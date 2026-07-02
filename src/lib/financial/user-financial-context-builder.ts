import { buildFinancialDashboard } from "@/lib/financial/dashboard";
import { buildGoalPlan, type GoalPlan } from "@/lib/financial/goal-planning";
import {
  mapSupabaseBudgetCategory,
  mapSupabaseCoachPreferences,
  mapSupabaseFixedExpense,
  mapSupabaseIncomeSource,
  mapSupabaseSpendingAlertRule,
  mapSupabaseUserContextNote,
  type SupabaseBudgetCategoryRow,
  type SupabaseCoachPreferencesRow,
  type SupabaseFixedExpenseRow,
  type SupabaseIncomeSourceRow,
  type SupabaseSpendingAlertRuleRow,
  type SupabaseUserContextNoteRow,
} from "@/lib/financial/onboarding-context-mappers";
import {
  mapSupabaseAccount,
  mapSupabaseDebtAccount,
  mapSupabaseGoal,
  type SupabaseAccountRow,
  type SupabaseDebtAccountRow,
  type SupabaseGoalRow,
} from "@/lib/financial/supabase-mappers";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadFxRates } from "@/lib/fx/fx-store";
import { convert, type FxRate } from "@/lib/fx/fx-rates";
import { roundMoney } from "@/lib/financial/money";
import type {
  Account,
  BudgetCategory,
  CoachPreferences,
  DebtAccount,
  FinancialGoal,
  FixedExpense,
  IncomeSource,
  RecurringExpense,
  SpendingAlertRule,
  UserContextNote,
  VariableBudgetEstimate,
} from "@/types/financial";

export interface UserFinancialProfileContext {
  userId: string;
  fullName?: string;
  country?: string;
  baseCurrency: string;
  /** Web-display-only currency preference (Stage 24). `undefined` when the user has
   *  NOT explicitly chosen one — in that case display re-expression is a strict no-op
   *  (native amounts render exactly as before). NEVER used by the engine/agent/Telegram. */
  displayCurrency?: string;
  tonePreference: string;
  onboardingCompleted: boolean;
}

export interface UserFinancialContext {
  profile: UserFinancialProfileContext;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  incomeSources: IncomeSource[];
  fixedExpenses: FixedExpense[];
  coachPreferences: CoachPreferences | null;
  budgetCategories: BudgetCategory[];
  spendingAlertRules: SpendingAlertRule[];
  userContextNotes: UserContextNote[];
  mainGoal: FinancialGoal | null;
  goalPlan: GoalPlan;
  dashboard: ReturnType<typeof buildFinancialDashboard> | null;
  summary: {
    activeIncomeSourcesCount: number;
    activeFixedExpensesCount: number;
    activeGoalsCount: number;
    activeDebtAccountsCount: number;
    totalAccountBalanceBase: number;
    totalDebtBalanceBase: number;
    estimatedMonthlyIncome: number;
    estimatedMonthlyFixedExpenses: number;
    baseCurrency: string;
  };
}

interface SupabaseProfileRow {
  id: string;
  full_name: string | null;
  country: string | null;
  base_currency: string;
  // Stage 24 (migration 032) — absent until applied; degrades to base_currency.
  display_currency?: string | null;
  tone_preference: string;
  onboarding_completed: boolean;
}

export async function buildUserFinancialContext(
  userId: string,
): Promise<UserFinancialContext> {
  const supabase = createSupabaseAdminClient();

  const [
    profileResult,
    accountsResult,
    debtAccountsResult,
    goalsResult,
    incomeSourcesResult,
    fixedExpensesResult,
    coachPreferencesResult,
    budgetCategoriesResult,
    spendingAlertRulesResult,
    userContextNotesResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      // `*` so Stage 24 `display_currency` (migration 032) loads when present and
      // degrades gracefully (absent → undefined → base_currency) before 032 is applied.
      .select("*")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("accounts")
      // `*` so the Stage 29 `status` column (migration 034) loads when present and
      // degrades gracefully (absent → undefined → treated as active) before 034 is
      // applied — same defensive pattern as debt_accounts below.
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("debt_accounts")
      // `*` so Stage 14 columns (migration 023) load when present and degrade
      // gracefully (absent → undefined) before 023 is applied.
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("goals")
      .select(
        "id, user_id, name, target_amount, currency, current_amount, target_date, goal_account_id, status, feasibility_status, weekly_required_amount, monthly_required_amount, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("income_sources")
      // `*` so Stage 24 `pay_anchor_date` (migration 032) loads when present and
      // degrades gracefully (absent → undefined → weekday fallback) before 032 is applied.
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("fixed_expenses")
      .select(
        "id, user_id, name, amount, currency, category, frequency, expected_day, expected_weekday, payment_source_type, payment_source_id, is_essential, is_active, notes, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("coach_preferences")
      .select(
        "user_id, tone, strictness_level, humor_level, detail_level, proactive_alerts_enabled, weekly_review_enabled, daily_checkin_enabled, preferred_language, notes, created_at, updated_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("budget_categories")
      .select(
        "id, user_id, category, amount, currency, period, alert_threshold_percentage, is_active, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("spending_alert_rules")
      .select(
        "id, user_id, name, rule_type, category, account_id, debt_account_id, threshold_amount, threshold_percentage, period, is_active, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("user_context_notes")
      .select("id, user_id, note_type, content, source, is_active, created_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
  ]);

  const firstError =
    profileResult.error ??
    accountsResult.error ??
    debtAccountsResult.error ??
    goalsResult.error ??
    incomeSourcesResult.error ??
    fixedExpensesResult.error ??
    coachPreferencesResult.error ??
    budgetCategoriesResult.error ??
    spendingAlertRulesResult.error ??
    userContextNotesResult.error;

  if (firstError) {
    throw new Error(firstError.message);
  }

  const profileRow = profileResult.data as SupabaseProfileRow | null;

  const profile: UserFinancialProfileContext = {
    userId,
    fullName: profileRow?.full_name ?? undefined,
    country: profileRow?.country ?? undefined,
    baseCurrency: profileRow?.base_currency ?? "USD",
    // Only the EXPLICIT choice; undefined => native rendering everywhere (no conversion).
    displayCurrency: profileRow?.display_currency ?? undefined,
    tonePreference: profileRow?.tone_preference ?? "playful",
    onboardingCompleted: profileRow?.onboarding_completed ?? false,
  };

  // Soft-closed accounts (migration 034: status='closed') must NOT count toward
  // Margen or be offered as a source. Defensive: a missing/absent status (pre-034
  // DB, or the narrowed select that omits the column) is treated as active, so
  // this is a strict no-op until an account is actually closed from chat.
  const notClosed = <T>(row: T): boolean =>
    (row as { status?: string | null }).status !== "closed";
  const accounts = ((accountsResult.data ?? []) as SupabaseAccountRow[])
    .filter(notClosed)
    .map(mapSupabaseAccount);

  // ── Engine-base normalization ────────────────────────────────────────────────
  // Every engine downstream (Margen, calendar, cashflow, debt pressure, goal
  // planning, briefing digests) sums `amount`-style fields as if they were in the
  // profile base currency. Rows CAN be in another currency (multi-currency
  // onboarding), so re-express them into base here — once, at the single place the
  // context is assembled — using ONLY the user's known rates (manual/cached).
  // No known rate → the row is left untouched (exactly the pre-existing behavior;
  // never fabricate a rate). Native figures are preserved in original* fields.
  const fxRates: FxRate[] = await loadFxRates(userId);
  const baseUpper = (profile.baseCurrency || "USD").trim().toUpperCase();
  const toBase = (amount: number | undefined, currency: string | undefined): number | null => {
    if (amount == null || !Number.isFinite(amount)) return null;
    const from = (currency ?? baseUpper).trim().toUpperCase();
    if (from === baseUpper) return null; // already base → no conversion marker
    const res = convert(amount, from, baseUpper, fxRates);
    return res.ok ? roundMoney(res.baseAmount) : null;
  };

  const debtAccounts = (
    (debtAccountsResult.data ?? []) as SupabaseDebtAccountRow[]
  )
    .filter(notClosed)
    .map(mapSupabaseDebtAccount)
    .map((debt) => {
      const min = toBase(debt.minimumPayment, debt.currency);
      const full = toBase(debt.fullPaymentDue, debt.currency);
      if (min == null && full == null) return debt;
      return {
        ...debt,
        minimumPayment: min ?? debt.minimumPayment,
        fullPaymentDue: full ?? debt.fullPaymentDue,
        minimumPaymentOriginal: min != null ? debt.minimumPayment : undefined,
        fullPaymentDueOriginal: full != null ? debt.fullPaymentDue : undefined,
      };
    });
  const goals = ((goalsResult.data ?? []) as SupabaseGoalRow[])
    .map(mapSupabaseGoal)
    .map((goal) => {
      const target = toBase(goal.targetAmount, goal.currency);
      if (target == null) return goal;
      const current = toBase(goal.currentAmount, goal.currency);
      return {
        ...goal,
        targetAmount: target,
        currentAmount: current ?? goal.currentAmount,
        originalTargetAmount: goal.targetAmount,
        originalCurrentAmount: goal.currentAmount,
        originalCurrency: goal.currency,
        currency: baseUpper,
      };
    });
  const incomeSources = (
    (incomeSourcesResult.data ?? []) as SupabaseIncomeSourceRow[]
  )
    .map(mapSupabaseIncomeSource)
    .map((source) => {
      const amount = toBase(source.amount, source.currency);
      if (amount == null) return source;
      return {
        ...source,
        amount,
        minExpectedAmount: toBase(source.minExpectedAmount, source.currency) ?? source.minExpectedAmount,
        maxExpectedAmount: toBase(source.maxExpectedAmount, source.currency) ?? source.maxExpectedAmount,
        originalAmount: source.amount,
        originalCurrency: source.currency,
        currency: baseUpper,
      };
    });
  const fixedExpenses = (
    (fixedExpensesResult.data ?? []) as SupabaseFixedExpenseRow[]
  )
    .map(mapSupabaseFixedExpense)
    .map((expense) => {
      const amount = toBase(expense.amount, expense.currency);
      if (amount == null) return expense;
      return {
        ...expense,
        amount,
        originalAmount: expense.amount,
        originalCurrency: expense.currency,
        currency: baseUpper,
      };
    });
  const coachPreferences = coachPreferencesResult.data
    ? mapSupabaseCoachPreferences(
        coachPreferencesResult.data as SupabaseCoachPreferencesRow,
      )
    : null;
  const budgetCategories = (
    (budgetCategoriesResult.data ?? []) as SupabaseBudgetCategoryRow[]
  ).map(mapSupabaseBudgetCategory);
  const spendingAlertRules = (
    (spendingAlertRulesResult.data ?? []) as SupabaseSpendingAlertRuleRow[]
  ).map(mapSupabaseSpendingAlertRule);
  const userContextNotes = (
    (userContextNotesResult.data ?? []) as SupabaseUserContextNoteRow[]
  ).map(mapSupabaseUserContextNote);

  const mainGoal = goals.find((goal) => goal.status === "active") ?? goals[0] ?? null;

  const estimatedMonthlyIncome = incomeSources
    .filter((item) => item.status === "active")
    .reduce((total, item) => total + estimateMonthlyAmount(item.amount, item.frequency), 0);

  const estimatedMonthlyFixedExpenses = fixedExpenses
    .filter((item) => item.isActive)
    .reduce((total, item) => total + estimateMonthlyAmount(item.amount, item.frequency), 0);

  const dashboard = mainGoal
    ? buildFinancialDashboard({
        accounts,
        debtAccounts,
        recurringExpenses: fixedExpenses.map(mapFixedExpenseToRecurringExpense),
        variableBudgetEstimates: budgetCategories.map(mapBudgetCategoryToVariableEstimate),
        goal: mainGoal,
        monthlyIncome: estimatedMonthlyIncome,
        estimatedMonthlySavingsCapacity: Math.max(
          estimatedMonthlyIncome - estimatedMonthlyFixedExpenses,
          0,
        ),
        monthsRemainingForGoal: estimateMonthsRemaining(mainGoal.targetDate),
      })
    : null;

  const goalPlan = buildGoalPlan({
    goal: mainGoal,
    estimatedMonthlyIncome,
    estimatedMonthlyFixedExpenses,
    monthlyDebtDue: dashboard?.debtPressure.monthlyDebtDue ?? 0,
    flexibleSpending: dashboard?.flexibleSpending.flexibleSpending ?? 0,
    debtPressureLevel: dashboard?.debtPressure.level ?? "none",
    baseCurrency: profile.baseCurrency,
  });

  return {
    profile,
    accounts,
    debtAccounts,
    goals,
    incomeSources,
    fixedExpenses,
    coachPreferences,
    budgetCategories,
    spendingAlertRules,
    userContextNotes,
    mainGoal,
    goalPlan,
    dashboard,
    summary: {
      activeIncomeSourcesCount: incomeSources.filter((item) => item.status === "active").length,
      activeFixedExpensesCount: fixedExpenses.filter((item) => item.isActive).length,
      activeGoalsCount: goals.filter((item) => item.status === "active").length,
      activeDebtAccountsCount: debtAccounts.length,
      totalAccountBalanceBase: accounts.reduce(
        (total, account) => total + account.currentBalanceBase,
        0,
      ),
      totalDebtBalanceBase: debtAccounts.reduce(
        (total, debt) => total + debt.currentBalanceBase,
        0,
      ),
      estimatedMonthlyIncome,
      estimatedMonthlyFixedExpenses,
      baseCurrency: profile.baseCurrency,
    },
  };
}

function estimateMonthlyAmount(amount: number, frequency: string): number {
  if (frequency === "weekly") {
    return amount * 4.33;
  }

  if (frequency === "biweekly") {
    return amount * 2.165;
  }

  if (frequency === "yearly") {
    return amount / 12;
  }

  return amount;
}

function estimateMonthsRemaining(targetDate: string): number {
  if (!targetDate) {
    return 1;
  }

  const target = new Date(targetDate);
  const now = new Date();

  if (Number.isNaN(target.getTime())) {
    return 1;
  }

  const months =
    (target.getFullYear() - now.getFullYear()) * 12 +
    (target.getMonth() - now.getMonth());

  return Math.max(months, 1);
}

function mapFixedExpenseToRecurringExpense(expense: FixedExpense): RecurringExpense {
  return {
    id: expense.id,
    userId: expense.userId,
    name: expense.name,
    amount: expense.amount,
    currency: expense.currency,
    category: expense.category,
    frequency: expense.frequency,
    expectedDay: expense.expectedDay,
    paymentSourceId: expense.paymentSourceId,
    confidenceLevel: "high",
    status: expense.isActive ? "active" : "paused",
    createdAt: expense.createdAt,
  };
}

function mapBudgetCategoryToVariableEstimate(
  budget: BudgetCategory,
): VariableBudgetEstimate {
  return {
    id: budget.id,
    userId: budget.userId,
    category: budget.category,
    initialEstimate: budget.amount,
    currentEstimate: budget.amount,
    currency: budget.currency,
    confidenceLevel: "medium",
  };
}
