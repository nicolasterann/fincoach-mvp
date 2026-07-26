import type { DebtAccount } from "@/types/financial";
import { roundMoney } from "@/lib/financial/money";
import { estimateMonthlyInterest, monthlyRateDecimal, type RateKind } from "@/lib/financial/interest-math";

// Stage 30 — the CREDIT-CARD BILLING CYCLE, as a pure, deterministic module.
//
// A credit card is not a bill you owe in full today. It has a rhythm: a
// statement CLOSES on the cutoff day, and the amount that closed is DUE on the
// due day (which may fall in the next month when dueDay < cutoffDay). Spending
// that happens AFTER the cutoff is NOT owed yet — it lands on the NEXT statement,
// due a cycle later. So at any instant a card has at most ONE statement that is
// "pending" (closed, due date not passed, not yet paid). Everything still
// accumulating is future debt, scheduled at its future due date — it must NEVER
// be reserved against today's cash.
//
// This is the fix for the "whole card balance eats my margin" bug: we reserve
// ONLY the pending statement, ON its due date, and let income cover it. A card
// with nothing pending (last statement already paid, next not yet closed)
// reserves 0 today — even if it carries a large running balance.
//
// Only `credit_card` debts use this cycle. Loans are amortized fixed monthly
// payments (see financial-calendar / the loan path), NOT revolving statements.

const DAY_MS = 86_400_000;

export type CardStatementStatus =
  | "pending" // closed statement, due date in the future, not paid → schedule it
  | "paid" // detected paid (lastPaymentDate covers it, or silently assumed past)
  | "accumulating" // no closed-unpaid statement; the balance is next cycle's
  | "confirm"; // a large pending amount we can't confirm → ask, don't guess

export interface CardCyclePhase {
  /** Which credit card this describes. */
  debtId: string;
  status: CardStatementStatus;
  /** The statement payment to schedule (0 unless status === "pending"|"confirm"). */
  reserveAmount: number;
  /** ISO date the pending statement is due (null when nothing is pending). */
  dueDateISO: string | null;
  /** Days from `today` to the due date (null when nothing is pending). */
  daysUntilDue: number | null;
  /** True when reserveAmount is an ESTIMATE from the running balance rather than a
   *  confirmed closed-statement amount — the confidence contract flags it. */
  estimated: boolean;
  /** The running/accumulating balance NOT reserved today (future debt). */
  runningBalance: number;
}

export interface CardCycleInput {
  debtId: string;
  today: Date;
  cutoffDay?: number | null;
  dueDay?: number | null;
  /** Running, still-accumulating balance in base currency. */
  currentBalanceBase: number;
  /** Last CLOSED statement amount (0/undefined when unknown). */
  fullPaymentDue?: number | null;
  /** 065+: authoritative statement coverage. Undefined preserves the legacy
   * lastPaymentDate heuristic for rows loaded before the migration. */
  statementCovered?: boolean | null;
  /** Minimum payment on the last statement (fallback anchor for "large"). */
  minimumPayment?: number | null;
  /** ISO date of the most recent payment on this card, if any. */
  lastPaymentDate?: string | null;
  /** Stage G — installment money pending BEYOND the next statement. The running
   *  balance holds the FULL committed total from purchase day, but only one
   *  installment bills per cycle: the estimate subtracts this so a 12-cuota
   *  purchase never inflates THIS month's statement. */
  deferredNotYetBilled?: number | null;
  /** Above this reserved estimate, an UNCONFIRMED statement becomes "confirm"
   *  (the agent/UI asks) instead of silently reserving. Default 300 (base). */
  confirmThreshold?: number;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
// Parse a YYYY-MM-DD as LOCAL midnight (matching how due/cutoff dates are built),
// so a lastPaymentDate never lands a day off via UTC parsing. Returns null on a
// malformed/impossible date (caller treats it as "no payment on record").
function parseLocalDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(y, mo - 1, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
  return d;
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Stage 31 (5.8) — month-aware day-of-month, aligned with debt-health's timing:
// day 31 lands on the LAST day of a 30-day month (and 29–31 on Feb 28/29), never
// silently on the 28th of every month. `new Date` normalizes month overflow.
function domInMonth(year: number, monthIndex0: number, day: number): Date {
  const safeDay = Number.isFinite(day) ? Math.max(1, Math.round(day)) : 1;
  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate();
  return new Date(year, monthIndex0, Math.min(daysInMonth, safeDay));
}

// The due date of the statement that closed on the MOST RECENT cutoff on/before
// today. When dueDay < cutoffDay the payment lands the following month.
function lastStatementDueDate(cutoffDay: number, dueDay: number, today: Date): Date {
  // Most recent cutoff at or before today (month-aware: cutoff 31 = end of month).
  let cutoff = domInMonth(today.getFullYear(), today.getMonth(), cutoffDay);
  if (cutoff.getTime() > today.getTime()) {
    cutoff = domInMonth(today.getFullYear(), today.getMonth() - 1, cutoffDay);
  }
  // Due date for that cutoff: same month if due >= cutoff, else next month.
  const dueMonthOffset = dueDay >= cutoffDay ? 0 : 1;
  return domInMonth(cutoff.getFullYear(), cutoff.getMonth() + dueMonthOffset, dueDay);
}

/** J-3 — «ya la pagué» del onboarding significa CUBIERTA. Un ciclo saldado no se
 *  reclama, y el saldo ACUMULADO no es el pago del mes: lo que corre después del
 *  corte pertenece al ciclo siguiente. Una sola regla para las tres superficies
 *  (fase del ciclo, salud de la deuda y señales de coaching); si viven separadas,
 *  una vuelve a preguntar por una tarjeta que la otra ya da por paga.
 *
 *  `fullPaymentDue == null` es DESCONOCIDO, no cero: ahí no gateamos nada — que
 *  Kipu pregunte es lo honesto. El cero DECLARADO sí cierra.
 *
 *  `deriveCardCyclePhase` conserva su propia condición (mira `closed`, que colapsa
 *  null y cero) porque decide cuánto RESERVAR, no si reclamar; mezclarlas cambiaría
 *  la reserva de una tarjeta sin corte capturado. Este predicado gobierna las dos
 *  superficies que RECLAMAN: salud de la deuda y señales de coaching. */
export function cardStatementSettled(input: {
  statementCovered?: boolean | null;
  fullPaymentDue?: number | null;
}): boolean {
  if (input.statementCovered === true) return true;
  return input.fullPaymentDue != null && Math.max(0, input.fullPaymentDue) <= 0.005;
}

// Derive the billing-cycle phase for a single credit card. Deterministic; never
// moves money. Paid-detection order is the founder's decision B → A → C:
//   (B) lastPaymentDate >= the statement's due date → PAID.
//   (A) else the due date is already in the past → assume PAID (silent default).
//   (C) a LARGE pending amount we can't confirm → "confirm" (ask), never a
//       silent reserve or a silent skip.
export function deriveCardCyclePhase(input: CardCycleInput): CardCyclePhase {
  const today = startOfDay(input.today);
  const running = Math.max(0, input.currentBalanceBase ?? 0);
  const confirmThreshold = input.confirmThreshold ?? 300;

  // Without both cycle days we cannot place a statement on the calendar. Treat the
  // card as accumulating (reserve nothing today) — honest, never a fake due date.
  if (!input.cutoffDay || !input.dueDay) {
    return {
      debtId: input.debtId,
      status: "accumulating",
      reserveAmount: 0,
      dueDateISO: null,
      daysUntilDue: null,
      estimated: false,
      runningBalance: running,
    };
  }

  const lastDue = lastStatementDueDate(input.cutoffDay, input.dueDay, today);
  const lastDueIsFuture = lastDue.getTime() >= today.getTime();
  const daysUntilDue = Math.round((lastDue.getTime() - today.getTime()) / DAY_MS);

  // A confirmed closed-statement amount wins; otherwise estimate from the running
  // balance and FLAG it (until the cutoff passes / a statement is confirmed).
  const closed = Math.max(0, input.fullPaymentDue ?? 0);
  const hasClosedAmount = closed > 0;
  // A confirmed statement always wins untouched; the running-balance ESTIMATE
  // excludes installments that bill in future cycles (Stage G).
  const deferred = Math.max(0, input.deferredNotYetBilled ?? 0);
  const reserveAmount = hasClosedAmount ? closed : Math.max(0, roundMoney(running - deferred));
  const estimated = !hasClosedAmount;

  // Paid-detection. Parse lastPaymentDate as LOCAL midnight to match lastDue.
  const lastPay = input.lastPaymentDate ? parseLocalDate(input.lastPaymentDate) : null;
  const paidByLegacyDate = lastPay != null && lastPay.getTime() >= lastDue.getTime();
  // A partial payment also has a lastPaymentDate. Once 065 supplies the explicit
  // flag, only statementCovered=true may close the cycle. The date is a fallback
  // solely for pre-065/legacy fixtures where the flag is genuinely absent.
  const paidByDate = (input.statementCovered === true && closed <= 0.005)
    || (input.statementCovered == null && paidByLegacyDate);

  if (!lastDueIsFuture) {
    // (B)/(A): the statement's due date has passed. If a payment on/after it is on
    // record it's paid; otherwise assume paid silently (the founder's default A).
    // S34 exception: a DECLARED closed amount ("a pagar este mes") with NO payment
    // on record must not vanish silently — the user just told us they owe it. Roll
    // it to the NEXT due date as a "confirm" (decision C: ask, never silent-skip),
    // so the 30-day projection sees the payment and the agent can ask "¿ya lo
    // pagaste o te vence el próximo?".
    if (hasClosedAmount && !paidByDate) {
      const nextDue = domInMonth(lastDue.getFullYear(), lastDue.getMonth() + 1, input.dueDay);
      return {
        debtId: input.debtId,
        status: "confirm",
        reserveAmount: closed,
        dueDateISO: iso(nextDue),
        daysUntilDue: Math.round((nextDue.getTime() - today.getTime()) / DAY_MS),
        estimated: false,
        runningBalance: running,
      };
    }
    // Either way nothing is reserved against today — that debt window is closed.
    return {
      debtId: input.debtId,
      status: "paid",
      reserveAmount: 0,
      dueDateISO: iso(lastDue),
      daysUntilDue,
      estimated: false,
      runningBalance: running,
    };
  }

  // The due date is in the FUTURE → this statement is still live.
  if (paidByDate) {
    return {
      debtId: input.debtId,
      status: "paid",
      reserveAmount: 0,
      dueDateISO: iso(lastDue),
      daysUntilDue,
      estimated: false,
      runningBalance: running,
    };
  }

  if (reserveAmount <= 0) {
    // Nothing owed on the pending statement (e.g. paid down to zero) → accumulating.
    return {
      debtId: input.debtId,
      status: "accumulating",
      reserveAmount: 0,
      dueDateISO: iso(lastDue),
      daysUntilDue,
      estimated: false,
      runningBalance: running,
    };
  }

  // (C): a large, UNCONFIRMED (estimated) amount → surface as "confirm" so the
  // agent/UI can ask, rather than silently reserving a guessed statement. A known
  // closed amount, or a small estimate, schedules normally as "pending".
  const status: CardStatementStatus = estimated && reserveAmount >= confirmThreshold ? "confirm" : "pending";

  return {
    debtId: input.debtId,
    status,
    reserveAmount: Math.round(reserveAmount * 100) / 100,
    dueDateISO: iso(lastDue),
    daysUntilDue,
    estimated,
    runningBalance: running,
  };
}

// The RECURRING monthly obligation a debt adds to STEADY-STATE capacity (Margen,
// flexible spending, debt pressure). A credit card is settled by its billing CYCLE —
// its statement is a one-time cash event the calendar schedules on the due date — so
// its recurring floor is ONLY the minimum payment (0 when paid in full), NEVER the
// full statement, which would double-count a variable, once-per-cycle payment as a
// permanent monthly cost (the bug that made a paid-off-monthly card sink the Margen).
// Loans / family debts / anything else contribute their fixed monthly payment
// (max of statement-due and minimum). ONE rule, imported everywhere, so capacity,
// the dashboard, debt pressure and goal planning never contradict each other.
export function recurringMonthlyDebtObligation(debt: DebtAccount): number {
  if (debt.type === "credit_card") return Math.max(0, debt.minimumPayment ?? 0);
  return Math.max(debt.fullPaymentDue ?? 0, debt.minimumPayment ?? 0);
}

// Most recent cutoff (statement close) at or before today (month-aware).
function mostRecentCutoffDate(cutoffDay: number, today: Date): Date {
  let cutoff = domInMonth(today.getFullYear(), today.getMonth(), cutoffDay);
  if (cutoff.getTime() > startOfDay(today).getTime()) cutoff = domInMonth(today.getFullYear(), today.getMonth() - 1, cutoffDay);
  return cutoff;
}

// Day-to-day F3 — BANK-REALISTIC credit-card interest accrual (pure, deterministic).
// A bank charges interest only when you DON'T pay the statement in full by its due
// date (you lose the grace period): the carried balance — and, while carrying, new
// purchases too — accrue at the card's monthly rate, capitalized once per cycle.
// Kipu mirrors that: if the last statement's due date has passed with an unpaid
// remainder (`full_payment_due > 0` after payments), interest = balance × monthly
// rate is charged ONCE per cycle (idempotent via `lastInterestAccruedOn`). Paid in
// full by the due date → grace → no interest. It's an ESTIMATE (approx of the average-
// daily-balance method), refined as real statements come in.
export interface CardInterestAccrual {
  shouldAccrue: boolean;
  /** Interest to capitalize onto the balance (same currency basis as currentBalance). */
  interest: number;
  /** Monthly rate as a percent, for display ("~1.4%/mes"). */
  monthlyRatePct: number;
  reason: "carrying_unpaid" | "no_rate" | "no_balance" | "paid_or_grace" | "no_cycle_days" | "already_this_cycle";
}

export function computeCardInterestAccrual(input: {
  today: Date;
  cutoffDay?: number | null;
  dueDay?: number | null;
  currentBalance: number;
  fullPaymentDue?: number | null;
  interestRatePct?: number | null;
  interestRateKind?: RateKind;
  lastInterestAccruedOn?: string | null;
}): CardInterestAccrual {
  const balance = Math.max(0, input.currentBalance ?? 0);
  const rate = input.interestRatePct ?? 0;
  const none = (reason: CardInterestAccrual["reason"]): CardInterestAccrual => ({ shouldAccrue: false, interest: 0, monthlyRatePct: 0, reason });
  if (!(rate > 0)) return none("no_rate");
  if (!(balance > 0)) return none("no_balance");
  if (!input.cutoffDay || !input.dueDay) return none("no_cycle_days");
  const today = startOfDay(input.today);
  const dueDate = lastStatementDueDate(input.cutoffDay, input.dueDay, today);
  const pastDue = dueDate.getTime() < today.getTime();
  const unpaid = (input.fullPaymentDue ?? 0) > 0;
  // Paid in full by the due date, or nothing past due yet → grace → no interest.
  if (!pastDue || !unpaid) return none("paid_or_grace");
  // At most once per statement cycle.
  const lastCutoff = mostRecentCutoffDate(input.cutoffDay, today);
  const lastAcc = input.lastInterestAccruedOn ? parseLocalDate(input.lastInterestAccruedOn) : null;
  if (lastAcc != null && lastAcc.getTime() >= lastCutoff.getTime()) return none("already_this_cycle");
  const kind = input.interestRateKind ?? "annual_nominal";
  const interest = Math.round(estimateMonthlyInterest(balance, rate, kind) * 100) / 100;
  if (!(interest > 0)) return none("no_balance");
  return { shouldAccrue: true, interest, monthlyRatePct: Math.round(monthlyRateDecimal(rate, kind) * 10000) / 100, reason: "carrying_unpaid" };
}

// Convenience: derive the phase straight from a DebtAccount row. Only meaningful
// for `credit_card` debts — callers gate on type before using the reserve.
export function cardCyclePhaseFor(debt: DebtAccount, today: Date, confirmThreshold?: number, deferredNotYetBilled?: number): CardCyclePhase {
  return deriveCardCyclePhase({
    debtId: debt.id,
    today,
    cutoffDay: debt.cutoffDay ?? null,
    dueDay: debt.dueDay ?? null,
    currentBalanceBase: debt.currentBalanceBase,
    fullPaymentDue: debt.fullPaymentDue ?? null,
    statementCovered: debt.statementCovered ?? null,
    minimumPayment: debt.minimumPayment ?? null,
    lastPaymentDate: debt.lastPaymentDate ?? null,
    confirmThreshold,
    deferredNotYetBilled: deferredNotYetBilled ?? null,
  });
}
