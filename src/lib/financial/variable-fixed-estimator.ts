import { roundMoney } from "@/lib/financial/money";

export type VariableFixedConfidence = "baseline" | "low" | "medium" | "high";
export type VariableFixedMethod = "declared" | "conservative_p75";

export interface VariableFixedObservation {
  id: string;
  amount: number;
  currency: string;
  cycleDate: string;
  cadence: string;
  regime: number;
  current: boolean;
}

export interface VariableFixedEstimateInput {
  declaredAmount: number;
  currency: string;
  cadence: string;
  regime: number;
  observations: readonly VariableFixedObservation[];
  maxSamples?: number;
}

export interface VariableFixedEstimate {
  planningAmount: number;
  currency: string;
  sampleCount: number;
  confidence: VariableFixedConfidence;
  method: VariableFixedMethod;
  median: number | null;
  p75: number | null;
  dispersion: number | null;
  inlierIds: string[];
  outlierIds: string[];
  /** High observations that remain evidence but were capped at the robust
   * upper fence so one exceptional bill cannot dominate the protected plan. */
  winsorizedIds: string[];
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  const weight = pos - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function median(values: readonly number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

function normalizedCurrency(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Conservative estimator for a recurring bill whose amount varies.
 *
 * - Observations never cross currency/cadence/regime boundaries.
 * - Fewer than three observations cannot replace the user's declared plan.
 * - At three or more observations we reserve the robust 75th percentile, not
 *   the mean. A cheap month therefore cannot inflate Saldo, while a single
 *   unusually cheap reading may be rejected by a MAD/ratio fence. An expensive
 *   real bill remains evidence, but is winsorized at a deliberately wide upper
 *   fence: it still raises protection without letting one exceptional cycle
 *   dominate for months.
 * - Only the most recent `maxSamples` current observations participate.
 */
export function estimateVariableFixedExpense(
  input: VariableFixedEstimateInput,
): VariableFixedEstimate {
  const declaredRaw = Number(input.declaredAmount);
  const currency = normalizedCurrency(input.currency);
  const cadence = input.cadence.trim().toLowerCase();
  if (!Number.isFinite(declaredRaw) || declaredRaw < 0) {
    throw new RangeError("declaredAmount must be a finite non-negative amount");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new RangeError("currency must be a canonical ISO-like code");
  }
  if (!["weekly", "biweekly", "monthly", "yearly", "custom"].includes(cadence)) {
    throw new RangeError("cadence is not supported");
  }
  if (!Number.isInteger(input.regime) || input.regime < 1) {
    throw new RangeError("regime must be a positive integer");
  }
  const declared = roundMoney(declaredRaw);
  const maxSamples = Math.max(3, Math.min(24, Math.floor(input.maxSamples ?? 24)));
  const eligible = input.observations
    .filter(
      (observation) =>
        observation.current &&
        observation.regime === input.regime &&
        normalizedCurrency(observation.currency) === currency &&
        observation.cadence.trim().toLowerCase() === cadence &&
        Number.isFinite(observation.amount) &&
        observation.amount >= 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(observation.cycleDate),
    )
    .sort((a, b) =>
      a.cycleDate === b.cycleDate
        ? a.id.localeCompare(b.id)
        : a.cycleDate.localeCompare(b.cycleDate),
    )
    .slice(-maxSamples);

  if (eligible.length === 0) {
    return {
      planningAmount: declared,
      currency,
      sampleCount: 0,
      confidence: "baseline",
      method: "declared",
      median: null,
      p75: null,
      dispersion: null,
      inlierIds: [],
      outlierIds: [],
      winsorizedIds: [],
    };
  }

  const allAmounts = eligible.map((observation) => observation.amount);
  const center = median(allAmounts);
  const deviations = allAmounts.map((amount) => Math.abs(amount - center));
  const mad = median(deviations);
  // Keep ordinary seasonality (utilities can legitimately double in a hot/cold
  // season). A suspiciously cheap cycle is excluded because it could inflate
  // Saldo. A suspiciously expensive cycle remains evidence, but is winsorized
  // at the symmetric robust fence: it still raises the reserve without letting
  // one exceptional invoice make the planning number unusable for months.
  const fence = Math.max(0.01, center * 0.75, mad * 4);
  // A zero-heavy history has center=0 and MAD=0. Using that scale alone caps a
  // genuine positive invoice at 0.01 and can LOWER protection even though the
  // only non-zero evidence is expensive. In that degenerate regime the user's
  // declared plan is the only honest scale we have: let one high cycle lift the
  // p75, but cap its contribution so a single typo still cannot dominate.
  const upperFence =
    center <= 0.01
      ? Math.max(0.01, declared * 4)
      : center + fence;
  let inliers = eligible.filter(
    (observation) => observation.amount >= center - fence,
  );
  // With a tiny sample the fence can be too eager. Never manufacture
  // confidence by deleting most of the evidence.
  if (inliers.length < Math.min(2, eligible.length)) inliers = eligible;
  const inlierIds = new Set(inliers.map((observation) => observation.id));
  const winsorizedIds = inliers
    .filter((observation) => observation.amount > upperFence)
    .map((observation) => observation.id);
  const sorted = inliers
    .map((observation) => Math.min(observation.amount, upperFence))
    .sort((a, b) => a - b);
  const robustMedian = median(sorted);
  const p75 = quantile(sorted, 0.75);
  const dispersion =
    robustMedian > 0
      ? median(sorted.map((amount) => Math.abs(amount - robustMedian))) / robustMedian
      : sorted.every((amount) => amount === 0)
        ? 0
        : 1;

  const sampleCount = inliers.length;
  if (sampleCount < 3) {
    return {
      planningAmount: declared,
      currency,
      sampleCount,
      confidence: "low",
      method: "declared",
      median: roundMoney(robustMedian),
      p75: roundMoney(p75),
      dispersion,
      inlierIds: inliers.map((observation) => observation.id),
      outlierIds: eligible.filter((observation) => !inlierIds.has(observation.id)).map((observation) => observation.id),
      winsorizedIds,
    };
  }

  // During the first learned months, do not let a run of unusually cheap bills
  // lower the protected amount by more than 15% versus the user's declared
  // plan. Once six inlier cycles exist, the history is allowed to stand alone.
  const earlyFloor = sampleCount < 6 ? declared * 0.85 : 0;
  const planningAmount = roundMoney(Math.max(0, p75, earlyFloor));
  const confidence: VariableFixedConfidence =
    sampleCount >= 6 && dispersion <= 0.25 ? "high" : "medium";

  return {
    planningAmount,
    currency,
    sampleCount,
    confidence,
    method: "conservative_p75",
    median: roundMoney(robustMedian),
    p75: roundMoney(p75),
    dispersion,
    inlierIds: inliers.map((observation) => observation.id),
    outlierIds: eligible.filter((observation) => !inlierIds.has(observation.id)).map((observation) => observation.id),
    winsorizedIds,
  };
}
