/**
 * Kipu onboarding — AI engine contract.
 *
 * Defines the boundary between the onboarding state machine (which is
 * pure, deterministic, and lives in `@/lib/onboarding`) and the AI that
 * actually conducts the conversation (a later implementation, likely
 * OpenAI-backed, that mirrors the pattern used by the transaction
 * parser and coach response engines).
 *
 * Design rules this contract enforces:
 * - The AI never writes to Supabase directly. It returns a `patch` that
 *   the engine validates and applies to the draft.
 * - The AI never advances the step on its own decision alone. It can
 *   *propose* an advance via `advanceToStep`; the engine still calls
 *   `getNextOnboardingStep` to confirm.
 * - The AI is responsible for one message per turn, not a script.
 * - All output is JSON-serializable so it can be cached/replayed.
 */

import type {
  OnboardingConversationState,
  OnboardingDraftAccount,
  OnboardingDraftCoachPreferences,
  OnboardingDraftContextNote,
  OnboardingDraftDebtAccount,
  OnboardingDraftFixedExpense,
  OnboardingDraftGoal,
  OnboardingDraftIncomeSource,
  OnboardingDraftProfile,
  OnboardingStep,
} from "@/lib/onboarding";

// ── Input ───────────────────────────────────────────────────────────────────

export interface OnboardingTurnInput {
  state: OnboardingConversationState;
  /** The raw text the user just sent. */
  latestUserMessage: string;
  /**
   * Recent conversation turns (oldest first), so the engine can resolve
   * references to things the user ALREADY said ("ya te dije que los 20 eran
   * de la Visa"). Without this the model is amnesic between turns — the root
   * cause of clarification loops. Keep it short (~last 12 turns).
   */
  recentMessages?: { from: "kipu" | "user"; text: string }[];
  /**
   * Optional locale hint (e.g. "es-AR"). When absent, the AI should
   * default to neutral Latin American Spanish.
   */
  localeHint?: string;
}

// ── Patch ───────────────────────────────────────────────────────────────────

/**
 * Upsert semantics: an item with a `draftId` already in the state is
 * merged (shallow) with its existing record; items with a new
 * `draftId` are appended.
 */
export interface OnboardingDraftCollectionPatch<T> {
  upsert?: T[];
  /** draftIds the user explicitly disowned ("no, no tengo esa"). */
  remove?: string[];
}

export interface OnboardingDraftPatch {
  profile?: Partial<OnboardingDraftProfile>;
  accounts?: OnboardingDraftCollectionPatch<OnboardingDraftAccount>;
  debtAccounts?: OnboardingDraftCollectionPatch<OnboardingDraftDebtAccount>;
  incomeSources?: OnboardingDraftCollectionPatch<OnboardingDraftIncomeSource>;
  fixedExpenses?: OnboardingDraftCollectionPatch<OnboardingDraftFixedExpense>;
  goals?: OnboardingDraftCollectionPatch<OnboardingDraftGoal>;
  coachPreferences?: Partial<OnboardingDraftCoachPreferences>;
  userContextNotes?: OnboardingDraftContextNote[];
  /**
   * Steps the user verbally confirmed as empty (e.g. "no tengo deudas
   * de ningún tipo"). The engine uses this to satisfy the "at least
   * one item OR explicitly empty" rule for collection steps.
   */
  markStepsExplicitlyEmpty?: OnboardingStep[];
}

// ── Output ──────────────────────────────────────────────────────────────────

/**
 * Tags that classify the AI's response to help the engine decide
 * whether to keep probing, advance, or change tone.
 *
 * - `clarifying_question`: AI is asking the user to disambiguate.
 * - `probing_question`: AI is asking a follow-up to surface a high-value field.
 * - `acknowledgement`: AI is reflecting what it just learned.
 * - `summary`: AI is summarizing the current step or the whole draft.
 * - `transition`: AI is closing the current step and opening the next.
 * - `support`: Empathetic reply with no data extraction (e.g. user said
 *   something hard).
 */
export type OnboardingTurnIntentKind =
  | "clarifying_question"
  | "probing_question"
  | "acknowledgement"
  | "summary"
  | "transition"
  | "support";

export interface OnboardingTurnOutput {
  /** The assistant message to display to the user. */
  assistantMessage: string;
  /** Mutations to apply to the draft. May be empty if nothing was extracted. */
  patch: OnboardingDraftPatch;
  /** Categorization of what this turn is doing. */
  intentKind: OnboardingTurnIntentKind;
  /**
   * The step the AI thinks the conversation should land on after this
   * turn. The engine still validates against the state machine; this
   * is a suggestion, not a command.
   */
  advanceToStep?: OnboardingStep;
  /** Field names from `missingFields` that this turn resolved. */
  resolvedMissingFields?: string[];
  /** New fields the AI realized it still needs (added to missingFields). */
  newMissingFields?: string[];
  /** Confidence in 0..1 that the extraction is correct. */
  confidenceScore?: number;
  /** Raw model output for debugging / observability. */
  rawModelOutput?: unknown;
}

// ── Engine boundary ─────────────────────────────────────────────────────────

/**
 * The interface a concrete onboarding engine (OpenAI, mock, etc.)
 * implements. The Telegram and web channels both go through this same
 * contract so behavior stays consistent.
 */
export interface OnboardingConversationEngine {
  processTurn(input: OnboardingTurnInput): Promise<OnboardingTurnOutput>;
}

/**
 * Source label for observability and analytics.
 */
export type OnboardingEngineSource = "openai" | "mock" | "fallback";
