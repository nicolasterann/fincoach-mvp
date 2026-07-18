import { NextRequest, NextResponse } from "next/server";
import { runAmbientLoop } from "@/lib/ambient/ambient-loop";

export const dynamic = "force-dynamic";
// One pass can evaluate many users and make bounded model calls; give it room.
export const maxDuration = 300;

// Stage 13 — Ambient Telegram Loop cron.
//
// Runs one bounded pass of the ambient loop: find Telegram-linked users, let the
// deterministic decision layer choose whether/what to nudge (freshness, signals,
// preferences, quiet hours, cooldowns, max/day), and send AI-written check-ins —
// idempotently (per user/topic/local-day) so cron repeats, retries and concurrent
// runs never double-send. It NEVER writes the ledger and never blocks anything.
//
// Wire-up (manual, not added to project config here): add a Vercel cron entry
//   { "path": "/api/cron/ambient-loop", "schedule": "0 * * * *" }   // hourly: lets per-user quiet hours / timezones gate the actual send
// and set CRON_SECRET so Vercel sends `Authorization: Bearer <CRON_SECRET>`.
export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  // Strict bearer auth — no x-vercel-cron bypass (spoofable off Vercel).
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  // Optional bound for safety / manual runs (?limit=N).
  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(500, Math.floor(limitParam)) : 100;

  try {
    const r = await runAmbientLoop({ limit });
    // Aggregate, non-sensitive observability (no user ids, no financial detail).
    console.info(
      "[kipu.cron.ambient-loop]",
      JSON.stringify({
        ts: new Date().toISOString(),
        considered: r.considered,
        sent: r.sent,
        skipped: r.skipped,
        failed: r.failed,
        byReason: r.byReason,
      }),
    );
    // `ok` honesto (failed=0). Se queda en 200 a propósito: ambient NO es dinero
    // (jamás escribe el ledger), los sends son idempotentes por user/topic/día y el
    // próximo pase horario reintenta solo — un 5xx aquí solo haría ruido de monitor.
    return NextResponse.json({ ok: r.failed === 0, ...r });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ambient-loop-failed" },
      { status: 500 },
    );
  }
}
