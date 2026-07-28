import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";

export interface CardPaymentCaptureDraft {
  id: string;
  debtAccountId: string;
  originalCurrency: string;
  expectedDue: number | null;
  initialRawMessage: string;
  multiSourceRequired: boolean;
}

export type CardPaymentDraftRead =
  | { ok: true; draft: CardPaymentCaptureDraft | null }
  | { ok: false };

interface CardPaymentDraftRow {
  id: string;
  debt_account_id: string;
  original_currency: string;
  expected_due: number | null;
  initial_raw_message: string;
  multi_source_required: boolean;
}

/** Reads the one still-actionable draft for this exact conversation + card.
 * A read failure is NOT "there is no draft": forgetting a proved second source
 * can turn a safe follow-up into a one-account write. */
export async function readOpenCardPaymentCaptureDraft(input: {
  userId: string;
  channel: ChatChannel;
  chatId?: string | null;
  debtAccountId: string;
}): Promise<CardPaymentDraftRead> {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("card_payment_capture_drafts")
    .select(
      "id, debt_account_id, original_currency, expected_due, initial_raw_message, multi_source_required",
    )
    .eq("user_id", input.userId)
    .eq("channel", input.channel)
    .eq("debt_account_id", input.debtAccountId)
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  query = input.chatId == null
    ? query.is("chat_id", null)
    : query.eq("chat_id", input.chatId);
  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false };
  if (!data) return { ok: true, draft: null };
  const row = data as CardPaymentDraftRow;
  const expected = row.expected_due == null ? null : Number(row.expected_due);
  if (
    typeof row.id !== "string" ||
    typeof row.debt_account_id !== "string" ||
    typeof row.original_currency !== "string" ||
    typeof row.initial_raw_message !== "string" ||
    typeof row.multi_source_required !== "boolean" ||
    (expected != null && !Number.isFinite(expected))
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    draft: {
      id: row.id,
      debtAccountId: row.debt_account_id,
      originalCurrency: row.original_currency,
      expectedDue: expected,
      initialRawMessage: row.initial_raw_message,
      multiSourceRequired: row.multi_source_required,
    },
  };
}

/** Opens/replaces the draft atomically in Postgres. A failure must be surfaced
 * to the user: asking while forgetting the question is the original defect. */
export async function openCardPaymentCaptureDraft(input: {
  userId: string;
  channel: ChatChannel;
  chatId?: string | null;
  debtAccountId: string;
  originalCurrency: string;
  expectedDue: number | null;
  initialRawMessage: string;
  multiSourceRequired: boolean;
}): Promise<{ ok: true; draftId: string } | { ok: false }> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_open_card_payment_capture_draft", {
    p: {
      user_id: input.userId,
      channel: input.channel,
      chat_id: input.chatId ?? null,
      debt_account_id: input.debtAccountId,
      original_currency: input.originalCurrency,
      expected_due: input.expectedDue,
      initial_raw_message: input.initialRawMessage,
      multi_source_required: input.multiSourceRequired,
    },
  });
  const row = data as { outcome?: unknown; draft_id?: unknown } | null;
  if (error || row?.outcome !== "opened" || typeof row.draft_id !== "string") {
    return { ok: false };
  }
  return { ok: true, draftId: row.draft_id };
}

/** An explicit correction such as "en realidad salió solo de Produbanco"
 * retracts the previous multi-source fact. Silence never does. */
export function retractsMultiSource(rawMessage: string): boolean {
  const text = String(rawMessage ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  return (
    /\b(?:en realidad|correccion|me equivoque|no fue).{0,45}\bsolo\b/.test(text) ||
    /\b(?:salio|fue|pague|lo pague)\s+solo\s+(?:de|desde|con)\b/.test(text) ||
    /\bno\s+(?:use|fue de|salio de).{0,35}\b(?:prestamo|dinero prestado|otra cuenta)\b/.test(text)
  );
}
