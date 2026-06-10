import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { formatKipuMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { DashboardMetricCard } from "./components/DashboardMetricCard";
import { MovementRow } from "./components/MovementRow";
import { UpcomingCommitmentsCard } from "./components/UpcomingCommitmentsCard";
import {
  buildMetricViews,
  describeMovement,
  getMargenHeroClasses,
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

  if (!ctx.mainGoal || ctx.accounts.length === 0 || !ctx.dashboard) {
    redirect("/onboarding");
  }

  const { data: recentTransactions } = await supabase
    .from("transactions")
    .select("id, description, category, base_amount, base_currency, type, occurred_at, debt_account_id, goal_id")
    .eq("user_id", session.user.id)
    .order("occurred_at", { ascending: false })
    .limit(3);

  const { mainGoal, dashboard } = ctx;
  const baseCurrency = ctx.profile.baseCurrency;
  const firstName = ctx.profile.fullName?.split(" ")[0] ?? "";
  const txList = recentTransactions ?? [];

  // Same engine as the chat coach → dashboard and chat can't disagree. Read-only.
  const snapshot = deriveAdvisorySnapshot(ctx);
  const briefing = await buildCoachingBriefing({
    userId: session.user.id,
    ctx,
    snapshot,
    surfaceNudges: false,
  });
  const mk = briefing.margenKipu;
  const hero = getMargenHeroClasses(mk.status);
  const heroMessage =
    mk.status === "negative"
      ? "Esta semana los compromisos se comen el margen. Cuidemos lo no esencial hasta tu próximo ingreso; tu meta sigue protegida."
      : mk.status === "tight"
        ? "Semana justa. Ya aparté tus pagos, ahorro y meta; esto es lo que queda para moverte sin apretarte."
        : "Esto es lo que puedes gastar tranquilo esta semana, ya descontados tus pagos, gastos, deudas, ahorro y meta.";

  const metricViews = buildMetricViews({
    metrics: briefing.metrics,
    goalCurrent: mainGoal.currentAmount,
    goalTarget: mainGoal.targetAmount,
    goalCurrency: mainGoal.currency,
    goalHasDeadline: Boolean(mainGoal.targetDate),
    goalProgressPct: dashboard.goalProgress.progressPercentage,
    debtLevel: dashboard.debtPressure.level,
    baseCurrency,
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Greeting */}
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
            Tu semana
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-50">
            {firstName ? `Hola, ${firstName}` : "Hola"}
          </h1>
        </div>
        <Link
          href="/app/chat"
          className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
        >
          Hablar con Kipu
        </Link>
      </header>

      {/* Engagement banner */}
      {briefing.engagementMode !== "normal" && (
        <div className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3">
          <p className="text-xs font-medium text-zinc-400">
            {briefing.engagementMode === "paused"
              ? "Recordatorios en pausa. Cuando quieras, retomamos suave."
              : "Modo ligero activo. Te acompaño sin insistir."}
          </p>
        </div>
      )}

      {/* HERO — Margen Kipu (tap to see how it's formed) */}
      <Link href="/app/margen" className={`block rounded-3xl p-6 shadow-2xl transition ${hero.bg}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/40">
            Tu Margen Kipu · esta semana
          </p>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${hero.badge}`}>
            {hero.badgeLabel}
          </span>
        </div>
        <p className={`mt-5 text-6xl font-black leading-none tracking-tight ${hero.value}`}>
          {formatKipuMoney(mk.margenWeekly, baseCurrency)}
        </p>
        <p className="mt-3 text-sm font-medium text-white/55">
          {mk.status === "negative"
            ? `${mk.daysRemainingInWeek} días hasta el domingo`
            : `≈ ${formatKipuMoney(mk.margenDaily, baseCurrency)} por día · ${mk.daysRemainingInWeek} días hasta el domingo`}
        </p>
        <p className="mt-4 text-sm leading-6 text-white/75">{heroMessage}</p>
        <p className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-white/45">
          Ver cómo se forma
          <span aria-hidden>→</span>
        </p>
      </Link>

      {/* Insight — the one thing to know today (same source as chat) */}
      <section className="rounded-3xl border border-emerald-400/25 bg-emerald-950/50 p-5">
        <p className="text-sm font-medium text-emerald-400">Lo que yo cuidaría hoy</p>
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

      {/* Whoop-style wellness metrics */}
      <section>
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">
          Tu estado
        </p>
        <div className="grid grid-cols-2 gap-3">
          {metricViews.map((m) => (
            <DashboardMetricCard
              key={m.label}
              href={m.href}
              label={m.label}
              message={m.message}
              status={m.status}
              value={m.value}
            />
          ))}
        </div>
      </section>

      {/* Recent activity preview */}
      <section className="rounded-3xl border border-white/5 bg-zinc-900 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-300">Actividad reciente</p>
          <Link href="/app/activity" className="text-xs font-semibold text-emerald-400">
            Ver todo
          </Link>
        </div>
        {txList.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            Aún no hay movimientos. Cuéntale a Kipu tu primer gasto o ingreso.
          </p>
        ) : (
          <div className="mt-1 divide-y divide-white/5">
            {txList.map((tx) => (
              <MovementRow key={tx.id} view={describeMovement(tx)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
