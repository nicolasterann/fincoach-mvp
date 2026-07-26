import type {
  CoachResponseInput,
  CoachResponseResult,
  CoachTransactionContext,
} from "@/lib/ai/coach-response-contract";
import { buildGoalAwareSuffix } from "@/lib/ai/goal-aware-response-copy";
import { formatKipuMoney } from "@/lib/financial/money";
import type { CurrencyCode, FinancialCategory } from "@/types/financial";

// Spanish category labels for fallback copy. Used only when we have no
// clean item description to name the expense after.
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

// Money in Kipu voice: "90$" / "3.50$" (sign after the number, decimals
// only when there are cents). Never "USD 90.00".
function formatMoney(value: number, currency: string): string {
  return formatKipuMoney(value, currency as CurrencyCode);
}

// Per-day figures are always whole dollars in chat — "96$ por día".
function formatDaily(value: number, currency: string): string {
  return formatKipuMoney(Math.round(value), currency as CurrencyCode);
}

// Name the expense after what the user actually wrote ("café", "zapatos")
// when it's a short, clean label; otherwise fall back to the category.
function shortItemLabel(context: CoachTransactionContext): string | null {
  if (context.intent.type === "expense") {
    const desc = context.intent.description?.trim();
    if (desc) {
      const words = desc.split(/\s+/);
      if (desc.length <= 30 && words.length <= 4) return desc;
    }
    return spanishCategoryLabel(context.intent.category);
  }
  return null;
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
  // Some callers (fixed-expense resolution, pending clarifications) already
  // own a safe, validated string. When present, return it verbatim so the
  // deterministic copy never drifts — and so the response-only result codes
  // (expense_fixed_*) don't fall through to the debt_payment branch below.
  if (context.deterministicFallbackMessage) {
    return {
      source: "fallback",
      confidenceScore: 1,
      message: context.deterministicFallbackMessage,
    };
  }

  const amountText = formatMoney(
    context.intent.originalAmount,
    context.intent.originalCurrency,
  );
  const snapshot = context.financialSnapshot;
  const snapshotText = buildSnapshotText(snapshot);
  const plan = context.financialSnapshot?.goalPlanSummary;

  if (context.resultCode === "expense_created") {
    const label = shortItemLabel(context);
    const itemPart = label ? `${label} por ${amountText}` : amountText;

    if (context.debtAccountName) {
      const goalSuffix = buildGoalAwareSuffix({
        resultCode: "expense_with_debt_created",
        plan,
      });
      return {
        source: "fallback",
        confidenceScore: 1,
        message: `Listo, ${itemPart} con ${context.debtAccountName}. No salió efectivo hoy, pero sí subió la tarjeta.${goalSuffix}${snapshotText}`,
      };
    }

    const goalSuffix = buildGoalAwareSuffix({
      resultCode: "expense_created",
      plan,
    });
    return {
      source: "fallback",
      confidenceScore: 1,
      message: `Listo, ${itemPart} desde ${context.accountName ?? "tu cuenta"}.${goalSuffix}${snapshotText}`,
    };
  }

  if (context.resultCode === "income_created") {
    const goalSuffix = buildGoalAwareSuffix({
      resultCode: "income_created",
      plan,
    });
    return {
      source: "fallback",
      confidenceScore: 1,
      message: `Listo, entraron ${amountText} a ${context.accountName ?? "tu cuenta"}.${goalSuffix}${snapshotText}`,
    };
  }

  if (context.resultCode === "goal_contribution_created") {
    const source = context.accountName ? ` desde ${context.accountName}` : "";
    const goalSuffix = buildGoalAwareSuffix({
      resultCode: "goal_contribution_created",
      plan,
    });
    const trailingProgress = goalSuffix || " Vas un poco más cerca.";
    return {
      source: "fallback",
      confidenceScore: 1,
      message: `Listo, sumaste ${amountText} a tu meta de ${context.goalName ?? "ahorro"}${source}.${trailingProgress}${snapshotText}`,
    };
  }

  const goalSuffix = buildGoalAwareSuffix({
    resultCode: "debt_payment_created",
    plan,
  });
  return {
    source: "fallback",
    confidenceScore: 1,
    message: `Listo, bajaste ${amountText} de ${debtNameForCopy(context.debtAccountName)}. Bajó tu deuda.${goalSuffix}${snapshotText}`,
  };
}

function buildSnapshotText(
  snapshot: CoachResponseInput["context"]["financialSnapshot"],
): string {
  if (!snapshot) {
    return "";
  }

  if (snapshot.saldoAmount > 0) {
    return ` Tu Saldo queda en ${formatMoney(snapshot.saldoAmount, snapshot.baseCurrency)}; se recarga más o menos ${formatDaily(snapshot.saldoFillDaily, snapshot.baseCurrency)} al día.`;
  }

  return ` Tu Saldo queda en ${formatMoney(0, snapshot.baseCurrency)}; se recarga más o menos ${formatDaily(snapshot.saldoFillDaily, snapshot.baseCurrency)} al día.`;
}
