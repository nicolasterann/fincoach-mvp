import {
  calculateMargenKipu,
  type MargenCapacity,
  type MargenKipuResult,
} from "@/lib/financial/margen-kipu";
import { computeBudgetProgress, type BudgetProgress } from "@/lib/financial/budget-progress";
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
import { seedMonthISO, type OnboardingDraftV2 } from "@/lib/onboarding/wizard-model";

// The engine expresses the goal reservation weekly (× WEEKS_PER_MONTH internally);
// the wizard collects a MONTHLY goal contribution, so convert monthly → weekly here.
// S31 (4.4d): these MIRROR margen-kipu.ts:38-39 EXACTLY (30 and 30/7 — not 4.33).
// Exported so the wizard's "≈ al mes" hints and the dev gate use the same factor.
export const AVG_DAYS_PER_MONTH = 30;
export const WEEKS_PER_MONTH = AVG_DAYS_PER_MONTH / 7;

/** A rate the server already knows (fx_rates set via chat or a prior save). S34:
 *  the preview must honor these too, or the review number diverges from the
 *  dashboard for users whose rate lives only server-side. */
export interface KnownFxRateLite {
  from: string;
  to: string;
  rate: number;
}

// All manual rates the draft carries (S31 5.1c multi-rate; single-rate fallback),
// PLUS the server-known rates (S34) — wizard-typed rates come first so a rate the
// user just corrected wins over a stale stored one.
function draftFxRates(
  draft: OnboardingDraft | OnboardingDraftV2,
  knownRates: KnownFxRateLite[] = [],
): FxRate[] {
  const multi = (draft as OnboardingDraftV2).fxRates;
  const own: FxRate[] =
    multi && multi.length > 0
      ? multi.map((r) => ({ from: r.from, to: r.to, rate: r.rate, source: "manual" as const }))
      : draft.fxRate
        ? [{ from: draft.fxRate.from, to: draft.fxRate.to, rate: draft.fxRate.rate, source: "manual" }]
        : [];
  const server: FxRate[] = knownRates.map((r) => ({
    from: r.from as CurrencyCode,
    to: r.to as CurrencyCode,
    rate: r.rate,
    source: "manual" as const,
  }));
  return [...own, ...server];
}

// S32 (preview parity — the S31 lesson) — run the DRAFTED budgets+seeds through
// the SAME engine module the dashboard uses (computeBudgetProgress) with
// classified: [] (nothing logged yet during onboarding). The seeds are anchored
// to `now`'s month — exactly the seed_month save-actions will stamp — so the
// review-step Margen shows the same remaining-based number the dashboard will.
function draftBudgetProgress(
  draft: OnboardingDraft | OnboardingDraftV2,
  now: Date,
): BudgetProgress {
  const seedMonth = seedMonthISO(now);
  return computeBudgetProgress({
    budgets: (draft.categoryBudgets ?? []).map((cb) => ({
      category: cb.category,
      amountBase: cb.amount,
      mtdSeed: cb.mtdSeed ?? null,
      seedMonth: cb.mtdSeed !== undefined ? seedMonth : null,
      isActive: true,
    })),
    classified: [],
    now,
  });
}

// Total monthly goal contribution the user committed (allocation step, #7). Only
// positive committed amounts reserve money; unfunded goals reserve nothing.
function monthlyGoalContribution(draft: OnboardingDraft | OnboardingDraftV2): number {
  const goals = (draft as OnboardingDraftV2).goals ?? draft.goals ?? [];
  return goals.reduce((sum, g) => {
    const c = (g as { monthlyContribution?: number }).monthlyContribution;
    return sum + (typeof c === "number" && c > 0 ? c : 0);
  }, 0);
}

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
  draft: OnboardingDraft | OnboardingDraftV2,
  // Injectable clock so the dev gate is deterministic; the wizard uses the default.
  now: Date = new Date(),
  // S34 — server-known fx rates (fx_rates), so the preview converts exactly what
  // the dashboard will convert (a rate set earlier via chat must not diverge them).
  knownRates: KnownFxRateLite[] = [],
): MargenKipuResult | null {
  const baseCurrency = (draft.profile.baseCurrency ?? "USD") as CurrencyCode;
  const rates: FxRate[] = draftFxRates(draft, knownRates);

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
      // S34 (parity) — the weekly/biweekly pay anchor phases the 7/14-day cadence;
      // dropping it made the preview place the expense TODAY while the dashboard
      // places it on the real date (same S31 4.4a lesson as incomes). isVariable
      // travels too (calendar confidence).
      payAnchorDate: f.payAnchorDate,
      isEssential: f.isEssential ?? true,
      isActive: true,
      isVariable: Boolean((f as { isVariable?: boolean }).isVariable),
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
    // S31 (4.4a) — pass the CONVERTED variable minimum through so the engine's
    // conservative-min branch reads base truth (same figure as `amount` when the
    // income is min-only, but explicit — preview and live engine see one shape).
    const minBase = s.minExpectedAmount !== undefined ? toBase(s.minExpectedAmount, s.currency) : null;
    incomeSources.push({
      id: s.draftId || `draft-inc-${i}`,
      userId: "draft",
      name: s.name ?? "Ingreso",
      amount: base,
      currency: baseCurrency,
      frequency: freq(s.frequency),
      expectedDay: s.expectedDay,
      expectedWeekday: s.expectedWeekday,
      // S31 (4.4a) — the biweekly/weekly anchor drives the "cuándo cae tu próximo
      // ingreso" confidence gap; dropping it made the preview lie low vs. the app.
      payAnchorDate: s.payAnchorDate,
      isVariable: Boolean(s.isVariable),
      // A2 — occasional income must be excluded from the onboarding capacity/Margen
      // preview exactly as the live engines exclude it, so preview == live.
      isOccasional: Boolean(s.isOccasional),
      minExpectedAmount: minBase ?? undefined,
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
  // S32 (preview parity) — when the draft carries budget categories, feed the
  // projection the SAME remaining-based params coaching-signals feeds it from
  // computeBudgetProgress: the current month burns only what REMAINS of the
  // budgets (seeds already spent don't reserve twice), next month burns the full
  // rate. Capacity stays monthly (untouched). No budgets → params absent → the
  // engine keeps today's flat behavior.
  const budgetProgress = draftBudgetProgress(draft, now);
  return calculateMargenKipu({
    accounts,
    debtAccounts,
    fixedExpenses,
    scheduledPayments: [],
    incomeSources,
    monthlyEssentialEstimate: draft.profile.essentialMonthlyEstimate ?? 0,
    // Monthly goal contribution → the weekly figure the engine reserves (#7): so the
    // headline Margen and capacity reflect what the user committed to their goals.
    weeklyGoalContribution: monthlyGoalContribution(draft) / WEEKS_PER_MONTH,
    monthlySavingsCommitment: draft.profile.monthlySavings ?? 0,
    monthlyInvestmentCommitment: draft.profile.monthlyInvestment ?? 0,
    baseCurrency,
    now,
    ...(budgetProgress.hasBudgets
      ? {
          remainingEssentialThisMonth: budgetProgress.totalRemaining,
          daysLeftInMonth: budgetProgress.daysLeftInMonth,
        }
      : {}),
  });
}

// The capacity picture ALONE, for the capacity-reveal + allocation steps (#7). The
// full Margen preview returns null until there's liquid money AND income; capacity
// (income − fixed − debt − essentials, then protected) is meaningful earlier (e.g.
// income entered before a balance). This runs the SAME engine with the same mapped
// inputs but always returns `capacity`, never null. Honest: unconverted foreign
// items are still excluded (same toBase gate), so capacity never sums at a fake 1:1.
export function buildDraftCapacity(
  draft: OnboardingDraft | OnboardingDraftV2,
  knownRates: KnownFxRateLite[] = [],
): MargenCapacity | null {
  const baseCurrency = (draft.profile.baseCurrency ?? "USD") as CurrencyCode;
  const rates: FxRate[] = draftFxRates(draft, knownRates);
  const toBase = (amount: number, currency: CurrencyCode | undefined): number | null => {
    if (currency === undefined || currency === baseCurrency) return amount;
    const r = convert(amount, currency, baseCurrency, rates);
    return r.ok ? r.baseAmount : null;
  };

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
      payAnchorDate: f.payAnchorDate,
      isEssential: f.isEssential ?? true,
      isActive: true,
      isVariable: Boolean((f as { isVariable?: boolean }).isVariable),
      createdAt: "",
    });
  });

  const debtAccounts: DebtAccount[] = [];
  draft.debtAccounts.forEach((d, i) => {
    if (!(d.name || d.totalBalance !== undefined || d.minimumPayment !== undefined || d.currentMonthPayment !== undefined)) return;
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
      createdAt: "",
    });
  });

  const incomeSources: IncomeSource[] = [];
  draft.incomeSources.forEach((s, i) => {
    const raw = s.amount ?? s.minExpectedAmount ?? 0;
    if (!(raw > 0)) return;
    const base = toBase(raw, s.currency);
    if (base === null) return;
    const minBase = s.minExpectedAmount !== undefined ? toBase(s.minExpectedAmount, s.currency) : null;
    incomeSources.push({
      id: s.draftId || `draft-inc-${i}`,
      userId: "draft",
      name: s.name ?? "Ingreso",
      amount: base,
      currency: baseCurrency,
      frequency: freq(s.frequency),
      // S31 (4.4a) — same income shape as the full preview: timing + variable min
      // travel through so capacity mirrors what the live engine will compute.
      expectedDay: s.expectedDay,
      expectedWeekday: s.expectedWeekday,
      payAnchorDate: s.payAnchorDate,
      isVariable: Boolean(s.isVariable),
      isOccasional: Boolean(s.isOccasional),
      minExpectedAmount: minBase ?? undefined,
      status: "active",
      createdAt: "",
    });
  });

  if (incomeSources.length === 0) return null;

  return calculateMargenKipu({
    accounts: [],
    debtAccounts,
    fixedExpenses,
    scheduledPayments: [],
    incomeSources,
    monthlyEssentialEstimate: draft.profile.essentialMonthlyEstimate ?? 0,
    weeklyGoalContribution: monthlyGoalContribution(draft) / WEEKS_PER_MONTH,
    monthlySavingsCommitment: draft.profile.monthlySavings ?? 0,
    monthlyInvestmentCommitment: draft.profile.monthlyInvestment ?? 0,
    baseCurrency,
  }).capacity;
}
