import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { loadFxRates } from "@/lib/fx/fx-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { BudgetSignal } from "@/lib/financial/budget-intelligence";
import type { CategoryBaseline } from "@/lib/financial/category-baselines";
import type { Cadence } from "@/lib/financial/subscription-detection";
import { ChatCta, MetricShell, Section } from "../components/living/shell";
import { LearningState } from "../components/living/states";

// Stage 27 — Gasto detail: the learned "normal for YOU" per category, this
// week's pace vs that normal, detected subscriptions and anomalies, and what
// moved the margin. Everything comes from the Stage 16 spending intelligence;
// below ~8 real spends Kipu says it is still learning instead of faking patterns.

function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
  });
}

const STATUS_BAR: Record<BudgetSignal["status"], string> = {
  under: "bg-emerald-400",
  on_track: "bg-emerald-400",
  watch: "bg-amber-400",
  over: "bg-rose-400",
};
const STATUS_WORD: Record<BudgetSignal["status"], { text: string; cls: string }> = {
  under: { text: "por debajo", cls: "text-emerald-300" },
  on_track: { text: "en ritmo", cls: "text-emerald-300" },
  watch: { text: "a vigilar", cls: "text-amber-300" },
  over: { text: "pasado", cls: "text-rose-300" },
};
const TREND_CHIP: Record<CategoryBaseline["trend"], { text: string; cls: string } | null> = {
  rising: { text: "subiendo", cls: "text-amber-300" },
  falling: { text: "bajando", cls: "text-emerald-300" },
  stable: { text: "estable", cls: "text-zinc-500" },
  unknown: null,
};
const CADENCE_ES: Record<Cadence, string> = {
  weekly: "semanal",
  biweekly: "quincenal",
  monthly: "mensual",
  annual: "anual",
  irregular: "irregular",
};

export default async function SpendingDetailPage() {
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
  const briefing = await buildCoachingBriefing({
    userId: session.user.id,
    ctx,
    snapshot,
    surfaceNudges: false,
  });
  const si = briefing.spendingIntel;
  const rates = await loadFxRates(session.user.id);
  const disp = makeDisplayFormatter(ctx.profile.baseCurrency, ctx.profile.displayCurrency, rates);

  const learning = si.confidence === "low" || si.spendTxnCount < 8;
  const windowLabel = `promedios de tus últimos ~${si.windowDays} días`;
  const earlyCategories = si.baselines.categories.filter((c) => c.sampleSize >= 3);

  if (learning) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
        <MetricShell kicker="Detalle" title="Gasto" />
        <div className="mt-5">
          <LearningState
            title="Kipu está aprendiendo tu gasto real"
            body="Todavía tengo pocos gastos registrados para afirmar patrones — y prefiero no inventarlos. Lo que ya se ve de verdad, te lo muestro abajo."
            unlockHint="Con ~8 gastos registrados ya te muestro patrones; con 25, el mapa completo."
            ctaLabel="Registrar un gasto"
            ctaPrompt="gasté "
          />
        </div>
        <div className="kipu-stagger">
          {earlyCategories.length > 0 && (
            <Section kicker="Lo que ya veo" aside={<span className="text-[11px] text-zinc-600">{windowLabel}</span>}>
              <div className="space-y-3">
                {earlyCategories.slice(0, 6).map((c) => (
                  <div key={c.category} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-zinc-300">{c.parentCategory}</span>
                    <span className="font-semibold tabular-nums text-zinc-100">≈ {disp(c.weeklyAvg)}/sem</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 border-t border-white/5 pt-3 text-xs leading-5 text-zinc-600">
                Promedios tempranos con pocos datos — se afinan con cada gasto que registres.
              </p>
            </Section>
          )}
        </div>
        <ChatCta label="Pregúntale a Kipu por tu gasto" prompt="¿En qué se me está yendo la plata?" />
      </div>
    );
  }

  const signals = si.budget.signals.slice(0, 6);
  const adjust = si.budget.oneAdjustment;
  const cats = si.baselines.categories.slice(0, 6);
  const subs = si.subscriptions.subscriptions;
  const anomalies = si.anomalies.anomalies;
  const drivers = si.margin.drivers;

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <MetricShell
        kicker="Detalle"
        title="Gasto"
        right={
          si.confidence !== "high" ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-400">
              estimado
            </span>
          ) : undefined
        }
      />

      {/* Hero: this week vs YOUR normal, category by category */}
      <section className="kipu-fade-up mt-5 rounded-3xl border border-white/5 bg-zinc-900 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-zinc-300">Tu semana</p>
          <p className="text-[11px] text-zinc-600">proyectado vs tu normal</p>
        </div>
        {signals.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            Esta semana aún no hay suficiente movimiento para comparar contra tu normal.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {signals.map((s) => {
              const width = Math.max(4, Math.min(100, (s.projectedThisWeek / Math.max(1, s.normalWeekly)) * 100));
              const word = STATUS_WORD[s.status];
              const pct = Math.round(s.pctVsNormal * 100);
              return (
                <div key={s.category}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-zinc-200">{s.parentCategory}</p>
                    <p className="text-xs tabular-nums text-zinc-500">
                      {disp(s.projectedThisWeek)} <span className="text-zinc-600">/ {disp(s.normalWeekly)}</span>
                    </p>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className={`h-full rounded-full ${STATUS_BAR[s.status]}`} style={{ width: `${width}%` }} />
                  </div>
                  <p className={`mt-1 text-[11px] font-medium ${word.cls}`}>
                    {word.text}
                    {(s.status === "watch" || s.status === "over") && pct > 0 && ` · +${pct}% vs tu normal`}
                  </p>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-[11px] leading-4 text-zinc-600">La barra llena equivale a tu normal semanal en esa categoría.</p>
        {adjust && adjust.saving > 0 && (
          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-3">
            <p className="text-xs leading-5 text-emerald-200/80">
              <span className="font-semibold text-emerald-300">Un ajuste que alcanza:</span> si {adjust.categories.join(" y ")}{" "}
              {adjust.categories.length === 1 ? "vuelve" : "vuelven"} a tu normal, recuperas ≈ {disp(adjust.saving)} esta semana.
            </p>
          </div>
        )}
      </section>

      <div className="kipu-stagger">
        <Section
          kicker={`Categorías (≈${si.windowDays} días)`}
          aside={<span className="text-[11px] text-zinc-600">{windowLabel}</span>}
        >
          <div className="space-y-3">
            {cats.map((c) => {
              const chip = TREND_CHIP[c.trend];
              return (
                <div key={c.category} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-zinc-300">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.isControllable ? "bg-sky-400" : "bg-zinc-600"}`}
                      title={c.isControllable ? "ajustable" : "esencial"}
                    />
                    <span className="truncate">{c.parentCategory}</span>
                    {chip && <span className={`shrink-0 text-[10px] font-semibold ${chip.cls}`}>{chip.text}</span>}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-zinc-100">≈ {disp(c.weeklyAvg)}/sem</span>
                </div>
              );
            })}
          </div>
          <p className="mt-4 border-t border-white/5 pt-3 text-[11px] leading-4 text-zinc-600">
            Punto celeste = gasto ajustable. Son promedios de tu ventana reciente, no un presupuesto mensual.
          </p>
        </Section>

        <Section kicker="Suscripciones detectadas">
          {subs.length === 0 ? (
            <p className="text-sm leading-6 text-zinc-400">No detecto cobros recurrentes nuevos en esta ventana.</p>
          ) : (
            <>
              <div className="space-y-4">
                {subs.map((sub) => (
                  <div key={sub.merchantFamily}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-zinc-200">{sub.merchantFamily}</p>
                      <p className="text-sm font-semibold tabular-nums text-zinc-100">
                        {disp(sub.amount)} <span className="text-xs font-medium text-zinc-600">· {CADENCE_ES[sub.cadence]}</span>
                      </p>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-600">
                      {sub.nextChargeISO && <span>próximo ≈ {humanDate(sub.nextChargeISO)}</span>}
                      {sub.alreadyModeled ? (
                        <span className="text-teal-300">ya está en tu plan</span>
                      ) : (
                        <Link
                          href={`/app/chat?share=${encodeURIComponent(`convierte ${sub.merchantFamily} en gasto fijo`)}`}
                          className="font-semibold text-emerald-300 hover:text-emerald-200"
                        >
                          convertir en gasto fijo ›
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 border-t border-white/5 pt-3 text-xs leading-5 text-zinc-600">
                Recurrentes detectados: ≈ {disp(si.subscriptions.estimatedMonthlyTotal)} al mes.
              </p>
            </>
          )}
        </Section>

        <Section kicker="Fuera de lo normal">
          {anomalies.length === 0 ? (
            <p className="text-sm leading-6 text-zinc-400">Nada raro esta ventana.</p>
          ) : (
            <div className="space-y-3">
              {anomalies.map((a) => (
                <div key={`${a.merchantFamily}-${a.occurredAtISO}-${a.kind}`} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm text-zinc-300">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          a.severity === "notable" ? "bg-rose-400" : a.severity === "watch" ? "bg-amber-400" : "bg-zinc-500"
                        }`}
                      />
                      <span className="truncate">{a.merchantFamily}</span>
                    </p>
                    <p className="mt-0.5 pl-3.5 text-[11px] leading-4 text-zinc-600">
                      {a.vsTypical > 1 && `×${a.vsTypical.toFixed(1)} de lo típico`}
                      {a.vsTypical > 1 && a.marginImpact > 0.05 && " · "}
                      {a.marginImpact > 0.05 && `se comió ${Math.round(a.marginImpact * 100)}% de tu semana segura`}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-100">{disp(a.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {drivers.length > 0 && (
          <Section kicker="Qué movió tu margen">
            <div className="space-y-3">
              {drivers.map((d) => (
                <div key={`${d.kind}-${d.label}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-zinc-300">{d.label}</span>
                  <span
                    className={`font-semibold tabular-nums ${d.weeklyDelta > 0 ? "text-rose-300" : "text-emerald-300"}`}
                  >
                    {d.weeklyDelta > 0 ? "+" : "−"}
                    {disp(Math.abs(d.weeklyDelta))}
                    <span className="ml-1 text-[10px] font-medium text-zinc-600">vs tu normal</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 border-t border-white/5 pt-3 text-xs leading-5 text-zinc-600">{si.margin.basis}</p>
          </Section>
        )}
      </div>

      <ChatCta label="Pregúntale a Kipu por tu gasto" prompt="¿En qué se me está yendo la plata?" />
    </div>
  );
}
