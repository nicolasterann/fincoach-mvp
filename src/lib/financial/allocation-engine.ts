import { roundMoney } from "@/lib/financial/money";
import type { PortfolioGoal } from "@/lib/financial/goal-portfolio";
import type { AmbitionMode } from "@/types/financial";

// Stage 17 — PRIORITY-AWARE ALLOCATION ENGINE. Decides how the goal-free weekly
// SURPLUS (already net of essentials, fixed, scheduled, debt MINIMUMS, savings &
// investment commitments) is recarved across: emergency-reserve top-up → extra
// high-interest debt → goals by priority → preserved JOY. PURE.
//
// Human-realistic, NOT cold-optimal: it NEVER routes 100% of surplus to debt and
// always preserves a discretionary "joy" floor so the plan is sustainable (a plan
// the user abandons saves nothing). Minimums are reserved UPSTREAM, never here, so
// this can never recommend skipping a minimum. Output is a zero-sum split of
// `availableWeekly`; the goal portion is the recarve that later feeds Margen.

export interface AllocationGoalSlice {
  goalId: string;
  name: string;
  priority: number;
  weekly: number;
  cappedByFeasibility: boolean;
}

export interface AllocationPlan {
  availableWeekly: number; // the goal-free surplus pool
  joyFloorWeekly: number; // preserved for everyday life
  reserveTopUpWeekly: number; // toward emergency reserve when below target
  debtExtraWeekly: number; // beyond minimums (high-interest), capped — never 100%
  byGoal: AllocationGoalSlice[];
  totalGoalWeekly: number;
  discretionaryAfterPlanWeekly: number; // free-to-spend after the plan (≥ joy floor)
  strategy: "balanced" | "debt_aware" | "reserve_first" | "goal_focused";
  rationale: string; // structured Spanish fact for the agent
  confidence: "high" | "medium" | "low";
}

// How much everyday joy to protect, by ambition. A plan that leaves nothing to
// live on fails; power-builders accept a tighter floor, light-touch a generous one.
const JOY_FLOOR_PCT: Record<AmbitionMode, number> = { light_touch: 0.5, steady: 0.35, power_builder: 0.2 };
// Cap on the share of allocatable surplus that may go to EXTRA debt — even with
// high-interest debt we never starve goals/joy entirely (psychological realism).
const DEBT_EXTRA_CAP_PCT: Record<AmbitionMode, number> = { light_touch: 0.4, steady: 0.55, power_builder: 0.7 };

export interface AllocationInput {
  availableWeekly: number;
  goals: PortfolioGoal[]; // sorted by priority; uses plan.requiredWeeklyContribution
  ambitionMode?: AmbitionMode;
  // High-interest debt context (minimums already reserved upstream).
  hasHighInterestDebt?: boolean;
  debtPressure?: "none" | "low" | "medium" | "high" | "critical";
  // Emergency reserve.
  emergencyReserveTarget?: number;
  currentReserve?: number;
  reserveHorizonWeeks?: number; // spread the top-up over N weeks (default 12)
}

export function allocateExtraCashflow(input: AllocationInput): AllocationPlan {
  const ambition = input.ambitionMode ?? "steady";
  // Guard non-finite input (NaN/Infinity from an upstream cashflow with missing
  // data): `NaN <= 0` is false, so without this it would silently propagate NaN
  // into every field. Treat as "no surplus to split".
  const available = Number.isFinite(input.availableWeekly) ? roundMoney(Math.max(0, input.availableWeekly)) : 0;

  if (available <= 0) {
    return {
      availableWeekly: 0,
      joyFloorWeekly: 0,
      reserveTopUpWeekly: 0,
      debtExtraWeekly: 0,
      byGoal: [],
      totalGoalWeekly: 0,
      discretionaryAfterPlanWeekly: 0,
      strategy: "balanced",
      rationale: "No hay plata libre para repartir; primero estabilizamos lo esencial y los mínimos.",
      confidence: "low",
    };
  }

  const joyFloorWeekly = roundMoney(available * JOY_FLOOR_PCT[ambition]);
  let allocatable = roundMoney(available - joyFloorWeekly);

  // 1) Emergency reserve top-up FIRST when below target (protected money).
  let reserveTopUpWeekly = 0;
  const reserveTarget = input.emergencyReserveTarget ?? 0;
  const reserveNow = input.currentReserve ?? 0;
  if (reserveTarget > 0 && reserveNow < reserveTarget && allocatable > 0) {
    const gap = reserveTarget - reserveNow;
    const horizon = Math.max(4, input.reserveHorizonWeeks ?? 12);
    // Take up to ~40% of allocatable toward the reserve gap, spread over horizon.
    reserveTopUpWeekly = roundMoney(Math.min(allocatable * 0.4, gap / horizon));
    allocatable = roundMoney(allocatable - reserveTopUpWeekly);
  }

  // 2) Extra high-interest debt — meaningful but CAPPED (never 100%).
  let debtExtraWeekly = 0;
  if (input.hasHighInterestDebt && allocatable > 0) {
    const pressureBoost = input.debtPressure === "critical" ? 0.15 : input.debtPressure === "high" ? 0.1 : 0;
    const cap = Math.min(0.85, DEBT_EXTRA_CAP_PCT[ambition] + pressureBoost);
    debtExtraWeekly = roundMoney(allocatable * cap);
    allocatable = roundMoney(allocatable - debtExtraWeekly);
  }

  // 3) Goals by priority, each capped at its feasible required weekly.
  const byGoal: AllocationGoalSlice[] = [];
  let remaining = allocatable;
  for (const g of input.goals) {
    if (remaining <= 0.01) break;
    if (g.goal.status !== "active") continue;
    // Suggest funding the GAP (required − already committed), never re-suggest
    // committed money. null gap (no deadline) → a soft share so it still progresses.
    const gap = g.fundingGapWeekly;
    if (gap === 0) continue; // already fully committed → nothing to suggest
    const want = gap != null && gap > 0 ? gap : remaining * 0.5;
    const give = roundMoney(Math.min(want, remaining));
    if (give <= 0.01) continue;
    byGoal.push({
      goalId: g.goal.id,
      name: g.goal.name,
      priority: g.priority,
      weekly: give,
      cappedByFeasibility: gap != null && gap > 0 && give >= gap - 0.01,
    });
    remaining = roundMoney(remaining - give);
  }

  const totalGoalWeekly = roundMoney(byGoal.reduce((s, x) => s + x.weekly, 0));
  // Anything not consumed by goals folds back into discretionary (more joy).
  const discretionaryAfterPlanWeekly = roundMoney(available - reserveTopUpWeekly - debtExtraWeekly - totalGoalWeekly);

  const strategy: AllocationPlan["strategy"] =
    reserveTopUpWeekly > 0 && reserveTopUpWeekly >= totalGoalWeekly ? "reserve_first" : debtExtraWeekly > totalGoalWeekly ? "debt_aware" : totalGoalWeekly > 0 ? "goal_focused" : "balanced";

  const parts: string[] = [];
  if (reserveTopUpWeekly > 0) parts.push(`fondo de emergencia ~${reserveTopUpWeekly}/sem`);
  if (debtExtraWeekly > 0) parts.push(`abono extra a deuda ~${debtExtraWeekly}/sem`);
  if (totalGoalWeekly > 0) parts.push(`metas ~${totalGoalWeekly}/sem`);
  parts.push(`y te dejo ~${roundMoney(Math.max(discretionaryAfterPlanWeekly, joyFloorWeekly))}/sem para vivir`);
  const rationale =
    `De tu plata libre (~${available}/mes) reparto: ${parts.join(", ")}.` +
    (input.hasHighInterestDebt ? " Aunque lo más eficiente sería mandar todo a la tarjeta, dejo un espacio controlado para que el plan sea sostenible." : "");

  return {
    availableWeekly: available,
    joyFloorWeekly,
    reserveTopUpWeekly,
    debtExtraWeekly,
    byGoal,
    totalGoalWeekly,
    discretionaryAfterPlanWeekly,
    strategy,
    rationale,
    confidence: input.goals.length > 0 || available > 0 ? "medium" : "low",
  };
}
