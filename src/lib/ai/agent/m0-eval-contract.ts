/**
 * The live-model QA talks to a compiled Next server while its assertions run
 * from the current source tree. Without a handshake, a stale dev process can
 * test yesterday's agent and report its failures as if they belonged to today's
 * code (the 726-vs-731 capture mismatch exposed exactly that state).
 *
 * Bump this value whenever the M0 publication/runtime contract changes. Both
 * the route and the runner import the current value; a stale server necessarily
 * reports an older value (or none) and the suite aborts before creating a user.
 */
export const M0_AGENT_EVAL_CONTRACT =
  "m0-agent-eval-2026-08-14-subtractive-semantic-plan-m0-11a";

interface EvalPendingClarification {
  toolName?: unknown;
  appliesToActionIds?: unknown;
}

interface EvalPlanAction {
  id?: unknown;
  capability?: unknown;
}

/** Resolve what durable scope a clarification blocks without confusing its
 * author with its target. Executor challenges carry a capability in toolName;
 * planner missing_fields point either at a blocked action or at the explicit
 * response-only scope through appliesToActionIds. */
export function pendingClarificationTargetsScope(
  pending: EvalPendingClarification,
  planActions: EvalPlanAction[],
  target: string,
): boolean {
  const actionIds = Array.isArray(pending.appliesToActionIds)
    ? pending.appliesToActionIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (target === "$response") return actionIds.includes("$response");
  if (pending.toolName === target) return true;
  if (actionIds.length === 0) return false;
  const targetIds = new Set(actionIds);
  return planActions.some(
    (action) =>
      action.capability === target &&
      typeof action.id === "string" &&
      targetIds.has(action.id),
  );
}
