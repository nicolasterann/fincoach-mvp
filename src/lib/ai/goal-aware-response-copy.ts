import type { GoalPlanStatus } from "@/lib/financial/goal-planning";

export interface GoalPlanSummary {
  status: GoalPlanStatus;
  goalName: string | null;
  hasGoal: boolean;
  hasDeadline: boolean;
  suppressContributionPush: boolean;
}

export type GoalAwareResultCode =
  | "expense_created"
  | "expense_with_debt_created"
  | "income_created"
  | "goal_contribution_created"
  | "debt_payment_created";

export interface GoalAwareSuffixInput {
  resultCode: GoalAwareResultCode;
  plan?: GoalPlanSummary;
}

// Returns a short, leading-space sentence to append after the base
// transaction reply. Returns "" when the goal context is incomplete or
// the situation doesn't call for goal commentary. Callers can safely
// concatenate.
export function buildGoalAwareSuffix({
  resultCode,
  plan,
}: GoalAwareSuffixInput): string {
  if (!plan || !plan.hasGoal || !plan.goalName) {
    return "";
  }

  const goalName = plan.goalName;
  const suppress = plan.suppressContributionPush;

  if (resultCode === "goal_contribution_created") {
    if (suppress) {
      return ` Queda registrado. ${goalName} sigue protegida, pero por ahora no forcemos más aportes hasta cubrir compromisos.`;
    }
    if (!plan.hasDeadline || plan.status === "missing_deadline") {
      return " Buen avance. Cuando pongamos fecha, Kipu puede decirte cuánto necesitas por semana.";
    }
    if (plan.status === "on_track") {
      return " Vas bien: este aporte mantiene la meta encaminada.";
    }
    if (plan.status === "tight") {
      return " Bien hecho; esta meta está ajustada, así que cada aporte cuenta.";
    }
    if (plan.status === "at_risk" || plan.status === "not_realistic") {
      return " Ayuda, pero con la fecha actual todavía necesitamos ajustar el plan.";
    }
    if (plan.status === "blocked_by_debt_or_margin") {
      return " Queda registrado, pero por ahora no forcemos más aportes hasta cubrir compromisos.";
    }
    if (plan.status === "achieved") {
      return ` ${goalName} ya está cumplida; este extra es bono.`;
    }
    return "";
  }

  if (resultCode === "expense_created") {
    if (suppress || plan.status === "blocked_by_debt_or_margin") {
      return ` ${goalName} sigue protegida; cuidemos tu Saldo.`;
    }
    return "";
  }

  if (resultCode === "expense_with_debt_created") {
    if (
      suppress ||
      plan.status === "blocked_by_debt_or_margin" ||
      plan.status === "at_risk" ||
      plan.status === "not_realistic"
    ) {
      return ` Antes de aportar más a ${goalName}, cuidemos esta tarjeta.`;
    }
    return "";
  }

  if (resultCode === "income_created") {
    if (suppress) {
      return ` Primero cubramos compromisos; después vemos ${goalName}.`;
    }
    if (plan.status === "blocked_by_debt_or_margin") {
      return ` Primero cubramos compromisos; después vemos ${goalName}.`;
    }
    if (plan.status === "on_track" || plan.status === "tight") {
      return ` Si esta plata no tiene dueño todavía, podemos separar algo para ${goalName}.`;
    }
    return "";
  }

  if (resultCode === "debt_payment_created") {
    if (suppress || plan.status === "blocked_by_debt_or_margin") {
      return ` Esto también protege ${goalName}, aunque no sea un aporte directo.`;
    }
    return "";
  }

  return "";
}
