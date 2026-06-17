import { roundMoney } from "@/lib/financial/money";
import type { ClassifiedTxn, SpendingType } from "@/lib/financial/category-intelligence";
import type { FinancialCategory } from "@/types/financial";

// Stage 16 — CATEGORY BASELINES. Learns what is "normal for THIS user" per
// category from real expenses (only `isSpend` classified txns), with cautious
// sample-size safeguards so Kipu never claims a pattern from tiny data. PURE.
// These baselines feed budget intelligence, anomaly detection and margin
// attribution — and improve the Stage 15 cashflow's typical-burn estimate.

const DAY_MS = 86_400_000;

export interface CategoryBaseline {
  category: FinancialCategory;
  parentCategory: string;
  spendingType: SpendingType;
  total: number; // over the window
  weeklyAvg: number;
  monthlyAvg: number;
  weekdayDailyAvg: number;
  weekendDailyAvg: number;
  volatility: number; // coefficient of variation of daily totals (0 = steady)
  sampleSize: number; // # of spend transactions
  daysObserved: number; // distinct days with a charge
  trend: "rising" | "stable" | "falling" | "unknown";
  isControllable: boolean;
  confidence: "high" | "medium" | "low";
}

export interface SpendingBaselines {
  windowDays: number;
  txnCount: number;
  totalSpend: number;
  controllableSpend: number;
  typicalDailyVariable: number; // typical controllable daily spend (trimmed mean)
  categories: CategoryBaseline[]; // sorted by total desc
  topByImpact: CategoryBaseline[]; // top 3 controllable categories
  confidence: "high" | "medium" | "low";
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

export function buildCategoryBaselines(classified: ClassifiedTxn[], nowMs: number, windowDays = 35): SpendingBaselines {
  const since = nowMs - windowDays * DAY_MS;
  const spends = classified.filter((c) => c.isSpend && c.occurredAtMs >= since && Number.isFinite(c.baseAmount) && c.baseAmount > 0);

  const byCat = new Map<FinancialCategory, ClassifiedTxn[]>();
  for (const c of spends) {
    const arr = byCat.get(c.category) ?? [];
    arr.push(c);
    byCat.set(c.category, arr);
  }

  const halfMs = nowMs - (windowDays / 2) * DAY_MS;
  const categories: CategoryBaseline[] = [];
  for (const [category, list] of byCat) {
    const total = roundMoney(list.reduce((s, c) => s + c.baseAmount, 0));
    const byDay = new Map<number, number>();
    for (const c of list) {
      const day = Math.floor(c.occurredAtMs / DAY_MS);
      byDay.set(day, (byDay.get(day) ?? 0) + c.baseAmount);
    }
    const dailyTotals = [...byDay.values()];
    const daysObserved = byDay.size;
    const weekday: number[] = [];
    const weekend: number[] = [];
    for (const [day, amt] of byDay) {
      const dow = new Date(day * DAY_MS).getUTCDay();
      (dow === 0 || dow === 6 ? weekend : weekday).push(amt);
    }
    const recent = list.filter((c) => c.occurredAtMs >= halfMs).reduce((s, c) => s + c.baseAmount, 0);
    const older = total - recent;
    const trend: CategoryBaseline["trend"] =
      list.length < 4 || daysObserved < 4 ? "unknown" : recent > older * 1.25 ? "rising" : recent < older * 0.75 ? "falling" : "stable";
    const sampleSize = list.length;
    const confidence: CategoryBaseline["confidence"] = sampleSize >= 8 && daysObserved >= 10 ? "high" : sampleSize >= 3 ? "medium" : "low";

    categories.push({
      category,
      parentCategory: list[0].parentCategory,
      spendingType: list[0].spendingType,
      total,
      weeklyAvg: roundMoney((total / windowDays) * 7),
      monthlyAvg: roundMoney((total / windowDays) * 30),
      weekdayDailyAvg: roundMoney(mean(weekday)),
      weekendDailyAvg: roundMoney(mean(weekend)),
      volatility: roundMoney(mean(dailyTotals) > 0 ? stddev(dailyTotals) / mean(dailyTotals) : 0),
      sampleSize,
      daysObserved,
      trend,
      isControllable: list[0].isControllable,
      confidence,
    });
  }
  categories.sort((a, b) => b.total - a.total);

  const totalSpend = roundMoney(spends.reduce((s, c) => s + c.baseAmount, 0));
  const controllable = spends.filter((c) => c.isControllable);
  const controllableSpend = roundMoney(controllable.reduce((s, c) => s + c.baseAmount, 0));

  // Typical controllable daily spend (trimmed mean of daily totals).
  const ctrlByDay = new Map<number, number>();
  for (const c of controllable) {
    const day = Math.floor(c.occurredAtMs / DAY_MS);
    ctrlByDay.set(day, (ctrlByDay.get(day) ?? 0) + c.baseAmount);
  }
  const ctrlDaily = [...ctrlByDay.values()].sort((a, b) => a - b);
  let typicalDailyVariable = 0;
  if (ctrlDaily.length) {
    const cut = Math.floor(ctrlDaily.length * 0.1);
    const core = ctrlDaily.slice(cut, ctrlDaily.length - cut || ctrlDaily.length);
    typicalDailyVariable = roundMoney(mean(core.length ? core : ctrlDaily));
  }

  const topByImpact = categories.filter((c) => c.isControllable).slice(0, 3);
  const confidence: SpendingBaselines["confidence"] = spends.length >= 25 ? "high" : spends.length >= 8 ? "medium" : "low";

  return {
    windowDays,
    txnCount: spends.length,
    totalSpend,
    controllableSpend,
    typicalDailyVariable,
    categories,
    topByImpact,
    confidence,
  };
}
