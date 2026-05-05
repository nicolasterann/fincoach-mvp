import type { TransactionIntent } from "@/types/transaction-intents";

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

  if (input.resultCode === "expense_created") {
    if (input.debtAccountName) {
      return {
        status: "success",
        message: `Listo, registré ${amountText} como gasto con ${input.debtAccountName}. Lo sumé a tu deuda para que no parezca dinero disponible.`,
      };
    }

    return {
      status: "success",
      message: `Listo, registré ${amountText} como gasto desde ${input.accountName ?? "tu cuenta"}. Ya actualicé tu saldo y tu dinero flexible.`,
    };
  }

  if (input.resultCode === "income_created") {
    return {
      status: "success",
      message: `Listo, registré ${amountText} como ingreso en ${input.accountName ?? "tu cuenta"}. Tu saldo y tu dinero flexible ya subieron.`,
    };
  }

  if (input.resultCode === "goal_contribution_created") {
    return {
      status: "success",
      message: `Listo, registré ${amountText} como aporte a ${input.goalName ?? "tu meta"}. Tu progreso ya subió.`,
    };
  }

  if (input.resultCode === "debt_payment_created") {
    return {
      status: "success",
      message: `Listo, registré ${amountText} como pago de ${input.debtAccountName ?? "tu deuda"} desde ${input.accountName ?? "tu cuenta"}. Bajé tu cuenta y también bajé la deuda, sin contarlo como gasto nuevo.`,
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
