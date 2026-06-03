import OpenAI from "openai";
import type { AdvisoryRecentMessage } from "@/lib/ai/advisory-classifier";
import type { FinancialCategory, PaymentFrequency } from "@/types/financial";

// Classifies "commitment" messages: creating a new recurring/fixed expense,
// permanently changing an existing one's amount, or telling Kipu about a future
// payment that has NOT happened yet. AI is the primary interpreter; a cheap
// deterministic gate decides whether to even ask it, and a deterministic
// fallback keeps the door closed (action "none") when AI is unavailable.

export type CommitmentAction =
  | "create_fixed" // a new recurring/fixed expense
  | "update_fixed" // permanently change an existing fixed expense amount
  | "schedule_payment" // a future, not-yet-paid one-time (or future-recurring) payment
  | "none";

export interface CommitmentIntent {
  action: CommitmentAction;
  name: string | null;
  amount: number | null;
  frequency: PaymentFrequency | null;
  category: FinancialCategory | null;
  // Absolute dates resolved from relative phrasing, or null when unknown.
  dueDate: string | null; // YYYY-MM-DD — when a scheduled payment is due / starts
  startDate: string | null; // YYYY-MM-DD — when a future-starting recurring begins
  recurring: boolean; // a scheduled payment that actually repeats monthly
  payNow: boolean; // the user says they ALSO paid it now
  paymentSourceName: string | null;
  confidence: number;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

// Cheap gate: does this look like a fixed-expense / future-commitment message?
// Excludes plain logging ("café 3 pichincha") which has none of these cues.
export function looksLikeCommitmentish(message: string): boolean {
  const n = normalize(message);
  return (
    /\bgasto\s+fijo\b/.test(n) ||
    /\bnuevo\s+gasto\b/.test(n) ||
    /\bal\s+mes\b/.test(n) ||
    /\bmensual(?:es|mente)?\b/.test(n) ||
    /\bcada\s+mes\b/.test(n) ||
    /\btodos\s+los\s+meses\b/.test(n) ||
    /\bvoy\s+a\s+(?:empezar|pagar|tener)\b/.test(n) ||
    /\bempiezo\s+a\s+pagar\b/.test(n) ||
    /\b(?:recuerdame|recordar|acuerdame)\b/.test(n) ||
    /\bdesde\s+(?:el|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|este|el\s+proximo|la\s+proxima|manana|el\s+\d)/.test(n) ||
    /\b(?:el\s+)?proximo\s+mes\b/.test(n) ||
    /\bsuscripcion\b/.test(n) ||
    /\b(?:actualiza|actualizar|cambio|cambia|subio|subio\s+a|ahora\s+(?:pago|es|cuesta)|ya\s+no\s+son|ahora\s+son)\b/.test(n) ||
    /\b(?:gimnasio|renta|alquiler|internet|netflix|spotify|membresia|plan)\b.*\b(?:al\s+mes|mensual|fijo|cada\s+mes)\b/.test(n)
  );
}

function commitmentAiEnabled(): boolean {
  return (process.env.TRANSACTION_PARSER_MODE ?? "basic") !== "basic";
}

const VALID_CATEGORIES = new Set<FinancialCategory>([
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

const VALID_FREQUENCIES = new Set<PaymentFrequency>([
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
  "custom",
]);

function commitmentSystemPrompt(todayIso: string): string {
  return `
You read ONE user message to Kipu (a money assistant) plus recent chat. Decide whether it is about a recurring/fixed expense or a FUTURE (not-yet-paid) payment, and extract fields. You ONLY classify; deterministic code validates and writes. Today's date is ${todayIso}. Interpret natural LatAm Spanish, not fixed phrases.

"action":
- "create_fixed": the user is telling you about a NEW recurring/monthly cost they will pay regularly (a subscription, gym, rent, service). Examples of intent: "tengo un nuevo gasto fijo de gimnasio de 25 al mes", "voy a empezar a pagar Spotify 20 mensual".
- "update_fixed": the user wants to PERMANENTLY change the amount of a fixed expense they already have, going forward ("mi renta subió a 520 desde ahora", "ahora pago 30 de internet siempre").
- "schedule_payment": a FUTURE payment that has NOT happened yet — a reminder or a cost that starts later ("recuérdame pagar la matrícula el 15", "desde el 1 del próximo mes empiezo a pagar 25 de gimnasio"). Set recurring=true if it then repeats every month.
- "none": it is a normal expense already paid, a question, or anything not about a fixed/future commitment. A plain "café 3 pichincha" is "none".

Fields (null when unknown — NEVER invent):
- name: what the expense is ("gimnasio", "Spotify", "renta").
- amount (number).
- frequency: weekly | biweekly | monthly | yearly (for create_fixed / recurring). Default monthly when they say "al mes".
- category: housing, utilities, food, transport, health, education, subscriptions, debt, shopping, entertainment, family, savings, income, travel, other.
- dueDate: for schedule_payment, the absolute date it is due/starts, as YYYY-MM-DD, resolved from relative phrasing using today's date. Null if they gave no date.
- startDate: for create_fixed that BEGINS in the future, the absolute YYYY-MM-DD start. Null if it starts now.
- recurring: true if a schedule_payment repeats monthly.
- payNow: true ONLY if the user explicitly says they ALSO paid it now/today.
- paymentSourceName: the account/card they'll pay from, if named.
- confidence: 0..1.

Respond with STRICT JSON only:
{"action":"create_fixed"|"update_fixed"|"schedule_payment"|"none","name":string|null,"amount":number|null,"frequency":"weekly"|"biweekly"|"monthly"|"yearly"|null,"category":string|null,"dueDate":string|null,"startDate":string|null,"recurring":boolean,"payNow":boolean,"paymentSourceName":string|null,"confidence":number}
`;
}

function noneIntent(): CommitmentIntent {
  return {
    action: "none",
    name: null,
    amount: null,
    frequency: null,
    category: null,
    dueDate: null,
    startDate: null,
    recurring: false,
    payNow: false,
    paymentSourceName: null,
    confidence: 0,
  };
}

function validIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return value;
}

export async function classifyCommitment(input: {
  message: string;
  recentMessages: AdvisoryRecentMessage[];
}): Promise<CommitmentIntent> {
  if (!commitmentAiEnabled()) return noneIntent();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return noneIntent();

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_TRANSACTION_PARSER_MODEL ?? "gpt-5.4-mini";
  const todayIso = new Date().toISOString().slice(0, 10);

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: commitmentSystemPrompt(todayIso) },
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
    if (!content) return noneIntent();
    const parsed = JSON.parse(content) as Record<string, unknown>;

    const action: CommitmentAction = [
      "create_fixed",
      "update_fixed",
      "schedule_payment",
      "none",
    ].includes(parsed.action as string)
      ? (parsed.action as CommitmentAction)
      : "none";

    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
    const str = (v: unknown, max = 80): string | null => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t ? t.slice(0, max) : null;
    };

    return {
      action,
      name: str(parsed.name),
      amount: num(parsed.amount),
      frequency:
        typeof parsed.frequency === "string" &&
        VALID_FREQUENCIES.has(parsed.frequency as PaymentFrequency)
          ? (parsed.frequency as PaymentFrequency)
          : null,
      category:
        typeof parsed.category === "string" &&
        VALID_CATEGORIES.has(parsed.category as FinancialCategory)
          ? (parsed.category as FinancialCategory)
          : null,
      dueDate: validIsoDate(parsed.dueDate),
      startDate: validIsoDate(parsed.startDate),
      recurring: parsed.recurring === true,
      payNow: parsed.payNow === true,
      paymentSourceName: str(parsed.paymentSourceName, 60),
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
    };
  } catch {
    return noneIntent();
  }
}
