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
    // Tailored clarifications for shapes where the intent type is
    // recognized but a specific field is missing. The user gets one
    // direct follow-up question instead of a generic example dump.
    if (
      intent.type === "goal_contribution" &&
      intent.unresolvedGoalName
    ) {
      const mainName = input.context.mainGoal?.name;
      const wrote = intent.unresolvedGoalName;
      const message = mainName
        ? `Tengo "${mainName}" como tu meta principal, pero escribiste "${wrote}". Para no moverlo mal, confirma si va a ${mainName}.`
        : `Escribiste "${wrote}" pero no tengo esa meta guardada. ¿Quieres crearla primero o usar otra?`;
      return createClarificationResult({
        source: "basic",
        confidenceScore: intent.confidenceScore,
        clarificationQuestion: message,
        userFacingMessage: message,
      });
    }

    if (
      intent.type === "goal_contribution" &&
      intent.goalId &&
      !intent.sourceAccountId
    ) {
      const message =
        "¿Desde qué cuenta mandaste ese monto a tu meta? Dime algo como \"mandé 20 a [meta] desde Pichincha\".";
      return createClarificationResult({
        source: "basic",
        confidenceScore: intent.confidenceScore,
        clarificationQuestion: message,
        userFacingMessage: message,
      });
    }

    if (intent.type === "income" && !intent.destinationAccountId) {
      const message =
        "¿A qué cuenta te llegó ese ingreso? Dime algo como \"me pagaron 100 a Pichincha\".";
      return createClarificationResult({
        source: "basic",
        confidenceScore: intent.confidenceScore,
        clarificationQuestion: message,
        userFacingMessage: message,
      });
    }

    if (
      intent.type === "debt_payment" &&
      (!intent.sourceAccountId || !intent.debtAccountId)
    ) {
      const message =
        "¿Qué deuda pagaste y desde qué cuenta? Dime algo como \"pagué 30 de Visa Pichincha desde Pichincha\".";
      return createClarificationResult({
        source: "basic",
        confidenceScore: intent.confidenceScore,
        clarificationQuestion: message,
        userFacingMessage: message,
      });
    }

    const generic =
      "Casi lo tengo, pero me falta un dato para registrarlo bien. Prueba así: café 5 pichincha, zapatos 40 visa, me pagaron 50 a pichincha, aporté 20 a brasil desde pichincha o pagué 30 de visa desde pichincha.";
    return createClarificationResult({
      source: "basic",
      confidenceScore: intent.confidenceScore,
      clarificationQuestion: generic,
      userFacingMessage: generic,
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
