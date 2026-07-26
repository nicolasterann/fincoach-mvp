import OpenAI from "openai";
import type {
  AdvisoryIntent,
  AdvisoryRecentMessage,
  AdvisoryType,
} from "@/lib/ai/advisory-classifier";
import type { GoalPlanSummary } from "@/lib/ai/goal-aware-response-copy";
import type { AdvisoryDecision } from "@/lib/financial/advisory-decision-engine";
import { formatKipuMoney } from "@/lib/financial/money";
import type { CurrencyCode } from "@/types/financial";

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
  return formatKipuMoney(value, currency as CurrencyCode);
}

// Per-day amounts are always whole dollars in chat — "27$ por día", never
// "26.67$". Purchase and Saldo figures keep their natural precision.
function formatAdvisoryDaily(value: number, currency: string): string {
  return formatKipuMoney(Math.round(value), currency as CurrencyCode);
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
  amountOriginal?: number | null;
  originalCurrency?: CurrencyCode | null;
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
  const saldoBefore = decision.saldoBefore;
  const saldoAfter = decision.saldoAfter;
  const dailyRefill = decision.dailyRefill;
  const saldoImpact = decision.saldoImpact;
  const originalCurrency = input.originalCurrency ?? null;
  const originalAmount = input.amountOriginal ?? null;
  const amountText =
    amount !== null &&
    originalCurrency &&
    originalCurrency !== currency &&
    typeof originalAmount === "number" &&
    Number.isFinite(originalAmount)
      ? `${formatAdvisoryMoney(originalAmount, originalCurrency)} (≈ ${formatAdvisoryMoney(amount, currency)})`
      : amount !== null
        ? formatAdvisoryMoney(amount, currency)
        : "";
  const seed = amount;

  // No amount yet: ask for it, but give a USEFUL boundary, never a vague
  // "yo esperaría". Never imply a cost ("son X$").
  if (decision.recommendation === "need_more_info") {
    if (saldoBefore !== null && saldoBefore > 0) {
      if (dailyRefill !== null) {
        return `Tu Saldo actual es ${formatAdvisoryMoney(saldoBefore, currency)} y se recarga más o menos ${formatAdvisoryDaily(dailyRefill, currency)} al día. Dime el monto y te confirmo si entra.`;
      }
      return `Tu Saldo actual es ${formatAdvisoryMoney(saldoBefore, currency)}. Dime más o menos cuánto y te confirmo si entra.`;
    }
    // Already in the red: invite the amount / what it is (need vs want) and
    // give a calm boundary, not a scolding. A "0$" cap is allowed.
    return "Por ahora tu Saldo viene en cero, así que en gastos no esenciales me quedaría cerca de 0$. Dime el monto o qué es y te digo cómo acomodarlo sin apretarte más.";
  }

  const blocked =
    decision.recommendation === "no" || decision.recommendation === "wait";
  const debtIsIndependentCause =
    decision.reasonCodes.includes("debt_pressure_high") ||
    decision.reasonCodes.includes("debt_pressure_critical");
  const debtWaitClause = debtIsIndependentCause
    ? " La razón para esperar es que la deuda ya viene apretada; el cruce de capa solo te lo avisa."
    : "";
  const noSaldoBefore = saldoBefore !== null && saldoBefore <= 0;
  const hasSaldoImpact = saldoImpact !== null && saldoImpact > 0.005;
  const exceedsSaldo =
    hasSaldoImpact &&
    (noSaldoBefore ||
      (saldoBefore !== null && saldoImpact > saldoBefore));
  const afterText =
    saldoAfter !== null ? formatAdvisoryMoney(saldoAfter, currency) : "";
  const cardSaldoTail =
    decision.paymentMethodType !== "card"
      ? ""
      : exceedsSaldo
        ? " También supera tu Saldo y cruzaría a una capa protegida."
        : hasSaldoImpact && afterText
          ? ` Tu Saldo quedaría en ${afterText}.`
          : " Tu Saldo no cambia con esta compra.";

  // The reason clause ties the purchase to the current Saldo, phrased
  // positively and informatively (never as a punishment).
  const pushClause = exceedsSaldo
    ? amountText
      ? `${amountText} supera tu Saldo actual`
      : "supera tu Saldo actual"
    : amountText
      ? `${amountText} se lleva buena parte de tu Saldo`
      : "eso se lleva buena parte de tu Saldo";

  // The user is leaning toward waiting / asking "should I leave it?" — answer
  // that decision directly instead of re-explaining payment mechanics.
  if (advisoryType === "wait_or_buy" && blocked) {
    if (decision.paymentMethodType === "card") {
      return `Sí, yo lo dejaría para después. No baja tu efectivo hoy, pero sí sumaría deuda.${cardSaldoTail}${debtWaitClause}${miniGoalSuffix(decision)}`;
    }
    return `Sí, yo lo dejaría para después${amountText ? ` antes que soltar ${amountText} hoy` : ""}.${debtWaitClause || " El cruce de capa es solo una advertencia, no un bloqueo."}${miniGoalSuffix(decision)}`;
  }

  // Recurring/subscription: a monthly commitment that adds up — never a
  // one-off, never a mini-meta. Handled before card/cash so it also covers
  // the "caution" (not blocked) case.
  if (itemKind === "subscription") {
    const cardTail =
      decision.paymentMethodType === "card"
        ? " Con tarjeta no baja tu efectivo hoy, pero sí sube la deuda."
        : "";
    if (blocked) {
      return `Como es mensual, no lo trataría como gasto de una sola vez. ${amountText ? `${amountText} al mes` : "Eso"} se acumula; yo esperaría porque tu deuda ya viene apretada.${cardTail}${exceedsSaldo ? " El cruce de capa es una advertencia, no la razón para esperar." : ""}`;
    }
    if (exceedsSaldo) {
      return `Como es mensual, ${amountText ? `${amountText} al mes` : "eso"} se acumula y cruzaría una capa protegida. Puedes hacerlo; te lo aviso para que decidas sabiendo de dónde saldría.${cardTail}`;
    }
    return `Como es mensual, súmalo con cuidado: ${amountText ? `${amountText} al mes` : "eso"} se va acumulando. Si entra, que sea reemplazando otro gasto que ya tienes.${cardTail}`;
  }

  // Card path: never imply bank cash dropped today. The purchase still drains
  // Saldo because Saldo tracks the gusto, independently of payment method.
  if (decision.paymentMethodType === "card") {
    if (blocked) {
      return `Yo esperaría. Aunque con tarjeta no baja tu efectivo hoy, sí sube una deuda que ya viene apretada.${cardSaldoTail}${exceedsSaldo ? " El cruce de capa solo te lo avisa; no es lo que bloquea." : ""}${miniGoalSuffix(decision)}`;
    }
    if (advisoryType === "payment_method_comparison") {
      return `${amountText ? `Pagar ${amountText} con tarjeta` : "Pagarlo con tarjeta"} no baja tu efectivo hoy, pero sí sube la deuda.${cardSaldoTail} Yo la usaría solo si ya sabes con qué la vas a pagar.`;
    }
    return `${amountText ? `${amountText} con tarjeta` : "Con tarjeta"} no baja tu efectivo hoy, pero sí sube la deuda.${cardSaldoTail} Yo lo haría solo si ya tienes claro cómo pagarla.`;
  }

  // Cash path.
  if (blocked) {
    const independentReason = debtIsIndependentCause
      ? " La espera viene de la deuda apretada; cruzar de capa por sí solo no bloquea."
      : "";
    if (itemKind === "consumable") {
      return pickVariant(
        [
          `${capitalize(pushClause)}.${independentReason} Si te provoca algo, una versión más liviana te cuida sin apretarte.`,
          `Se entiende el antojo. ${capitalize(pushClause)}.${independentReason} Si vas, yo le pondría un tope más bajo.`,
        ],
        seed,
      );
    }

    if (itemKind === "experience") {
      return `Se entiende las ganas. ${capitalize(pushClause)}.${independentReason} Si sales, ponle un tope para ir tranquilo.`;
    }

    if (itemKind === "durable") {
      return noSaldoBefore
        ? `Yo lo dejaría para después: ${pushClause}.${independentReason}${miniGoalSuffix(decision)}`
        : `Yo lo dejaría para después. ${capitalize(pushClause)}.${independentReason}${miniGoalSuffix(decision)}`;
    }

    // Unknown item: clean, varied default — never the same line twice.
    return pickVariant(
      [
        `Por ahora lo dejaría pasar. ${capitalize(pushClause)}.${independentReason}${miniGoalSuffix(decision)}`,
        `Hoy no lo haría: ${pushClause}.${independentReason} Más adelante lo ves con calma.${miniGoalSuffix(decision)}`,
      ],
      seed,
    );
  }

  if (decision.recommendation === "caution") {
    if (exceedsSaldo) {
      return `${capitalize(pushClause)} y entraría en una capa protegida. Puedes hacerlo; te lo aviso para que decidas sabiendo de dónde saldría.`;
    }
    if (afterText) {
      return `Puedes${amountText ? ` gastar ${amountText}` : ""}, pero se lleva una parte importante: tu Saldo quedaría en ${afterText}.`;
    }
    return "Puedes, pero deja tu Saldo un poco apretado.";
  }

  // yes
  if (afterText) {
    return `Sí, ${amountText ? `${amountText} entra` : "entra"} en tu Saldo. Si lo haces, quedaría en ${afterText}.`;
  }
  return "Sí, entra en tu Saldo.";
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
  /(?<!no )(?<!nunca )baj[oa]\s+(?:tu\s+|el\s+)?(?:efectivo|cuenta|dinero)/,
  /(?<!no )(?<!nunca )sali[oa]\s+de\s+tu\s+cuenta/,
  /(?<!no )(?<!nunca )descont[oa]\s+de\s+(?:tu\s+)?cuenta/,
  /menos\s+efectivo\b/,
  /(?<!no )(?<!nunca )toc[oa]\s+tu\s+efectivo/,
];

const CARD_SALDO_UNCHANGED_PATTERNS: RegExp[] = [
  /\bsaldo\b.{0,30}\b(?:no\s+cambia|queda\s+igual|se\s+mantiene)\b/,
  /\bno\s+(?:te\s+)?baja\s+(?:tu\s+)?saldo\b/,
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

const LAYER_BLOCK_PATTERNS: RegExp[] = [
  /\bno\s+(?:lo|la|los|las)?\s*(?:compres|hagas)\b/,
  /\byo\s+(?:no\s+lo\s+haria|esperaria|lo\s+dejaria)\b/,
  /\bes\s+mejor\s+no\b/,
];

const DEBT_REASON_PATTERNS: RegExp[] = [
  /\bdeuda\b/,
  /\btarjeta\b/,
  /\binter[eé]s(?:es)?\b/,
  /\bpago(?:s)?\b/,
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

function extractCurrencyAmounts(
  message: string,
): Array<{ amount: number; currency: string }> {
  const amounts: Array<{ amount: number; currency: string }> = [];
  const currency =
    "usd|ars|eur|cop|clp|mxn|uyu|pen|brl|bob|pyg|dop|crc|gtq|hnl|nio|ves|cad|gbp|chf|jpy|cny|aud|nzd";
  const re =
    new RegExp(
      `(?:(${currency}|\\$)\\s*([\\d][\\d.,]*)|([\\d][\\d.,]*)\\s*(${currency}|\\$)(?![A-Za-z]))`,
      "gi",
    );
  let match: RegExpExecArray | null;
  while ((match = re.exec(message)) !== null) {
    const captured = match[2] ?? match[3];
    const parsed = parseLooseAmount(captured ?? "");
    const token = (match[1] ?? match[4] ?? "").toUpperCase();
    if (parsed !== null && token) amounts.push({ amount: parsed, currency: token });
  }
  return amounts;
}

const AMOUNT_TOLERANCE = 1;

function isAllowedAmount(value: number, allowed: number[]): boolean {
  // Compare magnitudes too: a computed figure can be negative (e.g. a
  // negative forward projection of -15) while the reply states it as "15$". Allowing the
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
  amountOriginal?: number | null;
  originalCurrency?: CurrencyCode | null;
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
    if (
      (decision.saldoImpact ?? 0) > 0 &&
      CARD_SALDO_UNCHANGED_PATTERNS.some((re) => re.test(normalized))
    ) {
      return { ok: false, reason: "card_saldo_unchanged_claim" };
    }
  }

  if (
    (decision.recommendation === "no" || decision.recommendation === "wait") &&
    ENCOURAGE_PATTERNS.some((re) => re.test(normalized))
  ) {
    return { ok: false, reason: "encourages_when_blocked" };
  }
  if (
    decision.reasonCodes.includes("crosses_saldo_layer") &&
    decision.recommendation !== "no" &&
    decision.recommendation !== "wait" &&
    LAYER_BLOCK_PATTERNS.some((re) => re.test(normalized))
  ) {
    return { ok: false, reason: "blocks_layer_crossing" };
  }
  if (
    decision.reasonCodes.includes("crosses_saldo_layer") &&
    (decision.recommendation === "no" ||
      decision.recommendation === "wait")
  ) {
    const hasIndependentDebtCause =
      decision.reasonCodes.includes("debt_pressure_high") ||
      decision.reasonCodes.includes("debt_pressure_critical");
    if (!hasIndependentDebtCause) {
      return { ok: false, reason: "layer_block_without_independent_reason" };
    }
    if (!DEBT_REASON_PATTERNS.some((re) => re.test(normalized))) {
      return { ok: false, reason: "missing_independent_debt_reason" };
    }
  }

  const allowedBaseAmounts = [
    decision.amount,
    decision.saldoBefore,
    decision.saldoAfter,
    decision.dailyRefill,
    decision.saldoImpact,
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
  for (const mention of mentioned) {
    const mentionedCurrency =
      mention.currency === "$"
        ? "USD"
        : mention.currency;
    const originalCurrency = input.originalCurrency?.toUpperCase() ?? null;
    if (
      originalCurrency &&
      originalCurrency !== decision.baseCurrency.toUpperCase() &&
      mentionedCurrency === originalCurrency
    ) {
      if (
        typeof input.amountOriginal !== "number" ||
        !Number.isFinite(input.amountOriginal) ||
        !isAllowedAmount(mention.amount, [input.amountOriginal, 0])
      ) {
        return { ok: false, reason: "foreign_amount" };
      }
      continue;
    }
    if (
      mentionedCurrency !== decision.baseCurrency.toUpperCase() ||
      !isAllowedAmount(mention.amount, allowedBaseAmounts)
    ) {
      return { ok: false, reason: "foreign_amount" };
    }
  }

  return { ok: true };
}

const ADVISORY_RESPONSE_SYSTEM_PROMPT = `
You are Kipu, a close, sharp, premium money coach for Latin American users — like a smart friend who is good with money, not a script. A deterministic engine already decided the recommendation and computed every number. You ONLY phrase the answer naturally. You never change the recommendation and never invent numbers. But within that, you write a REAL, specific reply — never a canned template.

Make every reply specific to THIS message. Adapt to:
- the item kind (itemKind) and what they actually asked (advisoryType + originalMessage),
- the amount vs their current Saldo (saldoBefore / saldoAfter),
- whether the purchase exceeds that Saldo,
- the payment method,
- the recent conversation (recentMessages) for continuity.
Two different questions must NOT get the same sentence. Do not default to "Yo esperaría" on everything.

Shape:
- 1 to 3 short sentences, natural LatAm Spanish, warm and direct.
- Give a clear opinion + one concrete, specific reason tied to their numbers/situation.
- No guilt, no moralizing, no tables, no "como modelo de IA", no budgeting lecture.
- Money: "120$" / "96$" (sign after the number, drop decimals when whole). Per-day ("por día") is ALWAYS a whole number: "27$", never "26.67$".

Tone — honest, not punitive: the user must feel safe telling you anything, never judged. Inform, don't scold. Don't end every tight answer with "yo frenaría / cuidaría / evitaría gastos no esenciales"; those may appear occasionally, not as the default.

Need vs want — judge them differently:
- ESSENTIAL (medicina, salud, pastillas, comida básica, transporte necesario, trabajo, estudio, emergencia, "lo necesito"): do NOT treat it like a splurge. Approve the necessity calmly and just suggest keeping it to what's needed.
- LOW-COST / SAVING intent ("para ahorrar", "lo más barato", "la opción barata", a small amount that avoids a bigger one): recognize it as a sensible, controlled choice — a cautious yes, not an automatic no. e.g. "Si es la opción barata para resolver el almuerzo, sí tiene sentido; mantén ese tope y evitamos extras."

How to vary by situation (guidance, not fixed phrases — rewrite in your own words each time):
- itemKind "durable" (zapatos, reloj, audífonos, mochila, ropa): it's a wishlist item. If blocked, you MAY suggest saving it as a mini-meta so they buy it without pressure.
- itemKind "consumable" (café, cena, sushi, antojo): NEVER suggest a mini-meta. If tight, suggest a lighter/cheaper version or a lower cap.
- itemKind "experience" (salir, finde, plan): NEVER a mini-meta. If tight, suggest going but with a spending cap.
- itemKind "subscription" (mensual, membresía): frame it as a recurring commitment that adds up monthly, not a one-time cost. NEVER a mini-meta.
- advisoryType "wait_or_buy" ("¿mejor lo dejo?", "¿espero?"): answer the WAIT decision directly ("sí, yo lo dejaría / no hace falta esperar"). Do NOT re-explain card mechanics unless they ask about the card.
- advisoryType "payment_method_comparison" ("¿y si lo pago con Visa?"): focus on the method trade-off.
- advisoryType "spending_check" / "general_money_question" with no amount: state saldoBefore and dailyRefill, then ask the amount. If Saldo is zero, say so calmly. If you don't know what the item is or how much it costs, ask before judging.

Vary the wording, especially when the Saldo is low. Do NOT answer every blocked case with the same sentence — make the reason concrete and specific to the amount and item.

Hard rules (financial truth — never break):
- Use ONLY numbers present in "decision". Never state a different amount.
- quotedAmount/quotedCurrency are the price exactly as the user stated it. When they differ from decision.amount/baseCurrency, keep the quoted price visible and add the base equivalent; do not silently rename 33.000 ARS as 33 USD.
- recommendation "need_more_info" = the user gave NO price. Do NOT invent or imply a cost. Ask for the amount; you may cite saldoBefore and dailyRefill.
- paymentMethodType "card": never say bank cash/efectivo went down and never say it has no impact. A card purchase does not lower bank cash today; it lowers Saldo by saldoImpact and raises debt.
- A card purchase still drains saldoImpact from Saldo: Saldo tracks the gusto, not the bank account. Use saldoAfter for the resulting Saldo.
- recommendation "no"/"wait": do NOT encourage the purchase. Offer to wait, or (durable only) a mini-meta.
- recommendation "yes"/"caution": be honest about the Saldo it leaves.
- Zero/exceeded Saldo: NEVER print a negative number. Say the purchase exceeds the current Saldo and would cross into the next protected layer. Keep it human and short, not a repeated warning.
- Crossing a protected layer WARNS but never blocks. Use recommendation "caution" as a transparent warning; do not turn it into a hard prohibition.
- If a crossed layer comes with recommendation "wait"/"no", state the INDEPENDENT reason (debt pressure / payment pressure) explicitly. Never make the layer crossing sound like the reason for waiting.

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
            quotedAmount: input.intent.amount,
            quotedCurrency: input.intent.currency,
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
              saldoBefore: input.decision.saldoBefore,
              saldoAfter: input.decision.saldoAfter,
              dailyRefill: input.decision.dailyRefill,
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
    amountOriginal: input.intent.amount,
    originalCurrency: input.intent.currency,
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
      amountOriginal: input.intent.amount,
      originalCurrency: input.intent.currency,
    });
    if (validation.ok) return aiResult;
  }

  return fallback;
}
