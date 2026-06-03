import OpenAI from "openai";
import type { AdvisoryRecentMessage } from "@/lib/ai/advisory-classifier";

// Universal AI Message Router — the flexible first interpreter for chat /
// Telegram. Its job is to read ONE user message (plus recent chat turns and
// the user's known account / card / goal / fixed-expense names) and decide
// what KIND of message it is, so Kipu feels like an intelligent coach rather
// than a rigid bot that only answers messages matching a narrow regex gate.
//
// CRITICAL SAFETY BOUNDARY: this module may ONLY classify and extract loose
// hints. It NEVER writes to the database, NEVER mutates balances, and NEVER
// decides that an unsafe action is safe. Every financial write still goes
// through the deterministic pipeline (parser → guards → applyChatTransaction
// Intent). Transaction-shaped messages are deliberately routed back to that
// pipeline; the router never short-circuits a movement into existence.
//
// Gating: enabled only when TRANSACTION_PARSER_MODE is not "basic" (the same
// flag that turns on AI interpretation everywhere else). In the deterministic
// production default the router is OFF and chat behaviour is unchanged.

export type UniversalRoute =
  | "transaction_log"
  | "advisory_question"
  | "pending_reply"
  | "transaction_correction_or_undo"
  | "unsupported_action"
  | "general_financial_question"
  | "general_chat"
  | "unclear";

export type UniversalAdvisoryType =
  | "purchase_decision"
  | "spending_check"
  | "payment_method_comparison"
  | "wait_or_buy"
  | "subscription_decision"
  | "general_money_question"
  | "unknown";

export type UniversalPaymentMethodMentioned =
  | "cash_account"
  | "card"
  | "unknown"
  | null;

// Loose hints only. The transaction parser re-derives the real intent; these
// fields are never trusted as financial truth.
export interface UniversalTransactionCandidate {
  description: string | null;
  amount: number | null;
  currency: "USD" | null;
  paymentMethodMentioned: UniversalPaymentMethodMentioned;
  mentionedAccountOrCardName: string | null;
}

export interface UniversalAdvisoryCandidate {
  advisoryType: UniversalAdvisoryType;
  itemDescription: string | null;
  amount: number | null;
  currency: "USD" | null;
  paymentMethodMentioned: UniversalPaymentMethodMentioned;
  mentionedAccountOrCardName: string | null;
  referencesPreviousTopic: boolean;
}

export interface UniversalMessageRoute {
  route: UniversalRoute;
  confidence: number;
  reason: string;
  transactionCandidate?: UniversalTransactionCandidate;
  advisoryCandidate?: UniversalAdvisoryCandidate;
  unsupportedReason?: string;
  needsClarification?: boolean;
  clarificationQuestion?: string;
}

export interface UniversalMessageRouterInput {
  message: string;
  recentMessages: AdvisoryRecentMessage[];
  accountNames: string[];
  debtNames: string[];
  goalNames: string[];
  fixedExpenseNames: string[];
  hasPendingClarification: boolean;
}

export function universalRouterEnabled(): boolean {
  return (process.env.TRANSACTION_PARSER_MODE ?? "basic") !== "basic";
}

const ROUTES: UniversalRoute[] = [
  "transaction_log",
  "advisory_question",
  "pending_reply",
  "transaction_correction_or_undo",
  "unsupported_action",
  "general_financial_question",
  "general_chat",
  "unclear",
];

const ADVISORY_TYPES: UniversalAdvisoryType[] = [
  "purchase_decision",
  "spending_check",
  "payment_method_comparison",
  "wait_or_buy",
  "subscription_decision",
  "general_money_question",
  "unknown",
];

function clampConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
}

function positiveAmountOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function usdOrNull(value: unknown): "USD" | null {
  return value === "USD" ? "USD" : null;
}

function boundedString(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function paymentMethodOrNull(value: unknown): UniversalPaymentMethodMentioned {
  return value === "card" || value === "cash_account" || value === "unknown"
    ? value
    : null;
}

function unclearRoute(reason: string): UniversalMessageRoute {
  return { route: "unclear", confidence: 0, reason };
}

// Sanitize and bound everything the model returns. Unknown routes collapse to
// "unclear", amounts that are not positive numbers become null, currency is
// forced to USD-or-null, and strings are trimmed/length-capped. This is the
// safety wall: nothing downstream ever sees raw model JSON.
function sanitizeRoute(parsed: Record<string, unknown>): UniversalMessageRoute {
  const route: UniversalRoute =
    typeof parsed.route === "string" &&
    ROUTES.includes(parsed.route as UniversalRoute)
      ? (parsed.route as UniversalRoute)
      : "unclear";

  const result: UniversalMessageRoute = {
    route,
    confidence: clampConfidence(parsed.confidence),
    reason: boundedString(parsed.reason, 200) ?? "",
  };

  const tc = parsed.transactionCandidate;
  if (tc && typeof tc === "object") {
    const obj = tc as Record<string, unknown>;
    const amount = positiveAmountOrNull(obj.amount);
    result.transactionCandidate = {
      description: boundedString(obj.description),
      amount,
      currency: amount !== null ? "USD" : usdOrNull(obj.currency),
      paymentMethodMentioned: paymentMethodOrNull(obj.paymentMethodMentioned),
      mentionedAccountOrCardName: boundedString(obj.mentionedAccountOrCardName),
    };
  }

  const ac = parsed.advisoryCandidate;
  if (ac && typeof ac === "object") {
    const obj = ac as Record<string, unknown>;
    const amount = positiveAmountOrNull(obj.amount);
    result.advisoryCandidate = {
      advisoryType:
        typeof obj.advisoryType === "string" &&
        ADVISORY_TYPES.includes(obj.advisoryType as UniversalAdvisoryType)
          ? (obj.advisoryType as UniversalAdvisoryType)
          : "unknown",
      itemDescription: boundedString(obj.itemDescription),
      amount,
      currency: amount !== null ? "USD" : usdOrNull(obj.currency),
      paymentMethodMentioned: paymentMethodOrNull(obj.paymentMethodMentioned),
      mentionedAccountOrCardName: boundedString(obj.mentionedAccountOrCardName),
      referencesPreviousTopic: obj.referencesPreviousTopic === true,
    };
  }

  const unsupportedReason = boundedString(parsed.unsupportedReason, 200);
  if (unsupportedReason) result.unsupportedReason = unsupportedReason;

  if (parsed.needsClarification === true) result.needsClarification = true;

  const clarificationQuestion = boundedString(parsed.clarificationQuestion, 300);
  if (clarificationQuestion) result.clarificationQuestion = clarificationQuestion;

  return result;
}

const UNIVERSAL_ROUTER_SYSTEM_PROMPT = `
You are the message router for Kipu, a close, playful, premium money coach for Latin American users (web chat + Telegram). You read ONE user message plus recent chat turns and the user's known account / card / goal / fixed-expense names, and you decide what KIND of message it is.

You ONLY classify and extract loose hints. You NEVER write data, NEVER move money, NEVER decide what is affordable, and NEVER decide that an unsafe action is safe. Deterministic code validates and executes everything after you. Do not be a rigid bot: interpret natural, messy, LatAm Spanish — typos, slang, hedging — and pick the best route. Never reply with prose; return STRICT JSON only.

Pick EXACTLY ONE route:

- "transaction_log": the user is telling you about a real movement that already happened and should be recorded. Shapes: "<thing> <amount> <account/card>", "pagué <amount> de <card> desde <account>", "me pagaron <amount> a <account>", "aporté <amount> a <goal>". Examples → transaction_log: "café 3 pichincha", "almuerzo 8 visa", "café 30 pichincha", "internet 25 pichincha", "me pagaron 100 en pichincha", "pagué 35 de visa desde pichincha".

- "advisory_question": the user is asking for an opinion/decision about ONE specific purchase — should I buy this thing, can I afford this item, which method for it, should I wait on it, does this purchase break my week. There is a single item or a single amount in play. Examples → advisory_question: "¿debería comprar este reloj de 120?", "¿me alcanza para salir a comer?", "Estoy pensando comprar unos zapatos de 90, ¿cómo lo ves?", "¿Comprar una cena de 60 me rompe la semana?", "Qué tan buena idea sería comprar una suscripción de $40 al mes?", "¿Me conviene gastar 30 en café esta semana?", "Estoy pensando comprar café de 30, ¿cómo lo ves?", "¿y si lo pago con Visa?", "¿mejor espero?".
  - subscription_decision is for recurring/subscription purchase opinions ("¿vale la pena una suscripción de 40 al mes?").
  - If the message references an earlier item without restating it ("¿y si lo pago con visa?", "¿mejor espero?", "ese reloj"), set referencesPreviousTopic=true and, only when clearly present in recent turns, fill itemDescription/amount. Otherwise leave them null. NEVER invent an amount the user did not give.

- "general_financial_question": the DEFAULT for any read-only money message that is broader than a single-item purchase check. The user is reflecting, comparing, worrying, or asking what to do — not logging anything and not deciding one specific purchase. Use it for: their current situation ("¿cómo voy esta semana?", "¿cuánto me queda?", "¿cómo van mis cuentas?"); comparisons between options ("ese almuerzo de 4 es lo más barato, la otra opción sería uno de 10", "¿el de 4 o el de 10?"); tradeoffs ("si compro esto, ¿qué sacrifico?"); a purchase the user frames as a CHEAPER / SAVING choice ("un almuerzo de 4 para ahorrar", "es la opción más barata") — that's a tradeoff to weigh, not a yes/no purchase verdict; feelings/guilt ("me da culpa comprar esto pero lo necesito"); debt/card worry ("mi tarjeta me preocupa"); planning ("¿qué debería cuidar hoy?", "¿cuánto podría gastar hoy?", "estoy entre salir o ahorrar", "¿qué hago si ya me pasé del margen?"); and a short reply that supplies context to a coaching question YOU just asked ("Son $25", "es un gasto", "es medicina", "es para la universidad") when the user is NOT explicitly logging. When you are unsure whether a read-only message is a single-item advisory_question or something broader, prefer general_financial_question — a coach answers it naturally either way and nothing gets written.

- "pending_reply": the user is answering a question Kipu just asked (e.g. "como uno aparte", "sí, era viaje a brasil", a bare amount after Kipu asked for one). Only use when hasPendingClarification is true OR recent turns clearly show Kipu just asked something.

- "transaction_correction_or_undo": the user wants to undo, delete, edit, or fix a movement. Examples: "deshaz el último", "borra ese gasto", "elimina el último movimiento", "corrige el monto", "ese gasto estaba mal".

- "unsupported_action": the user asks Kipu to do an action it cannot safely do from chat yet (move money between accounts, change a balance directly, manage settings). Transfers / refunds / subscription cancellations are usually caught earlier, so use this only for other unsupported asks.

- "general_chat": greetings, thanks, small talk: "hola", "buenas", "gracias", "qué tal".

- "unclear": you genuinely cannot tell.

KEY DISTINCTIONS (decide carefully):
- A completed movement is transaction_log even if it has an amount: "café 30 pichincha" → transaction_log. The SAME idea framed as a question/opinion is advisory_question: "Estoy pensando comprar café de 30, ¿cómo lo ves?" → advisory_question.
- When in doubt between transaction_log and advisory_question: if the message reads as a statement of something already spent → transaction_log; if it reads as a question or asks your opinion ("¿…?", "cómo lo ves", "me conviene", "me rompe la semana", "vale la pena", "buena idea") → advisory_question.
- Do NOT route a clear logging message to advisory just because it has no account named; "compré algo de 30" is still a movement, not advice.
- A clear completed movement is ALWAYS transaction_log, never advisory_question or general_financial_question. A message having two amounts does NOT make it a multi-log: a comparison ("el de 4 o el de 10", "la otra opción sería uno de 10") is general_financial_question, while "uber 12 y almuerzo 8 pichincha" is a real two-movement log (transaction_log).

confidence is your certainty from 0 to 1; use below 0.7 when genuinely ambiguous so deterministic code can take over.

Respond with STRICT JSON only, no prose:
{"route": "transaction_log"|"advisory_question"|"pending_reply"|"transaction_correction_or_undo"|"unsupported_action"|"general_financial_question"|"general_chat"|"unclear", "confidence": number, "reason": string, "transactionCandidate": {"description": string|null, "amount": number|null, "currency": "USD"|null, "paymentMethodMentioned": "cash_account"|"card"|"unknown"|null, "mentionedAccountOrCardName": string|null}|null, "advisoryCandidate": {"advisoryType": "purchase_decision"|"spending_check"|"payment_method_comparison"|"wait_or_buy"|"subscription_decision"|"general_money_question"|"unknown", "itemDescription": string|null, "amount": number|null, "currency": "USD"|null, "paymentMethodMentioned": "cash_account"|"card"|"unknown"|null, "mentionedAccountOrCardName": string|null, "referencesPreviousTopic": boolean}|null, "unsupportedReason": string|null, "needsClarification": boolean, "clarificationQuestion": string|null}
`;

export async function classifyUniversalMessage(
  input: UniversalMessageRouterInput,
): Promise<UniversalMessageRoute> {
  if (!universalRouterEnabled()) return unclearRoute("router-disabled");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return unclearRoute("no-api-key");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_TRANSACTION_PARSER_MODEL ?? "gpt-5.4-mini";

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: UNIVERSAL_ROUTER_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            message: input.message,
            recentMessages: input.recentMessages.slice(-10),
            accountNames: input.accountNames,
            debtNames: input.debtNames,
            goalNames: input.goalNames,
            fixedExpenseNames: input.fixedExpenseNames,
            hasPendingClarification: input.hasPendingClarification,
          }),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return unclearRoute("empty-response");

    const parsed = JSON.parse(content) as Record<string, unknown>;
    return sanitizeRoute(parsed);
  } catch (error) {
    return unclearRoute(
      error instanceof Error ? error.message : "unknown-router-error",
    );
  }
}

function normalizeForCues(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Deterministic question/opinion detector. NOT required for advisory routing:
// a high-confidence "advisory_question" from the router is trusted directly,
// because the router is the primary semantic interpreter and advisory is
// read-only. This helper is only a tie-breaker for the MEDIUM-confidence band
// (router unsure) — when present it lets a likely-advice message win over the
// transaction pipeline; when absent the message falls through to the parser.
// A bare statement like "café 30 pichincha" carries none of these cues.
const QUESTION_OR_OPINION_CUES: RegExp[] = [
  /\bme\s+conviene\b/,
  /\bconviene\b/,
  /\bdeberia\b/,
  /\bvale\s+la\s+pena\b/,
  /\bcomo\s+lo\s+ves\b/,
  /\bque\s+(?:dices|opinas|piensas|crees|tal)\b/,
  /\bque\s+tan\s+(?:buena|bueno|buen)\b/,
  /\bbuena\s+idea\b/,
  /\bme\s+tienta\b/,
  /\bla\s+hago\b/,
  /\bme\s+alcanza\b/,
  /\bpuedo\s+(?:gastar|comprar|salir|permitirme|darme|sacar)\b/,
  /\brompe\s+(?:mi|la)\s+semana\b/,
  /\brecomiendas\b/,
  /\bestoy\s+pensando\b/,
  /\bpensando\s+(?:en\s+)?comprar\b/,
  /\bmejor\s+espero\b/,
  /\bme\s+espero\b/,
];

export function looksLikeQuestionOrOpinion(message: string): boolean {
  if (message.includes("?") || message.includes("¿")) return true;
  const normalized = normalizeForCues(message);
  return QUESTION_OR_OPINION_CUES.some((re) => re.test(normalized));
}

// Deterministic, on-brand copy for read-only router outcomes. The router only
// classifies; these helpers own the user-facing wording so raw model text
// never reaches the user.
export function buildCorrectionComingSoonReply(): string {
  return "Todavía no puedo deshacer movimientos desde el chat sin riesgo de descuadrar saldos. Ya lo tengo identificado como próximo paso; por ahora revísalo desde la app.";
}

export function buildUnsupportedActionReply(): string {
  return "Eso todavía no lo puedo hacer desde el chat sin riesgo de descuadrar tus saldos. Por ahora ese ajuste hazlo desde la app; aquí sí puedo anotar tus movimientos del día y ayudarte a decidir si un gasto te entra.";
}

export function buildGeneralChatReply(message: string): string {
  const normalized = normalizeForCues(message);
  if (/\bgracias\b/.test(normalized)) {
    return "¡Con gusto! Cuando quieras anótame un gasto (\"café 3 pichincha\") o pregúntame si algo te entra en la semana.";
  }
  return "¡Hola! ¿En qué te ayudo con tu plata hoy? Puedes anotarme un gasto (\"café 3 pichincha\") o preguntarme si algo te alcanza esta semana.";
}
