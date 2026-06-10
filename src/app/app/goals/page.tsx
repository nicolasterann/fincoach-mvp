import Link from "next/link";
import { redirect } from "next/navigation";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { formatKipuMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isLiquidSpendable } from "@/lib/financial/liquidity";
import { createGoalContributionAction } from "../transaction-actions";
import { updateGoalDateAction } from "./actions";
import { getGoalStatusColor } from "../components/app-dashboard-helpers";

// Goals = the aspirational space. The main goal reads as a living plan Kipu is
// actively protecting, with DIRECT actions (set date, quick contribution) —
// chat is one option, not the toll booth for every interaction.
export default async function GoalsPage() {
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

  const { mainGoal, goalPlan } = ctx;
  const otherGoals = ctx.goals.filter((g) => g.id !== mainGoal.id);
  const missingDeadline = !mainGoal.targetDate;
  const spendableAccounts = ctx.accounts.filter(isLiquidSpendable);
  const goalAccountId = mainGoal.goalAccountId ?? ctx.accounts.find((a) => a.isGoalAccount)?.id ?? "";
  const pct = Math.min(100, goalPlan.progressPercentage);
  const today = new Date().toISOString().slice(0, 10);

  const dateLabel = mainGoal.targetDate
    ? new Date(`${mainGoal.targetDate}T00:00:00`).toLocaleDateString("es", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
          Hacia dónde vas
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-50">Metas</h1>
      </header>

      {/* Main goal — a living plan */}
      <section className="mt-5 overflow-hidden rounded-3xl border border-violet-400/20 bg-gradient-to-b from-violet-950/50 to-zinc-900 p-6">
        <div className="flex items-start justify-between gap-4">
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
          <div className="shrink-0 text-right">
            <p className="text-4xl font-black tracking-tight text-violet-300">{pct}%</p>
          </div>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-400 to-emerald-400"
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-zinc-400">
            {formatKipuMoney(goalPlan.currentAmount, mainGoal.currency)} ahorrado
          </span>
          <span className="font-semibold text-zinc-200">
            {goalPlan.remainingAmount > 0
              ? `Falta ${formatKipuMoney(goalPlan.remainingAmount, mainGoal.currency)}`
              : "¡Meta cumplida!"}
          </span>
        </div>

        {/* Plan facts */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-white/5 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Fecha
            </p>
            <p className="mt-1 text-sm font-bold text-zinc-100">
              {dateLabel ?? "Sin fecha aún"}
            </p>
          </div>
          <div className="rounded-2xl bg-white/5 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Ritmo sugerido
            </p>
            <p className="mt-1 text-sm font-bold text-zinc-100">
              {goalPlan.requiredWeeklyContribution && goalPlan.requiredWeeklyContribution > 0
                ? `${formatKipuMoney(goalPlan.requiredWeeklyContribution, mainGoal.currency)}/semana`
                : "Con fecha te lo calculo"}
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-6 text-zinc-400">{goalPlan.message}</p>
      </section>

      {/* Direct action: set/move the date (no chat detour) */}
      <section className="mt-4 rounded-3xl border border-white/5 bg-zinc-900 p-5">
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
            className="kipu-input min-w-0 flex-1 rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-violet-400/50"
            defaultValue={mainGoal.targetDate ?? ""}
            min={today}
            name="target_date"
            required
            type="date"
          />
          <button
            className="shrink-0 rounded-xl bg-violet-400 px-4 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-violet-300"
            type="submit"
          >
            Guardar
          </button>
        </form>
      </section>

      {/* Direct action: quick contribution */}
      {spendableAccounts.length > 0 && (
        <section className="mt-4 rounded-3xl border border-white/5 bg-zinc-900 p-5">
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
              className="kipu-input w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/50 sm:w-28"
              inputMode="decimal"
              min="0.01"
              name="amount"
              placeholder="Monto"
              required
              step="0.01"
              type="number"
            />
            <select
              className="kipu-select min-w-0 flex-1 rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-400/50"
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
              className="shrink-0 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
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
                <div
                  key={g.id}
                  className="rounded-2xl border border-white/5 bg-zinc-900 px-4 py-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="min-w-0 truncate text-sm font-medium text-zinc-100">{g.name}</p>
                    <span className="shrink-0 text-sm font-bold text-violet-300">{gp}%</span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-violet-400" style={{ width: `${Math.max(2, gp)}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-600">
                    {formatKipuMoney(g.currentAmount, g.currency)} de{" "}
                    {formatKipuMoney(g.targetAmount, g.currency)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Chat as the conversational option, not the only path */}
      <Link
        href="/app/chat"
        className="mt-5 block rounded-2xl border border-white/10 px-4 py-3 text-center text-sm font-semibold text-zinc-300 transition hover:bg-white/5"
      >
        ¿Dudas con tu meta? Pregúntale a Kipu
      </Link>
    </div>
  );
}
