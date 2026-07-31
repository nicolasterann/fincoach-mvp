import { NextRequest, NextResponse } from "next/server";
import { dolarArProvider } from "@/lib/fx/fx-provider-dolar-ar";
import { cacheProviderRate, readAutoRefreshRates, refreshAutoFxRate } from "@/lib/fx/fx-store";

export const dynamic = "force-dynamic";

// Day-to-day S6 — daily FX auto-refresh. Pulls the ARS MARKET rate ("blue") from a
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
// Wire-up: vercel.json cron `{ "path": "/api/cron/fx-refresh", "schedule": "0 13 * * *" }`
// (daily 13:00 UTC). Strict bearer auth: Vercel sends `Authorization: Bearer <…>`
// when CRON_SECRET exists, so no header-presence bypass (x-vercel-cron is spoofable
// off Vercel — same reasoning as scheduled-changes).
export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);

  try {
    const arsRate = await dolarArProvider.getArsRate("blue");
    if (!arsRate || !(arsRate.rate > 0)) {
      // Both sources unreachable → keep the last known rate, change nothing. Pero un
      // cron DIARIO que no refrescó nada NO puede verse idéntico a uno exitoso:
      // días seguidos de fuente caída = tasas cada vez más viejas valuando plata
      // real. 503 (sin tocar nada) para que el monitor lo distinga (punto 10).
      console.error("[kipu.cron.fx-refresh]", JSON.stringify({ ts: now.toISOString(), source: "none", refreshed: 0 }));
      return NextResponse.json({ ok: false, asOf: todayISO, source: "unavailable", cached: false, refreshed: 0 }, { status: 503 });
    }
    const usdArs = arsRate.rate; // ARS per USD
    const asOf = arsRate.asOfMs ? new Date(arsRate.asOfMs).toISOString().slice(0, 10) : todayISO;

    // 1. Global reference cache (benefits everyone without a manual rate). El upsert
    // reporta si aterrizó: "cached: true" era una afirmación no probada (el void se
    // tragaba el error) y este cache convierte los pesos de todo usuario sin tasa manual.
    const cacheOk = await cacheProviderRate("USD", "ARS", usdArs, asOf, "dolarapi");

    // 2. Per-user opted-in rows (only USD↔ARS is auto-sourced today). La lectura
    // reporta sobre sí misma: antes un scan fallido o truncado en 1000 llegaba como
    // "menos filas" y el cron respondía éxito mientras tasas viejas seguían pasando
    // por vivas. Un scan que no pudo leer NO autoriza a llamarse corrida exitosa.
    const read = await readAutoRefreshRates();
    if (!read.ok) {
      // 500 real: el monitor/retry de Vercel lo ve. Lo que falló es el scan per-user;
      // el estado real del cache global va en cacheOk, probado, no afirmado.
      console.error("[kipu.cron.fx-refresh]", JSON.stringify({ ts: now.toISOString(), error: "auto-refresh-scan-failed", cached: cacheOk }));
      return NextResponse.json({ ok: false, error: "auto-refresh-scan-failed", asOf, cached: cacheOk }, { status: 500 });
    }
    // Consumo del brazo PARCIAL a propósito: cada fila es independiente y
    // refrescable; el veredicto de abajo ya cuenta complete:false como 5xx.
    const scannedRates = read.complete ? read.rates : read.partial;
    let refreshed = 0;
    let gone = 0;
    let writeFailed = 0;
    for (const r of scannedRates) {
      const isUsdArs = (r.from === "USD" && r.to === "ARS") || (r.from === "ARS" && r.to === "USD");
      if (!isUsdArs) continue;
      const value = r.from === "USD" ? usdArs : 1 / usdArs;
      const result = await refreshAutoFxRate(r.userId, r.from, r.to, value, asOf);
      if (result === "applied") refreshed += 1;
      else if (result === "gone") gone += 1; // despinneada/borrada entre scan y write: benigno
      else writeFailed += 1; // error real: la tasa vieja sigue pasando por viva
    }

    // Veredicto (punto 10): sana solo si el cache aterrizó, el scan fue completo y
    // ningún write per-user falló de verdad. El refresh es idempotente ⇒ retry gratis.
    const healthy = cacheOk && read.complete && writeFailed === 0;
    const body = {
      ok: healthy,
      complete: read.complete,
      asOf,
      source: "dolarapi:blue",
      usdArs,
      cached: cacheOk,
      scanned: scannedRates.length,
      refreshed,
      gone,
      writeFailed,
    };
    const log = JSON.stringify({ ts: now.toISOString(), ...body, usdArs: Math.round(usdArs * 100) / 100 });
    if (healthy) console.info("[kipu.cron.fx-refresh]", log);
    else console.error("[kipu.cron.fx-refresh]", log);
    return NextResponse.json(body, { status: healthy ? 200 : 500 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "cron-failed" }, { status: 500 });
  }
}
