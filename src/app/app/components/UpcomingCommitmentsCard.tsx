import { formatMoney } from "@/lib/financial/money";

// "Lo que viene" — upcoming commitments the Margen Kipu engine already reserved.
// Shown so the user can SEE why their safe margin looks the way it does, without
// a spreadsheet. Same data the chat coach reasons over (cards due, scheduled
// payments). Renders nothing when there's nothing coming.
export function UpcomingCommitmentsCard({
  baseCurrency,
  cardsDueSoon,
  upcomingPayments,
}: {
  baseCurrency: string;
  cardsDueSoon: { name: string; inDays: number; balance: number }[];
  upcomingPayments: { name: string; amount: number | null; dueDate: string }[];
}) {
  if (cardsDueSoon.length === 0 && upcomingPayments.length === 0) {
    return null;
  }

  return (
    <section className="rounded-3xl border border-white/5 bg-zinc-900 p-5">
      <p className="text-sm font-medium text-zinc-400">Lo que viene</p>
      <div className="mt-3 space-y-2">
        {cardsDueSoon.map((card) => (
          <div
            className="flex items-center justify-between rounded-2xl bg-zinc-800/70 px-4 py-3"
            key={`card-${card.name}`}
          >
            <span className="text-sm text-zinc-200">{card.name}</span>
            <span className="text-xs font-semibold text-amber-300">
              {card.inDays <= 0
                ? "vence hoy"
                : `vence en ${card.inDays} día${card.inDays !== 1 ? "s" : ""}`}
            </span>
          </div>
        ))}
        {upcomingPayments.slice(0, 4).map((payment) => (
          <div
            className="flex items-center justify-between rounded-2xl bg-zinc-800/70 px-4 py-3"
            key={`pay-${payment.name}-${payment.dueDate}`}
          >
            <span className="text-sm text-zinc-200">{payment.name}</span>
            <span className="text-xs font-semibold text-zinc-400">
              {payment.amount ? `${formatMoney(payment.amount, baseCurrency)} · ` : ""}
              {payment.dueDate}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-zinc-600">
        Ya lo tengo en cuenta en tu Margen Kipu. No tienes que recordarlo tú.
      </p>
    </section>
  );
}
