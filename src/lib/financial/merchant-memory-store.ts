import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { MerchantOverride } from "@/lib/financial/merchant-normalization";
import type { FinancialCategory } from "@/types/financial";

// Stage 16 — the STRUCTURED merchant-memory store (migration 024). The classifier
// reads these learned facts every turn so a correction ("eso es transporte, no
// comida") GENERALIZES to every future matching transaction. Service-role only.
// EVERY call degrades gracefully: if migration 024 isn't applied yet, loads
// return [] and saves no-op — production behavior is unchanged until approval.

const VALID_CATEGORIES = new Set<FinancialCategory>([
  "housing", "utilities", "food", "transport", "health", "education", "subscriptions",
  "debt", "shopping", "entertainment", "family", "savings", "income", "travel", "other",
]);

function asCategory(v: unknown): FinancialCategory | undefined {
  return typeof v === "string" && VALID_CATEGORIES.has(v as FinancialCategory) ? (v as FinancialCategory) : undefined;
}

/** Una lectura de memoria de comercios que reporta sobre sí misma. Ver `money-read.ts`.
 *  Sin correcciones guardadas es `ok:true` con lista vacía: no tener memoria es el
 *  estado normal de un usuario nuevo, no un fallo. */
export type MerchantMemoryRead =
  | { ok: true; complete: true; overrides: MerchantOverride[] }
  | { ok: true; complete: false; partial: MerchantOverride[] }
  | { ok: false; complete: false };

// Nadie corrige 500 comercios; el tope es una cota de sanidad. Pero "vi 500" y "hay
// 500" no pueden ser la misma frase, así que pedimos una más y dejamos que la fila
// extra pruebe que había cola. Ordenado por correction_count: lo que se trunca es lo
// menos corregido, nunca la corrección más insistida.
const MEMORY_CAP = 500;

/** La lectura que dice la verdad sobre sí misma.
 *
 *  Esto NO es camino de dinero, y la diferencia importa: `classifyTxn`
 *  (category-intelligence.ts:85) clasifica con la categoría ALMACENADA en la
 *  transacción — el comercio solo produce `categorySuggestion`, y solo cuando la
 *  categoría guardada es 'other'. Perder la memoria no cambia `category`,
 *  `spendingType`, `isSpend` ni `baseAmount`: no mueve un centavo del tanque ni del
 *  objetivo mensual. Degrada a la normalización por reglas — exactamente lo que ve
 *  un usuario que nunca corrigió nada.
 *
 *  Por eso el contrato tipado existe pero NADIE fail-closea con él: negar el Saldo
 *  por una memoria de comercios sería el error opuesto. Está aquí para que el día
 *  que alguien haga la sugerencia AUTORITATIVA (aplicar la categoría del comercio en
 *  vez de proponerla), el fallo ya sea distinguible y no llegue río abajo disfrazado
 *  de "este usuario nunca corrigió nada". Ese día, cambia el consumidor a
 *  `readMerchantMemory` y respeta su veredicto. */
export async function readMerchantMemory(userId: string): Promise<MerchantMemoryRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("user_merchant_memory")
      .select("match_pattern, merchant_family, category, is_recurring")
      .eq("user_id", userId)
      .order("correction_count", { ascending: false })
      .limit(MEMORY_CAP + 1);
    if (error || !data) return { ok: false, complete: false };
    const capped = data.length > MEMORY_CAP;
    const overrides = data
      .slice(0, MEMORY_CAP)
      .filter((r): r is { match_pattern: string; merchant_family: string | null; category: string | null; is_recurring: boolean | null } => Boolean(r?.match_pattern))
      .map((r) => ({
        matchPattern: String(r.match_pattern).toLowerCase().trim(),
        family: r.merchant_family ? String(r.merchant_family) : undefined,
        category: asCategory(r.category),
        isRecurring: r.is_recurring,
      }))
      .filter((o) => o.matchPattern.length >= 2);
    return capped ? { ok: true, complete: false, partial: overrides } : { ok: true, complete: true, overrides };
  } catch {
    return { ok: false, complete: false };
  }
}

/** Colapsa el fallo a "sin correcciones" — legítimo SOLO porque la memoria de
 *  comercios no decide dinero (ver `readMerchantMemory`). Todos sus consumidores
 *  clasifican con la categoría almacenada y usan el comercio para sugerir, detectar
 *  suscripciones y oler duplicados: perderla enfría insights, no infla números. */
export async function loadMerchantMemory(userId: string): Promise<MerchantOverride[]> {
  const read = await readMerchantMemory(userId);
  return read.ok ? (read.complete ? read.overrides : read.partial) : [];
}

export interface MerchantCorrection {
  matchPattern: string;
  family?: string;
  category?: FinancialCategory;
  spendingType?: string;
  isRecurring?: boolean | null;
  note?: string;
  source?: "user_correction" | "inferred" | "system";
}

// Upsert a learned merchant fact. A repeated correction bumps correction_count
// (a confidence signal) instead of duplicating. Returns true when persisted.
export async function saveMerchantCorrection(userId: string, c: MerchantCorrection): Promise<boolean> {
  const pattern = c.matchPattern?.toLowerCase().trim();
  if (!pattern || pattern.length < 2) return false;
  try {
    const supabase = createSupabaseAdminClient();
    // Esta lectura DECIDE entre UPDATE e INSERT. Un `error` ignorado se leía como
    // "no existe" y mandaba a insertar sobre una fila que sí estaba: la corrección
    // se perdía, y con ella el correction_count que mide cuánto insiste el usuario.
    // Un fallo de lectura no prueba una ausencia — no adivinamos, reintentamos.
    const { data: existing, error: readErr } = await supabase
      .from("user_merchant_memory")
      .select("id, correction_count")
      .eq("user_id", userId)
      .eq("match_pattern", pattern)
      .maybeSingle();
    if (readErr) return false;

    const nowISO = new Date().toISOString();
    if (existing?.id) {
      const { error } = await supabase
        .from("user_merchant_memory")
        .update({
          merchant_family: c.family ?? undefined,
          category: c.category ?? undefined,
          spending_type: c.spendingType ?? undefined,
          is_recurring: c.isRecurring ?? undefined,
          note: c.note ?? undefined,
          correction_count: (Number(existing.correction_count) || 1) + 1,
          updated_at: nowISO,
        })
        .eq("id", existing.id);
      return !error;
    }

    const { error } = await supabase.from("user_merchant_memory").insert({
      user_id: userId,
      match_pattern: pattern,
      merchant_family: c.family ?? null,
      category: c.category ?? null,
      spending_type: c.spendingType ?? null,
      is_recurring: c.isRecurring ?? null,
      note: c.note ?? null,
      source: c.source ?? "user_correction",
      correction_count: 1,
      updated_at: nowISO,
    });
    return !error;
  } catch {
    return false;
  }
}
