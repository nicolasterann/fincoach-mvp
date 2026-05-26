import type {
  CoachResponseInput,
  CoachResponseResult,
} from "@/lib/ai/coach-response-contract";
import type { FinancialCategory } from "@/types/financial";

// Spanish category labels for fallback copy. Keep in sync with
// chat-response-mapper.ts so the user sees consistent voice whether
// the AI coach is on or off.
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

function debtNameForCopy(name: string | undefined): string {
  if (!name?.trim()) return "tu deuda";
  if (/^(visa|mastercard|master\s+card|amex|american\s+express|diners|discover|tarjeta|tc)\b/i.test(name)) {
    return name;
  }
  return `tu deuda con ${name}`;
}

export function buildFallbackCoachResponse({
  context,
}: CoachResponseInput): CoachResponseResult {
  const amountText = `${context.intent.originalCurrency} ${context.intent.originalAmount.toFixed(2)}`;
  const snapshotText = buildSnapshotText(context.financialSnapshot);

  if (context.resultCode === "expense_created") {
    const category =
      context.intent.type === "expense" ? context.intent.category : undefined;
    const categoryLabel = spanishCategoryLabel(category);
    const categoryFragment = categoryLabel ? ` en ${categoryLabel}` : "";

    if (context.debtAccountName) {
      return {
        source: "fallback",
        confidenceScore: 1,
        message: `Listo: ${amountText}${categoryFragment} con ${context.debtAccountName}. No bajó tu efectivo hoy; sí subió tu deuda.${snapshotText}`,
      };
    }

    return {
      source: "fallback",
      confidenceScore: 1,
      message: `Listo: ${amountText}${categoryFragment} desde ${context.accountName ?? "tu cuenta"}.${snapshotText}`,
    };
  }

  if (context.resultCode === "income_created") {
    return {
      source: "fallback",
      confidenceScore: 1,
      message: `Entró: ${amountText} a ${context.accountName ?? "tu cuenta"}. Tu margen subió.${snapshotText}`,
    };
  }

  if (context.resultCode === "goal_contribution_created") {
    const source = context.accountName ? ` desde ${context.accountName}` : "";
    return {
      source: "fallback",
      confidenceScore: 1,
      message: `Sumaste ${amountText} a tu meta de ${context.goalName ?? "ahorro"}${source}. Vas un poco más cerca.${snapshotText}`,
    };
  }

  return {
    source: "fallback",
    confidenceScore: 1,
    message: `Buena movida: pagaste ${amountText} a ${debtNameForCopy(context.debtAccountName)} desde ${context.accountName ?? "tu cuenta"}. Bajó tu cuenta y bajó tu deuda. Eso es progreso real.${snapshotText}`,
  };
}

function buildSnapshotText(snapshot: CoachResponseInput["context"]["financialSnapshot"]): string {
  if (!snapshot) {
    return "";
  }

  return ` Te quedan ${snapshot.baseCurrency} ${snapshot.flexibleSpending.toFixed(2)} flexibles esta semana (~${snapshot.baseCurrency} ${snapshot.dailySuggestedLimit.toFixed(2)}/día).`;
}
