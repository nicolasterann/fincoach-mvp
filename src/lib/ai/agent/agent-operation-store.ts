import { createHash } from "crypto";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import type {
  AgentOperationManifest,
  AgentOperationTransition,
} from "@/lib/ai/agent/agent-operation-authority";

export type AgentOperationStatus =
  | "planning"
  | "awaiting_input"
  | "ready"
  | "applying"
  | "verifying"
  | "completed"
  | "refused"
  | "failed_retriable"
  | "superseded"
  | "abandoned"
  | "expired";

export interface AgentContextCoverage {
  ok: boolean;
  complete: boolean;
  asOf: string;
  consulted: string[];
  failed: string[];
  truncated: string[];
}

export interface DurableAgentOperation {
  id: string;
  operationKey: string;
  channel: ChatChannel;
  chatId: string | null;
  requestText: string;
  latestRequestText: string;
  status: AgentOperationStatus;
  stateVersion: number;
  planVersion: number | null;
  plan: Record<string, unknown> | null;
  contextCoverage: AgentContextCoverage | Record<string, unknown>;
  missingFields: Array<Record<string, unknown>>;
  pendingQuestion: string | null;
  result: Record<string, unknown> | null;
  lastError: Record<string, unknown> | null;
  validatedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
  updatedAt: string;
  /** Every user delivery durably bound to this operation. Assistant prose and
   * planner output are deliberately excluded: only user-authored messages can
   * authorize a named entity introduced on an earlier clarification turn. */
  authorityMessages: string[];
  authorityDeliveries: Array<{
    deliveryKey: string;
    requestText: string;
  }>;
  /** Consecutive deliveries that consumed an answer but made no structural
   * progress on the same pending set. One clarified retry is allowed; a second
   * must resolve, modify, abandon or leave the operation instead of looping. */
  semanticStallCount: number;
  lastOperationTransition: AgentOperationTransition | null;
  steps: DurableAgentOperationStep[];
}

export interface DurableAgentOperationStep {
  id: string;
  planVersion: number;
  stepKey: string;
  stepOrder: number;
  capability: string | null;
  atomicGroup: string | null;
  status: string;
  arguments: Record<string, unknown>;
  stateWitness: Record<string, unknown>;
  effects: Array<Record<string, unknown>>;
  postconditions: Array<Record<string, unknown>>;
  result: Record<string, unknown> | null;
  affectedRefs: Array<Record<string, unknown>>;
  error: Record<string, unknown> | null;
  createdAt: string;
}

type Row = Record<string, unknown>;

/** Preserve only the server-owned KIPU_* class from an RPC error. PostgreSQL
 * messages can contain useful bounded contract diagnostics, but arbitrary
 * PostgREST text must never become durable turn metadata. */
export function boundedAgentOperationRpcDetail(error: unknown): string | undefined {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : error instanceof Error
        ? error.message
        : "";
  return message.match(/\bKIPU_[A-Z_]{2,80}\b/)?.[0];
}

const AGENT_OPERATION_STATUS_VALUES = new Set<AgentOperationStatus>([
  "planning",
  "awaiting_input",
  "ready",
  "applying",
  "verifying",
  "completed",
  "refused",
  "failed_retriable",
  "superseded",
  "abandoned",
  "expired",
]);

function isAgentOperationStatus(value: unknown): value is AgentOperationStatus {
  return (
    typeof value === "string" &&
    AGENT_OPERATION_STATUS_VALUES.has(value as AgentOperationStatus)
  );
}

export type AgentLoopManifestRejectionShape =
  | { ok: true; replayed: false; status: "planning" }
  | { ok: true; replayed: true; status: AgentOperationStatus }
  | { ok: false; reason: "invalid rejection outcome" };

export function agentLoopManifestRejectionShape(
  row: Record<string, unknown>,
): AgentLoopManifestRejectionShape {
  if (row.outcome !== "rejected") {
    return { ok: false, reason: "invalid rejection outcome" };
  }
  if (row.replayed === true) {
    return isAgentOperationStatus(row.status)
      ? { ok: true, replayed: true, status: row.status }
      : { ok: false, reason: "invalid rejection outcome" };
  }
  return row.status === "planning"
    ? { ok: true, replayed: false, status: "planning" }
    : { ok: false, reason: "invalid rejection outcome" };
}

export type AgentLoopStepStagingShape =
  | { ok: true; outcome: "staged"; status: "applying" }
  | { ok: true; outcome: "replayed"; status: AgentOperationStatus }
  | { ok: false; reason: "invalid loop staging outcome" };

export function agentLoopStepStagingShape(
  row: Record<string, unknown>,
): AgentLoopStepStagingShape {
  if (row.outcome === "replayed") {
    return isAgentOperationStatus(row.status)
      ? { ok: true, outcome: "replayed", status: row.status }
      : { ok: false, reason: "invalid loop staging outcome" };
  }
  return row.outcome === "staged" && row.status === "applying"
    ? { ok: true, outcome: "staged", status: "applying" }
    : { ok: false, reason: "invalid loop staging outcome" };
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mapOperation(
  row: Row,
  steps: DurableAgentOperationStep[] = [],
  authorityDeliveries: Array<{ deliveryKey: string; requestText: string }> = [],
): DurableAgentOperation {
  const fallbackAuthority = [row.request_text, row.latest_request_text]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    id: String(row.id),
    operationKey: String(row.operation_key ?? ""),
    channel: String(row.channel ?? "web") as ChatChannel,
    chatId: row.chat_id == null ? null : String(row.chat_id),
    requestText: String(row.request_text ?? ""),
    latestRequestText: String(row.latest_request_text ?? row.request_text ?? ""),
    status: String(row.status ?? "planning") as AgentOperationStatus,
    stateVersion: Number(row.state_version ?? 0),
    planVersion: row.plan_version == null ? null : Number(row.plan_version),
    plan: objectOrNull(row.plan),
    contextCoverage: objectOrNull(row.context_coverage) ?? {},
    missingFields: Array.isArray(row.missing_fields)
      ? row.missing_fields.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item && typeof item === "object" && !Array.isArray(item)),
        )
      : [],
    pendingQuestion:
      row.pending_question == null ? null : String(row.pending_question),
    result: objectOrNull(row.result),
    lastError: objectOrNull(row.last_error),
    validatedAt: row.validated_at == null ? null : String(row.validated_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
    expiresAt: String(row.expires_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    authorityMessages: [
      ...new Set([
        ...authorityDeliveries.map((delivery) => delivery.requestText),
        ...fallbackAuthority,
      ]),
    ],
    authorityDeliveries,
    semanticStallCount: Number(row.semantic_stall_count ?? 0),
    lastOperationTransition:
      row.last_operation_transition &&
        typeof row.last_operation_transition === "object" &&
        !Array.isArray(row.last_operation_transition)
        ? (row.last_operation_transition as unknown as AgentOperationTransition)
        : null,
    steps,
  };
}

function mapOperationStep(row: Row): DurableAgentOperationStep {
  return {
    id: String(row.id),
    planVersion: Number(row.plan_version ?? 0),
    stepKey: String(row.step_key ?? ""),
    stepOrder: Number(row.step_order ?? 0),
    capability: row.capability == null ? null : String(row.capability),
    atomicGroup: row.atomic_group == null ? null : String(row.atomic_group),
    status: String(row.status ?? "pending"),
    arguments: objectOrNull(row.arguments) ?? {},
    stateWitness: objectOrNull(row.state_witness) ?? {},
    effects: Array.isArray(row.effects)
      ? row.effects.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item && typeof item === "object" && !Array.isArray(item)),
        )
      : [],
    postconditions: Array.isArray(row.postconditions)
      ? row.postconditions.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item && typeof item === "object" && !Array.isArray(item)),
        )
      : [],
    result: objectOrNull(row.result),
    affectedRefs: Array.isArray(row.affected_refs)
      ? row.affected_refs.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item && typeof item === "object" && !Array.isArray(item)),
        )
      : [],
    error: objectOrNull(row.error),
    createdAt: String(row.created_at ?? ""),
  };
}

export type OpenAgentOperationsRead =
  | {
      ok: true;
      complete: true;
      operations: DurableAgentOperation[];
      asOf: string;
    }
  | {
      ok: true;
      complete: false;
      operations: DurableAgentOperation[];
      asOf: string;
    }
  | { ok: false; complete: false; operations: []; asOf: string };

const MAX_OPERATION_HISTORY_STEPS = 96;

/** Validate an RPC snapshot clock but preserve PostgreSQL's original
 * microsecond value. Converting through Date#toISOString truncates to
 * milliseconds and can move the bound backwards enough to hide a row
 * committed just before it. */
function validSnapshotClock(raw: unknown): string | null {
  return typeof raw === "string" &&
    raw.trim() &&
    Number.isFinite(new Date(raw).getTime())
    ? raw
    : null;
}

export interface CompletedAgentOperationSearchInput {
  userId: string;
  query?: string | null;
  after?: string | null;
  before?: string | null;
  limit?: number;
}

function normalizedOperationSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/** Semantic retrieval is still chosen by the LLM; this predicate only makes
 * the durable operation archive searchable without guessing one of the most
 * recent rows. Every requested token must be supported by the user's own
 * request/latest request or by the persisted typed plan. */
export function completedAgentOperationMatchesQuery(
  operation: Pick<
    DurableAgentOperation,
    "requestText" | "latestRequestText" | "plan"
  >,
  query: string,
): boolean {
  const terms = normalizedOperationSearchText(query)
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizedOperationSearchText(
    `${operation.requestText}\n${operation.latestRequestText}\n${JSON.stringify(operation.plan ?? {})}`,
  );
  return terms.every((term) => haystack.includes(term));
}

/** Complete-or-declared-partial read from ONE PostgreSQL snapshot (migración
 * 109). The old three-reader assembly could tear under concurrency: the parent
 * keyset paged on mutable `updated_at` — a row touched between pages jumped
 * into the already-read region and vanished — and the step/delivery readers
 * paged by offset with no snapshot bound at all, so a child committed after
 * the parent photo still landed under it while `complete` stayed true. The RPC
 * returns parents, children, CAP+1 completeness and its statement clock from
 * the same snapshot; any shape anomaly or membership breach fails closed. */
export async function readOpenAgentOperations(
  userId: string,
): Promise<OpenAgentOperationsRead> {
  const attemptedAt = new Date().toISOString();
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_read_open_agent_operations", {
      p: { user_id: userId },
    });
    const snapshot = rpcObject(data);
    const complete = snapshot?.complete;
    const operationsRaw = snapshot?.operations;
    const stepsRaw = snapshot?.steps;
    const deliveriesRaw = snapshot?.deliveries;
    // The snapshot clock is data from the same statement, never the app
    // process clock: migration 105 proved that even a small app↔DB skew hides
    // committed rows.
    const asOf =
      typeof snapshot?.as_of === "string" &&
      snapshot.as_of.trim() &&
      Number.isFinite(new Date(snapshot.as_of).getTime())
        ? snapshot.as_of
        : null;
    if (
      error ||
      !snapshot ||
      !asOf ||
      typeof complete !== "boolean" ||
      !Array.isArray(operationsRaw) ||
      !Array.isArray(stepsRaw) ||
      !Array.isArray(deliveriesRaw)
    ) {
      return { ok: false, complete: false, operations: [], asOf: attemptedAt };
    }
    const rows: Row[] = [];
    const rowIds = new Set<string>();
    for (const value of operationsRaw) {
      const row = objectOrNull(value);
      if (!row) {
        return { ok: false, complete: false, operations: [], asOf };
      }
      rows.push(row);
      rowIds.add(String(row.id));
    }
    const stepsByOperation = new Map<string, DurableAgentOperationStep[]>();
    for (const value of stepsRaw) {
      const step = objectOrNull(value);
      const operationId = step ? String(step.operation_id ?? "") : "";
      // Membership is part of the snapshot contract: a child row outside the
      // returned parent set proves this is not the single photo the migration
      // promises. Refuse instead of silently dropping it.
      if (!step || !rowIds.has(operationId)) {
        return { ok: false, complete: false, operations: [], asOf };
      }
      const current = stepsByOperation.get(operationId) ?? [];
      current.push(mapOperationStep(step));
      stepsByOperation.set(operationId, current);
    }
    const authorityByOperation = new Map<
      string,
      Array<{ deliveryKey: string; requestText: string }>
    >();
    for (const value of deliveriesRaw) {
      const delivery = objectOrNull(value);
      const operationId = delivery ? String(delivery.operation_id ?? "") : "";
      if (!delivery || !rowIds.has(operationId)) {
        return { ok: false, complete: false, operations: [], asOf };
      }
      const requestText = String(delivery.request_text ?? "").trim();
      const deliveryKey = String(delivery.delivery_key ?? "").trim();
      if (!requestText || !deliveryKey) {
        return { ok: false, complete: false, operations: [], asOf };
      }
      const current = authorityByOperation.get(operationId) ?? [];
      current.push({ deliveryKey, requestText });
      authorityByOperation.set(operationId, current);
    }
    return {
      ok: true,
      complete,
      operations: rows.map((row) =>
        mapOperation(
          row,
          stepsByOperation.get(String(row.id)) ?? [],
          authorityByOperation.get(String(row.id)) ?? [],
        ),
      ),
      asOf,
    };
  } catch {
    return { ok: false, complete: false, operations: [], asOf: attemptedAt };
  }
}

/** Search the durable archive used for operation-level correction and undo.
 * Text/date filters are selected by the model after understanding the request;
 * they are not an intent router.
 *
 * v27 (Codex re-audit): the old offset scan could MISS a concurrently
 * committing operation under MVCC — a transaction that began before the clock
 * read commits mid-scan with `completed_at` inside the bound, lands at the top
 * of the desc order (already-read region), and the boundary duplicate the
 * dedupe removed could never bring it back, yet `archiveComplete` stayed true.
 * The candidate SCAN now lives in one SQL statement (migración 111, CAP+1 at
 * 120 over the before/after-filtered set); the Unicode matcher stays in
 * TypeScript as the single truth; and the chosen ≤20 operations return with
 * their steps from a second single statement whose parent rows must match the
 * phase-1 terminal identity exactly (`completed` is terminal, so any drift
 * refutes the read and fails closed). A cap anywhere ⇒ `complete:false`; a
 * capped read never presents itself as the whole archive. */
export async function searchCompletedAgentOperations(
  input: CompletedAgentOperationSearchInput,
): Promise<OpenAgentOperationsRead> {
  const attemptedAt = new Date().toISOString();
  const safeLimit = Math.min(Math.max(Math.floor(input.limit ?? 12), 1), 20);
  const query = String(input.query ?? "").trim().slice(0, 500);
  const after = input.after?.trim() || null;
  const before = input.before?.trim() || null;
  try {
    const sb = createSupabaseAdminClient();
    const page = await sb.rpc("kipu_read_completed_agent_operations_page", {
      p: { user_id: input.userId, before, after },
    });
    const pageSnapshot = rpcObject(page.data);
    const pageComplete = pageSnapshot?.complete;
    const candidatesRaw = pageSnapshot?.operations;
    const asOf = validSnapshotClock(pageSnapshot?.as_of);
    if (
      page.error ||
      !pageSnapshot ||
      !asOf ||
      typeof pageComplete !== "boolean" ||
      !Array.isArray(candidatesRaw)
    ) {
      return { ok: false, complete: false, operations: [], asOf: attemptedAt };
    }
    const candidates: Row[] = [];
    for (const value of candidatesRaw) {
      const row = objectOrNull(value);
      if (!row) {
        return { ok: false, complete: false, operations: [], asOf };
      }
      candidates.push(row);
    }
    const matchedRows = candidates.filter((row) =>
      completedAgentOperationMatchesQuery(mapOperation(row), query),
    );
    const resultCapped = matchedRows.length > safeLimit;
    const rows = matchedRows.slice(0, safeLimit);
    let complete = pageComplete && !resultCapped;
    if (rows.length === 0) {
      return { ok: true, complete, operations: [], asOf };
    }
    const bundle = await sb.rpc("kipu_read_completed_agent_operation_bundles", {
      p: {
        user_id: input.userId,
        operation_ids: rows.map((row) => String(row.id)),
      },
    });
    const bundleSnapshot = rpcObject(bundle.data);
    const bundleComplete = bundleSnapshot?.complete;
    const bundleOpsRaw = bundleSnapshot?.operations;
    const bundleStepsRaw = bundleSnapshot?.steps;
    if (
      bundle.error ||
      !bundleSnapshot ||
      typeof bundleComplete !== "boolean" ||
      !Array.isArray(bundleOpsRaw) ||
      !Array.isArray(bundleStepsRaw)
    ) {
      return { ok: false, complete: false, operations: [], asOf };
    }
    // Terminal-identity verification: every chosen id must come back as the
    // exact completed row phase 1 saw. `completed` cannot transition, so any
    // difference (or absence) proves the bundle is not the same photo.
    const bundleById = new Map<string, Row>();
    for (const value of bundleOpsRaw) {
      const row = objectOrNull(value);
      if (!row) {
        return { ok: false, complete: false, operations: [], asOf };
      }
      bundleById.set(String(row.id), row);
    }
    for (const row of rows) {
      const returned = bundleById.get(String(row.id));
      if (
        !returned ||
        String(returned.status) !== "completed" ||
        Number(returned.state_version) !== Number(row.state_version) ||
        String(returned.completed_at) !== String(row.completed_at)
      ) {
        return { ok: false, complete: false, operations: [], asOf };
      }
    }
    complete = complete && bundleComplete;
    const rowIds = new Set(rows.map((row) => String(row.id)));
    const stepsByOperation = new Map<string, DurableAgentOperationStep[]>();
    for (const value of bundleStepsRaw) {
      const step = objectOrNull(value);
      const operationId = step ? String(step.operation_id ?? "") : "";
      if (!step || !rowIds.has(operationId)) {
        return { ok: false, complete: false, operations: [], asOf };
      }
      const current = stepsByOperation.get(operationId) ?? [];
      current.push(mapOperationStep(step));
      stepsByOperation.set(operationId, current);
    }
    const operations = rows.map((row) => {
      const steps = stepsByOperation.get(String(row.id)) ?? [];
      if (steps.length > MAX_OPERATION_HISTORY_STEPS) complete = false;
      return mapOperation(row, steps.slice(0, MAX_OPERATION_HISTORY_STEPS));
    });
    return { ok: true, complete, operations, asOf };
  } catch {
    return { ok: false, complete: false, operations: [], asOf: attemptedAt };
  }
}

/** Compatibility helper for callers that intentionally want only the newest
 * completed operations. Corrections of older work must use the searchable
 * archive above. */
export async function readRecentCompletedAgentOperations(
  userId: string,
  limit = 12,
): Promise<OpenAgentOperationsRead> {
  return searchCompletedAgentOperations({ userId, limit });
}

export interface ClaimAgentOperationInput {
  userId: string;
  deliveryKey: string;
  channel: ChatChannel;
  chatId?: string | null;
  rootMessageId: string;
  requestText: string;
  continuationOperationId?: string | null;
  supersedeOperationIds?: string[];
  abandonOperationIds?: string[];
  /** Versions from the same complete read that justified continuing/closing
   * each operation. Row locks serialize the claim; this CAS proves the plan
   * was not built before another delivery advanced the row and left it open
   * again. */
  expectedOperationVersions?: Record<string, number>;
}

export type ClaimAgentOperationResult =
  | {
      ok: true;
      outcome:
        | "claimed"
        | "resumed"
        | "replayed"
        | "recovered"
        | "recovered_plan"
        | "inflight";
      id: string;
      status: AgentOperationStatus;
      stateVersion: number;
      planVersion: number | null;
      plan: Record<string, unknown> | null;
      contextCoverage: AgentContextCoverage | Record<string, unknown>;
      result: Record<string, unknown> | null;
      pendingQuestion: string | null;
      missingFields: Array<Record<string, unknown>>;
      leaseToken: string | null;
      leaseExpiresAt: string | null;
    }
  | { ok: false; reason: string };

export type AgentOperationReplayRead =
  | { ok: true; outcome: "absent" }
  | Extract<ClaimAgentOperationResult, { ok: true }>
  | { ok: false; reason: string };

export async function recordAgentIntakeFailure(input: {
  userId: string;
  deliveryKey: string;
  channel: ChatChannel;
  chatId?: string | null;
  rootMessageId: string;
  requestText: string;
  stage: string;
  error: Record<string, unknown>;
}): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_record_agent_intake_failure", {
      p: {
        user_id: input.userId,
        delivery_key: input.deliveryKey,
        channel: input.channel,
        chat_id: input.chatId ?? null,
        message_id: input.rootMessageId,
        request_text: input.requestText,
        stage: input.stage,
        error: input.error,
      },
    });
    const row = rpcObject(data);
    return !error && row?.outcome === "recorded";
  } catch {
    return false;
  }
}

export async function resolveAgentIntakeFailure(input: {
  userId: string;
  deliveryKey: string;
  operationId: string;
}): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_resolve_agent_intake_failure", {
      p: {
        user_id: input.userId,
        delivery_key: input.deliveryKey,
        operation_id: input.operationId,
      },
    });
    const row = rpcObject(data);
    return (
      !error &&
      ["absent", "resolved", "replayed"].includes(String(row?.outcome ?? ""))
    );
  } catch {
    return false;
  }
}

function rpcObject(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return objectOrNull(data[0]);
  return objectOrNull(data);
}

/** Fast replay path. A delivered turn that already has a durable operation
 * must not depend on rebuilding financial context or sampling the planner
 * again just to return its stored outcome. Read the immutable delivery tuple,
 * verify that the key was not reused for another request, then fetch the
 * operation. Absence is not an error; every read error is. */
export async function readAgentOperationReplay(input: {
  userId: string;
  deliveryKey: string;
  channel: ChatChannel;
  chatId?: string | null;
  rootMessageId: string;
  requestText: string;
}): Promise<AgentOperationReplayRead> {
  try {
    const sb = createSupabaseAdminClient();
    const deliveryRead = await sb
      .from("agent_operation_deliveries")
      .select("operation_id,message_id,channel,chat_id,request_text")
      .eq("user_id", input.userId)
      .eq("delivery_key", input.deliveryKey)
      .maybeSingle();
    if (deliveryRead.error) {
      return { ok: false, reason: deliveryRead.error.message };
    }
    const delivery = deliveryRead.data as Row | null;
    if (!delivery) return { ok: true, outcome: "absent" };
    if (
      String(delivery.message_id ?? "") !== input.rootMessageId ||
      String(delivery.channel ?? "") !== input.channel ||
      String(delivery.chat_id ?? "") !== String(input.chatId ?? "") ||
      String(delivery.request_text ?? "") !== input.requestText.trim()
    ) {
      return {
        ok: false,
        reason: "operation delivery key was reused for a different request",
      };
    }
    return claimAgentOperation({
      userId: input.userId,
      deliveryKey: input.deliveryKey,
      channel: input.channel,
      chatId: input.chatId,
      rootMessageId: input.rootMessageId,
      requestText: input.requestText,
    });
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error ? error.message : "operation replay read failed",
    };
  }
}

export async function claimAgentOperation(
  input: ClaimAgentOperationInput,
): Promise<ClaimAgentOperationResult> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_claim_agent_operation", {
      p: {
        user_id: input.userId,
        operation_key: input.deliveryKey,
        channel: input.channel,
        chat_id: input.chatId ?? null,
        root_message_id: input.rootMessageId,
        request_text: input.requestText,
        continuation_operation_id: input.continuationOperationId ?? null,
        supersede_operation_ids: input.supersedeOperationIds ?? [],
        abandon_operation_ids: input.abandonOperationIds ?? [],
        expected_operation_versions: input.expectedOperationVersions ?? {},
      },
    });
    const row = rpcObject(data);
    if (error || !row?.id || !row.outcome) {
      return { ok: false, reason: error?.message ?? "operation claim failed" };
    }
    return {
      ok: true,
      outcome: String(row.outcome) as
        | "claimed"
        | "resumed"
        | "replayed"
        | "recovered"
        | "recovered_plan"
        | "inflight",
      id: String(row.id),
      status: String(row.status) as AgentOperationStatus,
      stateVersion: Number(row.state_version),
      planVersion:
        row.plan_version == null ? null : Number(row.plan_version),
      plan: objectOrNull(row.plan),
      contextCoverage: objectOrNull(row.context_coverage) ?? {},
      result: objectOrNull(row.result),
      pendingQuestion:
        row.pending_question == null ? null : String(row.pending_question),
      missingFields: Array.isArray(row.missing_fields)
        ? row.missing_fields.filter(
            (item): item is Record<string, unknown> =>
              Boolean(item && typeof item === "object" && !Array.isArray(item)),
          )
        : [],
      leaseToken: row.lease_token == null ? null : String(row.lease_token),
      leaseExpiresAt:
        row.lease_expires_at == null ? null : String(row.lease_expires_at),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "operation claim failed",
    };
  }
}

export type ResumeAgentOperationPlanResult =
  | {
      ok: true;
      id: string;
      status: "ready";
      stateVersion: number;
      planVersion: number;
    }
  | { ok: false; conflict: boolean; reason: string };

/** Resume the exact plan already persisted for an immutable redelivery.
 * This deliberately does not insert a new plan version. Re-sampling a model
 * after a writer landed but before its receipt was stored could derive a new
 * dedupe fingerprint and create a second economic event. PostgreSQL keeps the
 * original steps; the runtime executes only those that are not settled. */
export async function resumeAgentOperationPlan(input: {
  userId: string;
  operationId: string;
  expectedVersion: number;
  leaseToken: string;
}): Promise<ResumeAgentOperationPlanResult> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_resume_agent_operation_plan", {
      p: {
        user_id: input.userId,
        operation_id: input.operationId,
        expected_version: input.expectedVersion,
        lease_token: input.leaseToken,
      },
    });
    const row = rpcObject(data);
    if (error || !row) {
      return {
        ok: false,
        conflict: false,
        reason: error?.message ?? "persisted plan recovery failed",
      };
    }
    if (row.outcome === "conflict") {
      return { ok: false, conflict: true, reason: "operation state changed" };
    }
    if (row.status !== "ready" || row.plan_version == null) {
      return {
        ok: false,
        conflict: false,
        reason: "persisted plan recovery returned an invalid state",
      };
    }
    return {
      ok: true,
      id: String(row.id),
      status: "ready",
      stateVersion: Number(row.state_version),
      planVersion: Number(row.plan_version),
    };
  } catch (error) {
    return {
      ok: false,
      conflict: false,
      reason:
        error instanceof Error
          ? error.message
          : "persisted plan recovery failed",
    };
  }
}

export interface AgentPlanActionRow {
  id: string;
  capability: string;
  arguments: Record<string, unknown>;
  atomic_group: string | null;
  depends_on: string[];
  state_witness: Record<string, unknown>;
  effects: Array<Record<string, unknown>>;
  postconditions: Array<Record<string, unknown>>;
  /** Typed origin of every persisted monetary argument. The model declares
   * meaning; the server verifies the declared source instead of searching the
   * conversation for a magic phrase. */
  provenance?: import("@/lib/ai/agent/agent-operation-authority").AgentValueProvenance[];
}

/** One fact the answer MUST carry to satisfy what the user asked. The planner
 * derives these from the request (never a lexical router), and the publication
 * boundary verifies each one against the published text bound to its entity
 * and role. Truth and grounding stay deterministic; completeness stops being
 * an opinion of the stochastic style judge. */
export interface AgentResponseRequirement {
  id: string;
  /** Only values the publication boundary can verify and render
   * deterministically belong here. Qualitative prose stays under the semantic
   * reviewer; pretending it is covered because an entity name appeared would
   * turn the contract into a false guarantee. */
  kind: "money" | "date" | "entity";
  /** Canonical reference of the thing the fact is about. Money/date may be
   * global only when the verified evidence itself proves that shape; entity
   * requirements are always bound. */
  entity_ref: string | null;
  /** What this fact IS for that entity: amount_due, due_date, outstanding,
   * which_first, remaining_pending… Free-form on purpose: a new combination
   * must not require a new capability variant. */
  role: string;
  /** Exact discriminated payload: money={amount:number,currency:"USD"},
   * date={date:"YYYY-MM-DD"}, entity={name:"evidence-backed display name"}.
   * Aliases and extra keys are rejected so a repair receives one actionable
   * field path instead of having to guess a hidden wire contract. */
  value: Record<string, unknown>;
  source: string;
}

export interface DurableAgentPlan {
  goal: string;
  interpretation: string;
  /** Minimal set of facts the reply must cover. Empty for no_op/casual turns.
   * A requirement the verified evidence cannot prove is never demanded as an
   * affirmative fact — an unprovable claim must degrade to honest uncertainty,
   * not to invented certainty. */
  response_requirements?: AgentResponseRequirement[];
  /** Model-authored natural fallback. Every requirement id must appear once
   * as `[[id]]`; the server replaces those slots only with canonical values
   * proved by evidence. This keeps language flexible without ever waiving a
   * missing fact after the bounded repair. */
  response_template?: string | null;
  /** Natural model-authored explanation of the exact proposed operation. It
   * is used only when the mechanical risk policy requires a second delivery;
   * the user never has to copy a prescribed phrase to approve it. */
  authorization_prompt?: string | null;
  /** Open operations inspected as read-only state. They remain untouched: a
   * status question gets its own completed delivery operation and never copies
   * the observed operation's missing fields into a second awaiting row. */
  observed_operation_ids?: string[];
  assertions: Array<Record<string, unknown>>;
  ambiguities: Array<Record<string, unknown>>;
  required_reads: string[];
  actions: AgentPlanActionRow[];
  postconditions: Array<Record<string, unknown>>;
  response_intent: "answer" | "ask" | "act" | "answer_and_act" | "no_op";
  requires_replan_after_reads: boolean;
  /** Server-authored attestation of the exact root envelope that crossed the
   * planner validator before this plan was persisted. Runtime/executor pending
   * fields may evolve after a write attempt; they are not model output and
   * must never be fed back through the planner's ambiguity contract during an
   * exact worker retry. The model cannot author this field: validation rebuilds
   * DurableAgentPlan from an allow-list and the orchestrator attaches it only
   * after that validation succeeds. */
  persistence_validation?: {
    version: 1;
    delivery_key: string;
    request: {
      continuation_operation_id: string | null;
      supersede_operation_ids: string[];
      abandon_operation_ids: string[];
      missing_fields: Array<{
        key: string;
        reason: string;
        applies_to: string[];
        answer_shape: string;
      }>;
      pending_question: string | null;
      operation_transition?: import("@/lib/ai/agent/agent-operation-authority").AgentOperationTransition;
    };
    digest: string;
  };
}

export type SaveAgentOperationPlanResult =
  | {
      ok: true;
      outcome: "planned";
      id: string;
      status: "ready" | "awaiting_input";
      stateVersion: number;
      planVersion: number;
    }
  | { ok: false; conflict: boolean; reason: string };

export async function saveAgentOperationPlan(input: {
  userId: string;
  operationId: string;
  expectedVersion: number;
  plan: DurableAgentPlan;
  coverage: AgentContextCoverage;
  missingFields: Array<Record<string, unknown>>;
  pendingQuestion: string | null;
  leaseToken: string;
}): Promise<SaveAgentOperationPlanResult> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_save_agent_operation_plan", {
      p: {
        user_id: input.userId,
        operation_id: input.operationId,
        expected_version: input.expectedVersion,
        plan: input.plan,
        context_coverage: input.coverage,
        missing_fields: input.missingFields,
        pending_question: input.pendingQuestion,
        lease_token: input.leaseToken,
      },
    });
    const row = rpcObject(data);
    if (error || !row) {
      return {
        ok: false,
        conflict: false,
        reason: error?.message ?? "plan persistence failed",
      };
    }
    if (row.outcome === "conflict") {
      return { ok: false, conflict: true, reason: "operation state changed" };
    }
    return {
      ok: true,
      outcome: "planned",
      id: String(row.id),
      status: String(row.status) as "ready" | "awaiting_input",
      stateVersion: Number(row.state_version),
      planVersion: Number(row.plan_version),
    };
  } catch (error) {
    return {
      ok: false,
      conflict: false,
      reason: error instanceof Error ? error.message : "plan persistence failed",
    };
  }
}

export async function recordAgentOperationTransition(input: {
  userId: string;
  operationId: string;
  expectedVersion: number;
  deliveryKey: string;
  transition: AgentOperationTransition;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
}): Promise<{ ok: true; stateVersion: number } | { ok: false; reason: string }> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc(
      "kipu_record_agent_operation_transition",
      {
        p: {
          user_id: input.userId,
          operation_id: input.operationId,
          expected_version: input.expectedVersion,
          delivery_key: input.deliveryKey,
          transition: input.transition,
          before_state: input.beforeState ?? {},
          after_state: input.afterState ?? {},
        },
      },
    );
    const row = rpcObject(data);
    return !error && row?.outcome === "recorded" && row.state_version != null
      ? { ok: true, stateVersion: Number(row.state_version) }
      : { ok: false, reason: error?.message ?? "operation transition was not recorded" };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "operation transition was not recorded",
    };
  }
}

export type RegisterAgentOperationManifestResult =
  | {
      ok: true;
      outcome: "proposed" | "authorized";
      manifestId: string;
      manifestHash: string;
      status: "awaiting_input" | "ready";
      stateVersion: number;
      planVersion: number;
      pendingQuestion: string | null;
    }
  | { ok: false; conflict: boolean; reason: string };

export async function registerAgentOperationManifest(input: {
  userId: string;
  operationId: string;
  expectedVersion: number;
  planVersion: number;
  deliveryKey: string;
  manifest: AgentOperationManifest;
  manifestHash: string;
  requiresConfirmation: boolean;
  transitionKind: AgentOperationTransition["kind"];
  confirmationPrompt?: string | null;
}): Promise<RegisterAgentOperationManifestResult> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc(
      "kipu_register_agent_operation_manifest",
      {
        p: {
          user_id: input.userId,
          operation_id: input.operationId,
          expected_version: input.expectedVersion,
          plan_version: input.planVersion,
          delivery_key: input.deliveryKey,
          manifest: input.manifest,
          manifest_hash: input.manifestHash,
          requires_confirmation: input.requiresConfirmation,
          transition_kind: input.transitionKind,
          confirmation_prompt: input.confirmationPrompt ?? null,
        },
      },
    );
    const row = rpcObject(data);
    if (error || !row) {
      return {
        ok: false,
        conflict: false,
        reason: error?.message ?? "operation manifest registration failed",
      };
    }
    if (row.outcome === "conflict") {
      return { ok: false, conflict: true, reason: "operation state changed" };
    }
    if (!["proposed", "authorized"].includes(String(row.outcome))) {
      return { ok: false, conflict: false, reason: "invalid manifest outcome" };
    }
    return {
      ok: true,
      outcome: String(row.outcome) as "proposed" | "authorized",
      manifestId: String(row.manifest_id),
      manifestHash: String(row.manifest_hash),
      status: String(row.status) as "awaiting_input" | "ready",
      stateVersion: Number(row.state_version),
      planVersion: Number(row.plan_version),
      pendingQuestion:
        row.pending_question == null ? null : String(row.pending_question),
    };
  } catch (error) {
    return {
      ok: false,
      conflict: false,
      reason: error instanceof Error ? error.message : "operation manifest registration failed",
    };
  }
}

/** Authorize the exact manifest shown by a prior delivery and restore its
 * already-validated plan. The confirmation turn contributes only semantic
 * lifecycle authority; it never has to reproduce N tool payloads byte for
 * byte. PostgreSQL binds the new delivery, pending manifest, operation lease
 * and persisted plan under one transaction/CAS. */
export async function authorizeAgentOperationManifest(input: {
  userId: string;
  operationId: string;
  expectedVersion: number;
  deliveryKey: string;
  leaseToken: string;
  transition: AgentOperationTransition;
}): Promise<
  | {
      ok: true;
      id: string;
      status: "ready";
      stateVersion: number;
      planVersion: number;
      manifestId: string;
      manifestHash: string;
    }
  | { ok: false; conflict: boolean; reason: string }
> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc(
      "kipu_authorize_agent_operation_manifest",
      {
        p: {
          user_id: input.userId,
          operation_id: input.operationId,
          expected_version: input.expectedVersion,
          delivery_key: input.deliveryKey,
          lease_token: input.leaseToken,
          transition: input.transition,
        },
      },
    );
    const row = rpcObject(data);
    if (error || !row) {
      return {
        ok: false,
        conflict: false,
        reason: error?.message ?? "operation manifest authorization failed",
      };
    }
    if (row.outcome === "conflict") {
      return { ok: false, conflict: true, reason: "operation state changed" };
    }
    if (
      row.outcome !== "authorized" ||
      row.status !== "ready" ||
      row.plan_version == null
    ) {
      return {
        ok: false,
        conflict: false,
        reason: "operation manifest authorization returned an invalid state",
      };
    }
    return {
      ok: true,
      id: String(row.id),
      status: "ready",
      stateVersion: Number(row.state_version),
      planVersion: Number(row.plan_version),
      manifestId: String(row.manifest_id),
      manifestHash: String(row.manifest_hash),
    };
  } catch (error) {
    return {
      ok: false,
      conflict: false,
      reason:
        error instanceof Error
          ? error.message
          : "operation manifest authorization failed",
    };
  }
}

export async function beginAgentOperationManifest(input: {
  userId: string;
  operationId: string;
  planVersion: number;
  leaseToken: string;
}): Promise<
  | {
      ok: true;
      manifestId: string;
      manifestHash: string;
      /** Exact-delivery recovery after execution+verification succeeded but
       * publication crashed. The runtime must reuse receipts and never execute
       * the manifest again. */
      alreadyVerified: boolean;
      verification: Record<string, unknown> | null;
    }
  | { ok: false; reason: string }
> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_begin_agent_operation_manifest", {
      p: {
        user_id: input.userId,
        operation_id: input.operationId,
        plan_version: input.planVersion,
        lease_token: input.leaseToken,
      },
    });
    const row = rpcObject(data);
    return !error && ["executing", "already_verified"].includes(String(row?.outcome))
      ? {
          ok: true,
          manifestId: String(row!.manifest_id),
          manifestHash: String(row!.manifest_hash),
          alreadyVerified: row!.outcome === "already_verified",
          verification: objectOrNull(row!.verification),
        }
      : { ok: false, reason: error?.message ?? "operation manifest did not begin" };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "operation manifest did not begin",
    };
  }
}

export async function verifyAgentOperationManifest(input: {
  userId: string;
  operationId: string;
  planVersion: number;
  leaseToken?: string | null;
  allowIncomplete?: boolean;
}): Promise<
  | { ok: true; verification: Record<string, unknown> }
  | {
      ok: false;
      reason: string;
      reasonCode: string | null;
      verification: Record<string, unknown> | null;
    }
> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_verify_agent_operation_manifest", {
      p: {
        user_id: input.userId,
        operation_id: input.operationId,
        plan_version: input.planVersion,
        lease_token: input.leaseToken ?? null,
        allow_incomplete: input.allowIncomplete === true,
      },
    });
    const row = rpcObject(data);
    return !error && ["verified", "partially_verified"].includes(String(row?.outcome))
      ? { ok: true, verification: objectOrNull(row?.verification) ?? {} }
      : {
          ok: false,
          reasonCode:
            typeof row?.reason_code === "string" ? row.reason_code : null,
          verification: objectOrNull(row?.verification),
          reason:
            error?.message ??
            (typeof row?.reason === "string"
              ? row.reason
              : "operation manifest verification failed"),
        };
  } catch (error) {
    return {
      ok: false,
      reasonCode: null,
      verification: null,
      reason: error instanceof Error ? error.message : "operation manifest verification failed",
    };
  }
}

export type LeaseAgentOperationResult =
  | {
      ok: true;
      id: string;
      stateVersion: number;
      leaseToken: string;
      leaseExpiresAt: string;
    }
  | { ok: false; conflict: boolean; reason: string };

export async function beginAgentOperationApplication(input: {
  userId: string;
  operationId: string;
  expectedVersion: number;
}): Promise<LeaseAgentOperationResult> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc(
      "kipu_begin_agent_operation_application",
      {
        p: {
          user_id: input.userId,
          operation_id: input.operationId,
          expected_version: input.expectedVersion,
        },
      },
    );
    const row = rpcObject(data);
    if (error || !row) {
      return {
        ok: false,
        conflict: false,
        reason: error?.message ?? "operation lease failed",
      };
    }
    if (row.outcome === "conflict") {
      return { ok: false, conflict: true, reason: "operation state changed" };
    }
    if (!row.lease_token) {
      return { ok: false, conflict: false, reason: "operation lease missing" };
    }
    return {
      ok: true,
      id: String(row.id),
      stateVersion: Number(row.state_version),
      leaseToken: String(row.lease_token),
      leaseExpiresAt: String(row.lease_expires_at),
    };
  } catch (error) {
    return {
      ok: false,
      conflict: false,
      reason: error instanceof Error ? error.message : "operation lease failed",
    };
  }
}

export type TransitionAgentOperationResult =
  | {
      ok: true;
      id: string;
      status: AgentOperationStatus;
      stateVersion: number;
      replayed: boolean;
    }
  | { ok: false; conflict: boolean; reason: string };

export async function transitionAgentOperation(input: {
  userId: string;
  operationId: string;
  expectedVersion: number;
  status: AgentOperationStatus;
  leaseToken?: string | null;
  result?: Record<string, unknown> | null;
  lastError?: Record<string, unknown> | null;
  missingFields?: Array<Record<string, unknown>>;
  pendingQuestion?: string | null;
  expiresAt?: string | null;
  planVersion?: number;
  plan?: Record<string, unknown>;
}): Promise<TransitionAgentOperationResult> {
  try {
    const sb = createSupabaseAdminClient();
    const payload: Record<string, unknown> = {
      user_id: input.userId,
      operation_id: input.operationId,
      expected_version: input.expectedVersion,
      status: input.status,
      lease_token: input.leaseToken ?? null,
    };
    if (input.result !== undefined) payload.result = input.result;
    if (input.lastError !== undefined) payload.last_error = input.lastError;
    if (input.missingFields !== undefined) {
      payload.missing_fields = input.missingFields;
    }
    if (input.pendingQuestion !== undefined) {
      payload.pending_question = input.pendingQuestion;
    }
    if (input.expiresAt !== undefined) {
      payload.expires_at = input.expiresAt;
    }
    if (input.planVersion !== undefined) payload.plan_version = input.planVersion;
    if (input.plan !== undefined) payload.plan = input.plan;
    const { data, error } = await sb.rpc("kipu_transition_agent_operation", {
      p: payload,
    });
    const row = rpcObject(data);
    if (error || !row) {
      return {
        ok: false,
        conflict: false,
        reason: error?.message ?? "operation transition failed",
      };
    }
    if (row.outcome === "conflict") {
      return { ok: false, conflict: true, reason: "operation state changed" };
    }
    return {
      ok: true,
      id: String(row.id),
      status: String(row.status) as AgentOperationStatus,
      stateVersion: Number(row.state_version),
      replayed: row.outcome === "replayed",
    };
  } catch (error) {
    return {
      ok: false,
      conflict: false,
      reason:
        error instanceof Error ? error.message : "operation transition failed",
    };
  }
}

export async function expireAgentOperations(userId: string): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { error } = await sb.rpc("kipu_expire_agent_operations", {
      p_user: userId,
    });
    return !error;
  } catch {
    return false;
  }
}

export type AgentStepExecutionEffect =
  | "read"
  | "write"
  | "noop"
  | "failed"
  | "needs_info";

export async function recordAgentOperationStepOutcome(input: {
  userId: string;
  operationId: string;
  stepKey: string;
  capability: string;
  arguments: Record<string, unknown>;
  toolStatus: "done" | "redirect" | "needs_info" | "refused" | "error";
  executionEffect: AgentStepExecutionEffect;
  result: Record<string, unknown>;
  affectedRefs?: Array<Record<string, unknown>>;
  leaseToken?: string | null;
}): Promise<{ ok: true; status: string } | { ok: false; reason: string }> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc(
      "kipu_record_agent_operation_step_outcome",
      {
        p: {
          user_id: input.userId,
          operation_id: input.operationId,
          step_key: input.stepKey,
          capability: input.capability,
          arguments: input.arguments,
          tool_status: input.toolStatus,
          execution_effect: input.executionEffect,
          result: input.result,
          affected_refs: input.affectedRefs ?? [],
          lease_token: input.leaseToken ?? null,
        },
      },
    );
    const row = rpcObject(data);
    if (error || !row?.status) {
      return { ok: false, reason: error?.message ?? "step receipt failed" };
    }
    return { ok: true, status: String(row.status) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "step receipt failed",
    };
  }
}

export type StageAgentLoopStepResult =
  | {
      ok: true;
      outcome: "staged";
      id: string;
      status: "applying";
      stateVersion: number;
      planVersion: number;
      step: DurableAgentOperationStep;
    }
  | {
      ok: true;
      outcome: "replayed";
      id: string;
      status: AgentOperationStatus;
      stateVersion: number;
      planVersion: number;
      step: DurableAgentOperationStep;
    }
  | { ok: false; conflict: boolean; reason: string };

/** Persist one native tool call before dispatch. Migration 116 derives all
 * durable authority except the catalog effect mode inside PostgreSQL; the
 * caller can neither supply an effects array nor a manifest body. */
export async function stageAgentLoopStep(input: {
  userId: string;
  operationId: string;
  expectedVersion: number;
  deliveryKey: string;
  leaseToken: string;
  seq: number;
  capability: string;
  arguments: Record<string, unknown>;
  effectMode: "read" | "domain_state" | "economic_event" | "contextual_event";
}): Promise<StageAgentLoopStepResult> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_stage_agent_loop_step", {
      p: {
        user_id: input.userId,
        operation_id: input.operationId,
        expected_version: input.expectedVersion,
        delivery_key: input.deliveryKey,
        lease_token: input.leaseToken,
        seq: input.seq,
        capability: input.capability,
        arguments: input.arguments,
        effect_mode: input.effectMode,
      },
    });
    const row = rpcObject(data);
    if (error || !row) {
      return {
        ok: false,
        conflict: false,
        reason: error?.message ?? "loop step staging failed",
      };
    }
    if (row.outcome === "conflict") {
      return { ok: false, conflict: true, reason: "operation state changed" };
    }
    const shape = agentLoopStepStagingShape(row);
    if (!shape.ok) {
      return { ok: false, conflict: false, reason: shape.reason };
    }
    const step = mapOperationStep({
      id: row.step_key,
      plan_version: row.plan_version,
      step_key: row.step_key,
      step_order: row.step_order,
      capability: row.capability,
      status: row.step_status,
      arguments: row.arguments,
      effects: row.effects,
      result: row.result,
      affected_refs: row.affected_refs,
    });
    const result = {
      id: String(row.id),
      stateVersion: Number(row.state_version),
      planVersion: Number(row.plan_version),
      step,
    };
    return shape.outcome === "replayed"
      ? {
          ok: true,
          outcome: "replayed",
          status: shape.status,
          ...result,
        }
      : {
          ok: true,
          outcome: "staged",
          status: "applying",
          ...result,
        };
  } catch (error) {
    return {
      ok: false,
      conflict: false,
      reason: error instanceof Error ? error.message : "loop step staging failed",
    };
  }
}

export async function registerAgentLoopManifest(input: {
  userId: string;
  operationId: string;
  expectedVersion: number;
  deliveryKey: string;
  leaseToken: string;
  stepKeys: string[];
  confirmationPrompt: string;
}): Promise<RegisterAgentOperationManifestResult & {
  manifest?: Record<string, unknown>;
}> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_register_agent_loop_manifest", {
      p: {
        user_id: input.userId,
        operation_id: input.operationId,
        expected_version: input.expectedVersion,
        delivery_key: input.deliveryKey,
        lease_token: input.leaseToken,
        step_keys: input.stepKeys,
        confirmation_prompt: input.confirmationPrompt,
      },
    });
    const row = rpcObject(data);
    if (error || !row) {
      return {
        ok: false,
        conflict: false,
        reason: error?.message ?? "loop manifest registration failed",
      };
    }
    if (row.outcome === "conflict") {
      return { ok: false, conflict: true, reason: "operation state changed" };
    }
    if (row.outcome !== "proposed") {
      return { ok: false, conflict: false, reason: "invalid loop manifest outcome" };
    }
    return {
      ok: true,
      outcome: "proposed",
      manifestId: String(row.manifest_id),
      manifestHash: String(row.manifest_hash),
      status: "awaiting_input",
      stateVersion: Number(row.state_version),
      planVersion: Number(row.plan_version),
      pendingQuestion: String(row.pending_question ?? ""),
      manifest: objectOrNull(row.manifest) ?? undefined,
    };
  } catch (error) {
    return {
      ok: false,
      conflict: false,
      reason: error instanceof Error ? error.message : "loop manifest registration failed",
    };
  }
}

export async function rejectAgentOperationManifest(input: {
  userId: string;
  operationId: string;
  expectedVersion: number;
  deliveryKey: string;
  leaseToken: string;
  transition: AgentOperationTransition;
}): Promise<
  | {
      ok: true;
      replayed: false;
      status: "planning";
      stateVersion: number;
      planVersion: number;
      manifestId: string;
      manifestHash: string;
    }
  | {
      ok: true;
      replayed: true;
      status: AgentOperationStatus;
      stateVersion: number;
      planVersion: number;
      manifestId: string;
      manifestHash: string;
    }
  | { ok: false; conflict: boolean; reason: string }
> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_reject_agent_operation_manifest", {
      p: {
        user_id: input.userId,
        operation_id: input.operationId,
        expected_version: input.expectedVersion,
        delivery_key: input.deliveryKey,
        lease_token: input.leaseToken,
        transition: input.transition,
      },
    });
    const row = rpcObject(data);
    if (error || !row) {
      return {
        ok: false,
        conflict: false,
        reason: error?.message ?? "loop manifest rejection failed",
      };
    }
    if (row.outcome === "conflict") {
      return { ok: false, conflict: true, reason: "operation state changed" };
    }
    const shape = agentLoopManifestRejectionShape(row);
    if (!shape.ok) {
      return { ok: false, conflict: false, reason: shape.reason };
    }
    const result = {
      stateVersion: Number(row.state_version),
      planVersion: Number(row.plan_version),
      manifestId: String(row.manifest_id),
      manifestHash: String(row.manifest_hash),
    };
    return shape.replayed
      ? { ok: true, replayed: true, status: shape.status, ...result }
      : { ok: true, replayed: false, status: "planning", ...result };
  } catch (error) {
    return {
      ok: false,
      conflict: false,
      reason: error instanceof Error ? error.message : "loop manifest rejection failed",
    };
  }
}

export async function verifyAgentLoopStep(input: {
  userId: string;
  operationId: string;
  planVersion: number;
  stepKey: string;
  capability: string;
  arguments: Record<string, unknown>;
  leaseToken: string;
  postWriteContextVerified: boolean;
}): Promise<
  | { ok: true; replayed: boolean }
  | { ok: false; reason: string; detail?: string }
> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_verify_agent_loop_step", {
      p: {
        user_id: input.userId,
        operation_id: input.operationId,
        plan_version: input.planVersion,
        step_key: input.stepKey,
        capability: input.capability,
        arguments: input.arguments,
        lease_token: input.leaseToken,
        post_write_context_verified: input.postWriteContextVerified,
      },
    });
    const row = rpcObject(data);
    return !error && row?.outcome === "verified"
      ? { ok: true, replayed: row.replayed === true }
      : {
          ok: false,
          reason: error?.message ?? "loop step verification failed",
          ...(boundedAgentOperationRpcDetail(error)
            ? { detail: boundedAgentOperationRpcDetail(error) }
            : {}),
        };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "loop step verification failed",
      ...(boundedAgentOperationRpcDetail(error)
        ? { detail: boundedAgentOperationRpcDetail(error) }
        : {}),
    };
  }
}

export async function verifyAgentLoopManifest(input: {
  userId: string;
  operationId: string;
  planVersion: number;
  leaseToken: string;
}): Promise<
  | { ok: true; replayed: boolean; verification: Record<string, unknown> }
  | { ok: false; reason: string; detail?: string }
> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_verify_agent_loop_manifest", {
      p: {
        user_id: input.userId,
        operation_id: input.operationId,
        plan_version: input.planVersion,
        lease_token: input.leaseToken,
      },
    });
    const row = rpcObject(data);
    return !error && row?.outcome === "verified"
      ? {
          ok: true,
          replayed: row.replayed === true,
          verification: objectOrNull(row.verification) ?? {},
        }
      : {
          ok: false,
          reason: error?.message ?? "loop manifest verification failed",
          ...(boundedAgentOperationRpcDetail(error)
            ? { detail: boundedAgentOperationRpcDetail(error) }
            : {}),
        };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "loop manifest verification failed",
      ...(boundedAgentOperationRpcDetail(error)
        ? { detail: boundedAgentOperationRpcDetail(error) }
        : {}),
    };
  }
}

export type QuarantineAgentLoopOperationReason =
  | "terminal_step"
  | "resume_failure"
  | "claim_failure"
  | "repeated_turn_failure";

export async function quarantineAgentLoopOperation(input: {
  userId: string;
  operationId: string;
  expectedVersion: number;
  planVersion: number;
  deliveryKey: string;
  rootMessageId: string;
  channel: ChatChannel;
  chatId?: string | null;
  leaseToken?: string | null;
  reasonCode: QuarantineAgentLoopOperationReason;
}): Promise<
  | {
      ok: true;
      id: string;
      status: "abandoned";
      stateVersion: number;
      planVersion: number;
      manifestId: string;
      manifestHash: string;
      verification: Record<string, unknown>;
      replayed: boolean;
    }
  | { ok: false; conflict: boolean; reason: string; detail?: string }
> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc(
      "kipu_quarantine_agent_loop_operation",
      {
        p: {
          user_id: input.userId,
          operation_id: input.operationId,
          expected_version: input.expectedVersion,
          plan_version: input.planVersion,
          delivery_key: input.deliveryKey,
          root_message_id: input.rootMessageId,
          channel: input.channel,
          chat_id: input.chatId ?? null,
          lease_token: input.leaseToken ?? null,
          reason_code: input.reasonCode,
        },
      },
    );
    const row = rpcObject(data);
    if (error || !row) {
      const detail = boundedAgentOperationRpcDetail(error);
      return {
        ok: false,
        conflict: detail === "KIPU_CONFLICT",
        reason: error?.message ?? "loop operation quarantine failed",
        ...(detail ? { detail } : {}),
      };
    }
    if (row.outcome === "conflict") {
      return {
        ok: false,
        conflict: true,
        reason: "operation state changed before quarantine",
      };
    }
    const verification = objectOrNull(row.verification);
    if (
      row.outcome !== "quarantined" ||
      row.status !== "abandoned" ||
      !row.manifest_id ||
      !row.manifest_hash ||
      !verification ||
      verification.kind !== "loop_quarantined"
    ) {
      return {
        ok: false,
        conflict: false,
        reason: "loop operation quarantine returned an invalid state",
      };
    }
    return {
      ok: true,
      id: String(row.id),
      status: "abandoned",
      stateVersion: Number(row.state_version),
      planVersion: Number(row.plan_version),
      manifestId: String(row.manifest_id),
      manifestHash: String(row.manifest_hash),
      verification,
      replayed: row.replayed === true,
    };
  } catch (error) {
    const detail = boundedAgentOperationRpcDetail(error);
    return {
      ok: false,
      conflict: detail === "KIPU_CONFLICT",
      reason:
        error instanceof Error ? error.message : "loop operation quarantine failed",
      ...(detail ? { detail } : {}),
    };
  }
}

export interface AgentLoopManifestRead {
  id: string;
  planVersion: number;
  status: string;
  manifestHash: string;
  manifest: Record<string, unknown>;
  proposedDeliveryKey: string;
  authorizedDeliveryKey: string | null;
}

export async function readAgentLoopManifest(input: {
  userId: string;
  operationId: string;
  planVersion: number;
}): Promise<
  | { ok: true; manifest: AgentLoopManifestRead | null }
  | { ok: false; reason: string }
> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from("agent_operation_manifests")
      .select(
        "id,plan_version,status,manifest_hash,manifest,proposed_delivery_key,authorized_delivery_key",
      )
      .eq("user_id", input.userId)
      .eq("operation_id", input.operationId)
      .filter("plan_version", "eq", input.planVersion)
      .maybeSingle();
    if (error) return { ok: false, reason: error.message };
    const row = data as Row | null;
    if (!row) return { ok: true, manifest: null };
    const manifest = objectOrNull(row.manifest);
    if (!manifest || manifest.kind !== "loop_staged") {
      return { ok: false, reason: "loop manifest shape is invalid" };
    }
    return {
      ok: true,
      manifest: {
        id: String(row.id),
        planVersion: Number(row.plan_version),
        status: String(row.status),
        manifestHash: String(row.manifest_hash),
        manifest,
        proposedDeliveryKey: String(row.proposed_delivery_key),
        authorizedDeliveryKey:
          row.authorized_delivery_key == null
            ? null
            : String(row.authorized_delivery_key),
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "loop manifest read failed",
    };
  }
}

export async function verifyAgentOperation(input: {
  userId: string;
  operationId: string;
  leaseToken?: string | null;
  postWriteContextVerified: boolean;
  allowIncomplete?: boolean;
}): Promise<
  | { ok: true; stepCount: number; writeCount: number }
  | { ok: false; reason: string }
> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_verify_agent_operation", {
      p: {
        user_id: input.userId,
        operation_id: input.operationId,
        lease_token: input.leaseToken ?? null,
        post_write_context_verified: input.postWriteContextVerified,
        allow_incomplete: input.allowIncomplete === true,
      },
    });
    const row = rpcObject(data);
    if (error || row?.outcome !== "verified") {
      return {
        ok: false,
        reason: error?.message ?? "operation verification failed",
      };
    }
    return {
      ok: true,
      stepCount: Number(row.step_count ?? 0),
      writeCount: Number(row.write_count ?? 0),
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error ? error.message : "operation verification failed",
    };
  }
}

export type ResolvedAgentStepType =
  | "ledger_entry"
  | "card_payment"
  | "repayment"
  | "debt_proceeds"
  | "operation_reversal";

export async function preflightAgentOperationStep(input: {
  userId: string;
  operationId: string;
  stepKey: string;
  resolvedType: ResolvedAgentStepType;
  resolvedPayload: Record<string, unknown>;
  leaseToken: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc(
      "kipu_preflight_agent_operation_step",
      {
        p: {
          user_id: input.userId,
          operation_id: input.operationId,
          step_key: input.stepKey,
          resolved_type: input.resolvedType,
          resolved_payload: input.resolvedPayload,
          lease_token: input.leaseToken,
        },
      },
    );
    const row = rpcObject(data);
    return !error && row?.outcome === "preflighted"
      ? { ok: true }
      : {
          ok: false,
          reason: error?.message ?? "atomic step preflight failed",
        };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error ? error.message : "atomic step preflight failed",
    };
  }
}

export async function applyAgentAtomicGroup(input: {
  userId: string;
  operationId: string;
  atomicGroup: string;
  leaseToken: string;
}): Promise<
  | { ok: true; replayed: boolean; results: Array<Record<string, unknown>> }
  | { ok: false; reason: string }
> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_apply_operation", {
      p: {
        user_id: input.userId,
        operation_id: input.operationId,
        atomic_group: input.atomicGroup,
        lease_token: input.leaseToken,
      },
    });
    const row = rpcObject(data);
    if (error || !row || !["applied", "replayed"].includes(String(row.outcome))) {
      return {
        ok: false,
        reason: error?.message ?? "atomic operation failed",
      };
    }
    return {
      ok: true,
      replayed: row.outcome === "replayed",
      results: Array.isArray(row.results)
        ? row.results.filter(
            (item): item is Record<string, unknown> =>
              Boolean(item && typeof item === "object" && !Array.isArray(item)),
          )
        : [],
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "atomic operation failed",
    };
  }
}

export function agentPlanFingerprint(plan: DurableAgentPlan): string {
  return createHash("sha256")
    .update(JSON.stringify(plan))
    .digest("hex")
    .slice(0, 24);
}
