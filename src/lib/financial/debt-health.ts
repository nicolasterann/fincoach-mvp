import type { Account, DebtAccount } from "@/types/financial";
import { roundMoney } from "@/lib/financial/money";
import { calculateDebtPressure, type DebtPressureLevel } from "@/lib/financial/debt-pressure";
import { annualRatePctFromKind, estimateMonthlyInterest, type RateKind } from "@/lib/financial/interest-math";
import { classifyDebtPayment, statementAgeDays } from "@/lib/financial/debt-statement";
import type { PayoffDebtInput } from "@/lib/financial/debt-payoff";

// Stage 14 — the per-user CARD/DEBT HEALTH model. PURE. One truth that powers
// chat, the ambient Telegram loop, and the dashboard. It NEVER asserts a card is
// paid without evidence and NEVER invents a rate: missing data yields cautious
// states ("needs_payment_confirmation", "unknown") that make Kipu ASK, not claim.

export type CardHealthState =
  | "healthy"
  | "watch"
  | "due_soon"
  | "due_today"
  | "overdue"
  | "needs_payment_confirmation"
  | "stale_statement"
  | "revolving_risk"
  | "high_interest_risk"
  | "unknown";

const STATE_PRIORITY: Record<CardHealthState, number> = {
  overdue: 100,
  needs_payment_confirmation: 88,
  due_today: 85,
  due_soon: 75,
  high_interest_risk: 60,
  revolving_risk: 55,
  stale_statement: 45,
  watch: 30,
  healthy: 10,
  unknown: 0,
};

const STALE_STATEMENT_DAYS = 40; // a monthly cycle is ~30d; beyond this obligations may be outdated
const HIGH_INTEREST_ANNUAL_PCT = 30; // LatAm consumer cards commonly sit far above this

export interface CardHealth {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
  minimumPayment: number | null;
  fullPaymentDue: number | null;
  dueInDays: number | null;
  daysSinceDue: number | null;
  interestRatePct: number | null; // annualized for display
  estMonthlyInterest: number | null;
  statementAgeDays: number | null;
  recentPaymentDetected: boolean;
  state: CardHealthState;
  states: CardHealthState[];
  reasons: string[];
}

export interface DebtHealthReport {
  hasAnyDebt: boolean;
  cards: CardHealth[];
  totalDebt: number;
  totalMinimums: number;
  totalFull: number;
  pressureLevel: DebtPressureLevel;
  debtToIncomeRatio: number;
  highestInterestCardId: string | null;
  topAction: { kind: string; cardId: string | null; text: string } | null;
  estimate: true;
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

// Next occurrence of `dueDay` from now, and how many days since it last passed.
// A due day larger than a month's length (e.g. 31 in a 30-day month, 30 in Feb)
// is clamped to that month's last day, so timing never goes negative or bogus.
function dueDayTiming(dueDay: number, now: Date): { nextInDays: number; sinceLast: number } {
  const today = now.getDate();
  const dim = daysInMonth(now.getFullYear(), now.getMonth());
  const prevDim = daysInMonth(now.getFullYear(), now.getMonth() - 1);
  const dThis = Math.min(dueDay, dim);
  const dPrev = Math.min(dueDay, prevDim);
  const nextInDays = dThis >= today ? dThis - today : dim - today + dThis;
  const sinceLast = dThis <= today ? today - dThis : today + (prevDim - dPrev);
  return { nextInDays, sinceLast };
}

export interface DebtHealthInput {
  debtAccounts: DebtAccount[];
  accounts?: Account[];
  monthlyIncome: number;
  nowMs: number;
  recentDebtPayments?: { debtAccountId: string; amount: number; occurredAtMs: number }[];
}

export function buildDebtHealth(input: DebtHealthInput): DebtHealthReport {
  const now = new Date(input.nowMs);
  // "Has debt" means money actually owed now — a settled card (balance 0) with
  // stale minimum/full metadata does NOT count as current debt.
  const debts = input.debtAccounts.filter((d) => d.currentBalanceBase > 0.005);

  const cards: CardHealth[] = input.debtAccounts.map((d) => {
    const balance = roundMoney(Math.max(0, d.currentBalanceBase));
    const reasons: string[] = [];
    const states: CardHealthState[] = [];

    const rateKind: RateKind = d.interestRateKind ?? "annual_nominal";
    const annualPct = d.interestRate != null && d.interestRate > 0 ? annualRatePctFromKind(d.interestRate, rateKind) : null;
    const estMonthlyInterest = annualPct != null && balance > 0 ? estimateMonthlyInterest(balance, d.interestRate ?? 0, rateKind) : null;
    const ageDays = statementAgeDays(d.statementDate, input.nowMs);

    let nextInDays: number | null = null;
    let sinceLast: number | null = null;
    if (d.dueDay != null && d.dueDay >= 1 && d.dueDay <= 31) {
      const t = dueDayTiming(d.dueDay, now);
      nextInDays = t.nextInDays;
      sinceLast = t.sinceLast;
    }

    const recentPayment = (input.recentDebtPayments ?? []).find(
      (p) => p.debtAccountId === d.id && input.nowMs - p.occurredAtMs <= 14 * 86_400_000,
    );
    const recentPaymentDetected = Boolean(recentPayment);

    if (balance <= 0.005) {
      states.push("healthy");
      reasons.push("sin saldo pendiente");
    } else {
      // Due-date driven states.
      if (nextInDays === 0) {
        states.push("due_today");
        reasons.push("vence hoy");
      } else if (nextInDays != null && nextInDays >= 1 && nextInDays <= 5) {
        states.push("due_soon");
        reasons.push(`vence en ${nextInDays} día(s)`);
      } else if (nextInDays != null && nextInDays >= 6 && nextInDays <= 10) {
        states.push("watch");
      }
      // Only flag a recently-passed due date when it's the NEAREST due event
      // (sinceLast < nextInDays) and within ~12 days — otherwise we're mid-cycle
      // and the upcoming due drives the state. Avoids false "overdue" for users
      // who don't log card payments as ledger entries. Always phrased as an ASK.
      const recentlyPassed =
        sinceLast != null && nextInDays != null && sinceLast >= 1 && sinceLast <= 10 && sinceLast < nextInDays;
      if (recentlyPassed && !recentPaymentDetected) {
        if ((sinceLast as number) <= 5) {
          states.push("needs_payment_confirmation");
          reasons.push(`la fecha de pago pasó hace ${sinceLast} día(s) y no veo un pago`);
        } else {
          states.push("overdue");
          reasons.push(`la fecha de pago pasó hace ${sinceLast} día(s) sin pago registrado`);
        }
      }
      // Interest-driven states.
      if (annualPct != null && annualPct >= HIGH_INTEREST_ANNUAL_PCT) {
        states.push("high_interest_risk");
        reasons.push(`tasa alta (~${annualPct}%/año)`);
      }
      if (annualPct != null && annualPct > 0 && recentPayment) {
        const cls = classifyDebtPayment({ amount: recentPayment.amount, fullPaymentDue: d.fullPaymentDue, minimumPayment: d.minimumPayment, currentBalance: balance });
        if (cls.label === "minimum" || cls.label === "below_minimum" || cls.label === "partial") {
          states.push("revolving_risk");
          reasons.push("vienes pagando menos del total con interés corriendo");
        }
      }
      // Statement freshness.
      if (ageDays != null && ageDays > STALE_STATEMENT_DAYS) {
        states.push("stale_statement");
        reasons.push(`el último estado tiene ${ageDays} días`);
      }
      if (states.length === 0) {
        // A card carrying a balance but with NO known terms (no due day, no
        // minimum/full, no rate) can't be protected well — be honest, not "fine".
        const noTerms = d.dueDay == null && d.minimumPayment == null && d.fullPaymentDue == null && annualPct == null;
        states.push(noTerms ? "unknown" : "healthy");
        if (noTerms) reasons.push("tiene saldo pero no conozco sus condiciones (fecha, mínimo, tasa)");
      }
    }

    const state = states.slice().sort((a, b) => STATE_PRIORITY[b] - STATE_PRIORITY[a])[0] ?? "unknown";

    return {
      id: d.id,
      name: d.name,
      type: d.type,
      currency: d.currency,
      balance,
      minimumPayment: d.minimumPayment ?? null,
      fullPaymentDue: d.fullPaymentDue ?? null,
      dueInDays: nextInDays,
      daysSinceDue: sinceLast,
      interestRatePct: annualPct,
      estMonthlyInterest,
      statementAgeDays: ageDays,
      recentPaymentDetected,
      state,
      states,
      reasons,
    };
  });

  const totalDebt = roundMoney(input.debtAccounts.reduce((s, d) => s + Math.max(0, d.currentBalanceBase), 0));
  const totalMinimums = roundMoney(input.debtAccounts.reduce((s, d) => s + (d.minimumPayment ?? 0), 0));
  const totalFull = roundMoney(input.debtAccounts.reduce((s, d) => s + (d.fullPaymentDue ?? 0), 0));
  const pressure = calculateDebtPressure({ debtAccounts: input.debtAccounts, monthlyIncome: input.monthlyIncome });

  const withRate = cards.filter((c) => c.balance > 0 && c.interestRatePct != null);
  const highestInterestCardId = withRate.length
    ? withRate.slice().sort((a, b) => (b.interestRatePct ?? 0) - (a.interestRatePct ?? 0))[0].id
    : null;

  // Deterministic next action: the highest-priority card that needs something.
  const ranked = cards
    .filter((c) => c.state !== "healthy" && c.state !== "unknown")
    .sort((a, b) => STATE_PRIORITY[b.state] - STATE_PRIORITY[a.state]);
  const top = ranked[0] ?? null;
  let topAction: DebtHealthReport["topAction"] = null;
  if (top) {
    const kindByState: Record<string, string> = {
      overdue: "confirm_or_pay_overdue",
      needs_payment_confirmation: "confirm_payment",
      due_today: "pay_due_today",
      due_soon: "pay_due_soon",
      high_interest_risk: "reduce_high_interest",
      revolving_risk: "reduce_revolving",
      stale_statement: "refresh_statement",
      watch: "watch",
    };
    topAction = { kind: kindByState[top.state] ?? "review", cardId: top.id, text: `${top.name}: ${top.reasons[0] ?? top.state}` };
  }

  return {
    hasAnyDebt: debts.length > 0,
    cards,
    totalDebt,
    totalMinimums,
    totalFull,
    pressureLevel: pressure.level,
    debtToIncomeRatio: pressure.debtToIncomeRatio,
    highestInterestCardId,
    topAction,
    estimate: true,
  };
}

// Map health into payoff-strategy inputs (so the agent's payoff tool reuses the
// same date/overdue truth instead of recomputing).
export function payoffInputsFromHealth(report: DebtHealthReport, debts: DebtAccount[]): PayoffDebtInput[] {
  return report.cards
    .filter((c) => c.balance > 0.005)
    .map((c) => {
      const d = debts.find((x) => x.id === c.id);
      return {
        id: c.id,
        name: c.name,
        balance: c.balance,
        annualRatePct: c.interestRatePct,
        rateKind: (d?.interestRateKind ?? "annual_nominal") as RateKind,
        minimumPayment: c.minimumPayment,
        dueInDays: c.dueInDays,
        overdue: c.state === "overdue",
      };
    });
}
