import { roundMoney } from "@/lib/financial/money";

// Stage 14 — deterministic interest math for cards & debts. PURE and honest:
// every result is an ESTIMATE the caller must label as such. We never invent a
// rate; when the rate is unknown the caller decides whether to ask or to use a
// clearly-labeled assumption. Rates are interpreted via `RateKind`; the stored
// `debt_accounts.interest_rate` is treated as ANNUAL NOMINAL percent by default.

export type RateKind = "annual_nominal" | "annual_effective" | "monthly";

// Monthly interest rate as a decimal (e.g. 0.0375 for ~45%/yr nominal).
export function monthlyRateDecimal(rate: number | null | undefined, kind: RateKind = "annual_nominal"): number {
  if (rate === null || rate === undefined || !Number.isFinite(rate) || rate <= 0) return 0;
  const pct = rate / 100;
  if (kind === "monthly") return pct;
  if (kind === "annual_effective") return Math.pow(1 + pct, 1 / 12) - 1;
  return pct / 12; // annual_nominal
}

export function annualRatePctFromKind(rate: number, kind: RateKind = "annual_nominal"): number {
  if (kind === "annual_nominal" || kind === "annual_effective") return rate;
  return rate * 12; // monthly → annualized nominal
}

// One month's interest cost on a carried balance (estimate).
export function estimateMonthlyInterest(balance: number, rate: number | null | undefined, kind: RateKind = "annual_nominal"): number {
  const b = Math.max(0, balance);
  return roundMoney(b * monthlyRateDecimal(rate, kind));
}

// Approximate cost of waiting `days` before paying (daily-compounded-ish, linear estimate).
export function costOfDelay(balance: number, rate: number | null | undefined, days: number, kind: RateKind = "annual_nominal"): number {
  const b = Math.max(0, balance);
  const monthly = monthlyRateDecimal(rate, kind);
  const daily = monthly / 30;
  return roundMoney(b * daily * Math.max(0, days));
}

export interface PayoffProjection {
  feasible: boolean; // false when the payment can't ever clear the balance
  months: number | null; // null when not feasible
  totalInterest: number; // estimate
  totalPaid: number; // principal + interest estimate
  monthlyPayment: number;
}

// Amortize a fixed monthly payment against a balance at a given rate. Honest
// about the "payment < interest → never pays off" trap. Bounded iteration.
export function payoffProjection(input: {
  balance: number;
  rate: number | null | undefined;
  monthlyPayment: number;
  kind?: RateKind;
}): PayoffProjection {
  const b0 = roundMoney(Math.max(0, input.balance));
  const pay = input.monthlyPayment;
  if (b0 <= 0) return { feasible: true, months: 0, totalInterest: 0, totalPaid: 0, monthlyPayment: pay };
  if (!Number.isFinite(pay) || pay <= 0) {
    return { feasible: false, months: null, totalInterest: 0, totalPaid: b0, monthlyPayment: 0 };
  }
  const r = monthlyRateDecimal(input.rate, input.kind);
  // Payment must exceed the first month's interest, otherwise it never clears.
  if (r > 0 && pay <= b0 * r + 1e-9) {
    return { feasible: false, months: null, totalInterest: 0, totalPaid: b0, monthlyPayment: pay };
  }
  let bal = b0;
  let interestPaid = 0;
  let months = 0;
  const MAX_MONTHS = 1200; // 100-year backstop
  while (bal > 0.005 && months < MAX_MONTHS) {
    const interest = r * bal;
    interestPaid += interest;
    bal = bal + interest - pay;
    months += 1;
    if (bal < 0) bal = 0;
  }
  const feasible = bal <= 0.005;
  return {
    feasible,
    months: feasible ? months : null,
    totalInterest: roundMoney(interestPaid),
    totalPaid: roundMoney(b0 + interestPaid),
    monthlyPayment: pay,
  };
}

// Solve the monthly payment needed to clear `balance` in `months` (estimate).
export function paymentForMonths(input: { balance: number; rate: number | null | undefined; months: number; kind?: RateKind }): number {
  const b0 = Math.max(0, input.balance);
  const n = Math.max(1, Math.floor(input.months));
  if (b0 <= 0) return 0;
  const r = monthlyRateDecimal(input.rate, input.kind);
  if (r <= 0) return roundMoney(b0 / n);
  const factor = Math.pow(1 + r, n);
  return roundMoney((b0 * r * factor) / (factor - 1));
}

export interface PaymentOption {
  label: "full" | "minimum" | "partial";
  amount: number; // the payment applied now (estimate basis)
  monthlyInterestNext: number; // interest that would accrue next month on what remains
  remaining: number; // balance left after this payment
  payoff: PayoffProjection | null; // forward projection if this amount were paid monthly (null for full)
}

// Compare paying FULL vs MINIMUM vs an optional PARTIAL amount on a card balance.
// Pure facts only; the agent phrases them. `minimumPayment`/`partial` may be null.
export function comparePayments(input: {
  balance: number;
  rate: number | null | undefined;
  fullPaymentDue?: number | null;
  minimumPayment?: number | null;
  partial?: number | null;
  kind?: RateKind;
}): { full: PaymentOption; minimum: PaymentOption | null; partial: PaymentOption | null; interestSavedFullVsMin: number | null } {
  const balance = roundMoney(Math.max(0, input.balance));
  const full = roundMoney(Math.max(0, input.fullPaymentDue ?? balance));

  const fullOption: PaymentOption = {
    label: "full",
    amount: full,
    monthlyInterestNext: 0,
    remaining: roundMoney(Math.max(0, balance - full)),
    payoff: null,
  };

  let minimum: PaymentOption | null = null;
  if (input.minimumPayment != null && input.minimumPayment > 0) {
    const remaining = roundMoney(Math.max(0, balance - input.minimumPayment));
    minimum = {
      label: "minimum",
      amount: roundMoney(input.minimumPayment),
      monthlyInterestNext: estimateMonthlyInterest(remaining, input.rate, input.kind),
      remaining,
      payoff: payoffProjection({ balance, rate: input.rate, monthlyPayment: input.minimumPayment, kind: input.kind }),
    };
  }

  let partial: PaymentOption | null = null;
  if (input.partial != null && input.partial > 0) {
    const remaining = roundMoney(Math.max(0, balance - input.partial));
    partial = {
      label: "partial",
      amount: roundMoney(input.partial),
      monthlyInterestNext: estimateMonthlyInterest(remaining, input.rate, input.kind),
      remaining,
      payoff: payoffProjection({ balance, rate: input.rate, monthlyPayment: input.partial, kind: input.kind }),
    };
  }

  // Interest avoided by clearing the balance now vs riding the minimum forever.
  const interestSavedFullVsMin = minimum?.payoff?.feasible ? roundMoney(minimum.payoff.totalInterest) : null;

  return { full: fullOption, minimum, partial, interestSavedFullVsMin };
}
