import type { Account, DebtAccount, FinancialGoal } from "@/types/financial";
import type { TransactionIntent } from "@/types/transaction-intents";

export type TransactionParserSource = "basic" | "ai";

export type TransactionParserResultStatus =
  | "ready"
  | "needs_clarification"
  | "unsupported"
  | "failed";

export interface TransactionParserContext {
  userId: string;
  baseCurrency: string;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  mainGoal?: FinancialGoal | null;
}

export interface TransactionParserInput {
  message: string;
  source: TransactionParserSource;
  context: TransactionParserContext;
}

export interface TransactionParserResult {
  status: TransactionParserResultStatus;
  source: TransactionParserSource;
  intent?: TransactionIntent;
  confidenceScore: number;
  clarificationQuestion?: string;
  userFacingMessage: string;
  rawModelOutput?: unknown;
}

export function createClarificationResult({
  source,
  confidenceScore,
  clarificationQuestion,
  userFacingMessage,
}: {
  source: TransactionParserSource;
  confidenceScore: number;
  clarificationQuestion: string;
  userFacingMessage?: string;
}): TransactionParserResult {
  return {
    status: "needs_clarification",
    source,
    confidenceScore,
    clarificationQuestion,
    userFacingMessage:
      userFacingMessage ??
      "Necesito un dato más para registrar esto sin dañar tus saldos.",
  };
}

export function createReadyResult({
  source,
  intent,
  userFacingMessage,
}: {
  source: TransactionParserSource;
  intent: TransactionIntent;
  userFacingMessage?: string;
}): TransactionParserResult {
  return {
    status: "ready",
    source,
    intent,
    confidenceScore: intent.confidenceScore,
    userFacingMessage:
      userFacingMessage ?? "Listo, registré el movimiento en tu sistema financiero.",
  };
}

export function createUnsupportedResult({
  source,
  confidenceScore = 0,
  userFacingMessage,
}: {
  source: TransactionParserSource;
  confidenceScore?: number;
  userFacingMessage: string;
}): TransactionParserResult {
  return {
    status: "unsupported",
    source,
    confidenceScore,
    userFacingMessage,
  };
}
