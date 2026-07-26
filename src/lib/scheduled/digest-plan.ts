import type { OccurrenceKind, RecurringOccurrence } from "@/lib/financial/recurring-occurrences-store";

// ── Bloque J-4 — un digest, no una ametralladora ────────────────────────────
// El notifier mandaba UN mensaje por ocurrencia y sin tope: el día 15 del founder
// tiene 11 eventos (3 cortes + pagos + fijos + un ingreso) y todos salían juntos.
// Además preguntaba el corte el MISMO día del corte, cuando el banco todavía no
// mandó el estado: la pregunta era incontestable, se repetía 3 días seguidos y al
// tercero la ocurrencia moría para siempre. Preguntar antes de tiempo no solo
// molesta — FABRICA los pendientes eternos (3 colgados desde el 15-16 de julio).
//
// Este módulo es la decisión PURA: cuándo se puede preguntar, con qué cadencia, y
// en qué orden entra al resumen. Sin DB, sin reloj propio, sin IA.

/** Días que se espera desde el corte antes de preguntar por el estado. Los bancos
 *  no emiten el estado el día del corte, sino dos o tres días después. */
export const CARD_ASK_GRACE_DAYS = 3;
/** Pero nunca tan tarde que no quede margen para pagar. */
export const CARD_ASK_MIN_LEAD_DAYS = 4;
/** Backoff: primera pregunta el día 0, después +3 y +7 — no tres días seguidos. */
export const ASK_BACKOFF_DAYS = [0, 3, 7] as const;
export const MAX_ASKS = ASK_BACKOFF_DAYS.length;

function parseISO(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function toISO(y: number, mIdx0: number, d: number): string {
  const dt = new Date(Date.UTC(y, mIdx0, d));
  return dt.toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, days: number): string {
  const p = parseISO(iso);
  if (!p) return iso;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function daysBetweenISO(fromISO: string, toISODate: string): number | null {
  const a = parseISO(fromISO);
  const b = parseISO(toISODate);
  if (!a || !b) return null;
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

/** El primer día del mes siguiente al que contiene `iso` en el que cae `day`,
 *  recortado al último día real del mes (un vencimiento 31 en febrero = 28/29). */
function nextDayOfMonthAfter(iso: string, day: number): string | null {
  const p = parseISO(iso);
  if (!p || !(day >= 1 && day <= 31)) return null;
  for (let bump = 0; bump <= 2; bump += 1) {
    const y = p.y;
    const mIdx = p.m - 1 + bump;
    const lastDay = new Date(Date.UTC(y, mIdx + 1, 0)).getUTCDate();
    const candidate = toISO(y, mIdx, Math.min(day, lastDay));
    if (candidate > iso) return candidate;
  }
  return null;
}

/** El PRIMER día en que tiene sentido preguntar por el corte de una tarjeta.
 *  Corte + gracia, pero nunca después de (vencimiento − margen): si la ventana no
 *  existe (corte y pago pegados), gana el corte — preguntar tarde es peor que
 *  preguntar temprano cuando ya no hay tiempo de pagar. */
export function earliestCardAskDate(input: {
  occurrenceDate: string;
  dueDay?: number | null;
  graceDays?: number;
  minLeadDays?: number;
}): string {
  const grace = input.graceDays ?? CARD_ASK_GRACE_DAYS;
  const lead = input.minLeadDays ?? CARD_ASK_MIN_LEAD_DAYS;
  const delayed = addDaysISO(input.occurrenceDate, grace);
  if (input.dueDay == null) return delayed;
  const due = nextDayOfMonthAfter(input.occurrenceDate, input.dueDay);
  if (!due) return delayed;
  const latest = addDaysISO(due, -lead);
  if (latest <= input.occurrenceDate) return input.occurrenceDate;
  return delayed <= latest ? delayed : latest;
}

/** ¿Toca preguntar hoy? El día 0 es libre; después hay que esperar el hueco del
 *  backoff desde la ÚLTIMA pregunta. Sin `lastAskedOn` (nunca se preguntó) toca. */
export function askBackoffDue(input: {
  askCount: number;
  lastAskedOn?: string | null;
  today: string;
}): boolean {
  if (input.askCount <= 0) return true;
  if (input.askCount >= MAX_ASKS) return false;
  if (!input.lastAskedOn) return true;
  const gap = ASK_BACKOFF_DAYS[input.askCount];
  if (gap == null) return false;
  const elapsed = daysBetweenISO(input.lastAskedOn, input.today);
  return elapsed == null ? true : elapsed >= gap;
}

export type DigestSlot = "confirm" | "ask" | "standing";

export interface DigestItem {
  occurrenceId: string;
  kind: OccurrenceKind;
  slot: DigestSlot;
  label: string;
  amount: number | null;
  currency: string | null;
  occurrenceDate: string;
  /** 0 = mueve dinero HOY · 1 = necesita un dato · 2 = confirmación · 3 = solo recordar. */
  priority: number;
}

export interface DigestPlan {
  items: DigestItem[];
  asks: DigestItem[];
  confirms: DigestItem[];
  standing: DigestItem[];
  /** Por qué NO entró cada una — para el log y para el gate. */
  held: { occurrenceId: string; why: "snoozed" | "not_yet_askable" | "asked_recently" | "already_notified" }[];
  send: boolean;
}

const MONEY_TODAY_KINDS: OccurrenceKind[] = ["expense", "income", "debt_payment"];

function priorityFor(o: RecurringOccurrence, slot: DigestSlot, today: string): number {
  if (slot === "standing") return 3;
  if (slot === "confirm") return 2;
  // Un pago o un ingreso cuya fecha ya llegó mueve dinero HOY: va arriba de todo.
  if (MONEY_TODAY_KINDS.includes(o.kind) && o.occurrenceDate <= today) return 0;
  return 1;
}

export interface DigestPlanInput {
  occurrences: RecurringOccurrence[];
  today: string;
  nowMs: number;
  labelFor: (o: RecurringOccurrence) => string;
  /** Día de pago de la tarjeta, para no preguntar el corte demasiado tarde. */
  dueDayFor?: (o: RecurringOccurrence) => number | null;
}

export function planDigest(input: DigestPlanInput): DigestPlan {
  const confirms: DigestItem[] = [];
  const asks: DigestItem[] = [];
  const standing: DigestItem[] = [];
  const held: DigestPlan["held"] = [];

  const mk = (o: RecurringOccurrence, slot: DigestSlot): DigestItem => ({
    occurrenceId: o.id,
    kind: o.kind,
    slot,
    label: input.labelFor(o),
    amount: o.expectedAmount ?? null,
    currency: o.currency ?? null,
    occurrenceDate: o.occurrenceDate,
    priority: priorityFor(o, slot, input.today),
  });

  for (const o of input.occurrences) {
    if (o.status === "booked") {
      if (o.notified) {
        held.push({ occurrenceId: o.id, why: "already_notified" });
        continue;
      }
      confirms.push(mk(o, "confirm"));
      continue;
    }
    // pending → un ASK.
    if (o.snoozeUntil && new Date(o.snoozeUntil).getTime() > input.nowMs) {
      held.push({ occurrenceId: o.id, why: "snoozed" });
      continue;
    }
    // El corte no se pregunta el día del corte: el banco todavía no lo emitió.
    if (o.kind === "card_statement") {
      const from = earliestCardAskDate({
        occurrenceDate: o.occurrenceDate,
        dueDay: input.dueDayFor?.(o) ?? null,
      });
      if (input.today < from) {
        held.push({ occurrenceId: o.id, why: "not_yet_askable" });
        continue;
      }
    }
    if (o.askCount >= MAX_ASKS) {
      // Agotó sus intentos: NO desaparece — baja a una línea del resumen para que
      // siga a la vista sin volver a interrogar (antes moría en silencio).
      standing.push(mk(o, "standing"));
      continue;
    }
    if (!askBackoffDue({ askCount: o.askCount, lastAskedOn: o.lastAskedOn, today: input.today })) {
      held.push({ occurrenceId: o.id, why: "asked_recently" });
      continue;
    }
    asks.push(mk(o, "ask"));
  }

  const items = [...confirms, ...asks, ...standing].sort(
    (a, b) => a.priority - b.priority || a.occurrenceDate.localeCompare(b.occurrenceDate),
  );
  return {
    items,
    asks,
    confirms,
    standing,
    held,
    // Una línea "sigue pendiente" sola no justifica despertar a nadie.
    send: asks.length > 0 || confirms.length > 0,
  };
}
