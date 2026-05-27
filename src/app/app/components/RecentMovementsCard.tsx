import {
  formatTransactionDisplayAmount,
  getTransactionDisplayLabel,
  translateTransactionCategory,
} from "./app-dashboard-helpers";

export interface RecentTransaction {
  id: string;
  description: string;
  category: string | null;
  base_amount: number | string;
  base_currency: string;
  type: string;
  occurred_at: string;
  source_account_id?: string | null;
  debt_account_id?: string | null;
  goal_id?: string | null;
}

export function RecentMovementsCard({ txList }: { txList: RecentTransaction[] }) {
  return (
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
  );
}
