import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { readFxRates } from "@/lib/fx/fx-store";
import { convert } from "@/lib/fx/fx-rates";
import { roundMoney } from "@/lib/financial/money";
import type { MoneyReadStatus } from "@/lib/financial/money-read";

// Stage G — Cuotas / LatAm installments store + PURE progress math.
// A plan's elapsed/remaining are DERIVED from first_statement_due at read time
// (a passed statement due date counts its installment as billed — the same
// silent-paid default the card cycle uses); nothing mutates counters monthly.
// Option A (founder-locked): the active monthly load reduces the RITMO; the
// purchase transaction (external_ref 'installment:<id>') never drains the tank.

export type InstallmentPlanStatus = "active" | "cancelled" | "paid_off";

export interface InstallmentPlanRecord {
  id: string;
  debtAccountId: string;
  description: string;
  totalOriginal: number;
  originalCurrency: string;
  totalBase: number;
  baseCurrency: string;
  installmentBase: number;
  monthsTotal: number;
  /** ISO date — due date of the statement that includes installment #1. */
  firstStatementDue: string;
  /** Interest surcharge included in the total (0 = sin interés). */
  surchargeBase: number;
  /** Real billing day-of-month (card due day) — anniversaries clamp to each
   *  month's length from THIS day, so a first due that landed in a short month
   *  (e.g. day 31 → Feb 28) doesn't freeze every later cuota a day early. */
  anniversaryDay: number | null;
  status: InstallmentPlanStatus;
  paidOffAt: string | null;
  category: string;
  notes: string | null;
}

export interface InstallmentProgress {
  /** Installments whose statement due date already passed (billed & assumed paid). */
  billed: number;
  /** Installments still to be billed (0 for cancelled/paid_off plans). */
  remaining: number;
  /** remaining × installment (base) — committed money still to leave. */
  pendingBase: number;
  /** Pending money BEYOND the next statement — what the current-statement
   *  estimate must NOT include (running balance minus this ≈ this statement). */
  deferredBeyondCurrentBase: number;
  /** Due date (ISO) of the next installment's statement; null when done. */
  nextDueISO: string | null;
  /** The plan's monthly hit on the ritmo while active (0 when done). */
  monthlyLoadBase: number;
}

function addMonthsClamped(iso: string, months: number, dayOverride?: number | null): Date {
  const [y, m, dRaw] = iso.slice(0, 10).split("-").map(Number);
  const d = dayOverride ?? dRaw;
  const ty = y + Math.floor((m - 1 + months) / 12);
  const tm = (m - 1 + months) % 12;
  const daysInMonth = new Date(ty, tm + 1, 0).getDate();
  return new Date(ty, tm, Math.min(d, daysInMonth));
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function installmentProgress(plan: InstallmentPlanRecord, now: Date): InstallmentProgress {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (plan.status !== "active") {
    return { billed: plan.monthsTotal, remaining: 0, pendingBase: 0, deferredBeyondCurrentBase: 0, nextDueISO: null, monthlyLoadBase: 0 };
  }
  let billed = 0;
  for (let k = 0; k < plan.monthsTotal; k++) {
    if (addMonthsClamped(plan.firstStatementDue, k, plan.anniversaryDay).getTime() < today.getTime()) billed += 1;
    else break;
  }
  const remaining = Math.max(0, plan.monthsTotal - billed);
  const nextDueISO = remaining > 0 ? isoOf(addMonthsClamped(plan.firstStatementDue, billed, plan.anniversaryDay)) : null;
  // The LAST cuota absorbs the rounding residual (1000/60 → 59×16.67 + 16.47),
  // so pending/deferred always reconcile with the total the ledger booked.
  const pendingBase = remaining > 0 ? roundMoney(Math.min(plan.totalBase, Math.max(0, plan.totalBase - plan.installmentBase * billed))) : 0;
  const nextCuotaBase = remaining > 1 ? plan.installmentBase : pendingBase;
  return {
    billed,
    remaining,
    pendingBase,
    deferredBeyondCurrentBase: roundMoney(Math.max(0, pendingBase - nextCuotaBase)),
    nextDueISO,
    monthlyLoadBase: remaining > 0 ? plan.installmentBase : 0,
  };
}

/** Σ active plans' monthly installment — the temporary fixed outflow that
 *  lowers the ritmo (Option A) while the plans run. */
export function monthlyInstallmentLoad(plans: InstallmentPlanRecord[], now: Date): number {
  return roundMoney(plans.reduce((t, p) => t + installmentProgress(p, now).monthlyLoadBase, 0));
}

/** Per-card pending money BEYOND the next statement — the card-cycle estimate
 *  subtracts this so a 12-cuota purchase never inflates THIS month's statement.
 *  When the card's pending-statement DUE DATE is provided (nextDueByCard), only
 *  cuotas due ON OR BEFORE it stay in the estimate — a plan whose first cuota
 *  bills a cycle later defers its FULL pending money (no phantom cuota in the
 *  already-closed statement). Without a date, the conservative one-cuota
 *  heuristic applies (exactly the pre-map behavior). */
export function deferredByCard(
  plans: InstallmentPlanRecord[],
  now: Date,
  nextDueByCard?: Map<string, string | null>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of plans) {
    const pr = installmentProgress(p, now);
    let d = pr.deferredBeyondCurrentBase;
    const statementDue = nextDueByCard?.get(p.debtAccountId);
    if (statementDue && pr.remaining > 0) {
      let inStatement = 0;
      for (let k = 0; k < pr.remaining; k++) {
        if (isoOf(addMonthsClamped(p.firstStatementDue, pr.billed + k, p.anniversaryDay)) <= statementDue) inStatement += 1;
        else break;
      }
      d = inStatement >= pr.remaining ? 0 : roundMoney(Math.max(0, pr.pendingBase - p.installmentBase * inStatement));
    }
    if (d > 0) out.set(p.debtAccountId, roundMoney((out.get(p.debtAccountId) ?? 0) + d));
  }
  return out;
}

/** Per-card Σ monthly installment load — lets the capacity NET a card's declared
 *  pago mínimo against its cuotas (LatAm mínimos usually already include them). */
export function monthlyLoadByCard(plans: InstallmentPlanRecord[], now: Date): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of plans) {
    const load = installmentProgress(p, now).monthlyLoadBase;
    if (load > 0) out.set(p.debtAccountId, roundMoney((out.get(p.debtAccountId) ?? 0) + load));
  }
  return out;
}

// ── Persistence ────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  debt_account_id: string;
  description: string;
  total_original: number | string;
  original_currency: string;
  total_base: number | string;
  base_currency: string;
  installment_base: number | string;
  months_total: number;
  first_statement_due: string;
  surcharge_base: number | string;
  anniversary_day: number | null;
  status: string;
  paid_off_at: string | null;
  category: string;
  notes: string | null;
}

const SELECT_COLS =
  "id, debt_account_id, description, total_original, original_currency, total_base, base_currency, installment_base, months_total, first_statement_due, surcharge_base, anniversary_day, status, paid_off_at, category, notes";

function mapRow(r: Row): InstallmentPlanRecord {
  return {
    id: r.id,
    debtAccountId: r.debt_account_id,
    description: r.description,
    totalOriginal: Number(r.total_original) || 0,
    originalCurrency: (r.original_currency || "USD").toUpperCase(),
    totalBase: Number(r.total_base) || 0,
    baseCurrency: (r.base_currency || "USD").toUpperCase(),
    installmentBase: Number(r.installment_base) || 0,
    monthsTotal: Number(r.months_total) || 1,
    firstStatementDue: r.first_statement_due,
    surchargeBase: Number(r.surcharge_base) || 0,
    anniversaryDay: r.anniversary_day == null ? null : Number(r.anniversary_day),
    status: r.status === "cancelled" || r.status === "paid_off" ? r.status : "active",
    paidOffAt: r.paid_off_at,
    category: r.category || "shopping",
    notes: r.notes,
  };
}

// FX — re-value foreign-currency plans at the LIVE rate (same doctrine as
// savings plans): the native figures are the truth; base re-expresses live.
//
// Reports whether it could value EVERYTHING. A plan left at its stored base because
// the rate could not be read is a stale number sitting next to live ones — plausible,
// and wrong by however much the rate moved. This function's own comment already
// forbade that for the interest figure; now the caller can act on it.
async function revalueAtLiveRate(
  userId: string,
  records: InstallmentPlanRecord[],
): Promise<{ complete: boolean; records: InstallmentPlanRecord[] }> {
  if (!records.some((r) => r.originalCurrency !== r.baseCurrency)) {
    return { complete: true, records };
  }
  // Una lectura de tasas FALLIDA no es "este usuario no tiene tasas": dejaría cada
  // plan en su base vieja, un número plausible y equivocado al lado de cifras vivas.
  const fxRead = await readFxRates(userId);
  if (!fxRead.ok || !fxRead.complete) return { complete: false, records };
  const rates = fxRead.rates;
  let complete = true;
  const revalued = records.map((r) => {
    if (r.originalCurrency === r.baseCurrency) return r;
    const res = convert(r.totalOriginal, r.originalCurrency, r.baseCurrency, rates);
    if (!res.ok) {
      complete = false;
      return r;
    }
    const totalBase = res.baseAmount;
    return {
      ...r,
      totalBase,
      installmentBase: roundMoney(totalBase / r.monthsTotal),
      // The interest figure re-expresses at the SAME live rate (never a stale
      // base sitting next to live figures).
      surchargeBase: r.totalBase > 0 ? roundMoney((r.surchargeBase / r.totalBase) * totalBase) : r.surchargeBase,
    };
  });
  return { complete, records: revalued };
}

/** An active-plans read that reports on itself. See `money-read.ts` for why. */
export type InstallmentPlansRead = MoneyReadStatus & { plans: InstallmentPlanRecord[] };

// Nobody has 50 active plans; the cap is a sanity bound. But "I saw 50" and "there
// are 50" must not be the same sentence, so ask for one more than we accept and let
// the extra row prove there is a tail we did not see.
const PLANS_CAP = 50;

/** The reading, injected — same seam as the money feed's `readMoneyTxnFeed`, so the
 *  paths that matter (a failed query, a cap hit, an unvaluable plan) are exercised
 *  for real instead of by a fixture. */
export type InstallmentPlansDeps = {
  fetchRows: (limit: number) => Promise<{ rows: unknown[] | null; failed: boolean }>;
  revalue: (records: InstallmentPlanRecord[]) => Promise<{ complete: boolean; records: InstallmentPlanRecord[] }>;
};

/** All of the read's reliability logic. Money refuses; display degrades. */
export async function readInstallmentPlansWith(deps: InstallmentPlansDeps): Promise<InstallmentPlansRead> {
  try {
    const page = await deps.fetchRows(PLANS_CAP + 1);
    if (page.failed || !page.rows) return { ok: false, complete: false, plans: [] };
    const rows = page.rows as Row[];
    // Asked for CAP+1: the extra row is the proof that a tail exists.
    const capped = rows.length > PLANS_CAP;
    const valued = await deps.revalue(rows.slice(0, PLANS_CAP).map(mapRow));
    // Nothing failed, but a capped list or an unvaluable plan cannot be published:
    // both understate the cuota load, and understating it INFLATES the Saldo.
    return { ok: true, complete: !capped && valued.complete, plans: valued.records };
  } catch {
    return { ok: false, complete: false, plans: [] };
  }
}

/** The MONEY read: the cuota load lowers `monthlyTrulyFree`, and `monthlyTrulyFree`
 *  IS the tank's refill rate and its ceiling. Reading `[]` when the read actually
 *  failed told the engine "this person owes nothing in cuotas", which refills the
 *  tank faster AND raises `cap = fillDaily × 10`. The same `[]` zeroes the deferred
 *  money and inflates the card-statement estimate — one failed read moving two
 *  numbers in OPPOSITE directions. */
export async function readActiveInstallmentPlans(userId: string): Promise<InstallmentPlansRead> {
  return readInstallmentPlansWith({
    fetchRows: async (limit) => {
      try {
        const sb = createSupabaseAdminClient();
        // PostgREST reports a failed query as { data: null, error } WITHOUT throwing.
        const { data, error } = await sb
          .from("installment_plans")
          .select(SELECT_COLS)
          .eq("user_id", userId)
          .eq("status", "active")
          .order("created_at", { ascending: true })
          .limit(limit);
        return { rows: data ?? null, failed: !!error };
      } catch {
        return { rows: null, failed: true };
      }
    },
    revalue: (records) => revalueAtLiveRate(userId, records),
  });
}

/** DISPLAY ONLY — collapses a failed read into an empty list. Named to make the
 *  misuse loud: never derive a money number from this. Use
 *  `readActiveInstallmentPlans` and honour its verdict instead. */
export async function loadActiveInstallmentPlansForDisplay(userId: string): Promise<InstallmentPlanRecord[]> {
  return (await readActiveInstallmentPlans(userId)).plans;
}

export interface CreateInstallmentPlanInput {
  userId: string;
  debtAccountId: string;
  description: string;
  totalOriginal: number;
  originalCurrency: string;
  totalBase: number;
  baseCurrency: string;
  monthsTotal: number;
  firstStatementDue: string; // ISO
  surchargeBase?: number;
  /** Real billing day-of-month (card due day / day of the user-stated date). */
  anniversaryDay?: number | null;
  category?: string;
  notes?: string | null;
}

export async function createInstallmentPlan(input: CreateInstallmentPlanInput): Promise<InstallmentPlanRecord | null> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from("installment_plans")
      .insert({
        user_id: input.userId,
        debt_account_id: input.debtAccountId,
        description: input.description.slice(0, 200),
        total_original: input.totalOriginal,
        original_currency: input.originalCurrency.toUpperCase(),
        total_base: input.totalBase,
        base_currency: input.baseCurrency.toUpperCase(),
        installment_base: roundMoney(input.totalBase / input.monthsTotal),
        months_total: input.monthsTotal,
        first_statement_due: input.firstStatementDue,
        surcharge_base: Math.max(0, input.surchargeBase ?? 0),
        anniversary_day: input.anniversaryDay ?? null,
        category: input.category ?? "shopping",
        notes: input.notes ?? null,
      })
      .select(SELECT_COLS)
      .single();
    if (error || !data) return null;
    return mapRow(data as Row);
  } catch {
    return null;
  }
}

/** Cancel (product returned → the pending debt is reversed separately) or
 *  early-payoff (user paid the remaining installments at once). */
export async function closeInstallmentPlan(input: {
  userId: string;
  planId: string;
  mode: "cancelled" | "paid_off";
  when?: Date;
}): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { error, count } = await sb
      .from("installment_plans")
      .update({
        status: input.mode,
        paid_off_at: input.mode === "paid_off" ? (input.when ?? new Date()).toISOString().slice(0, 10) : null,
      }, { count: "exact" })
      .eq("id", input.planId)
      .eq("user_id", input.userId)
      .eq("status", "active");
    return !error && (count ?? 0) > 0;
  } catch {
    return false;
  }
}
