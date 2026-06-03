import {
  parseAmountOnlyFollowUp,
  type AdvisoryRecentMessage,
} from "@/lib/ai/advisory-classifier";

// Read-only coach follow-up memory + the explicit-write boundary.
//
// Core product rule: if the user is in a read-only coach conversation and is
// answering Kipu's question (supplying an amount, a category, or whether it's a
// need), Kipu must KEEP COACHING — it must NOT register a transaction. A DB
// write requires EXPLICIT write intent ("lo compré", "gasté 25…", "regístralo",
// or a clear "<thing> <amount> <account>" log). This module decides, from
// recent chat context (not a giant phrase list), whether a short reply should
// stay read-only.

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

// Explicit logging intent: the user says the movement happened or asks to
// record it. Broad verb stems in past tense / imperative — conditionals
// ("compraría", "pagaría", "gastaría") never match, so a hypothetical never
// counts as a write. This is the boundary: when true we never treat the
// message as a read-only coach follow-up.
const EXPLICIT_WRITE_PATTERNS: RegExp[] = [
  /\bcompr[eé]\b/, // compré / compre, "lo compré"
  /\bgast[eé]\b/, // gasté
  /\bpagu[eé]\b/, // pagué, "ya pagué"
  /\bme\s+pagaron\b/, // me pagaron (income)
  /\baport[eé]\b/, // aporté
  /\bdeposit[eé]\b/, // deposité
  /\bregistr[ao]\w*/, // registra, regístralo, registrar
  /\banot[ao]\w*/, // anota, anótalo, anótame
  /\bya\s+(?:lo|la)\s+(?:compr|pagu|gast)\w*/, // ya lo compré / pagué / gasté
];

export function hasExplicitWriteIntent(message: string): boolean {
  const normalized = normalize(message);
  return EXPLICIT_WRITE_PATTERNS.some((re) => re.test(normalized));
}

// Compact, broad cues for a SHORT reply that supplies the info a coach asked
// for: a "es/son/para …" answer, a need/want word, or a movement category.
// Deliberately small — it only acts as a tie-breaker, and only when a recent
// read-only coach turn is present (see isReplyToReadOnlyCoachPrompt).
const CLARIFICATION_CUES: RegExp[] = [
  /^(?:es|son|seria|serian|fue|era)\b/, // "es un gasto", "son pastillas"
  /\bpara\s+(?:la|el|mi|los|las)?\s*\w+/, // "es para la universidad"
  /\b(?:necesito|necesidad|necesaria?|medicina|pastillas?|salud|comida|transporte|trabajo|universidad|estudio|emergencia)\b/,
  /\b(?:gusto|antojo|capricho)\b/,
  /\b(?:gasto|ingreso|deuda|meta|aporte|aportacion)\b/,
];

const MAX_CLARIFICATION_TOKENS = 9;

// True when the message LOOKS like a short reply that supplies missing context
// (an amount, a category, a need/want) rather than a standalone transaction
// (which names a source) or a brand-new topic. No DB / account knowledge
// needed: a real log like "café 3 pichincha" is multi-word with a source and
// fails the bare-amount and cue checks.
export function looksLikeReadOnlyCoachReply(message: string): boolean {
  const normalized = normalize(message);
  if (!normalized) return false;
  // A bare amount ("25", "$25", "son 25", "unos 25") is the classic answer to
  // "¿cuánto cuesta?".
  if (parseAmountOnlyFollowUp(message) !== null) return true;
  // Otherwise it must be short and carry a category / need cue.
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  if (tokenCount > MAX_CLARIFICATION_TOKENS) return false;
  return CLARIFICATION_CUES.some((re) => re.test(normalized));
}

// True when the most recent assistant turn was a read-only coach/advisory turn.
// A transaction/clarification turn (messageType "transaction"/"clarification")
// means a write flow is in progress, NOT coaching — so we never capture those.
function lastAssistantWasReadOnlyCoachTurn(
  recentMessages: AdvisoryRecentMessage[],
): boolean {
  for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
    const msg = recentMessages[i];
    if (msg.role !== "assistant") continue;
    return msg.messageType === "advisory";
  }
  return false;
}

// Context-driven read-only follow-up detector. True when the user's short reply
// is continuing a recent read-only coach thread and carries NO explicit logging
// intent — so we keep coaching and never route a clarification into the write
// pipeline. Prefer-coach-when-ambiguous is safe: read-only never writes; if the
// user wants it logged they say "regístralo" or send a clear logging message.
export function isReplyToReadOnlyCoachPrompt(
  recentMessages: AdvisoryRecentMessage[],
  currentMessage: string,
): boolean {
  if (hasExplicitWriteIntent(currentMessage)) return false;
  if (!looksLikeReadOnlyCoachReply(currentMessage)) return false;
  return lastAssistantWasReadOnlyCoachTurn(recentMessages);
}
