"use server";

import type {
  OnboardingTurnInput,
  OnboardingTurnOutput,
} from "@/lib/ai/onboarding/onboarding-conversation-contract";
import { processOnboardingTurn } from "@/lib/ai/onboarding/onboarding-conversation-router";
import {
  runOnboardingAgentTurn,
  type OnboardingAgentTurnInput,
  type OnboardingAgentTurnResult,
} from "@/lib/ai/onboarding/onboarding-agent";

export async function processOnboardingTurnAction(
  input: OnboardingTurnInput,
): Promise<OnboardingTurnOutput> {
  return processOnboardingTurn(input);
}

// Stage 11.6 — the AI-first primary path: the onboarding AGENT owns the
// conversation and mutates the draft through deterministic tools. Returns
// ok:false (no key / engine failure) so the client can fall back to the
// legacy wizard path.
export async function processOnboardingAgentTurnAction(
  input: OnboardingAgentTurnInput,
): Promise<OnboardingAgentTurnResult> {
  return runOnboardingAgentTurn(input);
}
