import type { Account, DebtAccount, FinancialGoal } from "@/types/financial";

export interface SupabaseAccountRow {
  id: string;
  user_id: string;
  name: string;
  type: Account["type"];
  currency: string;
  current_balance_original: number | string;
  current_balance_base: number | string;
  is_goal_account: boolean;
  liquidity?: Account["liquidity"] | null;
  created_at: string;
}

export interface SupabaseDebtAccountRow {
  id: string;
  user_id: string;
  name: string;
  type: DebtAccount["type"];
  currency: string;
  current_balance_original: number | string;
  current_balance_base: number | string;
  minimum_payment: number | string | null;
  full_payment_due: number | string | null;
  due_day: number | null;
  cutoff_day: number | null;
  interest_rate: number | string | null;
  default_payment_account_id: string | null;
  created_at: string;
}

export interface SupabaseGoalRow {
  id: string;
  user_id: string;
  name: string;
  target_amount: number | string;
  currency: string;
  current_amount: number | string;
  target_date: string | null;
  goal_account_id: string | null;
  status: FinancialGoal["status"];
  feasibility_status: FinancialGoal["feasibilityStatus"];
  weekly_required_amount: number | string;
  monthly_required_amount: number | string;
  created_at: string;
}

export function mapSupabaseAccount(row: SupabaseAccountRow): Account {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    currentBalanceOriginal: toNumber(row.current_balance_original),
    currentBalanceBase: toNumber(row.current_balance_base),
    isGoalAccount: row.is_goal_account,
    liquidity: row.liquidity ?? "liquid",
    createdAt: row.created_at,
  };
}

export function mapSupabaseDebtAccount(row: SupabaseDebtAccountRow): DebtAccount {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    currentBalanceOriginal: toNumber(row.current_balance_original),
    currentBalanceBase: toNumber(row.current_balance_base),
    minimumPayment: row.minimum_payment === null ? undefined : toNumber(row.minimum_payment),
    fullPaymentDue: row.full_payment_due === null ? undefined : toNumber(row.full_payment_due),
    dueDay: row.due_day ?? undefined,
    cutoffDay: row.cutoff_day ?? undefined,
    interestRate: row.interest_rate === null ? undefined : toNumber(row.interest_rate),
    defaultPaymentAccountId: row.default_payment_account_id ?? undefined,
    createdAt: row.created_at,
  };
}

export function mapSupabaseGoal(row: SupabaseGoalRow): FinancialGoal {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    targetAmount: toNumber(row.target_amount),
    currency: row.currency,
    currentAmount: toNumber(row.current_amount),
    targetDate: row.target_date ?? "",
    goalAccountId: row.goal_account_id ?? undefined,
    status: row.status,
    feasibilityStatus: row.feasibility_status,
    weeklyRequiredAmount: toNumber(row.weekly_required_amount),
    monthlyRequiredAmount: toNumber(row.monthly_required_amount),
    createdAt: row.created_at,
  };
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}
