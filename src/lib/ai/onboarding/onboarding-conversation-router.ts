import type {
  OnboardingTurnInput,
  OnboardingTurnOutput,
} from "@/lib/ai/onboarding/onboarding-conversation-contract";
import { processOnboardingTurnWithOpenAI } from "@/lib/ai/onboarding/openai-onboarding-conversation";

function createMockEngineFallback(): OnboardingTurnOutput {
  return {
    assistantMessage:
      "El onboarding conversacional sigue en modo mock local. La interfaz todavía no usa el motor de IA.",
    patch: {},
    intentKind: "support",
    confidenceScore: 0,
  };
}

function createAiWithMockFallbackMessage(): OnboardingTurnOutput {
  return {
    assistantMessage:
      "No pude usar la IA de onboarding en este turno. Sigue el flujo mock local mientras lo conectamos.",
    patch: {},
    intentKind: "support",
    confidenceScore: 0,
  };
}

function indicatesOnboardingAiFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("modo básico") ||
    lower.includes("ia de onboarding") ||
    lower.includes("no pude conectar")
  );
}

function isPatchEmpty(patch: OnboardingTurnOutput["patch"]): boolean {
  return !patch || Object.keys(patch).length === 0;
}

function shouldFallbackFromAi(result: OnboardingTurnOutput): boolean {
  if (result.confidenceScore === 0) {
    return true;
  }

  return (
    isPatchEmpty(result.patch) && indicatesOnboardingAiFailure(result.assistantMessage)
  );
}

export async function processOnboardingTurn(
  input: OnboardingTurnInput,
): Promise<OnboardingTurnOutput> {
  // AI-first by default (Stage 11): onboarding is the seed of the user's
  // financial truth, so the conversational AI engine is the primary path even
  // when the env var is missing. The deterministic mock remains ONLY as the
  // resilience fallback (engine failure / no API key), never the product.
  const mode = process.env.ONBOARDING_ENGINE_MODE ?? "ai_with_mock_fallback";

  if (mode === "ai") {
    return processOnboardingTurnWithOpenAI(input);
  }

  if (mode === "ai_with_mock_fallback") {
    const aiResult = await processOnboardingTurnWithOpenAI(input);

    if (shouldFallbackFromAi(aiResult)) {
      return createAiWithMockFallbackMessage();
    }

    return aiResult;
  }

  return createMockEngineFallback();
}
