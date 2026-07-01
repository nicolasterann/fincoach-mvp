import {
  calculateMargenKipu,
  type MargenKipuResult,
} from "@/lib/financial/margen-kipu";
import { convert, type FxRate } from "@/lib/fx/fx-rates";
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
//
// Multi-currency (Stage 23): amounts in a currency other than the base are
// converted using the user's OWN manual rate (draft.fxRate). Kipu NEVER invents
// a rate — an item in a currency with no known rate is excluded from the preview
// rather than summed 1:1.

function freq(value: string | undefined): PaymentFrequency {
  return value === "weekly" || value === "biweekly" || value === "monthly" || value === "yearly" || value === "custom"
    ? value
    : "monthly";
}

export function buildDraftMargenPreview(
  draft: OnboardingDraft,
): MargenKipuResult | null {
  const baseCurrency = (draft.profile.baseCurrency ?? "USD") as CurrencyCode;
  const rates: FxRate[] = draft.fxRate
    ? [{ from: draft.fxRate.from, to: draft.fxRate.to, rate: draft.fxRate.rate, source: "manual" }]
    : [];

  // Convert an amount to the base currency; null when there's no known rate
  // (honest — the item is then excluded, never summed at a fabricated 1:1).
  const toBase = (amount: number, currency: CurrencyCode | undefined): number | null => {
    if (currency === undefined || currency === baseCurrency) return amount;
    const r = convert(amount, currency, baseCurrency, rates);
    return r.ok ? r.baseAmount : null;
  };

  const accounts: Account[] = [];
  draft.accounts.forEach((a, i) => {
    if (!a.name || a.currentBalance === undefined) return;
    const base = toBase(a.currentBalance, a.currency);
    if (base === null) return;
    accounts.push({
      id: a.draftId || `draft-acc-${i}`,
      userId: "draft",
      name: a.name ?? "Cuenta",
      type: a.type ?? "bank",
      currency: baseCurrency,
      currentBalanceOriginal: a.currentBalance,
      currentBalanceBase: base,
      isGoalAccount: Boolean(a.isGoalAccount) || a.type === "goal_account",
      liquidity: a.liquidity === "non_liquid" ? "non_liquid" : "liquid",
      createdAt: "",
    });
  });

  const debtAccounts: DebtAccount[] = [];
  draft.debtAccounts.forEach((d, i) => {
    if (!(d.name || d.totalBalance !== undefined || d.minimumPayment !== undefined)) return;
    const rawBalance = d.totalBalance ?? d.currentMonthPayment ?? d.accumulatedBalance ?? d.minimumPayment ?? 0;
    const base = toBase(rawBalance, d.currency);
    if (base === null) return;
    debtAccounts.push({
      id: d.draftId || `draft-debt-${i}`,
      userId: "draft",
      name: d.name ?? "Deuda",
      type: d.type ?? "credit_card",
      currency: baseCurrency,
      currentBalanceOriginal: rawBalance,
      currentBalanceBase: base,
      minimumPayment: d.minimumPayment !== undefined ? toBase(d.minimumPayment, d.currency) ?? undefined : undefined,
      fullPaymentDue: d.currentMonthPayment !== undefined ? toBase(d.currentMonthPayment, d.currency) ?? undefined : undefined,
      dueDay: d.dueDay,
      cutoffDay: d.cutoffDay,
      interestRate: d.interestRate,
      createdAt: "",
    });
  });

  const fixedExpenses: FixedExpense[] = [];
  draft.fixedExpenses.forEach((f, i) => {
    if (!((f.amount ?? 0) > 0)) return;
    const base = toBase(f.amount ?? 0, f.currency);
    if (base === null) return;
    fixedExpenses.push({
      id: f.draftId || `draft-fix-${i}`,
      userId: "draft",
      name: f.name ?? "Gasto fijo",
      amount: base,
      currency: baseCurrency,
      category: f.category ?? "other",
      frequency: freq(f.frequency),
      expectedDay: f.expectedDay,
      expectedWeekday: f.expectedWeekday,
      isEssential: f.isEssential ?? true,
      isActive: true,
      createdAt: "",
    });
  });

  const incomeSources: IncomeSource[] = [];
  draft.incomeSources.forEach((s, i) => {
    // Variable income → use the conservative minimum so a low month never reads as safe.
    const raw = s.amount ?? s.minExpectedAmount ?? 0;
    if (!(raw > 0)) return;
    const base = toBase(raw, s.currency);
    if (base === null) return;
    incomeSources.push({
      id: s.draftId || `draft-inc-${i}`,
      userId: "draft",
      name: s.name ?? "Ingreso",
      amount: base,
      currency: baseCurrency,
      frequency: freq(s.frequency),
      expectedDay: s.expectedDay,
      expectedWeekday: s.expectedWeekday,
      isVariable: Boolean(s.isVariable),
      status: "active",
      createdAt: "",
    });
  });

  const hasLiquidMoney = accounts.some(
    (a) => !a.isGoalAccount && a.liquidity !== "non_liquid" && a.currentBalanceBase > 0,
  );
  const hasIncome = incomeSources.length > 0;
  if (!hasLiquidMoney || !hasIncome) return null;

  // Category budgets already sum into essentialMonthlyEstimate at draft-build time.
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
