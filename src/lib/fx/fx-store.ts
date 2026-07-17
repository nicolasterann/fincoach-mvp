import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { FxRate, FxSource } from "@/lib/fx/fx-rates";
import type { MoneyReadStatus } from "@/lib/financial/money-read";

// Stage 20 (micro-stage A) — FX rate cache persistence (migration 029). Service-role,
// graceful (production unchanged until applied). Holds the rates the user/agent has
// confirmed so conversions use a KNOWN rate; never a guess.

/** An FX read that reports on itself. See `money-read.ts`. */
export type FxRatesRead = MoneyReadStatus & { rates: FxRate[] };

// Nobody pins 100 pairs; the cap is a sanity bound. But "I saw 100" and "there are
// 100" must not be the same sentence, so ask for one more and let the extra row prove
// there is a tail we did not see.
const FX_CAP = 100;

function mapFxRow(r0: unknown): FxRate {
  const r = r0 as Record<string, unknown>;
  return {
    from: String(r.base_currency ?? "").toUpperCase(),
    to: String(r.quote_currency ?? "").toUpperCase(),
    rate: typeof r.rate === "number" ? r.rate : parseFloat(String(r.rate)) || 0,
    source: (String(r.source ?? "manual") as FxSource),
    asOfMs: r.as_of ? new Date(String(r.as_of)).getTime() : undefined,
  };
}

/** The MONEY read. An empty rate list is NOT neutral: every consumer treats "no known
 *  rate" as a deliberate refusal to guess — a scheduled payment in a foreign currency
 *  is DROPPED rather than counted at a fabricated 1:1, a goal contribution stops being
 *  protected. That doctrine is right for a rate that genuinely is not there, and
 *  catastrophic when the rate simply could not be READ: one blip and every foreign
 *  obligation disappears at once, which raises the calendar bound and the tank
 *  together. So the read now says which of the two happened. */
export async function readFxRates(userId: string): Promise<FxRatesRead> {
  try {
    const sb = createSupabaseAdminClient();
    // The `error` was never destructured here: PostgREST reports a failed query as
    // { data: null, error } WITHOUT throwing, so a failure arrived as "no rates".
    const { data, error } = await sb
      .from("fx_rates")
      .select("base_currency, quote_currency, rate, source, as_of")
      .eq("user_id", userId)
      .limit(FX_CAP + 1);
    if (error || !data) return { ok: false, complete: false, rates: [] };
    const capped = data.length > FX_CAP;
    const rates = data.slice(0, FX_CAP).map(mapFxRow).filter((r) => r.from && r.to && r.rate > 0);
    return { ok: true, complete: !capped, rates };
  } catch {
    return { ok: false, complete: false, rates: [] };
  }
}

/** DISPLAY / best-effort ONLY — collapses a failed read into "no rates", which every
 *  money consumer reads as "drop the foreign obligation". Named to make the misuse
 *  loud: on a money path use `readFxRates` and honour its verdict. */
export async function loadFxRatesForDisplay(userId: string): Promise<FxRate[]> {
  return (await readFxRates(userId)).rates;
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

// ── Day-to-day S6 — opt-in per-user auto-refresh (fx_rates.auto_refresh) ──────────
export interface AutoRefreshRate {
  userId: string;
  from: string;
  to: string;
  rate: number;
}

/** Un scan global que reporta sobre sí mismo. See `money-read.ts`. */
export type AutoRefreshRatesRead = MoneyReadStatus & { rates: AutoRefreshRate[] };

// Es un scan GLOBAL multi-usuario: el CAP+1 simple (como FX_CAP arriba) no alcanza,
// porque "demasiadas filas" no es un estado raro sino el crecimiento normal del
// producto. Se pagina por KEYSET sobre `id` (orden total, sin offsets que se corren
// con escrituras concurrentes) pidiendo PAGE+1 por vuelta: la fila extra PRUEBA que
// había cola. PAGE queda muy por debajo del tope de servidor de PostgREST (~1000) —
// una query sin .limit() explícito también trunca en silencio a ese tope.
export const AUTO_REFRESH_PAGE_SIZE = 500;
// Cota de vueltas (500 × 40 = 20k filas por corrida). Tocarla no es un error, pero
// tampoco es "lo vi todo": la corrida sale ok:true, complete:false.
export const AUTO_REFRESH_MAX_PAGES = 40;

/** Una página del scan: filas ordenadas por `id` ascendente estrictamente después de
 *  `afterId` (o desde el inicio si es null), a lo sumo `limit` filas. `error: true`
 *  significa "no pude leer", NUNCA "no había filas". Inyectable para probar la
 *  paginación sin base de datos. */
export type AutoRefreshPageFetch = (
  afterId: string | null,
  limit: number,
) => Promise<{ rows: Record<string, unknown>[]; error: boolean }>;

/** El motor de paginación, separado de la conexión real para que el gate pueda
 *  inyectar páginas y probar los tres veredictos: todo leído una vez (complete),
 *  error a mitad de camino (ok:false) y tope de vueltas (complete:false). */
export async function paginateAutoRefreshRates(
  fetchPage: AutoRefreshPageFetch,
  opts?: { pageSize?: number; maxPages?: number },
): Promise<AutoRefreshRatesRead> {
  const pageSize = opts?.pageSize ?? AUTO_REFRESH_PAGE_SIZE;
  const maxPages = opts?.maxPages ?? AUTO_REFRESH_MAX_PAGES;
  const out: AutoRefreshRate[] = [];
  const seen = new Set<string>();
  let afterId: string | null = null;
  let complete = false;
  for (let page = 0; page < maxPages; page++) {
    let res: { rows: Record<string, unknown>[]; error: boolean };
    try {
      res = await fetchPage(afterId, pageSize + 1);
    } catch {
      // Un throw a mitad de camino NO convierte lo ya leído en "todo lo que hay":
      // devolvemos las filas vistas (cada una es independiente y refrescable) pero
      // el veredicto es fallo — la corrida no puede llamarse completa ni exitosa.
      return { ok: false, complete: false, rates: out };
    }
    if (res.error) return { ok: false, complete: false, rates: out };
    // La fila PAGE+1 solo prueba que hay cola; no se procesa (la trae la vuelta
    // siguiente vía el cursor), así ninguna fila depende de dos snapshots.
    const hasTail = res.rows.length > pageSize;
    const rows = res.rows.slice(0, pageSize);
    for (const r of rows) {
      const id = String(r.id ?? "");
      // El keyset estricto (.gt) no debería duplicar, pero un fetch mal inyectado o
      // un id vacío no puede inflar el resultado: dedupe defensivo por id.
      if (!id || seen.has(id)) continue;
      seen.add(id);
      afterId = id;
      const mapped: AutoRefreshRate = {
        userId: String(r.user_id ?? ""),
        from: String(r.base_currency ?? "").toUpperCase(),
        to: String(r.quote_currency ?? "").toUpperCase(),
        rate: typeof r.rate === "number" ? r.rate : parseFloat(String(r.rate)) || 0,
      };
      if (mapped.userId && mapped.from && mapped.to) out.push(mapped);
    }
    if (!hasTail) {
      complete = true; // página corta = PROBADO que no queda cola
      break;
    }
  }
  return { ok: true, complete, rates: out };
}

/** El MONEY read del cron FX semanal: cada fila flagged auto_refresh=true de TODOS
 *  los usuarios. Antes (loadAutoRefreshRates) devolvía [] ante error y truncaba en
 *  1000 sin señal — el cron respondía éxito y las tasas viejas seguían pasando por
 *  vivas. Filas NO flagged (pins deliberados) jamás se devuelven ni se tocan. */
export async function readAutoRefreshRates(): Promise<AutoRefreshRatesRead> {
  let sb: ReturnType<typeof createSupabaseAdminClient>;
  try {
    sb = createSupabaseAdminClient();
  } catch {
    return { ok: false, complete: false, rates: [] };
  }
  return paginateAutoRefreshRates(async (afterId, limit) => {
    let q = sb
      .from("fx_rates")
      .select("id, user_id, base_currency, quote_currency, rate")
      .eq("auto_refresh", true)
      .order("id", { ascending: true })
      .limit(limit);
    if (afterId) q = q.gt("id", afterId);
    const { data, error } = await q;
    // { data: null, error } de PostgREST no lanza: hay que mirarlo o el fallo llega
    // río abajo disfrazado de "no hay filas que refrescar".
    return { rows: (data ?? []) as Record<string, unknown>[], error: Boolean(error) || !data };
  });
}

// Update the VALUE of an auto-tracked rate IN PLACE. The `.eq("auto_refresh", true)`
// guard means it can NEVER overwrite a pinned manual rate. Records source="provider" +
// as_of so the origin stays honest; keeps the row's auto_refresh flag.
export async function refreshAutoFxRate(userId: string, from: string, to: string, rate: number, asOfISO: string): Promise<boolean> {
  if (!from || !to || !Number.isFinite(rate) || rate <= 0) return false;
  try {
    const sb = createSupabaseAdminClient();
    const patch: Record<string, unknown> = { rate, source: "provider", updated_at: new Date().toISOString() };
    if (/^\d{4}-\d{2}-\d{2}$/.test(asOfISO)) patch.as_of = asOfISO;
    const { data, error } = await sb
      .from("fx_rates")
      .update(patch)
      .eq("user_id", userId)
      .eq("base_currency", from.trim().toUpperCase())
      .eq("quote_currency", to.trim().toUpperCase())
      .eq("auto_refresh", true)
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// Toggle whether a user's rate for a pair auto-refreshes from the market source. The
// row must already exist (created via upsertFxRate); returns false if none matched.
export async function setFxAutoRefresh(userId: string, from: string, to: string, enabled: boolean): Promise<boolean> {
  if (!from || !to) return false;
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from("fx_rates")
      .update({ auto_refresh: enabled, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("base_currency", from.trim().toUpperCase())
      .eq("quote_currency", to.trim().toUpperCase())
      .select("id");
    return !error && (data?.length ?? 0) > 0;
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
