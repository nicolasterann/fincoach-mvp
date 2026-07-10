import { roundMoney, formatKipuMoney } from "@/lib/financial/money";

// Stage 32 — "Presupuesto vivo". THE budget-progress contract: how far each
// per-category monthly budget has advanced inside the CURRENT calendar month,
// seed-aware (what the user told us they had ALREADY spent when the budget was
// created mid-month) so the engine never reserves the full month on top of
// money that's already gone. PURE and deterministic: budgets + classified
// transactions in, structured facts out. ONE truth consumed by the coaching
// briefing (digest + remaining-based projection burn), the spending page and
// the onboarding preview — no consumer re-does this math.

export interface BudgetCategoryProgress {
  category: string; // FinancialCategory value (food, transport, …)
  labelEs: string; // "Comida", "Transporte", … (same ES labels the product uses)
  budgetMonthly: number; // base currency
  seed: number; // applied seed (0 when absent or seed_month ≠ current month)
  spentLogged: number; // categorized real spend this CALENDAR month (base)
  spentThisMonth: number; // seed + spentLogged
  remaining: number; // max(0, budgetMonthly − spentThisMonth)
  daysLeftInMonth: number; // today inclusive
  pace: "under" | "on_track" | "tight" | "over"; // vs day-of-month proportion
}

export interface BudgetProgress {
  items: BudgetCategoryProgress[]; // active budget categories only
  totalBudget: number;
  totalSpent: number;
  totalRemaining: number;
  daysLeftInMonth: number;
  monthISO: string; // "2026-07"
  hasBudgets: boolean; // false → all consumers hide/skip
}

// Mirrors the ES parents in category-intelligence's CATEGORY_PROFILE / the
// wizard's EXPENSE_CATEGORIES so budgets read with the same names everywhere.
const CATEGORY_LABELS_ES: Record<string, string> = {
  housing: "Vivienda",
  utilities: "Servicios",
  food: "Comida",
  transport: "Transporte",
  health: "Salud",
  education: "Educación",
  subscriptions: "Suscripciones",
  debt: "Deuda",
  shopping: "Compras",
  entertainment: "Entretenimiento",
  family: "Familia",
  travel: "Viajes",
  savings: "Ahorro",
  income: "Ingreso",
  other: "Otros",
};

function labelEsFor(category: string): string {
  return CATEGORY_LABELS_ES[category] ?? category;
}

// Pace vs the day-of-month proportion. "over" = the month's budget is already
// exceeded (nothing remains); "tight" = running above the proportional pace;
// "under"/"on_track" = at or below it (±10% band). Deterministic, no grace
// heuristics — a coach chip, not a verdict.
function paceFor(
  budgetMonthly: number,
  spentThisMonth: number,
  dayOfMonth: number,
  daysInMonth: number,
): BudgetCategoryProgress["pace"] {
  if (!(budgetMonthly > 0)) return spentThisMonth > 0 ? "over" : "on_track";
  if (spentThisMonth > budgetMonthly + 0.005) return "over";
  const expectedByToday = (budgetMonthly * dayOfMonth) / daysInMonth;
  if (spentThisMonth <= expectedByToday * 0.9) return "under";
  if (spentThisMonth <= expectedByToday * 1.1) return "on_track";
  return "tight";
}

export function computeBudgetProgress(input: {
  budgets: {
    category: string;
    amountBase: number;
    mtdSeed?: number | null;
    seedMonth?: string | null;
    isActive: boolean;
  }[];
  classified: {
    category: string;
    baseAmount: number;
    occurredAtMs: number;
    isSpend: boolean;
    excludedFromSpending: boolean;
  }[];
  now: Date;
}): BudgetProgress {
  const now = input.now;
  const year = now.getFullYear();
  const month = now.getMonth();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysLeftInMonth = daysInMonth - dayOfMonth + 1; // today inclusive
  const monthISO = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthStartMs = new Date(year, month, 1).getTime();
  const monthEndMs = new Date(year, month + 1, 1).getTime();

  // Aggregate active budgets by category (defensive: duplicate rows for the
  // same category merge instead of double-counting the month's spend).
  const byCategory = new Map<string, { budget: number; seed: number }>();
  for (const b of input.budgets) {
    if (!b.isActive) continue;
    const entry = byCategory.get(b.category) ?? { budget: 0, seed: 0 };
    entry.budget += Math.max(0, b.amountBase);
    // The seed applies ONLY when it belongs to the CURRENT calendar month —
    // a stale seed from a prior month is ignored, never carried over.
    const seedMonthISO = (b.seedMonth ?? "").slice(0, 7);
    if (b.mtdSeed != null && b.mtdSeed > 0 && seedMonthISO === monthISO) {
      entry.seed += b.mtdSeed;
    }
    byCategory.set(b.category, entry);
  }

  // Real categorized spend inside the current calendar month. Only true spend
  // counts: isSpend && !excludedFromSpending (transfers, card payments,
  // refunds, income never inflate a budget).
  const spentByCategory = new Map<string, number>();
  for (const t of input.classified) {
    if (!t.isSpend || t.excludedFromSpending) continue;
    if (t.occurredAtMs < monthStartMs || t.occurredAtMs >= monthEndMs) continue;
    if (!byCategory.has(t.category)) continue;
    spentByCategory.set(t.category, (spentByCategory.get(t.category) ?? 0) + t.baseAmount);
  }

  const items: BudgetCategoryProgress[] = [...byCategory.entries()]
    .map(([category, { budget, seed }]) => {
      const budgetMonthly = roundMoney(budget);
      const appliedSeed = roundMoney(seed);
      const spentLogged = roundMoney(spentByCategory.get(category) ?? 0);
      const spentThisMonth = roundMoney(appliedSeed + spentLogged);
      return {
        category,
        labelEs: labelEsFor(category),
        budgetMonthly,
        seed: appliedSeed,
        spentLogged,
        spentThisMonth,
        remaining: roundMoney(Math.max(0, budgetMonthly - spentThisMonth)),
        daysLeftInMonth,
        pace: paceFor(budgetMonthly, spentThisMonth, dayOfMonth, daysInMonth),
      };
    })
    .sort((a, b) => b.budgetMonthly - a.budgetMonthly || a.category.localeCompare(b.category));

  return {
    items,
    totalBudget: roundMoney(items.reduce((s, i) => s + i.budgetMonthly, 0)),
    totalSpent: roundMoney(items.reduce((s, i) => s + i.spentThisMonth, 0)),
    // Sum of per-category remainings (each clamped at 0): an over-spent
    // category never "lends" negative reserve to another one.
    totalRemaining: roundMoney(items.reduce((s, i) => s + i.remaining, 0)),
    daysLeftInMonth,
    monthISO,
    hasBudgets: items.length > 0,
  };
}

// Neutral shape for fallback paths (e.g. the agent's emptyBriefing): no
// budgets, honest month/days, every consumer hides/skips on hasBudgets:false.
export function emptyBudgetProgress(now: Date = new Date()): BudgetProgress {
  return computeBudgetProgress({ budgets: [], classified: [], now });
}

const PACE_ES: Record<BudgetCategoryProgress["pace"], string> = {
  under: "con espacio",
  on_track: "en ritmo",
  tight: "ritmo alto",
  over: "excedido",
};

// ONE compact agent-facing digest line ("" when the user has no budgets), so
// "¿cómo voy con la comida?" is answered straight from the prompt with the
// same numbers the spending page shows.
export function budgetProgressDigestLine(bp: BudgetProgress, baseCurrency: string): string {
  if (!bp.hasBudgets) return "";
  const fmt = (n: number) => formatKipuMoney(n, baseCurrency);
  const items = bp.items
    .map(
      (i) =>
        `${i.labelEs} ${fmt(i.spentThisMonth)}/${fmt(i.budgetMonthly)} (quedan ${fmt(i.remaining)}, ${PACE_ES[i.pace]})`,
    )
    .join(", ");
  return `PRESUPUESTO DEL MES (mes calendario, ya con lo gastado descontado — si pregunta "¿cómo voy con X?" responde con esto, simple): ${items} · ${bp.daysLeftInMonth} día(s) restantes · total ${fmt(bp.totalSpent)}/${fmt(bp.totalBudget)} (quedan ${fmt(bp.totalRemaining)}).`;
}

// Stage 32 (A4) / S5 — the SHARED "your budget estimate looks off, refine it?" rule.
// A configured category budget that diverges by more than `minDivergencePct` AND by a
// material absolute amount (`minAbsDiff`) from the user's LEARNED real monthly spend,
// with enough data to trust the learning (per-category and overall confidence not
// "low"). SUGGEST-ONLY: callers propose; the change only happens if the user says yes
// in chat (update_budget_category). ONE source of truth for the Telegram ambient topic
// AND the in-app / in-chat coaching nudge — never re-implemented in two places.
// Default divergence is 15% (S5): the founder's own case — ~280/mes real vs a 337.84
// estimate (~17%) — must nudge; the ABSOLUTE floor (20) still silences tiny categories
// so a 15% gap on a 34-budget transport line (~5) never fires.
export interface BudgetRefineSuggestion {
  category: string;
  labelEs: string;
  budgetMonthly: number; // current onboarding estimate (base)
  learnedMonthly: number; // learned real monthly average (base)
  diff: number; // abs difference (base)
  direction: "over" | "under"; // real spend runs OVER or UNDER the estimate
}

export function computeBudgetRefineSuggestions(input: {
  budgetItems: { category: string; labelEs: string; budgetMonthly: number }[];
  learnedByCategory: { category: string; monthlyAvg: number; confidence: "high" | "medium" | "low" }[];
  overallConfidence: "high" | "medium" | "low";
  minDivergencePct?: number; // default 0.15 (15%)
  minAbsDiff?: number; // default 20 base units
}): BudgetRefineSuggestion[] {
  if (input.overallConfidence === "low") return [];
  const minPct = input.minDivergencePct ?? 0.15;
  const minAbs = input.minAbsDiff ?? 20;
  const learnedByCat = new Map(input.learnedByCategory.map((c) => [c.category, c]));
  const out: BudgetRefineSuggestion[] = [];
  for (const item of input.budgetItems) {
    if (!(item.budgetMonthly > 0)) continue;
    const learned = learnedByCat.get(item.category);
    if (!learned || learned.confidence === "low") continue;
    const diff = Math.abs(learned.monthlyAvg - item.budgetMonthly);
    if (diff > item.budgetMonthly * minPct && diff > minAbs) {
      out.push({
        category: item.category,
        labelEs: item.labelEs,
        budgetMonthly: roundMoney(item.budgetMonthly),
        learnedMonthly: roundMoney(learned.monthlyAvg),
        diff: roundMoney(diff),
        direction: learned.monthlyAvg > item.budgetMonthly ? "over" : "under",
      });
    }
  }
  return out.sort((a, b) => b.diff - a.diff);
}
