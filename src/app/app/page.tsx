import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { formatMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { signOutAction } from "./actions";
import { sendWebChatMessageAction } from "./transaction-actions";
import { DashboardMetricCard } from "./components/DashboardMetricCard";
import { GoalPlanCard } from "./components/GoalPlanCard";
import { KipuUnderstoodCard } from "./components/KipuUnderstoodCard";
import { ManualAdvancedSection } from "./components/ManualAdvancedSection";
import { RecentMovementsCard } from "./components/RecentMovementsCard";
import { UpcomingCommitmentsCard } from "./components/UpcomingCommitmentsCard";
import {
  buildChatExamples,
  getMargenHeroClasses,
  metricStatusFromScore,
  scoreLabel,
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

  // The dashboard reads from the SAME engine as the chat coach, so the numbers
  // always agree. Margen Kipu is the hero; the Whoop-style wellness metrics and
  // the next-best-action come straight from the briefing. Read-only:
  // surfaceNudges=false so viewing the dashboard never consumes the chat's
  // nudge cooldown.
  const snapshot = deriveAdvisorySnapshot(ctx);
  const briefing = await buildCoachingBriefing({
    userId: session.user.id,
    ctx,
    snapshot,
    surfaceNudges: false,
  });
  const mk = briefing.margenKipu;
  const metrics = briefing.metrics;
  const hero = getMargenHeroClasses(mk.status);
  const heroMessage =
    mk.status === "negative"
      ? "Esta semana los compromisos se comen el margen. Cuidemos lo no esencial hasta tu próximo ingreso; tu meta sigue protegida, no cancelada."
      : mk.status === "tight"
        ? "Semana justa. Ya aparté tus pagos, ahorro y meta; esto es lo que queda para moverte sin apretarte."
        : "Esto es lo que puedes gastar tranquilo esta semana, ya descontados tus pagos, gastos, deudas, ahorro y meta.";

  const goalProgressPct = dashboard.goalProgress.progressPercentage;
  const chatExamples = buildChatExamples(ctx.accounts, ctx.debtAccounts, mainGoal);

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

        {/* Engagement banner (pause / light) */}
        {briefing.engagementMode !== "normal" && (
          <section className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3">
            <p className="text-xs font-medium text-zinc-400">
              {briefing.engagementMode === "paused"
                ? "Recordatorios en pausa. Cuando quieras, retomamos suave."
                : "Modo ligero activo. Te acompaño sin insistir."}
            </p>
          </section>
        )}

        {/* HERO — Margen Kipu */}
        <section className={`rounded-3xl p-6 shadow-2xl ${hero.bg}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/40">
              Tu Margen Kipu · esta semana
            </p>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${hero.badge}`}>
              {hero.badgeLabel}
            </span>
          </div>
          <div className="mt-5 flex items-end gap-2">
            <p className={`text-6xl font-black leading-none tracking-tight ${hero.value}`}>
              {formatMoney(mk.margenWeekly, baseCurrency)}
            </p>
          </div>
          <p className="mt-3 text-sm font-medium text-white/55">
            {mk.status === "negative"
              ? `${mk.daysRemainingInWeek} días hasta el domingo`
              : `≈ ${formatMoney(mk.margenDaily, baseCurrency)} por día · ${mk.daysRemainingInWeek} días hasta el domingo`}
          </p>
          <p className="mt-4 text-sm leading-6 text-white/75">{heroMessage}</p>
          <p className="mt-3 text-xs leading-5 text-white/35">
            Tu Margen Kipu es lo que puedes gastar tranquilo después de separar pagos, gastos
            necesarios, deudas, ahorro/inversión y tu meta.
          </p>
        </section>

        {/* Siguiente mejor paso — same source as chat */}
        <section className="rounded-3xl border border-emerald-400/30 bg-emerald-950/60 p-5">
          <p className="text-sm font-medium text-emerald-400">Tu siguiente mejor paso</p>
          <p className="mt-2 text-base font-semibold leading-7 text-emerald-50">
            {briefing.nextBestAction}
          </p>
        </section>

        {/* Lo que viene */}
        <UpcomingCommitmentsCard
          baseCurrency={baseCurrency}
          cardsDueSoon={briefing.cardsDueSoon}
          upcomingPayments={briefing.upcomingPayments}
        />

        {/* Whoop-style wellness metrics — all from the same briefing as chat */}
        <section className="grid grid-cols-2 gap-3">
          <DashboardMetricCard
            label="Readiness"
            message="Qué tan listo vas esta semana"
            status={metricStatusFromScore(metrics.financialReadiness)}
            value={scoreLabel(metrics.financialReadiness)}
          />
          <DashboardMetricCard
            label="Meta"
            message={
              goalProgressPct > 0
                ? `${formatMoney(mainGoal.currentAmount, mainGoal.currency)} de ${formatMoney(mainGoal.targetAmount, mainGoal.currency)}`
                : "Sin aportes aún"
            }
            status={metricStatusFromScore(metrics.goalMomentum)}
            value={`${goalProgressPct}%`}
          />
          <DashboardMetricCard
            label="Presión de deuda"
            message={
              dashboard.debtPressure.monthlyDebtDue > 0
                ? `${formatMoney(dashboard.debtPressure.monthlyDebtDue, baseCurrency)}/mes est.`
                : "Sin pagos de deuda registrados"
            }
            status={metricStatusFromScore(metrics.debtPressure)}
            value={translateDebtPressure(dashboard.debtPressure.level)}
          />
          <DashboardMetricCard
            label="Flexibilidad"
            message="Espacio para gastar sin apretarte"
            status={metricStatusFromScore(metrics.spendingFlexibility)}
            value={scoreLabel(metrics.spendingFlexibility)}
          />
          <DashboardMetricCard
            label="Precisión"
            message="Qué tan completos están tus datos"
            status={metricStatusFromScore(metrics.financialAccuracy)}
            value={scoreLabel(metrics.financialAccuracy)}
          />
          <DashboardMetricCard
            label="Realidad"
            message="Lo que voy aprendiendo de tu gasto real"
            status={metricStatusFromScore(metrics.budgetReality)}
            value={scoreLabel(metrics.budgetReality)}
          />
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
