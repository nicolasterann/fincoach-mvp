// Stage 13 — Data Freshness engine. A DETERMINISTIC classifier that decides how
// much Kipu can trust the user's financial context right now, from the REAL
// state — not "days since last transaction" alone. It drives the ambient loop
// (whether a freshness/reconciliation nudge is even worth sending) and never
// invents certainty. Pure + unit-tested in the build gate.

export type FreshnessState =
  | "insufficient_data" // not onboarded / no accounts → cannot advise yet
  | "paused" // ambient loop paused or snoozed by the user
  | "needs_completion" // onboarded but key recurring context is missing
  | "stale" // long since any activity → data likely out of date
  | "needs_reconciliation" // balances probably drifted (spending + no recent reconcile)
  | "slightly_stale" // a noticeable gap, still usable
  | "fresh"; // up to date

export interface FreshnessInput {
  onboardingCompleted: boolean;
  ambientPaused: boolean; // engagement paused OR snoozed (paused_until in the future)
  accountsCount: number;
  hasIncome: boolean;
  hasFixedExpenses: boolean;
  // Days since the user last DID anything Kipu can see (a movement OR a chat
  // turn on any channel). null = nothing yet.
  idleDays: number | null;
  // Days since the user last confirmed balances (reconcile / adjustment). null =
  // never.
  daysSinceReconcile: number | null;
  // How long the account has existed (profile age), used when there is no
  // activity yet so a brand-new user is not treated as "stale".
  accountAgeDays: number | null;
  hasGoal: boolean;
}

export interface FreshnessResult {
  state: FreshnessState;
  // Short factual reasons for the AI to phrase naturally (never shown raw).
  reasons: string[];
  // The worst staleness in days (for priority / copy), or null.
  stalestDays: number | null;
}

const SLIGHTLY_STALE_DAYS = 4;
const STALE_DAYS = 10;
const RECONCILE_GAP_DAYS = 30;
const NEW_USER_GRACE_DAYS = 3; // a just-onboarded user with no activity isn't "stale"

export function classifyFreshness(input: FreshnessInput): FreshnessResult {
  const reasons: string[] = [];

  if (!input.onboardingCompleted || input.accountsCount === 0) {
    return { state: "insufficient_data", reasons: ["sin onboarding o sin cuentas"], stalestDays: null };
  }
  if (input.ambientPaused) {
    return { state: "paused", reasons: ["recordatorios en pausa"], stalestDays: null };
  }

  // Missing recurring context makes any margin/advice unreliable.
  if (!input.hasIncome && !input.hasFixedExpenses) {
    return {
      state: "needs_completion",
      reasons: ["falta saber el ingreso y los gastos fijos"],
      stalestDays: null,
    };
  }

  // Effective idleness: when there is no activity at all, fall back to how long
  // the account has existed so a brand-new user gets grace, not a "stale" label.
  const idle =
    input.idleDays ?? (input.accountAgeDays !== null ? input.accountAgeDays : null);

  // Brand-new user, no activity, within grace → fresh (give them room).
  if (input.idleDays === null && (input.accountAgeDays ?? 0) <= NEW_USER_GRACE_DAYS) {
    return { state: "fresh", reasons: ["cuenta recién creada"], stalestDays: null };
  }

  const stalestDays = Math.max(idle ?? 0, input.daysSinceReconcile ?? 0);

  if (idle !== null && idle >= STALE_DAYS) {
    reasons.push(`sin registrar nada hace ${idle} días`);
    return { state: "stale", reasons, stalestDays };
  }

  // Spending happened recently-ish but balances were never (or long ago)
  // confirmed → they have probably drifted; a reconcile is the useful ask.
  const reconcileStale =
    input.daysSinceReconcile === null || input.daysSinceReconcile >= RECONCILE_GAP_DAYS;
  if (reconcileStale && idle !== null && idle >= SLIGHTLY_STALE_DAYS) {
    reasons.push(
      input.daysSinceReconcile === null
        ? "los saldos nunca se han cuadrado"
        : `los saldos no se cuadran hace ${input.daysSinceReconcile} días`,
    );
    return { state: "needs_reconciliation", reasons, stalestDays };
  }

  if (idle !== null && idle >= SLIGHTLY_STALE_DAYS) {
    reasons.push(`última actividad hace ${idle} días`);
    return { state: "slightly_stale", reasons, stalestDays };
  }

  return { state: "fresh", reasons: ["al día"], stalestDays: idle };
}

// Whether a freshness state, on its own, is worth a gentle proactive check-in
// (the decision layer still applies cooldowns / quiet hours / preferences).
export function freshnessWantsNudge(state: FreshnessState): boolean {
  return (
    state === "needs_completion" ||
    state === "stale" ||
    state === "needs_reconciliation" ||
    state === "slightly_stale"
  );
}
