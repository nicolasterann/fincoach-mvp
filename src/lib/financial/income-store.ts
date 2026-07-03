import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// Stage 26 — typed reads/writes for the user's income sources, so the agent can
// change a salary going forward ("ahora gano 1400", "me pagan quincenal",
// "pausa ese ingreso") WITHOUT touching the transaction ledger. Changing an
// income is a plan update, never a movement. Every write is scoped to
// user_id + id; the DB check constrains status to active|paused|cancelled.

export type IncomeFrequency = "weekly" | "biweekly" | "monthly" | "yearly" | "custom";
export type IncomeStatus = "active" | "paused" | "cancelled";

export interface IncomeSource {
  id: string;
  name: string;
  amount: number;
  currency: string;
  frequency: IncomeFrequency;
  expectedDay: number | null;
  payAnchorDate: string | null;
  status: IncomeStatus;
  // S31 — variable-income truth (the engines plan with the MINIMUM when
  // isVariable) + the "Se deposita en" account captured at onboarding, so chat
  // tools can read/realign them instead of leaving stale onboarding values.
  isVariable: boolean;
  minExpectedAmount: number | null;
  maxExpectedAmount: number | null;
  destinationAccountId: string | null;
}

type Row = Record<string, unknown>;

function mapRow(r: Row): IncomeSource {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    amount: Number(r.amount ?? 0),
    currency: String(r.currency ?? "USD"),
    frequency: String(r.frequency ?? "monthly") as IncomeFrequency,
    expectedDay: r.expected_day == null ? null : Number(r.expected_day),
    payAnchorDate: r.pay_anchor_date == null ? null : String(r.pay_anchor_date),
    status: String(r.status ?? "active") as IncomeStatus,
    isVariable: r.is_variable === true,
    minExpectedAmount: r.min_expected_amount == null ? null : Number(r.min_expected_amount),
    maxExpectedAmount: r.max_expected_amount == null ? null : Number(r.max_expected_amount),
    destinationAccountId: r.destination_account_id == null ? null : String(r.destination_account_id),
  };
}

export async function listIncomeSources(userId: string): Promise<IncomeSource[]> {
  const supabase = createSupabaseAdminClient();
  // `*` so pay_anchor_date (migration 032) loads when present and degrades
  // gracefully (absent → null) before the DDL is applied.
  const { data, error } = await supabase
    .from("income_sources")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as Row[]).map(mapRow);
}

export interface IncomeSourcePatch {
  amount?: number;
  currency?: string;
  frequency?: IncomeFrequency;
  expectedDay?: number | null;
  payAnchorDate?: string | null;
  status?: IncomeStatus;
  name?: string;
  // S31 (item 5.5) — chat can realign a variable income: flip is_variable and
  // set/clear the min/max range (null clears). min/max must be > 0 when set.
  isVariable?: boolean;
  minExpectedAmount?: number | null;
  maxExpectedAmount?: number | null;
  destinationAccountId?: string | null;
}

export async function updateIncomeSourceFields(
  userId: string,
  id: string,
  patch: IncomeSourcePatch,
): Promise<boolean> {
  const row: Record<string, unknown> = {};
  if (patch.amount !== undefined) {
    if (!Number.isFinite(patch.amount) || patch.amount <= 0) return false;
    row.amount = patch.amount;
  }
  if (patch.currency !== undefined) row.currency = patch.currency;
  if (patch.frequency !== undefined) row.frequency = patch.frequency;
  if (patch.expectedDay !== undefined) row.expected_day = patch.expectedDay;
  if (patch.payAnchorDate !== undefined) row.pay_anchor_date = patch.payAnchorDate;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.name !== undefined && patch.name.trim()) row.name = patch.name.trim().slice(0, 120);
  if (patch.isVariable !== undefined) row.is_variable = patch.isVariable;
  if (patch.minExpectedAmount !== undefined) {
    if (patch.minExpectedAmount !== null && (!Number.isFinite(patch.minExpectedAmount) || patch.minExpectedAmount <= 0)) return false;
    row.min_expected_amount = patch.minExpectedAmount;
  }
  if (patch.maxExpectedAmount !== undefined) {
    if (patch.maxExpectedAmount !== null && (!Number.isFinite(patch.maxExpectedAmount) || patch.maxExpectedAmount <= 0)) return false;
    row.max_expected_amount = patch.maxExpectedAmount;
  }
  if (patch.destinationAccountId !== undefined) row.destination_account_id = patch.destinationAccountId;
  if (Object.keys(row).length === 0) return true;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("income_sources")
    .update(row)
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  return !error && (data?.length ?? 0) > 0;
}

export interface CreateIncomeSourceInput {
  name: string;
  amount: number;
  currency: string;
  frequency: IncomeFrequency;
  expectedDay?: number | null;
  payAnchorDate?: string | null;
  destinationAccountId?: string | null;
}

export async function createIncomeSource(
  userId: string,
  input: CreateIncomeSourceInput,
): Promise<{ id: string } | null> {
  if (!input.name.trim() || !Number.isFinite(input.amount) || input.amount <= 0) return null;
  const row: Record<string, unknown> = {
    user_id: userId,
    name: input.name.trim().slice(0, 120),
    amount: input.amount,
    currency: input.currency,
    frequency: input.frequency,
    expected_day: input.expectedDay ?? null,
    destination_account_id: input.destinationAccountId ?? null,
    status: "active",
  };
  // Only send pay_anchor_date when given, so the insert still works before
  // migration 032 adds the column.
  if (input.payAnchorDate) row.pay_anchor_date = input.payAnchorDate;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("income_sources")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: String((data as Row).id) };
}
