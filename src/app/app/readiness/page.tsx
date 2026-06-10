import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { formatKipuMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { PulsoOrb, pulsoBand } from "../components/PulsoOrb";
import { scoreLabel } from "../components/app-dashboard-helpers";

// Pulso Kipu detail: WHY your weekly state is what it is. Readiness is the
// composite of everything Kipu watches — margin, debt, goal, data accuracy and
// learned reality — explained driver by driver, honestly.
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
  const briefing = await buildCoachingBriefing({
    userId: session.user.id,
    ctx,
    snapshot,
    surfaceNudges: false,
  });
  const m = briefing.metrics;
  const mk = briefing.margenKipu;
  const base = ctx.profile.baseCurrency;
  const band = pulsoBand(m.financialReadiness);

  const stateLine =
    band === "high"
      ? "Tu semana está en calma: hay margen real, tus pagos cercanos están considerados y tu meta sigue protegida."
      : band === "mid"
        ? "Semana estable pero con cosas que cuidar. Nada roto — solo conviene moverse con el ritmo que te sugiero."
        : "Semana exigente. Prioricemos lo esencial; yo te voy diciendo qué espacio real queda.";

  const drivers = [
    {
      label: "Margen y flexibilidad",
      score: m.spendingFlexibility,
      accent: "bg-sky-400",
      text: `Te quedan ${formatKipuMoney(mk.margenWeekly, base)} de Margen Kipu esta semana (≈ ${formatKipuMoney(mk.margenDaily, base)}/día).`,
      href: "/app/margen",
    },
    {
      label: "Presión de deuda",
      score: m.debtPressure,
      accent: "bg-orange-400",
      text:
        briefing.cardsDueSoon.length > 0
          ? `${briefing.cardsDueSoon[0].name} vence pronto — ya está reservado en tu margen.`
          : "Tus pagos de deuda no están apretando la semana.",
      href: "/app/debt",
    },
    {
      label: "Impulso de tu meta",
      score: m.goalMomentum,
      accent: "bg-violet-400",
      text: ctx.mainGoal.targetDate
        ? `"${ctx.mainGoal.name}" tiene plan y fecha; tu aporte ya está considerado.`
        : `"${ctx.mainGoal.name}" aún no tiene fecha — con fecha se vuelve un plan medible.`,
      href: "/app/goals",
    },
    {
      label: "Precisión de tus datos",
      score: m.financialAccuracy,
      accent: "bg-teal-400",
      text:
        briefing.daysSinceLastActivity !== null && briefing.daysSinceLastActivity <= 2
          ? "Tus números están frescos; puedo recomendar con confianza."
          : "Mientras más al día estén tus registros, más confiable es todo lo demás.",
      href: "/app/precision",
    },
    {
      label: "Realidad aprendida",
      score: m.budgetReality,
      accent: "bg-amber-400",
      text: "Comparo tus estimados con tu gasto real y voy afinando tu margen con el tiempo.",
      href: "/app/reality",
    },
  ];

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
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Pulso Kipu</h1>
        </div>
      </header>

      {/* The living state */}
      <section className="flex flex-col items-center rounded-3xl border border-white/5 bg-gradient-to-b from-zinc-900 to-zinc-950 px-6 py-8">
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
        <p className="mt-6 max-w-md text-center text-sm leading-6 text-zinc-400">{stateLine}</p>
      </section>

      {/* Drivers */}
      <section className="rounded-3xl border border-white/5 bg-zinc-900 p-5">
        <p className="text-sm font-medium text-zinc-300">Qué lo mueve</p>
        <div className="mt-4 space-y-4">
          {drivers.map((d) => (
            <Link key={d.label} href={d.href} className="group block">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-zinc-200 transition group-hover:text-zinc-50">
                  {d.label}
                </p>
                <span className="text-xs font-bold tabular-nums text-zinc-500">{d.score}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${d.accent}`}
                  style={{ width: `${Math.max(4, Math.min(100, d.score))}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs leading-5 text-zinc-600">{d.text}</p>
            </Link>
          ))}
        </div>
      </section>

      <p className="text-xs leading-5 text-zinc-600">
        Tu Pulso se recalcula con cada movimiento, pago y aporte. No es una nota — es la foto viva
        de tu semana, calculada con tus números reales.
      </p>
    </div>
  );
}
