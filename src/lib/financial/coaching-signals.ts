import type { AdvisorySnapshot } from "@/lib/ai/advisory-handler";
import {
  loadEngagement,
  loadMargenCommitments,
  loadNudgeLog,
  recordNudgeSurfaced,
  type EngagementMode,
} from "@/lib/financial/coach-state-store";
import {
  loadOpenReceivables,
  loadUpcomingScheduledPayments,
} from "@/lib/financial/commitments-store";
import { loadActiveSavingsPlans, toCalendarPlan } from "@/lib/financial/savings-plans-store";
import {
  buildLiquidBreakdown,
  sumNonLiquid,
  type LiquidBreakdown,
} from "@/lib/financial/liquidity";
import {
  calculateMargenKipu,
  type MargenKipuResult,
  type MargenConfidence,
  type MarginGap,
} from "@/lib/financial/margen-kipu";
import { buildDebtHealth, type DebtHealthReport } from "@/lib/financial/debt-health";
import { buildFinancialCalendar } from "@/lib/financial/financial-calendar";
import { projectCashflow, type CashflowConfidenceInput, type CashflowProjection } from "@/lib/financial/cashflow-projection";
import { detectSpendingPatterns, type PatternTxn, type SpendingPatterns } from "@/lib/financial/spending-patterns";
import type { ScenarioBase } from "@/lib/financial/cashflow-scenario";
import { buildCategoryBaselines } from "@/lib/financial/category-baselines";
import { computeBudgetProgress, budgetProgressDigestLine, computeBudgetRefineSuggestions, type BudgetProgress } from "@/lib/financial/budget-progress";
import { classifyForIntel, toIntelTxn, buildSpendingIntelligence, essentialBurnMonthly, type SpendingIntelligence } from "@/lib/financial/spending-intelligence";
import { isDiscretionaryCategory } from "@/lib/financial/category-intelligence";
import { computeObjectives, applyObjectiveOverrides, objectivesDigestLine, isObjectiveCategory, type ObjectivesResult } from "@/lib/financial/objectives";
import { makeDayKey } from "@/lib/financial/margen-kipu";
import { formatDateEs } from "@/lib/format/dates-es";
import { buildTreasury, learnAccountShares, emptyTreasury, type TreasurySnapshot, type EverydaySpendSample } from "@/lib/financial/treasury";
import { cardCyclePhaseFor } from "@/lib/financial/card-cycle";
import { loadActiveInstallmentPlans, monthlyInstallmentLoad, monthlyLoadByCard, deferredByCard, installmentProgress, type InstallmentPlanRecord } from "@/lib/financial/installment-plans-store";
import { loadMerchantMemory } from "@/lib/financial/merchant-memory-store";
import { loadGoalsWealthData, type GoalsWealthData } from "@/lib/financial/goals-wealth-store";
import { cadenceToWeekly } from "@/lib/financial/goal-portfolio";
import { buildGoalsIntelligence, type GoalsIntelligence } from "@/lib/financial/goals-intelligence";
import { loadPersonalizationData, type PersonalizationData } from "@/lib/financial/personalization-store";
import { loadHouseholdData } from "@/lib/household/household-store";
import { buildHouseholdIntelligence, emptyHouseholdIntelligence, type HouseholdIntelligence } from "@/lib/household/household-intelligence";
import { buildSnapshotTrend, type SnapshotTrend, type SnapshotMetrics } from "@/lib/trends/trend";
import { loadFxRates as loadFxRatesForGoals } from "@/lib/fx/fx-store";
import { convert as convertGoalFx } from "@/lib/fx/fx-rates";
import { writeDailySnapshot, loadPriorSnapshot } from "@/lib/trends/snapshot-store";
import { buildPersonalizationIntelligence, type PersonalizationIntelligence } from "@/lib/financial/personalization-intelligence";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { UserFinancialContext } from "@/lib/financial/user-financial-context-builder";

// Stage 4 — the proactive coaching layer. A DETERMINISTIC engine that reads the
// user's whole state (margin, days left, upcoming payments, receivables, card
// due dates, fixed expenses, goal, inactivity) and produces structured signals,
// a single next-best-action, and Whoop-style wellness metrics. It NEVER writes;
// the agent reasons over this to coach proactively, reconcile, and recover the
// user without guilt. Numbers come from the real engine, never invented.

export interface WellnessMetrics {
  // All 0–100, higher = healthier.
  financialReadiness: number;
  goalMomentum: number;
  debtPressure: number; // higher = LESS pressure
  spendingFlexibility: number;
  financialAccuracy: number;
  budgetReality: number;
}

export type SignalSeverity = "positive" | "info" | "watch" | "urgent";

// Stage D — "Tesorería" (recommend-only): an obligation's declared funding
// account can't cover what's due in the next ~2 weeks → tell the user exactly
// how much to move, where, and by when. Kipu NEVER moves money itself.
export interface TransferAlert {
  accountId: string;
  accountName: string;
  /** How much is missing for the NEXT tranche due (what to move now, base). */
  missing: number;
  /** Full shortfall across the whole cycle (Σ tranches) — the "or all at once". */
  totalMissing: number;
  /** Total the account must cover in the window. */
  needed: number;
  byDateISO: string;
  obligations: string[];
}

export interface CoachingSignal {
  kind:
    | "margin_negative"
    | "margin_tight"
    | "transfer_needed"
    | "card_due_soon"
    | "payment_scheduled_soon"
    | "receivable_outstanding"
    | "inactivity"
    | "goal_at_risk"
    | "reconcile_due"
    | "card_payment_confirm"
    | "card_overdue"
    | "high_interest_debt"
    | "debt_pressure_high"
    | "budget_refine"
    | "objective_pace"
    | "objective_crossed"
    | "all_good";
  severity: SignalSeverity;
  text: string;
}

export interface CoachingBriefing {
  baseCurrency: string;
  // Margen Kipu = the user's REAL safe spending margin (cash-flow + commitment
  // aware), NOT liquid cash. `weeklyMargin` / `dailySuggested` ARE the Margen
  // Kipu weekly/daily figures. `margenKipu` carries the full computation so the
  // agent can explain "why lower than my bank balance" only when asked.
  weeklyMargin: number;
  dailySuggested: number;
  daysRemainingInWeek: number;
  margenKipu: MargenKipuResult;
  // Exact, reconciling liquid picture (per-account + bank/cash/wallet totals) so
  // the agent never miscalculates a sum and can compare "bank" vs "cash".
  liquid: LiquidBreakdown;
  daysSinceLastActivity: number | null;
  upcomingPayments: { name: string; amount: number | null; dueDate: string }[];
  receivablesOutstanding: number;
  // Money the user holds but cannot spend now (investments / long-term savings)
  // and money protected for the goal — surfaced separately, never "available".
  nonLiquidTotal: number;
  protectedGoalMoney: number;
  cardsDueSoon: { name: string; inDays: number; balance: number }[];
  // Stage D — funding-account shortfalls for dated obligations ("mueve X a Y
  // antes del día Z"). Recommend-only; consumed by the home, chat and ambient.
  transferAlerts: TransferAlert[];
  // Stage F — Tesorería ("Dónde está tu plata"): per-account floors, ideal
  // distribution, concrete moves and the physical homes of the Saldo+Reserva.
  treasury: TreasurySnapshot;
  /** Stage F — an income transaction landed in the last ~2 days (payday moment). */
  incomeLandedRecently: boolean;
  /** Stage G — active installment plans (cuotas). Monthly load already lowers
   *  the ritmo inside margenKipu.capacity.monthlyInstallments. */
  installmentPlans: InstallmentPlanRecord[];
  // Stage 14 — the per-card/debt health model (states, interest, payoff, next
  // action). ONE truth shared by chat, the ambient loop and the dashboard.
  debtHealth: DebtHealthReport;
  // Stage 15 — forward-looking cashflow: day-by-day projection, timing-aware
  // safe spend (today/week/until-income), runway, risk windows, confidence. The
  // SAME truth powers chat, dashboard and Telegram. `cashflowScenarioBase` lets
  // tools re-project what-if scenarios consistently; `patterns` are cautious.
  cashflow: CashflowProjection;
  cashflowScenarioBase: ScenarioBase;
  patterns: SpendingPatterns;
  // Stage 16 — the behavioral spending OS: learned category baselines, dynamic
  // budgets, detected subscriptions/anomalies, margin attribution and the single
  // most useful behavioral insight. "Genius inside, simple outside": the agent
  // reads `spendingIntel.digest` and answers simply. Feeds the cashflow's typical
  // burn when the user has no configured estimate. Never double-counts.
  spendingIntel: SpendingIntelligence;
  // Stage 32 — "Presupuesto vivo": per-category calendar-month budget progress,
  // seed-aware. ALWAYS present (`hasBudgets:false` when the user has no active
  // budget categories → consumers hide/skip). ONE truth for the digest budget
  // line, the spending page and the remaining-based projection burn — no
  // consumer re-does this math.
  budgetProgress: BudgetProgress;
  // Stage H — "Objetivo mensual" (comida/transporte): the user-DECIDED monthly
  // objectives, their month-to-date state (spent/remaining/crossed/excess/
  // extraordinary + pre-cliff projected cross date) and today's extra tank
  // drains. hasObjectives:false → user has no objective set → exact legacy
  // behavior everywhere. ONE truth: the tank merge, the digest, the signals,
  // ambient, home and the month close all read THIS.
  objectives: ObjectivesResult;
  // Stage 17 — the goals/wealth OS: prioritized goal portfolio, human-realistic
  // allocation of the free surplus (controlled joy preserved), the impulse-safe
  // weekly joy budget, net worth + wealth-target progress and investment summary.
  // Committed goal contributions reserve money via the same Margen recarve; the
  // rest is advisory truth the agent phrases simply. Never double-counts.
  goalsIntel: GoalsIntelligence;
  // Stage 18 — the personalization layer: a cautious profile (life philosophy,
  // tone, detail, orientation, risk posture, usage style, nudge sensitivity) +
  // safe decisions. The agent reads `personalization.digest` to adapt TONE,
  // FRAMING and what it surfaces — never the money math, the minimums, or the
  // default brevity. Explicit prefs override inferred behavior.
  personalization: PersonalizationIntelligence;
  // Stage 19 — the household / shared-finance layer: for users in a household, the
  // shared truth (who owes whom, shared spend, pending reimbursements, shared goals)
  // computed ONLY from shared rows — never another member's private personal data.
  // `household.digest` lets the agent coordinate shared money calmly and neutrally;
  // empty/absent for solo users. Never changes the personal ledger or Margen.
  household: HouseholdIntelligence;
  // Stage 20 — honest day-over-day trend vs the last stored snapshot (Margen, safe
  // spend, net worth, debt, Pulso). `hasPrior` is false (and the digest empty) when
  // there's no prior snapshot — Kipu NEVER fabricates a yesterday/today comparison.
  trend: SnapshotTrend;
  signals: CoachingSignal[];
  // The ONE signal Kipu should lead with this turn (rotated so it doesn't
  // repeat itself), or null when nothing fresh is worth mentioning.
  leadSignal: CoachingSignal | null;
  // Signal kinds already mentioned recently — do NOT repeat unless decision-
  // relevant; if repeating, phrase differently.
  recentlyMentioned: string[];
  engagementMode: EngagementMode;
  nextBestAction: string;
  metrics: WellnessMetrics;
  // Compact text the agent gets in its system prompt each turn.
  digest: string;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function scoreDebtPressure(level: string): number {
  switch (level) {
    case "none":
      return 95;
    case "low":
      return 80;
    case "medium":
      return 58;
    case "high":
      return 35;
    case "critical":
      return 15;
    default:
      return 70;
  }
}

function scoreFlexibility(margin: number, daily: number): number {
  if (margin <= 0) return clamp(25 + margin / 8, 5, 25);
  const ref = Math.max(daily, 1);
  if (margin < ref) return 45;
  if (margin < ref * 3) return 68;
  if (margin < ref * 6) return 84;
  return 94;
}

function scoreGoalMomentum(ctx: UserFinancialContext): number {
  if (!ctx.mainGoal || !ctx.dashboard) return 60; // no goal yet → neutral
  const status = ctx.dashboard.goalFeasibility.status;
  const base =
    status === "viable"
      ? 85
      : status === "challenging"
        ? 62
        : status === "at_risk"
          ? 42
          : 25; // not_currently_viable
  const progress = ctx.dashboard.goalProgress.progressPercentage; // 0..100
  return clamp(base * 0.85 + Math.min(progress, 100) * 0.15);
}

function scoreBudgetReality(ctx: UserFinancialContext): number {
  const br = ctx.dashboard?.budgetReality;
  if (!br || br.items.length === 0) return 55; // not learned yet
  return clamp(100 - Math.abs(br.averageDifferencePercentage) * 100, 10, 100);
}

function scoreAccuracy(
  ctx: UserFinancialContext,
  daysSinceLastActivity: number | null,
): number {
  let score = 0;
  if (ctx.summary.estimatedMonthlyIncome > 0) score += 25;
  if (ctx.accounts.some((a) => !a.isGoalAccount)) score += 25;
  if (ctx.fixedExpenses.some((f) => f.isActive)) score += 20;
  if (ctx.dashboard?.budgetReality.items.length) score += 10;
  if (daysSinceLastActivity !== null && daysSinceLastActivity <= 7) score += 20;
  return clamp(score);
}

// Next occurrence of a day-of-month from today (approx, month-length aware).
function daysUntilDueDay(dueDay: number, now: Date): number {
  const today = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (dueDay >= today) return dueDay - today;
  return daysInMonth - today + dueDay;
}

async function loadDaysSinceLastActivity(userId: string): Promise<number | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("transactions")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.created_at) return null;
    return Math.floor((Date.now() - new Date(data.created_at).getTime()) / 86_400_000);
  } catch {
    return null;
  }
}

function money(value: number, currency: string): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

// ── Confidence contract — finalize Margen Kipu's honest confidence + gaps ─────
// The pure engine set defaults from what it could see (income, its essential
// input, unconverted currency). Here we layer the signals only the builder has:
//   • essentialsKnown — the CRUX: true when the user CONFIGURED an essential
//     estimate / active budgets, OR spend history is enough to estimate it
//     (baselines.confidence !== "low", i.e. ≥8 spend txns in ~35d).
//   • dataAgeDays — days since the last movement (null = never logged).
//   • thin history — no prior snapshot yet (soft gap).
// Confidence:
//   preliminary if essentials unknown OR no active income OR data ≥10 days stale.
//   estimated   if not preliminary but ≥1 soft gap (no income date / unconverted
//               currency / thin history).
//   solid       otherwise. We NEVER fake-lower the money figure — only the flag.
function enrichMargenConfidence(x: {
  margenKipu: MargenKipuResult;
  essentialConfigured: boolean;
  baselinesConfidence: "high" | "medium" | "low";
  daysSinceLastActivity: number | null;
  hasActiveIncome: boolean;
  incomeDateKnown: boolean;
  foreignUnconverted: boolean;
  hasPriorSnapshot: boolean;
  // Bloque C — count of recurring occurrences awaiting the user's confirm/correct. The
  // Margen never silently assumes nor silently drops a whole paycheck: while any are open it
  // flags them so the number carries its own honesty (a SOFT gap → "estimated", not blocking).
  unconfirmedRecurringCount?: number;
}): void {
  const mk = x.margenKipu;
  const essentialsKnown = x.essentialConfigured || x.baselinesConfidence !== "low";
  const dataAgeDays = x.daysSinceLastActivity;
  const stale = dataAgeDays !== null && dataAgeDays >= 10;

  const gaps: MarginGap[] = [];
  if (!x.hasActiveIncome) {
    gaps.push({ code: "no_income", label: "no me diste un ingreso todavía" });
  } else if (!x.incomeDateKnown) {
    gaps.push({ code: "no_income_date", label: "no sé bien cuándo cae tu próximo ingreso" });
  }
  if (!essentialsKnown) {
    gaps.push({ code: "essentials_unknown", label: "aún no conozco tu gasto diario" });
  }
  if (stale) {
    gaps.push({
      code: "stale_data",
      label: dataAgeDays !== null ? `hace ${dataAgeDays} días no registras nada` : "hace rato no registras nada",
    });
  }
  if (x.foreignUnconverted) {
    gaps.push({ code: "unconverted_currency", label: "tienes plata en otra moneda sin tasa" });
  }
  // Stage 30 — preserve the pure engine's card-confirm gap (a large, unconfirmable
  // pending statement): the enrichment rebuilds `marginGaps`, so carry it forward.
  const cardConfirmGap = mk.marginGaps.find((g) => g.code === "card_confirm");
  if (cardConfirmGap) gaps.push(cardConfirmGap);
  const unconfirmedRecurring = x.unconfirmedRecurringCount ?? 0;
  if (unconfirmedRecurring > 0) {
    gaps.push({
      code: "recurring_unconfirmed",
      label:
        unconfirmedRecurring === 1
          ? "tienes 1 movimiento recurrente sin confirmar"
          : `tienes ${unconfirmedRecurring} movimientos recurrentes sin confirmar`,
    });
  }
  // Thin history is a SOFT gap (drives "estimated", never "preliminary" on its own):
  // no prior snapshot yet → we can't compare against a real yesterday.
  const hasSoftHistoryGap = !x.hasPriorSnapshot;

  const preliminary = !essentialsKnown || !x.hasActiveIncome || stale;
  const hasSoftGap =
    gaps.some((g) => g.code === "no_income_date" || g.code === "unconverted_currency" || g.code === "card_confirm" || g.code === "recurring_unconfirmed") || hasSoftHistoryGap;
  const confidence: MargenConfidence = preliminary ? "preliminary" : hasSoftGap ? "estimated" : "solid";

  mk.essentialsKnown = essentialsKnown;
  mk.dataAgeDays = dataAgeDays;
  mk.marginGaps = gaps;
  mk.confidence = confidence;
}

// Recent card/debt payments (last ~14 days) so health can detect "looks paid"
// and "paid the minimum / revolving" without asserting beyond the ledger.
async function loadRecentDebtPayments(
  userId: string,
): Promise<{ debtAccountId: string; amount: number; occurredAtMs: number }[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const sinceISO = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const { data } = await supabase
      .from("transactions")
      .select("debt_account_id, base_amount, occurred_at")
      .eq("user_id", userId)
      .eq("type", "debt_payment")
      .gte("occurred_at", sinceISO)
      .not("debt_account_id", "is", null);
    return (data ?? [])
      .filter((r): r is { debt_account_id: string; base_amount: number | string; occurred_at: string } => Boolean(r?.debt_account_id))
      .map((r) => ({
        debtAccountId: r.debt_account_id,
        amount: typeof r.base_amount === "number" ? r.base_amount : Number(r.base_amount),
        occurredAtMs: new Date(r.occurred_at).getTime(),
      }));
  } catch {
    return [];
  }
}

// Recent transactions (last ~35 days) for cautious Stage 15 pattern detection.
async function loadRecentTransactionsForPatterns(userId: string): Promise<PatternTxn[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const sinceISO = new Date(Date.now() - 40 * 86_400_000).toISOString();
    // Paginate the 40-day window so a heavy month never silently truncates its
    // OLDEST rows (the month-start) — Stage H derives money-bearing tank drains
    // from this feed, so an incomplete month would understate the objective
    // accumulator and over-fill the Saldo tank. Capped at 2000 rows / 5 pages
    // as a sanity bound (well beyond any real 40-day volume).
    const PAGE = 400;
    const MAX_ROWS = 2000;
    const rawRows: unknown[] = [];
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      const { data: page } = await supabase
        .from("transactions")
        .select("id, occurred_at, base_amount, type, category, description, related_transaction_id, recurring_expense_id, source_account_id, external_ref, budget_treatment")
        .eq("user_id", userId)
        .gte("occurred_at", sinceISO)
        .order("occurred_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      const got = page ?? [];
      rawRows.push(...got);
      if (got.length < PAGE) break;
    }
    const rows = rawRows as { id: string; occurred_at: string; base_amount: number | string; type: string; category?: string | null; description?: string | null; related_transaction_id?: string | null; recurring_expense_id?: string | null; source_account_id?: string | null; external_ref?: string | null; budget_treatment?: string | null }[];
    // Exclude REVERSED originals (and the reversal rows themselves) so an undone /
    // duplicate expense never inflates the budget or spending analysis. A reversal's
    // related_transaction_id names the original it cancels. (Fixes: a reversed expense
    // still counting in "Presupuesto vivo".)
    const reversedIds = new Set<string>();
    for (const r of rows) {
      if (String(r.type) === "reversal" && r.related_transaction_id) reversedIds.add(String(r.related_transaction_id));
    }
    return rows
      .filter((r) => String(r.type) !== "reversal" && !reversedIds.has(String(r.id)))
      .map((r) => ({
        occurredAtMs: new Date(r.occurred_at).getTime(),
        baseAmount: typeof r.base_amount === "number" ? r.base_amount : Number(r.base_amount),
        type: String(r.type),
        category: r.category ? String(r.category) : undefined,
        description: r.description ? String(r.description) : undefined,
        recurringExpenseId: r.recurring_expense_id ? String(r.recurring_expense_id) : null,
        sourceAccountId: r.source_account_id ? String(r.source_account_id) : null,
        externalRef: r.external_ref ? String(r.external_ref) : null,
        budgetTreatment: r.budget_treatment ? String(r.budget_treatment) : null,
      }));
  } catch {
    return [];
  }
}

export async function buildCoachingBriefing(input: {
  userId: string;
  ctx: UserFinancialContext;
  snapshot: AdvisorySnapshot;
  now?: Date;
  // When false (e.g. the dashboard, a passive view), the briefing does NOT
  // record that a nudge was surfaced — so viewing the dashboard never consumes
  // the chat's nudge cooldown. The chat agent leaves this true.
  surfaceNudges?: boolean;
}): Promise<CoachingBriefing> {
  const { ctx, snapshot, userId } = input;
  const surfaceNudges = input.surfaceNudges !== false;
  const now = input.now ?? new Date();
  const base = snapshot.baseCurrency;

  const [upcomingRaw, receivablesRaw, daysSinceLastActivity, nudgeLog, engagement, commitments, recentDebtPayments, recentTxns, merchantMemory, goalsWealth, personalizationData, savingsPlansRaw, installmentPlans] =
    await Promise.all([
      loadUpcomingScheduledPayments(userId).catch(() => []),
      loadOpenReceivables(userId).catch(() => []),
      loadDaysSinceLastActivity(userId),
      loadNudgeLog(userId),
      loadEngagement(userId),
      loadMargenCommitments(userId),
      loadRecentDebtPayments(userId).catch(() => []),
      loadRecentTransactionsForPatterns(userId).catch(() => []),
      loadMerchantMemory(userId).catch(() => []),
      loadGoalsWealthData(userId).catch((): GoalsWealthData => ({ goals: [], investments: [] })),
      loadPersonalizationData(userId, (input.now ?? new Date()).getTime()).catch((): PersonalizationData => ({ explicitPersonalization: {}, lifeContext: [], captureEvents: [], nudgeEngagement: { sent: 0, replied: 0 }, correctionCount: 0 })),
      loadActiveSavingsPlans(userId).catch(() => []),
      loadActiveInstallmentPlans(userId).catch(() => [] as InstallmentPlanRecord[]),
    ]);
  // Stage 38 — per-reserve schedules drive the calendar's savings/investment
  // reservations on their REAL dates; the stored monthly_savings/investment_commitment
  // stays the authority for CAPACITY. Onboarding writes both from the same reserves so
  // they start equal (scalar = summed monthly-equivalent). If a later aggregate-only edit
  // (set_savings_plan, the "Tu mes" page, a scheduled_change) drifts the scalar from the
  // plans, it is still SAFE: the calendar skips its aggregate block whenever plans are
  // present, so the two never SUM — the headline is min(capacity-flow, plan-dated
  // projection), and drift can only make it more conservative, never looser. Empty ⇒
  // legacy aggregate behavior (pre-migration / chat-only users), unchanged.
  const savingsPlansForCalendar = savingsPlansRaw.map(toCalendarPlan);

  // Stage 19 — household / shared finance. Loaded separately (graceful → empty for
  // solo users and pre-migration) so personal Kipu is never affected. The shared
  // truth is derived ONLY from shared rows; no member's private personal data here.
  const householdData = await loadHouseholdData(userId).catch(() => ({ households: [] }));
  const householdIntel: HouseholdIntelligence = householdData.households.length
    ? buildHouseholdIntelligence({ households: householdData.households, nowMs: now.getTime() })
    : emptyHouseholdIntelligence();

  // Stage 17 — the goal reserve fed to Margen/cashflow is the SUM of COMMITTED
  // per-goal contributions (active + cashflow-protected), the zero-sum recarve.
  // When no goal has a committed contribution (e.g. pre-migration / single legacy
  // goal), fall back to the existing planned figure so behavior is unchanged.
  // Committed contributions live in each goal's OWN currency; re-express into
  // base with the user's known rates before reserving (no known rate → the goal
  // is excluded from the reserve rather than counted at a fabricated 1:1).
  const goalFxRates = await loadFxRatesForGoals(userId);
  let hasCommittedGoalContribution = false;
  const committedGoalReserveWeekly =
    Math.round(
      goalsWealth.goals
        .filter((g) => g.status === "active" && g.cashflowProtected !== false)
        .reduce((sum, g) => {
          const weekly = cadenceToWeekly(g.contributionAmount ?? 0, g.cadence);
          if (!(weekly > 0)) return sum;
          hasCommittedGoalContribution = true;
          const cur = String(g.currency ?? base).toUpperCase();
          if (cur === base.toUpperCase()) return sum + weekly;
          const res = convertGoalFx(weekly, cur, base, goalFxRates);
          return res.ok ? sum + res.baseAmount : sum;
        }, 0) * 100,
    ) / 100;
  const legacyGoalContribution = input.ctx.dashboard?.flexibleSpending.plannedGoalContribution ?? 0;
  // Legacy fallback ONLY when no goal has a committed contribution at all. If
  // committed goals exist but none was convertible (missing rates), reserve
  // what we can state honestly (possibly 0) — the legacy figure is unconverted
  // and would sneak the fabricated 1:1 back in.
  const weeklyGoalContribution = hasCommittedGoalContribution
    ? committedGoalReserveWeekly
    : legacyGoalContribution;

  // Stage 16 — classify every recent txn (no double counting) and learn the
  // user's per-category "normal". Merchant memory (user corrections) wins first.
  const classified = classifyForIntel(recentTxns.map(toIntelTxn), merchantMemory);
  const baselines = buildCategoryBaselines(classified, now.getTime());

  // Day boundaries are the USER's days (their timezone), matching the engine's
  // tank walk exactly — the server (Vercel) runs UTC and must never decide when
  // "hoy" starts for someone in Quito or Buenos Aires. Shared by the gustos
  // aggregation below AND the objectives engine (same month convention).
  const userDayKey = makeDayKey(engagement.timezone);
  const localIso = (ms: number) => userDayKey(new Date(ms));
  const todayISO = userDayKey(now);

  // Stage H — "Objetivo mensual" (comida/transporte). Every active monthly
  // food/transport budget row IS the user's decided objective (founder
  // cold-start: existing numbers become objectives; no row → hasObjectives
  // false → exact legacy behavior). recentTxns ↔ classified are index-aligned.
  const objectivesResult = computeObjectives({
    objectives: ctx.budgetCategories.map((c) => ({
      category: c.category,
      amountBase: c.amount,
      mtdSeed: c.mtdSeed,
      seedMonth: c.seedMonth,
      isActive: c.isActive,
    })),
    txns: classified.map((c, i) => {
      const src = recentTxns[i];
      return {
        dateISO: src ? localIso(src.occurredAtMs) : todayISO,
        category: c.category,
        baseAmount: c.spendingType === "refund" ? (src?.baseAmount ?? 0) : c.baseAmount,
        spendingType: c.spendingType,
        isSpend: c.isSpend,
        recurringExpenseId: src?.recurringExpenseId ?? null,
        externalRef: src?.externalRef ?? null,
        budgetTreatment: src?.budgetTreatment ?? null,
      };
    }),
    todayISO,
  });

  // Stage 32 — "Presupuesto vivo": seed-aware calendar-month budget progress.
  // The 40-day txn window above always covers the whole current month, so the
  // month-to-date spend here is complete. ONE truth: the digest line, the
  // spending page and the remaining-based projection burn below all read THIS.
  // Stage H — objective categories are PATCHED from the objectives engine
  // (doctrine exclusions: extraordinary/fixed-linked/cuotas out, refunds
  // netted, user-tz months) so every surface quotes the SAME accumulator.
  const budgetProgressRaw = computeBudgetProgress({
    budgets: ctx.budgetCategories.map((c) => ({
      category: c.category,
      amountBase: c.amount,
      mtdSeed: c.mtdSeed,
      seedMonth: c.seedMonth,
      isActive: c.isActive,
    })),
    classified,
    now,
  });
  const budgetProgress = applyObjectiveOverrides(budgetProgressRaw, objectivesResult);
  // Two-phase remaining-based burn only for users with real budget categories;
  // lump-only users (chat's essentialMonthlyEstimate, no categories) keep the
  // flat legacy burn — documented, honest (we can't know their month-to-date).
  const remainingBasedEssentials = budgetProgress.hasBudgets && budgetProgress.totalBudget > 0;
  const remainingEssentialThisMonth = remainingBasedEssentials ? budgetProgress.totalRemaining : undefined;
  const daysLeftInMonth = remainingBasedEssentials ? budgetProgress.daysLeftInMonth : undefined;

  const upcomingPayments = upcomingRaw.map((p) => ({
    name: p.name,
    amount: p.amount,
    dueDate: p.dueDate,
  }));
  const receivablesOutstanding = Math.round(
    receivablesRaw.reduce((t, r) => t + r.outstandingAmount, 0) * 100,
  ) / 100;
  const nonLiquidTotal = sumNonLiquid(ctx.accounts);
  const protectedGoalMoney = ctx.dashboard?.flexibleSpending.protectedGoalMoney ?? 0;

  // ── Margen Kipu: the user's REAL safe spending margin (Stage 6). ──────────
  // Reserve everything due before the next income (fixed, scheduled, debt,
  // essentials, savings, investment, goal) and spread the free remainder across
  // the cash-flow horizon. This — not liquid cash — drives weekly/daily coaching.
  // FX — prefer the (live-converted) budget categories over the lump scalar. The scalar
  // (essential_monthly_estimate) has no currency, so a foreign essential froze at its
  // write-time rate; the granular categories carry a currency and are re-valued live.
  // Categories present → use their live sum; lump-only users keep the scalar.
  // Stage D — budgets on DISCRETIONARY categories (shopping/entertainment/
  // travel/subscriptions) are gustos: they drain the Saldo tank when spent, so
  // reserving them as "essentials" too would count them twice against the user.
  const budgetEssentialSum = ctx.budgetCategories
    .filter((c) => c.isActive && !isDiscretionaryCategory(c.category))
    .reduce((total, c) => total + c.amount, 0);
  const essentialEstimate =
    budgetEssentialSum > 0 ? budgetEssentialSum : commitments.essentialMonthlyEstimate;
  // ── Stage D — daily GUSTOS aggregates for the Saldo tank. ────────────────────
  // A gusto = a real discretionary outflow (shopping/entertainment/travel/subs)
  // NOT linked to a declared fixed expense (those are already reserved in the
  // ritmo — draining them again would double-count). Food/transport are covered
  // by their monthly OBJECTIVE (Stage H): within the objective they never drain
  // here; the objective engine merges the excess/extraordinary drains below.
  // Refunds restore the tank as a negative drain on their day.
  // recentTxns ↔ classified are index-aligned (classifyForIntel maps 1:1).
  const gustosMap = new Map<string, number>();
  classified.forEach((c, i) => {
    const src = recentTxns[i];
    if (!src) return;
    const iso = localIso(src.occurredAtMs);
    const isInstallment = (src.externalRef ?? "").startsWith("installment:");
    if (c.spendingType === "refund" && src.baseAmount > 0) {
      // Only a refunded GUSTO restores the tank — refunds of essentials/fixed/
      // installment purchases never drained it, so crediting them would inflate it.
      if (!src.recurringExpenseId && !isInstallment && isDiscretionaryCategory(c.category)) {
        gustosMap.set(iso, (gustosMap.get(iso) ?? 0) - src.baseAmount);
      }
      return;
    }
    // A cuotas purchase costs the RITMO while the plan runs (Option A) — the
    // tank never drains it (that would charge the same decision twice).
    if (!c.isSpend || src.recurringExpenseId || isInstallment) return;
    if (c.spendingType === "discretionary" || c.spendingType === "recurring") {
      gustosMap.set(iso, (gustosMap.get(iso) ?? 0) + c.baseAmount);
    }
  });
  // Stage H — merge the objective engine's extra tank drains: the EXCESS past
  // a crossed food/transport objective (day by day) and confirmed EXTRAORDINARY
  // txns (full amount on their day); negatives are their refunds restoring.
  // Within-objective spend contributes nothing here — that money was already
  // reserved before the tank was filled (never both).
  for (const e of objectivesResult.extraDrainByDay) {
    gustosMap.set(e.dateISO, (gustosMap.get(e.dateISO) ?? 0) + e.amount);
  }
  const dailyGustos = Array.from(gustosMap.entries()).map(([dateISO, amount]) => ({ dateISO, amount }));
  // "Patrimonio" layer amount = SELLABLE value only (liquid assets — nobody
  // sells their home for an overspend; the full net worth lives on its own page).
  const investmentsTotalBase = goalsWealth.investments.reduce(
    (t, i) => t + (i.liquid ? Math.max(0, i.valueBase ?? 0) : 0),
    0,
  );
  // A 0%-rate NON-card facility (e.g. the founder's own company loan): deferring
  // there is cheaper than selling growing investments — agent guidance only.
  const zeroRateDebt = ctx.debtAccounts.find(
    (d) => d.type !== "credit_card" && d.interestRate === 0,
  );
  // Stage F (P0 fix) — scheduled payments live in their OWN currency; convert
  // ONCE into base with the user's known rates (same doctrine as the goal
  // contributions above) and feed EVERY engine from this list — the Margen, the
  // briefing calendar, the projection and the treasury must see the same money.
  // No known rate → excluded rather than counted at a fabricated 1:1.
  const scheduledBase = upcomingRaw.flatMap((p) => {
    const amt = p.amount ?? 0;
    if (!(amt > 0)) return [];
    const cur = String(p.currency ?? base).toUpperCase();
    const common = { id: p.id, name: p.name, dueDate: p.dueDate, category: p.category, paymentSourceType: p.paymentSourceType, paymentSourceId: p.paymentSourceId };
    if (cur === base.toUpperCase()) return [{ ...common, amountBase: amt }];
    const res = convertGoalFx(amt, cur, base, goalFxRates);
    return res.ok ? [{ ...common, amountBase: res.baseAmount }] : [];
  });
  // Stage G — cuotas (Option A): the active plans' monthly load is a TEMPORARY
  // fixed outflow (lowers the ritmo); per-card deferred money keeps this
  // month's statement estimate honest. Same figures for EVERY engine below.
  const installmentsMonthly = monthlyInstallmentLoad(installmentPlans, now);
  // Each card's pending-statement DUE DATE (amount-independent) lets the deferred
  // math keep a cuota out of a statement that closed before its first billing.
  const nextDueByCard = new Map<string, string | null>();
  if (installmentPlans.length) {
    for (const d of ctx.debtAccounts) {
      if (d.type === "credit_card") nextDueByCard.set(d.id, cardCyclePhaseFor(d, now).dueDateISO ?? null);
    }
  }
  const installmentsDeferred = deferredByCard(installmentPlans, now, nextDueByCard);
  const installmentsMonthlyByCard = monthlyLoadByCard(installmentPlans, now);
  const margenKipu = calculateMargenKipu({
    accounts: ctx.accounts,
    debtAccounts: ctx.debtAccounts,
    fixedExpenses: ctx.fixedExpenses,
    scheduledPayments: scheduledBase.map((p) => ({ amountBase: p.amountBase, dueDate: p.dueDate, name: p.name })),
    incomeSources: ctx.incomeSources,
    monthlyEssentialEstimate: essentialEstimate,
    weeklyGoalContribution,
    monthlySavingsCommitment: commitments.monthlySavings,
    monthlyInvestmentCommitment: commitments.monthlyInvestment,
    savingsPlans: savingsPlansForCalendar,
    baseCurrency: base,
    now,
    // Stage 32 — remaining-based two-phase burn (undefined ⇒ flat legacy burn).
    // Capacity stays monthly inside; only the day-by-day projection changes.
    remainingEssentialThisMonth,
    daysLeftInMonth,
    // Stage D — Saldo Kipu inputs (tank drain + layers + cost guidance).
    dailyGustos,
    investmentsTotalBase,
    zeroRateDebtName: zeroRateDebt?.name ?? null,
    timezone: engagement.timezone ?? undefined,
    monthlyInstallments: installmentsMonthly,
    installmentDeferredByCard: installmentsDeferred,
    installmentMonthlyByCard: installmentsMonthlyByCard,
  });
  const liquid = buildLiquidBreakdown(ctx.accounts);


  const cardsDueSoon = ctx.debtAccounts
    .filter((d) => d.currentBalanceBase > 0 && d.dueDay)
    .map((d) => ({
      name: d.name,
      inDays: daysUntilDueDay(d.dueDay as number, now),
      balance: d.currentBalanceBase,
    }))
    .filter((c) => c.inDays <= 7)
    .sort((a, b) => a.inDays - b.inDays);

  // Stage 14 — card/debt health (states, interest, next action), computed from
  // the same live truth so chat, ambient and dashboard agree.
  const debtHealth = buildDebtHealth({
    debtAccounts: ctx.debtAccounts,
    accounts: ctx.accounts,
    monthlyIncome: ctx.summary.estimatedMonthlyIncome,
    nowMs: now.getTime(),
    recentDebtPayments,
  });

  // Stage 18 — personalization: unify explicit prefs (philosophy/UX from the
  // personalization store; tone/detail from coach prefs; ambition/risk from goal
  // prefs) with cautious inferred behavior. Drives FRAMING/tone/surfaces and the
  // philosophy-derived allocation posture — never the money math or safety.
  const personalizationIntel = buildPersonalizationIntelligence({
    explicit: {
      financialPhilosophy: personalizationData.explicitPersonalization.financialPhilosophy,
      ambitionMode: goalsWealth.ambitionMode,
      riskTolerance: goalsWealth.riskTolerance,
      // Only a deliberately-set coach_preferences.tone counts as EXPLICIT. profiles.tone_preference
      // is force-defaulted to "playful", so passing it here would mislabel provenance and make
      // explain_personalization claim the user "fijó" a tone they never chose.
      communicationTone: ctx.coachPreferences?.tone ?? null,
      detailLevel: ctx.coachPreferences?.detailLevel,
      nudgeSensitivity: personalizationData.explicitPersonalization.nudgeSensitivity,
      dashboardDensity: personalizationData.explicitPersonalization.dashboardDensity,
      preferredCapture: personalizationData.explicitPersonalization.preferredCapture,
      onboardingMode: personalizationData.explicitPersonalization.onboardingMode,
    },
    lifeContext: personalizationData.lifeContext,
    captureEvents: personalizationData.captureEvents,
    nudgeEngagement: personalizationData.nudgeEngagement,
    correctionCount: personalizationData.correctionCount,
    hasHighDebtPressure: debtHealth.pressureLevel === "high" || debtHealth.pressureLevel === "critical",
    hasActiveGoals: goalsWealth.goals.some((g) => g.status === "active"),
    hasInvestments: goalsWealth.investments.length > 0,
    nowMs: now.getTime(),
  });

  // ── Stage 15 — forward-looking cashflow (the strengthened, timing-aware Margen
  // engine). Same reserved-commitment truth as Margen Kipu, projected day by day.
  const calendar = buildFinancialCalendar({
    accounts: ctx.accounts,
    incomeSources: ctx.incomeSources,
    fixedExpenses: ctx.fixedExpenses,
    scheduledPayments: scheduledBase.map((p) => ({ id: p.id, name: p.name, amount: p.amountBase, dueDate: p.dueDate, category: p.category, paymentSourceAccountId: p.paymentSourceType === "account" ? p.paymentSourceId : null })),
    debtAccounts: ctx.debtAccounts,
    mainGoal: ctx.mainGoal,
    weeklyGoalContribution,
    monthlySavingsCommitment: commitments.monthlySavings,
    monthlyInvestmentCommitment: commitments.monthlyInvestment,
    savingsPlans: savingsPlansForCalendar,
    now,
    // Stage 30 — model credit-card statements by billing cycle here too, so the
    // runway/risk projection agrees with Margen v2 and never double-counts a card
    // (a running balance that hasn't closed is future debt, not a reserve today).
    // Loans stay fixed-monthly. Horizon/protection semantics of the runway lens
    // are unchanged (this projects to the next income, not a forced full cycle).
    cardCycleAware: true,
    installmentDeferredByCard: installmentsDeferred,
  });
  // ── Stage F — Tesorería ("Dónde está tu plata"): per-account curves from the
  // SAME calendar, operational floors, ideal distribution and concrete moves.
  // Recommend-only: Kipu never moves money. Single-account users → module silent.
  // The Tesorería floors answer "where must each peso sit for its OWN dated
  // obligations", which spans the month — a different question from the Saldo's
  // "what's safe to spend until the next paycheck". So it walks its OWN 45-day
  // calendar (captures the next occurrence of every monthly obligation: cards,
  // rent, loans), never the runway's short days-to-next-income window.
  const treasuryCalendar = buildFinancialCalendar({
    accounts: ctx.accounts,
    incomeSources: ctx.incomeSources,
    fixedExpenses: ctx.fixedExpenses,
    scheduledPayments: scheduledBase.map((p) => ({ id: p.id, name: p.name, amount: p.amountBase, dueDate: p.dueDate, category: p.category, paymentSourceAccountId: p.paymentSourceType === "account" ? p.paymentSourceId : null })),
    debtAccounts: ctx.debtAccounts,
    mainGoal: ctx.mainGoal,
    weeklyGoalContribution,
    monthlySavingsCommitment: commitments.monthlySavings,
    monthlyInvestmentCommitment: commitments.monthlyInvestment,
    savingsPlans: savingsPlansForCalendar,
    now,
    horizonDays: 45,
    cardCycleAware: true,
    installmentDeferredByCard: installmentsDeferred,
  });
  const treasury: TreasurySnapshot = (() => {
    try {
      const liquidAccounts = ctx.accounts.filter((a) => !a.isGoalAccount && a.liquidity !== "non_liquid");
      if (liquidAccounts.length < 2) return emptyTreasury();
      const everydaySamples: EverydaySpendSample[] = [];
      classified.forEach((c, i) => {
        const src = recentTxns[i];
        if (!src || !c.isSpend || src.recurringExpenseId) return;
        everydaySamples.push({ sourceAccountId: src.sourceAccountId ?? null, baseAmount: c.baseAmount });
      });
      const accountShares = learnAccountShares(everydaySamples, liquidAccounts);
      return buildTreasury({
        accounts: ctx.accounts,
        calendar: treasuryCalendar,
        monthlyEssentialEstimate: essentialEstimate,
        accountShares,
        now,
      });
    } catch {
      return emptyTreasury();
    }
  })();
  // Urgent tier → the same TransferAlert contract the home/signals already speak.
  // Derived from the ACCOUNT STATE (missing = floor − balance), never from the
  // moves: an account short with nowhere to move from must STILL alert — that is
  // the worst state, not a silent one. Dateless (buffer-only) shortfalls sort last.
  const transferAlerts: TransferAlert[] = treasury.accounts
    .filter((a) => a.surplus < -5 && a.type !== "cash")
    .map((a) => {
      // Urge only the NEXT tranche (what's due next), not the whole cycle dumped
      // on the earliest deadline; keep the full shortfall as totalMissing.
      const urgent = a.shortfallSchedule[0];
      return {
        accountId: a.accountId,
        accountName: a.name,
        missing: urgent ? urgent.amount : Math.round(-a.surplus * 100) / 100,
        totalMissing: Math.round(-a.surplus * 100) / 100,
        needed: a.floor,
        byDateISO: (urgent ? urgent.byDateISO : a.firstShortfallDateISO) ?? "",
        obligations: urgent?.obligations.length ? urgent.obligations : a.nextObligations.length ? a.nextObligations : ["tus pagos del mes"],
      };
    })
    .sort((a, b) => (a.byDateISO || "9999").localeCompare(b.byDateISO || "9999"));
  // Payday moment = a SIGNIFICANT inflow (≥ 20% of the smallest declared income,
  // floor 20) in the last ~2 days — a friend repaying the dinner is not payday.
  const activeIncomes = ctx.incomeSources.filter((i) => i.status === "active" && !i.isOccasional && i.amount > 0);
  const paydayFloor = activeIncomes.length
    ? Math.max(20, 0.2 * Math.min(...activeIncomes.map((i) => i.amount)))
    : 50;
  const incomeLandedRecently = recentTxns.some(
    (t) => t.type === "income" && t.baseAmount >= paydayFloor && now.getTime() - t.occurredAtMs <= 2 * 86_400_000,
  );

  const patterns = detectSpendingPatterns(recentTxns, now.getTime());
  const reconciledAtMs = engagement.lastReconciledAt ? new Date(engagement.lastReconciledAt).getTime() : null;
  // Stage 16 — feed the cashflow a LEARNED everyday burn ONLY when the user has
  // no configured essential estimate (and only with non-low confidence: the
  // helper returns 0 otherwise). Strict improvement: today such users get a
  // zero burn and an over-optimistic safe spend; Margen Kipu stays untouched.
  const cashflowEssentialEstimate = essentialEstimate > 0 ? essentialEstimate : essentialBurnMonthly(baselines);
  const cashflowConfidence: CashflowConfidenceInput = {
    hasIncomeSource: ctx.incomeSources.some((s) => s.status === "active"),
    // Only "known" when the calendar anchored on a REAL pay date, not an assumed
    // day-1/Friday default — so an income source with no expected day lowers
    // confidence and makes Kipu ask for the pay date instead of faking certainty.
    incomeDateKnown: calendar.nextIncome !== null && calendar.nextIncome.confidence !== "low",
    balanceStale: reconciledAtMs === null || now.getTime() - reconciledAtMs > 14 * 86_400_000,
    hasFixedExpenses: ctx.fixedExpenses.some((f) => f.isActive),
    recentActivity: daysSinceLastActivity !== null && daysSinceLastActivity < 7,
    // Only TRUE when foreign money genuinely couldn't be converted (has an original
    // balance but no base value) — a positive base means the rate WAS applied. The old
    // `currentBalanceBase > 0` flagged every successfully-converted multi-currency user
    // (the core LatAm audience) as "sin tasa". Matches margen-kipu's hasUnconvertedForeign.
    foreignUnconverted: ctx.accounts.some(
      (a) => !a.isGoalAccount && a.currency !== base && a.currentBalanceOriginal > 0 && !(a.currentBalanceBase > 0),
    ),
    // When the everyday burn defaulted to 0 (no configured estimate AND thin spend
    // history), the projection can't discount daily spend — mark it so confidence
    // never reads "high" and `missing` says so. Honest, not a fabricated number.
    essentialBurnKnown: cashflowEssentialEstimate > 0,
  };
  const cashflowScenarioBase = { calendar, monthlyEssentialEstimate: cashflowEssentialEstimate, reserveFloor: 0, now, confidence: cashflowConfidence };
  // Stage 32 — the headline cashflow burns remaining-based (two-phase) for
  // budget users; the scenario base stays flat on purpose (what-if deltas are
  // internally consistent and the ScenarioBase contract is unchanged).
  const cashflow = projectCashflow({ ...cashflowScenarioBase, remainingEssentialThisMonth, daysLeftInMonth });

  // Stage 16 — the behavioral spending OS, built on the SAME live truth. Uses the
  // cashflow's timing-aware safe-spend so budgets/anomalies tie back to "today".
  const spendingIntel = buildSpendingIntelligence({
    classified,
    baselines,
    nowMs: now.getTime(),
    safeThisWeek: cashflow.safeThisWeek,
    existingFixedNames: ctx.fixedExpenses.map((f) => f.name),
  });

  // Stage 17 — the goals/wealth OS. Built on the SAME live truth: committed goal
  // contributions already reserved money above (single recarve scalar); here we
  // distribute the REMAINING free surplus (cashflow.safeThisWeek) across goals/
  // joy and surface the impulse-safe joy budget, net worth and wealth target.
  const highInterestCard = debtHealth.cards.find((c) => c.id === debtHealth.highestInterestCardId);
  const hasHighInterestDebt = !!highInterestCard && (highInterestCard.interestRatePct ?? 0) >= 30 && highInterestCard.balance > 0;
  // S34 — goals-wealth rows carry amounts in the GOAL's currency; every downstream
  // feasibility ratio (portfolio/plan) divides them by BASE-currency capacity. Re-
  // express into base with the user's known rates BEFORE intelligence — a goal
  // whose rate is unknown is excluded honestly (never compared at a fabricated
  // 1:1), same policy as the committed reserve above.
  const goalsForIntel = goalsWealth.goals.flatMap((g) => {
    const cur = String(g.currency ?? base).toUpperCase();
    if (cur === base.toUpperCase()) return [g];
    const target = convertGoalFx(g.targetAmount, cur, base, goalFxRates);
    if (!target.ok) return [];
    const current = convertGoalFx(g.currentAmount, cur, base, goalFxRates);
    const contribution =
      g.contributionAmount != null && g.contributionAmount > 0
        ? convertGoalFx(g.contributionAmount, cur, base, goalFxRates)
        : null;
    return [
      {
        ...g,
        currency: base,
        targetAmount: target.baseAmount,
        currentAmount: current.ok ? current.baseAmount : 0,
        contributionAmount: contribution && contribution.ok ? contribution.baseAmount : g.contributionAmount,
      },
    ];
  });
  const emergencyGoalReserve = ctx.mainGoal && ctx.mainGoal.archetype === "emergency" ? ctx.mainGoal.currentAmount : goalsForIntel.filter((g) => g.archetype === "emergency").reduce((s, g) => s + g.currentAmount, 0);
  const goalsIntel = buildGoalsIntelligence({
    goals: goalsForIntel,
    estimatedMonthlyIncome: ctx.summary.estimatedMonthlyIncome,
    estimatedMonthlyFixedExpenses: ctx.summary.estimatedMonthlyFixedExpenses ?? essentialEstimate,
    monthlyDebtDue: debtHealth.totalMinimums,
    monthlyInstallments: installmentsMonthly,
    flexibleSpending: ctx.dashboard?.flexibleSpending.flexibleSpending ?? Math.max(0, margenKipu.margenWeekly),
    debtPressureLevel: snapshot.debtPressureLevel,
    baseCurrency: base,
    // Fix #2 — goal capacity must subtract the SAME everyday essential burn the
    // cashflow uses, so "vas bien" and a tight cashflow can't contradict. When the
    // burn is unknown (0), the goal plan flags the capacity as preliminary.
    essentialMonthlyEstimate: cashflowEssentialEstimate,
    essentialsKnown: essentialEstimate > 0 || baselines.confidence !== "low",
    safeThisWeek: cashflow.safeThisWeek,
    liquidAccountsBase: liquid.liquidTotal,
    // Stage 31 (5.4a) — GUARDADA account money counts in net worth (never liquid).
    nonLiquidAccountsBase: nonLiquidTotal,
    totalDebtBase: debtHealth.totalDebt,
    hasHighInterestDebt,
    investments: goalsWealth.investments,
    wealthTarget: goalsWealth.wealthTarget ?? null,
    monthlyInvestmentContribution: goalsWealth.monthlyInvestmentContribution,
    // Stage 18 — the allocation posture (joy floor) honors the user's life
    // philosophy when they haven't set an explicit ambition (experiences → keep
    // more joy; wealth → push). Money math + minimums are unchanged.
    ambitionMode: personalizationIntel.effectiveAmbition,
    emergencyReserveTarget: goalsWealth.emergencyReserveTarget,
    currentReserve: emergencyGoalReserve,
    nowMs: now.getTime(),
  });

  // Signals, most important first. Margin = Margen Kipu (not liquid cash).
  const signals: CoachingSignal[] = [];
  const margin = margenKipu.margenWeekly;
  const dailySuggested = margenKipu.margenDaily;
  const daysRemainingInWeek = margenKipu.daysRemainingInWeek;
  if (margenKipu.status === "negative") {
    // Name the REAL hole: projection-negative → the trough shortfall (what the
    // coming days are short); flow-negative → the weekly pace, labeled as such.
    const troughShortfall = Math.abs(Math.min(0, cashflow.lowestProjectedBalance));
    signals.push({
      kind: "margin_negative",
      severity: "urgent",
      text:
        troughShortfall > 0.5
          ? `A tus próximos días les faltan ${money(troughShortfall, base)} para cubrir lo comprometido.`
          : `Tu ritmo va ${money(Math.abs(margin), base)} a la semana por encima de lo seguro.`,
    });
  } else if (margenKipu.status === "tight") {
    signals.push({
      kind: "margin_tight",
      severity: "watch",
      text: `Tu Saldo Kipu está bajo (${money(margenKipu.saldo.saldo, base)}); se recarga ${money(margenKipu.saldo.fillDaily, base)} al día.`,
    });
  }
  // Stage D — Tesorería: an obligation's funding account is short → concrete move.
  for (const ta of transferAlerts.slice(0, 2)) {
    signals.push({
      kind: "transfer_needed",
      severity: "urgent",
      text: `En ${ta.accountName} te faltan ${money(ta.missing, base)} para cubrir ${ta.obligations.join(" + ")}${ta.byDateISO ? ` (antes del ${formatDateEs(ta.byDateISO)})` : " — cuanto antes"}. Moverla a tiempo te evita el rebote.`,
    });
  }
  for (const c of cardsDueSoon) {
    signals.push({
      kind: "card_due_soon",
      severity: c.inDays <= 3 ? "urgent" : "watch",
      text: `${c.name} vence en ${c.inDays} día(s) (deuda ${money(c.balance, base)}).`,
    });
  }
  // Stage 14 debt-protection signals (cautious: ASK, never accuse). Cards in
  // cardsDueSoon are already covered above, so we only add the new conditions.
  for (const card of debtHealth.cards) {
    if (card.state === "overdue") {
      signals.push({ kind: "card_overdue", severity: "urgent", text: `${card.name}: la fecha de pago pasó y no veo un pago. ¿Ya la pagaste o la dejamos lista?` });
    } else if (card.state === "needs_payment_confirmation") {
      signals.push({ kind: "card_payment_confirm", severity: "watch", text: `${card.name}: ¿ya la pagaste? Su fecha pasó hace poco y no me consta.` });
    }
  }
  if (debtHealth.highestInterestCardId) {
    const hi = debtHealth.cards.find((c) => c.id === debtHealth.highestInterestCardId);
    // F5 — surface the interest COST for ANY carried balance with a rate (not only
    // ≥30%): show the estimated $/mes it would bleed. It stays OUT of the free-spend
    // Margen (debt cost, not spending) — this is a coaching nudge; the debt page shows
    // the per-card number. Severity scales with the rate so 17% informs without alarming.
    if (hi && hi.state !== "overdue" && hi.state !== "needs_payment_confirmation" && (hi.interestRatePct ?? 0) > 0 && hi.balance > 0) {
      const cost = hi.estMonthlyInterest != null && hi.estMonthlyInterest > 0 ? ` (~${Math.round(hi.estMonthlyInterest)}$/mes de interés si arrastras ese saldo)` : "";
      signals.push({ kind: "high_interest_debt", severity: (hi.interestRatePct ?? 0) >= 30 ? "watch" : "info", text: `${hi.name}: tasa ~${hi.interestRatePct}%/año${cost}. Pagarla completa evita ese costo.` });
    }
  }
  if (debtHealth.pressureLevel === "high" || debtHealth.pressureLevel === "critical") {
    signals.push({ kind: "debt_pressure_high", severity: debtHealth.pressureLevel === "critical" ? "urgent" : "watch", text: `Tu deuda está presionando tu flujo (nivel ${debtHealth.pressureLevel}).` });
  }
  for (const p of upcomingPayments.slice(0, 2)) {
    const dueSoon = (new Date(`${p.dueDate}T23:59:59`).getTime() - now.getTime()) / 86_400_000;
    // Only genuinely UPCOMING payments — a past-due date is not "lo que viene".
    if (dueSoon >= 0 && dueSoon <= 7) {
      signals.push({
        kind: "payment_scheduled_soon",
        severity: "watch",
        text: `${p.name}${p.amount ? ` (${money(p.amount, base)})` : ""} el ${formatDateEs(p.dueDate)}.`,
      });
    }
  }
  if (ctx.mainGoal && ctx.dashboard?.goalFeasibility.status === "at_risk") {
    signals.push({
      kind: "goal_at_risk",
      severity: "watch",
      text: `${ctx.mainGoal.name} viene apretada con el ritmo actual.`,
    });
  }
  if (receivablesOutstanding > 0) {
    signals.push({
      kind: "receivable_outstanding",
      severity: "info",
      text: `Te deben ${money(receivablesOutstanding, base)} en total.`,
    });
  }
  if (daysSinceLastActivity !== null && daysSinceLastActivity >= 4) {
    signals.push({
      kind: "inactivity",
      severity: "watch",
      text: `Sin registrar nada hace ${daysSinceLastActivity} días — toca retomar sin culpa.`,
    });
  }
  // Weekend → a good moment to reconcile the week.
  const dow = now.getDay();
  if ((dow === 0 || dow === 6) && daysSinceLastActivity !== null) {
    signals.push({
      kind: "reconcile_due",
      severity: "info",
      text: "Buen momento para cuadrar la semana.",
    });
  }
  // S5 — budget refine nudge, now ALSO in-app / in-chat (before it lived only in the
  // Telegram ambient loop, which needs Telegram linked). SAME shared rule as the
  // ambient topic. Low priority (a gentle "info", placed after the actionable
  // signals). SUGGEST-ONLY: the change happens only if the user says yes
  // (update_budget_category); Kipu never edits the budget by itself.
  // Stage H — the objective doctrine in chat: crossing warns (excess drains the
  // tank from here on), the pre-cliff pace signal fires BEFORE the cliff so the
  // day-~22 drop never feels like a bug. Same numbers as digest/home/ambient.
  for (const st of objectivesResult.states) {
    if (st.crossed) {
      signals.push({
        kind: "objective_crossed",
        severity: "watch",
        text: `${st.labelEs}: cruzaste tu objetivo del mes (${money(st.objectiveBase, base)}) — llevas ${money(st.spentMTD, base)}. Desde aquí, lo que gastes en ${st.labelEs.toLowerCase()} sale de tu Saldo (${money(st.excessDrainedMTD, base)} hasta hoy). Sin drama: era tu plan y lo estás viendo a tiempo.`,
      });
    } else if (st.projectedCrossDateISO) {
      signals.push({
        kind: "objective_pace",
        severity: "info",
        text: `${st.labelEs}: llevas ${money(st.spentMTD, base)} de tu objetivo de ${money(st.objectiveBase, base)} — a este ritmo lo cruzas el ${Number(st.projectedCrossDateISO.slice(8, 10))}. Si lo cruzas, solo el exceso sale de tu Saldo.`,
      });
    }
  }
  // Stage H — food/transport objectives are a USER DECISION: the refine nudge
  // ("¿ajusto el estimado a lo real?") never fires for them — the monthly close
  // is their refine moment (report + keep/change/wait, always the user's call).
  const budgetRefine = budgetProgress.hasBudgets
    ? computeBudgetRefineSuggestions({
        budgetItems: budgetProgress.items
          .filter((i) => !(objectivesResult.hasObjectives && isObjectiveCategory(i.category)))
          .map((i) => ({ category: i.category, labelEs: i.labelEs, budgetMonthly: i.budgetMonthly })),
        learnedByCategory: baselines.categories.map((c) => ({ category: c.category, monthlyAvg: c.monthlyAvg, confidence: c.confidence })),
        overallConfidence: baselines.confidence,
      })[0]
    : undefined;
  if (budgetRefine) {
    const dir = budgetRefine.direction === "over" ? "más" : "menos";
    signals.push({
      kind: "budget_refine",
      severity: "info",
      text: `${budgetRefine.labelEs}: gastas ~${money(budgetRefine.learnedMonthly, base)}/mes (${dir} que los ${money(budgetRefine.budgetMonthly, base)} de tu presupuesto). ¿Ajusto el estimado a lo real?`,
    });
  }
  if (signals.length === 0) {
    signals.push({
      kind: "all_good",
      severity: "positive",
      text: "Vas en orden esta semana.",
    });
  }

  const metrics: WellnessMetrics = (() => {
    const debtPressure = scoreDebtPressure(snapshot.debtPressureLevel);
    const spendingFlexibility = scoreFlexibility(margin, dailySuggested);
    const goalMomentum = scoreGoalMomentum(ctx);
    const budgetReality = scoreBudgetReality(ctx);
    const financialAccuracy = scoreAccuracy(ctx, daysSinceLastActivity);
    const financialReadiness = clamp(
      spendingFlexibility * 0.3 +
        debtPressure * 0.25 +
        goalMomentum * 0.2 +
        financialAccuracy * 0.15 +
        budgetReality * 0.1,
    );
    return {
      financialReadiness,
      goalMomentum,
      debtPressure,
      spendingFlexibility,
      financialAccuracy,
      budgetReality,
    };
  })();

  // Nudge continuity: a signal mentioned within the cooldown is "recently
  // mentioned" and must not be repeated unless it's decision-relevant.
  const COOLDOWN_MS = 3 * 3_600_000;
  const recentlyMentioned = signals
    .filter((s) => {
      const last = nudgeLog.get(s.kind);
      return last !== undefined && now.getTime() - last < COOLDOWN_MS;
    })
    .map((s) => s.kind);

  // Lead with the most important signal NOT mentioned recently (this rotates
  // nudges so Kipu doesn't repeat itself). Skip the neutral "all_good". When
  // paused, don't push proactively at all.
  const pushAllowed = engagement.mode !== "paused";
  const candidate = signals.find(
    (s) => s.kind !== "all_good" && !recentlyMentioned.includes(s.kind),
  );
  const leadSignal = pushAllowed ? candidate ?? null : null;
  if (leadSignal && surfaceNudges) {
    void recordNudgeSurfaced(userId, leadSignal.kind);
  }

  const nextBestAction = nextActionFor(leadSignal ?? signals[0]);

  // Stage 20 — honest day-over-day trend. Compare the LIVE headline metrics to the
  // most recent snapshot from a PREVIOUS day; write today's snapshot (idempotent per
  // day) so tomorrow has a prior. Graceful: pre-migration → empty trend, never fake.
  const liveSnapshot: SnapshotMetrics = {
    margenWeekly: margin,
    // Fix #3 — safe_weekly must hold a WEEKLY figure (trend.ts labels it "lo que
    // puedes gastar a la semana"). It previously stored margenDaily (a daily value)
    // under a weekly name, making trends ~7× off. Store the real weekly margin.
    safeWeekly: margenKipu.margenWeekly,
    netWorth: goalsIntel.netWorth?.totalNetWorth ?? 0,
    totalDebt: debtHealth.totalDebt,
    readiness: metrics.financialReadiness,
  };
  const priorSnapshot = await loadPriorSnapshot(userId, now.getTime()).catch(() => null);
  const trend = buildSnapshotTrend(liveSnapshot, priorSnapshot);
  await writeDailySnapshot(userId, liveSnapshot, base, now.getTime(), margenKipu.saldo.saldo).catch(() => {});

  // ── Confidence contract — enrich Margen Kipu with the signals only the builder
  // has: real essentials knowledge (configured estimate / active budgets / enough
  // spend history), data age, and thin-history (no prior snapshot). Never
  // fake-lower the number; flag it honestly so the UI/chat can offer an action.
  const { countPendingOccurrences } = await import("@/lib/financial/recurring-occurrences-store");
  const unconfirmedRecurringCount = await countPendingOccurrences(userId).catch(() => 0);
  enrichMargenConfidence({
    margenKipu,
    essentialConfigured: essentialEstimate > 0,
    baselinesConfidence: baselines.confidence,
    daysSinceLastActivity,
    hasActiveIncome: ctx.incomeSources.some((s) => s.status === "active" && s.amount > 0),
    incomeDateKnown: cashflowConfidence.incomeDateKnown,
    foreignUnconverted: cashflowConfidence.foreignUnconverted,
    hasPriorSnapshot: priorSnapshot !== null,
    unconfirmedRecurringCount,
  });

  const digest = buildDigest({
    base,
    margin,
    daily: dailySuggested,
    daysRemainingInWeek,
    margenKipu,
    transferAlerts,
    treasury,
    installmentPlans,
    cashflow,
    liquid,
    daysSinceLastActivity,
    nonLiquidTotal,
    receivablesOutstanding,
    protectedGoalMoney,
    leadSignal,
    recentlyMentioned,
    engagementMode: engagement.mode,
    metrics,
    nextBestAction,
    budgetLine: [budgetProgressDigestLine(budgetProgress, base), objectivesDigestLine(objectivesResult, base)].filter(Boolean).join("\n"),
    spendingDigest: spendingIntel.digest,
    goalsDigest: goalsIntel.digest,
    personalizationDigest: personalizationIntel.digest,
    householdDigest: householdIntel.digest,
    trendDigest: trend.digest,
  });

  return {
    baseCurrency: base,
    weeklyMargin: margin,
    dailySuggested,
    daysRemainingInWeek,
    margenKipu,
    liquid,
    daysSinceLastActivity,
    upcomingPayments,
    receivablesOutstanding,
    nonLiquidTotal,
    protectedGoalMoney,
    cardsDueSoon,
    transferAlerts,
    treasury,
    incomeLandedRecently,
    installmentPlans,
    debtHealth,
    cashflow,
    cashflowScenarioBase,
    patterns,
    spendingIntel,
    budgetProgress,
    objectives: objectivesResult,
    goalsIntel,
    personalization: personalizationIntel,
    household: householdIntel,
    trend,
    signals,
    leadSignal,
    recentlyMentioned,
    engagementMode: engagement.mode,
    nextBestAction,
    metrics,
    digest,
  };
}

function nextActionFor(signal: CoachingSignal): string {
  switch (signal.kind) {
    case "margin_negative":
      return "Esta semana iría suave con lo no esencial hasta que reinicie el lunes.";
    case "margin_tight":
      return "Dejar que el Saldo se recargue un par de días antes del próximo gusto.";
    case "transfer_needed":
      return "Mover la plata a la cuenta que paga lo que viene, antes de la fecha.";
    case "card_due_soon":
      return "Tener lista la fecha de pago de la tarjeta para no pagar interés.";
    case "payment_scheduled_soon":
      return "Recordar el pago que viene para que no tome por sorpresa.";
    case "goal_at_risk":
      return "Revisar la meta: ajustar plazo o aporte para volver a encaminarla.";
    case "receivable_outstanding":
      return "Tener presente lo que te deben; no cuenta como dinero disponible aún.";
    case "inactivity":
      return "Retomar con uno o dos gastos recientes, sin presión por reconstruir todo.";
    case "reconcile_due":
      return "Cuadrar la semana en 10 segundos confirmando que los saldos están bien.";
    case "card_overdue":
    case "card_payment_confirm":
      return "Confirmar si esa tarjeta ya está pagada para no arrastrar interés ni mora.";
    case "high_interest_debt":
      return "Mirar esa tarjeta de tasa alta: abonar más que el mínimo ahí ahorra interés.";
    case "debt_pressure_high":
      return "Ordenar los pagos de deuda antes de acelerar otras metas.";
    default:
      return "Seguir así; vas bien.";
  }
}

function buildDigest(input: {
  base: string;
  margin: number;
  daily: number;
  daysRemainingInWeek: number;
  margenKipu: MargenKipuResult;
  transferAlerts: TransferAlert[];
  treasury: TreasurySnapshot;
  installmentPlans: InstallmentPlanRecord[];
  cashflow: CashflowProjection;
  liquid: LiquidBreakdown;
  daysSinceLastActivity: number | null;
  nonLiquidTotal: number;
  receivablesOutstanding: number;
  protectedGoalMoney: number;
  leadSignal: CoachingSignal | null;
  recentlyMentioned: string[];
  engagementMode: EngagementMode;
  metrics: WellnessMetrics;
  nextBestAction: string;
  // Stage 32 — ONE compact budget-progress line ("" when the user has no budgets).
  budgetLine: string;
  spendingDigest: string;
  goalsDigest: string;
  personalizationDigest: string;
  householdDigest: string;
  trendDigest: string;
}): string {
  const base = input.base;
  const mk = input.margenKipu;
  const cf = input.cashflow;

  // The HEADLINE (Stage D): the SALDO KIPU — an accumulating balance, not a rate.
  // ONE simple truth: what they can spend on gustos RIGHT NOW, how fast it
  // refills, whether they reach their next income (runway) and the single thing
  // to watch. Communicate THIS, not the breakdown.
  const cfRunway = cf.runwayOk
    ? "Llega a su próximo ingreso sin quedarse corto."
    : `OJO: la proyección baja a ${money(cf.lowestProjectedBalance, base)} el ${cf.lowestDateISO} antes del ingreso — esos días están apretados; sugiere frenar lo no esencial, sin regañar.`;
  const cfRisk = cf.riskWindows.length ? ` Lo único a cuidar: ${cf.riskWindows.map((w) => `${w.label} (${w.dateISO})`).join(" y ")}.` : "";
  const cfConf =
    cf.confidence === "low"
      ? ` CONFIANZA BAJA${cf.missing[0] ? ` (${cf.missing[0]})` : ""}: dilo en una frase y, si ayuda, pide UNA sola cosa para afinar; no finjas certeza.`
      : cf.confidence === "medium"
        ? " (confianza media)"
        : "";
  // ONE number across the whole product: this saldo is the SAME figure the /app
  // hero shows. Runway/risk color still comes from the cashflow projection.
  const s = mk.saldo;
  const runwayLine =
    s.mode === "runway"
      ? ` MODO RUNWAY: no hay ingreso activo — la pregunta útil cambia a "¿cuánto me dura?": su plata cubre ~${s.runwayDays ?? "?"} días al ritmo actual de gastos. Acompaña sin alarmar; la Reserva ahora es el combustible (di \"Reserva\", nunca \"colchón\").`
      : "";
  const marginLine = `SALDO KIPU (el héroe del producto — un SALDO acumulable para gustos, NO una tasa diaria; el MISMO número del dashboard): AHORA tiene ${money(s.saldo, base)} para gustos; se recarga ~${money(s.fillDaily, base)}/día hasta un tope de ${money(s.cap, base)} (≈10 días). Hoy se recargó ${money(s.todayFill, base)} y lleva gastado ${money(s.todaySpent, base)} de su Saldo (gustos y, si cruzó su objetivo de comida/transporte, el exceso). Su Reserva (protegida, APARTE del saldo, nunca gastable en silencio) es ${money(s.reserva, base)}. ${cfRunway}${cfRisk}${cfConf}${runwayLine} Cuando pregunte "cuánto puedo gastar / me alcanza para X", compara contra el SALDO (${money(s.saldo, base)}): si X entra, dilo simple con lo que le quedaría; si NO entra, di de qué capa saldría (Reserva → aportes del mes → vender inversión → deuda) y AVISA SIEMPRE al cruzar de capa — sin bloquear ni juzgar. NO recites el desglose salvo que lo pida. Es el MISMO Saldo Kipu en dashboard y chat; no inventes otro concepto.${s.zeroRateDebtName ? ` Nota de costo: ${s.zeroRateDebtName} está al 0% — diferir/pedir ahí es MÁS barato que vender una inversión que crece; úsalo al ordenar opciones.` : ""}`;
  const transferLine = input.transferAlerts.length
    ? `MUEVE PLATA (recomendar-solo — Kipu nunca mueve dinero): ${input.transferAlerts
        .map((t) => `en ${t.accountName} te faltan ${money(t.missing, base)} para ${t.obligations.join(" + ")}${t.byDateISO ? ` antes del ${formatDateEs(t.byDateISO)}` : " (cuanto antes)"}${t.totalMissing > t.missing + 0.5 ? ` (de ${money(t.totalMissing, base)} en total este ciclo; el resto vence después — o muévelo todo de una vez)` : ""}`)
        .join("; ")}. Sugiérelo claro y una sola vez; la plata que requiere un movimiento manual NO se cuenta como cubierta hasta que el usuario confirme.`
    : "";
  const ip = input.installmentPlans.filter((p2) => installmentProgress(p2, new Date()).remaining > 0);
  const ipLine = ip.length
    ? ` CUOTAS ACTIVAS (LatAm installments): ${ip
        .map((p2) => {
          const pr = installmentProgress(p2, new Date());
          return `${p2.description}: cuota ${Math.min(pr.billed + 1, p2.monthsTotal)} de ${p2.monthsTotal} (${money(p2.installmentBase, base)}/mes, quedan ${pr.remaining})`;
        })
        .join("; ")}. Su carga mensual total (${money(ip.reduce((t2, p2) => t2 + installmentProgress(p2, new Date()).monthlyLoadBase, 0), base)}) YA está descontada del ritmo — no la restes de nuevo. Si registra una compra en cuotas usa create_installment_plan (NUNCA un gasto normal: drenaría el Saldo completo); al crearla dile cómo queda su recarga diaria (la tool te da antes → después). Y si un resumen de tarjeta trae la línea de una de ESTAS cuotas (p. ej. "TELE 3/12"), NO la registres como gasto nuevo: ya vive dentro de la deuda de la tarjeta y el pago del resumen la cubre.`
    : "";
  const tr = input.treasury;
  const treasuryLine = tr.accounts.length >= 2
    ? ` DÓNDE ESTÁ TU PLATA (Tesorería, recomendar-solo): cada cuenta tiene un PISO operativo (lo que la cuenta necesita para sus pagos + colchoncito): ${tr.accounts
        .map((a) => `${a.name} tiene ${money(a.balance, base)} y necesita ${money(a.floor, base)}${a.surplus < 0 ? ` (TE FALTAN ${money(Math.abs(a.surplus), base)})` : ""}`)
        .join("; ")}. Su plata libre (Saldo+Reserva físicamente) vive: ${tr.layerHomes.length ? tr.layerHomes.map((h) => `${money(h.amount, base)} en ${h.name}`).join(", ") : "sin sobrantes hoy"}.${tr.moves.length ? ` Movimientos recomendados: ${tr.moves.map((m) => `${money(m.amount, base)} de ${m.fromName} a ${m.toName}${m.byDateISO ? ` antes del ${formatDateEs(m.byDateISO)}` : ""}`).join("; ")}.` : ""} Si pregunta "¿dónde está mi plata?" o quiere sacar de la Reserva hacia una cuenta, usa el tool plan_reserve_withdrawal para darle los movimientos exactos; NUNCA muevas dinero tú ni des por movida una transferencia sin confirmación del usuario.${tr.shareConfidence === "none" || tr.shareConfidence === "low" || tr.accounts.some((a) => a.hasAssumedEvents) ? " (La atribución por cuenta aún tiene supuestos — algún pago no tiene cuenta declarada o el día a día aún se está aprendiendo: si el usuario corrige, recuérdalo.)" : ""}`
    : "";

  // Confidence contract — how solid the safe-spend number is. Never fake-lower it;
  // when it's preliminary/estimated, present it as such and offer a small action.
  const margenConfLine =
    mk.confidence === "preliminary"
      ? `CONFIANZA DEL SALDO: PRELIMINAR — es un estimado, no un número firme. Preséntalo así (ej. "va por ~X, pero es preliminar") y ofrece UNA acción para afinarlo. Falta: ${mk.marginGaps.map((g) => g.label).join("; ") || "más datos"}.`
      : mk.confidence === "estimated"
        ? `CONFIANZA DEL SALDO: ESTIMADO — bastante confiable, con algún supuesto${mk.marginGaps.length ? ` (${mk.marginGaps.map((g) => g.label).join("; ")})` : ""}. Menciónalo solo si el usuario decide algo apretado; no lo repitas por defecto.`
        : "";

  // Why it's lower than the bank balance — ONLY when the user asks.
  const r = mk.breakdown;
  const reserved: string[] = [];
  if (r.reservedFixed > 0) reserved.push(`gastos fijos ${money(r.reservedFixed, base)}`);
  if (r.reservedScheduled > 0) reserved.push(`pagos programados ${money(r.reservedScheduled, base)}`);
  if (r.reservedDebt > 0) reserved.push(`pagos de tarjeta/deuda ${money(r.reservedDebt, base)}`);
  // Stage 32 — label the essential reserve honestly: with budget categories the
  // projection reserves only what REMAINS of this month (+ next month's days at
  // full rate), never the full month again on top of money already spent.
  if (r.reservedEssentials > 0)
    reserved.push(
      input.cashflow.remainingBasedEssentials
        ? `tu gasto normal — lo que queda de este mes: ${money(r.reservedEssentials, base)}`
        : `tu gasto normal del mes ${money(r.reservedEssentials, base)}`,
    );
  if (r.reservedSavings > 0) reserved.push(`ahorro ${money(r.reservedSavings, base)}`);
  if (r.reservedInvestment > 0) reserved.push(`inversión ${money(r.reservedInvestment, base)}`);
  if (r.reservedGoal > 0) reserved.push(`meta ${money(r.reservedGoal, base)}`);
  const horizonNote = mk.nextIncomeDate
    ? `hasta tu próximo ingreso (~${mk.nextIncomeDate})`
    : `por el resto del periodo (~${mk.horizonDays} días)`;
  const whyLine =
    reserved.length > 0
      ? `Por qué el Saldo Kipu es menor que su plata líquida (usar SOLO si pregunta): de ${money(mk.liquidCash, base)} líquidos, aparté ${money(r.totalReserved, base)} ${horizonNote} para ${reserved.join(", ")}.`
      : "";

  // Exact liquid totals — the agent must use THESE, never sum balances itself.
  const liquidLines = input.liquid.lines
    .map((l) => `${l.name} ${money(l.balance, base)}`)
    .join(", ");
  const liquidLine = `LIQUIDEZ EXACTA (usa estos totales tal cual, NUNCA los sumes tú): total líquido ${money(input.liquid.liquidTotal, base)} = [${liquidLines}]. Banco ${money(input.liquid.bankTotal, base)}, efectivo ${money(input.liquid.cashTotal, base)}, billeteras ${money(input.liquid.walletTotal, base)}. Si el usuario dice "banco", compara contra el total de banco; el efectivo va aparte.`;

  // Money that exists but is NOT spendable now — mention SEPARATELY, never como
  // Margen Kipu.
  const apart: string[] = [];
  if (input.receivablesOutstanding > 0)
    apart.push(`te deben ${money(input.receivablesOutstanding, base)}`);
  if (input.nonLiquidTotal > 0)
    apart.push(`tienes ${money(input.nonLiquidTotal, base)} en ahorro/inversión no líquida`);
  if (input.protectedGoalMoney > 0)
    apart.push(`${money(input.protectedGoalMoney, base)} protegidos para tu meta`);
  const apartLine = apart.length
    ? `Dinero que NO es Saldo Kipu (menciónalo aparte solo si ayuda, nunca como gastable): ${apart.join("; ")}.`
    : "";

  const lead = input.leadSignal
    ? `Señal para mencionar HOY (como mucho una, breve, natural): ${input.leadSignal.text}`
    : "Nada nuevo que valga la pena resaltar proactivamente este turno.";
  const recent = input.recentlyMentioned.length
    ? `Ya mencionado hace poco — NO lo repitas salvo que el usuario esté por decidir algo que dependa de eso, y si lo repites dilo distinto: ${input.recentlyMentioned.join(", ")}.`
    : "";
  const pause =
    input.engagementMode === "paused"
      ? "MODO PAUSA: no empujes recordatorios ni señales; solo responde lo que pregunte."
      : input.engagementMode === "light"
        ? "MODO LIGERO: sé mínimo y suave, sin insistir."
        : "";

  const m = input.metrics;
  return [
    marginLine,
    transferLine,
    treasuryLine,
    ipLine,
    margenConfLine,
    whyLine,
    liquidLine,
    apartLine,
    input.budgetLine,
    `Actividad: ${input.daysSinceLastActivity === null ? "sin movimientos aún" : `último registro hace ${input.daysSinceLastActivity} día(s)`}.`,
    lead,
    recent,
    pause,
    `Mejor próximo paso: ${input.nextBestAction}`,
    `Bienestar (0-100, traduce a lenguaje humano, no muestres números crudos salvo que pregunten): Readiness ${m.financialReadiness}, Meta ${m.goalMomentum}, Deuda ${m.debtPressure}, Flexibilidad ${m.spendingFlexibility}, Precisión ${m.financialAccuracy}, Realidad ${m.budgetReality}.`,
    input.spendingDigest,
    input.goalsDigest,
    input.personalizationDigest,
    input.householdDigest,
    input.trendDigest,
  ]
    .filter(Boolean)
    .join("\n");
}
