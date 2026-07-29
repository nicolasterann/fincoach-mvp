// Bloque C — pure due-occurrence math for the recurring cash-flow materialization loop.
//
// Given a recurring flow (income or fixed expense) and a user-LOCAL `today`, decide whether
// an occurrence is due, and enumerate the occurrences in a small look-back window so a missed
// cron day still catches up. Kept SELF-CONTAINED (its own tiny date helpers, mirroring
// financial-calendar's private ones) so it never touches the Margen calendar; the only shared
// dependency is the DST-safe `nextAnchoredDate` from pay-anchor. Timezone is the caller's job
// (the cron builds `today` in the user's zone before calling here) — this module is pure and
// deterministic on the Date it receives.

import { nextAnchoredDate } from "@/lib/financial/pay-anchor";
import type { PaymentFrequency } from "@/types/financial";

// ── local-time date helpers (mirror financial-calendar.ts:109-123) ───────────
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
// Day-of-month normalized to 1..31 (Stage F: matches the calendar's REAL-month
// clamp — a flow set to the 30th materializes on the 30th; Feb clamps to 28/29
// inside nextMonthly, so month-length still never drops an occurrence).
export function clampDom(day: number | null | undefined): number {
  const n = typeof day === "number" ? day : Number(day);
  if (!Number.isFinite(n)) return 1;
  return Math.min(31, Math.max(1, Math.round(n)));
}
function clampToMonth(day: number, year: number, month: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Math.min(daysInMonth, clampDom(day));
}
// The next monthly occurrence on-or-after `today` (keeps this month's day when it is >=
// today, else rolls to next month) — mirrors financial-calendar.nextMonthly.
function nextMonthly(expectedDay: number, today: Date): Date {
  const y = today.getFullYear();
  const m = today.getMonth();
  const thisMonth = new Date(y, m, clampToMonth(expectedDay, y, m));
  if (thisMonth.getTime() >= today.getTime()) return thisMonth;
  const ny = m === 11 ? y + 1 : y;
  const nm = (m + 1) % 12;
  return new Date(ny, nm, clampToMonth(expectedDay, ny, nm));
}

export interface RecurringFlowLite {
  frequency: PaymentFrequency;
  expectedDay?: number | null;
  expectedWeekday?: number | null;
  payAnchorDate?: string | null;
}

export type EarlyVariableFixedCycleVerdict =
  | { ok: true; action: "reuse"; occurrenceId: string }
  | { ok: true; action: "create" }
  | {
      ok: false;
      reason: "unreadable" | "ambiguous" | "predates_plan_or_regime";
    };

/**
 * Decides whether chat may create an occurrence that the nightly materializer
 * has not created yet.  The all-status cycle read is authoritative: a
 * terminal row is reused, several rows are corruption/ambiguity, and an empty
 * historical cycle may not borrow today's learning regime.
 */
export function earlyVariableFixedCycleVerdict(input: {
  cycleRead:
    | { ok: true; complete: true; occurrenceIds: string[] }
    | { ok: true; complete: false; occurrenceIds: string[] }
    | { ok: false; complete: false; occurrenceIds?: never };
  occurrenceDate: string;
  planCreatedAt: string;
  regimeStartedAt: string;
}): EarlyVariableFixedCycleVerdict {
  if (!input.cycleRead.ok || !input.cycleRead.complete) {
    return { ok: false, reason: "unreadable" };
  }
  if (input.cycleRead.occurrenceIds.length > 1) {
    return { ok: false, reason: "ambiguous" };
  }
  if (input.cycleRead.occurrenceIds.length === 1) {
    return {
      ok: true,
      action: "reuse",
      occurrenceId: input.cycleRead.occurrenceIds[0],
    };
  }
  const planCreatedOn = input.planCreatedAt.slice(0, 10);
  const regimeStartedOn = input.regimeStartedAt.slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(planCreatedOn) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(regimeStartedOn) ||
    input.occurrenceDate < planCreatedOn ||
    input.occurrenceDate < regimeStartedOn
  ) {
    return { ok: false, reason: "predates_plan_or_regime" };
  }
  return { ok: true, action: "create" };
}

// Is an occurrence of this flow due exactly on `today` (user-local)? Returns the occurrence
// date ISO (== today's ISO) or null. `yearly` and `custom` are intentionally NOT materialized
// (we can't precisely date a yearly flow from a day-of-month alone, and custom has no cadence)
// — they stay projection-only, exactly like the calendar leaves them.
export function dueOccurrenceOn(flow: RecurringFlowLite, today: Date): string | null {
  const t = startOfDay(today);
  const todayIso = isoLocal(t);
  switch (flow.frequency) {
    case "monthly": {
      // No day-of-month → NOT schedulable. Never default to the 1st: that fabricates a phantom
      // paycheck/expense on a day the user never told us (the Margen calendar guards the same way).
      if (flow.expectedDay == null) return null;
      const cand = nextMonthly(clampDom(flow.expectedDay), t);
      return isoLocal(cand) === todayIso ? todayIso : null;
    }
    case "weekly":
    case "biweekly": {
      const step = flow.frequency === "biweekly" ? 14 : 7;
      if (flow.payAnchorDate) {
        // nextAnchoredDate returns the STRICTLY-future occurrence, so ask "from yesterday"
        // and check whether that next occurrence is today.
        const cand = nextAnchoredDate(flow.payAnchorDate, step, addDays(t, -1));
        return cand && isoLocal(cand) === todayIso ? todayIso : null;
      }
      if (flow.expectedWeekday != null) {
        return t.getDay() === flow.expectedWeekday ? todayIso : null;
      }
      return null;
    }
    default: // yearly, custom → never auto-materialized
      return null;
  }
}

// Every occurrence due within [today - lookbackDays, today] (user-local), oldest first, so a
// cron that missed a day still books the recent occurrence(s). De-duplicated. Reuses
// dueOccurrenceOn per day (the window is tiny, so this is cheap and always correct across all
// frequencies). Idempotency against already-materialized rows is the store's job.
export function occurrencesDueUpTo(flow: RecurringFlowLite, today: Date, lookbackDays = 2): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = Math.max(0, Math.round(lookbackDays)); i >= 0; i--) {
    const iso = dueOccurrenceOn(flow, addDays(startOfDay(today), -i));
    if (iso && !seen.has(iso)) {
      seen.add(iso);
      out.push(iso);
    }
  }
  return out;
}

// Canonical occurrence date for a bill the user reports BEFORE the nightly
// materializer created its row. This is intentionally derived from the plan,
// not from "today" alone: otherwise an early report on the 27th for a bill due
// on the 30th would create a second row when the cron reaches the 30th.
//
// The input is already the user's LOCAL date. ISO/UTC arithmetic keeps this
// helper independent from the server timezone.
export function reportedOccurrenceDate(
  flow: RecurringFlowLite,
  factDateISO: string,
): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(factDateISO);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const fact = new Date(Date.UTC(year, monthIndex, day));
  if (
    fact.getUTCFullYear() !== year ||
    fact.getUTCMonth() !== monthIndex ||
    fact.getUTCDate() !== day
  ) {
    return null;
  }
  const isoUtc = (date: Date) =>
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

  if (flow.frequency === "monthly") {
    if (flow.expectedDay == null) return factDateISO;
    return isoUtc(
      new Date(
        Date.UTC(
          year,
          monthIndex,
          clampToMonth(flow.expectedDay, year, monthIndex),
        ),
      ),
    );
  }

  if (flow.frequency === "weekly" || flow.frequency === "biweekly") {
    const step = flow.frequency === "biweekly" ? 14 : 7;
    let offset: number | null = null;
    if (flow.payAnchorDate && /^\d{4}-\d{2}-\d{2}$/.test(flow.payAnchorDate)) {
      const anchor = new Date(`${flow.payAnchorDate}T00:00:00.000Z`);
      if (!Number.isNaN(anchor.getTime())) {
        const diff = Math.round((fact.getTime() - anchor.getTime()) / 86_400_000);
        const mod = ((diff % step) + step) % step;
        offset = mod <= step / 2 ? -mod : step - mod;
      }
    } else if (flow.expectedWeekday != null) {
      const weekday = Math.min(6, Math.max(0, Math.round(flow.expectedWeekday)));
      const forward = (weekday - fact.getUTCDay() + 7) % 7;
      offset = forward <= 3 ? forward : forward - 7;
    }
    return offset == null
      ? factDateISO
      : isoUtc(new Date(fact.getTime() + offset * 86_400_000));
  }

  // Yearly/custom flows are deliberately not auto-materialized because the
  // schema has no complete annual/custom schedule. The report date is their
  // only honest cycle identity.
  return factDateISO;
}

/**
 * A stated bill cycle may be historical, but it cannot be arbitrarily far in
 * the future.  This is a guard on identity, not on payment time: an invoice can
 * legitimately arrive before its due date, so the window follows the cadence.
 *
 * Past cycles stay admissible because users may reconstruct old bills.  The
 * caller still has to prove that the plan exists and that the resulting
 * occurrence is unique.
 */
export function reportedOccurrenceIsPlausible(
  flow: RecurringFlowLite,
  factDateISO: string,
  occurrenceDateISO: string,
): boolean {
  const parse = (value: string): Date | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month, day));
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month &&
      date.getUTCDate() === day
      ? date
      : null;
  };
  const fact = parse(factDateISO);
  const occurrence = parse(occurrenceDateISO);
  if (!fact || !occurrence) return false;
  const forwardDays = Math.round(
    (occurrence.getTime() - fact.getTime()) / 86_400_000,
  );
  if (forwardDays <= 0) return true;
  const maxForwardDays =
    flow.frequency === "weekly"
      ? 8
      : flow.frequency === "biweekly"
        ? 15
        : flow.frequency === "monthly"
          ? 35
          : 400;
  return forwardDays <= maxForwardDays;
}

// A flow's materialization mode: variable amount → ASK the user; fixed amount → AUTO-book.
export function materializationMode(isVariable: boolean | undefined): "auto" | "ask" {
  return isVariable ? "ask" : "auto";
}
