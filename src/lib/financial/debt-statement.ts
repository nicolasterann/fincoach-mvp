import { roundMoney } from "@/lib/financial/money";

// Stage 14 — statement date-awareness + payment classification. PURE.
//
// The Stage 12 limitation this fixes: an OLDER card statement could silently
// overwrite NEWER obligations (minimum/full/due/cutoff). Here we decide, from
// statement emission dates alone, whether incoming obligations may replace the
// current ones — and we refuse to "assume freshness" when a date is missing.

export interface ApplyObligationsDecision {
  apply: boolean;
  reason:
    | "no_prior" // no obligations recorded yet → safe to apply
    | "newer" // incoming statement is newer → apply
    | "same_date" // same emission date → idempotent refresh, apply
    | "older_statement" // incoming is older → keep current obligations
    | "incoming_date_unknown"; // can't prove freshness → keep current, import movements only
}

// Compare statement emission dates (YYYY-MM-DD). Conservative: when we cannot
// prove the incoming statement is at least as new as the current one, we do NOT
// overwrite obligations (the movements still get imported by the caller).
export function decideApplyObligations(
  incomingStatementDate: string | null | undefined,
  currentStatementDate: string | null | undefined,
): ApplyObligationsDecision {
  if (!currentStatementDate) return { apply: true, reason: "no_prior" };
  if (!incomingStatementDate) return { apply: false, reason: "incoming_date_unknown" };
  const inc = Date.parse(incomingStatementDate);
  const cur = Date.parse(currentStatementDate);
  if (!Number.isFinite(inc)) return { apply: false, reason: "incoming_date_unknown" };
  if (!Number.isFinite(cur)) return { apply: true, reason: "no_prior" };
  if (inc > cur) return { apply: true, reason: "newer" };
  if (inc === cur) return { apply: true, reason: "same_date" };
  return { apply: false, reason: "older_statement" };
}

// Whole-days a statement has been outstanding (for "stale statement" health).
export function statementAgeDays(statementDate: string | null | undefined, nowMs: number): number | null {
  if (!statementDate) return null;
  const t = Date.parse(statementDate);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

export type PaymentLabel =
  | "full" // clears the statement balance / full payment due
  | "overpay" // pays more than owed → creates a credit balance
  | "minimum" // ~ the minimum payment
  | "below_minimum" // less than the minimum → fee/late risk
  | "partial" // between minimum and full
  | "unclear"; // not enough data to classify

export interface PaymentClassification {
  label: PaymentLabel;
  coversMinimum: boolean;
  coversFull: boolean;
  createsCredit: boolean;
  remainingAfter: number | null; // balance remaining after this payment (estimate)
  creditAmount: number; // amount overpaid beyond what's owed
}

// Classify a debt/card payment against the known obligations. Pure + honest:
// when `fullPaymentDue` and `minimumPayment` are both unknown we return
// "unclear" rather than guessing.
export function classifyDebtPayment(input: {
  amount: number;
  fullPaymentDue?: number | null;
  minimumPayment?: number | null;
  currentBalance?: number | null;
}): PaymentClassification {
  const amount = roundMoney(Math.max(0, input.amount));
  const full = input.fullPaymentDue != null && input.fullPaymentDue > 0 ? roundMoney(input.fullPaymentDue) : null;
  const min = input.minimumPayment != null && input.minimumPayment > 0 ? roundMoney(input.minimumPayment) : null;
  const owed = full ?? (input.currentBalance != null && input.currentBalance > 0 ? roundMoney(input.currentBalance) : null);
  const EPS = 0.01;

  if (amount <= 0) {
    return { label: "unclear", coversMinimum: false, coversFull: false, createsCredit: false, remainingAfter: null, creditAmount: 0 };
  }

  const remainingAfter = owed != null ? roundMoney(Math.max(0, owed - amount)) : null;
  const creditAmount = owed != null ? roundMoney(Math.max(0, amount - owed)) : 0;
  const coversMinimum = min != null ? amount + EPS >= min : false;
  const coversFull = owed != null ? amount + EPS >= owed : false;

  if (owed == null && min == null) {
    return { label: "unclear", coversMinimum: false, coversFull: false, createsCredit: false, remainingAfter: null, creditAmount: 0 };
  }
  if (owed != null && amount > owed + EPS) {
    return { label: "overpay", coversMinimum: true, coversFull: true, createsCredit: true, remainingAfter: 0, creditAmount };
  }
  if (coversFull) {
    return { label: "full", coversMinimum: true, coversFull: true, createsCredit: false, remainingAfter: remainingAfter ?? 0, creditAmount: 0 };
  }
  if (min != null && Math.abs(amount - min) <= Math.max(EPS, min * 0.05)) {
    return { label: "minimum", coversMinimum: true, coversFull: false, createsCredit: false, remainingAfter, creditAmount: 0 };
  }
  if (min != null && amount + EPS < min) {
    return { label: "below_minimum", coversMinimum: false, coversFull: false, createsCredit: false, remainingAfter, creditAmount: 0 };
  }
  return { label: "partial", coversMinimum, coversFull: false, createsCredit: false, remainingAfter, creditAmount: 0 };
}
