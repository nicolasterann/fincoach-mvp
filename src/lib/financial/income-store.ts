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
  // S7 — occasional/windfall income (excluded from the recurring monthly plan).
  isOccasional: boolean;
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
    isOccasional: r.is_occasional === true,
    minExpectedAmount: r.min_expected_amount == null ? null : Number(r.min_expected_amount),
    maxExpectedAmount: r.max_expected_amount == null ? null : Number(r.max_expected_amount),
    destinationAccountId: r.destination_account_id == null ? null : String(r.destination_account_id),
  };
}

/** An income read that reports on itself. See `money-read.ts`. */
export type IncomeSourcesRead =
  | { ok: true; complete: true; sources: IncomeSource[] }
  | { ok: true; complete: false; partial: IncomeSource[] }
  | { ok: false; complete: false };

// Nadie registra 50 ingresos; el tope es una cota de cordura. Pero "vi todos" y "hay
// estos" no pueden ser la misma frase: se pide uno más y la fila extra prueba la cola.
const INCOME_CAP = 50;

/** The MONEY read. El ingreso es la RAÍZ de `monthlyTrulyFree`, y de ahí sale el
 *  tanque entero: una lista vacía no dice "no gana nada", dice "no hay contra qué
 *  contrastar". Por eso el guard de duplicado de `create_income` la lee — y un guard
 *  que no pudo leer no puede autorizar: si un fallo llegara como [], el sueldo se
 *  crearía DOS veces y el tanque se llenaría al doble. */
export async function readIncomeSources(userId: string): Promise<IncomeSourcesRead> {
  try {
    const supabase = createSupabaseAdminClient();
    // `*` so pay_anchor_date (migration 032) loads when present and degrades
    // gracefully (absent → null) before the DDL is applied.
    const { data, error } = await supabase
      .from("income_sources")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(INCOME_CAP + 1);
    if (error || !data) return { ok: false, complete: false };
    const capped = data.length > INCOME_CAP;
    const sources = (data.slice(0, INCOME_CAP) as Row[]).map(mapRow);
    return capped ? { ok: true, complete: false, partial: sources } : { ok: true, complete: true, sources };
  } catch {
    return { ok: false, complete: false };
  }
}

/** DISPLAY / best-effort ONLY — colapsa un fallo en "no tiene ingresos". Nombrado así
 *  para que el mal uso se vea: en un camino de dinero usa `readIncomeSources` y honra
 *  su veredicto. */
export async function loadIncomeSourcesForDisplay(userId: string): Promise<IncomeSource[]> {
  const read = await readIncomeSources(userId);
  return read.ok ? (read.complete ? read.sources : read.partial) : [];
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
  isOccasional?: boolean;
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
  if (patch.isOccasional !== undefined) row.is_occasional = patch.isOccasional;
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
  isOccasional?: boolean;
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
    is_occasional: Boolean(input.isOccasional),
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
