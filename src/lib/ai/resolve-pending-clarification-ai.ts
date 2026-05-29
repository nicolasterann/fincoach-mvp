import OpenAI from "openai";

// AI-assisted classification of a user's short reply to a pending
// clarification. The AI ONLY classifies the reply into a fixed decision
// set — it never decides amounts, accounts, or goals, and it never writes
// to the database. The deterministic resolver in the chat handler keeps
// full control of what gets applied; this module just helps read natural
// follow-up phrasing the regex classifiers miss.
//
// Gating + safety:
//   • Enabled only when TRANSACTION_PARSER_MODE is not "basic" (same flag
//     that turns on AI interpretation of user input).
//   • Missing API key, AI disabled, bad JSON, or any error → returns
//     { decision: "unclear", confidence: 0 } so the caller re-asks.
//   • The caller applies a confidence threshold before acting.

export type FixedExpenseAiDecision =
  | "normal_fixed_payment"
  | "separate_charge"
  | "cancel"
  | "unclear";

export type GoalMismatchAiDecision =
  | "confirm_main_goal"
  | "reject_or_cancel"
  | "unclear";

export interface AiClassification<TDecision extends string> {
  decision: TDecision;
  confidence: number;
  reason: string;
}

export interface FixedExpenseAiClassifierInput {
  prompt: string;
  reply: string;
  fixedExpenseName: string;
  fixedExpenseAmount: number;
  enteredAmount: number;
  currency: string;
  sourceAccountName?: string;
}

export interface GoalMismatchAiClassifierInput {
  prompt: string;
  reply: string;
  mainGoalName: string;
  wroteGoalName: string;
  amount: number;
  currency: string;
  sourceAccountName?: string;
}

function aiClassificationEnabled(): boolean {
  return (process.env.TRANSACTION_PARSER_MODE ?? "basic") !== "basic";
}

const FIXED_EXPENSE_SYSTEM_PROMPT = `
You classify a user's short reply to ONE question Kipu asked about a recurring/fixed expense.

Background: the user logged an expense whose amount differs from their known fixed expense (e.g. Internet is normally 20 but they typed 25). Kipu asked whether this is their normal fixed payment or a separate/extra charge.

Classify the reply into exactly one decision:
- "normal_fixed_payment": it IS the usual recurring payment (even if the amount changed this month).
- "separate_charge": it is a SEPARATE / extra / additional charge, not the normal fixed payment.
- "cancel": the user wants to cancel / forget it / not register it.
- "unclear": you cannot tell with confidence.

Examples → separate_charge: "como uno a parte", "como uno aparte", "como cargo aparte", "fue aparte", "ese fue extra", "no, fue adicional", "es otro cobro", "es un cargo aparte".
Examples → normal_fixed_payment: "fue el normal", "el de siempre", "sí, el pago normal", "como gasto fijo", "fue el cargo normal", "ese es el internet de este mes", "sí, el normal aunque subió".

Rules:
- You ONLY classify the reply. You never decide amounts, accounts, or anything financial.
- Respond with STRICT JSON only, no prose: {"decision": "normal_fixed_payment" | "separate_charge" | "cancel" | "unclear", "confidence": <number 0..1>, "reason": "<short>"}.
- confidence is your certainty from 0 to 1. Use a value below 0.75 when the reply is genuinely ambiguous.
`;

const GOAL_MISMATCH_SYSTEM_PROMPT = `
You classify a user's short reply to ONE question Kipu asked about which goal a contribution belongs to.

Background: the user tried to send money to a goal using a name that does NOT match any saved goal (e.g. they wrote "boda"). Kipu has one main goal (e.g. "Viaje a Brasil") and asked the user to confirm whether the money should go to that main goal.

Classify the reply into exactly one decision:
- "confirm_main_goal": the user confirms it should go to the main goal.
- "reject_or_cancel": the user says no, it was a different goal, or to not register it.
- "unclear": you cannot tell with confidence.

Examples → confirm_main_goal: "sí", "sisi", "sí, era viaje a brasil", "correcto, era brasil", "sí a brasil", "va a viaje", "era para la meta principal", "sí, a esa".
Examples → reject_or_cancel: "no", "no, era boda", "era otra meta", "olvídalo", "no lo registres".

Rules:
- You ONLY classify the reply. You never decide amounts, accounts, or which goal exists.
- Respond with STRICT JSON only, no prose: {"decision": "confirm_main_goal" | "reject_or_cancel" | "unclear", "confidence": <number 0..1>, "reason": "<short>"}.
- confidence is your certainty from 0 to 1. Use a value below 0.75 when the reply is genuinely ambiguous.
`;

async function classifyWithAi<TDecision extends string>(
  systemPrompt: string,
  userPayload: unknown,
  allowedDecisions: readonly TDecision[],
): Promise<AiClassification<TDecision>> {
  const unclear = (reason: string): AiClassification<TDecision> => ({
    decision: "unclear" as TDecision,
    confidence: 0,
    reason,
  });

  if (!aiClassificationEnabled()) return unclear("ai-disabled");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return unclear("no-api-key");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_TRANSACTION_PARSER_MODEL ?? "gpt-5.4-mini";

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return unclear("empty-response");

    const parsed = JSON.parse(content) as {
      decision?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };

    const decision =
      typeof parsed.decision === "string" &&
      (allowedDecisions as readonly string[]).includes(parsed.decision)
        ? (parsed.decision as TDecision)
        : ("unclear" as TDecision);

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0;

    const reason = typeof parsed.reason === "string" ? parsed.reason : "";

    return { decision, confidence, reason };
  } catch (error) {
    return unclear(error instanceof Error ? error.message : "unknown-ai-error");
  }
}

export function classifyFixedExpenseFollowUpWithAI(
  input: FixedExpenseAiClassifierInput,
): Promise<AiClassification<FixedExpenseAiDecision>> {
  return classifyWithAi<FixedExpenseAiDecision>(
    FIXED_EXPENSE_SYSTEM_PROMPT,
    {
      kind: "fixed_expense_amount_mismatch",
      prompt: input.prompt,
      fixedExpenseName: input.fixedExpenseName,
      fixedExpenseAmount: input.fixedExpenseAmount,
      enteredAmount: input.enteredAmount,
      currency: input.currency,
      sourceAccountName: input.sourceAccountName ?? null,
      reply: input.reply,
    },
    ["normal_fixed_payment", "separate_charge", "cancel", "unclear"],
  );
}

export function classifyGoalMismatchFollowUpWithAI(
  input: GoalMismatchAiClassifierInput,
): Promise<AiClassification<GoalMismatchAiDecision>> {
  return classifyWithAi<GoalMismatchAiDecision>(
    GOAL_MISMATCH_SYSTEM_PROMPT,
    {
      kind: "goal_name_mismatch",
      prompt: input.prompt,
      mainGoalName: input.mainGoalName,
      wroteGoalName: input.wroteGoalName,
      amount: input.amount,
      currency: input.currency,
      sourceAccountName: input.sourceAccountName ?? null,
      reply: input.reply,
    },
    ["confirm_main_goal", "reject_or_cancel", "unclear"],
  );
}
