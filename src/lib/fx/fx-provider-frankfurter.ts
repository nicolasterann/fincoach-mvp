import type { FxProvider, FxRate } from "@/lib/fx/fx-rates";

// Stage 20 (micro-stage A2) — FRANKFURTER FX provider. Free, NO API KEY, no cost,
// commercial use OK, caching explicitly allowed (frankfurter.dev). ECB-sourced
// reference rates, current + historical (back to 1999). Public endpoint:
//   latest:     https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL,EUR
//   historical: https://api.frankfurter.dev/v1/2024-01-02?base=USD&symbols=BRL
// Response: { amount, base, date, rates: { <SYMBOL>: rate } }.
//
// IMPORTANT (honesty): coverage is the ECB reference set (USD, EUR, GBP, BRL, MXN,
// JPY, CHF, CNY, …). Non-ECB LatAm currencies (COP, ARS, PEN, CLP, UYU) are simply
// ABSENT from `rates` → we return null → the resolver falls back to the user's
// manual rate. The rate is REFERENCE (not a bank/transaction rate); the agent says
// so. We NEVER invent a rate and NEVER throw on network failure (→ null → fallback).

const BASE_URL = "https://api.frankfurter.dev/v1";
const DEFAULT_TIMEOUT_MS = 4000;
const norm = (c: string) => (c || "").trim().toUpperCase();

export interface FrankfurterResponse {
  amount?: number;
  base?: string;
  date?: string; // YYYY-MM-DD (the rate's effective date)
  rates?: Record<string, number>;
}

// PURE parser (gate-tested without network): a Frankfurter response → an FxRate for
// the requested pair, or null when the target currency isn't covered / malformed.
export function parseFrankfurter(json: FrankfurterResponse | null | undefined, from: string, to: string): FxRate | null {
  if (!json || typeof json !== "object") return null;
  const f = norm(from), t = norm(to);
  if (norm(json.base ?? "") !== f) return null; // we always set base=from; a mismatch is untrustworthy
  const raw = json.rates?.[t];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null; // unsupported pair (e.g. COP) → no rate
  const asOfMs = json.date ? Date.parse(`${json.date}T00:00:00Z`) : undefined;
  return { from: f, to: t, rate: raw, source: "provider", asOfMs: Number.isFinite(asOfMs as number) ? asOfMs : undefined };
}

export interface FrankfurterDeps {
  // Injectable fetch (default: global fetch) so gates run deterministically offline.
  fetchImpl?: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  timeoutMs?: number;
}

export interface HistoricalFxProvider extends FxProvider {
  getHistorical(from: string, to: string, dateISO: string): Promise<FxRate | null>;
}

export function makeFrankfurterProvider(deps: FrankfurterDeps = {}): HistoricalFxProvider {
  const doFetch = deps.fetchImpl ?? ((url: string, init?: { signal?: AbortSignal }) => fetch(url, init));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function fetchRate(path: string, from: string, to: string): Promise<FxRate | null> {
    const f = norm(from), t = norm(to);
    if (f === t) return { from: f, to: t, rate: 1, source: "same" };
    const url = `${BASE_URL}${path}?base=${encodeURIComponent(f)}&symbols=${encodeURIComponent(t)}`;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await doFetch(url, controller ? { signal: controller.signal } : undefined);
      if (!res.ok) return null; // HTTP error → no rate (never throw)
      const json = (await res.json()) as FrankfurterResponse;
      return parseFrankfurter(json, f, t);
    } catch {
      return null; // timeout / network / parse error → no rate (graceful)
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    name: "frankfurter",
    getRate: (from, to) => fetchRate("/latest", from, to),
    getHistorical: (from, to, dateISO) => {
      // Guard the date shape (YYYY-MM-DD); a bad date → null rather than a bad call.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return Promise.resolve(null);
      return fetchRate(`/${dateISO}`, from, to);
    },
  };
}

// The default live provider (no env vars, no key). Swap via DI in tests.
export const frankfurterProvider: HistoricalFxProvider = makeFrankfurterProvider();
