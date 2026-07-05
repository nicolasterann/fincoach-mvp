import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import {
  computeSpendingRhythm,
  computeWeekSpend,
  type RecentTxLite,
} from "@/lib/financial/activity-insights";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { loadFxRates } from "@/lib/fx/fx-store";
import { loadSnapshotSeries } from "@/lib/trends/snapshot-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { MargenRing } from "../components/MargenRing";
import { RhythmBars } from "../components/RhythmBars";
import { getMargenHeroClasses } from "../components/app-dashboard-helpers";
import { ConfidenceChip, ConfidenceNote } from "../components/MargenConfidence";
import { MargenBreakdownPanel } from "../components/MargenBreakdown";
import { TrendPill } from "../components/Charts";
import { CurveChart, timeFractions } from "../components/living/CurveChart";
import { LivingThread, type ThreadTone } from "../components/living/LivingThread";
import { Chevron, MetricShell, Section } from "../components/living/shell";
import { LearningState } from "../components/living/states";

// Drill-down: how Margen Kipu is formed. Simple at the top of the app, deep
// here for the curious — a calm "waterfall" from liquid cash to safe-to-spend,
// plus the real recorded history and what moved the number this week.

const shortDate = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es", { day: "numeric", month: "short" });

export default async function MargenDetailPage() {
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

  const snapshot = deriveAdvisorySnapshot(ctx);
  const now = new Date();
  const since = new Date(now.getTime() - 8 * 86_400_000).toISOString();
  const [briefing, { data: recentTx }, series] = await Promise.all([
    buildCoachingBriefing({
      userId: session.user.id,
      ctx,
      snapshot,
      surfaceNudges: false,
    }),
    supabase
      .from("transactions")
      .select("id, type, base_amount, occurred_at, related_transaction_id")
      .eq("user_id", session.user.id)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(300),
    loadSnapshotSeries(session.user.id, 30, now.getTime()),
  ]);
  const mk = briefing.margenKipu;
  const cf = briefing.cashflow; // Stage 15 — timing-aware projection
  const b = mk.breakdown;
  const base = ctx.profile.baseCurrency;
  // Stage 24 — WEB-ONLY display re-expression. No-op when displayCurrency === base
  // (every single-currency user) or when no manual rate exists; never fabricates a rate.
  const displayCurrency = ctx.profile.displayCurrency; // undefined => native no-op
  const rates = await loadFxRates(session.user.id);
  const disp = makeDisplayFormatter(base, displayCurrency, rates);

  // Brand-new user: no recorded activity ever and no liquid money → the Margen
  // has nothing real to compute yet. Honest learning state, never a fake zero.
  if (briefing.daysSinceLastActivity === null && b.liquidCash <= 0) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
        <MetricShell kicker="Detalle" title="Margen Kipu" />
        <div className="mt-5">
          <LearningState
            title="Tu Margen Kipu está por nacer"
            body="El Margen Kipu es cuánto puedes gastar tranquilo esta semana. Para calcularlo necesito conocer tus cuentas y tus primeros movimientos."
            unlockHint="Cuéntame cuánto tienes en tus cuentas y registra tu primer gasto — desde ahí este número vive solo."
            ctaLabel="Empezar con Kipu"
            ctaPrompt="Quiero registrar mis cuentas y mis primeros movimientos"
          />
        </div>
      </div>
    );
  }

  // ONE number across the whole product: the hero shows the SAME margenKipu the
  // /app dashboard and the coach quote. Runway risk is communicated in its own
  // labeled line below — never by silently zeroing the ring.
  const hero = getMargenHeroClasses(mk.status);
  const rhythm = computeSpendingRhythm((recentTx ?? []) as RecentTxLite[], now, 7);
  const { weekSpend } = computeWeekSpend((recentTx ?? []) as RecentTxLite[], now);
  const airTotal = Math.max(0, mk.margenWeekly) + weekSpend;
  // Same formula as the dashboard ring — same number, same visual.
  const ringFraction =
    mk.status === "negative" ? 0 : airTotal > 0 ? Math.max(0, mk.margenWeekly) / airTotal : 1;
  const incomeDateLabel =
    cf.nextIncome && cf.nextIncome.confidence !== "low" ? shortDate(cf.nextIncome.dateISO) : null;
  const heroTone: ThreadTone =
    mk.status === "healthy" ? "healthy" : mk.status === "tight" ? "tight" : "alert";

  // Recorded snapshot history (sparse, honest — only days Kipu actually
  // computed), on a real TIME axis so gaps render as gaps.
  const tf = timeFractions(series.map((s) => s.dateISO));
  const seriesPoints = series.map((s, i) => ({ label: shortDate(s.dateISO), value: s.margenWeekly, t: tf[i] }));
  const margenTrend = briefing.trend.trends.find((t) => t.metric === "margenWeekly") ?? null;

  // Stage 16 — what moved the margin this week (real drivers vs the user's own
  // learned normal; empty → the section simply doesn't exist).
  const attribution = briefing.spendingIntel.margin;
  const attributionRows = attribution.drivers.slice(0, 5);

  const reserved = [
    { label: "Gastos fijos", value: b.reservedFixed, color: "bg-zinc-400", href: "/app/cashflow" },
    { label: "Pagos programados", value: b.reservedScheduled, color: "bg-indigo-400", href: "/app/cashflow" },
    { label: "Pagos de tarjeta / deuda", value: b.reservedDebt, color: "bg-orange-400", href: "/app/debt" },
    { label: "Gastos esenciales", value: b.reservedEssentials, color: "bg-sky-400", href: null },
    { label: "Ahorro", value: b.reservedSavings, color: "bg-teal-400", href: "/app/goals" },
    { label: "Inversión", value: b.reservedInvestment, color: "bg-cyan-400", href: "/app/goals" },
    { label: "Tu meta", value: b.reservedGoal, color: "bg-violet-400", href: "/app/goals" },
  ].filter((r) => r.value > 0);

  // Composition bar: every peso of liquid money, colored by what it's for. The
  // "free" slice uses the Stage 15 timing-aware figure (consistent with the
  // hero); the remainder beyond it is shown as a timing/uncertainty cushion so
  // the dashboard never claims more spendable than the headline.
  const liquidTotal = Math.max(b.liquidCash, 1);
  const freeToSpend = Math.max(0, mk.safeToSpendUntilIncome);
  const cushion = Math.max(0, b.liquidCash - b.totalReserved - freeToSpend);
  const segments = [
    ...reserved.map((r) => ({ ...r, pct: (r.value / liquidTotal) * 100 })),
    { label: "Libre para ti", value: freeToSpend, color: "bg-emerald-400", pct: (freeToSpend / liquidTotal) * 100 },
    { label: "Colchón (timing / imprevistos)", value: cushion, color: "bg-zinc-600", pct: (cushion / liquidTotal) * 100 },
  ].filter((s) => s.pct > 0.5);

  const apart = [
    briefing.receivablesOutstanding > 0
      ? { label: "Te deben", value: briefing.receivablesOutstanding }
      : null,
    briefing.nonLiquidTotal > 0
      ? { label: "Ahorro / inversión no líquida", value: briefing.nonLiquidTotal }
      : null,
    briefing.protectedGoalMoney > 0
      ? { label: "Protegido para tu meta", value: briefing.protectedGoalMoney }
      : null,
  ].filter((x): x is { label: string; value: number } => x !== null);

  return (
    <div className="kipu-stagger mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <MetricShell
        kicker="Detalle"
        title="Margen Kipu"
        right={
          <div className="flex items-center gap-2">
            <ConfidenceChip confidence={mk.confidence} />
            {margenTrend ? (
              <TrendPill
                direction={margenTrend.direction}
                deltaPct={margenTrend.deltaPct}
                isImprovement={margenTrend.isImprovement}
              />
            ) : null}
          </div>
        }
      />

      <section className={`mt-5 rounded-3xl p-6 ${hero.bg}`}>
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-7">
          <LivingThread tone={heroTone} size={178}>
            <MargenRing fraction={ringFraction} status={mk.status} size={150}>
              <p className={`px-4 text-2xl font-black leading-none tracking-tight ${hero.value}`}>
                {disp(mk.margenWeekly)}
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-line/40">
                esta semana
              </p>
            </MargenRing>
          </LivingThread>
          <div className="text-center sm:text-left">
            <p className="text-xs font-semibold uppercase tracking-widest text-line/40">
              Para gastar tranquilo
            </p>
            <p className="mt-2 text-sm text-line/60">
              Hoy ≈ {disp(mk.margenDaily)} ·{" "}
              {incomeDateLabel
                ? `hasta tu ingreso (${incomeDateLabel})`
                : cf.nextIncome
                  ? "hasta tu ingreso (fecha por confirmar)"
                  : `${cf.horizonDays} días de horizonte`}
            </p>
            <p className="mt-2 text-sm text-line/60">
              {cf.runwayOk
                ? "Llegas tranquilo a tu próximo ingreso."
                : cf.lowestDateISO
                  ? `Cuida cerca del ${shortDate(cf.lowestDateISO)}: el saldo baja a ${disp(cf.lowestProjectedBalance)}.`
                  : `Cuida el ritmo: el saldo llega a bajar a ${disp(cf.lowestProjectedBalance)} en este horizonte.`}
              {cf.riskWindows.length > 0 && ` Cuida: ${cf.riskWindows.map((w) => w.label).join(" y ")}.`}
            </p>
            {cf.confidence !== "high" && (
              <p className="mt-2 text-xs leading-5 text-line/45">
                {cf.confidence === "low"
                  ? `Con lo que sé hoy${cf.missing[0] ? ` (${cf.missing[0]})` : ""}. Confírmame tu saldo y te lo afino.`
                  : "Estimado con la info actual; se afina al confirmar saldo e ingresos."}
              </p>
            )}
            {weekSpend > 0 && (
              <p className="mt-2 text-sm text-line/60">
                Esta semana ya usaste {disp(weekSpend)} de tu aire.
              </p>
            )}
            <ConfidenceNote
              confidence={mk.confidence}
              marginGaps={mk.marginGaps}
              className="mt-3 text-left"
            />
            {mk.marginGaps.some((g) => g.code === "essentials_unknown") && (
              <p className="mt-2 text-xs leading-5 text-line/45">
                Aún no descuenta tu gasto diario, porque todavía no me lo cuentas — por eso es preliminar.
              </p>
            )}
          </div>
        </div>
        {mk.confidence !== "solid" && (
          <p className="mt-4 text-xs leading-5 text-line/50">
            Kipu te da claridad con lo que sabe, y mientras más datos reales le das, más confiable se vuelve tu Margen.
          </p>
        )}
      </section>

      {/* Real recorded history — one dot per day Kipu computed the week */}
      <Section
        kicker="Tu Margen en el tiempo"
        aside={
          margenTrend ? (
            <TrendPill
              direction={margenTrend.direction}
              deltaPct={margenTrend.deltaPct}
              isImprovement={margenTrend.isImprovement}
            />
          ) : undefined
        }
      >
        {seriesPoints.length >= 2 ? (
          <>
            <CurveChart
              points={seriesPoints}
              mode="dotted"
              accent="emerald"
              formatValue={(v) => disp(v)}
              ariaLabel="Evolución de tu Margen Kipu en los últimos 30 días"
            />
            <p className="mt-3 text-xs leading-5 text-zinc-600">
              Cada punto es un día real en que calculé tu semana — sin inventar los días de en medio.
            </p>
          </>
        ) : (
          <p className="text-sm leading-6 text-zinc-500">
            Aún estoy armando tu historial — cada día que Kipu calcula tu semana, guardo un punto.
          </p>
        )}
      </Section>

      {/* What moved the number — real drivers, or nothing at all */}
      {attributionRows.length > 0 && (
        <Section kicker="Qué lo movió">
          {attribution.headline && (
            <p className="text-sm leading-6 text-zinc-300">{attribution.headline.note}</p>
          )}
          <div className={`space-y-3 ${attribution.headline ? "mt-4" : ""}`}>
            {attributionRows.map((d) => (
              <div key={`${d.kind}-${d.label}`} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-300">{d.label}</p>
                  {d !== attribution.headline && (
                    <p className="mt-0.5 text-xs leading-5 text-zinc-600">{d.note}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    d.weeklyDelta > 0 ? "text-rose-300" : "text-emerald-300"
                  }`}
                >
                  {d.weeklyDelta > 0 ? "+" : "−"}
                  {disp(Math.abs(d.weeklyDelta))}
                  <span className="ml-1 text-[10px] font-medium text-zinc-600">vs tu normal</span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-zinc-600">{attribution.basis}</p>
        </Section>
      )}

      {/* 7-day spending rhythm */}
      <section className="mt-5 rounded-3xl border border-line/5 bg-zinc-900 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-300">Tu ritmo · últimos 7 días</p>
          <p className="text-xs text-zinc-600">
            ritmo cómodo ≈ {disp(mk.margenDaily)}/día
          </p>
        </div>
        <div className="mt-4">
          <RhythmBars dailyReference={mk.margenDaily} days={rhythm} />
        </div>
        <p className="mt-3 text-xs leading-5 text-zinc-600">
          Verde: dentro de tu ritmo. Ámbar: día por encima. Con más semanas, comparo contra lo que
          es normal para ti.
        </p>
      </section>

      {/* ¿De dónde sale este número? — the plain-language math (feedback #9) +
          the capacity story (#7), straight from the engine breakdown/capacity. */}
      <section className="mt-5 rounded-3xl border border-line/5 bg-zinc-900 p-5">
        <p className="text-sm font-medium text-zinc-300">¿De dónde sale este número?</p>
        <div className="mt-4">
          <MargenBreakdownPanel
            breakdown={mk.breakdown}
            capacity={mk.capacity}
            margenDaily={mk.margenDaily}
            format={disp}
          />
        </div>
      </section>

      {/* How the number is formed: composition bar + waterfall */}
      <section className="mt-5 rounded-3xl border border-line/5 bg-zinc-900 p-5">
        <p className="text-sm font-medium text-zinc-300">Cada peso, por dentro</p>

        {/* Every peso of your liquid money, colored by what it's protecting */}
        <div className="mt-4 flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full">
          {segments.map((s) => (
            <div
              key={s.label}
              className={`${s.color} kipu-rise h-full rounded-sm`}
              style={{ width: `${s.pct}%` }}
              title={s.label}
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {segments.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className={`h-2 w-2 rounded-full ${s.color}`} />
              {s.label}
            </span>
          ))}
        </div>

        <div className="mt-5 space-y-1.5 border-t border-line/5 pt-4 text-sm">
          <div className="flex items-center justify-between py-1">
            <span className="text-zinc-400">Dinero líquido</span>
            <span className="font-semibold tabular-nums text-zinc-100">
              {disp(b.liquidCash)}
            </span>
          </div>
          {reserved.map((r) =>
            r.href ? (
              <Link
                key={r.label}
                href={r.href}
                className="group -mx-2 flex min-h-11 items-center justify-between rounded-xl px-2 py-1 transition hover:bg-line/5"
              >
                <span className="flex items-center gap-2 text-zinc-500 transition group-hover:text-zinc-300">
                  <span className={`h-1.5 w-1.5 rounded-full ${r.color}`} />− {r.label}
                </span>
                <span className="flex items-center gap-1.5 tabular-nums text-zinc-400">
                  {disp(r.value)}
                  <Chevron />
                </span>
              </Link>
            ) : (
              <div key={r.label} className="flex items-center justify-between py-1">
                <span className="flex items-center gap-2 text-zinc-500">
                  <span className={`h-1.5 w-1.5 rounded-full ${r.color}`} />− {r.label}
                </span>
                <span className="tabular-nums text-zinc-400">{disp(r.value)}</span>
              </div>
            ),
          )}
          <div className="mt-1 border-t border-line/10 pt-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-300">Libre hasta tu próximo ingreso</span>
              <span className="font-semibold tabular-nums text-emerald-300">
                {disp(freeToSpend)}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-600">
              Reparto ese aire entre los días que faltan, cuidando cuándo caen tus pagos — y eso es tu
              Margen Kipu de la semana, sin tocar tus pagos, ahorro, inversión ni tu meta.
            </p>
          </div>
        </div>
      </section>

      {/* Money that is NOT Margen Kipu */}
      {apart.length > 0 && (
        <section className="mt-5 rounded-3xl border border-line/5 bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-300">No lo cuento como gastable</p>
          <div className="mt-3 space-y-2 text-sm">
            {apart.map((a) => (
              <div key={a.label} className="flex items-center justify-between">
                <span className="text-zinc-500">{a.label}</span>
                <span className="tabular-nums text-zinc-400">{disp(a.value)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-600">
            Existe, pero no es dinero que puedas gastar tranquilo todavía, así que no entra en tu
            Margen Kipu.
          </p>
        </section>
      )}

      <Link
        href="/app/chat"
        className="kipu-press mt-5 block rounded-2xl bg-emerald-400 px-4 py-3 text-center text-sm font-bold text-zinc-950 hover:bg-emerald-300"
      >
        Preguntarle a Kipu
      </Link>
    </div>
  );
}
