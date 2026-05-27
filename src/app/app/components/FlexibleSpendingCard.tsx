import { formatMoney } from "@/lib/financial/money";
import { getFlexibleSpendingHelperText } from "./app-dashboard-helpers";

interface FlexibleSpendingData {
  baseCurrency: string;
  totalAvailableCash: number;
  protectedGoalMoney: number;
  upcomingDebtPayments: number;
  upcomingRecurringExpenses: number;
  plannedGoalContribution: number;
}

function FlexibleBreakdownRow({
  label,
  value,
  currency,
  neutral = false,
}: {
  label: string;
  value: number;
  currency: string;
  neutral?: boolean;
}) {
  const sign = neutral ? "" : value > 0 ? "+" : value < 0 ? "-" : "";
  const amount = Math.abs(value);
  return (
    <div className="flex items-center justify-between gap-3 text-zinc-400">
      <span>{label}</span>
      <span className="font-semibold text-zinc-300">
        {sign} {formatMoney(amount, currency)}
      </span>
    </div>
  );
}

export function FlexibleSpendingCard({
  flexAmount,
  flexibleSpending,
}: {
  flexAmount: number;
  flexibleSpending: FlexibleSpendingData;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-zinc-900 p-5">
      <p className="text-sm font-medium text-zinc-400">Desglose del margen flexible</p>
      <p
        className={`mt-1 text-2xl font-black ${flexAmount >= 0 ? "text-emerald-300" : "text-rose-400"}`}
      >
        {formatMoney(flexAmount, flexibleSpending.baseCurrency)}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{getFlexibleSpendingHelperText(flexAmount)}</p>
      <div className="mt-4 space-y-2 border-t border-white/5 pt-4 text-sm">
        <FlexibleBreakdownRow
          currency={flexibleSpending.baseCurrency}
          label="Disponible en cuentas"
          value={flexibleSpending.totalAvailableCash}
        />
        <FlexibleBreakdownRow
          currency={flexibleSpending.baseCurrency}
          label="Protegido en meta"
          neutral
          value={flexibleSpending.protectedGoalMoney}
        />
        <FlexibleBreakdownRow
          currency={flexibleSpending.baseCurrency}
          label="Pagos de deuda"
          value={-flexibleSpending.upcomingDebtPayments}
        />
        <FlexibleBreakdownRow
          currency={flexibleSpending.baseCurrency}
          label="Gastos recurrentes"
          value={-flexibleSpending.upcomingRecurringExpenses}
        />
        <FlexibleBreakdownRow
          currency={flexibleSpending.baseCurrency}
          label="Aporte a meta"
          value={-flexibleSpending.plannedGoalContribution}
        />
      </div>
    </section>
  );
}
