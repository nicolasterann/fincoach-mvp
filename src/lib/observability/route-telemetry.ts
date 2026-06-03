// Structured, non-sensitive route/outcome telemetry for the chat pipeline.
//
// Goal: make production debugging possible without screenshots. We log ONE
// structured line per handled message describing what route was taken, whether
// a DB write happened, and useful non-secret diagnostics. This must NEVER block
// the user response and must NEVER log secrets or full message bodies.
//
// Transport is intentionally simple (console as structured JSON). If a
// dedicated telemetry sink is added later, only `emit` changes.

export type ChatOutcomeKind =
  | "transaction_logged"
  | "internal_transfer"
  | "person_transfer"
  | "undo"
  | "duplicate_recovery"
  | "correction"
  | "fixed_expense_clarification"
  | "pending_resolution"
  | "advisory"
  | "general_coach"
  | "coach_followup"
  | "clarification"
  | "unsupported"
  | "failed"
  | "chat";

export interface ChatRouteTelemetry {
  route: string;
  channel?: string;
  outcome: ChatOutcomeKind;
  dbWrite: boolean;
  // Optional, all non-sensitive.
  transactionType?: string;
  parserSource?: string;
  coachSource?: string;
  aiConfidence?: number;
  validationReason?: string;
  fallbackReason?: string;
  missingFields?: string[];
  reversedTransactionId?: string;
  error?: string;
  // A short, truncated preview only — never the full message body.
  messagePreview?: string;
}

const MAX_PREVIEW_CHARS = 40;

// A safe, length-capped preview. Never log the full message; only the leading
// characters, enough to correlate a log line with a user report.
export function previewMessage(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (trimmed.length <= MAX_PREVIEW_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_PREVIEW_CHARS)}…`;
}

// Fire-and-forget. Wrapped so a logging failure can never affect the reply.
export function logChatRoute(event: ChatRouteTelemetry): void {
  try {
    // Single structured line; downstream log drains can parse the JSON.
    console.info(
      "[kipu.route]",
      JSON.stringify({ ts: new Date().toISOString(), ...event }),
    );
  } catch {
    // Telemetry must never throw into the user path.
  }
}
