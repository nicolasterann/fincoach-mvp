import OpenAI from "openai";
import type { FinancialCategory } from "@/types/financial";
import {
  aiTransactionParserSystemPrompt,
  type AiTransactionParserJson,
} from "@/lib/ai/ai-transaction-parser-schema";
import {
  createClarificationResult,
  createReadyResult,
  createUnsupportedResult,
  type TransactionParserInput,
  type TransactionParserResult,
} from "@/lib/ai/transaction-parser-contract";
import type {
  AdjustmentIntent,
  DebtPaymentIntent,
  ExpenseIntent,
  GoalContributionIntent,
  IncomeIntent,
  RefundIntent,
  ReversalIntent,
  TransactionIntent,
  TransferIntent,
} from "@/types/transaction-intents";

export async function parseTransactionWithOpenAI(
  input: TransactionParserInput,
): Promise<TransactionParserResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return createClarificationResult({
      source: "ai",
      confidenceScore: 0,
      clarificationQuestion:
        "El parser IA todavía no está configurado. Estoy usando el parser básico por ahora.",
      userFacingMessage:
        "Todavía no tengo IA conectada. Podemos seguir con el parser básico.",
    });
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_TRANSACTION_PARSER_MODEL ?? "gpt-4.1-mini";

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: aiTransactionParserSystemPrompt,
      },
      {
        role: "user",
        content: JSON.stringify({
          message: input.message,
          baseCurrency: input.context.baseCurrency,
          accounts: input.context.accounts.map((account) => ({
            id: account.id,
            name: account.name,
            type: account.type,
            currency: account.currency,
            isGoalAccount: account.isGoalAccount,
          })),
          debtAccounts: input.context.debtAccounts.map((debt) => ({
            id: debt.id,
            name: debt.name,
            type: debt.type,
            currency: debt.currency,
          })),
          goals: input.context.goals.map((goal) => ({
            id: goal.id,
            name: goal.name,
            currency: goal.currency,
            goalAccountId: goal.goalAccountId ?? null,
          })),
          mainGoalId: input.context.mainGoal?.id ?? null,
        }),
      },
    ],
  });

  const rawContent = completion.choices[0]?.message.content;

  if (!rawContent) {
    return createUnsupportedResult({
      source: "ai",
      confidenceScore: 0,
      userFacingMessage: "No pude interpretar ese movimiento todavía.",
    });
  }

  let parsed: AiTransactionParserJson;

  try {
    parsed = JSON.parse(rawContent) as AiTransactionParserJson;
  } catch {
    return createUnsupportedResult({
      source: "ai",
      confidenceScore: 0,
      userFacingMessage: "La IA respondió en un formato que todavía no puedo usar.",
    });
  }

  if (parsed.status === "needs_clarification") {
    return createClarificationResult({
      source: "ai",
      confidenceScore: parsed.confidenceScore,
      clarificationQuestion:
        parsed.clarificationQuestion ??
        "¿Me aclaras un dato más para registrar esto correctamente?",
    });
  }

  if (parsed.status === "unsupported" || !parsed.intent) {
    return createUnsupportedResult({
      source: "ai",
      confidenceScore: parsed.confidenceScore,
      userFacingMessage:
        "Todavía no puedo registrar ese tipo de movimiento desde el chat.",
    });
  }

  const intent = normalizeAiIntent(parsed);

  return createReadyResult({
    source: "ai",
    intent,
    userFacingMessage: "Listo, interpreté el movimiento con IA.",
  });
}

function normalizeAiIntent(parsed: AiTransactionParserJson): TransactionIntent {
  if (!parsed.intent) {
    throw new Error("AI parser returned no intent.");
  }

  const base = {
    description: parsed.intent.description,
    originalAmount: parsed.intent.originalAmount,
    originalCurrency: parsed.intent.originalCurrency,
    exchangeRateToBase: parsed.intent.exchangeRateToBase ?? undefined,
    baseCurrency: parsed.intent.baseCurrency,
    confidenceScore: parsed.intent.confidenceScore,
    status: parsed.intent.status,
  };

  switch (parsed.intent.type) {
    case "expense":
      return {
        ...base,
        type: "expense",
        category: normalizeCategory(parsed.intent.category, "other"),
        sourceAccountId: parsed.intent.sourceAccountId ?? undefined,
        debtAccountId: parsed.intent.debtAccountId ?? undefined,
        isSplit: parsed.intent.isSplit ?? undefined,
        grossAmount: parsed.intent.grossAmount ?? undefined,
        reimbursedAmount: parsed.intent.reimbursedAmount ?? undefined,
        netAmount: parsed.intent.netAmount ?? undefined,
      } satisfies ExpenseIntent;

    case "income":
      return {
        ...base,
        type: "income",
        destinationAccountId: parsed.intent.destinationAccountId ?? "",
        category: normalizeCategory(parsed.intent.category, "income"),
      } satisfies IncomeIntent;

    case "transfer":
      return {
        ...base,
        type: "transfer",
        sourceAccountId: parsed.intent.sourceAccountId ?? "",
        destinationAccountId: parsed.intent.destinationAccountId ?? "",
        category: normalizeCategory(parsed.intent.category, "other"),
      } satisfies TransferIntent;

    case "debt_payment":
      return {
        ...base,
        type: "debt_payment",
        sourceAccountId: parsed.intent.sourceAccountId ?? "",
        debtAccountId: parsed.intent.debtAccountId ?? "",
        category: normalizeCategory(parsed.intent.category, "debt"),
      } satisfies DebtPaymentIntent;

    case "goal_contribution":
      return {
        ...base,
        type: "goal_contribution",
        sourceAccountId: parsed.intent.sourceAccountId ?? "",
        destinationAccountId: parsed.intent.destinationAccountId ?? "",
        goalId: parsed.intent.goalId ?? "",
        category: normalizeCategory(parsed.intent.category, "savings"),
      } satisfies GoalContributionIntent;

    case "refund":
      return {
        ...base,
        type: "refund",
        destinationAccountId: parsed.intent.destinationAccountId ?? undefined,
        debtAccountId: parsed.intent.debtAccountId ?? undefined,
        relatedTransactionId: undefined,
        category: normalizeCategory(parsed.intent.category, "other"),
      } satisfies RefundIntent;

    case "reversal":
      return {
        ...base,
        type: "reversal",
        relatedTransactionId: undefined,
        category: normalizeCategory(parsed.intent.category, "other"),
      } satisfies ReversalIntent;

    case "adjustment":
      return {
        ...base,
        type: "adjustment",
        accountId: parsed.intent.sourceAccountId ?? undefined,
        debtAccountId: parsed.intent.debtAccountId ?? undefined,
        category: normalizeCategory(parsed.intent.category, "other"),
      } satisfies AdjustmentIntent;
  }
}

function normalizeCategory(
  category: string | null,
  fallback: FinancialCategory,
): FinancialCategory {
  return (category ?? fallback) as FinancialCategory;
}
