import { createSupabaseAdminClient } from "@/lib/supabase-admin";
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

export interface GoalsWealthData {
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
  const out: GoalsWealthData = { goals: [], investments: [] };

  // Goals — select * is graceful: extended columns simply absent pre-migration.
  try {
    const { data } = await supabase.from("goals").select("*").eq("user_id", userId);
    out.goals = (data ?? []).map((r) => mapGoalRow(r as Row));
  } catch {
    out.goals = [];
  }

  // Investments / assets — table may not exist yet.
  try {
    const { data, error } = await supabase.from("investment_accounts").select("*").eq("user_id", userId).limit(200);
    if (!error && data) {
      out.investments = data.map((r0) => {
        const r = r0 as Row;
        return {
          name: String(r.name ?? "Inversión"),
          assetClass: (str(r.asset_class) ?? "investment") as AssetClass,
          valueBase: num(r.value_base),
          liquid: typeof r.liquid === "boolean" ? r.liquid : false,
          includeInNetWorth: typeof r.include_in_net_worth === "boolean" ? r.include_in_net_worth : true,
          expectedReturnPct: r.expected_return_pct != null ? num(r.expected_return_pct) : null,
          returnKind: (str(r.return_kind) ?? "annual_nominal") as RateKind,
        } satisfies InvestmentInput;
      });
    }
  } catch {
    out.investments = [];
  }

  // Recurring investment contributions → monthly total (for net-worth projection).
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

  // Preferences extension — select * is graceful.
  try {
    const { data } = await supabase.from("user_financial_preferences").select("*").eq("user_id", userId).maybeSingle();
    if (data) {
      const r = data as Row;
      out.ambitionMode = str(r.ambition_mode) as AmbitionMode | undefined;
      out.riskTolerance = str(r.risk_tolerance) as RiskTolerance | undefined;
      out.emergencyReserveTarget = r.emergency_reserve_target != null ? num(r.emergency_reserve_target) : undefined;
      out.wealthTarget = r.wealth_target != null ? num(r.wealth_target) : null;
    }
  } catch {
    /* defaults */
  }

  return out;
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
    const { error } = await supabase.from("goals").update({ ...patch, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", goalId);
    return !error;
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
