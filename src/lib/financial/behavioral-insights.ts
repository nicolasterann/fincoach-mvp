import { roundMoney } from "@/lib/financial/money";
import type { SpendingBaselines } from "@/lib/financial/category-baselines";
import type { BudgetIntelligence } from "@/lib/financial/budget-intelligence";
import type { SubscriptionReport } from "@/lib/financial/subscription-detection";
import type { AnomalyReport } from "@/lib/financial/anomaly-detection";
import type { MarginAttribution } from "@/lib/financial/margin-attribution";
import type { FinancialCategory } from "@/types/financial";

// Stage 16 — BEHAVIORAL INSIGHTS: the synthesis layer. All the intelligence
// modules produce structured signals; this ranks them by how USEFUL they are to
// the user right now (actionability × cashflow impact × confidence) and picks
// THE one thing worth saying. "Genius inside, simple outside": internally we
// computed baselines, budgets, subscriptions, anomalies and margin drivers —
// externally Kipu leads with a single, kind, practical nudge. PURE.

export type InsightKind =
  | "budget_over"
  | "margin_driver"
  | "subscription_unmodeled"
  | "anomaly"
  | "duplicate"
  | "category_trend"
  | "on_track"
  | "low_data";

export interface BehavioralInsight {
  kind: InsightKind;
  title: string; // short structured Spanish fact (agent rephrases, never shown raw)
  detail: string; // the "why it matters / what to do"
  category: FinancialCategory | null;
  parentCategory: string | null;
  merchantFamily: string | null;
  amount: number | null;
  actionable: boolean;
  suggestedAction: string | null; // the concrete small move ("baja $18 en delivery")
  cashflowImpact: number; // 0..1 share of this week's safe spend it touches
  usefulness: number; // ranking score
  confidence: "high" | "medium" | "low";
}

export interface BehavioralInsights {
  insights: BehavioralInsight[]; // ranked, most useful first
  theOneThing: BehavioralInsight | null; // the single lead nudge (simple outside)
  positive: boolean; // true when the lead is encouraging, not corrective
  confidence: "high" | "medium" | "low";
}

const KIND_WEIGHT: Record<InsightKind, number> = {
  duplicate: 1.0,
  margin_driver: 0.9,
  budget_over: 0.85,
  subscription_unmodeled: 0.8,
  anomaly: 0.7,
  category_trend: 0.5,
  on_track: 0.4,
  low_data: 0.2,
};
// Urgency TIER drives ranking before the (softer) usefulness score: money-safety
// and things-to-check (a possible duplicate, a notable anomaly) lead over soft
// budget/margin guidance, which leads over informational trends. Within a tier,
// usefulness (impact × confidence) decides — so a large one-off still outranks a
// duplicate, but a routine budget overage never buries a possible double charge.
const KIND_TIER: Record<InsightKind, number> = {
  duplicate: 3,
  anomaly: 3,
  margin_driver: 2,
  budget_over: 2,
  subscription_unmodeled: 2,
  category_trend: 1,
  on_track: 1,
  low_data: 0,
};
const CONF_MULT = { high: 1, medium: 0.8, low: 0.55 } as const;

export function buildBehavioralInsights(
  baselines: SpendingBaselines,
  budgetIntel: BudgetIntelligence,
  subscriptions: SubscriptionReport,
  anomalies: AnomalyReport,
  margin: MarginAttribution,
  safeThisWeek: number,
): BehavioralInsights {
  const safe = Math.max(0, safeThisWeek);
  const impactOf = (amt: number) => (safe > 0 ? Math.min(1, roundMoney(Math.abs(amt) / safe)) : 0);
  const score = (kind: InsightKind, impact: number, conf: "high" | "medium" | "low") =>
    roundMoney((KIND_WEIGHT[kind] + impact * 1.5) * CONF_MULT[conf]);

  const insights: BehavioralInsight[] = [];

  // Duplicate-looking charge — highest-signal, cheapest to act on.
  const dup = anomalies.anomalies.find((a) => a.kind === "duplicate_suspected");
  if (dup) {
    const impact = impactOf(dup.amount);
    insights.push({
      kind: "duplicate",
      title: dup.note,
      detail: "Vale la pena confirmar que no te cobraron dos veces.",
      category: dup.category,
      parentCategory: dup.parentCategory,
      merchantFamily: dup.merchantFamily,
      amount: dup.amount,
      actionable: true,
      suggestedAction: `Revisa el cargo de ${dup.merchantFamily}.`,
      cashflowImpact: impact,
      usefulness: score("duplicate", impact, dup.confidence),
      confidence: dup.confidence,
    });
  }

  // The biggest margin driver this week (a category over, tied to a concrete pullback).
  if (margin.headline && budgetIntel.oneAdjustment) {
    const adj = budgetIntel.oneAdjustment;
    const impact = impactOf(adj.saving);
    insights.push({
      kind: "margin_driver",
      title: margin.headline.note,
      detail: `Si bajas ~${adj.saving} en ${adj.categories.join(" + ")} vuelves a tu ritmo normal sin apretarte.`,
      category: null,
      parentCategory: budgetIntel.overCategories[0]?.parentCategory ?? null,
      merchantFamily: null,
      amount: adj.saving,
      actionable: true,
      suggestedAction: `Ajusta ~${adj.saving} en ${adj.categories.join(" + ")} esta semana.`,
      cashflowImpact: impact,
      usefulness: score("margin_driver", impact, margin.headline.confidence),
      confidence: margin.headline.confidence,
    });
  } else {
    // No clear over-category but there's still a top budget signal worth noting.
    for (const s of budgetIntel.overCategories.slice(0, 1)) {
      const impact = impactOf(s.overage);
      insights.push({
        kind: "budget_over",
        title: `${s.parentCategory} va ~${Math.round(s.pctVsNormal * 100)}% arriba de tu normal esta semana.`,
        detail: `Nada grave: si aflojas un poco en ${s.parentCategory} estos días, vuelves a tu ritmo de siempre.`,
        category: s.category,
        parentCategory: s.parentCategory,
        merchantFamily: null,
        amount: roundMoney(s.overage),
        actionable: true,
        suggestedAction: `Aflojá un poco en ${s.parentCategory}.`,
        cashflowImpact: impact,
        usefulness: score("budget_over", impact, s.confidence),
        confidence: s.confidence,
      });
    }
  }

  // An unmodeled subscription worth converting to a fixed expense.
  const sub = subscriptions.subscriptions.find((x) => x.suggestConvert);
  if (sub) {
    const monthly = sub.cadence === "weekly" ? sub.amount * 4.33 : sub.cadence === "biweekly" ? sub.amount * 2.17 : sub.amount;
    const impact = impactOf(monthly / 4.33);
    insights.push({
      kind: "subscription_unmodeled",
      title: `${sub.merchantFamily} parece recurrente (${sub.amount} cada ${sub.cadence === "weekly" ? "semana" : sub.cadence === "biweekly" ? "quincena" : "mes"}).`,
      detail: "Si lo marcamos como gasto fijo, deja de sorprenderte y entra en tu plan.",
      category: sub.category,
      parentCategory: null,
      merchantFamily: sub.merchantFamily,
      amount: sub.amount,
      actionable: true,
      suggestedAction: `¿Lo trato como gasto fijo de ${sub.merchantFamily}?`,
      cashflowImpact: impact,
      usefulness: score("subscription_unmodeled", impact, sub.confidence),
      confidence: sub.confidence,
    });
  }

  // A notable anomaly that wasn't a duplicate or already-surfaced large one-off.
  const anom = anomalies.anomalies.find((a) => a.kind !== "duplicate_suspected" && a.severity !== "info");
  if (anom) {
    const impact = impactOf(anom.amount); // capped 0..1, consistent with the rest
    insights.push({
      kind: "anomaly",
      title: anom.note,
      detail: "No es para alarmarse; solo para que lo tengas en el radar.",
      category: anom.category,
      parentCategory: anom.parentCategory,
      merchantFamily: anom.merchantFamily,
      amount: anom.amount,
      actionable: false,
      suggestedAction: null,
      cashflowImpact: impact,
      usefulness: score("anomaly", impact, anom.confidence),
      confidence: anom.confidence,
    });
  }

  // A clear category trend worth knowing (rising/falling), low urgency.
  const trending = baselines.categories.find((c) => c.isControllable && (c.trend === "rising" || c.trend === "falling") && c.confidence !== "low");
  if (trending) {
    insights.push({
      kind: "category_trend",
      title: `${trending.parentCategory} viene ${trending.trend === "rising" ? "subiendo" : "bajando"} últimamente.`,
      detail: trending.trend === "rising" ? "Aún no es problema, pero lo estoy siguiendo." : "Buen movimiento, se nota.",
      category: trending.category,
      parentCategory: trending.parentCategory,
      merchantFamily: null,
      amount: trending.weeklyAvg,
      actionable: false,
      suggestedAction: null,
      cashflowImpact: impactOf(trending.weeklyAvg),
      usefulness: score("category_trend", impactOf(trending.weeklyAvg), trending.confidence),
      confidence: trending.confidence,
    });
  }

  // Nothing pressing → either reassure or admit we're still learning.
  if (!insights.length) {
    if (baselines.confidence === "low" || baselines.txnCount < 8) {
      insights.push({
        kind: "low_data",
        title: "Todavía estoy aprendiendo tu normal.",
        detail: "Con unos días más de movimientos te voy a poder decir exactamente qué cuidar.",
        category: null,
        parentCategory: null,
        merchantFamily: null,
        amount: null,
        actionable: false,
        suggestedAction: null,
        cashflowImpact: 0,
        usefulness: KIND_WEIGHT.low_data,
        confidence: "low",
      });
    } else {
      insights.push({
        kind: "on_track",
        title: "Vas en tu ritmo normal esta semana.",
        detail: "Nada raro en tus gastos; seguí así.",
        category: null,
        parentCategory: null,
        merchantFamily: null,
        amount: null,
        actionable: false,
        suggestedAction: null,
        cashflowImpact: 0,
        usefulness: KIND_WEIGHT.on_track,
        confidence: baselines.confidence,
      });
    }
  }

  insights.sort((a, b) => KIND_TIER[b.kind] - KIND_TIER[a.kind] || b.usefulness - a.usefulness);
  const theOneThing = insights[0] ?? null;
  const positive = !!theOneThing && (theOneThing.kind === "on_track" || (theOneThing.kind === "category_trend" && theOneThing.detail.includes("Buen")));

  return {
    insights,
    theOneThing,
    positive,
    confidence: baselines.confidence,
  };
}
