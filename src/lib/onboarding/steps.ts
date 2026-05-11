/**
 * Kipu onboarding — step taxonomy.
 *
 * The onboarding is modeled as a finite, ordered set of conversational
 * sections. Each step has a clear purpose and a clear "done" condition
 * (see `step-metadata.ts` and `helpers.ts`).
 *
 * Note on brand: this module is consumer-facing copy territory. Use
 * "Kipu" in any user-visible text. "Kipu X" is reserved for legal /
 * corporate contexts and must not appear here.
 */

export type OnboardingStep =
  | "welcome"
  | "profile"
  | "accounts"
  | "debt_accounts"
  | "income_sources"
  | "fixed_expenses"
  | "goals"
  | "coach_preferences"
  | "review"
  | "completed";

/**
 * Canonical traversal order. Anything that needs to "advance to the
 * next step" should consult this array rather than hard-coding order.
 */
export const ONBOARDING_STEP_ORDER: readonly OnboardingStep[] = [
  "welcome",
  "profile",
  "accounts",
  "debt_accounts",
  "income_sources",
  "fixed_expenses",
  "goals",
  "coach_preferences",
  "review",
  "completed",
] as const;

/**
 * Steps that collect a list of items (vs. a single object like profile).
 * Useful for generic "is there at least one item?" logic.
 */
export const ONBOARDING_COLLECTION_STEPS: readonly OnboardingStep[] = [
  "accounts",
  "debt_accounts",
  "income_sources",
  "fixed_expenses",
  "goals",
] as const;

/**
 * Sensitivity tells downstream UI / copy how careful to be.
 *
 * - low_sensitivity   → ask freely (welcome, profile basics).
 * - medium_sensitivity → use a soft, supportive tone (income, expenses, goals).
 * - high_sensitivity   → use a warm, non-judgmental tone, lead with empathy,
 *                        no startled reactions to numbers (debt, money shame).
 */
export type OnboardingStepSensitivity =
  | "low_sensitivity"
  | "medium_sensitivity"
  | "high_sensitivity";
