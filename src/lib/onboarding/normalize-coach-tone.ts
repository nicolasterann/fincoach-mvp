import type { CoachTone } from "@/types/financial";
import type { OnboardingDraft } from "./draft-types";

const VALID_COACH_TONES: readonly CoachTone[] = [
  "clear",
  "coach_like",
  "playful",
];

const COACH_LIKE_PATTERN =
  /\b(directo|directa|al grano|sin vueltas|estricto|firme|coach_like|coach like|coach-like)\b/i;

const CLEAR_PATTERN =
  /\b(relajado|claro|calmado|tranquilo|suave|clear)\b/i;

const PLAYFUL_PATTERN =
  /\b(juguet[oó]n|jugueton|divertido|cercano|con humor|playful|informal)\b/i;

const EXACT_ALIASES: Record<string, CoachTone> = {
  clear: "clear",
  coach_like: "coach_like",
  playful: "playful",
  direct: "coach_like",
  directo: "coach_like",
  directa: "coach_like",
  relaxed: "clear",
  relajado: "clear",
  calm: "clear",
  calmado: "clear",
  strict: "coach_like",
  estricto: "coach_like",
  firm: "coach_like",
  firme: "coach_like",
  funny: "playful",
  divertido: "playful",
};

export function isValidCoachTone(value: string): value is CoachTone {
  return VALID_COACH_TONES.includes(value as CoachTone);
}

/**
 * Map a raw tone string (enum, alias, or short label) to a valid CoachTone.
 * Returns undefined when the value is missing or cannot be mapped.
 */
export function normalizeCoachTone(
  value: string | undefined | null,
): CoachTone | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();

  if (isValidCoachTone(lower)) {
    return lower;
  }

  const alias = EXACT_ALIASES[lower];
  if (alias) {
    return alias;
  }

  return normalizeCoachToneFromText(trimmed);
}

/**
 * Infer coach tone from free-form user text (e.g. "Mejor directo").
 */
export function normalizeCoachToneFromText(text: string): CoachTone | undefined {
  const lower = text.trim().toLowerCase();
  if (!lower) {
    return undefined;
  }

  if (COACH_LIKE_PATTERN.test(lower)) {
    return "coach_like";
  }

  if (PLAYFUL_PATTERN.test(lower)) {
    return "playful";
  }

  if (CLEAR_PATTERN.test(lower)) {
    return "clear";
  }

  return undefined;
}

/**
 * Resolve the tone to persist. Coach preferences take precedence over profile hints.
 */
export function resolveOnboardingCoachTone(
  draft: Pick<OnboardingDraft, "coachPreferences" | "profile">,
): CoachTone {
  return (
    normalizeCoachTone(draft.coachPreferences.tone) ??
    normalizeCoachTone(draft.profile.tonePreference) ??
    "clear"
  );
}

/**
 * On the coach_preferences step, user message wins over a stale or invalid patch.
 */
export function applyCoachToneFromUserMessage(
  draft: OnboardingDraft,
  message: string,
): void {
  const fromMessage = normalizeCoachToneFromText(message);
  const fromDraft = normalizeCoachTone(draft.coachPreferences.tone);

  draft.coachPreferences.tone = fromMessage ?? fromDraft ?? "clear";
}
