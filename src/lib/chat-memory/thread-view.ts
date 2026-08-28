import "server-only";

import { describeMovement } from "@/app/app/components/app-dashboard-helpers";
import { loadCurrentFxRatesForDisplay } from "@/lib/fx/fx-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  dedupeThreadRows,
  readCompleteThreadRowsWith,
  storedTurnStatus,
  visibleThreadText,
} from "@/lib/chat-memory/thread-view-contract";
import type {
  ThreadMessageReader,
  ThreadMessageRow,
  ThreadReceipt,
  ThreadReceiptLine,
  ThreadTurn,
  ThreadView,
} from "@/lib/chat-memory/thread-view-contract";
import { turnAuthor } from "@/lib/chat-memory/turn-provenance";
import type { CurrencyCode } from "@/types/financial";

type ThreadClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

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
    const text = visibleThreadText(row.content);
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

/** Reads back a just-persisted turn so optimistic UI receives the same durable
 * identity and text that a subsequent full page load will reconstruct. */
export async function readFreshThreadTurn(input: {
  client: ThreadClient;
  userId: string;
  turnId: string;
  role?: "user" | "assistant";
}): Promise<ThreadTurn | null> {
  const role = input.role ?? "assistant";
  const { data, error } = await input.client
    .from("chat_messages")
    .select("id, role, channel, content, operation_key, metadata, created_at")
    .eq("user_id", input.userId)
    .eq("id", input.turnId)
    .eq("role", role)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as ThreadMessageRow;
  if (row.channel !== "web" && row.channel !== "telegram") return null;
  const text = visibleThreadText(row.content);
  if (role === "assistant" && !text) return null;
  const operationId = operationIdOf(row);
  const receipts = role === "assistant" && operationId
    ? await buildThreadReceipts(input.client, input.userId, [operationId])
    : new Map<string, ThreadReceipt>();

  return {
    id: row.id,
    role,
    author: turnAuthor({ role: row.role, metadata: row.metadata }),
    channel: row.channel,
    createdAtISO: row.created_at,
    text,
    status: role === "assistant" ? storedTurnStatus(row.metadata ?? {}) : null,
    receipt:
      role === "assistant" && operationId
        ? (receipts.get(operationId) ?? null)
        : null,
    attachment: attachmentOf(role, row.content),
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
