import { applyTransactionIntent } from "@/lib/financial/apply-transaction";
import { parseBasicTransactionIntent } from "@/lib/financial/basic-intent-parser";
import { demoAccounts, demoDebtAccounts } from "@/lib/financial/demo-data";
import { formatMoney } from "@/lib/financial/money";
import type { Account, DebtAccount } from "@/types/financial";

const testMessages = [
  "café 3 efectivo",
  "zapatos 40 visa",
  "pagué 40 visa desde pichincha",
  "mandé 20 a brasil desde pichincha",
];

interface ParserStep {
  message: string;
  parsedIntent: ReturnType<typeof parseBasicTransactionIntent>;
  engineMessage: string;
  accounts: Account[];
  debtAccounts: DebtAccount[];
}

function buildParserSteps(): ParserStep[] {
  return testMessages.reduce<{
    accounts: Account[];
    debtAccounts: DebtAccount[];
    steps: ParserStep[];
  }>(
    (state, message) => {
      const parsedIntent = parseBasicTransactionIntent({
        message,
        accounts: state.accounts,
        debtAccounts: state.debtAccounts,
        baseCurrency: "USD",
      });

      const result = applyTransactionIntent({
        accounts: state.accounts,
        debtAccounts: state.debtAccounts,
        intent: parsedIntent,
      });

      return {
        accounts: result.accounts,
        debtAccounts: result.debtAccounts,
        steps: [
          ...state.steps,
          {
            message,
            parsedIntent,
            engineMessage: result.message,
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

export default function ParserTestPage() {
  const steps = buildParserSteps();

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-5">
          <p className="text-sm font-medium text-emerald-300">Dev Test</p>
          <h1 className="mt-2 text-3xl font-bold">Parser + Financial Engine</h1>
          <p className="mt-3 text-sm text-zinc-300">
            Esta página prueba el flujo: mensaje → ención estructurada → motor financiero.
          </p>
        </header>

        {steps.map((step, index) => (
          <section key={step.message} className="rounded-3xl bg-white p-5 text-zinc-950">
            <p className="text-sm font-medium text-zinc-500">Mensaje {index + 1}</p>
            <h2 className="mt-1 text-xl font-bold">“{step.message}”</h2>
            <p className="mt-2 text-sm text-zinc-600">{step.engineMessage}</p>

            <div className="mt-4 rounded-2xl bg-zinc-100 p-4">
              <p className="text-sm font-bold">Intent JSON</p>
              <pre className="mt-2 overflow-x-auto text-xs leading-5">
                {JSON.stringify(step.parsedIntent, null, 2)}
              </pre>
            </div>

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
    <div className="grid gap-3 sm:grid-cols-2">
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
