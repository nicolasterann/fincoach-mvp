import { setDisplayCurrencyAction } from "../display-actions";
import type { CurrencyCode } from "@/types/financial";

// Stage 24 — web-only currency display toggle. Two pills (base ⇄ alt); the active one
// is highlighted. Submitting re-expresses every base-currency number on the dashboard
// at read time — it never rewrites a stored amount. When no manual rate links the two
// currencies we still let the user pick, but show a quiet "sin tasa" hint and keep
// showing native amounts (formatDisplay falls back honestly).
export function DisplayCurrencyToggle({
  base,
  alt,
  active,
  hasRate,
}: {
  base: CurrencyCode;
  alt: CurrencyCode;
  active: CurrencyCode;
  hasRate: boolean;
}) {
  const options: CurrencyCode[] = [base, alt];
  return (
    <div className="flex flex-col items-end gap-1">
      <form action={setDisplayCurrencyAction} className="flex items-center rounded-full border border-white/10 bg-zinc-900 p-0.5">
        {options.map((code) => {
          const isActive = code === active;
          return (
            <button
              key={code}
              type="submit"
              name="currency"
              value={code}
              aria-pressed={isActive}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                isActive ? "bg-emerald-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {code}
            </button>
          );
        })}
      </form>
      <span className="text-[10px] leading-none text-zinc-600">
        {hasRate ? "Kipu te habla en tu moneda base" : "sin tasa — muestro tu moneda base"}
      </span>
    </div>
  );
}
