import type { Account, DebtAccount, FinancialGoal } from "@/types/financial";
import {
  createGoalContributionAction,
  createManualExpenseAction,
  createManualIncomeAction,
} from "../transaction-actions";

interface ManualAdvancedSectionProps {
  accounts: Account[];
  debtAccounts: DebtAccount[];
  mainGoal: FinancialGoal;
}

export function ManualAdvancedSection({
  accounts,
  debtAccounts,
  mainGoal,
}: ManualAdvancedSectionProps) {
  return (
    <>
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-line/10" />
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
          Registro manual avanzado
        </p>
        <div className="h-px flex-1 bg-line/10" />
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
              {accounts.map((account) => (
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
              {debtAccounts.map((debt) => (
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
              {accounts.map((account) => (
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
              {accounts
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
    </>
  );
}
