import { formatMoney } from "@/lib/financial/money";
import type { CoachPreferences, FinancialGoal } from "@/types/financial";
import { translateCoachTone } from "./app-dashboard-helpers";

interface KipuUnderstoodCardProps {
  summary: {
    activeIncomeSourcesCount: number;
    activeFixedExpensesCount: number;
    estimatedMonthlyIncome: number;
    estimatedMonthlyFixedExpenses: number;
    totalDebtBalanceBase: number;
  };
  debtAccountsCount: number;
  mainGoal: FinancialGoal;
  baseCurrency: string;
  coachPreferences: CoachPreferences | null;
}

function ContextRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className="font-semibold text-white">{detail}</span>
    </div>
  );
}

export function KipuUnderstoodCard({
  summary,
  debtAccountsCount,
  mainGoal,
  baseCurrency,
  coachPreferences,
}: KipuUnderstoodCardProps) {
  return (
    <section className="rounded-3xl border border-white/10 bg-zinc-900 p-5">
      <p className="text-sm font-medium text-zinc-400">Lo que Kipu entendió de ti</p>
      <div className="mt-4 space-y-3">
        {summary.activeIncomeSourcesCount > 0 && (
          <ContextRow
            detail={`~${formatMoney(summary.estimatedMonthlyIncome, baseCurrency)}/mes`}
            label={`${summary.activeIncomeSourcesCount} fuente${summary.activeIncomeSourcesCount !== 1 ? "s" : ""} de ingreso`}
          />
        )}
        {summary.activeFixedExpensesCount > 0 && (
          <ContextRow
            detail={`~${formatMoney(summary.estimatedMonthlyFixedExpenses, baseCurrency)}/mes`}
            label={`${summary.activeFixedExpensesCount} gasto${summary.activeFixedExpensesCount !== 1 ? "s" : ""} fijo${summary.activeFixedExpensesCount !== 1 ? "s" : ""}`}
          />
        )}
        {debtAccountsCount > 0 && (
          <ContextRow
            detail={formatMoney(summary.totalDebtBalanceBase, baseCurrency)}
            label={`${debtAccountsCount} deuda${debtAccountsCount !== 1 ? "s" : ""} registrada${debtAccountsCount !== 1 ? "s" : ""}`}
          />
        )}
        <ContextRow
          detail={`${formatMoney(mainGoal.currentAmount, mainGoal.currency)} de ${formatMoney(mainGoal.targetAmount, mainGoal.currency)}`}
          label={`Meta: ${mainGoal.name}`}
        />
        {coachPreferences && (
          <ContextRow
            detail={translateCoachTone(coachPreferences.tone)}
            label="Estilo de guía"
          />
        )}
      </div>
    </section>
  );
}
