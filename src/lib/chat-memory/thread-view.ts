import "server-only";

import { describeMovement } from "@/app/app/components/app-dashboard-helpers";
import { loadCurrentFxRatesForDisplay } from "@/lib/fx/fx-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  turnAuthor,
  type TurnAuthor,
} from "@/lib/chat-memory/turn-provenance";
import type { CurrencyCode } from "@/types/financial";

export type { TurnAuthor };

export type TurnStatus =
  | "success"
  | "needs_clarification"
  | "unsupported"
  | "failed";

export interface ThreadReceiptLine {
  label: string;
  amountLabel: string;
  kindLabel: string;
}

export interface ThreadReceipt {
  lines: ThreadReceiptLine[];
  saldoLabel: string | null;
  incomplete: boolean;
}

export interface ThreadTurn {
  id: string;
  role: "user" | "assistant";
  author: TurnAuthor;
  channel: "web" | "telegram";
  createdAtISO: string;
  text: string;
  status: TurnStatus | null;
  receipt: ThreadReceipt | null;
  attachment: { kind: "image" | "document"; label: string } | null;
}

export interface ThreadView {
  turns: ThreadTurn[];
  complete: boolean;
  readFailed: boolean;
}

export const KIPU_INTERNAL_WRITE_RECEIPT = "KIPU_INTERNAL_WRITE_RECEIPT";

type ThreadClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ThreadMessageRow {
  id: string;
  role: string;
  channel: string;
  content: string;
  operation_key?: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ThreadMessageReader {
  page(
    cursor: { createdAt: string; id: string } | null,
    limit: number,
  ): Promise<{ rows: ThreadMessageRow[] | null; error: string | null }>;
  count(): Promise<{ count: number | null; error: string | null }>;
}

export const THREAD_PAGE = 200;
export const THREAD_CAP = 800;

type CompleteThreadRows = {
  rows: ThreadMessageRow[];
  complete: boolean;
  readFailed: boolean;
};

/** Cursor + CAP+1 reader. Reaching a cap, losing a count, or observing a
 * cursor/count mismatch is partial by construction; none of those states may
 * masquerade as the beginning of a conversation. */
export async function readCompleteThreadRowsWith(
  reader: ThreadMessageReader,
  pageSize = THREAD_PAGE,
  cap = THREAD_CAP,
): Promise<CompleteThreadRows> {
  const byId = new Map<string, ThreadMessageRow>();
  let cursor: { createdAt: string; id: string } | null = null;
  let reachedEnd = false;

  try {
    while (byId.size < cap) {
      const requested = Math.min(pageSize, cap - byId.size);
      const page = await reader.page(cursor, requested + 1);
      if (page.error || page.rows === null) {
        return { rows: [], complete: false, readFailed: true };
      }

      const hasMore = page.rows.length > requested;
      const accepted = page.rows.slice(0, requested);
      for (const row of accepted) byId.set(row.id, row);

      if (!hasMore) {
        reachedEnd = true;
        break;
      }

      const last = accepted[accepted.length - 1];
      if (!last?.id || !last.created_at) {
        return { rows: [...byId.values()], complete: false, readFailed: false };
      }
      const next = { createdAt: last.created_at, id: last.id };
      if (cursor && cursor.createdAt === next.createdAt && cursor.id === next.id) {
        return { rows: [...byId.values()], complete: false, readFailed: false };
      }
      cursor = next;
    }

    const rows = [...byId.values()];
    if (!reachedEnd) return { rows, complete: false, readFailed: false };

    const counted = await reader.count();
    if (counted.error || counted.count === null) {
      return { rows, complete: false, readFailed: false };
    }
    return {
      rows,
      complete: counted.count === byId.size,
      readFailed: false,
    };
  } catch {
    return { rows: [], complete: false, readFailed: true };
  }
}

function durableIdentityPart(
  row: ThreadMessageRow,
): { kind: string; value: string } | null {
  // The operation can legitimately span several user deliveries. Its id binds
  // receipts, but it is not enough to prove two chat turns are duplicates.
  // operation_key is the durable identity of one delivered role/turn.
  if (typeof row.operation_key === "string" && row.operation_key.trim()) {
    return { kind: "delivery", value: row.operation_key.trim() };
  }

  const metadata = row.metadata ?? {};
  const keys = [
    "calendarDigestClaimId",
    "objectiveCloseClaimId",
    "ambientClaimId",
    "deliveryFingerprint",
    "operationFingerprint",
  ] as const;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return { kind: key, value: value.trim() };
    }
  }
  return null;
}

/** Identity-only dedupe. Text, timestamps, and visual similarity are
 * deliberately absent: without a durable key, both deliveries stay visible. */
export function threadIdentityKey(row: ThreadMessageRow): string | null {
  const identity = durableIdentityPart(row);
  if (!identity) return null;
  return `${row.role}:${identity.kind}:${identity.value}`;
}

function chronological(a: ThreadMessageRow, b: ThreadMessageRow): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

export function dedupeThreadRows(rows: ThreadMessageRow[]): ThreadMessageRow[] {
  const withoutIdentity: ThreadMessageRow[] = [];
  const byIdentity = new Map<string, ThreadMessageRow>();

  for (const row of [...rows].sort(chronological)) {
    const identity = threadIdentityKey(row);
    if (!identity) {
      withoutIdentity.push(row);
      continue;
    }
    const current = byIdentity.get(identity);
    if (!current || (current.channel !== "web" && row.channel === "web")) {
      byIdentity.set(identity, row);
    }
  }

  return [...withoutIdentity, ...byIdentity.values()].sort(chronological);
}

export function storedTurnStatus(metadata: Record<string, unknown>): TurnStatus | null {
  const status = metadata.chatResponseStatus;
  return status === "success" ||
    status === "needs_clarification" ||
    status === "unsupported" ||
    status === "failed"
    ? status
    : null;
}

function safeTurnText(content: string): string {
  return content.replaceAll(KIPU_INTERNAL_WRITE_RECEIPT, "").trim();
}

function attachmentOf(
  role: "user" | "assistant",
  content: string,
): ThreadTurn["attachment"] {
  if (role !== "user") return null;
  if (content.trim().startsWith("📄")) {
    return { kind: "document", label: content.replace(/^📄\s*/, "").trim() || "Documento" };
  }
  if (content.trim().startsWith("📷")) {
    return { kind: "image", label: content.replace(/^📷\s*/, "").trim() || "Imagen" };
  }
  return null;
}

function operationIdOf(row: ThreadMessageRow): string | null {
  const durable = row.metadata?.durableOperation;
  if (!durable || typeof durable !== "object") return null;
  const id = (durable as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

interface OperationStepRow {
  operation_id: string;
  status: string;
  affected_refs: unknown;
  step_order: number;
}

interface TransactionRow {
  id: string;
  type: string;
  description: string;
  category: string | null;
  base_amount: number | string;
  base_currency: string;
  debt_account_id: string | null;
  goal_id: string | null;
}

function transactionIdsFromSteps(steps: OperationStepRow[]): string[] {
  const ids = new Set<string>();
  for (const step of [...steps].sort((a, b) => a.step_order - b.step_order)) {
    if (step.status !== "verified" && step.status !== "applied") continue;
    if (!Array.isArray(step.affected_refs)) continue;
    for (const ref of step.affected_refs) {
      if (!ref || typeof ref !== "object") continue;
      const type = (ref as { type?: unknown }).type;
      const id = (ref as { id?: unknown }).id;
      if (type === "transaction" && typeof id === "string" && id.trim()) {
        ids.add(id.trim());
      }
    }
  }
  return [...ids];
}

function transactionKindLabel(type: string): string {
  const labels: Record<string, string> = {
    expense: "Gasto",
    income: "Ingreso",
    refund: "Reembolso",
    debt_payment: "Pago de deuda",
    goal_contribution: "Aporte a meta",
    transfer: "Transferencia",
    reversal: "Reverso",
    adjustment: "Ajuste",
  };
  return labels[type] ?? "Movimiento";
}

const TRANSACTION_READ_CHUNK = 100;

/** Reconstructs display receipts from verified/applied operation steps and a
 * fresh ledger read. The operation/model metadata only supplies identities;
 * every visible label and amount comes from persisted transaction rows. */
export async function buildThreadReceipts(
  client: ThreadClient,
  userId: string,
  operationIds: string[],
): Promise<Map<string, ThreadReceipt>> {
  const uniqueOperations = [...new Set(operationIds.filter(Boolean))];
  const receipts = new Map<string, ThreadReceipt>();
  if (uniqueOperations.length === 0) return receipts;

  const { data: stepData, error: stepError } = await client
    .from("agent_operation_steps")
    .select("operation_id, status, affected_refs, step_order")
    .eq("user_id", userId)
    .in("operation_id", uniqueOperations)
    .in("status", ["verified", "applied"])
    .order("step_order", { ascending: true });
  if (stepError || !Array.isArray(stepData)) return receipts;

  const stepsByOperation = new Map<string, OperationStepRow[]>();
  for (const step of stepData as OperationStepRow[]) {
    const bucket = stepsByOperation.get(step.operation_id) ?? [];
    bucket.push(step);
    stepsByOperation.set(step.operation_id, bucket);
  }

  const idsByOperation = new Map<string, string[]>();
  const allTransactionIds = new Set<string>();
  for (const operationId of uniqueOperations) {
    const ids = transactionIdsFromSteps(stepsByOperation.get(operationId) ?? []);
    if (ids.length === 0) continue;
    idsByOperation.set(operationId, ids);
    ids.forEach((id) => allTransactionIds.add(id));
  }
  if (allTransactionIds.size === 0) return receipts;

  const [profileRead, ratesRead] = await Promise.all([
    client
      .from("profiles")
      .select("base_currency, display_currency")
      .eq("id", userId)
      .maybeSingle(),
    loadCurrentFxRatesForDisplay(userId).then(
      (rates) => ({ rates, failed: false as const }),
      () => ({ rates: [], failed: true as const }),
    ),
  ]);
  const profile = profileRead.data as
    | { base_currency?: string | null; display_currency?: string | null }
    | null;
  const displayCurrency =
    typeof profile?.display_currency === "string" && profile.display_currency
      ? (profile.display_currency as CurrencyCode)
      : undefined;
  const formattingIncomplete = Boolean(profileRead.error || ratesRead.failed);

  const transactions = new Map<string, TransactionRow>();
  let ledgerReadFailed = false;
  const transactionIds = [...allTransactionIds];
  for (let offset = 0; offset < transactionIds.length; offset += TRANSACTION_READ_CHUNK) {
    const chunk = transactionIds.slice(offset, offset + TRANSACTION_READ_CHUNK);
    const { data, error } = await client
      .from("transactions")
      .select(
        "id, type, description, category, base_amount, base_currency, debt_account_id, goal_id",
      )
      .eq("user_id", userId)
      .in("id", chunk);
    if (error || !Array.isArray(data)) {
      ledgerReadFailed = true;
      continue;
    }
    for (const row of data as TransactionRow[]) transactions.set(row.id, row);
  }

  for (const [operationId, ids] of idsByOperation) {
    const lines: ThreadReceiptLine[] = [];
    for (const id of ids) {
      const tx = transactions.get(id);
      if (!tx) continue;
      const view = describeMovement(tx, {
        displayCurrency,
        rates: ratesRead.rates,
      });
      const prefix = view.tone === "in" ? "+" : view.tone === "out" ? "−" : "";
      lines.push({
        label: view.sublabel ? `${view.title} · ${view.sublabel}` : view.title,
        amountLabel: `${prefix}${view.amount}`,
        kindLabel: transactionKindLabel(tx.type),
      });
    }
    receipts.set(operationId, {
      lines,
      // No historical post-write Saldo fact is persisted on the operation.
      // Inferring it from current state or model copy would lie, so it stays null.
      saldoLabel: null,
      incomplete:
        ledgerReadFailed || formattingIncomplete || lines.length !== ids.length,
    });
  }

  return receipts;
}

function liveThreadReader(
  client: ThreadClient,
  userId: string,
  since: string | null,
): ThreadMessageReader {
  const base = () => {
    let query = client
      .from("chat_messages")
      .select("id, role, channel, content, operation_key, metadata, created_at")
      .eq("user_id", userId)
      .in("channel", ["web", "telegram"])
      .neq("role", "system");
    if (since) query = query.gt("created_at", since);
    return query;
  };

  return {
    async page(cursor, limit) {
      let query = base()
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (cursor) {
        query = query.or(
          `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`,
        );
      }
      const { data, error } = await query;
      return {
        rows: Array.isArray(data) ? (data as ThreadMessageRow[]) : null,
        error: error?.message ?? null,
      };
    },
    async count() {
      let query = client
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("channel", ["web", "telegram"])
        .neq("role", "system");
      if (since) query = query.gt("created_at", since);
      const { count, error } = await query;
      return { count, error: error?.message ?? null };
    },
  };
}

export async function readThreadView(input: {
  client: ThreadClient;
  userId: string;
  since?: string | null;
}): Promise<ThreadView> {
  const read = await readCompleteThreadRowsWith(
    liveThreadReader(input.client, input.userId, input.since ?? null),
  );
  if (read.readFailed) {
    return { turns: [], complete: false, readFailed: true };
  }

  const rows = dedupeThreadRows(read.rows).filter(
    (row) =>
      (row.role === "user" || row.role === "assistant") &&
      (row.channel === "web" || row.channel === "telegram"),
  );
  const operationIds = rows.map(operationIdOf).filter((id): id is string => Boolean(id));
  const receipts = await buildThreadReceipts(input.client, input.userId, operationIds);

  const turns = rows.flatMap((row): ThreadTurn[] => {
    const role = row.role as "user" | "assistant";
    const text = safeTurnText(row.content);
    if (role === "assistant" && !text) return [];
    const status = storedTurnStatus(row.metadata ?? {});
    if (role === "assistant" && status === "failed") return [];
    const operationId = operationIdOf(row);
    return [
      {
        id: row.id,
        role,
        author: turnAuthor({ role, metadata: row.metadata }),
        channel: row.channel as "web" | "telegram",
        createdAtISO: row.created_at,
        text,
        status,
        receipt: operationId ? (receipts.get(operationId) ?? null) : null,
        attachment: attachmentOf(role, row.content),
      },
    ];
  });

  return { turns, complete: read.complete, readFailed: false };
}

/** Reads back the just-persisted assistant turn so the optimistic UI receives
 * the same durable id, status, provenance, timestamp, and ledger receipt that
 * a subsequent full page load will reconstruct. */
export async function readFreshThreadTurn(input: {
  client: ThreadClient;
  userId: string;
  turnId: string;
}): Promise<ThreadTurn | null> {
  const { data, error } = await input.client
    .from("chat_messages")
    .select("id, role, channel, content, operation_key, metadata, created_at")
    .eq("user_id", input.userId)
    .eq("id", input.turnId)
    .eq("role", "assistant")
    .maybeSingle();
  if (error || !data) return null;

  const row = data as ThreadMessageRow;
  if (row.channel !== "web" && row.channel !== "telegram") return null;
  const text = safeTurnText(row.content);
  if (!text) return null;
  const operationId = operationIdOf(row);
  const receipts = operationId
    ? await buildThreadReceipts(input.client, input.userId, [operationId])
    : new Map<string, ThreadReceipt>();

  return {
    id: row.id,
    role: "assistant",
    author: turnAuthor({ role: row.role, metadata: row.metadata }),
    channel: row.channel,
    createdAtISO: row.created_at,
    text,
    status: storedTurnStatus(row.metadata ?? {}),
    receipt: operationId ? (receipts.get(operationId) ?? null) : null,
    attachment: null,
  };
}

/** Presence proof for the sanctuary ribbon. Both joins are durable identities:
 * ledger transaction -> landed operation step -> persisted assistant metadata.
 * Any missing link returns null so the UI falls back to general activity. */
export async function findThreadTurnForTransaction(input: {
  client: ThreadClient;
  userId: string;
  transactionId: string;
}): Promise<string | null> {
  const { data: steps, error: stepError } = await input.client
    .from("agent_operation_steps")
    .select("operation_id, affected_refs, created_at")
    .eq("user_id", input.userId)
    .in("status", ["verified", "applied"])
    .contains("affected_refs", [
      { type: "transaction", id: input.transactionId },
    ])
    .order("created_at", { ascending: false })
    .limit(1);
  if (stepError || !Array.isArray(steps) || !steps[0]) return null;
  const operationId = (steps[0] as { operation_id?: unknown }).operation_id;
  if (typeof operationId !== "string" || !operationId) return null;

  const { data: turns, error: turnError } = await input.client
    .from("chat_messages")
    .select("id")
    .eq("user_id", input.userId)
    .eq("role", "assistant")
    .in("channel", ["web", "telegram"])
    .contains("metadata", { durableOperation: { id: operationId } })
    .order("created_at", { ascending: false })
    .limit(1);
  if (turnError || !Array.isArray(turns) || !turns[0]) return null;
  const turnId = (turns[0] as { id?: unknown }).id;
  return typeof turnId === "string" && turnId ? turnId : null;
}
