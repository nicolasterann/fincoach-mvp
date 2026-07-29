import { createHash } from "crypto";

// Stage 12 Phase 3 — deterministic operation identity for cross-channel
// idempotency. Every financial write a turn produces carries a dedupe_key
// (migration 019: UNIQUE (user_id, dedupe_key)) derived from:
//
//   <namespace> '#' <fingerprint> '#' <occurrence>
//
//   • namespace  — a TRUSTED, server-derived id that is STABLE across retries of
//                  the same delivery (Telegram update_id, web submission id,
//                  evidence row id) and DISTINCT for genuinely new requests.
//                  Never derived from model content.
//   • fingerprint — a stable hash of the movement's normalized financial content
//                  (type, cents, currency, source/debt/dest/goal, date).
//   • occurrence — the 0-based index among identical fingerprints WITHIN this
//                  turn, so two legitimate identical movements (two coffees of 3,
//                  two identical statement rows) get DISTINCT keys and are both
//                  kept, while a retry of the same turn re-derives the same set
//                  of keys and is fully deduplicated by the ledger's ON CONFLICT.
//
// This makes a redelivered Telegram update, a web double-submit, and a stale
// evidence re-extraction all idempotent at the ledger boundary, without
// suppressing legitimate repeats and without trusting model-generated order or a
// (non-unique) bank reference as identity.

const MAX_NAMESPACE = 80;
const MAX_DEDUPE_KEY = 200;

export function chatOperationNamespace(channel: string | undefined, requestId: string): string {
  const ch = channel === "telegram" ? "tg" : channel === "web" ? "web" : "ch";
  return `${ch}:t:${requestId}`.slice(0, MAX_NAMESPACE);
}

export function evidenceOperationNamespace(evidenceId: string): string {
  return `ev:${evidenceId}`.slice(0, MAX_NAMESPACE);
}

export interface MovementIdentityFields {
  type: string;
  cents: number;
  currency: string;
  sourceAccountId?: string | null;
  debtAccountId?: string | null;
  destinationAccountId?: string | null;
  goalId?: string | null;
  /** YYYY-MM-DD when the movement carries a real occurrence date. */
  occurredDate?: string | null;
}

export function movementFingerprint(f: MovementIdentityFields): string {
  // A debt payment has TWO identities: the cash source and the liability.
  // The original fingerprint used `sourceAccountId || debtAccountId`, so the
  // source hid the card. Two equal payments from one bank account to two
  // different cards then shared a fingerprint and depended on model call
  // order. Preserve the legacy shape for every one-legged movement; add the
  // liability only in the previously-colliding two-legged case.
  const source =
    f.sourceAccountId && f.debtAccountId
      ? `${f.sourceAccountId}|debt:${f.debtAccountId}`
      : f.sourceAccountId || f.debtAccountId || "";
  const parts = [
    f.type,
    Math.round(f.cents),
    (f.currency || "").toUpperCase(),
    source,
    f.destinationAccountId || "",
    f.goalId || "",
    f.occurredDate || "",
  ].join("|");
  return createHash("sha256").update(parts).digest("hex").slice(0, 16);
}

// Assign the next deterministic dedupe_key for a movement in this turn. Returns
// null when there is no operation namespace (legacy/uninstrumented callers keep
// their prior non-idempotent behavior rather than colliding by accident).
export function nextDedupeKey(
  namespace: string | undefined | null,
  fingerprint: string,
  occ: Map<string, number>,
): string | null {
  if (!namespace) return null;
  const n = occ.get(fingerprint) ?? 0;
  occ.set(fingerprint, n + 1);
  return `${namespace}#${fingerprint}#${n}`.slice(0, MAX_DEDUPE_KEY);
}

// A stable reconciliation operation id for this turn (durable idempotency,
// migration 020). Distinct per reconcile within the turn so two different
// accounts reconciled in one turn don't collide.
export function reconcileOperationId(
  namespace: string | undefined | null,
  seq: number,
): string | undefined {
  if (!namespace) return undefined;
  return `${namespace}:rec:${seq}`.slice(0, 200);
}
