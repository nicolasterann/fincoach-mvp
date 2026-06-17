import Link from "next/link";
import { redirect } from "next/navigation";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { buildDebtHealth, type CardHealthState } from "@/lib/financial/debt-health";
import { formatKipuMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { translateDebtPressure } from "../components/app-dashboard-helpers";

// Debt drill-down: what you owe, what each card asks for, and when — with the
// calm framing that the payments are ALREADY reserved inside Margen Kipu.
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

  const base = ctx.profile.baseCurrency;
  const debts = ctx.debtAccounts;
  const pressure = ctx.dashboard.debtPressure;
  const totalDebt = debts.reduce((t, d) => t + d.currentBalanceBase, 0);

  // Pressure meter: what share of monthly income this cycle's debt payments eat.
  const monthlyIncome = ctx.summary.estimatedMonthlyIncome;
  const pressurePct =
    monthlyIncome > 0 ? Math.min(100, Math.round((pressure.monthlyDebtDue / monthlyIncome) * 100)) : null;

  // Days until each card's payment day (month-aware), for "vence en N días" chips.
  const now = new Date();
  const daysUntil = (dueDay: number): number => {
    const today = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return dueDay >= today ? dueDay - today : daysInMonth - today + dueDay;
  };

  // Stage 14 — the same deterministic debt-health truth chat & Telegram use.
  const health = buildDebtHealth({
    debtAccounts: debts,
    accounts: ctx.accounts,
    monthlyIncome,
    nowMs: now.getTime(),
    recentDebtPayments: [],
  });
  const healthById = new Map(health.cards.map((c) => [c.id, c]));
  const STATE_CHIP: Partial<Record<CardHealthState, { label: string; cls: string }>> = {
    overdue: { label: "¿ya pagaste?", cls: "bg-rose-400/15 text-rose-300" },
    needs_payment_confirmation: { label: "¿ya pagaste?", cls: "bg-amber-400/15 text-amber-300" },
    high_interest_risk: { label: "tasa alta", cls: "bg-rose-400/15 text-rose-300" },
    revolving_risk: { label: "interés corriendo", cls: "bg-orange-400/15 text-orange-300" },
    stale_statement: { label: "dato viejo", cls: "bg-zinc-400/15 text-zinc-300" },
  };

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
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
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Tu deuda</h1>
        </div>
      </header>

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
              {formatKipuMoney(totalDebt, base)}
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              {pressure.monthlyDebtDue > 0
                ? `Pagos de este ciclo: ~${formatKipuMoney(pressure.monthlyDebtDue, base)}. Ya están apartados dentro de tu Margen Kipu — no tienes que recalcular nada.`
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
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full ${pressurePct >= 35 ? "bg-rose-400" : pressurePct >= 20 ? "bg-amber-400" : "bg-emerald-400"}`}
                    style={{ width: `${Math.max(3, pressurePct)}%` }}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Each debt */}
          <section className="mt-4 space-y-2">
            {debts.map((d) => {
              const dueIn = d.dueDay ? daysUntil(d.dueDay) : null;
              const dueSoon = dueIn !== null && dueIn <= 5 && d.currentBalanceBase > 0;
              const ch = healthById.get(d.id);
              const chip = ch ? STATE_CHIP[ch.state] : undefined;
              return (
                <div key={d.id} className="rounded-2xl border border-white/5 bg-zinc-900 p-4">
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
                      {formatKipuMoney(d.currentBalanceBase, base)}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    {d.dueDay && <span>Paga el día {d.dueDay}</span>}
                    {d.cutoffDay && <span>Corte el día {d.cutoffDay}</span>}
                    {(d.minimumPayment ?? 0) > 0 && (
                      <span>Mínimo {formatKipuMoney(d.minimumPayment!, base)}</span>
                    )}
                    {(d.fullPaymentDue ?? 0) > 0 && (
                      <span>Pago del mes {formatKipuMoney(d.fullPaymentDue!, base)}</span>
                    )}
                  </div>
                  {ch?.estMonthlyInterest != null && ch.estMonthlyInterest > 0 && (
                    <p className="mt-2 text-xs leading-5 text-rose-300/80">
                      Si arrastras este saldo, el interés ronda ~{formatKipuMoney(ch.estMonthlyInterest, base)}/mes (estimado).
                    </p>
                  )}
                  {dueSoon && (
                    <p className="mt-2 text-xs leading-5 text-zinc-600">
                      Este pago ya está reservado en tu margen; pagarlo a tiempo te evita intereses.
                    </p>
                  )}
                </div>
              );
            })}
          </section>

          <p className="mt-4 text-xs leading-5 text-zinc-600">
            Recuerda: la tarjeta es deuda, no dinero disponible. Cada compra con tarjeta sube esta
            cifra y cada pago la baja — y yo voy ajustando tu margen solo.
          </p>

          <Link
            href="/app/chat"
            className="mt-4 block rounded-2xl bg-emerald-400 px-4 py-3 text-center text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          >
            Armar un plan de pago con Kipu
          </Link>
        </>
      )}
    </div>
  );
}
