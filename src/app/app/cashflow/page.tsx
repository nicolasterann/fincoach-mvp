import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { loadFxRates } from "@/lib/fx/fx-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { CalendarEvent } from "@/lib/financial/financial-calendar";
import { CurveChart, type CurveMarker } from "../components/living/CurveChart";
import { ChatCta, MetricShell, Section } from "../components/living/shell";
import { LearningState } from "../components/living/states";
import { ConfidenceNote } from "../components/MargenConfidence";

// Stage 27 — Flujo detail: the day-by-day projected balance (the REAL computed
// curve from the Stage 15 engine), what money moves it, the week's safe numbers
// and the honest assumptions behind every figure. Nothing here is invented: the
// curve, the events and the confidence all come from the financial engine.

function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
  });
}

const EVENT_META: Record<CalendarEvent["type"], { label: string; dot: string }> = {
  income: { label: "ingreso", dot: "bg-emerald-400" },
  fixed_expense: { label: "fijo", dot: "bg-amber-400" },
  scheduled_payment: { label: "programado", dot: "bg-amber-400" },
  card_due: { label: "tarjeta", dot: "bg-orange-400" },
  goal_contribution: { label: "meta", dot: "bg-violet-400" },
  savings: { label: "ahorro", dot: "bg-teal-400" },
  investment: { label: "inversión", dot: "bg-teal-400" },
};

export default async function CashflowDetailPage() {
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
  const cf = briefing.cashflow;
  const mk = briefing.margenKipu;
  const cal = briefing.cashflowScenarioBase.calendar;
  const rates = await loadFxRates(session.user.id);
  const disp = makeDisplayFormatter(ctx.profile.baseCurrency, ctx.profile.displayCurrency, rates);

  const points = cf.curve.map((p, i) => ({
    label: i === 0 ? "hoy" : humanDate(p.dateISO),
    value: p.balance,
  }));
  const markers: CurveMarker[] = [];
  for (const w of cf.riskWindows.slice(0, 2)) {
    const i = cf.curve.findIndex((p) => p.dateISO === w.dateISO);
    if (i >= 0) markers.push({ index: i, label: `${humanDate(w.dateISO)} · ${w.label}`, tone: "risk" });
  }
  const ni = cf.nextIncome;
  if (ni) {
    const i = cf.curve.findIndex((p) => p.dateISO === ni.dateISO);
    if (i >= 0) markers.push({ index: i, label: "Ingreso", tone: "info" });
  }

  const accent = cf.status === "healthy" ? "emerald" : cf.status === "tight" ? "amber" : "rose";
  const statusLine =
    cf.status === "healthy"
      ? "Llegas bien al final del horizonte: tu saldo aguanta lo que viene."
      : cf.status === "tight"
        ? "Va justo — hay días donde el saldo se aprieta, pero alcanza si vamos con calma."
        : "Ojo: con lo que hay agendado, el saldo proyectado llega a bajar de cero.";
  const confBadge =
    cf.confidence === "high"
      ? { text: "confianza alta", cls: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" }
      : cf.confidence === "medium"
        ? { text: "estimado", cls: "border-line/10 bg-line/5 text-zinc-400" }
        : { text: "confianza baja", cls: "border-amber-400/40 bg-amber-400/10 text-amber-300" };

  const upcoming = cal.events.filter((e) => e.daysFromNow >= 0).slice(0, 14);
  const groups: { date: string; items: CalendarEvent[] }[] = [];
  for (const e of upcoming) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }
  const groupLabel = (g: { date: string; items: CalendarEvent[] }) =>
    g.items[0].daysFromNow === 0 ? "hoy" : g.items[0].daysFromNow === 1 ? "mañana" : humanDate(g.date);

  // Stage D — this page projects BALANCES; the one "cuánto puedo gastar" number
  // is the Saldo Kipu (home + /app/saldo). Competing spend figures were retired.
  const stats = [
    { label: "Punto más bajo proyectado", value: cf.lowestProjectedBalance },
    { label: "Saldo proyectado a fin de mes", value: cf.projectedEndOfMonth },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <MetricShell
        kicker="Detalle"
        title="Flujo"
        right={
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${confBadge.cls}`}>
            {confBadge.text}
          </span>
        }
      />

      {/* Hero: the real day-by-day projected balance */}
      <section className="kipu-fade-up mt-5 rounded-3xl border border-line/5 bg-zinc-900 p-5">
        <CurveChart
          points={points}
          mode="continuous"
          accent={accent}
          height={140}
          markers={markers}
          formatValue={disp}
          ariaLabel="Saldo proyectado día a día hasta el fin del horizonte"
          anchorZero
        />
        <p className="mt-3 text-sm leading-6 text-zinc-400">{statusLine}</p>
        {cf.confidence === "low" && cf.missing.length > 0 && (
          <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-3">
            <p className="text-xs font-semibold text-amber-300">Proyección con confianza baja</p>
            <ul className="mt-1.5 space-y-1">
              {cf.missing.map((m) => (
                <li key={m} className="text-xs leading-5 text-amber-200/70">
                  · {m}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="kipu-stagger">
        {upcoming.length === 0 ? (
          <div className="mt-5">
            <LearningState
              title="Kipu está aprendiendo tu flujo"
              body="Todavía no tengo pagos ni ingresos agendados para dibujarte lo que viene. Cuéntame tu sueldo (cuánto y cuándo llega) y tus gastos fijos, y esta página cobra vida."
              unlockHint="Con tu ingreso y 2–3 gastos fijos ya te proyecto el saldo día a día."
              ctaLabel="Contárselo a Kipu"
              ctaPrompt="quiero registrar mi sueldo y mis gastos fijos"
            />
          </div>
        ) : (
          <Section kicker="Lo que viene" aside={<span className="text-[11px] text-zinc-600">{cf.horizonDays} días</span>}>
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.date}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">{groupLabel(g)}</p>
                  <div className="mt-1.5 space-y-2">
                    {g.items.map((e) => {
                      const meta = EVENT_META[e.type];
                      return (
                        <div key={e.id} className={`flex items-center justify-between gap-3 ${e.isPaid ? "opacity-50" : ""}`}>
                          <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-300">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                            <span className="truncate">{e.label}</span>
                            <span className="shrink-0 text-[10px] font-medium text-zinc-600">{meta.label}</span>
                            {e.isPaid && <span className="shrink-0 text-[10px] font-medium text-zinc-600">ya pagado</span>}
                          </span>
                          <span
                            className={`shrink-0 text-sm font-semibold tabular-nums ${
                              e.signedAmount > 0 ? "text-emerald-300" : "text-zinc-300"
                            }`}
                          >
                            {e.signedAmount > 0 ? "+" : "−"}
                            {disp(e.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section kicker="Tu proyección">
          <div className="space-y-3">
            {stats.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-zinc-500">{s.label}</span>
                <span className={`font-semibold tabular-nums ${s.value < 0 ? "text-rose-300" : "text-zinc-100"}`}>
                  {disp(s.value)}
                </span>
              </div>
            ))}
          </div>
          {mk.capacity.monthlyIncome > 0 && (
            <p className="mt-4 rounded-2xl border border-line/5 bg-line/[0.03] p-3.5 text-xs leading-6 text-zinc-400">
              Al mes te quedan{" "}
              <span className="font-semibold text-zinc-200">
                {disp(Math.max(0, mk.capacity.monthlyDisposableBeforeAllocations))}
              </span>{" "}
              después de fijos, deuda y esenciales.
              {mk.capacity.monthlyProtected.investment > 0 ? (
                <>
                  {" "}Con{" "}
                  <span className="font-semibold text-zinc-200">
                    {disp(mk.capacity.monthlyProtected.investment)}
                  </span>{" "}
                  a inversión protegida, quedan{" "}
                  <span className="font-semibold text-emerald-400">
                    ~{disp(Math.max(0, mk.capacity.monthlyTrulyFree))} libres
                  </span>{" "}
                  — por eso tu Saldo se recarga ≈ {disp(mk.saldo.fillDaily)}/día.
                </>
              ) : (
                <>
                  {" "}De ahí sale la recarga de tu Saldo: ≈{" "}
                  <span className="font-semibold text-emerald-400">{disp(mk.saldo.fillDaily)}/día</span>.
                </>
              )}
            </p>
          )}
          <p className="mt-3 border-t border-line/5 pt-3 text-xs leading-5 text-zinc-600">
            Estos números son la proyección día a día de tu plata. Cuánto puedes gastar es tu Saldo Kipu
            del Resumen — siempre el menor entre tu ritmo y este calendario.
          </p>
          {mk.confidence !== "solid" ? (
            <ConfidenceNote confidence={mk.confidence} marginGaps={mk.marginGaps} className="mt-3" />
          ) : (
            <Link href="/app/saldo" className="mt-2 inline-block text-xs font-semibold text-emerald-300 hover:text-emerald-200">
              Ver cómo se forma ›
            </Link>
          )}
        </Section>

        <Section kicker="Ventanas de riesgo">
          {cf.riskWindows.length === 0 ? (
            <p className="text-sm leading-6 text-zinc-400">Sin ventanas de riesgo en el horizonte.</p>
          ) : (
            <div className="space-y-3">
              {cf.riskWindows.map((w) => (
                <div key={`${w.dateISO}-${w.label}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-zinc-300">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                    <span className="truncate">
                      {humanDate(w.dateISO)} · {w.label}
                    </span>
                  </span>
                  <span className={`shrink-0 font-semibold tabular-nums ${w.balance < 0 ? "text-rose-300" : "text-amber-300"}`}>
                    {disp(w.balance)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {cf.lowestDateISO && (
            <p className="mt-3 border-t border-line/5 pt-3 text-xs leading-5 text-zinc-600">
              Tu punto más bajo proyectado: <span className="font-semibold text-zinc-400">{disp(cf.lowestProjectedBalance)}</span>{" "}
              alrededor del {humanDate(cf.lowestDateISO)}.
            </p>
          )}
        </Section>

        <Section kicker="Supuestos">
          {cf.assumptions.length === 0 && cf.missing.length === 0 ? (
            <p className="text-sm leading-6 text-zinc-400">
              Nada que suponer: esta proyección usa tus datos tal como están registrados.
            </p>
          ) : (
            <ul className="space-y-2">
              {cf.missing.map((m) => (
                <li key={m} className="flex items-start gap-2 text-sm leading-6 text-zinc-400">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  {m}
                </li>
              ))}
              {cf.assumptions.map((a) => (
                <li key={a} className="flex items-start gap-2 text-sm leading-6 text-zinc-500">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" />
                  {a}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <ChatCta label="¿Dudas con tu flujo? Pregúntale a Kipu" prompt="Explícame mi flujo de caja de las próximas semanas" />
    </div>
  );
}
