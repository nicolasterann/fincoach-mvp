import { NextRequest, NextResponse } from "next/server";
import { runDueRecurringMaterializations } from "@/lib/scheduled/recurring-materializer";
import { deliverDueRecurringMessages } from "@/lib/scheduled/recurring-notifier";
import { runObjectiveMonthCloses } from "@/lib/scheduled/objective-month-close";

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
    // Stage H — objective month close (user-local day 1-3, idempotent per
    // (user, month) via objective_month_closes). Report-only + surplus default
    // Reservas (no ledger write); best-effort, never blocks the money steps.
    const objectiveCloses = await runObjectiveMonthCloses(now).catch(() => ({ ok: false, usersScanned: 0, closed: 0, skipped: 0, errors: 1 }));
    // Un 200 con errores adentro no le dice nada a Vercel: si cualquier etapa
    // reporta errores (o el cierre no es confiable de punta a punta), responder
    // 500 con el detalle para que el cron quede marcado fallido y se vea.
    // Idempotente end-to-end, así que el retry/manual re-hit es seguro.
    // materialized.ok / notified.errors (re-auditoría 2): el DESCUBRIMIENTO también
    // es una lectura de dinero — una select caída era "ese universo está vacío".
    const failed =
      !materialized.ok ||
      materialized.errors > 0 ||
      notified.errors > 0 ||
      !objectiveCloses.ok ||
      objectiveCloses.errors > 0;
    const body = { ok: !failed, materialized, notified, objectiveCloses };
    if (failed) {
      console.error("[kipu.cron.recurring-materialize] completed with errors:", JSON.stringify({ ts: now.toISOString(), ...body }));
      return NextResponse.json(body, { status: 500 });
    }
    console.info(
      "[kipu.cron.recurring-materialize]",
      JSON.stringify({ ts: now.toISOString(), materialized, notified, objectiveCloses }),
    );
    return NextResponse.json(body);
  } catch (error) {
    console.error("[kipu.cron.recurring-materialize] failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "cron-failed" },
      { status: 500 },
    );
  }
}
