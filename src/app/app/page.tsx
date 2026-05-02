import { redirect } from "next/navigation";
import {
  demoAccounts,
  demoDebtAccounts,
  demoGoal,
  demoRecurringExpenses,
  demoVariableBudgetEstimates,
} from "@/lib/financial/demo-data";
import { buildFinancialDashboard } from "@/lib/financial/dashboard";
import { formatMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function AppPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const dashboard = buildFinancialDashboard({
    accounts: demoAccounts,
    debtAccounts: demoDebtAccounts,
    recurringExpenses: demoRecurringExpenses,
    variableBudgetEstimates: demoVariableBudgetEstimates,
    goal: demoGoal,
    monthlyIncome: 1000,
    estimatedMonthlySavingsCapacity: 100,
    monthsRemainingForGoal: 6,
  });

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-md flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl">
          <p className="text-sm font-medium text-emerald-300">FinCoach</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Hola, seguimos con Brasil
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Sesión activa como <strong>{session.user.email}</strong>. Por ahora este dashboard usa datos demo; luego lo conectaremos a tu perfil real.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-500">Meta principal</p>
              <h2 className="mt-1 text-2xl font-bold">{demoGoal.name}</h2>
            </div>
           <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              Desafiante
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-zinc-600">Progreso</span>
              <span className="font-bold">
                {dashboard.goalProgress.progressPercentage}%
              </span>
            </div>
            <div className="mt-2 h-4 overflow-hidden rounded-full bg-zinc-200">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${dashboard.goalProgress.progressPercentage}%` }}
              />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-zinc-100 p-4">
              <p className="text-xs font-medium text-zinc-500">Ahorrado</p>
              <p className="mt-1 text-xl font-bold">
                {formatMoney(dashboard.goalProgress.currentAmount, demoGoal.currency)}
              </p>
            </div>
            <div className="rounded-2xl bg-zinc-100 p-4">
              <p className="text-xs font-medium text-zinc-500">Falta</p>
              <p className="mt-1 text-xl font-bold">
                {formatMoney(dashboard.goalProgress.remainingAmount, demoGoal.currency)}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
          <p className="text-sm font-medium text-emerald-200">Dinero flexible real</p>
          <p className="mt-2 text-4xl font-black tracking-tight">
            {formatMoney(
              dashboard.flexibleSpending.flexibleSpending,
              dashboard.flexibleSpending.baseCurrency,
            )}
          </p>
          <p className="mt-3 text-sm leading-6 text-emerald-50/80">
            Esto es lo que podrías gastar sin dañar tu meta ni llar pagos importantes.
          </p>
        </section>

        <section className="rounded-3xl bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-400">Coach</p>
          <p className="mt-3 text-lg font-semibold leading-7">
            “Ese café no nos va a arruinar, pero escondérmelo sí.”
          </p>
        </section>
      </section>
    </main>
  );
}
