import { buildChatTransactionSuccessResult } from "@/lib/ai/chat-transaction-result";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { Account, DebtAccount, FinancialGoal } from "@/types/financial";
import type { TransactionIntent } from "@/types/transaction-intents";

export interface ApplyChatTransactionIntentInput {
  userId: string;
  message: string;
  intent: TransactionIntent;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
}

export async function applyChatTransactionIntent({
  userId,
  message,
  intent,
  accounts,
  debtAccounts,
  goals,
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

    return buildChatTransactionSuccessResult({
      intent,
      accountName: destinationAccount.name,
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

    return buildChatTransactionSuccessResult({
      intent,
      goalName: goal.name,
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

    return buildChatTransactionSuccessResult({
      intent,
      accountName: account?.name,
      debtAccountName: debtAccount?.name,
    });
  }

  throw new Error("chat-parser-unsupported");
}
