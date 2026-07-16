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
  OnboardingDraftFxRate,
  OnboardingDraftGoal,
  OnboardingDraftSavingsPlan,
  OnboardingGoalArchetype,
} from "./draft-types";
import { GOAL_DEFAULT_NAMES, effectiveEssential } from "./wizard-constants";
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
  /** S31 (5.1c) — ALL manual rates (one per foreign currency), each anchored on the
   *  base. `fxRate` stays the FIRST entry for back-compat; save-actions upserts each. */
  fxRates?: OnboardingDraftFxRate[];
  /** S34 — the raw (unconverted) category estimates + their typed currency, so the
   *  server's honest-FX defense can gate on them when the client couldn't convert
   *  (these were read by save-actions but never emitted — dead defense until now). */
  categoryBudgetCurrency?: string;
  categoryBudgetsRaw?: { category: FinancialCategory; amount: number }[];
  /** S34 — the CLIENT's current month (YYYY-MM-01). budget_categories.seed_month
   *  must anchor to the month the user saw ("¿ya gastaste algo ESTE mes?"), not the
   *  server's UTC month, or an edge-of-month save lands the seed one month off. */
  clientSeedMonth?: string;
  /** Stage H — the browser's IANA timezone. The DB derives the month an objective
   *  version is stamped with (kipu__user_month) and, without this, falls back to
   *  America/Guayaquil: a Buenos Aires user has a two-hour window each month
   *  where their August decision would be recorded against July. Persisted with
   *  the onboarding write so the server's calendar IS the user's from day one. */
  clientTimezone?: string;
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
  /** A2 — OCCASIONAL/windfall income (lands every few months); excluded from the
   *  monthly plan (income_sources.is_occasional). */
  isOccasional?: boolean;
  /** When variable, the user gives a range instead of a fixed amount. */
  minAmount: string;
  maxAmount: string;
  destinationAccountId: string;
  /** S31 (W-P1) — free-text "nota para Kipu" persisted to income_sources.notes. */
  note?: string;
}

/** Variable-spend budget per category (Stage 23), amount as a raw string. */
export interface WizardCategoryBudget {
  category: FinancialCategory;
  amount: string;
  /** Item 2 — each habitual gasto can be in its OWN currency (someone in BA pays
   *  comida in ARS but transporte in USD). Falls back to the legacy per-step
   *  categoryBudgetCurrency, then base, when empty. */
  currency?: CurrencyCode;
  /** S32 — "¿ya gastaste algo de esto este mes?" (optional, same currency as the
   *  estimate). Only meaningful when the estimate has an amount — a seed without
   *  an estimate is ignored (nothing to track it against). */
  mtdSeed?: string;
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
  /** S32 (Item C) — for weekly/biweekly expenses: a known payment date (ISO) that
   *  anchors the 7/14-day cadence (mirrors WizardIncome.lastPayDate). Optional so
   *  pre-existing literals and restored drafts stay valid. */
  payAnchorDate?: string;
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

// O2.1 — reserves are CARDS like every other step (kind + amount + currency),
// added/removed via "+ Agregar". A reserve is a monthly FLOW you protect
// (ahorro/inversión), not a stock. Totals feed the allocation view by kind.
export type WizardReserveKind = "savings" | "investment";
export interface WizardReserve {
  id: string;
  kind: WizardReserveKind;
  amount: string;
  currency: CurrencyCode;
  // Stage 38 — reserves are scheduled like income/gastos/deudas: cadence + day +
  // where the money is stored, so the financial calendar reserves the contribution
  // on its real date. All optional so restored/older drafts + dev-gate literals stay
  // valid (absent ⇒ monthly, no fixed day, default destination).
  frequency?: PaymentFrequency;
  /** Day of the month (1–31) the reserve is set aside (monthly/yearly). */
  expectedDay?: string;
  /** A known date (ISO) anchoring a weekly/biweekly cadence (mirrors income lastPayDate). */
  payAnchorDate?: string;
  /** Where the reserve lands: draft id of a WizardAccount OR WizardAsset (asset id). */
  destinationId?: string;
  /** For an INVESTMENT reserve: draft id of the cash account it is funded FROM, so confirming the
   *  monthly contribution moves money (account ↓ + destination asset ↑), net-worth-neutral. */
  sourceId?: string;
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
  /** O2.1 — savings/investment reserve cards (kind + amount + currency). */
  reserves: WizardReserve[];
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
   *  Optional; when present the UI keeps `fxRate` in sync (mirrors fxEntries[0]). */
  fxTargetCurrency?: string;
  fxRateValue?: string;
  /** S31 (5.1c) — MULTI-rate guided FX: one raw "1 {base} = {value} {target}" entry
   *  per foreign currency. The UI renders one FxGuidedField per missing currency and
   *  keeps the legacy single-pair fields mirroring entry 0. */
  fxEntries?: { target: string; value: string }[];
  note: string;
}

// ── Guided FX (#3 / S31 5.1a-b) ───────────────────────────────────────────────

/**
 * STRICT parser for the guided FX control's rate value. An FX rate is a plain
 * decimal number, NOT money: "0.00072" must be 0.00072 (parseMoney would read 72),
 * a single comma is the decimal separator ("0,00072"), and ANY other character —
 * spaces inside, letters, grouping — is rejected instead of silently reinterpreted
 * ("1 480" → undefined, never 480; "1480 pesos" → undefined, never 1). Only a
 * positive finite number passes; the echo line then shows exactly what was parsed.
 */
export function parseFxRateValue(raw: string | undefined | null): number | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  if (!/^[0-9]+([.,][0-9]+)?$/.test(s)) return undefined;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// Compose the "1 {base} = {rate} {target}" string that parseFxRateString already
// understands. S31 (5.1a): the embedded rate is String(parsedNumber) — NEVER the
// raw text — so compose→parse always round-trips ("1 480" can no longer become a
// 480 rate). NEVER fabricates a rate — returns "" when the value is missing/invalid
// or the target equals the base, so the honest-FX gate still fires.
export function composeFxRateString(base: string, target: string | undefined, value: string | undefined): string {
  const b = (base ?? "").trim().toUpperCase();
  const t = (target ?? "").trim().toUpperCase();
  const n = parseFxRateValue(value);
  if (!b || !t || t === b || n === undefined) return "";
  return `1 ${b} = ${String(n)} ${t}`;
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

// S31 (1.4) — loan installments count ("cuotas que faltan"): any positive whole
// number (24, 360…), unlike parseDay's 1–31 clamp.
export function parsePositiveInt(raw: string | undefined): number | undefined {
  const n = Number(String(raw ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 1200 ? n : undefined;
}

// A number INSIDE an fx-rate string. Mostly parseMoney (LatAm grouping like
// "1.200,50" keeps working), but micro-rates are unambiguous decimals that
// parseMoney would destroy: "0.00072" (leading zero) or "1.0005" (≥4 fraction
// digits) can only be decimals, never grouping — parse them strictly (S31 5.1b).
function parseFxRateNumber(token: string): number | undefined {
  const s = token.trim();
  if (/^-?0[.,][0-9]+$/.test(s) || /^-?[0-9]+[.,][0-9]{4,}$/.test(s)) {
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }
  return parseMoney(s);
}

// Parse a free-typed rate like "1 USD = 1200 ARS" (or "USD ARS 1200",
// "1 usd = 1.200,50 ars", "1 ARS = 0.00072 USD") into { from, to, rate }. Returns
// undefined if it can't find two 3-letter currency codes and a positive number.
// Never throws.
export function parseFxRateString(raw: string | undefined): { from: CurrencyCode; to: CurrencyCode; rate: number } | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  // S34 — digits split by a space ("1 480") are ambiguous: reading them as two
  // numbers silently produced a 3x-wrong rate. The guided control already rejects
  // this; the legacy free-text path must too (reject, never reinterpret).
  if (/\d[ \u00a0]+\d/.test(s)) return undefined;
  // Bind each number to the code it precedes, in order: "n1 C1 = n2 C2" means
  // n1 C1 equals n2 C2 → 1 C1 = (n2/n1) C2. This keeps a reversed-but-natural
  // phrasing like "1480 ARS = 1 USD" from inverting the rate.
  const upper = s.toUpperCase();
  const tokenRe = /(-?[0-9][0-9.,]*)?\s*\b([A-Z]{3})\b/g;
  const pairs: { num: number | undefined; code: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(upper)) !== null && pairs.length < 2) {
    const num = m[1] ? parseFxRateNumber(m[1]) : undefined;
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
    if (tm) trailing = parseFxRateNumber(tm[0]);
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

// ── S31 (5.1c/d/f) — multi-rate collection + the client FX gate ───────────────

/** A known rate as the wizard consumes it (server-loaded fx_rates or wizard-typed). */
export interface WizardFxRateLite {
  from: string;
  to: string;
  rate: number;
}

/**
 * All manual rates the wizard currently holds, canonicalized. fxEntries (one per
 * foreign currency, always base-anchored) win; the legacy single `fxRate` string
 * is the fallback for restored pre-S31 drafts. Never fabricates: an entry with an
 * unparseable value is skipped, duplicates keep the first.
 */
export function collectWizardFxRates(state: WizardState): OnboardingDraftFxRate[] {
  const base = state.profile.baseCurrency;
  const baseUpper = (base ?? "").trim().toUpperCase();
  const out: OnboardingDraftFxRate[] = [];
  const seen = new Set<string>();
  for (const e of state.fxEntries ?? []) {
    const t = (e.target ?? "").trim().toUpperCase();
    const n = parseFxRateValue(e.value);
    if (!t || t === baseUpper || n === undefined || seen.has(t)) continue;
    seen.add(t);
    out.push({ from: base, to: t as CurrencyCode, rate: n });
  }
  if (out.length === 0) {
    const legacy = parseFxRateString(state.fxRate);
    if (legacy) out.push(legacy);
  }
  return out;
}

/**
 * The client mirror of save-actions' honest-FX gate. A currency counts as USED
 * only when a row that will actually persist carries a PARSEABLE amount in it
 * (5.1d — an amount-less foreign row must not block Confirmar). Coverage comes
 * from the base itself, every wizard-typed rate, and the server-loaded rates the
 * page passes down (5.1f — a rate set earlier via chat must not re-block). A pair
 * covers a currency when it connects it to the base in EITHER direction (the fx
 * engine inverts known rates; it never triangulates).
 */
export function wizardFxMissing(state: WizardState, knownRates: WizardFxRateLite[] = []): string[] {
  const base = (state.profile.baseCurrency ?? "").trim().toUpperCase();
  const used = new Set<string>();
  const markUsed = (currency: string | undefined, hasAmount: boolean) => {
    if (hasAmount) used.add((currency || base).trim().toUpperCase());
  };
  for (const a of state.accounts) markUsed(a.currency, accountReviewable(a) && parseMoney(a.balance) !== undefined);
  for (const d of state.debts) {
    const hasAmount =
      parseMoney(d.balance) !== undefined ||
      parseMoney(d.minimumPayment) !== undefined ||
      parseMoney(d.currentMonthPayment) !== undefined ||
      (d.type === "loan" && parseMoney(d.monthlyPayment) !== undefined);
    markUsed(d.currency, debtReviewable(d) && hasAmount);
  }
  for (const i of state.incomes) markUsed(i.currency, incomeReviewable(i));
  for (const e of state.expenses) markUsed(e.currency, expenseReviewable(e));
  for (const g of state.goals) {
    markUsed(g.currency, goalReviewable(g) && (parseMoney(g.targetAmount) !== undefined || parseMoney(g.currentAmount) !== undefined));
  }
  for (const a of state.assets ?? []) markUsed(a.currency, parseMoney(a.value) !== undefined);
  // Item 2 — each habitual budget can be in its OWN currency; flag every used currency
  // (per-row, falling back to the legacy per-step categoryBudgetCurrency, then base).
  for (const cb of state.categoryBudgets) {
    markUsed(cb.currency || state.categoryBudgetCurrency, (parseMoney(cb.amount) ?? 0) > 0);
  }
  const covered = new Set<string>([base]);
  const cover = (r: WizardFxRateLite) => {
    if (!(r.rate > 0)) return;
    const pair = [(r.from ?? "").trim().toUpperCase(), (r.to ?? "").trim().toUpperCase()];
    if (pair.includes(base)) pair.forEach((c) => covered.add(c));
  };
  collectWizardFxRates(state).forEach(cover);
  knownRates.forEach(cover);
  return [...used].filter((c) => !covered.has(c));
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

/** Sum of the per-goal monthly contributions currently typed in the wizard.
 *  S31 (5.12): only goals that will actually PERSIST count — a contribution typed
 *  against a goal save-actions drops must never inflate the allocation math. */
export function sumGoalContributions(goals: WizardGoal[]): number {
  return goals.reduce((sum, g) => {
    if (!goalReviewable(g)) return sum;
    const n = parseMoney(g.monthlyContribution);
    return sum + (n !== undefined && n > 0 ? n : 0);
  }, 0);
}

/** Stage 38 — monthly-equivalent multiplier for a reserve's cadence (mirrors
 *  margen-kipu's monthlyEquivalent). A weekly 500 reserve is ~2166/month; the live
 *  allocation view + the aggregate commitment must reason in the same monthly terms. */
export function reserveMonthlyMultiplier(freq: PaymentFrequency | undefined): number {
  switch (freq) {
    case "weekly":
      return 30 / 7;
    case "biweekly":
      return 15 / 7;
    case "yearly":
      return 1 / 12;
    case "monthly":
    case "custom":
    default:
      return 1;
  }
}

/** O2.1 — sum the reserve cards by kind, each converted to base with the user's
 *  own rate (never invents one — a reserve whose currency has no known rate is
 *  dropped, mirroring budgetToBase) and weighted to its MONTHLY-equivalent by cadence
 *  (Stage 38). Returns base-currency monthly totals that feed the live allocation
 *  view and the aggregate savings/investment commitment. */
export function sumReservesByKind(
  reserves: WizardReserve[],
  toBase: (amount: number, currency: string) => number | undefined,
): { monthlySavings: number; monthlyInvestment: number } {
  let monthlySavings = 0;
  let monthlyInvestment = 0;
  for (const r of reserves) {
    const raw = parseMoney(r.amount);
    if (raw === undefined || raw <= 0) continue;
    const inBase = toBase(raw, r.currency);
    if (inBase === undefined) continue;
    const monthly = inBase * reserveMonthlyMultiplier(r.frequency);
    if (r.kind === "investment") monthlyInvestment += monthly;
    else monthlySavings += monthly;
  }
  return {
    monthlySavings: Math.round(monthlySavings * 100) / 100,
    monthlyInvestment: Math.round(monthlyInvestment * 100) / 100,
  };
}

/** Build the live allocation view from the disposable figure + current commitments.
 *  Reserves arrive already summed to base (via sumReservesByKind) — goals are still
 *  summed here since their contributions are stored in base. */
export function computeAllocationView(
  monthlyDisposable: number,
  reserves: { monthlySavings: number; monthlyInvestment: number },
  goals: WizardGoal[],
): WizardAllocationView {
  const savings = Math.max(0, reserves.monthlySavings);
  const investment = Math.max(0, reserves.monthlyInvestment);
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

// O3 — three-state health of the day-to-day leftover (what survives after reserves
// and goals), so the UI can warn BEFORE it goes negative instead of jumping straight
// from "buen balance" to red. `leftover` is trulyFree; `disposable` is the pool it's
// carved from. Purely for display — no money moves on this.
export type LeftoverTone = "over" | "tight" | "ok";
const TIGHT_LEFTOVER_FRACTION = 0.12; // < 12% of the disposable left for día a día → amber

export function leftoverTone(leftover: number, disposable: number): LeftoverTone {
  if (leftover < -0.005) return "over";
  if (disposable > 0 && leftover < TIGHT_LEFTOVER_FRACTION * disposable) return "tight";
  return "ok";
}

// O11 (1+4) — the BALANCE SHEET, separate from the monthly cashflow: net worth =
// what you have (account balances + assets) − what you owe (debt balances). A pure
// STOCK snapshot; nothing here touches the month. Foreign amounts convert to base
// with the user's own rate (unknown rate → dropped, never invented).
export interface DraftNetWorth {
  tienes: number; // account balances + asset values, in base
  debes: number; // debt balances, in base
  neto: number; // tienes − debes
}

export function computeDraftNetWorth(
  state: WizardState,
  toBase: (amount: number, currency: string) => number | undefined,
): DraftNetWorth {
  const sum = (rows: { amount: string; currency: string }[]): number => {
    let total = 0;
    for (const r of rows) {
      const v = parseMoney(r.amount);
      if (v === undefined) continue;
      const b = toBase(v, r.currency);
      if (b !== undefined) total += b;
    }
    return total;
  };
  const accounts = sum(state.accounts.map((a) => ({ amount: a.balance, currency: a.currency })));
  const assets = sum(
    (state.assets ?? [])
      .filter((a) => a.includeInNetWorth !== false)
      .map((a) => ({ amount: a.value, currency: a.currency })),
  );
  const debes = sum(state.debts.map((d) => ({ amount: d.balance, currency: d.currency })));
  const round = (n: number) => Math.round(n * 100) / 100;
  const tienes = round(accounts + assets);
  return { tienes, debes: round(debes), neto: round(tienes - round(debes)) };
}

// ── Reviewability mirrors (must match save-actions.ts so the UI's "can finish"
// and progress reflect exactly what will persist) ────────────────────────────

export function accountReviewable(a: WizardAccount): boolean {
  const name = trimmed(a.name);
  return name.length > 0 && name !== "Cuenta";
}

export function incomeReviewable(i: WizardIncome): boolean {
  // Mirrors save-actions isReviewableIncome on the DRAFT the builder emits: the
  // draft only carries min/max when the "varía" toggle is ON (5.6 authoritative),
  // so a min typed while the toggle is OFF must not count here either (4.8).
  return parseMoney(i.amount) !== undefined || (i.isVariable && parseMoney(i.minAmount) !== undefined);
}

// Accept only a real ISO date (YYYY-MM-DD); anything else (e.g. "dic 2026",
// "12/2026") would break the goals.target_date column insert, so drop it.
export function sanitizeIsoDate(value: string | undefined): string | undefined {
  const v = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(v + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? undefined : v;
}

// S32 — first day of `now`'s calendar month, ISO. ONE truth for the
// budget_categories.seed_month stamp (save-actions) and the preview's seed
// anchoring (draft-margen-preview), so review and dashboard read the same month.
export function seedMonthISO(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

// Browser and server share the same strict timezone validation. A shape regex
// is insufficient: it rejects valid zones such as UTC and accepts invented ones
// such as Foo/Bar, which PostgreSQL then cannot use reliably at a month edge.
// Intl is the runtime's IANA authority and canonicalizes aliases for storage.
export function normalizeIanaTimezone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 100) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: candidate })
      .resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

export function expenseReviewable(e: WizardExpense): boolean {
  // S34 — a fixed expense needs a POSITIVE amount: a zero/negative row would
  // persist but be invisible to every engine (captured-but-never-consumed).
  const n = parseMoney(e.amount);
  return n !== undefined && n > 0;
}

export function debtReviewable(d: WizardDebt): boolean {
  const name = trimmed(d.name);
  const hasName = name.length > 0 && name !== "Deuda";
  // Mirrors save-actions debtHasAmount 1:1 on what the draft builder emits (4.8):
  // totalBalance ← balance, minimumPayment ← min (or loan cuota), and
  // currentMonthPayment ← "a pagar este mes" / loan cuota.
  const hasAmount =
    parseMoney(d.balance) !== undefined ||
    parseMoney(d.minimumPayment) !== undefined ||
    parseMoney(d.currentMonthPayment) !== undefined ||
    (d.type === "loan" && parseMoney(d.monthlyPayment) !== undefined);
  return hasName || hasAmount;
}

export function goalReviewable(g: WizardGoal): boolean {
  // Mirrors save-actions isReviewableGoal on the EFFECTIVE name the draft builder
  // emits (an empty wizard name becomes the archetype default), so this predicate
  // and the server keep/drop exactly the same rows (4.8).
  const name = trimmed(g.name) || GOAL_DEFAULT_NAMES[g.archetype];
  const amount = parseMoney(g.targetAmount);
  if (name === GOAL_DEFAULT_NAMES.other && amount === undefined) return false;
  if (isDebtPayoffGoalWithoutAmount(name, amount)) return false;
  const hasRealName = Boolean(name && name !== GOAL_DEFAULT_NAMES.other);
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
  if (reviewableGoals === 0) missing.push("Elige al menos una meta — «Solo ordenar mi mes» también cuenta.");
  return {
    reviewableAccounts,
    reviewableGoals,
    canFinish: reviewableAccounts > 0 && reviewableGoals > 0,
    missing,
  };
}

// ── Draft builder: WizardState → canonical OnboardingDraft ────────────────────
// (Goal default names live in wizard-constants.GOAL_DEFAULT_NAMES — one map for
// the builder, the review screen, and the reviewability mirror. S31 4.7.)

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
  // FX notes: guided entries produce one CANONICAL note per rate (what was parsed,
  // never the raw text — S31 5.1a); a restored legacy draft keeps its raw string.
  const entriesBased = (state.fxEntries ?? []).some(
    (e) => trimmed(e.target).length > 0 && parseFxRateValue(e.value) !== undefined,
  );
  if (entriesBased) {
    for (const r of collectWizardFxRates(state)) {
      push(`Tipo de cambio de referencia del usuario: 1 ${r.from} = ${r.rate} ${r.to}.`);
    }
  } else if (trimmed(state.fxRate)) {
    push(`Tipo de cambio de referencia del usuario: ${trimmed(state.fxRate)}.`);
  }
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

export function buildOnboardingDraft(
  state: WizardState,
  // S34 — server-known rates (fx_rates set via chat / a prior save). The FX gate
  // already honors them (5.1f), so the conversions here must too — otherwise an
  // estimate in a server-covered currency passes the gate but drops silently.
  knownRates: WizardFxRateLite[] = [],
): OnboardingDraftV2 {
  const base = state.profile.baseCurrency;
  const debtIds = new Set(state.debts.map((d) => d.id));

  // Per-category variable estimates are the source of truth; their sum feeds the
  // single essential_monthly_estimate the Margen engine reserves (no double count).
  // S31 (5.1c): ALL wizard rates, base-anchored; fxRate stays entry 0 (back-compat).
  const fxRates = collectWizardFxRates(state);
  // The founder types "comida" in the currency they actually spend (ARS in BA)
  // while their base is USD: convert each estimate to base with the user's own
  // rate so essential_monthly_estimate and budget_categories stay in base truth.
  // Wizard-typed rates first; server-known rates cover the rest (S34).
  const conversionRates: WizardFxRateLite[] = [
    ...fxRates,
    ...knownRates.map((r) => ({ from: (r.from ?? "").toUpperCase(), to: (r.to ?? "").toUpperCase(), rate: r.rate })),
  ];
  // O2.1 — reserve cards can be in any declared currency; convert each to base
  // with the user's own rate (never invents one) before summing by kind.
  const reserveToBase = (amount: number, currency: string): number | undefined => {
    const c = (currency ?? "").trim().toUpperCase();
    if (!c || c === base.toUpperCase()) return amount;
    for (const fxRate of conversionRates) {
      if (!(fxRate.rate > 0)) continue;
      if (fxRate.from === c && fxRate.to === base.toUpperCase()) return Math.round(amount * fxRate.rate * 100) / 100;
      if (fxRate.to === c && fxRate.from === base.toUpperCase()) return Math.round((amount / fxRate.rate) * 100) / 100;
    }
    return undefined; // no known rate → drop rather than lie
  };
  const reserveTotals = sumReservesByKind(state.reserves, reserveToBase);
  const savings = reserveTotals.monthlySavings > 0 ? reserveTotals.monthlySavings : undefined;
  const investment = reserveTotals.monthlyInvestment > 0 ? reserveTotals.monthlyInvestment : undefined;
  // Stage 38 — each reserve card also becomes a scheduled savings_plan. `amount` is the
  // PER-OCCURRENCE amount in base (not monthly-equivalent — the calendar dates each
  // occurrence itself); the monthly-equivalent already lives in profile.monthly* above,
  // so capacity and the per-plan calendar describe the same money without double count.
  // A reserve whose currency has no known rate is dropped (same as the sum), never lied.
  const savingsPlans: OnboardingDraftSavingsPlan[] = state.reserves
    .map((r): OnboardingDraftSavingsPlan | null => {
      const raw = parseMoney(r.amount);
      if (raw === undefined || raw <= 0) return null;
      const amountBase = reserveToBase(raw, r.currency);
      if (amountBase === undefined || amountBase <= 0) return null;
      const day = parseDay(r.expectedDay);
      const anchor = sanitizeIsoDate(r.payAnchorDate);
      return {
        draftId: r.id,
        kind: r.kind,
        amount: amountBase,
        originalAmount: raw,
        originalCurrency: r.currency,
        frequency: r.frequency ?? "monthly",
        ...(day !== undefined ? { expectedDay: day } : {}),
        ...(anchor ? { payAnchorDate: anchor } : {}),
        ...(r.destinationId ? { destinationDraftId: r.destinationId } : {}),
        // Only an investment reserve funds FROM a cash account (savings just reserves).
        ...(r.kind === "investment" && r.sourceId ? { sourceDraftId: r.sourceId } : {}),
      };
    })
    .filter((p): p is OnboardingDraftSavingsPlan => p !== null);
  const budgetCur = (state.categoryBudgetCurrency || base).toUpperCase();
  // Item 2 — each habitual budget converts with ITS OWN currency (per-row), falling
  // back to the legacy per-step categoryBudgetCurrency, then base. reserveToBase drops
  // a row whose currency has no known rate rather than converting at a lie (the client
  // FX gate re-asks). budgetCur remains only the draft's legacy currency hint below.
  const baseUpperCur = base.toUpperCase();
  const categoryBudgets = state.categoryBudgets
    .map((cb) => {
      const cur = (cb.currency || state.categoryBudgetCurrency || base).toUpperCase();
      const raw = parseMoney(cb.amount);
      const converted = raw !== undefined && raw >= 0 ? reserveToBase(raw, cur) : undefined;
      // S32 — the month-to-date seed converts with the SAME rate as the estimate;
      // it is a FROZEN base snapshot (actual spend), not re-floated. No estimate
      // amount → the whole row (seed included) is dropped below.
      const rawSeed = parseMoney(cb.mtdSeed);
      const seed =
        converted !== undefined && rawSeed !== undefined && rawSeed > 0
          ? reserveToBase(rawSeed, cur)
          : undefined;
      return { category: cb.category, amount: converted, native: raw, currency: cur, mtdSeed: seed };
    })
    .filter(
      (cb): cb is { category: FinancialCategory; amount: number; native: number | undefined; currency: string; mtdSeed: number | undefined } =>
        cb.amount !== undefined && cb.amount >= 0,
    )
    // Carry the NATIVE amount + currency so persistence stores a live-converting row
    // (only when the user's currency differs from base — a base-currency budget already
    // IS native, and omitting the pair keeps toBase() a no-op on it).
    .map((cb) => ({
      category: cb.category,
      amount: cb.amount,
      ...(cb.native !== undefined && cb.currency !== baseUpperCur
        ? { originalAmount: cb.native, originalCurrency: cb.currency as CurrencyCode }
        : {}),
      ...(cb.mtdSeed !== undefined ? { mtdSeed: cb.mtdSeed } : {}),
    }));
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
        // S31 (1.4) — loan installments reach the save so it can persist the
        // "le faltan N cuotas — terminaría aprox. {mes/año}" context note.
        installmentsRemaining: isLoan ? parsePositiveInt(d.installmentsRemaining) : undefined,
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
        // S31 (5.6) — the toggle is AUTHORITATIVE: toggled off means fixed, even if
        // stale min/max text lingers in local state (the UI also clears it).
        isVariable: variable,
        isOccasional: Boolean(i.isOccasional),
        minExpectedAmount: variable ? min : undefined,
        maxExpectedAmount: variable ? max : undefined,
        destinationAccountDraftId: i.destinationAccountId || undefined,
        notes: trimmed(i.note) || undefined,
      };
    }),
    fixedExpenses: state.expenses.map((e) => {
      const sourceId = e.paymentSourceId || undefined;
      const sourceType = sourceId ? (debtIds.has(sourceId) ? "debt_account" : "account") : undefined;
      // S32 (Item C) — the pay anchor only makes sense for a 7/14-day cadence;
      // monthly/yearly keep their "día del mes" shape untouched.
      const anchored = e.frequency === "weekly" || e.frequency === "biweekly";
      // S34 — mirror expenseReviewable: only a positive amount persists.
      const amountValue = parseMoney(e.amount);
      return {
        draftId: e.id,
        name: trimmed(e.name) || undefined,
        amount: amountValue !== undefined && amountValue > 0 ? amountValue : undefined,
        currency: e.currency,
        category: e.category,
        frequency: e.frequency,
        expectedDay: parseDay(e.expectedDay),
        payAnchorDate: anchored ? sanitizeIsoDate(e.payAnchorDate) : undefined,
        // O1 (#3) — essential-by-definition categories are always essential; the
        // rest respect the row's toggle (default not-essential). One source of
        // truth so preview, review and save agree.
        isEssential: effectiveEssential(e.category, e.isEssential),
        isVariable: Boolean(e.isVariable),
        paymentSourceType: sourceType,
        paymentSourceDraftId: sourceId,
        notes: trimmed(e.note) || undefined,
      };
    }),
    goals: state.goals.map((g) => ({
      draftId: g.id,
      name: trimmed(g.name) || GOAL_DEFAULT_NAMES[g.archetype],
      archetype: g.archetype,
      targetAmount: parseMoney(g.targetAmount),
      currentAmount: parseMoney(g.currentAmount),
      currency: g.currency,
      targetDate: sanitizeIsoDate(g.targetDate),
      // Monthly contribution the user committed in the allocation step (#7). Only a
      // positive number reserves money; 0/blank leaves the goal unfunded (no lie).
      // S31 (5.12): a goal save-actions will drop must not carry a contribution —
      // otherwise the preview reserves money the engine never will.
      monthlyContribution: (() => {
        if (!goalReviewable(g)) return undefined;
        // S34 — an ACHIEVED goal (llevas ya ≥ objetivo) must not keep reserving a
        // stale monthly contribution forever; nothing remains to fund.
        const target = parseMoney(g.targetAmount);
        const current = parseMoney(g.currentAmount);
        if (target !== undefined && target > 0 && current !== undefined && current >= target) return undefined;
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
    // Stage 38 — reserves as scheduled, account-linked plans → savings_plans.
    savingsPlans,
    // S34 — raw estimates + typed currency travel too, so save-actions' honest-FX
    // defense can gate on them when conversion wasn't possible client-side (these
    // were read server-side but never emitted — an unreachable defense until now).
    categoryBudgetCurrency: budgetCur !== base.toUpperCase() ? budgetCur : undefined,
    categoryBudgetsRaw:
      budgetCur !== base.toUpperCase()
        ? state.categoryBudgets
            .map((cb) => ({ category: cb.category, amount: parseMoney(cb.amount) }))
            .filter((cb): cb is { category: FinancialCategory; amount: number } => cb.amount !== undefined && cb.amount > 0)
        : undefined,
    fxRate: fxRates[0],
    fxRates,
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
