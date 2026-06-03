import OpenAI from "openai";
import type { AdvisoryRecentMessage } from "@/lib/ai/advisory-classifier";

// Classifies a recovery message (the Universal Router already decided it is a
// correction/undo) into a structured recovery intent. AI is the primary
// interpreter so we are NOT phrase-matching; a deterministic fallback keeps
// the feature working when AI is disabled. Code (not the model) then validates
// the target and applies the audit-safe reversal/correction.

export type RecoveryAction =
  | "undo"
  | "duplicate"
  | "correct"
  | "unclear";

export type CorrectionField =
  | "amount"
  | "source"
  | "category"
  | "description"
  | null;

export interface RecoveryIntent {
  action: RecoveryAction;
  // Free-text hint describing which movement ("el café", "los 90", "el último").
  targetHint: string | null;
  correctionField: CorrectionField;
  newAmount: number | null;
  newSourceName: string | null;
  newCategory: string | null;
  newDescription: string | null;
  confidence: number;
}

function recoveryAiEnabled(): boolean {
  return (process.env.TRANSACTION_PARSER_MODE ?? "basic") !== "basic";
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Broad affirmation / negation cues for confirming a recovery ("sí, quítalo",
// "dale", "no, déjalo"). Used only to resolve a confirmation Kipu just asked.
const AFFIRM = /\b(si|sip|sis|claro|dale|hazlo|correcto|exacto|dale\s+nomas|borralo|quitalo|eliminalo|elimina|confirmo|asi\s+es|esa|ese|eso)\b/;
const NEGATE = /\b(no|nop|dejalo|dejala|cancelar|cancela|mejor\s+no|olvidalo|ninguno|ninguna)\b/;

export function detectAffirmation(message: string): boolean {
  const n = normalize(message);
  if (NEGATE.test(n)) return false;
  return AFFIRM.test(n);
}

export function detectNegation(message: string): boolean {
  return NEGATE.test(normalize(message));
}

// Deterministic family hints (fallback only; the AI is primary). These are a
// coarse safety net, NOT the main classifier.
function deterministicAction(message: string): RecoveryAction {
  const n = normalize(message);
  if (/\b(duplicad|repetid|dos\s+veces|doble|2\s+veces|misma\s+dos|otra\s+vez\s+igual)\b/.test(n)) {
    return "duplicate";
  }
  if (/\b(corrige|corregir|cambia|cambiar|en\s+realidad|no\s+era|mas\s+bien|estaba\s+mal|equivoque|ajusta|en\s+verdad)\b/.test(n)) {
    return "correct";
  }
  if (/\b(borra|elimina|deshaz|quita|undo|reversa|revierte|anula|cancela\s+el|saca\s+el|me\s+equivoque)\b/.test(n)) {
    return "undo";
  }
  return "unclear";
}

const RECOVERY_SYSTEM_PROMPT = `
You read ONE user message to Kipu (a money assistant) plus recent chat. The message is already known to be about FIXING a recent movement they logged — undoing it, removing a duplicate, or correcting a field. Classify it into structured fields. You ONLY classify and extract; deterministic code finds the real transaction and applies the safe reversal/correction.

Pick "action":
- "undo": remove/delete/reverse a recent movement, or "me equivoqué", "bórralo", "quita eso".
- "duplicate": it got logged twice / there is a repeated one / Telegram sent it twice — remove the extra, keep one.
- "correct": a field of a recent movement was wrong and should change (amount, source account/card, category, or description). Includes "no era con Visa sino Pichincha", "eran 30 no 20", "era comida no transporte".
- "unclear": you cannot tell.

Other fields:
- "targetHint": short free text describing WHICH movement they mean ("el café", "los 90", "el último", "la cena de ayer"), or null. Never invent.
- For "correct", set "correctionField" to the ONE field changing: "amount" | "source" | "category" | "description". Fill only the matching new value:
  - newAmount (number) when the amount changes.
  - newSourceName (the account/card name they now say) when the source changes.
  - newCategory (one of: food, transport, shopping, subscriptions, travel, housing, utilities, health, education, entertainment, family, debt, savings, income, other) when the category changes.
  - newDescription (short text) when only the label changes.
- "confidence": 0..1; below 0.6 when genuinely unsure.

Respond with STRICT JSON only:
{"action": "undo"|"duplicate"|"correct"|"unclear", "targetHint": string|null, "correctionField": "amount"|"source"|"category"|"description"|null, "newAmount": number|null, "newSourceName": string|null, "newCategory": string|null, "newDescription": string|null, "confidence": number}
`;

const VALID_CATEGORIES = new Set([
  "food",
  "transport",
  "shopping",
  "subscriptions",
  "travel",
  "housing",
  "utilities",
  "health",
  "education",
  "entertainment",
  "family",
  "debt",
  "savings",
  "income",
  "other",
]);

function fallbackIntent(message: string): RecoveryIntent {
  return {
    action: deterministicAction(message),
    targetHint: null,
    correctionField: null,
    newAmount: null,
    newSourceName: null,
    newCategory: null,
    newDescription: null,
    confidence: 0,
  };
}

export async function classifyRecoveryIntent(input: {
  message: string;
  recentMessages: AdvisoryRecentMessage[];
}): Promise<RecoveryIntent> {
  if (!recoveryAiEnabled()) return fallbackIntent(input.message);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackIntent(input.message);

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_TRANSACTION_PARSER_MODEL ?? "gpt-5.4-mini";

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: RECOVERY_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            message: input.message,
            recentMessages: input.recentMessages.slice(-8),
          }),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return fallbackIntent(input.message);

    const parsed = JSON.parse(content) as Record<string, unknown>;

    const action: RecoveryAction =
      parsed.action === "undo" ||
      parsed.action === "duplicate" ||
      parsed.action === "correct" ||
      parsed.action === "unclear"
        ? parsed.action
        : "unclear";

    const correctionField: CorrectionField =
      parsed.correctionField === "amount" ||
      parsed.correctionField === "source" ||
      parsed.correctionField === "category" ||
      parsed.correctionField === "description"
        ? parsed.correctionField
        : null;

    const newAmount =
      typeof parsed.newAmount === "number" &&
      Number.isFinite(parsed.newAmount) &&
      parsed.newAmount > 0
        ? parsed.newAmount
        : null;

    const newCategory =
      typeof parsed.newCategory === "string" &&
      VALID_CATEGORIES.has(parsed.newCategory)
        ? parsed.newCategory
        : null;

    const boundedString = (value: unknown, max: number): string | null => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
    };

    return {
      action,
      targetHint: boundedString(parsed.targetHint, 80),
      correctionField,
      newAmount,
      newSourceName: boundedString(parsed.newSourceName, 60),
      newCategory,
      newDescription: boundedString(parsed.newDescription, 120),
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
    };
  } catch {
    return fallbackIntent(input.message);
  }
}
