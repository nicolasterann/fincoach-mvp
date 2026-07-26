import type { CoachTransactionContext } from "@/lib/ai/coach-response-contract";

// Telegram-friendly hard cap. A humanized confirmation should be 1–3
// short sentences; anything longer is treated as off-brand and we fall
// back to the deterministic reply.
export const MAX_COACH_RESPONSE_CHARS = 320;

export interface CoachValidationResult {
  ok: boolean;
  reason?: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Markers that mean the model leaked structured output or broke
// character (talking about itself as an AI / system).
const CODE_MARKERS = [
  "{",
  "}",
  "```",
  "</",
  '"message"',
  "confidencescore",
  "resultcode",
  "json",
];

const META_PHRASES = [
  "como modelo",
  "modelo de lenguaje",
  "como una ia",
  "como ia",
  "inteligencia artificial",
  "openai",
  "no puedo ayudarte",
];

// A card purchase must never claim the user's cash/account went down —
// it didn't today. The debt went UP, so it must never claim debt fell.
const CARD_CASH_DOWN_PATTERNS: RegExp[] = [
  /(?<!no )(?<!nunca )baj[oó]\s+(?:tu\s+|el\s+)?(?:efectivo|cuenta|dinero)/,
  /(?<!no )(?<!nunca )sali[oó]\s+de\s+tu\s+cuenta/,
  /(?<!no )(?<!nunca )descont[oó]\s+de\s+(?:tu\s+)?cuenta/,
  /menos\s+efectivo\b/,
  /(?<!no )(?<!nunca )toc[oó]\s+tu\s+efectivo/,
];

const CARD_DEBT_DOWN_PATTERNS: RegExp[] = [
  /baj[oó]\s+(?:tu\s+|la\s+)?deuda/,
  /menos\s+deuda\b/,
  /reduc\w*\s+(?:tu\s+|la\s+)?deuda/,
  /deuda\s+baj[oó]/,
  /debes\s+menos/,
];

// Transaction confirmations only receive the post-write Saldo. Without a
// pre-write value, claiming that the tank rose or fell is an invented trend
// (an income can leave a capped Saldo unchanged; an objective-covered expense
// can do the same).
const SALDO_DIRECTION_PATTERNS: RegExp[] = [
  /(?:tu\s+)?saldo\s+(?:subio|bajo|aumento|disminuyo)\b/,
  /(?:subio|bajo|aumento|disminuyo)\s+(?:tu\s+)?saldo\b/,
];

// This response contract has only the post-write Saldo. It cannot prove that
// the movement crossed into Reserva (zero can mean exact exhaustion, a
// category objective absorbed it, or the tank was already empty).
const UNSUPPORTED_LAYER_CLAIM_PATTERNS: RegExp[] = [
  /\b(?:salio|sale|tomo|uso|toco|entro)\b.{0,40}\b(?:tu\s+)?reserva\b/,
  /\b(?:tu\s+)?reserva\b.{0,40}\b(?:bajo|disminuyo|pago|cubrio)\b/,
];

// Phrases that push the user to put MORE toward the goal. Forbidden when
// the goal plan says contributions are suppressed (tight margin / debt
// pressure).
const GOAL_PUSH_PATTERNS: RegExp[] = [
  /sigue\s+aportando/,
  /aporta\s+(?:mas|un\s+poco\s+mas)/,
  /mete\s+mas/,
  /guarda\s+mas/,
  /ahorra\s+mas/,
  /sep[ao]ra\w*\s+(?:algo|mas|dinero|plata)\s+para/,
  /pod(?:emos|riamos)\s+(?:separar|apartar|aportar|guardar)/,
];

function parseLooseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d.,]/g, "");
  if (!s) return null;

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    // The separator that appears last is the decimal separator.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      s = `${parts[0]}.${parts[1]}`;
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasDot) {
    const parts = s.split(".");
    // 1.200 / 1.000.000 → thousands separators, not decimals.
    if (parts.length > 2 || (parts[1] && parts[1].length === 3)) {
      s = s.replace(/\./g, "");
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Pull out only currency-marked numbers ("3$", "USD 25.00", "$30"). We
// deliberately ignore bare numbers (day counts, percentages) to keep
// the check high-precision.
function extractCurrencyAmounts(message: string): number[] {
  const amounts: number[] = [];
  const re = /(?:usd\s*|\$\s*)([\d][\d.,]*)|([\d][\d.,]*)\s*\$/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(message)) !== null) {
    const captured = match[1] ?? match[2];
    const parsed = parseLooseAmount(captured ?? "");
    if (parsed !== null) amounts.push(parsed);
  }
  return amounts;
}

const AMOUNT_TOLERANCE = 1;

function isAllowedAmount(value: number, allowed: number[]): boolean {
  // Compare magnitudes too: a faithful reply about a NEGATIVE computed
  // figure (e.g. a forward projection of -15) states it as "15$". Allowing the
  // absolute value keeps that honest copy valid — every allowed number is
  // one WE computed, so its magnitude is never foreign.
  return allowed.some(
    (a) =>
      Math.abs(value - a) <= AMOUNT_TOLERANCE ||
      Math.round(value) === Math.round(a) ||
      Math.round(Math.abs(value)) === Math.round(Math.abs(a)),
  );
}

// Validates an AI-humanized confirmation against the structured facts of
// an already-applied financial event. Returns ok:false (with a reason)
// whenever the message is too long, leaks structure, or could contradict
// the validated truth — the router then falls back to deterministic copy.
export function validateHumanizedCoachMessage(input: {
  message: string;
  context: CoachTransactionContext;
}): CoachValidationResult {
  const { context } = input;
  const message = input.message.trim();
  const normalized = normalize(message);

  if (!message) {
    return { ok: false, reason: "empty" };
  }

  if (message.length > MAX_COACH_RESPONSE_CHARS) {
    return { ok: false, reason: "too_long" };
  }

  if (CODE_MARKERS.some((marker) => normalized.includes(marker))) {
    return { ok: false, reason: "code_marker" };
  }

  if (META_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return { ok: false, reason: "meta_phrase" };
  }

  const isCardExpense =
    context.resultCode === "expense_created" && Boolean(context.usedCard);

  if (isCardExpense) {
    if (CARD_CASH_DOWN_PATTERNS.some((re) => re.test(normalized))) {
      return { ok: false, reason: "card_cash_down" };
    }
    if (CARD_DEBT_DOWN_PATTERNS.some((re) => re.test(normalized))) {
      return { ok: false, reason: "card_debt_down" };
    }
  }

  const suppressGoalPush = Boolean(
    context.financialSnapshot?.goalPlanSummary?.suppressContributionPush,
  );

  if (suppressGoalPush && GOAL_PUSH_PATTERNS.some((re) => re.test(normalized))) {
    return { ok: false, reason: "goal_push_when_suppressed" };
  }
  if (SALDO_DIRECTION_PATTERNS.some((re) => re.test(normalized))) {
    return { ok: false, reason: "unsupported_saldo_direction" };
  }
  if (UNSUPPORTED_LAYER_CLAIM_PATTERNS.some((re) => re.test(normalized))) {
    return { ok: false, reason: "unsupported_layer_claim" };
  }

  const allowedAmounts = [
    context.intent.originalAmount,
    context.financialSnapshot?.saldoAmount,
    context.financialSnapshot?.saldoFillDaily,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const mentionedAmounts = extractCurrencyAmounts(message);
  const hasForeignAmount = mentionedAmounts.some(
    (value) => !isAllowedAmount(value, allowedAmounts),
  );

  if (hasForeignAmount) {
    return { ok: false, reason: "foreign_amount" };
  }

  return { ok: true };
}
