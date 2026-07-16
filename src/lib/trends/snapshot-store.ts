import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { SnapshotMetrics } from "@/lib/trends/trend";

// Stage 20 (micro-stage G) — daily snapshot persistence (migration 030). Service-role,
// graceful (production unchanged until applied). One row per user per day (idempotent
// upsert), so re-builds within a day don't multiply rows and trends stay day-over-day.

function dayBucket(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export async function writeDailySnapshot(userId: string, m: SnapshotMetrics, baseCurrency: string, nowMs: number, saldoKipu?: number | null): Promise<void> {
  try {
    const sb = createSupabaseAdminClient();
    await sb.from("daily_financial_snapshots").upsert(
      // Stage H — NEVER null out a Saldo already recorded for this day: the upsert
      // would destroy the honest value and leave the history with a hole (and, on
      // a day we could not compute, that hole is exactly what a later reader would
      // have to trust). Omit the column instead of writing null over a good row.
      {
        user_id: userId, snapshot_date: dayBucket(nowMs), margen_weekly: m.margenWeekly,
        safe_weekly: m.safeWeekly, net_worth: m.netWorth, total_debt: m.totalDebt,
        readiness: Math.round(m.readiness), base_currency: baseCurrency,
        ...(saldoKipu == null ? {} : { saldo_kipu: saldoKipu }),
      },
      { onConflict: "user_id,snapshot_date" },
    );
  } catch { /* pre-migration or transient → no snapshot, trends stay empty */ }
}

// Stage 20 PASS 2 — the recorded snapshot series for trend CHARTS. Returns the
// stored daily snapshots within the last `daysBack` days, oldest→newest, each with
// its date. HONEST: it returns ONLY rows that actually exist (one per recorded day);
// it never fills gaps or fabricates points. A brand-new user gets [] or one point →
// the dashboard shows "sin historial aún", never an invented curve.
export interface DatedSnapshot extends SnapshotMetrics {
  dateISO: string;
  // Stage D — the recorded Saldo Kipu of that day; null on rows older than
  // migration 048 (charts only plot days that really recorded it).
  saldoKipu: number | null;
}

export async function loadSnapshotSeries(userId: string, daysBack: number, nowMs: number): Promise<DatedSnapshot[]> {
  try {
    const sb = createSupabaseAdminClient();
    const fromISO = new Date(nowMs - Math.max(1, daysBack) * 86400000).toISOString().slice(0, 10);
    const { data } = await sb
      .from("daily_financial_snapshots")
      .select("margen_weekly, safe_weekly, net_worth, total_debt, readiness, snapshot_date, saldo_kipu")
      .eq("user_id", userId)
      .gte("snapshot_date", fromISO)
      .order("snapshot_date", { ascending: true })
      .limit(120);
    const n = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v)) || 0);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      dateISO: String(r.snapshot_date ?? ""),
      margenWeekly: n(r.margen_weekly),
      safeWeekly: n(r.safe_weekly),
      netWorth: n(r.net_worth),
      totalDebt: n(r.total_debt),
      readiness: n(r.readiness),
      saldoKipu: r.saldo_kipu == null ? null : n(r.saldo_kipu),
    })).filter((r) => r.dateISO);
  } catch {
    return [];
  }
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

