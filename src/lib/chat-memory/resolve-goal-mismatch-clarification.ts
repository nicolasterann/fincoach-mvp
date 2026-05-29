export type GoalMismatchClarificationResolution =
  | { kind: "confirm" }
  | { kind: "reject" }
  | { kind: "unclear" };

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Reject / cancel phrases. Checked first so an explicit "no, era otra
// meta" never gets misread as a confirmation. Note: a bare "no" only
// counts when the whole reply is "no" — natural corrections like
// "no, era viaje a brasil" (which actually CONFIRM the main goal) are
// intentionally NOT treated as rejects here; they fall through to the
// AI classifier.
const REJECT_PATTERNS: RegExp[] = [
  /^\s*no\s*[.!]*\s*$/,
  /\bera\s+otra\b/,
  /\botra\s+meta\b/,
  /\bno\s+(?:la|lo)\s+registres?\b/,
  /\bno\s+(?:la|lo)\s+guardes?\b/,
  /\bolvi[dt]a(?:lo|la)?\b/,
  /\bcancel(?:ar|a|alo|ala)\b/,
  /\bd[eé]jal[oa]\b/,
];

// Confident yes phrases.
const CONFIRM_PATTERNS: RegExp[] = [
  /^\s*s[ií]+\s*[.!]*\s*$/, // si, sii, siii
  /^\s*s[ií]\s*,?\s*s[ií]\s*[.!]*\s*$/, // si si, sisi
  /\bs[ií]+\s*,?\s*(?:s[ií]|era|es|esa|esta|va|a|para|claro|correcto|exacto)\b/,
  /\bcorrecto\b/,
  /\bexacto\b/,
  /\bclaro\b/,
  /\bas[ií]\s+es\b/,
  /\beso\s+es\b/,
  /\bes\s+esa\b/,
  /\bes\s+esta\b/,
  /\bla\s+principal\b/,
  /\bmeta\s+principal\b/,
];

// Deterministic classifier for the user's follow-up to a goal-name
// mismatch clarification. Returns:
//   - confirm: the user confirmed the money goes to the main goal.
//   - reject:  the user said no / it was a different goal / cancel.
//   - unclear: ambiguous — the caller may consult the AI classifier and
//              otherwise re-ask.
//
// We use it first; the AI classifier is only consulted when this returns
// "unclear", so a wrong AI guess can never bypass a clear yes/no.
export function classifyGoalMismatchFollowUp(
  reply: string,
  mainGoalName: string,
): GoalMismatchClarificationResolution {
  const normalized = normalize(reply);
  if (!normalized) return { kind: "unclear" };

  if (REJECT_PATTERNS.some((re) => re.test(normalized))) {
    return { kind: "reject" };
  }

  if (CONFIRM_PATTERNS.some((re) => re.test(normalized))) {
    return { kind: "confirm" };
  }

  // If the reply names the main goal (a distinctive token of it) and
  // carries no negation, treat it as a confirmation. This catches
  // natural replies like "era viaje a brasil" without an explicit "sí".
  const mainGoalTokens = normalize(mainGoalName)
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  const mentionsMainGoal = mainGoalTokens.some((token) =>
    new RegExp(`\\b${escapeRegExp(token)}\\b`).test(normalized),
  );
  const hasNegation = /\bno\b/.test(normalized);
  if (mentionsMainGoal && !hasNegation) return { kind: "confirm" };

  return { kind: "unclear" };
}

// Short, focused yes/no re-ask Kipu uses when the follow-up is still
// ambiguous. Deterministic so the wording never drifts.
export function buildGoalMismatchReClarifyQuestion(
  mainGoalName: string,
): string {
  return `Solo para confirmar: ¿lo registro en ${mainGoalName} o lo dejamos sin registrar?`;
}
