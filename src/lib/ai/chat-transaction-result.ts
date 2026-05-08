import {
  buildChatResponse,
  type ChatResponse,
  type ChatResponseFinancialContext,
} from "@/lib/ai/chat-response-mapper";
import { generateCoachResponse } from "@/lib/ai/coach-response-router";
import type { TransactionIntent } from "@/types/transaction-intents";

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
}: {
  intent: TransactionIntent;
  accountName?: string;
  debtAccountName?: string;
  goalName?: string;
  financialContext?: ChatResponseFinancialContext;
  parserSource?: "basic" | "ai";
  parserConfidenceScore?: number;
}): Promise<ChatTransactionResult> {
  const financialSnapshot = financialContext
    ? {
        flexibleSpending: financialContext.flexibleSpending,
        dailySuggestedLimit: financialContext.dailySuggestedLimit,
        baseCurrency: financialContext.baseCurrency,
      }
    : undefined;

  if (intent.type === "income") {
    const coachResponse = await generateCoachResponse({
      tone: "playful",
      context: {
        userId: "current-user",
        originalMessage: intent.description,
        resultCode: "income_created",
        intent,
        accountName,
        financialSnapshot,
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
        userId: "current-user",
        originalMessage: intent.description,
        resultCode: "goal_contribution_created",
        intent,
        goalName,
        financialSnapshot,
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
        userId: "current-user",
        originalMessage: intent.description,
        resultCode: "debt_payment_created",
        intent,
        accountName,
        debtAccountName,
        financialSnapshot,
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
    const coachResponse = await generateCoachResponse({
      tone: "playful",
      context: {
        userId: "current-user",
        originalMessage: intent.description,
        resultCode: "expense_created",
        intent,
        accountName,
        debtAccountName,
        financialSnapshot,
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
