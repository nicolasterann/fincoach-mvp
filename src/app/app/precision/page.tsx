import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import {
  loadEngagement,
  loadMargenCommitments,
} from "@/lib/financial/coach-state-store";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { scoreLabel } from "../components/app-dashboard-helpers";

// Precisión detail: how much Kipu's numbers can be trusted RIGHT NOW, and the
// one quick action that would improve them. Every check is a real signal —
// fresh logging, reconciliation, movement sources, income/fixed coverage.
export default async function PrecisionPage() {
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

  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const snapshot = deriveAdvisorySnapshot(ctx);
  const [briefing, engagement, commitments, { count: orphanCount }] = await Promise.all([
    buildCoachingBriefing({ userId: session.user.id, ctx, snapshot, surfaceNudges: false }),
    loadEngagement(session.user.id),
    loadMargenCommitments(session.user.id),
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id)
      .eq("type", "expense")
      .is("source_account_id", null)
      .is("debt_account_id", null)
      .gte("occurred_at", since),
  ]);

  const score = briefing.metrics.financialAccuracy;
  const days = briefing.daysSinceLastActivity;
  const reconciledDaysAgo = engagement.lastReconciledAt
    ? Math.floor((now.getTime() - new Date(engagement.lastReconciledAt).getTime()) / 86_400_000)
    : null;
  const orphans = orphanCount ?? 0;
  const hasSavingsPlan =
    commitments.monthlySavings > 0 ||
    commitments.monthlyInvestment > 0 ||
    commitments.essentialMonthlyEstimate > 0;

  type CheckState = "ok" | "warn" | "off";
  // Each non-ok check carries its fix as a chat prefill: the tip already says
  // what to do — tapping it lands in chat with the ask ready.
  const checks: { state: CheckState; label: string; tip: string; prompt: string; showActivityLink?: boolean }[] = [
    {
      state: days !== null && days <= 2 ? "ok" : days !== null && days <= 6 ? "warn" : "off",
      label:
        days === null
          ? "Aún sin movimientos registrados"
          : days <= 2
            ? "Registros frescos"
            : `Último registro hace ${days} día${days === 1 ? "" : "s"}`,
      tip:
        days !== null && days <= 2
          ? "Tus números reflejan tu vida real de los últimos días."
          : "Cuéntame un par de gastos recientes y tu margen vuelve a estar al día.",
      prompt: "quiero ponerme al día con mis gastos de estos días",
    },
    {
      state:
        reconciledDaysAgo !== null && reconciledDaysAgo <= 9
          ? "ok"
          : reconciledDaysAgo !== null
            ? "warn"
            : "off",
      label:
        reconciledDaysAgo === null
          ? "Semana aún sin cuadrar"
          : reconciledDaysAgo <= 9
            ? "Saldos cuadrados hace poco"
            : `Último cuadre hace ${reconciledDaysAgo} días`,
      tip: "Un cuadre de 10 segundos con Kipu confirma que tus saldos coinciden con tu banco.",
      prompt: "cuadremos mis saldos con mi banco",
    },
    {
      state: orphans === 0 ? "ok" : orphans <= 2 ? "warn" : "off",
      label:
        orphans === 0
          ? "Todos tus gastos tienen fuente"
          : `${orphans} gasto${orphans === 1 ? "" : "s"} sin cuenta de origen`,
      tip:
        orphans === 0
          ? "Sé exactamente de dónde sale cada peso."
          : "Dime de qué cuenta salieron y los dejo bien asignados.",
      prompt: "estos gastos no tienen cuenta: ayúdame a asignarlos",
      showActivityLink: orphans > 0,
    },
    {
      state: ctx.summary.activeIncomeSourcesCount > 0 ? "ok" : "off",
      label:
        ctx.summary.activeIncomeSourcesCount > 0
          ? "Ingresos configurados"
          : "Sin ingresos configurados",
      tip: "Con tu ingreso y su fecha calculo tu margen hasta el próximo sueldo.",
      prompt: "quiero configurar mis ingresos",
    },
    {
      state: ctx.summary.activeFixedExpensesCount > 0 ? "ok" : "warn",
      label:
        ctx.summary.activeFixedExpensesCount > 0
          ? "Gastos fijos mapeados"
          : "Sin gastos fijos registrados",
      tip: "Arriendo, suscripciones, planes — los reservo antes de decirte cuánto gastar.",
      prompt: "quiero registrar mis gastos fijos",
    },
    {
      state: hasSavingsPlan ? "ok" : "warn",
      label: hasSavingsPlan ? "Plan de ahorro/esenciales definido" : "Sin plan de ahorro/esenciales",
      tip: "Si me dices cuánto ahorras o gastas en esenciales, lo protejo en tu margen.",
      prompt: "quiero definir mi plan de ahorro y esenciales",
    },
  ];

  const firstFix = checks.find((c) => c.state !== "ok");

  const dot: Record<CheckState, string> = {
    ok: "bg-emerald-400",
    warn: "bg-amber-400",
    off: "bg-rose-400",
  };

  return (
    <div className="kipu-stagger mx-auto flex w-full max-w-2xl flex-col gap-5 pb-28 lg:pb-12">
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
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Precisión</h1>
        </div>
      </header>

      {/* Trust meter */}
      <section className="rounded-3xl border border-teal-400/20 bg-gradient-to-b from-teal-950/40 to-zinc-900 p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-300/70">
          Qué tanto puedes confiar en mis números
        </p>
        <div className="mt-3 flex items-end gap-3">
          <p className="text-5xl font-black tracking-tight text-teal-300">{score}</p>
          <p className="mb-1.5 text-sm font-bold text-teal-200/70">{scoreLabel(score)}</p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="kipu-rise h-full rounded-full bg-teal-400"
            style={{ width: `${Math.max(4, score)}%` }}
          />
        </div>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          {score >= 72
            ? "Tus datos están al día: mis recomendaciones se apoyan en tu realidad, no en supuestos."
            : firstFix
              ? `Lo que más ayudaría ahora: ${firstFix.tip.toLowerCase()}`
              : "Mientras más completo esté tu mapa, más afinadas son mis recomendaciones."}
        </p>
      </section>

      {/* Checklist — every pending fix is tappable (chat prefill, never a blind write) */}
      <section className="rounded-3xl border border-white/5 bg-zinc-900 p-5">
        <p className="text-sm font-medium text-zinc-300">Tu mapa de datos</p>
        <div className="mt-3 space-y-1.5">
          {checks.map((c) =>
            c.state === "ok" ? (
              <div key={c.label} className="flex gap-3 py-1.5">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[c.state]}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200">{c.label}</p>
                  <p className="text-xs leading-5 text-zinc-600">{c.tip}</p>
                </div>
              </div>
            ) : (
              <div key={c.label}>
                <Link
                  href={`/app/chat?share=${encodeURIComponent(c.prompt)}`}
                  className="kipu-press group -mx-2 flex gap-3 rounded-xl px-2 py-1.5 transition hover:bg-white/5"
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[c.state]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-200">{c.label}</p>
                    <p className="text-xs leading-5 text-zinc-500">{c.tip}</p>
                  </div>
                  <span
                    aria-hidden
                    className="mt-0.5 shrink-0 text-zinc-600 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-zinc-400"
                  >
                    ›
                  </span>
                </Link>
                {c.showActivityLink && (
                  <Link
                    href="/app/activity"
                    className="ml-7 inline-block text-xs font-semibold text-teal-300/80 transition hover:text-teal-200"
                  >
                    Ver mis movimientos →
                  </Link>
                )}
              </div>
            ),
          )}
        </div>
      </section>

      <Link
        href={firstFix ? `/app/chat?share=${encodeURIComponent(firstFix.prompt)}` : "/app/chat"}
        className="kipu-press block rounded-2xl bg-emerald-400 px-4 py-3 text-center text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
      >
        {firstFix ? "Ponerlo al día con Kipu" : "Cuadrar mi semana con Kipu"}
      </Link>
    </div>
  );
}
