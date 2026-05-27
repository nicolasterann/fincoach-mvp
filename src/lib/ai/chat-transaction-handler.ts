import { applyChatTransactionIntent } from "@/lib/ai/apply-chat-transaction-intent";
import {
  buildChatTransactionClarificationResult,
  buildChatTransactionFailedResult,
  buildChatTransactionUnsupportedResult,
} from "@/lib/ai/chat-transaction-result";
import { parseTransaction } from "@/lib/ai/transaction-parser-router";
import { detectTransactionPrefilter } from "@/lib/ai/transaction-prefilter";
import { matchFixedExpense } from "@/lib/financial/fixed-expense-matcher";
import {
  mapSupabaseFixedExpense,
  type SupabaseFixedExpenseRow,
} from "@/lib/financial/onboarding-context-mappers";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { CurrencyCode } from "@/types/financial";
import type { ExpenseIntent } from "@/types/transaction-intents";

export interface HandleChatTransactionMessageInput {
  userId: string;
  message: string;
}

export async function handleChatTransactionMessage({
  userId,
  message,
}: HandleChatTransactionMessageInput) {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    return buildChatTransactionClarificationResult({
      clarificationQuestion:
        "Mándame el movimiento en una frase simple, por ejemplo: cafe 3 pichincha.",
    });
  }

  // Catch a few shapes that would otherwise silently lose information
  // or fake a registration the financial engine cannot honor (multi-
  // transaction, transfers, refunds, cancellations, vague payments).
  // See src/lib/ai/transaction-prefilter.ts for the full rule set.
  const prefilter = detectTransactionPrefilter(trimmedMessage);
  if (prefilter) {
    return buildChatTransactionClarificationResult({
      clarificationQuestion: prefilter.clarificationQuestion,
    });
  }

  const supabase = createSupabaseAdminClient();

  const [accountsResult, debtAccountsResult, goalsResult, preferencesResult, fixedExpensesResult] = await Promise.all([
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
      supabase
        .from("user_financial_preferences")
        .select("user_id, default_source_type, default_source_id, created_at, updated_at")
        .eq("user_id", userId)
        .maybeSingle(),
    supabase
      .from("fixed_expenses")
      .select(
        "id, user_id, name, amount, currency, category, frequency, expected_day, expected_weekday, payment_source_type, payment_source_id, is_essential, is_active, notes, created_at",
      )
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
  ]);

  if (
    accountsResult.error ||
    debtAccountsResult.error ||
    goalsResult.error ||
    preferencesResult.error
  ) {
    const errorMessage =
      accountsResult.error?.message ??
      debtAccountsResult.error?.message ??
      goalsResult.error?.message ??
      preferencesResult.error?.message ??
      "Unknown context loading error";

    return buildChatTransactionClarificationResult({
      clarificationQuestion: `No pude leer tu contexto financiero completo: ${errorMessage}`,
    });
  }

  const accounts = (accountsResult.data ?? []).map((account) => ({
    id: account.id,
    userId: account.user_id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    currentBalanceOriginal: Number(account.current_balance_original),
    currentBalanceBase: Number(account.current_balance_base),
    isGoalAccount: account.is_goal_account,
    createdAt: account.created_at,
  }));

  const debtAccounts = (debtAccountsResult.data ?? []).map((debt) => ({
    id: debt.id,
    userId: debt.user_id,
    name: debt.name,
    type: debt.type,
    currency: debt.currency,
    currentBalanceOriginal: Number(debt.current_balance_original),
    currentBalanceBase: Number(debt.current_balance_base),
    minimumPayment: debt.minimum_payment === null ? undefined : Number(debt.minimum_payment),
    fullPaymentDue: debt.full_payment_due === null ? undefined : Number(debt.full_payment_due),
    dueDay: debt.due_day ?? undefined,
    cutoffDay: debt.cutoff_day ?? undefined,
    interestRate: debt.interest_rate === null ? undefined : Number(debt.interest_rate),
    defaultPaymentAccountId: debt.default_payment_account_id ?? undefined,
    createdAt: debt.created_at,
  }));

  const preferences = preferencesResult.data
    ? {
        userId: preferencesResult.data.user_id,
        defaultSourceType: preferencesResult.data.default_source_type ?? undefined,
        defaultSourceId: preferencesResult.data.default_source_id ?? undefined,
        createdAt: preferencesResult.data.created_at,
        updatedAt: preferencesResult.data.updated_at,
      }
    : null;

  const goals = (goalsResult.data ?? []).map((goal) => ({
    id: goal.id,
    userId: goal.user_id,
    name: goal.name,
    targetAmount: Number(goal.target_amount),
    currency: goal.currency,
    currentAmount: Number(goal.current_amount),
    targetDate: goal.target_date ?? "",
    goalAccountId: goal.goal_account_id ?? undefined,
    status: goal.status,
    feasibilityStatus: goal.feasibility_status,
    weeklyRequiredAmount: Number(goal.weekly_required_amount),
    monthlyRequiredAmount: Number(goal.monthly_required_amount),
    createdAt: goal.created_at,
  }));

  const fixedExpenses = (fixedExpensesResult.data ?? []).map((row) =>
    mapSupabaseFixedExpense(row as SupabaseFixedExpenseRow),
  );

  const fixedExpenseMatch = matchFixedExpense(trimmedMessage, fixedExpenses, accounts);

  if (fixedExpenseMatch.status === "ambiguous" || fixedExpenseMatch.status === "amount_mismatch") {
    return buildChatTransactionClarificationResult({
      clarificationQuestion: fixedExpenseMatch.clarificationQuestion,
    });
  }

  if (
    fixedExpenseMatch.status === "confident_match" &&
    fixedExpenseMatch.matchedExpense &&
    fixedExpenseMatch.messageAmount !== undefined
  ) {
    const matched = fixedExpenseMatch.matchedExpense;
    const expenseIntent: ExpenseIntent = {
      type: "expense",
      description: matched.name,
      originalAmount: fixedExpenseMatch.messageAmount,
      originalCurrency: matched.currency as CurrencyCode,
      confidenceScore: 0.95,
      status: "ready",
      category: matched.category,
      sourceAccountId: fixedExpenseMatch.resolvedAccount?.id,
    };

    try {
      return await applyChatTransactionIntent({
        userId,
        message: trimmedMessage,
        intent: expenseIntent,
        accounts,
        debtAccounts,
        goals,
        parserSource: "basic",
        parserConfidenceScore: 0.95,
        recurringExpenseId: matched.id,
        fixedExpenseName: matched.name,
      });
    } catch {
      return buildChatTransactionFailedResult();
    }
  }

  const parserResult = await parseTransaction({
    message: trimmedMessage,
    context: {
      userId,
      baseCurrency: goals[0]?.currency ?? "USD",
      accounts,
      debtAccounts,
      goals,
      mainGoal: goals[0] ?? null,
        preferences,
    },
  });

  if (parserResult.status === "unsupported") {
    return buildChatTransactionUnsupportedResult({
      parserSource: parserResult.source,
      parserConfidenceScore: parserResult.confidenceScore,
    });
  }

  if (parserResult.status !== "ready" || !parserResult.intent) {
    return buildChatTransactionClarificationResult({
      clarificationQuestion:
        parserResult.clarificationQuestion ??
        "Casi lo tengo, pero necesito un dato más para registrarlo bien.",
      parserSource: parserResult.source,
      parserConfidenceScore: parserResult.confidenceScore,
    });
  }

  try {
    return await applyChatTransactionIntent({
      userId,
      message: trimmedMessage,
      intent: parserResult.intent,
      accounts,
      debtAccounts,
      goals,
        parserSource: parserResult.source,
        parserConfidenceScore: parserResult.confidenceScore,
    });
  } catch {
    return buildChatTransactionFailedResult();
  }
}
