import type { CoachingBriefing } from "@/lib/financial/coaching-signals";
import type { EngagementMode } from "@/lib/financial/coach-state-store";
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
  | "freshness_check";

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
};
// In "light" mode only the genuinely urgent topics may fire.
const LIGHT_MODE_TOPICS = new Set<AmbientTopic>([
  "card_due_soon",
  "payment_scheduled_soon",
  "margin_negative",
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

  const card = b.cardsDueSoon[0];
  if (card) {
    out.push({
      topic: "card_due_soon",
      priority: 95 - card.inDays,
      reason: `card ${card.name} due in ${card.inDays}d`,
      facts: `La tarjeta "${card.name}" vence ${card.inDays <= 0 ? "hoy" : `en ${card.inDays} día(s)`} (deuda ${money(card.balance, base)}). Pregunta natural si ya la pagó o quiere dejarlo pendiente; no des por hecho.`,
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
  if (input.freshness.state === "slightly_stale") {
    out.push({
      topic: "freshness_check",
      priority: 20,
      reason: "slightly stale check-in",
      facts: `Pasó un tiempo desde la última vez (${input.freshness.stalestDays ?? "varios"} días). Un check-in MUY corto y casual de "¿cambió algo que quieras cargar?". Solo si de verdad ayuda.`,
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

  // Pick the highest-priority candidate NOT in its cooldown, honoring light mode.
  for (const c of candidates(input)) {
    if (p.mode === "light" && !LIGHT_MODE_TOPICS.has(c.topic)) continue;
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
