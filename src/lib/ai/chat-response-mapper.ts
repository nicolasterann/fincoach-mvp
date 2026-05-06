import type { TransactionIntent } from "@/types/transaction-intents";

export interface ChatResponseFinancialContext {
  flexibleSpending: number;
  dailySuggestedLimit: number;
  baseCurrency: string;
}

export interface ChatResponseInput {
  intent?: TransactionIntent;
  resultCode:
    | "expense_created"
    | "income_created"
    | "goal_contribution_created"
    | "debt_payment_created"
    | "needs_clarification"
    | "unsupported"
    | "failed";
  accountName?: string;
  debtAccountName?: string;
  goalName?: string;
  amount?: number;
  currency?: string;
  clarificationQuestion?: string;
  financialContext?: ChatResponseFinancialContext;
}

export interface ChatResponse {
  status: "success" | "needs_clarification" | "unsupported" | "failed";
  message: string;
}

export function buildChatResponse(input: ChatResponseInput): ChatResponse {
  const amountText =
    input.amount !== undefined && input.currency
      ? `${input.currency} ${input.amount.toFixed(2)}`
      : "el movimiento";

  const contextText = buildFinancialContextText(input.financialContext);

  if (input.resultCode === "expense_created") {
    if (input.debtAccountName) {
      return {
        status: "success",
        message: `Anotado: ${amountText} con ${input.debtAccountName}. La tarjeta no es magia, así que lo sumé a tu deuda.${contextText}`,
      };
    }

    return {
      status: "success",
      message: `Anotado: ${amountText} desde ${input.accountName ?? "tu cuenta"}.${contextText}`,
    };
  }

  if (input.resultCode === "income_created") {
    return {
      status: "success",
      message: `Entró plata: ${amountText} a ${input.accountName ?? "tu cuenta"}. Respira, tu margen subió.${contextText}`,
    };
  }

  if (input.resultCode === "goal_contribution_created") {
    return {
      status: "success",
      message: `Bien ahí: ${amountText} para ${input.goalName ?? "tu meta"}. Tu yo del futuro acaba de aplaudir.${contextText}`,
    };
  }

  if (input.resultCode === "debt_payment_created") {
    return {
      status: "success",
      message: `Buena movida: pagaste ${amountText} a tu tarjeta ${input.debtAccountName ?? "deuda"} desde tu cuenta de ${input.accountName ?? "origen"}. Bajó tu cuenta, pero también bajó tu deuda. Eso sí cuenta como progreso.${contextText}`,
    };
  }

  if (input.resultCode === "needs_clarification") {
    return {
      status: "needs_clarification",
      message:
        input.clarificationQuestion ??
        "Casi lo tengo. Dime un dato más para registrarlo sin dañar tus saldos.",
    };
  }

  if (input.resultCode === "unsupported") {
    return {
      status: "unsupported",
      message:
        "Todavía no puedo registrar ese tipo de movimiento desde el chat, pero ya lo tengo identificado para una siguiente versión.",
    };
  }

  return {
    status: "failed",
    message:
      "No pude registrar ese movimiento. Probemos con una frase más simple, por ejemplo: cafe 3 pichincha.",
  };
}

function buildFinancialContextText(
  context?: ChatResponseFinancialContext,
): string {
  if (!context) {
    return "";
  }

  return ` Te quedan ${context.baseCurrency} ${context.flexibleSpending.toFixed(2)} flexibles y ${context.baseCurrency} ${context.dailySuggestedLimit.toFixed(2)}/día esta semana.`;
}
