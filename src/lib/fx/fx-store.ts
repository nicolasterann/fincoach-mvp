import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { FxRate, FxSource } from "@/lib/fx/fx-rates";

// Stage 20 (micro-stage A) — FX rate cache persistence (migration 029). Service-role,
// graceful (production unchanged until applied). Holds the rates the user/agent has
// confirmed so conversions use a KNOWN rate; never a guess.

export async function loadFxRates(userId: string): Promise<FxRate[]> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb.from("fx_rates").select("base_currency, quote_currency, rate, source, as_of").eq("user_id", userId).limit(100);
    return (data ?? []).map((r0) => {
      const r = r0 as Record<string, unknown>;
      return {
        from: String(r.base_currency ?? "").toUpperCase(),
        to: String(r.quote_currency ?? "").toUpperCase(),
        rate: typeof r.rate === "number" ? r.rate : parseFloat(String(r.rate)) || 0,
        source: (String(r.source ?? "manual") as FxSource),
        asOfMs: r.as_of ? new Date(String(r.as_of)).getTime() : undefined,
      };
    }).filter((r) => r.from && r.to && r.rate > 0);
  } catch {
    return [];
  }
}

export async function upsertFxRate(userId: string, from: string, to: string, rate: number, source: FxSource = "manual"): Promise<boolean> {
  if (!from || !to || !Number.isFinite(rate) || rate <= 0) return false;
  try {
    const sb = createSupabaseAdminClient();
    const { error } = await sb.from("fx_rates").upsert(
      { user_id: userId, base_currency: from.trim().toUpperCase(), quote_currency: to.trim().toUpperCase(), rate, source, updated_at: new Date().toISOString() },
      { onConflict: "user_id,base_currency,quote_currency" },
    );
    return !error;
  } catch {
    return false;
  }
}

// ── Micro-stage A2 — GLOBAL provider/reference rate cache (fx_rate_cache) ─────────
const up = (c: string) => (c || "").trim().toUpperCase();
// Strict ISO-code sanitizer: ONLY A–Z, exactly 3 — prevents any PostgREST .or()
// filter injection from a malformed code (defense-in-depth; the tool also validates).
const code = (c: string): string | null => { const s = up(c).replace(/[^A-Z]/g, ""); return s.length === 3 ? s : null; };
function rowToFxRate(r0: Record<string, unknown>, source: FxSource): FxRate {
  return { from: up(String(r0.base_currency ?? "")), to: up(String(r0.quote_currency ?? "")), rate: typeof r0.rate === "number" ? r0.rate : parseFloat(String(r0.rate)) || 0, source, asOfMs: r0.rate_date ? new Date(`${String(r0.rate_date)}T00:00:00Z`).getTime() : undefined };
}

// The most recent cached rate for the pair (both directions) — for CURRENT conversion.
export async function loadLatestCachedRates(from: string, to: string): Promise<FxRate[]> {
  try {
    const sb = createSupabaseAdminClient();
    const f = code(from), t = code(to);
    if (!f || !t) return [];
    const { data } = await sb
      .from("fx_rate_cache")
      .select("base_currency, quote_currency, rate, rate_date")
      .or(`and(base_currency.eq.${f},quote_currency.eq.${t}),and(base_currency.eq.${t},quote_currency.eq.${f})`)
      .order("rate_date", { ascending: false })
      .limit(4);
    const seen = new Set<string>();
    const out: FxRate[] = [];
    for (const r0 of (data ?? []) as Record<string, unknown>[]) {
      const key = `${r0.base_currency}>${r0.quote_currency}`; // keep only the newest per direction
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rowToFxRate(r0, "cached"));
    }
    return out.filter((r) => r.rate > 0);
  } catch {
    return [];
  }
}

// The cached rate(s) for a SPECIFIC date (both directions) — for HISTORICAL conversion.
export async function loadCachedRateForDate(from: string, to: string, dateISO: string): Promise<FxRate[]> {
  try {
    const sb = createSupabaseAdminClient();
    const f = code(from), t = code(to);
    if (!f || !t || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return [];
    const { data } = await sb
      .from("fx_rate_cache")
      .select("base_currency, quote_currency, rate, rate_date")
      .eq("rate_date", dateISO)
      .or(`and(base_currency.eq.${f},quote_currency.eq.${t}),and(base_currency.eq.${t},quote_currency.eq.${f})`)
      .limit(2);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => rowToFxRate(r, "cached")).filter((r) => r.rate > 0);
  } catch {
    return [];
  }
}

// Persist a freshly-fetched provider rate (idempotent per pair+date).
export async function cacheProviderRate(from: string, to: string, rate: number, rateDateISO: string, provider = "frankfurter"): Promise<void> {
  if (!Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(rateDateISO)) return;
  try {
    const sb = createSupabaseAdminClient();
    await sb.from("fx_rate_cache").upsert(
      { base_currency: up(from), quote_currency: up(to), rate, rate_date: rateDateISO, source: "provider", provider },
      { onConflict: "base_currency,quote_currency,rate_date" },
    );
  } catch { /* best-effort cache */ }
}
