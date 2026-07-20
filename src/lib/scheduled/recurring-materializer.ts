import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { bookRecurring, reverseRecurring } from "@/lib/financial/recurring-ledger";
import { readFxRates } from "@/lib/fx/fx-store";
import {
  mapSupabaseIncomeSource,
  mapSupabaseFixedExpense,
  type SupabaseIncomeSourceRow,
  type SupabaseFixedExpenseRow,
} from "@/lib/financial/onboarding-context-mappers";
import { readActiveSavingsPlans, type SavingsPlanRecord } from "@/lib/financial/savings-plans-store";
import { occurrencesDueUpTo, materializationMode, isoLocal, addDays, startOfDay } from "@/lib/financial/recurring-occurrence";
import {
  getOccurrence, createOccurrenceIfAbsent, updateOccurrence } from "@/lib/financial/recurring-occurrences-store";
import type { FxRate } from "@/lib/fx/fx-rates";

// Bloque C — the materialization orchestration. Runs from an evening cron. For each user with
// active recurring flows it, in the user's LOCAL day:
//   - fixed-amount flows (is_variable=false) → AUTO-book the due occurrence into the ledger
//     (via the single writer, native amount + resolved FX, idempotent) and mark it 'booked';
//   - variable-amount flows (is_variable=true) → create a 'pending' occurrence to ASK the user.
// Occasional/windfall income and paused/inactive flows are skipped (never projected as a
// scheduled payday). Idempotency is doubled: one occurrence row per (source,date) AND a ledger
// dedupeKey per (source,period). Nothing here is silent — the cron then delivers notify/ask.

const DEFAULT_TZ = "America/Guayaquil";

// The user's current LOCAL calendar day as a local-midnight Date (so the pure occurrence math,
// which reads local Y/M/D, matches the user's timezone rather than the server's UTC).
function userLocalToday(now: Date, tz: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = Number(get("year"));
    const m = Number(get("month"));
    const d = Number(get("day"));
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) return new Date(y, m - 1, d);
  } catch {
    /* fall through to server-local */
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

interface LiteAccount {
  id: string;
  name: string;
  currency: string | null;
  isPrimary: boolean;
  closed: boolean;
}

// A debt/loan/card (recurring payment). `type` decides materialization: loan → auto-book the
// fixed cuota; credit_card → ask on the pay day only when a statement amount exists; family/
// other → ask (irregular).
interface LiteDebt {
  id: string;
  name: string;
  type: string;
  dueDay: number | null;
  cutoffDay: number | null; // credit-card statement close day → the CORTE ask fires here
  minimumPayment: number | null;
  fullPaymentDue: number | null;
  currentBalance: number | null; // base currency; a card with no balance has no cut to report
  currency: string | null;
  defaultPaymentAccountId: string | null;
}

// A one-off planned payment on an exact date.
interface LiteScheduled {
  id: string;
  name: string;
  amount: number | null;
  currency: string | null;
  dueDate: string; // YYYY-MM-DD
}

interface UserBundle {
  baseCurrency: string;
  fxRates: FxRate[];
  timezone: string;
  accounts: LiteAccount[];
  income: ReturnType<typeof mapSupabaseIncomeSource>[];
  fixed: ReturnType<typeof mapSupabaseFixedExpense>[];
  debts: LiteDebt[];
  savingsPlans: SavingsPlanRecord[];
  scheduled: LiteScheduled[];
  monthlySavings: number; // legacy aggregate reserve scalar (used only when no savings plan)
  monthlyInvestment: number;
}

// Nadie tiene 300 flujos activos de un mismo tipo; el tope es sanitario y queda muy
// por debajo del max-rows de PostgREST (~1000) — un CAP mayor a ese tope jamás
// recibiría su fila CAP+1 y "completo" sería mentira (re-auditoría 3, punto 3).
const BUNDLE_CAP = 300;

/** Una zona que Intl no acepta materializaría el mes en el DÍA EQUIVOCADO. */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function loadUserBundle(userId: string): Promise<UserBundle | null> {
  try {
    const sb = createSupabaseAdminClient();
    const [profRes, incRes, fixRes, accRes, engRes, debtRes, schedRes, prefRes, plans, rates] = await Promise.all([
      sb.from("profiles").select("base_currency").eq("id", userId).maybeSingle(),
      sb.from("income_sources").select("*").eq("user_id", userId).eq("status", "active").limit(BUNDLE_CAP + 1),
      sb.from("fixed_expenses").select("*").eq("user_id", userId).eq("is_active", true).limit(BUNDLE_CAP + 1),
      sb.from("accounts").select("*").eq("user_id", userId).limit(BUNDLE_CAP + 1),
      sb.from("user_engagement").select("timezone").eq("user_id", userId).maybeSingle(),
      sb.from("debt_accounts").select("id, name, type, due_day, cutoff_day, minimum_payment, full_payment_due, current_balance_base, currency, default_payment_account_id").eq("user_id", userId).eq("status", "active").limit(BUNDLE_CAP + 1),
      sb.from("scheduled_payments").select("id, name, amount, currency, due_date").eq("user_id", userId).eq("status", "scheduled").limit(BUNDLE_CAP + 1),
      sb.from("user_financial_preferences").select("monthly_savings_commitment, monthly_investment_commitment").eq("user_id", userId).maybeSingle(),
      readActiveSavingsPlans(userId),
      readFxRates(userId),
    ]);
    // Completitud PROBADA por universo (CAP+1): un flujo cortado por el tope del
    // servidor materializaría el mes a medias con el cron verde.
    if (
      (incRes.data?.length ?? 0) > BUNDLE_CAP ||
      (fixRes.data?.length ?? 0) > BUNDLE_CAP ||
      (accRes.data?.length ?? 0) > BUNDLE_CAP ||
      (debtRes.data?.length ?? 0) > BUNDLE_CAP ||
      (schedRes.data?.length ?? 0) > BUNDLE_CAP
    ) {
      return null;
    }
    // Auditoría 4 (punto 3): sin fila de perfil (o sin base) no se materializa —
    // el `?? "USD"` fabricaba la base y bookeaba el mes en la moneda equivocada.
    if (!profRes.data) return null;
    const baseCurrency = String((profRes.data as { base_currency?: string | null }).base_currency ?? "").trim().toUpperCase();
    if (!baseCurrency) return null;
    // Re-auditoría 3 (punto 3): la ZONA participa del fail-closed. Una lectura
    // caída ya NO usa Guayaquil (materializaría en el día equivocado) — se salta
    // al usuario esta noche (error contado, 5xx) y se reintenta. Una fila AUSENTE
    // sí es el default legítimo (usuario sin zona declarada). Y una zona guardada
    // que Intl no acepta también rehúsa: mejor una noche tarde que el día errado.
    if (engRes.error) return null;
    const timezone = String(engRes.data?.timezone ?? DEFAULT_TZ) || DEFAULT_TZ;
    if (!isValidTimezone(timezone)) return null;
    const accounts: LiteAccount[] = (accRes.data ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        name: String(row.name ?? "cuenta"),
        currency: row.currency == null ? null : String(row.currency),
        isPrimary: row.is_primary === true,
        closed: row.status === "closed",
      };
    });
    const income = ((incRes.data ?? []) as SupabaseIncomeSourceRow[])
      .map(mapSupabaseIncomeSource)
      .filter((i) => !i.isOccasional); // windfalls are never a scheduled payday
    const fixed = ((fixRes.data ?? []) as SupabaseFixedExpenseRow[]).map(mapSupabaseFixedExpense);
    const debts: LiteDebt[] = (debtRes.data ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        name: String(row.name ?? "deuda"),
        type: String(row.type ?? "other_debt"),
        dueDay: row.due_day == null ? null : Number(row.due_day),
        cutoffDay: row.cutoff_day == null ? null : Number(row.cutoff_day),
        minimumPayment: row.minimum_payment == null ? null : Number(row.minimum_payment),
        fullPaymentDue: row.full_payment_due == null ? null : Number(row.full_payment_due),
        currentBalance: row.current_balance_base == null ? null : Number(row.current_balance_base),
        currency: row.currency == null ? null : String(row.currency),
        defaultPaymentAccountId: row.default_payment_account_id == null ? null : String(row.default_payment_account_id),
      };
    });
    const scheduled: LiteScheduled[] = (schedRes.data ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        name: String(row.name ?? "pago programado"),
        amount: row.amount == null ? null : Number(row.amount),
        currency: row.currency == null ? null : String(row.currency),
        dueDate: String(row.due_date ?? "").slice(0, 10),
      };
    });
    // Bloque I — este cron BOOKEA plata: un fallo aquí no muestra un número, aparta
    // o deja de apartar. Devolver null salta al usuario esta noche y lo reintenta la
    // siguiente (las ocurrencias son idempotentes por fecha), que es infinitamente
    // mejor que materializar un mes con las reservas o las tasas a medias.
    if (!plans.ok || !plans.complete || !rates.ok || !rates.complete) return null;
    if (prefRes.error || profRes.error || incRes.error || fixRes.error || accRes.error || debtRes.error || schedRes.error) return null;
    const monthlySavings = Number(prefRes.data?.monthly_savings_commitment ?? 0) || 0;
    const monthlyInvestment = Number(prefRes.data?.monthly_investment_commitment ?? 0) || 0;
    return {
      baseCurrency,
      fxRates: rates.rates,
      timezone,
      accounts,
      income,
      fixed,
      debts,
      savingsPlans: plans.plans,
      scheduled,
      monthlySavings,
      monthlyInvestment,
    };
  } catch {
    return null;
  }
}

function pickAccount(accounts: LiteAccount[], preferredId: string | null | undefined): LiteAccount | null {
  const open = accounts.filter((a) => !a.closed);
  if (preferredId) {
    const match = open.find((a) => a.id === preferredId);
    if (match) return match;
  }
  return open.find((a) => a.isPrimary) ?? open[0] ?? null;
}

// ── Re-auditoría 3 (punto 3) — descubrimiento por KEYSET con final PROBADO ───
// Páginas de 501 ≪ max-rows (~1000): la fila extra SÍ puede llegar, así que la
// página corta es una prueba real. Exportado para que el gate lo recorra con
// fetchers inyectados (error a mitad, >página, tope de vueltas).
export const DISCOVERY_PAGE = 500;
export const DISCOVERY_MAX_PAGES = 40;

export type DiscoveryPageFetch = (
  afterCursor: string | null,
  limit: number,
) => PromiseLike<{ data: unknown; error: unknown }>;

export async function pageDiscoveryUserIds(
  fetchers: DiscoveryPageFetch[],
  pageSize: number = DISCOVERY_PAGE,
  maxPages: number = DISCOVERY_MAX_PAGES,
): Promise<{ ids: string[]; ok: boolean }> {
  const ids = new Set<string>();
  let ok = true;
  for (const fetchPage of fetchers) {
    let after: string | null = null;
    let provenEnd = false;
    for (let p = 0; p < maxPages; p++) {
      const { data, error } = await fetchPage(after, pageSize + 1);
      if (error || !data) {
        // Un universo ilegible no es "sin usuarios": la corrida no es sana.
        ok = false;
        provenEnd = true;
        break;
      }
      const rows = data as { id?: unknown; user_id?: unknown }[];
      const hasTail = rows.length > pageSize;
      for (const r of rows.slice(0, pageSize)) {
        if (r.user_id != null) ids.add(String(r.user_id));
        const cursor = r.id ?? r.user_id;
        if (cursor != null) after = String(cursor);
      }
      if (!hasTail) {
        provenEnd = true;
        break;
      }
    }
    if (!provenEnd) ok = false; // tope de vueltas sin final probado
  }
  return { ids: [...ids], ok };
}

export interface MaterializeResult {
  /** El DESCUBRIMIENTO de usuarios pudo leer sus 6 universos y probar su final.
   *  false ⇒ hay usuarios cuya materialización de esta noche pudo saltarse en
   *  silencio — el route lo cuenta como corrida fallida (5xx, retry gratis). */
  ok: boolean;
  usersScanned: number;
  occurrencesCreated: number;
  autoBooked: number;
  asksCreated: number;
  skipped: number;
  errors: number;
}


// Re-auditoría 3 (punto 2) — ¿esta ocurrencia se intenta auto-bookear AHORA?
// La decisión clave es el REINTENTO: una ocurrencia AUTO que ya existía y sigue
// 'pending' (p.ej. el write del ledger falló anoche, o quedó blocked por FX) se
// vuelve a intentar — el book es idempotente (dup-check + dedupeKey), así que
// reintentar jamás duplica. El `continue` viejo la dejaba fuera del ledger para
// SIEMPRE con el cron verde: el gasto fijo desaparecía del Saldo hasta que el
// usuario respondiera a mano. Exportada para que el gate la recorra.
export function shouldAttemptAutoBook(
  created: { created: boolean; occurrence: { status: string; mode: string } },
  modeToday: "auto" | "ask",
): "book" | "ask" | "skip" {
  if (created.created) return modeToday === "ask" ? "ask" : "book";
  if (created.occurrence.mode === "auto" && created.occurrence.status === "pending") return "book";
  return "skip";
}

/** El resultado del book, contado con su naturaleza real: booked → marca estado;
 *  blocked → skipped legítimo (queda pending y el usuario resuelve por chat);
 *  failed → INFRA: cuenta error (el route responde 5xx) y queda REINTENTABLE. */
export function countBookOutcome(
  res: { status: "blocked" | "failed"; reason?: string },
  out: MaterializeResult,
): void {
  if (res.status === "blocked") out.skipped += 1;
  else out.errors += 1;
}

// Mark a just-booked occurrence; if the state write fails after a FRESH booking, reverse the
// ledger row so we never leave an orphan that a later ask/confirm would double-book (the book
// and the state transition are two writes, not one transaction).
async function markBookedOrReverse(
  userId: string,
  occurrenceId: string,
  booked: { txId: string; preexisting: boolean },
  out: MaterializeResult,
): Promise<void> {
  const upd = await updateOccurrence(userId, occurrenceId, {
    status: booked.preexisting ? "confirmed" : "booked",
    createdTransactionId: booked.txId,
    notified: booked.preexisting,
  });
  if (upd) {
    out.autoBooked += 1;
    return;
  }
  // State write failed — pero "falló" puede significar dos cosas MUY distintas: que el
  // UPDATE no se aplicó, o que se aplicó y se perdió la respuesta. Revertir a ciegas
  // trata las dos igual, y en el segundo caso borra un movimiento que SÍ quedó
  // registrado y que la ocurrencia ya da por booked: la plata desaparece del ledger y
  // Kipu igual le dijo al usuario "lo registré".
  // Así que se RE-LEE antes de deshacer. Si la ocurrencia quedó booked/confirmed con
  // nuestra misma transacción, el write había commiteado: no se toca nada.
  const fresh = await getOccurrence(userId, occurrenceId);
  if (fresh && fresh.createdTransactionId === booked.txId && (fresh.status === "booked" || fresh.status === "confirmed")) {
    out.autoBooked += 1;
    return;
  }
  // Si la re-lectura tampoco se pudo hacer (fresh === null), NO revertimos: no
  // podemos probar que el movimiento sea huérfano, y un cobro perdido es peor que una
  // ocurrencia que se reintenta. La clave de dedupe por monto+fecha impide el doble
  // book en el próximo run.
  if (!booked.preexisting && fresh) await reverseRecurring(userId, booked.txId);
  out.errors += 1;
}

export async function runDueRecurringMaterializations(
  now: Date = new Date(),
  onlyUserId?: string,
): Promise<MaterializeResult> {
  const out: MaterializeResult = {
    ok: true,
    usersScanned: 0,
    occurrencesCreated: 0,
    autoBooked: 0,
    asksCreated: 0,
    skipped: 0,
    errors: 0,
  };
  const sb = createSupabaseAdminClient();
  // Users with at least one active scheduled flow of ANY calendar type (optionally scoped to a
  // single user, e.g. a manual catch-up run for one account). Reserves via preferences scalars
  // are covered because such users always have income/fixed too — but include them explicitly.
  // Re-auditoría 3 (punto 3): el CAP 5000+1 anterior era una prueba IMPOSIBLE —
  // PostgREST recorta TODA petición a su max-rows (~1000), así que la fila 5001
  // jamás llegaba y una lectura truncada se declaraba completa. El descubrimiento
  // ahora pagina por KEYSET con páginas muy por debajo de ese tope; error o tope
  // sin final probado ⇒ ok:false y el route responde 5xx.
  const disc = await pageDiscoveryUserIds([
    (a, l) => { let q = sb.from("income_sources").select("id, user_id").eq("status", "active").order("id", { ascending: true }).limit(l); if (a) q = q.gt("id", a); return q; },
    (a, l) => { let q = sb.from("fixed_expenses").select("id, user_id").eq("is_active", true).order("id", { ascending: true }).limit(l); if (a) q = q.gt("id", a); return q; },
    (a, l) => { let q = sb.from("debt_accounts").select("id, user_id").eq("status", "active").order("id", { ascending: true }).limit(l); if (a) q = q.gt("id", a); return q; },
    (a, l) => { let q = sb.from("savings_plans").select("id, user_id").eq("status", "active").order("id", { ascending: true }).limit(l); if (a) q = q.gt("id", a); return q; },
    (a, l) => { let q = sb.from("scheduled_payments").select("id, user_id").eq("status", "scheduled").order("id", { ascending: true }).limit(l); if (a) q = q.gt("id", a); return q; },
    (a, l) => { let q = sb.from("user_financial_preferences").select("user_id").or("monthly_savings_commitment.gt.0,monthly_investment_commitment.gt.0").order("user_id", { ascending: true }).limit(l); if (a) q = q.gt("user_id", a); return q; },
  ]);
  if (!disc.ok) out.ok = false;
  const userIds = disc.ids.filter((id) => !onlyUserId || id === onlyUserId);

  for (const userId of userIds) {
    out.usersScanned += 1;
    const bundle = await loadUserBundle(userId);
    if (!bundle) {
      out.errors += 1;
      continue;
    }
    const today = userLocalToday(now, bundle.timezone);

    // ── Income flows ──────────────────────────────────────────────────────────
    for (const inc of bundle.income) {
      const dueDates = occurrencesDueUpTo(
        {
          frequency: inc.frequency,
          expectedDay: inc.expectedDay ?? null,
          expectedWeekday: inc.expectedWeekday ?? null,
          payAnchorDate: inc.payAnchorDate ?? null,
        },
        today,
      );
      for (const dateISO of dueDates) {
        const mode = materializationMode(inc.isVariable);
        const created = await createOccurrenceIfAbsent({
          userId,
          incomeSourceId: inc.id,
          occurrenceDate: dateISO,
          kind: "income",
          mode,
          expectedAmount: inc.amount ?? null,
          currency: inc.currency ?? null,
        });
        if (!created) {
          out.errors += 1;
          continue;
        }
        const decision = shouldAttemptAutoBook(created, mode);
        if (created.created) out.occurrencesCreated += 1;
        if (decision === "ask") {
          out.asksCreated += 1;
          continue;
        }
        if (decision === "skip") continue; // ya resuelta o en modo ask de una corrida previa
        const account = pickAccount(bundle.accounts, inc.destinationAccountId);
        if (!account) {
          out.skipped += 1;
          continue;
        }
        const booked = await bookRecurring({
          userId,
          kind: "income",
          nativeAmount: inc.amount ?? 0,
          nativeCurrency: inc.currency ?? bundle.baseCurrency,
          base: bundle.baseCurrency,
          rates: bundle.fxRates,
          accountId: account.id,
          accountCurrency: account.currency,
          isCard: false,
          dedupeKey: `recurring-income:${inc.id}:${dateISO}`,
          occurredAtISO: `${dateISO}T12:00:00.000Z`,
          occurrenceDateISO: dateISO,
          description: inc.name || "Ingreso recurrente",
          sourceLinkId: inc.id,
        });
        if (booked.status === "booked") {
          await markBookedOrReverse(userId, created.occurrence.id, { txId: booked.txId, preexisting: booked.preexisting }, out);
        } else {
          // blocked (sin cuenta/FX) queda 'pending' → el usuario resuelve por chat;
          // failed es INFRA → error (5xx) y REINTENTA la próxima corrida.
          countBookOutcome(booked, out);
        }
      }
    }

    // ── Fixed expense flows ───────────────────────────────────────────────────
    for (const fe of bundle.fixed) {
      const dueDates = occurrencesDueUpTo(
        {
          frequency: fe.frequency,
          expectedDay: fe.expectedDay ?? null,
          expectedWeekday: fe.expectedWeekday ?? null,
          payAnchorDate: fe.payAnchorDate ?? null,
        },
        today,
      );
      for (const dateISO of dueDates) {
        // A fixed expense with a FUTURE start_date must not be booked before it begins (mirrors
        // financial-calendar's start-date guard so the ledger and the projection agree).
        if (fe.startDate && dateISO < String(fe.startDate).slice(0, 10)) continue;
        const mode = materializationMode(fe.isVariable);
        const created = await createOccurrenceIfAbsent({
          userId,
          fixedExpenseId: fe.id,
          occurrenceDate: dateISO,
          kind: "expense",
          mode,
          expectedAmount: fe.amount ?? null,
          currency: fe.currency ?? null,
        });
        if (!created) {
          out.errors += 1;
          continue;
        }
        const decision = shouldAttemptAutoBook(created, mode);
        if (created.created) out.occurrencesCreated += 1;
        if (decision === "ask") {
          out.asksCreated += 1;
          continue;
        }
        if (decision === "skip") continue;
        // Card-paid fixed expense (payment_source_type='debt_account') → charge the card
        // (debt up, no cash out). paymentSourceId is a DEBT account id, not in `accounts`.
        const isCard = fe.paymentSourceType === "debt_account" && !!fe.paymentSourceId;
        let accountId: string;
        let accountCurrency: string | null;
        if (isCard) {
          accountId = fe.paymentSourceId as string; // ownership enforced by the ledger RPC
          // J-1: la moneda de la tarjeta es conocida (bundle) — con ella el book
          // puede BLOQUEAR un fijo en otra moneda en vez de fallar cada noche.
          accountCurrency = bundle.debts.find((d) => d.id === accountId)?.currency ?? null;
        } else {
          const account = pickAccount(
            bundle.accounts,
            fe.paymentSourceType === "account" ? fe.paymentSourceId : null,
          );
          if (!account) {
            out.skipped += 1;
            continue;
          }
          accountId = account.id;
          accountCurrency = account.currency;
        }
        const booked = await bookRecurring({
          userId,
          kind: "expense",
          nativeAmount: fe.amount ?? 0,
          nativeCurrency: fe.currency ?? bundle.baseCurrency,
          base: bundle.baseCurrency,
          rates: bundle.fxRates,
          accountId,
          accountCurrency,
          isCard,
          recurringExpenseId: fe.id, // this IS a fixed expense → valid recurring_expense_id
          dedupeKey: `recurring-expense:${fe.id}:${dateISO}`,
          occurredAtISO: `${dateISO}T12:00:00.000Z`,
          occurrenceDateISO: dateISO,
          description: fe.name || "Gasto fijo",
          sourceLinkId: fe.id,
        });
        if (booked.status === "booked") {
          await markBookedOrReverse(userId, created.occurrence.id, { txId: booked.txId, preexisting: booked.preexisting }, out);
        } else {
          // blocked queda 'pending' (el usuario resuelve por chat); failed = INFRA
          // → error (5xx) y reintenta la próxima corrida.
          countBookOutcome(booked, out);
        }
      }
    }

    // ── Every OTHER calendar flow now uses the same loop ──────────────────────
    await materializeDebts(userId, bundle, today, out);
    await materializeSavingsPlans(userId, bundle, today, out);
    await materializeScheduled(userId, bundle, today, out);
    await materializeCommitments(userId, bundle, today, out);
  }
  return out;
}

// ── Debts (loans / cards / family) ───────────────────────────────────────────
// A loan auto-books its fixed cuota (like a fixed expense). A credit card is ASKED on its pay
// day, but ONLY when a closed statement exists to pay (full_payment_due > 0) — it never auto-
// moves cash, and it stays in its own cycle (excluded from the Margen). Family/other debts are
// irregular → ASK. Every payment books as effectType 'debt_payment' (source cash down + debt
// down; card statement reduced on confirm) through the shared ledger.
async function materializeDebts(userId: string, bundle: UserBundle, today: Date, out: MaterializeResult): Promise<void> {
  for (const debt of bundle.debts) {
    // ── CORTE ask: a credit card with any activity asks on its cutoff day whether the statement
    //    arrived + how much, which SETS full_payment_due for the pago ask that follows. ──────────
    if (debt.type === "credit_card" && debt.cutoffDay != null && ((debt.currentBalance ?? 0) > 0 || (debt.fullPaymentDue ?? 0) > 0)) {
      const corteDates = occurrencesDueUpTo({ frequency: "monthly", expectedDay: debt.cutoffDay }, today);
      for (const dateISO of corteDates) {
        const created = await createOccurrenceIfAbsent({
          userId,
          debtAccountId: debt.id,
          occurrenceDate: dateISO,
          kind: "card_statement",
          mode: "ask",
          expectedAmount: (debt.fullPaymentDue ?? 0) > 0 ? debt.fullPaymentDue : null, // last cut as a hint
          currency: debt.currency ?? null,
        });
        if (!created) {
          out.errors += 1;
          continue;
        }
        if (!created.created) continue;
        out.occurrencesCreated += 1;
        out.asksCreated += 1;
      }
    }
    if (debt.dueDay == null) continue; // no scheduled pay day → nothing to fire
    const isLoan = debt.type === "loan";
    const isCard = debt.type === "credit_card";
    // A card whose statement-close day coincides with its pay day would fire the CORTE ask and the
    // PAGO ask on the same day. The corte owns that day (it captures the amount), so skip the pago
    // this cycle — it fires next cycle, once the corte has set the statement.
    // Raw-day equality (Stage F): the old flat-28 clamp made cutoff 30 == due 31.
    if (isCard && debt.cutoffDay != null && Math.round(debt.cutoffDay) === Math.round(debt.dueDay ?? -1)) continue;
    const dueDates = occurrencesDueUpTo({ frequency: "monthly", expectedDay: debt.dueDay }, today);
    for (const dateISO of dueDates) {
      // Loan → the fixed cuota; card → the closed statement; family/other → a soft target.
      const expected = isCard
        ? debt.fullPaymentDue ?? 0
        : debt.fullPaymentDue ?? debt.minimumPayment ?? 0;
      // A card with no live statement has nothing to pay this cycle — don't nag.
      if (isCard && !(expected > 0)) continue;
      // A loan AUTO-books only when its funding account is EXPLICITLY known (never guess an account
      // and mis-attribute a cuota); otherwise it ASKS. Family/other/cards always ask.
      const loanFunding =
        isLoan && debt.defaultPaymentAccountId
          ? bundle.accounts.find((a) => a.id === debt.defaultPaymentAccountId && !a.closed) ?? null
          : null;
      const mode = isLoan && expected > 0 && loanFunding ? "auto" : "ask";
      const created = await createOccurrenceIfAbsent({
        userId,
        debtAccountId: debt.id,
        occurrenceDate: dateISO,
        kind: "debt_payment",
        mode,
        expectedAmount: expected > 0 ? expected : null,
        currency: debt.currency ?? null,
      });
      if (!created) {
        out.errors += 1;
        continue;
      }
      const decision = shouldAttemptAutoBook(created, mode);
      if (created.created) out.occurrencesCreated += 1;
      if (decision === "ask") {
        out.asksCreated += 1;
        continue;
      }
      if (decision === "skip") continue;
      // AUTO loan: cash out of the EXPLICIT payment account (guaranteed by the mode check) + the
      // loan balance down.
      const source = loanFunding!;
      const booked = await bookRecurring({
        userId,
        kind: "debt_payment",
        nativeAmount: expected,
        nativeCurrency: debt.currency ?? bundle.baseCurrency,
        base: bundle.baseCurrency,
        rates: bundle.fxRates,
        accountId: source.id,
        accountCurrency: source.currency,
        isCard: false,
        debtAccountId: debt.id,
        debtCurrency: debt.currency,
        cardStatementDue: null, // loans carry no statement to reduce
        dedupeKey: `recurring-debt:${debt.id}:${dateISO}`,
        occurredAtISO: `${dateISO}T12:00:00.000Z`,
        occurrenceDateISO: dateISO,
        description: debt.name || "Pago de deuda",
        sourceLinkId: debt.id,
      });
      if (booked.status === "booked") await markBookedOrReverse(userId, created.occurrence.id, { txId: booked.txId, preexisting: booked.preexisting }, out);
      else countBookOutcome(booked, out);
    }
  }
}

// ── Savings / investment reserve plans (Stage 38) ────────────────────────────
// A reserve is ALWAYS ask: Kipu never silently assumes the user moved money aside. On confirm
// the resolver acknowledges it (a reserve is a Margen allocation, not necessarily a ledger move).
async function materializeSavingsPlans(userId: string, bundle: UserBundle, today: Date, out: MaterializeResult): Promise<void> {
  for (const plan of bundle.savingsPlans) {
    // A reserve is acknowledge-only (no phantom-money risk), so default a missing day to the 1st
    // rather than dropping the reserve entirely (income/fixed instead skip when the date is unknown).
    const dueDates = occurrencesDueUpTo(
      { frequency: plan.frequency, expectedDay: plan.expectedDay ?? 1, payAnchorDate: plan.payAnchorDate },
      today,
    );
    for (const dateISO of dueDates) {
      const created = await createOccurrenceIfAbsent({
        userId,
        savingsPlanId: plan.id,
        occurrenceDate: dateISO,
        kind: plan.kind, // 'savings' | 'investment'
        mode: "ask",
        expectedAmount: plan.originalAmount ?? plan.amountBase ?? null,
        currency: plan.originalCurrency ?? bundle.baseCurrency,
      });
      if (!created) {
        out.errors += 1;
        continue;
      }
      if (!created.created) continue;
      out.occurrencesCreated += 1;
      out.asksCreated += 1;
    }
  }
}

// ── One-off scheduled payments ───────────────────────────────────────────────
// Fires ONCE on the exact due_date (within the small look-back window). ASK before booking — a
// planned payment is a discrete act, not a guaranteed debit. Amountless ones are dropped (the
// calendar does the same). Books as a normal expense on confirm.
async function materializeScheduled(userId: string, bundle: UserBundle, today: Date, out: MaterializeResult): Promise<void> {
  const t = startOfDay(today);
  const todayIso = isoLocal(t);
  const windowStart = isoLocal(addDays(t, -2));
  for (const sp of bundle.scheduled) {
    if (!sp.dueDate || sp.amount == null || !(sp.amount > 0)) continue;
    if (sp.dueDate < windowStart || sp.dueDate > todayIso) continue; // only fire in the window
    const created = await createOccurrenceIfAbsent({
      userId,
      scheduledPaymentId: sp.id,
      occurrenceDate: sp.dueDate,
      kind: "expense",
      mode: "ask",
      expectedAmount: sp.amount,
      currency: sp.currency ?? bundle.baseCurrency,
    });
    if (!created) {
      out.errors += 1;
      continue;
    }
    if (!created.created) continue;
    out.occurrencesCreated += 1;
    out.asksCreated += 1;
  }
}

// ── Legacy aggregate reserve scalars ─────────────────────────────────────────
// For a user with a monthly savings/investment commitment but NO per-reserve plan, a monthly
// reserve check-in ("¿ya apartaste tus X?") on day 1. Skipped per-kind when a plan supersedes
// the scalar (so the reserve is never double-materialized). ASK, acknowledge-only on confirm.
async function materializeCommitments(userId: string, bundle: UserBundle, today: Date, out: MaterializeResult): Promise<void> {
  const hasSavingsPlan = bundle.savingsPlans.some((p) => p.kind === "savings");
  const hasInvestPlan = bundle.savingsPlans.some((p) => p.kind === "investment");
  const dueDates = occurrencesDueUpTo({ frequency: "monthly", expectedDay: 1 }, today);
  for (const dateISO of dueDates) {
    const scalars: { kind: "savings" | "investment"; amount: number; skip: boolean }[] = [
      { kind: "savings", amount: bundle.monthlySavings, skip: hasSavingsPlan },
      { kind: "investment", amount: bundle.monthlyInvestment, skip: hasInvestPlan },
    ];
    for (const s of scalars) {
      if (s.skip || !(s.amount > 0)) continue;
      const created = await createOccurrenceIfAbsent({
        userId,
        commitmentKind: s.kind,
        occurrenceDate: dateISO,
        kind: s.kind,
        mode: "ask",
        expectedAmount: s.amount,
        currency: bundle.baseCurrency,
      });
      if (!created) {
        out.errors += 1;
        continue;
      }
      if (!created.created) continue;
      out.occurrencesCreated += 1;
      out.asksCreated += 1;
    }
  }
}
