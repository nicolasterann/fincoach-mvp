import type { AdvisoryRecentMessage } from "@/lib/ai/advisory-classifier";
import {
  handleAdvisoryFromRouter,
  handleGeneralFinancialQuestion,
  tryHandleAdvisoryMessage,
} from "@/lib/ai/advisory-handler";
import { applyChatTransactionIntent } from "@/lib/ai/apply-chat-transaction-intent";
import {
  buildChatAdvisoryResult,
  buildChatTransactionClarificationResult,
  buildChatTransactionFailedResult,
  buildChatTransactionUnsupportedResult,
  type ChatTransactionResult,
} from "@/lib/ai/chat-transaction-result";
import {
  classifyFixedExpenseFollowUpWithAI,
  classifyGoalMismatchFollowUpWithAI,
} from "@/lib/ai/resolve-pending-clarification-ai";
import { parseTransaction } from "@/lib/ai/transaction-parser-router";
import { detectTransactionPrefilter } from "@/lib/ai/transaction-prefilter";
import {
  buildCorrectionComingSoonReply,
  buildGeneralChatReply,
  buildUnsupportedActionReply,
  classifyUniversalMessage,
  looksLikeQuestionOrOpinion,
  universalRouterEnabled,
  type UniversalMessageRoute,
} from "@/lib/ai/universal-message-router";
import {
  appendChatMessage,
  getRecentChatMessages,
} from "@/lib/chat-memory/chat-messages";
import {
  cancelPendingClarification,
  getActivePendingClarification,
  openPendingClarification,
  resolvePendingClarification,
  type ChatChannel,
  type FixedExpenseAmountMismatchPayload,
  type GoalNameMismatchPayload,
  type PendingClarification,
} from "@/lib/chat-memory/pending-clarification";
import {
  buildReClarifyQuestion,
  classifyFixedExpenseFollowUp,
} from "@/lib/chat-memory/resolve-fixed-expense-clarification";
import {
  buildGoalMismatchReClarifyQuestion,
  classifyGoalMismatchFollowUp,
} from "@/lib/chat-memory/resolve-goal-mismatch-clarification";
import { parseBasicTransactionIntent } from "@/lib/financial/basic-intent-parser";
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
import type {
  DebtPaymentIntent,
  ExpenseIntent,
  GoalContributionIntent,
  TransactionIntent,
} from "@/types/transaction-intents";

// Minimum AI classifier certainty before we let it resolve a pending
// clarification. Below this we re-ask rather than guess.
const PENDING_AI_CONFIDENCE_THRESHOLD = 0.75;

// Minimum Universal AI Message Router certainty before we act on its route.
// Below this we fall through to the legacy deterministic pipeline (parser +
// guards), so a low-confidence classification never changes behaviour.
const UNIVERSAL_ROUTER_CONFIDENCE_THRESHOLD = 0.7;

// At or above this certainty the router is trusted as the primary semantic
// interpreter for read-only advisory routing: a high-confidence
// "advisory_question" goes straight to the read-only advisory engine WITHOUT
// requiring a deterministic question/opinion cue. Below it (but still ≥ the
// base threshold) the cue helper acts as a tie-breaker. This is safe because
// the advisory path never writes — worst case it gives advice instead of
// logging, which is preferable to mis-writing a movement.
const UNIVERSAL_ROUTER_ADVISORY_HIGH_CONFIDENCE = 0.85;

export interface HandleChatTransactionMessageInput {
  userId: string;
  message: string;
  channel?: ChatChannel;
  chatId?: string | null;
}

export async function handleChatTransactionMessage(
  input: HandleChatTransactionMessageInput,
): Promise<ChatTransactionResult> {
  const { userId, message, channel, chatId } = input;
  const trimmedMessage = message.trim();

  // Persist the user's turn first when we have a channel context.
  // Best-effort; appendChatMessage swallows DB errors so chat memory
  // can never break the chat flow.
  if (channel) {
    await appendChatMessage({
      userId,
      channel,
      chatId,
      role: "user",
      content: trimmedMessage || message,
      messageType: "chat",
    });
  }

  const result = await runChatPipeline({
    userId,
    trimmedMessage,
    channel,
    chatId,
  });

  if (channel) {
    await appendChatMessage({
      userId,
      channel,
      chatId,
      role: "assistant",
      content: result.chatResponse.message,
      messageType:
        result.redirectCode === "chat-advisory"
          ? "advisory"
          : result.redirectCode === "chat-parser-needs-clarification"
            ? "clarification"
            : result.redirectCode === "chat-parser-unsupported" ||
                result.redirectCode === "chat-parser-failed"
              ? "chat"
              : "transaction",
      metadata: {
        redirectCode: result.redirectCode,
        parserSource: result.parserSource ?? null,
      },
    });
  }

  return result;
}

interface RunChatPipelineInput {
  userId: string;
  trimmedMessage: string;
  channel?: ChatChannel;
  chatId?: string | null;
}

async function runChatPipeline(
  input: RunChatPipelineInput,
): Promise<ChatTransactionResult> {
  const { userId, trimmedMessage, channel, chatId } = input;

  if (!trimmedMessage) {
    return buildChatTransactionClarificationResult({
      clarificationQuestion:
        "Mándame el movimiento en una frase simple, por ejemplo: cafe 3 pichincha.",
    });
  }

  // If Kipu is waiting on an answer to a recent clarification, try to
  // resolve it deterministically before running the parser pipeline.
  // The resolver may apply the matched fixed expense, re-ask if the
  // reply is ambiguous, or return null so the normal pipeline runs.
  if (channel) {
    const pending = await getActivePendingClarification(
      userId,
      channel,
      chatId,
    );
    if (pending) {
      const resolved = await tryResolvePendingClarification({
        userId,
        message: trimmedMessage,
        pending,
        channel,
        chatId,
      });
      if (resolved) return resolved;
    }
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

  // Open a pending clarification whenever the matcher surfaces a
  // candidate fixed expense alongside the clarification question — that
  // is the deterministic signal that the question is a normal-vs-aparte
  // ask. This covers both:
  //   - status === "amount_mismatch" (single match, user typed a
  //     different amount), and
  //   - status === "ambiguous" with duplicate same-name rows (the
  //     matcher picks the first candidate; mirrors the "como gasto
  //     fijo" override behaviour).
  // The "distinct names" ambiguous branch does not expose a candidate,
  // so we skip pending creation there — we cannot safely pick a row.
  if (
    (fixedExpenseMatch.status === "amount_mismatch" ||
      fixedExpenseMatch.status === "ambiguous") &&
    fixedExpenseMatch.matchedExpense &&
    fixedExpenseMatch.messageAmount !== undefined &&
    channel
  ) {
    const matched = fixedExpenseMatch.matchedExpense;
    await openPendingClarification({
      userId,
      channel,
      chatId,
      kind: "fixed_expense_amount_mismatch",
      payload: {
        kind: "fixed_expense_amount_mismatch",
        fixedExpenseId: matched.id,
        fixedExpenseName: matched.name,
        fixedExpenseAmount: matched.amount,
        enteredAmount: fixedExpenseMatch.messageAmount,
        currency: matched.currency,
        sourceAccountId: fixedExpenseMatch.resolvedAccount?.id,
        sourceAccountName: fixedExpenseMatch.resolvedAccount?.name,
        rawInput: trimmedMessage,
        category: matched.category,
      },
      prompt: fixedExpenseMatch.clarificationQuestion ?? "",
    });
  }

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
        channel,
        chatId,
      });
    } catch {
      return buildChatTransactionFailedResult();
    }
  }

  // Advisory path. AFTER the fixed-expense matcher (so "internet 25" is
  // still treated as a payment) but BEFORE any transaction parsing — an
  // advice question like "¿debería comprar este reloj de 120?" must never
  // be registered as a movement. The handler is READ-ONLY: it reads the
  // user's real financial context and returns coaching, never a DB write.
  // Returns null when the message is not an advice question.
  const advisory = await tryHandleAdvisoryMessage({
    userId,
    message: trimmedMessage,
    channel,
    chatId,
  });
  if (advisory) return advisory;

  // Universal AI Message Router. A flexible first interpreter that catches
  // advice questions, "how am I doing" questions, corrections/undo, and
  // small talk that the narrow deterministic gates above do not recognize
  // (e.g. "Estoy pensando comprar unos zapatos de 90, ¿cómo lo ves?"). It is
  // gated by the same flag as AI interpretation (TRANSACTION_PARSER_MODE !=
  // "basic"), so in the deterministic default it is OFF and behaviour is
  // unchanged. It NEVER writes to the DB: transaction-shaped messages fall
  // through to the parser pipeline below, which keeps full control of every
  // financial write.
  if (universalRouterEnabled() && channel) {
    const recentMessages: AdvisoryRecentMessage[] = (
      await getRecentChatMessages({ userId, channel, chatId, limit: 10 })
    ).map((m) => ({
      role: m.role,
      content: m.content,
      messageType: m.messageType,
    }));

    const route = await classifyUniversalMessage({
      message: trimmedMessage,
      recentMessages,
      accountNames: accounts
        .filter((account) => !account.isGoalAccount)
        .map((account) => account.name),
      debtNames: debtAccounts.map((debt) => debt.name),
      goalNames: goals.map((goal) => goal.name),
      fixedExpenseNames: fixedExpenses.map((expense) => expense.name),
      hasPendingClarification: false,
    });

    const routed = await routeUniversalMessage({
      userId,
      message: trimmedMessage,
      route,
      recentMessages,
    });
    if (routed) return routed;
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

      // Store a pending row so the user's next reply ("sí, era viaje a
      // brasil" / "no, era otra meta") resolves in-context instead of
      // erroring. We deterministically extract the amount and source via
      // the basic intent parser; the AI never supplies these values.
      if (mainGoal && channel) {
        const basicIntent = parseBasicTransactionIntent({
          message: trimmedMessage,
          accounts,
          debtAccounts,
          goals,
          mainGoal,
          preferences,
          baseCurrency: goals[0]?.currency ?? "USD",
        });
        const resolvedSourceId =
          basicIntent.type === "goal_contribution"
            ? basicIntent.sourceAccountId
            : undefined;
        const sourceAccount = resolvedSourceId
          ? accounts.find(
              (account) => account.id === resolvedSourceId && !account.isGoalAccount,
            )
          : undefined;

        await openPendingClarification({
          userId,
          channel,
          chatId,
          kind: "goal_name_mismatch",
          payload: {
            kind: "goal_name_mismatch",
            amount: basicIntent.originalAmount,
            currency: basicIntent.originalCurrency,
            baseCurrency: basicIntent.baseCurrency ?? basicIntent.originalCurrency,
            sourceAccountId: sourceAccount?.id,
            sourceAccountName: sourceAccount?.name,
            wroteGoalName: wrote,
            mainGoalId: mainGoal.id,
            mainGoalName: mainGoal.name,
            rawInput: trimmedMessage,
            category: "savings",
          },
          prompt: clarification,
        });
      }

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
    // AI-first default: a message the parser can't turn into a movement is
    // usually a financial thought, not a failed log. When the router is on,
    // answer as a read-only coach (no DB write) instead of a bot-like
    // "todavía no puedo registrar eso". Basic mode keeps the old copy.
    if (universalRouterEnabled() && channel) {
      return handleGeneralFinancialQuestion({
        userId,
        message: trimmedMessage,
        channel,
        chatId,
      });
    }
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
  // token), deterministically correct the intent before the DB write.
  // Only block with a clarification when the user's phrasing is truly
  // ambiguous and we cannot safely pick a single source.
  const sourceGuard = enforcePaymentSourceMatch({
    message: trimmedMessage,
    intent: parserResult.intent,
    accounts,
    debtAccounts,
  });

  if (sourceGuard.kind === "clarify") {
    return buildChatTransactionClarificationResult({
      clarificationQuestion: sourceGuard.message,
      parserSource: parserResult.source,
      parserConfidenceScore: parserResult.confidenceScore,
    });
  }

  const intentToApply =
    sourceGuard.kind === "corrected" ? sourceGuard.intent : parserResult.intent;

  try {
    return await applyChatTransactionIntent({
      userId,
      message: trimmedMessage,
      intent: intentToApply,
      accounts,
      debtAccounts,
      goals,
        parserSource: parserResult.source,
        parserConfidenceScore: parserResult.confidenceScore,
      channel,
      chatId,
    });
  } catch {
    return buildChatTransactionFailedResult();
  }
}

// Acts on a Universal AI Message Router classification. Returns a
// ChatTransactionResult when the router confidently owns the message (advice,
// general financial question, correction/undo, unsupported action, small
// talk), or null to fall through to the legacy deterministic pipeline. It
// NEVER writes to the DB — transaction-shaped routes (transaction_log,
// pending_reply, unclear) deliberately return null so the parser + guards +
// applyChatTransactionIntent path keeps full control of every financial write.
async function routeUniversalMessage(input: {
  userId: string;
  message: string;
  route: UniversalMessageRoute;
  recentMessages: AdvisoryRecentMessage[];
}): Promise<ChatTransactionResult | null> {
  const { userId, message, route, recentMessages } = input;

  if (route.confidence < UNIVERSAL_ROUTER_CONFIDENCE_THRESHOLD) {
    return null;
  }

  switch (route.route) {
    case "advisory_question": {
      // The router is the primary semantic interpreter. We trust a
      // high-confidence advisory classification directly (no regex/cue gate),
      // so natural phrasings we never anticipated still get advice instead of
      // failing like a bot. The deterministic cue helper is only a
      // tie-breaker for the medium-confidence band. This is safe: advisory is
      // READ-ONLY — it never writes to the DB, so a wrong classification at
      // worst gives advice instead of logging (never a bad movement). Clear
      // transaction logs are protected because the router classifies them as
      // "transaction_log" (handled by the default branch → legacy parser).
      if (!route.advisoryCandidate) return null;

      const highConfidence =
        route.confidence >= UNIVERSAL_ROUTER_ADVISORY_HIGH_CONFIDENCE;
      if (highConfidence || looksLikeQuestionOrOpinion(message)) {
        return handleAdvisoryFromRouter({
          userId,
          message,
          recentMessages,
          candidate: route.advisoryCandidate,
        });
      }

      // Medium confidence AND no question/opinion cue → don't override the
      // transaction pipeline; fall through to the parser + guards.
      return null;
    }

    case "general_financial_question":
      return handleGeneralFinancialQuestion({ userId, message, recentMessages });

    case "general_chat":
      return buildChatAdvisoryResult({ message: buildGeneralChatReply(message) });

    case "transaction_correction_or_undo":
      return buildChatAdvisoryResult({
        message: buildCorrectionComingSoonReply(),
      });

    case "unsupported_action":
      return buildChatAdvisoryResult({ message: buildUnsupportedActionReply() });

    // transaction_log, pending_reply, unclear → let the legacy pipeline run.
    default:
      return null;
  }
}

// Deterministically resolve an open pending clarification using the
// user's latest reply. Returns a ChatTransactionResult when the reply
// is unambiguous (apply transaction or re-ask), or null when the reply
// is unrelated and the normal parser pipeline should run.
async function tryResolvePendingClarification(
  input: ResolvePendingInput,
): Promise<ChatTransactionResult | null> {
  if (input.pending.kind === "fixed_expense_amount_mismatch") {
    return resolveFixedExpenseMismatch(input);
  }

  if (input.pending.kind === "goal_name_mismatch") {
    return resolveGoalNameMismatch(input);
  }

  // Other pending kinds are not yet wired; let the normal parser pipeline
  // run and the pending stays open until it expires or is overwritten.
  return null;
}

interface ResolvePendingInput {
  userId: string;
  message: string;
  pending: PendingClarification;
  channel?: ChatChannel;
  chatId?: string | null;
}

async function resolveFixedExpenseMismatch(
  input: ResolvePendingInput,
): Promise<ChatTransactionResult> {
  const { userId, message, pending, channel, chatId } = input;
  const payload = pending.payload as FixedExpenseAmountMismatchPayload;

  // Deterministic regex first. Only consult the AI classifier when the
  // reply is ambiguous, and only act on it above the confidence bar. The
  // AI never decides amounts/accounts — it only labels the reply.
  const deterministic = classifyFixedExpenseFollowUp(message);
  let resolvedKind: "normal" | "separate" | null =
    deterministic.kind === "normal"
      ? "normal"
      : deterministic.kind === "separate"
        ? "separate"
        : null;

  if (!resolvedKind) {
    const ai = await classifyFixedExpenseFollowUpWithAI({
      prompt: pending.prompt,
      reply: message,
      fixedExpenseName: payload.fixedExpenseName,
      fixedExpenseAmount: payload.fixedExpenseAmount,
      enteredAmount: payload.enteredAmount,
      currency: payload.currency,
      sourceAccountName: payload.sourceAccountName,
    });
    if (ai.confidence >= PENDING_AI_CONFIDENCE_THRESHOLD) {
      if (ai.decision === "normal_fixed_payment") resolvedKind = "normal";
      else if (ai.decision === "separate_charge") resolvedKind = "separate";
    }
  }

  if (!resolvedKind) {
    // Ambiguous (or an AI cancel / low-confidence / failure) — keep the
    // pending row open and ask a shorter, focused clarification.
    return buildChatTransactionClarificationResult({
      clarificationQuestion: buildReClarifyQuestion(payload),
    });
  }

  const context = await loadResolutionContext(userId);
  if (!context) return buildChatTransactionFailedResult();
  const { accounts, debtAccounts, goals } = context;

  // Validate the source account still exists (and is not a goal
  // account). If the user did not name a source originally, leave
  // sourceAccountId undefined — the apply layer can still register the
  // expense; the user's saved default kicks in on a future message.
  let sourceAccountId = payload.sourceAccountId;
  if (sourceAccountId) {
    const found = accounts.find(
      (account) => account.id === sourceAccountId && !account.isGoalAccount,
    );
    if (!found) sourceAccountId = undefined;
  }

  const expenseIntent: ExpenseIntent = {
    type: "expense",
    description: payload.fixedExpenseName,
    originalAmount: payload.enteredAmount,
    originalCurrency: payload.currency as CurrencyCode,
    confidenceScore: 0.95,
    status: "ready",
    category: (payload.category as ExpenseIntent["category"]) ?? "other",
    sourceAccountId,
  };

  const sourceAccount = sourceAccountId
    ? accounts.find((account) => account.id === sourceAccountId)
    : undefined;
  const sourceName =
    sourceAccount?.name ?? payload.sourceAccountName ?? undefined;
  const desde = sourceName ? ` desde ${sourceName}` : "";
  const amountText = `${payload.currency} ${payload.enteredAmount.toFixed(2)}`;

  try {
    if (resolvedKind === "normal") {
      // Confirmed fixed-expense payment. Link recurring_expense_id so
      // future months still recognise it. The stored fixed-expense
      // amount is intentionally NOT mutated — that is a separate
      // decision (and out of scope for this module).
      // The resolver already owns the final, user-ready copy, so pass it
      // as coachMessageOverride to skip the coach-response/OpenAI call.
      const result = await applyChatTransactionIntent({
        userId,
        message: payload.rawInput,
        intent: expenseIntent,
        accounts,
        debtAccounts,
        goals,
        parserSource: "basic",
        parserConfidenceScore: 0.95,
        recurringExpenseId: payload.fixedExpenseId,
        fixedExpenseName: payload.fixedExpenseName,
        channel,
        chatId,
        coachMessageOverride: `Listo, lo registro como pago de ${payload.fixedExpenseName} por ${amountText}${desde}. No lo trato como gasto extra.`,
      });
      await resolvePendingClarification(pending.id);
      return result;
    }

    // resolvedKind === "separate" — apply as a normal expense, not linked
    // to the recurring expense row. The resolver owns the final copy, so
    // skip humanization via coachMessageOverride.
    const result = await applyChatTransactionIntent({
      userId,
      message: payload.rawInput,
      intent: expenseIntent,
      accounts,
      debtAccounts,
      goals,
      parserSource: "basic",
      parserConfidenceScore: 0.95,
      channel,
      chatId,
      coachMessageOverride: `Listo, lo registro como gasto aparte de ${payload.fixedExpenseName} por ${amountText}${desde}.`,
    });
    await resolvePendingClarification(pending.id);
    return result;
  } catch {
    return buildChatTransactionFailedResult();
  }
}

async function resolveGoalNameMismatch(
  input: ResolvePendingInput,
): Promise<ChatTransactionResult> {
  const { userId, message, pending, channel, chatId } = input;
  const payload = pending.payload as GoalNameMismatchPayload;

  // Deterministic regex first; AI only when the reply is ambiguous, and
  // only above the confidence bar. The AI labels the reply (confirm vs
  // reject) — it never decides the amount, source, or which goal exists.
  const deterministic = classifyGoalMismatchFollowUp(
    message,
    payload.mainGoalName,
  );
  let decision: "confirm" | "reject" | null =
    deterministic.kind === "confirm"
      ? "confirm"
      : deterministic.kind === "reject"
        ? "reject"
        : null;

  if (!decision) {
    const ai = await classifyGoalMismatchFollowUpWithAI({
      prompt: pending.prompt,
      reply: message,
      mainGoalName: payload.mainGoalName,
      wroteGoalName: payload.wroteGoalName,
      amount: payload.amount,
      currency: payload.currency,
      sourceAccountName: payload.sourceAccountName,
    });
    if (ai.confidence >= PENDING_AI_CONFIDENCE_THRESHOLD) {
      if (ai.decision === "confirm_main_goal") decision = "confirm";
      else if (ai.decision === "reject_or_cancel") decision = "reject";
    }
  }

  if (!decision) {
    // Keep the pending row open and ask a focused yes/no.
    return buildChatTransactionClarificationResult({
      clarificationQuestion: buildGoalMismatchReClarifyQuestion(
        payload.mainGoalName,
      ),
    });
  }

  if (decision === "reject") {
    await cancelPendingClarification(pending.id);
    return buildChatTransactionClarificationResult({
      clarificationQuestion:
        "Va, no lo registro. Cuando quieras, mándamelo con la meta correcta.",
    });
  }

  // decision === "confirm" — apply the original contribution to the main
  // goal. Never apply if the amount or main goal id is missing.
  if (!payload.mainGoalId || !(payload.amount > 0)) {
    await cancelPendingClarification(pending.id);
    return buildChatTransactionFailedResult();
  }

  const context = await loadResolutionContext(userId);
  if (!context) return buildChatTransactionFailedResult();
  const { accounts, debtAccounts, goals } = context;

  const mainGoal = goals.find((goal) => goal.id === payload.mainGoalId);
  if (!mainGoal) {
    await cancelPendingClarification(pending.id);
    return buildChatTransactionFailedResult();
  }

  // Validate the source account; never invent one.
  let sourceAccountId = payload.sourceAccountId;
  if (sourceAccountId) {
    const found = accounts.find(
      (account) => account.id === sourceAccountId && !account.isGoalAccount,
    );
    if (!found) sourceAccountId = undefined;
  }

  if (!sourceAccountId) {
    // We confirmed the goal but never had a safe source. Ask for it
    // instead of guessing, and close this pending so a yes/no reply can't
    // loop on a classifier that cannot read an account name.
    await cancelPendingClarification(pending.id);
    return buildChatTransactionClarificationResult({
      clarificationQuestion: `¿Desde qué cuenta salió ese aporte para ${mainGoal.name}? Mándamelo de nuevo nombrando la cuenta.`,
    });
  }

  const goalAccount = mainGoal.goalAccountId
    ? accounts.find((account) => account.id === mainGoal.goalAccountId)
    : accounts.find((account) => account.isGoalAccount);

  const contributionIntent: GoalContributionIntent = {
    type: "goal_contribution",
    description: payload.rawInput,
    originalAmount: payload.amount,
    originalCurrency: payload.currency as CurrencyCode,
    baseCurrency:
      (payload.baseCurrency as CurrencyCode) ?? (payload.currency as CurrencyCode),
    sourceAccountId,
    destinationAccountId: goalAccount?.id ?? "",
    goalId: mainGoal.id,
    confidenceScore: 0.95,
    status: "ready",
    category: "savings",
  };

  try {
    const result = await applyChatTransactionIntent({
      userId,
      message: payload.rawInput,
      intent: contributionIntent,
      accounts,
      debtAccounts,
      goals,
      parserSource: "basic",
      parserConfidenceScore: 0.95,
      channel,
      chatId,
    });
    await resolvePendingClarification(pending.id);
    return result;
  } catch {
    return buildChatTransactionFailedResult();
  }
}

// Shared account/debt/goal loader for pending-clarification resolution.
// Returns null on any read error so the caller can fail safely.
async function loadResolutionContext(userId: string): Promise<{
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
} | null> {
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
    return null;
  }

  const accounts: Account[] = (accountsResult.data ?? []).map((account) => ({
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

  const debtAccounts: DebtAccount[] = (debtAccountsResult.data ?? []).map((debt) => ({
    id: debt.id,
    userId: debt.user_id,
    name: debt.name,
    type: debt.type,
    currency: debt.currency,
    currentBalanceOriginal: Number(debt.current_balance_original),
    currentBalanceBase: Number(debt.current_balance_base),
    minimumPayment:
      debt.minimum_payment === null ? undefined : Number(debt.minimum_payment),
    fullPaymentDue:
      debt.full_payment_due === null ? undefined : Number(debt.full_payment_due),
    dueDay: debt.due_day ?? undefined,
    cutoffDay: debt.cutoff_day ?? undefined,
    interestRate:
      debt.interest_rate === null ? undefined : Number(debt.interest_rate),
    defaultPaymentAccountId: debt.default_payment_account_id ?? undefined,
    createdAt: debt.created_at,
  }));

  const goals: FinancialGoal[] = (goalsResult.data ?? []).map((goal) => ({
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

  return { accounts, debtAccounts, goals };
}

type PaymentSourceGuardResult =
  | { kind: "ok" }
  | { kind: "corrected"; intent: TransactionIntent }
  | { kind: "clarify"; message: string };

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
}): PaymentSourceGuardResult {
  if (intent.type !== "expense" && intent.type !== "debt_payment") {
    return { kind: "ok" };
  }

  const expected = inferExpectedPaymentSource(message, accounts, debtAccounts);

  if (expected.kind === "none") {
    // User did not name any source; trust the parser's pick (it may be
    // using the user's saved default).
    return { kind: "ok" };
  }

  if (expected.kind === "ambiguous") {
    // The user used a debt signal AND named an account, but the
    // resolver could not pick a single safe source. Ask before any DB
    // write.
    if (expected.account) {
      return {
        kind: "clarify",
        message: `Mencionaste tarjeta y también ${expected.account.name}. Para no moverlo mal, confirma con qué fue.`,
      };
    }
    return { kind: "ok" };
  }

  if (intent.type === "expense") {
    const intentAccount = intent.sourceAccountId
      ? accounts.find((account) => account.id === intent.sourceAccountId)
      : undefined;
    const intentDebt = intent.debtAccountId
      ? debtAccounts.find((debt) => debt.id === intent.debtAccountId)
      : undefined;

    if (expected.kind === "account" && expected.account) {
      const alreadyCorrect =
        !intentDebt && intentAccount?.id === expected.account.id;
      if (alreadyCorrect) return { kind: "ok" };

      const corrected: ExpenseIntent = {
        ...intent,
        sourceAccountId: expected.account.id,
        debtAccountId: undefined,
      };
      return { kind: "corrected", intent: corrected };
    }

    if (expected.kind === "debt" && expected.debtAccount) {
      const alreadyCorrect =
        !intentAccount && intentDebt?.id === expected.debtAccount.id;
      if (alreadyCorrect) return { kind: "ok" };

      const corrected: ExpenseIntent = {
        ...intent,
        sourceAccountId: undefined,
        debtAccountId: expected.debtAccount.id,
      };
      return { kind: "corrected", intent: corrected };
    }

    return { kind: "ok" };
  }

  // debt_payment: only guard the source-account side. The debt-account
  // side is the user's target and is intentionally out of scope here.
  if (intent.type === "debt_payment") {
    if (expected.kind === "account" && expected.account) {
      if (intent.sourceAccountId !== expected.account.id) {
        const corrected: DebtPaymentIntent = {
          ...intent,
          sourceAccountId: expected.account.id,
        };
        return { kind: "corrected", intent: corrected };
      }
    }
    return { kind: "ok" };
  }

  return { kind: "ok" };
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
