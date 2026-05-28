import {
  buildChatResponse,
  type ChatResponse,
  type ChatResponseFinancialContext,
} from "@/lib/ai/chat-response-mapper";
import type {
  CoachFinancialSnapshot,
  CoachResultCode,
} from "@/lib/ai/coach-response-contract";
import { generateCoachResponse } from "@/lib/ai/coach-response-router";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import type { TransactionIntent } from "@/types/transaction-intents";

function toFinancialSnapshot(
  financialContext: ChatResponseFinancialContext | undefined,
): CoachFinancialSnapshot | undefined {
  if (!financialContext) return undefined;
  return {
    flexibleSpending: financialContext.flexibleSpending,
    dailySuggestedLimit: financialContext.dailySuggestedLimit,
    baseCurrency: financialContext.baseCurrency,
    goalPlanSummary: financialContext.goalPlanSummary,
  };
}

// Humanizes an already-applied expense whose safe deterministic copy is
// owned by the builder (confident-match fixed-expense path). In fallback
// mode the deterministic string is returned verbatim; in AI mode the
// humanizer rewrites it, still bounded by the output validator.
async function humanizeValidatedExpenseMessage(input: {
  intent: TransactionIntent;
  resultCode: CoachResultCode;
  deterministicFallbackMessage: string;
  accountName?: string;
  debtAccountName?: string;
  fixedExpenseName?: string;
  financialContext?: ChatResponseFinancialContext;
  userId?: string;
  channel?: ChatChannel;
  chatId?: string | null;
}): Promise<string> {
  const usedCard = Boolean(input.debtAccountName);
  const coachResponse = await generateCoachResponse({
    tone: "playful",
    context: {
      userId: input.userId ?? "current-user",
      originalMessage: input.intent.description,
      resultCode: input.resultCode,
      intent: input.intent,
      accountName: input.accountName,
      debtAccountName: input.debtAccountName,
      fixedExpenseName: input.fixedExpenseName,
      usedCard,
      cashDecreased: !usedCard && Boolean(input.accountName),
      debtIncreased: usedCard,
      financialSnapshot: toFinancialSnapshot(input.financialContext),
      channel: input.channel,
      chatId: input.chatId,
      deterministicFallbackMessage: input.deterministicFallbackMessage,
    },
  });
  return coachResponse.message;
}

export interface ChatTransactionResult {
  parserSource?: "basic" | "ai";
  parserConfidenceScore?: number;
  coachResponseSource?: "fallback" | "ai";
  coachResponseConfidenceScore?: number;
  redirectCode:
    | "chat-expense-created"
    | "chat-income-created"
    | "chat-goal-contribution-created"
    | "chat-debt-payment-created"
    | "chat-parser-needs-clarification"
    | "chat-parser-unsupported"
    | "chat-parser-failed";
  chatResponse: ChatResponse;
}

export async function buildChatTransactionSuccessResult({
  intent,
  accountName,
  debtAccountName,
  goalName,
  financialContext,
  parserSource,
  parserConfidenceScore,
  fixedExpenseName,
  userId,
  channel,
  chatId,
  coachMessageOverride,
}: {
  intent: TransactionIntent;
  accountName?: string;
  debtAccountName?: string;
  goalName?: string;
  financialContext?: ChatResponseFinancialContext;
  parserSource?: "basic" | "ai";
  parserConfidenceScore?: number;
  fixedExpenseName?: string;
  userId?: string;
  channel?: ChatChannel;
  chatId?: string | null;
  // When the caller already owns the final, user-ready copy (e.g. the
  // fixed-expense pending resolver), pass it here to return it verbatim
  // with NO coach-response/OpenAI call. Humanization only runs for
  // events that do not already have a final message.
  coachMessageOverride?: string;
}): Promise<ChatTransactionResult> {
  const financialSnapshot = toFinancialSnapshot(financialContext);
  const coachUserId = userId ?? "current-user";

  if (intent.type === "income") {
    const coachResponse = await generateCoachResponse({
      tone: "playful",
      context: {
        userId: coachUserId,
        originalMessage: intent.description,
        resultCode: "income_created",
        intent,
        accountName,
        financialSnapshot,
        channel,
        chatId,
      },
    });
    return {
      parserSource,
      parserConfidenceScore,
      coachResponseSource: coachResponse.source,
      coachResponseConfidenceScore: coachResponse.confidenceScore,
      redirectCode: "chat-income-created",
      chatResponse: {
        status: "success",
        message: coachResponse.message,
      },
    };
  }

  if (intent.type === "goal_contribution") {
    const coachResponse = await generateCoachResponse({
      tone: "playful",
      context: {
        userId: coachUserId,
        originalMessage: intent.description,
        resultCode: "goal_contribution_created",
        intent,
        goalName,
        financialSnapshot,
        channel,
        chatId,
      },
    });
    return {
      parserSource,
      parserConfidenceScore,
      coachResponseSource: coachResponse.source,
      coachResponseConfidenceScore: coachResponse.confidenceScore,
      redirectCode: "chat-goal-contribution-created",
      chatResponse: {
        status: "success",
        message: coachResponse.message,
      },
    };
  }

  if (intent.type === "debt_payment") {
    const coachResponse = await generateCoachResponse({
      tone: "playful",
      context: {
        userId: coachUserId,
        originalMessage: intent.description,
        resultCode: "debt_payment_created",
        intent,
        accountName,
        debtAccountName,
        cashDecreased: true,
        debtDecreased: true,
        financialSnapshot,
        channel,
        chatId,
      },
    });
    return {
      parserSource,
      parserConfidenceScore,
      coachResponseSource: coachResponse.source,
      coachResponseConfidenceScore: coachResponse.confidenceScore,
      redirectCode: "chat-debt-payment-created",
      chatResponse: {
        status: "success",
        message: coachResponse.message,
      },
    };
  }

  if (intent.type === "expense") {
    if (coachMessageOverride) {
      return {
        parserSource,
        parserConfidenceScore,
        redirectCode: "chat-expense-created",
        chatResponse: {
          status: "success",
          message: coachMessageOverride,
        },
      };
    }

    if (fixedExpenseName) {
      const source = accountName
        ? ` desde ${accountName}`
        : debtAccountName
          ? ` con ${debtAccountName}`
          : "";
      const amountText = `${intent.originalCurrency} ${intent.originalAmount.toFixed(2)}`;
      const message = await humanizeValidatedExpenseMessage({
        intent,
        resultCode: "expense_fixed_linked",
        deterministicFallbackMessage: `Listo: ${fixedExpenseName} (${amountText})${source}. Lo ligué a tu gasto fijo mensual; no es gasto extra.`,
        accountName,
        debtAccountName,
        fixedExpenseName,
        financialContext,
        userId,
        channel,
        chatId,
      });
      return {
        parserSource,
        parserConfidenceScore,
        redirectCode: "chat-expense-created",
        chatResponse: {
          status: "success",
          message,
        },
      };
    }

    const usedCard = Boolean(debtAccountName);
    const coachResponse = await generateCoachResponse({
      tone: "playful",
      context: {
        userId: coachUserId,
        originalMessage: intent.description,
        resultCode: "expense_created",
        intent,
        accountName,
        debtAccountName,
        usedCard,
        cashDecreased: !usedCard && Boolean(accountName),
        debtIncreased: usedCard,
        financialSnapshot,
        channel,
        chatId,
      },
    });
    return {
      parserSource,
      parserConfidenceScore,
      coachResponseSource: coachResponse.source,
      coachResponseConfidenceScore: coachResponse.confidenceScore,
      redirectCode: "chat-expense-created",
      chatResponse: {
        status: "success",
        message: coachResponse.message,
      },
    };
  }

  return {
    parserSource,
    parserConfidenceScore,
    redirectCode: "chat-parser-unsupported",
    chatResponse: buildChatResponse({
      resultCode: "unsupported",
      intent,
    }),
  };
}

export function buildChatTransactionClarificationResult({
  clarificationQuestion,
  parserSource,
  parserConfidenceScore,
}: {
  clarificationQuestion?: string;
  parserSource?: "basic" | "ai";
  parserConfidenceScore?: number;
}): ChatTransactionResult {
  return {
    parserSource,
    parserConfidenceScore,
    redirectCode: "chat-parser-needs-clarification",
    chatResponse: buildChatResponse({
      resultCode: "needs_clarification",
      clarificationQuestion,
    }),
  };
}

export function buildChatTransactionUnsupportedResult({
  parserSource,
  parserConfidenceScore,
}: {
  parserSource?: "basic" | "ai";
  parserConfidenceScore?: number;
}): ChatTransactionResult {
  return {
    parserSource,
    parserConfidenceScore,
    redirectCode: "chat-parser-unsupported",
    chatResponse: buildChatResponse({
      resultCode: "unsupported",
    }),
  };
}

export function buildChatTransactionFailedResult(): ChatTransactionResult {
  return {
    redirectCode: "chat-parser-failed",
    chatResponse: buildChatResponse({
      resultCode: "failed",
    }),
  };
}
