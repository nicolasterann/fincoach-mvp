import { roundMoney } from "@/lib/financial/money";
import type { ClassifiedTxn } from "@/lib/financial/category-intelligence";
import type { CategoryBaseline, SpendingBaselines } from "@/lib/financial/category-baselines";
import type { FinancialCategory } from "@/types/financial";

// Stage 16 — DYNAMIC BUDGET INTELLIGENCE. No 30 manual category limits. Kipu
// learns the user's NORMAL per category and flags only the few that matter THIS
// week, always tied back to safe spend ("Uber está 42% arriba de tu normal; con
// bajar $18 en delivery + Uber mantienes tu semana"). PURE, cashflow-aware,
// non-shaming, focused on one practical adjustment — never a category lecture.

const DAY_MS = 86_400_000;

export interface BudgetSignal {
  category: FinancialCategory;
  parentCategory: string;
  normalWeekly: number; // the user's baseline for this category
  thisWeekSoFar: number;
  projectedThisWeek: number; // extrapolated to the full week
  overage: number; // projectedThisWeek − normalWeekly (can be negative)
  pctVsNormal: number; // overage / normal
  status: "under" | "on_track" | "watch" | "over";
  confidence: "high" | "medium" | "low";
}

export interface BudgetIntelligence {
  signals: BudgetSignal[]; // controllable categories with a baseline, by overage desc
  overCategories: BudgetSignal[];
  // The single practical adjustment: pull the top 1–2 over-categories back to
  // normal and recover this much, framed as control (not guilt).
  oneAdjustment: { categories: string[]; saving: number } | null;
  safeThisWeek: number; // from the Stage 15 cashflow, for tie-back
  confidence: "high" | "medium" | "low";
}

function startOfWeekMs(nowMs: number): number {
  const d = new Date(nowMs);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday));
  return monday.getTime();
}

export function buildBudgetIntelligence(
  baselines: SpendingBaselines,
  classified: ClassifiedTxn[],
  nowMs: number,
  safeThisWeek: number,
): BudgetIntelligence {
  const weekStart = startOfWeekMs(nowMs);
  const daysIntoWeek = Math.max(1, Math.min(7, Math.floor((nowMs - weekStart) / DAY_MS) + 1));
  // Early in the week a single charge × 7 fabricates a wild "+X% over". Until we
  // have a few days of the week, we still compute signals but force confidence
  // LOW so they never enter overCategories / ambient (which require non-low).
  const earlyWeek = daysIntoWeek < 3;

  const thisWeekByCat = new Map<FinancialCategory, number>();
  for (const c of classified) {
    if (!c.isSpend || !c.isControllable || c.occurredAtMs < weekStart) continue;
    thisWeekByCat.set(c.category, roundMoney((thisWeekByCat.get(c.category) ?? 0) + c.baseAmount));
  }

  const baselineByCat = new Map<FinancialCategory, CategoryBaseline>();
  for (const b of baselines.categories) baselineByCat.set(b.category, b);

  const signals: BudgetSignal[] = [];
  // Consider any controllable category that has either a baseline OR this-week spend.
  const cats = new Set<FinancialCategory>([...baselineByCat.keys(), ...thisWeekByCat.keys()]);
  for (const category of cats) {
    const b = baselineByCat.get(category);
    if (b && !b.isControllable) continue;
    const normalWeekly = b ? b.weeklyAvg : 0;
    const thisWeekSoFar = thisWeekByCat.get(category) ?? 0;
    if (normalWeekly <= 0 && thisWeekSoFar <= 0) continue;
    const projectedThisWeek = roundMoney((thisWeekSoFar / daysIntoWeek) * 7);
    const overage = roundMoney(projectedThisWeek - normalWeekly);
    const pctVsNormal = normalWeekly > 0 ? roundMoney(overage / normalWeekly) : projectedThisWeek > 0 ? 1 : 0;
    const status: BudgetSignal["status"] =
      pctVsNormal > 0.25 ? "over" : pctVsNormal > 0.1 ? "watch" : pctVsNormal < -0.1 ? "under" : "on_track";
    // Don't claim "over" from a category with no real baseline, tiny data, or
    // too few days into the week (one-charge × 7 extrapolation isn't a pattern).
    const confidence: BudgetSignal["confidence"] = earlyWeek ? "low" : b ? b.confidence : "low";
    signals.push({
      category,
      parentCategory: b?.parentCategory ?? "Otros",
      normalWeekly,
      thisWeekSoFar,
      projectedThisWeek,
      overage,
      pctVsNormal,
      status,
      confidence,
    });
  }
  signals.sort((a, b) => b.overage - a.overage);

  // Only treat as "over" with at least medium confidence — no shaming on noise.
  const overCategories = signals.filter((s) => s.status === "over" && s.confidence !== "low" && s.overage > 0);
  const top = overCategories.slice(0, 2);
  const oneAdjustment = top.length
    ? { categories: top.map((s) => s.parentCategory), saving: roundMoney(top.reduce((sum, s) => sum + s.overage, 0)) }
    : null;

  return {
    signals,
    overCategories,
    oneAdjustment,
    safeThisWeek: roundMoney(safeThisWeek),
    confidence: baselines.confidence,
  };
}
