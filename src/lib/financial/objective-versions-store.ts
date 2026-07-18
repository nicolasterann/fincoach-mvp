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
// Tres brazos (re-auditoría 2, punto 9): un scan TOPADO tampoco es historia —
// el orden es effective_month DESC, así que truncar corta justo la versión MÁS
// ANTIGUA, que es a la que resuelve todo mes pre-historia. El viejo `.limit(24)`
// sin CAP+1 la perdía en silencio con ok:true.
export type ObjectiveVersionsRead =
  | { ok: true; complete: true; rows: ObjectiveVersionRow[] }
  | { ok: true; complete: false; partial: ObjectiveVersionRow[] }
  | { ok: false; complete: false };

// Dos categorías con objetivo × una versión por mes ≈ 24 filas/año: 240 cubre una
// década. El punto no es el número sino la PRUEBA: se pide una más.
const VERSIONS_CAP = 240;

export async function loadObjectiveVersions(userId: string): Promise<ObjectiveVersionsRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("objective_versions")
      .select("category, effective_month, amount, currency, amount_base, base_currency")
      .eq("user_id", userId)
      .order("effective_month", { ascending: false })
      .limit(VERSIONS_CAP + 1);
    // A Supabase error returns {data:null,error} WITHOUT throwing. "No history"
    // and "couldn't read the history" are DIFFERENT facts in a financial source
    // of truth — never collapse them into [].
    if (error) return { ok: false, complete: false };
    const raw = (data ?? []) as {
      category: string; effective_month: string; amount: number | string; currency: string;
      amount_base: number | string | null; base_currency: string | null;
    }[];
    const capped = raw.length > VERSIONS_CAP;
    const rows = raw.slice(0, VERSIONS_CAP).map((r) => ({
      category: String(r.category),
      effectiveMonth: String(r.effective_month),
      amount: typeof r.amount === "number" ? r.amount : Number(r.amount),
      currency: String(r.currency),
      amountBase: r.amount_base == null ? null : (typeof r.amount_base === "number" ? r.amount_base : Number(r.amount_base)),
      baseCurrency: r.base_currency ? String(r.base_currency) : null,
    }));
    return capped ? { ok: true, complete: false, partial: rows } : { ok: true, complete: true, rows };
  } catch {
    return { ok: false, complete: false };
  }
}

// Carry BOTH valuations per version — the reader picks by the month it is
// RESOLVING, not by the row's own month. The same July row is the LIVE objective
// while July is current AND the FROZEN anchor once a past month falls back to
// it; deciding here (as the first cut did) chose before the question was known
// and let a rate move rewrite history.
//   · frozen = the equivalence recorded when the decision was made (immutable).
//   · live   = today's conversion, or null when no trusted rate exists (never a
//     fabricated 1:1 — the resolver then refuses rather than guessing).
export function versionsToBase(
  rows: ObjectiveVersionRow[],
  baseCurrency: string,
  rates: FxRate[],
): ObjectiveVersion[] {
  const baseUpper = baseCurrency.toUpperCase();
  return rows.map((r) => {
    const cur = (r.currency || baseUpper).trim().toUpperCase();
    let live: number | null;
    if (cur === baseUpper) {
      live = r.amount;
    } else {
      const res = convertFx(r.amount, cur, baseUpper, rates);
      live = res.ok ? res.baseAmount : null;
    }
    // A frozen value recorded against a DIFFERENT base (the user changed base
    // currency) can't be trusted as base today — drop it rather than mis-state.
    const frozen =
      r.amountBase != null && (r.baseCurrency ?? baseUpper).toUpperCase() === baseUpper
        ? r.amountBase
        : null;
    return { category: r.category, effectiveMonth: r.effectiveMonth, amountBaseFrozen: frozen, amountBaseLive: live };
  });
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
