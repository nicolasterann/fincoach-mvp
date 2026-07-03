import type {
  BudgetCategory,
  CoachPreferences,
  FixedExpense,
  FinancialContextSnapshot,
  IncomeSource,
  SpendingAlertRule,
  UserContextNote,
} from "@/types/financial";

export interface SupabaseIncomeSourceRow {
  id: string;
  user_id: string;
  name: string;
  amount: number | string;
  currency: string;
  frequency: IncomeSource["frequency"];
  expected_day: number | null;
  expected_weekday: number | null;
  is_variable: boolean;
  min_expected_amount: number | string | null;
  max_expected_amount: number | string | null;
  destination_account_id: string | null;
  status: IncomeSource["status"];
  notes: string | null;
  // Stage 24 (migration 032) — absent (undefined) until applied; degrades gracefully.
  pay_anchor_date?: string | null;
  created_at: string;
}

export interface SupabaseFixedExpenseRow {
  id: string;
  user_id: string;
  name: string;
  amount: number | string;
  currency: string;
  category: FixedExpense["category"];
  frequency: FixedExpense["frequency"];
  expected_day: number | null;
  expected_weekday: number | null;
  payment_source_type: FixedExpense["paymentSourceType"] | null;
  payment_source_id: string | null;
  is_essential: boolean;
  is_active: boolean;
  // Stage 30 (migration 035) — varies month to month (gas, luz). Optional so
  // reads degrade gracefully (absent → false = truly fixed) before 035 is applied.
  is_variable?: boolean | null;
  // Stage 32 (migration 038) — weekly/biweekly pay anchor + is_variable confirm
  // stamp. Optional so reads degrade gracefully before 038 is applied.
  pay_anchor_date?: string | null;
  last_confirmed_month?: string | null;
  notes: string | null;
  start_date?: string | null;
  created_at: string;
}

export interface SupabaseCoachPreferencesRow {
  user_id: string;
  tone: CoachPreferences["tone"];
  strictness_level: CoachPreferences["strictnessLevel"];
  humor_level: CoachPreferences["humorLevel"];
  detail_level: CoachPreferences["detailLevel"];
  proactive_alerts_enabled: boolean;
  weekly_review_enabled: boolean;
  daily_checkin_enabled: boolean;
  preferred_language: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupabaseBudgetCategoryRow {
  id: string;
  user_id: string;
  category: BudgetCategory["category"];
  amount: number | string;
  currency: string;
  period: BudgetCategory["period"];
  alert_threshold_percentage: number | string;
  is_active: boolean;
  // Stage 32 (migration 038) — month-to-date seed + its calendar month.
  // Optional so reads degrade gracefully before 038 is applied.
  mtd_seed?: number | string | null;
  seed_month?: string | null;
  created_at: string;
}

export interface SupabaseSpendingAlertRuleRow {
  id: string;
  user_id: string;
  name: string;
  rule_type: SpendingAlertRule["ruleType"];
  category: SpendingAlertRule["category"] | null;
  account_id: string | null;
  debt_account_id: string | null;
  threshold_amount: number | string | null;
  threshold_percentage: number | string | null;
  period: SpendingAlertRule["period"] | null;
  is_active: boolean;
  created_at: string;
}

export interface SupabaseUserContextNoteRow {
  id: string;
  user_id: string;
  note_type: UserContextNote["noteType"];
  content: string;
  source: UserContextNote["source"];
  is_active: boolean;
  created_at: string;
}

export interface SupabaseFinancialContextSnapshotRow {
  id: string;
  user_id: string;
  snapshot_date: string;
  base_currency: string;
  total_available: number | string;
  total_debt: number | string;
  total_goal_savings: number | string;
  weekly_available: number | string;
  daily_suggested: number | string;
  fixed_expenses_pending: number | string;
  debt_payments_pending: number | string;
  goal_contributions_required: number | string;
  raw_snapshot: Record<string, unknown>;
  created_at: string;
}

export function mapSupabaseIncomeSource(row: SupabaseIncomeSourceRow): IncomeSource {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    amount: Number(row.amount),
    currency: row.currency,
    frequency: row.frequency,
    expectedDay: row.expected_day ?? undefined,
    expectedWeekday: row.expected_weekday ?? undefined,
    isVariable: row.is_variable,
    minExpectedAmount:
      row.min_expected_amount === null ? undefined : Number(row.min_expected_amount),
    maxExpectedAmount:
      row.max_expected_amount === null ? undefined : Number(row.max_expected_amount),
    destinationAccountId: row.destination_account_id ?? undefined,
    status: row.status,
    notes: row.notes ?? undefined,
    payAnchorDate: row.pay_anchor_date ?? undefined,
    createdAt: row.created_at,
  };
}

export function mapSupabaseFixedExpense(row: SupabaseFixedExpenseRow): FixedExpense {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    amount: Number(row.amount),
    currency: row.currency,
    category: row.category,
    frequency: row.frequency,
    expectedDay: row.expected_day ?? undefined,
    expectedWeekday: row.expected_weekday ?? undefined,
    paymentSourceType: row.payment_source_type ?? undefined,
    paymentSourceId: row.payment_source_id ?? undefined,
    isEssential: row.is_essential,
    isActive: row.is_active,
    isVariable: row.is_variable ?? false,
    payAnchorDate: row.pay_anchor_date ?? undefined,
    lastConfirmedMonth: row.last_confirmed_month ?? undefined,
    notes: row.notes ?? undefined,
    startDate: row.start_date ?? undefined,
    createdAt: row.created_at,
  };
}

export function mapSupabaseCoachPreferences(
  row: SupabaseCoachPreferencesRow,
): CoachPreferences {
  return {
    userId: row.user_id,
    tone: row.tone,
    strictnessLevel: row.strictness_level,
    humorLevel: row.humor_level,
    detailLevel: row.detail_level,
    proactiveAlertsEnabled: row.proactive_alerts_enabled,
    weeklyReviewEnabled: row.weekly_review_enabled,
    dailyCheckinEnabled: row.daily_checkin_enabled,
    preferredLanguage: row.preferred_language,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSupabaseBudgetCategory(row: SupabaseBudgetCategoryRow): BudgetCategory {
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    amount: Number(row.amount),
    currency: row.currency,
    period: row.period,
    alertThresholdPercentage: Number(row.alert_threshold_percentage),
    isActive: row.is_active,
    mtdSeed: row.mtd_seed == null ? undefined : Number(row.mtd_seed),
    seedMonth: row.seed_month ?? undefined,
    createdAt: row.created_at,
  };
}

export function mapSupabaseSpendingAlertRule(
  row: SupabaseSpendingAlertRuleRow,
): SpendingAlertRule {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    ruleType: row.rule_type,
    category: row.category ?? undefined,
    accountId: row.account_id ?? undefined,
    debtAccountId: row.debt_account_id ?? undefined,
    thresholdAmount: row.threshold_amount === null ? undefined : Number(row.threshold_amount),
    thresholdPercentage:
      row.threshold_percentage === null ? undefined : Number(row.threshold_percentage),
    period: row.period ?? undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export function mapSupabaseUserContextNote(row: SupabaseUserContextNoteRow): UserContextNote {
  return {
    id: row.id,
    userId: row.user_id,
    noteType: row.note_type,
    content: row.content,
    source: row.source,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export function mapSupabaseFinancialContextSnapshot(
  row: SupabaseFinancialContextSnapshotRow,
): FinancialContextSnapshot {
  return {
    id: row.id,
    userId: row.user_id,
    snapshotDate: row.snapshot_date,
    baseCurrency: row.base_currency,
    totalAvailable: Number(row.total_available),
    totalDebt: Number(row.total_debt),
    totalGoalSavings: Number(row.total_goal_savings),
    weeklyAvailable: Number(row.weekly_available),
    dailySuggested: Number(row.daily_suggested),
    fixedExpensesPending: Number(row.fixed_expenses_pending),
    debtPaymentsPending: Number(row.debt_payments_pending),
    goalContributionsRequired: Number(row.goal_contributions_required),
    rawSnapshot: row.raw_snapshot,
    createdAt: row.created_at,
  };
}
