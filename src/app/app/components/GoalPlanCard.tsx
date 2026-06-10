import { formatKipuMoney } from "@/lib/financial/money";
import type { GoalPlan } from "@/lib/financial/goal-planning";
import type { FinancialGoal } from "@/types/financial";
import { getGoalStatusColor } from "./app-dashboard-helpers";

interface GoalPlanCardProps {
  mainGoal: FinancialGoal;
  goalPlan: GoalPlan;
}

export function GoalPlanCard({ mainGoal, goalPlan }: GoalPlanCardProps) {
  return (
    <section className="rounded-3xl border border-emerald-400/20 bg-zinc-900 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-zinc-500">Meta principal</p>
          <h2 className="mt-0.5 text-lg font-bold leading-tight text-zinc-50">
            {mainGoal.name}
          </h2>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-black text-emerald-400">
            {goalPlan.progressPercentage}%
          </p>
          <p className={`text-xs font-semibold ${getGoalStatusColor(goalPlan.status)}`}>
            {goalPlan.statusLabel}
          </p>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-700">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${goalPlan.progressPercentage}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-zinc-500">
          {formatKipuMoney(goalPlan.currentAmount, mainGoal.currency)} ahorrado
        </span>
        <span className="font-semibold text-zinc-200">
          {goalPlan.remainingAmount > 0
            ? `Falta ${formatKipuMoney(goalPlan.remainingAmount, mainGoal.currency)}`
            : "¡Meta cumplida!"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-400">{goalPlan.message}</p>
      {!goalPlan.suppressContributionPush &&
        goalPlan.requiredWeeklyContribution !== null &&
        goalPlan.requiredWeeklyContribution > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-zinc-800 p-3">
            <div>
              <p className="text-xs text-zinc-500">Por semana</p>
              <p className="text-sm font-bold text-zinc-100">
                {formatKipuMoney(goalPlan.requiredWeeklyContribution, mainGoal.currency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Por mes</p>
              <p className="text-sm font-bold text-zinc-100">
                {formatKipuMoney(goalPlan.requiredMonthlyContribution!, mainGoal.currency)}
              </p>
            </div>
          </div>
        )}
      {goalPlan.dataQuality === "initial" && goalPlan.status !== "achieved" && (
        <p className="mt-2 text-xs text-zinc-600">
          Estimación inicial — registra ingresos y gastos para afinar el plan.
        </p>
      )}
    </section>
  );
}
