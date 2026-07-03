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
import type {
  OnboardingDraft,
  OnboardingDraftFixedExpense,
  OnboardingDraftGoal,
  OnboardingGoalArchetype,
} from "./draft-types";
import { isDebtPayoffGoalWithoutAmount } from "./onboarding-guards";

// ── Stage 30 draft extension ─────────────────────────────────────────────────
// The canonical OnboardingDraft (draft-types.ts, owned by the DATA layer) doesn't
// yet model assets, per-expense variability, or a per-goal committed contribution.
// Rather than reach into that shared contract, the wizard emits an ADDITIVE
// superset that save-actions (also onboarding-owned) consumes. Every added piece
// is optional, so `OnboardingDraftV2` is assignable wherever `OnboardingDraft` is.

/** An asset row → public.investment_accounts (Stage 17 table). */
export interface OnboardingDraftAsset {
  draftId: string;
  name?: string;
  assetClass: string;
  value?: number;
  currency?: CurrencyCode;
  liquid: boolean;
  includeInNetWorth: boolean;
  expectedReturnPct?: number;
  notes?: string;
}

/** Fixed expense + the Stage 30 variability flag (fixed_expenses.is_variable). */
export type OnboardingDraftFixedExpenseV2 = OnboardingDraftFixedExpense & {
  isVariable?: boolean;
};

/** Goal + the Stage 30 committed monthly contribution (goals.contribution_amount). */
export type OnboardingDraftGoalV2 = OnboardingDraftGoal & {
  monthlyContribution?: number;
};

export interface OnboardingDraftV2 extends OnboardingDraft {
  fixedExpenses: OnboardingDraftFixedExpenseV2[];
  goals: OnboardingDraftGoalV2[];
  /** Assets / investments (patrimonio). Never touch the Margen; feed net worth. */
  assets?: OnboardingDraftAsset[];
}

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
  /** Optional annual return %, for investment/savings accounts (non-liquid). Kept as a learned note. */
  returnRate: string;
  /** Stage 30 (#8) — free-text "nota para Kipu" persisted to accounts.notes. Optional. */
  note?: string;
}

export interface WizardIncome {
  id: string;
  name: string;
  amount: string;
  currency: CurrencyCode;
  frequency: PaymentFrequency;
  expectedDay: string;
  /** A known payday (ISO) that anchors the 14-day cadence for weekly/biweekly. */
  lastPayDate: string;
  isVariable: boolean;
  /** When variable, the user gives a range instead of a fixed amount. */
  minAmount: string;
  maxAmount: string;
  destinationAccountId: string;
}

/** Variable-spend budget per category (Stage 23), amount as a raw string. */
export interface WizardCategoryBudget {
  category: FinancialCategory;
  amount: string;
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
  /** Stage 30 (#2) — a fixed expense whose amount varies month to month (gas, luz).
   *  Persisted to fixed_expenses.is_variable; the engine confirms these each month.
   *  Optional so pre-existing literals default to false (truly fixed). */
  isVariable?: boolean;
  /** Stage 30 (#8) — free-text "nota para Kipu" persisted to fixed_expenses.notes. */
  note?: string;
}

export interface WizardDebt {
  id: string;
  name: string;
  type: DebtAccountType;
  balance: string;
  /** What you owe in TOTAL across all months. */
  /** What you have to pay THIS month (the statement total). */
  currentMonthPayment: string;
  minimumPayment: string;
  currency: CurrencyCode;
  dueDay: string;
  /** Statement close / cutoff day (cards). */
  cutoffDay: string;
  interestRate: string;
  defaultPaymentAccountId: string;
  /** Stage 30 (#4) — LOAN-shaped input: the fixed monthly cuota. For loans this is
   *  the source of truth for monthly debt service (maps to currentMonthPayment →
   *  full_payment_due). Optional; cards leave it empty and use the cycle fields. */
  monthlyPayment?: string;
  /** Stage 30 (#4) — # of installments remaining on a loan (informational). */
  installmentsRemaining?: string;
  /** Stage 30 (#8) — free-text "nota para Kipu" persisted to debt_accounts.notes. */
  note?: string;
}

export interface WizardGoal {
  id: string;
  name: string;
  archetype: OnboardingGoalArchetype;
  targetAmount: string;
  /** How much the user already has toward this goal. */
  currentAmount: string;
  currency: CurrencyCode;
  targetDate: string;
  /** Stage 30 (#7) — the monthly contribution the user COMMITS to this goal. Decided
   *  in the post-capacity allocation step (not before), so the user first sees what
   *  they can afford. Reserved by the engine as protected money. Optional. */
  monthlyContribution?: string;
  /** Stage 30 (#8) — free-text "nota para Kipu" persisted to goals.notes. */
  note?: string;
}

/** Stage 30 (#6) — an asset / investment. Symmetric to a debt row but on the other
 *  side of the balance sheet: it NEVER raises the Margen (plata apartada), it builds
 *  patrimonio. Persisted into public.investment_accounts. */
export interface WizardAsset {
  id: string;
  name: string;
  /** Free-form asset class the investment_accounts table stores (investment|property|
   *  vehicle|crypto|receivable|other …). */
  assetClass: string;
  value: string;
  currency: CurrencyCode;
  /** Whether the value is easily convertible to cash. Does NOT make it spendable. */
  liquid: boolean;
  includeInNetWorth: boolean;
  /** Optional expected annual return %. */
  expectedReturn: string;
  /** Stage 30 (#8) — free-text "nota para Kipu" persisted to investment_accounts.notes. */
  note?: string;
}

export interface WizardState {
  profile: { fullName: string; country: string; baseCurrency: CurrencyCode };
  accounts: WizardAccount[];
  incomes: WizardIncome[];
  expenses: WizardExpense[];
  debts: WizardDebt[];
  noDebts: boolean;
  /** Stage 30 (#6) — assets / investments (patrimonio, not spendable). Optional so
   *  restored/older drafts and the dev-gate literals stay valid. */
  assets?: WizardAsset[];
  goals: WizardGoal[];
  reserves: { monthlySavings: string; monthlyInvestment: string };
  /** Per-category variable-spend estimates (comida, transporte…). */
  categoryBudgets: WizardCategoryBudget[];
  /** Currency the category estimates are typed in ("" = base). When it differs
   *  from base, buildOnboardingDraft converts them with the user's fx rate. */
  categoryBudgetCurrency: string;
  prefs: { tone: CoachTone; strictness: CoachStrictnessLevel };
  /** Manual reference rate for multi-currency users, e.g. "1 USD = 1200 ARS". This
   *  stays the canonical field (parseFxRateString reads it); the guided control
   *  (#3) composes it from fxTargetCurrency + fxRateValue via composeFxRateString. */
  fxRate: string;
  /** Stage 30 (#3) — the "1 {base} = ___ {target}" guided FX control's raw pieces.
   *  Optional; when present the UI keeps `fxRate` in sync. */
  fxTargetCurrency?: string;
  fxRateValue?: string;
  note: string;
}

// ── Guided FX (#3): compose the "1 {base} = {value} {target}" string that
// parseFxRateString already understands. NEVER fabricates a rate — returns "" when
// the value is missing/non-positive or the target equals the base, so the honest-FX
// gate still fires. Keeping the canonical shape as the string means every existing
// consumer (parser, save-actions, dev gate) is untouched.
export function composeFxRateString(base: string, target: string | undefined, value: string | undefined): string {
  const b = (base ?? "").trim().toUpperCase();
  const t = (target ?? "").trim().toUpperCase();
  const n = parseMoney(value);
  if (!b || !t || t === b || n === undefined || !(n > 0)) return "";
  return `1 ${b} = ${value!.trim()} ${t}`;
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

// Parse a free-typed rate like "1 USD = 1200 ARS" (or "USD ARS 1200",
// "1 usd = 1.200,50 ars") into { from, to, rate }. Returns undefined if it can't
// find two 3-letter currency codes and a positive number. Never throws.
export function parseFxRateString(raw: string | undefined): { from: CurrencyCode; to: CurrencyCode; rate: number } | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  // Bind each number to the code it precedes, in order: "n1 C1 = n2 C2" means
  // n1 C1 equals n2 C2 → 1 C1 = (n2/n1) C2. This keeps a reversed-but-natural
  // phrasing like "1480 ARS = 1 USD" from inverting the rate.
  const upper = s.toUpperCase();
  const tokenRe = /(-?[0-9][0-9.,]*)?\s*\b([A-Z]{3})\b/g;
  const pairs: { num: number | undefined; code: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(upper)) !== null && pairs.length < 2) {
    const num = m[1] ? parseMoney(m[1]) : undefined;
    pairs.push({ num, code: m[2] });
  }
  if (pairs.length < 2) return undefined;
  const [a, b] = pairs;
  if (a.code === b.code) return undefined;
  // Legacy shape "USD ARS 1200": the rate trails BOTH codes — attach it to the
  // second code when neither code carried a number.
  let trailing: number | undefined;
  if (a.num === undefined && b.num === undefined) {
    const afterCodes = upper.slice(upper.lastIndexOf(b.code) + 3);
    const tm = afterCodes.match(/-?[0-9][0-9.,]*/);
    if (tm) trailing = parseMoney(tm[0]);
  }
  const n1 = a.num !== undefined && a.num > 0 ? a.num : 1;
  const n2 = b.num !== undefined && b.num > 0 ? b.num : trailing !== undefined && trailing > 0 ? trailing : 1;
  const rate = n2 / n1;
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  return { from: a.code as CurrencyCode, to: b.code as CurrencyCode, rate };
}

function trimmed(value: string | undefined): string {
  return (value ?? "").trim();
}

// ── Capacity & allocation view (#7) ──────────────────────────────────────────
// Pure math for the capacity-first flow. `monthlyDisposable` comes from the engine
// (draft-margen-preview → capacity.monthlyDisposableBeforeAllocations); the
// allocation step subtracts what the user is committing (savings + investment +
// per-goal contributions, all live) to show truly-free money as they type. No I/O.

const ALLOCATION_DAYS_PER_MONTH = 30; // mirrors the engine's AVG_DAYS_PER_MONTH

export interface WizardAllocationView {
  /** income − fixed − debt − essentials (from the engine). */
  monthlyDisposable: number;
  savings: number;
  investment: number;
  goals: number;
  /** savings + investment + goals. */
  totalAllocated: number;
  /** disposable − totalAllocated (can be negative → over-allocated). */
  trulyFree: number;
  trulyFreeDaily: number;
  /** True when the user committed more than they can afford this month. */
  overAllocated: boolean;
}

/** Sum of the per-goal monthly contributions currently typed in the wizard. */
export function sumGoalContributions(goals: WizardGoal[]): number {
  return goals.reduce((sum, g) => {
    const n = parseMoney(g.monthlyContribution);
    return sum + (n !== undefined && n > 0 ? n : 0);
  }, 0);
}

/** Build the live allocation view from the disposable figure + current commitments. */
export function computeAllocationView(
  monthlyDisposable: number,
  reserves: { monthlySavings: string; monthlyInvestment: string },
  goals: WizardGoal[],
): WizardAllocationView {
  const savings = Math.max(0, parseMoney(reserves.monthlySavings) ?? 0);
  const investment = Math.max(0, parseMoney(reserves.monthlyInvestment) ?? 0);
  const goalsTotal = sumGoalContributions(goals);
  const totalAllocated = savings + investment + goalsTotal;
  const disposable = Number.isFinite(monthlyDisposable) ? monthlyDisposable : 0;
  const trulyFree = Math.round((disposable - totalAllocated) * 100) / 100;
  return {
    monthlyDisposable: disposable,
    savings,
    investment,
    goals: goalsTotal,
    totalAllocated: Math.round(totalAllocated * 100) / 100,
    trulyFree,
    trulyFreeDaily: Math.round((trulyFree / ALLOCATION_DAYS_PER_MONTH) * 100) / 100,
    overAllocated: totalAllocated > disposable + 0.005,
  };
}

// ── Reviewability mirrors (must match save-actions.ts so the UI's "can finish"
// and progress reflect exactly what will persist) ────────────────────────────

export function accountReviewable(a: WizardAccount): boolean {
  const name = trimmed(a.name);
  return name.length > 0 && name !== "Cuenta";
}

export function incomeReviewable(i: WizardIncome): boolean {
  return parseMoney(i.amount) !== undefined || parseMoney(i.minAmount) !== undefined;
}

// Accept only a real ISO date (YYYY-MM-DD); anything else (e.g. "dic 2026",
// "12/2026") would break the goals.target_date column insert, so drop it.
export function sanitizeIsoDate(value: string | undefined): string | undefined {
  const v = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(v + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? undefined : v;
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

// Qualitative facts the structured contract can't model (investment return
// rates, the user's own FX rate, free-form notes) are persisted as learned
// context notes the agent reads from day one — no schema change needed.
function buildContextNotes(state: WizardState): OnboardingDraft["userContextNotes"] {
  const notes: OnboardingDraft["userContextNotes"] = [];
  const push = (content: string) => {
    const c = content.trim();
    if (c) notes.push({ draftId: `wiz-note-${notes.length}`, content: c, noteType: "general", source: "onboarding", createdAt: "" });
  };
  if (trimmed(state.note)) push(trimmed(state.note));
  if (trimmed(state.fxRate)) push(`Tipo de cambio de referencia del usuario: ${trimmed(state.fxRate)}.`);
  for (const a of state.accounts) {
    if (a.liquidity === "non_liquid" && parseRate(a.returnRate) !== undefined) {
      push(`"${trimmed(a.name) || "Inversión"}" es una inversión/ahorro con rendimiento estimado de ${parseRate(a.returnRate)}% anual.`);
    }
  }
  // Biweekly/weekly anchor: a known payday lets Kipu reason about the next paycheck week.
  for (const i of state.incomes) {
    if ((i.frequency === "biweekly" || i.frequency === "weekly") && sanitizeIsoDate(i.lastPayDate)) {
      push(`El ingreso "${trimmed(i.name) || "Sueldo"}" es ${i.frequency === "biweekly" ? "cada 2 semanas" : "semanal"}; un pago fue el ${sanitizeIsoDate(i.lastPayDate)} (referencia para calcular el próximo).`);
    }
  }
  return notes.slice(0, 20);
}

export function buildOnboardingDraft(state: WizardState): OnboardingDraftV2 {
  const base = state.profile.baseCurrency;
  const debtIds = new Set(state.debts.map((d) => d.id));

  const savings = parseMoney(state.reserves.monthlySavings);
  const investment = parseMoney(state.reserves.monthlyInvestment);
  // Per-category variable estimates are the source of truth; their sum feeds the
  // single essential_monthly_estimate the Margen engine reserves (no double count).
  const fxRate = parseFxRateString(state.fxRate);
  // The founder types "comida" in the currency they actually spend (ARS in BA)
  // while their base is USD: convert each estimate to base with the user's own
  // rate so essential_monthly_estimate and budget_categories stay in base truth.
  const budgetCur = (state.categoryBudgetCurrency || base).toUpperCase();
  const budgetToBase = (amount: number): number | undefined => {
    if (budgetCur === base.toUpperCase()) return amount;
    if (fxRate) {
      if (fxRate.from === budgetCur && fxRate.to === base.toUpperCase()) return Math.round(amount * fxRate.rate * 100) / 100;
      if (fxRate.to === budgetCur && fxRate.from === base.toUpperCase()) return Math.round((amount / fxRate.rate) * 100) / 100;
    }
    return undefined; // no known rate → drop rather than lie
  };
  const categoryBudgets = state.categoryBudgets
    .map((cb) => {
      const raw = parseMoney(cb.amount);
      const converted = raw !== undefined && raw >= 0 ? budgetToBase(raw) : undefined;
      return { category: cb.category, amount: converted };
    })
    .filter((cb): cb is { category: FinancialCategory; amount: number } => cb.amount !== undefined && cb.amount >= 0);
  const essentials = categoryBudgets.length > 0
    ? categoryBudgets.reduce((sum, cb) => sum + cb.amount, 0)
    : undefined;

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
      notes: trimmed(a.note) || undefined,
    })),
    debtAccounts: state.debts.map((d) => {
      // A loan is an amortized fixed cuota (#4): its monthly payment is the source
      // of truth for monthly debt service and has no revolving statement. Fold the
      // loan cuota into currentMonthPayment (→ full_payment_due, which the engine
      // reads as the monthly obligation) and drop the card-only cutoff. Cards keep
      // their statement/cutoff fields untouched.
      const isLoan = d.type === "loan";
      const loanPayment = isLoan ? parseMoney(d.monthlyPayment) : undefined;
      return {
        draftId: d.id,
        name: trimmed(d.name) || undefined,
        type: d.type,
        currency: d.currency,
        totalBalance: parseMoney(d.balance),
        currentMonthPayment: loanPayment ?? parseMoney(d.currentMonthPayment),
        minimumPayment: isLoan ? loanPayment ?? parseMoney(d.minimumPayment) : parseMoney(d.minimumPayment),
        dueDay: parseDay(d.dueDay),
        cutoffDay: isLoan ? undefined : parseDay(d.cutoffDay),
        interestRate: parseRate(d.interestRate),
        defaultPaymentAccountDraftId: d.defaultPaymentAccountId || undefined,
        notes: trimmed(d.note) || undefined,
      };
    }),
    incomeSources: state.incomes.map((i) => {
      const variable = i.isVariable;
      const min = parseMoney(i.minAmount);
      const max = parseMoney(i.maxAmount);
      return {
        draftId: i.id,
        name: trimmed(i.name) || undefined,
        amount: parseMoney(i.amount),
        currency: i.currency,
        frequency: i.frequency,
        expectedDay: parseDay(i.expectedDay),
        payAnchorDate: sanitizeIsoDate(i.lastPayDate),
        isVariable: variable || min !== undefined || max !== undefined,
        minExpectedAmount: variable ? min : undefined,
        maxExpectedAmount: variable ? max : undefined,
        destinationAccountDraftId: i.destinationAccountId || undefined,
      };
    }),
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
        isVariable: Boolean(e.isVariable),
        paymentSourceType: sourceType,
        paymentSourceDraftId: sourceId,
        notes: trimmed(e.note) || undefined,
      };
    }),
    goals: state.goals.map((g) => ({
      draftId: g.id,
      name: trimmed(g.name) || GOAL_DEFAULT_NAME[g.archetype],
      archetype: g.archetype,
      targetAmount: parseMoney(g.targetAmount),
      currentAmount: parseMoney(g.currentAmount),
      currency: g.currency,
      targetDate: sanitizeIsoDate(g.targetDate),
      // Monthly contribution the user committed in the allocation step (#7). Only a
      // positive number reserves money; 0/blank leaves the goal unfunded (no lie).
      monthlyContribution: (() => {
        const n = parseMoney(g.monthlyContribution);
        return n !== undefined && n > 0 ? n : undefined;
      })(),
      notes: trimmed(g.note) || undefined,
    })),
    coachPreferences: {
      tone: state.prefs.tone,
      strictnessLevel: state.prefs.strictness,
    },
    categoryBudgets,
    fxRate,
    userContextNotes: buildContextNotes(state),
    explicitlyEmptySteps: state.noDebts ? ["debt_accounts"] : [],
    assets: (state.assets ?? [])
      .filter((a) => trimmed(a.name).length > 0 || parseMoney(a.value) !== undefined)
      .map((a) => ({
        draftId: a.id,
        name: trimmed(a.name) || undefined,
        assetClass: a.assetClass || "other",
        value: parseMoney(a.value),
        currency: a.currency,
        liquid: Boolean(a.liquid),
        includeInNetWorth: a.includeInNetWorth !== false,
        expectedReturnPct: parseRate(a.expectedReturn),
        notes: trimmed(a.note) || undefined,
      })),
  };
}
