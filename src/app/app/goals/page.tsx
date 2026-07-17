import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { loadFxRatesForDisplay } from "@/lib/fx/fx-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isLiquidSpendable } from "@/lib/financial/liquidity";
import { createGoalContributionAction } from "../transaction-actions";
import { updateGoalDateAction } from "./actions";
import { getGoalStatusColor } from "../components/app-dashboard-helpers";
import { LivingThread } from "@/app/app/components/living/LivingThread";
import { ProgressStrand } from "@/app/app/components/living/ProgressStrand";

// Known ?message codes → calm human copy. Anything else renders NOTHING (raw
// codes or DB errors never leak into the UI). Codes come from
// createGoalContributionAction and updateGoalDateAction.
const NOTICES: Record<string, { text: string; tone: "emerald" | "amber" | "zinc" }> = {
  "goal-contribution-created": { text: "Aporte registrado ✓", tone: "emerald" },
  "goal-contribution-amount-required": { text: "Dime cuánto quieres aportar.", tone: "amber" },
  "goal-contribution-source-required": { text: "Elige de qué cuenta sale.", tone: "amber" },
  "goal-contribution-goal-required": {
    text: "No encontré la meta para ese aporte — recarga e intenta de nuevo.",
    tone: "amber",
  },
  "goal-contribution-fx-missing": {
    text: "Ese aporte cruza monedas y no tengo la tasa — configúrala en Ajustes → Tipo de cambio.",
    tone: "amber",
  },
  "goal-date-set": { text: "Fecha actualizada ✓", tone: "emerald" },
  "goal-date-invalid": { text: "Esa fecha no me cuadra — elige un día válido.", tone: "amber" },
};

const NOTICE_TONE_CLASSES: Record<"emerald" | "amber" | "zinc", string> = {
  emerald: "border-emerald-400/25 bg-emerald-950/50 text-emerald-100",
  amber: "border-amber-400/25 bg-amber-950/40 text-amber-100",
  zinc: "border-line/10 bg-zinc-900 text-zinc-300",
};

// Goals = the aspirational space. The main goal reads as a living plan Kipu is
// actively protecting, with DIRECT actions (set date, quick contribution) —
// chat is one option, not the toll booth for every interaction.
export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  // hasOwnProperty guard: ?message=constructor must not hit inherited keys.
  const notice =
    message && Object.prototype.hasOwnProperty.call(NOTICES, message) ? NOTICES[message] : undefined;
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect("/login");
  }

  const ctx = await buildUserFinancialContext(session.user.id);
  if (!ctx.mainGoal || ctx.accounts.length === 0) {
    redirect("/onboarding");
  }

  const baseCurrency = ctx.profile.baseCurrency;
  const displayCurrency = ctx.profile.displayCurrency; // undefined => native no-op
  const rates = await loadFxRatesForDisplay(session.user.id);
  const disp = makeDisplayFormatter(baseCurrency, displayCurrency, rates);

  const { mainGoal, goalPlan: ctxGoalPlan } = ctx;

  // Stage 27 — goals intelligence layered on the live truth: committed rhythm,
  // honest funding gap, the joy budget that survives the plan, conflict notes.
  const snapshot = deriveAdvisorySnapshot(ctx);
  const briefing = await buildCoachingBriefing({
    userId: session.user.id,
    ctx,
    snapshot,
    surfaceNudges: false,
  });
  const gi = briefing.goalsIntel;
  const mainIntel = gi.portfolio.goals.find((g) => g.goal.id === mainGoal.id) ?? null;
  // S34 — the portfolio plan is the SOURCE OF TRUTH for feasibility: it receives
  // the essential burn + essentialsKnown (the context's bare goalPlan does not),
  // so this page can't say "vas bien" while the onboarding simulator said red.
  const goalPlan = mainIntel?.plan ?? ctxGoalPlan;
  const committedWeekly = mainIntel?.committedWeekly ?? 0;

  // Stage 31 (4.5) — an "Ordenar mi mes" (organize) goal is a habit goal: no
  // amount, no deadline, no contributions. Hide every money-plan affordance so
  // the page never nags "Falta monto" nor invites aportes to a target-0 goal.
  const isOrganize = goalPlan.status === "organize";
  const otherGoals = ctx.goals.filter((g) => g.id !== mainGoal.id);
  const missingDeadline = !mainGoal.targetDate;
  const spendableAccounts = ctx.accounts.filter(isLiquidSpendable);
  const goalAccountId = mainGoal.goalAccountId ?? ctx.accounts.find((a) => a.isGoalAccount)?.id ?? "";
  const pct = Math.min(100, goalPlan.progressPercentage);
  const celebrated = pct >= 100;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const fundingGapWeekly = mainIntel?.fundingGapWeekly ?? null;
  const conflicts = gi.portfolio.conflicts.slice(0, 3);
  const joyWeekly = gi.weeklyJoyBudget;
  // Mini-goals are INDEPENDENT goals: their progress is not a position on the
  // main cord, so they render as their own strands under "Otras metas" —
  // never as knots on the main goal's strand.

  // Projected completion at the REAL committed rhythm (only without a target
  // date — with one, the canonical plan already owns the math). Estimate only.
  const projectedDate =
    missingDeadline && !celebrated && committedWeekly > 0 && goalPlan.remainingAmount > 0
      ? new Date(now.getTime() + Math.ceil(goalPlan.remainingAmount / committedWeekly) * 7 * 86_400_000)
      : null;
  const projectedLabel = projectedDate
    ? projectedDate.toLocaleDateString("es", {
        day: "numeric",
        month: "short",
        year: projectedDate.getFullYear() === now.getFullYear() ? undefined : "numeric",
      })
    : null;
  const showRhythm =
    !celebrated && (committedWeekly > 0 || (fundingGapWeekly ?? 0) > 0 || joyWeekly > 0 || projectedLabel !== null || (!isOrganize && missingDeadline && committedWeekly === 0));

  const dateLabel = mainGoal.targetDate
    ? new Date(`${mainGoal.targetDate}T00:00:00`).toLocaleDateString("es", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="kipu-stagger mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
          Hacia dónde vas
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-50">Metas</h1>
      </header>

      {/* One-shot notice from a redirect (?message=...) — known codes only */}
      {notice && (
        <div
          className={`mt-5 flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 ${NOTICE_TONE_CLASSES[notice.tone]}`}
        >
          <p className="text-sm font-medium leading-6">{notice.text}</p>
          <Link
            href="/app/goals"
            aria-label="Cerrar aviso"
            className="shrink-0 text-sm font-semibold opacity-50 transition hover:opacity-100"
          >
            ✕
          </Link>
        </div>
      )}

      {/* Main goal — a living plan */}
      <section className="mt-5 overflow-hidden rounded-3xl border border-violet-400/20 bg-gradient-to-b from-violet-950/50 to-zinc-900 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-violet-300/70">
              Tu meta principal
            </p>
            <h2 className="mt-1 truncate text-2xl font-black tracking-tight text-zinc-50">
              {mainGoal.name}
            </h2>
            <p className={`mt-1 text-xs font-semibold ${getGoalStatusColor(goalPlan.status)}`}>
              {goalPlan.statusLabel}
            </p>
          </div>
          <LivingThread tone="violet" size={104} className="shrink-0">
            {isOrganize ? (
              <p className="px-3 text-center text-xs font-bold leading-4 text-violet-300">
                En marcha
              </p>
            ) : (
              <p className="text-2xl font-black tracking-tight text-violet-300">{pct}%</p>
            )}
          </LivingThread>
        </div>

        {!isOrganize && (
          <>
            <div className="mt-4">
              <ProgressStrand
                fraction={pct / 100}
                accent="violet"
                ariaLabel={`Progreso de ${mainGoal.name}: ${pct}%`}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-zinc-400">
                {disp(goalPlan.currentAmount, mainGoal.currency)} ahorrado
              </span>
              <span className="font-semibold text-zinc-200">
                {goalPlan.remainingAmount > 0
                  ? `Falta ${disp(goalPlan.remainingAmount, mainGoal.currency)}`
                  : "¡Meta cumplida!"}
              </span>
            </div>

            {/* Plan facts */}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-line/5 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Fecha
                </p>
                <p className="mt-1 text-sm font-bold text-zinc-100">
                  {dateLabel ?? "Sin fecha aún"}
                </p>
              </div>
              <div className="rounded-2xl bg-line/5 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Ritmo sugerido
                </p>
                <p className="mt-1 text-sm font-bold text-zinc-100">
                  {goalPlan.requiredWeeklyContribution && goalPlan.requiredWeeklyContribution > 0
                    ? `${disp(goalPlan.requiredWeeklyContribution, mainGoal.currency)}/semana`
                    : "Con fecha te lo calculo"}
                </p>
              </div>
            </div>
          </>
        )}

        <p className="mt-4 text-sm leading-6 text-zinc-400">{goalPlan.message}</p>
      </section>

      {/* Celebration — the goal is complete */}
      {celebrated && (
        <section className="mt-4 rounded-3xl border border-emerald-400/25 bg-gradient-to-b from-emerald-950/50 to-zinc-900 p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400/80">
            Meta cumplida
          </p>
          <p className="mt-2 text-2xl font-black tracking-tight text-emerald-100">¡Lo lograste!</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-emerald-100/70">
            Juntaste {disp(goalPlan.currentAmount, mainGoal.currency)} para {mainGoal.name}. Eso no
            fue suerte: fue tu constancia, semana a semana. Date el gusto de celebrarlo.
          </p>
          <Link
            href={`/app/chat?share=${encodeURIComponent(`cumplí mi meta ${mainGoal.name}, ¿qué sigue?`)}`}
            className="kipu-press mt-4 inline-block rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          >
            Armar la siguiente con Kipu
          </Link>
        </section>
      )}

      {/* Your real rhythm — committed pace, honest gap, joy that survives */}
      {showRhythm && (
        <section className="mt-4 rounded-3xl border border-line/5 bg-zinc-900 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Tu ritmo</p>
          <div className="mt-2 space-y-1.5 text-sm leading-6">
            {committedWeekly > 0 && (
              <p className="text-zinc-200">
                Apartas{" "}
                <span className="font-semibold text-violet-300">
                  {disp(committedWeekly, mainGoal.currency)}/semana
                </span>{" "}
                hacia esta meta.
              </p>
            )}
            {(fundingGapWeekly ?? 0) > 0 && (
              <p className="text-zinc-300">
                Te falta ritmo:{" "}
                <span className="font-semibold text-amber-300">
                  {disp(fundingGapWeekly ?? 0, mainGoal.currency)}/semana
                </span>{" "}
                más para llegar a tiempo.
              </p>
            )}
            {projectedLabel && (
              <p className="text-zinc-300">
                A tu ritmo real, llegarías ~
                <span className="font-semibold text-zinc-100">{projectedLabel}</span>{" "}
                <span className="text-xs text-zinc-500">(estimado)</span>.
              </p>
            )}
            {joyWeekly > 0 && (
              <p className="text-zinc-400">
                Y aun así te quedan{" "}
                <span className="font-semibold text-emerald-300">{disp(joyWeekly)}</span> esta
                semana para disfrutar.
              </p>
            )}
          </div>
          {!isOrganize && missingDeadline && committedWeekly === 0 && (
            <Link
              href={`/app/chat?share=${encodeURIComponent(`quiero comprometer un aporte semanal a mi meta ${mainGoal.name}`)}`}
              className="kipu-press mt-3 block rounded-xl border border-violet-400/25 bg-violet-950/30 px-4 py-2.5 text-center text-sm font-semibold text-violet-200 transition hover:bg-violet-950/50"
            >
              Comprometer un aporte semanal con Kipu
            </Link>
          )}
        </section>
      )}

      {/* Conflicts — calm, actionable, never alarmist */}
      {conflicts.length > 0 && (
        <section className="mt-4 rounded-3xl border border-amber-400/15 bg-zinc-900 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-300/60">
            A cuidar
          </p>
          <div className="mt-2 space-y-2">
            {conflicts.map((c) => (
              <p key={c.kind + c.goalIds.join(",")} className="text-sm leading-6 text-zinc-400">
                {c.note}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* Direct action: set/move the date (no chat detour) — meaningless for an
          organize goal, which has no deadline by design */}
      {!isOrganize && (
      <section className="mt-4 rounded-3xl border border-line/5 bg-zinc-900 p-5">
        <p className="text-sm font-semibold text-zinc-200">
          {missingDeadline ? "Conviértela en un plan" : "Mover la fecha"}
        </p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          {missingDeadline
            ? "Con una fecha, calculo cuánto apartar cada semana sin tocar tu margen para vivir."
            : "Si cambia tu plan, ajusto el ritmo semanal automáticamente."}
        </p>
        <form action={updateGoalDateAction} className="mt-3 flex items-center gap-2">
          <input name="goal_id" type="hidden" value={mainGoal.id} />
          <input
            className="kipu-input min-w-0 flex-1 rounded-xl border border-line/10 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-violet-400/50"
            defaultValue={mainGoal.targetDate ?? ""}
            min={today}
            name="target_date"
            required
            type="date"
          />
          <button
            className="kipu-press shrink-0 rounded-xl bg-violet-400 px-4 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-violet-300"
            type="submit"
          >
            Guardar
          </button>
        </form>
      </section>
      )}

      {/* Direct action: quick contribution — hidden for organize goals (nothing
          to fund; money contributions belong to money goals) */}
      {!isOrganize && spendableAccounts.length > 0 && (
        <section className="mt-4 rounded-3xl border border-line/5 bg-zinc-900 p-5">
          <p className="text-sm font-semibold text-zinc-200">Aporte rápido</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Mueve algo hacia tu meta ahora mismo. Kipu ajusta los saldos al instante.
          </p>
          <form action={createGoalContributionAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input name="goal_id" type="hidden" value={mainGoal.id} />
            <input name="goal_account_id" type="hidden" value={goalAccountId} />
            <input name="currency" type="hidden" value={mainGoal.currency} />
            <input name="description" type="hidden" value={`Aporte a ${mainGoal.name}`} />
            <input name="redirectTo" type="hidden" value="/app/goals" />
            <input
              className="kipu-input w-full rounded-xl border border-line/10 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/50 sm:w-28"
              inputMode="decimal"
              min="0.01"
              name="amount"
              placeholder="Monto"
              required
              step="0.01"
              type="number"
            />
            <select
              className="kipu-select min-w-0 flex-1 rounded-xl border border-line/10 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/50"
              defaultValue={spendableAccounts[0]?.id}
              name="source_account_id"
            >
              {spendableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  Desde {a.name}
                </option>
              ))}
            </select>
            <button
              className="kipu-press shrink-0 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
              type="submit"
            >
              Aportar
            </button>
          </form>
        </section>
      )}

      {/* Other goals */}
      {otherGoals.length > 0 && (
        <section className="mt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">
            Otras metas
          </p>
          <div className="space-y-2">
            {otherGoals.map((g) => {
              const gp =
                g.targetAmount > 0
                  ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100))
                  : 0;
              return (
                <Link
                  key={g.id}
                  href={`/app/chat?share=${encodeURIComponent(`¿cómo va mi meta ${g.name}?`)}`}
                  className="kipu-press group block rounded-2xl border border-line/5 bg-zinc-900 px-4 py-3 transition hover:border-line/15"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-zinc-100">{g.name}</p>
                    <span className="flex shrink-0 items-center gap-1.5 text-sm font-bold text-violet-300">
                      {gp}%
                      <span
                        aria-hidden
                        className="text-zinc-600 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-zinc-400"
                      >
                        ›
                      </span>
                    </span>
                  </div>
                  <ProgressStrand fraction={gp / 100} accent="violet" ariaLabel={`Progreso de ${g.name}: ${gp}%`} />
                  <p className="text-xs text-zinc-600">
                    {disp(g.currentAmount, g.currency)} de{" "}
                    {disp(g.targetAmount, g.currency)}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Chat as the conversational option, not the only path */}
      <Link
        href="/app/chat"
        className="mt-5 block rounded-2xl border border-line/10 px-4 py-3 text-center text-sm font-semibold text-zinc-300 transition hover:bg-line/5"
      >
        ¿Dudas con tu meta? Pregúntale a Kipu
      </Link>
    </div>
  );
}
