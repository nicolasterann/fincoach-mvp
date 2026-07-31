import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { loadCurrentFxRatesForDisplay } from "@/lib/fx/fx-store";
import { loadSnapshotSeries } from "@/lib/trends/snapshot-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { StackedBar, TrendPill } from "../components/Charts";
import { CurveChart, timeFractions } from "../components/living/CurveChart";
import { LivingThread } from "../components/living/LivingThread";
import { ProgressStrand } from "../components/living/ProgressStrand";
import { ChatCta, MetricShell, Section } from "../components/living/shell";
import { LearningState } from "../components/living/states";

// Stage 27 — Patrimonio detail: net worth (assets − debt) exactly as the user
// registered it, its composition, the wealth target and the investment summary.
// The history curve draws ONLY recorded snapshot days (dotted = real points,
// gaps stay gaps); nothing here is connected to banks or invented.

function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
  });
}

function humanMonths(m: number): string {
  if (m <= 1) return "~1 mes";
  if (m < 24) return `~${Math.round(m)} meses`;
  return `~${Math.round(m / 12)} años`;
}

export default async function WealthDetailPage() {
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
  const [briefing, rates, series] = await Promise.all([
    buildCoachingBriefing({
      userId: session.user.id,
      ctx,
      snapshot,
      surfaceNudges: false,
    }),
    loadCurrentFxRatesForDisplay(session.user.id),
    loadSnapshotSeries(session.user.id, 90, now.getTime()),
  ]);
  const disp = makeDisplayFormatter(ctx.profile.baseCurrency, ctx.profile.displayCurrency, rates);
  const nw = briefing.goalsIntel.netWorth;
  const inv = briefing.goalsIntel.investment;

  if (!nw) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
        <MetricShell kicker="Detalle" title="Patrimonio" />
        <div className="mt-5">
          <LearningState
            title="Kipu está aprendiendo tu patrimonio"
            body="Registra tus cuentas, deudas e inversiones y te armo tu patrimonio: cuánto tienes de verdad, cómo se compone y hacia dónde va."
            unlockHint="Con tus cuentas y deudas al día ya aparece tu primer número."
            ctaLabel="Contárselo a Kipu"
            ctaPrompt="quiero registrar mis cuentas y deudas para ver mi patrimonio"
          />
        </div>
        <ChatCta label="Pregúntale a Kipu por tu patrimonio" prompt="¿Cómo va mi patrimonio?" />
      </div>
    );
  }

  const nwTrend = briefing.trend.trends.find((t) => t.metric === "netWorth");
  // Real TIME axis for the sparse snapshot dots — gaps render as gaps.
  const tf = timeFractions(series.map((s) => s.dateISO));
  const historyPoints = series.map((s, i) => ({ label: humanDate(s.dateISO), value: s.netWorth, t: tf[i] }));
  // Composition segments must sum to totalAssets exactly: liquidAssets already
  // CONTAINS liquid investments (net-worth.ts), so the invested segment shows
  // only the non-liquid part instead of double-counting.
  const investedNonLiquid = Math.max(0, nw.totalAssets - nw.liquidAssets - nw.otherAssets);
  const tone = nw.totalNetWorth >= 0 ? "teal" : "alert";
  const progressPct = nw.wealthProgressPct !== null ? Math.max(0, Math.min(100, nw.wealthProgressPct)) : null;

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <MetricShell kicker="Detalle" title="Patrimonio" />

      {/* Hero: total net worth, alive */}
      <section className="kipu-fade-up mt-5 flex flex-col items-center rounded-3xl border border-line/5 bg-gradient-to-b from-zinc-900 to-zinc-950 px-6 py-8">
        <LivingThread tone={tone} size={220}>
          <div className="px-7 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Patrimonio total</p>
            <p className="mt-1 text-3xl font-black leading-tight tracking-tight text-zinc-50">{disp(nw.totalNetWorth)}</p>
            {nwTrend && (
              <div className="mt-1">
                <TrendPill direction={nwTrend.direction} deltaPct={nwTrend.deltaPct} isImprovement={nwTrend.isImprovement} />
              </div>
            )}
          </div>
        </LivingThread>
        {historyPoints.length >= 2 ? (
          <div className="mt-6 w-full">
            <CurveChart
              points={historyPoints}
              mode="dotted"
              accent="teal"
              height={96}
              formatValue={disp}
              ariaLabel="Historial de tu patrimonio en los días registrados"
            />
            <p className="mt-2 text-center text-[11px] leading-4 text-zinc-600">
              Cada punto es un día con registro real — sin relleno inventado entre medio.
            </p>
          </div>
        ) : (
          <p className="mt-6 max-w-sm text-center text-xs leading-5 text-zinc-600">
            Aún no hay historial para dibujar tu curva — se arma solo, un punto por cada día que uses Kipu.
          </p>
        )}
      </section>

      <div className="kipu-stagger">
        <Section kicker="Cómo se compone">
          <StackedBar
            segments={[
              { label: "Líquido", value: nw.liquidAssets, accent: "emerald" },
              { label: "Invertido", value: investedNonLiquid, accent: "violet" },
              { label: "Otros", value: nw.otherAssets, accent: "sky" },
            ]}
            ariaLabel="Composición de tus activos: líquido, invertido y otros"
          />
          <div className="mt-4 space-y-3 border-t border-line/5 pt-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">Activos totales</span>
              <span className="font-semibold tabular-nums text-zinc-100">{disp(nw.totalAssets)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                Deuda total
              </span>
              <span className="font-semibold tabular-nums text-rose-300">−{disp(nw.totalDebt)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line/5 pt-3">
              <span className="font-medium text-zinc-300">Patrimonio líquido</span>
              <span className="font-semibold tabular-nums text-emerald-300">{disp(nw.liquidNetWorth)}</span>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-600">
            Líquido = lo que podrías usar ya. El resto existe, pero no es dinero disponible hoy.
          </p>
        </Section>

        <Section kicker="Tu meta de patrimonio">
          {nw.wealthTarget !== null && nw.wealthTarget > 0 ? (
            <>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-zinc-400">
                  {disp(nw.totalNetWorth)} <span className="text-zinc-600">de {disp(nw.wealthTarget)}</span>
                </span>
                {progressPct !== null && (
                  <span className="font-bold tabular-nums text-violet-300">{Math.round(progressPct)}%</span>
                )}
              </div>
              <div className="mt-3">
                <ProgressStrand
                  fraction={(progressPct ?? 0) / 100}
                  accent="violet"
                  ariaLabel="Avance hacia tu meta de patrimonio"
                />
              </div>
              <div className="mt-4 space-y-2 text-sm">
                {nw.requiredMonthlyForTarget !== null && (
                  <p className="text-zinc-400">
                    Para llegar necesitas ≈{" "}
                    <span className="font-semibold text-zinc-200">{disp(nw.requiredMonthlyForTarget)}</span> al mes.
                  </p>
                )}
                {nw.projectedMonthsToTarget !== null && (
                  <p className="text-zinc-400">
                    A este ritmo, {humanMonths(nw.projectedMonthsToTarget)} — un estimado, no una promesa.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm leading-6 text-zinc-400">
                Aún no le pones un número a tu patrimonio. Con una meta, esto deja de ser una foto y se vuelve un plan.
              </p>
              <Link
                href={`/app/chat?share=${encodeURIComponent("quiero una meta de patrimonio")}`}
                className="mt-3 inline-block text-xs font-semibold text-emerald-300 hover:text-emerald-200"
              >
                Ponerle una meta con Kipu ›
              </Link>
            </>
          )}
        </Section>

        {inv && inv.count > 0 && (
          <Section kicker="Inversiones">
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">
                  {inv.count === 1 ? "1 inversión activa" : `${inv.count} inversiones activas`}
                </span>
                <span className="font-semibold tabular-nums text-zinc-100">{disp(inv.totalValue)}</span>
              </div>
              {inv.hasReturns && inv.monthlyAccrualNow > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Rinden hoy</span>
                  <span className="font-semibold tabular-nums text-emerald-300">≈ {disp(inv.monthlyAccrualNow)}/mes</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">En 12 meses</span>
                <span className="font-semibold tabular-nums text-violet-300">≈ {disp(inv.projected12mValue)}</span>
              </div>
            </div>
            {inv.hasReturns && (
              <p className="mt-3 border-t border-line/5 pt-3 text-xs leading-5 text-zinc-600">
                Proyección con tus retornos estimados, no una promesa.
              </p>
            )}
          </Section>
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-zinc-600">
        Tu patrimonio suma solo lo que tú registraste — Kipu no se conecta a tus bancos ni le pone precio a nada por ti.
      </p>

      <ChatCta label="Pregúntale a Kipu por tu patrimonio" prompt="¿Cómo va mi patrimonio?" />
    </div>
  );
}
