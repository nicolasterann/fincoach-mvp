import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// Bloque C — typed store for recurring_occurrences (migration 044). Service-role only
// (the materialization cron + the resolve agent tool run without a user session). Every
// read tolerates a pre-migration DB (try/catch → [] / null) so production is unchanged until
// 044 lands. The transaction ledger is NEVER written here — booking goes through the single
// ledger writer (applyLedgerEntry); this store only tracks occurrence lifecycle state.

export type OccurrenceStatus =
  | "pending" // ask-mode: asked, awaiting the user's amount
  | "booked" // auto-mode: booked automatically, awaiting the user's OK
  | "confirmed" // user confirmed the booked/expected amount
  | "corrected" // user gave a different amount (this occurrence rebooked)
  | "skipped" // did not arrive → the booking (if any) was reversed
  | "dismissed"; // ask-mode: user said "don't ask me about this"

// income/expense = cash-flow (drives the Margen). debt_payment = a loan/card/family-debt payment
// (reduces a cash account + the debt). savings/investment = a reserve check-in (a Margen
// allocation, not necessarily a ledger movement). Migration 045 widened the kind CHECK.
export type OccurrenceKind = "income" | "expense" | "debt_payment" | "savings" | "investment";
export type OccurrenceMode = "auto" | "ask";

// The aggregate reserve kinds (no per-reserve plan row) live under commitment_kind.
export type CommitmentKind = "savings" | "investment";

export interface RecurringOccurrence {
  id: string;
  userId: string;
  // Exactly one source is set (enforced by the DB check).
  incomeSourceId: string | null;
  fixedExpenseId: string | null;
  debtAccountId: string | null;
  savingsPlanId: string | null;
  scheduledPaymentId: string | null;
  commitmentKind: CommitmentKind | null;
  occurrenceDate: string; // YYYY-MM-DD
  kind: OccurrenceKind;
  mode: OccurrenceMode;
  expectedAmount: number | null;
  currency: string | null;
  status: OccurrenceStatus;
  createdTransactionId: string | null;
  askCount: number;
  snoozeUntil: string | null;
  lastAskedOn: string | null;
  resolvedAt: string | null;
  notified: boolean;
  createdAt: string;
}

// The kinds that are genuine cash-flow and therefore relevant to the Margen honesty signal
// (an unconfirmed one may mean the Margen is over/under-stated). Debt payments live in their own
// cycle and reserves are already reflected as capacity allocations, so neither drags the Margen.
export const MARGEN_RELEVANT_KINDS: OccurrenceKind[] = ["income", "expense"];

const TERMINAL: OccurrenceStatus[] = ["confirmed", "corrected", "skipped", "dismissed"];
export const OPEN_STATUSES: OccurrenceStatus[] = ["pending", "booked"];

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));

function mapRow(r: Row): RecurringOccurrence {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    incomeSourceId: str(r.income_source_id),
    fixedExpenseId: str(r.fixed_expense_id),
    debtAccountId: str(r.debt_account_id),
    savingsPlanId: str(r.savings_plan_id),
    scheduledPaymentId: str(r.scheduled_payment_id),
    commitmentKind: (str(r.commitment_kind) as CommitmentKind | null) ?? null,
    occurrenceDate: String(r.occurrence_date).slice(0, 10),
    kind: (str(r.kind) ?? "income") as OccurrenceKind,
    mode: (str(r.mode) ?? "auto") as OccurrenceMode,
    expectedAmount: num(r.expected_amount),
    currency: str(r.currency),
    status: (str(r.status) ?? "pending") as OccurrenceStatus,
    createdTransactionId: str(r.created_transaction_id),
    askCount: Number(r.ask_count ?? 0),
    snoozeUntil: str(r.snooze_until),
    lastAskedOn: str(r.last_asked_on)?.slice(0, 10) ?? null,
    resolvedAt: str(r.resolved_at),
    notified: r.notified === true,
    createdAt: String(r.created_at ?? ""),
  };
}

export interface CreateOccurrenceInput {
  userId: string;
  // Exactly one source. The DB check rejects zero or many.
  incomeSourceId?: string | null;
  fixedExpenseId?: string | null;
  debtAccountId?: string | null;
  savingsPlanId?: string | null;
  scheduledPaymentId?: string | null;
  commitmentKind?: CommitmentKind | null;
  occurrenceDate: string;
  kind: OccurrenceKind;
  mode: OccurrenceMode;
  expectedAmount?: number | null;
  currency?: string | null;
}

// The single source discriminator set on this input (used for the conflict re-fetch). Order is
// irrelevant — exactly one is non-null (DB-enforced).
function sourceFilterFor(input: CreateOccurrenceInput): { col: string; val: string } {
  if (input.incomeSourceId) return { col: "income_source_id", val: input.incomeSourceId };
  if (input.fixedExpenseId) return { col: "fixed_expense_id", val: input.fixedExpenseId };
  if (input.debtAccountId) return { col: "debt_account_id", val: input.debtAccountId };
  if (input.savingsPlanId) return { col: "savings_plan_id", val: input.savingsPlanId };
  if (input.scheduledPaymentId) return { col: "scheduled_payment_id", val: input.scheduledPaymentId };
  return { col: "commitment_kind", val: input.commitmentKind as string };
}

// Idempotent create: one row per (source, occurrence_date). On the partial-unique conflict we
// fetch and return the existing row with created=false, so a cron rerun / catch-up never makes
// a duplicate. Returns null only on an unexpected error (caller logs + skips).
export async function createOccurrenceIfAbsent(
  input: CreateOccurrenceInput,
): Promise<{ occurrence: RecurringOccurrence; created: boolean } | null> {
  const sb = createSupabaseAdminClient();
  const sourceFilter = sourceFilterFor(input);
  try {
    const { data, error } = await sb
      .from("recurring_occurrences")
      .insert({
        user_id: input.userId,
        income_source_id: input.incomeSourceId ?? null,
        fixed_expense_id: input.fixedExpenseId ?? null,
        debt_account_id: input.debtAccountId ?? null,
        savings_plan_id: input.savingsPlanId ?? null,
        scheduled_payment_id: input.scheduledPaymentId ?? null,
        commitment_kind: input.commitmentKind ?? null,
        occurrence_date: input.occurrenceDate,
        kind: input.kind,
        mode: input.mode,
        expected_amount: input.expectedAmount ?? null,
        currency: input.currency ?? null,
        status: "pending",
      })
      .select("*")
      .single();
    if (!error && data) return { occurrence: mapRow(data as Row), created: true };
    // Unique violation → the occurrence already exists; fetch it.
    if (error && (error.code === "23505" || /duplicate key|unique/i.test(error.message))) {
      const existing = await fetchExisting(input.userId, sourceFilter, input.occurrenceDate);
      return existing ? { occurrence: existing, created: false } : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchExisting(
  userId: string,
  sourceFilter: { col: string; val: string },
  occurrenceDate: string,
): Promise<RecurringOccurrence | null> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb
      .from("recurring_occurrences")
      .select("*")
      .eq("user_id", userId)
      .eq(sourceFilter.col, sourceFilter.val)
      .eq("occurrence_date", occurrenceDate)
      .maybeSingle();
    return data ? mapRow(data as Row) : null;
  } catch {
    return null;
  }
}

export async function getOccurrence(userId: string, id: string): Promise<RecurringOccurrence | null> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb
      .from("recurring_occurrences")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    return data ? mapRow(data as Row) : null;
  } catch {
    return null;
  }
}

// All non-terminal occurrences (pending asks + booked-unconfirmed). Feeds the Margen honesty
// signal AND the resolve flow (what the user can confirm/correct).
export async function listOpenOccurrences(userId: string): Promise<RecurringOccurrence[]> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb
      .from("recurring_occurrences")
      .select("*")
      .eq("user_id", userId)
      .in("status", OPEN_STATUSES)
      .order("occurrence_date", { ascending: true });
    return (data ?? []).map((r) => mapRow(r as Row));
  } catch {
    return [];
  }
}

// Count of PENDING cash-flow occurrences (asked, not yet booked) — the ones genuinely NOT in the
// Margen number yet. 'booked' occurrences are already in the balance, so they don't degrade
// accuracy. Scoped to MARGEN_RELEVANT_KINDS: a pending card/loan/reserve check-in lives in its
// own cycle / is already a capacity allocation, so it must NOT drag the daily Margen confidence.
export async function countPendingOccurrences(userId: string): Promise<number> {
  try {
    const sb = createSupabaseAdminClient();
    const { count } = await sb
      .from("recurring_occurrences")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending")
      .in("kind", MARGEN_RELEVANT_KINDS);
    return count ?? 0;
  } catch {
    return 0;
  }
}

export interface OccurrencePatch {
  status?: OccurrenceStatus;
  createdTransactionId?: string | null;
  askCount?: number;
  snoozeUntil?: string | null;
  lastAskedOn?: string | null;
  notified?: boolean;
}

// Single UPDATE scoped by id+user_id. Stamps resolved_at automatically when the status
// becomes terminal, and returns the fresh row.
export async function updateOccurrence(
  userId: string,
  id: string,
  patch: OccurrencePatch,
): Promise<RecurringOccurrence | null> {
  try {
    const sb = createSupabaseAdminClient();
    const row: Row = {};
    if (patch.status !== undefined) {
      row.status = patch.status;
      row.resolved_at = TERMINAL.includes(patch.status) ? new Date().toISOString() : null;
    }
    if (patch.createdTransactionId !== undefined) row.created_transaction_id = patch.createdTransactionId;
    if (patch.askCount !== undefined) row.ask_count = patch.askCount;
    if (patch.snoozeUntil !== undefined) row.snooze_until = patch.snoozeUntil;
    if (patch.lastAskedOn !== undefined) row.last_asked_on = patch.lastAskedOn;
    if (patch.notified !== undefined) row.notified = patch.notified;
    if (Object.keys(row).length === 0) return getOccurrence(userId, id);
    const { data, error } = await sb
      .from("recurring_occurrences")
      .update(row)
      .eq("user_id", userId)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    return !error && data ? mapRow(data as Row) : null;
  } catch {
    return null;
  }
}
