import OpenAI from "openai";
import type {
  AdvisoryIntent,
  AdvisoryRecentMessage,
  AdvisoryType,
} from "@/lib/ai/advisory-classifier";
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

// Per-day amounts are always whole dollars in chat — "27$ por día", never
// "26.67$". Weekly/purchase figures keep their natural precision.
function formatAdvisoryDaily(value: number, currency: string): string {
  const rounded = Math.round(value);
  return currency === "USD" ? `${rounded}$` : `${rounded} ${currency}`;
}

function miniGoalSuffix(decision: AdvisoryDecision): string {
  // The reason code is only present for durable/wishlist items (the engine
  // gates it), so this only ever fires where saving up actually makes sense.
  return decision.reasonCodes.includes("consider_mini_goal")
    ? " Si de verdad lo quieres, mejor lo guardas como mini-meta y no lo compras desde la presión."
    : "";
}

// Stable, deterministic variant pick so the fallback isn't a single
// identical sentence every time the same branch is hit. Seeded by the
// amount so a given case is reproducible (no Math.random in copy).
function pickVariant(variants: string[], seed: number | null): string {
  if (variants.length === 1) return variants[0];
  const index = Math.abs(Math.round(seed ?? 0)) % variants.length;
  return variants[index];
}

// Uppercase the first character so a reason clause ("90$ se come…") can also
// start a sentence ("eso se come…" → "Eso se come…"). Digits are unchanged.
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface AdvisoryFallbackInput {
  decision: AdvisoryDecision;
  advisoryType: AdvisoryType;
  itemDescription: string | null;
}

// Deterministic, on-brand advisory copy. This is the source of truth for
// wording when AI is disabled or its output fails validation. It varies by
// item kind, intent, amount and margin so it never collapses into one
// robotic "Yo esperaría…" template across very different questions.
export function buildAdvisoryFallbackResponse(
  input: AdvisoryFallbackInput,
): string {
  const { decision, advisoryType } = input;
  const itemKind = decision.itemKind;
  const currency = decision.baseCurrency;
  const amount = decision.amount;
  const weeklyBefore = decision.weeklyRemainingBefore;
  const weeklyAfter = decision.weeklyRemainingAfter;
  const dailyBefore = decision.dailyRemainingBefore;
  const dailyAfter = decision.dailyRemainingAfter;
  const amountText = amount !== null ? formatAdvisoryMoney(amount, currency) : "";
  const seed = amount;

  // No amount yet: ask for it, but give a USEFUL boundary, never a vague
  // "yo esperaría". Never imply a cost ("son X$").
  if (decision.recommendation === "need_more_info") {
    if (weeklyBefore !== null && weeklyBefore > 0) {
      if (dailyBefore !== null) {
        return `Con tu margen actual te quedan ${formatAdvisoryMoney(weeklyBefore, currency)} para esta semana, así que algo cerca de ${formatAdvisoryDaily(dailyBefore, currency)} por día te deja respirar; más que eso ya te aprieta. Dime el monto y te confirmo si entra.`;
      }
      return `Dime más o menos cuánto y te digo si entra en tu semana. Por ahora te quedan ${formatAdvisoryMoney(weeklyBefore, currency)} para esta semana.`;
    }
    // Already in the red: invite the amount / what it is (need vs want) and
    // give a calm boundary, not a scolding. A "0$" cap is allowed.
    return "Por ahora la semana viene sin margen, así que en gastos no esenciales me quedaría cerca de 0$. Dime el monto o qué es y te digo cómo acomodarlo sin apretarte más.";
  }

  const blocked =
    decision.recommendation === "no" || decision.recommendation === "wait";
  const noMarginBefore = weeklyBefore !== null && weeklyBefore <= 0;
  // The purchase would leave them in the red (already negative, or it tips
  // them under). Drives the calm "se suma a una semana justa" framing.
  const wouldGoNegative =
    noMarginBefore || (weeklyAfter !== null && weeklyAfter < 0);

  // The reason clause tying the purchase to their margin, phrased POSITIVELY
  // (never "-15$") and INFORMATIVELY (not punitive): it either adds to an
  // already-tight week, or it eats a big share.
  const pushClause = wouldGoNegative
    ? amountText
      ? `${amountText} se suma a una semana que ya viene justa`
      : "se suma a una semana que ya viene justa"
    : amountText
      ? `${amountText} se lleva buena parte de tu semana`
      : "eso se lleva buena parte de tu semana";

  // The user is leaning toward waiting / asking "should I leave it?" — answer
  // that decision directly instead of re-explaining payment mechanics.
  if (advisoryType === "wait_or_buy" && blocked) {
    return `Sí, yo lo dejaría para después. Con tu margen actual, esperar te deja más tranquilo${amountText ? ` que soltar ${amountText} hoy` : ""}.${miniGoalSuffix(decision)}`;
  }

  // Recurring/subscription: a monthly commitment that adds up — never a
  // one-off, never a mini-meta. Handled before card/cash so it also covers
  // the "caution" (not blocked) case.
  if (itemKind === "subscription") {
    if (blocked || wouldGoNegative) {
      return `Como es mensual, no lo trataría como gasto de una sola vez. ${amountText ? `${amountText} al mes` : "Eso"} se acumula; yo esperaría hasta que tu semana no esté en rojo.`;
    }
    return `Como es mensual, súmalo con cuidado: ${amountText ? `${amountText} al mes` : "eso"} se va acumulando. Si entra, que sea reemplazando otro gasto que ya tienes.`;
  }

  // Card path: never imply the cash dropped today.
  if (decision.paymentMethodType === "card") {
    if (decision.recommendation === "no") {
      return `Yo esperaría. Aunque con tarjeta no baja tu efectivo hoy, sí sube la deuda y ahora está bastante apretada.${miniGoalSuffix(decision)}`;
    }
    if (advisoryType === "payment_method_comparison") {
      return "Con tarjeta no baja tu efectivo hoy, pero sí sube la deuda. Yo la usaría solo si ya sabes con qué la vas a pagar.";
    }
    return "Con tarjeta no baja tu efectivo hoy, pero sí sube la deuda. Yo lo haría solo si ya tienes claro cómo pagarla.";
  }

  // Cash path.
  const afterText =
    weeklyAfter !== null ? formatAdvisoryMoney(Math.max(weeklyAfter, 0), currency) : "";
  const dailyText =
    dailyAfter !== null ? formatAdvisoryDaily(dailyAfter, currency) : "";

  if (blocked) {
    if (itemKind === "consumable") {
      return pickVariant(
        [
          `${capitalize(pushClause)}. Si te provoca algo, una versión más liviana te cuida sin apretarte.`,
          `Se entiende el antojo. ${capitalize(pushClause)}; si vas, yo le pondría un tope más bajo.`,
        ],
        seed,
      );
    }

    if (itemKind === "experience") {
      return `Se entiende las ganas. ${capitalize(pushClause)}; si sales, ponle un tope para ir tranquilo.`;
    }

    if (itemKind === "durable") {
      return noMarginBefore
        ? `Yo lo dejaría para después: ${pushClause}.${miniGoalSuffix(decision)}`
        : `Yo lo dejaría para después. ${capitalize(pushClause)}.${miniGoalSuffix(decision)}`;
    }

    // Unknown item: clean, varied default — never the same line twice.
    return pickVariant(
      [
        `Por ahora lo dejaría pasar. ${capitalize(pushClause)}.${miniGoalSuffix(decision)}`,
        `Hoy no lo haría: ${pushClause}. Más adelante lo ves con calma.${miniGoalSuffix(decision)}`,
      ],
      seed,
    );
  }

  if (decision.recommendation === "caution") {
    if (afterText && dailyText) {
      return `Puedes, pero te deja la semana apretada: te quedarían ${afterText} para esta semana, más o menos ${dailyText} por día.`;
    }
    return "Puedes, pero te deja la semana un poco apretada.";
  }

  // yes
  if (afterText && dailyText) {
    return `Sí, entra bien en tu semana. Si lo haces, te quedarían ${afterText} para esta semana, más o menos ${dailyText} por día.`;
  }
  return "Sí, entra en tu semana sin romperte el margen.";
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
  // Compare magnitudes too: a computed figure can be negative (e.g. a
  // weekly margin of -15) while the reply states it as "15$". Allowing the
  // absolute value is safe — every allowed number is one WE computed.
  return allowed.some(
    (a) =>
      Math.abs(value - a) <= AMOUNT_TOLERANCE ||
      Math.round(value) === Math.round(a) ||
      Math.round(Math.abs(value)) === Math.round(Math.abs(a)),
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
    decision.dailyRemainingBefore,
    decision.dailyRemainingAfter,
    decision.cashImpact,
    decision.debtImpact,
    // 0 is always safe to state ("yo pondría el tope en 0$"): it asserts the
    // absence of room, which can never misrepresent a real computed balance.
    0,
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
You are Kipu, a close, sharp, premium money coach for Latin American users — like a smart friend who is good with money, not a script. A deterministic engine already decided the recommendation and computed every number. You ONLY phrase the answer naturally. You never change the recommendation and never invent numbers. But within that, you write a REAL, specific reply — never a canned template.

Make every reply specific to THIS message. Adapt to:
- the item kind (itemKind) and what they actually asked (advisoryType + originalMessage),
- the amount vs how much room they have this week (weeklyRemainingBefore / weeklyRemainingAfter),
- whether their margin is already negative,
- the payment method,
- the recent conversation (recentMessages) for continuity.
Two different questions must NOT get the same sentence. Do not default to "Yo esperaría" on everything.

Shape:
- 1 to 3 short sentences, natural LatAm Spanish, warm and direct.
- Give a clear opinion + one concrete, specific reason tied to their numbers/situation.
- No guilt, no moralizing, no tables, no "como modelo de IA", no budgeting lecture.
- Money: "120$" / "96$" (sign after the number, drop decimals when whole). Per-day ("por día") is ALWAYS a whole number: "27$", never "26.67$".

Tone — honest, not punitive: the user must feel safe telling you anything, never judged. Inform, don't scold. Don't end every tight-week answer with "yo frenaría / cuidaría / evitaría gastos no esenciales"; those may appear occasionally, not as the default. Avoid artificial "AI" phrases ("con más aire") — say it plainly ("cuando tu semana esté más tranquila", "sin tocar tu margen de esta semana").

Need vs want — judge them differently:
- ESSENTIAL (medicina, salud, pastillas, comida básica, transporte necesario, trabajo, estudio, emergencia, "lo necesito"): do NOT treat it like a splurge. Approve the necessity calmly and just suggest keeping it to what's needed. e.g. "Si es medicina, va primero; cómprala sin culpa y solo evitamos sumarle extras esta semana."
- LOW-COST / SAVING intent ("para ahorrar", "lo más barato", "la opción barata", a small amount that avoids a bigger one): recognize it as a sensible, controlled choice — a cautious yes, not an automatic no. e.g. "Si es la opción barata para resolver el almuerzo, sí tiene sentido; mantén ese tope y evitamos extras."

How to vary by situation (guidance, not fixed phrases — rewrite in your own words each time):
- itemKind "durable" (zapatos, reloj, audífonos, mochila, ropa): it's a wishlist item. If blocked, you MAY suggest saving it as a mini-meta so they buy it without pressure.
- itemKind "consumable" (café, cena, sushi, antojo): NEVER suggest a mini-meta. If tight, suggest a lighter/cheaper version or a lower cap.
- itemKind "experience" (salir, finde, plan): NEVER a mini-meta. If tight, suggest going but with a spending cap.
- itemKind "subscription" (mensual, membresía): frame it as a recurring commitment that adds up monthly, not a one-time cost. NEVER a mini-meta.
- advisoryType "wait_or_buy" ("¿mejor lo dejo?", "¿espero?"): answer the WAIT decision directly ("sí, yo lo dejaría / no hace falta esperar"). Do NOT re-explain card mechanics unless they ask about the card.
- advisoryType "payment_method_comparison" ("¿y si lo pago con Visa?"): focus on the method trade-off.
- advisoryType "spending_check" / "general_money_question" with no amount: if there is room, give a safe range using weeklyRemainingBefore and dailyRemainingBefore (e.g. "algo cerca de X$ por día te deja respirar"), then ask the amount. If the margin is already negative, give a concrete boundary instead of a vague wait, e.g. "esta semana yo me quedaría cerca de 0$ en gastos no esenciales". If you don't know what the item is or how much it costs, ask before judging.

Vary the wording, especially on tight/negative weeks. Do NOT answer every blocked case with the same "te deja sin margen suficiente"/"yo esperaría" sentence — make the reason concrete and specific to the amount and item.

Hard rules (financial truth — never break):
- Use ONLY numbers present in "decision". Never state a different amount.
- recommendation "need_more_info" = the user gave NO price. Do NOT invent or imply a cost. Ask for the amount; you may cite weeklyRemainingBefore and dailyRemainingBefore.
- paymentMethodType "card": never say cash/efectivo went down and never say it has no impact. A card purchase does not lower cash today, it raises debt.
- recommendation "no"/"wait": do NOT encourage the purchase. Offer to wait, or (durable only) a mini-meta.
- recommendation "yes"/"caution": be honest about the margin it leaves.
- Negative margin (weeklyRemainingBefore <= 0, or the purchase makes weeklyRemainingAfter negative): NEVER print a negative number as "te quedan -15$". Instead frame it positively and concretely: the purchase "te empuja más fuera del margen" or "ya vienes sin margen y suma {amount}$ más". You MAY say "0$" as a cap. Treat any purchase as an exception, not part of the plan. Keep it human and short, not a repeated warning.

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
            itemKind: input.decision.itemKind,
            itemDescription: input.intent.itemDescription,
            decision: {
              recommendation: input.decision.recommendation,
              severity: input.decision.severity,
              reasonCodes: input.decision.reasonCodes,
              paymentMethodType: input.decision.paymentMethodType,
              itemKind: input.decision.itemKind,
              amount: input.decision.amount,
              weeklyRemainingBefore: input.decision.weeklyRemainingBefore,
              weeklyRemainingAfter: input.decision.weeklyRemainingAfter,
              dailyRemainingBefore: input.decision.dailyRemainingBefore,
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
  const fallbackMessage = buildAdvisoryFallbackResponse({
    decision: input.decision,
    advisoryType: input.intent.advisoryType,
    itemDescription: input.intent.itemDescription,
  });
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
