import { roundMoney } from "@/lib/financial/money";

// Stage 15 — CAUTIOUS pattern detection over recent transactions. It surfaces
// soft, confidence-tagged observations (typical daily spend, weekend lift,
// likely recurring charges, category pressure) to EXPLAIN risk and sanity-check
// the essential burn — never to fabricate a hard obligation. Weak patterns stay
// weak; turning one into a commitment is always the user's call (Kipu asks).

export interface PatternTxn {
  occurredAtMs: number;
  baseAmount: number;
  type: string; // expense / income / transfer / debt_payment …
  category?: string;
  description?: string;
}

export interface RecurringChargeHint {
  label: string; // merchant/description, human
  amount: number;
  occurrences: number;
  confidence: "high" | "medium" | "low";
}

export interface SpendingPatterns {
  sampleDays: number;
  txnCount: number;
  typicalDailySpend: number; // trimmed mean of daily discretionary spend
  weekendFactor: number | null; // weekend daily / weekday daily (null if not enough data)
  recurring: RecurringChargeHint[]; // likely subscriptions / repeated charges
  topCategories: { category: string; total: number }[];
  confidence: "high" | "medium" | "low";
}

const DAY_MS = 86_400_000;

function normalizeLabel(s: string | undefined): string {
  return (s ?? "").toLowerCase().replace(/\d+/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

// Only outflows that represent real discretionary/variable spending (not
// transfers, debt payments, income, goal contributions).
function isSpend(t: PatternTxn): boolean {
  return t.type === "expense" && t.baseAmount > 0;
}

export function detectSpendingPatterns(txns: PatternTxn[], nowMs: number, windowDays = 35): SpendingPatterns {
  const since = nowMs - windowDays * DAY_MS;
  const recent = txns.filter((t) => t.occurredAtMs >= since && Number.isFinite(t.baseAmount));
  const spends = recent.filter(isSpend);

  // Daily totals for discretionary spend.
  const byDay = new Map<number, number>();
  for (const t of spends) {
    const day = Math.floor(t.occurredAtMs / DAY_MS);
    byDay.set(day, (byDay.get(day) ?? 0) + t.baseAmount);
  }
  const dailyTotals = [...byDay.values()].sort((a, b) => a - b);
  // Trimmed mean (drop the top/bottom ~10%) to ignore outlier days.
  let typicalDailySpend = 0;
  if (dailyTotals.length) {
    const cut = Math.floor(dailyTotals.length * 0.1);
    const core = dailyTotals.slice(cut, dailyTotals.length - cut || dailyTotals.length);
    const arr = core.length ? core : dailyTotals;
    typicalDailySpend = roundMoney(arr.reduce((s, v) => s + v, 0) / arr.length);
  }

  // Weekend lift.
  let weekendFactor: number | null = null;
  const weekendDaily: number[] = [];
  const weekdayDaily: number[] = [];
  for (const [day, total] of byDay) {
    const dow = new Date(day * DAY_MS).getUTCDay();
    (dow === 0 || dow === 6 ? weekendDaily : weekdayDaily).push(total);
  }
  if (weekendDaily.length >= 2 && weekdayDaily.length >= 3) {
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const wk = avg(weekdayDaily);
    if (wk > 0) weekendFactor = roundMoney(avg(weekendDaily) / wk);
  }

  // Likely recurring charges: same normalized label + similar amount, ≥2 times.
  const groups = new Map<string, PatternTxn[]>();
  for (const t of spends) {
    const key = normalizeLabel(t.description);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const recurring: RecurringChargeHint[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const amounts = list.map((t) => t.baseAmount).sort((a, b) => a - b);
    const med = amounts[Math.floor(amounts.length / 2)];
    const similar = amounts.filter((a) => Math.abs(a - med) <= Math.max(1, med * 0.15));
    if (similar.length < 2) continue;
    recurring.push({
      label: key,
      amount: roundMoney(med),
      occurrences: similar.length,
      confidence: similar.length >= 3 ? "high" : "medium",
    });
  }
  recurring.sort((a, b) => b.occurrences - a.occurrences || b.amount - a.amount);

  // Category pressure.
  const byCat = new Map<string, number>();
  for (const t of spends) byCat.set(t.category ?? "otros", (byCat.get(t.category ?? "otros") ?? 0) + t.baseAmount);
  const topCategories = [...byCat.entries()].map(([category, total]) => ({ category, total: roundMoney(total) })).sort((a, b) => b.total - a.total).slice(0, 3);

  const confidence: SpendingPatterns["confidence"] = spends.length >= 25 ? "high" : spends.length >= 8 ? "medium" : "low";

  return {
    sampleDays: windowDays,
    txnCount: spends.length,
    typicalDailySpend,
    weekendFactor,
    recurring: recurring.slice(0, 5),
    topCategories,
    confidence,
  };
}
