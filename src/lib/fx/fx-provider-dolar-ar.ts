import type { FxProvider, FxRate } from "@/lib/fx/fx-rates";

// Day-to-day S6 — ARS (Argentine peso) FX provider. Free, NO API key, no cost.
// Argentina has multiple parallel USD rates; the OFFICIAL one is artificially held
// low (using it would roughly halve a peso salary's USD value), so Kipu defaults to
// the MARKET rate ("blue"). Two independent free sources, primary + fallback:
//   dolarapi:  https://dolarapi.com/v1/dolares        → array, discriminate by `casa`
//              [{ casa:"blue", compra, venta, fechaActualizacion }, …]
//   bluelytics https://api.bluelytics.com.ar/v2/latest → { blue:{value_avg}, oficial:{…} }
// Both return ARS-per-USD (USD→ARS). Coverage is ARS ONLY — any other pair → null →
// the resolver falls back to the user's manual/cached rate (never a guess). Like the
// Frankfurter provider: PURE parsers (gate-tested offline) + a thin fetch wrapper that
// NEVER throws on a network/parse error (→ null → graceful fallback).

const DOLARAPI_URL = "https://dolarapi.com/v1/dolares";
const BLUELYTICS_URL = "https://api.bluelytics.com.ar/v2/latest";
const DEFAULT_TIMEOUT_MS = 4000;
const norm = (c: string) => (c || "").trim().toUpperCase();

// Which parallel rate to track. "blue" = street/market (default), "oficial" = the
// artificially-low official rate, "mep"/"bolsa" = the legal financial-market rate.
export type ArsRateVariant = "blue" | "oficial" | "mep";

// Map our variant → each source's own key.
const DOLARAPI_CASA: Record<ArsRateVariant, string> = { blue: "blue", oficial: "oficial", mep: "bolsa" };

function isoDateFromTimestamp(ts: unknown): number | undefined {
  if (typeof ts !== "string" || !ts) return undefined;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : undefined;
}

export interface DolarApiEntry {
  casa?: string;
  compra?: number | string;
  venta?: number | string;
  fechaActualizacion?: string;
}

// PURE: a dolarapi array → the USD→ARS FxRate for the chosen variant. Uses the MID
// of compra/venta (the fairest single number); null when the variant/shape is absent.
export function parseDolarApi(json: unknown, variant: ArsRateVariant = "blue"): FxRate | null {
  if (!Array.isArray(json)) return null;
  const casa = DOLARAPI_CASA[variant];
  const row = json.find((r) => r && typeof r === "object" && String((r as DolarApiEntry).casa ?? "").toLowerCase() === casa) as DolarApiEntry | undefined;
  if (!row) return null;
  const compra = Number(row.compra);
  const venta = Number(row.venta);
  const usable = [compra, venta].filter((n) => Number.isFinite(n) && n > 0);
  if (usable.length === 0) return null;
  const rate = usable.reduce((s, n) => s + n, 0) / usable.length; // mid (or the one side present)
  if (!(rate > 0)) return null;
  return { from: "USD", to: "ARS", rate, source: "provider", asOfMs: isoDateFromTimestamp(row.fechaActualizacion) };
}

export interface BluelyticsResponse {
  blue?: { value_avg?: number; value_sell?: number; value_buy?: number };
  oficial?: { value_avg?: number; value_sell?: number; value_buy?: number };
  last_update?: string;
}

// PURE: a bluelytics response → USD→ARS for the chosen variant (blue/oficial only;
// it has no MEP, so "mep" → null and the caller keeps the primary source's value).
export function parseBluelytics(json: unknown, variant: ArsRateVariant = "blue"): FxRate | null {
  if (!json || typeof json !== "object") return null;
  if (variant === "mep") return null; // unsupported by this source
  const j = json as BluelyticsResponse;
  const node = variant === "oficial" ? j.oficial : j.blue;
  const rate = Number(node?.value_avg);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return { from: "USD", to: "ARS", rate, source: "provider", asOfMs: isoDateFromTimestamp(j.last_update) };
}

export interface DolarArDeps {
  fetchImpl?: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  timeoutMs?: number;
  variant?: ArsRateVariant;
}

export interface ArsFxProvider extends FxProvider {
  // Fetch the ARS rate for a specific variant (used by the refresh cron); null on any failure.
  getArsRate(variant?: ArsRateVariant): Promise<FxRate | null>;
}

async function fetchJson(
  doFetch: NonNullable<DolarArDeps["fetchImpl"]>,
  url: string,
  timeoutMs: number,
): Promise<unknown | null> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await doFetch(url, controller ? { signal: controller.signal } : undefined);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function makeDolarArProvider(deps: DolarArDeps = {}): ArsFxProvider {
  const doFetch = deps.fetchImpl ?? ((url: string, init?: { signal?: AbortSignal }) => fetch(url, init));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultVariant = deps.variant ?? "blue";

  async function getArsRate(variant: ArsRateVariant = defaultVariant): Promise<FxRate | null> {
    // Primary: dolarapi. Fallback: bluelytics. Never throws.
    const primary = await fetchJson(doFetch, DOLARAPI_URL, timeoutMs);
    const fromPrimary = parseDolarApi(primary, variant);
    if (fromPrimary) return fromPrimary;
    const fallback = await fetchJson(doFetch, BLUELYTICS_URL, timeoutMs);
    return parseBluelytics(fallback, variant);
  }

  return {
    name: "dolar-ar",
    // Only USD↔ARS is covered; anything else → null (resolver falls back to manual/cache).
    getRate: async (from, to) => {
      const f = norm(from), t = norm(to);
      if (f === "USD" && t === "ARS") return getArsRate();
      if (f === "ARS" && t === "USD") {
        const r = await getArsRate();
        return r && r.rate > 0 ? { from: "ARS", to: "USD", rate: 1 / r.rate, source: "provider", asOfMs: r.asOfMs } : null;
      }
      return null;
    },
    getArsRate,
  };
}

// Default live provider (no env vars, no key). Swap via DI in tests.
export const dolarArProvider: ArsFxProvider = makeDolarArProvider();
