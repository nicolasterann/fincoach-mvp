import { applyTransactionIntent } from "@/lib/financial/apply-transaction";
import { demoAccounts, demoDebtAccounts } from "@/lib/financial/demo-data";
import { formatMoney } from "@/lib/financial/money";
import type { Account, DebtAccount } from "@/types/financial";
import type { TransactionIntent } from "@/types/transaction-intents";

const intents: TransactionIntent[] = [
  {
    type: "expense",
    description: "Café",
    originalAmount: 3,
    originalCurrency: "USD",
    category: "food",
    sourceAccountId: "account-cash",
    confidenceScore: 0.95,
    status: "ready",
  },
  {
    type: "expense",
    description: "Zapatos",
    originalAmount: 40,
    originalCurrency: "USD",
    category: "shopping",
    debtAccountId: "debt-visa",
    confidenceScore: 0.95,
    status: "ready",
  },
  {
    type: "debt_payment",
    description: "Pago Visa",
    originalAmount: 40,
    originalCurrency: "USD",
    sourceAccountId: "account-pichincha",    debtAccountId: "debt-visa",
    confidenceScore: 0.95,
    status: "ready",
  },
  {
    type: "goal_contribution",
    description: "Aporte a Brasil",
    originalAmount: 20,
    originalCurrency: "USD",
    sourceAccountId: "account-pichincha",
    destinationAccountId: "account-brazil-goal",
    goalId: "goal-brazil",
    confidenceScore: 0.95,
    status: "ready",
  },
];

interface TransactionStep {
  intent: TransactionIntent;
  message: string;
  accounts: Account[];
  debtAccounts: DebtAccount[];
}

function buildTransactionSteps(): TransactionStep[] {
  return intents.reduce<{
    accounts: Account[];
    debtAccounts: DebtAccount[];
    steps: TransactionStep[];
  }>(
    (state, intent) => {
      const result = applyTransactionIntent({
        accounts: state.accounts,
        debtAccounts: state.debtAccounts,
        intent,
      });

      return {
        accounts: result.accounts,
        debtAccounts: result.debtAccounts,
        steps: [
          ...state.steps,
          {
            intent,
            message: result.message,
            accounts: result.accounts,
            debtAccounts: result.debtAccounts,
          },
        ],
      };
    },
    {
      accounts: demoAccounts,
      debtAccounts: demoDebtAccounts,
      steps: [],
    },
  ).steps;
}

export default function TransactionTestPage() {
  const steps = buildTransactionSteps();

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-5">
          <p className="text-sm font-medium text-emerald-300">Dev Test</p>
          <h1 className="mt-2 text-3xl font-bold">Transaction Engine</h1>
          <p className="mt-3 text-sm text-zinc-300">
            Esta página temporal prueba cómo el motor aplica gastos, pagos de deuda y
            aportes a meta.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-5 text-zin950">
          <h2 className="text-xl font-bold">Saldos iniciales</h2>
          <BalanceList accounts={demoAccounts} debtAccounts={demoDebtAccounts} />
        </section>

        {steps.map((step, index) => (
          <section
            key={`${step.intent.type}-${index}`}
            className="rounded-3xl bg-white p-5 text-zinc-950"
          >
            <p className="text-sm font-medium text-zinc-500">Paso {index + 1}</p>
            <h2 className="mt-1 text-xl font-bold">{step.intent.description}</h2>
            <p className="mt-2 text-sm text-zinc-600">{step.message}</p>
            <div className="mt-4">
              <BalanceList accounts={step.accounts} debtAccounts={step.debtAccounts} />
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}

function BalanceList({
  accounts,
  debtAccounts,
}: {
  accounts: Account[];
  debtAccounts: DebtAccount[];
}) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl bg-zinc-100 p-4">
        <p className="text-sm font-bold">Cuentas</p>
        <ul className="mt-2 space-y-1 text-sm">
          {accounts.map((account) => (
            <li key={account.id} className="flex justify-between gap-3">
              <span>{account.name}</span>
              <strong>{formatMoney(account.currentBalanceBase, account.currency)}</strong>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl bg-zinc-100 p-4">
        <p className="text-sm font-bold">Deudas</p>
        <ul className="mt-2 space-y-1 text-sm">
          {debtAccounts.map((debt) => (
            <li key={debt.id} className="flex justify-between gap-3">
              <span>{debt.name}</span>
              <strong>{formatMoney(debt.currentBalanceBase, debt.currency)}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
