import { roundMoney } from "@/lib/financial/money";
import type { DebtPressureLevel } from "@/lib/financial/debt-pressure";
import type { AmbitionMode, FinancialGoal } from "@/types/financial";
import { buildGoalPortfolio, type GoalPortfolio } from "@/lib/financial/goal-portfolio";
import { allocateExtraCashflow, type AllocationPlan } from "@/lib/financial/allocation-engine";
import { assessAdherence, type AdherenceModel } from "@/lib/financial/psychological-adherence";
import { computeNetWorth, type AssetLike, type NetWorthResult } from "@/lib/financial/net-worth";
import { investmentProjection } from "@/lib/financial/investment-math";
import type { RateKind } from "@/lib/financial/interest-math";

// Stage 17 — GOALS INTELLIGENCE orchestrator. One call assembles the whole
// "personal system for turning money into goals": a prioritized goal portfolio,
// a human-realistic allocation of the free surplus (controlled joy preserved), an
// adherence read, net worth + wealth-target progress, and an investment summary —
// plus a compact Spanish DIGEST the agent reads every turn (genius inside, simple
// outside). PURE. The committedWeeklyTotal it exposes is the recarve scalar that
// feeds Margen/cashflow; everything else is advisory truth for the AI to phrase.

export interface InvestmentInput {
  name: string;
  assetClass: AssetLike["assetClass"];
  valueBase: number;
  liquid: boolean;
  includeInNetWorth: boolean;
  expectedReturnPct?: number | null;
  returnKind?: RateKind;
  contributionPerMonth?: number;
}

export interface GoalsIntelligence {
  portfolio: GoalPortfolio;
  allocation: AllocationPlan;
  adherence: AdherenceModel;
  netWorth: NetWorthResult | null;
  investment: { count: number; totalValue: number; projected12mValue: number; monthlyAccrualNow: number; hasReturns: boolean } | null;
  committedWeeklyTotal: number; // recarve scalar → Margen/cashflow
  weeklyJoyBudget: number; // discretionary after the plan — for impulse-safe buys
  miniGoalEligible: boolean;
  ambitionMode: AmbitionMode;
  wealthTarget: number | null;
  confidence: "high" | "medium" | "low";
  digest: string;
}

export interface GoalsIntelligenceInput {
  goals: FinancialGoal[];
  estimatedMonthlyIncome: number;
  estimatedMonthlyFixedExpenses: number;
  monthlyDebtDue: number;
  flexibleSpending: number;
  debtPressureLevel: DebtPressureLevel;
  baseCurrency: string;
  // Everyday essential burn (monthly) + whether it's really known — so goal
  // capacity subtracts the SAME essentials the cashflow does. Optional (default
  // 0/known) for backward compatibility.
  essentialMonthlyEstimate?: number;
  essentialsKnown?: boolean;
  safeThisWeek: number; // post-commitment free surplus (from cashflow)
  liquidAccountsBase: number;
  totalDebtBase: number;
  hasHighInterestDebt?: boolean;
  investments?: InvestmentInput[];
  wealthTarget?: number | null;
  monthlyInvestmentContribution?: number;
  expectedReturnPct?: number | null;
  ambitionMode?: AmbitionMode;
  emergencyReserveTarget?: number;
  currentReserve?: number;
  nowMs: number;
}

export function emptyGoalsIntelligence(): GoalsIntelligence {
  return {
    portfolio: { goals: [], primary: null, miniGoals: [], activeCount: 0, committedWeeklyTotal: 0, conflicts: [], confidence: "low" },
    allocation: { availableWeekly: 0, joyFloorWeekly: 0, reserveTopUpWeekly: 0, debtExtraWeekly: 0, byGoal: [], totalGoalWeekly: 0, discretionaryAfterPlanWeekly: 0, strategy: "balanced", rationale: "Sin datos de metas todavía.", confidence: "low" },
    adherence: { miniGoalEligible: false, eligibilityReason: "aún sin datos", joyQuotient: 0.35, recommendedAmbition: "steady", slipRisk: "low", slipNote: "", allowControlledJoy: true },
    netWorth: null,
    investment: null,
    committedWeeklyTotal: 0,
    weeklyJoyBudget: 0,
    miniGoalEligible: false,
    ambitionMode: "steady",
    wealthTarget: null,
    confidence: "low",
    digest: "METAS: aún no disponible este turno; no afirmes planes de metas.",
  };
}

export function buildGoalsIntelligence(input: GoalsIntelligenceInput): GoalsIntelligence {
  const now = new Date(input.nowMs);
  const ambitionMode = input.ambitionMode ?? "steady";
  const investments = input.investments ?? [];

  const portfolio = buildGoalPortfolio({
    goals: input.goals,
    estimatedMonthlyIncome: input.estimatedMonthlyIncome,
    estimatedMonthlyFixedExpenses: input.estimatedMonthlyFixedExpenses,
    monthlyDebtDue: input.monthlyDebtDue,
    flexibleSpending: input.flexibleSpending,
    debtPressureLevel: input.debtPressureLevel,
    baseCurrency: input.baseCurrency,
    surplusWeekly: input.safeThisWeek,
    essentialMonthlyEstimate: input.essentialMonthlyEstimate,
    essentialsKnown: input.essentialsKnown,
    emergencyReserveTarget: input.emergencyReserveTarget,
    currentReserve: input.currentReserve,
    now,
  });

  const allocation = allocateExtraCashflow({
    availableWeekly: input.safeThisWeek,
    goals: portfolio.goals,
    ambitionMode,
    hasHighInterestDebt: input.hasHighInterestDebt,
    debtPressure: input.debtPressureLevel,
    emergencyReserveTarget: input.emergencyReserveTarget,
    currentReserve: input.currentReserve,
  });

  const adherence = assessAdherence({
    ambitionMode,
    mainGoalStatus: portfolio.primary?.plan.status ?? null,
    activeGoalCount: portfolio.activeCount,
    discretionaryWeekly: allocation.discretionaryAfterPlanWeekly,
    safeWeekly: input.safeThisWeek,
    debtPressure: input.debtPressureLevel,
  });

  // Net worth — only when there's something real to total (assets or balances).
  const hasNetWorthData = investments.length > 0 || input.liquidAccountsBase > 0 || (input.wealthTarget ?? 0) > 0;
  const assets: AssetLike[] = investments.map((i) => ({ name: i.name, assetClass: i.assetClass, valueBase: i.valueBase, liquid: i.liquid, includeInNetWorth: i.includeInNetWorth }));
  const netWorth = hasNetWorthData
    ? computeNetWorth({
        liquidAccountsBase: input.liquidAccountsBase,
        totalDebtBase: input.totalDebtBase,
        assets,
        wealthTarget: input.wealthTarget ?? null,
        monthlyContribution: input.monthlyInvestmentContribution,
        expectedAnnualReturnPct: input.expectedReturnPct ?? undefined,
      })
    : null;

  // Investment summary — project 12 months per asset that has a return (estimate).
  let investment: GoalsIntelligence["investment"] = null;
  if (investments.length > 0) {
    let totalValue = 0;
    let projected = 0;
    let accrual = 0;
    let hasReturns = false;
    for (const i of investments) {
      const v = Math.max(0, i.valueBase);
      totalValue += v;
      const proj = investmentProjection({ startValue: v, rate: i.expectedReturnPct ?? null, rateKind: i.returnKind ?? "annual_nominal", months: 12, contributionPerMonth: i.contributionPerMonth ?? 0 });
      projected += proj.projectedValue;
      accrual += proj.monthlyAccrualNow;
      if (proj.hasRate) hasReturns = true;
    }
    investment = { count: investments.length, totalValue: roundMoney(totalValue), projected12mValue: roundMoney(projected), monthlyAccrualNow: roundMoney(accrual), hasReturns };
  }

  const weeklyJoyBudget = roundMoney(Math.max(allocation.discretionaryAfterPlanWeekly, 0));
  const digest = buildGoalsDigest({ portfolio, allocation, adherence, netWorth, investment, ambitionMode, weeklyJoyBudget, baseCurrency: input.baseCurrency });

  return {
    portfolio,
    allocation,
    adherence,
    netWorth,
    investment,
    committedWeeklyTotal: portfolio.committedWeeklyTotal,
    weeklyJoyBudget,
    miniGoalEligible: adherence.miniGoalEligible,
    ambitionMode,
    wealthTarget: input.wealthTarget ?? null,
    confidence: portfolio.confidence,
    digest,
  };
}

function buildGoalsDigest(x: {
  portfolio: GoalPortfolio;
  allocation: AllocationPlan;
  adherence: AdherenceModel;
  netWorth: NetWorthResult | null;
  investment: GoalsIntelligence["investment"];
  ambitionMode: AmbitionMode;
  weeklyJoyBudget: number;
  baseCurrency: string;
}): string {
  const lines: string[] = [];

  if (x.portfolio.activeCount === 0) {
    lines.push("El usuario aún no tiene metas activas. Si menciona un objetivo o una compra, ofrécele crearla como meta o mini-meta (pregunta monto/fecha solo si hace falta).");
  } else {
    if (x.portfolio.primary) {
      const p = x.portfolio.primary;
      lines.push(`META PRINCIPAL: "${p.goal.name}" (${p.plan.statusLabel}, ${p.progressPct}%). ${p.plan.requiredWeeklyContribution != null ? `Para llegar a tiempo: ~${p.plan.requiredWeeklyContribution}/sem.` : ""} Protégela: si algo debe ceder, primero ceden las metas opcionales.`);
    }
    const others = x.portfolio.goals.filter((g) => !g.isPrimary);
    if (others.length) lines.push(`OTRAS METAS (${others.length}, por prioridad): ${others.slice(0, 4).map((g) => `${g.goal.name}${g.goalType === "mini" ? " (mini)" : ""} ${g.progressPct}%`).join(", ")}.`);
  }

  // Allocation — human-realistic split (controlled joy preserved).
  if (x.allocation.availableWeekly > 0) {
    lines.push(`REPARTO SUGERIDO DEL MARGEN LIBRE: ${x.allocation.rationale} Frámalo como control y tranquilidad, NUNCA como privación.`);
    lines.push(`PRESUPUESTO DE GUSTOS (impulse-safe): ~${x.weeklyJoyBudget}/sem libres para darse gustos sin tocar pagos ni metas. Úsalo para evaluar compras: si algo cabe ahí, se puede; si no, ofrece mini-meta.`);
  }

  // Conflicts (cautious).
  if (x.portfolio.conflicts.length) {
    lines.push(`A CUIDAR: ${x.portfolio.conflicts.slice(0, 2).map((c) => c.note).join(" ")}`);
  }

  // Adherence guardrail.
  if (x.adherence.slipRisk !== "low") lines.push(`ADHERENCIA: ${x.adherence.slipNote}. Ajusta el ritmo, no exijas de más.`);
  if (!x.adherence.miniGoalEligible) lines.push(`Mini-metas nuevas no recomendadas ahora: ${x.adherence.eligibilityReason}.`);

  // Net worth / wealth target.
  if (x.netWorth) {
    lines.push(`PATRIMONIO (estimado): neto ~${x.netWorth.totalNetWorth} (líquido ~${x.netWorth.liquidNetWorth}).${x.netWorth.wealthTarget ? ` Meta de patrimonio ${x.netWorth.wealthTarget}: ${x.netWorth.wealthProgressPct}%${x.netWorth.requiredMonthlyForTarget != null ? `, requiere ~${x.netWorth.requiredMonthlyForTarget}/mes` : ""}.` : ""} Todo ESTIMADO; dilo así.`);
  }
  if (x.investment) {
    lines.push(`INVERSIONES (estimado): ${x.investment.count} registrada(s), valor ~${x.investment.totalValue}${x.investment.hasReturns ? `, proyección 12m ~${x.investment.projected12mValue}` : " (sin rendimiento informado → no proyecto crecimiento)"}. NUNCA inventes precios, rendimientos ni valores de mercado; jamás recomiendes un activo específico.`);
  }

  lines.push("REGLA: una contribución a meta/inversión NO es gasto; nunca dupliques aporte vs transferencia vs reserva. Nunca sugieras saltarte un mínimo de tarjeta/deuda por una meta. Responde SIMPLE: ¿se puede? ¿qué afecta? mejor plan, aporte semanal, fecha.");
  return ["INTELIGENCIA DE METAS (genio adentro, simple afuera):", ...lines].join("\n");
}
