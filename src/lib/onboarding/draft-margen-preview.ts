import {
  calculateMargenKipu,
  type MargenKipuResult,
} from "@/lib/financial/margen-kipu";
import type {
  Account,
  CurrencyCode,
  DebtAccount,
  FixedExpense,
  IncomeSource,
  PaymentFrequency,
} from "@/types/financial";
import type { OnboardingDraft } from "@/lib/onboarding/draft-types";

// The first Margen Kipu moment: at the review step, the draft (still
// unpersisted) is mapped into the REAL engine so the user sees their first
// safe-to-spend number before confirming. Pure and client-safe — same math the
// dashboard will show, so the promise starts true. Returns null when the seed
// is too thin to be honest (no liquid money or no income yet).

function freq(value: string | undefined): PaymentFrequency {
  return value === "weekly" || value === "biweekly" || value === "monthly" || value === "yearly" || value === "custom"
    ? value
    : "monthly";
}

export function buildDraftMargenPreview(
  draft: OnboardingDraft,
): MargenKipuResult | null {
  const baseCurrency = (draft.profile.baseCurrency ?? "USD") as CurrencyCode;
  // The preview NEVER invents an FX rate (Kipu's rule). Only money already in the
  // base currency is summed; other-currency items are excluded so a USD balance is
  // never summed into pesos at 1:1. (Onboarding can't convert without a rate.)
  const inBase = (currency: CurrencyCode | undefined) => currency === undefined || currency === baseCurrency;

  const accounts: Account[] = draft.accounts
    .filter((a) => a.name && a.currentBalance !== undefined && inBase(a.currency))
    .map((a, i) => {
      const isGoal = Boolean(a.isGoalAccount) || a.type === "goal_account";
      return {
        id: a.draftId || `draft-acc-${i}`,
        userId: "draft",
        name: a.name ?? "Cuenta",
        type: a.type ?? "bank",
        currency: baseCurrency,
        currentBalanceOriginal: a.currentBalance ?? 0,
        currentBalanceBase: a.currentBalance ?? 0,
        isGoalAccount: isGoal,
        liquidity: a.liquidity === "non_liquid" ? "non_liquid" : "liquid",
        createdAt: "",
      };
    });

  const debtAccounts: DebtAccount[] = draft.debtAccounts
    .filter((d) => (d.name || d.totalBalance !== undefined || d.minimumPayment !== undefined) && inBase(d.currency))
    .map((d, i) => {
      const balance =
        d.totalBalance ?? d.currentMonthPayment ?? d.accumulatedBalance ?? d.minimumPayment ?? 0;
      return {
        id: d.draftId || `draft-debt-${i}`,
        userId: "draft",
        name: d.name ?? "Deuda",
        type: d.type ?? "credit_card",
        currency: baseCurrency,
        currentBalanceOriginal: balance,
        currentBalanceBase: balance,
        minimumPayment: d.minimumPayment,
        fullPaymentDue: d.currentMonthPayment,
        dueDay: d.dueDay,
        cutoffDay: d.cutoffDay,
        interestRate: d.interestRate,
        createdAt: "",
      };
    });

  const fixedExpenses: FixedExpense[] = draft.fixedExpenses
    .filter((f) => (f.amount ?? 0) > 0 && inBase(f.currency))
    .map((f, i) => ({
      id: f.draftId || `draft-fix-${i}`,
      userId: "draft",
      name: f.name ?? "Gasto fijo",
      amount: f.amount ?? 0,
      currency: baseCurrency,
      category: f.category ?? "other",
      frequency: freq(f.frequency),
      expectedDay: f.expectedDay,
      expectedWeekday: f.expectedWeekday,
      isEssential: f.isEssential ?? true,
      isActive: true,
      createdAt: "",
    }));

  const incomeSources: IncomeSource[] = draft.incomeSources
    .filter((s) => (s.amount ?? s.minExpectedAmount ?? 0) > 0 && inBase(s.currency))
    .map((s, i) => ({
      id: s.draftId || `draft-inc-${i}`,
      userId: "draft",
      name: s.name ?? "Ingreso",
      amount: s.amount ?? s.minExpectedAmount ?? 0,
      currency: baseCurrency,
      frequency: freq(s.frequency),
      expectedDay: s.expectedDay,
      expectedWeekday: s.expectedWeekday,
      isVariable: Boolean(s.isVariable),
      status: "active",
      createdAt: "",
    }));

  const hasLiquidMoney = accounts.some(
    (a) => !a.isGoalAccount && a.liquidity !== "non_liquid" && a.currentBalanceBase > 0,
  );
  const hasIncome = incomeSources.length > 0;
  if (!hasLiquidMoney || !hasIncome) return null;

  return calculateMargenKipu({
    accounts,
    debtAccounts,
    fixedExpenses,
    scheduledPayments: [],
    incomeSources,
    monthlyEssentialEstimate: draft.profile.essentialMonthlyEstimate ?? 0,
    weeklyGoalContribution: 0,
    monthlySavingsCommitment: draft.profile.monthlySavings ?? 0,
    monthlyInvestmentCommitment: draft.profile.monthlyInvestment ?? 0,
    baseCurrency,
  });
}
