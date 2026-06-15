import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import {
  computeStreakDays,
  computeWeekSpend,
  type RecentTxLite,
} from "@/lib/financial/activity-insights";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { formatKipuMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { DashboardMetricCard } from "./components/DashboardMetricCard";
import { MargenRing } from "./components/MargenRing";
import { MovementRow } from "./components/MovementRow";
import { PulsoOrb, pulsoBand } from "./components/PulsoOrb";
import { UpcomingCommitmentsCard } from "./components/UpcomingCommitmentsCard";
import {
  buildDashboardInsight,
  buildMetricViews,
  describeMovement,
  getMargenHeroClasses,
  scoreLabel,
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

  // One query feeds everything "alive": activity preview, week pace, streak.
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { data: recentTransactions } = await supabase
    .from("transactions")
    .select("id, description, category, base_amount, base_currency, type, occurred_at, debt_account_id, goal_id, related_transaction_id")
    .eq("user_id", session.user.id)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(200);

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

  const { weekSpend, todaySpend } = computeWeekSpend(txList as RecentTxLite[], now);
  const streak = computeStreakDays(txList as RecentTxLite[], now);
  const airTotal = Math.max(0, mk.margenWeekly) + weekSpend;
  const ringFraction =
    mk.status === "negative" ? 0 : airTotal > 0 ? Math.max(0, mk.margenWeekly) / airTotal : 1;

  const insight = buildDashboardInsight({
    margenWeekly: mk.margenWeekly,
    margenDaily: mk.margenDaily,
    margenStatus: mk.status,
    daysRemainingInWeek: mk.daysRemainingInWeek,
    todaySpend,
    weekSpend,
    cardsDueSoon: briefing.cardsDueSoon,
    goalName: mainGoal.name,
    goalHasDeadline: Boolean(mainGoal.targetDate),
    goalTarget: mainGoal.targetAmount,
    baseCurrency,
  });

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
    <div className="mx-auto w-full max-w-5xl pb-28 lg:pb-12">
      {/* Greeting */}
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
            Tu semana
          </p>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
              {firstName ? `Hola, ${firstName}` : "Hola"}
            </h1>
            {streak >= 2 && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                <svg aria-hidden className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 .5C16.5 13 18 11 17 7c3 2 5 5.5 5 9a8 8 0 1 1-16 0c0-5 4-7 6-14Z" />
                </svg>
                {streak} días
              </span>
            )}
          </div>
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
        <div className="mt-5 rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3">
          <p className="text-xs font-medium text-zinc-400">
            {briefing.engagementMode === "paused"
              ? "Recordatorios en pausa. Cuando quieras, retomamos suave."
              : "Modo ligero activo. Te acompaño sin insistir."}
          </p>
        </div>
      )}

      {/* Two intentional columns on desktop; calm stack on mobile */}
      <div className="mt-5 flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
        {/* Left: hero + insight + upcoming */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* HERO — Margen Kipu ring */}
          <Link
            href="/app/margen"
            className={`block rounded-3xl p-6 shadow-2xl transition sm:p-8 ${hero.bg}`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/40">
                Tu Margen Kipu
              </p>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${hero.badge}`}>
                {hero.badgeLabel}
              </span>
            </div>
            <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
              <MargenRing fraction={ringFraction} status={mk.status} size={176}>
                <p className={`px-4 text-3xl font-black leading-none tracking-tight ${hero.value}`}>
                  {formatKipuMoney(mk.margenWeekly, baseCurrency)}
                </p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-white/40">
                  esta semana
                </p>
              </MargenRing>
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <p className="text-sm font-medium text-white/60">
                  {mk.status === "negative"
                    ? `${mk.daysRemainingInWeek} días hasta el domingo`
                    : `≈ ${formatKipuMoney(mk.margenDaily, baseCurrency)} por día · ${mk.daysRemainingInWeek} día${mk.daysRemainingInWeek === 1 ? "" : "s"} hasta el domingo`}
                </p>
                <p className="mt-3 text-sm leading-6 text-white/75">
                  {mk.status === "negative"
                    ? "Los compromisos se comen el margen esta semana. Frena lo no esencial y se reacomoda; tu meta sigue protegida."
                    : "Para gastar tranquilo. Tus pagos, deudas, ahorro y meta ya están descontados — eso ya lo cuidé yo."}
                </p>
                <p className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-white/45">
                  Ver cómo se forma
                  <span aria-hidden>→</span>
                </p>
              </div>
            </div>
          </Link>

          {/* Insight — specific and decision-ready */}
          <section className="rounded-3xl border border-emerald-400/25 bg-emerald-950/50 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400/80">
              {insight.kicker}
            </p>
            <p className="mt-2 text-base font-semibold leading-7 text-emerald-50">
              {insight.text}
            </p>
            {insight.href && insight.cta && (
              <Link
                href={insight.href}
                className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-emerald-300"
              >
                {insight.cta}
                <span aria-hidden>→</span>
              </Link>
            )}
          </section>

          <UpcomingCommitmentsCard
            baseCurrency={baseCurrency}
            cardsDueSoon={briefing.cardsDueSoon}
            upcomingPayments={briefing.upcomingPayments}
          />
        </div>

        {/* Right: Pulso signature + wellness system + activity preview */}
        <div className="flex min-w-0 flex-col gap-5">
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">
              Tu estado
            </p>

            {/* Pulso Kipu — the living wellness identity */}
            <Link
              href="/app/readiness"
              className="flex items-center gap-5 rounded-3xl border border-white/5 bg-gradient-to-b from-zinc-900 to-zinc-950 p-4 transition hover:border-white/15"
            >
              <PulsoOrb score={briefing.metrics.financialReadiness} size={112}>
                <p className="text-3xl font-black tracking-tight text-zinc-50">
                  {briefing.metrics.financialReadiness}
                </p>
              </PulsoOrb>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                  Pulso Kipu
                </p>
                <p
                  className={`mt-1 text-lg font-black leading-tight ${
                    pulsoBand(briefing.metrics.financialReadiness) === "high"
                      ? "text-emerald-300"
                      : pulsoBand(briefing.metrics.financialReadiness) === "mid"
                        ? "text-amber-300"
                        : "text-rose-300"
                  }`}
                >
                  {scoreLabel(briefing.metrics.financialReadiness)}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-600">
                  El estado vivo de tu semana financiera. Tócalo para ver qué lo mueve.
                </p>
              </div>
            </Link>

            <div className="mt-3 grid grid-cols-2 gap-3">
              {metricViews
                .filter((m) => m.label !== "Readiness")
                .map((m) => (
                  <div key={m.label} className={m.label === "Meta" ? "col-span-2" : ""}>
                    <DashboardMetricCard metric={m} />
                  </div>
                ))}
            </div>
          </section>

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
                {txList.slice(0, 4).map((tx) => (
                  <MovementRow key={tx.id} view={describeMovement(tx)} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
