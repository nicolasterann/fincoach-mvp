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

// Best-effort: never throw if the chat-memory write fails. The chat
// product must keep working even if this table is unavailable.
export async function appendChatMessage(
  input: AppendChatMessageInput,
): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.from("chat_messages").insert({
      user_id: input.userId,
      channel: input.channel,
      chat_id: input.chatId ?? null,
      role: input.role,
      content: safeContent(input.content),
      message_type: input.messageType ?? "chat",
      metadata: input.metadata ?? {},
    });
  } catch {
    // Swallow — chat memory is non-critical context.
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

// Returns the last N messages for a user/channel/chat in chronological
// order (oldest first), restricted to a recent time window so old
// advisory chatter never leaks into a new conversation.
export async function getRecentChatMessages(
  input: GetRecentChatMessagesInput,
): Promise<ChatMessage[]> {
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
    if (error || !data) return [];

    return (data as ChatMessageRow[]).map(mapRow).reverse();
  } catch {
    return [];
  }
}

// Full recent conversation for the dedicated chat page (no tight time window):
// the last N messages for a user/channel, oldest first. Used to render the chat
// view; the agent's working memory still uses getRecentChatMessages.
export async function getChatHistory(input: {
  userId: string;
  channel: ChatChannel;
  chatId?: string | null;
  limit?: number;
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
