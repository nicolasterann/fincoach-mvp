import type { CurrencyCode, FinancialCategory, TransactionType } from "@/types/financial";

export type TransactionIntentStatus = "pending_confirmation" | "ready" | "needs_clarification";

export interface BaseTransactionIntent {
  type: TransactionType;
  description: string;
  originalAmount: number;
  originalCurrency: CurrencyCode;
  exchangeRateToBase?: number;
  baseCurrency?: CurrencyCode;
  occurredAt?: string;
  confidenceScore: number;
  status: TransactionIntentStatus;
}

export interface ExpenseIntent extends BaseTransactionIntent {
  type: "expense";
  category: FinancialCategory;
  sourceAccountId?: string;
  debtAccountId?: string;
  isSplit?: boolean;
  grossAmount?: number;
  reimbursedAmount?: number;
  netAmount?: number;
}

export interface IncomeIntent extends BaseTransactionIntent {
  type: "income";
  destinationAccountId: string;
  category?: FinancialCategory;
}

export interface TransferIntent extends BaseTransactionIntent {
  type: "transfer";
  sourceAccountId: string;
  destinationAccountId: string;
  category?: FinancialCategory;
}

export interface DebtPaymentIntent extends BaseTransactionIntent {
  type: "debt_payment";
  sourceAccountId: string;
  debtAccountId: string;
  category?: FinancialCategory;
}

export interface GoalContributionIntent extends BaseTransactionIntent {
  type: "goal_contribution";
  sourceAccountId: string;
  destinationAccountId: string;
  goalId: string;
  category?: FinancialCategory;
}

export interface RefundIntent extends BaseTransactionIntent {
  type: "refund";
  destinationAccountId?: string;
  debtAccountId?: string;
  relatedTransactionId?: string;
  category?: FinancialCategory;
}

export interface ReversalIntent extends BaseTransactionIntent {
  type: "reversal";
  relatedTransactionId?: string;
  category?: FinancialCategory;
}

export interface AdjustmentIntent extends BaseTransactionIntent {
  type: "adjustment";
  accountId?: string;
  debtAccountId?: string;
  category?: FinancialCategory;
}

export type TransactionIntent =
  | ExpenseIntent
  | IncomeIntent
  | TransferIntent
  | DebtPaymentIntent
  | GoalContributionIntent
  | RefundIntent
  | ReversalIntent
  | AdjustmentIntent;
