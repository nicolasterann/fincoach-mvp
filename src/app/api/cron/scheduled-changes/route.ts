import { NextRequest, NextResponse } from "next/server";
import { runDueScheduledChanges } from "@/lib/scheduled/scheduled-changes-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Stage 26 — applies due scheduled changes ("en 3 meses mi sueldo sube a 1500",
// "cada 3 meses sube 3% el arriendo") once a day. Idempotent per day (the store
// claims each row via last_applied_on before mutating). Strict bearer auth:
// Vercel sends Authorization: Bearer CRON_SECRET on cron invocations when the
// env var exists, so no header-presence bypass (x-vercel-cron is spoofable off
// Vercel: local dev exposed on a LAN, tunnels, future self-hosting).
export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const asOf = new Date().toISOString().slice(0, 10);
  try {
    const result = await runDueScheduledChanges(asOf);
    // Aggregate only — no user data in logs.
    console.info("[kipu.cron.scheduled-changes]", JSON.stringify({ ts: new Date().toISOString(), asOf, ...result }));
    return // Bloque I — `result.ok` es false cuando la COLA no se pudo leer. Un 200 con
    // ok:false no le dice nada a Vercel y el cron se ve sano mientras los cambios que
    // el usuario programó no se aplican.
    NextResponse.json({ asOf, ...result }, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "cron-failed" },
      { status: 500 },
    );
  }
}
