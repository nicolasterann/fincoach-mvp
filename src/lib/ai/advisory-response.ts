import OpenAI from "openai";
import type { AdvisoryIntent, AdvisoryRecentMessage } from "@/lib/ai/advisory-classifier";
import type { GoalPlanSummary } from "@/lib/ai/goal-aware-response-copy";
import type { AdvisoryDecision } from "@/lib/financial/advisory-decision-engine";

// Direction 2 of the human↔code translation: take the deterministic
// advisory decision (the financial truth) and turn it into a short,
// natural coach reply. The fallback copy is fully deterministic; the AI
// humanizer only rewrites it within a strict validator, and any failure
// degrades back to the deterministic string. Gated by COACH_RESPONSE_MODE.

// Slightly looser than the transaction confirmation cap: an advisory
// reply may carry a touch more reasoning, but it must still be short.
const MAX_ADVISORY_RESPONSE_CHARS = 420;

export interface AdvisoryResponseInput {
  intent: AdvisoryIntent;
  decision: AdvisoryDecision;
  recentMessages: AdvisoryRecentMessage[];
  originalMessage: string;
  goalPlanSummary?: GoalPlanSummary;
}

export interface AdvisoryResponseResult {
  source: "fallback" | "ai";
  message: string;
  confidenceScore: number;
}

function formatAdvisoryMoney(value: number, currency: string): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

function miniGoalSuffix(decision: AdvisoryDecision): string {
  return decision.reasonCodes.includes("consider_mini_goal")
    ? " Si de verdad lo quieres, podemos convertirlo en una mini-meta."
    : "";
}

// Deterministic, on-brand advisory copy. This is the source of truth for
// wording when AI is disabled or its output fails validation.
export function buildAdvisoryFallbackResponse(
  decision: AdvisoryDecision,
): string {
  const currency = decision.baseCurrency;
  const weeklyBefore = decision.weeklyRemainingBefore;
  const weeklyAfter = decision.weeklyRemainingAfter;
  const dailyAfter = decision.dailyRemainingAfter;

  if (decision.recommendation === "need_more_info") {
    if (weeklyBefore !== null && weeklyBefore > 0) {
      return `Cuéntame más o menos cuánto cuesta y te digo si entra en tu semana. Por ahora te quedan ${formatAdvisoryMoney(weeklyBefore, currency)} para esta semana.`;
    }
    return "Cuéntame más o menos cuánto cuesta y te digo si entra en tu semana.";
  }

  // Card path: never imply the cash dropped today.
  if (decision.paymentMethodType === "card") {
    if (decision.recommendation === "no") {
      return `Con tarjeta no baja tu efectivo hoy, pero sube tu deuda, y ahora mismo está bastante apretada. Yo esperaría.${miniGoalSuffix(decision)}`;
    }
    return "Con tarjeta no baja tu efectivo hoy, pero sube tu deuda. Yo lo haría solo si ya sabes cómo la vas a pagar.";
  }

  // Cash path.
  const afterText =
    weeklyAfter !== null ? formatAdvisoryMoney(Math.max(weeklyAfter, 0), currency) : "";
  const dailyText =
    dailyAfter !== null ? formatAdvisoryMoney(dailyAfter, currency) : "";

  if (decision.recommendation === "no") {
    return `Yo esperaría. Ese gasto te dejaría sin margen suficiente para esta semana.${miniGoalSuffix(decision)}`;
  }

  if (decision.recommendation === "wait") {
    return `Yo esperaría un poco. Se comería buena parte de tu margen de la semana.${miniGoalSuffix(decision)}`;
  }

  if (decision.recommendation === "caution") {
    if (afterText && dailyText) {
      return `Puedes hacerlo, pero te deja la semana apretada. Te quedarían ${afterText} para esta semana, más o menos ${dailyText} por día.`;
    }
    return "Puedes hacerlo, pero te deja la semana un poco apretada.";
  }

  // yes
  if (afterText && dailyText) {
    return `Sí entra en tu semana. Si lo compras, te quedarían ${afterText} para esta semana, más o menos ${dailyText} por día.`;
  }
  return "Sí entra en tu semana sin romper tu margen.";
}

// ── Validation (local copies; the coach-response validator's helpers are
// not exported, and the advisory rules differ).

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const CODE_MARKERS = ["{", "}", "```", "</", '"message"', "json", "confidencescore"];

const META_PHRASES = [
  "como modelo",
  "modelo de lenguaje",
  "como una ia",
  "como ia",
  "inteligencia artificial",
  "openai",
];

const CARD_CASH_DOWN_PATTERNS: RegExp[] = [
  /baj[oa]\s+(?:tu\s+|el\s+)?(?:efectivo|saldo|cuenta|dinero)/,
  /sali[oa]\s+de\s+tu\s+cuenta/,
  /descont[oa]\s+de\s+(?:tu\s+)?cuenta/,
  /menos\s+(?:efectivo|saldo)\b/,
  /toc[oa]\s+tu\s+efectivo/,
];

const NO_IMPACT_PATTERNS: RegExp[] = [
  /no\s+(?:te\s+)?afecta/,
  /sin\s+impacto/,
  /no\s+pasa\s+nada/,
  /no\s+cambia\s+nada/,
  /no\s+tiene\s+impacto/,
];

const ENCOURAGE_PATTERNS: RegExp[] = [
  /\bc[oa]mpralo\b/,
  /\bh[a]zlo\b/,
  /\badelante\b/,
  /\bve\s+por\s+(?:el|ese|eso|ella)\b/,
  /\bpuedes\s+comprarlo\b/,
  /\bs[i],?\s+c[oa]mpra/,
  /\bdale\b/,
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
  return allowed.some(
    (a) =>
      Math.abs(value - a) <= AMOUNT_TOLERANCE ||
      Math.round(value) === Math.round(a),
  );
}

export interface AdvisoryValidationResult {
  ok: boolean;
  reason?: string;
}

// Guards an AI-humanized advisory reply against the deterministic
// decision. Returns ok:false (with a reason) whenever the reply is too
// long, leaks structure, contradicts the card-vs-cash truth, encourages a
// purchase we advised against, or cites a money figure we never computed.
export function validateAdvisoryMessage(input: {
  message: string;
  decision: AdvisoryDecision;
}): AdvisoryValidationResult {
  const { decision } = input;
  const message = input.message.trim();
  const normalized = normalize(message);

  if (!message) return { ok: false, reason: "empty" };
  if (message.length > MAX_ADVISORY_RESPONSE_CHARS) {
    return { ok: false, reason: "too_long" };
  }
  if (CODE_MARKERS.some((marker) => normalized.includes(marker))) {
    return { ok: false, reason: "code_marker" };
  }
  if (META_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return { ok: false, reason: "meta_phrase" };
  }

  const isCard = decision.paymentMethodType === "card";
  if (isCard) {
    if (CARD_CASH_DOWN_PATTERNS.some((re) => re.test(normalized))) {
      return { ok: false, reason: "card_cash_down" };
    }
    if (NO_IMPACT_PATTERNS.some((re) => re.test(normalized))) {
      return { ok: false, reason: "card_no_impact_claim" };
    }
  }

  if (
    (decision.recommendation === "no" || decision.recommendation === "wait") &&
    ENCOURAGE_PATTERNS.some((re) => re.test(normalized))
  ) {
    return { ok: false, reason: "encourages_when_blocked" };
  }

  const allowedAmounts = [
    decision.amount,
    decision.weeklyRemainingBefore,
    decision.weeklyRemainingAfter,
    decision.dailyRemainingAfter,
    decision.cashImpact,
    decision.debtImpact,
  ].filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );

  const mentioned = extractCurrencyAmounts(message);
  if (mentioned.some((value) => !isAllowedAmount(value, allowedAmounts))) {
    return { ok: false, reason: "foreign_amount" };
  }

  return { ok: true };
}

const ADVISORY_RESPONSE_SYSTEM_PROMPT = `
You are Kipu, a close, playful, premium money coach for Latin American users. You are answering a user's question about whether to spend, which payment method to use, or whether to wait. A deterministic engine already decided the recommendation and computed every number — you ONLY rephrase it naturally. You never change the recommendation and never invent numbers.

Style:
- 1 to 3 short sentences, natural Spanish, friendly and direct.
- Give a clear opinion, one short reason, and a concrete next step.
- No guilt, no moralizing, no tables, no "como modelo de IA", no budgeting lecture.
- Money looks like "120$" or "96$" (sign after the number, drop decimals when whole).

Hard rules (the financial truth):
- Use ONLY the numbers provided in "decision". Never state a different amount.
- If paymentMethodType is "card": never say the cash/efectivo went down; never say it has no impact. A card purchase does not lower cash today, it raises debt.
- If the recommendation is "no" or "wait", do NOT encourage the purchase. You may suggest waiting or turning it into a mini-meta.
- If the recommendation is "yes" or "caution", be honest about the margin it leaves.

Allowed phrasings to draw from: "Yo esperaría.", "Puedes hacerlo, pero te deja la semana apretada.", "Si lo pagas con Visa, no baja tu efectivo hoy, pero sube la tarjeta.", "Si de verdad lo quieres, mejor lo convertimos en mini-meta.", "No te rompe la semana, pero tampoco es invisible."

Respond with STRICT JSON only: {"message": string, "confidenceScore": number between 0 and 1}.
`;

async function generateAdvisoryResponseWithOpenAI(
  input: AdvisoryResponseInput,
): Promise<AdvisoryResponseResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { source: "fallback", message: "", confidenceScore: 0 };
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_COACH_MODEL ?? "gpt-5.4";

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ADVISORY_RESPONSE_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            originalMessage: input.originalMessage,
            advisoryType: input.intent.advisoryType,
            itemDescription: input.intent.itemDescription,
            decision: {
              recommendation: input.decision.recommendation,
              severity: input.decision.severity,
              reasonCodes: input.decision.reasonCodes,
              paymentMethodType: input.decision.paymentMethodType,
              amount: input.decision.amount,
              weeklyRemainingBefore: input.decision.weeklyRemainingBefore,
              weeklyRemainingAfter: input.decision.weeklyRemainingAfter,
              dailyRemainingAfter: input.decision.dailyRemainingAfter,
              cashImpact: input.decision.cashImpact,
              debtImpact: input.decision.debtImpact,
              goalImpactNote: input.decision.goalImpactNote,
              baseCurrency: input.decision.baseCurrency,
            },
            goalPlanSummary: input.goalPlanSummary ?? null,
            recentMessages: input.recentMessages.slice(-8),
          }),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return { source: "fallback", message: "", confidenceScore: 0 };

    const parsed = JSON.parse(content) as {
      message?: unknown;
      confidenceScore?: unknown;
    };

    if (typeof parsed.message !== "string" || !parsed.message.trim()) {
      return { source: "fallback", message: "", confidenceScore: 0 };
    }

    const confidenceScore =
      typeof parsed.confidenceScore === "number"
        ? Math.max(0, Math.min(1, parsed.confidenceScore))
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

export async function generateAdvisoryResponse(
  input: AdvisoryResponseInput,
): Promise<AdvisoryResponseResult> {
  const fallbackMessage = buildAdvisoryFallbackResponse(input.decision);
  const fallback: AdvisoryResponseResult = {
    source: "fallback",
    message: fallbackMessage,
    confidenceScore: 0,
  };

  const mode = process.env.COACH_RESPONSE_MODE ?? "fallback";
  if (mode !== "ai") return fallback;

  const aiResult = await generateAdvisoryResponseWithOpenAI(input);
  if (
    aiResult.source === "ai" &&
    aiResult.message &&
    aiResult.confidenceScore >= 0.75
  ) {
    const validation = validateAdvisoryMessage({
      message: aiResult.message,
      decision: input.decision,
    });
    if (validation.ok) return aiResult;
  }

  return fallback;
}
