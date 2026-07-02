import { roundMoney } from "@/lib/financial/money";

// Stage 20 (micro-stage A) — FX / MULTICURRENCY core. PURE. Kipu NEVER invents a
// rate: a conversion is either trivial (same currency → 1), backed by a KNOWN rate
// (cached/manual/historical), or it fails honestly (no_rate → the agent asks). This
// keeps money truth deterministic across multi-currency accounts, goals, assets and
// household expenses. Original amounts are always preserved; base is derived, never
// fabricated. A live rate provider can be added later behind `FxProvider` without
// changing any of this business logic.

export type FxSource = "same" | "manual" | "cached" | "provider" | "historical";

export interface FxRate {
  from: string; // ISO-ish currency code (e.g. "USD")
  to: string;
  rate: number; // 1 unit of `from` = `rate` units of `to`
  source: FxSource;
  asOfMs?: number;
}

export interface ConvertResult {
  ok: boolean;
  baseAmount: number; // amount in `to` (0 when !ok)
  rate: number;
  source: FxSource | "none";
  reason: string; // "" when ok; "no_rate" otherwise
}

const norm = (c: string) => (c || "").trim().toUpperCase();

// A rate is a plain number, not money — ONE house style everywhere it renders
// (matches the app's en-US number formatting): 1480.25 → "1,480.25".
export function formatFxRate(rate: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(rate);
}

// Find a usable rate from a known list: direct, then inverse. NO triangulation /
// no invented cross-rates (a guessed cross-rate is a fabricated rate). Deterministic:
// prefers the most recent / most authoritative source on ties.
const SOURCE_RANK: Record<FxSource, number> = { same: 5, manual: 4, historical: 3, provider: 2, cached: 1 };
export function findRate(from: string, to: string, rates: FxRate[]): FxRate | null {
  const f = norm(from), t = norm(to);
  if (f === t) return { from: f, to: t, rate: 1, source: "same" };
  const direct = rates.filter((r) => norm(r.from) === f && norm(r.to) === t && Number.isFinite(r.rate) && r.rate > 0);
  const inverse = rates.filter((r) => norm(r.from) === t && norm(r.to) === f && Number.isFinite(r.rate) && r.rate > 0);
  const best = (xs: FxRate[]) => xs.sort((a, b) => (SOURCE_RANK[b.source] - SOURCE_RANK[a.source]) || ((b.asOfMs ?? 0) - (a.asOfMs ?? 0)))[0];
  if (direct.length) { const r = best(direct); return { ...r, from: f, to: t }; }
  if (inverse.length) { const r = best(inverse); return { from: f, to: t, rate: 1 / r.rate, source: r.source, asOfMs: r.asOfMs }; }
  return null;
}

export function convert(amount: number, from: string, to: string, rates: FxRate[]): ConvertResult {
  if (!Number.isFinite(amount)) return { ok: false, baseAmount: 0, rate: 0, source: "none", reason: "bad_amount" };
  const r = findRate(from, to, rates);
  if (!r) return { ok: false, baseAmount: 0, rate: 0, source: "none", reason: "no_rate" };
  return { ok: true, baseAmount: roundMoney(amount * r.rate), rate: r.rate, source: r.source, reason: "" };
}

// Aggregate mixed-currency items into a base total WITHOUT inventing anything. An
// item already carrying a base amount (converted at write time) is trusted as-is;
// otherwise we convert via a known rate, and anything we CAN'T convert is excluded
// from the total and reported separately (never silently counted at a guessed rate).
export interface MixedItem {
  amountOriginal: number;
  currency: string;
  amountBase?: number | null; // pre-computed base (e.g. transactions.base_amount); trusted if present
}
export interface MixedValuation {
  base: number; // sum of everything we could value in base
  convertedCount: number;
  totalCount: number;
  unconverted: { currency: string; amount: number }[]; // items with no rate (NOT counted)
  confidence: "high" | "medium" | "low";
}

export function valuateMixed(items: MixedItem[], baseCurrency: string, rates: FxRate[]): MixedValuation {
  const base = norm(baseCurrency);
  let total = 0, converted = 0;
  const unconverted: { currency: string; amount: number }[] = [];
  for (const it of items) {
    if (typeof it.amountBase === "number" && Number.isFinite(it.amountBase)) { total += it.amountBase; converted += 1; continue; }
    const c = norm(it.currency);
    if (c === base) { total += it.amountOriginal; converted += 1; continue; }
    const res = convert(it.amountOriginal, c, base, rates);
    if (res.ok) { total += res.baseAmount; converted += 1; }
    else unconverted.push({ currency: c, amount: it.amountOriginal });
  }
  const totalCount = items.length;
  const confidence: MixedValuation["confidence"] = unconverted.length === 0 ? "high" : converted >= unconverted.length ? "medium" : "low";
  return { base: roundMoney(total), convertedCount: converted, totalCount, unconverted, confidence };
}

// Provider abstraction — a live FX provider (or a manual/cached store) plugs in here
// later WITHOUT touching the pure logic above. `getRate` returns null when it has no
// rate (never a guess). Today the live provider is intentionally absent; the manual/
// cached store (fx-store) supplies rates the user/agent confirms.
export interface FxProvider {
  name: string;
  getRate(from: string, to: string): Promise<FxRate | null>;
}

export const NoFxProvider: FxProvider = { name: "none", getRate: async () => null };
