import { parseBasicTransactionIntent } from "@/lib/financial/basic-intent-parser";
import {
  createClarificationResult,
  createReadyResult,
  createUnsupportedResult,
  type TransactionParserInput,
  type TransactionParserResult,
} from "@/lib/ai/transaction-parser-contract";

export function parseTransactionWithBasicAdapter(
  input: TransactionParserInput,
): TransactionParserResult {
  const intent = parseBasicTransactionIntent({
    message: input.message,
    accounts: input.context.accounts,
    debtAccounts: input.context.debtAccounts,
    baseCurrency: input.context.baseCurrency,
  });

  if (intent.status === "needs_clarification") {
    return createClarificationResult({
      source: "basic",
      confidenceScore: intent.confidenceScore,
      clarificationQuestion:
        "¿Me dices desde dónde pagaste eso? Puede ser una cuenta o una tarjeta.",
      userFacingMessage:
        "Casi lo tengo, pero me falta saber si salió dna cuenta o de una tarjeta.",
    });
  }

  if (intent.type !== "expense") {
    return createUnsupportedResult({
      source: "basic",
      confidenceScore: intent.confidenceScore,
      userFacingMessage:
        "Por ahora el parser básico solo registra gastos. Para ingresos y aportes seguimos usando los formularios.",
    });
  }

  return createReadyResult({
    source: "basic",
    intent,
    userFacingMessage:
      intent.debtAccountId
        ? "Listo, registré el gasto como deuda de tarjeta."
        : "Listo, registré el gasto y actualicé tu cuenta.",
  });
}
