import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { convert as convertFx, type FxRate } from "@/lib/fx/fx-rates";
import type { ObjectiveVersion } from "@/lib/financial/objectives";

// Stage H (fix P1-1) — the objective's per-month HISTORY (migration 052).
// budget_categories holds ONE current row per category, so without this table
// changing the objective rewrote the past: the engine's 40-day walk and the
// month close both re-read the CURRENT amount, so raising the objective in July
// erased June's excess (which had already drained the Saldo) and refilled the
// tank retroactively. Here one row per (user, category, effective_month) makes
// each month's objective immutable once the month is over: the objective IN
// EFFECT for a month is the version with the greatest effective_month <= it.
//
// A change writes a version for the CURRENT user-tz month only (upsert), so the
// user's latest decision governs the month they are in, and past months keep
// the number they actually decided back then.

export interface ObjectiveVersionRow {
  category: string;
  effectiveMonth: string; // "YYYY-MM"
  amount: number; // in `currency`
  currency: string;
}

// Recent versions (newest month first). A small window is enough: the engine
// only resolves the current month and the one inside the 40-day tank walk, and
// the close resolves the month just ended.
export async function loadObjectiveVersions(userId: string): Promise<ObjectiveVersionRow[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("objective_versions")
      .select("category, effective_month, amount, currency")
      .eq("user_id", userId)
      .order("effective_month", { ascending: false })
      .limit(24);
    if (error) return [];
    return ((data ?? []) as { category: string; effective_month: string; amount: number | string; currency: string }[]).map((r) => ({
      category: String(r.category),
      effectiveMonth: String(r.effective_month),
      amount: typeof r.amount === "number" ? r.amount : Number(r.amount),
      currency: String(r.currency),
    }));
  } catch {
    return [];
  }
}

// Re-value each version into BASE at the LIVE rate — the same doctrine
// budget_categories follows (a peso objective must never freeze at one day's
// rate). No known rate → the version is DROPPED rather than leaked as a native
// number into base math; the caller then falls back to the current amount
// (which the context builder already zeroes under the same rule).
export function versionsToBase(
  rows: ObjectiveVersionRow[],
  baseCurrency: string,
  rates: FxRate[],
): ObjectiveVersion[] {
  const baseUpper = baseCurrency.toUpperCase();
  const out: ObjectiveVersion[] = [];
  for (const r of rows) {
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

// Record the user's decision for the month they are IN. Idempotent per
// (user, category, month): a second change the same month replaces it (their
// latest decision for that month), and never touches a past month's row.
export async function upsertObjectiveVersion(input: {
  userId: string;
  category: string;
  effectiveMonth: string; // user-tz "YYYY-MM"
  amount: number;
  currency: string;
}): Promise<boolean> {
  if (!Number.isFinite(input.amount) || input.amount < 0) return false;
  if (!/^\d{4}-\d{2}$/.test(input.effectiveMonth)) return false;
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("objective_versions").upsert(
      {
        user_id: input.userId,
        category: input.category,
        effective_month: input.effectiveMonth,
        amount: input.amount,
        currency: input.currency,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,category,effective_month" },
    );
    return !error;
  } catch {
    return false;
  }
}
