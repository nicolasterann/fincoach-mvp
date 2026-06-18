// Stage 20 PASS 2 (Micro-stage F) — recurring shared-bill cadence math. PURE +
// deterministic (now is passed in; no Date.now()/Math.random). Computes the NEXT
// occurrence of a household recurring bill so the dashboard/agent can show "lo que
// viene" and a calm reminder. It never moves money — only schedules a reminder; the
// payer still logs the real shared expense each cycle.

export type Cadence = "weekly" | "biweekly" | "monthly" | "annual";

export interface RecurringBillInput {
  description: string;
  amountBase: number;
  cadence: Cadence;
  anchorDay: number | null; // monthly/annual: day-of-month 1..28; weekly/biweekly: weekday 0..6
}

export interface UpcomingBill {
  description: string;
  amountBase: number;
  dueISO: string;
  dueInDays: number;
}

const DAY = 86_400_000;
const dayBucketISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Next occurrence date (UTC, day-resolution) at/after `nowMs`. Honest: clamps a
// monthly anchor to 1..28 so it always exists in every month.
export function nextOccurrenceMs(input: RecurringBillInput, nowMs: number): number {
  const now = new Date(nowMs);
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  if (input.cadence === "weekly" || input.cadence === "biweekly") {
    const targetDow = ((input.anchorDay ?? now.getUTCDay()) % 7 + 7) % 7;
    const todayDow = now.getUTCDay();
    let ahead = (targetDow - todayDow + 7) % 7;
    if (ahead === 0) ahead = 7; // strictly the NEXT one (a reminder, not "today is it forever")
    return todayUTC + ahead * DAY;
  }

  // monthly / annual: anchor is a day-of-month (clamped 1..28). A bill whose anchor
  // is TODAY counts as due today (dueInDays 0); a passed anchor rolls to next period.
  const anchor = Math.min(28, Math.max(1, input.anchorDay ?? 1));
  const candidate = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), anchor);
  if (candidate >= todayUTC) return candidate;
  if (input.cadence === "annual") return Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), anchor);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, anchor);
}

export function upcomingBill(input: RecurringBillInput, nowMs: number): UpcomingBill {
  const dueMs = nextOccurrenceMs(input, nowMs);
  const todayUTC = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate());
  return {
    description: input.description,
    amountBase: input.amountBase,
    dueISO: dayBucketISO(dueMs),
    dueInDays: Math.round((dueMs - todayUTC) / DAY),
  };
}

// The bills due within `windowDays` (soonest first) — what to surface as "upcoming".
export function upcomingBillsWithin(bills: RecurringBillInput[], nowMs: number, windowDays: number): UpcomingBill[] {
  return bills
    .map((b) => upcomingBill(b, nowMs))
    .filter((b) => b.dueInDays >= 0 && b.dueInDays <= windowDays)
    .sort((a, b) => a.dueInDays - b.dueInDays);
}
