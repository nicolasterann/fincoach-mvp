import type {
  CoachFinancialSnapshot,
  CoachResponseInput,
  CoachResponseResult,
  CoachTransactionContext,
} from "@/lib/ai/coach-response-contract";
import { buildGoalAwareSuffix } from "@/lib/ai/goal-aware-response-copy";
import type { FinancialCategory } from "@/types/financial";

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
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

// Per-day figures are always whole dollars in chat — "96$ por día".
function formatDaily(value: number, currency: string): string {
  const rounded = Math.round(value);
  return currency === "USD" ? `${rounded}$` : `${rounded} ${currency}`;
}

// Deterministic variant pick so the fallback never lands on the same
// sentence across different movements. Seeded (no Math.random in copy) so a
// given case is reproducible.
function pickVariant(variants: string[], seed: number): string {
  if (variants.length <= 1) return variants[0] ?? "";
  const index = Math.abs(Math.round(seed)) % variants.length;
  return variants[index];
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
  const tightWeek = Boolean(snapshot && snapshot.flexibleSpending <= 0);
  // Seed the deterministic copy variants so different movements don't all
  // land on the same negative-margin sentence (no Math.random in copy).
  const seed = Math.round(
    Math.abs(snapshot?.flexibleSpending ?? 0) + context.intent.originalAmount,
  );
  const snapshotText = buildSnapshotText(snapshot, { seed });
  // When the week is already in the red, the over-margin heads-up below
  // says it all — a goal-protection line on top just repeats the point.
  const plan = tightWeek ? undefined : context.financialSnapshot?.goalPlanSummary;

  if (context.resultCode === "expense_created") {
    const label = shortItemLabel(context);
    const itemPart = label ? `${label} por ${amountText}` : amountText;

    if (context.debtAccountName) {
      const goalSuffix = buildGoalAwareSuffix({
        resultCode: "expense_with_debt_created",
        plan,
      });
      // On a card, a tight week is about the card/debt, not cash — so the
      // heads-up points back at the tarjeta instead of "gastos no esenciales".
      const cardSnapshotText = buildSnapshotText(snapshot, { seed, isCard: true });
      return {
        source: "fallback",
        confidenceScore: 1,
        message: `Listo, ${itemPart} con ${context.debtAccountName}. No salió efectivo hoy, pero sí subió la tarjeta.${goalSuffix}${cardSnapshotText}`,
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
  // Paying down debt is progress even on a tight week — the heads-up
  // acknowledges that instead of warning about the margin.
  const debtSnapshotText = buildSnapshotText(snapshot, {
    seed,
    isDebtPayment: true,
  });
  return {
    source: "fallback",
    confidenceScore: 1,
    message: `Listo, bajaste ${amountText} de ${debtNameForCopy(context.debtAccountName)}. Bajó tu deuda.${goalSuffix}${debtSnapshotText}`,
  };
}

function buildSnapshotText(
  snapshot: CoachResponseInput["context"]["financialSnapshot"],
  options: { seed: number; isCard?: boolean; isDebtPayment?: boolean } = {
    seed: 0,
  },
): string {
  if (!snapshot) {
    return "";
  }

  // Healthy week: the concrete weekly + daily figure is the most useful
  // thing we can add, and it's what users liked. Keep it.
  if (snapshot.flexibleSpending > 0) {
    return ` Te quedan ${formatMoney(snapshot.flexibleSpending, snapshot.baseCurrency)} para esta semana, más o menos ${formatDaily(snapshot.dailySuggestedLimit, snapshot.baseCurrency)} por día.`;
  }

  // Week is in the red: never print a negative or zero figure ("te quedan
  // -15$"). Tell the truth (how far OVER the margin they are, absolute
  // value), but INFORMATIVELY — Kipu notes it and will factor it into what
  // it recommends next. No scolding "frenaría / cuidaría / evitaría" by
  // default; logging must always feel safe.
  return ` ${negativeMarginHeadsUp(snapshot, options)}`;
}

// One natural, NON-PUNITIVE over-margin note. The amount shown is the
// absolute value of the (negative) weekly margin — how far past the line
// they are. The framing is "Kipu is keeping track / will consider it next",
// never an order to cut back.
function negativeMarginHeadsUp(
  snapshot: CoachFinancialSnapshot,
  options: { seed: number; isCard?: boolean; isDebtPayment?: boolean },
): string {
  const { seed, isCard, isDebtPayment } = options;
  const overBy = Math.round(Math.abs(snapshot.flexibleSpending));
  const overText = formatMoney(overBy, snapshot.baseCurrency);

  // Paying down debt is good news even on a tight week — acknowledge the
  // progress instead of warning about the margin.
  if (isDebtPayment) {
    return pickVariant(
      [
        `Aunque la semana sigue apretada, bajar deuda siempre ayuda.`,
        `La semana sigue justa, pero bajar deuda es de lo mejor que puedes hacer ahora.`,
        `Aunque vas sobre el margen, bajar deuda juega a tu favor.`,
      ],
      seed,
    );
  }

  if (isCard) {
    return pickVariant(
      overBy >= 1
        ? [
            `Como ya vas ${overText} sobre el margen, te lo considero al recomendarte próximos gastos.`,
            `Con la semana ya sobre margen, lo tendré presente para próximas recomendaciones.`,
            `La tarjeta ya viene cargada esta semana (${overText} sobre el margen); lo tomaré en cuenta para lo que sigue.`,
            `Ya vas ${overText} sobre tu margen esta semana; lo considero de aquí en adelante.`,
            `Con esto quedas ${overText} sobre el margen de la semana; queda anotado para lo que sigue.`,
          ]
        : [
            `Como la semana ya va justa, te lo considero al recomendarte próximos gastos.`,
            `Quedaste al borde del margen; lo tendré presente para lo que sigue.`,
          ],
      seed,
    );
  }

  return pickVariant(
    overBy >= 1
      ? [
          `Esta semana ya vas ${overText} sobre tu margen; lo tengo en cuenta para las próximas recomendaciones.`,
          `La semana ya viene pasada por ${overText}, así que lo tomaré en cuenta cuando me preguntes por próximos gastos.`,
          `Con esto quedas ${overText} sobre el margen de la semana; lo considero para lo que te recomiende después.`,
          `Esta semana ya quedó por encima del margen; queda registrado y lo consideraré en lo que te recomiende después.`,
          `Ya vas ${overText} sobre tu margen; queda anotado y lo tomo en cuenta de aquí en adelante.`,
          `Vas ${overText} por encima esta semana; lo tendré presente cuando hablemos de próximos gastos.`,
          `La semana sigue apretada, pero queda registrado; lo sumo a lo que ya llevas.`,
        ]
      : [
          `Esta semana ya vas justo en tu margen; lo tengo en cuenta para lo que te recomiende.`,
          `Quedaste al borde del margen semanal; lo tendré presente de aquí en adelante.`,
          `La semana queda justa, pero queda registrado; lo sumo a lo que ya llevas.`,
        ],
    seed,
  );
}
