import {
  demoAccounts,
  demoDebtAccounts,
  demoGoal,
  demoRecurringExpenses,
  demoVariableBudgetEstimates,
} from "@/lib/financial/demo-data";
import { calculateFlexibleSpending } from "@/lib/financial/flexible-spending";
import { formatMoney } from "@/lib/financial/money";

function calculateGoalProgress(currentAmount: number, targetAmount: number): number {
  if (targetAmount <= 0) return 0;
  return Math.min(Math.round((currentAmount / targetAmount) * 100), 100);
}

export default function Home() {
  const flexibleSpending = calculateFlexibleSpending({
    accounts: demoAccounts,
    debtAccounts: demoDebtAccounts,
    recurringExpenses: demoRecurringExpenses,
    plannedGoalContribution: demoGoal.weeklyRequiredAmount,
    baseCurrency: demoGoal.currency,
  });

  const goalProgress = calculateGoalProgress(demoGoal.currentAmount, demoGoal.targetAmount);

  const foodEstimate = demoVariableBudgetEstimates.find(
    (estimate) => estimate.category === "food",
  );

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-md flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl">
          <p className="text-sm font-medium text-emerald-300">FinCoach MVP</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Tu coach financiero de bolsillo
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            No se trata de dejar de vivir. Se trata de llegar a tu meta con la vida real,
            no con una versión perfecta de ti.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-500">Meta principal</p>
              <h2 className="mt-1 text-2xl font-bold">{demoGoal.name}</h2>
            </div>
            <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              {demoGoal.feasibilityStatus === "challenging" ? "Desafiante" : "Activa"}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-zinc-600">Progreso</span>
              <span className="font-bold">{goalProgress}%</span>
            </div>
            <div className="mt-2 h-4 overflow-hidden rounded-full bg-zinc-200">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${goalProgress}%` }}
              />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-zinc-100 p-4">
              <p className="text-xs font-medium text-zinc-500">Ahorrado</p>
              <p className="mt-1 text-xl font-bold">
                {formatMoney(demoGoal.currentAmount, demoGoal.currency)}
              </p>
            </div>
            <div className="rounded-2xl bg-zinc-100 p-4">
              <p className="text-xs font-medium text-zinc-500">Objetivo</p>
              <p className="mt-1 text-xl font-bold">
                {formatMoney(demoGoal.targetAmount, demoGoal.currency)}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
          <p className="text-sm font-medium text-emerald-200">Dinero flexible real</p>
          <p className="mt-2 text-4xl font-black tracking-tight">
            {formatMoney(flexibleSpending.flexibleSpending, flexibleSpending.baseCurrency)}
          </p>
          <p className="mt-3 text-sm leading-6 text-emerald-50/80">
            Esto es lo que podrías gastar sin dañar tu meta ni fallar pagos importantes.
            Si gastas más, Brasil empieza a sufrir un poquito.
          </p>
     </section>

        <section className="grid grid-cols-2 gap-3">
          <MetricCard label="Readiness" value="72%" helper="Semana manejable" />
          <MetricCard label="Momentum" value="63%" helper="Brasil sigue vivo" />
          <MetricCard label="Debt Pressure" value="Media" helper="Visa bajo control" />
          <MetricCard label="Accuracy" value="84%" helper="Datos confiables" />
        </section>

        <section className="rounded-3xl bg-white/10 p-5">
          <p className="text-sm font-medium text-zinc-300">Budget Reality</p>
          <h3 className="mt-2 text-xl font-bold">Comida no era tan inocente 👀</h3>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Pensábamos que comida estaba cerca de{" "}
            <strong>{formatMoney(foodEstimate?.initialEstimate ?? 0, "USD")}</strong>, pero
            tu realidad va más cerca de{" "}
            <strong>{formatMoney(foodEstimate?.currentEstimate ?? 0, "USD")}</strong>.
            No pasa nada. Ahora podemoanear con números reales.
          </p>
        </section>

        <section className="rounded-3xl bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-400">Coach</p>
          <p className="mt-3 text-lg font-semibold leading-7">
            “Hoy no registramos nada… ¿día austero o te estás haciendo el loco conmigo?”
          </p>
        </section>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <article className="rounded-3xl bg-white p-4 text-zinc-950 shadow-xl">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{helper}</p>
    </article>
  );
}
