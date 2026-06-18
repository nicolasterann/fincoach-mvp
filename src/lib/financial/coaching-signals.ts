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
import {
  buildLiquidBreakdown,
  sumNonLiquid,
  type LiquidBreakdown,
} from "@/lib/financial/liquidity";
import {
  calculateMargenKipu,
  type MargenKipuResult,
} from "@/lib/financial/margen-kipu";
import { buildDebtHealth, type DebtHealthReport } from "@/lib/financial/debt-health";
import { buildFinancialCalendar } from "@/lib/financial/financial-calendar";
import { projectCashflow, type CashflowConfidenceInput, type CashflowProjection } from "@/lib/financial/cashflow-projection";
import { detectSpendingPatterns, type PatternTxn, type SpendingPatterns } from "@/lib/financial/spending-patterns";
import type { ScenarioBase } from "@/lib/financial/cashflow-scenario";
import { buildCategoryBaselines } from "@/lib/financial/category-baselines";
import { classifyForIntel, toIntelTxn, buildSpendingIntelligence, essentialBurnMonthly, type SpendingIntelligence } from "@/lib/financial/spending-intelligence";
import { loadMerchantMemory } from "@/lib/financial/merchant-memory-store";
import { loadGoalsWealthData, type GoalsWealthData } from "@/lib/financial/goals-wealth-store";
import { cadenceToWeekly } from "@/lib/financial/goal-portfolio";
import { buildGoalsIntelligence, type GoalsIntelligence } from "@/lib/financial/goals-intelligence";
import { loadPersonalizationData, type PersonalizationData } from "@/lib/financial/personalization-store";
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
      .select("occurred_at, base_amount, type, category, description")
      .eq("user_id", userId)
      .gte("occurred_at", sinceISO)
      .order("occurred_at", { ascending: false })
      .limit(400);
    return (data ?? []).map((r) => ({
      occurredAtMs: new Date(r.occurred_at as string).getTime(),
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

  const [upcomingRaw, receivablesRaw, daysSinceLastActivity, nudgeLog, engagement, commitments, recentDebtPayments, recentTxns, merchantMemory, goalsWealth, personalizationData] =
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
    ]);

  // Stage 17 — the goal reserve fed to Margen/cashflow is the SUM of COMMITTED
  // per-goal contributions (active + cashflow-protected), the zero-sum recarve.
  // When no goal has a committed contribution (e.g. pre-migration / single legacy
  // goal), fall back to the existing planned figure so behavior is unchanged.
  const committedGoalReserveWeekly =
    Math.round(
      goalsWealth.goals
        .filter((g) => g.status === "active" && g.cashflowProtected !== false)
        .reduce((sum, g) => sum + cadenceToWeekly(g.contributionAmount ?? 0, g.cadence), 0) * 100,
    ) / 100;
  const legacyGoalContribution = input.ctx.dashboard?.flexibleSpending.plannedGoalContribution ?? 0;
  const weeklyGoalContribution = committedGoalReserveWeekly > 0 ? committedGoalReserveWeekly : legacyGoalContribution;

  // Stage 16 — classify every recent txn (no double counting) and learn the
  // user's per-category "normal". Merchant memory (user corrections) wins first.
  const classified = classifyForIntel(recentTxns.map(toIntelTxn), merchantMemory);
  const baselines = buildCategoryBaselines(classified, now.getTime());

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
  const essentialEstimate =
    commitments.essentialMonthlyEstimate > 0
      ? commitments.essentialMonthlyEstimate
      : ctx.budgetCategories
          .filter((c) => c.isActive)
          .reduce((total, c) => total + c.amount, 0);
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
    baseCurrency: base,
    now,
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
    now,
  });
  const patterns = detectSpendingPatterns(recentTxns, now.getTime());
  const reconciledAtMs = engagement.lastReconciledAt ? new Date(engagement.lastReconciledAt).getTime() : null;
  const cashflowConfidence: CashflowConfidenceInput = {
    hasIncomeSource: ctx.incomeSources.some((s) => s.status === "active"),
    // Only "known" when the calendar anchored on a REAL pay date, not an assumed
    // day-1/Friday default — so an income source with no expected day lowers
    // confidence and makes Kipu ask for the pay date instead of faking certainty.
    incomeDateKnown: calendar.nextIncome !== null && calendar.nextIncome.confidence !== "low",
    balanceStale: reconciledAtMs === null || now.getTime() - reconciledAtMs > 14 * 86_400_000,
    hasFixedExpenses: ctx.fixedExpenses.some((f) => f.isActive),
    recentActivity: daysSinceLastActivity !== null && daysSinceLastActivity < 7,
    foreignUnconverted: ctx.accounts.some((a) => !a.isGoalAccount && a.currency !== base && a.currentBalanceBase > 0),
  };
  // Stage 16 — feed the cashflow a LEARNED everyday burn ONLY when the user has
  // no configured essential estimate (and only with non-low confidence: the
  // helper returns 0 otherwise). Strict improvement: today such users get a
  // zero burn and an over-optimistic safe spend; Margen Kipu stays untouched.
  const cashflowEssentialEstimate = essentialEstimate > 0 ? essentialEstimate : essentialBurnMonthly(baselines);
  const cashflowScenarioBase = { calendar, monthlyEssentialEstimate: cashflowEssentialEstimate, reserveFloor: 0, now, confidence: cashflowConfidence };
  const cashflow = projectCashflow(cashflowScenarioBase);

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
  const emergencyGoalReserve = ctx.mainGoal && ctx.mainGoal.archetype === "emergency" ? ctx.mainGoal.currentAmount : goalsWealth.goals.filter((g) => g.archetype === "emergency").reduce((s, g) => s + g.currentAmount, 0);
  const goalsIntel = buildGoalsIntelligence({
    goals: goalsWealth.goals,
    estimatedMonthlyIncome: ctx.summary.estimatedMonthlyIncome,
    estimatedMonthlyFixedExpenses: ctx.summary.estimatedMonthlyFixedExpenses ?? essentialEstimate,
    monthlyDebtDue: debtHealth.totalMinimums,
    flexibleSpending: ctx.dashboard?.flexibleSpending.flexibleSpending ?? Math.max(0, margenKipu.margenWeekly),
    debtPressureLevel: snapshot.debtPressureLevel,
    baseCurrency: base,
    safeThisWeek: cashflow.safeThisWeek,
    liquidAccountsBase: liquid.liquidTotal,
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
    if (hi && hi.state !== "overdue" && hi.state !== "needs_payment_confirmation" && (hi.interestRatePct ?? 0) >= 30 && hi.balance > 0) {
      signals.push({ kind: "high_interest_debt", severity: "watch", text: `${hi.name} tiene tasa alta (~${hi.interestRatePct}%/año); si arrastras saldo, el interés pesa.` });
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
    spendingDigest: spendingIntel.digest,
    goalsDigest: goalsIntel.digest,
    personalizationDigest: personalizationIntel.digest,
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
    goalsIntel,
    personalization: personalizationIntel,
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
  spendingDigest: string;
  goalsDigest: string;
  personalizationDigest: string;
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
  const marginLine = `MARGEN KIPU (proyectado, timing-aware — lo que puede gastar TRANQUILO ya descontado todo lo necesario): HOY hasta ${money(cf.safeToday, base)}; esta SEMANA ${money(cf.safeThisWeek, base)}. ${cfRunway}${cfRisk}${cfConf} Cuando pregunte "cuánto puedo gastar / llego a fin de mes / qué cuido", responde SIMPLE con esto (hoy, semana, una cosa a cuidar); NO recites el desglose ni cinco números salvo que lo pida. Es el MISMO Margen Kipu, no inventes otro concepto.`;

  // Why it's lower than the bank balance — ONLY when the user asks.
  const r = mk.breakdown;
  const reserved: string[] = [];
  if (r.reservedFixed > 0) reserved.push(`gastos fijos ${money(r.reservedFixed, base)}`);
  if (r.reservedScheduled > 0) reserved.push(`pagos programados ${money(r.reservedScheduled, base)}`);
  if (r.reservedDebt > 0) reserved.push(`pagos de tarjeta/deuda ${money(r.reservedDebt, base)}`);
  if (r.reservedEssentials > 0) reserved.push(`gastos esenciales ${money(r.reservedEssentials, base)}`);
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
    whyLine,
    liquidLine,
    apartLine,
    `Actividad: ${input.daysSinceLastActivity === null ? "sin movimientos aún" : `último registro hace ${input.daysSinceLastActivity} día(s)`}.`,
    lead,
    recent,
    pause,
    `Mejor próximo paso: ${input.nextBestAction}`,
    `Bienestar (0-100, traduce a lenguaje humano, no muestres números crudos salvo que pregunten): Readiness ${m.financialReadiness}, Meta ${m.goalMomentum}, Deuda ${m.debtPressure}, Flexibilidad ${m.spendingFlexibility}, Precisión ${m.financialAccuracy}, Realidad ${m.budgetReality}.`,
    input.spendingDigest,
    input.goalsDigest,
    input.personalizationDigest,
  ]
    .filter(Boolean)
    .join("\n");
}
