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
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { MargenRing } from "../components/MargenRing";
import { RhythmBars } from "../components/RhythmBars";
import { getMargenHeroClasses } from "../components/app-dashboard-helpers";

// Drill-down: how Margen Kipu is formed. Simple at the top of the app, deep
// here for the curious — a calm "waterfall" from liquid cash to safe-to-spend.
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
  const [briefing, { data: recentTx }] = await Promise.all([
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
  // Stage 15 — the HERO leads with the timing-aware cashflow (the SAME Margen
  // Kipu, projected), so the headline never contradicts chat/Telegram and stays
  // honest when the income date is unknown. The legacy reservation breakdown
  // (mk) remains below as supporting "cómo se forma" context only.
  const hero = getMargenHeroClasses(cf.status);
  const rhythm = computeSpendingRhythm((recentTx ?? []) as RecentTxLite[], now, 7);
  const { weekSpend } = computeWeekSpend((recentTx ?? []) as RecentTxLite[], now);
  const airTotal = Math.max(0, cf.safeThisWeek) + weekSpend;
  const ringFraction =
    cf.status === "negative" || !cf.runwayOk ? 0 : airTotal > 0 ? Math.max(0, cf.safeThisWeek) / airTotal : 1;
  const incomeDateLabel = cf.nextIncome && cf.nextIncome.confidence !== "low" ? cf.nextIncome.dateISO : null;

  const reserved = [
    { label: "Gastos fijos", value: b.reservedFixed, color: "bg-zinc-400" },
    { label: "Pagos programados", value: b.reservedScheduled, color: "bg-indigo-400" },
    { label: "Pagos de tarjeta / deuda", value: b.reservedDebt, color: "bg-orange-400" },
    { label: "Gastos esenciales", value: b.reservedEssentials, color: "bg-sky-400" },
    { label: "Ahorro", value: b.reservedSavings, color: "bg-teal-400" },
    { label: "Inversión", value: b.reservedInvestment, color: "bg-cyan-400" },
    { label: "Tu meta", value: b.reservedGoal, color: "bg-violet-400" },
  ].filter((r) => r.value > 0);

  // Composition bar: every peso of liquid money, colored by what it's for. The
  // "free" slice uses the Stage 15 timing-aware figure (consistent with the
  // hero); the remainder beyond it is shown as a timing/uncertainty cushion so
  // the dashboard never claims more spendable than the headline.
  const liquidTotal = Math.max(b.liquidCash, 1);
  const freeToSpend = Math.max(0, cf.safeUntilIncome);
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-28 lg:pb-12">
      <header className="flex items-center gap-3">
        <Link
          href="/app"
          aria-label="Volver"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-zinc-400 transition hover:bg-white/5"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Detalle</p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Tu Margen Kipu</h1>
        </div>
      </header>

      <section className={`rounded-3xl p-6 ${hero.bg}`}>
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-7">
          <MargenRing fraction={ringFraction} status={cf.status} size={150}>
            <p className={`px-4 text-2xl font-black leading-none tracking-tight ${hero.value}`}>
              {disp(cf.safeThisWeek)}
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">
              esta semana
            </p>
          </MargenRing>
          <div className="text-center sm:text-left">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/40">
              Para gastar tranquilo
            </p>
            <p className="mt-2 text-sm text-white/60">
              Hoy ≈ {disp(cf.safeToday)} ·{" "}
              {incomeDateLabel
                ? `hasta tu ingreso (${incomeDateLabel})`
                : cf.nextIncome
                  ? "hasta tu ingreso (fecha por confirmar)"
                  : `${cf.horizonDays} días de horizonte`}
            </p>
            <p className="mt-2 text-sm text-white/60">
              {cf.runwayOk
                ? "Llegas tranquilo a tu próximo ingreso."
                : `Cuida cerca del ${cf.lowestDateISO}: el saldo baja a ${disp(cf.lowestProjectedBalance)}.`}
              {cf.riskWindows.length > 0 && ` Cuida: ${cf.riskWindows.map((w) => w.label).join(" y ")}.`}
            </p>
            {cf.confidence !== "high" && (
              <p className="mt-2 text-xs leading-5 text-white/45">
                {cf.confidence === "low"
                  ? `Con lo que sé hoy${cf.missing[0] ? ` (${cf.missing[0]})` : ""}. Confírmame tu saldo y te lo afino.`
                  : "Estimado con la info actual; se afina al confirmar saldo e ingresos."}
              </p>
            )}
            {weekSpend > 0 && (
              <p className="mt-2 text-sm text-white/60">
                Esta semana ya usaste {disp(weekSpend)} de tu aire.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 7-day spending rhythm */}
      <section className="rounded-3xl border border-white/5 bg-zinc-900 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-300">Tu ritmo · últimos 7 días</p>
          <p className="text-xs text-zinc-600">
            ritmo cómodo ≈ {disp(cf.safeToday)}/día
          </p>
        </div>
        <div className="mt-4">
          <RhythmBars dailyReference={cf.safeToday} days={rhythm} />
        </div>
        <p className="mt-3 text-xs leading-5 text-zinc-600">
          Verde: dentro de tu ritmo. Ámbar: día por encima. Con más semanas, comparo contra lo que
          es normal para ti.
        </p>
      </section>

      {/* How the number is formed: composition bar + waterfall */}
      <section className="rounded-3xl border border-white/5 bg-zinc-900 p-5">
        <p className="text-sm font-medium text-zinc-300">Cómo se forma</p>

        {/* Every peso of your liquid money, colored by what it's protecting */}
        <div className="mt-4 flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full">
          {segments.map((s) => (
            <div
              key={s.label}
              className={`${s.color} h-full rounded-sm`}
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

        <div className="mt-5 space-y-3 border-t border-white/5 pt-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Dinero líquido</span>
            <span className="font-semibold tabular-nums text-zinc-100">
              {disp(b.liquidCash)}
            </span>
          </div>
          {reserved.map((r) => (
            <div key={r.label} className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-zinc-500">
                <span className={`h-1.5 w-1.5 rounded-full ${r.color}`} />− {r.label}
              </span>
              <span className="tabular-nums text-zinc-400">{disp(r.value)}</span>
            </div>
          ))}
          <div className="mt-1 border-t border-white/10 pt-3">
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
        <section className="rounded-3xl border border-white/5 bg-zinc-900 p-5">
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
        className="rounded-2xl bg-emerald-400 px-4 py-3 text-center text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
      >
        Preguntarle a Kipu
      </Link>
    </div>
  );
}
