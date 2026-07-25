import type {
  OnboardingDraftAccount,
  OnboardingDraftDebtAccount,
  OnboardingDraftFixedExpense,
  OnboardingDraftGoal,
  OnboardingDraftIncomeSource,
  OnboardingDraftSavingsPlan,
} from "@/lib/onboarding/draft-types";
import { convert, type FxRate } from "@/lib/fx/fx-rates";

type LinkedInstrumentKind = "account" | "debt";
type LinkedEntityKind = "debt" | "goal" | "income" | "fixed_expense" | "savings_plan";
type CurrencyPlanningGoal = OnboardingDraftGoal & {
  monthlyContribution?: number;
};

export interface OnboardingCurrencyDecision {
  currency: string;
  linkedDraftId: string | null;
}

export interface OnboardingCurrencyIssue {
  entityKind: LinkedEntityKind;
  entityLabel: string;
  linkedLabel: string;
  declaredCurrency: string | null;
  linkedCurrency: string | null;
  reason: "currency_mismatch" | "missing_instrument";
}

export interface OnboardingCurrencyPlan {
  accountCurrencies: ReadonlyMap<string, string>;
  debts: ReadonlyMap<string, OnboardingCurrencyDecision>;
  goals: ReadonlyMap<string, OnboardingCurrencyDecision>;
  incomes: ReadonlyMap<string, OnboardingCurrencyDecision>;
  fixedExpenses: ReadonlyMap<string, OnboardingCurrencyDecision>;
  usedCurrencies: readonly string[];
  issues: readonly OnboardingCurrencyIssue[];
}

export type OnboardingGoalContributionPlan =
  | { ok: true; amount: number | null }
  | { ok: false; missingCurrency: string };

interface PlanInput {
  baseCurrency: string;
  accounts: readonly OnboardingDraftAccount[];
  debts: readonly OnboardingDraftDebtAccount[];
  goals: readonly CurrencyPlanningGoal[];
  incomes: readonly OnboardingDraftIncomeSource[];
  fixedExpenses: readonly OnboardingDraftFixedExpense[];
  /** Reservas/inversiones programadas. Su cuenta de origen y su destino-cuenta
   *  deben compartir la moneda NATIVA del plan (migración 074 lo exige en DB;
   *  sin este preflight, el insert se perdía en silencio por el camino
   *  best-effort y el usuario solo veía una nota genérica). */
  savingsPlans?: readonly OnboardingDraftSavingsPlan[];
  /** Destinos de patrimonio que sí existen en la revisión. Un destino de reserva
   *  puede ser cuenta O activo; pasar sus ids evita confundir un activo válido
   *  con un vínculo eliminado o inventado. */
  assetDraftIds?: readonly string[];
}

interface InstrumentCurrency {
  currency: string;
  label: string;
}

interface ResolveInput {
  baseCurrency: string;
  declaredCurrency?: string;
  linkedDraftId?: string;
  linkedKind: LinkedInstrumentKind;
  entityKind: LinkedEntityKind;
  entityLabel: string;
  accounts: ReadonlyMap<string, InstrumentCurrency>;
  debts: ReadonlyMap<string, InstrumentCurrency>;
}

function normalizeCurrency(currency: string | undefined, fallback: string): string {
  const normalized = currency?.trim().toUpperCase();
  return normalized || fallback;
}

function nonZero(...values: Array<number | undefined>): boolean {
  return values.some(
    (value) => value !== undefined && Number.isFinite(value) && value !== 0,
  );
}

function resolveLinkedCurrency(input: ResolveInput): {
  decision: OnboardingCurrencyDecision;
  issue: OnboardingCurrencyIssue | null;
} {
  const declared = input.declaredCurrency?.trim().toUpperCase() || null;
  if (!input.linkedDraftId) {
    return {
      decision: {
        currency: declared ?? input.baseCurrency,
        linkedDraftId: null,
      },
      issue: null,
    };
  }

  const linked =
    input.linkedKind === "debt"
      ? input.debts.get(input.linkedDraftId)
      : input.accounts.get(input.linkedDraftId);
  if (!linked) {
    return {
      decision: {
        currency: declared ?? input.baseCurrency,
        linkedDraftId: null,
      },
      issue: {
        entityKind: input.entityKind,
        entityLabel: input.entityLabel,
        linkedLabel: "el instrumento elegido",
        declaredCurrency: declared,
        linkedCurrency: null,
        reason: "missing_instrument",
      },
    };
  }

  if (declared && declared !== linked.currency) {
    return {
      decision: {
        currency: declared,
        linkedDraftId: null,
      },
      issue: {
        entityKind: input.entityKind,
        entityLabel: input.entityLabel,
        linkedLabel: linked.label,
        declaredCurrency: declared,
        linkedCurrency: linked.currency,
        reason: "currency_mismatch",
      },
    };
  }

  return {
    decision: {
      currency: declared ?? linked.currency,
      linkedDraftId: input.linkedDraftId,
    },
    issue: null,
  };
}

export function planOnboardingCurrencies(input: PlanInput): OnboardingCurrencyPlan {
  const baseCurrency = normalizeCurrency(input.baseCurrency, "USD");
  const accountInstruments = new Map<string, InstrumentCurrency>();
  const accountCurrencies = new Map<string, string>();
  const assetDraftIds = new Set(input.assetDraftIds ?? []);
  const usedCurrencies = new Set<string>();
  const issues: OnboardingCurrencyIssue[] = [];

  for (const account of input.accounts) {
    const currency = normalizeCurrency(account.currency, baseCurrency);
    accountCurrencies.set(account.draftId, currency);
    accountInstruments.set(account.draftId, {
      currency,
      label: account.name?.trim() || "Cuenta",
    });
    if (nonZero(account.currentBalance)) usedCurrencies.add(currency);
  }

  const debts = new Map<string, OnboardingCurrencyDecision>();
  const debtInstruments = new Map<string, InstrumentCurrency>();
  for (const debt of input.debts) {
    const resolved = resolveLinkedCurrency({
      baseCurrency,
      declaredCurrency: debt.currency,
      linkedDraftId: debt.defaultPaymentAccountDraftId,
      linkedKind: "account",
      entityKind: "debt",
      entityLabel: debt.name?.trim() || "Deuda",
      accounts: accountInstruments,
      debts: debtInstruments,
    });
    debts.set(debt.draftId, resolved.decision);
    debtInstruments.set(debt.draftId, {
      currency: resolved.decision.currency,
      label: debt.name?.trim() || "Deuda",
    });
    if (resolved.issue) issues.push(resolved.issue);
    if (
      nonZero(
        debt.totalBalance,
        debt.minimumPayment,
        debt.currentMonthPayment,
        debt.accumulatedBalance,
      )
    ) {
      usedCurrencies.add(resolved.decision.currency);
    }
  }

  const goals = new Map<string, OnboardingCurrencyDecision>();
  for (const goal of input.goals) {
    const resolved = resolveLinkedCurrency({
      baseCurrency,
      declaredCurrency: goal.currency,
      linkedDraftId: goal.goalAccountDraftId,
      linkedKind: "account",
      entityKind: "goal",
      entityLabel: goal.name?.trim() || "Meta",
      accounts: accountInstruments,
      debts: debtInstruments,
    });
    goals.set(goal.draftId, resolved.decision);
    if (resolved.issue) issues.push(resolved.issue);
    if (nonZero(goal.targetAmount, goal.currentAmount, goal.monthlyContribution)) {
      usedCurrencies.add(resolved.decision.currency);
    }
  }

  const incomes = new Map<string, OnboardingCurrencyDecision>();
  for (const income of input.incomes) {
    const resolved = resolveLinkedCurrency({
      baseCurrency,
      declaredCurrency: income.currency,
      linkedDraftId: income.destinationAccountDraftId,
      linkedKind: "account",
      entityKind: "income",
      entityLabel: income.name?.trim() || "Ingreso",
      accounts: accountInstruments,
      debts: debtInstruments,
    });
    incomes.set(income.draftId, resolved.decision);
    if (resolved.issue) issues.push(resolved.issue);
    if (nonZero(income.amount, income.minExpectedAmount, income.maxExpectedAmount)) {
      usedCurrencies.add(resolved.decision.currency);
    }
  }

  const fixedExpenses = new Map<string, OnboardingCurrencyDecision>();
  for (const expense of input.fixedExpenses) {
    const linkedKind =
      expense.paymentSourceType === "debt_account" ? "debt" : "account";
    const resolved = resolveLinkedCurrency({
      baseCurrency,
      declaredCurrency: expense.currency,
      linkedDraftId: expense.paymentSourceDraftId,
      linkedKind,
      entityKind: "fixed_expense",
      entityLabel: expense.name?.trim() || "Gasto fijo",
      accounts: accountInstruments,
      debts: debtInstruments,
    });
    fixedExpenses.set(expense.draftId, resolved.decision);
    if (resolved.issue) issues.push(resolved.issue);
    if (nonZero(expense.amount)) usedCurrencies.add(resolved.decision.currency);
  }

  for (const plan of input.savingsPlans ?? []) {
    const amount = plan.originalAmount ?? plan.amount;
    if (!nonZero(amount, plan.amount)) continue;
    const currency = normalizeCurrency(plan.originalCurrency, baseCurrency);
    usedCurrencies.add(currency);
    const label = plan.kind === "investment" ? "tu inversión mensual" : "tu ahorro mensual";
    // El origen SIEMPRE es una cuenta. Antes, un id de cuenta eliminado se
    // confundía con "quizá es un activo" y el save lo convertía silenciosamente
    // en source_account_id=null.
    if (plan.sourceDraftId) {
      const source = accountInstruments.get(plan.sourceDraftId);
      if (!source) {
        issues.push({
          entityKind: "savings_plan",
          entityLabel: label,
          linkedLabel: "la cuenta de origen elegida",
          declaredCurrency: currency,
          linkedCurrency: null,
          reason: "missing_instrument",
        });
      } else if (source.currency !== currency) {
        issues.push({
          entityKind: "savings_plan",
          entityLabel: label,
          linkedLabel: source.label,
          declaredCurrency: currency,
          linkedCurrency: source.currency,
          reason: "currency_mismatch",
        });
      }
    }

    // El destino puede ser una cuenta o un activo. Una cuenta comparte la moneda
    // nativa del plan; un activo real es válido sin esa comparación. Cualquier id
    // que no exista en NINGUNO de los dos inventarios es un vínculo roto.
    if (plan.destinationDraftId) {
      const destinationAccount = accountInstruments.get(plan.destinationDraftId);
      if (destinationAccount) {
        if (destinationAccount.currency !== currency) {
          issues.push({
            entityKind: "savings_plan",
            entityLabel: label,
            linkedLabel: destinationAccount.label,
            declaredCurrency: currency,
            linkedCurrency: destinationAccount.currency,
            reason: "currency_mismatch",
          });
        }
      } else if (!assetDraftIds.has(plan.destinationDraftId)) {
        issues.push({
          entityKind: "savings_plan",
          entityLabel: label,
          linkedLabel: "el destino elegido",
          declaredCurrency: currency,
          linkedCurrency: null,
          reason: "missing_instrument",
        });
      }
    }
  }

  return {
    accountCurrencies,
    debts,
    goals,
    incomes,
    fixedExpenses,
    usedCurrencies: [...usedCurrencies].sort(),
    issues,
  };
}

export function onboardingCurrencyIssueMessage(issue: OnboardingCurrencyIssue): string {
  if (issue.reason === "missing_instrument") {
    return `No encontré ${issue.linkedLabel} para "${issue.entityLabel}" en tu revisión. Elige otra opción o quita ese vínculo; no guardé ningún cambio.`;
  }
  return `"${issue.entityLabel}" está en ${issue.declaredCurrency}, pero "${issue.linkedLabel}" está en ${issue.linkedCurrency}. Elige un instrumento en ${issue.declaredCurrency}, cambia explícitamente la moneda del monto o quita ese vínculo; no guardé ningún cambio.`;
}

export function planOnboardingGoalContribution(input: {
  monthlyContribution: number | undefined;
  baseCurrency: string;
  goalCurrency: string;
  rates: readonly FxRate[];
}): OnboardingGoalContributionPlan {
  const monthly = input.monthlyContribution;
  if (monthly === undefined || !Number.isFinite(monthly) || monthly <= 0) {
    return { ok: true, amount: null };
  }
  const baseCurrency = normalizeCurrency(input.baseCurrency, "USD");
  const goalCurrency = normalizeCurrency(input.goalCurrency, baseCurrency);
  if (goalCurrency === baseCurrency) {
    return { ok: true, amount: monthly };
  }
  const converted = convert(monthly, baseCurrency, goalCurrency, [...input.rates]);
  return converted.ok
    ? { ok: true, amount: converted.baseAmount }
    : { ok: false, missingCurrency: goalCurrency };
}
