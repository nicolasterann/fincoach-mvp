/**
 * Kipu onboarding — public barrel.
 *
 * Import from `@/lib/onboarding` rather than from the individual files
 * so we can reorganize internals later without breaking callers.
 */

export type {
  OnboardingStep,
  OnboardingStepSensitivity,
} from "./steps";
export {
  ONBOARDING_STEP_ORDER,
  ONBOARDING_COLLECTION_STEPS,
} from "./steps";

export type {
  DebtAmountInterpretation,
  OnboardingDraft,
  OnboardingDraftAccount,
  OnboardingDraftCoachPreferences,
  OnboardingDraftContextNote,
  OnboardingDraftDebtAccount,
  OnboardingDraftFixedExpense,
  OnboardingDraftGoal,
  OnboardingDraftIncomeSource,
  OnboardingDraftItemMeta,
  OnboardingDraftProfile,
  OnboardingExpensePredictability,
  OnboardingGoalArchetype,
  OnboardingGoalPriority,
  OnboardingIncomeKind,
  OnboardingIncomeStability,
} from "./draft-types";

export type {
  OnboardingConversationState,
  OnboardingMessage,
  OnboardingMissingFieldsMap,
} from "./conversation-state";

export type { OnboardingStepMetadata } from "./step-metadata";
export { ONBOARDING_STEP_METADATA } from "./step-metadata";

export type { OnboardingProgress } from "./helpers";
export {
  createInitialOnboardingConversationState,
  createInitialOnboardingDraft,
  getNextOnboardingStep,
  getOnboardingProgress,
  getRequiredFieldsForStep,
  isStepComplete,
} from "./helpers";
