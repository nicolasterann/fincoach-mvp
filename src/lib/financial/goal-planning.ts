import type { DebtPressureLevel } from "@/lib/financial/debt-pressure";
import type { FinancialGoal } from "@/types/financial";
import { formatMoney, roundMoney } from "@/lib/financial/money";

export type GoalPlanStatus =
  | "no_goal"
  | "missing_target"
  | "missing_deadline"
  | "achieved"
  | "on_track"
  | "tight"
  | "at_risk"
  | "not_realistic"
  | "blocked_by_debt_or_margin";

export const GOAL_PLAN_STATUS_LABELS: Record<GoalPlanStatus, string> = {
  no_goal: "Sin meta principal",
  missing_target: "Falta monto",
  missing_deadline: "Falta fecha",
  achieved: "Meta cumplida",
  on_track: "Vas bien",
  tight: "Ajustada",
  at_risk: "En riesgo",
  not_realistic: "No realista por ahora",
  blocked_by_debt_or_margin: "Primero estabilicemos",
};

export type GoalPlanDataQuality = "initial" | "partial" | "good";

export interface GoalPlan {
  status: GoalPlanStatus;
  statusLabel: string;
  targetAmount: number;
  currentAmount: number;
  remainingAmount: number;
  progressPercentage: number;
  targetDate: string | null;
  daysRemaining: number | null;
  weeksRemaining: number | null;
  monthsRemaining: number | null;
  deadlineIsPast: boolean;
  requiredWeeklyContribution: number | null;
  requiredMonthlyContribution: number | null;
  estimatedMonthlyCapacity: number;
  estimatedWeeklyCapacity: number;
  capacityGapMonthly: number | null;
  capacityGapWeekly: number | null;
  dataQuality: GoalPlanDataQuality;
  // true when the capacity used here does NOT yet subtract a real everyday
  // essential burn (essentials unknown) — so an "on_track"/"vas bien" status is
  // provisional. The UI/chat should soften it to "vas bien por ahora — lo afino
  // cuando conozca tu gasto real" instead of asserting a hard on-track.
  capacityPreliminary: boolean;
  message: string;
  nextActionLabel: string;
  nextActionDescription: string;
  suppressContributionPush: boolean;
}

export interface GoalPlanInput {
  goal: FinancialGoal | null;
  estimatedMonthlyIncome: number;
  estimatedMonthlyFixedExpenses: number;
  monthlyDebtDue: number;
  flexibleSpending: number;
  debtPressureLevel: DebtPressureLevel;
  baseCurrency: string;
  // Everyday essential burn (food/transport/…), monthly — the SAME figure the
  // cashflow uses. Subtracted from capacity so goals and cashflow agree on what's
  // free. Optional (default 0) for backward compatibility.
  essentialMonthlyEstimate?: number;
  // false when that essential burn is UNKNOWN (no configured estimate / thin
  // history) → the capacity omits it and any optimistic status is provisional.
  // Optional (default true = known) so legacy callers keep exact behavior.
  essentialsKnown?: boolean;
  now?: Date;
}

export function buildGoalPlan(input: GoalPlanInput): GoalPlan {
  const now = input.now ?? new Date();

  const suppressContributionPush =
    input.flexibleSpending <= 0 ||
    input.debtPressureLevel === "high" ||
    input.debtPressureLevel === "critical";

  // Conservative flow-based capacity: income minus fixed commitments, debt AND
  // the everyday essential burn — the SAME essential figure the cashflow subtracts,
  // so goals and cashflow can't disagree on what's actually free. When essentials
  // are unknown the burn is 0 here and the capacity is provisional (flagged below).
  const essentialMonthlyEstimate = Math.max(0, input.essentialMonthlyEstimate ?? 0);
  const essentialsKnown = input.essentialsKnown !== false; // default known (back-compat)
  const capacityPreliminary = !essentialsKnown;
  const estimatedMonthlyCapacity = roundMoney(
    Math.max(
      0,
      input.estimatedMonthlyIncome -
        input.estimatedMonthlyFixedExpenses -
        input.monthlyDebtDue -
        essentialMonthlyEstimate,
    ),
  );
  const estimatedWeeklyCapacity = roundMoney(estimatedMonthlyCapacity / 4.33);

  const dataQuality: GoalPlanDataQuality =
    input.estimatedMonthlyIncome > 0
      ? input.estimatedMonthlyFixedExpenses > 0 || input.monthlyDebtDue > 0
        ? "good"
        : "partial"
      : "initial";

  if (!input.goal) {
    return noGoalPlan(estimatedMonthlyCapacity, estimatedWeeklyCapacity, dataQuality, suppressContributionPush, capacityPreliminary);
  }

  const goal = input.goal;
  const targetAmount = roundMoney(goal.targetAmount);
  const currentAmount = roundMoney(goal.currentAmount);
  const remainingAmount = roundMoney(Math.max(targetAmount - currentAmount, 0));
  const progressPercentage =
    targetAmount <= 0 ? 0 : Math.min(Math.round((currentAmount / targetAmount) * 100), 100);
  const currency = goal.currency;

  if (targetAmount <= 0) {
    return missingTargetPlan(goal, currentAmount, estimatedMonthlyCapacity, estimatedWeeklyCapacity, dataQuality, suppressContributionPush, capacityPreliminary);
  }

  if (currentAmount >= targetAmount) {
    return achievedPlan(goal, targetAmount, currentAmount, progressPercentage, estimatedMonthlyCapacity, estimatedWeeklyCapacity, dataQuality, capacityPreliminary);
  }

  // Parse target date — empty string maps to missing
  const hasDeadlineString = !!goal.targetDate && goal.targetDate.length > 0;
  let targetDateObj: Date | null = null;

  if (hasDeadlineString) {
    const parsed = new Date(goal.targetDate);
    if (!Number.isNaN(parsed.getTime())) {
      targetDateObj = parsed;
    }
  }

  if (!targetDateObj) {
    return missingDeadlinePlan(goal, targetAmount, currentAmount, remainingAmount, progressPercentage, estimatedMonthlyCapacity, estimatedWeeklyCapacity, dataQuality, suppressContributionPush, capacityPreliminary);
  }

  // Time remaining
  const msRemaining = targetDateObj.getTime() - now.getTime();
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  const weeksRemaining = Math.max(Math.ceil(daysRemaining / 7), 0);
  const monthsRemaining = roundMoney(Math.max(daysRemaining / 30.44, 0));
  const deadlineIsPast = daysRemaining <= 0;

  // Required contributions (use raw days for division to avoid 0 denominator)
  const monthsForDivision = Math.max(daysRemaining / 30.44, 1 / 30.44);
  const requiredMonthlyContribution = roundMoney(remainingAmount / monthsForDivision);
  const requiredWeeklyContribution = roundMoney(requiredMonthlyContribution / 4.33);

  const capacityGapMonthly = roundMoney(estimatedMonthlyCapacity - requiredMonthlyContribution);
  const capacityGapWeekly = roundMoney(estimatedWeeklyCapacity - requiredWeeklyContribution);

  const baseFields = {
    targetAmount,
    currentAmount,
    remainingAmount,
    progressPercentage,
    targetDate: goal.targetDate,
    daysRemaining,
    weeksRemaining,
    monthsRemaining,
    deadlineIsPast,
    requiredWeeklyContribution,
    requiredMonthlyContribution,
    estimatedMonthlyCapacity,
    estimatedWeeklyCapacity,
    capacityGapMonthly,
    capacityGapWeekly,
    dataQuality,
    capacityPreliminary,
  };

  if (deadlineIsPast) {
    const status: GoalPlanStatus =
      estimatedMonthlyCapacity <= 0 || requiredMonthlyContribution > estimatedMonthlyCapacity * 2
        ? "not_realistic"
        : "at_risk";
    return {
      ...baseFields,
      status,
      statusLabel: GOAL_PLAN_STATUS_LABELS[status],
      message: `La fecha límite de "${goal.name}" ya pasó. Ajustemos el plan — falta ${formatMoney(remainingAmount, currency)}.`,
      nextActionLabel: "Actualiza la fecha",
      nextActionDescription: "Define una nueva fecha alcanzable y Kipu recalcula el plan.",
      suppressContributionPush,
    };
  }

  // Blocked by debt or negative margin — takes priority over feasibility status
  if (suppressContributionPush) {
    return {
      ...baseFields,
      status: "blocked_by_debt_or_margin",
      statusLabel: GOAL_PLAN_STATUS_LABELS.blocked_by_debt_or_margin,
      message: `Tu meta sigue viva, pero esta semana no conviene forzar aportes. Primero cubramos compromisos; "${goal.name}" está protegida.`,
      nextActionLabel: "Estabiliza primero",
      nextActionDescription: "Cuando el margen mejore, retomamos los aportes a la meta.",
      suppressContributionPush: true,
    };
  }

  // Feasibility: determine status from capacity ratio
  if (estimatedMonthlyCapacity <= 0) {
    return {
      ...baseFields,
      status: "not_realistic",
      statusLabel: GOAL_PLAN_STATUS_LABELS.not_realistic,
      message: `Con los números actuales, llegar a "${goal.name}" para esa fecha no es realista. No está cancelada — ajusta el plazo o el monto.`,
      nextActionLabel: "Ajusta el plan",
      nextActionDescription: "Una fecha más amplia o un monto menor haría esta meta alcanzable.",
      suppressContributionPush: false,
    };
  }

  const ratio = requiredMonthlyContribution / estimatedMonthlyCapacity;

  if (ratio <= 0.85) {
    return {
      ...baseFields,
      status: "on_track",
      statusLabel: GOAL_PLAN_STATUS_LABELS.on_track,
      // When essentials are unknown the capacity omits everyday burn — the status is
      // provisional, so phrase it as "vas bien por ahora" instead of a hard on-track.
      message: capacityPreliminary
        ? `Para llegar a "${goal.name}" a tiempo, necesitas cerca de ${formatMoney(requiredWeeklyContribution, currency)} por semana. Vas bien por ahora — lo afino cuando conozca tu gasto real del día a día.`
        : `Para llegar a "${goal.name}" a tiempo, necesitas cerca de ${formatMoney(requiredWeeklyContribution, currency)} por semana. Con tu margen actual, vas bien.`,
      nextActionLabel: "Sigue aportando",
      nextActionDescription: "Mantén el ritmo y la meta llegará sola.",
      suppressContributionPush: false,
    };
  }

  if (ratio <= 1.05) {
    return {
      ...baseFields,
      status: "tight",
      statusLabel: GOAL_PLAN_STATUS_LABELS.tight,
      message: `Para "${goal.name}" necesitas cerca de ${formatMoney(requiredWeeklyContribution, currency)} por semana. Tu margen está justo — no está cancelada, pero cuida los aportes.`,
      nextActionLabel: "Cuida el ritmo",
      nextActionDescription: "Con margen ajustado, cada aporte cuenta más.",
      suppressContributionPush: false,
    };
  }

  if (ratio <= 1.75) {
    return {
      ...baseFields,
      status: "at_risk",
      statusLabel: GOAL_PLAN_STATUS_LABELS.at_risk,
      message: `La meta "${goal.name}" está en riesgo para esta fecha. Necesitarías ${formatMoney(requiredMonthlyContribution, currency)}/mes, pero tu margen estimado es ${formatMoney(estimatedMonthlyCapacity, currency)}/mes.`,
      nextActionLabel: "Ajusta el plazo o el monto",
      nextActionDescription: "Una fecha más amplia haría esta meta más alcanzable.",
      suppressContributionPush: false,
    };
  }

  return {
    ...baseFields,
    status: "not_realistic",
    statusLabel: GOAL_PLAN_STATUS_LABELS.not_realistic,
    message: `Con los números actuales, llegar a "${goal.name}" para esa fecha no es realista. No está cancelada — ajusta el plazo o el monto y volvemos a calcular.`,
    nextActionLabel: "Ajusta el plan",
    nextActionDescription: "Una fecha más amplia o un monto menor haría esta meta alcanzable.",
    suppressContributionPush: false,
  };
}

// ─── Internal branch builders ─────────────────────────────────────────────────

function noGoalPlan(
  estimatedMonthlyCapacity: number,
  estimatedWeeklyCapacity: number,
  dataQuality: GoalPlanDataQuality,
  suppressContributionPush: boolean,
  capacityPreliminary: boolean,
): GoalPlan {
  return {
    status: "no_goal",
    statusLabel: GOAL_PLAN_STATUS_LABELS.no_goal,
    targetAmount: 0,
    currentAmount: 0,
    remainingAmount: 0,
    progressPercentage: 0,
    targetDate: null,
    daysRemaining: null,
    weeksRemaining: null,
    monthsRemaining: null,
    deadlineIsPast: false,
    requiredWeeklyContribution: null,
    requiredMonthlyContribution: null,
    estimatedMonthlyCapacity,
    estimatedWeeklyCapacity,
    capacityGapMonthly: null,
    capacityGapWeekly: null,
    dataQuality,
    capacityPreliminary,
    message: "Todavía no tienes una meta principal. Define una y Kipu te ayuda a planificarla.",
    nextActionLabel: "Define tu meta",
    nextActionDescription: "Cuéntale a Kipu cuánto quieres ahorrar y para cuándo.",
    suppressContributionPush,
  };
}

function missingTargetPlan(
  goal: FinancialGoal,
  currentAmount: number,
  estimatedMonthlyCapacity: number,
  estimatedWeeklyCapacity: number,
  dataQuality: GoalPlanDataQuality,
  suppressContributionPush: boolean,
  capacityPreliminary: boolean,
): GoalPlan {
  return {
    status: "missing_target",
    statusLabel: GOAL_PLAN_STATUS_LABELS.missing_target,
    targetAmount: 0,
    currentAmount,
    remainingAmount: 0,
    progressPercentage: 0,
    targetDate: goal.targetDate || null,
    daysRemaining: null,
    weeksRemaining: null,
    monthsRemaining: null,
    deadlineIsPast: false,
    requiredWeeklyContribution: null,
    requiredMonthlyContribution: null,
    estimatedMonthlyCapacity,
    estimatedWeeklyCapacity,
    capacityGapMonthly: null,
    capacityGapWeekly: null,
    dataQuality,
    capacityPreliminary,
    message: `La meta "${goal.name}" necesita un monto objetivo para convertirse en un plan real.`,
    nextActionLabel: "Define el monto objetivo",
    nextActionDescription: "¿Cuánto necesitas ahorrar para esta meta?",
    suppressContributionPush,
  };
}

function achievedPlan(
  goal: FinancialGoal,
  targetAmount: number,
  currentAmount: number,
  progressPercentage: number,
  estimatedMonthlyCapacity: number,
  estimatedWeeklyCapacity: number,
  dataQuality: GoalPlanDataQuality,
  capacityPreliminary: boolean,
): GoalPlan {
  return {
    status: "achieved",
    statusLabel: GOAL_PLAN_STATUS_LABELS.achieved,
    targetAmount,
    currentAmount,
    remainingAmount: 0,
    progressPercentage,
    targetDate: goal.targetDate || null,
    daysRemaining: null,
    weeksRemaining: null,
    monthsRemaining: null,
    deadlineIsPast: false,
    requiredWeeklyContribution: 0,
    requiredMonthlyContribution: 0,
    estimatedMonthlyCapacity,
    estimatedWeeklyCapacity,
    capacityGapMonthly: 0,
    capacityGapWeekly: 0,
    dataQuality,
    capacityPreliminary,
    message: `¡"${goal.name}" está cumplida! Llegaste a la meta. ¿Qué sigue?`,
    nextActionLabel: "Define la próxima meta",
    nextActionDescription: "Terminaste este capítulo. Es buen momento para pensar qué sigue.",
    suppressContributionPush: false,
  };
}

function missingDeadlinePlan(
  goal: FinancialGoal,
  targetAmount: number,
  currentAmount: number,
  remainingAmount: number,
  progressPercentage: number,
  estimatedMonthlyCapacity: number,
  estimatedWeeklyCapacity: number,
  dataQuality: GoalPlanDataQuality,
  suppressContributionPush: boolean,
  capacityPreliminary: boolean,
): GoalPlan {
  return {
    status: "missing_deadline",
    statusLabel: GOAL_PLAN_STATUS_LABELS.missing_deadline,
    targetAmount,
    currentAmount,
    remainingAmount,
    progressPercentage,
    targetDate: null,
    daysRemaining: null,
    weeksRemaining: null,
    monthsRemaining: null,
    deadlineIsPast: false,
    requiredWeeklyContribution: null,
    requiredMonthlyContribution: null,
    estimatedMonthlyCapacity,
    estimatedWeeklyCapacity,
    capacityGapMonthly: null,
    capacityGapWeekly: null,
    dataQuality,
    capacityPreliminary,
    message: suppressContributionPush
      ? `Falta una fecha para convertir "${goal.name}" en un plan real. Por ahora no forcemos aportes: primero cuidamos compromisos y mantenemos la meta protegida.`
      : `Falta una fecha para convertir "${goal.name}" en un plan real. Cuando la definas, Kipu calcula cuánto necesitas por semana.`,
    nextActionLabel: suppressContributionPush ? "Estabiliza y define fecha" : "Agrega una fecha límite",
    nextActionDescription: suppressContributionPush
      ? "Cuando el margen mejore, definir la fecha convierte esta meta en un plan real."
      : "Con una fecha, Kipu puede convertir esta meta en un plan real.",
    suppressContributionPush,
  };
}
