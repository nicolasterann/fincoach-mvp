import type {
  CoachResponseInput,
  CoachResponseResult,
} from "@/lib/ai/coach-response-contract";

export function buildFallbackCoachResponse({
  context,
}: CoachResponseInput): CoachResponseResult {
  const amountText = `${context.intent.originalCurrency} ${context.intent.originalAmount.toFixed(2)}`;
  const snapshotText = buildSnapshotText(context.financialSnapshot);

  if (context.resultCode === "expense_created") {
    if (context.debtAccountName) {
      return {
        source: "fallback",
        confidenceScore: 1,
        message: `Anotado: ${amountText} con ${context.debtAccountName}. La tarjeta no es magia, así que lo sumé a tu deuda.${snapshotText}`,
      };
    }

    return {
      source: "fallback",
      confidenceScore: 1,
      message: `Anotado: ${amountText} desde ${context.accountName ?? "tu cuenta"}.${snapshotText}`,
    };
  }

  if (context.resultCode === "income_created") {
    return {
      source: "fallback",
      confidenceScore: 1,
      message: `Entró plata: ${amountText} a ${context.accountName ?? "tu cuenta"}. Respira, tu margen subió.${snapshotText}`,
    };
  }

  if (context.resultCode === "goal_contribution_created") {
    return {
      source: "fallback",
      confidenceScore: 1,
      message: `Bien ahí: ${amountText} para ${context.goalName ?? "tu meta"}. Tu yo del futuro acaba de aplaudir.${snapshotText}`,
    };
  }

  return {
    source: "fallback",
    confidenceScore: 1,
    message: `Buena movida: pagaste ${amountText} a tu tarjeta ${context.debtAccountName ?? "deuda"} desde tu cuenta de ${context.accountName ?? "origen"}. Bajó tu cuenta, pero también bajó tu deuda. Eso sí cuenta como progreso.${snapshotText}`,
  };
}

function buildSnapshotText(snapshot: CoachResponseInput["context"]["financialSnapshot"]): string {
  if (!snapshot) {
    return "";
  }

  return ` Te quedan ${snapshot.baseCurrency} ${snapshot.flexibleSpending.toFixed(2)} flexibles y ${snapshot.baseCurrency} ${snapshot.dailySuggestedLimit.toFixed(2)}/día esta semana.`;
}
