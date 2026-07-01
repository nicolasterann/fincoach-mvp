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
import { isDebtPayoffGoalWithoutAmount } from "@/lib/onboarding/onboarding-guards";
import { resolveOnboardingCoachTone } from "@/lib/onboarding/normalize-coach-tone";
import { loadFxRates, upsertFxRate } from "@/lib/fx/fx-store";
import { convert } from "@/lib/fx/fx-rates";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  AccountType,
  DebtAccountType,
  FinancialCategory,
  PaymentFrequency,
  PaymentSourceType,
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
  if (isDebtPayoffGoalWithoutAmount(goal.name, goal.targetAmount)) return false;
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
  // An income source is only usable (and only persisted) once it carries an amount —
  // consistent with expenses/goals. A name-only entry would persist as 0 and feed a
  // fake paycheck into Margen/cashflow; better not to save it until the amount is known.
  return income.amount !== undefined || income.minExpectedAmount !== undefined;
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

// Resolve a fixed expense's draft payment-source link to the real inserted
// account/debt id. Returns nulls when unresolved (so a dangling link never
// blocks the insert). Powers Margen Kipu's payment-source awareness.
function resolveFixedExpenseSource(
  expense: OnboardingDraftFixedExpense,
  accountIdByDraft: Map<string, string>,
  debtIdByDraft: Map<string, string>,
): { type: PaymentSourceType | null; id: string | null } {
  const draftId = expense.paymentSourceDraftId;
  if (!draftId) return { type: null, id: null };
  if (expense.paymentSourceType === "debt_account") {
    const id = debtIdByDraft.get(draftId);
    return id ? { type: "debt_account", id } : { type: null, id: null };
  }
  const id = accountIdByDraft.get(draftId);
  return id ? { type: "account", id } : { type: null, id: null };
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
  const resolvedTone = resolveOnboardingCoachTone(draft);

  // Double-completion guard (Stage 11): re-running a finished onboarding used
  // to duplicate income sources/accounts. If this user already completed
  // onboarding AND has financial data, never insert again — send them home.
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", userId)
    .maybeSingle();
  if (existingProfile?.onboarding_completed) {
    const { count: existingAccounts } = await supabase
      .from("accounts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((existingAccounts ?? 0) > 0) {
      redirect("/app?message=onboarding-already-completed");
    }
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: draft.profile.fullName?.trim() || null,
      country: draft.profile.country?.trim() || null,
      base_currency: baseCurrency,
      tone_preference: resolvedTone,
      onboarding_completed: true,
    })
    .eq("id", userId);

  if (profileError) {
    redirectOnError(profileError.message);
  }

  // FX first (Stage 24): a manual reference rate must exist BEFORE we write account/
  // debt base amounts, so a non-base balance is converted honestly instead of stored
  // at an implicit rate 1 (which would pollute every base-currency total). Best-effort.
  if (draft.fxRate) {
    await upsertFxRate(userId, draft.fxRate.from, draft.fxRate.to, draft.fxRate.rate, "manual");
  }
  const fxRates = await loadFxRates(userId);
  const baseUpper = baseCurrency.trim().toUpperCase();
  // Convert an original balance to base using ONLY a known rate. Same currency → trivially
  // identical. No known rate → keep the original figure (unchanged from today's behavior);
  // we never fabricate a rate-1 base that pretends a foreign amount equals the base.
  const toBase = (amount: number, currency: string | undefined): number => {
    const from = (currency ?? baseCurrency).trim().toUpperCase();
    if (from === baseUpper) return amount;
    const res = convert(amount, from, baseCurrency, fxRates);
    return res.ok ? res.baseAmount : amount;
  };

  // Insert accounts and debts one at a time so we can map each draft item to its
  // real inserted id. This is what makes payment sources, the goal account, the
  // income destination, and default-payment accounts persist correctly (they
  // were previously hardcoded to null — a real data-loss bug that broke Margen
  // Kipu's payment-source awareness).
  const accountIdByDraft = new Map<string, string>();
  const debtIdByDraft = new Map<string, string>();

  const reviewableAccounts = draft.accounts.filter(isReviewableAccount);
  for (const account of reviewableAccounts) {
    const type = normalizeAccountType(account.type);
    const balance = account.currentBalance ?? 0;
    const { data, error } = await supabase
      .from("accounts")
      .insert({
        user_id: userId,
        name: account.name!.trim(),
        type,
        currency: account.currency ?? baseCurrency,
        current_balance_original: balance,
        current_balance_base: toBase(balance, account.currency),
        is_goal_account: Boolean(account.isGoalAccount) || type === "goal_account",
        liquidity: account.liquidity === "non_liquid" ? "non_liquid" : "liquid",
      })
      .select("id")
      .single();
    if (error) {
      redirectOnError(error.message);
    }
    if (data?.id && account.draftId) {
      accountIdByDraft.set(account.draftId, data.id);
    }
  }

  const reviewableDebts = draft.debtAccounts.filter(isReviewableDebt);
  for (const debt of reviewableDebts) {
    const balance =
      debt.totalBalance ??
      debt.currentMonthPayment ??
      debt.accumulatedBalance ??
      debt.minimumPayment ??
      0;
    const defaultPaymentAccountId = debt.defaultPaymentAccountDraftId
      ? accountIdByDraft.get(debt.defaultPaymentAccountDraftId) ?? null
      : null;
    const { data, error } = await supabase
      .from("debt_accounts")
      .insert({
        user_id: userId,
        name: debt.name?.trim() || "Deuda",
        type: inferDebtType(debt),
        currency: debt.currency ?? baseCurrency,
        current_balance_original: balance,
        current_balance_base: toBase(balance, debt.currency),
        minimum_payment: debt.minimumPayment ?? null,
        full_payment_due: debt.currentMonthPayment ?? null,
        due_day: validDay(debt.dueDay),
        cutoff_day: validDay(debt.cutoffDay),
        interest_rate: debt.interestRate ?? null,
        default_payment_account_id: defaultPaymentAccountId,
      })
      .select("id")
      .single();
    if (error) {
      redirectOnError(error.message);
    }
    if (data?.id && debt.draftId) {
      debtIdByDraft.set(debt.draftId, data.id);
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
        goal_account_id: goal.goalAccountDraftId
          ? accountIdByDraft.get(goal.goalAccountDraftId) ?? null
          : null,
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
    const buildIncomeRow = (
      income: OnboardingDraftIncomeSource,
      withAnchor: boolean,
    ) => ({
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
      destination_account_id: income.destinationAccountDraftId
        ? accountIdByDraft.get(income.destinationAccountDraftId) ?? null
        : null,
      status: "active" as const,
      notes: income.notes ?? null,
      // Stage 24: only present when the column exists (migration 032 applied).
      ...(withAnchor ? { pay_anchor_date: income.payAnchorDate ?? null } : {}),
    });

    // Insert WITH the anchor. If migration 032 isn't applied yet, PostgREST rejects the
    // unknown column (nothing is written on a schema error), so we retry WITHOUT it —
    // onboarding still completes and the optional payday is simply not persisted until
    // the migration lands. A real (non-schema) error surfaces via redirectOnError, so a
    // transient failure never silently drops the anchor post-migration.
    let { error } = await supabase
      .from("income_sources")
      .insert(reviewableIncome.map((income) => buildIncomeRow(income, true)));
    const unknownColumn =
      error != null &&
      (error.code === "PGRST204" ||
        error.code === "42703" ||
        /pay_anchor_date|schema cache/i.test(error.message ?? ""));
    if (unknownColumn) {
      ({ error } = await supabase
        .from("income_sources")
        .insert(reviewableIncome.map((income) => buildIncomeRow(income, false))));
    }

    if (error) {
      redirectOnError(error.message);
    }
  }

  const reviewableExpenses = draft.fixedExpenses.filter(isReviewableExpense);
  if (reviewableExpenses.length > 0) {
    const { error } = await supabase.from("fixed_expenses").insert(
      reviewableExpenses.map((expense) => {
        const source = resolveFixedExpenseSource(expense, accountIdByDraft, debtIdByDraft);
        return {
          user_id: userId,
          name: expense.name?.trim() || "Gasto fijo",
          amount: expense.amount!,
          currency: expense.currency ?? baseCurrency,
          category: normalizeCategory(expense.category),
          frequency: normalizeFrequency(expense.frequency),
          expected_day: validDay(expense.expectedDay),
          expected_weekday: validWeekday(expense.expectedWeekday),
          payment_source_type: source.type,
          payment_source_id: source.id,
          is_essential: expense.isEssential ?? true,
          is_active: true,
          notes: expense.notes ?? null,
        };
      }),
    );

    if (error) {
      redirectOnError(error.message);
    }
  }

  const { error: coachError } = await supabase.from("coach_preferences").upsert(
    {
      user_id: userId,
      tone: resolvedTone,
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

  // Financial preferences (Stage 6/7): the Margen Kipu saving/investing &
  // essential-spending reservations, plus the default payment source so the
  // agent can pick a source when the user doesn't name one. Only written when we
  // actually learned something.
  const prefsPatch: Record<string, number | string> = {};
  if (draft.profile.monthlySavings !== undefined && draft.profile.monthlySavings >= 0) {
    prefsPatch.monthly_savings_commitment = draft.profile.monthlySavings;
  }
  if (draft.profile.monthlyInvestment !== undefined && draft.profile.monthlyInvestment >= 0) {
    prefsPatch.monthly_investment_commitment = draft.profile.monthlyInvestment;
  }
  if (
    draft.profile.essentialMonthlyEstimate !== undefined &&
    draft.profile.essentialMonthlyEstimate >= 0
  ) {
    prefsPatch.essential_monthly_estimate = draft.profile.essentialMonthlyEstimate;
  }

  // Default payment source = the primary day-to-day account (or the first
  // non-goal account), resolved to its real id.
  const primaryDraft =
    reviewableAccounts.find((a) => a.isPrimary && !a.isGoalAccount) ??
    reviewableAccounts.find((a) => !a.isGoalAccount);
  const primaryAccountId = primaryDraft?.draftId
    ? accountIdByDraft.get(primaryDraft.draftId)
    : undefined;
  if (primaryAccountId) {
    prefsPatch.default_source_type = "account";
    prefsPatch.default_source_id = primaryAccountId;
  }

  if (Object.keys(prefsPatch).length > 0) {
    const { error: prefsError } = await supabase
      .from("user_financial_preferences")
      .upsert({ user_id: userId, ...prefsPatch }, { onConflict: "user_id" });
    if (prefsError) {
      redirectOnError(prefsError.message);
    }
  }

  // Onboarding memory (Stage 11.3): everything the user said that doesn't fit
  // a structured row — "el arriendo sube cada tres meses", "los servicios
  // varían 20–80", "también quiere bajar su deuda" — becomes learned context
  // the agent reads from day one. Best-effort: memory must never block the
  // financial save.
  const VALID_NOTE_TYPES = new Set([
    "general",
    "preference",
    "constraint",
    "goal_context",
    "risk_context",
    "behavior_pattern",
  ]);
  const contextNotes = draft.userContextNotes
    .filter((note) => note.content?.trim())
    .slice(0, 20)
    .map((note) => ({
      user_id: userId,
      note_type: VALID_NOTE_TYPES.has(note.noteType ?? "")
        ? (note.noteType as string)
        : "general",
      content: note.content.trim().slice(0, 500),
      source: "onboarding",
      is_active: true,
    }));
  if (contextNotes.length > 0) {
    await supabase.from("user_context_notes").insert(contextNotes);
  }

  // Per-category variable-spend estimates (Stage 23). budget_categories has
  // authenticated CRUD, so the user's own session client can write them. Kipu
  // refines each category from real spend over time; the sum already fed the
  // Margen via essential_monthly_estimate above (no double count).
  const categoryBudgets = (draft.categoryBudgets ?? []).filter((cb) => cb.amount >= 0);
  if (categoryBudgets.length > 0) {
    const { error: budgetError } = await supabase.from("budget_categories").upsert(
      categoryBudgets.map((cb) => ({
        user_id: userId,
        category: cb.category,
        amount: cb.amount,
        currency: baseCurrency,
        period: "monthly",
        is_active: true,
      })),
      { onConflict: "user_id,category,period" },
    );
    if (budgetError) {
      redirectOnError(budgetError.message);
    }
  }

  // Manual reference FX rate is written FIRST (see the FX-first block above) so the
  // account/debt base amounts convert against it. Nothing to do here.

  redirect("/app?message=onboarding-completed");
}
