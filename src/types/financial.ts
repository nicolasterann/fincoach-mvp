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
  /** Structured currency→account preference (068): the EXECUTOR-verifiable
   *  "learned" evidence for capture — declared via update_account, unique per
   *  (user, currency) in DB. Never inferred from free-text memory. */
  isCurrencyDefault?: boolean;
  // Stage 30 (migration 035) — free-text note the coach reads as memory
  // ("cuenta de emergencias, no tocar"). Absent until 035 applied.
  notes?: string | null;
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
  /** Total originally declared for the current card statement. Unlike
   * fullPaymentDue (the remaining amount), this does not shrink on partial pay. */
  statementTotalDue?: number;
  /** Authoritative coverage flag for the current card statement. `false` is
   * materially different from an absent legacy flag: a partial payment does
   * not cover the statement even though lastPaymentDate was stamped. */
  statementCovered?: boolean;
  /** Native (row-currency) figures preserved when the context builder re-expressed
   *  minimumPayment/fullPaymentDue into the profile base currency via a known rate. */
  minimumPaymentOriginal?: number;
  fullPaymentDueOriginal?: number;
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
  // Stage 30 (migration 035) — card billing-cycle paid signal: when the last
  // statement payment was made, so the Margen can tell "paid this cycle" from
  // "still owed" without a manual "0". ISO date. Absent until 035 applied.
  lastPaymentDate?: string | null;
  // Stage 30 (migration 035) — free-text note the coach reads as memory
  // ("la Visa sube el cupo en agosto"). Absent until 035 applied.
  notes?: string | null;
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
  /** Native figures preserved when the context builder re-expressed target/current
   *  into the profile base currency via a known rate (engines reason in base). */
  originalTargetAmount?: number;
  originalCurrentAmount?: number;
  originalCurrency?: CurrencyCode;
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
  // Stage 30 (migration 035) — free-text note the coach reads as memory
  // ("la boda es en Cartagena, presupuesto flexible"). Absent until 035 applied.
  notes?: string | null;
}

// Stage 30 — ASSET (from the existing public.investment_accounts table, Stage 17).
// Surfaced on the financial context so the agent SEES the user's assets every turn
// and net worth reads a consistent shape. IMPORTANT MONEY RULE: an asset is NEVER
// spendable/liquid-this-week money — it only counts toward NET WORTH. `assetClass`
// is the free-form investment_accounts.asset_class string (cash|investment|
// fixed_term|crypto|property|vehicle|business|receivable|other); `net-worth.ts`
// narrows it to its own AssetClass union when totaling.
export interface Asset {
  id: string;
  name: string;
  assetClass: string;
  valueBase: number;
  /** The value as the user stated it, in `currency`, when it differed from base. Lets
   *  the context builder re-value valueBase at the LIVE rate instead of the frozen base. */
  valueOriginal?: number | null;
  currency?: string | null;
  liquid: boolean;
  includeInNetWorth: boolean;
  expectedReturnPct?: number | null;
  returnKind?: string | null;
  linkedGoalId?: string | null;
  notes?: string | null;
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
  /** OCCASIONAL / windfall income (freelance every few months, a bonus, an
   *  unpredictable gig). EXCLUDED from the recurring monthly capacity/Margen so it never
   *  inflates the steady-state plan; Kipu factors it only when it actually arrives. */
  isOccasional?: boolean;
  minExpectedAmount?: number;
  maxExpectedAmount?: number;
  destinationAccountId?: string;
  status: IncomeSourceStatus;
  notes?: string;
  /** Optional known real payday (ISO date). Anchors a weekly/biweekly cadence so the
   *  date engines project the true 14/7-day phase instead of guessing a weekday. */
  payAnchorDate?: string;
  /** Set when the context builder re-expressed `amount` into the profile base
   *  currency using a KNOWN fx rate (engines always reason in base). The row's
   *  native figure is preserved here; absent = no conversion was applied. */
  originalAmount?: number;
  originalCurrency?: CurrencyCode;
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
  // Stage 30 (migration 035) — a fixed expense whose amount varies month to month
  // (gas, luz) vs a truly-fixed one (arriendo). The engine treats variable ones
  // with LOWER confidence and confirms them. Defaults false (existing rows =
  // truly fixed). Migration: fixed_expenses.is_variable (not null default false).
  isVariable: boolean;
  /** Native amount explicitly configured by the user. It remains the fallback
   *  and is never overwritten by a one-month bill. */
  declaredAmount?: number;
  /** Native amount Kipu prudently reserves for planning. For a non-variable
   *  expense it equals `declaredAmount`; for a variable one it comes from the
   *  durable forecast for the current learning regime. */
  planningAmount?: number;
  planningConfidence?: "baseline" | "low" | "medium" | "high";
  planningSampleCount?: number;
  planningRegime?: number;
  /** Whether the planning projection was read completely and matches the
   *  current plan regime/cadence/currency. `false` keeps the declared native
   *  amount available for plan correction, but forbids consumers from
   *  presenting it as a learned/baseline projection. */
  planningProjectionAvailable?: boolean;
  /** Whether the planning amount was actually valued into the profile base
   * currency. `false` keeps the native fact available for capture/correction,
   * but forbids consumers from treating `amount` as a publishable base number. */
  planningValuationAvailable?: boolean;
  // Stage 32 (migration 038) — real payment date anchoring a weekly/biweekly
  // cadence (mirrors IncomeSource.payAnchorDate) so the calendar phases the
  // 7/14-day cycle to the user's actual pay date instead of guessing "today".
  payAnchorDate?: string | null;
  // Stage 32 legacy marker. Bloque K no writes or trusts it as evidence: it
  // proves neither the observed amount nor payment/date/channel. Kept only to
  // read historical rows while canonical observations own the lifecycle.
  lastConfirmedMonth?: string | null;
  notes?: string;
  // When the recurring expense BEGINS (Phase 11). Absent = already active.
  startDate?: string;
  /** Set when the context builder re-expressed `amount` into the profile base
   *  currency using a KNOWN fx rate (engines always reason in base). When a
   *  required rate is missing, the native amount remains here while `amount`
   *  is neutralized and `planningValuationAvailable` is false. */
  originalAmount?: number;
  originalCurrency?: CurrencyCode;
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
  // Stage 32 (migration 038) — month-to-date SEED captured at onboarding: what
  // the user had ALREADY spent of this category when the budget was created,
  // so the engine reserves only what REMAINS of the month. `seedMonth` anchors
  // it to its calendar month (a stale seed is ignored, never carried over).
  mtdSeed?: number | null;
  seedMonth?: string | null;
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
