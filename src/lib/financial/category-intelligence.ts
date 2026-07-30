import type { FinancialCategory } from "@/types/financial";
import { normalizeMerchant, type MerchantOverride, type NormalizedMerchant } from "@/lib/financial/merchant-normalization";

// Stage 16 — CATEGORY INTELLIGENCE. The deterministic foundation that classifies
// every transaction so the spending/budget/behavior layer NEVER double-counts:
// transfers, card/debt payments, refunds, savings/goal moves and income are
// excluded from "spending"; only real expenses count, split into essential /
// variable / discretionary / recurring so Kipu knows what's actually cuttable.
// PURE. It tags a normalized merchant and a confidence; it never fabricates a
// category — the stored category stays authoritative, merchant only SUGGESTS.

export type SpendingType =
  | "installment_purchase"
  | "essential"
  | "variable"
  | "discretionary"
  | "recurring" // subscription-like discretionary that repeats
  | "debt_payment"
  | "transfer"
  | "income"
  | "savings_goal"
  | "investment"
  | "refund"
  | "adjustment";

export interface IntelTxn {
  type: string; // transaction_type
  category: string; // financial_category
  description?: string | null;
  baseAmount: number;
  occurredAtMs: number;
  debtAccountId?: string | null;
  goalId?: string | null;
  categorySource?: string | null; // user / statement / ai / rule / default
  // Stage G — provenance ref; 'installment:<plan_id>' marks a cuotas purchase.
  externalRef?: string | null;
}

export interface ClassifiedTxn {
  baseAmount: number;
  occurredAtMs: number;
  spendingType: SpendingType;
  category: FinancialCategory;
  parentCategory: string;
  merchant: NormalizedMerchant;
  isSpend: boolean; // a real outflow that counts in spending analysis (expense only)
  isControllable: boolean; // discretionary/variable/recurring — cuttable without breaking essentials
  affectsCashflow: boolean;
  excludedFromSpending: boolean;
  categorySource: string;
  // The merchant suggests a different category than the stored one (and the
  // stored one is the default 'other') → a gentle "want me to recategorize?".
  categorySuggestion: FinancialCategory | null;
  confidence: "high" | "medium" | "low";
}

const CATEGORY_PROFILE: Record<FinancialCategory, { essentialness: "essential" | "variable" | "discretionary"; parent: string; recurring: boolean }> = {
  housing: { essentialness: "essential", parent: "Vivienda", recurring: true },
  utilities: { essentialness: "essential", parent: "Servicios", recurring: true },
  food: { essentialness: "variable", parent: "Comida", recurring: false },
  transport: { essentialness: "variable", parent: "Transporte", recurring: false },
  health: { essentialness: "essential", parent: "Salud", recurring: false },
  education: { essentialness: "essential", parent: "Educación", recurring: true },
  subscriptions: { essentialness: "discretionary", parent: "Suscripciones", recurring: true },
  debt: { essentialness: "essential", parent: "Deuda", recurring: true },
  shopping: { essentialness: "discretionary", parent: "Compras", recurring: false },
  entertainment: { essentialness: "discretionary", parent: "Entretenimiento", recurring: false },
  family: { essentialness: "essential", parent: "Familia", recurring: false },
  travel: { essentialness: "discretionary", parent: "Viajes", recurring: false },
  savings: { essentialness: "essential", parent: "Ahorro", recurring: true },
  income: { essentialness: "essential", parent: "Ingreso", recurring: false },
  other: { essentialness: "variable", parent: "Otros", recurring: false },
};

function asCategory(c: string): FinancialCategory {
  return (c in CATEGORY_PROFILE ? c : "other") as FinancialCategory;
}

// Stage D — a category whose spend is a GUSTO (drains the Saldo tank). Budgets
// on these categories must NOT also reserve capacity (that would double-count).
export function isDiscretionaryCategory(c: string): boolean {
  return CATEGORY_PROFILE[asCategory(c)].essentialness === "discretionary";
}

export function classifyTxn(txn: IntelTxn, overrides: MerchantOverride[] = []): ClassifiedTxn {
  const category = asCategory(txn.category);
  const profile = CATEGORY_PROFILE[category];
  const merchant = normalizeMerchant(txn.description, overrides);
  const baseAmount = txn.baseAmount;
  const categorySource = txn.categorySource ?? (merchant.source === "memory" ? "merchant_memory" : "default");

  const base = {
    baseAmount,
    occurredAtMs: txn.occurredAtMs,
    category,
    parentCategory: profile.parent,
    merchant,
    categorySource,
    categorySuggestion: category === "other" && merchant.category && merchant.category !== "other" ? merchant.category : null,
    confidence: merchant.confidence,
  };

  // Non-spending types are excluded so they never inflate spending/budgets.
  const exclude = (spendingType: SpendingType, affectsCashflow: boolean): ClassifiedTxn => ({
    ...base,
    spendingType,
    isSpend: false,
    isControllable: false,
    affectsCashflow,
    excludedFromSpending: true,
  });

  // Stage G — a cuotas purchase is a COMMITMENT, not this month's spend: its
  // cost enters the ritmo (capacity.monthlyInstallments) month by month. Counting
  // the full total here would eat budgets/burn today AND charge the cuota too.
  if (
    txn.type !== "refund" &&
    (txn.externalRef ?? "").startsWith("installment:")
  ) {
    return exclude("installment_purchase", false);
  }
  switch (txn.type) {
    case "transfer":
      return exclude("transfer", false); // internal move, not cashflow-affecting as spend
    case "debt_payment":
      return exclude("debt_payment", true); // real outflow, but a payment — not "spending"
    case "income":
      return exclude("income", true);
    case "goal_contribution":
      return exclude("savings_goal", true);
    case "refund":
      return exclude("refund", true);
    case "reversal":
    case "adjustment":
      return exclude("adjustment", false);
    default:
      break; // expense → real spending below
  }

  // A card PURCHASE is an expense with a debt account; it IS spending (it raised
  // the card balance). It is NOT a transfer or a debt payment.
  const spendingType: SpendingType =
    profile.essentialness === "essential" ? (profile.recurring ? "essential" : "essential") : category === "subscriptions" ? "recurring" : profile.essentialness === "discretionary" ? "discretionary" : "variable";
  const isControllable = spendingType === "discretionary" || spendingType === "variable" || spendingType === "recurring";

  return {
    ...base,
    spendingType,
    isSpend: baseAmount > 0,
    isControllable,
    affectsCashflow: true,
    excludedFromSpending: false,
  };
}

export function classifyMany(txns: IntelTxn[], overrides: MerchantOverride[] = []): ClassifiedTxn[] {
  return txns.map((t) => classifyTxn(t, overrides));
}
