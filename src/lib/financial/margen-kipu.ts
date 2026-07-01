import type {
  Account,
  DebtAccount,
  FixedExpense,
  IncomeSource,
  PaymentFrequency,
} from "@/types/financial";
import { sumLiquidSpendable } from "@/lib/financial/liquidity";
import { roundMoney } from "@/lib/financial/money";
import { nextAnchoredDate } from "@/lib/financial/pay-anchor";

// Margen Kipu — the user's REAL safe spending margin.
//
// Not the bank balance. Not liquid cash. It is what the user can spend freely
// WITHOUT putting at risk their essential spending, fixed expenses, card/debt
// payments, scheduled payments, savings/investment commitments, goal progress,
// or their cash flow until the next income arrives.
//
// The engine "thinks like a CFO": it looks at the full cash-flow horizon (until
// the next paycheck), reserves everything that must be covered before then, and
// spreads the free remainder across the days in that horizon. Kipu then
// communicates only the simple weekly / daily slice — never the full breakdown
// unless the user asks.

const DEFAULT_HORIZON_DAYS = 21;
const MIN_HORIZON_DAYS = 3;
const MAX_HORIZON_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;
const AVG_DAYS_PER_MONTH = 30;

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
  baseCurrency: string;
  now?: Date;
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

export interface MargenKipuResult {
  /** Safe to spend for the rest of THIS week (today → Sunday). The headline. */
  margenWeekly: number;
  /** Safe per-day pace until the next income. */
  margenDaily: number;
  /** Total free discretionary money until the next income lands. */
  safeToSpendUntilIncome: number;
  horizonDays: number;
  daysRemainingInWeek: number;
  nextIncomeDate: string | null;
  nextIncomeAmount: number;
  status: "healthy" | "tight" | "negative";
  liquidCash: number;
  breakdown: MargenKipuBreakdown;
  baseCurrency: string;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Soonest upcoming paycheck date across active income sources. Yearly income is
// ignored for the cash-flow horizon (too far to anchor a weekly margin).
function nextIncomeOccurrence(
  sources: IncomeSource[],
  now: Date,
): { date: Date; amount: number } | null {
  const today = startOfDay(now);
  let best: { date: Date; amount: number } | null = null;

  for (const source of sources) {
    if (source.status !== "active") continue;
    // An income source with no real amount (e.g. a name-only entry) must NOT anchor a
    // fake paycheck that shrinks the safe-spend horizon. Skip until it has an amount.
    if (!(source.amount > 0)) continue;
    const candidate = nextDateForSource(source, today);
    if (!candidate) continue;
    if (!best || candidate.getTime() < best.date.getTime()) {
      best = { date: candidate, amount: source.amount };
    }
  }

  return best;
}

function nextDateForSource(source: IncomeSource, today: Date): Date | null {
  switch (source.frequency) {
    case "monthly": {
      const day = clampDayOfMonth(source.expectedDay ?? 1);
      const thisMonth = new Date(today.getFullYear(), today.getMonth(), day);
      if (thisMonth.getTime() >= today.getTime()) return thisMonth;
      return new Date(today.getFullYear(), today.getMonth() + 1, day);
    }
    case "weekly":
    case "biweekly": {
      // A known payday (Stage 24) projects the true 14/7-day phase; agrees with the
      // financial calendar for anchored sources. No anchor → exact prior behavior.
      const anchored = nextAnchoredDate(source.payAnchorDate, source.frequency === "biweekly" ? 14 : 7, today);
      if (anchored) return anchored;
      const targetWeekday = source.expectedWeekday ?? 5; // default Friday
      const delta = (targetWeekday - today.getDay() + 7) % 7;
      const next = new Date(today);
      next.setDate(today.getDate() + (delta === 0 ? 7 : delta));
      return next;
    }
    default:
      return null;
  }
}

function clampDayOfMonth(day: number): number {
  if (!Number.isFinite(day)) return 1;
  return Math.min(28, Math.max(1, Math.round(day)));
}

// Next time a day-of-month falls on/after today (this month or the next).
function nextMonthlyOccurrence(expectedDay: number, today: Date): Date {
  const day = clampDayOfMonth(expectedDay);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), day);
  if (thisMonth.getTime() >= today.getTime()) return thisMonth;
  return new Date(today.getFullYear(), today.getMonth() + 1, day);
}

// How much of a recurring obligation must be reserved before the next income.
// Due-date aware when the day is known (reserve the FULL amount only if it
// actually falls within the horizon — so an expense already paid this cycle, or
// due only after the next paycheck, is NOT reserved). Proration is the fallback
// when timing is unknown.
function reserveRecurring(
  amount: number,
  frequency: PaymentFrequency,
  expectedDay: number | undefined,
  today: Date,
  horizonEnd: Date,
  horizonDays: number,
  monthFraction: number,
): number {
  if (amount <= 0) return 0;
  switch (frequency) {
    case "monthly": {
      if (expectedDay && expectedDay >= 1) {
        return nextMonthlyOccurrence(expectedDay, today) <= horizonEnd ? amount : 0;
      }
      return amount * monthFraction;
    }
    case "weekly":
      return amount * Math.max(1, Math.round(horizonDays / 7));
    case "biweekly":
      return amount * Math.max(1, Math.round(horizonDays / 14));
    case "yearly":
      return (amount / 12) * monthFraction;
    case "custom":
    default:
      return amount * monthFraction;
  }
}

function daysUntilEndOfMonth(now: Date): number {
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return Math.max(1, daysBetween(startOfDay(now), endOfMonth));
}

export function calculateMargenKipu(input: MargenKipuInput): MargenKipuResult {
  const now = input.now ?? new Date();
  const today = startOfDay(now);
  const baseCurrency = input.baseCurrency;

  const liquidCash = sumLiquidSpendable(input.accounts);

  // 1. Cash-flow horizon: until the next paycheck (clamped to a sane window).
  const income = nextIncomeOccurrence(input.incomeSources, now);
  const rawHorizon = income
    ? daysBetween(today, income.date)
    : daysUntilEndOfMonth(now);
  const horizonDays = Math.min(
    MAX_HORIZON_DAYS,
    Math.max(MIN_HORIZON_DAYS, rawHorizon || DEFAULT_HORIZON_DAYS),
  );
  const horizonEnd = new Date(today.getTime() + horizonDays * DAY_MS);
  const monthFraction = horizonDays / AVG_DAYS_PER_MONTH;

  // 2. Reserve everything that must be covered before the next income.
  const reservedFixed = roundMoney(
    input.fixedExpenses
      .filter((expense) => expense.isActive)
      .filter((expense) => !expense.startDate || new Date(expense.startDate) <= horizonEnd)
      .reduce(
        (total, expense) =>
          total +
          reserveRecurring(
            expense.amount,
            expense.frequency,
            expense.expectedDay,
            today,
            horizonEnd,
            horizonDays,
            monthFraction,
          ),
        0,
      ),
  );

  const reservedScheduled = roundMoney(
    input.scheduledPayments
      .filter((payment) => {
        const due = new Date(payment.dueDate);
        return due >= today && due <= horizonEnd;
      })
      .reduce((total, payment) => total + (payment.amountBase ?? 0), 0),
  );

  // Reserve the payment DUE this cycle (minimum / statement), NOT the whole
  // balance — you don't pay off the entire card before you're allowed to spend.
  // Due-date aware via the card's dueDay (monthly), proration as fallback.
  const reservedDebt = roundMoney(
    input.debtAccounts.reduce((total, debt) => {
      const monthlyDue = Math.max(debt.fullPaymentDue ?? 0, debt.minimumPayment ?? 0);
      return (
        total +
        reserveRecurring(monthlyDue, "monthly", debt.dueDay, today, horizonEnd, horizonDays, monthFraction)
      );
    }, 0),
  );

  const reservedEssentials = roundMoney(Math.max(0, input.monthlyEssentialEstimate) * monthFraction);
  const reservedSavings = roundMoney(Math.max(0, input.monthlySavingsCommitment) * monthFraction);
  const reservedInvestment = roundMoney(Math.max(0, input.monthlyInvestmentCommitment) * monthFraction);
  const reservedGoal = roundMoney(Math.max(0, input.weeklyGoalContribution) * (horizonDays / 7));

  const totalReserved = roundMoney(
    reservedFixed +
      reservedScheduled +
      reservedDebt +
      reservedEssentials +
      reservedSavings +
      reservedInvestment +
      reservedGoal,
  );

  // 3. Free discretionary money until the next income, spread across the horizon.
  const freeUntilIncome = roundMoney(liquidCash - totalReserved); // signed
  const safeToSpendUntilIncome = Math.max(0, freeUntilIncome);
  const margenDaily = roundMoney(safeToSpendUntilIncome / horizonDays);

  const dayOfWeek = now.getDay();
  const daysRemainingInWeek = ((7 - dayOfWeek) % 7) + 1; // today → Sunday inclusive
  const weekSlice = Math.min(daysRemainingInWeek, horizonDays);
  // When over-committed, the weekly headline carries the shortfall (negative) so
  // coaching can say "vas X sobre lo seguro"; otherwise it's the safe slice.
  const margenWeekly =
    freeUntilIncome < 0 ? freeUntilIncome : roundMoney(margenDaily * weekSlice);

  const status: MargenKipuResult["status"] =
    freeUntilIncome < 0 ? "negative" : margenWeekly <= margenDaily * 1.5 ? "tight" : "healthy";

  return {
    margenWeekly,
    margenDaily,
    safeToSpendUntilIncome,
    horizonDays,
    daysRemainingInWeek,
    nextIncomeDate: income ? income.date.toISOString().slice(0, 10) : null,
    nextIncomeAmount: income ? roundMoney(income.amount) : 0,
    status,
    liquidCash,
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
