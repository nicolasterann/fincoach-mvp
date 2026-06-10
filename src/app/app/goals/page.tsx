import Link from "next/link";
import { redirect } from "next/navigation";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { formatKipuMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { GoalPlanCard } from "../components/GoalPlanCard";

// Goals get their own space: the main goal as a plan, plus a calm nudge to turn
// it into a real plan (add a deadline) and a chat CTA to contribute.
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

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Hacia dónde vas</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-50">Metas</h1>
      </header>

      <GoalPlanCard goalPlan={goalPlan} mainGoal={mainGoal} />

      {missingDeadline && (
        <section className="rounded-3xl border border-amber-400/25 bg-amber-950/40 p-5">
          <p className="text-sm font-medium text-amber-300">Conviértela en un plan</p>
          <p className="mt-2 text-sm leading-6 text-amber-50/80">
            Ponle una fecha a tu meta y Kipu calcula cuánto apartar cada semana sin tocar tu Margen
            Kipu.
          </p>
          <Link
            href="/app/chat"
            className="mt-4 inline-block rounded-full bg-amber-300 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-amber-200"
          >
            Ponerle fecha
          </Link>
        </section>
      )}

      {otherGoals.length > 0 && (
        <section>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600">
            Otras metas
          </p>
          <div className="space-y-2">
            {otherGoals.map((g) => {
              const pct =
                g.targetAmount > 0
                  ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100))
                  : 0;
              return (
                <div
                  key={g.id}
                  className="flex items-center justify-between rounded-2xl border border-white/5 bg-zinc-900 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">{g.name}</p>
                    <p className="truncate text-xs text-zinc-600">
                      {formatKipuMoney(g.currentAmount, g.currency)} de{" "}
                      {formatKipuMoney(g.targetAmount, g.currency)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-emerald-300">{pct}%</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <Link
        href="/app/chat"
        className="rounded-2xl bg-emerald-400 px-4 py-3 text-center text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
      >
        Aportar a tu meta
      </Link>
    </div>
  );
}
