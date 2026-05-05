import {
  createClarificationResult,
  createReadyResult,
  createUnsupportedResult,
  type TransactionParserInput,
  type TransactionParserResult,
} from "@/lib/ai/transaction-parser-contract";
import { parseBasicTransactionIntent } from "@/lib/financial/basic-intent-parser";

export function parseTransactionWithBasicAdapter(
  input: TransactionParserInput,
): TransactionParserResult {
  const intent = parseBasicTransactionIntent({
    message: input.message,
    accounts: input.context.accounts,
    debtAccounts: input.context.debtAccounts,
    goals: input.context.goals,
    mainGoal: input.context.mainGoal,
    preferences: input.context.preferences,
    baseCurrency: input.context.baseCurrency,
  });

  if (intent.status === "needs_clarification") {
    return createClarificationResult({
      source: "basic",
      confidenceScore: intent.confidenceScore,
      clarificationQuestion:
        "Casi lo tengo, pero me falta un dato para registrarlo bien. Prueba así: café 5 pichiha, zapatos 40 visa, me pagaron 50 a pichincha, aporté 20 a brasil desde pichincha o pagué 30 de visa desde pichincha.",
      userFacingMessage:
        "Casi lo tengo, pero me falta un dato para registrarlo bien. Prueba así: café 5 pichincha, zapatos 40 visa, me pagaron 50 a pichincha, aporté 20 a brasil desde pichincha o pagué 30 de visa desde pichincha.",
    });
  }

  if (
    intent.type !== "expense" &&
    intent.type !== "goal_contribution" &&
    intent.type !== "income" &&
    intent.type !== "debt_payment"
  ) {
    return createUnsupportedResult({
      source: "basic",
      confidenceScore: intent.confidenceScore,
      userFacingMessage:
        "Por ahora el parser básico registra gastos, ingresos, aportes a meta y pagos de deuda simples.",
    });
  }

  return createReadyResult({
    source: "basic",
    intent,
    userFacingMessage:
      intent.type === "goal_contribution"
        ? "Listo, registré el aporte y actualicé tu progreso."
        : intent.type === "income"
          ? "Listo, registré el ingreso y actualicé tu cuenta."
          : intent.type === "debt_payment"
            ? "Listo, registré el pago de deuda sin duplicarlo como gasto."
            : intent.debtAccountId
              ? "Listo, registré el gasto como deuda de tarjeta."
              : "Listo, registré el gasto y actualicé tu cuenta.",
  });
}
