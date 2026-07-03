import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { CurrencyCode, FinancialCategory } from "@/types/financial";

// Stage 32 (Item A4) — the typed writer for per-category monthly budgets
// (budget_categories). Onboarding seeds these rows with the user's session
// client; this module is the CHAT path ("sí, actualízalo", "mi presupuesto de
// comida ahora es 650k") used by the update_budget_category agent tool. The
// amount is ALWAYS stored in the user's base currency (the caller converts
// with a KNOWN fx rate — never a fabricated 1:1). Plan data only: no money
// moves here, the transaction ledger is untouched.

export async function upsertBudgetCategoryAmount(input: {
  userId: string;
  category: FinancialCategory;
  amount: number; // monthly, in base currency
  currency: CurrencyCode; // the user's base currency
}): Promise<boolean> {
  if (!Number.isFinite(input.amount) || input.amount < 0) return false;
  try {
    const supabase = createSupabaseAdminClient();
    // Same conflict target the onboarding seed uses (user_id, category, period):
    // updating an existing budget keeps its row (and id); a new category creates it.
    const { data, error } = await supabase
      .from("budget_categories")
      .upsert(
        {
          user_id: input.userId,
          category: input.category,
          amount: input.amount,
          currency: input.currency,
          period: "monthly",
          is_active: true,
        },
        { onConflict: "user_id,category,period" },
      )
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
