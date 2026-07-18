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
    // Bloque I — el veredicto entero (re-auditoría 2, punto 10): ok=false cuando la
    // cola o el recovery no se pudieron leer; complete=false cuando quedó cola sin
    // procesar; failed>0 cuando algún plan quedó marcado failed. Cualquiera de los
    // tres merece un 5xx — los writes son CAS/absolutos, el retry es gratis, y un 200
    // "a medias" se veía idéntico a un día sin cambios. (Y el comentario va ANTES del
    // return: puesto después, la inserción automática de punto y coma convertía esto
    // en `return undefined` — error real de runtime del 17/07.)
    const healthy = result.ok && result.complete && result.failed === 0;
    return NextResponse.json({ asOf, ...result }, { status: healthy ? 200 : 500 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "cron-failed" },
      { status: 500 },
    );
  }
}
