"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { parseTransactionWithBasicAdapter } from "@/lib/ai/basic-transaction-parser-adapter";
import { parseTransactionWithOpenAI } from "@/lib/ai/openai-transaction-parser";
import { parseTransaction } from "@/lib/ai/transaction-parser-router";
import type {
  TransactionParserContext,
  TransactionParserResult,
} from "@/lib/ai/transaction-parser-contract";
import {
  mapSupabaseAccount,
  mapSupabaseDebtAccount,
  mapSupabaseGoal,
  type SupabaseAccountRow,
  type SupabaseDebtAccountRow,
  type SupabaseGoalRow,
} from "@/lib/financial/supabase-mappers";
import type { UserFinancialPreferences } from "@/types/financial";

export type AiParserDevMode = "basic" | "ai" | "ai_with_basic_fallback";

export interface AiParserTestState {
  message: string;
  mode: AiParserDevMode;
  result?: TransactionParserResult;
  error?: string;
}

export async function testAiParserAction(
  _previousState: AiParserTestState,
  formData: FormData,
): Promise<AiParserTestState> {
  const message = String(formData.get("message") ?? "").trim();
  const mode = String(formData.get("mode") ?? "basic") as AiParserDevMode;

  if (!message) {
    return {
      message,
      mode,
      error: "Escribe un mensaje para probar el parser.",
    };
  }

  if (mode !== "basic" && mode !== "ai" && mode !== "ai_with_basic_fallback") {
    return {
      message,
      mode: "basic",
      error: "Modo de parser inválido.",
    };
  }

  try {
    const context = await loadParserContext();

    let result: TransactionParserResult;

    if (mode === "basic") {
      result = await parseTransactionWithBasicAdapter({
        message,
        source: "basic",
        context,
      });
    } else if (mode === "ai") {
      result = await parseTransactionWithOpenAI({
        message,
        source: "ai",
        context,
      });
    } else {
      result = await parseTransaction({
        message,
        context,
      });
    }

    return {
      message,
      mode,
      result,
    };
  } catch (error) {
    return {
      message,
      mode,
      error: error instanceof Error ? error.message : "Unknown AI parser test error",
    };
  }
}

async function loadParserContext(): Promise<TransactionParserContext> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Not authenticated");
  }

  const [accountsResult, debtAccountsResult, goalsResult, preferencesResult] =
    await Promise.all([
      supabase
        .from("accounts")
        .select(
          "id, user_id, name, type, currency, current_balance_original, current_balance_base, is_goal_account, created_at",
        )
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("debt_accounts")
        .select(
          "id, user_id, name, type, currency, current_balance_original, current_balance_base, minimum_payment, full_payment_due, due_day, cutoff_day, interest_rate, default_payment_account_id, created_at",
        )
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("goals")
        .select(
          "id, user_id, name, target_amount, currency, current_amount, target_date, goal_account_id, status, feasibility_status, weekly_required_amount, monthly_required_amount, created_at",
        )
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("user_financial_preferences")
        .select("user_id, default_source_type, default_source_id, created_at, updated_at")
        .eq("user_id", session.user.id)
        .maybeSingle(),
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

  if (preferencesResult.error) {
    throw new Error(preferencesResult.error.message);
  }

  const accounts = (accountsResult.data as SupabaseAccountRow[]).map(mapSupabaseAccount);
  const debtAccounts = (debtAccountsResult.data as SupabaseDebtAccountRow[]).map(
    mapSupabaseDebtAccount,
  );
  const goals = (goalsResult.data as SupabaseGoalRow[]).map(mapSupabaseGoal);

  const preferences: UserFinancialPreferences | null = preferencesResult.data
    ? {
        userId: preferencesResult.data.user_id,
        defaultSourceType: preferencesResult.data.default_source_type ?? undefined,
        defaultSourceId: preferencesResult.data.default_source_id ?? undefined,
        createdAt: preferencesResult.data.created_at,
        updatedAt: preferencesResult.data.updated_at,
      }
    : null;

  return {
    userId: session.user.id,
    baseCurrency: goals[0]?.currency ?? "USD",
    accounts,
    debtAccounts,
    goals,
    mainGoal: goals[0] ?? null,
    preferences,
  };
}
