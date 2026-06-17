import { roundMoney } from "@/lib/financial/money";
import { monthlyRateDecimal, type RateKind } from "@/lib/financial/interest-math";

// Stage 17 — INVESTMENT / COMPOUNDING math. PURE and HONEST: every projection is
// an ESTIMATE the caller must label as such. We NEVER invent a rate, a balance,
// or a market price; the user provides the rate (póliza/CD/expected return) or we
// don't project. Reuses the Stage 14 monthly-rate primitive so debt and
// investment interest are interpreted identically. Models compounding growth +
// optional recurring contributions month by month (compound, not simple).

export type Compounding = "monthly" | "quarterly" | "annual";

export interface InvestmentProjection {
  startValue: number;
  months: number;
  contributionPerMonth: number;
  projectedValue: number; // estimate
  totalContributed: number;
  totalGrowth: number; // projectedValue − startValue − totalContributed (interest earned)
  monthlyAccrualNow: number; // this month's interest on the current balance (estimate)
  effectiveAnnualPct: number; // annualized rate used, for transparency
  hasRate: boolean; // false when no usable rate → growth is 0, say so honestly
}

// Convert a per-compounding-period setup into an equivalent monthly decimal rate
// so we can iterate monthly with recurring contributions. We accrue only on the
// compounding boundary to respect the stated frequency.
function periodsPerYear(c: Compounding): number {
  return c === "monthly" ? 12 : c === "quarterly" ? 4 : 1;
}

export function investmentProjection(input: {
  startValue: number;
  rate: number | null | undefined; // percent; interpreted by rateKind
  rateKind?: RateKind;
  months: number;
  contributionPerMonth?: number;
  compounding?: Compounding;
}): InvestmentProjection {
  const start = roundMoney(Math.max(0, input.startValue));
  const months = Math.max(0, Math.floor(input.months));
  const contrib = Math.max(0, input.contributionPerMonth ?? 0);
  const compounding = input.compounding ?? "monthly";
  const monthly = monthlyRateDecimal(input.rate, input.rateKind ?? "annual_nominal");
  const hasRate = monthly > 0;

  // Interest credited at each compounding boundary; contributions added monthly.
  const stepMonths = 12 / periodsPerYear(compounding); // 1, 3, or 12
  // Equivalent rate applied at each boundary so the annual outcome matches.
  const periodRate = hasRate ? Math.pow(1 + monthly, stepMonths) - 1 : 0;

  let bal = start;
  let contributed = 0;
  for (let m = 1; m <= months; m++) {
    bal += contrib;
    contributed += contrib;
    if (hasRate && m % stepMonths === 0) {
      bal += bal * periodRate;
    }
  }
  // If the horizon ends mid-period, credit the partial accrual (estimate) so a
  // 2-month projection on an annual póliza still reflects ~2/12 of a year.
  if (hasRate && months % stepMonths !== 0) {
    const partial = (months % stepMonths) / stepMonths;
    bal += bal * periodRate * partial;
  }

  const projectedValue = roundMoney(bal);
  const totalContributed = roundMoney(contributed);
  const annualPct = hasRate ? roundMoney((Math.pow(1 + monthly, 12) - 1) * 100) : 0;
  return {
    startValue: start,
    months,
    contributionPerMonth: roundMoney(contrib),
    projectedValue,
    totalContributed,
    totalGrowth: roundMoney(projectedValue - start - totalContributed),
    monthlyAccrualNow: roundMoney(start * monthly),
    effectiveAnnualPct: annualPct,
    hasRate,
  };
}

// Loan RECEIVABLE earning interest (money the user lent out at a rate). Same
// compounding model; the "value" is what they're owed, growing over time.
export function receivableProjection(input: {
  principal: number;
  rate: number | null | undefined;
  rateKind?: RateKind;
  months: number;
  compounding?: Compounding;
}): InvestmentProjection {
  return investmentProjection({
    startValue: input.principal,
    rate: input.rate,
    rateKind: input.rateKind,
    months: input.months,
    contributionPerMonth: 0,
    compounding: input.compounding,
  });
}
