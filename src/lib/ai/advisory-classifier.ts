import OpenAI from "openai";

// Advisory classification. The user is NOT logging a movement — they are
// asking Kipu whether to spend, which method to use, or whether to wait.
//
// Two layers, deterministic-first:
//   1. detectAdvisoryCandidate(): a cheap, coarse gate. It only fires on
//      recognizable advisory intent families (purchase decision, spending
//      check, payment-method comparison, wait-or-buy). A normal logging
//      message like "cafe 3 pichincha" never matches, so the transaction
//      pipeline is never hijacked.
//   2. classifyAdvisoryWithAI(): when AI interpretation is enabled, the
//      model reads the flexible natural language (typos, synonyms,
//      references like "y si lo pago con Visa") and returns a structured
//      intent. It NEVER writes to the DB and NEVER decides money truth.
//
// The deterministic gate is intentionally a family-level classifier, not
// an exhaustive phrase list — the AI does the heavy interpretation when
// enabled, and the deterministic extraction is a safe fallback.

export type AdvisoryType =
  | "purchase_decision"
  | "spending_check"
  | "payment_method_comparison"
  | "wait_or_buy"
  | "general_money_question"
  | "unknown";

export type AdvisoryPaymentMethodMentioned =
  | "cash_account"
  | "card"
  | "unknown"
  | null;

export interface AdvisoryIntent {
  isAdvisory: boolean;
  advisoryType: AdvisoryType;
  itemDescription: string | null;
  amount: number | null;
  currency: "USD" | null;
  paymentMethodMentioned: AdvisoryPaymentMethodMentioned;
  mentionedAccountOrCardName: string | null;
  referencesPreviousTopic: boolean;
  needsMoreInfo: boolean;
  missingInfo: string[];
  confidence: number;
}

export interface AdvisoryCandidate {
  intent: AdvisoryIntent;
}

export interface AdvisoryRecentMessage {
  role: "user" | "assistant" | "system";
  content: string;
  // Optional persisted message kind ("advisory", "transaction", …). When
  // present it lets us recognize that the previous assistant turn was an
  // advisory amount prompt, so a bare "Unos $25" reply is treated as a
  // follow-up rather than a new transaction.
  messageType?: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

const PURCHASE_DECISION_PATTERNS: RegExp[] = [
  /\bdeber[ia]a?\s+(?:comprar|gastar|pagar|llevar|adquirir)/,
  /\bvale\s+la\s+pena\b/,
  /\bme\s+conviene\b/,
  /\bconviene\s+(?:comprar|gastar|pagar)/,
  /\bcrees\s+que\s+(?:deber|compr|gast|pag)/,
  /\bque\s+opinas\b/,
  /\bme\s+lo\s+(?:compro|llevo)\b/,
  /\blo\s+compro\s*\?/,
];

const SPENDING_CHECK_PATTERNS: RegExp[] = [
  /\bpuedo\s+(?:gastar|comprar|permitirme|darme|sacar)/,
  /\bme\s+alcanza\b/,
  // Natural "how am I doing / what's left" phrasings a beta user actually types.
  /\b(?:cuanto|que)\s+(?:me\s+)?queda\b/,
  /\bcomo\s+voy\b/,
  /\bcomo\s+vamos\b/,
  /\bestoy\s+bien\s+(?:de|con)\s+(?:plata|dinero|presupuesto)\b/,
  /\bllego\s+a\s+fin\s+de\s+mes\b/,
  /\bcuanto\s+tengo\s+(?:libre|disponible)\b/,
  /\bme\s+da\b[^?]*\bpara\b/,
  /\bse\s+ajusta\b/,
  /\bentra\s+en\s+(?:mi|el|la)\s+(?:semana|presupuesto|plan)/,
  /\bpuedo\s+salir\s+a\s+(?:comer|cenar|almorzar|tomar)/,
  /\btengo\s+para\b/,
  /\balcanza\s+para\b/,
];

const PAYMENT_METHOD_PATTERNS: RegExp[] = [
  /\by\s+si\s+(?:lo\s+)?(?:pago|compro|uso|cargo)/,
  /\bsi\s+(?:lo\s+)?pago\s+con\b/,
  /\bmejor\s+(?:con|pago\s+con|lo\s+pago\s+con)\b/,
  /\bcon\s+(?:la\s+)?(?:tarjeta|visa|mastercard|credito|debito|diners)\b[^?]*\?/,
];

const WAIT_OR_BUY_PATTERNS: RegExp[] = [
  /\bmejor\s+espero\b/,
  /\bme\s+espero\b/,
  /\bespero\s+o\s+(?:lo\s+)?compro/,
  /\b(?:lo\s+)?compro\s+(?:ahora|ya)\b/,
  /\bahora\s+o\s+(?:despues|mas\s+tarde)/,
  /\bvale\s+la\s+pena\s+esperar/,
];

const CARD_WORDS = /\b(?:tarjeta|visa|mastercard|credito|debito|diners|amex)\b/;
const CASH_WORDS = /\b(?:efectivo|en\s+cuenta|de\s+la\s+cuenta|debito)\b/;

// Explicit back-reference cues: the user points at an item discussed in
// an earlier turn ("y si lo pago", "ese reloj", "lo compro") without
// restating it. These decide when it is safe to recover the previous
// amount from chat history — a fresh question like "¿puedo salir a comer
// hoy?" carries no such cue and must NOT borrow a stale number.
const PREVIOUS_TOPIC_CUE_PATTERNS: RegExp[] = [
  /\by\s+si\s+(?:lo|la|los|las|eso|esto)\b/,
  /\b(?:lo|la|los|las)\s+(?:pago|compro|llevo|cargo|saco|adquiero|dejo)\b/,
  /\bme\s+(?:lo|la)\s+(?:compro|llevo|quedo)\b/,
  /\bcomprarl[oa]\b/,
  /\b(?:ese|esa|eso|esos|esas)\b/,
  /\bmejor\s+(?:espero|lo\s+dejo)\b/,
  /\bme\s+espero\b/,
  /\bvale\s+la\s+pena\s+esperar\b/,
];

// Phrases an assistant uses when it has asked the user for a spending
// amount in an advisory turn ("me falta el monto", "¿cuánto quieres
// gastar?", "dime el monto"). Used to recognize that a bare "Unos $25"
// reply is the answer to that question, not a new movement to log.
const ADVISORY_AMOUNT_PROMPT_PATTERNS: RegExp[] = [
  /me\s+falta\s+el\s+monto/,
  /(?:dime|dame|pasame|mandame|escribeme|ponme)\s+(?:el\s+)?monto/,
  /(?:dime|dame|pasame|mandame)\s+cuanto/,
  /cuanto\s+(?:quieres|quieras|piensas|pensabas|vas\s+a|querias)\s+gastar/,
  /necesito\s+(?:saber\s+)?(?:el\s+)?monto/,
  /(?:que|cual)\s+(?:es\s+)?(?:el\s+)?monto/,
];

// Hedging fillers that may surround a bare amount in a follow-up reply
// ("unos 25", "más o menos 25", "serían 25 dólares"). If a short message
// is nothing but ONE amount plus these words, it is an amount-only reply.
const AMOUNT_FOLLOW_UP_FILLERS = new Set([
  "unos",
  "unas",
  "uno",
  "una",
  "como",
  "tipo",
  "casi",
  "aprox",
  "aproximadamente",
  "alrededor",
  "cerca",
  "mas",
  "menos",
  "o",
  "de",
  "y",
  "serian",
  "seria",
  "seran",
  "sera",
  "son",
  "es",
  "tal",
  "vez",
  "talvez",
  "quiza",
  "quizas",
  "creo",
  "que",
  "pues",
  "bueno",
  "este",
  "ponle",
  "digamos",
  "asi",
  "dolares",
  "dolar",
  "usd",
  "pesos",
  "peso",
  "lucas",
  "verdes",
]);

function matchesAny(normalized: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(normalized));
}

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
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Best-effort: pick the first plausible money amount in the message.
// Prefers a number that follows a money cue (de / $ / por / cuesta /
// vale) but falls back to the first standalone number.
function extractAmount(normalized: string): number | null {
  const cued =
    /(?:\$\s*|usd\s*|de\s+|por\s+|cuesta\s+|vale\s+|sale\s+)(\d[\d.,]*)/.exec(
      normalized,
    );
  if (cued) {
    const parsed = parseLooseAmount(cued[1]);
    if (parsed !== null) return parsed;
  }
  const any = /\b(\d[\d.,]*)\b/.exec(normalized);
  if (any) {
    const parsed = parseLooseAmount(any[1]);
    if (parsed !== null) return parsed;
  }
  return null;
}

// Best-effort item label, used as AI context only — never a money value.
function extractItem(normalized: string): string | null {
  const m =
    /\b(?:comprar|compro|llevar|el|este|esta|ese|esa|un|una)\s+([a-z]{3,}(?:\s+[a-z]{3,})?)/.exec(
      normalized,
    );
  if (!m) return null;
  const candidate = m[1].trim();
  const stop = new Set([
    "para",
    "con",
    "que",
    "pago",
    "esta",
    "este",
    "semana",
    "plan",
    "mejor",
    "ahora",
  ]);
  const first = candidate.split(/\s+/)[0];
  if (stop.has(first)) return null;
  return candidate;
}

function detectPaymentMethod(normalized: string): {
  method: AdvisoryPaymentMethodMentioned;
  name: string | null;
} {
  const cardMatch = CARD_WORDS.exec(normalized);
  if (cardMatch) {
    return { method: "card", name: cardMatch[0] };
  }
  if (CASH_WORDS.test(normalized)) {
    return { method: "cash_account", name: null };
  }
  // A named source after "con" (e.g. "con pichincha") — leave the method
  // unknown and let the handler resolve the name against real accounts.
  const named = /\bcon\s+([a-z]{3,})/.exec(normalized);
  if (named && named[1] !== "la" && named[1] !== "el") {
    return { method: "unknown", name: named[1] };
  }
  return { method: null, name: null };
}

// Deterministic gate. Returns null when the message is NOT advisory
// territory (so the transaction pipeline runs untouched).
export function detectAdvisoryCandidate(
  message: string,
): AdvisoryCandidate | null {
  const normalized = normalize(message);
  if (!normalized) return null;

  const isPaymentMethod = matchesAny(normalized, PAYMENT_METHOD_PATTERNS);
  const isWaitOrBuy = matchesAny(normalized, WAIT_OR_BUY_PATTERNS);
  const isPurchase = matchesAny(normalized, PURCHASE_DECISION_PATTERNS);
  const isSpendingCheck = matchesAny(normalized, SPENDING_CHECK_PATTERNS);

  if (!isPaymentMethod && !isWaitOrBuy && !isPurchase && !isSpendingCheck) {
    return null;
  }

  // Priority chooses the dominant family when several match.
  const advisoryType: AdvisoryType = isPaymentMethod
    ? "payment_method_comparison"
    : isWaitOrBuy
      ? "wait_or_buy"
      : isPurchase
        ? "purchase_decision"
        : "spending_check";

  const amount = extractAmount(normalized);
  const item = extractItem(normalized);
  const { method, name } = detectPaymentMethod(normalized);

  // We only treat a message as referencing the previous topic when it
  // lacks its own amount AND either belongs to a follow-up family
  // (payment-method / wait-or-buy) or carries an explicit back-reference
  // cue. This is the gate the handler uses before recovering an amount
  // from chat history, so a fresh amount-less question never inherits an
  // old number.
  const referencesPreviousTopic =
    amount === null &&
    (advisoryType === "payment_method_comparison" ||
      advisoryType === "wait_or_buy" ||
      matchesAny(normalized, PREVIOUS_TOPIC_CUE_PATTERNS));

  const missingInfo: string[] = [];
  if (amount === null) missingInfo.push("amount");

  return {
    intent: {
      isAdvisory: true,
      advisoryType,
      itemDescription: item,
      amount,
      currency: amount !== null ? "USD" : null,
      paymentMethodMentioned: method,
      mentionedAccountOrCardName: name,
      referencesPreviousTopic,
      needsMoreInfo: amount === null,
      missingInfo,
      confidence: 0.6,
    },
  };
}

// Scan recent chat turns (newest first) for the last money amount the
// user discussed, so a follow-up like "¿y si lo pago con Visa?" can
// recover the "reloj de 120" from the previous turn. Chat history is
// context for continuity ONLY — never financial truth.
export function recoverFromRecentMessages(
  messages: AdvisoryRecentMessage[],
): { amount: number | null; itemDescription: string | null } | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const normalized = normalize(messages[i].content);
    const amount = extractAmount(normalized);
    if (amount !== null) {
      return { amount, itemDescription: extractItem(normalized) };
    }
  }
  return null;
}

// True when the most recent assistant turn asked the user for a spending
// amount as part of an advisory answer (e.g. "…me falta el monto; pásame
// cuánto quieres gastar"). Lets the handler treat a short "Unos $25" reply
// as the answer to that question instead of a new transaction. Only the
// latest assistant turn counts — older chatter must not keep the door open.
export function lastAssistantAskedForAdvisoryAmount(
  messages: AdvisoryRecentMessage[],
): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const normalized = normalize(msg.content);
    if (matchesAny(normalized, ADVISORY_AMOUNT_PROMPT_PATTERNS)) return true;
    // A turn we persisted as advisory that still talks about an amount is
    // enough on its own; non-advisory turns require the explicit phrase.
    if (
      msg.messageType === "advisory" &&
      (/\bmonto\b/.test(normalized) || /\bcuanto\b[^?]*\bgastar\b/.test(normalized))
    ) {
      return true;
    }
    return false;
  }
  return false;
}

// Detect a short reply that is essentially just an amount, possibly
// wrapped in hedging fillers and a currency word: "25", "$25", "unos 25",
// "más o menos 25", "serían 25 dólares". Returns the amount, or null when
// the message carries real content (an item, a verb, a payment method, or
// a second number) that would make it a normal message rather than a bare
// amount answer.
export function parseAmountOnlyFollowUp(message: string): number | null {
  const normalized = normalize(message).replace(/\$/g, " ");
  if (!normalized) return null;

  const tokens = normalized
    .split(/\s+/)
    .map((t) => t.replace(/[.,;:!?]+$/g, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0 || tokens.length > 6) return null;

  let amount: number | null = null;
  for (const token of tokens) {
    if (/^\d[\d.,]*$/.test(token)) {
      const numeric = parseLooseAmount(token);
      if (numeric === null) return null;
      if (amount !== null) return null; // more than one number → not bare
      amount = numeric;
      continue;
    }
    if (!AMOUNT_FOLLOW_UP_FILLERS.has(token)) return null;
  }

  return amount;
}

export function advisoryAiEnabled(): boolean {
  return (process.env.TRANSACTION_PARSER_MODE ?? "basic") !== "basic";
}

const ADVISORY_CLASSIFIER_SYSTEM_PROMPT = `
You read ONE user message to Kipu, a personal money coach, plus recent chat turns for context. Decide whether the user is asking for ADVICE about spending (NOT logging a movement) and extract structured fields.

Advisory = the user asks whether to buy something, whether they can afford it, which payment method to use, or whether to wait. Examples: "¿debería comprar este reloj de 120?", "¿me alcanza para salir a comer?", "¿y si lo pago con Visa?", "¿mejor espero?", "¿se ajusta a mi semana?".

NOT advisory (these are movement logging, return isAdvisory=false): "cafe 3 pichincha", "almuerzo 8 visa", "me pagaron 100 en pichincha", "pagué 35 de visa desde pichincha", "internet 25 pichincha".

Rules:
- You ONLY classify and extract. You NEVER decide what is affordable, never invent amounts, and never write anything financial.
- If the message references an earlier item without restating it ("y si lo pago con visa", "y eso?", "mejor espero", "lo compro?", "ese reloj"), set referencesPreviousTopic=true and use recent chat turns to fill itemDescription/amount when clearly present there. If still unknown, leave them null.
- A fresh, generic question that does NOT point back at a specific earlier item ("¿puedo salir a comer hoy?", "¿puedo comprar algo hoy?", "¿puedo salir?") is NOT a back-reference: set referencesPreviousTopic=false, leave amount null, and do NOT borrow an amount from earlier turns. Never invent an amount the user did not give.
- paymentMethodMentioned: "card" if a credit/debit card is named, "cash_account" if cash/an account is named, "unknown" if a source is named you cannot classify, null if none.
- Respond with STRICT JSON only, no prose:
{"isAdvisory": boolean, "advisoryType": "purchase_decision"|"spending_check"|"payment_method_comparison"|"wait_or_buy"|"general_money_question"|"unknown", "itemDescription": string|null, "amount": number|null, "currency": "USD"|null, "paymentMethodMentioned": "cash_account"|"card"|"unknown"|null, "mentionedAccountOrCardName": string|null, "referencesPreviousTopic": boolean, "needsMoreInfo": boolean, "missingInfo": string[], "confidence": number}
- confidence is your certainty 0..1. Use below 0.75 when genuinely ambiguous.
`;

const ADVISORY_TYPES: AdvisoryType[] = [
  "purchase_decision",
  "spending_check",
  "payment_method_comparison",
  "wait_or_buy",
  "general_money_question",
  "unknown",
];

function lowConfidenceIntent(): AdvisoryIntent {
  return {
    isAdvisory: false,
    advisoryType: "unknown",
    itemDescription: null,
    amount: null,
    currency: null,
    paymentMethodMentioned: null,
    mentionedAccountOrCardName: null,
    referencesPreviousTopic: false,
    needsMoreInfo: true,
    missingInfo: [],
    confidence: 0,
  };
}

export async function classifyAdvisoryWithAI(input: {
  message: string;
  recentMessages: AdvisoryRecentMessage[];
}): Promise<AdvisoryIntent> {
  if (!advisoryAiEnabled()) return lowConfidenceIntent();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return lowConfidenceIntent();

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_TRANSACTION_PARSER_MODEL ?? "gpt-5.4-mini";

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ADVISORY_CLASSIFIER_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            message: input.message,
            recentMessages: input.recentMessages.slice(-10),
          }),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return lowConfidenceIntent();

    const parsed = JSON.parse(content) as Record<string, unknown>;

    const advisoryType: AdvisoryType =
      typeof parsed.advisoryType === "string" &&
      ADVISORY_TYPES.includes(parsed.advisoryType as AdvisoryType)
        ? (parsed.advisoryType as AdvisoryType)
        : "unknown";

    const amount =
      typeof parsed.amount === "number" && Number.isFinite(parsed.amount)
        ? parsed.amount
        : null;

    const method = parsed.paymentMethodMentioned;
    const paymentMethodMentioned: AdvisoryPaymentMethodMentioned =
      method === "card" || method === "cash_account" || method === "unknown"
        ? method
        : null;

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0;

    return {
      isAdvisory: parsed.isAdvisory === true,
      advisoryType,
      itemDescription:
        typeof parsed.itemDescription === "string" && parsed.itemDescription
          ? parsed.itemDescription
          : null,
      amount,
      currency: amount !== null ? "USD" : null,
      paymentMethodMentioned,
      mentionedAccountOrCardName:
        typeof parsed.mentionedAccountOrCardName === "string" &&
        parsed.mentionedAccountOrCardName
          ? parsed.mentionedAccountOrCardName
          : null,
      referencesPreviousTopic: parsed.referencesPreviousTopic === true,
      needsMoreInfo: parsed.needsMoreInfo === true || amount === null,
      missingInfo: Array.isArray(parsed.missingInfo)
        ? parsed.missingInfo.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      confidence,
    };
  } catch {
    return lowConfidenceIntent();
  }
}

// Merge an AI-refined intent over the deterministic baseline. The AI is
// preferred where it provides a value; deterministic fields fill gaps so
// we never lose a number the regex already found.
export function mergeAdvisoryIntents(
  base: AdvisoryIntent,
  ai: AdvisoryIntent,
): AdvisoryIntent {
  const amount = ai.amount ?? base.amount;
  return {
    isAdvisory: ai.isAdvisory,
    advisoryType:
      ai.advisoryType !== "unknown" ? ai.advisoryType : base.advisoryType,
    itemDescription: ai.itemDescription ?? base.itemDescription,
    amount,
    currency: amount !== null ? "USD" : null,
    paymentMethodMentioned:
      ai.paymentMethodMentioned ?? base.paymentMethodMentioned,
    mentionedAccountOrCardName:
      ai.mentionedAccountOrCardName ?? base.mentionedAccountOrCardName,
    referencesPreviousTopic:
      ai.referencesPreviousTopic || base.referencesPreviousTopic,
    needsMoreInfo: amount === null,
    missingInfo: amount === null ? ["amount"] : [],
    confidence: ai.confidence,
  };
}
