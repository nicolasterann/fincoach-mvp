import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { SnapshotMetrics } from "@/lib/trends/trend";

// Stage 20 (micro-stage G) — daily snapshot persistence (migration 030). Service-role,
// graceful (production unchanged until applied). One row per user per day (idempotent
// upsert), so re-builds within a day don't multiply rows and trends stay day-over-day.

function dayBucket(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export async function writeDailySnapshot(userId: string, m: SnapshotMetrics, baseCurrency: string, nowMs: number): Promise<void> {
  try {
    const sb = createSupabaseAdminClient();
    await sb.from("daily_financial_snapshots").upsert(
      { user_id: userId, snapshot_date: dayBucket(nowMs), margen_weekly: m.margenWeekly, safe_weekly: m.safeWeekly, net_worth: m.netWorth, total_debt: m.totalDebt, readiness: Math.round(m.readiness), base_currency: baseCurrency },
      { onConflict: "user_id,snapshot_date" },
    );
  } catch { /* pre-migration or transient → no snapshot, trends stay empty */ }
}

// The most recent snapshot STRICTLY BEFORE today — the honest "last time" to compare
// the live metrics against. Returns null when there's no prior day (→ no fake trend).
export async function loadPriorSnapshot(userId: string, nowMs: number): Promise<SnapshotMetrics | null> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb
      .from("daily_financial_snapshots")
      .select("margen_weekly, safe_weekly, net_worth, total_debt, readiness, snapshot_date")
      .eq("user_id", userId)
      .lt("snapshot_date", dayBucket(nowMs))
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const r = data as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v)) || 0);
    return { margenWeekly: n(r.margen_weekly), safeWeekly: n(r.safe_weekly), netWorth: n(r.net_worth), totalDebt: n(r.total_debt), readiness: n(r.readiness) };
  } catch {
    return null;
  }
}
