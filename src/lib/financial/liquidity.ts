import type { Account } from "@/types/financial";
import { roundMoney } from "@/lib/financial/money";

// Liquidity realism (Stage 5). "Available this week" must be money the user can
// actually spend NOW: liquid, non-goal accounts (bank/cash/wallet). Money that
// is NOT spendable today — investments, long-term/protected savings, goal-
// account money — is excluded from spendable margin and surfaced separately.
// A receivable (money owed to the user) lives in its own ledger and is never
// counted here. Absent liquidity flag = liquid (back-compat default).

export function isLiquidSpendable(account: Account): boolean {
  return !account.isGoalAccount && account.liquidity !== "non_liquid";
}

export function sumLiquidSpendable(accounts: Account[]): number {
  return roundMoney(
    accounts
      .filter(isLiquidSpendable)
      .reduce((total, account) => total + account.currentBalanceBase, 0),
  );
}

// Non-goal money the user has marked as NOT spendable now (investments,
// long-term savings). Surfaced separately so Kipu can mention it without
// inflating spendable margin.
export function sumNonLiquid(accounts: Account[]): number {
  return roundMoney(
    accounts
      .filter((account) => !account.isGoalAccount && account.liquidity === "non_liquid")
      .reduce((total, account) => total + account.currentBalanceBase, 0),
  );
}

export function hasNonLiquid(accounts: Account[]): boolean {
  return accounts.some(
    (account) => !account.isGoalAccount && account.liquidity === "non_liquid",
  );
}
