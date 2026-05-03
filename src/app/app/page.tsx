import { redirect } from "next/navigation";
import { buildFinancialDashboard } from "@/lib/financial/dashboard";
import { loadUserFinancialData } from "@/lib/financial/load-user-financial-data";
import { formatMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { signOutAction } from "./actions";

export default async function AppPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const financialData = await loadUserFinancialData(session.user.id);

  if (!financialData.mainGoal || financialData.accounts.length === 0) {
    redirect("/onboarding");
  }

  const dashboard = buildFinancialDashboard({
    accounts: financialData.accounts,
    debtAccounts: financialData.debtAccounts,
    recurringExpenses: [],
    variableBudgetEstimates: [],
    goal: financialData.mainGoal,
    monthlyIncome: 1000,
    estimatedMonthlySavingsCapacity: 100,
    monthsRemainingForGoal: 6,
  });

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-md flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-medium text-emerald-300">FinCoach</p>
            <form action={signOutAction}>
              <button
                className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-zinc-300 transition hover:bg-white/10"
                type="submit"
              >
                Salir
              </button>
            </form>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Hola, seguimos con {financialData.mainGoal.name}
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Sesión activa como <strong>{session.user.email}</strong>. Este dashboard ya usa
            tus cuentas, deudas y meta guardadas en Supabase.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-500">Meta principal</p>
              <h2 className="mt-1 text-2xl font-bold">{financialData.mainGoal.name}</h2>
            </div>
            <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              {translateFeasibility(financialData.mainGoal.feasibilityStatus)}
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
                {formatMoney(
                  dashboard.goalProgress.currentAmount,
                  financialData.mainGoal.currency,
                )}
              </p>
            </div>
            <div className="rounded-2xl bg-zinc-100 p-4">
              <p className="text-xs font-medium text-zinc-500">Falta</p>
              <p className="mt-1 text-xl font-bold">
                {formatMoney(
                  dashboard.goalProgress.remainingAmount,
                  financialData.mainGoal.currency,
                )}
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
            Esto es lo que podrías gastar sin dañar tu meta ni fallar pagos importantes.
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <MetricCard
            label="Cuentas"
            value={String(financialData.accounts.length)}
            helper="Fuentes reales"
          />         <MetricCard
            label="Deudas"
            value={String(financialData.debtAccounts.length)}
            helper="Incluye tarjetas"
          />
          <MetricCard
            label="Debt Pressure"
            value={translateDebtPressure(dashboard.debtPressure.level)}
            helper={formatMoney(
              dashboard.debtPressure.monthlyDebtDue,
              financialData.mainGoal.currency,
            )}
          />
          <MetricCard
            label="Momentum"
            value={`${dashboard.goalProgress.progressPercentage}%`}
            helper="Meta en camino"
          />
        </section>

        <section className="rounded-3xl bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-400">Coach</p>
          <p className="mt-3 text-lg font-semibold leading-7">
            “Ya tengo tus cuentas, tus deudas y tu meta. Ahora sí podemos dejar de imaginar
            y empezar a manejar plata real.”
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

function translateDebtPressure(level: string): string {
  const labels: Record<string, string> = {
    none: "Nula",
    low: "Baja",
    medium: "Media",
    high: "Alta",
    critical: "Crítica",
  };

  return labels[level] ?? level;
}

function translateFeasibility(status: string): string {
  const labels: Record<string, string> = {
    viable: "Viable",
    challenging: "Desafiante",
    at_risk: "En riesgo",
    not_currently_viable: "No viable",
    paused_due_to_financial_health: "Pausada",
  };

  return labels[status] ?? status;
}
