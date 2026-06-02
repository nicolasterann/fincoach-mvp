import OpenAI from "openai";
import type { AdvisoryRecentMessage } from "@/lib/ai/advisory-classifier";
import type { GoalPlanSummary } from "@/lib/ai/goal-aware-response-copy";
import type { DebtPressureLevel } from "@/lib/financial/debt-pressure";

// General, AI-first, READ-ONLY financial coach. This is the default path for
// any financial message that is NOT a clear request to record/change/delete
// data: comparisons, tradeoffs, guilt, debt worries, "what should I do / cuidar
// hoy", "how much could I spend", "should I go out or save". It never writes to
// the database and never decides money truth — it reasons over the user's real
// financial context (passed in as a compact package) and recent chat to answer
// like a personal coach, not a rigid bot.
//
// The deterministic engine still owns the numbers (weekly margin, daily limit,
// debt pressure) — those are computed elsewhere and handed in. This module only
// phrases the answer. AI is the PRIMARY voice when COACH_RESPONSE_MODE=ai and
// the output passes validation; otherwise we degrade to a short deterministic
// fallback. No template rotation on the happy path.

const MAX_GENERAL_COACH_RESPONSE_CHARS = 500;

// AI is trusted only at/above this certainty; below it we use the fallback.
const GENERAL_COACH_AI_CONFIDENCE_THRESHOLD = 0.75;

// Compact, useful slice of the user's real financial context. Built by the
// caller from buildUserFinancialContext + the derived weekly/debt snapshot.
// Every number here is one WE computed; the coach may restate these (and simple
// sums/differences of them, e.g. savings between two options) but must never
// invent a balance.
export interface GeneralCoachContextPackage {
  baseCurrency: string;
  weeklyRemaining: number;
  dailySuggested: number;
  daysRemainingInWeek: number;
  debtPressureLevel: DebtPressureLevel;
  totalDebt: number;
  availableCash: number;
  accounts: { name: string; balance: number }[];
  cards: { name: string; balance: number }[];
  goal: { name: string; targetAmount: number; currentAmount: number } | null;
  goalPlanSummary: GoalPlanSummary;
  fixedExpenses: { name: string; amount: number }[];
}

export interface GeneralCoachResponseResult {
  source: "fallback" | "ai";
  message: string;
  confidenceScore: number;
}

export interface GeneralCoachResponseInput {
  userId: string;
  message: string;
  recentMessages: AdvisoryRecentMessage[];
  context: GeneralCoachContextPackage;
  // Safe, always-valid deterministic copy to use when AI is off, low
  // confidence, or its output fails validation.
  deterministicFallback: string;
}

// ── Validation ─────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const CODE_MARKERS = ["{", "}", "```", "</", '"message"', "confidencescore"];

const META_PHRASES = [
  "como modelo",
  "modelo de lenguaje",
  "como una ia",
  "como ia",
  "inteligencia artificial",
  "openai",
];

// Claims that a movement was actually applied. A read-only coach must never
// say it recorded / changed / deleted / moved anything. Tuned to past-tense /
// completed claims so conditionals ("guardaría", "registraría", "bajaría") and
// suggestions ("mándamelo y lo anoto") never trip it.
const WROTE_CLAIM_PATTERNS: RegExp[] = [
  /\bregistrad[oa]s?\b/,
  /\b(?:lo|la|los|las)\s+(?:registr[eé]|anot[eé]|guard[eé]|apunt[eé]|apliqu[eé]|baj[eé]|sub[ií]|mov[ií]|descont[eé]|elimin[eé]|borr[eé])\b/,
  /\bya\s+(?:qued[oó]|est[aá]\s+(?:registrad|anotad|guardad|aplicad))/,
  /\bte\s+(?:descont[eé]|baj[eé]|sub[ií])\b/,
  /\btransfer[ií]\b/,
  /\breembols[eé]\b/,
];

const CARD_NO_IMPACT_PATTERNS: RegExp[] = [
  /\bno\s+(?:te\s+)?afecta\b/,
  /\bsin\s+impacto\b/,
  /\bno\s+pasa\s+nada\b/,
  /\bno\s+cambia\s+nada\b/,
  /\bno\s+tiene\s+impacto\b/,
];

function parseLooseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d.,]/g, "");
  if (!s) return null;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
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
    if (parts.length > 2 || (parts[1] && parts[1].length === 3)) {
      s = s.replace(/\./g, "");
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// All standalone numbers in the user's own message — they are allowed inputs
// the coach may restate (and combine).
function extractAllNumbers(message: string): number[] {
  const out: number[] = [];
  const re = /\b(\d[\d.,]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(message)) !== null) {
    const parsed = parseLooseAmount(match[1] ?? "");
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

// Money figures the coach's reply states ("80$", "USD 80"). These are what we
// validate against the allowed set.
function extractCurrencyAmounts(message: string): number[] {
  const out: number[] = [];
  const re = /(?:usd\s*|\$\s*)([\d][\d.,]*)|([\d][\d.,]*)\s*\$/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(message)) !== null) {
    const captured = match[1] ?? match[2];
    const parsed = parseLooseAmount(captured ?? "");
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

// Numbers the coach may safely use: everything WE computed (margins, balances,
// goal, fixed expenses), the user's own numbers, 0, and simple pairwise sums /
// absolute differences of those (so "comparado con 10$ te ahorra 6$" passes
// for a $4-vs-$10 comparison). It is intentionally lenient: this path is
// READ-ONLY, so a stray figure is cosmetic, never a balance corruption — but a
// wholesale invented number (e.g. "te quedan 500$") still gets rejected.
function buildAllowedAmounts(
  context: GeneralCoachContextPackage,
  userMessage: string,
): number[] {
  const base: number[] = [
    context.weeklyRemaining,
    context.dailySuggested,
    context.totalDebt,
    context.availableCash,
    ...context.accounts.map((a) => a.balance),
    ...context.cards.map((c) => c.balance),
    ...context.fixedExpenses.map((f) => f.amount),
    ...extractAllNumbers(userMessage),
  ];
  if (context.goal) {
    base.push(context.goal.targetAmount, context.goal.currentAmount);
  }

  const finite = base.filter((n) => Number.isFinite(n));
  const allowed = new Set<number>([0]);
  for (const n of finite) allowed.add(n);
  for (let i = 0; i < finite.length; i += 1) {
    for (let j = i; j < finite.length; j += 1) {
      allowed.add(finite[i] + finite[j]);
      allowed.add(Math.abs(finite[i] - finite[j]));
    }
  }
  return [...allowed];
}

const AMOUNT_TOLERANCE = 1;

function isAllowedAmount(value: number, allowed: number[]): boolean {
  return allowed.some(
    (a) =>
      Math.abs(value - a) <= AMOUNT_TOLERANCE ||
      Math.round(Math.abs(value)) === Math.round(Math.abs(a)),
  );
}

export interface GeneralCoachValidationResult {
  ok: boolean;
  reason?: string;
}

// Guards an AI-generated coaching reply: bounded length, no leaked structure,
// no "I recorded/changed it" claim, no card-has-no-impact claim, and no money
// figure we cannot trace back to the user's message or context.
export function validateGeneralCoachMessage(input: {
  message: string;
  context: GeneralCoachContextPackage;
  userMessage: string;
}): GeneralCoachValidationResult {
  const message = input.message.trim();
  const normalized = normalize(message);

  if (!message) return { ok: false, reason: "empty" };
  if (message.length > MAX_GENERAL_COACH_RESPONSE_CHARS) {
    return { ok: false, reason: "too_long" };
  }
  if (CODE_MARKERS.some((marker) => normalized.includes(marker))) {
    return { ok: false, reason: "code_marker" };
  }
  if (META_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return { ok: false, reason: "meta_phrase" };
  }
  if (WROTE_CLAIM_PATTERNS.some((re) => re.test(normalized))) {
    return { ok: false, reason: "claims_write" };
  }
  if (CARD_NO_IMPACT_PATTERNS.some((re) => re.test(normalized))) {
    return { ok: false, reason: "card_no_impact_claim" };
  }

  const allowed = buildAllowedAmounts(input.context, input.userMessage);
  const mentioned = extractCurrencyAmounts(message);
  if (mentioned.some((value) => !isAllowedAmount(value, allowed))) {
    return { ok: false, reason: "foreign_amount" };
  }

  return { ok: true };
}

// ── AI generation ────────────────────────────────────────────────────────────

const GENERAL_COACH_SYSTEM_PROMPT = `
You are Kipu, a close, sharp, premium money coach for Latin American users — like a smart friend who is good with money. The user wrote something about their money that is NOT a request to record, change, or delete a movement. Your job is to answer like a real coach in a normal chat: understand what they actually mean and give a useful, human, personalized reply grounded in their real numbers.

You are READ-ONLY. You NEVER record, change, move, or delete anything, and you must NEVER claim you did ("lo registré", "ya lo anoté", "bajé tu saldo", "te descontué", "moví", "transferí"). If they clearly want to log a movement, you may invite them ("si quieres lo anotas con \"café 3 pichincha\""), but you do not do it here.

Use ONLY the facts in the provided context (weekly margin, daily suggested amount, debt/card pressure, account/card/goal/fixed-expense names and balances) plus the numbers in the user's own message. Never invent a balance, an account/card/goal name, or an amount. You MAY do simple math with the user's numbers (e.g. the savings between a 4$ option and a 10$ one is 6$).

What you can reason about (this is the point — do NOT collapse into one canned line):
- comparisons between options ("el de 4$ vs el de 10$"): say which makes sense and why, in money terms.
- tradeoffs ("si compro esto, ¿qué sacrifico?"): what it costs them this week.
- guilt / feelings ("me da culpa comprar esto pero lo necesito"): be empathetic, then practical (a cap, a plan).
- debt / card worry ("mi tarjeta me preocupa"): speak to the real debt pressure, what to watch.
- planning ("¿qué debería cuidar hoy?", "¿cuánto podría gastar hoy?", "estoy entre salir o ahorrar"): give a concrete, useful boundary from their real margin.
- "¿qué hago si ya me pasé del margen?": no guilt; freeze non-essentials, watch the card until the week resets.

Money truth:
- A card purchase does NOT lower cash today; it RAISES debt. Never say a card spend has no impact.
- Negative/zero weekly margin: NEVER print a negative number ("te quedan -15$"). Say how far past the line they are using the absolute value, or that the week is already tight. You MAY say a "0$" cap.
- If their margin is tight or debt comes first, do NOT push them to save more toward the goal.

Voice (sound like a person, not a script):
- Natural, everyday LatAm Spanish. 1 to 3 short sentences. Warm, direct, never preachy, never shaming, no bank-speak, no over-polished AI tone, no canned "yo esperaría" on everything.
- Money: "120$" / "96$" (sign after the number, drop decimals when whole). Per-day is a whole number: "27$".
- If you genuinely need the amount or which option to answer well, ask ONE short question (set needsFollowUp=true and put it in followUpQuestion). Don't ask if you can already answer.

Unsupported from chat (transfers between accounts, refunds, editing/deleting a past movement, changing a balance directly): say you can't do that from the chat yet and it's better from the app — never claim you did it.

Respond with STRICT JSON only, no prose:
{"message": string, "confidence": number, "needsFollowUp": boolean, "followUpQuestion": string|null, "usesFinancialFacts": string[]}
`;

async function generateGeneralCoachResponseWithOpenAI(
  input: GeneralCoachResponseInput,
): Promise<GeneralCoachResponseResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { source: "fallback", message: "", confidenceScore: 0 };

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_COACH_MODEL ?? "gpt-5.4";
  const { context } = input;

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: GENERAL_COACH_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            userMessage: input.message,
            recentMessages: input.recentMessages.slice(-8),
            financialContext: {
              baseCurrency: context.baseCurrency,
              weeklyRemaining: context.weeklyRemaining,
              dailySuggested: context.dailySuggested,
              daysRemainingInWeek: context.daysRemainingInWeek,
              marginIsNegative: context.weeklyRemaining <= 0,
              overBudgetBy:
                context.weeklyRemaining < 0
                  ? Math.abs(context.weeklyRemaining)
                  : 0,
              debtPressureLevel: context.debtPressureLevel,
              totalDebt: context.totalDebt,
              availableCash: context.availableCash,
              accounts: context.accounts,
              cards: context.cards,
              goal: context.goal,
              goalPlanSummary: context.goalPlanSummary,
              fixedExpenses: context.fixedExpenses,
            },
            expectedJsonShape: {
              message: "string",
              confidence: "number 0..1",
              needsFollowUp: "boolean",
              followUpQuestion: "string|null",
              usesFinancialFacts: "string[]",
            },
          }),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return { source: "fallback", message: "", confidenceScore: 0 };

    const parsed = JSON.parse(content) as {
      message?: unknown;
      confidence?: unknown;
    };

    if (typeof parsed.message !== "string" || !parsed.message.trim()) {
      return { source: "fallback", message: "", confidenceScore: 0 };
    }

    const confidenceScore =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.8;

    return {
      source: "ai",
      message: parsed.message.trim(),
      confidenceScore,
    };
  } catch {
    return { source: "fallback", message: "", confidenceScore: 0 };
  }
}

// Primary entry: AI when COACH_RESPONSE_MODE=ai and it passes validation;
// otherwise the deterministic fallback the caller supplied.
export async function generateGeneralCoachResponse(
  input: GeneralCoachResponseInput,
): Promise<GeneralCoachResponseResult> {
  const fallback: GeneralCoachResponseResult = {
    source: "fallback",
    message: input.deterministicFallback,
    confidenceScore: 0,
  };

  const mode = process.env.COACH_RESPONSE_MODE ?? "fallback";
  if (mode !== "ai") return fallback;

  const aiResult = await generateGeneralCoachResponseWithOpenAI(input);
  if (
    aiResult.source === "ai" &&
    aiResult.message &&
    aiResult.confidenceScore >= GENERAL_COACH_AI_CONFIDENCE_THRESHOLD
  ) {
    const validation = validateGeneralCoachMessage({
      message: aiResult.message,
      context: input.context,
      userMessage: input.message,
    });
    if (validation.ok) return aiResult;
  }

  return fallback;
}
