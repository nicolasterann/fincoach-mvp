import { NextRequest, NextResponse } from "next/server";
import { dolarArProvider } from "@/lib/fx/fx-provider-dolar-ar";
import { cacheProviderRate, readAutoRefreshRates, refreshAutoFxRate } from "@/lib/fx/fx-store";

export const dynamic = "force-dynamic";

// Day-to-day S6 — weekly FX auto-refresh. Pulls the ARS MARKET rate ("blue") from a
// free source (dolarapi, fallback bluelytics) and:
//   1. writes it to the GLOBAL reference cache (fx_rate_cache) so any user WITHOUT a
//      manual USD↔ARS rate converts pesos at the live market rate; and
//   2. updates every per-user rate flagged auto_refresh=true (the resolver ranks a
//      manual rate above the cache, so an opted-in user's own row must be refreshed
//      directly). A pinned (auto_refresh=false) manual rate is NEVER touched.
// If BOTH sources are down we refresh NOTHING — the last good rate stays (never wipe a
// known rate with a guess). Argentina's official rate is artificially low, so Kipu uses
// the market rate on purpose. ARS is the only auto-sourced currency today.
//
// Wire-up: vercel.json cron `{ "path": "/api/cron/fx-refresh", "schedule": "0 13 * * 1" }`
// (Mondays 13:00 UTC). Requires CRON_SECRET (Vercel sends `Authorization: Bearer <…>`;
// the `x-vercel-cron` header is also accepted).
export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  const isVercelCron = request.headers.get("x-vercel-cron") !== null;
  if (auth !== `Bearer ${expectedSecret}` && !isVercelCron) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);

  try {
    const arsRate = await dolarArProvider.getArsRate("blue");
    if (!arsRate || !(arsRate.rate > 0)) {
      // Both sources unreachable → keep the last known rate, change nothing.
      console.info("[kipu.cron.fx-refresh]", JSON.stringify({ ts: now.toISOString(), source: "none", refreshed: 0 }));
      return NextResponse.json({ ok: true, asOf: todayISO, source: "unavailable", cached: false, refreshed: 0 });
    }
    const usdArs = arsRate.rate; // ARS per USD
    const asOf = arsRate.asOfMs ? new Date(arsRate.asOfMs).toISOString().slice(0, 10) : todayISO;

    // 1. Global reference cache (benefits everyone without a manual rate).
    await cacheProviderRate("USD", "ARS", usdArs, asOf, "dolarapi");

    // 2. Per-user opted-in rows (only USD↔ARS is auto-sourced today). La lectura
    // reporta sobre sí misma: antes un scan fallido o truncado en 1000 llegaba como
    // "menos filas" y el cron respondía éxito mientras tasas viejas seguían pasando
    // por vivas. Un scan que no pudo leer NO autoriza a llamarse corrida exitosa.
    const read = await readAutoRefreshRates();
    if (!read.ok) {
      // 500 real: el monitor/retry de Vercel lo ve. El cache global del paso 1 ya
      // quedó escrito (independiente y correcto); lo que falló es el scan per-user.
      console.error("[kipu.cron.fx-refresh]", JSON.stringify({ ts: now.toISOString(), error: "auto-refresh-scan-failed" }));
      return NextResponse.json({ ok: false, error: "auto-refresh-scan-failed", asOf, cached: true }, { status: 500 });
    }
    let refreshed = 0;
    for (const r of read.rates) {
      const isUsdArs = (r.from === "USD" && r.to === "ARS") || (r.from === "ARS" && r.to === "USD");
      if (!isUsdArs) continue;
      const value = r.from === "USD" ? usdArs : 1 / usdArs;
      const ok = await refreshAutoFxRate(r.userId, r.from, r.to, value, asOf);
      if (ok) refreshed += 1;
    }
    if (!read.complete) {
      // Cada fila es independiente: refrescar lo que SÍ se leyó es correcto. Pero la
      // corrida no puede llamarse completa — las filas más allá del tope siguen viejas.
      console.error("[kipu.cron.fx-refresh]", JSON.stringify({ ts: now.toISOString(), warning: "auto-refresh-scan-incomplete", scanned: read.rates.length, refreshed }));
    }

    console.info(
      "[kipu.cron.fx-refresh]",
      JSON.stringify({ ts: now.toISOString(), source: "dolarapi:blue", usdArs: Math.round(usdArs * 100) / 100, asOf, scanned: read.rates.length, refreshed, complete: read.complete }),
    );
    return NextResponse.json({ ok: true, complete: read.complete, asOf, source: "dolarapi:blue", usdArs, cached: true, refreshed });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "cron-failed" }, { status: 500 });
  }
}
