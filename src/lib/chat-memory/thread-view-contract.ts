import type { TurnAuthor } from "@/lib/chat-memory/turn-provenance";

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

export type CompleteThreadRows = {
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

export function visibleThreadText(content: string): string {
  return content.replaceAll(KIPU_INTERNAL_WRITE_RECEIPT, "").trim();
}
