// Stage 22 — structured onboarding wizard: pure state model + draft builder.
// The wizard UI holds a flat, string-friendly WizardState; this module turns it
// into the canonical OnboardingDraft consumed UNCHANGED by saveOnboardingDraftAction.
// No persistence here — pure functions only (so they're unit-testable).

import type {
  AccountLiquidity,
  AccountType,
  CoachStrictnessLevel,
  CoachTone,
  CurrencyCode,
  DebtAccountType,
  FinancialCategory,
  PaymentFrequency,
} from "@/types/financial";
import type { OnboardingDraft, OnboardingGoalArchetype } from "./draft-types";
import { isDebtPayoffGoalWithoutAmount } from "./onboarding-guards";

// ── UI state shapes (amounts are raw strings while the user types) ────────────

export interface WizardAccount {
  id: string;
  name: string;
  type: AccountType;
  balance: string;
  currency: CurrencyCode;
  liquidity: AccountLiquidity;
  isGoalAccount: boolean;
  isPrimary: boolean;
}

export interface WizardIncome {
  id: string;
  name: string;
  amount: string;
  currency: CurrencyCode;
  frequency: PaymentFrequency;
  expectedDay: string;
  isVariable: boolean;
  destinationAccountId: string;
}

export interface WizardExpense {
  id: string;
  name: string;
  amount: string;
  currency: CurrencyCode;
  category: FinancialCategory;
  frequency: PaymentFrequency;
  expectedDay: string;
  isEssential: boolean;
  paymentSourceId: string;
}

export interface WizardDebt {
  id: string;
  name: string;
  type: DebtAccountType;
  balance: string;
  minimumPayment: string;
  currency: CurrencyCode;
  dueDay: string;
  interestRate: string;
  defaultPaymentAccountId: string;
}

export interface WizardGoal {
  id: string;
  name: string;
  archetype: OnboardingGoalArchetype;
  targetAmount: string;
  currency: CurrencyCode;
  targetDate: string;
}

export interface WizardState {
  profile: { fullName: string; country: string; baseCurrency: CurrencyCode };
  accounts: WizardAccount[];
  incomes: WizardIncome[];
  expenses: WizardExpense[];
  debts: WizardDebt[];
  noDebts: boolean;
  goals: WizardGoal[];
  reserves: { monthlySavings: string; monthlyInvestment: string; essentialMonthlyEstimate: string };
  prefs: { tone: CoachTone; strictness: CoachStrictnessLevel };
  note: string;
}

// ── Parsing helpers (forgiving of LatAm number formats + stray symbols) ───────

/**
 * Parse a user-typed money string into a number, tolerant of "$", currency
 * codes, spaces, and both LatAm ("1.250,50") and US ("1,250.50") grouping.
 * Returns undefined when there is no parseable number (so "abc" → undefined,
 * which callers treat as "not provided" / a validation error). Never throws.
 */
export function parseMoney(raw: string | undefined | null): number | undefined {
  if (raw == null) return undefined;
  let s = String(raw).trim();
  if (!s) return undefined;
  s = s.replace(/[^0-9.,-]/g, "");
  const negative = s.startsWith("-");
  s = s.replace(/-/g, "");
  if (!/[0-9]/.test(s)) return undefined;

  const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  let intPart = s;
  let fracPart = "";
  if (lastSep !== -1) {
    const after = s.slice(lastSep + 1);
    if (after.length === 1 || after.length === 2) {
      // Trailing 1–2 digits after the last separator → decimals.
      intPart = s.slice(0, lastSep);
      fracPart = after;
    }
    // Otherwise (3 trailing digits, e.g. "1.500") every separator is grouping.
  }
  intPart = intPart.replace(/[.,]/g, "");
  fracPart = fracPart.replace(/[.,]/g, "");
  const n = Number(fracPart ? `${intPart}.${fracPart}` : intPart || "0");
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

export function parseDay(raw: string | undefined): number | undefined {
  const n = Number(String(raw ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : undefined;
}

export function parseRate(raw: string | undefined): number | undefined {
  const n = parseMoney(raw);
  return n !== undefined && n >= 0 && n <= 1000 ? n : undefined;
}

function trimmed(value: string | undefined): string {
  return (value ?? "").trim();
}

// ── Reviewability mirrors (must match save-actions.ts so the UI's "can finish"
// and progress reflect exactly what will persist) ────────────────────────────

export function accountReviewable(a: WizardAccount): boolean {
  const name = trimmed(a.name);
  return name.length > 0 && name !== "Cuenta";
}

export function incomeReviewable(i: WizardIncome): boolean {
  return parseMoney(i.amount) !== undefined;
}

export function expenseReviewable(e: WizardExpense): boolean {
  return parseMoney(e.amount) !== undefined;
}

export function debtReviewable(d: WizardDebt): boolean {
  const name = trimmed(d.name);
  const hasName = name.length > 0 && name !== "Deuda";
  const hasAmount = parseMoney(d.balance) !== undefined || parseMoney(d.minimumPayment) !== undefined;
  return hasName || hasAmount;
}

export function goalReviewable(g: WizardGoal): boolean {
  const name = trimmed(g.name);
  const amount = parseMoney(g.targetAmount);
  if (name === "Mi meta" && amount === undefined) return false;
  if (isDebtPayoffGoalWithoutAmount(name || undefined, amount)) return false;
  const hasRealName = Boolean(name && name !== "Mi meta");
  if (!hasRealName && !g.archetype) return false;
  const needsAmount = g.archetype !== "organize_month";
  if (needsAmount && amount === undefined) return false;
  return true;
}

// ── Readiness: the real /app gate is ">=1 account row AND >=1 goal row" ───────

export interface WizardReadiness {
  reviewableAccounts: number;
  reviewableGoals: number;
  canFinish: boolean;
  missing: string[];
}

export function wizardReadiness(state: WizardState): WizardReadiness {
  const reviewableAccounts = state.accounts.filter(accountReviewable).length;
  const reviewableGoals = state.goals.filter(goalReviewable).length;
  const missing: string[] = [];
  if (reviewableAccounts === 0) missing.push("Agrega al menos una cuenta con nombre.");
  if (reviewableGoals === 0) missing.push("Elige al menos una meta (puede ser solo «Ordenar mi mes»).");
  return {
    reviewableAccounts,
    reviewableGoals,
    canFinish: reviewableAccounts > 0 && reviewableGoals > 0,
    missing,
  };
}

// ── Draft builder: WizardState → canonical OnboardingDraft ────────────────────

const GOAL_DEFAULT_NAME: Record<OnboardingGoalArchetype, string> = {
  organize_month: "Ordenar mi mes",
  emergency_savings: "Fondo de emergencia",
  specific_purchase: "Mi compra",
  pay_down_debt: "Salir de deudas",
  other: "Mi meta",
};

export function buildOnboardingDraft(state: WizardState): OnboardingDraft {
  const base = state.profile.baseCurrency;
  const debtIds = new Set(state.debts.map((d) => d.id));

  const savings = parseMoney(state.reserves.monthlySavings);
  const investment = parseMoney(state.reserves.monthlyInvestment);
  const essentials = parseMoney(state.reserves.essentialMonthlyEstimate);

  return {
    profile: {
      fullName: trimmed(state.profile.fullName) || undefined,
      country: trimmed(state.profile.country) || undefined,
      baseCurrency: base,
      tonePreference: state.prefs.tone,
      strictnessLevel: state.prefs.strictness,
      monthlySavings: savings,
      monthlyInvestment: investment,
      essentialMonthlyEstimate: essentials,
    },
    accounts: state.accounts.map((a) => ({
      draftId: a.id,
      name: trimmed(a.name) || undefined,
      type: a.type,
      currency: a.currency,
      currentBalance: parseMoney(a.balance),
      isGoalAccount: a.isGoalAccount,
      isPrimary: a.isPrimary,
      liquidity: a.liquidity,
    })),
    debtAccounts: state.debts.map((d) => ({
      draftId: d.id,
      name: trimmed(d.name) || undefined,
      type: d.type,
      currency: d.currency,
      totalBalance: parseMoney(d.balance),
      minimumPayment: parseMoney(d.minimumPayment),
      dueDay: parseDay(d.dueDay),
      interestRate: parseRate(d.interestRate),
      defaultPaymentAccountDraftId: d.defaultPaymentAccountId || undefined,
    })),
    incomeSources: state.incomes.map((i) => ({
      draftId: i.id,
      name: trimmed(i.name) || undefined,
      amount: parseMoney(i.amount),
      currency: i.currency,
      frequency: i.frequency,
      expectedDay: parseDay(i.expectedDay),
      isVariable: i.isVariable,
      destinationAccountDraftId: i.destinationAccountId || undefined,
    })),
    fixedExpenses: state.expenses.map((e) => {
      const sourceId = e.paymentSourceId || undefined;
      const sourceType = sourceId ? (debtIds.has(sourceId) ? "debt_account" : "account") : undefined;
      return {
        draftId: e.id,
        name: trimmed(e.name) || undefined,
        amount: parseMoney(e.amount),
        currency: e.currency,
        category: e.category,
        frequency: e.frequency,
        expectedDay: parseDay(e.expectedDay),
        isEssential: e.isEssential,
        paymentSourceType: sourceType,
        paymentSourceDraftId: sourceId,
      };
    }),
    goals: state.goals.map((g) => ({
      draftId: g.id,
      name: trimmed(g.name) || GOAL_DEFAULT_NAME[g.archetype],
      archetype: g.archetype,
      targetAmount: parseMoney(g.targetAmount),
      currency: g.currency,
      targetDate: trimmed(g.targetDate) || undefined,
    })),
    coachPreferences: {
      tone: state.prefs.tone,
      strictnessLevel: state.prefs.strictness,
    },
    userContextNotes: trimmed(state.note)
      ? [
          {
            draftId: "wizard-note",
            content: trimmed(state.note),
            noteType: "general",
            source: "onboarding",
            createdAt: "",
          },
        ]
      : [],
    explicitlyEmptySteps: state.noDebts ? ["debt_accounts"] : [],
  };
}
