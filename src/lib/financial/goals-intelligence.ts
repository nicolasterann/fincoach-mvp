import { roundMoney } from "@/lib/financial/money";
import type { DebtPressureLevel } from "@/lib/financial/debt-pressure";
import type { AmbitionMode, FinancialGoal } from "@/types/financial";
import { buildGoalPortfolio, type GoalPortfolio } from "@/lib/financial/goal-portfolio";
import { buildGoalPlan } from "@/lib/financial/goal-planning";
import type { MargenCapacity } from "@/lib/financial/margen-kipu";
import { allocateExtraCashflow, type AllocationPlan } from "@/lib/financial/allocation-engine";
import { assessAdherence, type AdherenceModel } from "@/lib/financial/psychological-adherence";
import { computeNetWorth, type AssetLike, type NetWorthResult } from "@/lib/financial/net-worth";
import { investmentProjection } from "@/lib/financial/investment-math";
import { annualRatePctFromKind, type RateKind } from "@/lib/financial/interest-math";

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
  /** Capacity picture for a NEW goal: the same conservative flow math as every
   *  goal plan, with EXISTING goals' committed contributions and the investment
   *  commitment already subtracted. `availableMonthlyForNewGoal` is the honest
   *  "free for one more goal each month" scalar the funding advisor quotes —
   *  engine-owned so the model never derives it by mental arithmetic. */
  newGoalCapacity: MargenCapacity;
  availableMonthlyForNewGoal: number;
  /** Re-auditoría 2 (punto 7): la mitad de PATRIMONIO se pudo leer entera. Con
   *  false, `netWorth: null` significa "no pude leer", no "no tiene nada" — y
   *  ningún tool puede afirmar ausencia de activos/inversiones. */
  wealthAvailable: boolean;
}

export interface GoalsIntelligenceInput {
  goals: FinancialGoal[];
  estimatedMonthlyIncome: number;
  estimatedMonthlyFixedExpenses: number;
  monthlyDebtDue: number;
  /** Stage G — Σ active installment plans' monthly load. */
  monthlyInstallments?: number;
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
  // Stage 31 (5.4a) — money in non-goal accounts marked GUARDADA (non-liquid):
  // counts in net worth (never as liquid). Optional (default 0) for back-compat.
  nonLiquidAccountsBase?: number;
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
  /** Veredicto de la lectura de patrimonio (wealthOk). Default true por
   *  back-compat: solo coaching-signals lo cablea. */
  wealthAvailable?: boolean;
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
    newGoalCapacity: {
      monthlyIncome: 0,
      monthlyFixed: 0,
      monthlyDebtService: 0,
      monthlyInstallments: 0,
      monthlyEssentials: 0,
      monthlyDisposableBeforeAllocations: 0,
      monthlyProtected: { savings: 0, investment: 0, goals: 0 },
      monthlyTrulyFree: 0,
    },
    availableMonthlyForNewGoal: 0,
    // El briefing vacío NO probó nada: netWorth null aquí es "no pude leer".
    wealthAvailable: false,
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
    monthlyInstallments: input.monthlyInstallments,
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

  // Stage 31 (5.4b) — an excluded / soft-removed asset (include_in_net_worth =
  // false) is tracked but must NOT count anywhere: not in the "Inversiones"
  // summary, not in the 12-month projection, not in net worth.
  const visibleInvestments = investments.filter((i) => i.includeInNetWorth);
  const nonLiquidAccountsBase = Math.max(0, input.nonLiquidAccountsBase ?? 0);

  // Stage 31 (5.4c) — the wealth-target solver uses the USER-STATED expected
  // returns: value-weighted average across included return-bearing assets
  // (annualized per each asset's rate kind). No stated return → null (the solver
  // stays flat/linear; growth is never fabricated).
  let expectedReturnPct = input.expectedReturnPct ?? null;
  if (expectedReturnPct == null) {
    let weighted = 0;
    let weight = 0;
    for (const i of visibleInvestments) {
      if (i.expectedReturnPct != null && i.expectedReturnPct > 0 && i.valueBase > 0) {
        weighted += annualRatePctFromKind(i.expectedReturnPct, i.returnKind ?? "annual_nominal") * i.valueBase;
        weight += i.valueBase;
      }
    }
    expectedReturnPct = weight > 0 ? weighted / weight : null;
  }

  // Net worth — only when there's something real to total (assets or balances).
  // Re-auditoría 2 (refutación P7): con la mitad de PATRIMONIO no probada, NINGÚN
  // total de patrimonio se computa — un netWorth armado solo con las cuentas
  // publicaba «neto ~$2.000» a alguien con $30.000 invertidos que no se pudieron
  // leer (y el digest lo metía al prompt sin que ningún tool corriera). null aquí
  // apaga la línea del digest y el brazo no-null de net_worth a la vez.
  const wealthUnavailable = input.wealthAvailable === false;
  const hasNetWorthData = !wealthUnavailable && (visibleInvestments.length > 0 || input.liquidAccountsBase > 0 || nonLiquidAccountsBase > 0 || (input.wealthTarget ?? 0) > 0);
  const assets: AssetLike[] = visibleInvestments.map((i) => ({ name: i.name, assetClass: i.assetClass, valueBase: i.valueBase, liquid: i.liquid, includeInNetWorth: i.includeInNetWorth }));
  const netWorth = hasNetWorthData
    ? computeNetWorth({
        liquidAccountsBase: input.liquidAccountsBase,
        nonLiquidAccountsBase,
        totalDebtBase: input.totalDebtBase,
        assets,
        wealthTarget: input.wealthTarget ?? null,
        monthlyContribution: input.monthlyInvestmentContribution,
        expectedAnnualReturnPct: expectedReturnPct ?? undefined,
      })
    : null;

  // Investment summary — project 12 months per INCLUDED asset that has a return
  // (estimate). Excluded assets never inflate the summary (5.4b).
  let investment: GoalsIntelligence["investment"] = null;
  // Mismo veredicto: un resumen de inversiones desde una lista parcial afirma
  // conteo y valor cerrados — con la lectura no probada, no se publica.
  if (!wealthUnavailable && visibleInvestments.length > 0) {
    let totalValue = 0;
    let projected = 0;
    let accrual = 0;
    let hasReturns = false;
    for (const i of visibleInvestments) {
      const v = Math.max(0, i.valueBase);
      totalValue += v;
      const proj = investmentProjection({ startValue: v, rate: i.expectedReturnPct ?? null, rateKind: i.returnKind ?? "annual_nominal", months: 12, contributionPerMonth: i.contributionPerMonth ?? 0 });
      projected += proj.projectedValue;
      accrual += proj.monthlyAccrualNow;
      if (proj.hasRate) hasReturns = true;
    }
    investment = { count: visibleInvestments.length, totalValue: roundMoney(totalValue), projected12mValue: roundMoney(projected), monthlyAccrualNow: roundMoney(accrual), hasReturns };
  }

  const weeklyJoyBudget = roundMoney(Math.max(allocation.discretionaryAfterPlanWeekly, 0));
  // S34: 30/7, the same weeks-per-month the margen recarve uses.
  const newGoalCapacity = buildGoalPlan({
    goal: null,
    estimatedMonthlyIncome: input.estimatedMonthlyIncome,
    estimatedMonthlyFixedExpenses: input.estimatedMonthlyFixedExpenses,
    monthlyDebtDue: input.monthlyDebtDue,
    monthlyInstallments: input.monthlyInstallments,
    flexibleSpending: input.flexibleSpending,
    debtPressureLevel: input.debtPressureLevel,
    baseCurrency: input.baseCurrency,
    essentialMonthlyEstimate: input.essentialMonthlyEstimate,
    essentialsKnown: input.essentialsKnown,
    monthlyInvestmentCommitment: input.monthlyInvestmentContribution,
    monthlyGoalContribution: roundMoney(portfolio.committedWeeklyTotal * (30 / 7)),
    now,
  }).capacity;
  const availableMonthlyForNewGoal = roundMoney(
    Math.max(0, newGoalCapacity.monthlyTrulyFree),
  );
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
    newGoalCapacity,
    availableMonthlyForNewGoal,
    wealthAvailable: input.wealthAvailable ?? true,
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
    lines.push(`REPARTO SUGERIDO DE LA PLATA LIBRE: ${x.allocation.rationale} Frámalo como control y tranquilidad, NUNCA como privación.`);
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
