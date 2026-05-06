import type {
  Account,
  DebtAccount,
  FinancialGoal,
  RecurringExpense,
  VariableBudgetEstimate,
} from "@/types/financial";
import { calculateBudgetReality } from "@/lib/financial/budget-reality";
import { calculateDebtPressure } from "@/lib/financial/debt-pressure";
import { calculateFlexibleSpending } from "@/lib/financial/flexible-spending";
import { calculateGoalFeasibility, calculateGoalProgress } from "@/lib/financial/goals";
import { calculateWeeklyPlan } from "@/lib/financial/weekly-plan";

export interface FinancialDashboardInput {
  accounts: Account[];
  debtAccounts: DebtAccount[];
  recurringExpenses: RecurringExpense[];
  variableBudgetEstimates: VariableBudgetEstimate[];
  goal: FinancialGoal;
  monthlyIncome: number;
  estimatedMonthlySavingsCapacity: number;
  monthsRemainingForGoal: number;
}

export function buildFinancialDashboard(input: FinancialDashboardInput) {
  const goalProgress = calculateGoalProgress(input.goal);

  const flexibleSpending = calculateFlexibleSpending({
    accounts: input.accounts,
    debtAccounts: input.debtAccounts,
    recurringExpenses: input.recurringExpenses,
    plannedGoalContribution: input.goal.weeklyRequiredAmount,
    protectedGoalMoneyOverride: input.goal.currentAmount,
    baseCurrency: input.goal.currency,
  });

  const weeklyPlan = calculateWeeklyPlan({
    flexibleSpending: flexibleSpending.flexibleSpending,
    baseCurrency: input.goal.currency,
  });

  const debtPressure = calculateDebtPressure({
    debtAccounts: input.debtAccounts,
    monthlyIncome: input.monthlyIncome,
  });

  const budgetReality = calculateBudgetReality(input.variableBudgetEstimates);

  const goalFeasibility = calculateGoalFeasibility({
    targetAmount: input.goal.targetAmount,
    currentAmount: input.goal.currentAmount,
    monthsRemaining: input.monthsRemainingForGoal,
    estimatedMonthlySavingsCapacity: input.estimatedMonthlySavingsCapacity,
  });

  return {
    goalProgress,
    flexibleSpending,
    weeklyPlan,
    debtPressure,
    budgetReality,
    goalFeasibility,
  };
}
