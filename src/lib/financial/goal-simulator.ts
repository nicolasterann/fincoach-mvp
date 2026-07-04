// Stage 33 — goal simulator (pure). Powers the onboarding "plan de metas" step
// (and, reusably, chat/dashboard): given how much is FREE for a goal each month,
// what is the date ⇄ contribution tradeoff, and is it physically feasible?
//
// Bidirectional:
//   • by date  → the monthly you'd need to hit the target by that date
//   • by money → the date you'd reach the target at that monthly
// Plus the feasible frontier (earliest date at full margin, max affordable
// monthly) so the UI can show a RED alert + a one-tap "ajustar a lo posible"
// instead of a hard block — coherent with Kipu's zero-judgment voice.
//
// `availableMonthly` is what's free for THIS goal specifically =
//   monthlyDisposable − savings − investment − OTHER goals' committed contributions.
// All math is divide-by-zero safe and clamps `remaining` at 0.

const DAYS_PER_MONTH = 30.44; // matches goal-planning.ts month math
const MS_PER_DAY = 86_400_000;
// Half a currency unit of slack: 833.00 required vs 833.00 available shouldn't
// flip to "infeasible" on a rounding wobble.
const FEASIBILITY_EPSILON = 0.5;

export type GoalSimStatus =
  | "feasible" // fits with room to spare
  | "tight" // fits, but eats ≥90% of what's free for this goal
  | "infeasible" // needs more per month than is free → red alert + escape
  | "no_margin" // nothing free for this goal at all
  | "achieved" // already funded (current ≥ target)
  | "no_target"; // organize-month / missing amount → no simulation

export interface GoalSimBase {
  targetAmount: number;
  currentAmount: number;
  /** Free for THIS goal each month (disposable − savings − investment − other goals). */
  availableMonthly: number;
  now: Date;
}

export interface GoalSimResult {
  remaining: number;
  /** Months implied by the effective plan (from the chosen date, or derived from money). */
  monthsToTarget: number;
  /** The monthly the plan uses (required-for-date, or the typed contribution). */
  effectiveMonthly: number;
  /** When the target is actually reached at effectiveMonthly (ISO YYYY-MM-DD). */
  reachDateISO: string;
  availableMonthly: number;
  feasible: boolean;
  /** How much the effective monthly overshoots what's free (0 when it fits). */
  overBy: number;
  status: GoalSimStatus;
  // Feasible frontier — the "ajustar a lo posible" one-tap targets:
  /** Soonest date reachable at the FULL available margin (null if nothing is free). */
  earliestFeasibleDateISO: string | null;
  /** The most you could put aside per month (= max(0, availableMonthly)). */
  maxAffordableMonthly: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toISODateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseISO(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Fractional months between now and an ISO date (negative if in the past). null if unparseable. */
export function monthsUntil(now: Date, iso: string): number | null {
  const d = parseISO(iso);
  if (!d) return null;
  return (d.getTime() - now.getTime()) / MS_PER_DAY / DAYS_PER_MONTH;
}

/** ISO date `months` fractional months from now (clamped to ≥0 months). */
export function addMonthsISO(now: Date, months: number): string {
  const m = Math.max(0, months);
  return toISODateLocal(new Date(now.getTime() + m * DAYS_PER_MONTH * MS_PER_DAY));
}

function frontier(base: GoalSimBase, remaining: number): {
  maxAffordableMonthly: number;
  earliestFeasibleDateISO: string | null;
} {
  const maxAffordableMonthly = round2(Math.max(0, base.availableMonthly));
  let earliestFeasibleDateISO: string | null = null;
  if (maxAffordableMonthly > 0 && remaining > 0) {
    earliestFeasibleDateISO = addMonthsISO(base.now, remaining / maxAffordableMonthly);
  }
  return { maxAffordableMonthly, earliestFeasibleDateISO };
}

function noTargetResult(base: GoalSimBase, remaining: number): GoalSimResult {
  const { maxAffordableMonthly, earliestFeasibleDateISO } = frontier(base, remaining);
  return {
    remaining,
    monthsToTarget: 0,
    effectiveMonthly: 0,
    reachDateISO: "",
    availableMonthly: round2(base.availableMonthly),
    feasible: true,
    overBy: 0,
    status: "no_target",
    earliestFeasibleDateISO,
    maxAffordableMonthly,
  };
}

function achievedResult(base: GoalSimBase): GoalSimResult {
  return {
    remaining: 0,
    monthsToTarget: 0,
    effectiveMonthly: 0,
    reachDateISO: toISODateLocal(base.now),
    availableMonthly: round2(base.availableMonthly),
    feasible: true,
    overBy: 0,
    status: "achieved",
    earliestFeasibleDateISO: null,
    maxAffordableMonthly: round2(Math.max(0, base.availableMonthly)),
  };
}

function finalize(
  base: GoalSimBase,
  remaining: number,
  effectiveMonthly: number,
  reachDateISO: string,
  months: number,
): GoalSimResult {
  const available = round2(base.availableMonthly);
  const { maxAffordableMonthly, earliestFeasibleDateISO } = frontier(base, remaining);
  const feasible = effectiveMonthly <= available + FEASIBILITY_EPSILON;
  const overBy = round2(Math.max(0, effectiveMonthly - available));
  let status: GoalSimStatus;
  if (!feasible) status = available <= 0 ? "no_margin" : "infeasible";
  else if (available > 0 && effectiveMonthly >= available * 0.9) status = "tight";
  else status = "feasible";
  return {
    remaining,
    monthsToTarget: round2(months),
    effectiveMonthly: round2(effectiveMonthly),
    reachDateISO,
    availableMonthly: available,
    feasible,
    overBy,
    status,
    earliestFeasibleDateISO,
    maxAffordableMonthly,
  };
}

function remainingOf(base: GoalSimBase): number {
  return round2(Math.max(0, base.targetAmount - base.currentAmount));
}

/** Direction 1: user picks a target DATE → the monthly they'd need. */
export function simulateByDate(base: GoalSimBase, targetDateISO: string): GoalSimResult {
  const remaining = remainingOf(base);
  if (base.targetAmount <= 0) return noTargetResult(base, remaining);
  if (remaining <= 0) return achievedResult(base);
  const target = parseISO(targetDateISO);
  // No/!parseable date → fall back to the earliest feasible plan (full margin), so
  // the card still shows a coherent number instead of NaN.
  if (!target) {
    const months = base.availableMonthly > 0 ? remaining / base.availableMonthly : Infinity;
    const reach = Number.isFinite(months) ? addMonthsISO(base.now, months) : "";
    return finalize(base, remaining, round2(Math.max(0, base.availableMonthly)), reach, Number.isFinite(months) ? months : 0);
  }
  const rawDays = (target.getTime() - base.now.getTime()) / MS_PER_DAY;
  // Floor at ~1 day so "hoy mismo" doesn't divide by zero.
  const months = Math.max(rawDays / DAYS_PER_MONTH, 1 / DAYS_PER_MONTH);
  const requiredMonthly = round2(remaining / months);
  return finalize(base, remaining, requiredMonthly, toISODateLocal(target), months);
}

/** Direction 2: user commits a MONTHLY amount → the date they'd reach it. */
export function simulateByContribution(base: GoalSimBase, monthlyContribution: number): GoalSimResult {
  const remaining = remainingOf(base);
  if (base.targetAmount <= 0) return noTargetResult(base, remaining);
  if (remaining <= 0) return achievedResult(base);
  const monthly = round2(Math.max(0, monthlyContribution));
  if (monthly <= 0) {
    // A zero contribution never arrives — infeasible, no reach date.
    const { maxAffordableMonthly, earliestFeasibleDateISO } = frontier(base, remaining);
    return {
      remaining,
      monthsToTarget: Infinity,
      effectiveMonthly: 0,
      reachDateISO: "",
      availableMonthly: round2(base.availableMonthly),
      feasible: false,
      overBy: 0,
      status: round2(base.availableMonthly) <= 0 ? "no_margin" : "infeasible",
      earliestFeasibleDateISO,
      maxAffordableMonthly,
    };
  }
  const months = remaining / monthly;
  return finalize(base, remaining, monthly, addMonthsISO(base.now, months), months);
}
