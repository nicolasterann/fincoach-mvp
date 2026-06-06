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

  const [upcomingRaw, receivablesRaw, daysSinceLastActivity, nudgeLog, engagement, commitments] =
    await Promise.all([
      loadUpcomingScheduledPayments(userId).catch(() => []),
      loadOpenReceivables(userId).catch(() => []),
      loadDaysSinceLastActivity(userId),
      loadNudgeLog(userId),
      loadEngagement(userId),
      loadMargenCommitments(userId),
    ]);

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
    weeklyGoalContribution: ctx.dashboard?.flexibleSpending.plannedGoalContribution ?? 0,
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
}): string {
  const base = input.base;
  const mk = input.margenKipu;

  // The HEADLINE. Margen Kipu = safe-to-spend this week, after reserving
  // everything necessary. Communicate THIS simple number, not the breakdown.
  const marginLine =
    input.margin >= 0
      ? `MARGEN KIPU de esta semana (lo que puede gastar TRANQUILO, ya descontado todo lo necesario): ${money(input.margin, base)} (~${money(Math.round(input.daily), base)}/día, ${input.daysRemainingInWeek} días hasta el domingo). Comunica SOLO este número simple; NO recites el desglose salvo que pregunte.`
      : `MARGEN KIPU negativo: la semana ya va ${money(Math.abs(input.margin), base)} pasada de lo seguro (${input.daysRemainingInWeek} días hasta el domingo). Sugiere frenar lo no esencial, sin regañar.`;

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
  ]
    .filter(Boolean)
    .join("\n");
}
