import {
  advisoryAiEnabled,
  classifyAdvisoryWithAI,
  detectAdvisoryCandidate,
  mergeAdvisoryIntents,
  recoverFromRecentMessages,
  type AdvisoryIntent,
  type AdvisoryRecentMessage,
} from "@/lib/ai/advisory-classifier";
import { generateAdvisoryResponse } from "@/lib/ai/advisory-response";
import { buildChatAdvisoryResult, type ChatTransactionResult } from "@/lib/ai/chat-transaction-result";
import type { GoalPlanSummary } from "@/lib/ai/goal-aware-response-copy";
import { getRecentChatMessages } from "@/lib/chat-memory/chat-messages";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import {
  evaluateAdvisoryDecision,
  type AdvisoryPaymentMethodType,
} from "@/lib/financial/advisory-decision-engine";
import { calculateDebtPressure, type DebtPressureLevel } from "@/lib/financial/debt-pressure";
import { calculateFlexibleSpending } from "@/lib/financial/flexible-spending";
import {
  buildUserFinancialContext,
  type UserFinancialContext,
} from "@/lib/financial/user-financial-context-builder";
import { calculateWeeklyPlan } from "@/lib/financial/weekly-plan";
import type { Account, DebtAccount, FixedExpense, RecurringExpense } from "@/types/financial";

// Minimum AI certainty before we let the model override the deterministic
// candidate (including deciding a message is NOT advisory after all).
const ADVISORY_AI_CONFIDENCE_THRESHOLD = 0.75;

export interface AdvisoryHandlerInput {
  userId: string;
  message: string;
  channel?: ChatChannel;
  chatId?: string | null;
}

interface AdvisorySnapshot {
  weeklyRemaining: number;
  dailySuggested: number;
  daysRemainingInWeek: number;
  debtPressureLevel: DebtPressureLevel;
  totalDebt: number;
  availableCash: number;
  suppressContributionPush: boolean;
  baseCurrency: string;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goalPlanSummary: GoalPlanSummary;
}

function mapFixedExpenseToRecurringExpense(
  expense: FixedExpense,
): RecurringExpense {
  return {
    id: expense.id,
    userId: expense.userId,
    name: expense.name,
    amount: expense.amount,
    currency: expense.currency,
    category: expense.category,
    frequency: expense.frequency,
    expectedDay: expense.expectedDay,
    paymentSourceId: expense.paymentSourceId,
    confidenceLevel: "high",
    status: expense.isActive ? "active" : "paused",
    createdAt: expense.createdAt,
  };
}

// Derive the weekly margin / debt picture from the canonical context.
// Prefer the dashboard numbers the user already sees; when there is no
// main goal (dashboard is null) compute the same figures directly.
function deriveAdvisorySnapshot(ctx: UserFinancialContext): AdvisorySnapshot {
  const baseCurrency = ctx.profile.baseCurrency;

  let weeklyRemaining: number;
  let dailySuggested: number;
  let daysRemainingInWeek: number;
  let debtPressureLevel: DebtPressureLevel;
  let totalDebt: number;
  let availableCash: number;

  if (ctx.dashboard) {
    weeklyRemaining = ctx.dashboard.weeklyPlan.weeklyAvailable;
    dailySuggested = ctx.dashboard.weeklyPlan.dailySuggestedLimit;
    daysRemainingInWeek = ctx.dashboard.weeklyPlan.daysRemainingInWeek;
    debtPressureLevel = ctx.dashboard.debtPressure.level;
    totalDebt = ctx.dashboard.debtPressure.totalDebt;
    availableCash = ctx.dashboard.flexibleSpending.totalAvailableCash;
  } else {
    const flexible = calculateFlexibleSpending({
      accounts: ctx.accounts,
      debtAccounts: ctx.debtAccounts,
      recurringExpenses: ctx.fixedExpenses.map(mapFixedExpenseToRecurringExpense),
      plannedGoalContribution: 0,
      baseCurrency,
    });
    const weekly = calculateWeeklyPlan({
      flexibleSpending: flexible.flexibleSpending,
      baseCurrency,
    });
    const debt = calculateDebtPressure({
      debtAccounts: ctx.debtAccounts,
      monthlyIncome: ctx.summary.estimatedMonthlyIncome,
    });
    weeklyRemaining = weekly.weeklyAvailable;
    dailySuggested = weekly.dailySuggestedLimit;
    daysRemainingInWeek = weekly.daysRemainingInWeek;
    debtPressureLevel = debt.level;
    totalDebt = debt.totalDebt;
    availableCash = flexible.totalAvailableCash;
  }

  return {
    weeklyRemaining,
    dailySuggested,
    daysRemainingInWeek,
    debtPressureLevel,
    totalDebt,
    availableCash,
    suppressContributionPush: ctx.goalPlan.suppressContributionPush,
    baseCurrency,
    accounts: ctx.accounts,
    debtAccounts: ctx.debtAccounts,
    goalPlanSummary: {
      status: ctx.goalPlan.status,
      goalName: ctx.mainGoal?.name ?? null,
      hasGoal: Boolean(ctx.mainGoal),
      hasDeadline: Boolean(ctx.mainGoal?.targetDate),
      suppressContributionPush: ctx.goalPlan.suppressContributionPush,
    },
  };
}

function nameMatches(accountName: string, mentioned: string): boolean {
  const a = accountName.toLowerCase();
  const m = mentioned.toLowerCase();
  return a.includes(m) || m.includes(a);
}

function resolvePaymentMethodType(
  intent: AdvisoryIntent,
  snapshot: AdvisorySnapshot,
): AdvisoryPaymentMethodType {
  if (intent.paymentMethodMentioned === "card") return "card";
  if (intent.paymentMethodMentioned === "cash_account") return "account";

  const name = intent.mentionedAccountOrCardName;
  if (name) {
    if (snapshot.debtAccounts.some((debt) => nameMatches(debt.name, name))) {
      return "card";
    }
    if (
      snapshot.accounts.some(
        (account) => !account.isGoalAccount && nameMatches(account.name, name),
      )
    ) {
      return "account";
    }
  }

  return "unknown";
}

// Advisory path of the chat pipeline. Returns a ChatTransactionResult when
// the message is an advice question (READ-ONLY — it never registers a
// movement and only the outer handler persists chat messages), or null
// when the message is not advisory and the transaction pipeline should
// run instead.
export async function tryHandleAdvisoryMessage(
  input: AdvisoryHandlerInput,
): Promise<ChatTransactionResult | null> {
  const { userId, message, channel, chatId } = input;

  const candidate = detectAdvisoryCandidate(message);
  if (!candidate) return null;

  let intent = candidate.intent;

  const recentMessages: AdvisoryRecentMessage[] = channel
    ? (
        await getRecentChatMessages({ userId, channel, chatId, limit: 10 })
      ).map((m) => ({ role: m.role, content: m.content }))
    : [];

  if (advisoryAiEnabled()) {
    const ai = await classifyAdvisoryWithAI({ message, recentMessages });
    if (ai.confidence >= ADVISORY_AI_CONFIDENCE_THRESHOLD) {
      // The model is confident this is actually a movement to log; let the
      // transaction pipeline handle it.
      if (!ai.isAdvisory) return null;
      intent = mergeAdvisoryIntents(candidate.intent, ai);
    }
  }

  // Recover an item/amount from the recent conversation for references
  // like "¿y si lo pago con Visa?" that omit what "lo" is.
  if (intent.amount === null || intent.referencesPreviousTopic) {
    const recovered = recoverFromRecentMessages(recentMessages);
    if (recovered) {
      if (intent.amount === null && recovered.amount !== null) {
        intent = { ...intent, amount: recovered.amount, currency: "USD" };
      }
      if (!intent.itemDescription && recovered.itemDescription) {
        intent = { ...intent, itemDescription: recovered.itemDescription };
      }
    }
  }

  let snapshot: AdvisorySnapshot;
  try {
    const ctx = await buildUserFinancialContext(userId);
    snapshot = deriveAdvisorySnapshot(ctx);
  } catch {
    return buildChatAdvisoryResult({
      message:
        "Ahora mismo no puedo leer bien tus números. Dame un momento y vuelve a preguntarme.",
    });
  }

  const paymentMethodType = resolvePaymentMethodType(intent, snapshot);

  const decision = evaluateAdvisoryDecision({
    amount: intent.amount,
    paymentMethodType,
    weeklyRemaining: snapshot.weeklyRemaining,
    dailySuggested: snapshot.dailySuggested,
    daysRemainingInWeek: snapshot.daysRemainingInWeek,
    debtPressureLevel: snapshot.debtPressureLevel,
    totalDebt: snapshot.totalDebt,
    availableCash: snapshot.availableCash,
    suppressContributionPush: snapshot.suppressContributionPush,
    baseCurrency: snapshot.baseCurrency,
  });

  const response = await generateAdvisoryResponse({
    intent,
    decision,
    recentMessages,
    originalMessage: message,
    goalPlanSummary: snapshot.goalPlanSummary,
  });

  return buildChatAdvisoryResult({ message: response.message });
}
