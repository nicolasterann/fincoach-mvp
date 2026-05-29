import { parseTransactionWithBasicAdapter } from "@/lib/ai/basic-transaction-parser-adapter";
import { parseTransactionWithOpenAI } from "@/lib/ai/openai-transaction-parser";
import type {
  TransactionParserInput,
  TransactionParserResult,
} from "@/lib/ai/transaction-parser-contract";

export async function parseTransaction(
  input: Omit<TransactionParserInput, "source">,
): Promise<TransactionParserResult> {
  const mode = process.env.TRANSACTION_PARSER_MODE ?? "basic";

  if (mode === "ai") {
    const aiResult = await parseTransactionWithOpenAI({
      ...input,
      source: "ai",
    });

    if (aiResult.status === "needs_clarification" || aiResult.status === "unsupported") {
      const rescued = rescueClearDebtPayment(input);
      if (rescued) return rescued;
    }

    return aiResult;
  }

  if (mode === "ai_with_basic_fallback") {
    const aiResult = await parseTransactionWithOpenAI({
      ...input,
      source: "ai",
    });

    if (aiResult.status === "ready" && aiResult.intent && aiResult.confidenceScore >= 0.75) {
      return aiResult;
    }

    if (aiResult.status === "needs_clarification" || aiResult.status === "unsupported") {
      const rescued = rescueClearDebtPayment(input);
      if (rescued) return rescued;
    }

    if (aiResult.status === "unsupported" && aiResult.confidenceScore >= 0.75) {
      return aiResult;
    }

    if (
      aiResult.status === "needs_clarification" &&
      aiResult.clarificationQuestion &&
      aiResult.confidenceScore >= 0.5
    ) {
      return aiResult;
    }
  }

  return parseTransactionWithBasicAdapter({
    ...input,
    source: "basic",
  });
}

// Deterministic rescue for a clearly-shaped debt payment that AI
// uncertainty turned into a clarification/unsupported. We only override
// when the basic parser fully resolves a debt_payment (amount + source
// account + debt account); anything less stays as the AI result so we
// never auto-parse ambiguous input or unsupported movement types.
function rescueClearDebtPayment(
  input: Omit<TransactionParserInput, "source">,
): TransactionParserResult | null {
  const basicResult = parseTransactionWithBasicAdapter({
    ...input,
    source: "basic",
  });

  const intent = basicResult.intent;

  if (
    basicResult.status === "ready" &&
    intent?.type === "debt_payment" &&
    intent.sourceAccountId &&
    intent.debtAccountId &&
    intent.originalAmount > 0
  ) {
    return basicResult;
  }

  return null;
}
