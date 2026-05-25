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

type MetricStatus = "good" | "ok" | "warn" | "bad" | "neutral";
type ReadinessMode = "stable" | "adjusted" | "defense" | "risk";

interface ReadinessResult {
  score: number;
  mode: ReadinessMode;
  modeLabel: string;
  message: string;
}

interface BudgetRealityState {
  label: string;
  message: string;
}

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
  const txList = recentTransactions ?? [];
  const noTransactions = txList.length === 0;
  const flexAmount = dashboard.flexibleSpending.flexibleSpending;

  // Derived display metrics
  const readiness = computeFinancialReadiness(
    flexAmount,
    dashboard.debtPressure.level,
    dashboard.goalProgress.progressPercentage,
    dashboard.weeklyPlan.status,
  );

  const accuracyScore = computeFinancialAccuracy(
    ctx.summary.activeIncomeSourcesCount > 0,
    ctx.summary.activeFixedExpensesCount > 0,
    txList.length,
    ctx.debtAccounts.length > 0,
    ctx.accounts.length,
  );

  const budgetReality = getBudgetRealityState(txList.length);

  const nextStep = computeNextStep(
    mainGoal,
    dashboard.flexibleSpending.totalAvailableCash,
    ctx.summary.totalDebtBalanceBase,
    noTransactions,
    flexAmount,
    dashboard.debtPressure.level,
  );

  const chatExamples = buildChatExamples(ctx.accounts, ctx.debtAccounts, mainGoal);

  // Per-metric statuses
  const flexStatus: MetricStatus =
    flexAmount > 100 ? "good" : flexAmount > 30 ? "ok" : flexAmount > 0 ? "warn" : "bad";

  const debtStatus: MetricStatus =
    dashboard.debtPressure.level === "none" || dashboard.debtPressure.level === "low"
      ? "good"
      : dashboard.debtPressure.level === "medium"
        ? "ok"
        : dashboard.debtPressure.level === "high"
          ? "warn"
          : "bad";

  const goalStatus: MetricStatus =
    dashboard.goalProgress.progressPercentage >= 30
      ? "good"
      : dashboard.goalProgress.progressPercentage >= 10
        ? "ok"
        : dashboard.goalProgress.progressPercentage > 0
          ? "warn"
          : "neutral";

  const accuracyStatus: MetricStatus =
    accuracyScore >= 75 ? "good" : accuracyScore >= 55 ? "ok" : accuracyScore >= 35 ? "warn" : "neutral";

  const dailyStatus: MetricStatus =
    dashboard.weeklyPlan.status === "healthy"
      ? "good"
      : dashboard.weeklyPlan.status === "tight"
        ? "warn"
        : "bad";

  const heroClasses = getReadinessClasses(readiness.mode);

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-md flex-col gap-5">

        {/* Compact nav */}
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-emerald-400">Kipu</p>
            {firstName && <p className="text-xs text-zinc-500">Hola, {firstName}</p>}
          </div>
          <form action={signOutAction}>
            <button
              className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-zinc-400 transition hover:bg-white/10"
              type="submit"
            >
              Salir
            </button>
          </form>
        </header>

        {/* Hero readiness card */}
        <section className={`rounded-3xl p-6 shadow-2xl ${heroClasses.bg}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/40">
              Readiness financiero
            </p>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${heroClasses.badge}`}>
              {readiness.modeLabel}
            </span>
          </div>
          <div className="mt-5 flex items-end gap-2">
            <p className={`text-7xl font-black leading-none tracking-tight ${heroClasses.score}`}>
              {readiness.score}
            </p>
            <p className="mb-2 text-lg font-medium text-white/30">/ 100</p>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${heroClasses.bar}`}
              style={{ width: `${readiness.score}%` }}
            />
          </div>
          <p className="mt-4 text-sm leading-6 text-white/75">{readiness.message}</p>
        </section>

        {/* Metrics grid 2×3 */}
        <section className="grid grid-cols-2 gap-3">
          <DashboardMetricCard
            label="Gasto flexible"
            message={flexAmount > 0 ? "Después de meta, deuda y compromisos" : "Margen negativo esta semana"}
            status={flexStatus}
            value={formatMoney(flexAmount, baseCurrency)}
          />
          <DashboardMetricCard
            label="Meta"
            message={
              dashboard.goalProgress.progressPercentage > 0
                ? `${formatMoney(mainGoal.currentAmount, mainGoal.currency)} de ${formatMoney(mainGoal.targetAmount, mainGoal.currency)}`
                : "Sin aportes aún"
            }
            status={goalStatus}
            value={`${dashboard.goalProgress.progressPercentage}%`}
          />
          <DashboardMetricCard
            label="Presión de deuda"
            message={
              dashboard.debtPressure.monthlyDebtDue > 0
                ? `${formatMoney(dashboard.debtPressure.monthlyDebtDue, baseCurrency)}/mes est.`
                : "Sin pagos de deuda registrados"
            }
            status={debtStatus}
            value={translateDebtPressure(dashboard.debtPressure.level)}
          />
          <DashboardMetricCard
            label="Precisión"
            message={getAccuracyMessage(txList.length)}
            status={accuracyStatus}
            value={`${accuracyScore}%`}
          />
          <DashboardMetricCard
            label="Aprendizaje"
            message={budgetReality.message}
            status="neutral"
            value={budgetReality.label}
          />
          <DashboardMetricCard
            label="Límite diario"
            message={
              flexAmount <= 0
                ? "Primero cubramos compromisos"
                : `${dashboard.weeklyPlan.daysRemainingInWeek} día${dashboard.weeklyPlan.daysRemainingInWeek !== 1 ? "s" : ""} restante${dashboard.weeklyPlan.daysRemainingInWeek !== 1 ? "s" : ""}`
            }
            status={flexAmount <= 0 ? "bad" : dailyStatus}
            value={flexAmount <= 0 ? "Sin margen" : formatMoney(dashboard.weeklyPlan.dailySuggestedLimit, baseCurrency)}
          />
        </section>

        {/* Siguiente mejor paso */}
        <section className="rounded-3xl border border-emerald-400/30 bg-emerald-950/60 p-5">
          <p className="text-sm font-medium text-emerald-400">Tu siguiente mejor paso</p>
          <p className="mt-2 text-lg font-bold leading-7">{nextStep.title}</p>
          <p className="mt-2 text-sm leading-6 text-emerald-100/80">{nextStep.description}</p>
        </section>

        {/* Goal compact card */}
        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-zinc-500">Meta principal</p>
              <h2 className="mt-0.5 text-lg font-bold leading-tight">{mainGoal.name}</h2>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-2xl font-black text-emerald-600">
                {dashboard.goalProgress.progressPercentage}%
              </p>
              <p className="text-xs text-zinc-400">{translateFeasibility(mainGoal.feasibilityStatus)}</p>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${dashboard.goalProgress.progressPercentage}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-zinc-500">
              {formatMoney(dashboard.goalProgress.currentAmount, mainGoal.currency)} ahorrado
            </span>
            <span className="font-semibold text-zinc-800">
              Falta {formatMoney(dashboard.goalProgress.remainingAmount, mainGoal.currency)}
            </span>
          </div>
        </section>

        {/* Chat financiero */}
        <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
          <div className="space-y-1">
            <p className="text-sm font-medium text-emerald-200">Chat financiero</p>
            <h2 className="text-xl font-bold text-white">Registra como hablarías</h2>
            <p className="text-sm leading-6 text-emerald-50/80">
              Ejemplos: &ldquo;café 3 visa&rdquo; o &ldquo;mandé 20 a mi meta&rdquo;. Escríbelo
              natural; Kipu intenta ordenarlo por ti.
            </p>
          </div>
          <form action={createChatParsedTransactionAction} className="mt-5 flex gap-3">
            <input
              className="min-w-0 flex-1 rounded-2xl border border-emerald-300/20 bg-white px-4 py-3 text-base text-zinc-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
              name="message"
              placeholder="Escribe tu movimiento..."
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

        {/* Recent movements */}
        <section className="rounded-3xl bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-400">Movimientos recientes</p>
          <div className="mt-4 space-y-2">
            {txList.length === 0 ? (
              <p className="rounded-2xl bg-zinc-800 px-4 py-3 text-sm text-zinc-500">
                Todavía no tienes movimientos registrados. ¡Empieza hoy!
              </p>
            ) : (
              txList.map((transaction) => (
                <div
                  className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-800 px-4 py-3 text-sm"
                  key={transaction.id}
                >
                  <div>
                    <p className="font-bold text-zinc-100">{transaction.description}</p>
                    <p className="text-xs text-zinc-500">
                      {getTransactionDisplayLabel(transaction)} ·{" "}
                      {translateTransactionCategory(transaction.category)}
                    </p>
                  </div>
                  <p className="shrink-0 font-black text-zinc-200">
                    {formatTransactionDisplayAmount(transaction)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Cómo hablarle a Kipu */}
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

        {/* Flexible spending detail */}
        <section className="rounded-3xl border border-white/10 bg-zinc-900 p-5">
          <p className="text-sm font-medium text-zinc-400">Desglose del margen flexible</p>
          <p
            className={`mt-1 text-2xl font-black ${flexAmount >= 0 ? "text-emerald-300" : "text-rose-400"}`}
          >
            {formatMoney(flexAmount, dashboard.flexibleSpending.baseCurrency)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{getFlexibleSpendingHelperText(flexAmount)}</p>
          <div className="mt-4 space-y-2 border-t border-white/5 pt-4 text-sm">
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
              label="Aporte a meta"
              value={-dashboard.flexibleSpending.plannedGoalContribution}
            />
          </div>
        </section>

        {/* Lo que Kipu entendió */}
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

        {/* Manual forms — secondary */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
            Registro manual avanzado
          </p>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-xl">
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-500">Gasto</p>
            <h2 className="text-lg font-bold">Registrar gasto manual</h2>
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

        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-xl">
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-500">Ingreso</p>
            <h2 className="text-lg font-bold">Registrar ingreso manual</h2>
            <p className="text-sm leading-6 text-zinc-500">
              Sueldo, freelance, venta, devolución recibida, o cualquier entrada de dinero.
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

        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-xl">
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-500">Aporte a meta</p>
            <h2 className="text-lg font-bold">Registrar aporte a {mainGoal.name}</h2>
            <p className="text-sm leading-6 text-zinc-500">
              Mueve dinero desde una cuenta disponible hacia tu meta.
            </p>
          </div>
          <form action={createGoalContributionAction} className="mt-5 flex flex-col gap-4">
            <input name="goal_id" type="hidden" value={mainGoal.id} />
            <input name="goal_account_id" type="hidden" value={mainGoal.goalAccountId ?? ""} />
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

      </section>
    </main>
  );
}

// ─── Presentational components ───────────────────────────────────────────────

function DashboardMetricCard({
  label,
  value,
  status,
  message,
}: {
  label: string;
  value: string;
  status: MetricStatus;
  message: string;
}) {
  const dotColor: Record<MetricStatus, string> = {
    good: "bg-emerald-400",
    ok: "bg-sky-400",
    warn: "bg-amber-400",
    bad: "bg-rose-400",
    neutral: "bg-zinc-600",
  };
  const valueColor: Record<MetricStatus, string> = {
    good: "text-emerald-300",
    ok: "text-sky-300",
    warn: "text-amber-300",
    bad: "text-rose-400",
    neutral: "text-zinc-300",
  };
  return (
    <article className="rounded-3xl border border-white/5 bg-zinc-900 p-4">
      <div className="flex items-center gap-1.5">
        <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor[status]}`} />
        <p className="text-xs font-medium text-zinc-500">{label}</p>
      </div>
      <p className={`mt-3 text-xl font-black leading-tight ${valueColor[status]}`}>{value}</p>
      <p className="mt-1.5 text-xs leading-snug text-zinc-600">{message}</p>
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
    <div className="flex items-center justify-between gap-3 text-zinc-400">
      <span>{label}</span>
      <span className="font-semibold text-zinc-300">
        {sign} {formatMoney(amount, currency)}
      </span>
    </div>
  );
}

// ─── Derived metric helpers ───────────────────────────────────────────────────

function computeFinancialReadiness(
  flexibleSpending: number,
  debtLevel: string,
  goalProgressPct: number,
  weeklyPlanStatus: string,
): ReadinessResult {
  let score = 60;

  if (flexibleSpending > 150) score += 15;
  else if (flexibleSpending > 50) score += 10;
  else if (flexibleSpending > 0) score += 4;
  else score -= 15;

  if (debtLevel === "none") score += 10;
  else if (debtLevel === "low") score += 5;
  else if (debtLevel === "high") score -= 12;
  else if (debtLevel === "critical") score -= 22;

  if (goalProgressPct >= 10) score += 8;
  else if (goalProgressPct > 0) score += 4;

  if (weeklyPlanStatus === "healthy") score += 7;
  else if (weeklyPlanStatus === "negative") score -= 10;

  score = Math.min(95, Math.max(10, score));

  let mode: ReadinessMode;
  let modeLabel: string;
  if (score >= 75) {
    mode = "stable";
    modeLabel = "Estable";
  } else if (score >= 55) {
    mode = "adjusted";
    modeLabel = "Ajustado";
  } else if (score >= 35) {
    mode = "defense";
    modeLabel = "Modo defensa";
  } else {
    mode = "risk";
    modeLabel = "Necesita atención";
  }

  const messages: Record<ReadinessMode, string> = {
    stable: "Tienes margen, tu meta avanza y los compromisos están cubiertos. Sigue así.",
    adjusted: "Esta semana toca cuidar el margen. Primero cubramos compromisos y luego vemos qué espacio queda.",
    defense: "Semana apretada, pero no rota. Ordenemos pagos críticos y protejamos la meta sin forzarla.",
    risk: "Esta semana toca cuidar cada paso. Primero los pagos críticos — la meta está protegida, no cancelada.",
  };

  return { score, mode, modeLabel, message: messages[mode] };
}

function computeFinancialAccuracy(
  hasIncomeSources: boolean,
  hasFixedExpenses: boolean,
  transactionCount: number,
  hasDebtAccounts: boolean,
  accountCount: number,
): number {
  let score = 40;
  if (hasIncomeSources) score += 20;
  if (hasFixedExpenses) score += 15;
  if (transactionCount > 0) score += 15;
  if (hasDebtAccounts || accountCount >= 2) score += 10;
  if (transactionCount === 0) return Math.min(score, 65);
  if (transactionCount < 5) return Math.min(score, 75);
  return Math.min(score, 85);
}

function getBudgetRealityState(transactionCount: number): BudgetRealityState {
  if (transactionCount === 0) {
    return {
      label: "Sin datos",
      message: "Todavía estoy conociendo tu vida real.",
    };
  }
  if (transactionCount < 5) {
    return {
      label: "Primeras señales",
      message: "Ya tengo primeras señales reales.",
    };
  }
  return {
    label: "Aprendiendo",
    message: "Empiezo a ver tu patrón de gasto.",
  };
}

function getReadinessClasses(mode: ReadinessMode): {
  bg: string;
  score: string;
  bar: string;
  badge: string;
} {
  const map: Record<ReadinessMode, { bg: string; score: string; bar: string; badge: string }> = {
    stable: {
      bg: "border border-emerald-500/20 bg-emerald-950/50",
      score: "text-emerald-300",
      bar: "bg-emerald-400",
      badge: "bg-emerald-400/20 text-emerald-300",
    },
    adjusted: {
      bg: "border border-amber-500/20 bg-amber-950/50",
      score: "text-amber-300",
      bar: "bg-amber-400",
      badge: "bg-amber-400/20 text-amber-300",
    },
    defense: {
      bg: "border border-orange-500/20 bg-orange-950/50",
      score: "text-orange-300",
      bar: "bg-orange-400",
      badge: "bg-orange-400/20 text-orange-300",
    },
    risk: {
      bg: "border border-rose-500/20 bg-rose-950/50",
      score: "text-rose-300",
      bar: "bg-rose-400",
      badge: "bg-rose-400/20 text-rose-300",
    },
  };
  return map[mode];
}

function getAccuracyMessage(transactionCount: number): string {
  if (transactionCount === 0) return "Buen mapa inicial, falta vida real.";
  if (transactionCount < 5) return "Primeros datos reales, aún aprendiendo.";
  return "Datos útiles, seguimos afinando.";
}

// ─── Action / navigation helpers ─────────────────────────────────────────────

function computeNextStep(
  mainGoal: FinancialGoal,
  availableCash: number,
  totalDebt: number,
  noTransactions: boolean,
  flexibleSpending: number,
  debtPressureLevel: string,
): { title: string; description: string } {
  if (noTransactions) {
    return {
      title: "Registra tu primer movimiento",
      description:
        "Cuéntale a Kipu qué pasó con tu plata hoy. Puede ser cualquier gasto, ingreso, o pago.",
    };
  }
  if (flexibleSpending <= 0) {
    return {
      title: "Cuidemos la semana antes de pensar en la meta",
      description:
        "Tu margen está en negativo. Primero aseguremos los compromisos principales — la meta no se cancela, solo la protegemos.",
    };
  }
  if (debtPressureLevel === "high" || debtPressureLevel === "critical") {
    return {
      title: "Revisemos la presión de deuda",
      description:
        "La deuda está ocupando bastante espacio. Entendamos qué hay que pagar esta semana antes de considerar un aporte extra.",
    };
  }
  if (mainGoal.currentAmount === 0 && mainGoal.targetAmount > 0) {
    return {
      title: `Haz tu primer aporte a "${mainGoal.name}"`,
      description:
        "Ya tienes la meta lista y hay margen. El siguiente paso es mover el primer peso hacia ella, aunque sea poco.",
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

// ─── Translation / display helpers ───────────────────────────────────────────

function translateCoachTone(tone: CoachTone): string {
  const labels: Record<CoachTone, string> = {
    clear: "Directo y claro",
    coach_like: "Coach motivador",
    playful: "Juguetón y cercano",
  };
  return labels[tone] ?? tone;
}

function getFlexibleSpendingHelperText(flexibleSpending: number): string {
  if (flexibleSpending < 0) {
    return "Estás en margen negativo. Si gastas más estarías tocando pagos importantes o tu meta.";
  }
  if (flexibleSpending <= 20) {
    return "Te queda poco margen. Cuida compras impulsivas hasta que entre más plata.";
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
  if (!category) return "Sin categoría";
  return labels[category] ?? category;
}
