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

export interface CoachingSignal {
  kind:
    | "margin_negative"
    | "margin_tight"
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
  // Thin history is a SOFT gap (drives "estimated", never "preliminary" on its own):
  // no prior snapshot yet → we can't compare against a real yesterday.
  const hasSoftHistoryGap = !x.hasPriorSnapshot;

  const preliminary = !essentialsKnown || !x.hasActiveIncome || stale;
  const hasSoftGap =
    gaps.some((g) => g.code === "no_income_date" || g.code === "unconverted_currency" || g.code === "card_confirm") || hasSoftHistoryGap;
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
    const { data } = await supabase
      .from("transactions")
      .select("id, occurred_at, base_amount, type, category, description, related_transaction_id")
      .eq("user_id", userId)
      .gte("occurred_at", sinceISO)
      .order("occurred_at", { ascending: false })
      .limit(400);
    const rows = (data ?? []) as { id: string; occurred_at: string; base_amount: number | string; type: string; category?: string | null; description?: string | null; related_transaction_id?: string | null }[];
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

  const [upcomingRaw, receivablesRaw, daysSinceLastActivity, nudgeLog, engagement, commitments, recentDebtPayments, recentTxns, merchantMemory, goalsWealth, personalizationData, savingsPlansRaw] =
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

  // Stage 32 — "Presupuesto vivo": seed-aware calendar-month budget progress.
  // The 40-day txn window above always covers the whole current month, so the
  // month-to-date spend here is complete. ONE truth: the digest line, the
  // spending page and the remaining-based projection burn below all read THIS.
  const budgetProgress = computeBudgetProgress({
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
  const budgetEssentialSum = ctx.budgetCategories
    .filter((c) => c.isActive)
    .reduce((total, c) => total + c.amount, 0);
  const essentialEstimate =
    budgetEssentialSum > 0 ? budgetEssentialSum : commitments.essentialMonthlyEstimate;
  const margenKipu = calculateMargenKipu({
    accounts: ctx.accounts,
    debtAccounts: ctx.debtAccounts,
    fixedExpenses: ctx.fixedExpenses,
    scheduledPayments: upcomingRaw.map((p) => ({
      amountBase: p.amount ?? 0,
      dueDate: p.dueDate,
    })),
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
    scheduledPayments: upcomingRaw.map((p) => ({ id: p.id, name: p.name, amount: p.amount, dueDate: p.dueDate, category: p.category })),
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
  });
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
    signals.push({
      kind: "margin_negative",
      severity: "urgent",
      text: `Vas ${money(Math.abs(margin), base)} sobre lo seguro hasta tu próximo ingreso.`,
    });
  } else if (margenKipu.status === "tight") {
    signals.push({
      kind: "margin_tight",
      severity: "watch",
      text: `Queda poco Margen Kipu esta semana (${money(margin, base)}).`,
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
    const dueSoon = (new Date(`${p.dueDate}T00:00:00`).getTime() - now.getTime()) / 86_400_000;
    if (dueSoon <= 7) {
      signals.push({
        kind: "payment_scheduled_soon",
        severity: "watch",
        text: `${p.name}${p.amount ? ` (${money(p.amount, base)})` : ""} el ${p.dueDate}.`,
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
  const budgetRefine = budgetProgress.hasBudgets
    ? computeBudgetRefineSuggestions({
        budgetItems: budgetProgress.items.map((i) => ({ category: i.category, labelEs: i.labelEs, budgetMonthly: i.budgetMonthly })),
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

  const nextBestAction = nextActionFor(
    leadSignal ?? signals[0],
    base,
    margin,
    dailySuggested,
  );

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
  await writeDailySnapshot(userId, liveSnapshot, base, now.getTime()).catch(() => {});

  // ── Confidence contract — enrich Margen Kipu with the signals only the builder
  // has: real essentials knowledge (configured estimate / active budgets / enough
  // spend history), data age, and thin-history (no prior snapshot). Never
  // fake-lower the number; flag it honestly so the UI/chat can offer an action.
  enrichMargenConfidence({
    margenKipu,
    essentialConfigured: essentialEstimate > 0,
    baselinesConfidence: baselines.confidence,
    daysSinceLastActivity,
    hasActiveIncome: ctx.incomeSources.some((s) => s.status === "active" && s.amount > 0),
    incomeDateKnown: cashflowConfidence.incomeDateKnown,
    foreignUnconverted: cashflowConfidence.foreignUnconverted,
    hasPriorSnapshot: priorSnapshot !== null,
  });

  const digest = buildDigest({
    base,
    margin,
    daily: dailySuggested,
    daysRemainingInWeek,
    margenKipu,
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
    budgetLine: budgetProgressDigestLine(budgetProgress, base),
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
    debtHealth,
    cashflow,
    cashflowScenarioBase,
    patterns,
    spendingIntel,
    budgetProgress,
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

function nextActionFor(
  signal: CoachingSignal,
  base: string,
  margin: number,
  daily: number,
): string {
  switch (signal.kind) {
    case "margin_negative":
      return "Esta semana iría suave con lo no esencial hasta que reinicie el lunes.";
    case "margin_tight":
      return `Cuidar el ritmo: cerca de ${money(Math.max(daily, 0), base)} por día deja la semana tranquila.`;
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

  // The HEADLINE (Stage 15): Margen Kipu, projected and timing-aware. ONE simple
  // truth — what's safe TODAY and THIS WEEK, whether they reach their next income
  // (runway) and the single thing to watch. Communicate THIS, not the breakdown.
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
  // ONE number across the whole product: these HOY/SEMANA figures are the SAME
  // margenKipu the /app hero shows (never the timing-aware cashflow figure, which
  // can exceed liquid cash by counting income not yet received — quoting that as
  // "Margen Kipu" made chat and dashboard disagree). Runway/risk color still
  // comes from the cashflow projection.
  const marginLine = `MARGEN KIPU (lo que puede gastar TRANQUILO ya descontado todo lo necesario — el MISMO número del dashboard): HOY hasta ${money(mk.margenDaily, base)}; esta SEMANA ${money(mk.margenWeekly, base)}. ${cfRunway}${cfRisk}${cfConf} Cuando pregunte "cuánto puedo gastar / llego a fin de mes / qué cuido", responde SIMPLE con esto (hoy, semana, una cosa a cuidar); NO recites el desglose ni cinco números salvo que lo pida. Es el MISMO Margen Kipu, no inventes otro concepto.`;

  // Confidence contract — how solid the safe-spend number is. Never fake-lower it;
  // when it's preliminary/estimated, present it as such and offer a small action.
  const margenConfLine =
    mk.confidence === "preliminary"
      ? `CONFIANZA DEL MARGEN: PRELIMINAR — es un estimado, no un número firme. Preséntalo así (ej. "va por ~X, pero es preliminar") y ofrece UNA acción para afinarlo. Falta: ${mk.marginGaps.map((g) => g.label).join("; ") || "más datos"}.`
      : mk.confidence === "estimated"
        ? `CONFIANZA DEL MARGEN: ESTIMADO — bastante confiable, con algún supuesto${mk.marginGaps.length ? ` (${mk.marginGaps.map((g) => g.label).join("; ")})` : ""}. Menciónalo solo si el usuario decide algo apretado; no lo repitas por defecto.`
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
      ? `Por qué el Margen Kipu es menor que tu saldo (usar SOLO si pregunta): de ${money(mk.liquidCash, base)} líquidos, aparté ${money(r.totalReserved, base)} ${horizonNote} para ${reserved.join(", ")}.`
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
    ? `Dinero que NO es Margen Kipu (menciónalo aparte solo si ayuda, nunca como gastable): ${apart.join("; ")}.`
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
