import { roundMoney, formatKipuMoney } from "@/lib/financial/money";
import { paceFor, labelEsFor, type BudgetProgress, type BudgetCategoryProgress } from "@/lib/financial/budget-progress";

// Stage H — "Objetivo mensual" (comida/transporte). The product rule in one
// sentence: ALL food/transport spend counts against a user-DECIDED monthly
// objective; while the month-to-date accumulated spend stays under the
// objective nothing drains the Saldo tank (the objective is already reserved
// in the ritmo via essentialEstimate); when it crosses, ONLY the excess drains
// — day by day, deterministically. A user-confirmed EXTRAORDINARY txn
// (budget_treatment='saldo') bypasses the objective: it drains the tank fully,
// consumes NO objective, and is excluded from the month-close comparison.
// Refunds match the registration type: an objective-registered refund returns
// to the accumulator; a saldo-registered refund restores the tank.
//
// The objective is a DECISION, never auto-replaced by observed behavior — the
// monthly close reports and asks; the user keeps/changes/waits.
//
// PURE and deterministic: objectives (active monthly budget rows for the
// objective categories) + user-tz-dated classified txns in, states + the extra
// tank-drain series out. ONE truth consumed by the coaching briefing (digest +
// signals + tank merge), the spending page, home, ambient and the month close
// — no consumer re-does this math.
//
// HARD CONSTRAINT (no double-counting): a food/transport dollar is EITHER
// reserved (inside the objective → lowers fillDaily, no drain) OR drains the
// tank (excess / extraordinary), never both. That is why extraordinary txns
// never enter the accumulator, why fixed-linked (recurringExpenseId) and
// installment rows are excluded entirely (already reserved in the ritmo), and
// why the excess drain starts exactly where the reserve stops.

export const OBJECTIVE_CATEGORIES: readonly string[] = ["food", "transport"];

export function isObjectiveCategory(category: string): boolean {
  return OBJECTIVE_CATEGORIES.includes(category);
}

// One month's decided objective (base currency, already FX-re-valued upstream).
export interface ObjectiveVersion {
  category: string;
  effectiveMonth: string; // "YYYY-MM"
  amountBase: number;
}

// The objective IN EFFECT for a given month = the version with the greatest
// effective_month <= that month. Returns null when no version covers it, so the
// caller falls back to the current amount (users seeded before versioning, or a
// month older than the first version — there is no history to recover, but from
// the first version forward a later change can never rewrite a past month).
//
// THIS is what stops "raise the objective in July" from erasing June's excess
// (which already drained the Saldo) and refilling the tank retroactively.
export function objectiveForMonth(
  versions: ObjectiveVersion[] | undefined,
  category: string,
  monthISO: string,
): number | null {
  if (!versions || versions.length === 0) return null;
  let best: ObjectiveVersion | null = null;
  for (const v of versions) {
    if (v.category !== category) continue;
    if (v.effectiveMonth > monthISO) continue; // a FUTURE decision never governs a past month
    if (!best || v.effectiveMonth > best.effectiveMonth) best = v;
  }
  return best ? best.amountBase : null;
}

// One classified ledger row as the objectives engine sees it. dateISO is the
// USER-timezone day key (same makeDayKey convention as the tank walk).
export interface ObjectiveFeedTxn {
  dateISO: string; // YYYY-MM-DD in the user's timezone
  category: string;
  baseAmount: number; // > 0
  spendingType: string; // classifyTxn spendingType ("refund" for refunds)
  isSpend: boolean;
  recurringExpenseId?: string | null;
  externalRef?: string | null; // "installment:<id>" marks a cuotas purchase
  budgetTreatment?: string | null; // 'saldo' = extraordinary; null/'objective' = default
}

export interface ObjectiveState {
  category: string;
  labelEs: string;
  objectiveBase: number; // the decided monthly objective (base currency)
  seed: number; // mtd_seed applied (current month only)
  spentMTD: number; // objective-treatment net (seed + spends − refunds), ≥ 0
  remaining: number; // max(0, objective − spentMTD)
  excessMTD: number; // max(0, spentMTD − objective) — IS part of the close comparison
  // The excess that ACTUALLY drained the tank this month = max(0, spentMTD −
  // max(objective, seed)). Differs from excessMTD only when a mtd_seed already
  // exceeded the objective: that seed overflow was pre-Kipu spend the tank never
  // funded, so surfaces that say "salió de tu Saldo" must quote THIS, not
  // excessMTD (which stays the close-comparison figure).
  excessDrainedMTD: number;
  extraordinaryMTD: number; // saldo-treatment net this month — reported separately, consumes NO objective
  crossed: boolean;
  // Pre-cliff pace signal (REQUIRED design): the user-tz date the objective is
  // projected to cross at the current run rate — null when crossed already or
  // when the projection lands beyond the month.
  projectedCrossDateISO: string | null;
}

export interface ObjectivesResult {
  hasObjectives: boolean; // false → user has no objective set → today's exact behavior
  states: ObjectiveState[];
  // Extra Saldo-tank drains to merge into dailyGustos: positive = drain
  // (objective excess / extraordinary), negative = restore (their refunds).
  extraDrainByDay: { dateISO: string; amount: number }[];
  todayExcess: number; // today's excess-drain component (receipt explainability)
  todayExtraordinary: number; // today's extraordinary component
}

// Neutral shape for fallback paths (e.g. the agent's emptyBriefing): no
// objectives, every consumer hides/skips on hasObjectives:false.
export function emptyObjectives(): ObjectivesResult {
  return { hasObjectives: false, states: [], extraDrainByDay: [], todayExcess: 0, todayExtraordinary: 0 };
}

function daysInMonthOf(monthISO: string): number {
  const [y, m] = monthISO.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

// A row the ritmo already reserves (fixed-linked or cuotas) never enters the
// objective math — counting it here would charge the same decision twice.
function excludedFromObjective(t: ObjectiveFeedTxn): boolean {
  return Boolean(t.recurringExpenseId) || (t.externalRef ?? "").startsWith("installment:");
}

export function computeObjectives(input: {
  objectives: {
    category: string;
    amountBase: number;
    mtdSeed?: number | null;
    seedMonth?: string | null;
    isActive: boolean;
  }[];
  txns: ObjectiveFeedTxn[];
  todayISO: string; // user-tz today (YYYY-MM-DD)
  // Per-month decided objectives (migration 052). Each month in the walk is
  // measured against the objective that was IN EFFECT that month, so changing
  // the objective today can never rewrite a past month's excess (and refill the
  // tank retroactively). Absent/uncovered month → the current amount.
  versions?: ObjectiveVersion[];
}): ObjectivesResult {
  const monthISO = input.todayISO.slice(0, 7);
  const dayOfMonth = Number(input.todayISO.slice(8, 10));
  const daysInMonth = daysInMonthOf(monthISO);

  // Merge active objective rows by category (duplicate rows accumulate, same
  // defensive rule as computeBudgetProgress). The seed applies ONLY when it
  // belongs to the current user-tz month.
  const objectives = new Map<string, { amount: number; seed: number }>();
  for (const o of input.objectives) {
    if (!o.isActive || !isObjectiveCategory(o.category) || !(o.amountBase > 0)) continue;
    const entry = objectives.get(o.category) ?? { amount: 0, seed: 0 };
    entry.amount += o.amountBase;
    if (o.mtdSeed != null && o.mtdSeed > 0 && (o.seedMonth ?? "").slice(0, 7) === monthISO) {
      entry.seed += o.mtdSeed;
    }
    objectives.set(o.category, entry);
  }
  if (objectives.size === 0) return emptyObjectives();

  // Bucket the feed. Objective-treatment activity accumulates per category per
  // day, keyed by MONTH so each month's cumulative is walked independently
  // (the objective resets monthly). Extraordinary (saldo) activity drains
  // per-txn on its own day in ANY month (it needs no accumulator).
  const objectiveNetByDay = new Map<string, Map<string, number>>(); // category → dateISO → net
  const extraDrain = new Map<string, number>(); // dateISO → net drain
  const extraordinaryMTD = new Map<string, number>(); // category → net this month
  let todayExtraordinary = 0;

  for (const t of input.txns) {
    if (!objectives.has(t.category) || excludedFromObjective(t)) continue;
    if (!(t.baseAmount > 0)) continue;
    const isRefund = t.spendingType === "refund";
    if (!isRefund && !t.isSpend) continue;
    const signed = isRefund ? -t.baseAmount : t.baseAmount;
    if (t.budgetTreatment === "saldo") {
      extraDrain.set(t.dateISO, (extraDrain.get(t.dateISO) ?? 0) + signed);
      if (t.dateISO.slice(0, 7) === monthISO) {
        extraordinaryMTD.set(t.category, (extraordinaryMTD.get(t.category) ?? 0) + signed);
        if (t.dateISO === input.todayISO) todayExtraordinary += signed;
      }
      continue;
    }
    // Keep ALL months (not just current): the excess-delta walk below runs each
    // month independently, so a late-prior-month overrun's drain STAYS in the
    // tank's 40-day walk and ages out like any gusto — instead of vanishing (and
    // refilling the tank) the instant the calendar flips. The 40-day window
    // fully covers the prior month exactly while its days are still in the walk.
    const days = objectiveNetByDay.get(t.category) ?? new Map<string, number>();
    days.set(t.dateISO, (days.get(t.dateISO) ?? 0) + signed);
    objectiveNetByDay.set(t.category, days);
  }

  // Per category: walk each month's cumulative INDEPENDENTLY against THAT
  // MONTH'S decided objective, emitting the DELTA of max(0, cum − objective) per
  // day (only the excess drains; a later refund that pulls the month back under
  // emits a negative delta = tank restore). The seed participates ONLY in its
  // own month's cumulative, and its OWN excess never emits a drain (it predates
  // capture — the tank never funded it). Only the CURRENT month feeds the state.
  const states: ObjectiveState[] = [];
  let todayExcess = 0;
  for (const [category, { amount, seed }] of objectives) {
    // The objective for the CURRENT month: its version if one exists (the user's
    // latest decision for the month they're in), else the current amount.
    const objective = roundMoney(objectiveForMonth(input.versions, category, monthISO) ?? amount);
    const appliedSeed = roundMoney(seed);
    const byMonth = new Map<string, [string, number][]>();
    for (const [dateISO, net] of objectiveNetByDay.get(category)?.entries() ?? []) {
      const mon = dateISO.slice(0, 7);
      const arr = byMonth.get(mon) ?? [];
      arr.push([dateISO, net]);
      byMonth.set(mon, arr);
    }
    let currentCum = appliedSeed; // current-month cumulative (seed applies here only)
    for (const [mon, monDays] of byMonth) {
      monDays.sort(([a], [b]) => a.localeCompare(b));
      // Each month is measured against the objective that was IN EFFECT then —
      // changing it today never rewrites a past month's excess (P1-1).
      const monthObjective = roundMoney(objectiveForMonth(input.versions, category, mon) ?? amount);
      const startCum = mon === monthISO ? appliedSeed : 0;
      let cum = startCum;
      let excessPrev = Math.max(0, startCum - monthObjective);
      for (const [dateISO, net] of monDays) {
        cum += net;
        const excessNow = Math.max(0, cum - monthObjective);
        const delta = roundMoney(excessNow - excessPrev);
        excessPrev = excessNow;
        if (Math.abs(delta) < 0.005) continue;
        extraDrain.set(dateISO, (extraDrain.get(dateISO) ?? 0) + delta);
        if (dateISO === input.todayISO) todayExcess += delta;
      }
      if (mon === monthISO) currentCum = cum;
    }
    const spentMTD = roundMoney(Math.max(0, currentCum));
    const crossed = spentMTD > objective + 0.005;
    let projectedCrossDateISO: string | null = null;
    if (!crossed && dayOfMonth > 0 && spentMTD > 0) {
      const rate = spentMTD / dayOfMonth;
      const crossDay = Math.ceil(objective / rate);
      // Only warn about crossing STRICTLY before the month ends — an on-pace
      // user (projected to land on the objective on the last day) gets no nag.
      if (crossDay > dayOfMonth && crossDay < daysInMonth) {
        projectedCrossDateISO = `${monthISO}-${String(crossDay).padStart(2, "0")}`;
      }
    }
    states.push({
      category,
      labelEs: labelEsFor(category),
      objectiveBase: objective,
      seed: appliedSeed,
      spentMTD,
      remaining: roundMoney(Math.max(0, objective - spentMTD)),
      excessMTD: roundMoney(Math.max(0, spentMTD - objective)),
      excessDrainedMTD: roundMoney(Math.max(0, spentMTD - Math.max(objective, appliedSeed))),
      extraordinaryMTD: roundMoney(extraordinaryMTD.get(category) ?? 0),
      crossed,
      projectedCrossDateISO,
    });
  }
  states.sort((a, b) => b.objectiveBase - a.objectiveBase || a.category.localeCompare(b.category));

  return {
    hasObjectives: true,
    states,
    extraDrainByDay: [...extraDrain.entries()]
      .map(([dateISO, amount]) => ({ dateISO, amount: roundMoney(amount) }))
      .filter((e) => Math.abs(e.amount) >= 0.005),
    todayExcess: roundMoney(Math.max(0, todayExcess)),
    todayExtraordinary: roundMoney(Math.max(0, todayExtraordinary)),
  };
}

// What a HYPOTHETICAL purchase in an objective category would actually take out
// of the Saldo: the INCREMENTAL excess it creates, not its full amount and not
// zero. The three cases the coach must tell apart (P1-2):
//   · still inside the objective after it   → drains 0 ("ni toca tu Saldo")
//   · already crossed before it             → drains the full amount
//   · the purchase itself crosses           → drains ONLY the part past the objective
//     (objetivo 500, llevas 480, compra 50 → 30 sale del Saldo, no 50 ni 0)
export interface ObjectivePurchaseImpact {
  drainsFromSaldo: number; // what actually leaves the tank
  absorbedByObjective: number; // the part the objective still covers
  crossesWithThisPurchase: boolean; // this purchase is the one that crosses
  alreadyCrossed: boolean;
}

export function objectiveDrainForPurchase(
  state: Pick<ObjectiveState, "objectiveBase" | "spentMTD">,
  amount: number,
): ObjectivePurchaseImpact {
  const excessBefore = Math.max(0, state.spentMTD - state.objectiveBase);
  const excessAfter = Math.max(0, state.spentMTD + Math.max(0, amount) - state.objectiveBase);
  const drains = roundMoney(excessAfter - excessBefore);
  return {
    drainsFromSaldo: drains,
    absorbedByObjective: roundMoney(Math.max(0, amount) - drains),
    crossesWithThisPurchase: excessBefore <= 0.005 && excessAfter > 0.005,
    alreadyCrossed: excessBefore > 0.005,
  };
}

// Patch the shared BudgetProgress so every surface (digest, spending page,
// home, remaining-based projection burn) quotes the objectives engine's
// numbers for objective categories — ONE truth, no drift. Non-objective
// categories keep computeBudgetProgress's math untouched. The doctrine
// exclusions (extraordinary / fixed-linked / cuotas / refund netting) apply
// only here; remaining stays capped at the objective so the reserve never
// exceeds it (the excess drains the tank instead — never both).
export function applyObjectiveOverrides(bp: BudgetProgress, result: ObjectivesResult): BudgetProgress {
  if (!result.hasObjectives) return bp;
  const byCategory = new Map(result.states.map((s) => [s.category, s]));
  const items: BudgetCategoryProgress[] = bp.items.map((item) => {
    const s = byCategory.get(item.category);
    if (!s) return item;
    return {
      ...item,
      seed: s.seed,
      spentLogged: roundMoney(Math.max(0, s.spentMTD - s.seed)),
      spentThisMonth: s.spentMTD,
      remaining: s.remaining,
      pace: s.crossed
        ? ("over" as const)
        : paceFor(s.objectiveBase, s.spentMTD, daysInMonthOf(bp.monthISO) - bp.daysLeftInMonth + 1, daysInMonthOf(bp.monthISO)),
    };
  });
  return {
    ...bp,
    items,
    totalBudget: roundMoney(items.reduce((t, i) => t + i.budgetMonthly, 0)),
    totalSpent: roundMoney(items.reduce((t, i) => t + i.spentThisMonth, 0)),
    totalRemaining: roundMoney(items.reduce((t, i) => t + i.remaining, 0)),
  };
}

// ONE compact agent-facing doctrine line ("" when no objectives) so chat,
// ambient and the dashboard explain the objective with the SAME numbers.
export function objectivesDigestLine(result: ObjectivesResult, baseCurrency: string): string {
  if (!result.hasObjectives) return "";
  const fmt = (n: number) => formatKipuMoney(n, baseCurrency);
  const parts = result.states.map((s) => {
    let line = `${s.labelEs}: objetivo ${fmt(s.objectiveBase)}, llevas ${fmt(s.spentMTD)}`;
    if (s.crossed) {
      line += ` — CRUZADO: lo que se pasó del objetivo (${fmt(s.excessDrainedMTD)}) sale de tu Saldo`;
      if (s.excessMTD > s.excessDrainedMTD + 0.005) line += ` (otros ${fmt(s.excessMTD - s.excessDrainedMTD)} ya venían gastados antes de arrancar Kipu — esos no salieron del tanque)`;
    } else if (s.projectedCrossDateISO) {
      line += ` — a este ritmo lo cruzas el ${Number(s.projectedCrossDateISO.slice(8, 10))}`;
    } else {
      line += ` (quedan ${fmt(s.remaining)})`;
    }
    if (s.extraordinaryMTD > 0) line += ` · extraordinarios aparte: ${fmt(s.extraordinaryMTD)} (salieron directo del Saldo, no tocan el objetivo)`;
    return line;
  });
  return `OBJETIVO MENSUAL (comida/transporte — decisión del usuario, NUNCA lo ajustes solo; dentro del objetivo no toca el Saldo, el exceso sí drena; un gasto extraordinario confirmado va directo al Saldo sin consumir objetivo): ${parts.join(" · ")}.`;
}

// Month close: the honest report for a CLOSED user-tz month. spentBase includes
// the overflow (it is the refine-loop signal: "objetivo 500, cerraste en 560");
// extraordinaryBase is reported separately and NEVER pushes the objective up.
// Surplus default destination is Reservas — a NO-WRITE: the unspent money
// physically stays in the accounts and the computed Reserva layer absorbs it.
export interface ObjectiveMonthClose {
  category: string;
  labelEs: string;
  objectiveBase: number;
  spentBase: number; // objective-treatment net for the month (overflow INCLUDED)
  extraordinaryBase: number; // saldo-treatment net — separate line, excluded from the comparison
  surplusBase: number; // max(0, objective − spent)
  excessBase: number; // max(0, spent − objective) — the close-comparison overflow
  // The overflow that ACTUALLY drained the tank = max(0, spent − max(objective,
  // seed)); excludes a seed that already exceeded the objective (pre-Kipu spend
  // the tank never funded). Quote THIS in "ya salió de tu Saldo" copy.
  excessDrainedBase: number;
}

export function computeObjectiveMonthClose(input: {
  objectives: {
    category: string;
    amountBase: number;
    mtdSeed?: number | null;
    seedMonth?: string | null;
    isActive: boolean;
  }[];
  txns: ObjectiveFeedTxn[]; // must cover the closed month
  monthISO: string; // the CLOSED user-tz month ("2026-06")
  // The objective that was IN EFFECT during the closed month. Without this the
  // close would report last month against THIS month's number — e.g. the user
  // raises their objective on the 1st and Kipu claims last month's objective was
  // the new one (P1-1).
  versions?: ObjectiveVersion[];
}): ObjectiveMonthClose[] {
  const objectives = new Map<string, { amount: number; seed: number }>();
  for (const o of input.objectives) {
    if (!o.isActive || !isObjectiveCategory(o.category) || !(o.amountBase > 0)) continue;
    const entry = objectives.get(o.category) ?? { amount: 0, seed: 0 };
    entry.amount += o.amountBase;
    if (o.mtdSeed != null && o.mtdSeed > 0 && (o.seedMonth ?? "").slice(0, 7) === input.monthISO) {
      entry.seed += o.mtdSeed;
    }
    objectives.set(o.category, entry);
  }
  const out: ObjectiveMonthClose[] = [];
  for (const [category, { amount, seed }] of objectives) {
    let spent = seed;
    let extraordinary = 0;
    for (const t of input.txns) {
      if (t.category !== category || excludedFromObjective(t)) continue;
      if (t.dateISO.slice(0, 7) !== input.monthISO || !(t.baseAmount > 0)) continue;
      const isRefund = t.spendingType === "refund";
      if (!isRefund && !t.isSpend) continue;
      const signed = isRefund ? -t.baseAmount : t.baseAmount;
      if (t.budgetTreatment === "saldo") extraordinary += signed;
      else spent += signed;
    }
    const objective = roundMoney(objectiveForMonth(input.versions, category, input.monthISO) ?? amount);
    const spentBase = roundMoney(Math.max(0, spent));
    out.push({
      category,
      labelEs: labelEsFor(category),
      objectiveBase: objective,
      spentBase,
      extraordinaryBase: roundMoney(Math.max(0, extraordinary)),
      surplusBase: roundMoney(Math.max(0, objective - spentBase)),
      excessBase: roundMoney(Math.max(0, spentBase - objective)),
      excessDrainedBase: roundMoney(Math.max(0, spentBase - Math.max(objective, roundMoney(seed)))),
    });
  }
  return out.sort((a, b) => b.objectiveBase - a.objectiveBase || a.category.localeCompare(b.category));
}
