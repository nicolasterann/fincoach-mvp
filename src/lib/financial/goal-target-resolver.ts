import type { FinancialGoal } from "@/types/financial";

// Mode-agnostic helpers that detect whether the user named a specific
// goal in their message. Used by:
//   • the basic parser (so it doesn't silently fall back to the main
//     goal when the user wrote a different name);
//   • the chat transaction handler's post-parser guard (so AI parser
//     results that target a different goal are caught before any DB
//     write).
//
// All helpers operate on plain Spanish text, lowercase, with diacritics
// stripped.

export type GoalTargetResolutionKind =
  | "no_explicit_target"
  | "generic"
  | "matched"
  | "unresolved";

export interface GoalTargetResolution {
  kind: GoalTargetResolutionKind;
  matchedGoal?: FinancialGoal;
  unresolvedName?: string;
}

export function normalizeForTargetMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

// Extracts the substring the user wrote after "a"/"para" and before
// "desde …" (the source clause). Returns null when the message has no
// explicit target phrase, e.g. "aporté 20 desde pichincha".
export function extractGoalTargetPhrase(
  normalizedMessage: string,
): string | null {
  const amountMatch = normalizedMessage.match(
    /(?:\$|\busd\s*)?(\d+(?:[.,]\d{1,2})?)/i,
  );
  if (!amountMatch || amountMatch.index === undefined) return null;

  const afterAmount = normalizedMessage
    .slice(amountMatch.index + amountMatch[0].length)
    .trim();
  if (!afterAmount) return null;

  const desdeMatch = afterAmount.match(/\bdesde\b/);
  const candidate = desdeMatch
    ? afterAmount.slice(0, desdeMatch.index).trim()
    : afterAmount.trim();
  if (!candidate) return null;

  const trimmed = candidate.replace(/^(?:a|para|al|hacia)\s+/, "").trim();
  if (!trimmed) return null;

  return trimmed;
}

// Removes generic words ("mi", "la", "meta", "ahorro", connectors like
// "de" / "del") and returns the distinctive part of the target. Returns
// "" for fully generic references like "mi meta", which means: fall
// back to the main goal.
export function reduceTargetToName(target: string): string {
  return target
    .replace(/^(?:la|el|mi|mis|tu|tus|una|un|los|las)\s+/, "")
    .replace(/\b(?:la|el|mi|mis|tu|tus|una|un|los|las)\b/g, "")
    .replace(/\b(?:meta|metas|ahorro|ahorros|sueno|objetivo|objetivos)\b/g, "")
    .replace(/\b(?:de|del|para|hacia|al|a)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function findGoalByReducedTarget(
  reducedTarget: string,
  goals: FinancialGoal[],
): FinancialGoal | undefined {
  const targetTokens = reducedTarget
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  if (targetTokens.length === 0) return undefined;

  return goals.find((goal) => {
    const goalName = normalizeForTargetMatch(goal.name);
    if (goalName === reducedTarget) return true;
    if (goalName.includes(reducedTarget) || reducedTarget.includes(goalName)) {
      return true;
    }
    const goalTokens = goalName
      .split(/\s+/)
      .filter((token) => token.length >= 3);
    return targetTokens.some((targetToken) => goalTokens.includes(targetToken));
  });
}

// High-level resolver. Pass the raw user message (any casing) and the
// user's goals (active or not — caller decides). Returns a tagged
// outcome so callers can either trust the match, fall back to a main
// goal (for "generic" / "no_explicit_target"), or ask the user to
// confirm (for "unresolved").
export function resolveGoalTarget(
  rawMessage: string,
  goals: FinancialGoal[],
): GoalTargetResolution {
  const normalized = normalizeForTargetMatch(rawMessage);
  const namedTarget = extractGoalTargetPhrase(normalized);
  if (!namedTarget) return { kind: "no_explicit_target" };

  const reduced = reduceTargetToName(namedTarget);
  if (!reduced) return { kind: "generic" };

  const matched = findGoalByReducedTarget(reduced, goals);
  if (matched) return { kind: "matched", matchedGoal: matched };

  return { kind: "unresolved", unresolvedName: namedTarget };
}
