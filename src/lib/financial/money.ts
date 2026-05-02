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

export function sumMoneyBaseAmounts(amounts: MoneyAmount[]): number {
  return roundMoney(amounts.reduce((total, amount) => total + amount.baseAmount, 0));
}

export function subtractMoneyBaseAmounts(params: {
  from: MoneyAmount;
  value: MoneyAmount;
}): number {
  return roundMoney(params.from.baseAmount - params.value.baseAmount);
}
