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
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { loadSnapshotSeries } from "@/lib/trends/snapshot-store";
import { loadPersonalityResult } from "@/lib/personality/personality-store";
import { loadFxRates } from "@/lib/fx/fx-store";
import { findRate } from "@/lib/fx/fx-rates";
import { DisplayCurrencyToggle } from "./components/DisplayCurrencyToggle";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { DashboardMetricCard } from "./components/DashboardMetricCard";
import { MargenRing } from "./components/MargenRing";
import { MovementRow } from "./components/MovementRow";
import { PulsoOrb, pulsoBand } from "./components/PulsoOrb";
import { UpcomingCommitmentsCard } from "./components/UpcomingCommitmentsCard";
import { ConfidenceChip, ConfidenceNote, MargenEmptyState } from "./components/MargenConfidence";
import { MargenBreakdownReveal } from "./components/MargenBreakdown";
import { TrendStrip, type TrendItem } from "./components/DashboardCards";
import { DashboardSecondary } from "./components/DashboardSecondary";
import { LivingThread } from "./components/living/LivingThread";
import { Chevron, PressCard } from "./components/living/shell";
import {
  buildDashboardInsight,
  buildMetricViews,
  describeMovement,
  getMargenHeroClasses,
  scoreLabel,
} from "./components/app-dashboard-helpers";

// Each trend pill drills into the page that explains that metric.
const TREND_METRIC_META: Record<string, { label: string; href: string }> = {
  margenWeekly: { label: "Margen", href: "/app/margen" },
  safeWeekly: { label: "Gasto seguro", href: "/app/margen" },
  netWorth: { label: "Patrimonio", href: "/app/wealth" },
  totalDebt: { label: "Deuda", href: "/app/debt" },
  readiness: { label: "Pulso", href: "/app/readiness" },
};

// Known ?message codes → calm human copy. Anything else renders NOTHING (raw
// codes or DB errors never leak into the UI).
const NOTICES: Record<string, { text: string; tone: "emerald" | "amber" | "zinc" }> = {
  "onboarding-completed": {
    text: "¡Listo! Kipu ya conoce tu plata. Este es tu Resumen.",
    tone: "emerald",
  },
  "onboarding-already-completed": {
    text: "Ya habías completado tu configuración.",
    tone: "zinc",
  },
  "goal-contribution-created": { text: "Aporte registrado ✓", tone: "emerald" },
  "goal-contribution-fx-missing": {
    text: "Ese aporte cruza monedas y no tengo la tasa — configúrala en Ajustes → Tipo de cambio.",
    tone: "amber",
  },
};

const NOTICE_TONE_CLASSES: Record<"emerald" | "amber" | "zinc", string> = {
  emerald: "border-emerald-400/25 bg-emerald-950/50 text-emerald-100",
  amber: "border-amber-400/25 bg-amber-950/40 text-amber-100",
  zinc: "border-line/10 bg-zinc-900 text-zinc-300",
};

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  // hasOwnProperty guard: ?message=constructor must not hit inherited keys.
  const notice =
    message && Object.prototype.hasOwnProperty.call(NOTICES, message) ? NOTICES[message] : undefined;
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
  // Stage 24 — WEB-ONLY display currency. `disp` re-expresses base-currency numbers
  // into the user's chosen display currency at READ time (no stored amount changes);
  // it is byte-identical to base formatting when displayCurrency === base or no rate
  // exists — so single-currency users see exactly what they saw before.
  const displayCurrency = ctx.profile.displayCurrency; // undefined => native no-op
  const manualRates = await loadFxRates(session.user.id);
  const disp = makeDisplayFormatter(baseCurrency, displayCurrency, manualRates);
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
  // Brand-new / data-thin: no liquid money AND/OR no income → the "0$" is only
  // "aún no tengo datos", never a spendable number to scold. Show an empty state
  // with the prefill actions instead of a bald 0 with an amber "cuida el ritmo".
  const noIncomeGap = mk.marginGaps.some((g) => g.code === "no_income");
  const isMargenEmpty =
    mk.margenWeekly <= 0 && (mk.liquidCash <= 0 || (noIncomeGap && !mk.essentialsKnown));

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
    formatMoney: disp,
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
    formatMoney: disp,
  });

  // Stage 20 PASS 2 — new surfaces: honest snapshot history, trend, personality, FX.
  const nowMs = now.getTime();
  const snapSeries = await loadSnapshotSeries(session.user.id, 30, nowMs);
  const margenSeries = snapSeries.map((s) => s.margenWeekly);
  const netWorthSeries = snapSeries.map((s) => s.netWorth);
  const trendItems: TrendItem[] = briefing.trend.trends
    .filter((t) => TREND_METRIC_META[t.metric])
    .map((t) => ({
      label: TREND_METRIC_META[t.metric].label,
      href: TREND_METRIC_META[t.metric].href,
      direction: t.direction,
      deltaPct: t.deltaPct,
      isImprovement: t.isImprovement,
    }));

  const personalityRes = await loadPersonalityResult(session.user.id);
  const personality = {
    taken: Boolean(personalityRes),
    archetypeLabel: personalityRes?.archetypeLabel ?? null,
  };

  // FX surface only when the user actually touches a non-base currency or set a
  // manual rate. Honest: the rate comes from a KNOWN manual rate or is null
  // ("sin tasa"); the dashboard NEVER calls the provider/network.
  const codeSet = new Set<string>(
    ctx.accounts.map((a) => a.currency).filter((c): c is typeof baseCurrency => Boolean(c) && c !== baseCurrency),
  );
  for (const r of manualRates) {
    if (r.from && r.from !== baseCurrency) codeSet.add(r.from as typeof baseCurrency);
    if (r.to && r.to !== baseCurrency) codeSet.add(r.to as typeof baseCurrency);
  }
  const fx =
    codeSet.size > 0
      ? {
          base: baseCurrency,
          lines: Array.from(codeSet).map((code) => {
            const r = findRate(code, baseCurrency, manualRates);
            return { code, rateToBase: r ? Math.round(r.rate * 10000) / 10000 : null, source: r?.source ?? null };
          }),
        }
      : null;

  // The toggle only appears when the user actually has a second currency to switch to.
  const altCurrency = Array.from(codeSet)[0] ?? null;
  const toggleHasRate = altCurrency ? findRate(baseCurrency, altCurrency, manualRates) != null : false;

  return (
    <div className="mx-auto w-full max-w-5xl pb-28 lg:pb-12">
      {/* Greeting */}
      <header className="kipu-fade-up flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
            Tu semana
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-3">
            <h1 className="truncate text-2xl font-bold tracking-tight text-zinc-50">
              {firstName ? `Hola, ${firstName}` : "Hola"}
            </h1>
            {streak >= 2 && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                <svg aria-hidden className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 .5C16.5 13 18 11 17 7c3 2 5 5.5 5 9a8 8 0 1 1-16 0c0-5 4-7 6-14Z" />
                </svg>
                {streak} días
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {altCurrency && (
            <DisplayCurrencyToggle
              base={baseCurrency}
              alt={altCurrency}
              active={displayCurrency ?? baseCurrency}
              hasRate={toggleHasRate}
            />
          )}
          <Link
            href="/app/settings"
            aria-label="Ajustes"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line/10 text-zinc-400 transition hover:border-line/20 hover:text-zinc-200"
          >
            <svg aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.3 3.3a1.5 1.5 0 0 1 3.4 0l.2 1.1a7 7 0 0 1 1.7 1l1-.5a1.5 1.5 0 0 1 1.9 2l-.5 1a7 7 0 0 1 0 2l.5 1a1.5 1.5 0 0 1-1.9 2l-1-.5a7 7 0 0 1-1.7 1l-.2 1.1a1.5 1.5 0 0 1-3.4 0l-.2-1.1a7 7 0 0 1-1.7-1l-1 .5a1.5 1.5 0 0 1-1.9-2l.5-1a7 7 0 0 1 0-2l-.5-1a1.5 1.5 0 0 1 1.9-2l1 .5a7 7 0 0 1 1.7-1Z"
              />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          </Link>
          <Link
            href="/app/chat"
            className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          >
            Hablar con Kipu
          </Link>
        </div>
      </header>

      {/* One-shot notice from a redirect (?message=...) — known codes only */}
      {notice && (
        <div
          className={`kipu-fade-up mt-5 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${NOTICE_TONE_CLASSES[notice.tone]}`}
        >
          <p className="text-sm font-medium leading-6">{notice.text}</p>
          <Link
            href="/app"
            aria-label="Cerrar aviso"
            className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold opacity-50 transition hover:opacity-100"
          >
            ✕
          </Link>
        </div>
      )}

      {/* Engagement banner — tapping it lands in chat to retomar */}
      {briefing.engagementMode !== "normal" && (
        <Link
          href="/app/chat"
          className="kipu-press group mt-5 flex items-center justify-between gap-3 rounded-2xl border border-line/10 bg-zinc-900 px-4 py-3 hover:border-line/20"
        >
          <p className="text-xs font-medium text-zinc-400">
            {briefing.engagementMode === "paused"
              ? "Recordatorios en pausa. Cuando quieras, retomamos suave."
              : "Modo ligero activo. Te acompaño sin insistir."}
          </p>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-400">
            Hablar con Kipu
            <Chevron />
          </span>
        </Link>
      )}

      {/* Two intentional columns on desktop; calm stack on mobile */}
      <div className="mt-5 flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
        {/* Left: hero + insight + upcoming */}
        <div className="kipu-stagger flex min-w-0 flex-col gap-5">
          {/* HERO — Margen Kipu ring, woven in its living quipu strand. When the
              number is trustworthy the whole card taps into /app/margen. When
              it's data-thin (empty state or a confidence note with an action),
              the card is a plain container so the inner action links stay valid
              (no nested anchors) — the ring itself still drills into /app/margen. */}
          {isMargenEmpty || mk.confidence !== "solid" ? (
            <div className={`group block rounded-3xl p-6 shadow-2xl sm:p-8 ${hero.bg}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-line/40">
                  Tu Margen Kipu
                </p>
                {isMargenEmpty ? (
                  <span className="rounded-full bg-line/10 px-3 py-1 text-xs font-bold text-line/60">
                    Aún calculando
                  </span>
                ) : (
                  <ConfidenceChip confidence={mk.confidence} />
                )}
              </div>
              <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
                <Link href="/app/margen" aria-label="Ver cómo se forma tu Margen" className="kipu-press">
                  <LivingThread tone={mk.status === "negative" ? "alert" : mk.status} size={220}>
                    <MargenRing fraction={ringFraction} status={mk.status} size={176}>
                      <p className={`px-4 text-3xl font-black leading-none tracking-tight ${hero.value}`}>
                        {disp(mk.margenWeekly)}
                      </p>
                      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-line/40">
                        esta semana
                      </p>
                    </MargenRing>
                  </LivingThread>
                </Link>
                <div className="min-w-0 flex-1 text-center sm:text-left">
                  {isMargenEmpty ? (
                    <MargenEmptyState marginGaps={mk.marginGaps} />
                  ) : (
                    <>
                      <p className="text-sm font-medium text-line/60">
                        {mk.status === "negative"
                          ? `${mk.daysRemainingInWeek} días hasta el domingo`
                          : `≈ ${disp(mk.margenDaily)} por día · ${mk.daysRemainingInWeek} día${mk.daysRemainingInWeek === 1 ? "" : "s"} hasta el domingo`}
                      </p>
                      <p className="mt-3 text-sm leading-6 text-line/75">
                        {mk.status === "negative"
                          ? "Esta semana tus pagos y compromisos ya usan todo tu margen. Si bajas el ritmo en lo no esencial hasta tu próximo ingreso, se reacomoda solo — tu meta sigue protegida."
                          : "Para gastar tranquilo. Tus pagos, deudas, ahorro y meta ya están descontados — eso ya lo cuidé yo."}
                      </p>
                      <ConfidenceNote
                        confidence={mk.confidence}
                        marginGaps={mk.marginGaps}
                        className="mt-3 text-left"
                      />
                      <MargenBreakdownReveal
                        breakdown={mk.breakdown}
                        capacity={mk.capacity}
                        margenDaily={mk.margenDaily}
                        format={disp}
                      />
                      <Link
                        href="/app/margen"
                        className="kipu-press group mt-4 inline-flex items-center gap-1 text-xs font-semibold text-line/45 transition hover:text-line/70"
                      >
                        Ver el detalle completo
                        <Chevron />
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className={`block rounded-3xl p-6 shadow-2xl sm:p-8 ${hero.bg}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-line/40">
                  Tu Margen Kipu
                </p>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${hero.badge}`}>
                  {hero.badgeLabel}
                </span>
              </div>
              <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
                <Link href="/app/margen" aria-label="Ver cómo se forma tu Margen" className="kipu-press">
                  <LivingThread tone={mk.status === "negative" ? "alert" : mk.status} size={220}>
                    <MargenRing fraction={ringFraction} status={mk.status} size={176}>
                      <p className={`px-4 text-3xl font-black leading-none tracking-tight ${hero.value}`}>
                        {disp(mk.margenWeekly)}
                      </p>
                      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-line/40">
                        esta semana
                      </p>
                    </MargenRing>
                  </LivingThread>
                </Link>
                <div className="min-w-0 flex-1 text-center sm:text-left">
                  <p className="text-sm font-medium text-line/60">
                    {`≈ ${disp(mk.margenDaily)} por día · ${mk.daysRemainingInWeek} día${mk.daysRemainingInWeek === 1 ? "" : "s"} hasta el domingo`}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-line/75">
                    Para gastar tranquilo. Tus pagos, deudas, ahorro y meta ya están descontados — eso ya lo cuidé yo.
                  </p>
                  <MargenBreakdownReveal
                    breakdown={mk.breakdown}
                    capacity={mk.capacity}
                    margenDaily={mk.margenDaily}
                    format={disp}
                  />
                  <Link
                    href="/app/margen"
                    className="kipu-press group mt-4 inline-flex items-center gap-1 text-xs font-semibold text-line/45 transition hover:text-line/70"
                  >
                    Ver el detalle completo
                    <Chevron />
                  </Link>
                </div>
              </div>
            </div>
          )}

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
                className="kipu-press group mt-3 inline-flex items-center gap-1 text-xs font-bold text-emerald-300"
              >
                {insight.cta}
                <Chevron />
              </Link>
            )}
          </section>

          <UpcomingCommitmentsCard
            baseCurrency={baseCurrency}
            cardsDueSoon={briefing.cardsDueSoon}
            upcomingPayments={briefing.upcomingPayments}
            displayCurrency={displayCurrency}
            rates={manualRates}
            hasCommitmentsConfigured={
              ctx.fixedExpenses.some((f) => f.isActive) || ctx.debtAccounts.length > 0
            }
          />
        </div>

        {/* Right: Pulso signature + wellness system + activity preview */}
        <div className="kipu-stagger flex min-w-0 flex-col gap-5">
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">
              Tu estado
            </p>

            {/* Pulso Kipu — the living wellness identity. The orb already breathes
                (glow + halo + particles); a second LivingThread ring here reads
                heavy, so alive = orb, pressable = kipu-press + chevron. */}
            <Link
              href="/app/readiness"
              className="kipu-press group flex items-center gap-5 rounded-3xl border border-line/5 bg-gradient-to-b from-zinc-900 to-zinc-950 p-4 hover:border-line/15"
            >
              <PulsoOrb score={briefing.metrics.financialReadiness} size={112}>
                <p className="text-3xl font-black tracking-tight text-zinc-50">
                  {briefing.metrics.financialReadiness}
                </p>
              </PulsoOrb>
              <div className="min-w-0 flex-1">
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
              <Chevron className="shrink-0 text-lg" />
            </Link>

            <div className="kipu-stagger mt-3 grid grid-cols-2 gap-3">
              {metricViews
                .filter((m) => m.key !== "readiness")
                .map((m) => (
                  <div key={m.key} className={m.key === "goal" ? "col-span-2" : ""}>
                    <DashboardMetricCard metric={m} />
                  </div>
                ))}
            </div>

            {/* Stage 37 — "Tu mes": the PLANNING number gets its own home. Verb is
                repartir (never "gastar" — that's the Margen hero above). */}
            <PressCard href="/app/mes" className="mt-3 px-5 py-4" ariaLabel="Tu mes: cómo se reparte y cuánto queda libre">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Tu mes</p>
                  <p className="mt-1 text-sm leading-5 text-zinc-400">
                    Libre para repartir{" "}
                    <span className="font-bold text-emerald-300">
                      {disp(Math.max(0, briefing.margenKipu.capacity.monthlyTrulyFree))}
                    </span>
                    /mes
                  </p>
                </div>
                <Chevron className="shrink-0 text-lg" />
              </div>
            </PressCard>
          </section>

          <TrendStrip items={trendItems} series={margenSeries} hasHistory={briefing.trend.hasPrior} />

          <section className="rounded-3xl border border-line/5 bg-zinc-900 p-5">
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
              <div className="mt-1 divide-y divide-line/5">
                {txList.slice(0, 4).map((tx) => (
                  <MovementRow
                    key={tx.id}
                    href="/app/activity"
                    view={describeMovement(tx, { displayCurrency, rates: manualRates })}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Personalization-aware secondary surfaces (Stage 20 PASS 2): household,
          patrimonio, gasto, monedas, Kipu Fit, lo que viene — ordered by the
          view-model; obligations never collapsed. */}
      <div className="kipu-fade-up mt-5">
        <DashboardSecondary
          briefing={briefing}
          baseCurrency={baseCurrency}
          nowMs={nowMs}
          netWorthSeries={netWorthSeries}
          personality={personality}
          fx={fx}
          displayCurrency={displayCurrency}
          rates={manualRates}
        />
      </div>
    </div>
  );
}
