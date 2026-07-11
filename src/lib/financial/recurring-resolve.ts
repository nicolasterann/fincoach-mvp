import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadFxRates } from "@/lib/fx/fx-store";
import {
  bookRecurring,
  reverseRecurring,
  bookReserveInvestment,
  reverseReserveInvestment,
} from "@/lib/financial/recurring-ledger";
import { updateIncomeSourceFields } from "@/lib/financial/income-store";
import { updateFixedExpenseFields, setCardStatementDue } from "@/lib/financial/commitments-store";
import {
  getOccurrence,
  updateOccurrence,
  listOpenOccurrences,
  type RecurringOccurrence,
  type OccurrenceKind,
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
  investmentTransfer: { sourceAccountId: string; sourceAccountCurrency: string | null; assetId: string } | null;
}

async function loadFlowInfo(userId: string, occ: RecurringOccurrence): Promise<FlowInfo | null> {
  const sb = createSupabaseAdminClient();
  const { data: accData } = await sb.from("accounts").select("*").eq("user_id", userId);
  const accounts = (accData ?? []).map((r) => r as Record<string, unknown>).filter((a) => a.status !== "closed");
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
    const { data } = await sb
      .from("income_sources")
      .select("name, currency, destination_account_id")
      .eq("user_id", userId)
      .eq("id", occ.incomeSourceId)
      .maybeSingle();
    if (!data) return null;
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
    const { data } = await sb
      .from("fixed_expenses")
      .select("name, currency, payment_source_type, payment_source_id")
      .eq("user_id", userId)
      .eq("id", occ.fixedExpenseId)
      .maybeSingle();
    if (!data) return null;
    const isCard = data.payment_source_type === "debt_account" && !!data.payment_source_id;
    if (isCard) {
      return {
        ...base(),
        name: String(data.name ?? "gasto"),
        currency: data.currency == null ? occ.currency : String(data.currency),
        accountId: String(data.payment_source_id),
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
    const { data } = await sb
      .from("debt_accounts")
      .select("name, currency")
      .eq("user_id", userId)
      .eq("id", occ.debtAccountId)
      .maybeSingle();
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
    const { data } = await sb
      .from("debt_accounts")
      .select("name, type, currency, full_payment_due, default_payment_account_id")
      .eq("user_id", userId)
      .eq("id", occ.debtAccountId)
      .maybeSingle();
    if (!data) return null;
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
    const { data } = await sb
      .from("scheduled_payments")
      .select("name, currency, payment_source_type, payment_source_id")
      .eq("user_id", userId)
      .eq("id", occ.scheduledPaymentId)
      .maybeSingle();
    if (!data) return null;
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
    const { data } = await sb
      .from("savings_plans")
      .select("name, original_currency, base_currency, kind, source_account_id, destination_asset_id")
      .eq("user_id", userId)
      .eq("id", occ.savingsPlanId)
      .maybeSingle();
    // An investment plan with BOTH a funding account AND a destination asset → a real transfer on
    // confirm; otherwise a pure reserve (acknowledged, no ledger movement).
    let investmentTransfer: FlowInfo["investmentTransfer"] = null;
    if (data?.kind === "investment" && data.source_account_id && data.destination_asset_id) {
      const src = accounts.find((a) => String(a.id) === String(data.source_account_id));
      investmentTransfer = {
        sourceAccountId: String(data.source_account_id),
        sourceAccountCurrency: src && src.currency != null ? String(src.currency) : null,
        assetId: String(data.destination_asset_id),
      };
    }
    return {
      ...base(),
      name: String(data?.name ?? (occ.kind === "investment" ? "inversión" : "ahorro")),
      currency: data?.original_currency ? String(data.original_currency) : occ.currency,
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
  const sb = createSupabaseAdminClient();
  const { data: prof } = await sb.from("profiles").select("base_currency").eq("id", userId).maybeSingle();
  const base = String(prof?.base_currency ?? "USD").toUpperCase();
  const rates = await loadFxRates(userId);
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
  return booked?.txId ?? null;
}

// Realize an investment reserve as a net-worth-neutral transfer (funding account ↓ + Etoro-style
// asset ↑). Loads base + FX itself (like bookAmount) and delegates the money-safety to the ledger.
async function bookInvestmentTransfer(
  userId: string,
  occ: RecurringOccurrence,
  flow: FlowInfo,
  nativeAmount: number,
): Promise<{ txId: string; baseAmount: number; originalAmount: number } | null> {
  const it = flow.investmentTransfer;
  if (!it) return null;
  const sb = createSupabaseAdminClient();
  const { data: prof } = await sb.from("profiles").select("base_currency").eq("id", userId).maybeSingle();
  const base = String(prof?.base_currency ?? "USD").toUpperCase();
  const rates = await loadFxRates(userId);
  const linkId = occ.savingsPlanId ?? occ.id;
  return bookReserveInvestment({
    userId,
    sourceAccountId: it.sourceAccountId,
    sourceAccountCurrency: it.sourceAccountCurrency,
    assetId: it.assetId,
    nativeAmount,
    nativeCurrency: flow.currency,
    base,
    rates,
    dedupeKey: `recurring-investment:${linkId}:${occ.occurrenceDate}:r${Math.round(nativeAmount * 100)}`,
    occurredAtISO: `${occ.occurrenceDate}T12:00:00.000Z`,
    description: flow.name,
  });
}

async function updatePlanAmount(userId: string, occ: RecurringOccurrence, amount: number): Promise<boolean> {
  if (occ.incomeSourceId) {
    return updateIncomeSourceFields(userId, occ.incomeSourceId, { amount });
  }
  if (occ.fixedExpenseId) {
    return updateFixedExpenseFields({ userId, id: occ.fixedExpenseId, amount });
  }
  return false;
}

export async function resolveOccurrence(input: ResolveInput): Promise<{ ok: boolean; detail: string }> {
  const occ = await getOccurrence(input.userId, input.occurrenceId);
  if (!occ) return { ok: false, detail: "no encuentro ese movimiento recurrente" };
  if (["confirmed", "corrected", "skipped", "dismissed"].includes(occ.status)) {
    return { ok: false, detail: "ese movimiento ya estaba resuelto" };
  }

  switch (input.action) {
    case "snooze": {
      const until = input.snoozeUntilISO && !Number.isNaN(Date.parse(input.snoozeUntilISO))
        ? input.snoozeUntilISO
        : new Date(Date.now() + 86_400_000).toISOString();
      await updateOccurrence(input.userId, occ.id, { snoozeUntil: until });
      return { ok: true, detail: "listo, te lo recuerdo más tarde" };
    }
    case "dismiss": {
      await updateOccurrence(input.userId, occ.id, { status: "dismissed" });
      return { ok: true, detail: "ok, no te pregunto más por esto" };
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
      await updateOccurrence(input.userId, occ.id, { status: "skipped" });
      return { ok: true, detail: "lo saqué del cálculo; no se registró nada" };
    }
    case "confirm": {
      if (occ.status === "booked") {
        await updateOccurrence(input.userId, occ.id, { status: "confirmed" });
        return { ok: true, detail: "confirmado" };
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
        const ok = await setCardStatementDue({ userId: input.userId, debtAccountId: flow.debtAccountId, amount: amt, statementDateISO: occ.occurrenceDate });
        await updateOccurrence(input.userId, occ.id, { status: "confirmed" });
        return ok ? { ok: true, detail: `anotado, tu corte quedó en ${amt}` } : { ok: true, detail: "anotado el corte" };
      }
      if (flow.investmentTransfer) {
        // Investment reserve WITH a funding account + destination asset → move the money for real.
        const amt = occ.expectedAmount;
        if (amt == null || !(amt > 0)) return { ok: false, detail: "¿de cuánto fue la inversión?" };
        const booked = await bookInvestmentTransfer(input.userId, occ, flow, amt);
        if (!booked) return { ok: false, detail: "no pude registrar la inversión (¿falta cuenta o tipo de cambio?)" };
        const upd = await updateOccurrence(input.userId, occ.id, { status: "confirmed", createdTransactionId: booked.txId });
        if (!upd) {
          await reverseReserveInvestment({ userId: input.userId, transactionId: booked.txId, assetId: flow.investmentTransfer.assetId, baseAmount: booked.baseAmount, originalAmount: booked.originalAmount });
          return { ok: false, detail: "no pude cerrar el registro; reintentá en un momento" };
        }
        return { ok: true, detail: `listo, moví ${amt} de tu inversión a ${flow.name}` };
      }
      if (!flow.bookable) {
        // A reserve is a Margen allocation, not a ledger movement — just mark it set aside.
        await updateOccurrence(input.userId, occ.id, { status: "confirmed" });
        return { ok: true, detail: `listo, marqué tu ${flow.name} de este mes como apartado` };
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
        const ok = await setCardStatementDue({ userId: input.userId, debtAccountId: flow.debtAccountId, amount: input.amount, statementDateISO: occ.occurrenceDate });
        await updateOccurrence(input.userId, occ.id, { status: "corrected" });
        return ok
          ? { ok: true, detail: `listo, tu corte de este mes quedó en ${input.amount}` }
          : { ok: false, detail: "no pude anotar el corte; reintentá en un momento" };
      }
      if (flow.investmentTransfer) {
        const booked = await bookInvestmentTransfer(input.userId, occ, flow, input.amount);
        if (!booked) return { ok: false, detail: "no pude registrar la inversión (¿falta cuenta o tipo de cambio?)" };
        const upd = await updateOccurrence(input.userId, occ.id, { status: "corrected", createdTransactionId: booked.txId });
        if (!upd) {
          await reverseReserveInvestment({ userId: input.userId, transactionId: booked.txId, assetId: flow.investmentTransfer.assetId, baseAmount: booked.baseAmount, originalAmount: booked.originalAmount });
          return { ok: false, detail: "no pude cerrar la inversión; reintentá en un momento" };
        }
        return { ok: true, detail: `listo, moví ${input.amount} de tu inversión a ${flow.name}` };
      }
      if (!flow.bookable) {
        // Reserve: record the real amount set aside; no ledger row. (A permanent change to the
        // reserve target is a separate, explicit action — the plan/commitment stays as configured.)
        await updateOccurrence(input.userId, occ.id, { status: "corrected" });
        return { ok: true, detail: `anotado, apartaste ese monto de tu ${flow.name} este mes` };
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
        if (wasBooked) await updateOccurrence(input.userId, occ.id, { status: "pending", createdTransactionId: null });
        return { ok: false, detail: "no pude registrar el monto corregido; revertí el anterior, decime el monto de nuevo" };
      }
      const updc = await updateOccurrence(input.userId, occ.id, { status: "corrected", createdTransactionId: txId });
      if (!updc) {
        await reverseRecurring(input.userId, txId); // don't leave a ghost the retry could re-book past
        return { ok: false, detail: "no pude cerrar la corrección; reintentá en un momento" };
      }
      if (input.scope === "from_now") {
        const planOk = await updatePlanAmount(input.userId, occ, input.amount);
        return planOk
          ? { ok: true, detail: "corregido, y actualicé el plan de ahora en más" }
          : { ok: true, detail: "corregido por esta vez; el plan no se pudo actualizar, decímelo de nuevo para dejarlo fijo" };
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

async function occurrenceNames(userId: string, occ: RecurringOccurrence[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (occ.length === 0) return names;
  try {
    const sb = createSupabaseAdminClient();
    const [inc, fix, debt, sav, sched] = await Promise.all([
      sb.from("income_sources").select("id, name").eq("user_id", userId),
      sb.from("fixed_expenses").select("id, name").eq("user_id", userId),
      sb.from("debt_accounts").select("id, name").eq("user_id", userId),
      sb.from("savings_plans").select("id, name").eq("user_id", userId),
      sb.from("scheduled_payments").select("id, name").eq("user_id", userId),
    ]);
    for (const r of (inc.data ?? []) as Record<string, unknown>[]) names.set(String(r.id), String(r.name ?? "ingreso"));
    for (const r of (fix.data ?? []) as Record<string, unknown>[]) names.set(String(r.id), String(r.name ?? "gasto"));
    for (const r of (debt.data ?? []) as Record<string, unknown>[]) names.set(String(r.id), String(r.name ?? "deuda"));
    for (const r of (sav.data ?? []) as Record<string, unknown>[]) names.set(String(r.id), String(r.name ?? "reserva"));
    for (const r of (sched.data ?? []) as Record<string, unknown>[]) names.set(String(r.id), String(r.name ?? "pago programado"));
  } catch {
    /* names best-effort */
  }
  // Aggregate reserve scalars have no source row — label them by kind.
  names.set("commit:savings", "ahorro");
  names.set("commit:investment", "inversión");
  return names;
}

function fmtAmt(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  const cur = (currency ?? "USD").toUpperCase();
  return cur === "USD" ? `${amount}$` : `${amount} ${cur}`;
}

// Returns a facts string for the agent (empty when nothing is open).
export async function describeOpenOccurrencesForAgent(userId: string): Promise<string> {
  const open = await listOpenOccurrences(userId);
  if (open.length === 0) return "";
  const names = await occurrenceNames(userId, open);
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
  return [
    'FLUJOS DEL CALENDARIO SIN CONFIRMAR — si el usuario responde a uno ("sí"/"entró"/"pagué"/"fueron X"/"no vino"/"no lo pagué"/"ya aparté"/"no me preguntes"/"te digo mañana"), llamá resolve_recurring_occurrence con el occurrenceId correcto. Pagos de deuda y tarjetas se registran al confirmar; ahorro/inversión solo se marcan como apartados (no mueven el ledger):',
    ...lines,
  ].join("\n");
}

// Match a resolve request to an open occurrence: explicit id wins; else by flow name +
// kind; else the single open one. Returns the occurrence id or null (agent should ask).
export async function matchOpenOccurrence(
  userId: string,
  ref: { occurrenceId?: string | null; flowName?: string | null; kind?: OccurrenceKind | null },
): Promise<string | null> {
  if (ref.occurrenceId) return ref.occurrenceId;
  const open = await listOpenOccurrences(userId);
  if (open.length === 0) return null;
  const want = (ref.flowName ?? "").trim().toLowerCase();
  const names = await occurrenceNames(userId, open);
  const candidates = open.filter((o) => (ref.kind ? o.kind === ref.kind : true));
  // A NAME (or kind) was given → it MUST match. Never fall back to a lone open occurrence when
  // the user named a different flow: resolving the wrong (real, booked) movement corrupts the
  // ledger. Mismatch → null (the agent asks which one).
  if (want) {
    const byName = candidates.find((o) => {
      const nm = (names.get(sourceKey(o)) ?? "").toLowerCase();
      return nm && (nm.includes(want) || want.includes(nm));
    });
    return byName ? byName.id : null;
  }
  // No name given → the single-open default is safe only when there is exactly one candidate.
  return candidates.length === 1 ? candidates[0].id : null;
}
