import { saveFxRateAction } from "./fx-actions";
import { CURRENCIES } from "@/lib/onboarding/wizard-constants";
import { formatFxRate, type FxRate } from "@/lib/fx/fx-rates";
import type { CurrencyCode } from "@/types/financial";
import { SubmitButton } from "@/components/ui/SubmitButton";

// Settings — editable exchange-rate source of truth (Stage 23). Server-rendered
// form posts to saveFxRateAction; the list shows the user's current manual rates.
export function FxRatesCard({
  rates,
  baseCurrency,
  status,
}: {
  rates: FxRate[];
  baseCurrency: CurrencyCode;
  status?: "saved" | "invalid" | "error";
}) {
  const manual = rates.filter((r) => r.source === "manual");
  return (
    <div className="rounded-2xl border border-white/5 bg-zinc-900 p-4">
      <p className="text-sm font-semibold text-zinc-100">Tipo de cambio</p>
      <p className="mt-1 text-xs leading-5 text-zinc-500">
        La tasa que Kipu usa para tus monedas. Nunca inventa una — usa esta y tú la actualizas cuando quieras.
      </p>

      {status === "saved" && (
        <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">Tasa guardada.</p>
      )}
      {status === "invalid" && (
        <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          Revisa: dos monedas distintas (USD, ARS…) y un número mayor a 0.
        </p>
      )}
      {status === "error" && (
        <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">No pude guardarla, intenta de nuevo.</p>
      )}

      {manual.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {manual.map((r) => (
            <li key={`${r.from}-${r.to}`} className="text-sm text-zinc-300">
              1 {r.from} = {formatFxRate(r.rate)} {r.to}
            </li>
          ))}
        </ul>
      )}

      <form action={saveFxRateAction} className="mt-4 flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">De</span>
            <select name="from" defaultValue="USD" className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-base text-zinc-50 outline-none focus:border-emerald-400/60">
              {CURRENCIES.map((c) => (
                <option key={c.value} value={c.value}>{c.value}</option>
              ))}
            </select>
          </label>
          <span className="pb-3 text-zinc-500">→</span>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">A</span>
            <select name="to" defaultValue={baseCurrency === "USD" ? "ARS" : baseCurrency} className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-base text-zinc-50 outline-none focus:border-emerald-400/60">
              {CURRENCIES.map((c) => (
                <option key={c.value} value={c.value}>{c.value}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">1 unidad de la primera equivale a…</span>
          <input
            name="rate"
            inputMode="decimal"
            placeholder="1200"
            className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-base text-zinc-50 outline-none placeholder:text-zinc-600 focus:border-emerald-400/60"
          />
        </label>
        <SubmitButton
          className="self-start rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          pendingLabel="Guardando…"
        >
          Guardar tasa
        </SubmitButton>
      </form>
    </div>
  );
}
