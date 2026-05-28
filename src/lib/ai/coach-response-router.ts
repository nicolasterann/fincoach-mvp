import type {
  CoachRecentMessage,
  CoachResponseInput,
  CoachResponseResult,
} from "@/lib/ai/coach-response-contract";
import { buildFallbackCoachResponse } from "@/lib/ai/fallback-coach-response";
import { validateHumanizedCoachMessage } from "@/lib/ai/coach-response-validation";
import { generateCoachResponseWithOpenAI } from "@/lib/ai/openai-coach-response";
import { getRecentChatMessages } from "@/lib/chat-memory/chat-messages";

// Recent chat turns are pulled for conversational continuity ONLY. They
// are passed to the humanizer as style/context, never as financial truth.
// Keep the window small so old advisory chatter never colors a new turn.
const RECENT_MESSAGE_LIMIT = 8;

async function loadRecentMessages(
  context: CoachResponseInput["context"],
): Promise<CoachRecentMessage[]> {
  if (context.recentMessages && context.recentMessages.length > 0) {
    return context.recentMessages;
  }
  if (!context.channel) {
    return [];
  }
  try {
    const messages = await getRecentChatMessages({
      userId: context.userId,
      channel: context.channel,
      chatId: context.chatId ?? null,
      limit: RECENT_MESSAGE_LIMIT,
    });
    return messages.map((m) => ({ role: m.role, content: m.content }));
  } catch {
    return [];
  }
}

export async function generateCoachResponse(
  input: CoachResponseInput,
): Promise<CoachResponseResult> {
  const mode = process.env.COACH_RESPONSE_MODE ?? "fallback";
  const fallbackResult = buildFallbackCoachResponse(input);

  if (mode !== "ai") {
    return fallbackResult;
  }

  const recentMessages = await loadRecentMessages(input.context);
  const aiInput: CoachResponseInput = {
    ...input,
    context: { ...input.context, recentMessages },
  };

  const aiResult = await generateCoachResponseWithOpenAI(aiInput);

  if (
    aiResult.source === "ai" &&
    aiResult.message &&
    aiResult.confidenceScore >= 0.75
  ) {
    const validation = validateHumanizedCoachMessage({
      message: aiResult.message,
      context: aiInput.context,
    });
    if (validation.ok) {
      return aiResult;
    }
  }

  return fallbackResult;
}
