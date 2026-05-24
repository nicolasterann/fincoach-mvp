import OpenAI from "openai";
import { onboardingConversationSystemPrompt } from "@/lib/ai/onboarding/onboarding-conversation-prompt";
import type {
  OnboardingDraftPatch,
  OnboardingTurnInput,
  OnboardingTurnIntentKind,
  OnboardingTurnOutput,
} from "@/lib/ai/onboarding/onboarding-conversation-contract";
import type { OnboardingStep } from "@/lib/onboarding";

const VALID_INTENT_KINDS = new Set<OnboardingTurnIntentKind>([
  "clarifying_question",
  "probing_question",
  "acknowledgement",
  "summary",
  "transition",
  "support",
]);

const ONBOARDING_STEPS = new Set<OnboardingStep>([
  "welcome",
  "profile",
  "accounts",
  "debt_accounts",
  "income_sources",
  "fixed_expenses",
  "goals",
  "coach_preferences",
  "review",
  "completed",
]);

function createDisconnectedFallback(): OnboardingTurnOutput {
  return {
    assistantMessage:
      "Todavía no tengo la IA de onboarding conectada. Podemos seguir con el modo básico por ahora.",
    patch: {},
    intentKind: "support",
    confidenceScore: 0,
  };
}

function createErrorFallback(): OnboardingTurnOutput {
  return {
    assistantMessage:
      "No pude conectar con la IA de onboarding. Sigamos con el modo básico mientras lo revisamos.",
    patch: {},
    intentKind: "support",
    confidenceScore: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeIntentKind(value: unknown): OnboardingTurnIntentKind {
  if (typeof value === "string" && VALID_INTENT_KINDS.has(value as OnboardingTurnIntentKind)) {
    return value as OnboardingTurnIntentKind;
  }
  return "support";
}

function normalizePatch(value: unknown): OnboardingDraftPatch {
  return isRecord(value) ? (value as OnboardingDraftPatch) : {};
}

function normalizeOnboardingTurnOutput(parsed: unknown): OnboardingTurnOutput {
  const obj = isRecord(parsed) ? parsed : {};

  const assistantMessage =
    typeof obj.assistantMessage === "string" && obj.assistantMessage.trim()
      ? obj.assistantMessage.trim()
      : "¿Me cuentas un poco más?";

  const output: OnboardingTurnOutput = {
    assistantMessage,
    patch: normalizePatch(obj.patch),
    intentKind: normalizeIntentKind(obj.intentKind),
  };

  if (typeof obj.confidenceScore === "number") {
    output.confidenceScore = obj.confidenceScore;
  }

  if (
    typeof obj.advanceToStep === "string" &&
    ONBOARDING_STEPS.has(obj.advanceToStep as OnboardingStep)
  ) {
    output.advanceToStep = obj.advanceToStep as OnboardingStep;
  }

  if (Array.isArray(obj.resolvedMissingFields)) {
    output.resolvedMissingFields = obj.resolvedMissingFields.filter(
      (field): field is string => typeof field === "string",
    );
  }

  if (Array.isArray(obj.newMissingFields)) {
    output.newMissingFields = obj.newMissingFields.filter(
      (field): field is string => typeof field === "string",
    );
  }

  return output;
}

export async function processOnboardingTurnWithOpenAI(
  input: OnboardingTurnInput,
): Promise<OnboardingTurnOutput> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return createDisconnectedFallback();
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_ONBOARDING_MODEL ?? "gpt-5.4";

  let rawContent: string | null | undefined;

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: onboardingConversationSystemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify({
            currentStep: input.state.currentStep,
            state: input.state,
            latestUserMessage: input.latestUserMessage,
            localeHint: input.localeHint ?? null,
          }),
        },
      ],
    });

    rawContent = completion.choices[0]?.message.content;
  } catch {
    return createErrorFallback();
  }

  if (!rawContent) {
    return createErrorFallback();
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return createErrorFallback();
  }

  const normalized = normalizeOnboardingTurnOutput(parsed);

  return {
    ...normalized,
    rawModelOutput: parsed,
  };
}
