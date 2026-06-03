import { NextRequest, NextResponse } from "next/server";
import { loadDueScheduledPayments } from "@/lib/financial/commitments-store";

export const dynamic = "force-dynamic";

// Scheduled-payments cron digest.
//
// INTENTIONALLY READ-ONLY: it finds scheduled payments whose due date has
// arrived and returns/logs an aggregate. It does NOT auto-create transactions
// or move money — a scheduled payment is a PLAN, and charging it without the
// user confirming they actually paid would violate "DB writes require explicit
// intent". The materialization happens when the user confirms the payment in
// chat ("ya pagué el gimnasio"), which goes through the normal writer.
//
// Wire-up (manual, not added to project config here): add a Vercel cron entry
//   { "path": "/api/cron/scheduled-payments", "schedule": "0 13 * * *" }
// and set CRON_SECRET so Vercel sends `Authorization: Bearer <CRON_SECRET>`.
export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization");
  const isVercelCron = request.headers.get("x-vercel-cron") !== null;
  if (auth !== `Bearer ${expectedSecret}` && !isVercelCron) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const asOf = new Date().toISOString().slice(0, 10);

  try {
    const due = await loadDueScheduledPayments(asOf);
    const distinctUsers = new Set(due.map((p) => p.userId)).size;

    // Aggregate only — no names/amounts in the response or logs (non-sensitive).
    console.info(
      "[kipu.cron.scheduled-payments]",
      JSON.stringify({ ts: new Date().toISOString(), asOf, dueCount: due.length, users: distinctUsers }),
    );

    return NextResponse.json({ ok: true, asOf, dueCount: due.length });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "cron-failed",
      },
      { status: 500 },
    );
  }
}
