import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";

export type AgentActionChallengeReason =
  | "destructive"
  | "sensitive_create"
  | "unstated_amount";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([key, item]) =>
            !["confirm", "confirmedNew", "confirmDefaultSource"].includes(key) &&
            item !== undefined,
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
  }
  if (typeof value === "string") return value.trim();
  return value;
}

export function agentActionPayloadHash(
  toolName: string,
  args: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ toolName, args: canonical(args) }))
    .digest("hex");
}

export interface AgentActionChallengeScope {
  userId: string;
  channel: ChatChannel;
  chatId?: string | null;
  toolName: string;
  args: Record<string, unknown>;
  operationId: string;
}

export interface AgentActionChallengeDeps {
  issue(input: {
    userId: string;
    channel: ChatChannel;
    chatId?: string | null;
    toolName: string;
    payloadHash: string;
    operationId: string;
    reason: AgentActionChallengeReason;
    prompt: string;
    payload: Record<string, unknown>;
  }): Promise<boolean>;
  claim(input: {
    userId: string;
    channel: ChatChannel;
    chatId?: string | null;
    toolName: string;
    payloadHash: string;
    operationId: string;
  }): Promise<Record<string, unknown> | null>;
  /** Read-only lookup used before the model runs. A bare "sí, hazlo" must not
   * depend on the LLM choosing the same tool again. The DB still performs the
   * actual claim inside `claim`, immediately before execution. */
  peekPending?(input: {
    userId: string;
    channel: ChatChannel;
    chatId?: string | null;
    operationId: string;
  }): Promise<{
    toolName: string;
    payload: Record<string, unknown>;
  } | null>;
}

export const liveAgentActionChallengeDeps: AgentActionChallengeDeps = {
  async issue(input) {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.rpc(
        "kipu_issue_agent_action_challenge",
        {
          p: {
            user_id: input.userId,
            channel: input.channel,
            chat_id: input.chatId ?? null,
            tool_name: input.toolName,
            payload_hash: input.payloadHash,
            operation_id: input.operationId,
            reason: input.reason,
            prompt: input.prompt,
            payload: input.payload,
          },
        },
      );
      const outcome = (data as { outcome?: unknown } | null)?.outcome;
      return !error && (outcome === "issued" || outcome === "existing");
    } catch {
      return false;
    }
  },
  async claim(input) {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.rpc(
        "kipu_claim_agent_action_challenge",
        {
          p: {
            user_id: input.userId,
            channel: input.channel,
            chat_id: input.chatId ?? null,
            tool_name: input.toolName,
            payload_hash: input.payloadHash,
            operation_id: input.operationId,
          },
        },
      );
      const row = data as { claimed?: unknown; payload?: unknown } | null;
      if (
        error ||
        row?.claimed !== true ||
        !row.payload ||
        typeof row.payload !== "object" ||
        Array.isArray(row.payload)
      ) {
        return null;
      }
      return row.payload as Record<string, unknown>;
    } catch {
      return null;
    }
  },
  async peekPending(input) {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.rpc(
        "kipu_peek_pending_agent_action_challenge",
        {
          p: {
            user_id: input.userId,
            channel: input.channel,
            chat_id: input.chatId ?? null,
            operation_id: input.operationId,
          },
        },
      );
      const row = data as {
        found?: unknown;
        tool_name?: unknown;
        payload?: unknown;
      } | null;
      if (
        error ||
        row?.found !== true ||
        typeof row.tool_name !== "string" ||
        !row.tool_name.trim() ||
        !row.payload ||
        typeof row.payload !== "object" ||
        Array.isArray(row.payload)
      ) {
        return null;
      }
      return {
        toolName: row.tool_name,
        payload: row.payload as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  },
};
