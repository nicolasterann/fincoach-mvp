import { redirect } from "next/navigation";
import { buildFinancialDashboard } from "@/lib/financial/dashboard";
import { loadUserFinancialData } from "@/lib/financial/load-user-financial-data";
import { formatMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { signOutAction } from "./actions";
import { createChatParsedTransactionAction, createGoalContributionAction, createManualExpenseAction, createManualIncomeAction } from "./transaction-actions";

export default async function AppPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const financialData = await loadUserFinancialData(session.user.id);

  const { data: recentTransactions, error: transactionsError } = await supabase
    .from("transactions")
    .select("id, description, category, base_amount, base_currency, type, occurred_at, source_account_id, debt_account_id, goal_id")
    .eq("user_id", session.user.id)
    .order("occurred_at", { ascending: false })
    .limit(5);

  if (transactionsError) {
    throw new Error(transactionsError.message);
  }

  if (!financialData.mainGoal || financialData.accounts.length === 0) {
    redirect("/onboarding");
  }

  const dashboard = buildFinancialDashboard({
    accounts: financialData.accounts,
    debtAccounts: financialData.debtAccounts,
    recurringExpenses: [],
    variableBudgetEstimates: [],
    goal: financialData.mainGoal,
    monthlyIncome: 1000,
    estimatedMonthlySavingsCapacity: 100,
    monthsRemainingForGoal: 6,
  });

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-md flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-medium text-emerald-300">FinCoach</p>
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
            Hola, seguimos con {financialData.mainGoal.name}
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Sesión activa como <strong>{session.user.email}</strong>. Este dashboard ya usa
            tus cuentas, deudas y meta guardadas en Supabase.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-5 text-zinc-950 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-500">Meta principal</p>
              <h2 className="mt-1 text-2xl font-bold">{financialData.mainGoal.name}</h2>
            </div>
            <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              {translateFeasibility(financialData.mainGoal.feasibilityStatus)}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-zinc-600">Progreso</span>
              <span className="font-bold">
                {dashboard.goalProgress.progressPercentage}%
              </span>
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
                {formatMoney(
                  dashboard.goalProgress.currentAmount,
                  financialData.mainGoal.currency,
                )}
              </p>
            </div>
            <div className="rounded-2xl bg-zinc-100 p-4">
              <p className="text-xs font-medium text-zinc-500">Falta</p>
              <p className="mt-1 text-xl font-bold">
                {formatMoney(
                  dashboard.goalProgress.remainingAmount,
                  financialData.mainGoal.currency,
                )}
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
              label="Disponible en cuentas"
              value={dashboard.flexibleSpending.totalAvailableCash}
              currency={dashboard.flexibleSpending.baseCurrency}
            />
            <FlexibleBreakdownRow
              label="Protegido en meta"
              value={dashboard.flexibleSpending.protectedGoalMoney}
              currency={dashboard.flexibleSpending.baseCurrency}
              neutral
            />
            <FlexibleBreakdownRow
              label="Pagos de deuda"
              value={-dashboard.flexibleSpending.upcomingDebtPayments}
              currency={dashboard.flexibleSpending.baseCurrency}
            />
            <FlexibleBreakdownRow
              label="Gastos recurrentes"
              value={-dashboard.flexibleSpending.upcomingRecurringExpenses}
              currency={dashboard.flexibleSpending.baseCurrency}
            />
            <FlexibleBreakdownRow
              label="Aporte semanal planificado"
              value={-dashboard.flexibleSpending.plannedGoalContribution}
              currency={dashboard.flexibleSpending.baseCurrency}
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
            label="Cuentas"
            value={String(financialData.accounts.length)}
            helper="Fuentes reales"
          />         <MetricCard
            label="Deudas"
            value={String(financialData.debtAccounts.length)}
            helper="Incluye tarjetas"
          />
          <MetricCard
            label="Debt Pressure"
            value={translateDebtPressure(dashboard.debtPressure.level)}
            helper={formatMoney(
              dashboard.debtPressure.monthlyDebtDue,
              financialData.mainGoal.currency,
            )}
          />
          <MetricCard
            label="Momentum"
            value={`${dashboard.goalProgress.progressPercentage}%`}
            helper="Meta en camino"
          />
        </section>

        <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-emerald-200">Chat financiero</p>            <h2 className="text-xl font-bold text-white">Registra como hablarías por WhatsApp</h2>
            <p className="text-sm leading-6 text-emerald-50/80">
              Ejemplos: “café 3 pichincha” o “zapatos 40 visa”. Por ahora usamos parser básico; después entra IA.
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
              Elige solo una fuente: cuenta si pagaste con dinero disponible, o tarjeta si fue crédito/deuda.
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
                defaultValue={financialData.mainGoal.currency}
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
                {financialData.accounts.map((account) => (
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
                {financialData.debtAccounts.map((debt) => (
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
              Registra ingresos reales: sueldo, freelance, venta, devolución recibida o cualquier entrada de dinero.
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
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring4 focus:ring-emerald-500/10"
                defaultValue={financialData.mainGoal.currency}
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
                {financialData.accounts.map((account) => (
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
              Mueve dinero desde una cuenta disponible hacia tu meta. Esto actualizará tu rogreso real.
            </p>
          </div>

          <form action={createGoalContributionAction} className="mt-5 flex flex-col gap-4">
            <input name="goal_id" type="hidden" value={financialData.mainGoal.id} />
            <input
              name="goal_account_id"
              type="hidden"
              value={financialData.mainGoal.goalAccountId ?? ""}
            />

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Descripción</span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={`Aporte a ${financialData.mainGoal.name}`}
                name="description"
                required
                type="text"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-mediu text-zinc-700">Monto</span>
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
                defaultValue={financialData.mainGoal.currency}
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
                {financialData.accounts
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
                Todavía no tienes transacciones registradas.
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
                      {getTransactionDisplayLabel(transaction)} · {translateTransactionCategory(transaction.category)}
                    </p>
                  </div>
                  <p className="font-black text-zinc-9">
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
            “Ya tengo tus cuentas, tus deudas y tu meta. Ahora sí podemos dejar de imaginar
            y empezar a manejar plata real.”
          </p>
        </section>
      </section>
    </main>
  );
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
