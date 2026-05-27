import type { GoalPlanSummary } from "@/lib/ai/goal-aware-response-copy";
import type { FinancialCategory } from "@/types/financial";
import type { TransactionIntent } from "@/types/transaction-intents";

export interface ChatResponseFinancialContext {
  flexibleSpending: number;
  dailySuggestedLimit: number;
  baseCurrency: string;
  goalPlanSummary?: GoalPlanSummary;
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
  category?: FinancialCategory;
  clarificationQuestion?: string;
  financialContext?: ChatResponseFinancialContext;
}

export interface ChatResponse {
  status: "success" | "needs_clarification" | "unsupported" | "failed";
  message: string;
}

// Spanish category labels used in success copy ("registré 40 en compras …").
// Returns null for vague / catch-all categories so we don't tack on
// "en other" or similar.
function spanishCategoryLabel(
  category: FinancialCategory | undefined,
): string | null {
  switch (category) {
    case "food":
      return "comida";
    case "transport":
      return "transporte";
    case "shopping":
      return "compras";
    case "subscriptions":
      return "una suscripción";
    case "travel":
      return "viaje";
    case "housing":
      return "vivienda";
    case "utilities":
      return "servicios";
    case "health":
      return "salud";
    case "education":
      return "educación";
    case "entertainment":
      return "salidas";
    case "family":
      return "familia";
    case "debt":
    case "savings":
    case "income":
    case "other":
    default:
      return null;
  }
}

// Formats a debt account name for reply copy. "Visa Pichincha" already
// contains a debt marker, so we use it verbatim. A bare "Mamá" or "Tito"
// gets a "deuda con …" prefix so the sentence reads cleanly.
function debtNameForCopy(name: string | undefined): string {
  if (!name?.trim()) return "tu deuda";
  if (/^(visa|mastercard|master\s+card|amex|american\s+express|diners|discover|tarjeta|tc)\b/i.test(name)) {
    return name;
  }
  return `tu deuda con ${name}`;
}

export function buildChatResponse(input: ChatResponseInput): ChatResponse {
  const amountText =
    input.amount !== undefined && input.currency
      ? `${input.currency} ${input.amount.toFixed(2)}`
      : "el movimiento";

  const contextText = buildFinancialContextText(input.financialContext);

  if (input.resultCode === "expense_created") {
    const categoryLabel = spanishCategoryLabel(input.category);
    const categoryFragment = categoryLabel ? ` en ${categoryLabel}` : "";

    if (input.debtAccountName) {
      return {
        status: "success",
        message: `Listo: ${amountText}${categoryFragment} con ${input.debtAccountName}. No bajó tu efectivo hoy; sí subió tu deuda.${contextText}`,
      };
    }

    return {
      status: "success",
      message: `Listo: ${amountText}${categoryFragment} desde ${input.accountName ?? "tu cuenta"}.${contextText}`,
    };
  }

  if (input.resultCode === "income_created") {
    return {
      status: "success",
      message: `Entró: ${amountText} a ${input.accountName ?? "tu cuenta"}. Tu margen subió.${contextText}`,
    };
  }

  if (input.resultCode === "goal_contribution_created") {
    const source = input.accountName ? ` desde ${input.accountName}` : "";
    return {
      status: "success",
      message: `Sumaste ${amountText} a tu meta de ${input.goalName ?? "ahorro"}${source}. Vas un poco más cerca.${contextText}`,
    };
  }

  if (input.resultCode === "debt_payment_created") {
    return {
      status: "success",
      message: `Buena movida: pagaste ${amountText} a ${debtNameForCopy(input.debtAccountName)} desde ${input.accountName ?? "tu cuenta"}. Bajó tu cuenta y bajó tu deuda. Eso es progreso real.${contextText}`,
    };
  }

  if (input.resultCode === "needs_clarification") {
    return {
      status: "needs_clarification",
      message:
        input.clarificationQuestion ??
        "Casi lo tengo. Dime un dato más para registrarlo sin descuadrar tus saldos.",
    };
  }

  if (input.resultCode === "unsupported") {
    return {
      status: "unsupported",
      message:
        "Todavía no puedo registrar ese cambio completo sin riesgo de descuadrar tus saldos. Por ahora dime si fue gasto, ingreso, pago de deuda o aporte a meta.",
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

  return ` Te quedan ${context.baseCurrency} ${context.flexibleSpending.toFixed(2)} flexibles esta semana (~${context.baseCurrency} ${context.dailySuggestedLimit.toFixed(2)}/día).`;
}
