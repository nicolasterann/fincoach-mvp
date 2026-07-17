import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { moneyReadPublishable, type MoneyReadStatus } from "@/lib/financial/money-read";
import { readFxRates } from "@/lib/fx/fx-store";
import type { FxRate } from "@/lib/fx/fx-rates";
import { convert } from "@/lib/fx/fx-rates";
import type {
  AmbitionMode,
  CurrencyCode,
  FinancialGoal,
  GoalArchetype,
  GoalCadence,
  GoalStatus,
  GoalType,
  RiskTolerance,
} from "@/types/financial";
import type { InvestmentInput } from "@/lib/financial/goals-intelligence";
import type { AssetClass } from "@/lib/financial/net-worth";
import type { RateKind } from "@/lib/financial/interest-math";

// Stage 17 — the goals/wealth persistence layer (migration 025). Service-role
// only. EVERY read uses `select *` and tolerates missing columns/tables, and every
// write is try/catch → production behavior is UNCHANGED until 025 is applied. The
// extended goal fields, investments and ambition/wealth prefs feed the goals
// intelligence; the writes back the agent tools (create/update goal, mini-goal,
// investment, ambition, wealth target).

type Row = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length ? v : undefined);

function mapGoalRow(r: Row): FinancialGoal {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    name: String(r.name ?? ""),
    targetAmount: num(r.target_amount),
    currency: (str(r.currency) ?? "USD") as CurrencyCode,
    currentAmount: num(r.current_amount),
    targetDate: String(r.target_date ?? ""),
    goalAccountId: str(r.goal_account_id),
    status: (str(r.status) ?? "active") as GoalStatus,
    feasibilityStatus: (str(r.feasibility_status) ?? "viable") as FinancialGoal["feasibilityStatus"],
    weeklyRequiredAmount: num(r.weekly_required_amount),
    monthlyRequiredAmount: num(r.monthly_required_amount),
    createdAt: String(r.created_at ?? ""),
    // Stage 17 extended (undefined pre-migration → legacy single-goal defaults)
    goalType: str(r.goal_type) as GoalType | undefined,
    archetype: str(r.archetype) as GoalArchetype | undefined,
    parentGoalId: (str(r.parent_goal_id) ?? null) as string | null,
    isPrimary: typeof r.is_primary === "boolean" ? r.is_primary : undefined,
    priority: typeof r.priority === "number" ? r.priority : r.priority != null ? Number(r.priority) : undefined,
    cadence: str(r.cadence) as GoalCadence | undefined,
    contributionAmount: r.contribution_amount != null ? num(r.contribution_amount) : null,
    cashflowProtected: typeof r.cashflow_protected === "boolean" ? r.cashflow_protected : undefined,
    flexibleDeadline: typeof r.flexible_deadline === "boolean" ? r.flexible_deadline : undefined,
    canPause: typeof r.can_pause === "boolean" ? r.can_pause : undefined,
    contributionModel: str(r.contribution_model) as FinancialGoal["contributionModel"],
    investmentEligible: typeof r.investment_eligible === "boolean" ? r.investment_eligible : undefined,
  };
}

// Bloque I (punto 9) — la lectura reporta sobre sí misma, pero en DOS mitades,
// porque este loader mezcla dos destinos con consecuencias distintas:
//   · goalsRead  = DINERO. Metas + prefs de reserva + base_currency + FX que las
//     metas necesiten. Las metas ACTIVAS restan de monthlyTrulyFree
//     (protectedGoals) y emergencyReserveTarget dimensiona la Reserva: perderlas
//     por un error de lectura SUBE la recarga del tanque.
//   · wealthRead = PATRIMONIO. investment_accounts + su valuación FX. Las
//     inversiones NO alimentan el tanque (solo patrimonio y proyección): un fallo
//     aquí degrada una superficie, no puede inflar el Saldo — y por eso NO debe
//     apagarlo.
// Un solo `ok` obligaba a elegir entre apagar el Saldo por un fallo de patrimonio
// o dejar pasar un fallo de metas; y el catch de investments ni siquiera lo
// marcaba, así que dos fallos equivalentes (error de PostgREST vs excepción) se
// comportaban distinto. Ausencia legítima (cero filas) sigue siendo ok+complete.

/** Tope explícito de lectura de metas. PostgREST trunca en silencio alrededor de
 *  ~1000 filas cuando NO hay .limit(): una query "sin límite" también es una query
 *  topada, solo que sin forma de saberlo. Pedimos CAP+1 — la fila extra PRUEBA que
 *  había cola (una página corta no prueba nada). */
export const GOALS_READ_CAP = 500;
export const INVESTMENTS_READ_CAP = 200;

/** Lo que cada consulta del loader observó, separado del efecto para que la
 *  decisión sea pura y testeable (el gate la ejercita con lecturas inyectadas). */
export interface GoalsWealthReadOutcomes {
  /** Sin base_currency, TODA valuación (metas e inversiones) parte de una
   *  adivinanza ("USD") — envenena ambas mitades. */
  profileFailed: boolean;
  /** Contrato tipado de fx-store: las tasas que convierten metas (río abajo) e
   *  inversiones (aquí). */
  fx: MoneyReadStatus;
  goalsFailed: boolean;
  /** Vino la fila CAP+1: hay metas que no vimos, y las activas restan del tanque. */
  goalsOverflowed: boolean;
  /** Alguna meta vive en moneda ≠ base: su conversión necesita las tasas FX.
   *  Mono-moneda con FX caído sigue siendo publicable — nada necesitaba convertirse. */
  goalsNeedFx: boolean;
  /** user_financial_preferences: emergencyReserveTarget dimensiona la Reserva —
   *  perderlo la libera y eso infla lo gastable. */
  reservePrefsFailed: boolean;
  investmentsFailed: boolean;
  investmentsOverflowed: boolean;
  /** Un activo extranjero intentó valuarse al FX vivo y cayó a su base vieja:
   *  patrimonio plausible y desactualizado. */
  investmentsValuationFellBack: boolean;
}

/** La decisión completa outcomes → {goalsRead, wealthRead}. El invariante que el
 *  gate protege: un fallo de UNA mitad jamás toca la otra, y error-check y catch
 *  de la MISMA consulta marcan el MISMO flag. */
export function resolveGoalsWealthStatus(o: GoalsWealthReadOutcomes): { goalsRead: MoneyReadStatus; wealthRead: MoneyReadStatus } {
  return {
    goalsRead: {
      ok: !o.profileFailed && !o.goalsFailed && !o.reservePrefsFailed,
      complete: !o.goalsOverflowed && (!o.goalsNeedFx || moneyReadPublishable(o.fx)),
    },
    wealthRead: {
      ok: !o.profileFailed && !o.investmentsFailed,
      complete: !o.investmentsOverflowed && !o.investmentsValuationFellBack,
    },
  };
}

export interface GoalsWealthData {
  /** Mitad DINERO (metas, prefs de reserva, base_currency, FX de metas). */
  goalsRead: MoneyReadStatus;
  /** Mitad PATRIMONIO (investment_accounts + valuación FX). */
  wealthRead: MoneyReadStatus;
  /** Veredictos colapsados (moneyReadPublishable) — lo que consulta un guard.
   *  Derivados UNA vez en el return; no existen como estado mutable. */
  goalsOk: boolean;
  wealthOk: boolean;
  goals: FinancialGoal[];
  investments: InvestmentInput[];
  ambitionMode?: AmbitionMode;
  riskTolerance?: RiskTolerance;
  emergencyReserveTarget?: number;
  wealthTarget?: number | null;
  monthlyInvestmentContribution?: number;
}

export async function loadGoalsWealthData(userId: string): Promise<GoalsWealthData> {
  const supabase = createSupabaseAdminClient();
  const out: Omit<GoalsWealthData, "goalsRead" | "wealthRead" | "goalsOk" | "wealthOk"> = { goals: [], investments: [] };
  // Se acumulan OBSERVACIONES; la decisión vive en resolveGoalsWealthStatus para
  // que el gate pueda ejercitarla sin una base de datos.
  const seen: GoalsWealthReadOutcomes = {
    profileFailed: false,
    fx: { ok: true, complete: true },
    goalsFailed: false,
    goalsOverflowed: false,
    goalsNeedFx: false,
    reservePrefsFailed: false,
    investmentsFailed: false,
    investmentsOverflowed: false,
    investmentsValuationFellBack: false,
  };

  // FX — value a foreign asset at the LIVE rate (net worth reads investment valueBase).
  // The native figure is value_original; base currency / no rate → keep the stored base.
  let baseCur = "USD";
  let fxRates: FxRate[] = [];
  try {
    const [profRes, fxRead] = await Promise.all([
      supabase.from("profiles").select("base_currency").eq("id", userId).maybeSingle(),
      readFxRates(userId),
    ]);
    if (profRes.error) seen.profileFailed = true;
    baseCur = String(profRes.data?.base_currency ?? "USD").toUpperCase();
    // Sin tasas, un activo extranjero se queda en su base vieja y una meta en moneda
    // extranjera puede perder su conversión — números plausibles y equivocados. El
    // efecto se decide por mitad: metas solo si ALGUNA vive en otra moneda
    // (goalsNeedFx), inversiones por fila cuando la conversión realmente cae.
    seen.fx = { ok: fxRead.ok, complete: fxRead.complete };
    fxRates = fxRead.rates;
  } catch {
    // No sabemos cuál de las dos lecturas lanzó → tratamos la base como perdida,
    // que envenena ambas mitades (peor caso honesto).
    seen.profileFailed = true;
  }
  const valueAtLiveRate = (base: number, orig: unknown, cur: unknown): number => {
    const c = String(cur ?? baseCur).toUpperCase();
    const o = orig != null ? Number(orig) : NaN;
    if (!Number.isFinite(o) || c === baseCur) return base;
    const res = convert(o, c, baseCur, fxRates);
    // Cayó a la base vieja: el patrimonio queda plausible pero sin valuar al vivo.
    if (!res.ok) seen.investmentsValuationFellBack = true;
    return res.ok ? res.baseAmount : base;
  };

  // Goals — select * is graceful: extended columns simply absent pre-migration.
  try {
    // CAP+1 explícito: sin .limit(), PostgREST trunca solo (~1000) y la lista
    // llegaría corta SIN ninguna señal — la fila extra es la prueba de la cola.
    const { data, error } = await supabase.from("goals").select("*").eq("user_id", userId).limit(GOALS_READ_CAP + 1);
    // Un error de PostgREST llega como { data: null, error } SIN lanzar: perder las
    // metas por eso libera su reserva y sube el tanque.
    if (error) seen.goalsFailed = true;
    const rows = data ?? [];
    if (rows.length > GOALS_READ_CAP) seen.goalsOverflowed = true;
    out.goals = rows.slice(0, GOALS_READ_CAP).map((r) => mapGoalRow(r as Row));
    seen.goalsNeedFx = out.goals.some((g) => String(g.currency).toUpperCase() !== baseCur);
  } catch {
    seen.goalsFailed = true;
    out.goals = [];
  }

  // Investments / assets — table may not exist yet.
  try {
    const { data, error } = await supabase
      .from("investment_accounts")
      .select("*")
      .eq("user_id", userId)
      .limit(INVESTMENTS_READ_CAP + 1);
    // Bloque I — las inversiones NO alimentan el tanque (solo patrimonio y la
    // proyección), así que un fallo aquí degrada un insight, no infla el Saldo. Se
    // marca en SU mitad (wealthRead) para que la superficie pueda decir la verdad
    // en vez de dibujar un patrimonio sin la parte invertida — sin apagar el Saldo.
    if (error) seen.investmentsFailed = true;
    if ((data?.length ?? 0) > INVESTMENTS_READ_CAP) seen.investmentsOverflowed = true;
    if (!error && data) {
      out.investments = data.slice(0, INVESTMENTS_READ_CAP).map((r0) => {
        const r = r0 as Row;
        return {
          name: String(r.name ?? "Inversión"),
          assetClass: (str(r.asset_class) ?? "investment") as AssetClass,
          valueBase: valueAtLiveRate(num(r.value_base), r.value_original, r.currency),
          liquid: typeof r.liquid === "boolean" ? r.liquid : false,
          includeInNetWorth: typeof r.include_in_net_worth === "boolean" ? r.include_in_net_worth : true,
          expectedReturnPct: r.expected_return_pct != null ? num(r.expected_return_pct) : null,
          returnKind: (str(r.return_kind) ?? "annual_nominal") as RateKind,
        } satisfies InvestmentInput;
      });
    }
  } catch {
    // El bug original: el error-check de arriba marcaba y este catch NO — una
    // excepción y un { error } de PostgREST son el MISMO fallo y marcan el
    // MISMO flag.
    seen.investmentsFailed = true;
    out.investments = [];
  }

  // Recurring investment contributions → monthly total (for net-worth projection).
  // Deliberadamente best-effort: perderlo BAJA una proyección (dirección segura,
  // nada se infla) y no alimenta ni tanque ni valuación — no marca ninguna mitad.
  try {
    const { data, error } = await supabase.from("recurring_investment_plans").select("amount, frequency, status").eq("user_id", userId).eq("status", "active");
    if (!error && data) {
      out.monthlyInvestmentContribution = data.reduce((sum, r0) => {
        const r = r0 as Row;
        const amt = num(r.amount);
        const f = str(r.frequency);
        return sum + (f === "weekly" ? amt * 4.33 : f === "biweekly" ? amt * 2.17 : amt);
      }, 0);
    }
  } catch {
    /* none */
  }

  // Preferences extension — select * is graceful. emergencyReserveTarget es
  // DINERO (dimensiona la Reserva): perderlo por un error de lectura la libera,
  // así que un fallo aquí marca la mitad de metas. Ausencia de fila sigue siendo
  // legítima (defaults).
  try {
    const { data, error } = await supabase.from("user_financial_preferences").select("*").eq("user_id", userId).maybeSingle();
    if (error) seen.reservePrefsFailed = true;
    if (data) {
      const r = data as Row;
      out.ambitionMode = str(r.ambition_mode) as AmbitionMode | undefined;
      out.riskTolerance = str(r.risk_tolerance) as RiskTolerance | undefined;
      out.emergencyReserveTarget = r.emergency_reserve_target != null ? num(r.emergency_reserve_target) : undefined;
      out.wealthTarget = r.wealth_target != null ? num(r.wealth_target) : null;
    }
  } catch {
    // Mismo fallo, mismo flag que el error-check de arriba.
    seen.reservePrefsFailed = true;
  }

  const { goalsRead, wealthRead } = resolveGoalsWealthStatus(seen);
  return {
    ...out,
    goalsRead,
    wealthRead,
    goalsOk: moneyReadPublishable(goalsRead),
    wealthOk: moneyReadPublishable(wealthRead),
  };
}

// ── Writes (all try/catch; honest false on failure / pre-migration) ──────────

export interface CreateGoalArgs {
  userId: string;
  name: string;
  targetAmount: number;
  targetDate?: string | null;
  currency?: string;
  goalType?: GoalType;
  archetype?: GoalArchetype;
  parentGoalId?: string | null;
  isPrimary?: boolean;
  priority?: number;
  cadence?: GoalCadence;
  contributionAmount?: number | null;
  flexibleDeadline?: boolean;
  investmentEligible?: boolean;
}

export async function createGoalRow(a: CreateGoalArgs): Promise<{ ok: boolean; id?: string }> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("goals")
      .insert({
        user_id: a.userId,
        name: a.name.slice(0, 120),
        target_amount: a.targetAmount,
        current_amount: 0,
        currency: a.currency ?? "USD",
        target_date: a.targetDate ?? null,
        status: "active",
        feasibility_status: "viable",
        weekly_required_amount: 0,
        monthly_required_amount: 0,
        goal_type: a.goalType ?? (a.parentGoalId ? "mini" : "primary"),
        archetype: a.archetype ?? null,
        parent_goal_id: a.parentGoalId ?? null,
        is_primary: a.isPrimary ?? false,
        priority: a.priority ?? null,
        cadence: a.cadence ?? null,
        contribution_amount: a.contributionAmount ?? null,
        flexible_deadline: a.flexibleDeadline ?? false,
        investment_eligible: a.investmentEligible ?? false,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false };
    return { ok: true, id: String(data.id) };
  } catch {
    return { ok: false };
  }
}

export async function updateGoalRow(userId: string, goalId: string, patch: Record<string, unknown>): Promise<boolean> {
  if (!goalId || Object.keys(patch).length === 0) return false;
  try {
    const supabase = createSupabaseAdminClient();
    // .select() confirms a row actually matched (user + id) — so updating a
    // non-existent / non-owned goal returns false instead of a false "done".
    const { data, error } = await supabase
      .from("goals")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", goalId)
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export interface RegisterInvestmentArgs {
  userId: string;
  name: string;
  assetClass: AssetClass;
  valueBase: number;
  currency?: string;
  liquid?: boolean;
  expectedReturnPct?: number | null;
  returnKind?: RateKind;
  compounding?: string;
  linkedGoalId?: string | null;
}

export async function registerInvestmentRow(a: RegisterInvestmentArgs): Promise<{ ok: boolean; id?: string }> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("investment_accounts")
      .insert({
        user_id: a.userId,
        name: a.name.slice(0, 120),
        asset_class: a.assetClass,
        value_base: a.valueBase,
        currency: a.currency ?? "USD",
        liquid: a.liquid ?? false,
        include_in_net_worth: true,
        expected_return_pct: a.expectedReturnPct ?? null,
        return_kind: a.returnKind ?? null,
        compounding: a.compounding ?? null,
        linked_goal_id: a.linkedGoalId ?? null,
        valuation_date: new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false };
    return { ok: true, id: String(data.id) };
  } catch {
    return { ok: false };
  }
}

export async function setGoalPrefs(userId: string, patch: { ambitionMode?: AmbitionMode; riskTolerance?: RiskTolerance; emergencyReserveTarget?: number; wealthTarget?: number; investmentHorizon?: string }): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
    if (patch.ambitionMode) row.ambition_mode = patch.ambitionMode;
    if (patch.riskTolerance) row.risk_tolerance = patch.riskTolerance;
    if (patch.emergencyReserveTarget != null) row.emergency_reserve_target = patch.emergencyReserveTarget;
    if (patch.wealthTarget != null) row.wealth_target = patch.wealthTarget;
    if (patch.investmentHorizon) row.investment_horizon = patch.investmentHorizon;
    const { error } = await supabase.from("user_financial_preferences").upsert(row, { onConflict: "user_id" });
    return !error;
  } catch {
    return false;
  }
}

// Audit trail (immutable) — best-effort; never read back into Margen.
export async function saveAllocationRevision(userId: string, rows: { goalId: string | null; weekly: number; strategy: string; rationale: string }[]): Promise<void> {
  if (!rows.length) return;
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.from("goal_allocation_revisions").insert(rows.map((r) => ({ user_id: userId, goal_id: r.goalId, weekly_amount: r.weekly, strategy: r.strategy, rationale: r.rationale.slice(0, 300) })));
  } catch {
    /* audit is best-effort */
  }
}
