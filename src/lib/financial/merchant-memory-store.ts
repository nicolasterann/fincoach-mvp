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

export async function loadMerchantMemory(userId: string): Promise<MerchantOverride[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("user_merchant_memory")
      .select("match_pattern, merchant_family, category, is_recurring")
      .eq("user_id", userId)
      .order("correction_count", { ascending: false })
      .limit(500);
    if (error || !data) return [];
    return data
      .filter((r): r is { match_pattern: string; merchant_family: string | null; category: string | null; is_recurring: boolean | null } => Boolean(r?.match_pattern))
      .map((r) => ({
        matchPattern: String(r.match_pattern).toLowerCase().trim(),
        family: r.merchant_family ? String(r.merchant_family) : undefined,
        category: asCategory(r.category),
        isRecurring: r.is_recurring,
      }))
      .filter((o) => o.matchPattern.length >= 2);
  } catch {
    return [];
  }
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
    const { data: existing } = await supabase
      .from("user_merchant_memory")
      .select("id, correction_count")
      .eq("user_id", userId)
      .eq("match_pattern", pattern)
      .maybeSingle();

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
