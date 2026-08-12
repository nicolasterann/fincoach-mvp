import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatMessageType =
  | "chat"
  | "transaction"
  | "clarification"
  | "advisory"
  | "system";

export interface AppendChatMessageInput {
  userId: string;
  channel: ChatChannel;
  chatId?: string | null;
  role: ChatMessageRole;
  content: string;
  messageType?: ChatMessageType;
  metadata?: Record<string, unknown>;
  /** Stable identity for one delivered turn/role (migration 088). */
  operationKey?: string | null;
}

export interface ChatMessage {
  id: string;
  userId: string;
  channel: ChatChannel;
  chatId: string | null;
  role: ChatMessageRole;
  content: string;
  messageType: ChatMessageType;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type AppendChatMessageResult =
  | { ok: true; id: string; replayed: boolean }
  | { ok: false };

interface ChatMessageRow {
  id: string;
  user_id: string;
  channel: ChatChannel;
  chat_id: string | null;
  role: ChatMessageRole;
  content: string;
  message_type: ChatMessageType;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function mapRow(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    userId: row.user_id,
    channel: row.channel,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    messageType: row.message_type,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

const MAX_CONTENT_CHARS = 2000;

function safeContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_CONTENT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_CONTENT_CHARS)}…`;
}

/** The two DB effects this writer needs, as a seam. The identity contract —
 * "the same delivery key with different content is NOT a replay" — is the whole
 * point of this function, and with the Supabase client hard-wired inside it was
 * the one durable-identity rule no test could reach: deleting the content
 * comparison left the gate green. */
export interface AppendChatMessageDeps {
  insert(row: {
    user_id: string;
    channel: ChatChannel;
    chat_id: string | null;
    role: ChatMessageRole;
    content: string;
    message_type: ChatMessageType;
    metadata: Record<string, unknown>;
    operation_key: string | null;
  }): Promise<{ id: string | null; errorCode: string | null }>;
  readByOperationKey(key: {
    userId: string;
    channel: ChatChannel;
    role: ChatMessageRole;
    operationKey: string;
  }): Promise<{
    ok: boolean;
    row: {
      id: string;
      chatId: string | null;
      content: string;
      messageType: string;
    } | null;
  }>;
}

export async function appendChatMessageWithStatusUsing(
  input: AppendChatMessageInput,
  deps: AppendChatMessageDeps,
): Promise<AppendChatMessageResult> {
  try {
    const operationKey = input.operationKey?.trim().slice(0, 240) || null;
    const content = safeContent(input.content);
    const messageType = input.messageType ?? "chat";
    const inserted = await deps.insert({
      user_id: input.userId,
      channel: input.channel,
      chat_id: input.chatId ?? null,
      role: input.role,
      content,
      message_type: messageType,
      metadata: input.metadata ?? {},
      operation_key: operationKey,
    });
    if (!inserted.errorCode && inserted.id) {
      return { ok: true, id: String(inserted.id), replayed: false };
    }
    // The other delivery won the unique key. Read the proved replay back rather
    // than treating it as a failed memory write.
    if (inserted.errorCode === "23505" && operationKey) {
      const existing = await deps.readByOperationKey({
        userId: input.userId,
        channel: input.channel,
        role: input.role,
        operationKey,
      });
      if (
        existing.ok &&
        existing.row?.id &&
        (existing.row.chatId ?? null) === (input.chatId ?? null) &&
        existing.row.content === content &&
        existing.row.messageType === messageType
      ) {
        return { ok: true, id: String(existing.row.id), replayed: true };
      }
      // Reusing a trusted delivery id for different content is not a replay.
      // A failed re-read is not one either: we cannot prove what is stored.
      return { ok: false };
    }
    return { ok: false };
  } catch {
    // Most callers treat chat memory as best-effort and may ignore the id.
    // Money/calendar callers can require durable provenance before notifying.
    return { ok: false };
  }
}

export const liveAppendChatMessageDeps: AppendChatMessageDeps = {
  async insert(row) {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("chat_messages")
      .insert(row)
      .select("id")
      .maybeSingle();
    return {
      id: data?.id ? String(data.id) : null,
      errorCode: error ? (error.code ?? "unknown") : null,
    };
  },
  async readByOperationKey(key) {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, chat_id, content, message_type")
      .eq("user_id", key.userId)
      .eq("channel", key.channel)
      .eq("role", key.role)
      .eq("operation_key", key.operationKey)
      .maybeSingle();
    if (error) return { ok: false, row: null };
    return {
      ok: true,
      row: data
        ? {
            id: String(data.id),
            chatId: (data.chat_id as string | null) ?? null,
            content: String(data.content),
            messageType: String(data.message_type),
          }
        : null,
    };
  },
};

// Best-effort: never throw if the chat-memory write fails. The chat
// product must keep working even if this table is unavailable.
export async function appendChatMessageWithStatus(
  input: AppendChatMessageInput,
): Promise<AppendChatMessageResult> {
  return appendChatMessageWithStatusUsing(input, liveAppendChatMessageDeps);
}

export async function appendChatMessage(
  input: AppendChatMessageInput,
): Promise<string | null> {
  const result = await appendChatMessageWithStatus(input);
  return result.ok ? result.id : null;
}

export type ChatMessageByOperationRead =
  | { ok: true; found: false }
  | { ok: true; found: true; message: ChatMessage }
  | { ok: false };

export async function readChatMessageByOperationKey(input: {
  userId: string;
  channel: ChatChannel;
  role: ChatMessageRole;
  operationKey: string;
}): Promise<ChatMessageByOperationRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("chat_messages")
      .select(
        "id, user_id, channel, chat_id, role, content, message_type, metadata, created_at",
      )
      .eq("user_id", input.userId)
      .eq("channel", input.channel)
      .eq("role", input.role)
      .eq("operation_key", input.operationKey.trim().slice(0, 240))
      .maybeSingle();
    if (error) return { ok: false };
    if (!data) return { ok: true, found: false };
    return {
      ok: true,
      found: true,
      message: mapRow(data as ChatMessageRow),
    };
  } catch {
    return { ok: false };
  }
}

export async function removeChatMessage(userId: string, id: string): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("chat_messages")
      .delete()
      .eq("user_id", userId)
      .eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

const RECENT_CHAT_WINDOW_MINUTES = 60;

export interface GetRecentChatMessagesInput {
  userId: string;
  channel: ChatChannel;
  chatId?: string | null;
  limit?: number;
  windowMinutes?: number;
}

export type RecentChatMessagesRead =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false };

// Agent/evidence callers must distinguish a genuinely empty conversation from
// a failed read. The display wrapper below may still collapse the distinction.
export async function readRecentChatMessages(
  input: GetRecentChatMessagesInput,
): Promise<RecentChatMessagesRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const limit = input.limit ?? 10;
    const windowMinutes = input.windowMinutes ?? RECENT_CHAT_WINDOW_MINUTES;
    const sinceIso = new Date(
      Date.now() - windowMinutes * 60_000,
    ).toISOString();

    let query = supabase
      .from("chat_messages")
      .select(
        "id, user_id, channel, chat_id, role, content, message_type, metadata, created_at",
      )
      .eq("user_id", input.userId)
      .eq("channel", input.channel)
      .gt("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (input.chatId !== undefined && input.chatId !== null) {
      query = query.eq("chat_id", input.chatId);
    } else if (input.chatId === null) {
      query = query.is("chat_id", null);
    }

    const { data, error } = await query;
    if (error || !data) return { ok: false };
    return {
      ok: true,
      messages: (data as ChatMessageRow[]).map(mapRow).reverse(),
    };
  } catch {
    return { ok: false };
  }
}

export type ConversationArchiveRead =
  | { ok: true; complete: true; messages: ChatMessage[]; asOf: string }
  | { ok: true; complete: false; messages: ChatMessage[]; asOf: string }
  | { ok: false; complete: false; messages: []; asOf: string };

const CONVERSATION_ARCHIVE_CAP = 500;

/** Cross-channel durable memory for the planner. This is intentionally
 * separate from the 60-minute conversational buffer: a statement amount from
 * two weeks ago or an unfinished Telegram operation does not stop being true
 * because the current delivery came from web. CAP+1 makes truncation explicit;
 * the planner may use positive evidence from a partial archive but may never
 * infer that an older fact is absent. */
export async function readConversationArchive(
  userId: string,
): Promise<ConversationArchiveRead> {
  const asOf = new Date().toISOString();
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("chat_messages")
      .select(
        "id, user_id, channel, chat_id, role, content, message_type, metadata, created_at",
      )
      .eq("user_id", userId)
      .neq("role", "system")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(CONVERSATION_ARCHIVE_CAP + 1);
    if (error || !Array.isArray(data)) {
      return { ok: false, complete: false, messages: [], asOf };
    }
    const complete = data.length <= CONVERSATION_ARCHIVE_CAP;
    return {
      ok: true,
      complete,
      messages: (data as ChatMessageRow[])
        .slice(0, CONVERSATION_ARCHIVE_CAP)
        .map(mapRow)
        .reverse(),
      asOf,
    };
  } catch {
    return { ok: false, complete: false, messages: [], asOf };
  }
}

export type ConversationSearchRead =
  | { ok: true; complete: boolean; messages: ChatMessage[]; asOf: string }
  | { ok: false; complete: false; messages: []; asOf: string };

const CONVERSATION_SEARCH_CAP = 80;

/** Targeted cross-channel memory lookup for archives larger than the planning
 * prompt. The model chooses the concepts only after understanding the request;
 * this is a read capability, not a lexical router. `complete=false` is part of
 * the result contract so a capped search can prove presence but never absence. */
export async function searchConversationArchive(input: {
  userId: string;
  query?: string | null;
  before?: string | null;
  after?: string | null;
  limit?: number;
}): Promise<ConversationSearchRead> {
  const asOf = new Date().toISOString();
  const query = String(input.query ?? "").trim().slice(0, 500);
  const before = input.before?.trim() || null;
  const after = input.after?.trim() || null;
  // Text search is useful for entities/concepts, but it cannot answer a request
  // such as "¿qué te dije el 16 de julio?" when the user no longer remembers
  // the words. A bounded date interval is therefore an equally valid read mode.
  // Requiring one of the two keeps this from becoming an unbounded history dump.
  if (!query && !before && !after) {
    return { ok: false, complete: false, messages: [], asOf };
  }
  const requested = Math.min(
    Math.max(Math.trunc(input.limit ?? 30), 1),
    CONVERSATION_SEARCH_CAP,
  );
  try {
    const supabase = createSupabaseAdminClient();
    let request = supabase
      .from("chat_messages")
      .select(
        "id, user_id, channel, chat_id, role, content, message_type, metadata, created_at",
      )
      .eq("user_id", input.userId)
      .neq("role", "system")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(requested + 1);
    if (query) {
      request = request.textSearch("content", query, {
        config: "spanish",
        type: "websearch",
      });
    }
    if (before) request = request.lt("created_at", before);
    if (after) request = request.gt("created_at", after);
    const { data, error } = await request;
    if (error || !Array.isArray(data)) {
      return { ok: false, complete: false, messages: [], asOf };
    }
    const complete = data.length <= requested;
    return {
      ok: true,
      complete,
      messages: (data as ChatMessageRow[]).slice(0, requested).map(mapRow),
      asOf,
    };
  } catch {
    return { ok: false, complete: false, messages: [], asOf };
  }
}

// Returns the last N messages for a user/channel/chat in chronological
// order (oldest first), restricted to a recent time window so old
// advisory chatter never leaks into a new conversation.
export async function getRecentChatMessages(
  input: GetRecentChatMessagesInput,
): Promise<ChatMessage[]> {
  const read = await readRecentChatMessages(input);
  return read.ok ? read.messages : [];
}

// Full recent conversation for the dedicated chat page (no tight time window):
// the last N messages for a user/channel, oldest first. Used to render the chat
// view; the agent's working memory still uses getRecentChatMessages.
export async function getChatHistory(input: {
  userId: string;
  channel: ChatChannel;
  chatId?: string | null;
  limit?: number;
  // Hide everything before this timestamp (the user's "new conversation"
  // point). View-level only — nothing is deleted.
  since?: string | null;
}): Promise<ChatMessage[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const limit = input.limit ?? 60;
    let query = supabase
      .from("chat_messages")
      .select(
        "id, user_id, channel, chat_id, role, content, message_type, metadata, created_at",
      )
      .eq("user_id", input.userId)
      .eq("channel", input.channel)
      .neq("role", "system")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (input.since) {
      query = query.gt("created_at", input.since);
    }

    if (input.chatId !== undefined && input.chatId !== null) {
      query = query.eq("chat_id", input.chatId);
    }

    const { data, error } = await query;
    if (error || !data) return [];
    return (data as ChatMessageRow[]).map(mapRow).reverse();
  } catch {
    return [];
  }
}
