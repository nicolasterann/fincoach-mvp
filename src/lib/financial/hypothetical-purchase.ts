import { convert, type FxRate } from "@/lib/fx/fx-rates";
import {
  isObjectiveCategory,
  objectiveDrainForPurchase,
  type ObjectivePurchaseImpact,
  type ObjectiveState,
} from "@/lib/financial/objectives";
import { roundMoney } from "@/lib/financial/money";
import type { CurrencyCode, FinancialCategory } from "@/types/financial";

export type HypotheticalPurchasePlan =
  | {
      ok: true;
      amountOriginal: number;
      originalCurrency: CurrencyCode;
      amountBase: number;
      baseCurrency: CurrencyCode;
      exchangeRateToBase: number;
      category: FinancialCategory;
      objectiveImpact: ObjectivePurchaseImpact | null;
      saldoCostBase: number;
    }
  | {
      ok: false;
      reason: "invalid_amount" | "invalid_currency" | "fx_required";
      originalCurrency: CurrencyCode | null;
      baseCurrency: CurrencyCode;
    };

function currencyCode(value: string | null | undefined): CurrencyCode | null {
  const normalized = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

export function planHypotheticalPurchase(input: {
  amountOriginal: number;
  originalCurrency: string | null | undefined;
  baseCurrency: string;
  category: FinancialCategory;
  fxRates: FxRate[];
  objectiveState?: Pick<ObjectiveState, "category" | "objectiveBase" | "spentMTD"> | null;
}): HypotheticalPurchasePlan {
  const baseCurrency = currencyCode(input.baseCurrency) ?? "USD";
  const originalCurrency = currencyCode(input.originalCurrency);
  if (!originalCurrency) {
    return {
      ok: false,
      reason: "invalid_currency",
      originalCurrency: null,
      baseCurrency,
    };
  }
  if (!Number.isFinite(input.amountOriginal) || input.amountOriginal <= 0) {
    return {
      ok: false,
      reason: "invalid_amount",
      originalCurrency,
      baseCurrency,
    };
  }

  const conversion = convert(
    input.amountOriginal,
    originalCurrency,
    baseCurrency,
    input.fxRates,
  );
  if (!conversion.ok) {
    return {
      ok: false,
      reason: "fx_required",
      originalCurrency,
      baseCurrency,
    };
  }

  const amountBase = roundMoney(conversion.baseAmount);
  const objectiveState =
    isObjectiveCategory(input.category) &&
    input.objectiveState?.category === input.category
      ? input.objectiveState
      : null;
  const objectiveImpact = objectiveState
    ? objectiveDrainForPurchase(objectiveState, amountBase)
    : null;

  return {
    ok: true,
    amountOriginal: roundMoney(input.amountOriginal),
    originalCurrency,
    amountBase,
    baseCurrency,
    exchangeRateToBase: conversion.rate,
    category: input.category,
    objectiveImpact,
    saldoCostBase: objectiveImpact?.drainsFromSaldo ?? amountBase,
  };
}
