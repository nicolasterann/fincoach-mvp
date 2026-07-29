import { insertIdempotentUserRow } from "@/lib/financial/idempotent-user-create";

// Persistent bug/feedback reports captured by the `report_bug` chat tool
// (migration 034: public.user_feedback, RLS deny-by-default + service_role only,
// like every other Kipu write store — channel handlers run without a user
// session). This is the single typed write path for user-reported problems; the
// LLM never inserts here directly.

export type FeedbackKind = "bug" | "idea" | "confusion" | "other";

const VALID_KINDS = new Set<FeedbackKind>(["bug", "idea", "confusion", "other"]);

export interface SaveFeedbackInput {
  userId: string;
  message: string;
  kind?: FeedbackKind;
  context?: string | null;
  channel?: string | null;
  operationKey?: string | null;
}

// Store one feedback/bug report. Returns true on success. Defensive: if the
// table is somehow absent (pre-034), it degrades to false instead of throwing,
// so a report never breaks the turn — the tool then tells the user honestly.
export async function saveUserFeedback(
  input: SaveFeedbackInput,
): Promise<{ ok: boolean; replayed?: boolean }> {
  const message = input.message.trim();
  if (!message) return { ok: false };
  const kind: FeedbackKind = input.kind && VALID_KINDS.has(input.kind) ? input.kind : "bug";
  const created = await insertIdempotentUserRow({
    table: "user_feedback",
    userId: input.userId,
    row: {
      user_id: input.userId,
      kind,
      message: message.slice(0, 2000),
      context: input.context ? input.context.slice(0, 1000) : null,
      channel: input.channel ?? null,
    },
    identity: input.operationKey
      ? { operationKey: input.operationKey }
      : null,
  });
  return created
    ? { ok: true, replayed: created.replayed }
    : { ok: false };
}
