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
    return parseTransactionWithOpenAI({
      ...input,
      source: "ai",
    });
  }

  if (mode === "ai_with_basic_fallback") {
    const aiResult = await parseTransactionWithOpenAI({
      ...input,
      source: "ai",
    });

    if (
      aiResult.status === "ready" &&
      aiResult.intent &&
      aiResult.confidenceScore >= 0.75
    ) {
      return aiResult;
    }
  }

  return parseTransactionWithBasicAdapter({
    ...input,
    source: "basic",
  });
}
