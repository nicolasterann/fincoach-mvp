import type { VariableBudgetEstimate } from "@/types/financial";
import { roundMoney } from "@/lib/financial/money";

export type BudgetRealityStatus = "unknown" | "aligned" | "slightly_over" | "over" | "far_over";

export interface BudgetRealityItem {
  category: string;
  initialEstimate: number;
  currentEstimate: number;
  difference: number;
  differencePercentage: number;
  status: BudgetRealityStatus;
}

export interface BudgetRealityResult {
  items: BudgetRealityItem[];
  averageDifferencePercentage: number;
  biggestGap?: BudgetRealityItem;
  message: string;
}

export function calculateBudgetReality(
  estimates: VariableBudgetEstimate[],
): BudgetRealityResult {
  const items = estimates.map((estimate) => {
    const difference = roundMoney(estimate.currentEstimate - estimate.initialEstimate);
    const differencePercentage =
      estimate.initialEstimate <= 0
        ? 0
        : roundMoney(difference / estimate.initialEstimate);

    return {
      category: estimate.category,
      initialEstimate: roundMoney(estimate.initialEstimate),
      currentEstimate: roundMoney(estimate.currentEstimate),
      difference,
      differencePercentage,
      status: getBudgetRealityStatus(differencePercentage),
    };
  });

  const averageDifferencePercentage =
    items.length === 0
      ? 0
      : roundMoney(
          items.reduce((total, item) => total + item.differencePercentage, 0) / items.length,
        );

  const biggestGap = [...items].sort(
    (a, b) => Math.abs(b.difference) - Math.abs(a.difference),
  )[0];

  return {
    items,
    averageDifferencePercentage,
    biggestGap,
    message: buildBudgetRealityMessage(biggestGap),
  };
}

function getBudgetRealityStatus(differencePercentage: number): BudgetRealityStatus {
  if (differencePercentage === 0) return "unknown";
  if (differencePercentage <= 0.1) return "aligned";
  if (differencePercentage <= 0.25) return "slightly_over";
  if (differencePercentage <= 0.75) return "over";
  return "far_over";
}

function buildBudgetRealityMessage(biggestGap?: BudgetRealityItem): string {
  if (!biggestGap) {
    return "Todavía no tenemos suficiente información para comparar tu presupuesto con la realidad.";
  }

  if (biggestGap.difference <= 0) {
    return "Tus estimados están bastante alineados con tu realidad. Sigamos registrando para mantenerlo así.";
  }

  if (biggestGap.status === "far_over") {
    return `Tu categoría más descuadrada es ${biggestGap.category}. Parece que aquí la realidad está bastante por encima del estimado inicial. No pasa nada: ahora podemos planear con números reales.`;
  }

  if (biggestGap.status === "over") {
    return `Tu categoría con mayor diferencia es ${biggestGap.category}. Está saliendo más alta de lo que pensábamos, así que conviene ajustar el plan.`;
  }

  return `Tu presupuesto va relativamente alineado, pero ${biggestGap.category} merece seguimiento.`;
}
