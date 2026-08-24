import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  mapSupabaseAccount,
  mapSupabaseDebtAccount,
  mapSupabaseGoal,
  type SupabaseAccountRow,
  type SupabaseDebtAccountRow,
  type SupabaseGoalRow,
} from "@/lib/financial/supabase-mappers";

export async function loadUserFinancialData(userId: string) {
  const supabase = await createSupabaseServerClient();

  const [accountsResult, debtAccountsResult, goalsResult] = await Promise.all([
    supabase
      .from("accounts")
      .select(
        "id, user_id, name, type, currency, current_balance_original, current_balance_base, is_goal_account, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("debt_accounts")
      // `*` so Stage 14 columns (migration 023) load when present and degrade
      // gracefully (absent → undefined) before 023 is applied.
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("goals")
      .select(
        "id, user_id, name, target_amount, currency, current_amount, target_date, goal_account_id, funding_account_id, status, feasibility_status, weekly_required_amount, monthly_required_amount, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
  ]);

  if (accountsResult.error) {
    throw new Error(accountsResult.error.message);
  }

  if (debtAccountsResult.error) {
    throw new Error(debtAccountsResult.error.message);
  }

  if (goalsResult.error) {
    throw new Error(goalsResult.error.message);
  }

  const accounts = (accountsResult.data as SupabaseAccountRow[]).map(mapSupabaseAccount);
  const debtAccounts = (debtAccountsResult.data as SupabaseDebtAccountRow[]).map(
    mapSupabaseDebtAccount,
  );
  const goals = (goalsResult.data as SupabaseGoalRow[]).map(mapSupabaseGoal);

  return {
    accounts,
    debtAccounts,
    goals,
    mainGoal: goals[0] ?? null,
  };
}
