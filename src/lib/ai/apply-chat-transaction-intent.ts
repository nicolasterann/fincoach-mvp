import { buildChatTransactionSuccessResult } from "@/lib/ai/chat-transaction-result";
import type { ChatResponseFinancialContext } from "@/lib/ai/chat-response-mapper";
import { buildFinancialDashboard } from "@/lib/financial/dashboard";
import {
  mapSupabaseAccount,
  mapSupabaseDebtAccount,
  mapSupabaseGoal,
  type SupabaseAccountRow,
  type SupabaseDebtAccountRow,
  type SupabaseGoalRow,
} from "@/lib/financial/supabase-mappers";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { Account, DebtAccount, FinancialGoal } from "@/types/financial";
import type { TransactionParserResult } from "@/lib/ai/transaction-parser-contract";
import type { TransactionIntent } from "@/types/transaction-intents";

export interface ApplyChatTransactionIntentInput {
  userId: string;
  message: string;
  intent: TransactionIntent;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  parserSource?: TransactionParserResult["source"];
  parserConfidenceScore?: number;
}

export async function applyChatTransactionIntent({
  userId,
  message,
  intent,
  accounts,
  debtAccounts,
  goals,
  parserSource,
  parserConfidenceScore,
}: ApplyChatTransactionIntentInput) {
  const supabase = createSupabaseAdminClient();

  if (intent.type === "income") {
    const destinationAccount = accounts.find(
      (account) => account.id === intent.destinationAccountId,
    );

    if (!destinationAccount) {
      throw new Error("chat-income-account-not-found");
    }

    const { error: transactionError } = await supabase.from("transactions").insert({
      user_id: userId,
      type: "income",
      description: intent.description,
      category: intent.category,
      original_amount: intent.originalAmount,
      original_currency: intent.originalCurrency,
      exchange_rate_to_base: intent.exchangeRateToBase ?? 1,
      base_amount: intent.originalAmount * (intent.exchangeRateToBase ?? 1),
      base_currency: intent.baseCurrency ?? intent.originalCurrency,
      destination_account_id: intent.destinationAccountId,
      confidence_score: intent.confidenceScore,
      raw_input: message,
      input_channel: "chat",
      occurred_at: new Date().toISOString(),
    });

    if (transactionError) {
      throw new Error(transactionError.message);
    }

    const { error: accountUpdateError } = await supabase
      .from("accounts")
      .update({
        current_balance_original:
          destinationAccount.currentBalanceOriginal + intent.originalAmount,
        current_balance_base: destinationAccount.currentBalanceBase + intent.originalAmount,
      })
      .eq("id", intent.destinationAccountId)
      .eq("user_id", userId);

    if (accountUpdateError) {
      throw new Error(accountUpdateError.message);
    }

    const financialContext = await loadChatResponseFinancialContext(userId);

    return buildChatTransactionSuccessResult({
      intent,
      accountName: destinationAccount.name,
      financialContext,
      parserSource,
      parserConfidenceScore,
    });
  }

  if (intent.type === "debt_payment") {
    const sourceAccount = accounts.find((account) => account.id === intent.sourceAccountId);
    const debtAccount = debtAccounts.find((debt) => debt.id === intent.debtAccountId);

    if (!sourceAccount) {
      throw new Error("chat-parser-account-not-found");
    }

    if (!debtAccount) {
      throw new Error("chat-parser-debt-account-not-found");
    }

    const { error: transactionError } = await supabase.from("transactions").insert({
      user_id: userId,
      type: "debt_payment",
      description: intent.description,
      category: intent.category,
      original_amount: intent.originalAmount,
      original_currency: intent.originalCurrency,
      exchange_rate_to_base: intent.exchangeRateToBase ?? 1,
      base_amount: intent.originalAmount * (intent.exchangeRateToBase ?? 1),
      base_currency: intent.baseCurrency ?? intent.originalCurrency,
      source_account_id: intent.sourceAccountId,
      debt_account_id: intent.debtAccountId,
      confidence_score: intent.confidenceScore,
      raw_input: message,
      input_channel: "chat",
      occurred_at: new Date().toISOString(),
    });

    if (transactionError) {
      throw new Error(transactionError.message);
    }

    const { error: sourceAccountUpdateError } = await supabase
      .from("accounts")
      .update({
        current_balance_original: sourceAccount.currentBalanceOriginal - intent.originalAmount,
        current_balance_base: sourceAccount.currentBalanceBase - intent.originalAmount,
      })
      .eq("id", intent.sourceAccountId)
      .eq("user_id", userId);

    if (sourceAccountUpdateError) {
      throw new Error(sourceAccountUpdateError.message);
    }

    const newDebtOriginalBalance = Math.max(
      debtAccount.currentBalanceOriginal - intent.originalAmount,
      0,
    );
    const newDebtBaseBalance = Math.max(
      debtAccount.currentBalanceBase - intent.originalAmount,
      0,
    );

    const { error: debtAccountUpdateError } = await supabase
      .from("debt_accounts")
      .update({
        current_balance_original: newDebtOriginalBalance,
        current_balance_base: newDebtBaseBalance,
      })
      .eq("id", intent.debtAccountId)
      .eq("user_id", userId);

    if (debtAccountUpdateError) {
      throw new Error(debtAccountUpdateError.message);
    }

    const financialContext = await loadChatResponseFinancialContext(userId);

    return buildChatTransactionSuccessResult({
      intent,
      accountName: sourceAccount.name,
      debtAccountName: debtAccount.name,
      financialContext,
      parserSource,
      parserConfidenceScore,
    });
  }

  if (intent.type === "goal_contribution") {
    const sourceAccount = accounts.find((account) => account.id === intent.sourceAccountId);
    const goal = goals.find((item) => item.id === intent.goalId);

    if (!sourceAccount) {
      throw new Error("chat-parser-account-not-found");
    }

    if (!goal) {
      throw new Error("chat-parser-goal-not-found");
    }

    const { error: transactionError } = await supabase.from("transactions").insert({
      user_id: userId,
      type: "goal_contribution",
      description: intent.description,
      category: intent.category,
      original_amount: intent.originalAmount,
      original_currency: intent.originalCurrency,
      exchange_rate_to_base: intent.exchangeRateToBase ?? 1,
      base_amount: intent.originalAmount * (intent.exchangeRateToBase ?? 1),
      base_currency: intent.baseCurrency ?? intent.originalCurrency,
      source_account_id: intent.sourceAccountId,
      destination_account_id: intent.destinationAccountId || null,
      goal_id: intent.goalId,
      confidence_score: intent.confidenceScore,
      raw_input: message,
      input_channel: "chat",
      occurred_at: new Date().toISOString(),
    });

    if (transactionError) {
      throw new Error(transactionError.message);
    }

    const { error: sourceAccountUpdateError } = await supabase
      .from("accounts")
      .update({
        current_balance_original: sourceAccount.currentBalanceOriginal - intent.originalAmount,
        current_balance_base: sourceAccount.currentBalanceBase - intent.originalAmount,
      })
      .eq("id", intent.sourceAccountId)
      .eq("user_id", userId);

    if (sourceAccountUpdateError) {
      throw new Error(sourceAccountUpdateError.message);
    }

    if (intent.destinationAccountId) {
      const goalAccount = accounts.find((account) => account.id === intent.destinationAccountId);

      if (goalAccount) {
        const { error: goalAccountUpdateError } = await supabase
          .from("accounts")
          .update({
            current_balance_original:
              goalAccount.currentBalanceOriginal + intent.originalAmount,
            current_balance_base: goalAccount.currentBalanceBase + intent.originalAmount,
          })
          .eq("id", intent.destinationAccountId)
          .eq("user_id", userId);

        if (goalAccountUpdateError) {
          throw new Error(goalAccountUpdateError.message);
        }
      }
    }

    const { error: goalUpdateError } = await supabase
      .from("goals")
      .update({
        current_amount: goal.currentAmount + intent.originalAmount,
      })
      .eq("id", intent.goalId)
      .eq("user_id", userId);

    if (goalUpdateError) {
      throw new Error(goalUpdateError.message);
    }

    const financialContext = await loadChatResponseFinancialContext(userId);

    return buildChatTransactionSuccessResult({
      intent,
      goalName: goal.name,
      financialContext,
      parserSource,
      parserConfidenceScore,
    });
  }

  if (intent.type === "expense") {
    const account = intent.sourceAccountId
      ? accounts.find((item) => item.id === intent.sourceAccountId)
      : undefined;
    const debtAccount = intent.debtAccountId
      ? debtAccounts.find((item) => item.id === intent.debtAccountId)
      : undefined;

    const { error: transactionError } = await supabase.from("transactions").insert({
      user_id: userId,
      type: "expense",
      description: intent.description,
      category: intent.category,
      original_amount: intent.originalAmount,
      original_currency: intent.originalCurrency,
      exchange_rate_to_base: intent.exchangeRateToBase ?? 1,
      base_amount: intent.originalAmount * (intent.exchangeRateToBase ?? 1),
      base_currency: intent.baseCurrency ?? intent.originalCurrency,
      source_account_id: intent.sourceAccountId ?? null,
      debt_account_id: intent.debtAccountId ?? null,
      confidence_score: intent.confidenceScore,
      raw_input: message,
      input_channel: "chat",
      occurred_at: new Date().toISOString(),
    });

    if (transactionError) {
      throw new Error(transactionError.message);
    }

    if (intent.sourceAccountId) {
      if (!account) {
        throw new Error("chat-parser-account-not-found");
      }

      const { error: accountUpdateError } = await supabase
        .from("accounts")
        .update({
          current_balance_original: account.currentBalanceOriginal - intent.originalAmount,
          current_balance_base: account.currentBalanceBase - intent.originalAmount,
        })
        .eq("id", intent.sourceAccountId)
        .eq("user_id", userId);

      if (accountUpdateError) {
        throw new Error(accountUpdateError.message);
      }
    }

    if (intent.debtAccountId) {
      if (!debtAccount) {
        throw new Error("chat-parser-debt-account-not-found");
      }

      const { error: debtUpdateError } = await supabase
        .from("debt_accounts")
        .update({
          current_balance_original: debtAccount.currentBalanceOriginal + intent.originalAmount,
          current_balance_base: debtAccount.currentBalanceBase + intent.originalAmount,
        })
        .eq("id", intent.debtAccountId)
        .eq("user_id", userId);

      if (debtUpdateError) {
        throw new Error(debtUpdateError.message);
      }
    }

    const financialContext = await loadChatResponseFinancialContext(userId);

    return buildChatTransactionSuccessResult({
      intent,
      accountName: account?.name,
      debtAccountName: debtAccount?.name,
      financialContext,
      parserSource,
      parserConfidenceScore,
    });
  }

  throw new Error("chat-parser-unsupported");
}

async function loadChatResponseFinancialContext(
  userId: string,
): Promise<ChatResponseFinancialContext | undefined> {
  const supabase = createSupabaseAdminClient();

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
      .select(
        "id, user_id, name, type, currency, current_balance_original, current_balance_base, minimum_payment, full_payment_due, due_day, cutoff_day, interest_rate, default_payment_account_id, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("goals")
      .select(
        "id, user_id, name, target_amount, currency, current_amount, target_date, goal_account_id, status, feasibility_status, weekly_required_amount, monthly_required_amount, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
  ]);

  if (accountsResult.error || debtAccountsResult.error || goalsResult.error) {
    return undefined;
  }

  const accounts = (accountsResult.data as SupabaseAccountRow[]).map(mapSupabaseAccount);
  const debtAccounts = (debtAccountsResult.data as SupabaseDebtAccountRow[]).map(
    mapSupabaseDebtAccount,
  );
  const goals = (goalsResult.data as SupabaseGoalRow[]).map(mapSupabaseGoal);
  const mainGoal = goals[0];

  if (!mainGoal) {
    return undefined;
  }

  const dashboard = buildFinancialDashboard({
    accounts,
    debtAccounts,
    recurringExpenses: [],
    variableBudgetEstimates: [],
    goal: mainGoal,
    monthlyIncome: 1000,
    estimatedMonthlySavingsCapacity: 100,
    monthsRemainingForGoal: 6,
  });

  return {
    flexibleSpending: dashboard.flexibleSpending.flexibleSpending,
    dailySuggestedLimit: dashboard.weeklyPlan.dailySuggestedLimit,
    baseCurrency: dashboard.weeklyPlan.baseCurrency,
  };
}
