import type { DebtAccount } from "@/types/financial";

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
  /** Minimum payment on the last statement (fallback anchor for "large"). */
  minimumPayment?: number | null;
  /** ISO date of the most recent payment on this card, if any. */
  lastPaymentDate?: string | null;
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
function clampDom(day: number): number {
  if (!Number.isFinite(day)) return 1;
  return Math.min(28, Math.max(1, Math.round(day)));
}

// The due date of the statement that closed on the MOST RECENT cutoff on/before
// today. When dueDay < cutoffDay the payment lands the following month.
function lastStatementDueDate(cutoffDay: number, dueDay: number, today: Date): Date {
  const cut = clampDom(cutoffDay);
  const due = clampDom(dueDay);
  // Most recent cutoff at or before today.
  let cutoff = new Date(today.getFullYear(), today.getMonth(), cut);
  if (cutoff.getTime() > today.getTime()) {
    cutoff = new Date(today.getFullYear(), today.getMonth() - 1, cut);
  }
  // Due date for that cutoff: same month if due >= cutoff, else next month.
  const dueMonthOffset = due >= cut ? 0 : 1;
  return new Date(cutoff.getFullYear(), cutoff.getMonth() + dueMonthOffset, due);
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
  const reserveAmount = hasClosedAmount ? closed : running;
  const estimated = !hasClosedAmount;

  // Paid-detection. Parse lastPaymentDate as LOCAL midnight to match lastDue.
  const lastPay = input.lastPaymentDate ? parseLocalDate(input.lastPaymentDate) : null;
  const paidByDate = lastPay != null && lastPay.getTime() >= lastDue.getTime();

  if (!lastDueIsFuture) {
    // (B)/(A): the statement's due date has passed. If a payment on/after it is on
    // record it's paid; otherwise assume paid silently (the founder's default A).
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

// Convenience: derive the phase straight from a DebtAccount row. Only meaningful
// for `credit_card` debts — callers gate on type before using the reserve.
export function cardCyclePhaseFor(debt: DebtAccount, today: Date, confirmThreshold?: number): CardCyclePhase {
  return deriveCardCyclePhase({
    debtId: debt.id,
    today,
    cutoffDay: debt.cutoffDay ?? null,
    dueDay: debt.dueDay ?? null,
    currentBalanceBase: debt.currentBalanceBase,
    fullPaymentDue: debt.fullPaymentDue ?? null,
    minimumPayment: debt.minimumPayment ?? null,
    lastPaymentDate: debt.lastPaymentDate ?? null,
    confirmThreshold,
  });
}
