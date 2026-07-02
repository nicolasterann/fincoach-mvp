import { createSupabaseAdminClient } from "@/lib/supabase-admin";
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
}): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  if (input.amount !== undefined) patch.amount = input.amount;
  if (input.startDate !== undefined) patch.start_date = input.startDate;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.expectedDay !== undefined) patch.expected_day = input.expectedDay;
  if (input.name !== undefined && input.name.trim()) patch.name = input.name.trim().slice(0, 120);
  if (input.currency !== undefined) patch.currency = input.currency;
  if (Object.keys(patch).length === 0) return true;
  const supabase = createSupabaseAdminClient();
  // Zero matched rows (stale id, someone else's row) must read as failure —
  // otherwise Kipu confirms a pause/rename that never happened.
  const { data, error } = await supabase
    .from("fixed_expenses")
    .update(patch)
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .select("id");
  return !error && (data?.length ?? 0) > 0;
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
export async function getFixedExpenseCurrency(input: {
  userId: string;
  id: string;
}): Promise<string | null> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("fixed_expenses")
    .select("currency")
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .maybeSingle();
  const cur = (data as { currency?: unknown } | null)?.currency;
  return typeof cur === "string" && cur ? cur.toUpperCase() : null;
}

// Loose name match against the user's active fixed expenses, so we can ask
// "update vs create" when something similar already exists.
export async function findSimilarFixedExpenses(input: {
  userId: string;
  name: string;
}): Promise<ExistingFixedExpense[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("fixed_expenses")
    .select("id, name, amount, currency, frequency")
    .eq("user_id", input.userId)
    .eq("is_active", true);
  if (error || !data) return [];
  const norm = (t: string) =>
    t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  const target = norm(input.name);
  if (!target) return [];
  return (data as { id: string; name: string; amount: number | string; currency: string; frequency: string }[])
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
}

interface ScheduledPaymentRow {
  id: string;
  name: string;
  amount: number | string | null;
  currency: string;
  category: string;
  due_date: string;
  recurring: boolean;
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
  };
}

// Upcoming, still-scheduled payments for a user (for coach context / reminders).
export async function loadUpcomingScheduledPayments(
  userId: string,
  withinDays = 45,
): Promise<UpcomingScheduledPayment[]> {
  const supabase = createSupabaseAdminClient();
  const until = new Date(Date.now() + withinDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await supabase
    .from("scheduled_payments")
    .select("id, name, amount, currency, category, due_date, recurring")
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .lte("due_date", until)
    .order("due_date", { ascending: true })
    .limit(20);
  if (error || !data) return [];
  return (data as ScheduledPaymentRow[]).map(mapScheduled);
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
