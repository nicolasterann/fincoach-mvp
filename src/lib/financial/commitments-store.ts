import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { MoneyReadStatus } from "@/lib/financial/money-read";
import type {
  CurrencyCode,
  FinancialCategory,
  PaymentFrequency,
  PaymentSourceType,
} from "@/types/financial";

// Phase 11 Slice 2 persistence for future commitments and receivables. These
// tables are NOT the transaction ledger — they describe future plans and
// loans — so writes here are independent of applyChatTransactionIntent (which
// stays the sole writer of the `transactions` ledger + balances). When a
// scheduled payment is actually paid or a loan repaid, the ledger write still
// goes through that single writer; this module only links the records.

// ── Fixed / recurring expenses (create + permanent update) ──────────────────

export interface CreateFixedExpenseInput {
  userId: string;
  name: string;
  amount: number;
  currency: CurrencyCode;
  category: FinancialCategory;
  frequency: PaymentFrequency;
  startDate?: string | null;
  paymentSourceType?: PaymentSourceType;
  paymentSourceId?: string;
  isEssential?: boolean;
}

export async function createFixedExpense(
  input: CreateFixedExpenseInput,
): Promise<{ id: string } | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("fixed_expenses")
    .insert({
      user_id: input.userId,
      name: input.name,
      amount: input.amount,
      currency: input.currency,
      category: input.category,
      frequency: input.frequency,
      start_date: input.startDate ?? null,
      payment_source_type: input.paymentSourceType ?? null,
      payment_source_id: input.paymentSourceId ?? null,
      is_essential: input.isEssential ?? false,
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: data.id as string };
}

export async function updateFixedExpenseAmount(input: {
  userId: string;
  id: string;
  amount: number;
}): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("fixed_expenses")
    .update({ amount: input.amount })
    .eq("id", input.id)
    .eq("user_id", input.userId);
  return !error;
}

// Update amount and/or the future start date together, so a permanent change
// that begins later ("desde el 1 del próximo mes pago 25 de gimnasio") keeps
// both the new amount and the start timing. Also covers pause/resume/soft-
// delete (isActive), due day, rename and currency — always scoped to the user.
export async function updateFixedExpenseFields(input: {
  userId: string;
  id: string;
  amount?: number;
  startDate?: string | null;
  isActive?: boolean;
  expectedDay?: number | null;
  name?: string;
  currency?: CurrencyCode;
  // Stage 30 — mark a fixed expense as varying month to month (gas, luz) vs
  // truly fixed (arriendo). The engine treats variable ones with lower
  // confidence. Migration 035: fixed_expenses.is_variable.
  isVariable?: boolean;
  // Stage 30 — free-text note the coach reads as memory. Empty string clears it.
  notes?: string | null;
  // Stage 32 (Item B) — when the user confirms a variable expense's amount for
  // THIS month, stamp the first day of the month (YYYY-MM-01) so the ambient
  // "¿cuánto te salió X este mes?" ask stops until next month. Migration 038:
  // fixed_expenses.last_confirmed_month.
  lastConfirmedMonth?: string;
}): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  if (input.amount !== undefined) patch.amount = input.amount;
  if (input.startDate !== undefined) patch.start_date = input.startDate;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.expectedDay !== undefined) patch.expected_day = input.expectedDay;
  if (input.name !== undefined && input.name.trim()) patch.name = input.name.trim().slice(0, 120);
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.isVariable !== undefined) patch.is_variable = input.isVariable;
  if (input.notes !== undefined) patch.notes = input.notes && input.notes.trim() ? input.notes.trim().slice(0, 500) : null;
  const stampConfirmedMonth =
    input.lastConfirmedMonth !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(input.lastConfirmedMonth);
  if (stampConfirmedMonth) patch.last_confirmed_month = input.lastConfirmedMonth;
  if (Object.keys(patch).length === 0) return true;
  const supabase = createSupabaseAdminClient();
  // Zero matched rows (stale id, someone else's row) must read as failure —
  // otherwise Kipu confirms a pause/rename that never happened.
  let { data, error } = await supabase
    .from("fixed_expenses")
    .update(patch)
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .select("id");
  // Schema guard (like the onboarding save): a pre-038 database must not make
  // the WHOLE update fail because of the confirmation stamp — retry without it.
  const unknownColumn =
    error != null &&
    stampConfirmedMonth &&
    ((error as { code?: string }).code === "PGRST204" ||
      (error as { code?: string }).code === "42703" ||
      /last_confirmed_month|schema cache/i.test(error.message ?? ""));
  if (unknownColumn) {
    delete patch.last_confirmed_month;
    if (Object.keys(patch).length === 0) return true;
    ({ data, error } = await supabase
      .from("fixed_expenses")
      .update(patch)
      .eq("id", input.id)
      .eq("user_id", input.userId)
      .select("id"));
  }
  return !error && (data?.length ?? 0) > 0;
}

// Whether one fixed expense (scoped to the user) is marked month-to-month
// variable. Null when the row doesn't exist; false when the column predates
// migration 035 (absent → truly fixed). Read by the update executor to decide
// if an amount change also counts as this month's confirmation (Stage 32).
export async function getFixedExpenseVariableFlag(input: {
  userId: string;
  id: string;
}): Promise<boolean | null> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("fixed_expenses")
    .select("is_variable")
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!data) return null;
  return (data as { is_variable?: unknown }).is_variable === true;
}

export interface ExistingFixedExpense {
  id: string;
  name: string;
  amount: number;
  currency: string;
  frequency: string;
}

// The stored denomination of one fixed expense (any active state), scoped to
// the user. Null when the row doesn't exist.
/** Distingue "no pude leer" de "no tiene moneda declarada" — con `string | null`
 *  eran el mismo valor y el caller asumía la base, convirtiendo 1:1 a ciegas. */
export type FixedExpenseCurrencyRead = { ok: boolean; currency: string | null };

export async function getFixedExpenseCurrency(input: {
  userId: string;
  id: string;
}): Promise<FixedExpenseCurrencyRead> {
  const supabase = createSupabaseAdminClient();
  // Devolver `string | null` hacía que "falló la lectura" y "no tiene moneda" fueran
  // literalmente el mismo valor, y el caller lee null como "asume la base" — o sea,
  // convierte 1:1 sin saberlo. Un `if (error) return null` NO arreglaba nada: en
  // error `data` ya venía null y el retorno ya era null. El tipo es el arreglo.
  const { data, error } = await supabase
    .from("fixed_expenses")
    .select("currency")
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error) return { ok: false, currency: null };
  const cur = (data as { currency?: unknown } | null)?.currency;
  return { ok: true, currency: typeof cur === "string" && cur ? cur.toUpperCase() : null };
}

// Loose name match against the user's active fixed expenses, so we can ask
// "update vs create" when something similar already exists.
/** Un guard que no pudo leer NO autoriza. Con `ExistingFixedExpense[]`, una lectura
 *  fallida decía "no hay ninguno parecido" y el fijo duplicado entraba — justo cuando
 *  el guard más hacía falta. */
export type SimilarFixedExpensesRead = MoneyReadStatus & { matches: ExistingFixedExpense[] };

export async function readSimilarFixedExpenses(input: {
  userId: string;
  name: string;
}): Promise<SimilarFixedExpensesRead> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("fixed_expenses")
    .select("id, name, amount, currency, frequency")
    .eq("user_id", input.userId)
    .eq("is_active", true);
  // Un guard que no pudo leer NO autoriza. Antes, `[]` significaba "no hay ninguno
  // parecido" y el fijo duplicado entraba — justo cuando el guard más hacía falta.
  if (error || !data) return { ok: false, complete: false, matches: [] };
  const norm = (t: string) =>
    t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  const target = norm(input.name);
  if (!target) return { ok: true, complete: true, matches: [] };
  const matches = (data as { id: string; name: string; amount: number | string; currency: string; frequency: string }[])
    .filter((row) => {
      const n = norm(row.name);
      return n.includes(target) || target.includes(n);
    })
    .map((row) => ({
      id: row.id,
      name: row.name,
      amount: Number(row.amount),
      currency: row.currency,
      frequency: row.frequency,
    }));
  return { ok: true, complete: true, matches };
}

// ── Scheduled (future, not-yet-paid) payments ───────────────────────────────

export interface CreateScheduledPaymentInput {
  userId: string;
  name: string;
  amount?: number | null;
  currency: CurrencyCode;
  category: FinancialCategory;
  dueDate: string; // YYYY-MM-DD
  recurring: boolean;
  paymentSourceType?: PaymentSourceType;
  paymentSourceId?: string;
  rawInput?: string;
}

export async function createScheduledPayment(
  input: CreateScheduledPaymentInput,
): Promise<{ id: string } | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("scheduled_payments")
    .insert({
      user_id: input.userId,
      name: input.name,
      amount: input.amount ?? null,
      currency: input.currency,
      category: input.category,
      due_date: input.dueDate,
      recurring: input.recurring,
      payment_source_type: input.paymentSourceType ?? null,
      payment_source_id: input.paymentSourceId ?? null,
      status: "scheduled",
      raw_input: input.rawInput ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: data.id as string };
}

export interface UpcomingScheduledPayment {
  id: string;
  name: string;
  amount: number | null;
  currency: string;
  category: string;
  dueDate: string;
  recurring: boolean;
  // Stage D — declared funding source (Tesorería alerts need to know WHICH
  // account must hold the money before the due date).
  paymentSourceType: string | null;
  paymentSourceId: string | null;
}

interface ScheduledPaymentRow {
  id: string;
  name: string;
  amount: number | string | null;
  currency: string;
  category: string;
  due_date: string;
  recurring: boolean;
  payment_source_type: string | null;
  payment_source_id: string | null;
}

function mapScheduled(row: ScheduledPaymentRow): UpcomingScheduledPayment {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency,
    category: row.category,
    dueDate: row.due_date,
    recurring: row.recurring,
    paymentSourceType: row.payment_source_type ?? null,
    paymentSourceId: row.payment_source_id ?? null,
  };
}

/** A scheduled-payments read that reports on itself. See `money-read.ts`. */
export type ScheduledPaymentsRead = MoneyReadStatus & { payments: UpcomingScheduledPayment[] };

// "Vi N" y "hay N" no pueden ser la misma frase: se pide uno más y la fila extra
// prueba que había cola. El tope escala con la VENTANA: 20 alcanzaba para 45 días,
// pero la tool del agente pide 400 — con un recordatorio mensual se pasaba de 20,
// marcaba complete:false y el guard rechazaba editar o cancelar un pago a quien
// simplemente tiene muchos. Seguro, pero una regresión de UX innecesaria.
const scheduledCapFor = (withinDays: number) => Math.max(20, Math.ceil(withinDays / 45) * 20);

// Upcoming, still-scheduled payments for a user (for coach context / reminders).
export async function readUpcomingScheduledPayments(
  userId: string,
  withinDays = 45,
): Promise<ScheduledPaymentsRead> {
  const supabase = createSupabaseAdminClient();
  const cap = scheduledCapFor(withinDays);
  const until = new Date(Date.now() + withinDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await supabase
    .from("scheduled_payments")
    .select("id, name, amount, currency, category, due_date, recurring, payment_source_type, payment_source_id")
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .lte("due_date", until)
    .order("due_date", { ascending: true })
    .limit(cap + 1);
  // Bloque I — el error se tragaba y el .limit(20) truncaba sin avisar. Los pagos
  // programados son plata que el calendario APARTA: perderlos sube el punto más bajo
  // de la proyección, o sea la cota del calendario del Saldo. "No tiene pagos" y "no
  // pude leer sus pagos" tienen que ser respuestas distintas.
  if (error || !data) return { ok: false, complete: false, payments: [] };
  const capped = data.length > cap;
  return {
    ok: true,
    complete: !capped,
    payments: (data.slice(0, cap) as ScheduledPaymentRow[]).map(mapScheduled),
  };
}

/** DISPLAY ONLY — collapses a failed read into an empty list. */
export async function loadUpcomingScheduledPaymentsForDisplay(
  userId: string,
  withinDays = 45,
): Promise<UpcomingScheduledPayment[]> {
  return (await readUpcomingScheduledPayments(userId, withinDays)).payments;
}

export interface DueScheduledPayment extends UpcomingScheduledPayment {
  userId: string;
  paymentSourceType: string | null;
  paymentSourceId: string | null;
}

// Scheduled payments whose due date has arrived (status still 'scheduled').
// Used by the cron route to surface/materialize them. Service-role scan.
export async function loadDueScheduledPayments(
  asOfDate: string,
  limit = 200,
): Promise<DueScheduledPayment[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("scheduled_payments")
    .select(
      "id, user_id, name, amount, currency, category, due_date, recurring, payment_source_type, payment_source_id",
    )
    .eq("status", "scheduled")
    .lte("due_date", asOfDate)
    .order("due_date", { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return (
    data as (ScheduledPaymentRow & {
      user_id: string;
      payment_source_type: string | null;
      payment_source_id: string | null;
    })[]
  ).map((row) => ({
    ...mapScheduled(row),
    userId: row.user_id,
    paymentSourceType: row.payment_source_type,
    paymentSourceId: row.payment_source_id,
  }));
}

export async function setScheduledPaymentStatus(input: {
  userId: string;
  id: string;
  status: "scheduled" | "done" | "cancelled" | "skipped";
  createdTransactionId?: string | null;
}): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { status: input.status };
  if (input.createdTransactionId !== undefined) {
    patch.created_transaction_id = input.createdTransactionId;
  }
  const { error } = await supabase
    .from("scheduled_payments")
    .update(patch)
    .eq("id", input.id)
    .eq("user_id", input.userId);
  return !error;
}

// Edit a still-scheduled payment's amount and/or due date (never its currency —
// that would silently re-denominate). No money moves; this only changes the
// FUTURE plan. `.select()` confirms a row actually matched (user + id + still
// scheduled), so editing a non-existent / already-materialized one returns false
// instead of a false success.
export async function updateScheduledPaymentFields(input: {
  userId: string;
  id: string;
  amount?: number;
  dueDate?: string;
}): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  if (typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount > 0) {
    patch.amount = input.amount;
  }
  if (typeof input.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    patch.due_date = input.dueDate;
  }
  if (Object.keys(patch).length === 0) return false;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("scheduled_payments")
    .update(patch)
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .eq("status", "scheduled")
    .select("id");
  return !error && (data?.length ?? 0) > 0;
}

// ── Receivables (loans out / money owed) ────────────────────────────────────

export interface CreateReceivableInput {
  userId: string;
  counterparty: string;
  direction?: "owed_to_user" | "user_owes";
  amount: number;
  currency: CurrencyCode;
  reason?: string;
  originTransactionId?: string | null;
}

export async function createReceivable(
  input: CreateReceivableInput,
): Promise<{ id: string } | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("receivables")
    .insert({
      user_id: input.userId,
      counterparty: input.counterparty,
      direction: input.direction ?? "owed_to_user",
      original_amount: input.amount,
      outstanding_amount: input.amount,
      currency: input.currency,
      reason: input.reason ?? null,
      status: "open",
      origin_transaction_id: input.originTransactionId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: data.id as string };
}

export interface OpenReceivable {
  id: string;
  counterparty: string;
  direction: string;
  originalAmount: number;
  outstandingAmount: number;
  currency: string;
  reason: string | null;
  status: string;
}

interface ReceivableRow {
  id: string;
  counterparty: string;
  direction: string;
  original_amount: number | string;
  outstanding_amount: number | string;
  currency: string;
  reason: string | null;
  status: string;
}

function mapReceivable(row: ReceivableRow): OpenReceivable {
  return {
    id: row.id,
    counterparty: row.counterparty,
    direction: row.direction,
    originalAmount: Number(row.original_amount),
    outstandingAmount: Number(row.outstanding_amount),
    currency: row.currency,
    reason: row.reason,
    status: row.status,
  };
}

export async function loadOpenReceivables(
  userId: string,
  direction: "owed_to_user" | "user_owes" = "owed_to_user",
): Promise<OpenReceivable[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("receivables")
    .select(
      "id, counterparty, direction, original_amount, outstanding_amount, currency, reason, status",
    )
    .eq("user_id", userId)
    .eq("direction", direction)
    .in("status", ["open", "partial"])
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as ReceivableRow[]).map(mapReceivable);
}

// Apply a repayment against the user's open receivables for a counterparty
// (oldest first). Reduces outstanding and flips status to partial/settled.
// Returns how much was matched (the rest is treated as plain income upstream).
export async function applyReceivableRepayment(input: {
  userId: string;
  counterparty: string | null;
  amount: number;
}): Promise<{ matched: number }> {
  const supabase = createSupabaseAdminClient();
  const open = await loadOpenReceivables(input.userId, "owed_to_user");
  const norm = (t: string) =>
    t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  const counterparty = input.counterparty ? norm(input.counterparty) : null;
  const candidates = counterparty
    ? open.filter(
        (r) =>
          norm(r.counterparty).includes(counterparty) ||
          counterparty.includes(norm(r.counterparty)),
      )
    : open;

  let remaining = input.amount;
  let matched = 0;
  for (const r of candidates) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, r.outstandingAmount);
    if (applied <= 0) continue;
    const newOutstanding = Math.round((r.outstandingAmount - applied) * 100) / 100;
    const { error } = await supabase
      .from("receivables")
      .update({
        outstanding_amount: newOutstanding,
        status: newOutstanding <= 0.005 ? "settled" : "partial",
      })
      .eq("id", r.id)
      .eq("user_id", input.userId);
    // Only count what truly persisted, so "y la descontué de lo que te debían"
    // is never claimed for an update that silently failed.
    if (error) continue;
    remaining -= applied;
    matched += applied;
  }
  return { matched: Math.round(matched * 100) / 100 };
}

// ── Stage 30 — per-row notes + card-cycle paid signal ───────────────────────
// These write the `notes` column the coach reads as memory (migration 035 added
// it to accounts/debt_accounts/goals; fixed_expenses/income_sources already had
// it), and the card `last_payment_date` so the billing cycle can tell "paid this
// statement" from "still owed" (detection B) without a manual "0" movement. No
// money moves here; the ledger writer stays the sole mover of balances.

// The DB table + column that back each note-bearing entity. fixed_expense goes
// through updateFixedExpenseFields (currency/amount safety lives there); the rest
// are simple text columns on a user-scoped, already-RLS'd table.
const NOTE_TABLE_BY_ENTITY: Record<"account" | "debt" | "goal" | "asset" | "income", string> = {
  account: "accounts",
  debt: "debt_accounts",
  goal: "goals",
  asset: "investment_accounts",
  income: "income_sources",
};

// Attach/replace/clear the free-text note on one entity, scoped to the user.
// `.select()` confirms a row matched so a stale id reads as failure. An empty /
// whitespace note clears it (null). Returns false on any error → Kipu never
// claims it saved a note that didn't land.
export async function setEntityNote(input: {
  userId: string;
  entity: "account" | "debt" | "goal" | "asset" | "income";
  id: string;
  note: string | null;
}): Promise<boolean> {
  const table = NOTE_TABLE_BY_ENTITY[input.entity];
  if (!table || !input.id) return false;
  const value = input.note && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from(table)
      .update({ notes: value })
      .eq("id", input.id)
      .eq("user_id", input.userId)
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// Stage-day-to-day F2 — after a credit-card payment, lower the PENDING STATEMENT
// (`full_payment_due`, "pago del mes") by what was paid, floored at 0, so it reflects
// what's LEFT to pay this cycle. The ACCUMULATED balance (`current_balance`) is
// reduced separately by the ledger writer — the two card numbers stay distinct (F4).
// Only credit cards carry a per-cycle statement (the `.eq("type","credit_card")`
// guard makes this a no-op for loans, whose full_payment_due is a recurring cuota).
// `currentDue`/`paidInCardCurrency` are both in the card's OWN currency (the caller
// only passes an amount it could express there — never a fabricated FX).
export async function reduceCardStatementDue(input: {
  userId: string;
  debtAccountId: string;
  currentDue: number;
  paidInCardCurrency: number;
}): Promise<boolean> {
  if (!(input.paidInCardCurrency > 0) || !(input.currentDue > 0)) return true;
  const next = Math.max(0, Math.round((input.currentDue - input.paidInCardCurrency) * 100) / 100);
  if (next === Math.round(input.currentDue * 100) / 100) return true; // nothing to change
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("debt_accounts")
      .update({ full_payment_due: next })
      .eq("id", input.debtAccountId)
      .eq("user_id", input.userId)
      .eq("type", "credit_card");
    return !error;
  } catch {
    return false;
  }
}

// Bloque C — the CORTE ask sets the closed statement ("pago del mes") when the user confirms the
// cut amount on the cutoff day. SETS full_payment_due (unlike reduceCardStatementDue which lowers
// it after a payment) + stamps statement_date. Guarded to credit cards, and refuses to overwrite
// a NEWER statement with an older corte date (same older-over-newer protection as a statement
// import), so a late/duplicate confirm can't clobber a fresher cut. `amount` is in the card's own
// currency. Returns true on success (or a safe no-op).
export async function setCardStatementDue(input: {
  userId: string;
  debtAccountId: string;
  amount: number;
  statementDateISO: string;
}): Promise<boolean> {
  if (!(input.amount >= 0)) return false;
  try {
    const supabase = createSupabaseAdminClient();
    const { data: cur } = await supabase
      .from("debt_accounts")
      .select("statement_date, type")
      .eq("id", input.debtAccountId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (!cur || cur.type !== "credit_card") return false;
    const existing = cur.statement_date ? String(cur.statement_date).slice(0, 10) : null;
    if (existing && input.statementDateISO < existing) return true; // don't clobber a newer statement
    const { error } = await supabase
      .from("debt_accounts")
      .update({ full_payment_due: input.amount, statement_date: input.statementDateISO })
      .eq("id", input.debtAccountId)
      .eq("user_id", input.userId)
      .eq("type", "credit_card");
    return !error;
  } catch {
    return false;
  }
}

// Day-to-day F3 — capitalize BANK-REALISTIC interest onto a carried card balance.
// Increases current_balance by the interest (bank finance charge) and stamps
// last_interest_accrued_on so the monthly cron never double-charges. original/base
// grow in the same ratio the row already has (multi-currency safe). Typed executor
// (mirrors update_card_obligations, which also writes current_balance directly);
// guarded to credit_card. Returns false on any error → the cron logs + moves on.
export interface InterestCandidateCard {
  id: string;
  userId: string;
  currentBalanceBase: number;
  currentBalanceOriginal: number;
  fullPaymentDue: number | null;
  cutoffDay: number | null;
  dueDay: number | null;
  interestRate: number | null;
  interestRateKind: string | null;
  lastInterestAccruedOn: string | null;
}

// Service-role scan of every credit card that COULD accrue interest (has a balance,
// a rate, and both cycle days). The pure computeCardInterestAccrual then decides per
// card whether it's actually carrying an unpaid statement. Used by the interest cron.
export async function loadCardsForInterestAccrual(): Promise<InterestCandidateCard[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("debt_accounts")
      .select("id, user_id, current_balance_base, current_balance_original, full_payment_due, cutoff_day, due_day, interest_rate, interest_rate_kind, last_interest_accrued_on")
      .eq("type", "credit_card")
      .gt("current_balance_base", 0)
      .gt("interest_rate", 0)
      .not("cutoff_day", "is", null)
      .not("due_day", "is", null);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      currentBalanceBase: Number(r.current_balance_base) || 0,
      currentBalanceOriginal: Number(r.current_balance_original) || 0,
      fullPaymentDue: r.full_payment_due == null ? null : Number(r.full_payment_due),
      cutoffDay: r.cutoff_day == null ? null : Number(r.cutoff_day),
      dueDay: r.due_day == null ? null : Number(r.due_day),
      interestRate: r.interest_rate == null ? null : Number(r.interest_rate),
      interestRateKind: r.interest_rate_kind == null ? null : String(r.interest_rate_kind),
      lastInterestAccruedOn: r.last_interest_accrued_on == null ? null : String(r.last_interest_accrued_on),
    }));
  } catch {
    return [];
  }
}

export async function accrueCardInterest(input: {
  userId: string;
  debtAccountId: string;
  currentBalanceBase: number;
  currentBalanceOriginal: number;
  interestBase: number;
  todayISO: string;
}): Promise<boolean> {
  if (!(input.interestBase > 0)) return true;
  const ratio = input.currentBalanceBase > 0 ? input.currentBalanceOriginal / input.currentBalanceBase : 1;
  const interestOriginal = Math.round(input.interestBase * ratio * 100) / 100;
  const newBase = Math.round((input.currentBalanceBase + input.interestBase) * 100) / 100;
  const newOriginal = Math.round((input.currentBalanceOriginal + interestOriginal) * 100) / 100;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("debt_accounts")
      .update({
        current_balance_base: newBase,
        current_balance_original: newOriginal,
        last_interest_accrued_on: input.todayISO,
      })
      .eq("id", input.debtAccountId)
      .eq("user_id", input.userId)
      .eq("type", "credit_card")
      // COMPARE-AND-SWAP. Esto es un read-modify-write: el saldo se leyó antes y se
      // escribe `leído + interés`. Sin esta condición, una compra registrada ENTRE la
      // lectura y este UPDATE se borraba — el write la pisaba con el saldo viejo más
      // el interés. Si el saldo ya no es el que leímos, no matchea ninguna fila y el
      // cron devuelve false: como `last_interest_accrued_on` tampoco se escribe, el
      // interés se acredita mañana sobre el saldo correcto. Perder un día de interés
      // es recuperable; borrar una compra del usuario, no.
      .eq("current_balance_base", input.currentBalanceBase)
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// Record when a card's statement was last paid, so the cycle engine reads it as
// paid (detection B). Only the date is written — the actual money movement (cash
// out, debt down) goes through the ledger's debt_payment writer, NOT here. Scoped
// to the user; `.select()` confirms the row matched.
export async function setDebtLastPaymentDate(input: {
  userId: string;
  debtAccountId: string;
  date: string; // YYYY-MM-DD
}): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return false;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("debt_accounts")
      .update({ last_payment_date: input.date })
      .eq("id", input.debtAccountId)
      .eq("user_id", input.userId)
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
