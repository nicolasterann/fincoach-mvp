/**
 * Kipu onboarding — pure helpers.
 *
 * Everything in this file is pure and synchronous. No I/O, no time
 * mocking, no React. The conversation state machine is owned by the
 * caller (server action / AI engine); these helpers just answer
 * questions about a given state.
 */

import type {
  OnboardingDraft,
  OnboardingDraftAccount,
  OnboardingDraftCoachPreferences,
  OnboardingDraftDebtAccount,
  OnboardingDraftFixedExpense,
  OnboardingDraftGoal,
  OnboardingDraftIncomeSource,
  OnboardingDraftProfile,
} from "./draft-types";
import { ONBOARDING_STEP_METADATA } from "./step-metadata";
import type { OnboardingStep } from "./steps";
import { ONBOARDING_STEP_ORDER } from "./steps";
import type {
  OnboardingConversationState,
  OnboardingMissingFieldsMap,
} from "./conversation-state";

/**
 * Empty draft used as the seed for a new onboarding conversation.
 *
 * Note: the inner objects (profile, coachPreferences) are intentionally
 * fresh per call so callers can mutate freely without affecting other
 * conversations.
 */
export function createInitialOnboardingDraft(): OnboardingDraft {
  const profile: OnboardingDraftProfile = {};
  const coachPreferences: OnboardingDraftCoachPreferences = {};

  return {
    profile,
    accounts: [],
    debtAccounts: [],
    incomeSources: [],
    fixedExpenses: [],
    goals: [],
    coachPreferences,
    userContextNotes: [],
    explicitlyEmptySteps: [],
  };
}

/**
 * Build the initial missing-fields map from step metadata.
 * Every step starts with its declared required fields pending.
 */
function buildInitialMissingFieldsMap(): OnboardingMissingFieldsMap {
  const map: OnboardingMissingFieldsMap = {};
  for (const step of ONBOARDING_STEP_ORDER) {
    const fields = ONBOARDING_STEP_METADATA[step].requiredFields;
    if (fields.length > 0) {
      map[step] = [...fields];
    }
  }
  return map;
}

export function createInitialOnboardingConversationState(
  now: string = new Date().toISOString(),
): OnboardingConversationState {
  return {
    currentStep: "welcome",
    draft: createInitialOnboardingDraft(),
    messages: [],
    missingFields: buildInitialMissingFieldsMap(),
    completedSteps: [],
    readyForReview: false,
    updatedAt: now,
  };
}

export function getRequiredFieldsForStep(step: OnboardingStep): readonly string[] {
  return ONBOARDING_STEP_METADATA[step].requiredFields;
}

// ── Step completeness ───────────────────────────────────────────────────────

function isProfileComplete(profile: OnboardingDraftProfile): boolean {
  return Boolean(profile.fullName && profile.baseCurrency);
}

function isAccountUsable(account: OnboardingDraftAccount): boolean {
  return Boolean(account.name && account.type);
}

function isDebtAccountUsable(debt: OnboardingDraftDebtAccount): boolean {
  return Boolean(debt.name && debt.type);
}

function isIncomeSourceUsable(income: OnboardingDraftIncomeSource): boolean {
  return Boolean(income.name && income.kind);
}

function isFixedExpenseUsable(expense: OnboardingDraftFixedExpense): boolean {
  return Boolean(expense.name);
}

function isGoalUsable(goal: OnboardingDraftGoal): boolean {
  return Boolean(goal.name || goal.archetype);
}

function isStepExplicitlyEmpty(step: OnboardingStep, draft: OnboardingDraft): boolean {
  return draft.explicitlyEmptySteps?.includes(step) ?? false;
}

/**
 * Whether the given step has gathered enough to move on.
 *
 * For collection steps, the rule is:
 *   "at least one usable item OR the user explicitly said there's none".
 *
 * `welcome` and `completed` have no required fields and are considered
 * complete by definition once the state moves past them — but this
 * helper only inspects the draft, so it returns `true` for both.
 */
export function isStepComplete(step: OnboardingStep, draft: OnboardingDraft): boolean {
  switch (step) {
    case "welcome":
      return true;

    case "profile":
      return isProfileComplete(draft.profile);

    case "accounts":
      return (
        draft.accounts.some(isAccountUsable) || isStepExplicitlyEmpty("accounts", draft)
      );

    case "debt_accounts":
      return (
        draft.debtAccounts.some(isDebtAccountUsable) ||
        isStepExplicitlyEmpty("debt_accounts", draft)
      );

    case "income_sources":
      return (
        draft.incomeSources.some(isIncomeSourceUsable) ||
        isStepExplicitlyEmpty("income_sources", draft)
      );

    case "fixed_expenses":
      return (
        draft.fixedExpenses.some(isFixedExpenseUsable) ||
        isStepExplicitlyEmpty("fixed_expenses", draft)
      );

    case "goals":
      return (
        draft.goals.some(isGoalUsable) || isStepExplicitlyEmpty("goals", draft)
      );

    case "coach_preferences":
      // No hard requirements; defaults are fine.
      return true;

    case "review":
      // Review is "complete" once the caller flips readyForReview, which
      // is tracked on the state, not the draft. We treat it as
      // incomplete here so callers must explicitly mark it done.
      return false;

    case "completed":
      return true;
  }
}

// ── Step navigation ─────────────────────────────────────────────────────────

/**
 * Returns the next step Kipu should focus on.
 *
 * Rules, in order:
 * 1. If the conversation is already at "completed", stay there.
 * 2. If the current step is incomplete (per `isStepComplete`), stay on
 *    it. The AI should keep probing rather than skipping ahead.
 * 3. Otherwise return the next step in `ONBOARDING_STEP_ORDER`.
 * 4. Once everything before `review` is done and the user confirms,
 *    return `completed`.
 */
export function getNextOnboardingStep(
  state: OnboardingConversationState,
): OnboardingStep {
  const { currentStep, draft, readyForReview } = state;

  if (currentStep === "completed") {
    return "completed";
  }

  if (currentStep === "review") {
    return readyForReview ? "completed" : "review";
  }

  if (!isStepComplete(currentStep, draft)) {
    return currentStep;
  }

  const index = ONBOARDING_STEP_ORDER.indexOf(currentStep);
  if (index < 0 || index >= ONBOARDING_STEP_ORDER.length - 1) {
    return "completed";
  }

  return ONBOARDING_STEP_ORDER[index + 1];
}

// ── Progress ────────────────────────────────────────────────────────────────

export interface OnboardingProgress {
  /** 0-based index of the current step in the ordered list. */
  currentStepIndex: number;
  /** Total number of steps including welcome and completed. */
  totalSteps: number;
  /** Number of steps already marked complete by the engine. */
  completedSteps: number;
  /** Integer 0–100. */
  percent: number;
}

export function getOnboardingProgress(
  state: OnboardingConversationState,
): OnboardingProgress {
  const totalSteps = ONBOARDING_STEP_ORDER.length;
  const currentStepIndex = Math.max(
    0,
    ONBOARDING_STEP_ORDER.indexOf(state.currentStep),
  );
  const completedSteps = state.completedSteps.length;
  const percent = Math.min(
    100,
    Math.max(0, Math.round((completedSteps / totalSteps) * 100)),
  );

  return { currentStepIndex, totalSteps, completedSteps, percent };
}
