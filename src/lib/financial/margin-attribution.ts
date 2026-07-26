import { roundMoney } from "@/lib/financial/money";
import type { BudgetIntelligence } from "@/lib/financial/budget-intelligence";
import type { SubscriptionReport } from "@/lib/financial/subscription-detection";
import type { AnomalyReport } from "@/lib/financial/anomaly-detection";
import type { SpendingBaselines } from "@/lib/financial/category-baselines";

// Stage 16 — MARGIN ATTRIBUTION. Answers "¿por qué bajó mi margen?" / "¿qué me
// está dejando sin margen esta semana?" by naming the few real drivers, not a
// wall of numbers. There is no per-day margin snapshot history yet, so Kipu is
// HONEST about the basis: it compares this week's pace against the user's own
// learned normal (baselines) and attributes the gap to specific categories, new
// recurring charges, or a large one-off. PURE.

export interface MarginDriver {
  kind: "category_increase" | "category_decrease" | "new_recurring" | "large_one_off";
  label: string; // parent category or merchant family
  weeklyDelta: number; // + = more spending than normal this week (pressure on margin)
  note: string; // structured Spanish fact for the agent to rephrase
  confidence: "high" | "medium" | "low";
}

export interface MarginAttribution {
  hasSnapshot: boolean; // false → comparing against learned baseline, stated honestly
  basis: string; // human description of what the comparison is against
  spendingUpWeekly: number; // net projected extra spending vs normal this week
  drivers: MarginDriver[]; // strongest first
  headline: MarginDriver | null;
  confidence: "high" | "medium" | "low";
}

export function buildMarginAttribution(
  budgetIntel: BudgetIntelligence,
  subscriptions: SubscriptionReport,
  anomalies: AnomalyReport,
  baselines: SpendingBaselines,
): MarginAttribution {
  const drivers: MarginDriver[] = [];

  // 1. Categories spending above / below their learned normal this week.
  const floor = Math.max(5, baselines.typicalDailyVariable * 0.5);
  for (const s of budgetIntel.signals) {
    if (s.confidence === "low") continue;
    if (Math.abs(s.overage) < floor) continue;
    if (s.overage > 0) {
      drivers.push({
        kind: "category_increase",
        label: s.parentCategory,
        weeklyDelta: roundMoney(s.overage),
        note: `${s.parentCategory} va ~${Math.round(s.pctVsNormal * 100)}% arriba de tu normal (≈ ${roundMoney(s.overage)} más esta semana).`,
        confidence: s.confidence,
      });
    } else {
      drivers.push({
        kind: "category_decrease",
        label: s.parentCategory,
        weeklyDelta: roundMoney(s.overage),
        note: `${s.parentCategory} va por debajo de tu normal (≈ ${roundMoney(-s.overage)} menos), eso suma a tu Saldo.`,
        confidence: s.confidence,
      });
    }
  }

  // 2. New recurring charges not yet modeled as fixed expenses — quiet margin drain.
  for (const sub of subscriptions.subscriptions) {
    if (!sub.suggestConvert || sub.confidence === "low") continue;
    const weekly = sub.cadence === "weekly" ? sub.amount : sub.cadence === "biweekly" ? sub.amount / 2 : sub.amount / 4.33;
    drivers.push({
      kind: "new_recurring",
      label: sub.merchantFamily,
      weeklyDelta: roundMoney(weekly),
      note: `${sub.merchantFamily} parece cargo recurrente (${sub.amount}/${sub.cadence === "weekly" ? "semana" : sub.cadence === "biweekly" ? "quincena" : "mes"}) que aún no tenías como fijo.`,
      confidence: sub.confidence,
    });
  }

  // 3. A notable large one-off this period.
  const big = anomalies.anomalies.find((a) => a.kind === "large_one_off" && a.severity !== "info");
  if (big) {
    drivers.push({
      kind: "large_one_off",
      label: big.merchantFamily,
      weeklyDelta: roundMoney(big.amount),
      note: `Un gasto puntual grande en ${big.parentCategory} (${big.merchantFamily}, ${big.amount}) pesó en tu semana.`,
      confidence: big.confidence,
    });
  }

  // Strongest pressure first (largest positive delta), decreases last.
  drivers.sort((a, b) => b.weeklyDelta - a.weeklyDelta);
  const spendingUpWeekly = roundMoney(drivers.reduce((sum, d) => sum + d.weeklyDelta, 0));
  const headline = drivers.find((d) => d.weeklyDelta > 0) ?? null;

  return {
    hasSnapshot: false,
    basis: "Comparado con tu gasto normal de las últimas semanas (aún no guardo un histórico de margen día a día).",
    spendingUpWeekly,
    drivers,
    headline,
    confidence: baselines.confidence,
  };
}
