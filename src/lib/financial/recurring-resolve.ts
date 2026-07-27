import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { readFxRates, usableRates } from "@/lib/fx/fx-store";
import { convert } from "@/lib/fx/fx-rates";
import { readProfileBaseCurrency } from "@/lib/financial/profile-base";
import {
  bookRecurring,
  reverseRecurring,
  applyInvestmentOccurrence,
} from "@/lib/financial/recurring-ledger";
import { updateIncomeSourceFields } from "@/lib/financial/income-store";
import { updateFixedExpenseFields, setCardStatementDue, type SetCardStatementResult } from "@/lib/financial/commitments-store";
import { setMargenCommitments } from "@/lib/financial/coach-state-store";
import { updateSavingsPlanAmount } from "@/lib/financial/savings-plans-store";
import {
  readOccurrenceById,
  updateOccurrence,
  readOpenOccurrences,
  type OpenOccurrencesRead,
  type RecurringOccurrence,
  type OccurrenceKind,
  type OccurrencePatch,
} from "@/lib/financial/recurring-occurrences-store";

// Bloque C — resolve a recurring occurrence from chat. The agent maps the user's natural-
// language reply to one action; this module does the money + plan + state work safely and
// self-contained (loads the flow/account/FX itself so the agent tool stays thin). Every ledger
// write goes through the shared recurring-ledger (single writer, append-only reversal).
//
//   confirm  → booked: mark confirmed (no ledger change). pending: book the expected amount now.
//   correct  → book the REAL amount (reverse the auto-booked one first). scope 'from_now' also
//              updates the recurring PLAN. scope 'once' leaves the plan untouched.
//   skip     → didn't arrive: reverse the booking (if any) and mark skipped.
//   snooze   → keep pending, re-ask after snoozeUntil.
//   dismiss  → stop asking about this occurrence (mark dismissed).

export type ResolveAction = "confirm" | "correct" | "skip" | "snooze" | "dismiss";

export interface ResolveInput {
  userId: string;
  occurrenceId: string;
  action: ResolveAction;
  amount?: number; // native amount, required for 'correct'
  scope?: "once" | "from_now"; // for 'correct'; default 'once'
  snoozeUntilISO?: string; // for 'snooze'
}

export function reserveResolutionPatch(
  status: "confirmed" | "corrected",
  amount: number | null,
  currency: string | null,
): OccurrencePatch {
  const normalizedAmount =
    amount != null && Number.isFinite(amount) && amount >= 0
      ? Math.round(amount * 100) / 100
      : null;
  const normalizedCurrency =
    normalizedAmount == null
      ? null
      : /^[A-Z]{3}$/.test(String(currency ?? "").trim().toUpperCase())
        ? String(currency).trim().toUpperCase()
        : null;
  return {
    status,
    // The DB stores the pair all-or-none. If a legacy occurrence has no proven
    // native currency, keep both NULL instead of inventing one or failing the
    // terminal transition.
    resolvedAmount: normalizedCurrency ? normalizedAmount : null,
    resolvedCurrency: normalizedCurrency,
  };
}

interface FlowInfo {
  name: string;
  currency: string | null;
  accountId: string | null; // cash account: income destination / expense-or-debt-payment source
  accountCurrency: string | null;
  isCard: boolean; // a fixed expense charged to a card (debt up, no cash out)
  debtAccountId: string | null; // debt_payment: the liability paid down
  debtCurrency: string | null;
  cardStatementDue: number | null; // credit-card "pago del mes" to reduce on payment
  bookable: boolean; // a reserve (savings/investment) is acknowledged WITHOUT a ledger row
  // An INVESTMENT reserve whose plan has BOTH a funding account AND a destination asset →
  // confirming it books a net-worth-neutral transfer (account ↓ + asset ↑) instead of a plain
  // acknowledge. NULL for pure reserves (savings, or an investment with no source/asset set).
  investmentTransfer: {
    sourceAccountId: string;
    sourceAccountCurrency: string | null;
    assetId: string;
    assetName: string | null;
    assetCurrency: string | null;
  } | null;
}

export function usableSavingsPlanFlowRow<T>(
  read: { data: T | null; error: unknown },
): T | null {
  return read.error == null && read.data != null ? read.data : null;
}

export const RECURRING_FLOW_ACCOUNTS_CAP = 200;

async function loadFlowInfo(userId: string, occ: RecurringOccurrence): Promise<FlowInfo | null> {
  const sb = createSupabaseAdminClient();
  const { data: accData, error: accError } = await sb
    .from("accounts")
    .select("*")
    .eq("user_id", userId)
    .order("id", { ascending: true })
    .limit(RECURRING_FLOW_ACCOUNTS_CAP + 1);
  // The account inventory chooses the actual cash leg. An error or server cap
  // cannot mean "use the first/primary account I happened to see".
  if (accError || !accData || accData.length > RECURRING_FLOW_ACCOUNTS_CAP) {
    return null;
  }
  const accounts = accData.map((r) => r as Record<string, unknown>).filter((a) => a.status !== "closed");
  const pick = (preferredId: string | null): { id: string; currency: string | null } | null => {
    const match = preferredId ? accounts.find((a) => String(a.id) === preferredId) : null;
    const chosen = match ?? accounts.find((a) => a.is_primary === true) ?? accounts[0];
    return chosen ? { id: String(chosen.id), currency: chosen.currency == null ? null : String(chosen.currency) } : null;
  };
  const base = (): Omit<FlowInfo, "name" | "currency"> => ({
    accountId: null,
    accountCurrency: null,
    isCard: false,
    debtAccountId: null,
    debtCurrency: null,
    cardStatementDue: null,
    bookable: true,
    investmentTransfer: null,
  });
  if (occ.incomeSourceId) {
    const { data, error } = await sb
      .from("income_sources")
      .select("name, currency, destination_account_id")
      .eq("user_id", userId)
      .eq("id", occ.incomeSourceId)
      .maybeSingle();
    if (error || !data) return null;
    const acc = pick(data.destination_account_id ? String(data.destination_account_id) : null);
    return {
      ...base(),
      name: String(data.name ?? "ingreso"),
      currency: data.currency == null ? occ.currency : String(data.currency),
      accountId: acc?.id ?? null,
      accountCurrency: acc?.currency ?? null,
    };
  }
  if (occ.fixedExpenseId) {
    const { data, error } = await sb
      .from("fixed_expenses")
      .select("name, currency, payment_source_type, payment_source_id")
      .eq("user_id", userId)
      .eq("id", occ.fixedExpenseId)
      .maybeSingle();
    if (error || !data) return null;
    const isCard = data.payment_source_type === "debt_account" && !!data.payment_source_id;
    if (isCard) {
      // J-1: la moneda de la tarjeta viaja en el flow para que el book pueda
      // bloquear un fijo en otra moneda (jamás restar original-sobre-original).
      const { data: cardRow, error: cardError } = await sb
        .from("debt_accounts")
        .select("currency")
        .eq("user_id", userId)
        .eq("id", String(data.payment_source_id))
        .maybeSingle();
      if (cardError || !cardRow) return null;
      return {
        ...base(),
        name: String(data.name ?? "gasto"),
        currency: data.currency == null ? occ.currency : String(data.currency),
        accountId: String(data.payment_source_id),
        accountCurrency: cardRow?.currency == null ? null : String(cardRow.currency),
        isCard: true,
      };
    }
    const acc = pick(data.payment_source_type === "account" && data.payment_source_id ? String(data.payment_source_id) : null);
    return {
      ...base(),
      name: String(data.name ?? "gasto"),
      currency: data.currency == null ? occ.currency : String(data.currency),
      accountId: acc?.id ?? null,
      accountCurrency: acc?.currency ?? null,
    };
  }
  if (occ.kind === "card_statement" && occ.debtAccountId) {
    // The CORTE ask — capturing the statement amount, not a payment. Non-bookable: on confirm it
    // SETS full_payment_due (handled in resolveOccurrence), no cash moves.
    const { data, error } = await sb
      .from("debt_accounts")
      .select("name, currency")
      .eq("user_id", userId)
      .eq("id", occ.debtAccountId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      ...base(),
      name: String(data?.name ?? "tarjeta"),
      currency: data?.currency ? String(data.currency) : occ.currency,
      debtAccountId: occ.debtAccountId,
      bookable: false,
    };
  }
  if (occ.debtAccountId) {
    // A loan/card/family-debt payment: cash out of the debt's payment account + the debt down.
    const { data, error } = await sb
      .from("debt_accounts")
      .select("name, type, currency, full_payment_due, default_payment_account_id")
      .eq("user_id", userId)
      .eq("id", occ.debtAccountId)
      .maybeSingle();
    if (error || !data) return null;
    const acc = pick(data.default_payment_account_id ? String(data.default_payment_account_id) : null);
    const isCreditCard = data.type === "credit_card";
    return {
      ...base(),
      name: String(data.name ?? "deuda"),
      currency: data.currency == null ? occ.currency : String(data.currency),
      accountId: acc?.id ?? null,
      accountCurrency: acc?.currency ?? null,
      debtAccountId: occ.debtAccountId,
      debtCurrency: data.currency == null ? occ.currency : String(data.currency),
      // Only a credit card carries a per-cycle statement to reduce; loans/family do not.
      cardStatementDue: isCreditCard && data.full_payment_due != null ? Number(data.full_payment_due) : null,
    };
  }
  if (occ.scheduledPaymentId) {
    const { data, error } = await sb
      .from("scheduled_payments")
      .select("name, currency, payment_source_type, payment_source_id")
      .eq("user_id", userId)
      .eq("id", occ.scheduledPaymentId)
      .maybeSingle();
    if (error || !data) return null;
    const acc = pick(data.payment_source_type === "account" && data.payment_source_id ? String(data.payment_source_id) : null);
    return {
      ...base(),
      name: String(data.name ?? "pago programado"),
      currency: data.currency == null ? occ.currency : String(data.currency),
      accountId: acc?.id ?? null,
      accountCurrency: acc?.currency ?? null,
    };
  }
  if (occ.savingsPlanId) {
    const planRead = await sb
      .from("savings_plans")
      .select("name, original_currency, base_currency, kind, source_account_id, destination_asset_id")
      .eq("user_id", userId)
      .eq("id", occ.savingsPlanId)
      .maybeSingle();
    // Bloque I doctrine: "no pude leer el plan" is not "es una reserva pura".
    // The old fallback closed a linked investment as merely set aside when this
    // query returned {data:null,error}, skipping both cash and asset writes.
    const data = usableSavingsPlanFlowRow(planRead);
    if (!data) return null;
    // An investment plan with BOTH a funding account AND a destination asset → a real transfer on
    // confirm; otherwise a pure reserve (acknowledged, no ledger movement).
    let investmentTransfer: FlowInfo["investmentTransfer"] = null;
    if (data.kind === "investment" && data.source_account_id && data.destination_asset_id) {
      const src = accounts.find((a) => String(a.id) === String(data.source_account_id));
      const { data: assetRow, error: assetError } = await sb
        .from("investment_accounts")
        .select("name, currency")
        .eq("user_id", userId)
        .eq("id", String(data.destination_asset_id))
        .maybeSingle();
      if (assetError || !assetRow) return null;
      investmentTransfer = {
        sourceAccountId: String(data.source_account_id),
        sourceAccountCurrency: src && src.currency != null ? String(src.currency) : null,
        assetId: String(data.destination_asset_id),
        assetName: assetRow?.name ? String(assetRow.name) : null,
        assetCurrency: assetRow?.currency ? String(assetRow.currency) : null,
      };
    }
    return {
      ...base(),
      name: String(data.name ?? (occ.kind === "investment" ? "inversión" : "ahorro")),
      currency: data.original_currency ? String(data.original_currency) : occ.currency,
      bookable: false,
      investmentTransfer,
    };
  }
  if (occ.commitmentKind) {
    return {
      ...base(),
      name: occ.commitmentKind === "investment" ? "inversión" : "ahorro",
      currency: occ.currency,
      bookable: false,
    };
  }
  return null;
}

async function bookAmount(
  userId: string,
  occ: RecurringOccurrence,
  flow: FlowInfo,
  nativeAmount: number,
): Promise<string | null> {
  if (!flow.bookable) return null; // a reserve is acknowledged, never booked here
  if (!flow.accountId) return null; // need a cash account (source/destination)
  // Auditoría 4 (punto 3): la base se PRUEBA o no hay write — el `?? "USD"` viejo
  // fabricaba base USD ante una lectura de perfil caída y el booking extranjero se
  // registraba con la moneda equivocada.
  const baseRead = await readProfileBaseCurrency(userId);
  if (!baseRead.ok) return null;
  const base = baseRead.base;
  const rates = usableRates(await readFxRates(userId));
  const linkId =
    occ.incomeSourceId ?? occ.fixedExpenseId ?? occ.debtAccountId ?? occ.scheduledPaymentId ?? occ.savingsPlanId ?? occ.id;
  const bookKind: "income" | "expense" | "debt_payment" =
    occ.kind === "debt_payment" ? "debt_payment" : occ.kind === "income" ? "income" : "expense";
  // Amount-based key (NOT the auto-book `:${date}` key): so a correction rebooking after the
  // auto row was reversed is not blocked by the reversed row's dedupe key, while re-confirming
  // the SAME amount stays idempotent. bookRecurring still runs findAlreadyRecorded, so a manual
  // log or an orphaned auto-booking of this amount is reused, never double-booked.
  const booked = await bookRecurring({
    userId,
    kind: bookKind,
    nativeAmount,
    nativeCurrency: flow.currency,
    base,
    rates,
    accountId: flow.accountId,
    accountCurrency: flow.accountCurrency,
    isCard: flow.isCard,
    debtAccountId: flow.debtAccountId,
    debtCurrency: flow.debtCurrency,
    cardStatementDue: flow.cardStatementDue,
    recurringExpenseId: occ.fixedExpenseId ?? null, // ONLY a fixed expense links to fixed_expenses

    dedupeKey: `recurring-${occ.kind}:${linkId}:${occ.occurrenceDate}:r${Math.round(nativeAmount * 100)}`,
    occurredAtISO: `${occ.occurrenceDate}T12:00:00.000Z`,
    occurrenceDateISO: occ.occurrenceDate,
    description: flow.name,
    sourceLinkId: linkId,
  });
  // blocked y failed colapsan a null aquí: el flujo conversacional le dice al
  // usuario que no se pudo registrar y el reintento es su propia re-confirmación
  // (idempotente por dedupe + dup-check). No hay cron verde que engañar en este
  // camino — la respuesta honesta llega en el mismo turno.
  return booked.status === "booked" ? booked.txId : null;
}

// Realize an investment reserve as a net-worth-neutral transfer (funding account ↓ + Etoro-style
// asset ↑). Loads base + FX itself (like bookAmount) and delegates the money-safety to the ledger.
async function bookInvestmentTransfer(
  userId: string,
  occ: RecurringOccurrence,
  flow: FlowInfo,
  nativeAmount: number,
  action: "confirm" | "correct",
): Promise<{ txId: string; replayed: boolean } | null> {
  const it = flow.investmentTransfer;
  if (!it) return null;
  // Auditoría 4 (punto 3): misma regla — base probada o no hay write.
  const baseRead = await readProfileBaseCurrency(userId);
  if (!baseRead.ok) return null;
  const base = baseRead.base;
  const rates = usableRates(await readFxRates(userId));
  const linkId = occ.savingsPlanId ?? occ.id;
  return applyInvestmentOccurrence({
    userId,
    occurrenceId: occ.id,
    action,
    sourceAccountId: it.sourceAccountId,
    sourceAccountCurrency: it.sourceAccountCurrency,
    assetId: it.assetId,
    assetCurrency: it.assetCurrency,
    nativeAmount,
    nativeCurrency: flow.currency,
    base,
    rates,
    dedupeKey: `recurring-investment:${linkId}:${occ.occurrenceDate}:r${Math.round(nativeAmount * 100)}`,
    occurredAtISO: `${occ.occurrenceDate}T12:00:00.000Z`,
    description: flow.name,
  });
}

async function updatePlanAmount(
  userId: string,
  occ: RecurringOccurrence,
  amount: number,
  currency: string | null,
): Promise<boolean> {
  if (occ.incomeSourceId) {
    return updateIncomeSourceFields(userId, occ.incomeSourceId, { amount });
  }
  if (occ.fixedExpenseId) {
    return updateFixedExpenseFields({ userId, id: occ.fixedExpenseId, amount });
  }
  if (occ.savingsPlanId || occ.commitmentKind) {
    const nativeCurrency = String(currency ?? "").trim().toUpperCase();
    const baseRead = await readProfileBaseCurrency(userId);
    if (!baseRead.ok || !/^[A-Z]{3}$/.test(nativeCurrency)) return false;
    const base = baseRead.base.toUpperCase();
    let amountBase = amount;
    if (nativeCurrency !== base) {
      const fxRead = await readFxRates(userId);
      if (!fxRead.ok) return false;
      const valued = convert(amount, nativeCurrency, base, usableRates(fxRead));
      if (!valued.ok) return false;
      amountBase = valued.baseAmount;
    }
    if (occ.savingsPlanId) {
      const updated = await updateSavingsPlanAmount({
        userId,
        planId: occ.savingsPlanId,
        amount,
        currency: nativeCurrency,
        amountBase,
        baseCurrency: base,
      });
      return updated.ok;
    }
    // Aggregate reserve occurrences have no plan row; their authoritative
    // recurring target is the corresponding capacity commitment in base.
    return occ.commitmentKind === "investment"
      ? setMargenCommitments({ userId, monthlyInvestment: amountBase })
      : setMargenCommitments({ userId, monthlySavings: amountBase });
  }
  return false;
}

function sameResolvedCorrection(occ: RecurringOccurrence, amount: number): boolean {
  return (
    occ.status === "corrected" &&
    occ.resolvedAmount != null &&
    Math.abs(occ.resolvedAmount - amount) < 0.005
  );
}

async function updatePermanentPlanAfterResolvedOccurrence(
  input: ResolveInput,
  occ: RecurringOccurrence,
  currency: string | null,
): Promise<{ ok: boolean; detail: string }> {
  if (input.amount == null || !(input.amount > 0)) {
    return { ok: false, detail: "¿cuál es el monto correcto de ahora en más?" };
  }
  const planOk = await updatePlanAmount(input.userId, occ, input.amount, currency);
  return planOk
    ? { ok: true, detail: "corregido, y actualicé el plan de ahora en más" }
    : {
        ok: false,
        detail:
          "La corrección de este mes quedó registrada, pero no pude actualizar el plan. Reinténtalo: no voy a volver a mover el dinero.",
      };
}

// ── Auditoría 4 (punto 2) — el corte de tarjeta transiciona SOLO con write probado ──
// El flujo viejo marcaba la ocurrencia confirmed/corrected ANTES de mirar el
// resultado de setCardStatementDue — y el confirm hasta respondía ok:true con el
// write caído. Un corte no anotado con la ocurrencia terminal jamás se reintenta:
// el "pago del mes" queda viejo y el ask de pago usa una cifra que no existe.
// Regla: primero el DINERO (set), después el estado; cualquier resultado no probado
// deja la ocurrencia pending (el set es idempotente: re-poner el mismo corte es
// seguro). Extraído con deps para que el gate recorra los dos caminos reales.
//
// Pasada 5 (punto 1): setDue devuelve el resultado TIPADO de la RPC con lock
// (kipu_set_card_statement vía setCardStatementDueWith) — `updated` anota;
// `safe_newer_exists` significa que un corte MÁS NUEVO aterrizó concurrentemente:
// NO se pisó y este aviso viejo se cierra diciéndolo; {ok:false} (cero filas,
// no-tarjeta, infra) sigue sin transición terminal.
export interface CardStatementResolveDeps {
  setDue: (amount: number) => Promise<SetCardStatementResult>;
  mark: (status: "confirmed" | "corrected") => Promise<boolean>;
}

export async function resolveCardStatementOcc(
  deps: CardStatementResolveDeps,
  action: "confirm" | "correct",
  amount: number,
): Promise<{ ok: boolean; detail: string }> {
  const set = await deps.setDue(amount);
  if (!set.ok) {
    // El write NO está probado: nada de terminal — queda pending y se reintenta.
    return { ok: false, detail: "no pude anotar el corte; reintentá en un momento" };
  }
  // Migration 075 closes the occurrence in the SAME transaction as the card
  // state. Keep the old mark as a deployment/back-compat bridge only when the
  // RPC response proves that atomic effect was not available.
  if (set.occurrenceResolution === "none") {
    const marked = await deps.mark(action === "confirm" ? "confirmed" : "corrected");
    if (!marked) {
      // The card was written but an old RPC did not close the occurrence.
      // Pending ⇒ retrying the same idempotent statement is safe.
      return { ok: false, detail: "anoté el corte pero no pude cerrar el aviso; reintentá en un momento" };
    }
  }
  if (set.outcome === "safe_newer_exists") {
    return { ok: true, detail: "ya tenías anotado un corte más nuevo, así que no lo pisé; cerré este aviso viejo" };
  }
  return { ok: true, detail: action === "confirm" ? `anotado, tu corte quedó en ${amount}` : `listo, tu corte de este mes quedó en ${amount}` };
}

// J-7 (barrido 3). `updateOccurrence` devuelve `| null` y se traga la excepción, así
// que un `await` suelto convierte una escritura FALLIDA en un éxito narrado: Kipu
// dice «ok, no te pregunto más por esto» y mañana lo vuelve a preguntar. Es el
// defecto de J-5 exacto, en los caminos que J-5 no tocó (J-5 solo cubrió
// card_statement). Los sitios que SÍ escriben dinero ya lo verificaban; los que solo
// marcan estado, no. Este helper es el único acceso permitido: devuelve el resultado
// tipado para que la marca no verificada no se pueda volver a escribir por descuido.
async function markOccurrence(
  userId: string,
  occurrenceId: string,
  patch: Parameters<typeof updateOccurrence>[2],
  okDetail: string,
  failDetail: string,
): Promise<{ ok: boolean; detail: string }> {
  const row = await updateOccurrence(userId, occurrenceId, patch);
  return row ? { ok: true, detail: okDetail } : { ok: false, detail: failDetail };
}

export async function resolveOccurrence(input: ResolveInput): Promise<{ ok: boolean; detail: string }> {
  const occurrenceRead = await readOccurrenceById(input.userId, input.occurrenceId);
  if (!occurrenceRead.ok) {
    return { ok: false, detail: "no pude leer ese aviso ahora; no cambié nada. Reintentá en un momento" };
  }
  const occ = occurrenceRead.occurrence;
  if (!occ) return { ok: false, detail: "no encuentro ese movimiento recurrente" };
  if (["confirmed", "corrected", "skipped", "dismissed"].includes(occ.status)) {
    // Recovery for the only intentional two-step boundary left here: the
    // occurrence/money may have committed while the permanent plan update
    // failed or its response was lost. Retrying the SAME correction must finish
    // the plan update without booking/moving the occurrence again.
    if (
      input.action === "correct" &&
      input.scope === "from_now" &&
      input.amount != null &&
      sameResolvedCorrection(occ, input.amount)
    ) {
      return updatePermanentPlanAfterResolvedOccurrence(
        input,
        occ,
        occ.resolvedCurrency ?? occ.currency,
      );
    }
    return { ok: false, detail: "ese movimiento ya estaba resuelto" };
  }

  switch (input.action) {
    case "snooze": {
      const until = input.snoozeUntilISO && !Number.isNaN(Date.parse(input.snoozeUntilISO))
        ? input.snoozeUntilISO
        : new Date(Date.now() + 86_400_000).toISOString();
      return markOccurrence(input.userId, occ.id, { snoozeUntil: until },
        "listo, te lo recuerdo más tarde",
        "no pude agendar el recordatorio; reintentá en un momento");
    }
    case "dismiss": {
      return markOccurrence(input.userId, occ.id, { status: "dismissed" },
        "ok, no te pregunto más por esto",
        "no pude cerrarlo, así que te lo voy a volver a preguntar; reintentá en un momento");
    }
    case "skip": {
      if (occ.status === "booked" && occ.createdTransactionId) {
        const rev = await reverseRecurring(input.userId, occ.createdTransactionId);
        if (!rev) {
          // Reversal did not commit → do NOT mark terminal (would leave the tx applied while
          // telling the user it was removed). Leave it open to retry.
          return { ok: false, detail: "no pude revertir el registro anterior; reintentá en un momento" };
        }
      }
      return markOccurrence(input.userId, occ.id, { status: "skipped" },
        "lo saqué del cálculo; no se registró nada",
        "saqué el registro pero no pude cerrar el aviso; reintentá en un momento");
    }
    case "confirm": {
      if (occ.status === "booked") {
        return markOccurrence(input.userId, occ.id, { status: "confirmed" },
          "confirmado",
          "no pude cerrar el aviso; reintentá en un momento");
      }
      // pending → acknowledge (reserve) or book the expected amount (cash-flow / debt).
      const flow = await loadFlowInfo(input.userId, occ);
      if (!flow) return { ok: false, detail: "no pude cargar los datos del flujo" };
      if (occ.kind === "card_statement") {
        // The corte arrived at the hinted amount → set the statement so the pago ask can use it.
        const amt = occ.expectedAmount;
        if (amt == null || !(amt > 0) || !flow.debtAccountId) {
          return { ok: false, detail: "¿de cuánto vino el corte?" };
        }
        return resolveCardStatementOcc(
          {
            setDue: (amount) => setCardStatementDue({
              userId: input.userId,
              debtAccountId: flow.debtAccountId!,
              amount,
              statementDateISO: occ.occurrenceDate,
              occurrenceId: occ.id,
            }),
            mark: async (status) => (await updateOccurrence(input.userId, occ.id, { status })) != null,
          },
          "confirm",
          amt,
        );
      }
      if (flow.investmentTransfer) {
        // Investment reserve WITH a funding account + destination asset → move the money for real.
        const amt = occ.expectedAmount;
        if (amt == null || !(amt > 0)) return { ok: false, detail: "¿de cuánto fue la inversión?" };
        const booked = await bookInvestmentTransfer(input.userId, occ, flow, amt, "confirm");
        if (!booked) return { ok: false, detail: "no pude registrar la inversión (¿falta cuenta o tipo de cambio?)" };
        return {
          ok: true,
          detail: booked.replayed
            ? `esa inversión ya estaba registrada en ${flow.investmentTransfer.assetName ?? flow.name}`
            : `listo, moví ${amt} a ${flow.investmentTransfer.assetName ?? flow.name}`,
        };
      }
      if (!flow.bookable) {
        // Una reserva pura no mueve el ledger, pero el monto confirmado sí es
        // un hecho auditable de ESTE mes (no reescribe el plan).
        return markOccurrence(input.userId, occ.id, reserveResolutionPatch(
          "confirmed",
          occ.expectedAmount,
          flow.currency ?? occ.currency,
        ),
          `listo, marqué tu ${flow.name} de este mes como apartado`,
          "no pude cerrar el aviso; reintentá en un momento");
      }
      if (occ.expectedAmount == null) {
        return { ok: false, detail: "necesito el monto para registrarlo; ¿cuánto fue?" };
      }
      const txId = await bookAmount(input.userId, occ, flow, occ.expectedAmount);
      if (!txId) return { ok: false, detail: "no pude registrarlo (¿falta cuenta o tipo de cambio?)" };
      const upd = await updateOccurrence(input.userId, occ.id, { status: "confirmed", createdTransactionId: txId });
      if (!upd) {
        // State write failed after a fresh booking → reverse it so the still-'pending' occurrence
        // re-books cleanly on retry instead of leaving a ghost payment (mirrors markBookedOrReverse).
        await reverseRecurring(input.userId, txId);
        return { ok: false, detail: "no pude cerrar el registro; reintentá en un momento" };
      }
      return { ok: true, detail: "registrado" };
    }
    case "correct": {
      if (input.amount == null || !(input.amount > 0)) {
        return { ok: false, detail: "¿cuál es el monto correcto?" };
      }
      const flow = await loadFlowInfo(input.userId, occ);
      if (!flow) return { ok: false, detail: "no pude cargar los datos del flujo" };
      if (occ.kind === "card_statement") {
        // The corte came in at a different amount → set the statement to the real cut.
        if (!flow.debtAccountId) return { ok: false, detail: "no pude anotar el corte" };
        return resolveCardStatementOcc(
          {
            setDue: (amount) => setCardStatementDue({
              userId: input.userId,
              debtAccountId: flow.debtAccountId!,
              amount,
              statementDateISO: occ.occurrenceDate,
              occurrenceId: occ.id,
            }),
            mark: async (status) => (await updateOccurrence(input.userId, occ.id, { status })) != null,
          },
          "correct",
          input.amount,
        );
      }
      if (flow.investmentTransfer) {
        const booked = await bookInvestmentTransfer(input.userId, occ, flow, input.amount, "correct");
        if (!booked) return { ok: false, detail: "no pude registrar la inversión (¿falta cuenta o tipo de cambio?)" };
        if (input.scope === "from_now") {
          return updatePermanentPlanAfterResolvedOccurrence(input, occ, flow.currency ?? occ.currency);
        }
        return {
          ok: true,
          detail: booked.replayed
            ? `esa inversión ya estaba registrada en ${flow.investmentTransfer.assetName ?? flow.name}`
            : `listo, moví ${input.amount} a ${flow.investmentTransfer.assetName ?? flow.name}`,
        };
      }
      if (!flow.bookable) {
        // Reserve: record the real amount set aside; no ledger row. (A permanent change to the
        // reserve target is applied after this per-month fact and is safely
        // recoverable by retrying the same correction).
        const marked = await markOccurrence(input.userId, occ.id, reserveResolutionPatch(
          "corrected",
          input.amount,
          flow.currency ?? occ.currency,
        ),
          `anotado, apartaste ese monto de tu ${flow.name} este mes`,
          "no pude cerrar el aviso; reintentá en un momento");
        if (!marked.ok || input.scope !== "from_now") return marked;
        return updatePermanentPlanAfterResolvedOccurrence(input, occ, flow.currency ?? occ.currency);
      }
      // Reverse the auto-booking (if any) BEFORE rebooking at the real amount — and abort if the
      // reversal did not commit, so we never leave the original applied AND book a second row.
      const wasBooked = occ.status === "booked" && !!occ.createdTransactionId;
      if (wasBooked) {
        const rev = await reverseRecurring(input.userId, occ.createdTransactionId!);
        if (!rev) return { ok: false, detail: "no pude revertir el registro anterior; reintentá en un momento" };
      }
      const txId = await bookAmount(input.userId, occ, flow, input.amount);
      if (!txId) {
        // The original was already reversed but the rebook failed → do NOT leave the occurrence
        // 'booked' pointing at a reversed row (a later confirm would claim it paid). Reset it to
        // 'pending' with no tx so it re-asks the amount, instead of silently under-counting.
        const reset = wasBooked
          ? await updateOccurrence(input.userId, occ.id, { status: "pending", createdTransactionId: null })
          : true;
        return {
          ok: false,
          detail: reset
            ? "no pude registrar el monto corregido; revertí el anterior, decime el monto de nuevo"
            : "revertí el registro anterior pero no pude reabrir el aviso; reintentá en un momento",
        };
      }
      const updc = await updateOccurrence(input.userId, occ.id, {
        ...reserveResolutionPatch("corrected", input.amount, flow.currency ?? occ.currency),
        createdTransactionId: txId,
      });
      if (!updc) {
        await reverseRecurring(input.userId, txId); // don't leave a ghost the retry could re-book past
        return { ok: false, detail: "no pude cerrar la corrección; reintentá en un momento" };
      }
      if (input.scope === "from_now") {
        return updatePermanentPlanAfterResolvedOccurrence(input, occ, flow.currency ?? occ.currency);
      }
      return { ok: true, detail: "corregido solo por esta vez; el plan queda igual" };
    }
    default:
      return { ok: false, detail: "acción no reconocida" };
  }
}

// ── Agent surfacing ──────────────────────────────────────────────────────────
// A compact facts block for the agent prompt + a resolver's-eye name map, so the
// agent can map a reply ("sí", "fueron 45000", "no vino") to the right occurrence id.

// The occurrence's source discriminator as a stable string key (aggregate reserves have no row,
// so they key by kind). Used to join an occurrence to its human name + to match a user reply.
function sourceKey(o: RecurringOccurrence): string {
  return (
    o.incomeSourceId ??
    o.fixedExpenseId ??
    o.debtAccountId ??
    o.savingsPlanId ??
    o.scheduledPaymentId ??
    (o.commitmentKind ? `commit:${o.commitmentKind}` : "")
  );
}

function kindLabel(k: OccurrenceKind): string {
  switch (k) {
    case "income":
      return "ingreso";
    case "expense":
      return "gasto";
    case "debt_payment":
      return "pago de deuda";
    case "savings":
      return "ahorro";
    case "investment":
      return "inversión";
    case "card_statement":
      return "corte de tarjeta";
    default:
      return "movimiento";
  }
}

export type OccurrenceNamesRead =
  | { ok: true; names: Map<string, string> }
  | { ok: false };

export function occurrenceNamesCover(
  occurrences: RecurringOccurrence[],
  names: ReadonlyMap<string, string>,
): boolean {
  return occurrences.every((o) => {
    const key = sourceKey(o);
    return !!key && names.has(key);
  });
}

export async function readOccurrenceNames(
  userId: string,
  occ: RecurringOccurrence[],
): Promise<OccurrenceNamesRead> {
  const names = new Map<string, string>();
  if (occ.length === 0) return { ok: true, names };
  try {
    const sb = createSupabaseAdminClient();
    // Query only the source ids present in the already-bounded occurrence set.
    // Reading whole source tables would re-introduce a silent PostgREST cap:
    // one of two similarly named cards could disappear from the name map and a
    // substring such as "Visa" would look falsely unique.
    const ids = (pick: (o: RecurringOccurrence) => string | null): string[] =>
      [...new Set(occ.map(pick).filter((id): id is string => !!id))];
    const incomeIds = ids((o) => o.incomeSourceId);
    const fixedIds = ids((o) => o.fixedExpenseId);
    const debtIds = ids((o) => o.debtAccountId);
    const savingsIds = ids((o) => o.savingsPlanId);
    const scheduledIds = ids((o) => o.scheduledPaymentId);
    const emptyNames = Promise.resolve({ data: [] as Record<string, unknown>[], error: null });
    const [inc, fix, debt, sav, sched] = await Promise.all([
      incomeIds.length
        ? sb.from("income_sources").select("id, name").eq("user_id", userId).in("id", incomeIds)
        : emptyNames,
      fixedIds.length
        ? sb.from("fixed_expenses").select("id, name").eq("user_id", userId).in("id", fixedIds)
        : emptyNames,
      debtIds.length
        ? sb.from("debt_accounts").select("id, name").eq("user_id", userId).in("id", debtIds)
        : emptyNames,
      savingsIds.length
        ? sb.from("savings_plans").select("id, name").eq("user_id", userId).in("id", savingsIds)
        : emptyNames,
      scheduledIds.length
        ? sb.from("scheduled_payments").select("id, name").eq("user_id", userId).in("id", scheduledIds)
        : emptyNames,
    ]);
    // PostgREST reports ordinary query failures in `error`; it does not throw.
    // A missing name map is not the same as "that flow name does not match".
    if (inc.error || fix.error || debt.error || sav.error || sched.error) {
      return { ok: false };
    }
    for (const r of (inc.data ?? []) as Record<string, unknown>[]) names.set(String(r.id), String(r.name ?? "ingreso"));
    for (const r of (fix.data ?? []) as Record<string, unknown>[]) names.set(String(r.id), String(r.name ?? "gasto"));
    for (const r of (debt.data ?? []) as Record<string, unknown>[]) names.set(String(r.id), String(r.name ?? "deuda"));
    for (const r of (sav.data ?? []) as Record<string, unknown>[]) names.set(String(r.id), String(r.name ?? "reserva"));
    for (const r of (sched.data ?? []) as Record<string, unknown>[]) names.set(String(r.id), String(r.name ?? "pago programado"));
  } catch {
    return { ok: false };
  }
  // Aggregate reserve scalars have no source row — label them by kind.
  names.set("commit:savings", "ahorro");
  names.set("commit:investment", "inversión");
  // A successful query with a missing source row is still not a usable identity.
  // Never downgrade a named card/flow to a generic label and expose its id for
  // the model to guess.
  if (!occurrenceNamesCover(occ, names)) {
    return { ok: false };
  }
  return { ok: true, names };
}

function fmtAmt(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  const cur = (currency ?? "USD").toUpperCase();
  return cur === "USD" ? `${amount}$` : `${amount} ${cur}`;
}

// J-3 — «no pude leer tus pendientes» ≠ «no tenés pendientes». Con la lista
// colapsada a [], el bloque desaparecía y el agente perdía los occurrenceId: la
// respuesta del usuario («ya la pagué») dejaba de poder ir a
// resolve_recurring_occurrence, la ocurrencia seguía PENDING y el notifier la
// volvía a preguntar al día siguiente — el error real del founder. Peor: sin
// bloque, esa respuesta se convierte en un movimiento NUEVO.
export const OPEN_OCCURRENCES_UNREADABLE = [
  "FLUJOS DEL CALENDARIO — NO PUDE LEERLOS ahora mismo. Esto NO significa que no tenga pendientes.",
  'Si el usuario responde a un aviso del calendario ("ya la pagué", "sí", "fueron X", "no vino"), NO lo registres como movimiento nuevo ni lo des por resuelto: dile que no pudiste verificar sus flujos pendientes y que lo reintente en un rato.',
].join("\n");

export type OpenOccurrenceAgentFacts =
  | { ok: true; complete: true; text: string }
  | { ok: false; complete: false; text: string };

export async function readOpenOccurrenceFactsForAgent(
  userId: string,
): Promise<OpenOccurrenceAgentFacts> {
  return readOpenOccurrenceFactsForAgentWith({
    readOpen: () => readOpenOccurrences(userId),
    readNames: (open) => readOccurrenceNames(userId, open),
  });
}

export async function readOpenOccurrenceFactsForAgentWith(
  deps: {
    readOpen: () => Promise<OpenOccurrencesRead>;
    readNames: (open: RecurringOccurrence[]) => Promise<OccurrenceNamesRead>;
  },
): Promise<OpenOccurrenceAgentFacts> {
  const read = await deps.readOpen();
  // A partial list cannot safely tell the agent that a named flow is absent.
  // It is deliberately unavailable instead of presenting the first 300 rows as
  // the complete calendar.
  if (!read.ok || !read.complete) {
    return { ok: false, complete: false, text: OPEN_OCCURRENCES_UNREADABLE };
  }
  const open = read.occurrences;
  if (open.length === 0) return { ok: true, complete: true, text: "" };
  const namesRead = await deps.readNames(open);
  // An occurrence id is authoritative only after the user-visible flow has
  // been identified. Publishing anonymous ids such as two generic "cortes de
  // tarjeta" lets the model choose one arbitrarily. Name failure therefore
  // makes the entire routing block unavailable.
  if (!namesRead.ok) {
    return { ok: false, complete: false, text: OPEN_OCCURRENCES_UNREADABLE };
  }
  const names = namesRead.names;
  const lines = open.map((o) => {
    const label = names.get(sourceKey(o)) ?? kindLabel(o.kind);
    const amt = fmtAmt(o.expectedAmount, o.currency);
    const reserve = o.kind === "savings" || o.kind === "investment";
    const state =
      o.status === "booked"
        ? `registrado ${amt} el ${o.occurrenceDate}, esperando tu OK`
        : o.kind === "card_statement"
          ? `corte esperado el ${o.occurrenceDate} (aprox. ${amt}); pídele el monto del pago del mes (esto NO registra un pago, solo fija el corte)`
          : reserve
            ? `reserva esperada ${amt} el ${o.occurrenceDate}, sin apartar aún`
            : `esperado ${amt} el ${o.occurrenceDate}, sin confirmar`;
    return `- occurrenceId=${o.id} · "${label}" (${kindLabel(o.kind)}) · ${state}`;
  });
  return {
    ok: true,
    complete: true,
    text: [
    'FLUJOS DEL CALENDARIO SIN CONFIRMAR — si el usuario responde a uno ("sí"/"entró"/"pagué"/"fueron X"/"no vino"/"no lo pagué"/"ya aparté"/"no me preguntes"/"te digo mañana"), llamá resolve_recurring_occurrence con el occurrenceId correcto. Pagos de deuda y tarjetas se registran al confirmar; una reserva pura solo se marca como apartada, pero una inversión vinculada a cuenta de origen + activo mueve ambas patas atómicamente:',
    ...lines,
    ].join("\n"),
  };
}

export async function describeOpenOccurrencesForAgent(userId: string): Promise<string> {
  return (await readOpenOccurrenceFactsForAgent(userId)).text;
}

/** J-3 — el match distingue las TRES cosas que antes eran `null`: no pude leer,
 *  no hay a qué referirse, y es ambiguo. Sin esa distinción, una lectura caída
 *  se le presentaba al usuario como «¿a cuál te referís?» sobre algo que ya
 *  había respondido, y al día siguiente el notifier se lo volvía a preguntar. */
export type OpenOccurrenceMatch =
  | { ok: true; id: string }
  | { ok: true; id: null }
  | { ok: false };

// Match a resolve request to an open occurrence: explicit id wins; else by flow name +
// kind; else the single open one.
export async function matchOpenOccurrence(
  userId: string,
  ref: { occurrenceId?: string | null; flowName?: string | null; kind?: OccurrenceKind | null },
): Promise<OpenOccurrenceMatch> {
  return matchOpenOccurrenceWith(ref, {
    readOpen: () => readOpenOccurrences(userId),
    readNames: (open) => readOccurrenceNames(userId, open),
  });
}

/** El seam: la decisión pura sobre el contrato de lectura, sin DB, para que el
 *  gate pueda ejercitar los tres veredictos y sus fronteras. */
export async function matchOpenOccurrenceWith(
  ref: { occurrenceId?: string | null; flowName?: string | null; kind?: OccurrenceKind | null },
  deps: {
    readOpen: () => Promise<OpenOccurrencesRead>;
    readNames: (open: RecurringOccurrence[]) => Promise<OccurrenceNamesRead>;
  },
): Promise<OpenOccurrenceMatch> {
  // El id salió del bloque de arriba: es evidencia directa, no necesita la lista.
  if (ref.occurrenceId) return { ok: true, id: ref.occurrenceId };
  const read = await deps.readOpen();
  if (!read.ok) return { ok: false };
  // On an incomplete set, neither absence nor uniqueness is proven. The only
  // safe shortcut is the explicit occurrenceId handled above.
  if (!read.complete) return { ok: false };
  const open = read.occurrences;
  if (open.length === 0) {
    return { ok: true, id: null };
  }
  const want = (ref.flowName ?? "").trim().toLowerCase();
  const candidates = open.filter((o) => (ref.kind ? o.kind === ref.kind : true));
  // A NAME (or kind) was given → it MUST match. Never fall back to a lone open occurrence when
  // the user named a different flow: resolving the wrong (real, booked) movement corrupts the
  // ledger. Mismatch → null (the agent asks which one).
  if (want) {
    const namesRead = await deps.readNames(open);
    if (!namesRead.ok) return { ok: false };
    const byName = candidates.filter((o) => {
      const names = namesRead.names;
      const nm = (names.get(sourceKey(o)) ?? "").toLowerCase();
      return nm && (nm.includes(want) || want.includes(nm));
    });
    // A substring is not a unique identity: "Visa" can match Visa Pichincha and
    // Visa Produbanco. Exactly one match is required.
    return byName.length === 1
      ? { ok: true, id: byName[0].id }
      : { ok: true, id: null };
  }
  // Sin nombre, «hay exactamente una» es una inferencia por AUSENCIA: solo vale
  // sobre una lista completa. Sobre una topada, «una» puede ser una de cinco, y
  // resolver la equivocada registra el pago de otra tarjeta.
  return candidates.length === 1 ? { ok: true, id: candidates[0].id } : { ok: true, id: null };
}
