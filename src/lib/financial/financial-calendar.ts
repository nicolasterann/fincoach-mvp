import type { Account, DebtAccount, FinancialGoal, FixedExpense, IncomeSource, PaymentFrequency } from "@/types/financial";
import { sumLiquidSpendable } from "@/lib/financial/liquidity";
import { roundMoney } from "@/lib/financial/money";
import { nextAnchoredDate } from "@/lib/financial/pay-anchor";
import { deriveCardCyclePhase } from "@/lib/financial/card-cycle";

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
  /** Stage F — the CASH account this event moves money in/out of (income →
   *  destination, outflow → declared funding source). null = not declared;
   *  the treasury attributes it to the learned everyday account, flagged. */
  accountId?: string | null;
}

export interface FinancialCalendar {
  events: CalendarEvent[]; // sorted by date
  horizonDays: number;
  horizonEndISO: string;
  nextIncome: { dateISO: string; amount: number; confidence: EventConfidence } | null;
  liquidCash: number;
}

// Stage 38 — a per-reserve scheduled plan (ahorro/inversión) with its OWN cadence
// and day, so the calendar reserves it on its REAL date — exactly like a fixed
// expense or debt payment — instead of one lumped monthly "commitment". `amount` is
// the base-currency amount PER occurrence at `frequency`. When any plan is present it
// REPLACES the aggregate monthlySavings/InvestmentCommitment block below (else the
// same reserve would be counted twice). The scalar commitments still drive CAPACITY
// (monthly-equivalent), so the two stay consistent and the projection is never looser.
export interface SavingsPlanCalendarInput {
  id: string;
  kind: "savings" | "investment";
  amount: number;
  frequency: PaymentFrequency;
  expectedDay?: number | null;
  payAnchorDate?: string | null;
  label?: string | null;
  /** Stage F — funding cash account of the reserve (savings_plans.source_account_id). */
  sourceAccountId?: string | null;
}

export interface KnownVariableFixedBillCalendarInput {
  occurrenceId: string;
  fixedExpenseId: string;
  occurrenceDate: string;
  /** Historical cadence captured with this invoice. Never infer it from the
   * current plan, which may have changed since the cycle occurred. */
  cadence: PaymentFrequency;
  /** Already valued in the profile base currency by the context builder. */
  amount: number;
  status: "observed" | "dismissed" | "confirmed" | "corrected";
  /** True means this exact billing cycle was already paid or was a proven
   * zero invoice, so the forecast must not reserve it again. */
  settled: boolean;
}

export interface FinancialCalendarInput {
  accounts: Account[];
  incomeSources: IncomeSource[];
  fixedExpenses: FixedExpense[];
  scheduledPayments: { id?: string; name: string; amount: number | null; dueDate: string; category?: string; paymentSourceAccountId?: string | null }[];
  debtAccounts: DebtAccount[];
  mainGoal?: FinancialGoal | null;
  weeklyGoalContribution?: number;
  monthlySavingsCommitment?: number;
  monthlyInvestmentCommitment?: number;
  // Stage 38 — explicit per-reserve schedules. When present (non-empty) they are the
  // source of truth for savings/investment reservations and the aggregate scalars
  // above are ignored (no double count). Absent/empty ⇒ legacy aggregate behavior.
  savingsPlans?: SavingsPlanCalendarInput[];
  /** A real invoice amount that is known but not paid. It replaces the
   * projection for its exact cycle; an overdue one is reserved today. */
  knownVariableFixedBills?: KnownVariableFixedBillCalendarInput[];
  now?: Date;
  horizonDays?: number;
  // Stage 30 — force a FULL billing/monthly cycle window (~30d) regardless of the
  // next paycheck, so Margen v2 is calendar-aware over a whole month instead of
  // collapsing to "days until next of N paychecks". Absent ⇒ legacy behavior
  // (horizon = clamped days to next income).
  fullCycleHorizon?: boolean;
  // Stage 30 — reserve savings/investment at their FULL monthly value inside the
  // window (fixes "investment only 8/30 protected"). Absent ⇒ legacy proration.
  protectFullMonthly?: boolean;
  // Stage 30 — model `credit_card` debts with the real billing cycle (schedule
  // ONLY the pending statement on its due date; nothing when it's already paid or
  // still accumulating). Loans stay fixed-monthly. Absent ⇒ legacy "reserve the
  // amount due on dueDay for every debt" (kept for existing callers/tests).
  cardCycleAware?: boolean;
  // Stage G — per-card installment money pending BEYOND the next statement
  // (key = debt_account_id). The cycle's running-balance ESTIMATE subtracts it
  // so a 12-cuota purchase never inflates this month's statement.
  installmentDeferredByCard?: Map<string, number>;
}

const FULL_CYCLE_DAYS = 30;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Clamp a due day against the REAL length of a month (Stage F): a day-30 bill
// must land on the 30th (Feb → 28/29), never silently on the 28th — the old
// flat-28 clamp made 29-31 obligations vanish from the calendar exactly when
// they were due (today the 29th → "past" → pushed a whole month out).
function clampDom(day: number, year: number, month: number): number {
  if (!Number.isFinite(day)) return 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Math.min(daysInMonth, Math.max(1, Math.round(day)));
}
function nextMonthly(expectedDay: number, today: Date): Date {
  const y = today.getFullYear();
  const m = today.getMonth();
  const thisMonth = new Date(y, m, clampDom(expectedDay, y, m));
  if (thisMonth.getTime() >= today.getTime()) return thisMonth;
  const ny = m === 11 ? y + 1 : y;
  const nm = (m + 1) % 12;
  return new Date(ny, nm, clampDom(expectedDay, ny, nm));
}
function nextWeekday(targetWeekday: number, today: Date): Date {
  const delta = (targetWeekday - today.getDay() + 7) % 7;
  const next = new Date(today);
  next.setDate(today.getDate() + (delta === 0 ? 0 : delta));
  return next;
}

export function variableFixedCycleKey(
  frequency: PaymentFrequency,
  dateISO: string,
): string {
  if (frequency === "monthly") return dateISO.slice(0, 7);
  if (frequency === "yearly") return dateISO.slice(0, 4);
  return dateISO;
}

// All occurrences of a recurring event within [today, horizonEnd].
function occurrencesWithin(frequency: PaymentFrequency, expectedDay: number | undefined, expectedWeekday: number | undefined, today: Date, horizonEnd: Date, payAnchorDate?: string | null): Date[] {
  const out: Date[] = [];
  const limit = horizonEnd.getTime();
  if (frequency === "monthly" || frequency === "yearly" || frequency === "custom") {
    if (frequency === "monthly") {
      let d = nextMonthly(expectedDay ?? 1, today);
      while (d.getTime() <= limit && out.length < 3) {
        out.push(d);
        const ny = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
        const nm = (d.getMonth() + 1) % 12;
        d = new Date(ny, nm, clampDom(expectedDay ?? 1, ny, nm));
      }
    } else if (expectedDay) {
      const d = nextMonthly(expectedDay, today);
      if (d.getTime() <= limit) out.push(d);
    }
    return out;
  }
  // weekly / biweekly. A known payday (Stage 24) anchors the true 14/7-day phase;
  // otherwise fall back to the exact expectedWeekday / today path used before.
  const step: 7 | 14 = frequency === "biweekly" ? 14 : 7;
  const anchored = nextAnchoredDate(payAnchorDate, step, today);
  let d = anchored ?? (expectedWeekday != null ? nextWeekday(expectedWeekday, today) : new Date(today));
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
    // Occasional/windfall income lands unpredictably — never project it as a scheduled
    // payday (that would inflate runway / "safe-until-income"). Same rule as capacity.
    if (s.status !== "active" || s.isOccasional) continue;
    let date: Date | null = null;
    let confidence: EventConfidence = "high";
    if (s.frequency === "monthly") {
      date = nextMonthly(s.expectedDay ?? 1, today);
      if (s.expectedDay == null) confidence = "low"; // day assumed, not known — don't pretend certainty
    } else if (s.frequency === "weekly" || s.frequency === "biweekly") {
      const anchored = nextAnchoredDate(s.payAnchorDate, s.frequency === "biweekly" ? 14 : 7, today);
      if (anchored) {
        date = anchored; // a real payday is a KNOWN date, not a guessed weekday
      } else {
        date = nextWeekday(s.expectedWeekday ?? 5, today);
        if (s.expectedWeekday == null) confidence = "low";
      }
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
  // Stage 30 — Margen v2 projects a full month so obligations land on their real
  // dates and income covers them; the old "clamp to next paycheck" collapsed the
  // window (and treated the whole liquid balance as this-week-spendable).
  const horizonDays = input.fullCycleHorizon
    ? FULL_CYCLE_DAYS
    : Math.min(MAX_HORIZON_DAYS, Math.max(MIN_HORIZON_DAYS, input.horizonDays ?? rawHorizon ?? DEFAULT_HORIZON_DAYS));
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
      accountId: e.accountId ?? null,
    });
  };

  // Income (one or two paychecks within the horizon). We only PROJECT income on a
  // KNOWN date (explicit expectedDay/expectedWeekday). If the day is unknown we do
  // NOT bank on it — the projection stays conservative and confidence drops, so
  // Kipu asks for the pay date instead of pretending the money lands on day 1.
  for (const s of input.incomeSources) {
    if (s.status !== "active" || s.isOccasional) continue; // occasional → never a dated payday
    if (s.frequency === "custom" || s.frequency === "yearly") continue; // irregular → not dated
    // A valid pay anchor makes a weekly/biweekly date KNOWN even with no weekday set.
    const anchorValid =
      (s.frequency === "weekly" || s.frequency === "biweekly") &&
      nextAnchoredDate(s.payAnchorDate, s.frequency === "biweekly" ? 14 : 7, today) != null;
    const dateKnown = s.frequency === "monthly" ? s.expectedDay != null : (anchorValid || s.expectedWeekday != null);
    if (!dateKnown) continue;
    for (const d of occurrencesWithin(s.frequency, s.expectedDay, s.expectedWeekday, today, horizonEnd, s.payAnchorDate)) {
      const amount = s.isVariable && s.minExpectedAmount != null ? s.minExpectedAmount : s.amount;
      if (amount <= 0) continue;
      push({ dateObj: d, idSeed: s.id, date: iso(d), amount, type: "income", label: s.name || "Ingreso", requirement: "required", confidence: s.isVariable ? "medium" : "high", cashflowAffecting: true, isInternalTransfer: false, isPaid: false, reserves: false, origin: "income_source", accountId: s.destinationAccountId ?? null });
    }
  }

  // Fixed expenses. Stage 31 (1.5) — a fixed expense PAID WITH a cycle-modeled
  // credit card is settled by that card's statement payment (already scheduled by
  // the card-cycle path below), so scheduling it as its own cash event would count
  // the same dollar twice. Skip it ONLY when the cycle can actually model it
  // (cardCycleAware + credit_card + both cycle days known); a card without cutoff
  // data reserves nothing, so its expenses stay as normal cash events.
  const cycleModeledCardIds = input.cardCycleAware
    ? new Set(
        input.debtAccounts
          .filter((d) => d.type === "credit_card" && d.cutoffDay != null && d.dueDay != null)
          .map((d) => d.id),
      )
    : new Set<string>();
  const knownBillsByFixed = new Map<
    string,
    KnownVariableFixedBillCalendarInput[]
  >();
  for (const bill of input.knownVariableFixedBills ?? []) {
    const existing = knownBillsByFixed.get(bill.fixedExpenseId) ?? [];
    existing.push(bill);
    knownBillsByFixed.set(bill.fixedExpenseId, existing);
  }
  const consumedKnownBills = new Set<string>();
  for (const fe of input.fixedExpenses) {
    const knownBills = knownBillsByFixed.get(fe.id) ?? [];
    const cycleModeledCard =
      fe.paymentSourceType === "debt_account" &&
      fe.paymentSourceId != null &&
      cycleModeledCardIds.has(fe.paymentSourceId);
    // A card-funded fixed expense is represented by the card statement, not a
    // direct cash event. Its known invoice still remains durable evidence; it
    // simply cannot be charged to cash before the card itself is paid.
    if (cycleModeledCard) continue;
    if (
      fe.isActive &&
      fe.amount > 0 &&
      (!fe.startDate ||
        new Date(fe.startDate).getTime() <= horizonEnd.getTime())
    ) {
    // Stage 32 (Item C) — a known real payment date anchors the weekly/biweekly
    // 7/14-day phase (same contract as income); monthly/yearly are untouched
    // (occurrencesWithin only reads the anchor on the weekly/biweekly branch).
    // Stage F — a YEARLY fixed expense reserves its MONTHLY equivalent (amount/12)
    // inside the window, mirroring the savings-plans rule: dumping the whole year
    // into one month would 12× over-reserve every projection window it lands in.
      const feAmount =
        fe.frequency === "yearly" ? roundMoney(fe.amount / 12) : fe.amount;
      for (const d of occurrencesWithin(
        fe.frequency,
        fe.expectedDay,
        fe.expectedWeekday,
        today,
        horizonEnd,
        fe.payAnchorDate,
      )) {
        if (fe.startDate && new Date(fe.startDate).getTime() > d.getTime()) {
          continue;
        }
        const dateISO = iso(d);
        // A yearly plan has no month anchor in the current schema. Once an
        // invoice for this annual cycle is known, moving it to the plan's
        // generic day would be a fabricated due date. Paid/zero facts suppress
        // the cycle; an unpaid fact inside this horizon is emitted below on its
        // exact date (or today when overdue). A future bill beyond the horizon
        // does not erase the monthly-equivalent planning reserve yet.
        const relevantYearlyKnown =
          fe.frequency === "yearly"
            ? knownBills.filter((bill) => {
                if (
                  consumedKnownBills.has(bill.occurrenceId) ||
                  bill.cadence !== "yearly" ||
                  variableFixedCycleKey("yearly", bill.occurrenceDate) !==
                    variableFixedCycleKey("yearly", dateISO)
                ) {
                  return false;
                }
                if (bill.settled) return true;
                const billTime = new Date(
                  `${bill.occurrenceDate}T00:00:00`,
                ).getTime();
                return (
                  Number.isFinite(billTime) &&
                  billTime <= horizonEnd.getTime()
                );
              })
            : [];
        if (relevantYearlyKnown.length > 0) {
          for (const bill of relevantYearlyKnown) {
            if (bill.settled) consumedKnownBills.add(bill.occurrenceId);
          }
          continue;
        }
        const matchingKnown = knownBills.filter(
          (bill) =>
            !consumedKnownBills.has(bill.occurrenceId) &&
            bill.cadence === fe.frequency &&
            variableFixedCycleKey(bill.cadence, bill.occurrenceDate) ===
              variableFixedCycleKey(bill.cadence, dateISO),
        );
        for (const bill of matchingKnown) {
          consumedKnownBills.add(bill.occurrenceId);
        }
        // Paying early already moved cash; a zero invoice proves there is no
        // cash to move. Either fact consumes this cycle and suppresses the
        // forecast instead of reserving the same obligation a second time.
        if (matchingKnown.some((bill) => bill.settled)) continue;
        const amount =
          matchingKnown.length > 0
            ? matchingKnown.reduce((sum, bill) => sum + bill.amount, 0)
            : feAmount;
        // A proven zero invoice replaces — rather than supplements — the
        // forecast for this cycle. There is no cash event to add.
        if (!(amount > 0)) continue;
        const dateConfidence: EventConfidence =
          matchingKnown.length > 0
            ? "high"
            : fe.expectedDay || fe.expectedWeekday
              ? "high"
              : "medium";
        push({
          dateObj: d,
          idSeed:
            matchingKnown.length > 0
              ? matchingKnown.map((bill) => bill.occurrenceId).join("+")
              : fe.id,
          date: dateISO,
          amount,
          type: "fixed_expense",
          label:
            matchingKnown.length > 0
              ? `${fe.name || "Gasto fijo"} (factura conocida)`
              : fe.name || "Gasto fijo",
          category: fe.category,
          requirement: fe.isEssential ? "required" : "flexible",
          confidence:
            matchingKnown.length > 0
              ? "high"
              : fe.frequency === "yearly"
                ? "low"
                : fe.isVariable
                  ? "medium"
                  : dateConfidence,
          cashflowAffecting: true,
          isInternalTransfer: false,
          isPaid: false,
          reserves: true,
          origin: "fixed_expense",
          accountId:
            fe.paymentSourceType === "account"
              ? fe.paymentSourceId ?? null
              : null,
        });
      }
    }

    // A known bill may already be overdue, may belong to an inactive plan, or
    // may predate a later due-day change. None of those facts makes the debt
    // disappear. Any fact not consumed by a scheduled cycle lands once, on its
    // real future date or today when overdue.
    for (const bill of knownBills) {
      if (consumedKnownBills.has(bill.occurrenceId)) continue;
      consumedKnownBills.add(bill.occurrenceId);
      if (bill.settled) continue;
      if (!(bill.amount > 0)) continue;
      const billDate = startOfDay(
        new Date(`${bill.occurrenceDate}T00:00:00`),
      );
      if (Number.isNaN(billDate.getTime())) continue;
      const reserveDate =
        billDate.getTime() < today.getTime() ? today : billDate;
      if (reserveDate.getTime() > horizonEnd.getTime()) continue;
      push({
        dateObj: reserveDate,
        idSeed: bill.occurrenceId,
        date: iso(reserveDate),
        amount: bill.amount,
        type: "fixed_expense",
        label: `${fe.name || "Gasto fijo"} (factura conocida${billDate < today ? ", vencida" : ""})`,
        category: fe.category,
        requirement: fe.isEssential ? "required" : "flexible",
        confidence: "high",
        cashflowAffecting: true,
        isInternalTransfer: false,
        isPaid: false,
        reserves: true,
        origin: "fixed_expense",
        accountId:
          fe.paymentSourceType === "account"
            ? fe.paymentSourceId ?? null
            : null,
      });
    }
  }

  // Scheduled (one-off planned) payments within the horizon.
  for (const sp of input.scheduledPayments) {
    if (sp.amount == null || sp.amount <= 0) continue;
    const d = startOfDay(new Date(`${sp.dueDate}T00:00:00`));
    if (d.getTime() < today.getTime() || d.getTime() > horizonEnd.getTime()) continue;
    push({ dateObj: d, idSeed: sp.id ?? sp.name, date: iso(d), amount: sp.amount, type: "scheduled_payment", label: sp.name || "Pago programado", category: sp.category, requirement: "required", confidence: "high", cashflowAffecting: true, isInternalTransfer: false, isPaid: false, reserves: true, origin: "scheduled_payment", accountId: sp.paymentSourceAccountId ?? null });
  }

  // Card / debt obligations. Stage 30: with `cardCycleAware`, a `credit_card` is
  // scheduled by its BILLING CYCLE (only the pending statement, on its due date —
  // see card-cycle.ts; nothing today when it's already paid or still accumulating,
  // so a big running balance never eats today's margin), while a `loan` is an
  // amortized fixed monthly payment on its due day. Legacy path (flag off):
  // reserve the amount due on dueDay for every debt (unchanged for old callers).
  for (const debt of input.debtAccounts) {
    if (input.cardCycleAware && debt.type === "credit_card") {
      const phase = deriveCardCyclePhase({
        debtId: debt.id,
        today,
        cutoffDay: debt.cutoffDay ?? null,
        dueDay: debt.dueDay ?? null,
        currentBalanceBase: debt.currentBalanceBase,
        fullPaymentDue: debt.fullPaymentDue ?? null,
        statementCovered: debt.statementCovered ?? null,
        minimumPayment: debt.minimumPayment ?? null,
        lastPaymentDate: debt.lastPaymentDate ?? null,
        deferredNotYetBilled: input.installmentDeferredByCard?.get(debt.id) ?? null,
      });
      // Only a live statement lands in the calendar; "confirm" still reserves (so
      // the projection stays safe) but flags lower confidence for the agent/UI.
      if ((phase.status === "pending" || phase.status === "confirm") && phase.reserveAmount > 0 && phase.dueDateISO) {
        const d = startOfDay(new Date(`${phase.dueDateISO}T00:00:00`));
        if (d.getTime() <= horizonEnd.getTime()) {
          push({ dateObj: d, idSeed: debt.id, date: iso(d), amount: phase.reserveAmount, type: "card_due", label: `${debt.name || "Tarjeta"} (pago del mes)`, requirement: "required", confidence: phase.estimated ? "medium" : "high", cashflowAffecting: true, isInternalTransfer: false, isPaid: false, reserves: true, origin: "statement", accountId: debt.defaultPaymentAccountId ?? null });
        }
      }
      continue;
    }
    // Loans (and legacy debts): fixed monthly amount due on the due day.
    const due = Math.max(debt.fullPaymentDue ?? 0, debt.minimumPayment ?? 0);
    if (due <= 0 || !debt.dueDay) continue;
    const d = nextMonthly(debt.dueDay, today);
    if (d.getTime() > horizonEnd.getTime()) continue;
    push({ dateObj: d, idSeed: debt.id, date: iso(d), amount: due, type: "card_due", label: `${debt.name || (debt.type === "loan" ? "Préstamo" : "Tarjeta")} (pago del mes)`, requirement: "required", confidence: debt.fullPaymentDue != null ? "high" : "medium", cashflowAffecting: true, isInternalTransfer: false, isPaid: false, reserves: true, origin: debt.statementDate ? "statement" : "debt", accountId: debt.defaultPaymentAccountId ?? null });
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

  // Savings / investment — PROTECTED money set aside first. Stage 38: explicit
  // per-reserve plans (with their own cadence + day) are the source of truth when
  // present — each lands on its REAL date like a fixed expense, and the aggregate
  // block below is SKIPPED so the same reserve is never counted twice. Legacy callers
  // (no plans) keep the Stage 30 lumped-commitment behavior unchanged.
  const activeSavingsPlans = input.savingsPlans?.filter((p) => p.amount > 0) ?? [];
  if (activeSavingsPlans.length > 0) {
    const fallbackDate = new Date(today.getTime() + Math.min(horizonDays, 7) * DAY_MS);
    for (const plan of activeSavingsPlans) {
      const type = plan.kind === "investment" ? "investment" : "savings";
      const label = plan.label || (type === "investment" ? "Inversión del mes" : "Ahorro del mes");
      // A YEARLY reserve is ~amount/12 per month: reserve the MONTHLY-EQUIVALENT inside
      // the window (matching capacity), NEVER the full year's amount dumped into a single
      // month — that would over-reserve the projection and wrongly crush the safe-spend.
      if (plan.frequency === "yearly") {
        const monthlyAmt = roundMoney(plan.amount / 12);
        if (monthlyAmt > 0) {
          push({ dateObj: fallbackDate, idSeed: plan.id, date: iso(fallbackDate), amount: monthlyAmt, type, label, requirement: "flexible", confidence: "low", cashflowAffecting: true, isInternalTransfer: true, isPaid: false, reserves: true, origin: "commitment", accountId: plan.sourceAccountId ?? null });
        }
        continue;
      }
      const occ = occurrencesWithin(plan.frequency, plan.expectedDay ?? undefined, undefined, today, horizonEnd, plan.payAnchorDate);
      // A weekly/biweekly/monthly plan whose day we don't know still needs protecting:
      // place it a week out (clamped to the horizon) — the same conservative spot the
      // legacy aggregate used — so it is never silently dropped. Its per-occurrence amount
      // for these cadences is at most ~one month's worth, so this never over-reserves.
      const dates = occ.length > 0 ? occ : [fallbackDate];
      for (const d of dates) {
        if (d.getTime() > horizonEnd.getTime()) continue;
        push({ dateObj: d, idSeed: plan.id, date: iso(d), amount: roundMoney(plan.amount), type, label, requirement: "flexible", confidence: plan.expectedDay != null || plan.payAnchorDate ? "medium" : "low", cashflowAffecting: true, isInternalTransfer: true, isPaid: false, reserves: true, origin: "commitment", accountId: plan.sourceAccountId ?? null });
      }
    }
  } else {
    // Legacy aggregate monthly commitments. Stage 30 (`protectFullMonthly`): reserve
    // the FULL monthly value inside the window, so investment isn't left ~8/30
    // protected and discretionary can't quietly spend next month's contribution.
    const monthFraction = input.protectFullMonthly ? 1 : horizonDays / 30;
    for (const [amount, type, label] of [
      [input.monthlySavingsCommitment ?? 0, "savings", "Ahorro del mes"] as const,
      [input.monthlyInvestmentCommitment ?? 0, "investment", "Inversión del mes"] as const,
    ]) {
      const amt = roundMoney(Math.max(0, amount) * monthFraction);
      if (amt <= 0) continue;
      const d = new Date(today.getTime() + Math.min(horizonDays, 7) * DAY_MS);
      push({ dateObj: d, idSeed: type, date: iso(d), amount: amt, type, label, requirement: "flexible", confidence: "low", cashflowAffecting: true, isInternalTransfer: true, isPaid: false, reserves: true, origin: "commitment" });
    }
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
