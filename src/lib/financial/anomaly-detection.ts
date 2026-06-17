import { roundMoney } from "@/lib/financial/money";
import type { ClassifiedTxn } from "@/lib/financial/category-intelligence";
import type { SpendingBaselines } from "@/lib/financial/category-baselines";
import type { FinancialCategory } from "@/types/financial";

// Stage 16 — ANOMALY DETECTION. Graded and quiet: Kipu only surfaces what a
// sharp friend would actually mention — a charge that's way above this user's
// normal, a possible duplicate, a large one-off that dents the week. It NEVER
// overreacts to a single normal purchase and never fires on tiny samples. PURE.
// Every anomaly carries an honest margin impact so the agent can explain "why it
// matters" instead of just flagging noise.

const DAY_MS = 86_400_000;

export type AnomalyKind = "duplicate_suspected" | "large_one_off" | "category_spike" | "unusual_charge";
export type AnomalySeverity = "info" | "watch" | "notable";

export interface Anomaly {
  kind: AnomalyKind;
  severity: AnomalySeverity;
  category: FinancialCategory;
  parentCategory: string;
  merchantFamily: string;
  amount: number;
  occurredAtISO: string;
  vsTypical: number; // multiple of the user's typical single charge in this category
  marginImpact: number; // how much of this week's safe spend it eats (estimate)
  note: string; // structured Spanish fact for the agent to rephrase (never shown raw)
  confidence: "high" | "medium" | "low";
}

export interface AnomalyReport {
  anomalies: Anomaly[];
  topConcern: Anomaly | null;
  confidence: "high" | "medium" | "low";
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function iso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function detectAnomalies(
  classified: ClassifiedTxn[],
  baselines: SpendingBaselines,
  nowMs: number,
  safeThisWeek: number,
  recentDays = 10,
): AnomalyReport {
  const spends = classified.filter((c) => c.isSpend && c.baseAmount > 0);
  // Per-category typical single charge, from the whole window (cautious).
  const chargesByCat = new Map<FinancialCategory, number[]>();
  for (const c of spends) {
    const arr = chargesByCat.get(c.category) ?? [];
    arr.push(c.baseAmount);
    chargesByCat.set(c.category, arr);
  }
  const typicalCharge = new Map<FinancialCategory, number>();
  for (const [cat, xs] of chargesByCat) typicalCharge.set(cat, median(xs));

  const recentSince = nowMs - recentDays * DAY_MS;
  const recent = spends.filter((c) => c.occurredAtMs >= recentSince).sort((a, b) => b.occurredAtMs - a.occurredAtMs);
  const safe = Math.max(0, safeThisWeek);
  const marginImpactOf = (amt: number) => (safe > 0 ? roundMoney(amt / safe) : 0);

  const anomalies: Anomaly[] = [];
  const seen: { key: string; amount: number; ms: number }[] = [];

  for (const c of recent) {
    const typical = typicalCharge.get(c.category) ?? 0;
    const catSample = chargesByCat.get(c.category)?.length ?? 0;
    const vsTypical = typical > 0 ? roundMoney(c.baseAmount / typical) : 0;

    // Duplicate-looking: same merchant key + near-equal amount within 72h.
    const dup = seen.find((s) => s.key && s.key === c.merchant.key && Math.abs(s.amount - c.baseAmount) <= Math.max(0.5, c.baseAmount * 0.02) && Math.abs(s.ms - c.occurredAtMs) <= 3 * DAY_MS);
    if (dup && c.merchant.key) {
      anomalies.push({
        kind: "duplicate_suspected",
        severity: "watch",
        category: c.category,
        parentCategory: c.parentCategory,
        merchantFamily: c.merchant.family,
        amount: roundMoney(c.baseAmount),
        occurredAtISO: iso(c.occurredAtMs),
        vsTypical,
        marginImpact: marginImpactOf(c.baseAmount),
        note: `Posible cargo duplicado en ${c.merchant.family}: ${roundMoney(c.baseAmount)} repetido en menos de 3 días.`,
        confidence: "medium",
      });
    }
    seen.push({ key: c.merchant.key, amount: c.baseAmount, ms: c.occurredAtMs });

    // Large one-off vs the user's whole typical week of controllable spend.
    const weeklyControllable = baselines.typicalDailyVariable * 7;
    const isLargeOneOff = c.isControllable && weeklyControllable > 0 && c.baseAmount >= weeklyControllable * 0.6 && c.baseAmount >= 15;
    // Category spike: well above this user's typical single charge here.
    const isSpike = c.isControllable && catSample >= 4 && typical > 0 && vsTypical >= 2.5 && c.baseAmount >= 10;

    if (isLargeOneOff || isSpike) {
      const impact = marginImpactOf(c.baseAmount);
      const severity: AnomalySeverity = impact >= 0.4 ? "notable" : impact >= 0.15 ? "watch" : "info";
      anomalies.push({
        kind: isLargeOneOff ? "large_one_off" : "category_spike",
        severity,
        category: c.category,
        parentCategory: c.parentCategory,
        merchantFamily: c.merchant.family,
        amount: roundMoney(c.baseAmount),
        occurredAtISO: iso(c.occurredAtMs),
        vsTypical,
        marginImpact: impact,
        note: isLargeOneOff
          ? `Gasto grande en ${c.parentCategory} (${c.merchant.family}): ${roundMoney(c.baseAmount)}, equivale a buena parte de tu semana variable.`
          : `${c.parentCategory} (${c.merchant.family}) en ${roundMoney(c.baseAmount)} está ~${vsTypical}x tu cargo normal ahí.`,
        confidence: catSample >= 6 ? "high" : "medium",
      });
    }
  }

  // De-dup: keep at most one anomaly per (kind, merchant, day); strongest first.
  const order: Record<AnomalySeverity, number> = { notable: 3, watch: 2, info: 1 };
  anomalies.sort((a, b) => order[b.severity] - order[a.severity] || b.marginImpact - a.marginImpact || b.amount - a.amount);
  const deduped: Anomaly[] = [];
  const keyset = new Set<string>();
  for (const a of anomalies) {
    const k = `${a.kind}|${a.merchantFamily}|${a.occurredAtISO}`;
    if (keyset.has(k)) continue;
    keyset.add(k);
    deduped.push(a);
  }

  return {
    anomalies: deduped,
    topConcern: deduped.find((a) => a.severity !== "info") ?? null,
    confidence: baselines.confidence,
  };
}
