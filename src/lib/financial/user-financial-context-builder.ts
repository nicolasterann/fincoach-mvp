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
import { readFxRates, usableCurrentRates } from "@/lib/fx/fx-store";
import { convert, type FxRate } from "@/lib/fx/fx-rates";
import { roundMoney } from "@/lib/financial/money";
import { readUserAssets } from "@/lib/financial/assets-store";
import { moneyReadPublishable } from "@/lib/financial/money-read";
import {
  readKnownVariableFixedBills,
  readVariableFixedForecasts,
  knownVariableFixedBillIdentity,
  variableFixedForecastMatchesPlan,
  type VariableFixedForecast,
} from "@/lib/financial/variable-fixed-store";
import { type KnownVariableFixedBillCalendarInput } from "@/lib/financial/financial-calendar";
import type {
  Account,
  Asset,
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

export function variableFixedMoneyReadRequirements(input: {
  activeVariablePlanExists: boolean;
  fixedPlanCount: number;
  forecastReadComplete: boolean;
  forecastRowCount: number;
  knownBillReadComplete: boolean;
}): {
  forecastUnavailable: boolean;
  knownBillsUnavailable: boolean;
} {
  const forecastUnavailable =
    input.activeVariablePlanExists && !input.forecastReadComplete;
  // A stable/inactive plan can still own observations from a prior variable
  // regime. A complete empty forecast proves that history never existed; a
  // failed forecast read cannot. With zero fixed plans, however, the FK graph
  // proves there cannot be a surviving K bill, so a table blip must not turn
  // off Saldo for an unrelated user.
  const mayHaveVariableHistory =
    input.activeVariablePlanExists ||
    (input.forecastReadComplete
      ? input.forecastRowCount > 0
      : input.fixedPlanCount > 0);
  return {
    forecastUnavailable,
    knownBillsUnavailable:
      mayHaveVariableHistory && !input.knownBillReadComplete,
  };
}

export interface UserFinancialProfileContext {
  userId: string;
  fullName?: string;
  country?: string;
  baseCurrency: string;
  /** Web-display-only currency preference (Stage 24). `undefined` when the user has
   *  NOT explicitly chosen one — in that case display re-expression is a strict no-op
   *  (native amounts render exactly as before). NEVER used by the engine/agent/Telegram. */
  displayCurrency?: string;
  timezone?: string;
  tonePreference: string;
  onboardingCompleted: boolean;
}

export interface UserFinancialContext {
  profile: UserFinancialProfileContext;
  /** Known manual/cached rates loaded with this exact financial snapshot.
   * Advisory planning reuses them so a hypothetical in ARS/EUR is converted
   * against the same evidence that valued the rest of the context. */
  fxRates: FxRate[];
  /** Bloque I (re-auditoría) — ¿quedó VALUADA toda fila monetaria que necesitaba
   *  una tasa?
   *
   *  `false` = alguna conversión de una fila que alimenta Saldo/cashflow FALLÓ — da
   *  igual si fue porque la lectura de `fx_rates` reventó o porque el par
   *  genuinamente no existe. La primera versión de este campo distinguía esos dos
   *  casos y dejaba pasar el segundo; la auditoría demostró que el número miente
   *  IGUAL en ambos: un presupuesto extranjero cae a 0 (deja de reservar → sube
   *  `monthlyTrulyFree` → sube el tanque), un ingreso o fijo extranjero queda con su
   *  monto NATIVO y después se suma como si fuera base (1.000.000 ARS contados como
   *  1.000.000 USD), y cuentas/deudas quedan en su base vieja congelada. El usuario
   *  no distingue "no tengo tasa" de "no reservo nada" — y el número se mueve hacia
   *  arriba igual. Quien publique dinero se niega; el producto pide la tasa.
   *
   *  `true` con la lectura de tasas fallada sigue siendo correcto cuando ninguna
   *  fila era extranjera: no se intentó convertir nada, ningún número se movió, y
   *  negarse sería un apagón inventado (la mayoría del beta es mono-moneda). El
   *  corte ya no vive en un flag paralelo: si `toBase` nunca corrió una conversión,
   *  ninguna pudo fallar. */
  fxReliable: boolean;
  /** All account/debt/asset stocks needed for a closed net-worth total were
   * valued in base. Separate from `fxReliable`: a non-liquid foreign asset may
   * degrade patrimonio without turning off the daily Saldo. */
  wealthFxReliable: boolean;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  incomeSources: IncomeSource[];
  fixedExpenses: FixedExpense[];
  /** Native variable invoices already known but not paid, valued in base for
   * the exact-cycle calendar override. */
  knownVariableFixedBills: KnownVariableFixedBillCalendarInput[];
  /** Bloque I (punto 10) — ¿la lectura de activos salió bien? `false` = el agente
   *  y las tools NO pueden afirmar "no tiene activos" (ofrecer registrar algo que ya
   *  existe, o negar lo que sí está). No apaga el Saldo: los activos son patrimonio,
   *  no tanque. */
  assetsAvailable: boolean;
  /** Stage 30 — the user's assets (from public.investment_accounts). SURFACED for
   *  the agent + net worth; NEVER counted as liquid/spendable-this-week money.
   *  Degrades to [] when the assets table predates the current schema. */
  assets: Asset[];
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

export function validFinancialTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export async function buildUserFinancialContext(
  userId: string,
): Promise<UserFinancialContext> {
  const supabase = createSupabaseAdminClient();
  // Every collection asks CAP+1 below the PostgREST server ceiling. Seeing the
  // witness row is not "all data": the agent refuses the context instead of
  // asserting absence or computing on a silently truncated set.
  const CONTEXT_CAP = 500;

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
    assetsRead,
    engagementResult,
    variableFixedForecastRead,
    knownVariableFixedBillsRead,
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
      .order("created_at", { ascending: true })
      .limit(CONTEXT_CAP + 1),
    supabase
      .from("debt_accounts")
      // `*` so Stage 14 columns (migration 023) load when present and degrade
      // gracefully (absent → undefined) before 023 is applied.
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(CONTEXT_CAP + 1),
    supabase
      .from("goals")
      // `notes` (Stage 30 migration 035) added to the narrowed select so the coach
      // note loads; degrades gracefully (absent column → undefined) before 035.
      .select(
        "id, user_id, name, target_amount, currency, current_amount, target_date, goal_account_id, status, feasibility_status, weekly_required_amount, monthly_required_amount, notes, archetype, goal_type, contribution_amount, cadence, cashflow_protected, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(CONTEXT_CAP + 1),
    supabase
      .from("income_sources")
      // `*` so Stage 24 `pay_anchor_date` (migration 032) loads when present and
      // degrades gracefully (absent → undefined → weekday fallback) before 032 is applied.
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(CONTEXT_CAP + 1),
    supabase
      .from("fixed_expenses")
      // `is_variable` (Stage 30 migration 035) added so the engine can treat
      // variable fixed expenses (gas, luz) with lower confidence; degrades
      // gracefully (absent column → undefined → false = truly fixed) before 035.
      // `pay_anchor_date` / `last_confirmed_month` (Stage 32 migration 038,
      // applied in prod): the weekly/biweekly phase anchor and the is_variable
      // confirm stamp.
      .select(
        "id, user_id, name, amount, currency, category, frequency, expected_day, expected_weekday, payment_source_type, payment_source_id, is_essential, is_active, is_variable, pay_anchor_date, last_confirmed_month, notes, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(CONTEXT_CAP + 1),
    supabase
      .from("coach_preferences")
      .select(
        "user_id, tone, strictness_level, humor_level, detail_level, proactive_alerts_enabled, weekly_review_enabled, daily_checkin_enabled, preferred_language, notes, created_at, updated_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("budget_categories")
      // `mtd_seed` / `seed_month` (Stage 32 migration 038, applied in prod) —
      // the month-to-date seed so the engine reserves only what REMAINS.
      .select(
        "id, user_id, category, amount, currency, period, alert_threshold_percentage, is_active, mtd_seed, seed_month, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(CONTEXT_CAP + 1),
    supabase
      .from("spending_alert_rules")
      .select(
        "id, user_id, name, rule_type, category, account_id, debt_account_id, threshold_amount, threshold_percentage, period, is_active, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(CONTEXT_CAP + 1),
    supabase
      .from("user_context_notes")
      .select("id, user_id, note_type, content, source, is_active, created_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(CONTEXT_CAP + 1),
    // Stage 30 — assets (investment_accounts). Self-guarded reader (own admin
    // client, never throws, degrades to []); assets are surfaced to the agent +
    // net worth, NEVER added to any liquid/spendable sum.
    readUserAssets(userId),
    supabase
      .from("user_engagement")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle(),
    readVariableFixedForecasts(userId),
    readKnownVariableFixedBills(userId),
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
  const contextError = firstError ?? engagementResult.error;

  if (contextError) {
    throw new Error(contextError.message);
  }
  const activeVariableFixedRows = (
    (fixedExpensesResult.data ?? []) as SupabaseFixedExpenseRow[]
  ).some((row) => row.is_active && row.is_variable === true);
  const fixedPlanCount = (fixedExpensesResult.data ?? []).length;
  const variableReadRequirements = variableFixedMoneyReadRequirements({
    activeVariablePlanExists: activeVariableFixedRows,
    fixedPlanCount,
    forecastReadComplete:
      variableFixedForecastRead.ok && variableFixedForecastRead.complete,
    forecastRowCount:
      variableFixedForecastRead.ok && variableFixedForecastRead.complete
        ? variableFixedForecastRead.forecasts.length
        : 0,
    knownBillReadComplete:
      knownVariableFixedBillsRead.ok &&
      knownVariableFixedBillsRead.complete,
  });
  const variableFixedForecastUnavailable =
    variableReadRequirements.forecastUnavailable;
  const knownVariableFixedBillsUnavailable =
    variableReadRequirements.knownBillsUnavailable;
  const cappedContextSet = [
    accountsResult.data,
    debtAccountsResult.data,
    goalsResult.data,
    incomeSourcesResult.data,
    fixedExpensesResult.data,
    budgetCategoriesResult.data,
    spendingAlertRulesResult.data,
    userContextNotesResult.data,
  ].some((rows) => Array.isArray(rows) && rows.length > CONTEXT_CAP);
  if (cappedContextSet) {
    throw new Error("Financial context exceeded its proven complete read cap.");
  }

  const profileRow = profileResult.data as SupabaseProfileRow | null;
  const profileBaseCurrency = String(profileRow?.base_currency ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(profileBaseCurrency)) {
    throw new Error("User profile is missing a valid base currency.");
  }

  const explicitTimezone =
    typeof engagementResult.data?.timezone === "string" &&
    engagementResult.data.timezone.trim()
      ? engagementResult.data.timezone.trim()
      : undefined;
  if (explicitTimezone && !validFinancialTimezone(explicitTimezone)) {
    // A malformed stored timezone is not permission to move the user's
    // day/month boundary to the product fallback. The number becomes
    // unavailable until the capture/backfill stores a valid IANA zone.
    throw new Error("User profile has an invalid IANA timezone.");
  }

  const profile: UserFinancialProfileContext = {
    userId,
    fullName: profileRow?.full_name ?? undefined,
    country: profileRow?.country ?? undefined,
    baseCurrency: profileBaseCurrency,
    // Only the EXPLICIT choice; undefined => native rendering everywhere (no conversion).
    displayCurrency: profileRow?.display_currency ?? undefined,
    timezone: explicitTimezone,
    tonePreference: profileRow?.tone_preference ?? "playful",
    onboardingCompleted: profileRow?.onboarding_completed ?? false,
  };

  // Soft-closed accounts (migration 034: status='closed') must NOT count toward
  // Margen or be offered as a source. Defensive: a missing/absent status (pre-034
  // DB, or the narrowed select that omits the column) is treated as active, so
  // this is a strict no-op until an account is actually closed from chat.
  const notClosed = <T>(row: T): boolean =>
    (row as { status?: string | null }).status !== "closed";
  let accounts = ((accountsResult.data ?? []) as SupabaseAccountRow[])
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
  // Bloque I — una lectura de tasas FALLIDA deja cada fila en su base congelada de
  // escritura: un número plausible y viejo, no un cero. El contexto lo reporta
  // (`fxReliable`) para que quien publique dinero decida; el `convert` de abajo sigue
  // sin fabricar tasas, que es la doctrina correcta cuando la tasa de verdad no está.
  const fxRead = await readFxRates(userId);
  // Las tasas QUE HAY (consumo parcial por diseño): la completitud la juzga la
  // VALUACIÓN (moneyFxIncomplete/fxReliable), no este lector (puntos 1+2+9).
  const fxRates: FxRate[] = usableCurrentRates(fxRead);
  const baseUpper = (profile.baseCurrency || "USD").trim().toUpperCase();
  // Se marca el FALLO, no el intento — aquí, en el ÚNICO punto donde este archivo
  // convierte, para que ninguna fila extranjera pueda escaparse del veredicto sin
  // tocar esta línea. La versión anterior marcaba "hubo conversión" y el veredicto
  // perdonaba si la LECTURA había sido sana; pero una tasa genuinamente ausente hace
  // fallar el convert exactamente igual, y el número resultante miente exactamente
  // igual. Un intento que SALIÓ BIEN no ensucia nada.
  //
  // Re-auditoría 2 (punto 8) — el RADIO del flag es tan importante como el flag:
  // `moneyFxIncomplete` apaga el Saldo entero (fxReliable → KipuSaldoUnavailableError),
  // así que solo puede encenderlo una fila que ALIMENTA el Saldo/cashflow. Un ACTIVO
  // (patrimonio/display) o una fila INACTIVA (ingreso pausado, fijo apagado,
  // presupuesto desactivado, meta cancelada — todas filtradas antes de cualquier
  // suma) que no se pudo valuar degrada su superficie, no el Saldo. Para eso hay dos
  // conversores: `toBase` (crítico: marca) y `toBaseSoft` (jamás marca).
  // Keep the agent alive so it can still record a native bill or explain the
  // read failure, but make every Saldo/planning publisher fail closed. Throwing
  // here dropped the whole agent into the legacy fallback — precisely the path
  // that does not know K's observation contract.
  let moneyFxIncomplete =
    variableFixedForecastUnavailable || knownVariableFixedBillsUnavailable;
  let wealthFxIncomplete = false;
  const toBaseAs = (amount: number | undefined, currency: string | undefined, critical: boolean): number | null => {
    if (amount == null || !Number.isFinite(amount)) return null;
    const from = (currency ?? baseUpper).trim().toUpperCase();
    if (from === baseUpper) return null; // already base → no conversion marker
    // Zero is zero in every currency. Requiring an FX row to prove it only
    // creates a deadlock for empty foreign accounts/plans and cannot change a
    // financial total.
    if (Math.abs(amount) <= 0.0000001) return 0;
    const res = convert(amount, from, baseUpper, fxRates);
    if (!res.ok) {
      if (critical) moneyFxIncomplete = true;
      return null;
    }
    return roundMoney(res.baseAmount);
  };
  const toBase = (amount: number | undefined, currency: string | undefined): number | null =>
    toBaseAs(amount, currency, true);
  const toBaseSoft = (amount: number | undefined, currency: string | undefined): number | null =>
    toBaseAs(amount, currency, false);

  // S6 — value FOREIGN-currency accounts at the LIVE rate, not the base frozen at write
  // time. A peso balance's USD value is a function of TODAY's rate; with the weekly ARS
  // auto-refresh a stale frozen base would drift from reality (net worth, liquid and the
  // agent's account lines all read currentBalanceBase). No known rate → keep the stored
  // base (never fabricate). Base-currency accounts are untouched (toBase → null). The
  // native amount stays in currentBalanceOriginal.
  accounts = accounts.map((acc) => {
    const moneyCritical =
      !acc.isGoalAccount && acc.liquidity !== "non_liquid";
    const base = (moneyCritical ? toBase : toBaseSoft)(
      acc.currentBalanceOriginal,
      acc.currency,
    );
    if (
      base == null &&
      String(acc.currency).toUpperCase() !== baseUpper &&
      Math.abs(acc.currentBalanceOriginal) > 0.0000001
    ) {
      wealthFxIncomplete = true;
    }
    return base == null ? acc : { ...acc, currentBalanceBase: base };
  });
  // FX — value FOREIGN-currency ASSETS at the LIVE rate too (net worth + wealth-target
  // progress read valueBase). The native figure lives in valueOriginal; no rate / base
  // currency → keep the stored base.
  // Re-auditoría 2 (punto 7): el veredicto ENTERO — ok Y complete. Con 201 activos la
  // lectura recorta a 200 y `ok` solo seguía diciendo "disponible": el agente negaba
  // el activo #201 con cara de hecho. Y (punto 8) la conversión de activos es SOFT:
  // el patrimonio no alimenta el Saldo, así que una póliza en otra moneda sin tasa
  // no puede apagar el número diario entero.
  const assetsAvailable = moneyReadPublishable(assetsRead);
  // Para MOSTRAR (prompt del agente, net worth estimado) el brazo parcial sirve;
  // afirmar ausencia o totales cerrados exige assetsAvailable (arriba).
  const assets = moneyReadPublishable(assetsRead) ? assetsRead.assets : assetsRead.ok ? assetsRead.partial : [];
  const assetsBased = assets.map((a) => {
    if (a.valueOriginal == null || !a.currency) return a;
    const base = toBaseSoft(a.valueOriginal, a.currency);
    if (
      base == null &&
      String(a.currency).toUpperCase() !== baseUpper &&
      Math.abs(a.valueOriginal) > 0.0000001
    ) {
      wealthFxIncomplete = true;
    }
    return base == null ? a : { ...a, valueBase: base };
  });

  const debtAccounts = (
    (debtAccountsResult.data ?? []) as SupabaseDebtAccountRow[]
  )
    .filter(notClosed)
    .map(mapSupabaseDebtAccount)
    .map((debt) => {
      const min = toBase(debt.minimumPayment, debt.currency);
      const full = toBase(debt.fullPaymentDue, debt.currency);
      // FX — live-convert the accumulated STOCK too (net worth, debt pressure/health and
      // the card cycle all read currentBalanceBase). No rate / base currency → keep stored.
      const stock = toBase(debt.currentBalanceOriginal, debt.currency);
      if (
        stock == null &&
        String(debt.currency).toUpperCase() !== baseUpper &&
        Math.abs(debt.currentBalanceOriginal) > 0.0000001
      ) {
        wealthFxIncomplete = true;
      }
      if (min == null && full == null && stock == null) return debt;
      return {
        ...debt,
        minimumPayment: min ?? debt.minimumPayment,
        fullPaymentDue: full ?? debt.fullPaymentDue,
        currentBalanceBase: stock ?? debt.currentBalanceBase,
        minimumPaymentOriginal: min != null ? debt.minimumPayment : undefined,
        fullPaymentDueOriginal: full != null ? debt.fullPaymentDue : undefined,
      };
    });
  const goals = ((goalsResult.data ?? []) as SupabaseGoalRow[])
    .map(mapSupabaseGoal)
    .map((goal) => {
      // Solo una meta ACTIVA puede alimentar dinero (mainGoal/goalPlan filtran
      // active; la reserva del tanque además pasa por goalReserve.incomplete). Una
      // cancelada/completada extranjera sin tasa no apaga el Saldo (punto 8).
      const conv = goal.status === "active" ? toBase : toBaseSoft;
      const target = conv(goal.targetAmount, goal.currency);
      if (target == null) return goal;
      const current = conv(goal.currentAmount, goal.currency);
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
      // Solo un ingreso ACTIVO alimenta estimatedMonthlyIncome (el filtro de status
      // corre DESPUÉS de convertir): uno pausado/terminado extranjero sin tasa no
      // puede apagar el Saldo (punto 8).
      const conv = source.status === "active" ? toBase : toBaseSoft;
      const amount = conv(source.amount, source.currency);
      if (amount == null) return source;
      return {
        ...source,
        amount,
        minExpectedAmount: conv(source.minExpectedAmount, source.currency) ?? source.minExpectedAmount,
        maxExpectedAmount: conv(source.maxExpectedAmount, source.currency) ?? source.maxExpectedAmount,
        originalAmount: source.amount,
        originalCurrency: source.currency,
        currency: baseUpper,
      };
    });
  const forecastByFixed = new Map<string, VariableFixedForecast>(
    variableFixedForecastRead.ok && variableFixedForecastRead.complete
      ? variableFixedForecastRead.forecasts.map((forecast) => [
          forecast.fixedExpenseId,
          forecast,
        ] as const)
      : [],
  );
  const fixedExpenses = (
    (fixedExpensesResult.data ?? []) as SupabaseFixedExpenseRow[]
  )
    .map(mapSupabaseFixedExpense)
    .map((expense) => {
      const forecast = expense.isVariable
        ? forecastByFixed.get(expense.id)
        : undefined;
      if (expense.isVariable && expense.isActive && !forecast) {
        // Bloque K — a missing learned row is not "no history": migration 093
        // creates a baseline forecast for every variable plan. Publishing with
        // the raw plan here would hide a partial/missing financial read.
        moneyFxIncomplete = true;
      }
      const forecastMatches =
        forecast != null &&
        variableFixedForecastMatchesPlan(forecast, expense);
      const planningProjectionAvailable =
        !expense.isVariable || forecastMatches;
      if (expense.isActive && forecast && !forecastMatches) {
        moneyFxIncomplete = true;
      }
      const planningNative =
        forecastMatches
          ? forecast.planningAmount
          : expense.amount;
      const plannedExpense = {
        ...expense,
        amount: planningNative,
        declaredAmount: expense.amount,
        planningAmount: planningNative,
        planningConfidence:
          forecastMatches ? forecast.confidence : ("baseline" as const),
        planningSampleCount: forecastMatches ? forecast.sampleCount : 0,
        planningRegime: forecastMatches ? forecast.regime : 1,
        planningProjectionAvailable,
      };
      // Solo un fijo ACTIVO alimenta estimatedMonthlyFixedExpenses / el ritmo: uno
      // pausado extranjero sin tasa no puede apagar el Saldo (punto 8).
      const amount = (plannedExpense.isActive ? toBase : toBaseSoft)(
        plannedExpense.amount,
        plannedExpense.currency,
      );
      if (
        plannedExpense.currency.trim().toUpperCase() === baseUpper
      ) {
        return {
          ...plannedExpense,
          planningProjectionAvailable,
          planningValuationAvailable: true,
        };
      }
      if (amount == null) {
        // Bloques I+K — never leave a native amount in the engine's base-money
        // field. The global `fxReliable=false` is the publication verdict; zero
        // is only a neutral internal placeholder so even a consumer bug cannot
        // turn 30,000 ARS into 30,000 USD. The native fact stays explicit.
        return {
          ...plannedExpense,
          amount: 0,
          originalAmount: planningNative,
          originalCurrency: plannedExpense.currency,
          currency: baseUpper,
          planningProjectionAvailable,
          planningValuationAvailable: false,
        };
      }
      return {
        ...plannedExpense,
        amount,
        originalAmount: planningNative,
        originalCurrency: plannedExpense.currency,
        currency: baseUpper,
        planningProjectionAvailable,
        planningValuationAvailable: true,
      };
    });
  const fixedExpenseById = new Map(
    fixedExpenses.map((expense) => [expense.id, expense] as const),
  );
  const knownBillCycleKeys = new Set<string>();
  const duplicateKnownBillCycleKeys = new Set<string>();
  if (knownVariableFixedBillsRead.ok && knownVariableFixedBillsRead.complete) {
    for (const bill of knownVariableFixedBillsRead.bills) {
      if (!fixedExpenseById.has(bill.fixedExpenseId)) {
        moneyFxIncomplete = true;
        continue;
      }
      const key = knownVariableFixedBillIdentity(bill);
      if (knownBillCycleKeys.has(key)) duplicateKnownBillCycleKeys.add(key);
      knownBillCycleKeys.add(key);
    }
  }
  if (duplicateKnownBillCycleKeys.size > 0) moneyFxIncomplete = true;

  const knownVariableFixedBills: KnownVariableFixedBillCalendarInput[] =
    knownVariableFixedBillsRead.ok && knownVariableFixedBillsRead.complete
      ? knownVariableFixedBillsRead.bills.flatMap<KnownVariableFixedBillCalendarInput>((bill) => {
          const plan = fixedExpenseById.get(bill.fixedExpenseId);
          if (!plan) {
            moneyFxIncomplete = true;
            return [];
          }
          const cycleKey = knownVariableFixedBillIdentity(bill);
          if (duplicateKnownBillCycleKeys.has(cycleKey)) return [];
          if (bill.settled) {
            // This fact only suppresses a forecast for a cycle whose cash
            // already moved (or whose proven invoice was zero). Its historical
            // native amount feeds the estimator in PostgreSQL, not today's
            // base-money calendar, so a missing current FX rate must not turn
            // off Saldo for a number that no longer enters it.
            return [
              {
                occurrenceId: bill.occurrenceId,
                fixedExpenseId: bill.fixedExpenseId,
                occurrenceDate: bill.occurrenceDate,
                cadence: bill.cadence,
                amount: 0,
                status: bill.status,
                settled: true,
              },
            ];
          }
          const nativeCurrency = bill.currency.trim().toUpperCase();
          const amount =
            nativeCurrency === baseUpper
              ? bill.amount
              : toBase(bill.amount, nativeCurrency);
          if (amount == null) {
            // Preserve the native fact in storage/UI, but never place that
            // number into a base-money calendar at 1:1.
            moneyFxIncomplete = true;
            return [];
          }
          return [
            {
              occurrenceId: bill.occurrenceId,
              fixedExpenseId: bill.fixedExpenseId,
              occurrenceDate: bill.occurrenceDate,
              cadence: bill.cadence,
              amount,
              status: bill.status,
              settled: bill.settled,
            },
          ];
        })
      : [];
  const coachPreferences = coachPreferencesResult.data
    ? mapSupabaseCoachPreferences(
        coachPreferencesResult.data as SupabaseCoachPreferencesRow,
      )
    : null;
  const budgetCategories = (
    (budgetCategoriesResult.data ?? []) as SupabaseBudgetCategoryRow[]
  )
    .map(mapSupabaseBudgetCategory)
    // FX — the budget TARGET (`amount`) entered in another currency re-values at the LIVE
    // rate (the digest, the remaining-based essentials reserve and the Margen all read it).
    // `mtdSeed` is DELIBERATELY left untouched: it is month-to-date actual spend, a frozen
    // base snapshot like a transaction's base_amount (actual spend is valued WHEN it
    // happened, never re-floated) — and keeping it base makes the row robust to a later
    // chat edit that rewrites `amount` in base with currency=base.
    .map((bc) => {
      const cur = (bc.currency ?? baseUpper).trim().toUpperCase();
      if (cur === baseUpper) return bc; // already base — `amount` is correct as stored
      // Solo un presupuesto ACTIVO alimenta la reserva de esenciales (el consumo
      // filtra isActive): uno desactivado extranjero sin tasa no apaga el Saldo.
      const base = (bc.isActive ? toBase : toBaseSoft)(bc.amount, bc.currency);
      if (base != null) return { ...bc, amount: base, currency: baseUpper as BudgetCategory["currency"] };
      // Foreign currency with NO known rate: we cannot value it in base and must NEVER leak
      // the native number into the base-denominated essentials/Margen sums (unlike accounts,
      // a budget row has no stored-base fallback column). Reserve 0 until a rate exists —
      // drop rather than lie — keeping the row visible for repair.
      // Bloque I — el 0 no es gratis: un presupuesto que no reserva SUBE
      // `monthlyTrulyFree` y con él el tanque, o sea que este fallback empuja el número
      // hacia arriba, justo donde más duele. Es aceptable cuando la tasa de verdad no
      // existe; cuando solo no se pudo LEER, `fxReliable` (ya en false por este mismo
      // `toBase`) es lo que impide publicarlo como un hecho.
      return { ...bc, amount: 0, currency: baseUpper as BudgetCategory["currency"] };
    });
  const spendingAlertRules = (
    (spendingAlertRulesResult.data ?? []) as SupabaseSpendingAlertRuleRow[]
  ).map(mapSupabaseSpendingAlertRule);
  const userContextNotes = (
    (userContextNotesResult.data ?? []) as SupabaseUserContextNoteRow[]
  ).map(mapSupabaseUserContextNote);

  // Stage 31 (4.5) — prefer a MONEY goal as the main goal so a target-0
  // "Ordenar mi mes" (organize) goal never shadows a real money plan. Falls back
  // to any active goal, then the first row (legacy behavior, archetype-agnostic —
  // safe for pre-archetype rows).
  const mainGoal =
    goals.find((goal) => goal.status === "active" && goal.targetAmount > 0) ??
    goals.find((goal) => goal.status === "active") ??
    goals[0] ??
    null;

  const estimatedMonthlyIncome = incomeSources
    // Occasional/windfall income is excluded from the steady-state monthly estimate.
    .filter((item) => item.status === "active" && !item.isOccasional)
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
    fxRates,
    // Se evalúa DESPUÉS de todas las conversiones: el hecho observado de que alguna
    // fila monetaria quedó SIN valuar — por lectura rota o por par ausente, da igual.
    // Nota deliberada: una lectura de fx_rates INCOMPLETA (tope) sin que ninguna
    // conversión haya fallado sigue siendo confiable — las que corrieron, corrieron
    // con una tasa real.
    fxReliable: !moneyFxIncomplete,
    wealthFxReliable: !wealthFxIncomplete,
    accounts,
    debtAccounts,
    goals,
    incomeSources,
    fixedExpenses,
    knownVariableFixedBills,
    // Surfaced for the agent + net worth; NEVER part of any liquid/spendable sum
    // (see summary.totalAccountBalanceBase, which sums only `accounts`). Foreign-currency
    // assets are re-valued at the live rate (assetsBased).
    assetsAvailable,
    assets: assetsBased,
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
