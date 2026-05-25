import { redirect } from "next/navigation";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { formatMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { signOutAction } from "./actions";
import {
  createChatParsedTransactionAction,
  createGoalContributionAction,
  createManualExpenseAction,
  createManualIncomeAction,
} from "./transaction-actions";
import type { Account, CoachTone, DebtAccount, FinancialGoal } from "@/types/financial";

export default async function AppPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const ctx = await buildUserFinancialContext(session.user.id);

  const { data: recentTransactions, error: transactionsError } = await supabase
    .from("transactions")
    .select(
      "id, description, category, base_amount, base_currency, type, occurred_at, source_account_id, debt_account_id, goal_id",
    )
    .eq("user_id", session.user.id)
    .order("occurred_at", { ascending: false })
    .limit(5);

  if (transactionsError) {
    throw new Error(transactionsError.message);
  }

  if (!ctx.mainGoal || ctx.accounts.length === 0 || !ctx.dashboard) {
    redirect("/onboarding");
  }

  const { mainGoal, dashboard } = ctx;
  const baseCurrency = ctx.profile.baseCurrency;
  const firstName = ctx.profile.fullName?.split(" ")[0] ?? "";
  const noTransactions = (recentTransactions ?? []).length === 0;

  const nextStep = computeNextStep(
    mainGoal,
    dashboard.flexibleSpending.totalAvailableCash,
    ctx.summary.totalDebtBalanceBase,
    noTransactions,
  );

  const chatExamples = buildChatExamples(ctx.accounts, ctx.debtAccounts, mainGoal);

  const nonGoalAccountCount = ctx.accounts.filter((a) => !a.isGoalAccount).length;

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-md flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-medium text-emerald-300">Kipu</p>
            <form action={signOutAction}>
              <button
                className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-zinc-300 transition hover:bg-white/10"
                type="submit"
              >
                Salir
              </button>
            </form>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            {firstName ? `Listo, ${firstName}. Ya tengo tu mapa.` : "Listo. Ya tengo tu mapa."}
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Esto es lo que sé de ti y de tu plata hasta ahora.
          </p>
        </header>

        <section className="grid grid-cols-2 gap-3">
          <SummaryCard
            label="Dinero disponible"
            sub={`${nonGoalAccountCount} cuenta${nonGoalAccountCount !== 1 ? "s" : ""}`}
            tone="green"
            value={formatMoney(dashboard.flexibleSpending.totalAvailableCash, baseCurrency)}
          />
          <SummaryCard
            label="Deuda total"
            sub={
              ctx.debtAccounts.length > 0
                ? `${ctx.debtAccounts.length} deuda${ctx.debtAccounts.length !== 1 ? "s" : ""}`
                : "Sin deudas"
            }
            tone={ctx.summary.totalDebtBalanceBase > 0 ? "amber" : "neutral"}
            value={
              ctx.debtAccounts.length > 0
                ? formatMoney(ctx.summary.totalDebtBalanceBase, baseCurrency)
                : "—"
            }
          />
          <SummaryCard
            label="Compromisos fijos"
            sub="estimado al mes"
            tone="neutral"
            value={
              ctx.summary.estimatedMonthlyFixedExpenses > 0
                ? formatMoney(ctx.summary.estimatedMonthlyFixedExpenses, baseCurrency)
                : "—"
            }
          />
          <SummaryCard
            label={mainGoal.name}
            sub="de avance"
            tone="blue"
            value={`${dashboard.goalProgress.progressPercentage}%`}
          />
        </section>

        <section className="rounded-3xl border border-white/10 bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-400">Lo que Kipu entendió de ti</p>
          <div className="mt-4 space-y-3">
            {ctx.summary.activeIncomeSourcesCount > 0 && (
              <ContextRow
                detail={`~${formatMoney(ctx.summary.estimatedMonthlyIncome, baseCurrency)}/mes`}
                label={`${ctx.summary.activeIncomeSourcesCount} fuente${ctx.summary.activeIncomeSourcesCount !== 1 ? "s" : ""} de ingreso`}
              />
            )}
            {ctx.summary.activeFixedExpensesCount > 0 && (
              <ContextRow
                detail={`~${formatMoney(ctx.summary.estimatedMonthlyFixedExpenses, baseCurrency)}/mes`}
                label={`${ctx.summary.activeFixedExpensesCount} gasto${ctx.summary.activeFixedExpensesCount !== 1 ? "s" : ""} fijo${ctx.summary.activeFixedExpensesCount !== 1 ? "s" : ""}`}
              />
            )}
            {ctx.debtAccounts.length > 0 && (
              <ContextRow
                detail={formatMoney(ctx.summary.totalDebtBalanceBase, baseCurrency)}
                label={`${ctx.debtAccounts.length} deuda${ctx.debtAccounts.length !== 1 ? "s" : ""} registrada${ctx.debtAccounts.length !== 1 ? "s" : ""}`}
              />
            )}
            <ContextRow
              detail={`${formatMoney(mainGoal.currentAmount, mainGoal.currency)} de ${formatMoney(mainGoal.targetAmount, mainGoal.currency)}`}
              label={`Meta: ${mainGoal.name}`}
            />
            {ctx.coachPreferences && (
              <ContextRow
                detail={translateCoachTone(ctx.coachPreferences.tone)}
                label="Estilo de guía"
              />
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-400/30 bg-emerald-950/60 p-5">
          <p className="text-sm font-medium text-emerald-400">Tu siguiente mejor paso</p>
          <p className="mt-2 text-lg font-bold leading-7">{nextStep.title}</p>
          <p className="mt-2 text-sm leading-6 text-emerald-100/80">{nextStep.description}</p>
        </section>

        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-500">Meta principal</p>
              <h2 className="mt-1 text-2xl font-bold">{mainGoal.name}</h2>
            </div>
            <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              {translateFeasibility(mainGoal.feasibilityStatus)}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-zinc-600">Progreso</span>
              <span className="font-bold">{dashboard.goalProgress.progressPercentage}%</span>
            </div>
            <div className="mt-2 h-4 overflow-hidden rounded-full bg-zinc-200">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${dashboard.goalProgress.progressPercentage}%` }}
              />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-zinc-100 p-4">
              <p className="text-xs font-medium text-zinc-500">Ahorrado</p>
              <p className="mt-1 text-xl font-bold">
                {formatMoney(dashboard.goalProgress.currentAmount, mainGoal.currency)}
              </p>
            </div>
            <div className="rounded-2xl bg-zinc-100 p-4">
              <p className="text-xs font-medium text-zinc-500">Falta</p>
              <p className="mt-1 text-xl font-bold">
                {formatMoney(dashboard.goalProgress.remainingAmount, mainGoal.currency)}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
          <p className="text-sm font-medium text-emerald-200">Dinero flexible real</p>
          <p className="mt-2 text-4xl font-black tracking-tight">
            {formatMoney(
              dashboard.flexibleSpending.flexibleSpending,
              dashboard.flexibleSpending.baseCurrency,
            )}
          </p>
          <p className="mt-3 text-sm leading-6 text-emerald-50/80">
            {getFlexibleSpendingHelperText(dashboard.flexibleSpending.flexibleSpending)}
          </p>

          <div className="mt-5 space-y-2 rounded-2xl bg-white/10 p-4 text-sm">
            <FlexibleBreakdownRow
              currency={dashboard.flexibleSpending.baseCurrency}
              label="Disponible en cuentas"
              value={dashboard.flexibleSpending.totalAvailableCash}
            />
            <FlexibleBreakdownRow
              currency={dashboard.flexibleSpending.baseCurrency}
              label="Protegido en meta"
              neutral
              value={dashboard.flexibleSpending.protectedGoalMoney}
            />
            <FlexibleBreakdownRow
              currency={dashboard.flexibleSpending.baseCurrency}
              label="Pagos de deuda"
              value={-dashboard.flexibleSpending.upcomingDebtPayments}
            />
            <FlexibleBreakdownRow
              currency={dashboard.flexibleSpending.baseCurrency}
              label="Gastos recurrentes"
              value={-dashboard.flexibleSpending.upcomingRecurringExpenses}
            />
            <FlexibleBreakdownRow
              currency={dashboard.flexibleSpending.baseCurrency}
              label="Aporte semanal planificado"
              value={-dashboard.flexibleSpending.plannedGoalContribution}
            />
          </div>
        </section>

        <section className="rounded-3xl border border-sky-400/20 bg-sky-400/10 p-5">
          <p className="text-sm font-medium text-sky-200">Plan semanal</p>
          <p className="mt-2 text-3xl font-black tracking-tight">
            {formatMoney(
              dashboard.weeklyPlan.dailySuggestedLimit,
              dashboard.weeklyPlan.baseCurrency,
            )}
            <span className="text-base font-semibold text-sky-100/80"> / día</span>
          </p>
          <p className="mt-3 text-sm leading-6 text-sky-50/80">
            {getWeeklyPlanHelperText(
              dashboard.weeklyPlan.status,
              dashboard.weeklyPlan.daysRemainingInWeek,
            )}
          </p>
          <div className="mt-5 rounded-2xl bg-white/10 p-4 text-sm text-sky-50/85">
            <div className="flex items-center justify-between gap-3">
              <span>Disponible esta semana</span>
              <span className="font-bold">
                {formatMoney(
                  dashboard.weeklyPlan.weeklyAvailable,
                  dashboard.weeklyPlan.baseCurrency,
                )}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span>Días restantes</span>
              <span className="font-bold">{dashboard.weeklyPlan.daysRemainingInWeek}</span>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <MetricCard
            helper="Fuentes reales"
            label="Cuentas"
            value={String(ctx.accounts.length)}
          />
          <MetricCard
            helper="Incluye tarjetas"
            label="Deudas"
            value={String(ctx.debtAccounts.length)}
          />
          <MetricCard
            helper={formatMoney(dashboard.debtPressure.monthlyDebtDue, mainGoal.currency)}
            label="Presión de deuda"
            value={translateDebtPressure(dashboard.debtPressure.level)}
          />
          <MetricCard
            helper="Meta en camino"
            label="Momentum"
            value={`${dashboard.goalProgress.progressPercentage}%`}
          />
        </section>

        <section className="rounded-3xl bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-400">Cómo hablarle a Kipu</p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            Escríbele aquí o en Telegram, en tus propias palabras:
          </p>
          <div className="mt-4 space-y-2">
            {chatExamples.map((example) => (
              <p
                className="rounded-2xl bg-zinc-800 px-4 py-3 font-mono text-sm text-zinc-200"
                key={example}
              >
                &ldquo;{example}&rdquo;
              </p>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-emerald-200">Chat financiero</p>
            <h2 className="text-xl font-bold text-white">
              Registra como hablarías por WhatsApp
            </h2>
            <p className="text-sm leading-6 text-emerald-50/80">
              Ejemplos: &ldquo;café 3 visa&rdquo; o &ldquo;mandé 20 a mi meta&rdquo;. Escríbelo
              natural; Kipu intenta ordenarlo por ti.
            </p>
          </div>

          <form action={createChatParsedTransactionAction} className="mt-5 flex gap-3">
            <input
              className="min-w-0 flex-1 rounded-2xl border border-emerald-300/20 bg-white px-4 py-3 text-base text-zinc-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
              name="message"
              placeholder="Escribe tu gasto..."
              required
              type="text"
            />
            <button
              className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-zinc-950 transition hover:bg-emerald-50"
              type="submit"
            >
              Enviar
            </button>
          </form>
        </section>

        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-2xl">
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-500">Registro rápido</p>
            <h2 className="text-xl font-bold">Registrar gasto manual</h2>
            <p className="text-sm leading-6 text-zinc-500">
              Elige solo una fuente: cuenta si pagaste con dinero disponible, o tarjeta si fue
              crédito/deuda.
            </p>
          </div>

          <form action={createManualExpenseAction} className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Descripción</span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                name="description"
                placeholder="Café, zapatos, almuerzo..."
                required
                type="text"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Monto</span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                inputMode="decimal"
                min="0"
                name="amount"
                placeholder="3.00"
                required
                step="0.01"
                type="number"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Categoría</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue="other"
                name="category"
              >
                <option value="food">Comida</option>
                <option value="transport">Transporte</option>
                <option value="shopping">Compras</option>
                <option value="entertainment">Entretenimiento</option>
                <option value="health">Salud</option>
                <option value="travel">Viaje</option>
                <option value="other">Otro</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Moneda</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={mainGoal.currency}
                name="currency"
              >
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
                <option value="EUR">EUR</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Pagado desde cuenta</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue=""
                name="source_account_id"
              >
                <option value="">No aplica / usé tarjeta</option>
                {ctx.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">O pagado con tarjeta/deuda</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue=""
                name="debt_account_id"
              >
                <option value="">No aplica / usé cuenta</option>
                {ctx.debtAccounts.map((debt) => (
                  <option key={debt.id} value={debt.id}>
                    {debt.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="mt-2 rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-zinc-800"
              type="submit"
            >
              Registrar gasto
            </button>
          </form>
        </section>

        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-2xl">
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-500">Registro rápido</p>
            <h2 className="text-xl font-bold">Registrar ingreso manual</h2>
            <p className="text-sm leading-6 text-zinc-500">
              Registra ingresos reales: sueldo, freelance, venta, devolución recibida o cualquier
              entrada de dinero.
            </p>
          </div>

          <form action={createManualIncomeAction} className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Descripción</span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                name="description"
                placeholder="Sueldo, freelance, venta..."
                required
                type="text"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Monto</span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                inputMode="decimal"
                min="0"
                name="amount"
                placeholder="100.00"
                required
                step="0.01"
                type="number"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Categoría</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue="income"
                name="category"
              >
                <option value="income">Ingreso</option>
                <option value="other">Otro</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Moneda</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={mainGoal.currency}
                name="currency"
              >
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
                <option value="EUR">EUR</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Cuenta destino</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue=""
                name="destination_account_id"
                required
              >
                <option value="">Selecciona cuenta</option>
                {ctx.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="mt-2 rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-zinc-800"
              type="submit"
            >
              Registrar ingreso
            </button>
          </form>
        </section>

        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-2xl">
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-500">Meta principal</p>
            <h2 className="text-xl font-bold">Registrar aporte a meta</h2>
            <p className="text-sm leading-6 text-zinc-500">
              Mueve dinero desde una cuenta disponible hacia tu meta. Esto actualizará tu progreso
              real.
            </p>
          </div>

          <form action={createGoalContributionAction} className="mt-5 flex flex-col gap-4">
            <input name="goal_id" type="hidden" value={mainGoal.id} />
            <input
              name="goal_account_id"
              type="hidden"
              value={mainGoal.goalAccountId ?? ""}
            />

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Descripción</span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={`Aporte a ${mainGoal.name}`}
                name="description"
                required
                type="text"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Monto</span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                inputMode="decimal"
                min="0"
                name="amount"
                placeholder="20.00"
                required
                step="0.01"
                type="number"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Moneda</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={mainGoal.currency}
                name="currency"
              >
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
                <option value="EUR">EUR</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Cuenta origen</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue=""
                name="source_account_id"
                required
              >
                <option value="">Selecciona cuenta</option>
                {ctx.accounts
                  .filter((account) => !account.isGoalAccount)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
              </select>
            </label>

            <button
              className="mt-2 rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-zinc-800"
              type="submit"
            >
              Registrar aporte
            </button>
          </form>
        </section>

        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-2xl">
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-500">Movimientos recientes</p>
            <h2 className="text-xl font-bold">Tus últimos registros</h2>
          </div>

          <div className="mt-5 space-y-3">
            {(recentTransactions ?? []).length === 0 ? (
              <p className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-500">
                Todavía no tienes movimientos registrados. ¡Empieza hoy!
              </p>
            ) : (
              recentTransactions?.map((transaction) => (
                <div
                  className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-100 px-4 py-3 text-sm"
                  key={transaction.id}
                >
                  <div>
                    <p className="font-bold text-zinc-950">{transaction.description}</p>
                    <p className="text-xs text-zinc-500">
                      {getTransactionDisplayLabel(transaction)} ·{" "}
                      {translateTransactionCategory(transaction.category)}
                    </p>
                  </div>
                  <p className="font-black text-zinc-900">
                    {formatTransactionDisplayAmount(transaction)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-400">Coach</p>
          <p className="mt-3 text-lg font-semibold leading-7">
            &ldquo;Ya tengo tus cuentas, tus deudas y tu meta. Ahora sí podemos dejar de imaginar
            y empezar a manejar plata real.&rdquo;
          </p>
        </section>
      </section>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "green" | "amber" | "blue" | "neutral";
}) {
  const cardClass = {
    green: "border-emerald-400/20 bg-emerald-400/10",
    amber: "border-amber-400/20 bg-amber-400/10",
    blue: "border-sky-400/20 bg-sky-400/10",
    neutral: "border-white/10 bg-white/5",
  }[tone];
  const valueClass = {
    green: "text-emerald-100",
    amber: "text-amber-100",
    blue: "text-sky-100",
    neutral: "text-zinc-50",
  }[tone];
  return (
    <article className={`rounded-3xl border p-4 ${cardClass}`}>
      <p className="text-xs font-medium leading-snug text-zinc-400">{label}</p>
      <p className={`mt-2 text-base font-black leading-tight ${valueClass}`}>{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{sub}</p>
    </article>
  );
}

function ContextRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className="font-semibold text-white">{detail}</span>
    </div>
  );
}

function FlexibleBreakdownRow({
  label,
  value,
  currency,
  neutral = false,
}: {
  label: string;
  value: number;
  currency: string;
  neutral?: boolean;
}) {
  const sign = neutral ? "" : value > 0 ? "+" : value < 0 ? "-" : "";
  const amount = Math.abs(value);

  return (
    <div className="flex items-center justify-between gap-3 text-emerald-50/85">
      <span>{label}</span>
      <span className="font-bold">
        {sign} {formatMoney(amount, currency)}
      </span>
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <article className="rounded-3xl bg-white p-4 text-zinc-950 shadow-xl">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{helper}</p>
    </article>
  );
}

function computeNextStep(
  mainGoal: FinancialGoal,
  availableCash: number,
  totalDebt: number,
  noTransactions: boolean,
): { title: string; description: string } {
  if (noTransactions) {
    return {
      title: "Registra tu primer movimiento",
      description:
        "Cuéntale a Kipu qué pasó con tu plata hoy. Puede ser cualquier gasto, ingreso, o pago.",
    };
  }
  if (mainGoal.currentAmount === 0 && mainGoal.targetAmount > 0) {
    return {
      title: `Haz tu primer aporte a "${mainGoal.name}"`,
      description:
        "Ya tienes la meta lista. El siguiente paso es mover el primer peso hacia ella, aunque sea poco.",
    };
  }
  if (totalDebt > availableCash && totalDebt > 0) {
    return {
      title: "Revisa tu plan de deudas",
      description:
        "Tienes más deuda que efectivo disponible. No es una crisis, pero vale la pena tener un plan claro.",
    };
  }
  return {
    title: "Sigue registrando cada movimiento",
    description:
      "El hábito es lo que hace funcionar a Kipu. Entre más registres, más precisa es la guía.",
  };
}

function buildChatExamples(
  accounts: Account[],
  debtAccounts: DebtAccount[],
  mainGoal: FinancialGoal,
): string[] {
  const firstAccount = accounts.find((a) => !a.isGoalAccount);
  const firstDebt = debtAccounts[0];
  const acctName = firstAccount?.name ?? "mi cuenta";

  const examples: string[] = [
    `Gasté 6 en café con ${acctName}`,
    `Me pagaron 100 en ${acctName}`,
  ];

  if (firstDebt) {
    examples.push(`Pagué 50 de ${firstDebt.name} desde ${acctName}`);
  }

  examples.push(`Mandé 20 a mi meta "${mainGoal.name}"`);
  return examples.slice(0, 4);
}

function translateCoachTone(tone: CoachTone): string {
  const labels: Record<CoachTone, string> = {
    clear: "Directo y claro",
    coach_like: "Coach motivador",
    playful: "Juguetón y cercano",
  };
  return labels[tone] ?? tone;
}

function getWeeklyPlanHelperText(
  status: "healthy" | "tight" | "negative",
  daysRemainingInWeek: number,
): string {
  if (status === "negative") {
    return "Plan de defensa esta semana: frenemos gastos extra y protejamos pagos importantes y tu meta. No es drama, es ordenar antes de seguir gastando.";
  }

  if (status === "tight") {
    return `Semana apretada para los próximos ${daysRemainingInWeek} días. Vivir no está prohibido, pero conviene priorizar comida, transporte y gastos realmente necesarios.`;
  }

  return `Vas bien. Si repartes tu dinero flexible entre los próximos ${daysRemainingInWeek} días, este es tu límite diario sugerido para no tocar tu meta.`;
}

function getFlexibleSpendingHelperText(flexibleSpending: number): string {
  if (flexibleSpending < 0) {
    return "Estás en margen negativo. No significa que estés quebrado, pero si gastas más estarías tocando pagos importantes o tu meta.";
  }

  if (flexibleSpending <= 20) {
    return "Te queda poco margen. Gastar no está prohibido, pero conviene cuidar compras impulsivas hasta que entre más plata.";
  }

  return "Esto es lo que podrías gastar sin dañar tu meta ni fallar pagos importantes.";
}

function translateDebtPressure(level: string): string {
  const labels: Record<string, string> = {
    none: "Nula",
    low: "Baja",
    medium: "Media",
    high: "Alta",
    critical: "Crítica",
  };

  return labels[level] ?? level;
}

function translateFeasibility(status: string): string {
  const labels: Record<string, string> = {
    viable: "Viable",
    challenging: "Desafiante",
    at_risk: "En riesgo",
    not_currently_viable: "No viable",
    paused_due_to_financial_health: "Pausada",
  };

  return labels[status] ?? status;
}

function getTransactionDisplayLabel(transaction: {
  type: string;
  debt_account_id?: string | null;
}): string {
  if (transaction.type === "expense" && transaction.debt_account_id) {
    return "Gasto con tarjeta";
  }

  return translateTransactionType(transaction.type);
}

function formatTransactionDisplayAmount(transaction: {
  type: string;
  base_amount: number | string;
  base_currency: string;
}): string {
  const amount = Number(transaction.base_amount).toFixed(2);

  if (transaction.type === "income" || transaction.type === "refund") {
    return `+ ${transaction.base_currency} ${amount}`;
  }

  if (
    transaction.type === "expense" ||
    transaction.type === "goal_contribution" ||
    transaction.type === "debt_payment"
  ) {
    return `- ${transaction.base_currency} ${amount}`;
  }

  return `${transaction.base_currency} ${amount}`;
}

function translateTransactionType(type: string): string {
  const labels: Record<string, string> = {
    expense: "Gasto",
    income: "Ingreso",
    transfer: "Transferencia",
    debt_payment: "Pago de deuda",
    goal_contribution: "Aporte a meta",
    refund: "Reembolso",
    reversal: "Reverso",
    adjustment: "Ajuste",
  };

  return labels[type] ?? type;
}

function translateTransactionCategory(category: string | null): string {
  const labels: Record<string, string> = {
    food: "Comida",
    transport: "Transporte",
    shopping: "Compras",
    entertainment: "Entretenimiento",
    health: "Salud",
    travel: "Viaje",
    income: "Ingreso",
    savings: "Ahorro",
    debt: "Deuda",
    other: "Otro",
  };

  if (!category) {
    return "Sin categoría";
  }

  return labels[category] ?? category;
}
