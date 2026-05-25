"use server";

import { redirect } from "next/navigation";
import type {
  OnboardingDraft,
  OnboardingDraftAccount,
  OnboardingDraftDebtAccount,
  OnboardingDraftFixedExpense,
  OnboardingDraftGoal,
  OnboardingDraftIncomeSource,
  OnboardingGoalArchetype,
} from "@/lib/onboarding/draft-types";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  AccountType,
  DebtAccountType,
  FinancialCategory,
  PaymentFrequency,
} from "@/types/financial";

function redirectOnError(message: string): never {
  redirect(`/onboarding?message=${encodeURIComponent(message)}`);
}

function isReviewableAccount(account: OnboardingDraftAccount): boolean {
  const name = account.name?.trim();
  if (!name || name === "Cuenta") return false;
  return true;
}

function debtHasAmount(debt: OnboardingDraftDebtAccount): boolean {
  return (
    debt.totalBalance !== undefined ||
    debt.minimumPayment !== undefined ||
    debt.currentMonthPayment !== undefined ||
    debt.accumulatedBalance !== undefined
  );
}

function isReviewableDebt(debt: OnboardingDraftDebtAccount): boolean {
  const name = debt.name?.trim();
  const hasMeaningfulName = Boolean(name && name !== "Deuda");
  return hasMeaningfulName || debtHasAmount(debt);
}

function isReviewableGoal(goal: OnboardingDraftGoal): boolean {
  if (goal.name === "Mi meta" && goal.targetAmount === undefined) return false;
  const hasRealName = Boolean(goal.name && goal.name !== "Mi meta");
  const hasArchetype = goal.archetype !== undefined;
  if (!hasRealName && !hasArchetype) return false;

  // Savings/purchase/emergency/pay-down-debt goals need a target amount to
  // be usable by the goal engine (feasibility, weekly/monthly required).
  // organize_month is the only archetype that legitimately has no amount.
  const isMoneyGoal = goal.archetype !== "organize_month";
  if (isMoneyGoal && goal.targetAmount === undefined) return false;

  return true;
}

function isReviewableIncome(income: OnboardingDraftIncomeSource): boolean {
  return Boolean(
    income.name?.trim() ||
      income.amount !== undefined ||
      income.minExpectedAmount !== undefined,
  );
}

function isReviewableExpense(expense: OnboardingDraftFixedExpense): boolean {
  return expense.amount !== undefined;
}

function defaultGoalName(archetype?: OnboardingGoalArchetype): string {
  switch (archetype) {
    case "organize_month":
      return "Ordenar mi mes";
    case "pay_down_debt":
      return "Bajar lo que debo";
    case "emergency_savings":
      return "Colchón de emergencia";
    case "specific_purchase":
    case "other":
    default:
      return "Meta principal";
  }
}

function inferDebtType(debt: OnboardingDraftDebtAccount): DebtAccountType {
  if (debt.type) return debt.type;

  const name = (debt.name ?? "").toLowerCase();
  if (/tarjeta|card|visa|master|amex|cr[eé]dito|credit/.test(name)) {
    return "credit_card";
  }

  return "other_debt";
}

function validDay(day: number | undefined): number | null {
  return day !== undefined && day >= 1 && day <= 31 ? day : null;
}

function validWeekday(weekday: number | undefined): number | null {
  return weekday !== undefined && weekday >= 0 && weekday <= 6 ? weekday : null;
}

function normalizeAccountType(type: string | undefined): AccountType {
  if (
    type === "bank" ||
    type === "cash" ||
    type === "wallet" ||
    type === "goal_account"
  ) {
    return type;
  }
  return "bank";
}

function normalizeFrequency(frequency: string | undefined): PaymentFrequency {
  if (
    frequency === "weekly" ||
    frequency === "biweekly" ||
    frequency === "monthly" ||
    frequency === "yearly" ||
    frequency === "custom"
  ) {
    return frequency;
  }
  return "monthly";
}

function normalizeCategory(category: string | undefined): FinancialCategory {
  const valid: FinancialCategory[] = [
    "housing",
    "utilities",
    "food",
    "transport",
    "health",
    "education",
    "subscriptions",
    "debt",
    "shopping",
    "entertainment",
    "family",
    "savings",
    "income",
    "travel",
    "other",
  ];
  if (category && valid.includes(category as FinancialCategory)) {
    return category as FinancialCategory;
  }
  return "other";
}

export async function saveOnboardingDraftAction(draft: OnboardingDraft) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const userId = session.user.id;
  const baseCurrency = draft.profile.baseCurrency ?? "USD";

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: draft.profile.fullName?.trim() || null,
      country: draft.profile.country?.trim() || null,
      base_currency: baseCurrency,
      tone_preference:
        draft.profile.tonePreference ??
        draft.coachPreferences.tone ??
        "playful",
      onboarding_completed: true,
    })
    .eq("id", userId);

  if (profileError) {
    redirectOnError(profileError.message);
  }

  const reviewableAccounts = draft.accounts.filter(isReviewableAccount);
  if (reviewableAccounts.length > 0) {
    const { error } = await supabase.from("accounts").insert(
      reviewableAccounts.map((account) => {
        const type = normalizeAccountType(account.type);
        const balance = account.currentBalance ?? 0;

        return {
          user_id: userId,
          name: account.name!.trim(),
          type,
          currency: account.currency ?? baseCurrency,
          current_balance_original: balance,
          current_balance_base: balance,
          is_goal_account:
            Boolean(account.isGoalAccount) || type === "goal_account",
        };
      }),
    );

    if (error) {
      redirectOnError(error.message);
    }
  }

  const reviewableDebts = draft.debtAccounts.filter(isReviewableDebt);
  if (reviewableDebts.length > 0) {
    const { error } = await supabase.from("debt_accounts").insert(
      reviewableDebts.map((debt) => {
        const balance =
          debt.totalBalance ??
          debt.currentMonthPayment ??
          debt.accumulatedBalance ??
          debt.minimumPayment ??
          0;

        return {
          user_id: userId,
          name: debt.name?.trim() || "Deuda",
          type: inferDebtType(debt),
          currency: debt.currency ?? baseCurrency,
          current_balance_original: balance,
          current_balance_base: balance,
          minimum_payment: debt.minimumPayment ?? null,
          full_payment_due: debt.currentMonthPayment ?? null,
          due_day: validDay(debt.dueDay),
          cutoff_day: validDay(debt.cutoffDay),
          interest_rate: debt.interestRate ?? null,
          default_payment_account_id: null,
        };
      }),
    );

    if (error) {
      redirectOnError(error.message);
    }
  }

  const reviewableGoals = draft.goals.filter(isReviewableGoal);
  if (reviewableGoals.length > 0) {
    const { error } = await supabase.from("goals").insert(
      reviewableGoals.map((goal) => ({
        user_id: userId,
        name: goal.name?.trim() || defaultGoalName(goal.archetype),
        target_amount: goal.targetAmount ?? 0,
        current_amount: goal.currentAmount ?? 0,
        currency: goal.currency ?? baseCurrency,
        target_date: goal.targetDate ?? null,
        goal_account_id: null,
        status: "active" as const,
        feasibility_status: "challenging" as const,
        weekly_required_amount: 0,
        monthly_required_amount: 0,
      })),
    );

    if (error) {
      redirectOnError(error.message);
    }
  }

  const reviewableIncome = draft.incomeSources.filter(isReviewableIncome);
  if (reviewableIncome.length > 0) {
    const { error } = await supabase.from("income_sources").insert(
      reviewableIncome.map((income) => ({
        user_id: userId,
        name: income.name?.trim() || "Ingreso",
        amount: income.amount ?? income.minExpectedAmount ?? 0,
        currency: income.currency ?? baseCurrency,
        frequency: normalizeFrequency(income.frequency),
        expected_day: validDay(income.expectedDay),
        expected_weekday: validWeekday(income.expectedWeekday),
        is_variable:
          Boolean(income.isVariable) ||
          income.minExpectedAmount !== undefined ||
          income.maxExpectedAmount !== undefined,
        min_expected_amount: income.minExpectedAmount ?? null,
        max_expected_amount: income.maxExpectedAmount ?? null,
        destination_account_id: null,
        status: "active" as const,
        notes: income.notes ?? null,
      })),
    );

    if (error) {
      redirectOnError(error.message);
    }
  }

  const reviewableExpenses = draft.fixedExpenses.filter(isReviewableExpense);
  if (reviewableExpenses.length > 0) {
    const { error } = await supabase.from("fixed_expenses").insert(
      reviewableExpenses.map((expense) => ({
        user_id: userId,
        name: expense.name?.trim() || "Gasto fijo",
        amount: expense.amount!,
        currency: expense.currency ?? baseCurrency,
        category: normalizeCategory(expense.category),
        frequency: normalizeFrequency(expense.frequency),
        expected_day: validDay(expense.expectedDay),
        expected_weekday: validWeekday(expense.expectedWeekday),
        payment_source_type: null,
        payment_source_id: null,
        is_essential: expense.isEssential ?? true,
        is_active: true,
        notes: expense.notes ?? null,
      })),
    );

    if (error) {
      redirectOnError(error.message);
    }
  }

  const { error: coachError } = await supabase.from("coach_preferences").upsert(
    {
      user_id: userId,
      tone:
        draft.coachPreferences.tone ??
        draft.profile.tonePreference ??
        "playful",
      strictness_level:
        draft.coachPreferences.strictnessLevel ??
        draft.profile.strictnessLevel ??
        "balanced",
      humor_level: draft.coachPreferences.humorLevel ?? "medium",
      detail_level: draft.coachPreferences.detailLevel ?? "short",
      proactive_alerts_enabled:
        draft.coachPreferences.proactiveAlertsEnabled ?? true,
      weekly_review_enabled:
        draft.coachPreferences.weeklyReviewEnabled ?? true,
      daily_checkin_enabled:
        draft.coachPreferences.dailyCheckinEnabled ?? true,
      preferred_language:
        draft.coachPreferences.preferredLanguage ??
        draft.profile.preferredLanguage ??
        "es",
      notes: draft.coachPreferences.notes ?? null,
    },
    { onConflict: "user_id" },
  );

  if (coachError) {
    redirectOnError(coachError.message);
  }

  redirect("/app?message=onboarding-completed");
}
