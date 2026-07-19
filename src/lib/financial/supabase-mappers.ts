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
  // Stage 30 (migration 035) — optional so reads degrade gracefully if 035 is
  // not yet applied (the column is simply absent from a `select("*")` row).
  notes?: string | null;
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
  statement_total_due?: number | string | null;
  statement_covered?: boolean | null;
  due_day: number | null;
  cutoff_day: number | null;
  interest_rate: number | string | null;
  default_payment_account_id: string | null;
  // Stage 14 (migration 023) — optional so reads degrade gracefully if 023 is
  // not yet applied (the column is simply absent from a `select("*")` row).
  interest_rate_kind?: string | null;
  statement_date?: string | null;
  statement_period_end?: string | null;
  last_statement_evidence_id?: string | null;
  // Stage 30 (migration 035) — card billing-cycle paid signal + coach note.
  // Optional so reads degrade gracefully before 035 is applied.
  last_payment_date?: string | null;
  notes?: string | null;
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
  // Stage 30 (migration 035) — coach note. Optional so reads degrade gracefully
  // before 035 is applied.
  notes?: string | null;
  // S34 — the goal-OS columns (migration 025) the context select now loads so
  // ctx.mainGoal carries archetype/committed contribution (they were selected
  // nowhere on this path → dead branches downstream). Optional: degrade pre-025.
  archetype?: string | null;
  goal_type?: string | null;
  contribution_amount?: number | string | null;
  cadence?: string | null;
  cashflow_protected?: boolean | null;
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
    notes: row.notes ?? undefined,
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
    statementTotalDue: row.statement_total_due == null ? undefined : toNumber(row.statement_total_due),
    statementCovered: row.statement_covered == null ? undefined : row.statement_covered,
    dueDay: row.due_day ?? undefined,
    cutoffDay: row.cutoff_day ?? undefined,
    interestRate: row.interest_rate === null ? undefined : toNumber(row.interest_rate),
    interestRateKind:
      row.interest_rate_kind === "annual_effective" || row.interest_rate_kind === "monthly"
        ? row.interest_rate_kind
        : row.interest_rate_kind === "annual_nominal"
          ? "annual_nominal"
          : undefined,
    defaultPaymentAccountId: row.default_payment_account_id ?? undefined,
    statementDate: row.statement_date ?? undefined,
    statementPeriodEnd: row.statement_period_end ?? undefined,
    lastStatementEvidenceId: row.last_statement_evidence_id ?? undefined,
    lastPaymentDate: row.last_payment_date ?? undefined,
    notes: row.notes ?? undefined,
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
    notes: row.notes ?? undefined,
    archetype: (row.archetype ?? undefined) as FinancialGoal["archetype"],
    goalType: (row.goal_type ?? undefined) as FinancialGoal["goalType"],
    contributionAmount: row.contribution_amount != null ? toNumber(row.contribution_amount) : undefined,
    cadence: (row.cadence ?? undefined) as FinancialGoal["cadence"],
    cashflowProtected: row.cashflow_protected ?? undefined,
    createdAt: row.created_at,
  };
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}
