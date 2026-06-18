import { roundMoney } from "@/lib/financial/money";
import { findRate, type FxRate, type FxSource } from "@/lib/fx/fx-rates";
import type { HistoricalFxProvider } from "@/lib/fx/fx-provider-frankfurter";

// Stage 20 (micro-stage A2) — FX RESOLUTION orchestrator. Cache-first, provider-second,
// honest-last. Order:
//   1. same currency → 1
//   2. a KNOWN rate (user manual + cached/provider rows already loaded) — findRate ranks
//      MANUAL above provider/cached, so the user's own rate wins for their real context;
//      and because we only call the network when NO known rate exists, a manual rate
//      ALWAYS outranks a live provider fetch.
//   3. live provider (Frankfurter) — current or historical (by transaction date)
//   4. no_rate (never invents) → the agent asks the user.
// Fully injectable (knownRates + provider) so gates are deterministic and offline.

export interface RateResolution {
  ok: boolean;
  baseAmount: number; // amount in `to` (0 when !ok)
  rate: number;
  source: FxSource | "none";
  reason: string; // "" when ok; "no_rate" otherwise
  rateDate?: string; // the provider's effective date, when applicable
  fetched: boolean; // true if a live provider call produced this rate (→ caller should cache it)
}

export interface ResolveOptions {
  dateISO?: string; // transaction date for HISTORICAL conversion; undefined → latest
  knownRates: FxRate[]; // pre-loaded user-manual + cached rows (findRate handles ranking + inverse)
  provider?: HistoricalFxProvider | null; // live provider; null/undefined → disabled (manual/cache only)
}

export async function resolveRate(amount: number, from: string, to: string, opts: ResolveOptions): Promise<RateResolution> {
  if (!Number.isFinite(amount)) return { ok: false, baseAmount: 0, rate: 0, source: "none", reason: "bad_amount", fetched: false };

  // 1 + 2: same currency or a known (manual/cached) rate — no network needed.
  const known = findRate(from, to, opts.knownRates);
  if (known) return { ok: true, baseAmount: roundMoney(amount * known.rate), rate: known.rate, source: known.source, reason: "", fetched: false };

  // 3: live provider (only reached when there's no known rate → manual always wins).
  if (opts.provider) {
    let r: FxRate | null = null;
    try {
      r = opts.dateISO ? await opts.provider.getHistorical(from, to, opts.dateISO) : await opts.provider.getRate(from, to);
    } catch {
      r = null; // provider must never crash resolution
    }
    if (r && Number.isFinite(r.rate) && r.rate > 0) {
      const asOf = r.asOfMs ? new Date(r.asOfMs).toISOString().slice(0, 10) : undefined;
      return { ok: true, baseAmount: roundMoney(amount * r.rate), rate: r.rate, source: r.source, reason: "", rateDate: asOf, fetched: true };
    }
  }

  // 4: honest no-rate — the agent asks the user (and can save it via set_exchange_rate).
  return { ok: false, baseAmount: 0, rate: 0, source: "none", reason: "no_rate", fetched: false };
}
