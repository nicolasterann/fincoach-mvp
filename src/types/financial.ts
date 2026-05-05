export type CurrencyCode = "USD" | "ARS" | "EUR" | "COP" | "PEN" | "CLP" | "MXN" | string;

export type AccountType = "bank" | "cash" | "wallet" | "goal_account";

export type DebtAccountType = "credit_card" | "loan" | "family_debt" | "other_debt";

export type TransactionType =
  | "expense"
  | "income"
  | "transfer"
  | "debt_payment"
  | "goal_contribution"
  | "refund"
  | "reversal"
  | "adjustment";

export type ReimbursementStatus = "none" | "expected" | "received" | "partial";

export type GoalStatus = "active" | "paused" | "completed" | "cancelled";

export type GoalFeasibilityStatus =
  | "viable"
  | "challenging"
  | "at_risk"
  | "not_currently_viable"
  | "paused_due_to_financial_health";

export type FinancialConfidenceLevel = "low" | "medium" | "high";

export type RecurringExpenseStatus = "active" | "paused" | "cancelled";

export type PaymentFrequency = "weekly" | "biweekly" | "monthly" | "yearly" | "custom";

export type FinancialCategory =
  | "housing"
  | "utilities"
  | "food"
  | "transport"
  | "health"
  | "education"
  | "subscriptions"
  | "debt"
  | "shopping"
  | "entertainment"
  | "family"
  | "savings"
  | "income"
  | "travel"
  | "other";

export interface MoneyAmount {
  originalAmount: number;
  originalCurrency: CurrencyCode;
  exchangeRateToBase: number;
  baseAmount: number;
  baseCurrency: CurrencyCode;
}

export interface Account {
  id: string;
  userId: string;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  currentBalanceOriginal: number;
  currentBalanceBase: number;
  isGoalAccount: boolean;
  createdAt: string;
}

export interface DebtAccount {
  id: string;
  userId: string;
  name: string;
  type: DebtAccountType;
  currency: CurrencyCode;
  currentBalanceOriginal: number;
  currentBalanceBase: number;
  minimumPayment?: number;
  fullPaymentDue?: number;
  dueDay?: number;
  cutoffDay?: number;
  interestRate?: number;
  defaultPaymentAccountId?: string;
  createdAt: string;
}

export interface FinancialGoal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  currency: CurrencyCode;
  currentAmount: number;
  targetDate: string;
  goalAccountId?: string;
  status: GoalStatus;
  feasibilityStatus: GoalFeasibilityStatus;
  weeklyRequiredAmount: number;
  monthlyRequiredAmount: number;
  createdAt: string;
}

export interface RecurringExpense {
  id: string;
  userId: string;
  name: string;
  amount: number;
  currency: CurrencyCode;
  category: FinancialCategory;
  frequency: PaymentFrequency;
  expectedDay?: number;
  paymentSourceId?: string;
  confidenceLevel: FinancialConfidenceLevel;
  status: RecurringExpenseStatus;
  createdAt: string;
}

export interface VariableBudgetEstimate {
  id: string;
  userId: string;
  category: FinancialCategory;
  initialEstimate: number;
  currentEstimate: number;
  currency: CurrencyCode;
  confidenceLevel: FinancialConfidenceLevel;
  lastCalculatedAt?: string;
}

export interface FinancialTransaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: MoneyAmount;
  description: string;
  category: FinancialCategory;
  sourceAccountId?: string;
  destinationAccountId?: string;
  debtAccountId?: string;
  relatedTransactionId?: string;
  recurringExpenseId?: string;
  isSplit: boolean;
  grossAmount?: number;
  reimbursedAmount?: number;
  netAmount?: number;
  reimbursementStatus: ReimbursementStatus;
  confidenceScore: number;
  occurredAt: string;
  createdAt: string;
}

export interface UserFinancialPreferences {
  userId: string;
  defaultSourceType?: "account" | "debt_account";
  defaultSourceId?: string;
  createdAt: string;
  updatedAt: string;
}
