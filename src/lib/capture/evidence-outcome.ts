import type { ChatTransactionResult } from "@/lib/ai/chat-transaction-result";

export type TerminalEvidenceStatus =
  | "processed"
  | "needs_clarification"
  | "failed";

export interface EvidenceToolOutcome {
  wrote: boolean;
  hadError: boolean;
  needsInfo: boolean;
}

/**
 * Maps the real agent/tool outcome to the durable evidence lifecycle.
 *
 * `needsInfo` wins over a partial write or a tool error: the capture is still
 * resumable and must remain open. A hard error without a pending question is a
 * retryable failure. Only a completed write/read-only handling is terminal.
 */
export function evidenceStatusFromAgent(input: {
  ok: boolean;
  outcome: EvidenceToolOutcome;
}): TerminalEvidenceStatus {
  if (!input.ok) return "failed";
  if (input.outcome.needsInfo) return "needs_clarification";
  if (input.outcome.hadError) return "failed";
  return "processed";
}

export function evidenceStatusFromChatResult(
  result: Pick<ChatTransactionResult, "redirectCode" | "assistantMetadata">,
): TerminalEvidenceStatus {
  const metadata = result.assistantMetadata as
    | {
        agentRunOk?: unknown;
        agentOutcome?: Partial<EvidenceToolOutcome>;
        evidenceStatus?: unknown;
      }
    | undefined;

  if (
    metadata?.evidenceStatus === "processed" ||
    metadata?.evidenceStatus === "needs_clarification" ||
    metadata?.evidenceStatus === "failed"
  ) {
    return metadata.evidenceStatus;
  }

  if (
    typeof metadata?.agentRunOk === "boolean" &&
    typeof metadata.agentOutcome?.wrote === "boolean" &&
    typeof metadata.agentOutcome?.hadError === "boolean" &&
    typeof metadata.agentOutcome?.needsInfo === "boolean"
  ) {
    return evidenceStatusFromAgent({
      ok: metadata.agentRunOk,
      outcome: {
        wrote: metadata.agentOutcome.wrote,
        hadError: metadata.agentOutcome.hadError,
        needsInfo: metadata.agentOutcome.needsInfo,
      },
    });
  }

  switch (result.redirectCode) {
    case "chat-parser-needs-clarification":
    case "chat-parser-unsupported":
      return "needs_clarification";
    case "chat-parser-failed":
      return "failed";
    default:
      return "processed";
  }
}
