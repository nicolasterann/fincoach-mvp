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

export interface LiquidAccountLine {
  name: string;
  type: Account["type"];
  balance: number;
}

// Exact, reconciling liquid picture for the agent so it NEVER does its own
// arithmetic on account balances (a QA bug: stated breakdown summed to a
// different total than the headline). `bankTotal` / `cashTotal` / `walletTotal`
// let Kipu compare like-for-like: when the user says "en el banco tengo X",
// compare against bankTotal, not the mixed liquid total.
export interface LiquidBreakdown {
  lines: LiquidAccountLine[];
  liquidTotal: number;
  bankTotal: number;
  cashTotal: number;
  walletTotal: number;
}

export function buildLiquidBreakdown(accounts: Account[]): LiquidBreakdown {
  const spendable = accounts.filter(isLiquidSpendable);
  const lines: LiquidAccountLine[] = spendable.map((account) => ({
    name: account.name,
    type: account.type,
    balance: roundMoney(account.currentBalanceBase),
  }));

  const sumType = (type: Account["type"]) =>
    roundMoney(
      spendable
        .filter((account) => account.type === type)
        .reduce((total, account) => total + account.currentBalanceBase, 0),
    );

  return {
    lines,
    liquidTotal: roundMoney(
      spendable.reduce((total, account) => total + account.currentBalanceBase, 0),
    ),
    bankTotal: sumType("bank"),
    cashTotal: sumType("cash"),
    walletTotal: sumType("wallet"),
  };
}
