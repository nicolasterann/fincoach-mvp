import type { Account, DebtAccount, FinancialGoal, RecurringExpense, VariableBudgetEstimate } from "@/types/financial";

export const demoUserId = "demo-user-1";

export const demoAccounts: Account[] = [
  {
    id: "account-pichincha",
    userId: demoUserId,
    name: "Pichincha",
    type: "bank",
    currency: "USD",
    currentBalanceOriginal: 420,
    currentBalanceBase: 420,
    isGoalAccount: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: "account-cash",
    userId: demoUserId,
    name: "Efectivo",
    type: "cash",
    currency: "USD",
    currentBalanceOriginal: 35,
    currentBalanceBase: 35,
    isGoalAccount: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: "account-brazil-goal",
    userId: demoUserId,
    name: "Cuenta Brasil",
    type: "goal_account",
    currency: "USD",
    currentBalanceOriginal: 180,
    currentBalanceBase: 180,
    isGoalAccount: true,
    createdAt: new Date().toISOString(),
  },
];

export const demoDebtAccounts: DebtAccount[] = [
  {
    id: "debt-visa",
    userId: demoUserId,
    name: "Visa Pichincha",
    type: "credit_card",
    currency: "USD",
    currentBalanceOriginal: 80,
    currentBalanceBase: 80,
    minimumPayment: 20,
    fullPaymentDue: 80,
    dueDay: 29,
    cutoffDay: 15,
    interestRate: 15,
    defaultPaymentAccountId: "account-pichincha",
    createdAt: new Date().toISOString(),
  },
];

export const demoRecurringExpenses: RecurringExpense[] = [
  {
    id: "recurring-rent",
    userId: demoUserId,
    name: "Arriendo",
    amount: 300,
    currency: "USD",
    category: "housing",
    frequency: "monthly",
    expectedDay: 1,
    paymentSourceId: "account-pichincha",
    confidenceLevel: "high",
    status: "active",
    createdAt: new Date().toISOString(),
  },
  {
    id: "recurring-netflix",
    userId: demoUserId,
    name: "Netflix",
    amount: 10,
    currency: "USD",
    category: "subscriptions",
    frequency: "monthly",
    expectedDay: 15,
    paymentSourceId: "account-pichincha",
    confidenceLevel: "high",
    status: "active",
    createdAt: new Date().toISOString(),
  },
];

export const demoVariableBudgetEstimates: VariableBudgetEstimate[] = [
  {
    id: "estimate-food",
    userId: demoUserId,
    category: "food",
    initialEstimate: 200,
    currentEstimate: 430,
    currency: "USD",
    confidenceLevel: "medium",
    lastCalculatedAt: new Date().toISOString(),
  },
  {
    id: "estimate-transport",
    userId: demoUserId,
    category: "transport",
    initialEstimate: 80,
    currentEstimate: 95,
    currency: "USD",
    confidenceLevel: "medium",
    lastCalculatedAt: new Date().toISOString(),
  },
];

export const demoGoal: FinancialGoal = {
  id: "goal-brazil",
  userId: demoUserId,
  name: "Viaje a Brasil",
  targetAmount: 800,
  currency: "USD",
  currentAmount: 180,
  targetDate: "2026-12-15",
  goalAccountId: "account-brazil-goal",
  status: "active",
  feasibilityStatus: "challenging",
  weeklyRequiredAmount: 35,
  monthlyRequiredAmount: 140,
  createdAt: new Date().toISOString(),
};
