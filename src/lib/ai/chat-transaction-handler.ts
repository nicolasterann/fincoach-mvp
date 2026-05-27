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
  looksLikeExplicitGoalContribution,
  resolveGoalTarget,
} from "@/lib/financial/goal-target-resolver";
import { inferExpectedPaymentSource } from "@/lib/financial/payment-source-resolver";
import {
  mapSupabaseFixedExpense,
  type SupabaseFixedExpenseRow,
} from "@/lib/financial/onboarding-context-mappers";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type {
  Account,
  CurrencyCode,
  DebtAccount,
  FinancialGoal,
} from "@/types/financial";
import type { ExpenseIntent, TransactionIntent } from "@/types/transaction-intents";

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

  // Mode-agnostic, pre-parser goal-target guard. The post-parser guard
  // only fires when the parser already returned a ready
  // goal_contribution intent. In AI parser mode the AI may instead
  // return "unsupported" or pick a different intent type for messages
  // like "mandé 20 a boda" → safety would be bypassed. This deterministic
  // early check verifies the user's named goal against the user's actual
  // goals BEFORE any parser runs.
  if (looksLikeExplicitGoalContribution(trimmedMessage)) {
    const resolution = resolveGoalTarget(trimmedMessage, goals);
    if (resolution.kind === "unresolved") {
      const wrote = resolution.unresolvedName ?? "";
      const mainGoal = goals[0] ?? null;
      const clarification = mainGoal
        ? `Tengo "${mainGoal.name}" como tu meta principal, pero escribiste "${wrote}". Para no moverlo mal, confirma si va a ${mainGoal.name}.`
        : `Escribiste "${wrote}" pero no tengo esa meta guardada. ¿Quieres crearla primero o usar otra?`;
      return buildChatTransactionClarificationResult({
        clarificationQuestion: clarification,
      });
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

  // Mode-agnostic goal-name guard. The basic parser flags this case
  // internally, but AI parser results bypass that branch entirely. We
  // re-check here so any parser path is held to the same safety bar:
  // if the user named a goal that does not match the parser's target
  // goal (or any user goal), we never silently apply the contribution.
  const goalGuard = enforceGoalNameMatch({
    message: trimmedMessage,
    intent: parserResult.intent,
    goals,
    mainGoal: goals[0] ?? null,
  });

  if (goalGuard) {
    return buildChatTransactionClarificationResult({
      clarificationQuestion: goalGuard,
      parserSource: parserResult.source,
      parserConfidenceScore: parserResult.confidenceScore,
    });
  }

  // Mode-agnostic payment-source guard. If the user explicitly named a
  // source in the raw text (e.g. "café 3 pichincha") and the parser
  // chose a different source (e.g. Visa Pichincha because it shares a
  // token), block the DB write and ask for confirmation. Same rule for
  // the reverse case (user said "visa" but parser picked the account).
  const sourceGuard = enforcePaymentSourceMatch({
    message: trimmedMessage,
    intent: parserResult.intent,
    accounts,
    debtAccounts,
  });

  if (sourceGuard) {
    return buildChatTransactionClarificationResult({
      clarificationQuestion: sourceGuard,
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

function enforcePaymentSourceMatch({
  message,
  intent,
  accounts,
  debtAccounts,
}: {
  message: string;
  intent: TransactionIntent;
  accounts: Account[];
  debtAccounts: DebtAccount[];
}): string | null {
  if (intent.type !== "expense" && intent.type !== "debt_payment") return null;

  const expected = inferExpectedPaymentSource(message, accounts, debtAccounts);

  if (expected.kind === "none" || expected.kind === "ambiguous") {
    // User did not clearly name a single source; trust the parser's
    // pick (it may be using the user's saved default).
    return null;
  }

  if (intent.type === "expense") {
    const intentAccount = intent.sourceAccountId
      ? accounts.find((account) => account.id === intent.sourceAccountId)
      : undefined;
    const intentDebt = intent.debtAccountId
      ? debtAccounts.find((debt) => debt.id === intent.debtAccountId)
      : undefined;

    if (expected.kind === "account" && expected.account) {
      if (intentDebt) {
        return `Escribiste ${expected.account.name}, pero iba a registrarlo en ${intentDebt.name}. Para no moverlo mal, confirma si fue con ${expected.account.name} o con ${intentDebt.name}.`;
      }
      if (intentAccount && intentAccount.id !== expected.account.id) {
        return `Escribiste ${expected.account.name}, pero iba a registrarlo en ${intentAccount.name}. Confirma cuál fue.`;
      }
      return null;
    }

    if (expected.kind === "debt" && expected.debtAccount) {
      if (intentAccount && !intentDebt) {
        return `Escribiste ${expected.debtAccount.name}, pero iba a registrarlo en ${intentAccount.name}. Para no moverlo mal, confirma si fue con ${expected.debtAccount.name} o con ${intentAccount.name}.`;
      }
      if (intentDebt && intentDebt.id !== expected.debtAccount.id) {
        return `Escribiste ${expected.debtAccount.name}, pero iba a registrarlo en ${intentDebt.name}. Confirma cuál fue.`;
      }
      return null;
    }

    return null;
  }

  // debt_payment: validate the source account the user named matches
  // the parser's source. The debt account in a debt_payment is the
  // user's target, not the payment source, so we only guard the
  // source side here.
  if (intent.type === "debt_payment") {
    if (expected.kind === "account" && expected.account && intent.sourceAccountId) {
      if (intent.sourceAccountId !== expected.account.id) {
        const parserAccount = accounts.find(
          (account) => account.id === intent.sourceAccountId,
        );
        if (parserAccount) {
          return `Escribiste ${expected.account.name} como cuenta de origen, pero iba a usar ${parserAccount.name}. Confirma cuál fue.`;
        }
      }
    }
    return null;
  }

  return null;
}

function enforceGoalNameMatch({
  message,
  intent,
  goals,
  mainGoal,
}: {
  message: string;
  intent: { type: string; goalId?: string };
  goals: FinancialGoal[];
  mainGoal: FinancialGoal | null;
}): string | null {
  if (intent.type !== "goal_contribution") return null;

  const resolution = resolveGoalTarget(message, goals);

  if (resolution.kind === "unresolved") {
    const wrote = resolution.unresolvedName ?? "";
    return mainGoal
      ? `Tengo "${mainGoal.name}" como tu meta principal, pero escribiste "${wrote}". Para no moverlo mal, confirma si va a ${mainGoal.name}.`
      : `Escribiste "${wrote}" pero no tengo esa meta guardada. ¿Quieres crearla primero o usar otra?`;
  }

  if (resolution.kind === "matched") {
    const targetGoal = resolution.matchedGoal;
    if (targetGoal && intent.goalId && targetGoal.id !== intent.goalId) {
      const parserPickedName =
        goals.find((goal) => goal.id === intent.goalId)?.name ?? mainGoal?.name;
      return parserPickedName
        ? `Escribiste "${targetGoal.name}", pero iba a registrarlo en "${parserPickedName}". Para no moverlo mal, confirma si va a ${targetGoal.name}.`
        : `Escribiste "${targetGoal.name}", pero no estoy seguro de a qué meta debería ir. Confirma si va a ${targetGoal.name}.`;
    }
  }

  return null;
}
