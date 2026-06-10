import Link from "next/link";
import { redirect } from "next/navigation";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
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
          </section>

          {/* Each debt */}
          <section className="mt-4 space-y-2">
            {debts.map((d) => (
              <div key={d.id} className="rounded-2xl border border-white/5 bg-zinc-900 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-zinc-100">{d.name}</p>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-orange-300">
                    {formatKipuMoney(d.currentBalanceBase, base)}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                  {d.dueDay && <span>Vence el día {d.dueDay}</span>}
                  {d.cutoffDay && <span>Corte el día {d.cutoffDay}</span>}
                  {(d.minimumPayment ?? 0) > 0 && (
                    <span>Mínimo {formatKipuMoney(d.minimumPayment!, base)}</span>
                  )}
                  {(d.fullPaymentDue ?? 0) > 0 && (
                    <span>Pago del mes {formatKipuMoney(d.fullPaymentDue!, base)}</span>
                  )}
                </div>
              </div>
            ))}
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
