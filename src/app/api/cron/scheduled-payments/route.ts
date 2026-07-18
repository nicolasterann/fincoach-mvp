import { NextRequest, NextResponse } from "next/server";
import { readDueScheduledPayments } from "@/lib/financial/commitments-store";

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
// Wire-up (manual, not added to project config here — hoy es un endpoint manual, no
// figura en vercel.json): add a Vercel cron entry
//   { "path": "/api/cron/scheduled-payments", "schedule": "0 13 * * *" }
// and set CRON_SECRET. Strict bearer auth: Vercel sends `Authorization: Bearer <…>`
// when the env var exists — no x-vercel-cron bypass (spoofable off Vercel).
export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const asOf = new Date().toISOString().slice(0, 10);

  try {
    // La lectura reporta sobre sí misma: "no pude leer" ya no es "no vence nada".
    const read = await readDueScheduledPayments(asOf);
    if (!read.ok) {
      console.error("[kipu.cron.scheduled-payments]", JSON.stringify({ ts: new Date().toISOString(), asOf, error: "due-scan-failed" }));
      return NextResponse.json({ ok: false, error: "due-scan-failed", asOf }, { status: 500 });
    }
    // Read-only digest: el brazo parcial sirve para contar lo visto; `complete`
    // viaja en el body para que el operador distinga.
    const payments = read.complete ? read.payments : read.partial;
    const distinctUsers = new Set(payments.map((p) => p.userId)).size;

    // Aggregate only — no names/amounts in the response or logs (non-sensitive).
    console.info(
      "[kipu.cron.scheduled-payments]",
      JSON.stringify({ ts: new Date().toISOString(), asOf, dueCount: payments.length, users: distinctUsers, complete: read.complete }),
    );

    return NextResponse.json({ ok: true, complete: read.complete, asOf, dueCount: payments.length });
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
