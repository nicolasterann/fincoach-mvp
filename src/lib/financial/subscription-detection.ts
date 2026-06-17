import { roundMoney } from "@/lib/financial/money";
import type { ClassifiedTxn } from "@/lib/financial/category-intelligence";
import type { FinancialCategory } from "@/types/financial";

// Stage 16 — SUBSCRIPTION / RECURRING CHARGE detection. Finds charges that
// repeat (same merchant family, similar amount, consistent interval) and
// estimates the next charge, with HONEST confidence and no overclaiming — a
// pattern needs a consistent interval AND a similar amount before Kipu calls it
// a subscription. It flags whether each is already modeled as a fixed expense
// and which are worth proposing to convert. PURE; the conversion is the user's
// call (Kipu asks). It never auto-creates an obligation.

const DAY_MS = 86_400_000;

export type Cadence = "weekly" | "biweekly" | "monthly" | "annual" | "irregular";

export interface DetectedSubscription {
  merchantFamily: string;
  category: FinancialCategory | null;
  amount: number; // median
  amountMin: number;
  amountMax: number;
  cadence: Cadence;
  occurrences: number;
  lastChargeISO: string;
  nextChargeISO: string | null;
  alreadyModeled: boolean;
  suggestConvert: boolean;
  confidence: "high" | "medium" | "low";
}

export interface SubscriptionReport {
  subscriptions: DetectedSubscription[];
  estimatedMonthlyTotal: number;
  unmodeledCount: number;
  confidence: "high" | "medium" | "low";
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function cadenceFromDays(d: number): Cadence {
  if (d >= 5 && d <= 9) return "weekly";
  if (d >= 12 && d <= 16) return "biweekly";
  if (d >= 25 && d <= 35) return "monthly";
  if (d >= 330 && d <= 400) return "annual";
  return "irregular";
}
function cadenceDays(c: Cadence): number {
  return c === "weekly" ? 7 : c === "biweekly" ? 14 : c === "monthly" ? 30 : c === "annual" ? 365 : 0;
}
function iso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function detectSubscriptions(
  classified: ClassifiedTxn[],
  nowMs: number,
  existingFixedNames: string[] = [],
  windowDays = 75,
): SubscriptionReport {
  const since = nowMs - windowDays * DAY_MS;
  const spends = classified.filter((c) => c.isSpend && c.occurredAtMs >= since && c.baseAmount > 0);

  // Group by normalized merchant key.
  const groups = new Map<string, ClassifiedTxn[]>();
  for (const c of spends) {
    const key = c.merchant.key;
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  const fixedLower = existingFixedNames.map((n) => n.toLowerCase());
  const subs: DetectedSubscription[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const amounts = list.map((c) => c.baseAmount);
    const med = median(amounts);
    const similar = amounts.filter((a) => Math.abs(a - med) <= Math.max(1, med * 0.2));
    if (similar.length < 2) continue; // amounts not consistent → not a subscription

    const times = list.map((c) => c.occurredAtMs).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / DAY_MS);
    const medGap = gaps.length ? median(gaps) : 0;
    const cadence = cadenceFromDays(medGap);
    // Either a known subscription category, or a consistent recurring interval.
    const looksSubscription = list[0].category === "subscriptions" || cadence !== "irregular";
    if (!looksSubscription) continue;

    const occurrences = similar.length;
    const consistentInterval = gaps.length >= 2 && gaps.every((g) => Math.abs(g - medGap) <= Math.max(3, medGap * 0.25));
    const confidence: DetectedSubscription["confidence"] =
      occurrences >= 3 && consistentInterval ? "high" : occurrences >= 2 && (cadence !== "irregular" || list[0].category === "subscriptions") ? "medium" : "low";

    const lastMs = times[times.length - 1];
    const step = cadenceDays(cadence);
    const family = list[0].merchant.family;
    const alreadyModeled = fixedLower.some((n) => n.includes(family.toLowerCase()) || family.toLowerCase().includes(n));

    subs.push({
      merchantFamily: family,
      category: list[0].merchant.category ?? (list[0].category === "subscriptions" ? "subscriptions" : null),
      amount: roundMoney(med),
      amountMin: roundMoney(Math.min(...similar)),
      amountMax: roundMoney(Math.max(...similar)),
      cadence,
      occurrences,
      lastChargeISO: iso(lastMs),
      nextChargeISO: step ? iso(lastMs + step * DAY_MS) : null,
      alreadyModeled,
      suggestConvert: confidence !== "low" && !alreadyModeled && (cadence === "monthly" || cadence === "weekly" || cadence === "biweekly"),
      confidence,
    });
  }
  subs.sort((a, b) => b.amount - a.amount);

  const monthlyOf = (s: DetectedSubscription) => (s.cadence === "weekly" ? s.amount * 4.33 : s.cadence === "biweekly" ? s.amount * 2.17 : s.cadence === "annual" ? s.amount / 12 : s.amount);
  const estimatedMonthlyTotal = roundMoney(subs.filter((s) => s.confidence !== "low").reduce((sum, s) => sum + monthlyOf(s), 0));

  return {
    subscriptions: subs,
    estimatedMonthlyTotal,
    unmodeledCount: subs.filter((s) => s.suggestConvert).length,
    confidence: spends.length >= 20 ? "high" : spends.length >= 8 ? "medium" : "low",
  };
}
