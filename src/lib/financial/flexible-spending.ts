import type { Account, DebtAccount, RecurringExpense } from "@/types/financial";
import { roundMoney } from "@/lib/financial/money";

export interface FlexibleSpendingInput {
  accounts: Account[];
  debtAccounts: DebtAccount[];
  recurringExpenses: RecurringExpense[];
  plannedGoalContribution: number;
  baseCurrency: string;
}

export interface FlexibleSpendingResult {
  totalAvailableCash: number;
  protectedGoalMoney: number;
  upcomingDebtPayments: number;
  upcomingRecurringExpenses: number;
  plannedGoalContribution: number;
  flexibleSpending: number;
  baseCurrency: string;
}

export function calculateFlexibleSpending(input: FlexibleSpendingInput): FlexibleSpendingResult {
  const protectedGoalMoney = roundMoney(
    input.accounts
      .filter((account) => account.isGoalAccount)
      .reduce((total, account) => total + account.currentBalanceBase, 0),
  );

  const totalAvailableCash = roundMoney(
    input.accounts
      .filter((account) => !account.isGoalAccount)
      .reduce((total, account) => total + account.currentBalanceBase, 0),
  );

  const upcomingDebtPayments = roundMoney(
    input.debtAccounts.reduce((total, debt) => {
      const paymentDue = debt.fullPaymentDue ?? debt.minimumPayment ?? 0;
      return total + paymentDue;
    }, 0),
  );

  const upcomingRecurringExpenses = roundMoney(
    input.recurringExpenses
      .filter((expense) => expense.status === "active")
      .reduce((total, expense) => total + expense.amount, 0),
  );

  const flexibleSpending = roundMoney(
    totalAvailableCash -
      upcomingDebtPayments -
      upcomingRecurringExpenses -
      input.plannedGoalContribution,
  );

  return {
    totalAvailableCash,
    protectedGoalMoney,
    upcomingDebtPayments,
    upcomingRecurringExpenses,
    plannedGoalContribution: roundMoney(input.plannedGoalContribution),
    flexibleSpending,
    baseCurrency: input.baseCurrency,
  };
}
