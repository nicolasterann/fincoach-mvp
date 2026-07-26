import type { AmbitionMode } from "@/types/financial";
import type { GoalPlanStatus } from "@/lib/financial/goal-planning";

// Stage 17 — PSYCHOLOGICAL ADHERENCE (product logic, not clinical). The reason
// most finance apps fail: plans that are mathematically optimal but humanly
// unsustainable. This module encodes the guardrails that keep Kipu usable —
// preserve everyday joy, allow controlled indulgence even with debt, cap how much
// of the surplus goals may claim, and flag when a plan is too tight to last. PURE.

export interface AdherenceModel {
  // Can Kipu suggest a NEW mini-goal / controlled-joy spend right now?
  miniGoalEligible: boolean;
  eligibilityReason: string; // structured Spanish
  joyQuotient: number; // 0..1 share of surplus to keep as everyday joy
  recommendedAmbition: AmbitionMode;
  // Risk the current plan is too restrictive to be sustained (→ user quits).
  slipRisk: "low" | "medium" | "high";
  slipNote: string;
  // Even with high-interest debt, allow a small controlled-joy allowance?
  allowControlledJoy: boolean;
}

const JOY_QUOTIENT: Record<AmbitionMode, number> = { light_touch: 0.5, steady: 0.35, power_builder: 0.2 };

export function assessAdherence(input: {
  ambitionMode?: AmbitionMode;
  mainGoalStatus?: GoalPlanStatus | null;
  activeGoalCount: number;
  discretionaryWeekly: number; // joy money left after the goal plan
  safeWeekly: number; // total safe spend this week
  debtPressure?: "none" | "low" | "medium" | "high" | "critical";
}): AdherenceModel {
  const ambition = input.ambitionMode ?? "steady";
  const joyQuotient = JOY_QUOTIENT[ambition];
  const discretionary = Math.max(0, input.discretionaryWeekly);
  const safe = Math.max(0, input.safeWeekly);
  const pressure = input.debtPressure ?? "none";

  // Controlled joy is allowed even with debt — denying ALL enjoyment is what
  // makes users quit. Only a truly broken week (no discretionary at all) blocks it.
  const allowControlledJoy = discretionary > 0 && pressure !== "critical";

  // A mini-goal is eligible when there's real discretionary room, not too many
  // goals already competing, and the main goal isn't actively breaking.
  const tooManyGoals = input.activeGoalCount >= 4;
  const mainBlocked = input.mainGoalStatus === "blocked_by_debt_or_margin" || input.mainGoalStatus === "not_realistic";
  const miniGoalEligible = discretionary >= 5 && !tooManyGoals && pressure !== "critical";
  const eligibilityReason = miniGoalEligible
    ? "hay plata libre suficiente para una mini-meta sin tocar lo importante"
    : discretionary < 5
      ? "ahora mismo casi no hay plata libre; mejor no sumar una mini-meta por ahora"
      : tooManyGoals
        ? "ya hay varias metas activas compitiendo; conviene cerrar o pausar alguna antes de sumar otra"
        : "la deuda está muy presionada esta semana; primero aliviamos eso";

  // Slip risk: plan too tight if discretionary is a tiny slice of safe spend.
  const ratio = safe > 0 ? discretionary / safe : 0;
  const slipRisk: AdherenceModel["slipRisk"] = ratio < 0.1 ? "high" : ratio < 0.25 ? "medium" : "low";
  const slipNote =
    slipRisk === "high"
      ? "el plan deja muy poco para vivir; así suele abandonarse — mejor aflojar un aporte para que sea sostenible"
      : slipRisk === "medium"
        ? "el plan está algo ajustado; vigila que siga siendo cómodo"
        : "el plan deja espacio para vivir, debería ser sostenible";

  // Recommend a gentler ambition if the plan is slipping; firmer if very loose.
  const recommendedAmbition: AmbitionMode = slipRisk === "high" && ambition !== "light_touch" ? "light_touch" : mainBlocked && ambition === "power_builder" ? "steady" : ambition;

  return { miniGoalEligible, eligibilityReason, joyQuotient, recommendedAmbition, slipRisk, slipNote, allowControlledJoy };
}
