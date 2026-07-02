import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { loadFxRates } from "@/lib/fx/fx-store";
import { loadSnapshotSeries } from "@/lib/trends/snapshot-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { PulsoOrb, pulsoBand } from "../components/PulsoOrb";
import { scoreLabel } from "../components/app-dashboard-helpers";
import { TrendPill, type ChartAccent } from "../components/Charts";
import { CurveChart, timeFractions } from "../components/living/CurveChart";
import { LivingThread, type ThreadTone } from "../components/living/LivingThread";
import { Chevron, MetricShell, PressCard, Section } from "../components/living/shell";

// Pulso Kipu detail: WHY your weekly state is what it is. Readiness is the
// composite of everything Kipu watches — margin, debt, goal, data accuracy and
// learned reality — explained driver by driver, honestly, with real history.

const shortDate = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es", { day: "numeric", month: "short" });

export default async function ReadinessPage() {
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
  const [briefing, series] = await Promise.all([
    buildCoachingBriefing({
      userId: session.user.id,
      ctx,
      snapshot,
      surfaceNudges: false,
    }),
    loadSnapshotSeries(session.user.id, 30, now.getTime()),
  ]);
  const m = briefing.metrics;
  const mk = briefing.margenKipu;
  const base = ctx.profile.baseCurrency;
  const displayCurrency = ctx.profile.displayCurrency; // undefined => native no-op
  const rates = await loadFxRates(session.user.id);
  const disp = makeDisplayFormatter(base, displayCurrency, rates);
  const band = pulsoBand(m.financialReadiness);
  const bandTone: ThreadTone = band === "high" ? "healthy" : band === "mid" ? "tight" : "alert";
  const bandAccent: ChartAccent = band === "high" ? "emerald" : band === "mid" ? "amber" : "rose";

  // Recorded Pulso history (sparse, honest — one dot per computed day), on a
  // real TIME axis so gaps render as gaps.
  const tf = timeFractions(series.map((s) => s.dateISO));
  const seriesPoints = series.map((s, i) => ({ label: shortDate(s.dateISO), value: s.readiness, t: tf[i] }));
  const readinessTrend = briefing.trend.trends.find((t) => t.metric === "readiness") ?? null;

  // The composite weights are the REAL formula in coaching-signals.ts:
  // flexibility 30% + debt 25% + goal 20% + accuracy 15% + reality 10%.
  const drivers = [
    {
      label: "Margen y flexibilidad",
      noun: "la flexibilidad de tu gasto",
      weight: 30,
      score: m.spendingFlexibility,
      accent: "bg-sky-400",
      text: `Te quedan ${disp(mk.margenWeekly)} de Margen Kipu esta semana (≈ ${disp(mk.margenDaily)}/día).`,
      href: "/app/margen",
      action: "Cuida el ritmo esta semana: gasta cerca de tu margen diario y esto sube solo.",
    },
    {
      label: "Presión de deuda",
      noun: "la presión de tu deuda",
      weight: 25,
      score: m.debtPressure,
      accent: "bg-orange-400",
      text:
        briefing.cardsDueSoon.length > 0
          ? `${briefing.cardsDueSoon[0].name} vence pronto — ya está reservado en tu margen.`
          : "Tus pagos de deuda no están apretando la semana.",
      href: "/app/debt",
      action: "Revisa tus pagos de tarjeta: cubrir lo del ciclo a tiempo baja la presión.",
    },
    {
      label: "Impulso de tu meta",
      noun: "el impulso de tu meta",
      weight: 20,
      score: m.goalMomentum,
      accent: "bg-violet-400",
      text: ctx.mainGoal.targetDate
        ? `"${ctx.mainGoal.name}" tiene plan y fecha; tu aporte ya está considerado.`
        : `"${ctx.mainGoal.name}" aún no tiene fecha — con fecha se vuelve un plan medible.`,
      href: "/app/goals",
      action: "Dale fecha y aporte a tu meta: con un plan medible, el impulso sube.",
    },
    {
      label: "Precisión de tus datos",
      noun: "la precisión de tus datos",
      weight: 15,
      score: m.financialAccuracy,
      accent: "bg-teal-400",
      text:
        briefing.daysSinceLastActivity !== null && briefing.daysSinceLastActivity <= 2
          ? "Tus números están frescos; puedo recomendar con confianza."
          : "Mientras más al día estén tus registros, más confiable es todo lo demás.",
      href: "/app/precision",
      action: "Ponte al día con tus registros: mientras más frescos, más confiable todo.",
    },
    {
      label: "Realidad aprendida",
      noun: "la realidad aprendida de tus gastos",
      weight: 10,
      score: m.budgetReality,
      accent: "bg-amber-400",
      text: "Comparo tus estimados con tu gasto real y voy afinando tu margen con el tiempo.",
      href: "/app/reality",
      action: "Cuéntame tus gastos reales unas semanas: afino tus estimados y esto sube.",
    },
  ]
    // What most holds the Pulso back first: weighted impact = weight × (100 − score).
    .sort((a, b) => b.weight * (100 - b.score) - a.weight * (100 - a.score));

  const weakest = drivers[0];
  // Fact-based state line. "Tu punto más flojo" is the lowest RAW score (what
  // the user sees in the list below); the weighted sort still owns the list
  // order and the "what most holds you back" framing.
  const lowest = drivers.reduce((a, b) => (a.score < b.score ? a : b));
  const stateLine =
    lowest.score >= 80
      ? `Nada te está frenando fuerte hoy: hasta tu punto más flojo (${lowest.noun}) está en ${lowest.score} de 100.`
      : `Lo que más te frena hoy: ${weakest.noun} — está en ${weakest.score} de 100 y pesa ${weakest.weight}% de tu Pulso.`;

  return (
    <div className="kipu-stagger mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <MetricShell kicker="Detalle" title="Pulso Kipu" />

      {/* The living state */}
      <section className="mt-5 flex flex-col items-center rounded-3xl border border-white/5 bg-gradient-to-b from-zinc-900 to-zinc-950 px-6 py-8">
        <LivingThread tone={bandTone} size={244}>
          <PulsoOrb score={m.financialReadiness} size={210}>
            <p className="text-6xl font-black tracking-tight text-zinc-50">
              {m.financialReadiness}
            </p>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
              Pulso Kipu
            </p>
            <p
              className={`mt-1 text-xs font-bold ${
                band === "high" ? "text-emerald-300" : band === "mid" ? "text-amber-300" : "text-rose-300"
              }`}
            >
              {scoreLabel(m.financialReadiness)}
            </p>
          </PulsoOrb>
        </LivingThread>
        <p className="mt-6 max-w-md text-center text-sm leading-6 text-zinc-400">{stateLine}</p>
      </section>

      {/* Real recorded history — one dot per computed day */}
      <Section
        kicker="Tu Pulso en el tiempo"
        aside={
          readinessTrend ? (
            <TrendPill
              direction={readinessTrend.direction}
              deltaPct={readinessTrend.deltaPct}
              isImprovement={readinessTrend.isImprovement}
            />
          ) : undefined
        }
      >
        {seriesPoints.length >= 2 ? (
          <>
            <CurveChart
              points={seriesPoints}
              mode="dotted"
              accent={bandAccent}
              formatValue={(v) => `${Math.round(v)}`}
              ariaLabel="Evolución de tu Pulso Kipu en los últimos 30 días"
            />
            <p className="mt-3 text-xs leading-5 text-zinc-600">
              Cada punto es un día real en que calculé tu Pulso — sin inventar los días de en medio.
            </p>
          </>
        ) : (
          <p className="text-sm leading-6 text-zinc-500">
            Aún estoy armando tu historial — cada día que Kipu calcula tu Pulso, guardo un punto.
          </p>
        )}
      </Section>

      {/* Drivers, ordered by what most holds the Pulso back */}
      <Section kicker="Qué lo mueve" aside={<span className="text-[10px] font-medium text-zinc-600">ordenado por impacto</span>}>
        <div className="space-y-4">
          {drivers.map((d, i) => (
            <Link key={d.label} href={d.href} className="group block">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-zinc-200 transition group-hover:text-zinc-50">
                  {d.label}
                </p>
                <span className="flex items-baseline gap-2">
                  <span className="text-[10px] font-medium text-zinc-600">pesa {d.weight}%</span>
                  <span className="text-xs font-bold tabular-nums text-zinc-500">{d.score}</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${d.accent} kipu-rise`}
                  style={{ width: `${Math.max(4, Math.min(100, d.score))}%`, animationDelay: `${i * 90}ms` }}
                />
              </div>
              <p className="mt-1.5 text-xs leading-5 text-zinc-600">{d.text}</p>
            </Link>
          ))}
        </div>
      </Section>

      {/* The one move that raises the Pulso most */}
      <Section kicker="La jugada que más sube tu Pulso">
        <PressCard href={weakest.href} className="border-white/10 bg-zinc-950/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-100">{weakest.label}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{weakest.action}</p>
            </div>
            <Chevron className="text-lg" />
          </div>
        </PressCard>
        <p className="mt-3 text-xs leading-5 text-zinc-600">
          Es tu factor con más impacto ponderado hoy — mover ese número mueve tu Pulso más que
          cualquier otro.
        </p>
      </Section>

      <p className="mt-5 text-xs leading-5 text-zinc-600">
        Tu Pulso se recalcula con cada movimiento, pago y aporte. No es una nota — es la foto viva
        de tu semana, calculada con tus números reales.
      </p>
    </div>
  );
}
