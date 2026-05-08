"use server";

import { buildFallbackCoachResponse } from "@/lib/ai/fallback-coach-response";
import { generateCoachResponseWithOpenAI } from "@/lib/ai/openai-coach-response";
import type {
  CoachResponseResult,
  CoachResponseTone,
  CoachTransactionContext,
} from "@/lib/ai/coach-response-contract";
import type { TransactionIntent } from "@/types/transaction-intents";

export type CoachResponseTestMode = "fallback" | "ai";

export interface CoachResponseTestState {
  mode: CoachResponseTestMode;
  tone: CoachResponseTone;
  scenario: string;
  result?: CoachResponseResult;
  fallbackResult?: CoachResponseResult;
  error?: string;
}

export async function testCoachResponseAction(
  _previousState: CoachResponseTestState,
  formData: FormData,
): Promise<CoachResponseTestState> {
  const mode = String(formData.get("mode") ?? "fallback") as CoachResponseTestMode;
  const tone = String(formData.get("tone") ?? "playful") as CoachResponseTone;
  const scenario = String(formData.get("scenario") ?? "expense_created");

  if (mode !== "fallback" && mode !== "ai") {
    return {
      mode: "fallback",
      tone,
      scenario,
      error: "Modo inválido.",
    };
  }

  if (tone !== "clear" && tone !== "coach_like" && tone !== "playful") {
    return {
      mode,
      tone: "playful",
      scenario,
      error: "Tono inválido.",
    };
  }

  try {
    const context = buildScenarioContext(scenario);
    const fallbackResult = buildFallbackCoachResponse({
      context,
      tone,
    });

    if (mode === "fallback") {
      return {
        mode,
        tone,
        scenario,
        result: fallbackResult,
        fallbackResult,
      };
    }

    const aiResult = await generateCoachResponseWithOpenAI({
      context,
      tone,
    });

    return {
      mode,
      tone,
      scenario,
      result: aiResult.message ? aiResult : fallbackResult,
      fallbackResult,
    };
  } catch (error) {
    return {
      mode,
      tone,
      scenario,
      error: error instanceof Error ? error.message : "Unknown coach response test error",
    };
  }
}

function buildScenarioContext(scenario: string): CoachTransactionContext {
  if (scenario === "income_created") {
    return {
      userId: "dev-user",
      originalMessage: "me pagaron 50 a pichincha",
      resultCode: "income_created",
      accountName: "Pichincha",
      intent: {
        type: "income",
        description: "me pagaron 50 a pichincha",
        originalAmount: 50,
        originalCurrency: "USD",
        baseCurrency: "USD",
        destinationAccountId: "account-pichincha",
        category: "income",
        confidenceScore: 0.98,
        status: "ready",
      } satisfies TransactionIntent,
      financialSnapshot: {
        flexibleSpending: 119,
        dailySuggestedLimit: 29.75,
        baseCurrency: "USD",
        protectedGoalMoney: 220,
        goalProgressPercentage: 44,
      },
    };
  }

  if (scenario === "goal_contribution_created") {
    return {
      userId: "dev-user",
      originalMessage: "aporté 20 a brasil desde pichincha",
      resultCode: "goal_contribution_created",
      goalName: "Viaje a Brasil",
      intent: {
        type: "goal_contribution",
        description: "aporté 20 a brasil desde pichincha",
        originalAmount: 20,
        originalCurrency: "USD",
        baseCurrency: "USD",
        sourceAccountId: "account-pichincha",
        destinationAccountId: "",
        goalId: "goal-brasil",
        category: "savings",
        confidenceScore: 0.98,
        status: "ready",
      } satisfies TransactionIntent,
      financialSnapshot: {
        flexibleSpending: 99,
        dailySuggestedLimit: 24.75,
        baseCurrency: "USD",
        protectedGoalMoney: 240,
        goalProgressPercentage: 48,
      },
    };
  }

  if (scenario === "debt_payment_created") {
    return {
      userId: "dev-user",
      originalMessage: "pagué 10 de visa desde pichincha",
      resultCode: "debt_payment_created",
      accountName: "Pichincha",
      debtAccountName: "Visa Pichincha",
      intent: {
        type: "debt_payment",
        description: "pagué 10 de visa desde pichincha",
        originalAmount: 10,
        originalCurrency: "USD",
        baseCurrency: "USD",
        sourceAccountId: "account-pichincha",
        debtAccountId: "debt-visa",
        category: "debt",
        confidenceScore: 0.98,
        status: "ready",
      } satisfies TransactionIntent,
      financialSnapshot: {
        flexibleSpending: 99,
        dailySuggestedLimit: 24.75,
        baseCurrency: "USD",
        protectedGoalMoney: 240,
        goalProgressPercentage: 48,
      },
    };
  }

  return {
    userId: "dev-user",
    originalMessage: "café 1",
    resultCode: "expense_created",
    debtAccountName: "Visa Pichincha",
    intent: {
      type: "expense",
      description: "café 1",
      originalAmount: 1,
      originalCurrency: "USD",
      baseCurrency: "USD",
      debtAccountId: "debt-visa",
      category: "food",
      confidenceScore: 0.98,
      status: "ready",
    } satisfies TransactionIntent,
    financialSnapshot: {
      flexibleSpending: 69,
      dailySuggestedLimit: 17.25,
      baseCurrency: "USD",
      protectedGoalMoney: 240,
      goalProgressPercentage: 48,
    },
  };
}
