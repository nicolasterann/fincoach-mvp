import OpenAI from "openai";
import type {
  CoachResponseInput,
  CoachResponseResult,
} from "@/lib/ai/coach-response-contract";
import { coachResponseSystemPrompt } from "@/lib/ai/coach-response-prompt";

export async function generateCoachResponseWithOpenAI({
  context,
  tone,
}: CoachResponseInput): Promise<CoachResponseResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      source: "fallback",
      confidenceScore: 0,
      message: "",
    };
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_COACH_MODEL ?? "gpt-5.4";

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: coachResponseSystemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify({
            tone,
            context,
            expectedJsonShape: {
              message: "string",
              confidenceScore: "number between 0 and 1",
            },
          }),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      return {
        source: "fallback",
        confidenceScore: 0,
        message: "",
        rawModelOutput: completion,
      };
    }

    const parsed = JSON.parse(content) as {
      message?: unknown;
      confidenceScore?: unknown;
    };

    if (typeof parsed.message !== "string" || !parsed.message.trim()) {
      return {
        source: "fallback",
        confidenceScore: 0,
        message: "",
        rawModelOutput: parsed,
      };
    }

    const confidenceScore =
      typeof parsed.confidenceScore === "number"
        ? Math.max(0, Math.min(1, parsed.confidenceScore))
        : 0.8;

    return {
      source: "ai",
      message: parsed.message.trim(),
      confidenceScore,
      rawModelOutput: parsed,
    };
  } catch (error) {
    return {
      source: "fallback",
      confidenceScore: 0,
      message: "",
      rawModelOutput: error instanceof Error ? error.message : "Unknown coach error",
    };
  }
}
