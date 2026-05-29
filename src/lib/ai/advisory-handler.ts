import {
  advisoryAiEnabled,
  classifyAdvisoryWithAI,
  detectAdvisoryCandidate,
  lastAssistantAskedForAdvisoryAmount,
  mergeAdvisoryIntents,
  parseAmountOnlyFollowUp,
  recoverFromRecentMessages,
  type AdvisoryIntent,
  type AdvisoryRecentMessage,
  type AdvisoryType,
} from "@/lib/ai/advisory-classifier";
import { generateAdvisoryResponse } from "@/lib/ai/advisory-response";
import type {
  UniversalAdvisoryCandidate,
  UniversalAdvisoryType,
} from "@/lib/ai/universal-message-router";
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

  // When the message is not an advisory question on its own, the only way
  // it can still be advisory is a bare amount reply ("Unos $25") answering
  // a previous "dime el monto" prompt. Detect that cheaply BEFORE any DB
  // read so normal logging ("cafe 3 pichincha") never pays for chat memory.
  const followUpAmount = candidate ? null : parseAmountOnlyFollowUp(message);
  if (!candidate && followUpAmount === null) return null;

  const recentMessages: AdvisoryRecentMessage[] = channel
    ? (
        await getRecentChatMessages({ userId, channel, chatId, limit: 10 })
      ).map((m) => ({
        role: m.role,
        content: m.content,
        messageType: m.messageType,
      }))
    : [];

  let intent: AdvisoryIntent;

  if (candidate) {
    intent = candidate.intent;

    if (advisoryAiEnabled()) {
      const ai = await classifyAdvisoryWithAI({ message, recentMessages });
      if (ai.confidence >= ADVISORY_AI_CONFIDENCE_THRESHOLD) {
        // The model is confident this is actually a movement to log; let the
        // transaction pipeline handle it.
        if (!ai.isAdvisory) return null;
        intent = mergeAdvisoryIntents(candidate.intent, ai);
      }
    }
  } else {
    // Amount-only follow-up. Only treat it as advisory when the previous
    // assistant turn actually asked for a spending amount; otherwise a bare
    // "25" is a standalone number and must fall through to the transaction
    // pipeline (return null) so it gets the normal expense/income question.
    if (!lastAssistantAskedForAdvisoryAmount(recentMessages)) return null;
    intent = {
      isAdvisory: true,
      advisoryType: "spending_check",
      // Item stays null: a generic spending check ("si gastas 25$, te
      // quedarían…") is the safe, correct answer. Payment method unknown is
      // treated as cash by the engine, the more protective assumption.
      itemDescription: null,
      amount: followUpAmount,
      currency: "USD",
      paymentMethodMentioned: null,
      mentionedAccountOrCardName: null,
      referencesPreviousTopic: true,
      needsMoreInfo: false,
      missingInfo: [],
      confidence: 0.6,
    };
  }

  return runAdvisoryForIntent({ userId, message, intent, recentMessages });
}

// Shared advisory tail: recover context when the message points back at an
// earlier topic, read the user's real financial snapshot, run the
// deterministic decision engine, and humanize it. READ-ONLY — never a DB
// write. Used by both the deterministic gate (tryHandleAdvisoryMessage) and
// the Universal AI Message Router (handleAdvisoryFromRouter).
async function runAdvisoryForIntent(input: {
  userId: string;
  message: string;
  intent: AdvisoryIntent;
  recentMessages: AdvisoryRecentMessage[];
}): Promise<ChatTransactionResult> {
  const { userId, message, recentMessages } = input;
  let intent = input.intent;

  // Recover an item/amount from the recent conversation ONLY when the
  // message clearly references the previous topic (e.g. "¿y si lo pago
  // con Visa?", "¿mejor espero?"). A fresh, generic question like
  // "¿puedo salir a comer hoy?" carries no such reference, so it must
  // stay amount-less and ask for the amount instead of borrowing a stale
  // number from an unrelated earlier turn.
  if (intent.referencesPreviousTopic) {
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

function toAdvisoryType(type: UniversalAdvisoryType): AdvisoryType {
  switch (type) {
    case "purchase_decision":
    case "spending_check":
    case "payment_method_comparison":
    case "wait_or_buy":
    case "general_money_question":
      return type;
    case "subscription_decision":
      // A recurring/subscription purchase is still a "should I buy this"
      // decision for the deterministic engine.
      return "purchase_decision";
    default:
      // Unknown → generic spending check, the safe, protective default.
      return "spending_check";
  }
}

// Advisory entry point for the Universal AI Message Router. The router has
// already classified the message as an advice question and extracted a loose
// candidate; we map it to the canonical AdvisoryIntent and run the same
// read-only decision tail as the deterministic gate. No DB write happens here.
export async function handleAdvisoryFromRouter(input: {
  userId: string;
  message: string;
  recentMessages: AdvisoryRecentMessage[];
  candidate: UniversalAdvisoryCandidate;
}): Promise<ChatTransactionResult> {
  const { userId, message, recentMessages, candidate } = input;

  const intent: AdvisoryIntent = {
    isAdvisory: true,
    advisoryType: toAdvisoryType(candidate.advisoryType),
    itemDescription: candidate.itemDescription,
    amount: candidate.amount,
    currency: candidate.amount !== null ? "USD" : null,
    paymentMethodMentioned: candidate.paymentMethodMentioned,
    mentionedAccountOrCardName: candidate.mentionedAccountOrCardName,
    referencesPreviousTopic: candidate.referencesPreviousTopic,
    needsMoreInfo: candidate.amount === null,
    missingInfo: candidate.amount === null ? ["amount"] : [],
    confidence: 0.8,
  };

  return runAdvisoryForIntent({ userId, message, intent, recentMessages });
}

function moneyText(value: number, currency: string): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

// Per-day figures are ALWAYS whole dollars in chat — "35$ por día".
function dailyText(value: number, currency: string): string {
  const rounded = Math.round(value);
  return currency === "USD" ? `${rounded}$` : `${rounded} ${currency}`;
}

function buildGeneralFinancialReply(snapshot: AdvisorySnapshot): string {
  const { weeklyRemaining, dailySuggested, baseCurrency, debtPressureLevel } =
    snapshot;

  const debtTail =
    debtPressureLevel === "high" || debtPressureLevel === "critical"
      ? " Yo cuidaría la tarjeta y los gastos grandes estos días."
      : "";

  if (weeklyRemaining <= 0) {
    return `Esta semana vas justo: ya casi no te queda margen libre. Yo evitaría gastos no esenciales hasta que reinicie tu semana.${debtTail}`;
  }

  const tail = debtTail || " Vas bien, sigue así.";
  return `Vas con ${moneyText(weeklyRemaining, baseCurrency)} para esta semana, más o menos ${dailyText(dailySuggested, baseCurrency)} por día.${tail}`;
}

// Read-only "how am I doing" answer for the Universal AI Message Router. Uses
// the user's real snapshot; never invents numbers, never writes to the DB.
export async function handleGeneralFinancialQuestion(input: {
  userId: string;
}): Promise<ChatTransactionResult> {
  let snapshot: AdvisorySnapshot;
  try {
    const ctx = await buildUserFinancialContext(input.userId);
    snapshot = deriveAdvisorySnapshot(ctx);
  } catch {
    return buildChatAdvisoryResult({
      message:
        "Ahora mismo no puedo leer bien tus números. Dame un momento y vuelve a preguntarme.",
    });
  }

  return buildChatAdvisoryResult({
    message: buildGeneralFinancialReply(snapshot),
  });
}
