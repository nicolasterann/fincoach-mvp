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
// Day-of-month clamped to 1..28 (matches the calendar): a flow set to the 30th/31st
// materializes on the 28th so month-length never drops an occurrence.
export function clampDom(day: number | null | undefined): number {
  const n = typeof day === "number" ? day : Number(day);
  if (!Number.isFinite(n)) return 1;
  return Math.min(28, Math.max(1, Math.round(n)));
}
// The next monthly occurrence on-or-after `today` (keeps this month's day when it is >=
// today, else rolls to next month) — mirrors financial-calendar.nextMonthly.
function nextMonthly(expectedDay: number, today: Date): Date {
  const day = clampDom(expectedDay);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), day);
  return thisMonth.getTime() >= today.getTime()
    ? thisMonth
    : new Date(today.getFullYear(), today.getMonth() + 1, day);
}

export interface RecurringFlowLite {
  frequency: PaymentFrequency;
  expectedDay?: number | null;
  expectedWeekday?: number | null;
  payAnchorDate?: string | null;
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

// A flow's materialization mode: variable amount → ASK the user; fixed amount → AUTO-book.
export function materializationMode(isVariable: boolean | undefined): "auto" | "ask" {
  return isVariable ? "ask" : "auto";
}
