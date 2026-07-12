import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { cardCyclePhaseFor } from "@/lib/financial/card-cycle";
import { payoffInputsFromHealth, type CardHealthState } from "@/lib/financial/debt-health";
import { planPayoff } from "@/lib/financial/debt-payoff";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { formatKipuMoney } from "@/lib/financial/money";
import { loadFxRates } from "@/lib/fx/fx-store";
import { loadSnapshotSeries } from "@/lib/trends/snapshot-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { translateDebtPressure } from "../components/app-dashboard-helpers";
import { TrendPill, type ChartAccent } from "../components/Charts";
import { CurveChart, timeFractions } from "../components/living/CurveChart";
import { MetricShell, Section } from "../components/living/shell";
import type { CurrencyCode } from "@/types/financial";

// Debt drill-down: what you owe, what each card asks for, and when — with the
// calm framing that the payments are ALREADY reserved inside Saldo Kipu.

const shortDate = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es", { day: "numeric", month: "short" });

export default async function DebtPage() {
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

  // The SAME briefing chat and Telegram read — its debtHealth already knows
  // about recent detected payments, so the web never asks "¿ya pagaste?" for a
  // payment chat has already seen.
  const advisorySnapshot = deriveAdvisorySnapshot(ctx);
  const now = new Date();
  const [briefing, series] = await Promise.all([
    buildCoachingBriefing({
      userId: session.user.id,
      ctx,
      snapshot: advisorySnapshot,
      surfaceNudges: false,
    }),
    loadSnapshotSeries(session.user.id, 30, now.getTime()),
  ]);
  const health = briefing.debtHealth;
  // Stage 30 — cards with a large, unconfirmable pending statement the engine
  // wants the user to confirm (paid or not). Advisory; never blocks the number.
  const cardsToConfirm = briefing.margenKipu.cardsToConfirm;

  const base = ctx.profile.baseCurrency;
  const displayCurrency = ctx.profile.displayCurrency; // undefined => native no-op
  const rates = await loadFxRates(session.user.id);
  const disp = makeDisplayFormatter(base, displayCurrency, rates);
  const debts = ctx.debtAccounts;
  const pressure = ctx.dashboard.debtPressure;
  const totalDebt = debts.reduce((t, d) => t + d.currentBalanceBase, 0);

  // Pressure meter: what share of monthly income this cycle's debt payments eat.
  const monthlyIncome = ctx.summary.estimatedMonthlyIncome;
  const pressurePct =
    monthlyIncome > 0 ? Math.min(100, Math.round((pressure.monthlyDebtDue / monthlyIncome) * 100)) : null;

  // Days until each card's payment day (month-aware), for "vence en N días" chips.
  const daysUntil = (dueDay: number): number => {
    const today = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return dueDay >= today ? dueDay - today : daysInMonth - today + dueDay;
  };

  const healthById = new Map(health.cards.map((c) => [c.id, c]));
  const STATE_CHIP: Partial<Record<CardHealthState, { label: string; cls: string }>> = {
    overdue: { label: "¿ya pagaste?", cls: "bg-rose-400/15 text-rose-300" },
    needs_payment_confirmation: { label: "¿ya pagaste?", cls: "bg-amber-400/15 text-amber-300" },
    high_interest_risk: { label: "tasa alta", cls: "bg-rose-400/15 text-rose-300" },
    revolving_risk: { label: "interés corriendo", cls: "bg-orange-400/15 text-orange-300" },
    stale_statement: { label: "dato viejo", cls: "bg-zinc-400/15 text-zinc-300" },
  };

  // Recorded total-debt history (sparse, honest). Falling = good. Points sit on
  // a real TIME axis so a gap between records looks like a gap.
  const tf = timeFractions(series.map((s) => s.dateISO));
  const seriesPoints = series.map((s, i) => ({ label: shortDate(s.dateISO), value: s.totalDebt, t: tf[i] }));
  const debtTrend = briefing.trend.trends.find((t) => t.metric === "totalDebt") ?? null;
  const debtAccent: ChartAccent =
    debtTrend?.isImprovement === true ? "emerald" : debtTrend?.isImprovement === false ? "rose" : "zinc";

  // Payoff plan — the SAME deterministic engine the agent's tool uses (default
  // strategy, extra 0 unless the user asks in chat, margin-capped).
  const payoffPlan =
    health.hasAnyDebt && totalDebt > 0
      ? planPayoff(payoffInputsFromHealth(health, debts), {
          strategy: "hybrid",
          extraMonthlyBudget: 0,
          monthlyMarginForDebt: Math.max(0, briefing.weeklyMargin * 4.33),
        })
      : null;
  const focusAllocation = payoffPlan?.focusDebtId
    ? payoffPlan.allocations.find((a) => a.id === payoffPlan.focusDebtId) ?? null
    : null;

  return (
    <div className="kipu-stagger mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <MetricShell kicker="Detalle" title="Tu deuda" />

      {debts.length === 0 ? (
        <section className="mt-5 rounded-3xl border border-emerald-400/20 bg-emerald-950/40 p-6 text-center">
          <p className="text-base font-semibold text-emerald-200">Sin deudas registradas</p>
          <p className="mt-1 text-sm leading-6 text-emerald-50/70">
            Todo tu margen es tuyo. Si abres una tarjeta o un préstamo, cuéntamelo y lo cuido por ti.
          </p>
        </section>
      ) : (
        <>
          {/* Pressure summary */}
          <section className="mt-5 rounded-3xl border border-orange-400/20 bg-gradient-to-b from-orange-950/40 to-zinc-900 p-6">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-orange-300/70">
                Presión de deuda
              </p>
              <span className="rounded-full bg-orange-400/15 px-3 py-1 text-xs font-bold text-orange-300">
                {translateDebtPressure(pressure.level)}
              </span>
            </div>
            <p className="mt-4 text-5xl font-black tracking-tight text-orange-300">
              {disp(totalDebt)}
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              {pressure.monthlyDebtDue > 0
                ? `Pagos de este ciclo: ~${disp(pressure.monthlyDebtDue)}. Ya están apartados dentro de tu Saldo Kipu — no tienes que recalcular nada.`
                : "Sin pagos exigidos este ciclo. Igual la tengo presente en tu margen."}
            </p>
            {pressurePct !== null && pressure.monthlyDebtDue > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-500">
                    Peso sobre tu ingreso mensual
                  </span>
                  <span className="font-bold tabular-nums text-orange-300">{pressurePct}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/10">
                  <div
                    className={`kipu-rise h-full rounded-full ${pressurePct >= 35 ? "bg-rose-400" : pressurePct >= 20 ? "bg-amber-400" : "bg-emerald-400"}`}
                    style={{ width: `${Math.max(3, pressurePct)}%` }}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Gentle confirm affordance: a large statement the engine can't tell
              is paid. One tap prefills chat — never a silent reserve or scold. */}
          {cardsToConfirm.length > 0 && (
            <section className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
              <p className="text-sm font-medium leading-6 text-amber-200">
                {cardsToConfirm.length === 1
                  ? `¿Ya pagaste tu ${cardsToConfirm[0].name}? Tengo un pago grande sin confirmar (~${disp(cardsToConfirm[0].amount)}). Confírmame y afino tu Margen.`
                  : "Tengo un par de pagos de tarjeta grandes sin confirmar. Cuéntame cuáles ya pagaste y afino tu Margen."}
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {cardsToConfirm.map((c) => (
                  <Link
                    key={c.name}
                    href={`/app/chat?share=${encodeURIComponent(`ya pagué mi ${c.name}`)}`}
                    className="kipu-press inline-flex min-h-11 items-center text-xs font-semibold text-emerald-300 transition hover:text-emerald-200"
                  >
                    Ya pagué mi {c.name} →
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Real recorded history — falling is the good direction here */}
          {seriesPoints.length >= 2 && (
            <Section
              kicker="Tu deuda en el tiempo"
              aside={
                debtTrend ? (
                  <TrendPill
                    direction={debtTrend.direction}
                    deltaPct={debtTrend.deltaPct}
                    isImprovement={debtTrend.isImprovement}
                  />
                ) : undefined
              }
            >
              <CurveChart
                points={seriesPoints}
                mode="dotted"
                accent={debtAccent}
                formatValue={(v) => disp(v)}
                ariaLabel="Evolución de tu deuda total en los últimos 30 días"
              />
              <p className="mt-3 text-xs leading-5 text-zinc-600">
                Cada punto es un día real registrado. Aquí, bajar es la buena noticia.
              </p>
            </Section>
          )}

          {/* Each debt */}
          <div className="mt-5 flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
              Tarjeta por tarjeta
            </p>
            <Link
              href="/app/activity"
              className="inline-flex min-h-11 items-center text-[11px] font-semibold text-zinc-500 transition hover:text-zinc-300"
            >
              Ver movimientos ›
            </Link>
          </div>
          <section className="mt-2 space-y-2">
            {debts.map((d) => {
              const dueIn = d.dueDay ? daysUntil(d.dueDay) : null;
              const dueSoon = dueIn !== null && dueIn <= 5 && d.currentBalanceBase > 0;
              // Stage 30 — billing-cycle honesty (only credit cards revolve). A
              // statement that hasn't closed is FUTURE debt: scheduled on its due
              // date, it never lowers today's Margen. We show that plainly.
              const phase = d.type === "credit_card" ? cardCyclePhaseFor(d, now) : null;
              const buildingFuture =
                phase != null &&
                (phase.status === "accumulating" || phase.status === "paid") &&
                phase.runningBalance > 0 &&
                d.cutoffDay != null &&
                d.dueDay != null;
              const ch = healthById.get(d.id);
              const chip = ch ? STATE_CHIP[ch.state] : undefined;
              const payAmount = d.fullPaymentDue ?? d.minimumPayment;
              // The chat prefill carries the BASE amount (ledger truth), never
              // the cosmetic display re-expression — the agent reasons in base.
              const payPrompt =
                payAmount != null && payAmount > 0
                  ? `pagué ${formatKipuMoney(payAmount, base as CurrencyCode)} de la ${d.name}`
                  : `pagué la ${d.name}`;
              return (
                <div key={d.id} className="rounded-2xl border border-line/5 bg-zinc-900 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold text-zinc-100">
                        {d.name}
                      </p>
                      {dueSoon && (
                        <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                          {dueIn === 0 ? "vence hoy" : `en ${dueIn} día${dueIn === 1 ? "" : "s"}`}
                        </span>
                      )}
                      {chip && !dueSoon && (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${chip.cls}`}>
                          {chip.label}
                        </span>
                      )}
                    </div>
                    <p className="shrink-0 text-sm font-bold tabular-nums text-orange-300">
                      {disp(d.currentBalanceBase)}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    {d.dueDay && <span>Paga el día {d.dueDay}</span>}
                    {d.cutoffDay && <span>Corte el día {d.cutoffDay}</span>}
                    {(d.minimumPayment ?? 0) > 0 && (
                      <span>Mínimo {disp(d.minimumPayment!)}</span>
                    )}
                    {(d.fullPaymentDue ?? 0) > 0 && (
                      <span>Pago del mes {disp(d.fullPaymentDue!)}</span>
                    )}
                  </div>
                  {/* Stage 31 (4.6) — "arrastrar el saldo" is revolving language: cards only.
                      A loan's interest already lives inside the cuota, so a high-rate loan
                      gets loan-appropriate phrasing instead of a phantom monthly interest. */}
                  {d.type === "credit_card" && ch?.estMonthlyInterest != null && ch.estMonthlyInterest > 0 && (
                    <p className="mt-2 text-xs leading-5 text-rose-300/80">
                      Si arrastras este saldo, el interés ronda ~{disp(ch.estMonthlyInterest)}/mes (estimado).
                    </p>
                  )}
                  {d.type !== "credit_card" &&
                    ch != null &&
                    ch.states.includes("high_interest_risk") &&
                    ch.interestRatePct != null &&
                    d.currentBalanceBase > 0 && (
                      <p className="mt-2 text-xs leading-5 text-rose-300/80">
                        La tasa de este préstamo es alta (~{Math.round(ch.interestRatePct)}% anual). El
                        interés ya va incluido en tu cuota — si algún mes puedes abonar a capital, ahorras
                        intereses.
                      </p>
                    )}
                  {dueSoon && (
                    <p className="mt-2 text-xs leading-5 text-zinc-600">
                      Este pago ya está reservado en tu margen; pagarlo a tiempo te evita intereses.
                    </p>
                  )}
                  {!dueSoon && buildingFuture && (
                    <p className="mt-2 rounded-xl bg-line/[0.03] px-3 py-2 text-xs leading-5 text-zinc-400">
                      Cierra el {d.cutoffDay}; ~{disp(phase!.runningBalance)} estimado a pagar el{" "}
                      {d.dueDay} — ya lo tengo en cuenta, no te baja tu Saldo de hoy.
                    </p>
                  )}
                  {d.currentBalanceBase > 0 && (
                    <div className="mt-3 border-t border-line/5 pt-2.5">
                      <Link
                        href={`/app/chat?share=${encodeURIComponent(payPrompt)}`}
                        className="inline-flex min-h-11 items-center text-xs font-semibold text-emerald-300/90 transition hover:text-emerald-200"
                      >
                        ¿Ya la pagaste? Cuéntamelo →
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {/* A payoff plan that breathes — same engine as the chat tool */}
          {payoffPlan && payoffPlan.hasDebt && (
            <Section kicker="Un plan que respira">
              {payoffPlan.minimumsExceedMargin && (
                <p className="mb-4 rounded-xl bg-amber-400/10 px-3.5 py-3 text-xs leading-5 text-amber-300">
                  Hoy tus pagos mínimos ({disp(payoffPlan.minimumsTotal)}/mes) superan tu margen
                  mensual. No es para asustarte — es la señal de que el primer paso es liberar
                  flujo, y en eso te puedo ayudar paso a paso.
                </p>
              )}
              <div className="space-y-2">
                {payoffPlan.allocations.map((a) => {
                  const isFocus = a.id === payoffPlan.focusDebtId;
                  return (
                    <div
                      key={a.id}
                      className={`rounded-xl px-3.5 py-3 ${
                        isFocus
                          ? "border border-emerald-400/20 bg-emerald-400/5"
                          : "bg-line/[0.03]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-100">
                          <span className="min-w-0 truncate">{a.name}</span>
                          {isFocus && (
                            <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                              enfócate aquí
                            </span>
                          )}
                        </p>
                        {a.total > 0 && (
                          <p className="shrink-0 text-sm font-bold tabular-nums text-zinc-200">
                            {disp(a.total)}/mes
                          </p>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-zinc-600">
                        {a.minimum > 0 && `Mínimo ${disp(a.minimum)}`}
                        {a.extra > 0 && ` + extra ${disp(a.extra)}`}
                        {a.minimum > 0 ? " · " : ""}
                        {a.reason}
                      </p>
                    </div>
                  );
                })}
              </div>
              {focusAllocation && payoffPlan.focusPayoff && (
                <p className="mt-4 text-sm leading-6 text-zinc-300">
                  {payoffPlan.focusPayoff.feasible && payoffPlan.focusPayoff.months !== null
                    ? `A este ritmo, ${focusAllocation.name} quedaría libre en ~${payoffPlan.focusPayoff.months} mes${payoffPlan.focusPayoff.months === 1 ? "" : "es"}${payoffPlan.focusPayoff.totalInterest > 0 ? ` (interés estimado ${disp(payoffPlan.focusPayoff.totalInterest)})` : ""}.`
                    : `Al ritmo actual, ${focusAllocation.name} no baja — el interés se come el pago. Cualquier abono extra, por pequeño que sea, cambia la historia.`}
                </p>
              )}
              <p className="mt-3 text-xs leading-5 text-zinc-600">
                Es un estimado con tus datos de hoy — cada pago que registres lo afina.
                {payoffPlan.notes.length > 0 && ` ${payoffPlan.notes.join(" ")}`}
              </p>
            </Section>
          )}

          <p className="mt-5 text-xs leading-5 text-zinc-600">
            Recuerda: la tarjeta es deuda, no dinero disponible. Cada compra con tarjeta sube esta
            cifra y cada pago la baja — y yo voy ajustando tu margen solo.
          </p>

          <Link
            href={`/app/chat?share=${encodeURIComponent("ayúdame a armar un plan para pagar mis deudas")}`}
            className="kipu-press mt-4 block rounded-2xl bg-emerald-400 px-4 py-3 text-center text-sm font-bold text-zinc-950 hover:bg-emerald-300"
          >
            Armar un plan de pago con Kipu
          </Link>
        </>
      )}
    </div>
  );
}
