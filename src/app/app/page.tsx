import { redirect } from "next/navigation";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { formatMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { signOutAction } from "./actions";
import { sendWebChatMessageAction } from "./transaction-actions";
import { DashboardMetricCard } from "./components/DashboardMetricCard";
import { FlexibleSpendingCard } from "./components/FlexibleSpendingCard";
import { GoalPlanCard } from "./components/GoalPlanCard";
import { KipuUnderstoodCard } from "./components/KipuUnderstoodCard";
import { ManualAdvancedSection } from "./components/ManualAdvancedSection";
import { RecentMovementsCard } from "./components/RecentMovementsCard";
import {
  buildChatExamples,
  computeFinancialAccuracy,
  computeFinancialReadiness,
  computeNextStep,
  getAccuracyMessage,
  getBudgetRealityState,
  getReadinessClasses,
  translateDebtPressure,
} from "./components/app-dashboard-helpers";

export default async function AppPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const ctx = await buildUserFinancialContext(session.user.id);

  const { data: recentTransactions, error: transactionsError } = await supabase
    .from("transactions")
    .select(
      "id, description, category, base_amount, base_currency, type, occurred_at, source_account_id, debt_account_id, goal_id",
    )
    .eq("user_id", session.user.id)
    .order("occurred_at", { ascending: false })
    .limit(5);

  if (transactionsError) {
    throw new Error(transactionsError.message);
  }

  if (!ctx.mainGoal || ctx.accounts.length === 0 || !ctx.dashboard) {
    redirect("/onboarding");
  }

  const { mainGoal, goalPlan, dashboard } = ctx;
  const baseCurrency = ctx.profile.baseCurrency;
  const firstName = ctx.profile.fullName?.split(" ")[0] ?? "";
  const txList = recentTransactions ?? [];
  const noTransactions = txList.length === 0;
  const flexAmount = dashboard.flexibleSpending.flexibleSpending;

  const readiness = computeFinancialReadiness(
    flexAmount,
    dashboard.debtPressure.level,
    dashboard.goalProgress.progressPercentage,
    dashboard.weeklyPlan.status,
  );

  const accuracyScore = computeFinancialAccuracy(
    ctx.summary.activeIncomeSourcesCount > 0,
    ctx.summary.activeFixedExpensesCount > 0,
    txList.length,
    ctx.debtAccounts.length > 0,
    ctx.accounts.length,
  );

  const budgetReality = getBudgetRealityState(txList.length);

  const nextStep = computeNextStep(
    mainGoal,
    dashboard.flexibleSpending.totalAvailableCash,
    ctx.summary.totalDebtBalanceBase,
    noTransactions,
    flexAmount,
    dashboard.debtPressure.level,
  );

  const chatExamples = buildChatExamples(ctx.accounts, ctx.debtAccounts, mainGoal);
  const heroClasses = getReadinessClasses(readiness.mode);

  const flexStatus =
    flexAmount > 100 ? "good" : flexAmount > 30 ? "ok" : flexAmount > 0 ? "warn" : "bad";

  const debtStatus =
    dashboard.debtPressure.level === "none" || dashboard.debtPressure.level === "low"
      ? "good"
      : dashboard.debtPressure.level === "medium"
        ? "ok"
        : dashboard.debtPressure.level === "high"
          ? "warn"
          : "bad";

  const goalStatus =
    dashboard.goalProgress.progressPercentage >= 30
      ? "good"
      : dashboard.goalProgress.progressPercentage >= 10
        ? "ok"
        : dashboard.goalProgress.progressPercentage > 0
          ? "warn"
          : "neutral";

  const accuracyStatus =
    accuracyScore >= 75 ? "good" : accuracyScore >= 55 ? "ok" : accuracyScore >= 35 ? "warn" : "neutral";

  const dailyStatus =
    dashboard.weeklyPlan.status === "healthy"
      ? "good"
      : dashboard.weeklyPlan.status === "tight"
        ? "warn"
        : "bad";

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-md flex-col gap-5">

        {/* Compact nav */}
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-emerald-400">Kipu</p>
            {firstName && <p className="text-xs text-zinc-500">Hola, {firstName}</p>}
          </div>
          <form action={signOutAction}>
            <button
              className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-zinc-400 transition hover:bg-white/10"
              type="submit"
            >
              Salir
            </button>
          </form>
        </header>

        {/* Hero readiness card */}
        <section className={`rounded-3xl p-6 shadow-2xl ${heroClasses.bg}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/40">
              Readiness financiero
            </p>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${heroClasses.badge}`}>
              {readiness.modeLabel}
            </span>
          </div>
          <div className="mt-5 flex items-end gap-2">
            <p className={`text-7xl font-black leading-none tracking-tight ${heroClasses.score}`}>
              {readiness.score}
            </p>
            <p className="mb-2 text-lg font-medium text-white/30">/ 100</p>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${heroClasses.bar}`}
              style={{ width: `${readiness.score}%` }}
            />
          </div>
          <p className="mt-4 text-sm leading-6 text-white/75">{readiness.message}</p>
        </section>

        {/* Metrics grid 2×3 */}
        <section className="grid grid-cols-2 gap-3">
          <DashboardMetricCard
            label="Gasto flexible"
            message={flexAmount > 0 ? "Después de meta, deuda y compromisos" : "Margen negativo esta semana"}
            status={flexStatus}
            value={formatMoney(flexAmount, baseCurrency)}
          />
          <DashboardMetricCard
            label="Meta"
            message={
              dashboard.goalProgress.progressPercentage > 0
                ? `${formatMoney(mainGoal.currentAmount, mainGoal.currency)} de ${formatMoney(mainGoal.targetAmount, mainGoal.currency)}`
                : "Sin aportes aún"
            }
            status={goalStatus}
            value={`${dashboard.goalProgress.progressPercentage}%`}
          />
          <DashboardMetricCard
            label="Presión de deuda"
            message={
              dashboard.debtPressure.monthlyDebtDue > 0
                ? `${formatMoney(dashboard.debtPressure.monthlyDebtDue, baseCurrency)}/mes est.`
                : "Sin pagos de deuda registrados"
            }
            status={debtStatus}
            value={translateDebtPressure(dashboard.debtPressure.level)}
          />
          <DashboardMetricCard
            label="Precisión"
            message={getAccuracyMessage(txList.length)}
            status={accuracyStatus}
            value={`${accuracyScore}%`}
          />
          <DashboardMetricCard
            label="Aprendizaje"
            message={budgetReality.message}
            status="neutral"
            value={budgetReality.label}
          />
          <DashboardMetricCard
            label="Límite diario"
            message={
              flexAmount <= 0
                ? "Primero cubramos compromisos"
                : `${dashboard.weeklyPlan.daysRemainingInWeek} día${dashboard.weeklyPlan.daysRemainingInWeek !== 1 ? "s" : ""} restante${dashboard.weeklyPlan.daysRemainingInWeek !== 1 ? "s" : ""}`
            }
            status={flexAmount <= 0 ? "bad" : dailyStatus}
            value={flexAmount <= 0 ? "Sin margen" : formatMoney(dashboard.weeklyPlan.dailySuggestedLimit, baseCurrency)}
          />
        </section>

        {/* Siguiente mejor paso */}
        <section className="rounded-3xl border border-emerald-400/30 bg-emerald-950/60 p-5">
          <p className="text-sm font-medium text-emerald-400">Tu siguiente mejor paso</p>
          <p className="mt-2 text-lg font-bold leading-7">{nextStep.title}</p>
          <p className="mt-2 text-sm leading-6 text-emerald-100/80">{nextStep.description}</p>
        </section>

        <GoalPlanCard goalPlan={goalPlan} mainGoal={mainGoal} />

        {/* Chat financiero */}
        <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
          <div className="space-y-1">
            <p className="text-sm font-medium text-emerald-200">Chat financiero</p>
            <h2 className="text-xl font-bold text-white">Registra como hablarías</h2>
            <p className="text-sm leading-6 text-emerald-50/80">
              Ejemplos: &ldquo;café 3 visa&rdquo; o &ldquo;mandé 20 a mi meta&rdquo;. Escríbelo
              natural; Kipu intenta ordenarlo por ti.
            </p>
          </div>
          <form action={sendWebChatMessageAction} className="mt-5 flex gap-3">
            <input
              className="min-w-0 flex-1 rounded-2xl border border-emerald-300/20 bg-white px-4 py-3 text-base text-zinc-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
              name="message"
              placeholder="Escribe tu movimiento..."
              required
              type="text"
            />
            <button
              className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-zinc-950 transition hover:bg-emerald-50"
              type="submit"
            >
              Enviar
            </button>
          </form>
        </section>

        <RecentMovementsCard txList={txList} />

        {/* Cómo hablarle a Kipu */}
        <section className="rounded-3xl bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-400">Cómo hablarle a Kipu</p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            Escríbele aquí o en Telegram, en tus propias palabras:
          </p>
          <div className="mt-4 space-y-2">
            {chatExamples.map((example) => (
              <p
                className="rounded-2xl bg-zinc-800 px-4 py-3 font-mono text-sm text-zinc-200"
                key={example}
              >
                &ldquo;{example}&rdquo;
              </p>
            ))}
          </div>
        </section>

        <FlexibleSpendingCard
          flexAmount={flexAmount}
          flexibleSpending={dashboard.flexibleSpending}
        />

        <KipuUnderstoodCard
          baseCurrency={baseCurrency}
          coachPreferences={ctx.coachPreferences}
          debtAccountsCount={ctx.debtAccounts.length}
          mainGoal={mainGoal}
          summary={ctx.summary}
        />

        <ManualAdvancedSection
          accounts={ctx.accounts}
          debtAccounts={ctx.debtAccounts}
          mainGoal={mainGoal}
        />

      </section>
    </main>
  );
}
