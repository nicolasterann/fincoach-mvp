import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { loadCurrentFxRatesForDisplay } from "@/lib/fx/fx-store";
import { loadSnapshotSeries } from "@/lib/trends/snapshot-store";
import { QuipuCord } from "../components/SaldoKipu";
import { MargenBreakdownPanel } from "../components/MargenBreakdown";
import { CurveChart, timeFractions } from "../components/living/CurveChart";
import { Chevron, MetricShell, Section, ChatCta } from "../components/living/shell";
import { formatDateEs, formatDateEsShort } from "@/lib/format/dates-es";

// Stage D — the Saldo Kipu DETAIL page. This is where the financial substance
// lives (per the founder's spec, it never crowds the hero): the full layer
// stack ("Tus capas"), how the number is formed, the history, and the calendar
// bound. The metaphor owns the glance; the truth owns the tap.

const LAYER_STYLE: Record<string, { dot: string; text: string }> = {
  saldo: { dot: "bg-emerald-400", text: "text-emerald-300" },
  reserva: { dot: "bg-sky-400", text: "text-sky-300" },
  metas: { dot: "bg-violet-400", text: "text-violet-300" },
  ahorro_inversion: { dot: "bg-teal-400", text: "text-teal-300" },
  patrimonio: { dot: "bg-zinc-400", text: "text-zinc-300" },
  deuda: { dot: "bg-rose-400", text: "text-rose-300" },
};

export default async function SaldoPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const ctx = await buildUserFinancialContext(session.user.id);
  if (!ctx.dashboard) redirect("/onboarding");

  const now = new Date();
  const snapshot = deriveAdvisorySnapshot(ctx);
  const [briefing, manualRates, snapSeries] = await Promise.all([
    buildCoachingBriefing({ userId: session.user.id, ctx, snapshot, surfaceNudges: false }),
    loadCurrentFxRatesForDisplay(session.user.id),
    loadSnapshotSeries(session.user.id, 30, now.getTime()),
  ]);
  const baseCurrency = ctx.profile.baseCurrency;
  const displayCurrency = ctx.profile.displayCurrency;
  const disp = makeDisplayFormatter(baseCurrency, displayCurrency, manualRates);

  const mk = briefing.margenKipu;
  const s = mk.saldo;

  // Only days that really recorded a Saldo (migration 048+) — never the retired
  // weekly margin dressed up as the Saldo.
  const saldoDays = snapSeries.filter((x) => x.saldoKipu !== null);
  const tf = timeFractions(saldoDays.map((x) => x.dateISO));
  const seriesPoints = saldoDays.map((x, i) => ({
    label: formatDateEsShort(x.dateISO),
    value: x.saldoKipu as number,
    t: tf[i],
  }));

  return (
    <div className="mx-auto w-full max-w-3xl pb-28 lg:pb-12">
      <MetricShell kicker="Detalle" title="Saldo Kipu" />

      {/* The quipu, larger, with the exact numbers beside it */}
      <section className="kipu-fade-up mt-5 rounded-3xl border border-line/5 bg-gradient-to-b from-zinc-900 to-zinc-950 p-6 sm:p-8">
        <div className="flex items-center gap-7">
          <QuipuCord saldo={s} height={260} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-500">Para tus gustos, ahora</p>
            <p className="mt-1 text-4xl font-black tracking-tight text-emerald-300">{disp(s.saldo)}</p>
            <div className="mt-4 space-y-1.5 text-sm leading-6 text-zinc-400">
              <p>
                Se recarga <span className="font-semibold text-zinc-200">{disp(s.fillDaily)}</span> al día
              </p>
              <p>
                Tope <span className="font-semibold text-zinc-200">{disp(s.cap)}</span> (≈10 días de gustos)
              </p>
              <p>
                Hoy: <span className="font-semibold text-emerald-300">+{disp(s.todayFill)}</span> ·{" "}
                <span className="font-semibold text-zinc-200">−{disp(s.todaySpent)}</span>
                {briefing.objectives.todayExcess > 0 || briefing.objectives.todayExtraordinary > 0
                  ? " del Saldo"
                  : " en gustos"}
              </p>
              {/* Stage H — a tank drop must always be explainable: itemize the
                  objective-excess and extraordinary components of today. */}
              {briefing.objectives.todayExcess > 0 && (
                <p className="text-[11px] text-zinc-500">
                  incluye {disp(briefing.objectives.todayExcess)} de exceso sobre tu objetivo del mes
                </p>
              )}
              {briefing.objectives.todayExtraordinary > 0 && (
                <p className="text-[11px] text-zinc-500">
                  incluye {disp(briefing.objectives.todayExtraordinary)} extraordinario (no toca tu objetivo)
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Tus capas — the full stack, in the design's fixed order */}
      <Section kicker="Tus capas" className="mt-6">
        <div className="rounded-3xl border border-line/5 bg-zinc-900 p-2">
          <div className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5">
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${LAYER_STYLE.saldo.dot}`} />
              <div>
                <p className="text-sm font-semibold text-zinc-100">Saldo Kipu</p>
                <p className="text-[11px] text-zinc-600">tus gustos del día a día</p>
              </div>
            </div>
            <p className={`text-sm font-bold ${LAYER_STYLE.saldo.text}`}>{disp(s.saldo)}</p>
          </div>
          {s.layers.map((l) => {
            const style = LAYER_STYLE[l.kind] ?? LAYER_STYLE.patrimonio;
            return (
              <div key={l.kind} className="flex items-center justify-between gap-3 rounded-2xl border-t border-line/5 px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{l.label}</p>
                    <p className="text-[11px] text-zinc-600">
                      {l.kind === "reserva" && "protegida — un gasto grande la usa solo si tú decides"}
                      {l.kind === "metas" && "tus aportes del mes a metas"}
                      {l.kind === "ahorro_inversion" && "tu ahorro e inversión del mes, aún por hacer"}
                      {l.kind === "patrimonio" && "venderías inversión — pierde lo que crecía"}
                      {l.kind === "deuda" && "la última puerta — entra con interés"}
                    </p>
                  </div>
                </div>
                <p className={`text-sm font-bold ${style.text}`}>{l.amount === null ? "—" : disp(l.amount)}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-xs leading-5 text-zinc-600">
          <Link href="/app/cuentas" className="font-semibold text-emerald-400 hover:text-emerald-300">¿Dónde vive físicamente esta plata? →</Link>
          {" "}Si un gasto supera tu Saldo, baja capa por capa — Kipu te avisa siempre antes de cruzar a una peor.
          {s.zeroRateDebtName ? ` ${s.zeroRateDebtName} está al 0%: diferir ahí puede costar menos que vender inversión.` : ""}
        </p>
      </Section>

      {/* De dónde sale el número — the honest math, one tap from the hero */}
      <Section kicker="De dónde sale" className="mt-6">
        <div className="rounded-3xl border border-line/5 bg-zinc-900 p-5">
          <MargenBreakdownPanel breakdown={mk.breakdown} capacity={mk.capacity} margenDaily={s.fillDaily} format={disp} />
          <div className="mt-4 border-t border-line/5 pt-4 text-sm leading-6 text-zinc-400">
            <p>
              El calendario también manda: hoy podrían salir hasta{" "}
              <span className="font-semibold text-zinc-200">{disp(s.calendarHeadroom)}</span> antes de que un pago
              de los próximos días quede corto{s.calendarTroughDateISO ? ` (el punto más bajo llega el ${formatDateEs(s.calendarTroughDateISO)})` : ""} —
              pero gastar todo eso se comería tu Reserva. Por eso tu Saldo es siempre el menor entre tu ritmo y tu
              calendario, con la Reserva aparte.
            </p>
          </div>
        </div>
      </Section>

      {/* History — honest snapshots only */}
      {seriesPoints.length >= 2 && (
        <Section kicker="Tu Saldo, últimos días" className="mt-6">
          <div className="rounded-3xl border border-line/5 bg-zinc-900 p-5">
            <CurveChart
              points={seriesPoints}
              mode="dotted"
              accent="emerald"
              formatValue={(v) => disp(v)}
              ariaLabel="Evolución de tu Saldo Kipu en los últimos 30 días"
            />
          </div>
        </Section>
      )}

      {/* Runway honesty */}
      {s.mode === "runway" && (
        <Section kicker="Modo aguante" className="mt-6">
          <div className="rounded-3xl border border-amber-400/20 bg-amber-950/30 p-5 text-sm leading-6 text-amber-100">
            Sin un ingreso activo, tu Saldo no se recarga. Tu plata cubre{" "}
            <span className="font-bold">{s.runwayDays != null ? `~${s.runwayDays} días` : "un tiempo que aún no puedo calcular"}</span>{" "}
            al ritmo actual de gastos. Cuando registres un ingreso, todo esto se recalcula solo.
          </div>
        </Section>
      )}

      <div className="mt-8 flex items-center justify-between">
        <Link href="/app/mes" className="kipu-press group inline-flex items-center gap-1 text-sm font-semibold text-zinc-400 hover:text-zinc-200">
          Ver Tu mes (planificación)
          <Chevron />
        </Link>
        <ChatCta label="Preguntarle a Kipu" prompt="¿Cómo viene mi Saldo Kipu?" />
      </div>
    </div>
  );
}
