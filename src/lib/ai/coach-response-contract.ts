import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import type { GoalPlanSummary } from "@/lib/ai/goal-aware-response-copy";
import type { TransactionIntent } from "@/types/transaction-intents";

export type CoachResponseSource = "fallback" | "ai";

export type CoachResponseTone = "clear" | "coach_like" | "playful";

// A validated financial event always maps to exactly one of these
// codes. The fixed-expense codes are response-only distinctions (the
// underlying movement is still an expense); they let the humanizer and
// validator know how to frame the message without inventing facts.
export type CoachResultCode =
  | "expense_created"
  | "income_created"
  | "goal_contribution_created"
  | "debt_payment_created"
  | "expense_fixed_linked"
  | "expense_fixed_separate";

export interface CoachFinancialSnapshot {
  flexibleSpending: number;
  dailySuggestedLimit: number;
  baseCurrency: string;
  protectedGoalMoney?: number;
  goalProgressPercentage?: number;
  goalPlanSummary?: GoalPlanSummary;
}

// Recent chat turns are passed to the AI humanizer for conversational
// continuity ONLY. They are never a source of financial truth — the
// validated event fields below are the only authoritative facts.
export interface CoachRecentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface CoachTransactionContext {
  userId: string;
  originalMessage: string;
  intent: TransactionIntent;
  resultCode: CoachResultCode;
  accountName?: string;
  debtAccountName?: string;
  goalName?: string;
  fixedExpenseName?: string;
  // Deterministic truth flags about what the validated event did to the
  // user's money. The humanizer must respect these; the validator
  // rejects any AI message that contradicts them.
  usedCard?: boolean;
  cashDecreased?: boolean;
  debtIncreased?: boolean;
  debtDecreased?: boolean;
  financialSnapshot?: CoachFinancialSnapshot;
  // Channel context lets the router pull recent chat turns (best-effort,
  // AI mode only) for tone/continuity.
  channel?: ChatChannel;
  chatId?: string | null;
  recentMessages?: CoachRecentMessage[];
  // When provided, this exact string is the deterministic fallback the
  // router returns whenever the AI is disabled, fails, or is rejected.
  // Used by paths that already own their safe copy (e.g. fixed-expense
  // resolution) so humanization never changes the safe wording.
  deterministicFallbackMessage?: string;
}

export interface CoachResponseInput {
  context: CoachTransactionContext;
  tone: CoachResponseTone;
}

export interface CoachResponseResult {
  source: CoachResponseSource;
  message: string;
  confidenceScore: number;
  rawModelOutput?: unknown;
}
