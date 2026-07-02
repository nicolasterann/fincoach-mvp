import { formatDisplay } from "@/lib/financial/display-money";
import type { FxRate } from "@/lib/fx/fx-rates";
import type { CurrencyCode } from "@/types/financial";
import { Chevron, PressCard } from "./living/shell";

// "Lo que viene" — upcoming commitments the Margen Kipu engine already
// reserved. Shown so the user can SEE why their safe margin looks the way it
// does, without a spreadsheet. The whole card drills into /app/cashflow.
// Nothing due but commitments configured → a calm one-liner (still real state);
// nothing configured at all → renders nothing.

function formatDueDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es", { day: "numeric", month: "short" });
}

export function UpcomingCommitmentsCard({
  baseCurrency,
  cardsDueSoon,
  upcomingPayments,
  displayCurrency,
  rates = [],
  hasCommitmentsConfigured = false,
}: {
  baseCurrency: string;
  cardsDueSoon: { name: string; inDays: number; balance: number }[];
  upcomingPayments: { name: string; amount: number | null; dueDate: string }[];
  displayCurrency?: string;
  rates?: FxRate[];
  hasCommitmentsConfigured?: boolean;
}) {
  const empty = cardsDueSoon.length === 0 && upcomingPayments.length === 0;
  if (empty && !hasCommitmentsConfigured) {
    return null;
  }

  return (
    <PressCard href="/app/cashflow" ariaLabel="Lo que viene — ver el detalle" className="p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-zinc-300">Lo que viene</p>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-400">
          Ver detalle
          <Chevron />
        </span>
      </div>
      {empty ? (
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          Nada fuerte en los próximos días — respira.
        </p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            {cardsDueSoon.map((card) => (
              <div
                className="flex items-center justify-between rounded-2xl bg-zinc-800/70 px-4 py-3"
                key={`card-${card.name}`}
              >
                <span className="min-w-0 truncate text-sm text-zinc-200">{card.name}</span>
                <span className="shrink-0 text-xs font-semibold text-amber-300">
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
                <span className="min-w-0 truncate text-sm text-zinc-200">{payment.name}</span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-400">
                  {payment.amount
                    ? `${formatDisplay(payment.amount, baseCurrency as CurrencyCode, displayCurrency as CurrencyCode | undefined, rates)} · `
                    : ""}
                  {formatDueDate(payment.dueDate)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-600">
            Ya lo tengo en cuenta en tu Margen Kipu. No tienes que recordarlo tú.
          </p>
        </>
      )}
    </PressCard>
  );
}
