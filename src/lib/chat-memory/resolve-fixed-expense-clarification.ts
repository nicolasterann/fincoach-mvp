import type { FixedExpenseAmountMismatchPayload } from "@/lib/chat-memory/pending-clarification";

export type FixedExpenseClarificationResolution =
  | { kind: "normal" }
  | { kind: "separate" }
  | { kind: "unclear" };

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

// Phrases the user can reasonably reply with after Kipu asks:
// "Internet normalmente está en 20$, pero esta vez pusiste 25$.
// ¿Lo dejo como el pago normal o como un cargo aparte?"
//
// Order matters — separate-charge phrases are checked first because
// they often contain words that also appear in "normal" phrases
// (e.g. "no, fue aparte, no el normal").
const SEPARATE_PATTERNS: RegExp[] = [
  /\bcargo\s+aparte\b/,
  /\bgasto\s+aparte\b/,
  /\bes\s+aparte\b/,
  /\bfue\s+aparte\b/,
  /\bcomo\s+aparte\b/,
  /\bun\s+cargo\s+(?:aparte|extra)\b/,
  /\botro\s+cargo\b/,
  /\bes\s+un?\s+(?:cargo\s+)?extra\b/,
  /\bcargo\s+extra\b/,
  /\b(?:fue|es)\s+(?:un|una)?\s*extra\b/,
  /\bno,?\s+aparte\b/,
  /\baparte\b/,
  // "a parte" (two words) is the same intent as "aparte"; the original
  // pattern only matched the single-word form, so "como uno a parte"
  // fell through to unclear in production.
  /\ba\s+parte\b/,
];

const NORMAL_PATTERNS: RegExp[] = [
  /\bfue\s+el\s+(?:cargo|pago)\s+normal\b/,
  /\bes\s+el\s+(?:cargo|pago)\s+normal\b/,
  /\bel\s+(?:cargo|pago)\s+normal\b/,
  /\bsi,?\s+normal\b/,
  /\bsi,?\s+es(?:e)?\s+pago\b/,
  /\bsi,?\s+ese\s+(?:es\s+)?el?\s*pago\b/,
  /\bes\s+el\s+normal\b/,
  /\bel\s+normal\b/,
  /\bde\s+siempre\b/,
  /\bfue\s+normal\b/,
  /\bcomo\s+gasto\s+fijo\b/,
  /\bcomo\s+pago\s+fijo\b/,
  /\bcomo\s+fijo\b/,
  /\bel\s+pago\s+fijo\b/,
  /\bes\s+el?\s*fijo\b/,
  /\bfijo\b/,
  /^\s*normal\s*$/,
  /^\s*si\s*$/,
];

const CANCEL_PATTERNS: RegExp[] = [
  /^\s*no\s*$/,
  /\bolvi[dt]a(?:lo)?\b/,
  /\bcancel(?:ar|a|alo)\b/,
  /\bd[ée]jalo\b/,
];

// Deterministic classifier for the user's follow-up to an amount-
// mismatch clarification. Returns:
//   - normal:   user confirmed this IS the fixed-expense payment;
//               apply with the user's typed amount and link the
//               recurring_expense_id.
//   - separate: user said it is a separate/extra charge; apply as a
//               normal expense, do NOT link the recurring_expense_id.
//   - unclear:  the reply is ambiguous (or an explicit cancel); the
//               handler should re-ask without writing to the DB.
//
// We do not let AI decide which DB write to make here. The AI/coach
// layer can still pick the wording, but the categorisation is
// deterministic so a wrong AI guess never silently mutates money.
export function classifyFixedExpenseFollowUp(
  reply: string,
): FixedExpenseClarificationResolution {
  const normalized = normalize(reply);
  if (!normalized) return { kind: "unclear" };

  if (CANCEL_PATTERNS.some((re) => re.test(normalized))) {
    return { kind: "unclear" };
  }

  if (SEPARATE_PATTERNS.some((re) => re.test(normalized))) {
    return { kind: "separate" };
  }

  if (NORMAL_PATTERNS.some((re) => re.test(normalized))) {
    return { kind: "normal" };
  }

  return { kind: "unclear" };
}

// Convenience builder for the short re-clarify line Kipu uses when the
// user's follow-up is still ambiguous. Keeping it deterministic and
// tied to the original payload avoids any AI-side drift in wording.
export function buildReClarifyQuestion(
  payload: FixedExpenseAmountMismatchPayload,
): string {
  const name = payload.fixedExpenseName;
  return `Solo para no moverlo mal: ¿lo dejo como tu pago fijo de ${name} o como cargo aparte?`;
}
