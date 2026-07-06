import type {
  Account,
  DebtAccount,
  FixedExpense,
  IncomeSource,
  PaymentFrequency,
} from "@/types/financial";
import { sumLiquidSpendable } from "@/lib/financial/liquidity";
import { roundMoney } from "@/lib/financial/money";
import { buildFinancialCalendar, type SavingsPlanCalendarInput } from "@/lib/financial/financial-calendar";
import { projectCashflow, type CashflowConfidenceInput } from "@/lib/financial/cashflow-projection";
import { cardCyclePhaseFor } from "@/lib/financial/card-cycle";

// Margen Kipu v2 (Stage 30) — the user's REAL safe spending margin, calendar-aware.
//
// Not the bank balance. Not liquid cash. It is what the user can spend freely
// this week/today WITHOUT breaking their month or eating their protected money
// (savings / investment / goals), given the FULL cash-flow calendar: income on
// its real dates, fixed expenses and loan payments on their due days, credit-card
// STATEMENTS on their due dates (only what's actually pending — a running balance
// that hasn't closed is future debt, not today's problem), and a continuous
// essential burn.
//
// The old engine collapsed the horizon to "days until the next of N paychecks"
// and then treated the WHOLE liquid balance as this-week-spendable — so a user
// with a healthy buffer and a late paycheck saw an absurd weekly margin. v2 fixes
// this two ways:
//   1. It projects a full ~30-day cycle (financial-calendar / cashflow-projection,
//      the same S15 day-by-day engine) with full monthly protection reserved, and
//      reads the timing-aware safe daily spend (min_d (balance[d]-floor)/(d+1)).
//   2. It caps that by the SUSTAINABLE flow rate — capacity.monthlyTrulyFree / 30 —
//      so a fat liquid buffer never inflates the number above what the month can
//      actually sustain. margenDaily = min(flowDaily, projectionSafeDaily).
//
// Kipu communicates only the simple weekly / daily slice — never the breakdown
// unless the user asks. Deterministic; honest; no fake precision.

const AVG_DAYS_PER_MONTH = 30;
const WEEKS_PER_MONTH = AVG_DAYS_PER_MONTH / 7;

export interface ScheduledPaymentLite {
  amountBase: number;
  dueDate: string; // ISO date
}

export interface MargenKipuInput {
  accounts: Account[];
  debtAccounts: DebtAccount[];
  fixedExpenses: FixedExpense[];
  scheduledPayments: ScheduledPaymentLite[];
  incomeSources: IncomeSource[];
  /** Monthly essential variable spending (food, transport, groceries…). A
   *  learned hypothesis, not a hard truth. 0 when the user hasn't told us yet. */
  monthlyEssentialEstimate: number;
  /** Protected goal contribution per week (already reserved for the goal). */
  weeklyGoalContribution: number;
  monthlySavingsCommitment: number;
  monthlyInvestmentCommitment: number;
  // Stage 38 — explicit per-reserve schedules (ahorro/inversión with cadence + day).
  // When present they drive the calendar's savings/investment reservations on their
  // real dates; the scalar commitments above still drive CAPACITY (monthly-equivalent),
  // so the two describe the same money without double-counting.
  savingsPlans?: SavingsPlanCalendarInput[];
  baseCurrency: string;
  now?: Date;
  // Stage 32 — remaining-based two-phase essential burn (budget-category users;
  // fed by coaching-signals from computeBudgetProgress). Threaded straight into
  // the day-by-day projection: current-month days burn what REMAINS of the
  // month's budgets, next-month days burn the full monthly rate. CAPACITY stays
  // monthly (a monthly rate is month-agnostic) — only the projection changes.
  // Absent ⇒ flat legacy burn (lump-estimate users unchanged).
  remainingEssentialThisMonth?: number;
  daysLeftInMonth?: number;
}

export interface MargenKipuBreakdown {
  liquidCash: number;
  reservedFixed: number;
  reservedScheduled: number;
  reservedDebt: number;
  reservedEssentials: number;
  reservedSavings: number;
  reservedInvestment: number;
  reservedGoal: number;
  totalReserved: number;
}

// Stage 30 — the capacity picture (capacity-first onboarding + scenarios need this).
// Monthly, base currency. `monthlyDisposableBeforeAllocations` = income − fixed −
// debt service − essentials; `monthlyTrulyFree` = that − protected (savings +
// investment + goals). For the founder: disposable ≈ 1,627; trulyFree ≈ 627.
export interface MargenCapacity {
  monthlyIncome: number;
  monthlyFixed: number;
  monthlyDebtService: number;
  monthlyEssentials: number;
  monthlyDisposableBeforeAllocations: number;
  monthlyProtected: { savings: number; investment: number; goals: number };
  monthlyTrulyFree: number;
}

// How trustworthy the safe-spend number is. Kipu must NEVER present a spendable
// figure as solid when it knows the data is weak — it flags it honestly instead
// of fake-lowering the number. Populated by the code path that builds the result
// (coaching-signals threads in the spend/income/staleness signals).
export type MargenConfidence = "solid" | "estimated" | "preliminary";

export type MarginGapCode =
  | "no_income"
  | "no_income_date"
  | "essentials_unknown"
  | "stale_data"
  | "unconverted_currency"
  | "card_confirm";

export interface MarginGap {
  code: MarginGapCode;
  /** Short, warm LatAm Spanish. e.g. "aún no conozco tu gasto diario". */
  label: string;
}

export interface MargenKipuResult {
  /** Safe to spend for the rest of THIS week (today → Sunday). The headline. */
  margenWeekly: number;
  /** Safe per-day pace (the sustainable, timing-aware daily discretionary spend). */
  margenDaily: number;
  /** Total free discretionary money across the projected cycle. */
  safeToSpendUntilIncome: number;
  horizonDays: number;
  daysRemainingInWeek: number;
  nextIncomeDate: string | null;
  nextIncomeAmount: number;
  status: "healthy" | "tight" | "negative";
  liquidCash: number;
  breakdown: MargenKipuBreakdown;
  // Stage 30 — the monthly capacity picture (see MargenCapacity). Always present.
  capacity: MargenCapacity;
  baseCurrency: string;
  // ── Confidence contract (Stage 29 money-truth pass — preserved in v2) ─────────
  // How much the safe-spend number can be trusted. Never fake-lower the figure;
  // flag it and let the UI/chat offer an action. The pure engine sets honest
  // defaults from what IT can see (income + currency conversions); the builder
  // in coaching-signals enriches `essentialsKnown` / `dataAgeDays` and finalizes
  // `confidence` + `marginGaps` with the spend-history and staleness signals.
  confidence: MargenConfidence;
  /** true when we can honestly estimate the user's essential burn (configured
   *  essential estimate / active budget categories, or enough spend history). */
  essentialsKnown: boolean;
  /** Days since the last logged movement; null = never logged. */
  dataAgeDays: number | null;
  marginGaps: MarginGap[];
  // Stage 30 — a credit card with a large, unconfirmable pending statement the
  // user should confirm (paid or not). Advisory only; never blocks the number.
  cardsToConfirm: { name: string; amount: number }[];
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Monthly-equivalent of a recurring amount at a given cadence (base currency).
function monthlyEquivalent(amount: number, frequency: PaymentFrequency): number {
  if (!(amount > 0)) return 0;
  switch (frequency) {
    case "weekly":
      return amount * WEEKS_PER_MONTH;
    case "biweekly":
      return amount * (WEEKS_PER_MONTH / 2);
    case "monthly":
      return amount;
    case "yearly":
      return amount / 12;
    case "custom":
    default:
      return amount; // best-effort: treat unknown cadence as monthly
  }
}

// Total expected monthly income across active sources (conservative for variable
// sources: use the minimum expected when present). Yearly income is annualized.
function monthlyIncomeTotal(sources: IncomeSource[]): number {
  return sources.reduce((total, s) => {
    if (s.status !== "active") return total;
    const amount = s.isVariable && s.minExpectedAmount != null ? s.minExpectedAmount : s.amount;
    if (!(amount > 0)) return total;
    return total + monthlyEquivalent(amount, s.frequency);
  }, 0);
}

// Total monthly fixed-expense burden (active expenses, monthly-equivalent).
function monthlyFixedTotal(fixedExpenses: FixedExpense[]): number {
  return fixedExpenses.reduce((total, fe) => {
    if (!fe.isActive || !(fe.amount > 0)) return total;
    return total + monthlyEquivalent(fe.amount, fe.frequency);
  }, 0);
}

// Total monthly DEBT SERVICE (fixed obligations, not balances). Loans → their
// fixed monthly payment; credit cards → the pending statement / minimum they must
// service monthly. A debt's outstanding balance NEVER counts here (mirror of an
// invested asset): only the recurring payment does.
function monthlyDebtServiceTotal(debtAccounts: DebtAccount[]): number {
  return debtAccounts.reduce((total, debt) => {
    const monthlyDue = Math.max(debt.fullPaymentDue ?? 0, debt.minimumPayment ?? 0);
    if (!(monthlyDue > 0)) return total;
    return total + monthlyDue;
  }, 0);
}

export function calculateMargenKipu(input: MargenKipuInput): MargenKipuResult {
  const now = input.now ?? new Date();
  const today = startOfDay(now);
  const baseCurrency = input.baseCurrency;

  const liquidCash = sumLiquidSpendable(input.accounts);

  // ── 1. Capacity: the sustainable monthly picture (spec §B). ─────────────────
  const monthlyIncome = roundMoney(monthlyIncomeTotal(input.incomeSources));
  const monthlyFixed = roundMoney(monthlyFixedTotal(input.fixedExpenses));
  const monthlyDebtService = roundMoney(monthlyDebtServiceTotal(input.debtAccounts));
  const monthlyEssentials = roundMoney(Math.max(0, input.monthlyEssentialEstimate));
  const monthlyDisposableBeforeAllocations = roundMoney(
    monthlyIncome - monthlyFixed - monthlyDebtService - monthlyEssentials,
  );
  const protectedSavings = roundMoney(Math.max(0, input.monthlySavingsCommitment));
  const protectedInvestment = roundMoney(Math.max(0, input.monthlyInvestmentCommitment));
  const protectedGoals = roundMoney(Math.max(0, input.weeklyGoalContribution) * WEEKS_PER_MONTH);
  const monthlyTrulyFree = roundMoney(
    monthlyDisposableBeforeAllocations - protectedSavings - protectedInvestment - protectedGoals,
  );
  const capacity: MargenCapacity = {
    monthlyIncome,
    monthlyFixed,
    monthlyDebtService,
    monthlyEssentials,
    monthlyDisposableBeforeAllocations,
    monthlyProtected: { savings: protectedSavings, investment: protectedInvestment, goals: protectedGoals },
    monthlyTrulyFree,
  };

  // ── 2. Calendar-aware projection over a FULL cycle (spec §A). ───────────────
  // Same S15 day-by-day engine, but forced to a full month, protecting savings/
  // investment/goals at full value and modeling credit-card statements by cycle
  // (loans as fixed monthly). No-double-count is structural: a card purchase is
  // settled by its statement payment on the due date — the running balance is NOT
  // separately reserved, and the essential burn is the only forward discretionary.
  const calendar = buildFinancialCalendar({
    accounts: input.accounts,
    incomeSources: input.incomeSources,
    fixedExpenses: input.fixedExpenses,
    scheduledPayments: input.scheduledPayments.map((p, i) => ({ id: `sp${i}`, name: "Pago programado", amount: p.amountBase, dueDate: p.dueDate })),
    debtAccounts: input.debtAccounts,
    mainGoal: input.weeklyGoalContribution > 0 ? ({ id: "margen-goal", name: "tu meta", goalAccountId: undefined } as unknown as Parameters<typeof buildFinancialCalendar>[0]["mainGoal"]) : null,
    weeklyGoalContribution: input.weeklyGoalContribution,
    monthlySavingsCommitment: input.monthlySavingsCommitment,
    monthlyInvestmentCommitment: input.monthlyInvestmentCommitment,
    savingsPlans: input.savingsPlans,
    now,
    fullCycleHorizon: true,
    protectFullMonthly: true,
    cardCycleAware: true,
  });

  // The projection needs a confidence stub; the honest confidence is finalized
  // below (and enriched by coaching-signals). Feed neutral flags so the projection
  // math (safe daily) is unaffected by confidence — we only consume its numbers.
  const projConfidence: CashflowConfidenceInput = {
    hasIncomeSource: input.incomeSources.some((s) => s.status === "active" && s.amount > 0),
    incomeDateKnown: calendar.nextIncome !== null,
    balanceStale: false,
    hasFixedExpenses: input.fixedExpenses.some((f) => f.isActive),
    recentActivity: true,
    foreignUnconverted: false,
    essentialBurnKnown: monthlyEssentials > 0,
  };
  const projection = projectCashflow({
    calendar,
    monthlyEssentialEstimate: monthlyEssentials,
    reserveFloor: 0,
    now,
    confidence: projConfidence,
    // Stage 32 — remaining-based two-phase burn (absent ⇒ flat legacy burn).
    remainingEssentialThisMonth: input.remainingEssentialThisMonth,
    daysLeftInMonth: input.daysLeftInMonth,
  });

  const horizonDays = calendar.horizonDays;

  // ── 3. The headline: sustainable flow rate, capped by timing. ───────────────
  // flowDaily = the steady-state free money per day (capacity), so a fat liquid
  // buffer never inflates the weekly number above what the month sustains.
  // projectionSafeDaily = the timing-aware safe spend (catches acute troughs — a
  // card statement or loan cluster landing before income). Take the tighter one.
  const flowDaily = monthlyTrulyFree / AVG_DAYS_PER_MONTH; // signed (can be < 0)
  const projectionSafeDaily = projection.safeToday; // already >= 0
  const rawDaily = flowDaily < 0 ? flowDaily : Math.min(flowDaily, projectionSafeDaily);
  const margenDaily = roundMoney(Math.max(0, rawDaily));
  const safeToSpendUntilIncome = roundMoney(Math.max(0, rawDaily) * (horizonDays + 1));

  const dayOfWeek = now.getDay();
  const daysRemainingInWeek = ((7 - dayOfWeek) % 7) + 1; // today → Sunday inclusive
  // The weekly headline is the SUSTAINABLE 7-day rate (daily × 7) — "how much can I
  // spend per week", a rate, not "dollars left in this calendar week". This is the
  // canonical figure the dashboard/chat show. When the sustainable flow is negative
  // (structurally over-committed), it carries the shortfall so coaching can say
  // "vas X sobre lo seguro".
  const margenWeekly = flowDaily < 0 ? roundMoney(flowDaily * 7) : roundMoney(margenDaily * 7);

  // ── 4. Breakdown — itemized calendar reservations for the expandable UI. ────
  // Derived from the SAME calendar the projection walked, so the math the user
  // expands to matches the headline. Each dollar is counted once.
  const cashEvents = calendar.events.filter((e) => e.cashflowAffecting && e.signedAmount < 0 && e.daysFromNow >= 0 && e.daysFromNow <= horizonDays);
  const sumType = (t: string) => roundMoney(cashEvents.filter((e) => e.type === t).reduce((s, e) => s + e.amount, 0));
  const reservedFixed = sumType("fixed_expense");
  const reservedScheduled = sumType("scheduled_payment");
  const reservedDebt = sumType("card_due");
  // Stage 32 — read the projection's own burn total so the breakdown matches
  // the curve it walked (flat mode: identical to dailyEssential×(horizonDays+1);
  // two-phase mode: the month's REMAINING + the next month's full-rate days).
  const reservedEssentials = roundMoney(projection.essentialBurnTotal);
  const reservedSavings = sumType("savings");
  const reservedInvestment = sumType("investment");
  const reservedGoal = sumType("goal_contribution");
  const totalReserved = roundMoney(
    reservedFixed + reservedScheduled + reservedDebt + reservedEssentials + reservedSavings + reservedInvestment + reservedGoal,
  );

  const status: MargenKipuResult["status"] =
    flowDaily < 0 || projection.status === "negative"
      ? "negative"
      : margenDaily <= 0 || margenWeekly <= margenDaily * 1.5
        ? "tight"
        : "healthy";

  // ── 5. Confidence contract (honest defaults from what the PURE engine sees) ──
  // Preserved from Stage 29: the engine sees income, the essential estimate it was
  // handed, and unconverted foreign money. It CANNOT see spend history or
  // staleness — coaching-signals enriches those and finalizes confidence.
  const hasActiveIncome = input.incomeSources.some((s) => s.status === "active" && s.amount > 0);
  const essentialsKnownFromInput = monthlyEssentials > 0;
  const hasUnconvertedForeign = input.accounts.some(
    (a) =>
      !a.isGoalAccount &&
      a.currency !== baseCurrency &&
      a.currentBalanceOriginal > 0 &&
      !(a.currentBalanceBase > 0),
  );

  // Credit cards with a large, unconfirmable pending statement → advisory "confirm".
  const cardsToConfirm: { name: string; amount: number }[] = [];
  for (const debt of input.debtAccounts) {
    if (debt.type !== "credit_card") continue;
    const phase = cardCyclePhaseFor(debt, today);
    if (phase.status === "confirm") {
      cardsToConfirm.push({ name: debt.name || "Tarjeta", amount: phase.reserveAmount });
    }
  }

  const marginGaps: MarginGap[] = [];
  if (!hasActiveIncome) {
    marginGaps.push({ code: "no_income", label: "no me diste un ingreso todavía" });
  } else if (
    // Stage 31 (5.11) — only a DATABLE income suppresses the honesty gap. The
    // calendar never schedules yearly/custom incomes (irregular → no next-income
    // date), so their "día del mes" must not fake date certainty here.
    !input.incomeSources.some(
      (s) =>
        s.status === "active" &&
        s.amount > 0 &&
        s.frequency !== "yearly" &&
        s.frequency !== "custom" &&
        (s.payAnchorDate || s.expectedDay || s.expectedWeekday),
    )
  ) {
    marginGaps.push({ code: "no_income_date", label: "no sé bien cuándo cae tu próximo ingreso" });
  }
  if (!essentialsKnownFromInput) {
    marginGaps.push({ code: "essentials_unknown", label: "aún no conozco tu gasto diario" });
  }
  if (hasUnconvertedForeign) {
    marginGaps.push({ code: "unconverted_currency", label: "tienes plata en otra moneda sin tasa" });
  }
  if (cardsToConfirm.length > 0) {
    marginGaps.push({ code: "card_confirm", label: "hay una tarjeta con un pago grande por confirmar" });
  }

  const confidence: MargenConfidence =
    !essentialsKnownFromInput || !hasActiveIncome
      ? "preliminary"
      : marginGaps.length > 0
        ? "estimated"
        : "solid";

  return {
    margenWeekly,
    margenDaily,
    safeToSpendUntilIncome,
    horizonDays,
    daysRemainingInWeek,
    nextIncomeDate: calendar.nextIncome ? calendar.nextIncome.dateISO : null,
    nextIncomeAmount: calendar.nextIncome ? roundMoney(calendar.nextIncome.amount) : 0,
    status,
    liquidCash,
    capacity,
    confidence,
    essentialsKnown: essentialsKnownFromInput,
    dataAgeDays: null,
    marginGaps,
    cardsToConfirm,
    breakdown: {
      liquidCash,
      reservedFixed,
      reservedScheduled,
      reservedDebt,
      reservedEssentials,
      reservedSavings,
      reservedInvestment,
      reservedGoal,
      totalReserved,
    },
    baseCurrency,
  };
}
