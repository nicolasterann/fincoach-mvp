import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadFxRates } from "@/lib/fx/fx-store";
import { convert } from "@/lib/fx/fx-rates";
import type { CurrencyCode, PaymentFrequency } from "@/types/financial";
import type { SavingsPlanCalendarInput } from "@/lib/financial/financial-calendar";

// Stage 38 — typed writer/reader for `savings_plans` (migration 040). A savings plan
// is the account-linked, scheduled version of an onboarding reserve: ahorro/inversión
// with its own cadence + day + destination, so the financial calendar reserves it on
// its real date exactly like a debt payment. This is NOT the transaction ledger — it
// describes a FUTURE recurring reservation. When the money actually moves, the ledger
// write still goes through the single transaction writer; this module only persists
// the plan. Every read/write is scoped to the user (RLS + explicit user_id filter).

const WEEKS_PER_MONTH = 30 / 7; // matches margen-kipu's monthly-equivalent

export type SavingsPlanKind = "savings" | "investment";
export type SavingsPlanStatus = "active" | "paused" | "cancelled";

// The DB check constraint only allows these four cadences; `custom` (and anything
// unknown) collapses to monthly so an insert never fails on the constraint.
function normalizeFrequency(freq: PaymentFrequency | string | null | undefined): PaymentFrequency {
  return freq === "weekly" || freq === "biweekly" || freq === "yearly" ? freq : "monthly";
}

function normalizeKind(kind: string | null | undefined): SavingsPlanKind {
  return kind === "investment" ? "investment" : "savings";
}

function clampDay(day: number | null | undefined): number | null {
  if (day == null || !Number.isFinite(day)) return null;
  return Math.min(31, Math.max(1, Math.round(day)));
}

function normalizeAnchor(date: string | null | undefined): string | null {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

// Monthly-equivalent of a per-occurrence amount at a cadence (base currency). Mirrors
// margen-kipu's monthlyEquivalent so the summed scalar commitment and the per-plan
// calendar events describe the same money.
export function planMonthlyEquivalent(amountBase: number, frequency: PaymentFrequency | string): number {
  if (!(amountBase > 0)) return 0;
  switch (normalizeFrequency(frequency)) {
    case "weekly":
      return amountBase * WEEKS_PER_MONTH;
    case "biweekly":
      return amountBase * (WEEKS_PER_MONTH / 2);
    case "yearly":
      return amountBase / 12;
    case "monthly":
    default:
      return amountBase;
  }
}

export interface SavingsPlanRecord {
  id: string;
  kind: SavingsPlanKind;
  name: string | null;
  amountBase: number;
  originalAmount: number | null;
  originalCurrency: string | null;
  baseCurrency: string;
  frequency: PaymentFrequency;
  expectedDay: number | null;
  payAnchorDate: string | null;
  destinationAccountId: string | null;
  destinationAssetId: string | null;
  /** Stage F — funding cash account (where the reserve leaves from). */
  sourceAccountId: string | null;
  status: SavingsPlanStatus;
  notes: string | null;
}

interface SavingsPlanRow {
  id: string;
  kind: string;
  name: string | null;
  amount_base: number | string;
  original_amount: number | string | null;
  original_currency: string | null;
  base_currency: string;
  frequency: string;
  expected_day: number | null;
  pay_anchor_date: string | null;
  destination_account_id: string | null;
  destination_asset_id: string | null;
  source_account_id: string | null;
  status: string;
  notes: string | null;
}

function mapRow(row: SavingsPlanRow): SavingsPlanRecord {
  return {
    id: row.id,
    kind: normalizeKind(row.kind),
    name: row.name,
    amountBase: Number(row.amount_base) || 0,
    originalAmount: row.original_amount == null ? null : Number(row.original_amount),
    originalCurrency: row.original_currency,
    baseCurrency: row.base_currency || "USD",
    frequency: normalizeFrequency(row.frequency),
    expectedDay: row.expected_day == null ? null : Number(row.expected_day),
    payAnchorDate: row.pay_anchor_date,
    destinationAccountId: row.destination_account_id,
    destinationAssetId: row.destination_asset_id,
    sourceAccountId: row.source_account_id ?? null,
    status: row.status === "paused" || row.status === "cancelled" ? row.status : "active",
    notes: row.notes,
  };
}

const SELECT_COLS =
  "id, kind, name, amount_base, original_amount, original_currency, base_currency, frequency, expected_day, pay_anchor_date, destination_account_id, destination_asset_id, source_account_id, status, notes";

// FX — re-value each foreign-currency reserve's amountBase at the LIVE rate (the reserve
// reserves this amount in the plan/calendar). The native figure is originalAmount; base
// currency / no rate → keep the stored base. One rates load per call.
async function revalueAtLiveRate(userId: string, records: SavingsPlanRecord[]): Promise<SavingsPlanRecord[]> {
  if (!records.some((r) => r.originalAmount != null && r.originalCurrency && r.originalCurrency.toUpperCase() !== r.baseCurrency.toUpperCase())) {
    return records; // nothing foreign → no rates load
  }
  let rates: Awaited<ReturnType<typeof loadFxRates>> = [];
  try {
    rates = await loadFxRates(userId);
  } catch {
    return records;
  }
  return records.map((r) => {
    if (r.originalAmount == null || !r.originalCurrency) return r;
    const from = r.originalCurrency.toUpperCase();
    if (from === r.baseCurrency.toUpperCase()) return r;
    const res = convert(r.originalAmount, from, r.baseCurrency, rates);
    return res.ok ? { ...r, amountBase: res.baseAmount } : r;
  });
}

export interface CreateSavingsPlanInput {
  userId: string;
  kind: SavingsPlanKind;
  name?: string | null;
  amountBase: number;
  originalAmount?: number | null;
  originalCurrency?: CurrencyCode | string | null;
  baseCurrency: CurrencyCode | string;
  frequency: PaymentFrequency | string;
  expectedDay?: number | null;
  payAnchorDate?: string | null;
  destinationAccountId?: string | null;
  destinationAssetId?: string | null;
  sourceAccountId?: string | null; // funding cash account (investment reserve → asset transfer)
  notes?: string | null;
}

function toInsertRow(input: CreateSavingsPlanInput): Record<string, unknown> {
  return {
    user_id: input.userId,
    kind: normalizeKind(input.kind),
    name: input.name?.trim() ? input.name.trim().slice(0, 120) : null,
    amount_base: Math.max(0, Math.round((input.amountBase || 0) * 100) / 100),
    original_amount:
      input.originalAmount != null && input.originalAmount >= 0
        ? Math.round(input.originalAmount * 100) / 100
        : null,
    original_currency: input.originalCurrency ? String(input.originalCurrency).toUpperCase().slice(0, 8) : null,
    base_currency: String(input.baseCurrency || "USD").toUpperCase().slice(0, 8),
    frequency: normalizeFrequency(input.frequency),
    expected_day: clampDay(input.expectedDay),
    pay_anchor_date: normalizeAnchor(input.payAnchorDate),
    destination_account_id: input.destinationAccountId ?? null,
    destination_asset_id: input.destinationAssetId ?? null,
    source_account_id: input.sourceAccountId ?? null,
    status: "active",
    notes: input.notes?.trim() ? input.notes.trim().slice(0, 500) : null,
  };
}

export async function createSavingsPlan(
  input: CreateSavingsPlanInput,
): Promise<{ id: string } | null> {
  if (!(input.amountBase > 0)) return null;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("savings_plans")
      .insert(toInsertRow(input))
      .select("id")
      .single();
    if (error || !data) return null;
    return { id: data.id as string };
  } catch {
    return null;
  }
}

// Batch insert used by the onboarding save. Best-effort per the onboarding contract
// (a reserve failing to persist must not strand the user); returns how many landed.
export async function insertSavingsPlansForUser(
  inputs: CreateSavingsPlanInput[],
): Promise<{ inserted: number; error: string | null }> {
  const rows = inputs.filter((i) => i.amountBase > 0).map(toInsertRow);
  if (rows.length === 0) return { inserted: 0, error: null };
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.from("savings_plans").insert(rows).select("id");
    if (error) return { inserted: 0, error: error.message };
    return { inserted: data?.length ?? 0, error: null };
  } catch (e) {
    return { inserted: 0, error: e instanceof Error ? e.message : "unknown" };
  }
}

// Active plans only — paused/cancelled plans reserve nothing. Used to hydrate the
// financial calendar and coach context.
export async function loadActiveSavingsPlans(userId: string): Promise<SavingsPlanRecord[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("savings_plans")
      .select(SELECT_COLS)
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return revalueAtLiveRate(userId, (data as SavingsPlanRow[]).map(mapRow));
  } catch {
    return [];
  }
}

// All plans (any status) for the agent to list / edit.
export async function loadAllSavingsPlans(userId: string): Promise<SavingsPlanRecord[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("savings_plans")
      .select(SELECT_COLS)
      .eq("user_id", userId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return revalueAtLiveRate(userId, (data as SavingsPlanRow[]).map(mapRow));
  } catch {
    return [];
  }
}

// Map an active plan record to the calendar's per-plan input (base, per occurrence).
export function toCalendarPlan(rec: SavingsPlanRecord): SavingsPlanCalendarInput {
  return {
    id: rec.id,
    kind: rec.kind,
    amount: rec.amountBase,
    frequency: rec.frequency,
    expectedDay: rec.expectedDay,
    payAnchorDate: rec.payAnchorDate,
    sourceAccountId: rec.sourceAccountId ?? null,
    label:
      rec.name || (rec.kind === "investment" ? "Inversión del mes" : "Ahorro del mes"),
  };
}

// Sum of active plans' monthly-equivalents by kind (base). This is the SINGLE source
// the aggregate user_financial_preferences commitment columns are derived from, so the
// scalar capacity math and the per-plan calendar never double-count.
export function sumActivePlansMonthly(plans: SavingsPlanRecord[]): {
  monthlySavings: number;
  monthlyInvestment: number;
} {
  let monthlySavings = 0;
  let monthlyInvestment = 0;
  for (const p of plans) {
    if (p.status !== "active") continue;
    const monthly = planMonthlyEquivalent(p.amountBase, p.frequency);
    if (p.kind === "investment") monthlyInvestment += monthly;
    else monthlySavings += monthly;
  }
  return {
    monthlySavings: Math.round(monthlySavings * 100) / 100,
    monthlyInvestment: Math.round(monthlyInvestment * 100) / 100,
  };
}

// Edit a plan's fields (amount / cadence / day / destination / status / notes). Never
// changes currency (that would silently re-denominate). `.select()` confirms a row
// matched (user + id), so a stale id reads as failure — Kipu never claims a change
// that didn't land. When amountBase changes, the caller must also refresh the summed
// aggregate commitments so capacity stays consistent.
export async function updateSavingsPlanFields(input: {
  userId: string;
  id: string;
  amountBase?: number;
  frequency?: PaymentFrequency | string;
  expectedDay?: number | null;
  payAnchorDate?: string | null;
  destinationAccountId?: string | null;
  destinationAssetId?: string | null;
  status?: SavingsPlanStatus;
  notes?: string | null;
}): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  if (input.amountBase !== undefined && input.amountBase >= 0) {
    patch.amount_base = Math.round(input.amountBase * 100) / 100;
  }
  if (input.frequency !== undefined) patch.frequency = normalizeFrequency(input.frequency);
  if (input.expectedDay !== undefined) patch.expected_day = clampDay(input.expectedDay);
  if (input.payAnchorDate !== undefined) patch.pay_anchor_date = normalizeAnchor(input.payAnchorDate);
  if (input.destinationAccountId !== undefined) patch.destination_account_id = input.destinationAccountId;
  if (input.destinationAssetId !== undefined) patch.destination_asset_id = input.destinationAssetId;
  if (input.status !== undefined) patch.status = input.status;
  if (input.notes !== undefined) {
    patch.notes = input.notes?.trim() ? input.notes.trim().slice(0, 500) : null;
  }
  if (Object.keys(patch).length === 0) return false;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("savings_plans")
      .update(patch)
      .eq("id", input.id)
      .eq("user_id", input.userId)
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// Pause / resume / cancel a plan (soft — the row is kept for history, mirroring how
// fixed expenses soft-delete via is_active). Cancelling stops the reservation without
// hard-deleting a financial planning row.
export async function setSavingsPlanStatus(input: {
  userId: string;
  id: string;
  status: SavingsPlanStatus;
}): Promise<boolean> {
  return updateSavingsPlanFields({ userId: input.userId, id: input.id, status: input.status });
}
