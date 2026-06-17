import { roundMoney } from "@/lib/financial/money";
import { classifyMany, type ClassifiedTxn, type IntelTxn } from "@/lib/financial/category-intelligence";
import type { MerchantOverride } from "@/lib/financial/merchant-normalization";
import type { SpendingBaselines } from "@/lib/financial/category-baselines";
import { buildBudgetIntelligence, type BudgetIntelligence } from "@/lib/financial/budget-intelligence";
import { detectSubscriptions, type SubscriptionReport } from "@/lib/financial/subscription-detection";
import { detectAnomalies, type AnomalyReport } from "@/lib/financial/anomaly-detection";
import { buildMarginAttribution, type MarginAttribution } from "@/lib/financial/margin-attribution";
import { buildBehavioralInsights, type BehavioralInsights } from "@/lib/financial/behavioral-insights";

// Stage 16 — SPENDING INTELLIGENCE orchestrator. One call assembles the whole
// "behavioral spending OS": classify every txn (no double counting), learn
// baselines, derive dynamic budgets, detect subscriptions & anomalies, attribute
// margin movement and synthesize the single most useful behavioral insight. It
// returns a compact Spanish DIGEST the agent reads every turn — genius inside,
// simple outside. PURE: deterministic in, structured facts out; the agent
// phrases. Numbers come from the engine, never invented.

export interface SpendingIntelligence {
  windowDays: number;
  spendTxnCount: number;
  baselines: SpendingBaselines;
  budget: BudgetIntelligence;
  subscriptions: SubscriptionReport;
  anomalies: AnomalyReport;
  margin: MarginAttribution;
  insights: BehavioralInsights;
  // Continuous everyday burn learned from real spend (essential + variable
  // categories), monthly — feeds the Stage 15 cashflow only when the user has no
  // configured estimate, and only with non-low confidence.
  learnedMonthlyEssentialBurn: number;
  typicalDailyVariable: number;
  confidence: "high" | "medium" | "low";
  digest: string; // compact agent-facing context (structured facts, never shown raw)
}

// Map the briefing's recent-txn rows into the intelligence input shape.
export function toIntelTxn(row: {
  occurredAtMs: number;
  baseAmount: number;
  type: string;
  category?: string;
  description?: string;
  debtAccountId?: string | null;
  goalId?: string | null;
  categorySource?: string | null;
}): IntelTxn {
  return {
    type: row.type,
    category: row.category ?? "other",
    description: row.description ?? null,
    baseAmount: row.baseAmount,
    occurredAtMs: row.occurredAtMs,
    debtAccountId: row.debtAccountId ?? null,
    goalId: row.goalId ?? null,
    categorySource: row.categorySource ?? null,
  };
}

export function classifyForIntel(rows: IntelTxn[], overrides: MerchantOverride[] = []): ClassifiedTxn[] {
  return classifyMany(rows, overrides);
}

// Continuous everyday burn = ongoing essential + variable categories (food,
// transport, utilities…), monthly. Excludes purely discretionary/subscription
// (those are lumpier and covered by discretionary safe-spend). Cautious: returns
// 0 on low confidence so Kipu never fabricates a burn from tiny data.
export function essentialBurnMonthly(baselines: SpendingBaselines): number {
  if (baselines.confidence === "low") return 0;
  const burn = baselines.categories
    .filter((c) => c.spendingType === "essential" || c.spendingType === "variable")
    .reduce((sum, c) => sum + c.monthlyAvg, 0);
  return roundMoney(burn);
}

// Neutral, coherent intelligence for fallback paths (agent emptyBriefing, gate
// stubs) — no patterns asserted, low confidence, nothing to surface.
export function emptySpendingIntelligence(): SpendingIntelligence {
  const baselines: SpendingBaselines = {
    windowDays: 35,
    txnCount: 0,
    totalSpend: 0,
    controllableSpend: 0,
    typicalDailyVariable: 0,
    categories: [],
    topByImpact: [],
    confidence: "low",
  };
  return {
    windowDays: 35,
    spendTxnCount: 0,
    baselines,
    budget: { signals: [], overCategories: [], oneAdjustment: null, safeThisWeek: 0, confidence: "low" },
    subscriptions: { subscriptions: [], estimatedMonthlyTotal: 0, unmodeledCount: 0, confidence: "low" },
    anomalies: { anomalies: [], topConcern: null, confidence: "low" },
    margin: { hasSnapshot: false, basis: "Aún no tengo suficiente historial.", spendingUpWeekly: 0, drivers: [], headline: null, confidence: "low" },
    insights: {
      insights: [],
      theOneThing: null,
      positive: false,
      confidence: "low",
    },
    learnedMonthlyEssentialBurn: 0,
    typicalDailyVariable: 0,
    confidence: "low",
    digest: "INTELIGENCIA DE GASTO: aún no disponible este turno; no afirmes patrones de gasto.",
  };
}

export function buildSpendingIntelligence(input: {
  classified: ClassifiedTxn[];
  baselines: SpendingBaselines;
  nowMs: number;
  safeThisWeek: number;
  existingFixedNames: string[];
}): SpendingIntelligence {
  const { classified, baselines, nowMs, safeThisWeek, existingFixedNames } = input;

  const budget = buildBudgetIntelligence(baselines, classified, nowMs, safeThisWeek);
  const subscriptions = detectSubscriptions(classified, nowMs, existingFixedNames);
  const anomalies = detectAnomalies(classified, baselines, nowMs, safeThisWeek);
  const margin = buildMarginAttribution(budget, subscriptions, anomalies, baselines);
  const insights = buildBehavioralInsights(baselines, budget, subscriptions, anomalies, margin, safeThisWeek);

  const digest = buildIntelDigest({ baselines, budget, subscriptions, anomalies, margin, insights });

  return {
    windowDays: baselines.windowDays,
    spendTxnCount: baselines.txnCount,
    baselines,
    budget,
    subscriptions,
    anomalies,
    margin,
    insights,
    learnedMonthlyEssentialBurn: essentialBurnMonthly(baselines),
    typicalDailyVariable: baselines.typicalDailyVariable,
    confidence: baselines.confidence,
    digest,
  };
}

function buildIntelDigest(x: {
  baselines: SpendingBaselines;
  budget: BudgetIntelligence;
  subscriptions: SubscriptionReport;
  anomalies: AnomalyReport;
  margin: MarginAttribution;
  insights: BehavioralInsights;
}): string {
  // Too little data → say so, don't fake patterns.
  if (x.baselines.confidence === "low" && x.baselines.txnCount < 8) {
    return `INTELIGENCIA DE GASTO: aún estoy aprendiendo el "normal" de este usuario (pocos movimientos: ${x.baselines.txnCount}). No afirmes patrones, presupuestos ni suscripciones con certeza; si ayuda, invita suave a registrar para afinar.`;
  }

  const lines: string[] = [];

  // THE one thing (simple outside) — lead with this, naturally, no jerga.
  const one = x.insights.theOneThing;
  if (one) {
    lines.push(
      `LO QUE MÁS IMPORTA HOY (díselo SIMPLE y humano, una idea; no recites números ni listas salvo que pregunte): ${one.title}${one.suggestedAction ? ` — acción sugerida: ${one.suggestedAction}` : ""}${one.detail ? ` (${one.detail})` : ""}`,
    );
  }

  // Budget intelligence: only the few categories that matter, tied to safe spend.
  if (x.budget.overCategories.length) {
    const tops = x.budget.overCategories
      .slice(0, 2)
      .map((s) => `${s.parentCategory} ~${Math.round(s.pctVsNormal * 100)}% arriba de su normal (proyecta ${s.projectedThisWeek} vs ${s.normalWeekly})`)
      .join("; ");
    const adj = x.budget.oneAdjustment;
    lines.push(
      `PRESUPUESTO DINÁMICO (sin sermón): ${tops}.${adj ? ` Un ajuste de ~${adj.saving} en ${adj.categories.join(" + ")} reencauza la semana.` : ""} Frámalo como control, nunca como fracaso.`,
    );
  } else if (x.baselines.confidence !== "low") {
    lines.push("PRESUPUESTO DINÁMICO: el usuario va dentro de su normal esta semana; si pregunta, confírmalo tranquilo.");
  }

  // Subscriptions worth converting (ask, never auto-create).
  const convertible = x.subscriptions.subscriptions.filter((s) => s.suggestConvert);
  if (convertible.length) {
    const s = convertible[0];
    lines.push(
      `SUSCRIPCIONES: detecté ${convertible.length} cargo(s) recurrente(s) no modelado(s) como fijo. Ej.: ${s.merchantFamily} ~${s.amount} cada ${s.cadence === "weekly" ? "semana" : s.cadence === "biweekly" ? "quincena" : "mes"}${s.nextChargeISO ? `, próximo ~${s.nextChargeISO}` : ""}. Si encaja, PREGUNTA si lo trato como gasto fijo; no lo crees solo.`,
    );
  }
  if (x.subscriptions.estimatedMonthlyTotal > 0) {
    lines.push(`Gasto recurrente estimado: ~${x.subscriptions.estimatedMonthlyTotal}/mes en suscripciones detectadas (úsalo solo si pregunta "en qué se va mi plata").`);
  }

  // Margin attribution (honest basis).
  if (x.margin.headline) {
    lines.push(`POR QUÉ CAMBIÓ EL MARGEN (si pregunta): ${x.margin.headline.note} ${x.margin.basis}`);
  }

  // Anomalies (graded, quiet).
  if (x.anomalies.topConcern) {
    const a = x.anomalies.topConcern;
    lines.push(`A VIGILAR (sin alarmar, una vez): ${a.note}`);
  }

  // Where the money goes — top categories by real impact, for "¿en qué se me va?".
  const top = x.baselines.topByImpact.slice(0, 3).map((c) => `${c.parentCategory} ~${c.monthlyAvg}/mes`).join(", ");
  if (top) lines.push(`EN QUÉ SE VA (controlable, aprox/mes — usa si pregunta): ${top}. Confianza del análisis: ${x.baselines.confidence}.`);

  lines.push("REGLA: transferencias, pagos de tarjeta, reembolsos e ingresos NO son gasto; nunca los cuentes como gasto ni dupliques statement+registro.");
  return ["INTELIGENCIA DE GASTO (genio adentro, simple afuera):", ...lines].join("\n");
}
