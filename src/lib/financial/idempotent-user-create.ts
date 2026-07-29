import { createHash } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export interface AgentCreateIdentity {
  operationKey: string;
}

export interface IdempotentCreateResult {
  id: string;
  replayed: boolean;
}

export interface IdempotentCreatePort {
  insert: (
    table: string,
    row: Record<string, unknown>,
  ) => Promise<{
    data: { id?: unknown } | null;
    error: { code?: string; message?: string } | null;
  }>;
  readMarker: (
    table: string,
    userId: string,
    operationKey: string,
  ) => Promise<{
    data:
      | { id?: unknown; agent_payload_fingerprint?: unknown }
      | null;
    error: { message?: string } | null;
  }>;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([key, nested]) =>
            nested !== undefined &&
            ![
              "agent_operation_key",
              "agent_payload_fingerprint",
              "created_at",
              "updated_at",
              "valuation_date",
            ].includes(key),
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
}

export function agentCreateFingerprint(
  row: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(row)))
    .digest("hex");
}

/** One row is also its replay marker. The partial unique index installed by
 * migration 088 serializes concurrent redeliveries; after a lost response the
 * retry proves both the operation key and the exact payload fingerprint before
 * returning the original id. Other uniqueness errors never masquerade as a
 * replay because the marker lookup then finds no matching operation. */
export async function insertIdempotentUserRow(input: {
  table: string;
  userId: string;
  row: Record<string, unknown>;
  identity?: AgentCreateIdentity | null;
}, injected?: IdempotentCreatePort): Promise<IdempotentCreateResult | null> {
  const operationKey = input.identity?.operationKey.trim() || null;
  const payloadFingerprint = operationKey
    ? agentCreateFingerprint(input.row)
    : null;
  const row = {
    ...input.row,
    ...(operationKey
      ? {
          agent_operation_key: operationKey,
          agent_payload_fingerprint: payloadFingerprint,
        }
      : {}),
  };
  let port: IdempotentCreatePort;
  try {
    port =
      injected ??
      (() => {
        const supabase = createSupabaseAdminClient();
        return {
          insert: async (table: string, next: Record<string, unknown>) => {
            const result = await supabase
              .from(table)
              .insert(next)
              .select("id")
              .single();
            return { data: result.data, error: result.error };
          },
          readMarker: async (
            table: string,
            userId: string,
            key: string,
          ) => {
            const result = await supabase
              .from(table)
              .select("id,agent_payload_fingerprint")
              .eq("user_id", userId)
              .eq("agent_operation_key", key)
              .maybeSingle();
            return { data: result.data, error: result.error };
          },
        } satisfies IdempotentCreatePort;
      })();
  } catch {
    return null;
  }

  const readProvenReplay = async (): Promise<IdempotentCreateResult | null> => {
    if (!operationKey || !payloadFingerprint) return null;
    try {
      const existing = await port.readMarker(
        input.table,
        input.userId,
        operationKey,
      );
      if (
        existing.error ||
        !existing.data?.id ||
        existing.data.agent_payload_fingerprint !== payloadFingerprint
      ) {
        return null;
      }
      return { id: String(existing.data.id), replayed: true };
    } catch {
      return null;
    }
  };

  try {
    const inserted = await port.insert(input.table, row);
    if (!inserted.error && inserted.data?.id) {
      return { id: String(inserted.data.id), replayed: false };
    }
    return readProvenReplay();
  } catch {
    // Network/response loss is the reason this primitive exists. A read after
    // an uncertain insert is the only evidence that permits success.
    return readProvenReplay();
  }
}
