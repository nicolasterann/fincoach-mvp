import type { CoachingBriefing } from "@/lib/financial/coaching-signals";
import type { EngagementMode } from "@/lib/financial/coach-state-store";
import type { CardHealthState } from "@/lib/financial/debt-health";
import { computeBudgetRefineSuggestions } from "@/lib/financial/budget-progress";
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
  | "too_many_goals"
  // Stage 20 PASS 2 — household / shared-finance topics (derived ONLY from
  // briefing.household, the shared truth — never a member's personal data).
  // Neutral, no-blame, SUPPRESSIBLE by sensitivity (not money-safety obligations).
  | "household_settlement_pending"
  | "household_bill_due"
  | "household_shared_goal"
  // S31 (item 2.2) — a scheduled reminder the user EXPLICITLY asked for fired
  // (cron wrote its note) and hasn't been delivered yet. A kept promise, so it
  // outranks everything except an overdue card and is never suppressed.
  | "scheduled_reminder_due"
  // Stage 32 — presupuesto vivo. variable_expense_confirm asks (once the month
  // is a few days in) how much a month-to-month variable fixed expense (luz,
  // gas) actually came to; the user's answer IS the update (update_fixed_expense
  // stamps last_confirmed_month). budget_estimate_refine SUGGESTS aligning a
  // configured category budget with the user's learned real spend — never
  // auto-changes anything (update happens only via chat: update_budget_category).
  | "variable_expense_confirm"
  | "budget_estimate_refine";

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
  // S31 (item 2.2) — fired-but-undelivered scheduled reminders (their context
  // notes, already carrying the concrete date). Optional; absent ⇒ no topic.
  dueReminders?: { content: string }[];
  // Stage 32 (Item B) — the user's ACTIVE month-to-month variable fixed expenses
  // (amount already in base where convertible) + the month they last confirmed
  // (YYYY-MM-DD or null = never). Fed by the loop; absent ⇒ no confirm topic.
  variableExpenses?: {
    name: string;
    amount: number;
    currency: string;
    lastConfirmedMonth: string | null;
  }[];
  // Stage 32 — the local calendar date "YYYY-MM-DD" in the user's timezone
  // (drives day-of-month / current-month eligibility). Optional; absent ⇒
  // derived from nowMs in UTC.
  localDateISO?: string;
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
  household_settlement_pending: 3,
  household_bill_due: 1,
  household_shared_goal: 7,
  scheduled_reminder_due: 1,
  variable_expense_confirm: 7,
  budget_estimate_refine: 14,
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
  // The user explicitly asked to be reminded → honoring it is not noise.
  "scheduled_reminder_due",
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
  // An explicitly-requested reminder is a promise, not a preference.
  "scheduled_reminder_due",
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

  // S31 (item 2.2) — deliver fired scheduled reminders ("recuérdame el 1 de
  // agosto que sube el arriendo"). The user asked for this exact ping, so it
  // outranks every coaching topic (only an overdue card beats it). The facts
  // carry the notes verbatim (they already include the concrete due date); the
  // loop deactivates them after this nudge is delivered.
  const due = input.dueReminders ?? [];
  if (due.length > 0) {
    const listed = due.map((r) => `«${r.content}»`).join(" · ");
    out.push({
      topic: "scheduled_reminder_due",
      priority: 97,
      reason: `scheduled reminder due (${due.length})`,
      facts: `El usuario pidió EXPLÍCITAMENTE que le recordaras esto y la fecha ya llegó: ${listed}. Recuérdaselo directo, cálido y concreto. Si el recordatorio implica aplicar un cambio (un monto que sube/baja), pregúntale si lo aplican juntos ahora — tú NO cambies ningún monto por tu cuenta.`,
    });
  }

  // Stage 14 — card/debt protection candidates from the shared health model.
  const dh = b.debtHealth;
  const firstWith = (s: CardHealthState) => dh.cards.find((c) => c.states.includes(s));
  // NOTE (Bloque C): card-PAYMENT nudging on/around the due day now lives ENTIRELY in the
  // recurring materialization loop (the "corte" ask on the cutoff day captures the statement, the
  // "pago" ask on the due day confirms payment + books it + reduces the statement). The old
  // ambient topics card_overdue / card_due_today / payment_confirmation / card_due_soon pushed the
  // SAME "¿ya pagaste la tarjeta?" message off the same due_day and would double up with it, so
  // they are retired here. The DEBT-COST topics below (pressure / revolving / high interest /
  // stale statement) are a different message type and stay.
  if (b.margenKipu.status === "negative") {
    out.push({
      topic: "margin_negative",
      priority: 90,
      reason: "margin negative",
      facts: `A los próximos días les falta plata para lo comprometido: el Saldo Kipu está en ${money(b.margenKipu.saldo.saldo, base)} y la Reserva quedó corta. Sin culpa: sugiere frenar lo no esencial hasta el próximo ingreso.`,
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
      facts: `El Saldo Kipu viene bajo: ${money(b.margenKipu.saldo.saldo, base)} disponibles, se recarga ${money(b.margenKipu.saldo.fillDaily, base)} al día. Un comentario corto para dejarlo recargarse un par de días, sin alarmar.`,
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
      facts: `El Saldo Kipu viene justo: ${money(b.margenKipu.saldo.saldo, base)} disponibles, se recarga ${money(b.margenKipu.saldo.fillDaily, base)} al día. Un comentario corto para cuidar el ritmo, sin alarmar.`,
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

  // Stage 32 (Item B) — variable fixed expenses not yet confirmed THIS month.
  // Only once the month is a few days in (day ≥ 3): asking on the 1st about a
  // bill that hasn't even arrived is noise. The user's reply ("la luz fue
  // 42000") becomes update_fixed_expense, which stamps last_confirmed_month and
  // silences this until next month.
  const localISO = input.localDateISO ?? new Date(input.nowMs).toISOString().slice(0, 10);
  const dayOfMonth = Number(localISO.slice(8, 10));
  const monthISO = localISO.slice(0, 7);
  const toConfirm = (input.variableExpenses ?? []).filter(
    (v) => !v.lastConfirmedMonth || v.lastConfirmedMonth.slice(0, 7) < monthISO,
  );
  if (dayOfMonth >= 3 && toConfirm.length > 0) {
    const listed = toConfirm
      .slice(0, 3)
      .map((v) => `"${v.name}" (tengo ${money(v.amount, v.currency)} anotado)`)
      .join(", ");
    out.push({
      topic: "variable_expense_confirm",
      priority: 70,
      reason: `variable confirm (${toConfirm.length})`,
      facts: `Estos gastos fijos del usuario varían mes a mes y aún no me dice cuánto le salieron ESTE mes: ${listed}. Pregúntale natural y corto cuánto le llegó/salió este mes (una sola pregunta; si son varios, empieza por el primero), mencionando el monto que tienes anotado como referencia. Si responde con el monto, ese número actualiza el gasto fijo. Cero presión; es solo para tener su mes al día.`,
    });
  }

  // Stage 32 (Item A4) / S5 — a configured category budget that diverges materially
  // (default 15%, and by an absolute floor of 20) from the user's LEARNED real monthly
  // spend, with enough data to trust the learning. SUGGEST-ONLY: Kipu proposes updating
  // the estimate; the change happens only if the user says yes in chat
  // (update_budget_category). Never auto-adjusted. Thresholds live in the shared
  // computeBudgetRefineSuggestions (ONE source of truth for this + the in-app nudge).
  const bp = b.budgetProgress;
  const baselines = si.baselines;
  if (bp?.hasBudgets) {
    // Shared refine rule (same thresholds as the in-app coaching nudge — one source
    // of truth in computeBudgetRefineSuggestions).
    const diverging = computeBudgetRefineSuggestions({
      budgetItems: (bp.items ?? []).map((i) => ({ category: i.category, labelEs: i.labelEs, budgetMonthly: i.budgetMonthly })),
      learnedByCategory: baselines.categories.map((c) => ({ category: c.category, monthlyAvg: c.monthlyAvg, confidence: c.confidence })),
      overallConfidence: baselines.confidence,
    })[0];
    if (diverging) {
      const dir = diverging.direction === "over" ? "por encima" : "por debajo";
      out.push({
        topic: "budget_estimate_refine",
        priority: 60,
        reason: `budget refine ${diverging.category}`,
        facts: `Su gasto real de ${diverging.labelEs} viene siendo ~${money(diverging.learnedMonthly, base)}/mes y tiene ${money(diverging.budgetMonthly, base)}/mes anotado como presupuesto (el real va ${dir}). SUGIERE, sin culpa, actualizar ese estimado para que su plan refleje la realidad, y pregúntale si lo actualiza — NUNCA lo cambies tú; si dice que sí, el ajuste se hace en el chat. Es un dato aprendido de sus gastos, preséntalo como estimado.`,
      });
    }
  }

  // Stage 20 PASS 2 — household / shared-finance candidates. PRIVACY-STRUCTURAL:
  // facts come ONLY from b.household (shared settlements / shared goals / shared
  // bills) — never a member's personal ledger, Margen or private data. Neutral and
  // never blameful; sent to the member's OWN chat. At most ONE household nudge per
  // run (it competes with personal topics for the single daily slot).
  const hh = b.household;
  if (hh.hasHousehold) {
    const billDue = hh.households
      .flatMap((h) => h.upcomingSharedBills.map((bDue) => ({ h, bDue })))
      .filter((x) => x.bDue.dueInDays >= 0 && x.bDue.dueInDays <= 3)
      .sort((a, c) => a.bDue.dueInDays - c.bDue.dueInDays)[0];
    if (billDue) {
      out.push({
        topic: "household_bill_due",
        priority: 58,
        reason: `shared bill ${billDue.h.name}`,
        facts: `En el hogar "${billDue.h.name}" viene un gasto compartido: ${billDue.bDue.description} (${money(billDue.bDue.amountBase, base)}) ${billDue.bDue.dueInDays === 0 ? "hoy" : `en ${billDue.bDue.dueInDays} día(s)`}. Recuérdalo NEUTRAL para que el grupo lo tenga presente; sin reclamar.`,
      });
    }
    const settle = hh.households.find((h) => h.myToPay.length > 0 || h.myToCollect.length > 0);
    if (settle) {
      const detail =
        settle.myToPay.length > 0
          ? `te toca pasar ${settle.myToPay.map((t) => `${money(t.amountBase, base)} a ${t.toName}`).join(" y ")}`
          : `te deben ${settle.myToCollect.map((t) => `${money(t.amountBase, base)} (${t.fromName})`).join(", ")}`;
      out.push({
        topic: "household_settlement_pending",
        priority: 36,
        reason: `settlement ${settle.name}`,
        facts: `En el hogar "${settle.name}" hay un saldo pendiente: ${detail}. Coméntalo NEUTRAL, como dinero compartido por cuadrar — nunca como reclamo ni culpa, y sin exponer nada personal de nadie.`,
      });
    }
    const goalHh = hh.households.find((h) => h.sharedGoals.some((g) => g.progressPct >= 50 && g.progressPct < 100));
    if (goalHh) {
      const g = goalHh.sharedGoals.find((x) => x.progressPct >= 50 && x.progressPct < 100)!;
      out.push({
        topic: "household_shared_goal",
        priority: 15,
        reason: `shared goal ${goalHh.name}`,
        facts: `La meta compartida "${g.name}" del hogar "${goalHh.name}" va en ${g.progressPct}%. Un mensaje corto y motivador para el grupo, sin presión. Solo si de verdad aporta.`,
      });
    }
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
