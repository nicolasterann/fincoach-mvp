/**
 * Kipu onboarding — conversation state.
 *
 * `OnboardingConversationState` is the single source of truth for an
 * in-flight onboarding. It is intentionally serializable (no class
 * instances, no Dates, no functions) so it can be stored in Supabase,
 * passed to/from the AI, and rehydrated on the client.
 */

import type { OnboardingDraft } from "./draft-types";
import type { OnboardingStep } from "./steps";

/**
 * A single message in the onboarding conversation.
 *
 * `step` is the step the conversation was on when this message was
 * produced. We keep it on the message itself (rather than only on the
 * state) so the UI can later replay or filter by section without
 * re-running the state machine.
 */
export interface OnboardingMessage {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
  /** ISO timestamp. */
  createdAt: string;
  step: OnboardingStep;
}

/**
 * Per-step list of fields Kipu still needs to ask about. The AI updates
 * this each turn so the UI can show progress and the engine can decide
 * whether to advance.
 */
export type OnboardingMissingFieldsMap = Partial<Record<OnboardingStep, string[]>>;

export interface OnboardingConversationState {
  currentStep: OnboardingStep;
  draft: OnboardingDraft;
  messages: OnboardingMessage[];
  /** Fields still pending, grouped by step. */
  missingFields: OnboardingMissingFieldsMap;
  /** Steps the user has fully completed (or explicitly skipped). */
  completedSteps: OnboardingStep[];
  /** True once we've reached the review step and the draft is presentable. */
  readyForReview: boolean;
  /** ISO timestamp of the last update. */
  updatedAt: string;
}
