import { roundMoney } from "@/lib/financial/money";
import { buildGoalPlan, type GoalPlan } from "@/lib/financial/goal-planning";
import type { DebtPressureLevel } from "@/lib/financial/debt-pressure";
import type { FinancialGoal, GoalArchetype, GoalCadence, GoalType } from "@/types/financial";

// Stage 17 — GOAL PORTFOLIO. Turns the single-main-goal world into a prioritized
// set of goals (primary / secondary / mini / milestone) WITHOUT touching the
// validated single-goal planner: it calls buildGoalPlan PER goal and layers
// priority, committed-reservation accounting and conflict detection on top. PURE.
// The committedWeeklyTotal is the ONE number that later becomes the goal reserve
// fed to Margen/cashflow (the zero-sum recarve) — only goals with an explicit,
// active, cashflow-protected committed contribution reserve money.

const WEEKS_PER_MONTH = 4.33;

export interface PortfolioGoal {
  goal: FinancialGoal;
  plan: GoalPlan;
  goalType: GoalType;
  archetype: GoalArchetype;
  priority: number; // effective; 1 = highest
  isPrimary: boolean;
  parentGoalId: string | null;
  progressPct: number;
  // Committed per-week reservation (0 when the user hasn't committed a cadence/
  // amount). Only counted when status active + cashflowProtected.
  committedWeekly: number;
  cashflowProtected: boolean;
  // Remaining weekly funding the allocation engine may SUGGEST from free surplus:
  // max(0, requiredWeekly − committedWeekly). null ⇒ no deadline → soft share.
  fundingGapWeekly: number | null;
}

export interface GoalConflict {
  kind:
    | "too_many_active"
    | "deadline_unrealistic"
    | "contributions_exceed_surplus"
    | "mini_slows_main"
    | "emergency_reserve_low";
  goalIds: string[];
  severity: "info" | "watch" | "high";
  note: string; // structured Spanish fact for the agent to rephrase
}

export interface GoalPortfolio {
  goals: PortfolioGoal[]; // active, sorted by effective priority
  primary: PortfolioGoal | null;
  miniGoals: PortfolioGoal[];
  activeCount: number;
  committedWeeklyTotal: number; // the recarve scalar (only committed+protected)
  conflicts: GoalConflict[];
  confidence: "high" | "medium" | "low";
}

export interface GoalPortfolioInput {
  goals: FinancialGoal[];
  estimatedMonthlyIncome: number;
  estimatedMonthlyFixedExpenses: number;
  monthlyDebtDue: number;
  flexibleSpending: number;
  debtPressureLevel: DebtPressureLevel;
  baseCurrency: string;
  // Weekly surplus available for goals (goal-free), for conflict detection.
  surplusWeekly: number;
  // Everyday essential burn (monthly) + whether it's really known — threaded into
  // each goal plan so capacity agrees with the cashflow. Optional (default 0/known).
  essentialMonthlyEstimate?: number;
  essentialsKnown?: boolean;
  emergencyReserveTarget?: number;
  currentReserve?: number;
  now?: Date;
}

export function cadenceToWeekly(amount: number, cadence: GoalCadence | undefined): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  switch (cadence) {
    case "weekly":
      return roundMoney(amount);
    case "biweekly":
      return roundMoney(amount / 2);
    case "monthly":
      return roundMoney(amount / WEEKS_PER_MONTH);
    // one_time / flexible / undefined are not standing weekly reservations.
    default:
      return 0;
  }
}

function effectivePriority(goal: FinancialGoal, index: number): number {
  if (goal.isPrimary || goal.goalType === "primary") return 1;
  if (typeof goal.priority === "number" && goal.priority > 0) return goal.priority + 1; // keep primary ahead
  // Mini-goals default to lower priority than unranked secondary goals.
  if (goal.goalType === "mini") return 100 + index;
  return 50 + index;
}

export function buildGoalPortfolio(input: GoalPortfolioInput): GoalPortfolio {
  const now = input.now ?? new Date();
  const active = input.goals.filter((g) => g.status === "active");

  const portfolioGoals: PortfolioGoal[] = active.map((goal, index) => {
    const plan = buildGoalPlan({
      goal,
      estimatedMonthlyIncome: input.estimatedMonthlyIncome,
      estimatedMonthlyFixedExpenses: input.estimatedMonthlyFixedExpenses,
      monthlyDebtDue: input.monthlyDebtDue,
      flexibleSpending: input.flexibleSpending,
      debtPressureLevel: input.debtPressureLevel,
      baseCurrency: input.baseCurrency,
      essentialMonthlyEstimate: input.essentialMonthlyEstimate,
      essentialsKnown: input.essentialsKnown,
      now,
    });
    const goalType: GoalType = goal.goalType ?? (goal.parentGoalId ? "mini" : "primary");
    const cashflowProtected = goal.cashflowProtected !== false; // default protected
    const committedWeekly = cashflowProtected ? cadenceToWeekly(goal.contributionAmount ?? 0, goal.cadence) : 0;
    const requiredWeekly = plan.requiredWeeklyContribution;
    const fundingGapWeekly = requiredWeekly != null && requiredWeekly > 0 ? roundMoney(Math.max(0, requiredWeekly - committedWeekly)) : null;
    return {
      goal,
      plan,
      goalType,
      archetype: goal.archetype ?? "custom",
      priority: effectivePriority(goal, index),
      isPrimary: goal.isPrimary === true || goalType === "primary",
      parentGoalId: goal.parentGoalId ?? null,
      progressPct: plan.progressPercentage,
      committedWeekly,
      cashflowProtected,
      fundingGapWeekly,
    };
  });

  portfolioGoals.sort((a, b) => a.priority - b.priority || b.progressPct - a.progressPct);

  // Primary: explicit isPrimary, else a "primary" type, else the highest-priority
  // NON-mini goal (a mini-goal must never be picked as the main goal).
  const primary =
    portfolioGoals.find((g) => g.isPrimary) ??
    portfolioGoals.find((g) => g.goalType === "primary") ??
    portfolioGoals.find((g) => g.goalType !== "mini") ??
    null;
  const miniGoals = portfolioGoals.filter((g) => g.goalType === "mini");

  const committedWeeklyTotal = roundMoney(portfolioGoals.reduce((sum, g) => sum + g.committedWeekly, 0));

  // ── Conflicts (cautious, actionable) ──────────────────────────────────────
  const conflicts: GoalConflict[] = [];
  const nonMiniActive = portfolioGoals.filter((g) => g.goalType !== "mini");
  if (nonMiniActive.length >= 4) {
    conflicts.push({
      kind: "too_many_active",
      goalIds: nonMiniActive.map((g) => g.goal.id),
      severity: "watch",
      note: `Hay ${nonMiniActive.length} metas grandes compitiendo por el mismo dinero; conviene enfocar 1–2 y poner el resto en pausa o flexibles.`,
    });
  }
  if (input.surplusWeekly > 0 && committedWeeklyTotal > input.surplusWeekly + 0.5) {
    conflicts.push({
      kind: "contributions_exceed_surplus",
      goalIds: portfolioGoals.filter((g) => g.committedWeekly > 0).map((g) => g.goal.id),
      severity: "high",
      note: `Los aportes comprometidos (~${committedWeeklyTotal}/sem) superan tu margen disponible (~${roundMoney(input.surplusWeekly)}/sem); hay que bajar un aporte, extender un plazo o pausar una meta.`,
    });
  }
  for (const g of portfolioGoals) {
    if (g.plan.status === "not_realistic" && g.goalType !== "mini") {
      conflicts.push({
        kind: "deadline_unrealistic",
        goalIds: [g.goal.id],
        severity: "watch",
        note: `"${g.goal.name}" no es alcanzable con la fecha actual; extender el plazo o ajustar el monto la vuelve viable.`,
      });
    }
  }
  if (primary && miniGoals.some((m) => m.committedWeekly > 0) && primary.plan.status === "at_risk") {
    conflicts.push({
      kind: "mini_slows_main",
      goalIds: [primary.goal.id, ...miniGoals.filter((m) => m.committedWeekly > 0).map((m) => m.goal.id)],
      severity: "watch",
      note: `Tu meta principal "${primary.goal.name}" va en riesgo mientras hay mini-metas activas; quizá pausar una mini-meta la reencauza.`,
    });
  }
  if (input.emergencyReserveTarget && input.emergencyReserveTarget > 0 && (input.currentReserve ?? 0) < input.emergencyReserveTarget * 0.5) {
    conflicts.push({
      kind: "emergency_reserve_low",
      goalIds: [],
      severity: "watch",
      note: `Tu fondo de emergencia está por debajo de la mitad de tu objetivo; vale priorizar reconstruirlo antes de acelerar metas opcionales.`,
    });
  }

  const confidence: GoalPortfolio["confidence"] =
    input.estimatedMonthlyIncome > 0 && active.length > 0 ? (input.estimatedMonthlyFixedExpenses > 0 || input.monthlyDebtDue > 0 ? "high" : "medium") : "low";

  return {
    goals: portfolioGoals,
    primary,
    miniGoals,
    activeCount: active.length,
    committedWeeklyTotal,
    conflicts,
    confidence,
  };
}
