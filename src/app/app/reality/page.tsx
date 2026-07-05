import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { loadFxRates } from "@/lib/fx/fx-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
// formatKipuMoney is no longer imported here — all money renders go through `disp`
// (Stage 24 display formatter), which is byte-identical to it when displayCurrency === base.
import {
  scoreLabel,
  translateTransactionCategory,
} from "../components/app-dashboard-helpers";
import { Chevron, PressCard } from "@/app/app/components/living/shell";

interface CatRow {
  category: string | null;
  base_amount: number | string;
}

// Realidad detail: what Kipu is LEARNING about the user's actual behavior —
// initial estimates vs real 30-day spending per category, where there isn't
// enough history yet, and how this feeds back into Margen Kipu. The budget
// starts as a hypothesis; daily life reveals the truth.
export default async function RealityPage() {
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
  const [briefing, { data: catRows }] = await Promise.all([
    buildCoachingBriefing({ userId: session.user.id, ctx, snapshot, surfaceNudges: false }),
    supabase
      .from("transactions")
      .select("category, base_amount")
      .eq("user_id", session.user.id)
      .eq("type", "expense")
      .gte("occurred_at", since)
      .limit(400),
  ]);

  const base = ctx.profile.baseCurrency;
  // Stage 24 — WEB-ONLY display-currency re-expression. No-op (byte-identical to
  // formatKipuMoney) when displayCurrency === base; base_amount stays the source of truth.
  const displayCurrency = ctx.profile.displayCurrency; // undefined => native no-op
  const rates = await loadFxRates(session.user.id);
  const disp = makeDisplayFormatter(base, displayCurrency, rates);
  const score = briefing.metrics.budgetReality;

  // Stage 16 — the behavioral spending OS, surfaced WITHOUT clutter: the single
  // thing that matters and any detected subscriptions. Everything else stays in
  // chat. Guards keep low-confidence/empty states from rendering noise.
  const si = briefing.spendingIntel;
  const oneThing = si.insights.theOneThing && si.insights.theOneThing.kind !== "low_data" ? si.insights.theOneThing : null;
  const detectedSubs = si.subscriptions.subscriptions.filter((s) => s.confidence !== "low").slice(0, 5);
  const cadenceEs = (c: string) => (c === "weekly" ? "sem" : c === "biweekly" ? "quincena" : c === "annual" ? "año" : "mes");

  // Stage 27 — goals/wealth and household live on THEIR pages now (/app/goals,
  // /app/household); here they collapse to one honest line + link each.
  const gi = briefing.goalsIntel;
  const primaryGoal = gi.portfolio.primary;
  const showGoals = gi.portfolio.activeCount > 0 || gi.weeklyJoyBudget > 0 || gi.netWorth != null;
  const goalsSummary = primaryGoal
    ? `${primaryGoal.goal.name} · ${primaryGoal.progressPct}%${gi.portfolio.activeCount > 1 ? ` · ${gi.portfolio.activeCount} metas activas` : ""}`
    : gi.portfolio.activeCount > 0
      ? `${gi.portfolio.activeCount} meta${gi.portfolio.activeCount === 1 ? "" : "s"} activa${gi.portfolio.activeCount === 1 ? "" : "s"}`
      : gi.netWorth
        ? `Patrimonio estimado: ${disp(gi.netWorth.totalNetWorth)}`
        : `Margen para gustos esta semana: ${disp(gi.weeklyJoyBudget)}`;
  const firstHousehold = briefing.household.households[0];
  const householdSummary = firstHousehold
    ? `${firstHousehold.name}: ${firstHousehold.nextAction}${briefing.household.households.length > 1 ? ` · +${briefing.household.households.length - 1} más` : ""}`
    : "";

  // Actual 30-day spend per category (real observed behavior).
  const actualByCat = new Map<string, { total: number; count: number }>();
  for (const row of (catRows ?? []) as CatRow[]) {
    const key = row.category ?? "other";
    const prev = actualByCat.get(key) ?? { total: 0, count: 0 };
    prev.total += Math.abs(Number(row.base_amount) || 0);
    prev.count += 1;
    actualByCat.set(key, prev);
  }

  // Estimates (the starting hypotheses) vs what really happened.
  const estimates = ctx.budgetCategories
    .filter((c) => c.isActive && c.amount > 0)
    .map((c) => {
      const actual = actualByCat.get(c.category) ?? { total: 0, count: 0 };
      const ratio = c.amount > 0 ? actual.total / c.amount : 0;
      const state =
        actual.count < 3
          ? ("learning" as const)
          : ratio > 1.2
            ? ("over" as const)
            : ratio < 0.6
              ? ("under" as const)
              : ("match" as const);
      return { category: c.category, estimate: c.amount, actual: actual.total, count: actual.count, ratio, state };
    })
    .sort((a, b) => b.estimate - a.estimate);

  // Observed spending in categories the user never estimated.
  const estimatedSet = new Set<string>(estimates.map((e) => e.category));
  const observedOnly = [...actualByCat.entries()]
    .filter(([cat]) => !estimatedSet.has(cat))
    .map(([category, v]) => ({ category, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);

  const STATE_COPY = {
    learning: { label: "Aprendiendo", color: "text-zinc-500", bar: "bg-zinc-600" },
    match: { label: "Se parece a tu estimado", color: "text-emerald-300", bar: "bg-emerald-400" },
    over: { label: "Va más alto que tu estimado", color: "text-amber-300", bar: "bg-amber-400" },
    under: { label: "Va más bajo que tu estimado", color: "text-sky-300", bar: "bg-sky-400" },
  } as const;

  return (
    <div className="kipu-stagger mx-auto flex w-full max-w-2xl flex-col gap-5 pb-28 lg:pb-12">
      <header className="flex items-center gap-3">
        <Link
          href="/app"
          aria-label="Volver"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line/10 text-zinc-400 transition hover:bg-line/5"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Detalle</p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Realidad</h1>
        </div>
      </header>

      {/* Learning state */}
      <section className="rounded-3xl border border-amber-400/20 bg-gradient-to-b from-amber-950/30 to-zinc-900 p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-300/70">
          Lo que voy aprendiendo de tu gasto real
        </p>
        <div className="mt-3 flex items-end gap-3">
          <p className="text-5xl font-black tracking-tight text-amber-300">{score}</p>
          <p className="mb-1.5 text-sm font-bold text-amber-200/70">{scoreLabel(score)}</p>
        </div>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Tu presupuesto empieza como una hipótesis; tu vida diaria revela la verdad. Comparo lo
          que estimaste con lo que realmente gastas y voy afinando tu Margen Kipu — sin que tengas
          que recalcular nada.
        </p>
      </section>

      {/* Stage 16 — the one thing that matters this week (simple outside) */}
      {oneThing && (
        <section className="rounded-3xl border border-line/5 bg-zinc-900 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Lo que más importa</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-zinc-100">{oneThing.title}</p>
          {oneThing.suggestedAction && (
            <p className="mt-1.5 text-sm leading-6 text-emerald-300/80">{oneThing.suggestedAction}</p>
          )}
          {oneThing.detail && <p className="mt-1.5 text-xs leading-5 text-zinc-500">{oneThing.detail}</p>}
        </section>
      )}

      {/* Stage 27 — goals live at /app/goals; here just the honest one-liner + link */}
      {showGoals && (
        <PressCard href="/app/goals" className="p-5" ariaLabel="Ver mis metas">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
                Metas y patrimonio
              </p>
              <p className="mt-1 truncate text-sm leading-6 text-zinc-300">{goalsSummary}</p>
            </div>
            <Chevron />
          </div>
        </PressCard>
      )}

      {/* Stage 27 — shared money lives at /app/household; one-liner + link */}
      {briefing.household.hasHousehold && firstHousehold && (
        <PressCard href="/app/household" className="p-5" ariaLabel="Ver dinero en común">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
                Compartido
              </p>
              <p className="mt-1 truncate text-sm leading-6 text-zinc-300">{householdSummary}</p>
            </div>
            <Chevron />
          </div>
        </PressCard>
      )}

      {/* Estimates vs reality */}
      {estimates.length > 0 ? (
        <section className="rounded-3xl border border-line/5 bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-300">Estimado vs. realidad · 30 días</p>
          <p className="mt-1 text-xs leading-5 text-zinc-600">
            Comparo contra tus últimos 30 días, no el mes calendario.
          </p>
          <div className="kipu-stagger mt-4 space-y-4">
            {estimates.map((e) => {
              const c = STATE_COPY[e.state];
              const fill = Math.max(3, Math.min(100, Math.round(e.ratio * 100)));
              return (
                <div key={e.category}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-zinc-200">
                      {translateTransactionCategory(e.category)}
                    </p>
                    <p className={`text-xs font-bold ${c.color}`}>{c.label}</p>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/10">
                    <div className={`kipu-rise h-full rounded-full ${c.bar}`} style={{ width: `${fill}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-600">
                    {disp(e.actual)} real de {disp(e.estimate)}{" "}
                    estimado
                    {e.state === "learning"
                      ? ` · ${e.count === 0 ? "aún sin registros" : `solo ${e.count} registro${e.count === 1 ? "" : "s"}`} — necesito ver más para opinar`
                      : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-line/5 bg-zinc-900 p-6 text-center">
          <p className="text-sm font-medium text-zinc-200">Aún sin estimados por categoría</p>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            Dime cuánto sueles gastar en comida o transporte (aunque sea aproximado) y empiezo a
            comparar tu plan con tu realidad.
          </p>
        </section>
      )}

      {/* What Kipu observed beyond the plan */}
      {observedOnly.length > 0 && (
        <section className="rounded-3xl border border-line/5 bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-300">También estoy viendo</p>
          <div className="mt-3 space-y-2">
            {observedOnly.map((o) => (
              <div key={o.category} className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">{translateTransactionCategory(o.category)}</span>
                <span className="font-semibold tabular-nums text-zinc-300">
                  {disp(o.total)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-600">
            Patrones que aparecen en tu gasto real aunque no estaban en tu plan inicial. Con más
            semanas, los convierto en estimados aprendidos.
          </p>
        </section>
      )}

      {/* Stage 16 — detected recurring charges / subscriptions */}
      {detectedSubs.length > 0 && (
        <section className="rounded-3xl border border-line/5 bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-300">Cobros recurrentes que detecté</p>
          <div className="mt-3 space-y-1">
            {detectedSubs.map((s) => {
              const inner = (
                <>
                  <span className="text-zinc-400">
                    {s.merchantFamily}
                    {s.alreadyModeled ? <span className="ml-2 text-xs text-emerald-400/70">ya es fijo</span> : s.suggestConvert ? <span className="ml-2 text-xs text-amber-300/70">no está como fijo</span> : null}
                  </span>
                  <span className="font-semibold tabular-nums text-zinc-300">
                    {disp(s.amount)}
                    <span className="ml-1 text-xs font-normal text-zinc-600">/{cadenceEs(s.cadence)}</span>
                  </span>
                </>
              );
              // Not yet a fixed expense → one tap hands it to chat to convert
              // (Kipu confirms; nothing is written from here).
              return s.alreadyModeled ? (
                <div key={`${s.merchantFamily}-${s.amount}`} className="flex min-h-11 items-center justify-between gap-3 text-sm">
                  {inner}
                </div>
              ) : (
                <Link
                  key={`${s.merchantFamily}-${s.amount}`}
                  href={`/app/chat?share=${encodeURIComponent(`convierte ${s.merchantFamily} en gasto fijo`)}`}
                  className="kipu-press -mx-2 flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 text-sm transition hover:bg-line/5"
                >
                  {inner}
                </Link>
              );
            })}
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-600">
            Si alguno no está como gasto fijo, dile a Kipu y lo deja en tu plan para que no te sorprenda.
          </p>
        </section>
      )}

      <Link
        href="/app/chat"
        className="block rounded-2xl border border-line/10 px-4 py-3 text-center text-sm font-semibold text-zinc-300 transition hover:bg-line/5"
      >
        Ajustar mis estimados con Kipu
      </Link>
    </div>
  );
}
