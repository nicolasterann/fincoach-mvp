import { formatKipuMoney } from "@/lib/financial/money";
import { convert, type FxRate } from "@/lib/fx/fx-rates";
import type { CurrencyCode } from "@/types/financial";

// Stage 24 — WEB-DISPLAY-ONLY re-expression. base_amount / base_currency stay the
// summed source of truth; this NEVER writes a converted number and NEVER fabricates a
// rate. When displayCurrency equals the value's own currency, or no KNOWN rate exists,
// it shows the native amount unchanged (honest fallback). The agent, Telegram and
// ambient nudges never call this — they reason in base currency by design, so the
// web toggle is a purely cosmetic, per-view preference.

export function formatDisplay(
  amount: number,
  fromCurrency: CurrencyCode,
  displayCurrency: CurrencyCode | undefined,
  rates: FxRate[],
): string {
  if (!displayCurrency || displayCurrency === fromCurrency) {
    return formatKipuMoney(amount, fromCurrency);
  }
  const res = convert(amount, fromCurrency, displayCurrency, rates);
  return res.ok
    ? formatKipuMoney(res.baseAmount, displayCurrency)
    : formatKipuMoney(amount, fromCurrency); // no rate → native, never invented
}

// Whether a re-expression into displayCurrency is actually backed by a known rate.
// Lets the toggle show a "sin tasa" hint instead of silently showing native amounts.
export function canDisplayIn(
  fromCurrency: CurrencyCode,
  displayCurrency: CurrencyCode | undefined,
  rates: FxRate[],
): boolean {
  if (!displayCurrency || displayCurrency === fromCurrency) return true;
  return convert(1, fromCurrency, displayCurrency, rates).ok;
}

// A re-usable per-request money formatter, drop-in for formatKipuMoney. When
// displayCurrency equals the base (every user by default, since display_currency is
// NULL → base) it is byte-identical to formatKipuMoney — so wiring it in is a no-op
// for single-currency users and only re-expresses for someone who set a display toggle.
export type DisplayFormatter = (amount: number, fromCurrency?: CurrencyCode) => string;

export function makeDisplayFormatter(
  baseCurrency: CurrencyCode,
  displayCurrency: CurrencyCode | undefined,
  rates: FxRate[],
): DisplayFormatter {
  return (amount: number, fromCurrency?: CurrencyCode) =>
    formatDisplay(amount, fromCurrency ?? baseCurrency, displayCurrency, rates);
}
