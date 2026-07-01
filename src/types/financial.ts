export type CurrencyCode = "USD" | "ARS" | "EUR" | "COP" | "PEN" | "CLP" | "MXN" | string;

export type AccountType = "bank" | "cash" | "wallet" | "goal_account";

export type DebtAccountType = "credit_card" | "loan" | "family_debt" | "other_debt";

export type TransactionType =
  | "expense"
  | "income"
  | "transfer"
  | "debt_payment"
  | "goal_contribution"
  | "refund"
  | "reversal"
  | "adjustment";

export type ReimbursementStatus = "none" | "expected" | "received" | "partial";

export type GoalStatus = "active" | "paused" | "completed" | "cancelled";

export type GoalFeasibilityStatus =
  | "viable"
  | "challenging"
  | "at_risk"
  | "not_currently_viable"
  | "paused_due_to_financial_health";

// Stage 17 — goal portfolio model (all additive; legacy goals default to a
// single PRIMARY goal so existing single-goal behavior is unchanged).
export type GoalType = "primary" | "mini" | "milestone";
export type GoalArchetype =
  | "savings"
  | "travel"
  | "purchase"
  | "emergency"
  | "debt_payoff"
  | "investment"
  | "wealth"
  | "family"
  | "lifestyle"
  | "custom";
export type GoalCadence = "weekly" | "biweekly" | "monthly" | "one_time" | "flexible";
// How a contribution moves money: a notional increment (only current_amount
// moves) vs an actual transfer into a linked goal account.
export type ContributionModel = "notional_increment" | "move_to_account";
// Adaptive ambition (set at onboarding, distinct from the temporal engagement
// mode): how aggressively Kipu pushes goals vs preserving everyday joy.
export type AmbitionMode = "light_touch" | "steady" | "power_builder";
export type RiskTolerance = "conservative" | "moderate" | "aggressive";

// Stage 18 — the user's LIFE PHILOSOPHY toward money (the core personalization
// lever). NOT a judgment: an experiences-oriented user wants to enjoy their money
// and Kipu must respect that (never nag them to save); a wealth-builder wants Kipu
// to push harder. It shapes FRAMING and allocation posture (joy floor) only —
// never the underlying money math or safety guardrails.
export type FinancialPhilosophy = "experiences" | "balanced" | "builder" | "wealth" | "unknown";

export type FinancialConfidenceLevel = "low" | "medium" | "high";

export type RecurringExpenseStatus = "active" | "paused" | "cancelled";

export type PaymentFrequency = "weekly" | "biweekly" | "monthly" | "yearly" | "custom";

export type IncomeSourceStatus = "active" | "paused" | "cancelled";

export type PaymentSourceType = "account" | "debt_account";

export type CoachTone = "clear" | "coach_like" | "playful";

export type CoachStrictnessLevel = "relaxed" | "balanced" | "strict";

export type CoachHumorLevel = "none" | "low" | "medium" | "high";

export type CoachDetailLevel = "short" | "medium" | "detailed";

export type BudgetPeriod = "weekly" | "monthly" | "yearly" | "custom";

export type SpendingAlertRuleType =
  | "category_amount"
  | "account_balance_below"
  | "debt_usage_above"
  | "daily_spend_above"
  | "weekly_spend_above";

export type SpendingAlertPeriod = "daily" | "weekly" | "monthly" | "custom";

export type UserContextNoteType =
  | "general"
  | "preference"
  | "constraint"
  | "goal_context"
  | "risk_context"
  | "behavior_pattern";

export type UserContextNoteSource = "manual" | "onboarding" | "ai" | "system";

export type FinancialCategory =
  | "housing"
  | "utilities"
  | "food"
  | "transport"
  | "health"
  | "education"
  | "subscriptions"
  | "debt"
  | "shopping"
  | "entertainment"
  | "family"
  | "savings"
  | "income"
  | "travel"
  | "other";

export interface MoneyAmount {
  originalAmount: number;
  originalCurrency: CurrencyCode;
  exchangeRateToBase: number;
  baseAmount: number;
  baseCurrency: CurrencyCode;
}

// 'liquid' = spendable now (bank/cash/wallet); 'non_liquid' = investments,
// long-term/protected savings, etc. Only liquid, non-goal money counts as
// "available this week". Absent = treated as liquid (back-compat default).
export type AccountLiquidity = "liquid" | "non_liquid";

export interface Account {
  id: string;
  userId: string;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  currentBalanceOriginal: number;
  currentBalanceBase: number;
  isGoalAccount: boolean;
  liquidity?: AccountLiquidity;
  createdAt: string;
}

export interface DebtAccount {
  id: string;
  userId: string;
  name: string;
  type: DebtAccountType;
  currency: CurrencyCode;
  currentBalanceOriginal: number;
  currentBalanceBase: number;
  minimumPayment?: number;
  fullPaymentDue?: number;
  dueDay?: number;
  cutoffDay?: number;
  interestRate?: number;
  // Stage 14 — how to read `interestRate` ("annual_nominal" default | "annual_effective" | "monthly").
  interestRateKind?: "annual_nominal" | "annual_effective" | "monthly";
  defaultPaymentAccountId?: string;
  // Stage 14 — emission date / period-end of the statement that produced the
  // CURRENT obligations, so an older statement can't silently overwrite them.
  statementDate?: string;
  statementPeriodEnd?: string;
  lastStatementEvidenceId?: string;
  createdAt: string;
}

export interface FinancialGoal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  currency: CurrencyCode;
  currentAmount: number;
  targetDate: string;
  goalAccountId?: string;
  status: GoalStatus;
  feasibilityStatus: GoalFeasibilityStatus;
  weeklyRequiredAmount: number;
  monthlyRequiredAmount: number;
  createdAt: string;
  // Stage 17 — portfolio fields (all optional; absent ⇒ legacy primary goal).
  goalType?: GoalType;
  archetype?: GoalArchetype;
  parentGoalId?: string | null;
  isPrimary?: boolean;
  priority?: number; // 1 = highest; lower number = higher priority
  cadence?: GoalCadence;
  // The COMMITTED per-cadence contribution the user accepted. When present and
  // the goal is active + cashflow-protected, this RESERVES money (feeds Margen/
  // cashflow). Absent ⇒ no reservation; the allocation engine only SUGGESTS.
  contributionAmount?: number | null;
  cashflowProtected?: boolean; // default true for committed goals
  flexibleDeadline?: boolean;
  canPause?: boolean;
  contributionModel?: ContributionModel;
  investmentEligible?: boolean;
}

export interface RecurringExpense {
  id: string;
  userId: string;
  name: string;
  amount: number;
  currency: CurrencyCode;
  category: FinancialCategory;
  frequency: PaymentFrequency;
  expectedDay?: number;
  paymentSourceId?: string;
  confidenceLevel: FinancialConfidenceLevel;
  status: RecurringExpenseStatus;
  createdAt: string;
}

export interface IncomeSource {
  id: string;
  userId: string;
  name: string;
  amount: number;
  currency: CurrencyCode;
  frequency: PaymentFrequency;
  expectedDay?: number;
  expectedWeekday?: number;
  isVariable: boolean;
  minExpectedAmount?: number;
  maxExpectedAmount?: number;
  destinationAccountId?: string;
  status: IncomeSourceStatus;
  notes?: string;
  /** Optional known real payday (ISO date). Anchors a weekly/biweekly cadence so the
   *  date engines project the true 14/7-day phase instead of guessing a weekday. */
  payAnchorDate?: string;
  createdAt: string;
}

export interface FixedExpense {
  id: string;
  userId: string;
  name: string;
  amount: number;
  currency: CurrencyCode;
  category: FinancialCategory;
  frequency: PaymentFrequency;
  expectedDay?: number;
  expectedWeekday?: number;
  paymentSourceType?: PaymentSourceType;
  paymentSourceId?: string;
  isEssential: boolean;
  isActive: boolean;
  notes?: string;
  // When the recurring expense BEGINS (Phase 11). Absent = already active.
  startDate?: string;
  createdAt: string;
}

export interface CoachPreferences {
  userId: string;
  tone: CoachTone;
  strictnessLevel: CoachStrictnessLevel;
  humorLevel: CoachHumorLevel;
  detailLevel: CoachDetailLevel;
  proactiveAlertsEnabled: boolean;
  weeklyReviewEnabled: boolean;
  dailyCheckinEnabled: boolean;
  preferredLanguage: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCategory {
  id: string;
  userId: string;
  category: FinancialCategory;
  amount: number;
  currency: CurrencyCode;
  period: BudgetPeriod;
  alertThresholdPercentage: number;
  isActive: boolean;
  createdAt: string;
}

export interface SpendingAlertRule {
  id: string;
  userId: string;
  name: string;
  ruleType: SpendingAlertRuleType;
  category?: FinancialCategory;
  accountId?: string;
  debtAccountId?: string;
  thresholdAmount?: number;
  thresholdPercentage?: number;
  period?: SpendingAlertPeriod;
  isActive: boolean;
  createdAt: string;
}

export interface UserContextNote {
  id: string;
  userId: string;
  noteType: UserContextNoteType;
  content: string;
  source: UserContextNoteSource;
  isActive: boolean;
  createdAt: string;
}

export interface FinancialContextSnapshot {
  id: string;
  userId: string;
  snapshotDate: string;
  baseCurrency: CurrencyCode;
  totalAvailable: number;
  totalDebt: number;
  totalGoalSavings: number;
  weeklyAvailable: number;
  dailySuggested: number;
  fixedExpensesPending: number;
  debtPaymentsPending: number;
  goalContributionsRequired: number;
  rawSnapshot: Record<string, unknown>;
  createdAt: string;
}

export interface VariableBudgetEstimate {
  id: string;
  userId: string;
  category: FinancialCategory;
  initialEstimate: number;
  currentEstimate: number;
  currency: CurrencyCode;
  confidenceLevel: FinancialConfidenceLevel;
  lastCalculatedAt?: string;
}

export interface FinancialTransaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: MoneyAmount;
  description: string;
  category: FinancialCategory;
  sourceAccountId?: string;
  destinationAccountId?: string;
  debtAccountId?: string;
  relatedTransactionId?: string;
  recurringExpenseId?: string;
  isSplit: boolean;
  grossAmount?: number;
  reimbursedAmount?: number;
  netAmount?: number;
  reimbursementStatus: ReimbursementStatus;
  confidenceScore: number;
  occurredAt: string;
  createdAt: string;
}

export interface UserFinancialPreferences {
  userId: string;
  defaultSourceType?: "account" | "debt_account";
  defaultSourceId?: string;
  createdAt: string;
  updatedAt: string;
}
