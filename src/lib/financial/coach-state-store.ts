import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// Operational coaching STATE (Stage 5): when each proactive signal was last
// surfaced (so Kipu doesn't repeat itself), and the user's engagement mode
// (pause / light / normal) + last weekly reconciliation. This is NOT financial
// truth — it only shapes how/when Kipu coaches.

export type EngagementMode = "normal" | "light" | "paused";

export interface EngagementState {
  mode: EngagementMode;
  pausedUntil: string | null;
  lastReconciledAt: string | null;
  /** IANA timezone the user set (null → LatAm default). Day boundaries for the
   *  Saldo ("hoy", tank walk) must be the USER's days, not the server's. */
  timezone: string | null;
}

// ── Nudge cooldown log ───────────────────────────────────────────────────────

// Returns a map of signalKind → last surfaced time (ms epoch).
export async function loadNudgeLog(userId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("coach_nudge_log")
      .select("signal_kind, last_surfaced_at")
      .eq("user_id", userId);
    for (const row of (data ?? []) as { signal_kind: string; last_surfaced_at: string }[]) {
      out.set(row.signal_kind, new Date(row.last_surfaced_at).getTime());
    }
  } catch {
    // best-effort
  }
  return out;
}

// Records that a signal was just surfaced to the user (upsert; never throws).
export async function recordNudgeSurfaced(
  userId: string,
  signalKind: string,
): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("coach_nudge_log")
      .upsert(
        { user_id: userId, signal_kind: signalKind, last_surfaced_at: new Date().toISOString() },
        { onConflict: "user_id,signal_kind" },
      );
  } catch {
    // best-effort: nudge continuity is non-critical
  }
}

// ── Engagement (pause / light / reconciliation) ──────────────────────────────

export async function loadEngagement(userId: string): Promise<EngagementState> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("user_engagement")
      .select("mode, paused_until, last_reconciled_at, timezone")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return { mode: "normal", pausedUntil: null, lastReconciledAt: null, timezone: null };
    const row = data as { mode: EngagementMode; paused_until: string | null; last_reconciled_at: string | null; timezone: string | null };
    // An expired pause silently reverts to normal.
    const expired = row.paused_until ? new Date(row.paused_until).getTime() < Date.now() : false;
    return {
      mode: row.mode === "paused" && expired ? "normal" : row.mode,
      pausedUntil: row.paused_until,
      lastReconciledAt: row.last_reconciled_at,
      timezone: row.timezone ?? null,
    };
  } catch {
    return { mode: "normal", pausedUntil: null, lastReconciledAt: null, timezone: null };
  }
}

export async function setEngagementMode(input: {
  userId: string;
  mode: EngagementMode;
  pausedUntil?: string | null;
}): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("user_engagement").upsert(
      {
        user_id: input.userId,
        mode: input.mode,
        paused_until: input.pausedUntil ?? null,
      },
      { onConflict: "user_id" },
    );
    return !error;
  } catch {
    return false;
  }
}

export async function markWeekReconciled(userId: string): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("user_engagement").upsert(
      { user_id: userId, last_reconciled_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    return !error;
  } catch {
    return false;
  }
}

// ── Margen Kipu commitments (savings / investment / essentials) ──────────────

export interface MargenCommitments {
  monthlySavings: number;
  monthlyInvestment: number;
  essentialMonthlyEstimate: number;
}

// The user's monthly saving/investing commitments + their essential-spending
// estimate (Stage 6). These are RESERVED before Kipu reports free spending
// money, so the user can spend their Margen Kipu knowing savings are protected.
// Columns are nullable (additive migration) → absent/NULL means 0.
/** A commitments read that reports on itself. See `money-read.ts`. */
export type MargenCommitmentsRead =
  | { ok: true; commitments: MargenCommitments }
  | { ok: false };

const EMPTY_COMMITMENTS: MargenCommitments = {
  monthlySavings: 0,
  monthlyInvestment: 0,
  essentialMonthlyEstimate: 0,
};

/** The MONEY read. `monthlySavings` and `monthlyInvestment` are SUBTRACTED from
 *  `monthlyTrulyFree`, which is the tank's refill rate and its ceiling — so reading
 *  zero when the read actually failed hands the user their own protected savings to
 *  spend, as a Saldo that looks perfectly normal. No shield downstream catches it:
 *  the two scalars go straight from here into the engine.
 *
 *  A MISSING ROW still means zero — the columns are nullable by an additive
 *  migration and "this person committed nothing" is a legitimate answer. What can no
 *  longer masquerade as that answer is a FAILED read. */
export async function readMargenCommitments(userId: string): Promise<MargenCommitmentsRead> {
  try {
    const supabase = createSupabaseAdminClient();
    // The `error` was never destructured here: PostgREST reports a failed query as
    // { data: null, error } WITHOUT throwing, so every failure arrived as "no row".
    const { data, error } = await supabase
      .from("user_financial_preferences")
      .select(
        "monthly_savings_commitment, monthly_investment_commitment, essential_monthly_estimate",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { ok: false };
    if (!data) return { ok: true, commitments: EMPTY_COMMITMENTS };
    const row = data as {
      monthly_savings_commitment: number | null;
      monthly_investment_commitment: number | null;
      essential_monthly_estimate: number | null;
    };
    return {
      ok: true,
      commitments: {
        monthlySavings: row.monthly_savings_commitment ?? 0,
        monthlyInvestment: row.monthly_investment_commitment ?? 0,
        essentialMonthlyEstimate: row.essential_monthly_estimate ?? 0,
      },
    };
  } catch {
    return { ok: false };
  }
}

/** DISPLAY ONLY — collapses a failed read into zeros. Named to make the misuse loud:
 *  never derive a money number from this. */
export async function loadMargenCommitmentsForDisplay(userId: string): Promise<MargenCommitments> {
  const read = await readMargenCommitments(userId);
  return read.ok ? read.commitments : EMPTY_COMMITMENTS;
}

export async function setMargenCommitments(input: {
  userId: string;
  monthlySavings?: number | null;
  monthlyInvestment?: number | null;
  essentialMonthlyEstimate?: number | null;
}): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const patch: Record<string, number | string | null> = { user_id: input.userId };
    if (input.monthlySavings !== undefined)
      patch.monthly_savings_commitment = input.monthlySavings;
    if (input.monthlyInvestment !== undefined)
      patch.monthly_investment_commitment = input.monthlyInvestment;
    if (input.essentialMonthlyEstimate !== undefined)
      patch.essential_monthly_estimate = input.essentialMonthlyEstimate;
    const { error } = await supabase
      .from("user_financial_preferences")
      .upsert(patch, { onConflict: "user_id" });
    return !error;
  } catch {
    return false;
  }
}
