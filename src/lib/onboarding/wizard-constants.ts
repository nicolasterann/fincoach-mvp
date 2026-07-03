// Stage 22 — structured onboarding wizard: shared option lists + labels.
// Pure data, no deps. These power the wizard dropdowns AND the CSV template, so
// both paths stay in sync with the canonical financial enums (@/types/financial).

import type {
  AccountType,
  CoachStrictnessLevel,
  CoachTone,
  CurrencyCode,
  DebtAccountType,
  FinancialCategory,
  PaymentFrequency,
} from "@/types/financial";
import type { OnboardingGoalArchetype } from "./draft-types";

export type Option<T extends string> = { value: T; label: string; hint?: string };

export const CURRENCIES: Option<CurrencyCode>[] = [
  { value: "USD", label: "Dólar (USD)" },
  { value: "ARS", label: "Peso argentino (ARS)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "COP", label: "Peso colombiano (COP)" },
  { value: "PEN", label: "Sol peruano (PEN)" },
  { value: "CLP", label: "Peso chileno (CLP)" },
  { value: "MXN", label: "Peso mexicano (MXN)" },
];

// Country → sensible default base currency. Country itself is free text.
export const COUNTRIES: { value: string; label: string; currency: CurrencyCode }[] = [
  { value: "Ecuador", label: "Ecuador", currency: "USD" },
  { value: "Argentina", label: "Argentina", currency: "ARS" },
  { value: "Colombia", label: "Colombia", currency: "COP" },
  { value: "México", label: "México", currency: "MXN" },
  { value: "Perú", label: "Perú", currency: "PEN" },
  { value: "Chile", label: "Chile", currency: "CLP" },
  { value: "Uruguay", label: "Uruguay", currency: "USD" },
  { value: "Venezuela", label: "Venezuela", currency: "USD" },
  { value: "España", label: "España", currency: "EUR" },
  { value: "Bolivia", label: "Bolivia", currency: "USD" },
  { value: "Paraguay", label: "Paraguay", currency: "USD" },
  { value: "Estados Unidos", label: "Estados Unidos", currency: "USD" },
];

export const ACCOUNT_TYPES: Option<AccountType>[] = [
  { value: "bank", label: "Cuenta de banco" },
  { value: "cash", label: "Efectivo" },
  { value: "wallet", label: "Billetera digital", hint: "PayPal, Mercado Pago, etc." },
];

export const DEBT_TYPES: Option<DebtAccountType>[] = [
  { value: "credit_card", label: "Tarjeta de crédito" },
  { value: "loan", label: "Préstamo" },
  { value: "family_debt", label: "Le debo a alguien" },
  { value: "other_debt", label: "Otra deuda" },
];

// Expense categories (excludes "income"; that's not a fixed expense).
export const EXPENSE_CATEGORIES: Option<FinancialCategory>[] = [
  { value: "housing", label: "Vivienda / arriendo" },
  { value: "utilities", label: "Servicios (luz, agua, internet)" },
  { value: "food", label: "Comida" },
  { value: "transport", label: "Transporte" },
  { value: "subscriptions", label: "Suscripciones" },
  { value: "health", label: "Salud" },
  { value: "education", label: "Educación" },
  { value: "debt", label: "Pago de deuda" },
  { value: "family", label: "Familia" },
  { value: "entertainment", label: "Entretenimiento" },
  { value: "shopping", label: "Compras" },
  { value: "travel", label: "Viajes" },
  { value: "savings", label: "Ahorro" },
  { value: "other", label: "Otro" },
];

// UI frequency set (omits "custom"; the wizard offers the four real-world ones).
export const FREQUENCIES: Option<PaymentFrequency>[] = [
  { value: "monthly", label: "Cada mes" },
  { value: "biweekly", label: "Cada 2 semanas" },
  { value: "weekly", label: "Cada semana" },
  { value: "yearly", label: "Una vez al año" },
];

export const GOAL_ARCHETYPES: Option<OnboardingGoalArchetype>[] = [
  { value: "organize_month", label: "Ordenar mi mes", hint: "Solo quiero entender mi plata" },
  { value: "emergency_savings", label: "Fondo de emergencia", hint: "Un colchón para imprevistos" },
  { value: "specific_purchase", label: "Comprar algo", hint: "Viaje, equipo, un gusto" },
  { value: "pay_down_debt", label: "Salir de deudas" },
  { value: "other", label: "Otra meta" },
];

// S31 (4.7) — THE single goal default-name map. buildOnboardingDraft, the review
// screen, goalReviewable AND save-actions' defaultGoalName() all read this one
// export, so a goal never renders or persists under a different fallback name
// depending on the code path.
export const GOAL_DEFAULT_NAMES: Record<OnboardingGoalArchetype, string> = {
  organize_month: "Ordenar mi mes",
  emergency_savings: "Fondo de emergencia",
  specific_purchase: "Mi compra",
  pay_down_debt: "Salir de deudas",
  other: "Mi meta",
};

// The one archetype that legitimately needs no target amount (matches
// save-actions isReviewableGoal). Used to drive "amount required" in the UI.
export const GOAL_ARCHETYPE_NEEDS_AMOUNT: Record<OnboardingGoalArchetype, boolean> = {
  organize_month: false,
  emergency_savings: true,
  specific_purchase: true,
  pay_down_debt: true,
  other: true,
};

export const COACH_TONES: Option<CoachTone>[] = [
  { value: "playful", label: "Cercano y con humor" },
  { value: "coach_like", label: "Como un coach" },
  { value: "clear", label: "Claro y directo" },
];

export const STRICTNESS_LEVELS: Option<CoachStrictnessLevel>[] = [
  { value: "relaxed", label: "Suave" },
  { value: "balanced", label: "Equilibrado" },
  { value: "strict", label: "Exigente" },
];

export function defaultCurrencyForCountry(country: string | undefined): CurrencyCode | undefined {
  if (!country) return undefined;
  const match = COUNTRIES.find((c) => c.value.toLowerCase() === country.trim().toLowerCase());
  return match?.currency;
}
