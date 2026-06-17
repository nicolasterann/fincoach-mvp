import type { Account, DebtAccount, RecurringExpense } from "@/types/financial";
import { sumLiquidSpendable, sumNonLiquid } from "@/lib/financial/liquidity";
import { roundMoney } from "@/lib/financial/money";

export interface FlexibleSpendingInput {
  accounts: Account[];
  debtAccounts: DebtAccount[];
  recurringExpenses: RecurringExpense[];
  plannedGoalContribution: number;
  protectedGoalMoneyOverride?: number;
  baseCurrency: string;
}

export interface FlexibleSpendingResult {
  // LIQUID, spendable-now money (bank/cash/wallet, non-goal). This is what
  // "available" means for weekly/daily coaching.
  totalAvailableCash: number;
  // Money the user holds but has marked as NOT spendable now (investments,
  // long-term savings). Surfaced separately; never part of spendable margin.
  nonLiquidCash: number;
  protectedGoalMoney: number;
  upcomingDebtPayments: number;
  upcomingRecurringExpenses: number;
  plannedGoalContribution: number;
  flexibleSpending: number;
  baseCurrency: string;
}

export function calculateFlexibleSpending(input: FlexibleSpendingInput): FlexibleSpendingResult {
  const protectedGoalAccountMoney = roundMoney(
    input.accounts
      .filter((account) => account.isGoalAccount)
      .reduce((total, account) => total + account.currentBalanceBase, 0),
  );

  const protectedGoalMoney = roundMoney(
    Math.max(protectedGoalAccountMoney, input.protectedGoalMoneyOverride ?? 0),
  );

  // Only LIQUID, non-goal money is spendable this week. Investments / long-term
  // savings (liquidity = 'non_liquid') and goal-account money are excluded so
  // "available" matches what the user can actually spend today.
  const totalAvailableCash = sumLiquidSpendable(input.accounts);
  const nonLiquidCash = sumNonLiquid(input.accounts);

  // Reserve the payment DUE this cycle (full or minimum), NOT the whole card
  // balance — consistent with Margen Kipu and the Stage 15 cashflow calendar, so
  // the dashboard, chat and Telegram never disagree on what's spendable. (You
  // don't pay off the entire card before you're allowed to spend.)
  const upcomingDebtPayments = roundMoney(
    input.debtAccounts.reduce((total, debt) => {
      const paymentDue = Math.max(debt.fullPaymentDue ?? 0, debt.minimumPayment ?? 0);
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
    nonLiquidCash,
    protectedGoalMoney,
    upcomingDebtPayments,
    upcomingRecurringExpenses,
    plannedGoalContribution: roundMoney(input.plannedGoalContribution),
    flexibleSpending,
    baseCurrency: input.baseCurrency,
  };
}
