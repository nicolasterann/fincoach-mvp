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
      .select("mode, paused_until, last_reconciled_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return { mode: "normal", pausedUntil: null, lastReconciledAt: null };
    const row = data as { mode: EngagementMode; paused_until: string | null; last_reconciled_at: string | null };
    // An expired pause silently reverts to normal.
    const expired = row.paused_until ? new Date(row.paused_until).getTime() < Date.now() : false;
    return {
      mode: row.mode === "paused" && expired ? "normal" : row.mode,
      pausedUntil: row.paused_until,
      lastReconciledAt: row.last_reconciled_at,
    };
  } catch {
    return { mode: "normal", pausedUntil: null, lastReconciledAt: null };
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
