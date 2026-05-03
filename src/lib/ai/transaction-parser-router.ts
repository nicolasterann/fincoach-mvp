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

  return parseTransactionWithBasicAdapter({
    ...input,
    source: "basic",
  });
}
