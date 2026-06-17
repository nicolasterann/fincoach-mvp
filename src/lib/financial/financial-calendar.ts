import type { Account, DebtAccount, FinancialGoal, FixedExpense, IncomeSource, PaymentFrequency } from "@/types/financial";
import { sumLiquidSpendable } from "@/lib/financial/liquidity";
import { roundMoney } from "@/lib/financial/money";

// Stage 15 — the FINANCIAL CALENDAR. A deterministic, reusable stream of the
// money events that move a user's cash between now and (about) the next income:
// expected income, fixed expenses, scheduled payments, card/debt obligations,
// goal/savings/investment reservations. Each event is dated, signed, typed and
// tagged (required/flexible/optional, confidence, whether it reserves money,
// whether it's already paid, where it came from). Chat, dashboard and Telegram
// all read this same truth. It never moves money and never invents amounts.

const DAY_MS = 86_400_000;
const DEFAULT_HORIZON_DAYS = 21;
const MIN_HORIZON_DAYS = 5;
const MAX_HORIZON_DAYS = 45;

export type CalendarEventType =
  | "income"
  | "fixed_expense"
  | "scheduled_payment"
  | "card_due"
  | "goal_contribution"
  | "savings"
  | "investment";

export type EventRequirement = "required" | "flexible" | "optional";
export type EventConfidence = "high" | "medium" | "low";
export type EventOrigin = "income_source" | "fixed_expense" | "scheduled_payment" | "statement" | "debt" | "goal" | "commitment";

export interface CalendarEvent {
  id: string;
  date: string; // YYYY-MM-DD (local)
  daysFromNow: number;
  amount: number; // absolute, positive
  signedAmount: number; // + income, − outflow
  type: CalendarEventType;
  label: string; // human, no ids/jargon
  category?: string;
  requirement: EventRequirement;
  confidence: EventConfidence;
  cashflowAffecting: boolean;
  isInternalTransfer: boolean;
  isPaid: boolean;
  reserves: boolean;
  origin: EventOrigin;
}

export interface FinancialCalendar {
  events: CalendarEvent[]; // sorted by date
  horizonDays: number;
  horizonEndISO: string;
  nextIncome: { dateISO: string; amount: number; confidence: EventConfidence } | null;
  liquidCash: number;
}

export interface FinancialCalendarInput {
  accounts: Account[];
  incomeSources: IncomeSource[];
  fixedExpenses: FixedExpense[];
  scheduledPayments: { id?: string; name: string; amount: number | null; dueDate: string; category?: string }[];
  debtAccounts: DebtAccount[];
  mainGoal?: FinancialGoal | null;
  weeklyGoalContribution?: number;
  monthlySavingsCommitment?: number;
  monthlyInvestmentCommitment?: number;
  now?: Date;
  horizonDays?: number;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function clampDom(day: number): number {
  if (!Number.isFinite(day)) return 1;
  return Math.min(28, Math.max(1, Math.round(day)));
}
function nextMonthly(expectedDay: number, today: Date): Date {
  const day = clampDom(expectedDay);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), day);
  return thisMonth.getTime() >= today.getTime() ? thisMonth : new Date(today.getFullYear(), today.getMonth() + 1, day);
}
function nextWeekday(targetWeekday: number, today: Date): Date {
  const delta = (targetWeekday - today.getDay() + 7) % 7;
  const next = new Date(today);
  next.setDate(today.getDate() + (delta === 0 ? 0 : delta));
  return next;
}

// All occurrences of a recurring event within [today, horizonEnd].
function occurrencesWithin(frequency: PaymentFrequency, expectedDay: number | undefined, expectedWeekday: number | undefined, today: Date, horizonEnd: Date): Date[] {
  const out: Date[] = [];
  const limit = horizonEnd.getTime();
  if (frequency === "monthly" || frequency === "yearly" || frequency === "custom") {
    if (frequency === "monthly") {
      let d = nextMonthly(expectedDay ?? 1, today);
      while (d.getTime() <= limit && out.length < 3) {
        out.push(d);
        d = new Date(d.getFullYear(), d.getMonth() + 1, clampDom(expectedDay ?? 1));
      }
    } else if (expectedDay) {
      const d = nextMonthly(expectedDay, today);
      if (d.getTime() <= limit) out.push(d);
    }
    return out;
  }
  // weekly / biweekly
  const step = frequency === "biweekly" ? 14 : 7;
  let d = expectedWeekday != null ? nextWeekday(expectedWeekday, today) : new Date(today);
  let guard = 0;
  while (d.getTime() <= limit && guard < 8) {
    out.push(new Date(d));
    d = new Date(d.getTime() + step * DAY_MS);
    guard += 1;
  }
  return out;
}

function nextIncomeOccurrence(sources: IncomeSource[], today: Date): { date: Date; amount: number; confidence: EventConfidence; source: IncomeSource } | null {
  let best: { date: Date; amount: number; confidence: EventConfidence; source: IncomeSource } | null = null;
  for (const s of sources) {
    if (s.status !== "active") continue;
    let date: Date | null = null;
    let confidence: EventConfidence = "high";
    if (s.frequency === "monthly") {
      date = nextMonthly(s.expectedDay ?? 1, today);
      if (s.expectedDay == null) confidence = "low"; // day assumed, not known — don't pretend certainty
    } else if (s.frequency === "weekly" || s.frequency === "biweekly") {
      date = nextWeekday(s.expectedWeekday ?? 5, today);
      if (s.expectedWeekday == null) confidence = "low";
    } else {
      continue; // custom/yearly → irregular, can't anchor a date
    }
    if (s.isVariable && confidence === "high") confidence = "medium";
    if (!date) continue;
    if (!best || date.getTime() < best.date.getTime()) {
      const amount = s.isVariable && s.minExpectedAmount != null ? s.minExpectedAmount : s.amount;
      best = { date, amount, confidence, source: s };
    }
  }
  return best;
}

export function buildFinancialCalendar(input: FinancialCalendarInput): FinancialCalendar {
  const now = input.now ?? new Date();
  const today = startOfDay(now);
  const liquidCash = sumLiquidSpendable(input.accounts);

  const income = nextIncomeOccurrence(input.incomeSources, today);
  const rawHorizon = income ? Math.round((income.date.getTime() - today.getTime()) / DAY_MS) : DEFAULT_HORIZON_DAYS;
  const horizonDays = Math.min(MAX_HORIZON_DAYS, Math.max(MIN_HORIZON_DAYS, input.horizonDays ?? rawHorizon ?? DEFAULT_HORIZON_DAYS));
  const horizonEnd = new Date(today.getTime() + horizonDays * DAY_MS);

  const events: CalendarEvent[] = [];
  const daysFrom = (d: Date) => Math.round((startOfDay(d).getTime() - today.getTime()) / DAY_MS);
  const push = (e: Omit<CalendarEvent, "daysFromNow" | "signedAmount" | "id"> & { dateObj: Date; idSeed: string }) => {
    const sign = e.type === "income" ? 1 : -1;
    events.push({
      id: `${e.type}:${e.idSeed}:${e.date}`,
      date: e.date,
      daysFromNow: daysFrom(e.dateObj),
      amount: roundMoney(Math.abs(e.amount)),
      signedAmount: roundMoney(sign * Math.abs(e.amount)),
      type: e.type,
      label: e.label,
      category: e.category,
      requirement: e.requirement,
      confidence: e.confidence,
      cashflowAffecting: e.cashflowAffecting,
      isInternalTransfer: e.isInternalTransfer,
      isPaid: e.isPaid,
      reserves: e.reserves,
      origin: e.origin,
    });
  };

  // Income (one or two paychecks within the horizon). We only PROJECT income on a
  // KNOWN date (explicit expectedDay/expectedWeekday). If the day is unknown we do
  // NOT bank on it — the projection stays conservative and confidence drops, so
  // Kipu asks for the pay date instead of pretending the money lands on day 1.
  for (const s of input.incomeSources) {
    if (s.status !== "active") continue;
    if (s.frequency === "custom" || s.frequency === "yearly") continue; // irregular → not dated
    const dateKnown = s.frequency === "monthly" ? s.expectedDay != null : s.expectedWeekday != null;
    if (!dateKnown) continue;
    for (const d of occurrencesWithin(s.frequency, s.expectedDay, s.expectedWeekday, today, horizonEnd)) {
      const amount = s.isVariable && s.minExpectedAmount != null ? s.minExpectedAmount : s.amount;
      if (amount <= 0) continue;
      push({ dateObj: d, idSeed: s.id, date: iso(d), amount, type: "income", label: s.name || "Ingreso", requirement: "required", confidence: s.isVariable ? "medium" : "high", cashflowAffecting: true, isInternalTransfer: false, isPaid: false, reserves: false, origin: "income_source" });
    }
  }

  // Fixed expenses.
  for (const fe of input.fixedExpenses) {
    if (!fe.isActive || fe.amount <= 0) continue;
    if (fe.startDate && new Date(fe.startDate).getTime() > horizonEnd.getTime()) continue;
    for (const d of occurrencesWithin(fe.frequency, fe.expectedDay, fe.expectedWeekday, today, horizonEnd)) {
      if (fe.startDate && new Date(fe.startDate).getTime() > d.getTime()) continue;
      push({ dateObj: d, idSeed: fe.id, date: iso(d), amount: fe.amount, type: "fixed_expense", label: fe.name || "Gasto fijo", category: fe.category, requirement: fe.isEssential ? "required" : "flexible", confidence: fe.expectedDay || fe.expectedWeekday ? "high" : "medium", cashflowAffecting: true, isInternalTransfer: false, isPaid: false, reserves: true, origin: "fixed_expense" });
    }
  }

  // Scheduled (one-off planned) payments within the horizon.
  for (const sp of input.scheduledPayments) {
    if (sp.amount == null || sp.amount <= 0) continue;
    const d = startOfDay(new Date(`${sp.dueDate}T00:00:00`));
    if (d.getTime() < today.getTime() || d.getTime() > horizonEnd.getTime()) continue;
    push({ dateObj: d, idSeed: sp.id ?? sp.name, date: iso(d), amount: sp.amount, type: "scheduled_payment", label: sp.name || "Pago programado", category: sp.category, requirement: "required", confidence: "high", cashflowAffecting: true, isInternalTransfer: false, isPaid: false, reserves: true, origin: "scheduled_payment" });
  }

  // Card / debt payment due this cycle (the amount due, NOT the whole balance).
  for (const debt of input.debtAccounts) {
    const due = Math.max(debt.fullPaymentDue ?? 0, debt.minimumPayment ?? 0);
    if (due <= 0 || !debt.dueDay) continue;
    const d = nextMonthly(debt.dueDay, today);
    if (d.getTime() > horizonEnd.getTime()) continue;
    push({ dateObj: d, idSeed: debt.id, date: iso(d), amount: due, type: "card_due", label: `${debt.name || "Tarjeta"} (pago del mes)`, requirement: "required", confidence: debt.fullPaymentDue != null ? "high" : "medium", cashflowAffecting: true, isInternalTransfer: false, isPaid: false, reserves: true, origin: debt.statementDate ? "statement" : "debt" });
  }

  // Goal contribution (protected money), weekly within the horizon.
  const weeklyGoal = Math.max(0, input.weeklyGoalContribution ?? 0);
  if (weeklyGoal > 0 && input.mainGoal) {
    const weeks = Math.max(1, Math.round(horizonDays / 7));
    for (let w = 0; w < weeks; w++) {
      const d = new Date(today.getTime() + w * 7 * DAY_MS);
      push({ dateObj: d, idSeed: input.mainGoal.id, date: iso(d), amount: weeklyGoal, type: "goal_contribution", label: `Aporte a ${input.mainGoal.name || "tu meta"}`, requirement: "flexible", confidence: "medium", cashflowAffecting: true, isInternalTransfer: Boolean(input.mainGoal.goalAccountId), isPaid: false, reserves: true, origin: "goal" });
    }
  }

  // Savings / investment monthly commitments (prorated to one occurrence in horizon).
  const monthFraction = horizonDays / 30;
  for (const [amount, type, label] of [
    [input.monthlySavingsCommitment ?? 0, "savings", "Ahorro del mes"] as const,
    [input.monthlyInvestmentCommitment ?? 0, "investment", "Inversión del mes"] as const,
  ]) {
    const amt = roundMoney(Math.max(0, amount) * monthFraction);
    if (amt <= 0) continue;
    const d = new Date(today.getTime() + Math.min(horizonDays, 7) * DAY_MS);
    push({ dateObj: d, idSeed: type, date: iso(d), amount: amt, type, label, requirement: "flexible", confidence: "low", cashflowAffecting: true, isInternalTransfer: true, isPaid: false, reserves: true, origin: "commitment" });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || b.signedAmount - a.signedAmount);

  return {
    events,
    horizonDays,
    horizonEndISO: iso(horizonEnd),
    nextIncome: income ? { dateISO: iso(income.date), amount: roundMoney(income.amount), confidence: income.confidence } : null,
    liquidCash,
  };
}
