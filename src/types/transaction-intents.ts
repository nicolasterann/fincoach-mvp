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
  // Stage H — objetivo mensual: 'saldo' = user-confirmed EXTRAORDINARY
  // food/transport movement (drains the Saldo tank fully, consumes no
  // objective); null/'objective'/omitted = default objective semantics.
  budgetTreatment?: "objective" | "saldo" | null;
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
  unresolvedGoalName?: string;
}

export interface RefundIntent extends BaseTransactionIntent {
  type: "refund";
  destinationAccountId?: string;
  debtAccountId?: string;
  relatedTransactionId?: string;
  /** Inherited registration provenance. A refund of a fixed/installment
   * purchase must not restore Saldo that the original never drained. */
  recurringExpenseId?: string;
  originalExternalRef?: string;
  /** Deterministic executor provenance. A refund is writable only when it is
   * linked to the persisted original, or the current user message explicitly
   * proved that the original never existed in Kipu. Legacy/model parsers leave
   * this absent and the canonical applier asks instead of guessing. */
  registrationProvenance?: "derived_original" | "confirmed_unrecorded";
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
