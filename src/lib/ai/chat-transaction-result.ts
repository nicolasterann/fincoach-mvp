import { buildChatResponse, type ChatResponse, type ChatResponseFinancialContext } from "@/lib/ai/chat-response-mapper";
import type { TransactionIntent } from "@/types/transaction-intents";

export interface ChatTransactionResult {
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

export function buildChatTransactionSuccessResult({
  intent,
  accountName,
  debtAccountName,
  goalName,
    financialContext,
}: {
  intent: TransactionIntent;
  accountName?: string;
  debtAccountName?: string;
  goalName?: string;
    financialContext?: ChatResponseFinancialContext;
}): ChatTransactionResult {
  if (intent.type === "income") {
    return {
      redirectCode: "chat-income-created",
      chatResponse: buildChatResponse({
        resultCode: "income_created",
        intent,
        accountName,
        amount: intent.originalAmount,
        currency: intent.originalCurrency,
          financialContext,
      }),
    };
  }

  if (intent.type === "goal_contribution") {
    return {
      redirectCode: "chat-goal-contribution-created",
      chatResponse: buildChatResponse({
        resultCode: "goal_contribution_created",
        intent,
        goalName,
        amount: intent.originalAmount,
        currency: intent.originalCurrency,
          financialContext,
      }),
    };
  }

  if (intent.type === "debt_payment") {
    return {
      redirectCode: "chat-debt-payment-created",
      chatResponse: buildChatResponse({
        resultCode: "debt_payment_created",
        intent,
        accountName,
        debtAccountName,
        amount: intent.originalAmount,
        currency: intent.originalCurrency,
          financialContext,
      }),
    };
  }

  if (intent.type === "expense") {
    return {
      redirectCode: "chat-expense-created",
      chatResponse: buildChatResponse({
        resultCode: "expense_created",
        intent,
        accountName,
        debtAccountName,
        amount: intent.originalAmount,
        currency: intent.originalCurrency,
          financialContext,
      }),
    };
  }

  return {
    redirectCode: "chat-parser-unsupported",
    chatResponse: buildChatResponse({
      resultCode: "unsupported",
      intent,
    }),
  };
}

export function buildChatTransactionClarificationResult({
  clarificationQuestion,
}: {
  clarificationQuestion?: string;
}): ChatTransactionResult {
  return {
    redirectCode: "chat-parser-needs-clarification",
    chatResponse: buildChatResponse({
      resultCode: "needs_clarification",
      clarificationQuestion,
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
