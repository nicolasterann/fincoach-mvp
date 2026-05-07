import type { TransactionIntent } from "@/types/transaction-intents";

export type CoachResponseSource = "fallback" | "ai";

export type CoachResponseTone = "clear" | "coach_like" | "playful";

export interface CoachFinancialSnapshot {
  flexibleSpending: number;
  dailySuggestedLimit: number;
  baseCurrency: string;
  protectedGoalMoney?: number;
  goalProgressPercentage?: number;
}

export interface CoachTransactionContext {
  userId: string;
  originalMessage: string;
  intent: TransactionIntent;
  resultCode:
    | "expense_created"
    | "income_created"
    | "goal_contribution_created"
    | "debt_payment_created";
  accountName?: string;
  debtAccountName?: string;
  goalName?: string;
  financialSnapshot?: CoachFinancialSnapshot;
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
