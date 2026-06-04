/**
 * Kipu onboarding — draft data shapes.
 *
 * A "draft" is the in-progress, partially-confirmed version of a
 * canonical financial entity (from `@/types/financial`). Drafts are
 * permissive on purpose: most fields are optional because the AI may
 * extract them across multiple conversational turns, and the user is
 * allowed to give approximate answers.
 *
 * Drafts are NEVER persisted directly to the canonical tables. A later
 * step ("review" → "completed") will translate them into the canonical
 * `Account`, `DebtAccount`, `IncomeSource`, `FixedExpense`, `Goal`,
 * `CoachPreferences`, and `UserContextNote` rows.
 */

import type {
  AccountLiquidity,
  AccountType,
  CoachDetailLevel,
  CoachHumorLevel,
  CoachStrictnessLevel,
  CoachTone,
  CurrencyCode,
  DebtAccountType,
  FinancialCategory,
  FinancialConfidenceLevel,
  PaymentFrequency,
  PaymentSourceType,
  UserContextNoteType,
} from "@/types/financial";

/**
 * Common fields every draft item gets, so the AI can track its own
 * progress on filling in details without re-asking what it already has.
 */
export interface OnboardingDraftItemMeta {
  /** Temporary id used while the draft lives in conversation state. */
  draftId: string;
  /** How confident the extraction is. Defaults to "low" until confirmed. */
  confidence?: FinancialConfidenceLevel;
  /** Field names still missing or ambiguous on this item. */
  missingFields?: string[];
  /** Free-form notes the AI wants to remember about this item. */
  notes?: string;
  /** True once the user has explicitly confirmed this item. */
  isConfirmed?: boolean;
}

// ── Profile ─────────────────────────────────────────────────────────────────

export interface OnboardingDraftProfile {
  fullName?: string;
  /** Country name in natural language, e.g. "Ecuador". */
  country?: string;
  baseCurrency?: CurrencyCode;
  tonePreference?: CoachTone;
  /** How strict the user wants Kipu to be on plan deviations. */
  strictnessLevel?: CoachStrictnessLevel;
  preferredLanguage?: string;
  /** Anything the user wanted Kipu to remember about themselves. */
  freeFormNote?: string;
  /**
   * Margen Kipu inputs (Stage 6). Money the user commits to saving / investing
   * each month, and a rough estimate of essential variable spending (food,
   * transport, basics). These are RESERVED before Kipu computes the user's safe
   * spending margin, so the user can spend freely knowing savings are protected.
   * Essentials are a starting hypothesis Kipu refines from real behavior.
   */
  monthlySavings?: number;
  monthlyInvestment?: number;
  essentialMonthlyEstimate?: number;
}

// ── Accounts ────────────────────────────────────────────────────────────────

export interface OnboardingDraftAccount extends OnboardingDraftItemMeta {
  name?: string;
  type?: AccountType;
  currency?: CurrencyCode;
  /** Approximate current balance. The user is told approximations are fine. */
  currentBalance?: number;
  /** True if this account is reserved for storing goal money. */
  isGoalAccount?: boolean;
  /**
   * Whether this account is spendable now ("liquid") or money the user does NOT
   * touch for daily spending — investments, long-term/protected savings
   * ("non_liquid"). Non-liquid accounts are excluded from Margen Kipu. Captured
   * so an investment/savings account isn't mistaken for available cash.
   */
  liquidity?: AccountLiquidity;
  /**
   * True if this is the user's primary day-to-day account. Helpful for
   * defaulting payment sources later.
   */
  isPrimary?: boolean;
}

// ── Debt accounts ───────────────────────────────────────────────────────────

/**
 * What the user *meant* when they gave us a single number for a card.
 *
 * Kipu must clarify this because the same number can mean three very
 * different things: minimum, this-month total, or accumulated balance.
 */
export type DebtAmountInterpretation =
  | "minimum_payment"
  | "current_month_payment"
  | "total_balance"
  | "unknown";

export interface OnboardingDraftDebtAccount extends OnboardingDraftItemMeta {
  name?: string;
  type?: DebtAccountType;
  currency?: CurrencyCode;
  /** Total outstanding balance (across all months). */
  totalBalance?: number;
  /** Minimum monthly payment, if applicable. */
  minimumPayment?: number;
  /** Payment owed for the current statement period. */
  currentMonthPayment?: number;
  /** Balance carried from previous months that may accrue interest. */
  accumulatedBalance?: number;
  /** True if the user told us this debt is accruing interest. */
  hasInterest?: boolean;
  /** Annual rate, expressed as a percentage (e.g. 38.5). */
  interestRate?: number;
  /** Day of month the payment is due (1–31). */
  dueDay?: number;
  /** Day of month the statement closes (1–31). */
  cutoffDay?: number;
  /** Draft id of the account the user typically pays from. */
  defaultPaymentAccountDraftId?: string;
  /** True if the card is also used for daily purchases. */
  isUsedForDailyPurchases?: boolean;
  /**
   * The clarified meaning of any single amount the user mentioned. Until
   * this is resolved away from "unknown", Kipu should keep probing.
   */
  amountInterpretation?: DebtAmountInterpretation;
}

// ── Income sources ──────────────────────────────────────────────────────────

export type OnboardingIncomeKind =
  | "fixed_salary"
  | "freelance"
  | "commissions"
  | "business"
  | "family_support"
  | "passive"
  | "other";

export type OnboardingIncomeStability = "stable" | "variable" | "unstable" | "unknown";

export interface OnboardingDraftIncomeSource extends OnboardingDraftItemMeta {
  name?: string;
  kind?: OnboardingIncomeKind;
  amount?: number;
  currency?: CurrencyCode;
  frequency?: PaymentFrequency;
  /** True if the income is variable (freelance, commissions, etc.). */
  isVariable?: boolean;
  /** Lower bound for variable income. */
  minExpectedAmount?: number;
  /** Upper bound for variable income. */
  maxExpectedAmount?: number;
  /** Day of the month the income usually arrives. */
  expectedDay?: number;
  /** Day of the week (0 = Sunday) when applicable. */
  expectedWeekday?: number;
  /** Draft id of the account this income lands in. */
  destinationAccountDraftId?: string;
  /** The user's own sense of how stable this stream is. */
  stability?: OnboardingIncomeStability;
}

// ── Fixed expenses ──────────────────────────────────────────────────────────

export type OnboardingExpensePredictability =
  | "monthly"
  | "annual"
  | "irregular_but_predictable"
  | "unknown";

export interface OnboardingDraftFixedExpense extends OnboardingDraftItemMeta {
  name?: string;
  amount?: number;
  currency?: CurrencyCode;
  category?: FinancialCategory;
  frequency?: PaymentFrequency;
  /** Day of month, when applicable. */
  expectedDay?: number;
  /** Day of week (0 = Sunday), when applicable. */
  expectedWeekday?: number;
  /** Whether this comes out of an account or a debt account (e.g. card). */
  paymentSourceType?: PaymentSourceType;
  /** Draft id of the source account or debt account. */
  paymentSourceDraftId?: string;
  /** True if the user marked this as essential (rent, utilities). */
  isEssential?: boolean;
  /**
   * Helps Kipu distinguish monthly recurring costs from annual surprises
   * like insurance or tuition.
   */
  predictability?: OnboardingExpensePredictability;
}

// ── Goals ───────────────────────────────────────────────────────────────────

/**
 * For users who arrive without a concrete goal, Kipu offers archetypes
 * so the conversation can keep moving without forcing a specific answer.
 */
export type OnboardingGoalArchetype =
  | "organize_month"
  | "pay_down_debt"
  | "emergency_savings"
  | "specific_purchase"
  | "other";

export type OnboardingGoalPriority = "low" | "medium" | "high";

export interface OnboardingDraftGoal extends OnboardingDraftItemMeta {
  name?: string;
  archetype?: OnboardingGoalArchetype;
  targetAmount?: number;
  currentAmount?: number;
  currency?: CurrencyCode;
  /** ISO date string, e.g. "2026-12-31". */
  targetDate?: string;
  priority?: OnboardingGoalPriority;
  /** Draft id of the account where money for this goal lives. */
  goalAccountDraftId?: string;
}

// ── Coach preferences ───────────────────────────────────────────────────────

export interface OnboardingDraftCoachPreferences {
  tone?: CoachTone;
  strictnessLevel?: CoachStrictnessLevel;
  humorLevel?: CoachHumorLevel;
  detailLevel?: CoachDetailLevel;
  proactiveAlertsEnabled?: boolean;
  weeklyReviewEnabled?: boolean;
  dailyCheckinEnabled?: boolean;
  preferredLanguage?: string;
  notes?: string;
  missingFields?: string[];
}

// ── Free-form context notes ─────────────────────────────────────────────────

/**
 * Kipu collects "things worth remembering" during the conversation:
 * lifestyle constraints, sensitivities, family context, etc. These do
 * not belong to a structured entity and are persisted as user context
 * notes later.
 */
export interface OnboardingDraftContextNote {
  draftId: string;
  content: string;
  noteType?: UserContextNoteType;
  /** Optional, but typically "onboarding" once persisted. */
  source?: "onboarding" | "manual" | "ai" | "system";
  /** ISO timestamp at which the note was captured. */
  createdAt: string;
}

// ── Aggregate draft ─────────────────────────────────────────────────────────

export interface OnboardingDraft {
  profile: OnboardingDraftProfile;
  accounts: OnboardingDraftAccount[];
  debtAccounts: OnboardingDraftDebtAccount[];
  incomeSources: OnboardingDraftIncomeSource[];
  fixedExpenses: OnboardingDraftFixedExpense[];
  goals: OnboardingDraftGoal[];
  coachPreferences: OnboardingDraftCoachPreferences;
  userContextNotes: OnboardingDraftContextNote[];
  /**
   * Steps the user explicitly told us are empty (e.g. "no debts at
   * all"). Without this, an empty collection is ambiguous: did we
   * forget to ask, or did the user confirm there is nothing?
   */
  explicitlyEmptySteps?: string[];
}
