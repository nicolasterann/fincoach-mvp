import {
  buildChatActionResult,
  buildChatTransactionSuccessResult,
  type ChatTransactionResult,
} from "@/lib/ai/chat-transaction-result";
import type { ChatResponseFinancialContext } from "@/lib/ai/chat-response-mapper";
import type { GoalPlanSummary } from "@/lib/ai/goal-aware-response-copy";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import type { StoredTransaction } from "@/lib/financial/transaction-recovery";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { Account, DebtAccount, FinancialGoal } from "@/types/financial";
import type { TransactionParserResult } from "@/lib/ai/transaction-parser-contract";
import type { TransactionIntent } from "@/types/transaction-intents";

// Money in Kipu voice for the deterministic confirmation copy this module
// owns (transfer / undo / correction): "50$" / "3.50$", sign after the number.
function kipuMoney(amount: number, currency: string): string {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

function channelToInputChannel(channel?: ChatChannel): string {
  return channel === "web" ? "web" : "chat";
}

export interface ApplyChatTransactionIntentInput {
  userId: string;
  message: string;
  intent: TransactionIntent;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  parserSource?: TransactionParserResult["source"];
  parserConfidenceScore?: number;
  recurringExpenseId?: string;
  fixedExpenseName?: string;
  channel?: ChatChannel;
  chatId?: string | null;
  // When set, the success result uses this exact message and skips the
  // coach-response/OpenAI call entirely (caller already owns final copy).
  coachMessageOverride?: string;
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
  recurringExpenseId,
  fixedExpenseName,
  channel,
  chatId,
  coachMessageOverride,
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
      userId,
      channel,
      chatId,
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
      userId,
      channel,
      chatId,
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
      userId,
      channel,
      chatId,
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
      recurring_expense_id: recurringExpenseId ?? null,
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
      fixedExpenseName,
      userId,
      channel,
      chatId,
      coachMessageOverride,
    });
  }

  if (intent.type === "refund") {
    const destination = accounts.find(
      (item) => item.id === intent.destinationAccountId,
    );
    if (!destination) {
      throw new Error("chat-refund-account-not-found");
    }

    const { error: transactionError } = await supabase.from("transactions").insert({
      user_id: userId,
      type: "refund",
      description: intent.description,
      category: intent.category ?? "other",
      original_amount: intent.originalAmount,
      original_currency: intent.originalCurrency,
      exchange_rate_to_base: intent.exchangeRateToBase ?? 1,
      base_amount: intent.originalAmount * (intent.exchangeRateToBase ?? 1),
      base_currency: intent.baseCurrency ?? intent.originalCurrency,
      destination_account_id: intent.destinationAccountId,
      related_transaction_id: intent.relatedTransactionId ?? null,
      confidence_score: intent.confidenceScore,
      raw_input: message,
      input_channel: channelToInputChannel(channel),
      occurred_at: new Date().toISOString(),
    });
    if (transactionError) {
      throw new Error(transactionError.message);
    }

    const { error: accountUpdateError } = await supabase
      .from("accounts")
      .update({
        current_balance_original:
          destination.currentBalanceOriginal + intent.originalAmount,
        current_balance_base: destination.currentBalanceBase + intent.originalAmount,
      })
      .eq("id", destination.id)
      .eq("user_id", userId);
    if (accountUpdateError) {
      throw new Error(accountUpdateError.message);
    }

    const amountText = kipuMoney(intent.originalAmount, intent.originalCurrency);
    return buildChatActionResult({
      redirectCode: "chat-income-created",
      message: `Listo, registré ${amountText} que te devolvieron a ${destination.name}. Lo cuento como reembolso, no como ingreso nuevo, para no inflar lo que ganas.`,
    });
  }

  if (intent.type === "transfer") {
    const source = accounts.find((item) => item.id === intent.sourceAccountId);
    const destination = accounts.find(
      (item) => item.id === intent.destinationAccountId,
    );

    if (!source) {
      throw new Error("chat-transfer-source-not-found");
    }
    if (!destination) {
      throw new Error("chat-transfer-destination-not-found");
    }

    const { error: transactionError } = await supabase.from("transactions").insert({
      user_id: userId,
      type: "transfer",
      description: intent.description,
      category: intent.category ?? "other",
      original_amount: intent.originalAmount,
      original_currency: intent.originalCurrency,
      exchange_rate_to_base: intent.exchangeRateToBase ?? 1,
      base_amount: intent.originalAmount * (intent.exchangeRateToBase ?? 1),
      base_currency: intent.baseCurrency ?? intent.originalCurrency,
      source_account_id: intent.sourceAccountId,
      destination_account_id: intent.destinationAccountId,
      confidence_score: intent.confidenceScore,
      raw_input: message,
      input_channel: channelToInputChannel(channel),
      occurred_at: new Date().toISOString(),
    });

    if (transactionError) {
      throw new Error(transactionError.message);
    }

    const { error: sourceUpdateError } = await supabase
      .from("accounts")
      .update({
        current_balance_original: source.currentBalanceOriginal - intent.originalAmount,
        current_balance_base: source.currentBalanceBase - intent.originalAmount,
      })
      .eq("id", source.id)
      .eq("user_id", userId);
    if (sourceUpdateError) {
      throw new Error(sourceUpdateError.message);
    }

    const { error: destinationUpdateError } = await supabase
      .from("accounts")
      .update({
        current_balance_original:
          destination.currentBalanceOriginal + intent.originalAmount,
        current_balance_base: destination.currentBalanceBase + intent.originalAmount,
      })
      .eq("id", destination.id)
      .eq("user_id", userId);
    if (destinationUpdateError) {
      throw new Error(destinationUpdateError.message);
    }

    const amountText = kipuMoney(intent.originalAmount, intent.originalCurrency);
    return buildChatActionResult({
      redirectCode: "chat-transfer-created",
      message: `Listo, moví ${amountText} de ${source.name} a ${destination.name}. Es solo un movimiento entre tus cuentas, no lo cuento como gasto ni ingreso.`,
    });
  }

  throw new Error("chat-parser-unsupported");
}

// ── Audit-safe reversal + correction writers ────────────────────────────────
// These live in the SAME module as applyChatTransactionIntent so every write
// to the transactions ledger and balances flows through one surface. Reversal
// is append-only (a `reversal` row linked via related_transaction_id) and
// idempotent — never a hard delete, never a double reversal.

async function adjustAccountBalance(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  accountId: string,
  delta: number,
): Promise<void> {
  const { data, error } = await supabase
    .from("accounts")
    .select("current_balance_original, current_balance_base")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return;
  await supabase
    .from("accounts")
    .update({
      current_balance_original: Number(data.current_balance_original) + delta,
      current_balance_base: Number(data.current_balance_base) + delta,
    })
    .eq("id", accountId)
    .eq("user_id", userId);
}

async function adjustDebtBalance(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  debtAccountId: string,
  delta: number,
): Promise<void> {
  const { data, error } = await supabase
    .from("debt_accounts")
    .select("current_balance_original, current_balance_base")
    .eq("id", debtAccountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return;
  await supabase
    .from("debt_accounts")
    .update({
      current_balance_original: Math.max(
        Number(data.current_balance_original) + delta,
        0,
      ),
      current_balance_base: Math.max(Number(data.current_balance_base) + delta, 0),
    })
    .eq("id", debtAccountId)
    .eq("user_id", userId);
}

async function adjustGoalAmount(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  goalId: string,
  delta: number,
): Promise<void> {
  const { data, error } = await supabase
    .from("goals")
    .select("current_amount")
    .eq("id", goalId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return;
  await supabase
    .from("goals")
    .update({ current_amount: Math.max(Number(data.current_amount) + delta, 0) })
    .eq("id", goalId)
    .eq("user_id", userId);
}

// Apply the EXACT inverse of how the original transaction moved balances,
// mirroring applyChatTransactionIntent's own (rate-1) math so balances return
// to their pre-transaction state for the common single-currency case.
async function applyInverseBalanceEffects(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  tx: StoredTransaction,
): Promise<void> {
  const amount = tx.originalAmount;

  switch (tx.type) {
    case "expense":
      if (tx.sourceAccountId) {
        await adjustAccountBalance(supabase, userId, tx.sourceAccountId, amount);
      }
      if (tx.debtAccountId) {
        await adjustDebtBalance(supabase, userId, tx.debtAccountId, -amount);
      }
      return;
    case "income":
      if (tx.destinationAccountId) {
        await adjustAccountBalance(supabase, userId, tx.destinationAccountId, -amount);
      }
      return;
    case "refund":
      if (tx.destinationAccountId) {
        await adjustAccountBalance(supabase, userId, tx.destinationAccountId, -amount);
      }
      if (tx.debtAccountId) {
        await adjustDebtBalance(supabase, userId, tx.debtAccountId, amount);
      }
      return;
    case "transfer":
      if (tx.sourceAccountId) {
        await adjustAccountBalance(supabase, userId, tx.sourceAccountId, amount);
      }
      if (tx.destinationAccountId) {
        await adjustAccountBalance(supabase, userId, tx.destinationAccountId, -amount);
      }
      return;
    case "debt_payment":
      if (tx.sourceAccountId) {
        await adjustAccountBalance(supabase, userId, tx.sourceAccountId, amount);
      }
      if (tx.debtAccountId) {
        await adjustDebtBalance(supabase, userId, tx.debtAccountId, amount);
      }
      return;
    case "goal_contribution":
      if (tx.sourceAccountId) {
        await adjustAccountBalance(supabase, userId, tx.sourceAccountId, amount);
      }
      if (tx.destinationAccountId) {
        await adjustAccountBalance(supabase, userId, tx.destinationAccountId, -amount);
      }
      if (tx.goalId) {
        await adjustGoalAmount(supabase, userId, tx.goalId, -amount);
      }
      return;
    default:
      return;
  }
}

export interface ReverseStoredTransactionResult {
  ok: boolean;
  alreadyReversed: boolean;
}

// Idempotently reverse one stored transaction: append a `reversal` audit row
// and undo its balance effect. Safe to call twice — the second call is a no-op.
export async function reverseStoredTransaction(input: {
  userId: string;
  transaction: StoredTransaction;
  message: string;
  channel?: ChatChannel;
}): Promise<ReverseStoredTransactionResult> {
  const supabase = createSupabaseAdminClient();
  const { userId, transaction: tx } = input;

  const { count } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "reversal")
    .eq("related_transaction_id", tx.id);

  if ((count ?? 0) > 0) {
    return { ok: false, alreadyReversed: true };
  }

  const { error: insertError } = await supabase.from("transactions").insert({
    user_id: userId,
    type: "reversal",
    description: `Reverso: ${tx.description}`.slice(0, 280),
    category: tx.category,
    original_amount: tx.originalAmount,
    original_currency: tx.originalCurrency,
    exchange_rate_to_base: tx.exchangeRateToBase,
    base_amount: tx.baseAmount,
    base_currency: tx.baseCurrency,
    source_account_id: tx.sourceAccountId,
    destination_account_id: tx.destinationAccountId,
    debt_account_id: tx.debtAccountId,
    goal_id: tx.goalId,
    related_transaction_id: tx.id,
    confidence_score: 1,
    raw_input: input.message,
    input_channel: channelToInputChannel(input.channel),
    occurred_at: new Date().toISOString(),
  });
  if (insertError) {
    throw new Error(insertError.message);
  }

  await applyInverseBalanceEffects(supabase, userId, tx);

  return { ok: true, alreadyReversed: false };
}

// Update only descriptive metadata (category / description) in place. No
// balance change — safe for "era comida, no transporte" style corrections.
export async function correctTransactionMetadata(input: {
  userId: string;
  transactionId: string;
  category?: string;
  description?: string;
}): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const patch: Record<string, string> = {};
  if (input.category) patch.category = input.category;
  if (input.description) patch.description = input.description;
  if (Object.keys(patch).length === 0) return;
  await supabase
    .from("transactions")
    .update(patch)
    .eq("id", input.transactionId)
    .eq("user_id", input.userId);
}

// Balance-impacting correction = audit-safe reverse + replace: reverse the
// original, then apply the corrected intent through the normal writer. Returns
// the corrected transaction's success result for the user-facing reply.
export async function correctTransactionByReplacement(input: {
  userId: string;
  original: StoredTransaction;
  correctedIntent: TransactionIntent;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  message: string;
  channel?: ChatChannel;
  chatId?: string | null;
}): Promise<ChatTransactionResult> {
  await reverseStoredTransaction({
    userId: input.userId,
    transaction: input.original,
    message: input.message,
    channel: input.channel,
  });

  return applyChatTransactionIntent({
    userId: input.userId,
    message: input.message,
    intent: input.correctedIntent,
    accounts: input.accounts,
    debtAccounts: input.debtAccounts,
    goals: input.goals,
    parserSource: "basic",
    parserConfidenceScore: 1,
    channel: input.channel,
    chatId: input.chatId,
  });
}

async function loadChatResponseFinancialContext(
  userId: string,
): Promise<ChatResponseFinancialContext | undefined> {
  let context;
  try {
    context = await buildUserFinancialContext(userId);
  } catch {
    return undefined;
  }

  if (!context.dashboard) {
    return undefined;
  }

  return {
    flexibleSpending: context.dashboard.flexibleSpending.flexibleSpending,
    dailySuggestedLimit: context.dashboard.weeklyPlan.dailySuggestedLimit,
    baseCurrency: context.dashboard.weeklyPlan.baseCurrency,
    goalPlanSummary: toGoalPlanSummary(context.mainGoal, context.goalPlan),
  };
}

function toGoalPlanSummary(
  mainGoal: FinancialGoal | null,
  goalPlan: Awaited<ReturnType<typeof buildUserFinancialContext>>["goalPlan"],
): GoalPlanSummary | undefined {
  if (!mainGoal) {
    return undefined;
  }

  return {
    status: goalPlan.status,
    goalName: mainGoal.name,
    hasGoal: true,
    hasDeadline: !!goalPlan.targetDate,
    suppressContributionPush: goalPlan.suppressContributionPush,
  };
}
