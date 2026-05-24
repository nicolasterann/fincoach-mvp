"use server";

import type {
  OnboardingTurnInput,
  OnboardingTurnOutput,
} from "@/lib/ai/onboarding/onboarding-conversation-contract";
import { processOnboardingTurn } from "@/lib/ai/onboarding/onboarding-conversation-router";

export async function processOnboardingTurnAction(
  input: OnboardingTurnInput,
): Promise<OnboardingTurnOutput> {
  return processOnboardingTurn(input);
}
