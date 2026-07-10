import { NextRequest, NextResponse } from "next/server";
import { runDueRecurringMaterializations } from "@/lib/scheduled/recurring-materializer";
import { deliverDueRecurringMessages } from "@/lib/scheduled/recurring-notifier";

// Bloque C — evening cron (21:00 Argentina = 00:00 UTC; see vercel.json). It (1) materializes
// due recurring flows: auto-books fixed-amount ones into the ledger and creates pending asks
// for variable ones, then (2) delivers the confirmations/questions. STRICT auth (Bearer-only,
// no x-vercel-cron bypass) because it mutates the money ledger. Idempotent end-to-end (one
// occurrence row per source+date + a ledger dedupeKey), so a retry or a manual hit is safe.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const now = new Date();
    const materialized = await runDueRecurringMaterializations(now);
    const notified = await deliverDueRecurringMessages(now);
    console.info(
      "[kipu.cron.recurring-materialize]",
      JSON.stringify({ ts: now.toISOString(), materialized, notified }),
    );
    return NextResponse.json({ ok: true, materialized, notified });
  } catch (error) {
    console.error("[kipu.cron.recurring-materialize] failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "cron-failed" },
      { status: 500 },
    );
  }
}
