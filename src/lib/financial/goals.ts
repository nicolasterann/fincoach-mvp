import type { FinancialGoal, GoalFeasibilityStatus } from "@/types/financial";
import { roundMoney } from "@/lib/financial/money";

export interface GoalProgressResult {
  currentAmount: number;
  targetAmount: number;
  remainingAmount: number;
  progressPercentage: number;
  isCompleted: boolean;
}

export interface GoalFeasibilityInput {
  targetAmount: number;
  currentAmount: number;
  monthsRemaining: number;
  estimatedMonthlySavingsCapacity: number;
}

export interface GoalFeasibilityResult {
  status: GoalFeasibilityStatus;
  requiredMonthlySavings: number;
  savingsGap: number;
  message: string;
}

export function calculateGoalProgress(goal: FinancialGoal): GoalProgressResult {
  const currentAmount = roundMoney(goal.currentAmount);
  const targetAmount = roundMoney(goal.targetAmount);
  const remainingAmount = roundMoney(Math.max(targetAmount - currentAmount, 0));
  const progressPercentage =
    targetAmount <= 0 ? 0 : Math.min(Math.round((currentAmount / targetAmount) * 100), 100);

  return {
    currentAmount,
    targetAmount,
    remainingAmount,
    progressPercentage,
    isCompleted: currentAmount >= targetAmount,
  };
}

export function calculateGoalFeasibility(input: GoalFeasibilityInput): GoalFeasibilityResult {
  const remainingAmount = roundMoney(Math.max(input.targetAmount - input.currentAmount, 0));
  const monthsRemaining = Math.max(input.monthsRemaining, 1);
  const requiredMonthlySavings = roundMoney(remainingAmount / monthsRemaining);
  const savingsGap = roundMoney(requiredMonthlySavings - input.estimatedMonthlySavingsCapacity);

  if (remainingAmount <= 0) {
    return {
      status: "viable",
      requiredMonthlySavings: 0,
      savingsGap: 0,
      message: "La meta ya está completa.",
    };
  }

  if (input.estimatedMonthlySavingsCapacity <= 0) {
    return {
      status: "not_currently_viable",
      requiredMonthlySavings,
      savingsGap,
      message:
        "Con tus números actuales, esta meta no es viable todavía. Necesitamos ajustar plazo, monto o capacidad de ahorro.",
    };
  }

  const capacityRatio = input.estimatedMonthlySavingsCapacity / requiredMonthlySavings;

  if (capacityRatio >= 1.1) {
    return {
      status: "viable",
      requiredMonthlySavings,
      savingsGap: 0,
      message: "La meta es viable con tu capacidad actual.",
    };
  }

  if (capacityRatio >= 0.8) {
    return {
      status: "challenging",
      requiredMonthlySavings,
      savingsGap: Math.max(savingsGap, 0),
      message: "La meta es desafiante, pero todavía podemos llegar con disciplina y ajustes.",
    };
  }

  if (capacityRatio >= 0.5) {
    return {
      status: "at_risk",
      requiredMonthlySavings,
      savingsGap,
      message:
        "La meta está en riesgo. Necesitamos reducir gastos, sumar ingresos o ajustar el plazo.",
    };
  }

  return {
    status: "not_currently_viable",
    requiredMonthlySavings,
    savingsGap,
    message:
      "Con tus números actuales, esta meta no es alcanzable en ese plazo sin poner presión sobre tu estabilidad financiera.",
  };
}
