import { roundMoney } from "@/lib/financial/money";
import { monthlyRateDecimal, type RateKind } from "@/lib/financial/interest-math";

// Stage 17 — OPPORTUNITY-COST reasoning. INTERNAL math so Kipu understands the
// tradeoff of moving money between goals/debt/investment/joy; the agent translates
// it SIMPLY (no "opportunity cost" jargon to the user by default). PURE, estimate-
// labeled. Answers "what does $X/week to A cost?" = joy reduced now + how much it
// slows a competing goal + interest avoided if it went to debt instead.

const WEEKS_PER_MONTH = 4.33;

export interface ContributionTradeoff {
  addWeekly: number;
  joyReductionWeekly: number; // it comes straight from discretionary money
  // How much SOONER the funded goal completes (weeks), if a competing/funded goal is given.
  fundedGoalSpeedupWeeks: number | null;
  // How much LATER a competing goal completes if this money is taken from it.
  competingGoalDelayWeeks: number | null;
  // Interest avoided per month if the same money went to high-interest debt.
  debtInterestAvoidedMonthly: number | null;
  verdict: "worth_it" | "balanced" | "reconsider";
  note: string; // structured Spanish fact
}

export function contributionOpportunityCost(input: {
  addWeekly: number;
  // Funded goal (the one receiving the money): remaining + its current weekly.
  fundedRemaining?: number;
  fundedCurrentWeekly?: number;
  // Competing goal the money is taken FROM: remaining + weekly before/after.
  competingRemaining?: number;
  competingWeeklyBefore?: number;
  // High-interest debt context for the "instead pay debt" framing.
  debtBalance?: number;
  debtRatePct?: number;
  debtRateKind?: RateKind;
}): ContributionTradeoff {
  const add = roundMoney(Math.max(0, input.addWeekly));

  const weeksToFill = (remaining: number, weekly: number): number | null =>
    weekly > 0 && remaining > 0 ? Math.ceil(remaining / weekly) : null;

  let fundedGoalSpeedupWeeks: number | null = null;
  if (input.fundedRemaining && input.fundedRemaining > 0) {
    const before = weeksToFill(input.fundedRemaining, input.fundedCurrentWeekly ?? 0);
    const after = weeksToFill(input.fundedRemaining, (input.fundedCurrentWeekly ?? 0) + add);
    if (before != null && after != null) fundedGoalSpeedupWeeks = Math.max(0, before - after);
    else if (before == null && after != null) fundedGoalSpeedupWeeks = null; // went from never to N
  }

  let competingGoalDelayWeeks: number | null = null;
  if (input.competingRemaining && input.competingRemaining > 0 && (input.competingWeeklyBefore ?? 0) > 0) {
    const before = weeksToFill(input.competingRemaining, input.competingWeeklyBefore ?? 0);
    const reduced = Math.max(0, (input.competingWeeklyBefore ?? 0) - add);
    const after = weeksToFill(input.competingRemaining, reduced);
    if (before != null) competingGoalDelayWeeks = after == null ? null : Math.max(0, after - before);
  }

  let debtInterestAvoidedMonthly: number | null = null;
  if (input.debtBalance && input.debtBalance > 0 && input.debtRatePct && input.debtRatePct > 0) {
    // Redirecting add/week ≈ add*4.33/month off the balance avoids ~that month's
    // interest on that slice (estimate).
    const monthlyRate = monthlyRateDecimal(input.debtRatePct, input.debtRateKind ?? "annual_nominal");
    debtInterestAvoidedMonthly = roundMoney(add * WEEKS_PER_MONTH * monthlyRate);
  }

  // Verdict: if redirecting to debt avoids meaningful interest and debt is large,
  // lean "reconsider" (the math favors debt); if it speeds a real goal cheaply
  // without delaying a higher one, "worth_it"; else "balanced".
  let verdict: ContributionTradeoff["verdict"] = "balanced";
  if (debtInterestAvoidedMonthly != null && debtInterestAvoidedMonthly >= add * 0.5) verdict = "reconsider";
  else if (fundedGoalSpeedupWeeks != null && fundedGoalSpeedupWeeks > 0 && (competingGoalDelayWeeks == null || competingGoalDelayWeeks <= fundedGoalSpeedupWeeks)) verdict = "worth_it";

  const bits: string[] = [`son ~${add}/sem que dejan de estar libres para otros gustos`];
  if (competingGoalDelayWeeks && competingGoalDelayWeeks > 0) bits.push(`atrasaría tu otra meta ~${competingGoalDelayWeeks} semana(s)`);
  if (fundedGoalSpeedupWeeks && fundedGoalSpeedupWeeks > 0) bits.push(`adelanta esta meta ~${fundedGoalSpeedupWeeks} semana(s)`);
  if (debtInterestAvoidedMonthly && debtInterestAvoidedMonthly > 0) bits.push(`si en cambio fuera a tu tarjeta, te ahorrarías ~${debtInterestAvoidedMonthly}/mes de interés`);
  return {
    addWeekly: add,
    joyReductionWeekly: add,
    fundedGoalSpeedupWeeks,
    competingGoalDelayWeeks,
    debtInterestAvoidedMonthly,
    verdict,
    note: `${bits.join("; ")}. (estimado)`,
  };
}
