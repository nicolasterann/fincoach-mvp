import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { convert as convertFx, type FxRate } from "@/lib/fx/fx-rates";
import type { ObjectiveVersion } from "@/lib/financial/objectives";

// Stage H (fix P1-1) — the objective's per-month HISTORY (migrations 052-053).
// budget_categories holds ONE current row per category, so without this table
// changing the objective rewrote the past: the engine's 40-day walk and the
// month close both re-read the CURRENT amount, so raising the objective in July
// erased June's excess (which had already drained the Saldo) and refilled the
// tank retroactively. Here one row per (user, category, effective_month) makes
// each month's objective immutable once the month is over: the objective IN
// EFFECT for a month is the version with the greatest effective_month <= it.
//
// A change writes a version for the CURRENT user-tz month only, so the user's
// latest decision governs the month they are in, and past months keep the
// number they actually decided back then.

export interface ObjectiveVersionRow {
  category: string;
  effectiveMonth: string; // "YYYY-MM"
  amount: number; // in `currency`
  currency: string;
  // The base-currency equivalence FROZEN when the decision was made (053).
  // null on pre-053 rows → the reader falls back to live conversion.
  amountBase: number | null;
  baseCurrency: string | null;
}

// A read either SUCCEEDS (rows, possibly empty = genuinely no history) or
// FAILS. The engine must tell those apart: on a transient DB failure it must
// NOT fall back to the current mutable amount for past months — that would
// recompute history against today's objective and make the user's Saldo jump.
export interface ObjectiveVersionsRead {
  ok: boolean;
  rows: ObjectiveVersionRow[];
}

export async function loadObjectiveVersions(userId: string): Promise<ObjectiveVersionsRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("objective_versions")
      .select("category, effective_month, amount, currency, amount_base, base_currency")
      .eq("user_id", userId)
      .order("effective_month", { ascending: false })
      .limit(24);
    // A Supabase error returns {data:null,error} WITHOUT throwing. "No history"
    // and "couldn't read the history" are DIFFERENT facts in a financial source
    // of truth — never collapse them into [].
    if (error) return { ok: false, rows: [] };
    return {
      ok: true,
      rows: ((data ?? []) as {
        category: string; effective_month: string; amount: number | string; currency: string;
        amount_base: number | string | null; base_currency: string | null;
      }[]).map((r) => ({
        category: String(r.category),
        effectiveMonth: String(r.effective_month),
        amount: typeof r.amount === "number" ? r.amount : Number(r.amount),
        currency: String(r.currency),
        amountBase: r.amount_base == null ? null : (typeof r.amount_base === "number" ? r.amount_base : Number(r.amount_base)),
        baseCurrency: r.base_currency ? String(r.base_currency) : null,
      })),
    };
  } catch {
    return { ok: false, rows: [] };
  }
}

// Value each version in BASE. Two regimes, deliberately:
//   · CURRENT month  → LIVE rate. The objective is a decision the user is living
//     right now; a peso objective must not freeze at one day's rate while the
//     base-denominated reserve/Saldo track it (same doctrine as budget_categories).
//   · PAST months    → the FROZEN equivalence recorded when it was decided. A
//     rate move must NEVER create or erase historical excess: transactions keep
//     their own historical base_amount, so the objective they were compared
//     against has to be equally immutable.
// A past row with no frozen value (pre-053) falls back to live — the only case
// where FX can still touch history, and it disappears as those rows age out.
export function versionsToBase(
  rows: ObjectiveVersionRow[],
  baseCurrency: string,
  rates: FxRate[],
  currentMonthISO: string,
): ObjectiveVersion[] {
  const baseUpper = baseCurrency.toUpperCase();
  const out: ObjectiveVersion[] = [];
  for (const r of rows) {
    const isCurrent = r.effectiveMonth === currentMonthISO;
    if (!isCurrent && r.amountBase != null && (r.baseCurrency ?? baseUpper).toUpperCase() === baseUpper) {
      out.push({ category: r.category, effectiveMonth: r.effectiveMonth, amountBase: r.amountBase });
      continue;
    }
    const cur = (r.currency || baseUpper).trim().toUpperCase();
    if (cur === baseUpper) {
      out.push({ category: r.category, effectiveMonth: r.effectiveMonth, amountBase: r.amount });
      continue;
    }
    const res = convertFx(r.amount, cur, baseUpper, rates);
    if (res.ok) out.push({ category: r.category, effectiveMonth: r.effectiveMonth, amountBase: res.baseAmount });
  }
  return out;
}

// Set the objective ATOMICALLY: the current pointer (budget_categories) and the
// month's immutable version land in ONE transaction, or neither does (053 RPC).
// Two separate writes could change the objective while silently losing its
// history — and the caller would still tell the user it worked.
// `effectiveMonth` omitted → only the budget pointer moves (non-objective
// categories keep exactly the old behavior).
export async function upsertBudgetObjective(input: {
  userId: string;
  category: string;
  amount: number; // in `currency`
  currency: string;
  effectiveMonth?: string | null; // user-tz "YYYY-MM"
  amountBase?: number | null; // frozen base equivalence at decision time
  baseCurrency?: string | null;
}): Promise<boolean> {
  if (!Number.isFinite(input.amount) || input.amount < 0) return false;
  if (input.effectiveMonth && !/^\d{4}-\d{2}$/.test(input.effectiveMonth)) return false;
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.rpc("kipu_upsert_budget_objective", {
      p: {
        user_id: input.userId,
        category: input.category,
        amount: input.amount,
        currency: input.currency,
        effective_month: input.effectiveMonth ?? null,
        amount_base: input.amountBase ?? null,
        base_currency: input.baseCurrency ?? null,
      },
    });
    return !error;
  } catch {
    return false;
  }
}
