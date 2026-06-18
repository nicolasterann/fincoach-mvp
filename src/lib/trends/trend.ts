import { roundMoney } from "@/lib/financial/money";

// Stage 20 (micro-stage G) — TREND engine. PURE. Compares the latest financial
// snapshot against a PRIOR one to power honest "¿qué cambió?" / dashboard trends.
// HONEST by construction: with no prior snapshot it says "no_prior" (never invents
// a yesterday/today comparison). Direction uses a small dead-band so noise doesn't
// read as a change. Some metrics are "good when up" (net worth, Margen, safe spend,
// readiness); others "good when down" (debt) — the engine tags the GOOD direction.

export interface SnapshotMetrics {
  margenWeekly: number;
  safeWeekly: number;
  netWorth: number;
  totalDebt: number;
  readiness: number; // 0..100
}

export type TrendDirection = "up" | "down" | "flat" | "no_prior";

export interface MetricTrend {
  metric: keyof SnapshotMetrics;
  current: number;
  prior: number | null;
  deltaAbs: number; // 0 when no prior
  deltaPct: number | null; // null when no prior or prior 0
  direction: TrendDirection;
  isImprovement: boolean | null; // null when no prior/flat
}

// "good when up" for all but debt.
const GOOD_WHEN_UP: Record<keyof SnapshotMetrics, boolean> = { margenWeekly: true, safeWeekly: true, netWorth: true, totalDebt: false, readiness: true };

function deadband(metric: keyof SnapshotMetrics): number {
  // Absolute dead-band so tiny moves read as "flat".
  return metric === "readiness" ? 2 : 1;
}

export function metricTrend(metric: keyof SnapshotMetrics, current: number, prior: number | null): MetricTrend {
  if (prior === null || !Number.isFinite(prior)) {
    return { metric, current: roundMoney(current), prior: null, deltaAbs: 0, deltaPct: null, direction: "no_prior", isImprovement: null };
  }
  const deltaAbs = roundMoney(current - prior);
  const band = deadband(metric);
  let direction: TrendDirection;
  if (Math.abs(deltaAbs) < band) direction = "flat";
  else direction = deltaAbs > 0 ? "up" : "down";
  const deltaPct = prior !== 0 ? Math.round((deltaAbs / Math.abs(prior)) * 100) : null;
  const isImprovement = direction === "flat" ? null : (direction === "up") === GOOD_WHEN_UP[metric];
  return { metric, current: roundMoney(current), prior: roundMoney(prior), deltaAbs, deltaPct, direction, isImprovement };
}

export function compareSnapshots(latest: SnapshotMetrics, prior: SnapshotMetrics | null): MetricTrend[] {
  const metrics: (keyof SnapshotMetrics)[] = ["margenWeekly", "safeWeekly", "netWorth", "totalDebt", "readiness"];
  return metrics.map((m) => metricTrend(m, latest[m], prior ? prior[m] : null));
}

const LABEL: Record<keyof SnapshotMetrics, string> = {
  margenWeekly: "tu Margen semanal", safeWeekly: "lo que puedes gastar a la semana", netWorth: "tu patrimonio", totalDebt: "tu deuda", readiness: "tu Pulso",
};

// Compact Spanish digest — ONLY mentions metrics with a prior AND a real change.
// "Honest from available data": silent when there's no prior or nothing moved.
export function trendDigest(trends: MetricTrend[]): string {
  const moved = trends.filter((t) => t.direction === "up" || t.direction === "down");
  if (moved.length === 0) return "";
  const parts = moved.map((t) => {
    const word = t.metric === "totalDebt" ? (t.direction === "down" ? "bajó" : "subió") : (t.direction === "up" ? "subió" : "bajó");
    return `${LABEL[t.metric]} ${word}${t.deltaPct !== null ? ` ${Math.abs(t.deltaPct)}%` : ""}${t.isImprovement === false ? " (a cuidar)" : ""}`;
  });
  return `CAMBIOS DESDE LA ÚLTIMA FOTO (úsalo solo si el usuario pregunta '¿qué cambió?' o si es relevante; NO lo recites por defecto, NUNCA inventes comparaciones sin foto previa): ${parts.join("; ")}.`;
}

export interface SnapshotTrend {
  hasPrior: boolean;
  trends: MetricTrend[];
  digest: string;
}

export function buildSnapshotTrend(latest: SnapshotMetrics, prior: SnapshotMetrics | null): SnapshotTrend {
  const trends = compareSnapshots(latest, prior);
  return { hasPrior: prior !== null, trends, digest: prior ? trendDigest(trends) : "" };
}

export function emptySnapshotTrend(): SnapshotTrend {
  return { hasPrior: false, trends: [], digest: "" };
}
