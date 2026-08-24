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
  "m0-agent-eval-2026-08-24-native-loop-closure";
