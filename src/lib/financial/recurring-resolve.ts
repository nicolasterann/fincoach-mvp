import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { readFxRates, usableCurrentRates } from "@/lib/fx/fx-store";
import { convert } from "@/lib/fx/fx-rates";
import { readProfileBaseCurrency } from "@/lib/financial/profile-base";
import {
  bookRecurring,
  reverseRecurring,
  applyInvestmentOccurrence,
  planRecurringLedgerEntry,
} from "@/lib/financial/recurring-ledger";
import { recordVariableFixedObservation } from "@/lib/financial/variable-fixed-store";
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
import { recurringAccountChoiceId } from "@/lib/financial/recurring-account-choice";
import type { FinancialCategory } from "@/types/financial";

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

export type ResolveAction =
  | "observe"
  | "confirm"
  | "correct"
  | "unpaid"
  | "retract"
  | "skip"
  | "snooze"
  | "dismiss";

export interface ResolveInput {
  userId: string;
  occurrenceId: string;
  action: ResolveAction;
  amount?: number; // native amount, required for 'correct'
  scope?: "once" | "from_now"; // for 'correct'; default 'once'
  snoozeUntilISO?: string; // for 'snooze'
  /** Actual payment day stated by the user. A bill observation has no payment
   * day because it moves no money. */
  paymentDateISO?: string;
  /** User-local capture day for a NEW payment when no other day was stated.
   * Kept separate from `paymentDateISO`: a correction/replay must not treat
   * this default as authority to move an existing payment in time. */
  defaultPaymentDateISO?: string;
  /** One-cycle payment instrument. It does not rewrite the recurring plan. */
  paymentSource?: {
    id: string;
    currency: string;
    isCard: boolean;
  };
  /** Trusted server delivery namespace. A retry of the same delivery replays;
   * a later, explicit redo after an undo gets a different identity. */
  operationId?: string | null;
}

export function variableFixedPaymentDate(input: {
  statedDateISO?: string;
  defaultDateISO?: string;
  hasExistingPayment: boolean;
}): string | undefined {
  if (input.statedDateISO) return input.statedDateISO;
  return input.hasExistingPayment ? undefined : input.defaultDateISO;
}

export function variableFixedPaymentLedgerDedupe(input: {
  occurrenceId: string;
  operationId?: string | null;
  amount: number;
  accountId: string;
  paymentDateISO: string;
}): string {
  const operationIdentity = input.operationId?.trim() || "semantic";
  return [
    "variable-fixed-payment",
    operationIdentity,
    input.occurrenceId,
    `r${Math.round(input.amount * 100)}`,
    input.accountId,
    input.paymentDateISO,
  ].join(":");
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

export function terminalOccurrenceReplay(
  status: RecurringOccurrence["status"],
  action: ResolveAction,
): string | null {
  if (
    action === "confirm" &&
    (status === "confirmed" || status === "corrected")
  ) {
    return "ese pago ya estaba confirmado; no moví dinero otra vez";
  }
  if (action === "skip" && status === "skipped") {
    return "esa factura ya estaba retirada; no cambié nada otra vez";
  }
  if (action === "retract" && status === "skipped") {
    return "esa factura ya estaba retirada; no cambié nada otra vez";
  }
  if (action === "dismiss" && status === "dismissed") {
    return "ese aviso ya estaba cerrado; no lo cerré dos veces";
  }
  return null;
}

export function terminalVariableFixedFactReplay(input: {
  isVariableFixed: boolean;
  status: RecurringOccurrence["status"];
  action: ResolveAction;
  scope?: "once" | "from_now";
  amount?: number;
  resolvedAmount: number | null;
  paymentSourceStated: boolean;
  paymentDateStated: boolean;
}): string | null {
  if (!input.isVariableFixed) return null;
  const paid =
    input.status === "confirmed" || input.status === "corrected";
  if (!paid || input.scope === "from_now") return null;
  if (input.action === "observe") {
    return "esa factura ya consta como pagada; no la volví a marcar como impaga. Si el monto estaba mal, corrígelo junto con el pago";
  }
  if (
    input.action === "correct" &&
    input.amount != null &&
    input.resolvedAmount != null &&
    Math.abs(input.amount - input.resolvedAmount) < 0.005 &&
    !input.paymentSourceStated &&
    !input.paymentDateStated
  ) {
    return "ese mismo monto ya constaba pagado; no moví dinero ni abrí otra corrección";
  }
  return null;
}

export function variableFixedObservationConflictsWithPayment(input: {
  action: ResolveAction;
  createdTransactionId: string | null;
}): boolean {
  // A legacy/toggled occurrence can still be `booked` while already pointing
  // at money.  Treating a later amount-only reply as `observe` would preserve
  // that transaction in SQL but tell the user "no payment was registered".
  // The fact-only lane is unavailable once any payment row exists: the user
  // must confirm/correct/skip the payment explicitly.
  return input.action === "observe" && input.createdTransactionId != null;
}

export function variableFixedWriterAction(input: {
  action: ResolveAction;
  amount: number;
  createdTransactionId: string | null;
}): "observe" | "pay" | "zero" {
  if (input.action === "observe") return "observe";
  if (input.action === "correct" && Math.abs(input.amount) < 0.005) {
    return input.createdTransactionId == null ? "observe" : "zero";
  }
  return "pay";
}

export function terminalZeroVariableBillReplay(input: {
  status: RecurringOccurrence["status"];
  action: ResolveAction;
  scope?: "once" | "from_now";
  amount?: number;
  resolvedAmount: number | null;
  createdTransactionId: string | null;
}): string | null {
  if (
    input.status !== "confirmed" ||
    input.createdTransactionId != null ||
    input.resolvedAmount == null ||
    Math.abs(input.resolvedAmount) >= 0.005 ||
    input.scope === "from_now"
  ) {
    return null;
  }
  if (
    input.action === "observe" ||
    input.action === "confirm" ||
    (
      input.action === "correct" &&
      input.amount != null &&
      Math.abs(input.amount) < 0.005
    )
  ) {
    return "esa factura ya constaba en cero; no había pago pendiente y no moví dinero";
  }
  return null;
}

export function terminalVariableFixedRetractable(input: {
  isVariableFixed: boolean;
  status: RecurringOccurrence["status"];
  action: ResolveAction;
  resolvedAmount: number | null;
  resolvedCurrency: string | null;
  createdTransactionId: string | null;
}): boolean {
  return (
    input.isVariableFixed &&
    input.action === "retract" &&
    (
      input.status === "confirmed" ||
      input.status === "corrected" ||
      input.status === "dismissed"
    ) &&
    input.resolvedAmount != null &&
    /^[A-Z]{3}$/.test(
      String(input.resolvedCurrency ?? "").trim().toUpperCase(),
    )
  );
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
  isVariableFixed: boolean;
  category: FinancialCategory | null;
}

type PriorVariablePaymentRead =
  | {
      ok: true;
      source: NonNullable<ResolveInput["paymentSource"]>;
      paymentDateISO: string;
      amount: number;
      currency: string;
    }
  | { ok: false };

export function preserveVariablePaymentIdentity(
  stated: Pick<ResolveInput, "paymentSource" | "paymentDateISO">,
  prior: Extract<PriorVariablePaymentRead, { ok: true }>,
): {
  paymentSource: NonNullable<ResolveInput["paymentSource"]>;
  paymentDateISO: string;
} {
  return {
    paymentSource: stated.paymentSource ?? prior.source,
    paymentDateISO: stated.paymentDateISO ?? prior.paymentDateISO,
  };
}

export function sameVariableFixedPaymentFact(
  stated: {
    amount: number;
    currency: string;
    paymentSource: NonNullable<ResolveInput["paymentSource"]>;
    paymentDateISO: string;
  },
  prior: Extract<PriorVariablePaymentRead, { ok: true }>,
): boolean {
  return (
    Math.abs(stated.amount - prior.amount) < 0.005 &&
    stated.currency.trim().toUpperCase() ===
      prior.currency.trim().toUpperCase() &&
    stated.paymentSource.id === prior.source.id &&
    stated.paymentSource.isCard === prior.source.isCard &&
    stated.paymentSource.currency.trim().toUpperCase() ===
      prior.source.currency.trim().toUpperCase() &&
    stated.paymentDateISO === prior.paymentDateISO
  );
}

/**
 * A correction of an already-paid variable bill changes the amount, not the
 * historical source/date by implication. Reading the current plan source here
 * would silently move a correction to a different account if the plan changed
 * after that cycle. Preserve the committed transaction unless the user names
 * an explicit one-cycle override.
 */
async function readPriorVariablePayment(
  userId: string,
  transactionId: string,
  fixedExpenseId: string,
): Promise<PriorVariablePaymentRead> {
  try {
    const sb = createSupabaseAdminClient();
    const txRead = await sb
      .from("transactions")
      .select(
        "type, recurring_expense_id, source_account_id, debt_account_id, original_amount, original_currency, occurred_at",
      )
      .eq("id", transactionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (txRead.error || !txRead.data) return { ok: false };
    const tx = txRead.data as Record<string, unknown>;
    if (
      tx.type !== "expense" ||
      String(tx.recurring_expense_id ?? "") !== fixedExpenseId
    ) {
      return { ok: false };
    }
    const accountId = String(tx.source_account_id ?? "");
    const cardId = String(tx.debt_account_id ?? "");
    if (Boolean(accountId) === Boolean(cardId)) return { ok: false };
    const instrumentRead = accountId
      ? await sb
          .from("accounts")
          .select("id, currency")
          .eq("id", accountId)
          .eq("user_id", userId)
          .maybeSingle()
      : await sb
          .from("debt_accounts")
          .select("id, currency, type")
          .eq("id", cardId)
          .eq("user_id", userId)
          .maybeSingle();
    if (instrumentRead.error || !instrumentRead.data) return { ok: false };
    const instrument = instrumentRead.data as Record<string, unknown>;
    if (!accountId && instrument.type !== "credit_card") return { ok: false };
    const currency = String(instrument.currency ?? "").trim().toUpperCase();
    const originalCurrency = String(tx.original_currency ?? "")
      .trim()
      .toUpperCase();
    const amount = Number(tx.original_amount);
    const date = String(tx.occurred_at ?? "").slice(0, 10);
    if (
      !/^[A-Z]{3}$/.test(currency) ||
      originalCurrency !== currency ||
      !Number.isFinite(amount) ||
      !(amount > 0) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      source: {
        id: accountId || cardId,
        currency,
        isCard: !accountId,
      },
      paymentDateISO: date,
      amount,
      currency: originalCurrency,
    };
  } catch {
    return { ok: false };
  }
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
    const chosenId = recurringAccountChoiceId(
      accounts.map((account) => ({
        id: String(account.id),
        isPrimary: account.is_primary === true,
      })),
      preferredId,
    );
    const chosen = chosenId
      ? accounts.find((account) => String(account.id) === chosenId)
      : null;
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
    isVariableFixed: false,
    category: null,
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
    const [fixedRead, observationRead] = await Promise.all([
      sb
        .from("fixed_expenses")
        .select("name, currency, category, payment_source_type, payment_source_id, is_variable")
        .eq("user_id", userId)
        .eq("id", occ.fixedExpenseId)
        .maybeSingle(),
      sb
        .from("fixed_expense_observations")
        .select("id")
        .eq("user_id", userId)
        .eq("fixed_expense_id", occ.fixedExpenseId)
        .eq("occurrence_id", occ.id)
        .eq("is_current", true)
        .limit(2),
    ]);
    const { data, error } = fixedRead;
    if (
      error ||
      !data ||
      observationRead.error ||
      !observationRead.data ||
      observationRead.data.length > 1
    ) {
      return null;
    }
    const hasVariableFact = observationRead.data.length === 1;
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
        isVariableFixed: data.is_variable === true || hasVariableFact,
        category: data.category as FinancialCategory,
      };
    }
    const acc = pick(data.payment_source_type === "account" && data.payment_source_id ? String(data.payment_source_id) : null);
    return {
      ...base(),
      name: String(data.name ?? "gasto"),
      currency: data.currency == null ? occ.currency : String(data.currency),
      accountId: acc?.id ?? null,
      accountCurrency: acc?.currency ?? null,
      isVariableFixed: data.is_variable === true || hasVariableFact,
      category: data.category as FinancialCategory,
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
  const rates = usableCurrentRates(await readFxRates(userId));
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
    category: flow.category,

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
  const rates = usableCurrentRates(await readFxRates(userId));
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
      const valued = convert(amount, nativeCurrency, base, usableCurrentRates(fxRead));
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
    return { ok: false, detail: "no pude anotar el corte; reintenta en un momento" };
  }
  // Migration 075 closes the occurrence in the SAME transaction as the card
  // state. Keep the old mark as a deployment/back-compat bridge only when the
  // RPC response proves that atomic effect was not available.
  if (set.occurrenceResolution === "none") {
    const marked = await deps.mark(action === "confirm" ? "confirmed" : "corrected");
    if (!marked) {
      // The card was written but an old RPC did not close the occurrence.
      // Pending ⇒ retrying the same idempotent statement is safe.
      return { ok: false, detail: "anoté el corte pero no pude cerrar el aviso; reintenta en un momento" };
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

async function retractVariableFixedOccurrence(
  input: ResolveInput,
  occ: RecurringOccurrence,
  adoptedFact?: { amount: number; currency: string },
): Promise<{ ok: boolean; detail: string }> {
  const amount = adoptedFact?.amount ?? occ.resolvedAmount;
  const currency = adoptedFact?.currency ?? occ.resolvedCurrency;
  if (
    amount == null ||
    !currency ||
    !occ.fixedExpenseId
  ) {
    return {
      ok: false,
      detail:
        "Ese aviso no tiene un hecho completo que pueda retirar; no cambié nada.",
    };
  }
  const retracted = await recordVariableFixedObservation({
    userId: input.userId,
    occurrenceId: occ.id,
    amount,
    currency,
    action: "retract",
    scope: "once",
    dedupeKey: [
      "variable-fixed",
      input.operationId?.trim() || "semantic",
      occ.id,
      "retract",
      Math.round(amount * 100),
    ].join(":"),
    expectedOccurrenceStatus: occ.status,
    expectedResolvedAmount: occ.resolvedAmount,
    expectedTransactionId: occ.createdTransactionId,
    entry: null,
  });
  return retracted.ok
    ? {
        ok: true,
        detail: occ.createdTransactionId
          ? "retiré esa factura del ciclo y revertí su pago en la misma operación; la estimación quedó recalculada"
          : "retiré esa factura observada del ciclo y recalculé la estimación; no había dinero que revertir",
      }
    : {
        ok: false,
        detail:
          "no pude retirar juntas la observación y la estimación; no quedó una mitad aplicada",
      };
}

export function variableFixedPermanentCurrencyCompatible(
  cycleCurrency: string | null | undefined,
  currentPlanCurrency: string | null | undefined,
): boolean {
  const cycle = String(cycleCurrency ?? "").trim().toUpperCase();
  const plan = String(currentPlanCurrency ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(cycle) && cycle === plan;
}

async function resolveVariableFixedOccurrence(
  input: ResolveInput,
  occ: RecurringOccurrence,
  flow: FlowInfo,
): Promise<{ ok: boolean; detail: string }> {
  if (
    variableFixedObservationConflictsWithPayment({
      action: input.action,
      createdTransactionId: occ.createdTransactionId,
    })
  ) {
    return {
      ok: false,
      detail:
        "Ese ciclo ya apunta a un pago registrado. No lo marqué como factura impaga: confirma/corrige el pago, o indica que no ocurrió para revertirlo.",
    };
  }
  // The occurrence owns the historical bill. A plan can legitimately change
  // currency after this cycle was created; correcting the old fact must stay
  // in the currency Kipu recorded for that cycle, never inherit today's plan.
  const currency = String(
    occ.resolvedCurrency ?? occ.currency ?? flow.currency ?? "",
  ).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, detail: "no pude probar la moneda de esa factura; no cambié nada" };
  }
  const amount =
    input.amount ??
    (input.action === "confirm" &&
    (occ.status === "observed" || occ.status === "dismissed")
      ? occ.resolvedAmount ?? undefined
      : undefined);
  if (amount == null || !Number.isFinite(amount) || amount < 0) {
    return {
      ok: false,
      detail:
        input.action === "observe"
          ? "¿de cuánto vino la factura?"
          : "¿de cuánto fue la factura que pagaste?",
    };
  }
  if (input.scope === "from_now" && !(amount > 0)) {
    return {
      ok: false,
      detail:
        "Un plan permanente no puede quedar en cero por una factura puntual. ¿Quieres pausarlo o cuál será el monto de ahora en más?",
    };
  }
  if (
    input.scope === "from_now" &&
    !variableFixedPermanentCurrencyCompatible(currency, flow.currency)
  ) {
    return {
      ok: false,
      detail:
        `Ese ciclo está en ${currency}, pero el plan actual está en ${String(flow.currency ?? "").trim().toUpperCase() || "otra moneda"}. ` +
        "Puedo corregir este ciclo una sola vez; para cambiar el plan futuro dime el monto en la moneda actual.",
    };
  }

  const action = variableFixedWriterAction({
    action: input.action,
    amount,
    createdTransactionId: occ.createdTransactionId,
  });
  const scope = input.scope ?? "once";
  let paymentSource = input.paymentSource;
  let paymentDateISO = variableFixedPaymentDate({
    statedDateISO: input.paymentDateISO,
    defaultDateISO: input.defaultPaymentDateISO,
    hasExistingPayment: occ.createdTransactionId != null,
  });
  if (
    action === "pay" &&
    occ.createdTransactionId &&
    occ.fixedExpenseId
  ) {
    const prior = await readPriorVariablePayment(
      input.userId,
      occ.createdTransactionId,
      occ.fixedExpenseId,
    );
    if (!prior.ok) {
      return {
        ok: false,
        detail:
          "No pude probar la cuenta y fecha del pago anterior; no moví la corrección a otro instrumento.",
      };
    }
    const identity = preserveVariablePaymentIdentity(input, prior);
    paymentSource = identity.paymentSource;
    paymentDateISO = identity.paymentDateISO;
    if (
      input.action === "correct" &&
      scope === "once" &&
      sameVariableFixedPaymentFact(
        {
          amount,
          currency,
          paymentSource,
          paymentDateISO,
        },
        prior,
      )
    ) {
      return {
        ok: true,
        detail:
          "esa factura ya constaba pagada con ese monto, instrumento y fecha; no la revaloricé ni moví dinero otra vez",
      };
    }
  }
  if (
    action === "pay" &&
    !occ.createdTransactionId &&
    !paymentSource
  ) {
    return {
      ok: false,
      detail:
        "¿Desde qué cuenta o tarjeta pagaste esa factura? El instrumento habitual del plan no prueba lo que pasó en este ciclo.",
    };
  }
  const paymentFlow =
    action === "pay" && paymentSource
      ? {
          ...flow,
          accountId: paymentSource.id,
          accountCurrency: paymentSource.currency,
          isCard: paymentSource.isCard,
        }
      : flow;
  let entry = null;
  let accountKey = "no-money";
  if (action === "pay") {
    if (!(amount > 0)) {
      return { ok: false, detail: "Un pago debe ser mayor que cero; no moví dinero." };
    }
    if (!paymentFlow.accountId) {
      return { ok: false, detail: "¿Desde qué cuenta o tarjeta pagaste esa factura?" };
    }
    const baseRead = await readProfileBaseCurrency(input.userId);
    if (!baseRead.ok) {
      return { ok: false, detail: "no pude probar tu moneda base; no registré el pago" };
    }
    const ratesRead = await readFxRates(input.userId);
    const planned = planRecurringLedgerEntry({
      userId: input.userId,
      kind: "expense",
      nativeAmount: amount,
      nativeCurrency: currency,
      base: baseRead.base,
      rates: usableCurrentRates(ratesRead),
      accountId: paymentFlow.accountId,
      accountCurrency: paymentFlow.accountCurrency,
      isCard: paymentFlow.isCard,
      recurringExpenseId: occ.fixedExpenseId,
      dedupeKey: variableFixedPaymentLedgerDedupe({
        occurrenceId: occ.id,
        operationId: input.operationId,
        amount,
        accountId: paymentFlow.accountId,
        paymentDateISO: paymentDateISO ?? occ.occurrenceDate,
      }),
      occurredAtISO: `${paymentDateISO ?? occ.occurrenceDate}T12:00:00.000Z`,
      occurrenceDateISO: occ.occurrenceDate,
      description: flow.name,
      sourceLinkId: occ.fixedExpenseId ?? occ.id,
      category: flow.category,
    });
    if (!planned.ok) {
      return {
        ok: false,
        detail:
          planned.reason === "account_currency"
            ? `La factura está en ${currency}, pero el instrumento elegido está en otra moneda. ¿Desde cuál se pagó realmente?`
            : "No pude valuar el pago con una tasa confiable; guardé cero movimientos.",
      };
    }
    entry = planned.entry;
    accountKey = `${paymentFlow.accountId}:${paymentDateISO ?? occ.occurrenceDate}`;
  }

  const result = await recordVariableFixedObservation({
    userId: input.userId,
    occurrenceId: occ.id,
    amount,
    currency,
    action,
    scope,
    dedupeKey: [
      "variable-fixed",
      input.operationId?.trim() || "semantic",
      occ.id,
      action,
      scope,
      Math.round(amount * 100),
      accountKey,
    ].join(":"),
    expectedOccurrenceStatus: occ.status,
    expectedResolvedAmount: occ.resolvedAmount,
    expectedTransactionId: occ.createdTransactionId,
    entry,
  });
  if (!result.ok) {
    return {
      ok: false,
      detail:
        result.reason === "unsafe"
          ? "Ese ciclo cambió o ya tiene otro pago. Vuelve a cargar el aviso antes de corregirlo; no moví una segunda vez."
          : "No pude guardar juntas la factura y su estado; no quedó una mitad aplicada.",
    };
  }
  if (action === "observe") {
    return {
      ok: true,
      detail:
        amount === 0
          ? "anoté que la factura vino en cero; quedó cerrada sin registrar ningún pago"
          : scope === "from_now"
          ? `anoté la factura en ${amount} ${currency}, actualicé el plan de ahora en más y todavía NO registré un pago`
          : `anoté que la factura vino en ${amount} ${currency}; todavía NO registré un pago`,
    };
  }
  if (action === "zero") {
    return {
      ok: true,
      detail:
        "corregí la factura a cero y revertí el pago anterior en la misma operación; no quedó dinero cobrado",
    };
  }
  return {
    ok: true,
    detail:
      scope === "from_now"
        ? `registré el pago de ${amount} ${currency} y actualicé el plan de ahora en más`
        : `registré el pago de ${amount} ${currency}; el plan declarado queda igual`,
  };
}

export async function resolveOccurrence(input: ResolveInput): Promise<{ ok: boolean; detail: string }> {
  const occurrenceRead = await readOccurrenceById(input.userId, input.occurrenceId);
  if (!occurrenceRead.ok) {
    return { ok: false, detail: "no pude leer ese aviso ahora; no cambié nada. Reintenta en un momento" };
  }
  const occ = occurrenceRead.occurrence;
  if (!occ) return { ok: false, detail: "no encuentro ese movimiento recurrente" };
  if (["confirmed", "corrected", "skipped", "dismissed"].includes(occ.status)) {
    const zeroBillReplay = terminalZeroVariableBillReplay({
      status: occ.status,
      action: input.action,
      scope: input.scope,
      amount: input.amount,
      resolvedAmount: occ.resolvedAmount,
      createdTransactionId: occ.createdTransactionId,
    });
    if (zeroBillReplay && occ.fixedExpenseId != null) {
      const flow = await loadFlowInfo(input.userId, occ);
      if (!flow) {
        return {
          ok: false,
          detail: "no pude probar el gasto de esa factura; no cambié nada",
        };
      }
      if (flow.isVariableFixed) {
        return { ok: true, detail: zeroBillReplay };
      }
    }
    if (
      input.action === "retract" &&
      occ.fixedExpenseId != null
    ) {
      const flow = await loadFlowInfo(input.userId, occ);
      if (!flow) {
        return {
          ok: false,
          detail: "no pude probar el gasto de esa factura; no cambié nada",
        };
      }
      if (
        terminalVariableFixedRetractable({
          isVariableFixed: flow.isVariableFixed,
          status: occ.status,
          action: input.action,
          resolvedAmount: occ.resolvedAmount,
          resolvedCurrency: occ.resolvedCurrency,
          createdTransactionId: occ.createdTransactionId,
        })
      ) {
        return retractVariableFixedOccurrence(input, occ);
      }
    }
    const replay = terminalOccurrenceReplay(occ.status, input.action);
    if (replay) return { ok: true, detail: replay };
    // Bloque K — a terminal variable bill is still CORRECTABLE append-only.
    // Returning "already resolved" here made the first paid amount permanent:
    // the canonical RPC already knows how to reverse the old payment, insert
    // the corrected one and replace the current observation atomically.
    if (
      (
        occ.status === "confirmed" ||
        occ.status === "corrected" ||
        occ.status === "skipped" ||
        occ.status === "dismissed"
      ) &&
      (
        input.action === "observe" ||
        input.action === "confirm" ||
        input.action === "correct"
      )
    ) {
      const flow = await loadFlowInfo(input.userId, occ);
      if (!flow) {
        return { ok: false, detail: "no pude cargar los datos del flujo" };
      }
      if (flow.isVariableFixed) {
        const variableFactReplay = terminalVariableFixedFactReplay({
          isVariableFixed: true,
          status: occ.status,
          action: input.action,
          scope: input.scope,
          amount: input.amount,
          resolvedAmount: occ.resolvedAmount,
          paymentSourceStated: input.paymentSource != null,
          paymentDateStated: input.paymentDateISO != null,
        });
        if (variableFactReplay) {
          return { ok: true, detail: variableFactReplay };
        }
        return resolveVariableFixedOccurrence(input, occ, flow);
      }
    }
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
    case "observe": {
      const flow = await loadFlowInfo(input.userId, occ);
      if (!flow) return { ok: false, detail: "no pude cargar los datos del flujo" };
      if (!flow.isVariableFixed) {
        return {
          ok: false,
          detail:
            "Ese aviso no es una factura variable. Usa confirmar/corregir solo si el dinero ya se movió.",
        };
      }
      return resolveVariableFixedOccurrence(input, occ, flow);
    }
    case "snooze": {
      const until = input.snoozeUntilISO && !Number.isNaN(Date.parse(input.snoozeUntilISO))
        ? input.snoozeUntilISO
        : new Date(Date.now() + 86_400_000).toISOString();
      return markOccurrence(input.userId, occ.id, { snoozeUntil: until },
        "listo, te lo recuerdo más tarde",
        "no pude agendar el recordatorio; reintenta en un momento");
    }
    case "dismiss": {
      return markOccurrence(input.userId, occ.id, { status: "dismissed" },
        "ok, no te pregunto más por esto",
        "no pude cerrarlo, así que te lo voy a volver a preguntar; reintenta en un momento");
    }
    case "unpaid": {
      if (occ.status !== "observed") {
        return {
          ok: false,
          detail:
            "Todavía no tengo una factura observada que pueda dejar pendiente de pago. Dime primero cuánto vino.",
        };
      }
      const until =
        input.snoozeUntilISO &&
        !Number.isNaN(Date.parse(input.snoozeUntilISO))
          ? input.snoozeUntilISO
          : new Date(Date.now() + 86_400_000).toISOString();
      return markOccurrence(
        input.userId,
        occ.id,
        { snoozeUntil: until },
        "la factura sigue anotada como pendiente de pago; te la recordaré después",
        "no pude posponer el recordatorio; la factura sigue intacta",
      );
    }
    case "retract": {
      if (occ.status !== "observed") {
        return {
          ok: false,
          detail:
            "Solo puedo retirar así una factura observada que todavía no tenga pago. No cambié nada.",
        };
      }
      return retractVariableFixedOccurrence(input, occ);
    }
    case "skip": {
      if (occ.status === "observed") {
        return {
          ok: false,
          detail:
            "La factura sí está observada. Si todavía no se pagó usa unpaid; si esa factura nunca existió usa retract. No borré el hecho.",
        };
      }
      if (occ.status === "booked" && occ.createdTransactionId) {
        const flow = await loadFlowInfo(input.userId, occ);
        if (!flow) {
          return {
            ok: false,
            detail: "no pude probar el flujo antes de retirar ese registro",
          };
        }
        if (flow.isVariableFixed) {
          if (!occ.fixedExpenseId) {
            return {
              ok: false,
              detail:
                "Ese aviso variable no identifica su plan; no revertí una fila a ciegas.",
            };
          }
          const prior = await readPriorVariablePayment(
            input.userId,
            occ.createdTransactionId,
            occ.fixedExpenseId,
          );
          if (!prior.ok) {
            return {
              ok: false,
              detail:
                "No pude probar el pago ligado a ese aviso; no lo revertí ni cerré.",
            };
          }
          return retractVariableFixedOccurrence(input, occ, {
            amount: prior.amount,
            currency: prior.currency,
          });
        }
        const rev = await reverseRecurring(input.userId, occ.createdTransactionId);
        if (!rev) {
          // Reversal did not commit → do NOT mark terminal (would leave the tx applied while
          // telling the user it was removed). Leave it open to retry.
          return { ok: false, detail: "no pude revertir el registro anterior; reintenta en un momento" };
        }
      }
      return markOccurrence(input.userId, occ.id, { status: "skipped" },
        "lo saqué del cálculo; no se registró nada",
        "saqué el registro pero no pude cerrar el aviso; reintenta en un momento");
    }
    case "confirm": {
      if (occ.status === "booked") {
        const flow = await loadFlowInfo(input.userId, occ);
        if (!flow) {
          return { ok: false, detail: "no pude cargar los datos del flujo" };
        }
        if (flow.isVariableFixed) {
          if (!occ.createdTransactionId || !occ.fixedExpenseId) {
            return {
              ok: false,
              detail:
                "Ese aviso dice que hubo un pago, pero no pude probar cuál; no registré otro.",
            };
          }
          const prior = await readPriorVariablePayment(
            input.userId,
            occ.createdTransactionId,
            occ.fixedExpenseId,
          );
          if (!prior.ok) {
            return {
              ok: false,
              detail:
                "No pude probar el pago ya ligado a ese aviso; no lo confirmé ni cobré otra vez.",
            };
          }
          return resolveVariableFixedOccurrence(
            {
              ...input,
              amount: input.amount ?? prior.amount,
              paymentSource: input.paymentSource ?? prior.source,
              paymentDateISO: input.paymentDateISO ?? prior.paymentDateISO,
            },
            occ,
            flow,
          );
        }
        return markOccurrence(input.userId, occ.id, { status: "confirmed" },
          "confirmado",
          "no pude cerrar el aviso; reintenta en un momento");
      }
      // pending → acknowledge (reserve) or book the expected amount (cash-flow / debt).
      const flow = await loadFlowInfo(input.userId, occ);
      if (!flow) return { ok: false, detail: "no pude cargar los datos del flujo" };
      if (flow.isVariableFixed) {
        return resolveVariableFixedOccurrence(input, occ, flow);
      }
      if (input.paymentSource || input.paymentDateISO) {
        return {
          ok: false,
          detail:
            "La fuente/fecha puntual solo está cableada al writer atómico de facturas variables; no moví dinero por otra ruta.",
        };
      }
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
          "no pude cerrar el aviso; reintenta en un momento");
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
        return { ok: false, detail: "no pude cerrar el registro; reintenta en un momento" };
      }
      return { ok: true, detail: "registrado" };
    }
    case "correct": {
      if (
        input.amount == null ||
        !Number.isFinite(input.amount) ||
        input.amount < 0
      ) {
        return { ok: false, detail: "¿cuál es el monto correcto?" };
      }
      const flow = await loadFlowInfo(input.userId, occ);
      if (!flow) return { ok: false, detail: "no pude cargar los datos del flujo" };
      if (flow.isVariableFixed) {
        return resolveVariableFixedOccurrence(input, occ, flow);
      }
      if (!(input.amount > 0)) {
        return {
          ok: false,
          detail: "El monto correcto debe ser mayor a cero.",
        };
      }
      if (input.paymentSource || input.paymentDateISO) {
        return {
          ok: false,
          detail:
            "La fuente/fecha puntual solo está cableada al writer atómico de facturas variables; no moví dinero por otra ruta.",
        };
      }
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
          "no pude cerrar el aviso; reintenta en un momento");
        if (!marked.ok || input.scope !== "from_now") return marked;
        return updatePermanentPlanAfterResolvedOccurrence(input, occ, flow.currency ?? occ.currency);
      }
      // Reverse the auto-booking (if any) BEFORE rebooking at the real amount — and abort if the
      // reversal did not commit, so we never leave the original applied AND book a second row.
      const wasBooked = occ.status === "booked" && !!occ.createdTransactionId;
      if (wasBooked) {
        const rev = await reverseRecurring(input.userId, occ.createdTransactionId!);
        if (!rev) return { ok: false, detail: "no pude revertir el registro anterior; reintenta en un momento" };
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
            ? "no pude registrar el monto corregido; revertí el anterior, dime el monto de nuevo"
            : "revertí el registro anterior pero no pude reabrir el aviso; reintenta en un momento",
        };
      }
      const updc = await updateOccurrence(input.userId, occ.id, {
        ...reserveResolutionPatch("corrected", input.amount, flow.currency ?? occ.currency),
        createdTransactionId: txId,
      });
      if (!updc) {
        await reverseRecurring(input.userId, txId); // don't leave a ghost the retry could re-book past
        return { ok: false, detail: "no pude cerrar la corrección; reintenta en un momento" };
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
  | {
      ok: true;
      complete: true;
      text: string;
      evidence: Array<Record<string, unknown>>;
    }
  | {
      ok: false;
      complete: false;
      text: string;
      evidence: [];
    };

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
    return {
      ok: false,
      complete: false,
      text: OPEN_OCCURRENCES_UNREADABLE,
      evidence: [],
    };
  }
  const open = read.occurrences;
  if (open.length === 0) {
    return { ok: true, complete: true, text: "", evidence: [] };
  }
  const namesRead = await deps.readNames(open);
  // An occurrence id is authoritative only after the user-visible flow has
  // been identified. Publishing anonymous ids such as two generic "cortes de
  // tarjeta" lets the model choose one arbitrarily. Name failure therefore
  // makes the entire routing block unavailable.
  if (!namesRead.ok) {
    return {
      ok: false,
      complete: false,
      text: OPEN_OCCURRENCES_UNREADABLE,
      evidence: [],
    };
  }
  const names = namesRead.names;
  const lines = open.map((o) => {
    const label = names.get(sourceKey(o)) ?? kindLabel(o.kind);
    const amt = fmtAmt(o.expectedAmount, o.currency);
    const reserve = o.kind === "savings" || o.kind === "investment";
    const state =
      o.status === "booked"
        ? `registrado ${amt} el ${o.occurrenceDate}, esperando tu OK`
        : o.status === "observed"
          ? `factura observada en ${fmtAmt(o.resolvedAmount, o.resolvedCurrency)}; el monto ya está aprendido pero NO consta como pagada`
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
    'FLUJOS DEL CALENDARIO SIN CONFIRMAR — si el usuario responde a uno ("sí"/"entró"/"pagué"/"fueron X"/"no vino"/"no lo pagué"/"ya aparté"/"no me preguntes"/"te digo mañana"), llama resolve_recurring_occurrence con el occurrenceId correcto. Para una factura variable OBSERVADA: "no la pagué" = unpaid (conserva el monto); "esa factura no existió/la anoté por error" = retract. Nunca uses skip para borrar una factura observada. Pagos de deuda y tarjetas se registran al confirmar; una reserva pura solo se marca como apartada, pero una inversión vinculada a cuenta de origen + activo mueve ambas patas atómicamente:',
    ...lines,
    ].join("\n"),
    // Grounding receives typed facts, never the presentation string above.
    // Names remain identity only; dates and amounts are read from explicit
    // keys so a user-authored label/note cannot manufacture a calendar fact.
    evidence: open.map((occurrence) => {
      const name = names.get(sourceKey(occurrence)) ?? kindLabel(occurrence.kind);
      return {
        id: occurrence.id,
        name,
        kind: occurrence.kind,
        status: occurrence.status,
        expectedAmount: occurrence.expectedAmount,
        currency: occurrence.currency,
        resolvedAmount: occurrence.resolvedAmount,
        resolvedCurrency: occurrence.resolvedCurrency,
        ...(occurrence.kind === "card_statement"
          ? { cutoffDate: occurrence.occurrenceDate }
          : occurrence.kind === "debt_payment"
            ? { dueDate: occurrence.occurrenceDate }
            : { occurrenceDate: occurrence.occurrenceDate }),
      };
    }),
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
  | { ok: true; id: null; reason: "none" | "ambiguous" }
  | { ok: false };

// Match a resolve request to an open occurrence: explicit id wins; else by flow name +
// kind; else the single open one.
export async function matchOpenOccurrence(
  userId: string,
  ref: {
    occurrenceId?: string | null;
    flowName?: string | null;
    kind?: OccurrenceKind | null;
    fixedExpenseId?: string | null;
    occurrenceDate?: string | null;
  },
): Promise<OpenOccurrenceMatch> {
  return matchOpenOccurrenceWith(ref, {
    readOpen: () => readOpenOccurrences(userId),
    readNames: (open) => readOccurrenceNames(userId, open),
  });
}

/** El seam: la decisión pura sobre el contrato de lectura, sin DB, para que el
 *  gate pueda ejercitar los tres veredictos y sus fronteras. */
export async function matchOpenOccurrenceWith(
  ref: {
    occurrenceId?: string | null;
    flowName?: string | null;
    kind?: OccurrenceKind | null;
    fixedExpenseId?: string | null;
    occurrenceDate?: string | null;
  },
  deps: {
    readOpen: () => Promise<OpenOccurrencesRead>;
    readNames: (open: RecurringOccurrence[]) => Promise<OccurrenceNamesRead>;
  },
): Promise<OpenOccurrenceMatch> {
  // El id salió del bloque de arriba: es evidencia directa, no necesita la lista
  // UNLESS the same call also claims a concrete fixed expense. In that case both
  // identities must denote the same row; otherwise a model call carrying
  // fixedExpenseId=Luz could resolve the sole open Gas occurrence.
  if (ref.occurrenceId && !ref.fixedExpenseId && !ref.occurrenceDate) {
    return { ok: true, id: ref.occurrenceId };
  }
  const read = await deps.readOpen();
  if (!read.ok) return { ok: false };
  // On an incomplete set, neither absence nor uniqueness is proven. The only
  // safe shortcut is the explicit occurrenceId handled above.
  if (!read.complete) return { ok: false };
  const open = read.occurrences;
  if (open.length === 0) {
    return { ok: true, id: null, reason: "none" };
  }
  const want = (ref.flowName ?? "").trim().toLowerCase();
  const candidates = open.filter(
    (o) =>
      (ref.kind ? o.kind === ref.kind : true) &&
      (ref.fixedExpenseId
        ? o.fixedExpenseId === ref.fixedExpenseId
        : true) &&
      (ref.occurrenceDate
        ? o.occurrenceDate === ref.occurrenceDate
        : true),
  );
  if (ref.occurrenceId) {
    return candidates.some((o) => o.id === ref.occurrenceId)
      ? { ok: true, id: ref.occurrenceId }
      : { ok: true, id: null, reason: "ambiguous" };
  }
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
    if (byName.length === 1) return { ok: true, id: byName[0].id };
    return {
      ok: true,
      id: null,
      reason: candidates.length === 0 ? "none" : "ambiguous",
    };
  }
  // Sin nombre, «hay exactamente una» es una inferencia por AUSENCIA: solo vale
  // sobre una lista completa. Sobre una topada, «una» puede ser una de cinco, y
  // resolver la equivocada registra el pago de otra tarjeta.
  if (candidates.length === 1) return { ok: true, id: candidates[0].id };
  return {
    ok: true,
    id: null,
    reason: candidates.length === 0 ? "none" : "ambiguous",
  };
}
