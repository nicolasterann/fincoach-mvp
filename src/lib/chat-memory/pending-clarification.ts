import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type ChatChannel = "telegram" | "web";

export type PendingClarificationKind =
  | "fixed_expense_amount_mismatch"
  | "fixed_expense_match_confirmation"
  | "goal_name_mismatch"
  | "payment_source_mismatch"
  | "vague_payment";

export type PendingClarificationStatus =
  | "open"
  | "resolved"
  | "expired"
  | "cancelled";

export interface FixedExpenseAmountMismatchPayload {
  fixedExpenseId: string;
  fixedExpenseName: string;
  fixedExpenseAmount: number;
  enteredAmount: number;
  currency: string;
  sourceAccountId?: string;
  sourceAccountName?: string;
  rawInput: string;
  category?: string;
}

export type PendingClarificationPayload =
  | ({ kind: "fixed_expense_amount_mismatch" } & FixedExpenseAmountMismatchPayload)
  | { kind: "fixed_expense_match_confirmation"; [key: string]: unknown }
  | { kind: "goal_name_mismatch"; [key: string]: unknown }
  | { kind: "payment_source_mismatch"; [key: string]: unknown }
  | { kind: "vague_payment"; [key: string]: unknown };

export interface PendingClarification {
  id: string;
  userId: string;
  channel: ChatChannel;
  chatId: string | null;
  kind: PendingClarificationKind;
  payload: PendingClarificationPayload;
  prompt: string;
  status: PendingClarificationStatus;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
}

const DEFAULT_TTL_MINUTES = 12;

interface PendingClarificationRow {
  id: string;
  user_id: string;
  channel: ChatChannel;
  chat_id: string | null;
  kind: PendingClarificationKind;
  payload: PendingClarificationPayload;
  prompt: string;
  status: PendingClarificationStatus;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
}

function mapRow(row: PendingClarificationRow): PendingClarification {
  return {
    id: row.id,
    userId: row.user_id,
    channel: row.channel,
    chatId: row.chat_id,
    kind: row.kind,
    payload: row.payload,
    prompt: row.prompt,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

export interface OpenPendingClarificationInput {
  userId: string;
  channel: ChatChannel;
  chatId?: string | null;
  kind: PendingClarificationKind;
  payload: PendingClarificationPayload;
  prompt: string;
  ttlMinutes?: number;
}

export async function openPendingClarification(
  input: OpenPendingClarificationInput,
): Promise<PendingClarification | null> {
  const supabase = createSupabaseAdminClient();
  const channel = input.channel;
  const chatId = input.chatId ?? null;

  await cancelOpenClarificationsForChat(input.userId, channel, chatId);

  const ttlMinutes = input.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  const { data, error } = await supabase
    .from("pending_chat_clarifications")
    .insert({
      user_id: input.userId,
      channel,
      chat_id: chatId,
      kind: input.kind,
      payload: input.payload,
      prompt: input.prompt,
      status: "open",
      expires_at: expiresAt,
    })
    .select(
      "id, user_id, channel, chat_id, kind, payload, prompt, status, created_at, expires_at, resolved_at",
    )
    .single();

  if (error || !data) {
    // Surface persistence failures in server logs so we can spot
    // misconfigured grants / missing migrations without exposing DB
    // details to the user. Insert errors must not block the chat
    // reply — the caller still returns the clarification question; the
    // user simply will not benefit from in-context follow-up
    // resolution on this turn.
    console.error(
      "[chat-memory] openPendingClarification insert failed",
      {
        kind: input.kind,
        channel,
        hasChatId: chatId !== null,
        code: error?.code,
        message: error?.message,
      },
    );
    return null;
  }
  return mapRow(data as PendingClarificationRow);
}

export async function getActivePendingClarification(
  userId: string,
  channel: ChatChannel,
  chatId: string | null | undefined,
): Promise<PendingClarification | null> {
  const supabase = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  let query = supabase
    .from("pending_chat_clarifications")
    .select(
      "id, user_id, channel, chat_id, kind, payload, prompt, status, created_at, expires_at, resolved_at",
    )
    .eq("user_id", userId)
    .eq("channel", channel)
    .eq("status", "open")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1);

  if (chatId !== undefined && chatId !== null) {
    query = query.eq("chat_id", chatId);
  } else {
    query = query.is("chat_id", null);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return mapRow(data as PendingClarificationRow);
}

async function updateStatus(
  pendingId: string,
  status: Exclude<PendingClarificationStatus, "open">,
) {
  const supabase = createSupabaseAdminClient();
  await supabase
    .from("pending_chat_clarifications")
    .update({
      status,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", pendingId);
}

export async function resolvePendingClarification(pendingId: string) {
  await updateStatus(pendingId, "resolved");
}

export async function cancelPendingClarification(pendingId: string) {
  await updateStatus(pendingId, "cancelled");
}

export async function expirePendingClarification(pendingId: string) {
  await updateStatus(pendingId, "expired");
}

async function cancelOpenClarificationsForChat(
  userId: string,
  channel: ChatChannel,
  chatId: string | null,
) {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("pending_chat_clarifications")
    .update({
      status: "cancelled",
      resolved_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("channel", channel)
    .eq("status", "open");

  if (chatId === null) {
    query = query.is("chat_id", null);
  } else {
    query = query.eq("chat_id", chatId);
  }

  await query;
}
