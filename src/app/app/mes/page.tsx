import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { formatKipuMoney } from "@/lib/financial/money";
import { buildTuMesFlows, buildTuMesMetrics, goalMonthlyEquivalent } from "@/lib/financial/tu-mes";
import { loadFxRates } from "@/lib/fx/fx-store";
import { listScheduledChanges, type ScheduledChange } from "@/lib/scheduled/scheduled-changes-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { MonthSankey } from "../components/living/MonthSankey";
import { Chevron, ChatCta, MetricShell, PressCard, Section } from "../components/living/shell";
import { LearningState } from "../components/living/states";
import { MesRedistribute, type MesGoalRow } from "./MesRedistribute";

// Stage 37 — "Tu mes", the PLANNING view (la foto): how a typical month splits
// into fijos, deuda, esenciales y lo que apartas, and what stays free to
// redistribute. Vocabulary is repartir/apartar — the daily "gastar" number is the
// Margen (la película) and lives at /app/margen. Same engine as everywhere:
// briefing.margenKipu.capacity — never a second computation.

const shortDate = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es", { day: "numeric", month: "short" });

// Minimal human phrasing for pending plans (page-side mirror of the agent's voice).
function describePlan(c: ScheduledChange, base: string): string {
  const cur = c.currency ?? base;
  const amt = (v: number) => formatKipuMoney(v, cur as Parameters<typeof formatKipuMoney>[1]);
  const what =
    c.changeKind === "set_amount"
      ? `pasa a ${amt(c.amount ?? 0)}`
      : c.changeKind === "adjust_percent"
        ? `${(c.amount ?? 0) >= 0 ? "sube" : "baja"} ${Math.abs(c.amount ?? 0)}%`
        : c.changeKind === "adjust_fixed"
          ? `${(c.amount ?? 0) >= 0 ? "sube" : "baja"} ${amt(Math.abs(c.amount ?? 0))}`
          : c.changeKind === "pause"
            ? "se pausa"
            : c.changeKind === "resume"
              ? "se reactiva"
              : c.changeKind === "set_frequency"
                ? `pasa a frecuencia ${c.newFrequency ?? "?"}`
                : "recordatorio";
  const prefix = c.targetType === "goal" && c.targetField === "contribution" ? `El aporte a ${c.targetLabel}` : c.targetLabel;
  return `${prefix} ${what}`;
}

export default async function TuMesPage() {
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
  const [briefing, scheduled, rates] = await Promise.all([
    buildCoachingBriefing({ userId: session.user.id, ctx, snapshot, surfaceNudges: false }),
    listScheduledChanges(session.user.id),
    loadFxRates(session.user.id),
  ]);

  const capacity = briefing.margenKipu.capacity;
  const base = ctx.profile.baseCurrency;
  const disp = makeDisplayFormatter(base, ctx.profile.displayCurrency, rates);

  if (capacity.monthlyIncome <= 0) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
        <MetricShell kicker="Planificación" title="Tu mes" />
        <div className="mt-5">
          <LearningState
            title="Tu mes está por armarse"
            body="Aquí ves cómo se reparte un mes típico tuyo: qué entra, qué se va a fijos, deuda y esenciales, y cuánto queda libre para repartir."
            unlockHint="Para armarlo necesito al menos un ingreso. Cuéntamelo en el chat y esta página cobra vida."
            ctaLabel="Contarle a Kipu mi ingreso"
            ctaPrompt="Quiero registrar mi ingreso mensual"
          />
        </div>
      </div>
    );
  }

  const flows = buildTuMesFlows(capacity);
  const m = buildTuMesMetrics(capacity);

  const goalRows: MesGoalRow[] = ctx.goals
    .filter((g) => g.status === "active")
    .map((g) => ({
      id: g.id,
      name: g.name,
      contributionAmount: g.contributionAmount ?? 0,
      cadence: g.cadence ?? null,
      currency: (g.currency ?? base).toUpperCase(),
      protected: g.cashflowProtected !== false,
    }));
  const baseGoalsMonthly = goalRows
    .filter((g) => g.protected && g.currency === base.toUpperCase())
    .reduce((sum, g) => sum + goalMonthlyEquivalent(g.contributionAmount, g.cadence), 0);
  const foreignGoalsMonthlyBase = Math.max(0, Math.round((capacity.monthlyProtected.goals - baseGoalsMonthly) * 100) / 100);

  const pendingPlans = scheduled.filter(
    (s) => s.status === "pending" && s.targetType !== "reminder" && s.changeKind !== "reminder",
  );

  const usesBudgets = ctx.budgetCategories.some((c) => c.isActive);

  const composition = [
    { key: "in", label: "Entra", amount: m.monthlyIncome, pct: null as number | null, tone: "text-emerald-300" },
    { key: "fixed", label: "Gastos fijos", amount: m.monthlyFixed, pct: m.fixedPct, tone: "text-zinc-200" },
    { key: "debt", label: "Deudas", amount: m.monthlyDebtService, pct: m.debtPct, tone: "text-rose-200" },
    { key: "essential", label: "Lo esencial", amount: m.monthlyEssentials, pct: m.essentialPct, tone: "text-amber-200" },
    { key: "apartado", label: "Apartas (ahorro + inversión + metas)", amount: m.monthlyApartado, pct: m.apartadoPct, tone: "text-sky-200" },
    { key: "free", label: "Libre sin asignar", amount: m.monthlyFreeReal, pct: m.freePct, tone: m.overcommitted ? "text-rose-300" : "text-emerald-300" },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <MetricShell
        kicker="Planificación"
        title="Tu mes"
        right={<span className="rounded-full border border-line/10 px-3 py-1 text-xs font-semibold text-zinc-400">/mes</span>}
      />

      <div className="kipu-stagger">
        <div
          className={`mt-5 rounded-3xl border p-5 text-center ${
            m.overcommitted
              ? "border-rose-400/25 bg-gradient-to-b from-rose-500/10 to-transparent"
              : "border-emerald-400/20 bg-gradient-to-b from-emerald-500/10 to-transparent"
          }`}
        >
          <p className={`text-xs font-semibold uppercase tracking-widest ${m.overcommitted ? "text-rose-300/80" : "text-emerald-300/80"}`}>
            {m.overcommitted ? "Repartiste más de lo que rinde" : "Libre para repartir"}
          </p>
          <p className="mt-1 text-3xl font-black text-zinc-50">{disp(Math.abs(m.monthlyFreeReal))}</p>
          <p className="mt-1 text-xs text-zinc-400">
            {m.overcommitted
              ? "de más al mes · ajusta abajo lo que apartas para que respire"
              : "al mes · después de fijos, deuda, esenciales y lo que apartas"}
          </p>
        </div>

        <Section kicker="Cómo se reparte">
          <MonthSankey income={capacity.monthlyIncome} flows={flows} base={base} />
          <p className="mt-3 text-xs leading-5 text-zinc-600">
            Un mes típico tuyo, mensualizado. No es tu saldo ni tu día a día — para “¿cuánto puedo gastar hoy?” está tu{" "}
            <Link href="/app/saldo" className="font-semibold text-emerald-400 hover:text-emerald-300">
              Saldo Kipu
            </Link>
            .
          </p>
        </Section>

        <Section kicker="De qué está hecho">
          <div className="divide-y divide-line/5">
            {composition.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <p className="min-w-0 truncate text-sm text-zinc-400">{row.label}</p>
                <p className="shrink-0 text-sm font-semibold tabular-nums">
                  <span className={row.tone}>{row.key === "free" && m.overcommitted ? `−${disp(Math.abs(row.amount))}` : disp(row.amount)}</span>
                  {row.pct !== null && <span className="ml-2 text-xs font-normal text-zinc-600">{row.pct}%</span>}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-line/5 bg-line/[0.03] p-3 text-xs leading-5 text-zinc-500">
            {m.monthlyApartado > 0 ? (
              <>
                Si mantienes lo que apartas, en un año son{" "}
                <span className="font-semibold text-zinc-300">~{disp(m.apartadoYearly)}</span> entre ahorro, inversión y metas.
              </>
            ) : (
              <>Todavía no apartas nada fijo al mes. Abajo puedes empezar — hasta un monto pequeño cuenta.</>
            )}
            {usesBudgets && <> Lo esencial sale de tus presupuestos por categoría.</>}
          </div>
        </Section>

        <Section kicker="Redistribuir" aside={<span className="text-xs text-zinc-600">en tu moneda base</span>}>
          <MesRedistribute
            base={base}
            savings={capacity.monthlyProtected.savings}
            investment={capacity.monthlyProtected.investment}
            disposable={capacity.monthlyDisposableBeforeAllocations}
            foreignGoalsMonthlyBase={foreignGoalsMonthlyBase}
            goals={goalRows}
          />
        </Section>

        {pendingPlans.length > 0 && (
          <Section kicker="Cambios ya programados">
            <div className="divide-y divide-line/5">
              {pendingPlans.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <p className="min-w-0 text-sm leading-5 text-zinc-300">{describePlan(p, base)}</p>
                  <p className="shrink-0 text-xs font-semibold text-zinc-500">{shortDate(p.nextRunDate)}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-600">
              Se aplican solos ese día y Kipu te lo confirma. Para cancelar uno, díselo en el chat.
            </p>
          </Section>
        )}

        <PressCard href="/app/saldo" className="mt-5 px-5 py-4" ariaLabel="Ver el Saldo Kipu">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">De aquí sale</p>
              <p className="mt-1 text-sm leading-5 text-zinc-400">
                Tu <span className="font-semibold text-emerald-300">Saldo Kipu</span> — lo que puedes gastar tranquilo hoy, según tu saldo y tus fechas.
              </p>
            </div>
            <Chevron className="shrink-0 text-lg" />
          </div>
        </PressCard>

        <ChatCta
          label="Redistribuir con Kipu"
          prompt="Quiero redistribuir mi mes: revisemos cuánto aparto a ahorro, inversión y metas."
        />
      </div>
    </div>
  );
}
