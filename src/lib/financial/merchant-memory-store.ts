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

type MerchantCorrectionRpc = (
  name: string,
  payload: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;

export function merchantCorrectionWriteSucceeded(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const row = data as { outcome?: unknown; memory_id?: unknown; correction_count?: unknown };
  return (
    (row.outcome === "created" || row.outcome === "updated" || row.outcome === "replayed") &&
    typeof row.memory_id === "string" &&
    row.memory_id.length > 0 &&
    Number.isInteger(Number(row.correction_count)) &&
    Number(row.correction_count) >= 1
  );
}

/** Atomic, idempotent merchant learning.
 *
 * The former read → update/insert sequence had two independent false-success
 * routes: an UPDATE that matched zero rows still returned true, and two
 * concurrent corrections both derived the same `correction_count + 1`. The RPC
 * introduced in migration 088 serializes the operation identity, validates its
 * fingerprint, and increments the counter in PostgreSQL in the same transaction.
 */
export async function saveMerchantCorrectionWith(
  rpc: MerchantCorrectionRpc,
  userId: string,
  c: MerchantCorrection,
  operationId: string,
): Promise<boolean> {
  const pattern = c.matchPattern?.toLowerCase().trim();
  const operation = operationId.trim();
  if (!pattern || pattern.length < 2 || !operation) return false;
  try {
    const body: Record<string, unknown> = {
      user_id: userId,
      operation_id: operation,
      match_pattern: pattern,
      source: c.source ?? "user_correction",
      ...(c.family !== undefined ? { merchant_family: c.family } : {}),
      ...(c.category !== undefined ? { category: c.category } : {}),
      ...(c.spendingType !== undefined ? { spending_type: c.spendingType } : {}),
      ...(c.isRecurring !== undefined ? { is_recurring: c.isRecurring } : {}),
      ...(c.note !== undefined ? { note: c.note } : {}),
    };
    const { data, error } = await rpc("kipu_save_merchant_correction", {
      p: body,
    });
    return !error && merchantCorrectionWriteSucceeded(data);
  } catch {
    return false;
  }
}

export async function saveMerchantCorrection(
  userId: string,
  c: MerchantCorrection,
  operationId: string,
): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  return saveMerchantCorrectionWith(
    (name, payload) => supabase.rpc(name, payload),
    userId,
    c,
    operationId,
  );
}
