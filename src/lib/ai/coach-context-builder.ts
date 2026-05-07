import type { CoachFinancialSnapshot } from "@/lib/ai/coach-response-contract";
import { buildFinancialDashboard } from "@/lib/financial/dashboard";
import type {
  Account,
  DebtAccount,
  FinancialGoal,
  RecurringExpense,
  VariableBudgetEstimate,
} from "@/types/financial";

export interface BuildCoachFinancialSnapshotInput {
  accounts: Account[];
  debtAccounts: DebtAccount[];
  recurringExpenses?: RecurringExpense[];
  variableBudgetEstimates?: VariableBudgetEstimate[];
  goal: FinancialGoal;
  monthlyIncome?: number;
  estimatedMonthlySavingsCapacity?: number;
  monthsRemainingForGoal?: number;
}

export function buildCoachFinancialSnapshot({
  accounts,
  debtAccounts,
  recurringExpenses = [],
  variableBudgetEstimates = [],
  goal,
  monthlyIncome = 1000,
  estimatedMonthlySavingsCapacity = 100,
  monthsRemainingForGoal = 6,
}: BuildCoachFinancialSnapshotInput): CoachFinancialSnapshot {
  const dashboard = buildFinancialDashboard({
    accounts,
    debtAccounts,
    recurringExpenses,
    variableBudgetEstimates,
    goal,
    monthlyIncome,
    estimatedMonthlySavingsCapacity,
    monthsRemainingForGoal,
  });

  return {
    flexibleSpending: dashboard.flexibleSpending.flexibleSpending,
    dailySuggestedLimit: dashboard.weeklyPlan.dailySuggestedLimit,
    baseCurrency: dashboard.weeklyPlan.baseCurrency,
    protectedGoalMoney: dashboard.flexibleSpending.protectedGoalMoney,
    goalProgressPercentage: dashboard.goalProgress.progressPercentage,
  };
}
