import type { CoachingBriefing } from "@/lib/financial/coaching-signals";
import type { EngagementMode } from "@/lib/financial/coach-state-store";
import type { CardHealthState } from "@/lib/financial/debt-health";
import { freshnessWantsNudge, type FreshnessResult } from "@/lib/financial/freshness";

// Stage 13 — the ambient nudge DECISION layer. DETERMINISTIC: it decides whether
// a proactive Telegram check-in is worth sending right now, which ONE topic, and
// why — applying eligibility, preferences, quiet hours, frequency, cooldowns,
// recency and "is there anything actually useful to say". It returns STRUCTURED
// facts for the AI to phrase; it never writes the user-facing copy and never
// exposes its internal labels. Pure + unit-tested in the build gate.

export type AmbientTopic =
  | "card_due_soon"
  | "payment_scheduled_soon"
  | "margin_negative"
  | "margin_tight"
  | "needs_reconciliation"
  | "needs_completion"
  | "inactivity"
  | "goal_at_risk"
  | "freshness_check"
  // Stage 14 — card/debt protection topics (derived from briefing.debtHealth).
  | "card_due_today"
  | "card_overdue"
  | "payment_confirmation"
  | "minimum_payment_warning"
  | "high_interest_debt"
  | "debt_pressure"
  | "statement_stale"
  // Stage 15 — cashflow autopilot (derived from briefing.cashflow).
  | "runway_risk"
  | "payments_cluster"
  | "low_daily_spend"
  | "confirm_balance"
  | "safe_week"
  // Stage 16 — behavioral spending OS (derived from briefing.spendingIntel).
  // Deliberately few & quiet: money-safety first, then graded behavior nudges.
  | "duplicate_charge"
  | "unusual_transaction"
  | "spending_spike"
  | "subscription_detected"
  | "pattern_changed"
  // Stage 17 — goals/wealth OS (derived from briefing.goalsIntel). Positive &
  // motivating: celebrate wins, keep goals alive, flag conflicts gently.
  | "mini_goal_ready"
  | "goal_milestone"
  | "goal_off_track"
  | "allocation_opportunity"
  | "too_many_goals";

export interface AmbientPrefs {
  ambientEnabled: boolean;
  mode: EngagementMode; // normal | light | paused
  pausedUntilMs: number | null;
  timezone: string | null;
  quietHoursStart: number | null; // local hour 0-23 inclusive
  quietHoursEnd: number | null; // local hour 0-23 exclusive
  frequency: "auto" | "daily" | "weekly" | "off";
  nudgeWeekdays: number[] | null; // 0=Sun..6=Sat
  maxNudgesPerDay: number;
}

export interface AmbientDecisionInput {
  telegramLinked: boolean;
  prefs: AmbientPrefs;
  freshness: FreshnessResult;
  briefing: CoachingBriefing;
  idleHours: number | null; // since the user last interacted (any channel)
  nudgeLog: Map<string, number>; // topic → last surfaced (ms epoch)
  sentToday: number; // ambient nudges already sent in this local day
  nowMs: number;
  localHour: number; // 0-23 in the user's timezone
  localWeekday: number; // 0=Sun..6=Sat in the user's timezone
  // Stage 18 — personalization: when the user's nudge sensitivity is high, only
  // candidates at/above this priority may fire (on top of all Stage 13 limits).
  // Optional; absent ⇒ no extra suppression (unchanged behavior).
  suppressBelowPriority?: number;
}

export interface AmbientNudge {
  topic: AmbientTopic;
  priority: number; // higher = more urgent
  reason: string; // internal/audit, never shown to the user
  facts: string; // compact factual context for the AI to phrase (no ids/jargon)
}

export type AmbientDecision =
  | { send: true; nudge: AmbientNudge }
  | { send: false; skipReason: string };

// Don't nudge within this many hours of the user's last interaction — let a
// conversation breathe; ambient is for when they've gone quiet.
const MIN_IDLE_HOURS = 18;
// Per-topic cooldown (days): don't repeat the same ask too soon.
const TOPIC_COOLDOWN_DAYS: Record<AmbientTopic, number> = {
  card_due_soon: 1,
  payment_scheduled_soon: 2,
  margin_negative: 1,
  margin_tight: 2,
  needs_reconciliation: 3,
  needs_completion: 4,
  inactivity: 2,
  goal_at_risk: 7,
  freshness_check: 3,
  card_due_today: 1,
  card_overdue: 1,
  payment_confirmation: 2,
  minimum_payment_warning: 5,
  high_interest_debt: 10,
  debt_pressure: 5,
  statement_stale: 7,
  runway_risk: 2,
  payments_cluster: 3,
  low_daily_spend: 3,
  confirm_balance: 4,
  safe_week: 6,
  duplicate_charge: 3,
  unusual_transaction: 4,
  spending_spike: 3,
  subscription_detected: 10,
  pattern_changed: 14,
  mini_goal_ready: 1,
  goal_milestone: 7,
  goal_off_track: 5,
  allocation_opportunity: 7,
  too_many_goals: 10,
};
// In "light" mode only the genuinely urgent topics may fire.
const LIGHT_MODE_TOPICS = new Set<AmbientTopic>([
  "card_due_soon",
  "payment_scheduled_soon",
  "margin_negative",
  "card_due_today",
  "card_overdue",
  "payment_confirmation",
  "runway_risk",
  // A possible double charge is money-safety, not a behavior nudge → light mode OK.
  "duplicate_charge",
  // A mini-goal becoming ready is a celebration the user opted into → light mode OK.
  "mini_goal_ready",
]);

// Stage 18 — obligation / debt-protection / cashflow-safety / fraud nudges that
// personalization (nudge sensitivity) must NEVER suppress. "Personalization may
// change which nudge is selected, never the protection of obligations." The
// suppressBelowPriority floor is bypassed for these regardless of its value.
const PERSONALIZATION_PROTECTED_TOPICS = new Set<AmbientTopic>([
  "card_overdue",
  "card_due_today",
  "card_due_soon",
  "payment_confirmation",
  "margin_negative",
  "payment_scheduled_soon",
  "runway_risk",
  "debt_pressure",
  "minimum_payment_warning",
  "high_interest_debt",
  "duplicate_charge",
]);

const DAY_MS = 86_400_000;

function money(value: number, currency: string): string {
  const r = Math.round((value + Number.EPSILON) * 100) / 100;
  const whole = Math.abs(r - Math.round(r)) < 0.005;
  const t = whole ? String(Math.round(r)) : r.toFixed(2);
  return currency === "USD" ? `${t}$` : `${t} ${currency}`;
}

function inQuietHours(hour: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null) return false;
  if (start === end) return false;
  // Window may wrap midnight (e.g. 22→7).
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

// Build the candidate topics (most urgent first) from the briefing + freshness.
function candidates(input: AmbientDecisionInput): AmbientNudge[] {
  const b = input.briefing;
  const base = b.baseCurrency;
  const out: AmbientNudge[] = [];

  // Stage 14 — card/debt protection candidates from the shared health model.
  const dh = b.debtHealth;
  const firstWith = (s: CardHealthState) => dh.cards.find((c) => c.states.includes(s));
  const overdue = firstWith("overdue");
  if (overdue) {
    out.push({
      topic: "card_overdue",
      priority: 98,
      reason: `overdue ${overdue.name}`,
      facts: `La fecha de pago de "${overdue.name}" pasó hace ${overdue.daysSinceDue} día(s) y NO me consta un pago (deuda ${money(overdue.balance, base)}). Pregunta con tacto si ya la pagó o quiere dejarla lista; NO afirmes que está vencida, puede que ya la haya pagado.`,
    });
  }
  const dueToday = firstWith("due_today");
  if (dueToday) {
    out.push({
      topic: "card_due_today",
      priority: 96,
      reason: `due today ${dueToday.name}`,
      facts: `La tarjeta "${dueToday.name}" vence HOY (deuda ${money(dueToday.balance, base)}${dueToday.fullPaymentDue ? `, pago del mes ${money(dueToday.fullPaymentDue, base)}` : ""}). Recuérdaselo suave y pregunta si quiere dejarla lista.`,
    });
  }
  const confirm = firstWith("needs_payment_confirmation");
  if (confirm) {
    out.push({
      topic: "payment_confirmation",
      priority: 92,
      reason: `confirm ${confirm.name}`,
      facts: `La fecha de pago de "${confirm.name}" pasó hace poco y no me consta el pago. Pregunta natural: ¿ya la pagaste? Si sí, ofrécele registrarlo; cero regaño.`,
    });
  }
  // card_due_soon stays sourced from cardsDueSoon (same underlying debts as
  // debtHealth, but a stable existing field) so due-in-≤7-days still nudges.
  const card = b.cardsDueSoon[0];
  if (card && card.inDays > 0) {
    out.push({
      topic: "card_due_soon",
      priority: 95 - card.inDays,
      reason: `due soon ${card.name}`,
      facts: `La tarjeta "${card.name}" vence en ${card.inDays} día(s) (deuda ${money(card.balance, base)}). Pregunta natural si ya la pagó o quiere dejarlo listo; no des por hecho.`,
    });
  }
  if (b.margenKipu.status === "negative") {
    out.push({
      topic: "margin_negative",
      priority: 90,
      reason: "margin negative",
      facts: `El Margen Kipu de esta semana está negativo (${money(Math.abs(b.weeklyMargin), base)} pasado de lo seguro). Sin culpa: sugiere frenar lo no esencial hasta el próximo ingreso.`,
    });
  }
  const pay = b.upcomingPayments[0];
  if (pay) {
    out.push({
      topic: "payment_scheduled_soon",
      priority: 80,
      reason: `payment ${pay.name} soon`,
      facts: `Viene el pago "${pay.name}"${pay.amount ? ` de ${money(pay.amount, base)}` : ""} el ${pay.dueDate}. Recuérdaselo suave para que no lo tome por sorpresa.`,
    });
  }
  // Stage 15 — cashflow autopilot candidates (timing-aware, from the projection).
  const cf = b.cashflow;
  if (!cf.runwayOk && cf.confidence !== "low") {
    out.push({
      topic: "runway_risk",
      priority: 82,
      reason: `runway dip ${cf.lowestDateISO}`,
      facts: `Por cómo caen tus pagos, cerca del ${cf.lowestDateISO} el saldo bajaría a ${money(cf.lowestProjectedBalance, base)} antes de tu próximo ingreso${cf.riskWindows[0] ? ` (pesa ${cf.riskWindows[0].label})` : ""}. Avísale con calma para mover o cuidar algo esos días; sin alarmar ni culpa.`,
    });
  }
  if (cf.runwayOk && cf.liquidCash > 0 && cf.riskWindows.length >= 2) {
    out.push({
      topic: "payments_cluster",
      priority: 52,
      reason: "payments cluster",
      facts: `Vienen varios pagos juntos (${cf.riskWindows.map((r) => r.label).join(" y ")}). Recuérdaselo para que no lo tome por sorpresa; tono tranquilo.`,
    });
  }
  if (cf.runwayOk && cf.status === "tight" && cf.liquidCash > 0 && cf.confidence !== "low") {
    out.push({
      topic: "low_daily_spend",
      priority: 44,
      reason: "tight week",
      facts: `Esta semana el margen viene justo: ~${money(cf.safeToday, base)}/día, ${money(cf.safeThisWeek, base)} en la semana. Un comentario corto para cuidar el ritmo, sin alarmar.`,
    });
  }
  if (cf.confidence === "low" && cf.liquidCash > 0 && cf.missing.some((m) => m.includes("saldo"))) {
    out.push({
      topic: "confirm_balance",
      priority: 38,
      reason: "stale balance",
      facts: `Hace un rato no confirmamos tu saldo, así que el "cuánto puedes gastar" puede estar desviado. Pídele confirmar su saldo principal para darle un número confiable; UNA sola cosa.`,
    });
  }
  if (cf.runwayOk && cf.status === "healthy" && cf.confidence === "high" && cf.safeThisWeek > 0 && cf.liquidCash > 0) {
    out.push({
      topic: "safe_week",
      priority: 12,
      reason: "all safe",
      facts: `Va tranquilo: esta semana puede gastar ~${money(cf.safeThisWeek, base)} sin apuros y llega bien a su ingreso. Un mensaje BREVE y positivo, sin sonar a felicitación vacía. Solo si de verdad aporta.`,
    });
  }
  if (input.freshness.state === "needs_reconciliation") {
    out.push({
      topic: "needs_reconciliation",
      priority: 60,
      reason: "balances stale",
      facts: `Los saldos pueden estar desactualizados (${input.freshness.reasons.join("; ")}). Antes de darle un margen confiable, pregunta si su saldo principal sigue parecido o quiere actualizarlo. Una sola cosa.`,
    });
  }
  if (input.freshness.state === "needs_completion") {
    out.push({
      topic: "needs_completion",
      priority: 55,
      reason: "missing recurring context",
      facts: `Falta contexto para aconsejar bien (${input.freshness.reasons.join("; ")}). Pregunta UNA cosa útil para completarlo (su ingreso o un gasto fijo), sin abrumar.`,
    });
  }
  if (b.margenKipu.status === "tight") {
    out.push({
      topic: "margin_tight",
      priority: 50,
      reason: "margin tight",
      facts: `El Margen Kipu de la semana viene justo (${money(b.weeklyMargin, base)}, ~${money(b.dailySuggested, base)}/día). Un comentario corto para cuidar el ritmo, sin alarmar.`,
    });
  }
  if (input.freshness.state === "stale" && b.daysSinceLastActivity !== null) {
    out.push({
      topic: "inactivity",
      priority: 45,
      reason: `idle ${b.daysSinceLastActivity}d`,
      facts: `No registra nada hace ${b.daysSinceLastActivity} días. Dale la bienvenida sin regañar y ofrece retomar con un par de gastos; nada de culpa.`,
    });
  }
  if (b.signals.some((s) => s.kind === "goal_at_risk")) {
    out.push({
      topic: "goal_at_risk",
      priority: 35,
      reason: "goal at risk",
      facts: `La meta viene apretada con el ritmo actual. Ofrece revisar plazo o aporte, sin presión.`,
    });
  }
  if (dh.pressureLevel === "critical" || dh.pressureLevel === "high") {
    out.push({
      topic: "debt_pressure",
      priority: dh.pressureLevel === "critical" ? 70 : 48,
      reason: `debt pressure ${dh.pressureLevel}`,
      facts: `La deuda viene presionando el flujo (nivel ${dh.pressureLevel}; total ${money(dh.totalDebt, base)}). Sin alarmar ni culpa, ofrece ordenar los pagos antes de acelerar otras metas.`,
    });
  }
  const revolving = firstWith("revolving_risk");
  if (revolving) {
    out.push({
      topic: "minimum_payment_warning",
      priority: 55,
      reason: `revolving ${revolving.name}`,
      facts: `En "${revolving.name}" vienes pagando menos del total y el interés corre${revolving.estMonthlyInterest ? ` (~${money(revolving.estMonthlyInterest, base)}/mes ESTIMADO)` : ""}. Explica suave que abonar más que el mínimo ahí ahorra; deja claro que es estimado.`,
    });
  }
  if (dh.highestInterestCardId) {
    const hi = dh.cards.find((c) => c.id === dh.highestInterestCardId);
    if (hi && hi.states.includes("high_interest_risk") && !hi.states.includes("overdue") && !hi.states.includes("needs_payment_confirmation") && !hi.states.includes("revolving_risk")) {
      out.push({
        topic: "high_interest_debt",
        priority: 40,
        reason: `high interest ${hi.name}`,
        facts: `"${hi.name}" tiene la tasa más alta (~${hi.interestRatePct}%/año) y arrastra saldo (${money(hi.balance, base)}). Si puede, abonar extra ahí rinde más que en otras deudas; tono tranquilo, es estimado.`,
      });
    }
  }
  const staleCard = firstWith("stale_statement");
  if (staleCard) {
    out.push({
      topic: "statement_stale",
      priority: 30,
      reason: `stale statement ${staleCard.name}`,
      facts: `El último estado de "${staleCard.name}" tiene ${staleCard.statementAgeDays} días; sus datos pueden estar viejos. Pregunta si quiere subir el más reciente para tener fecha y pago al día.`,
    });
  }
  if (input.freshness.state === "slightly_stale") {
    out.push({
      topic: "freshness_check",
      priority: 20,
      reason: "slightly stale check-in",
      facts: `Pasó un tiempo desde la última vez (${input.freshness.stalestDays ?? "varios"} días). Un check-in MUY corto y casual de "¿cambió algo que quieras cargar?". Solo si de verdad ayuda.`,
    });
  }

  // Stage 16 — behavioral spending OS candidates (quiet, graded; never noisy).
  const si = b.spendingIntel;
  const dup = si.anomalies.anomalies.find((a) => a.kind === "duplicate_suspected");
  if (dup) {
    out.push({
      topic: "duplicate_charge",
      priority: 78,
      reason: `dup ${dup.merchantFamily}`,
      facts: `Vi dos cargos parecidos de ${dup.merchantFamily} (~${money(dup.amount, base)} cada uno) en pocos días. Pregúntale natural si fueron dos compras distintas o quedó uno repetido; SIN alarmar y SIN afirmar que le cobraron de más.`,
    });
  }
  const notable = si.anomalies.anomalies.find((a) => a.kind !== "duplicate_suspected" && a.severity === "notable");
  if (notable) {
    out.push({
      topic: "unusual_transaction",
      priority: 42,
      reason: `anomaly ${notable.kind}`,
      facts: `${notable.note} Coméntaselo SIN alarmar, solo para que lo tenga en el radar; una vez.`,
    });
  }
  const over = si.budget.overCategories[0];
  if (over && over.confidence !== "low") {
    const adj = si.budget.oneAdjustment;
    out.push({
      topic: "spending_spike",
      priority: 40,
      reason: `spike ${over.parentCategory}`,
      facts: `${over.parentCategory} va ~${Math.round(over.pctVsNormal * 100)}% arriba de tu normal esta semana (proyecta ${money(over.projectedThisWeek, base)} vs ${money(over.normalWeekly, base)}).${adj ? ` Con ajustar ~${money(adj.saving, base)} vuelve a su ritmo.` : ""} Sin culpa: ofrécelo como control, no como reto.`,
    });
  }
  const sub = si.subscriptions.subscriptions.find((s) => s.suggestConvert);
  if (sub) {
    const cadence = sub.cadence === "weekly" ? "semana" : sub.cadence === "biweekly" ? "quincena" : sub.cadence === "annual" ? "año" : "mes";
    out.push({
      topic: "subscription_detected",
      priority: 33,
      reason: `sub ${sub.merchantFamily}`,
      facts: `Detecté un cobro recurrente que no tienes como gasto fijo: ${sub.merchantFamily} ~${money(sub.amount, base)} cada ${cadence}${sub.nextChargeISO ? ` (próximo ~${sub.nextChargeISO})` : ""}. Pregúntale si quiere que lo trate como fijo para que no lo sorprenda; NO lo crees solo.`,
    });
  }
  const trend = si.baselines.categories.find((c) => c.isControllable && c.trend === "rising" && c.confidence === "high");
  if (trend) {
    out.push({
      topic: "pattern_changed",
      priority: 16,
      reason: `trend ${trend.parentCategory}`,
      facts: `${trend.parentCategory} viene subiendo respecto a tu normal últimamente (~${money(trend.weeklyAvg, base)}/sem). Aún no es problema; un comentario corto de que lo estás siguiendo. Solo si aporta.`,
    });
  }

  // Stage 17 — goals/wealth candidates (positive & motivating; non-spammy).
  const gi = b.goalsIntel;
  const ready = gi.portfolio.goals.find((g) => g.progressPct >= 100 && (g.goalType === "mini" || g.goal.archetype === "purchase"));
  if (ready) {
    out.push({
      topic: "mini_goal_ready",
      priority: 60,
      reason: `mini ready ${ready.goal.name}`,
      facts: `El usuario ya juntó lo de "${ready.goal.name}" sin tocar su tarjeta ni su meta principal. Reconoce el logro con calma y dile que puede comprarlo tranquilo. Tono: satisfacción genuina, breve, nada infantil ni de marketing.`,
    });
  }
  const primary = gi.portfolio.primary;
  if (primary && (primary.plan.status === "at_risk" || primary.plan.status === "not_realistic")) {
    out.push({
      topic: "goal_off_track",
      priority: 34,
      reason: `goal off-track ${primary.goal.name}`,
      facts: `Tu meta principal "${primary.goal.name}" viene apretada con el ritmo actual (${primary.plan.statusLabel}). Sin culpa: ofrece ajustar plazo o aporte, o un aporte chico para mantenerla viva. No la des por perdida.`,
    });
  } else if (primary && primary.progressPct >= 45 && primary.progressPct <= 60) {
    out.push({
      topic: "goal_milestone",
      priority: 18,
      reason: `goal halfway ${primary.goal.name}`,
      facts: `Vas por la mitad de "${primary.goal.name}" (${primary.progressPct}%). Un mensaje corto y motivador, sin exagerar. Solo si de verdad aporta ánimo.`,
    });
  }
  const tooMany = gi.portfolio.conflicts.find((c) => c.kind === "too_many_active" || c.kind === "contributions_exceed_surplus");
  if (tooMany) {
    out.push({
      topic: "too_many_goals",
      priority: 30,
      reason: tooMany.kind,
      facts: `${tooMany.note} Ofrece, con calma, enfocar 1–2 metas y pausar o flexibilizar el resto; nunca lo hagas sentir mal por querer varias cosas.`,
    });
  }
  if (!ready && !tooMany && gi.miniGoalEligible && gi.weeklyJoyBudget > 0 && gi.allocation.byGoal.length > 0 && gi.portfolio.primary && gi.portfolio.primary.plan.status !== "at_risk") {
    out.push({
      topic: "allocation_opportunity",
      priority: 14,
      reason: "spare surplus for goals",
      facts: `Hay ~${money(gi.weeklyJoyBudget, base)}/sem libres después de lo importante. Si quiere acelerar su meta puede aportar algo chico esta semana; si no, sigue su ritmo normal. Pura opción, sin presión ni culpa, y solo si de verdad aporta.`,
    });
  }

  return out.sort((a, b2) => b2.priority - a.priority);
}

export function decideAmbientNudge(input: AmbientDecisionInput): AmbientDecision {
  const p = input.prefs;
  if (!input.telegramLinked) return { send: false, skipReason: "not_linked" };
  if (input.freshness.state === "insufficient_data")
    return { send: false, skipReason: "insufficient_data" };
  if (!p.ambientEnabled || p.frequency === "off")
    return { send: false, skipReason: "ambient_disabled" };
  if (p.mode === "paused") return { send: false, skipReason: "paused" };
  if (p.pausedUntilMs !== null && p.pausedUntilMs > input.nowMs)
    return { send: false, skipReason: "snoozed" };
  if (input.freshness.state === "paused") return { send: false, skipReason: "paused" };
  if (inQuietHours(input.localHour, p.quietHoursStart, p.quietHoursEnd))
    return { send: false, skipReason: "quiet_hours" };
  if (p.frequency === "weekly") {
    // Weekly with no days set means "specific days, unknown" → never nudge daily.
    const days = p.nudgeWeekdays ?? [];
    if (days.length === 0 || !days.includes(input.localWeekday))
      return { send: false, skipReason: "off_schedule" };
  }
  if (input.idleHours !== null && input.idleHours < MIN_IDLE_HOURS)
    return { send: false, skipReason: "recent_interaction" };
  // maxPerDay 0 means "none" (honor a user who asked for zero), not floored to 1.
  const dailyCap = Math.max(0, p.maxNudgesPerDay);
  if (dailyCap === 0 || input.sentToday >= dailyCap)
    return { send: false, skipReason: "max_per_day" };

  // Pick the highest-priority candidate NOT in its cooldown, honoring light mode
  // and the user's personalization-driven sensitivity threshold.
  const minPriority = input.suppressBelowPriority ?? 0;
  for (const c of candidates(input)) {
    if (p.mode === "light" && !LIGHT_MODE_TOPICS.has(c.topic)) continue;
    // High nudge sensitivity → only important ones — but NEVER drop a protected
    // obligation/debt/cashflow/fraud nudge, whatever the personalization threshold.
    if (c.priority < minPriority && !PERSONALIZATION_PROTECTED_TOPICS.has(c.topic)) continue;
    const last = input.nudgeLog.get(c.topic);
    const cooled =
      last === undefined || input.nowMs - last >= TOPIC_COOLDOWN_DAYS[c.topic] * DAY_MS;
    if (cooled) return { send: true, nudge: c };
  }

  // Nothing urgent and nothing fresh-stale worth saying (or all in cooldown).
  return {
    send: false,
    skipReason: freshnessWantsNudge(input.freshness.state) ? "all_cooldown" : "nothing_useful",
  };
}
