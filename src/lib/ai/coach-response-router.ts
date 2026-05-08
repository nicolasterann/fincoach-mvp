import type {
  CoachResponseInput,
  CoachResponseResult,
} from "@/lib/ai/coach-response-contract";
import { buildFallbackCoachResponse } from "@/lib/ai/fallback-coach-response";
import { generateCoachResponseWithOpenAI } from "@/lib/ai/openai-coach-response";

export async function generateCoachResponse(
  input: CoachResponseInput,
): Promise<CoachResponseResult> {
  const mode = process.env.COACH_RESPONSE_MODE ?? "fallback";
  const fallbackResult = buildFallbackCoachResponse(input);

  if (mode !== "ai") {
    return fallbackResult;
  }

  const aiResult = await generateCoachResponseWithOpenAI(input);

  if (aiResult.source === "ai" && aiResult.message && aiResult.confidenceScore >= 0.75) {
    return aiResult;
  }

  return fallbackResult;
}
