import type { CurrencyCode, MoneyAmount } from "@/types/financial";

export function createMoneyAmount(params: {
  originalAmount: number;
  originalCurrency: CurrencyCode;
  baseCurrency?: CurrencyCode;
  exchangeRateToBase?: number;
}): MoneyAmount {
  const baseCurrency = params.baseCurrency ?? params.originalCurrency;
  const exchangeRateToBase = params.exchangeRateToBase ?? 1;

  return {
    originalAmount: roundMoney(params.originalAmount),
    originalCurrency: params.originalCurrency,
    exchangeRateToBase,
    baseAmount: roundMoney(params.originalAmount * exchangeRateToBase),
    baseCurrency,
  };
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatMoney(amount: number, currency: CurrencyCode = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Kipu's house money style for ALL user-facing copy: the sign goes AFTER the
// number, no decimals when the amount is whole, two decimals only when there
// are cents, and a thousands separator. "120$", "3.50$", "1,250$" — never
// "$120.00" or "USD 3.00". Use this everywhere in the product UI.
export function formatKipuMoney(
  amount: number,
  currency: CurrencyCode = "USD",
): string {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const abs = Math.abs(rounded);
  const body = isWhole
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(abs))
    : new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(abs);
  const sign = rounded < 0 ? "-" : "";
  return currency === "USD" ? `${sign}${body}$` : `${sign}${body} ${currency}`;
}

export function sumMoneyBaseAmounts(amounts: MoneyAmount[]): number {
  return roundMoney(amounts.reduce((total, amount) => total + amount.baseAmount, 0));
}

export function subtractMoneyBaseAmounts(params: {
  from: MoneyAmount;
  value: MoneyAmount;
}): number {
  return roundMoney(params.from.baseAmount - params.value.baseAmount);
}
