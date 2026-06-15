import { roundMoney } from "@/lib/financial/money";

// Pure, deterministic helpers that turn raw recent transactions into the
// dashboard's living signals: daily spending rhythm, week pace, and the
// logging streak. All real derived data — never simulated.

export interface RecentTxLite {
  type: string;
  base_amount: number | string;
  occurred_at: string;
  // Optional ledger linkage so spend analytics can net out reversed/corrected
  // movements. When omitted (older callers, fixtures) nothing is netted and the
  // behaviour is exactly as before — strictly additive.
  id?: string;
  related_transaction_id?: string | null;
}

const SPEND_TYPES = new Set(["expense"]);

// Ids of originals that have been reversed (an undo, or the reverse half of a
// correction). Their spend must NOT count: the append-only `reversal` row
// cancels the original's balance effect, so a reversed — or corrected-away —
// expense should drop out of spending analytics. Built once per call from the
// same recent window; if `related_transaction_id`/`id` aren't provided, the set
// is empty and totals are unchanged.
function reversedOriginalIds(rows: RecentTxLite[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.type === "reversal" && row.related_transaction_id) {
      ids.add(row.related_transaction_id);
    }
  }
  return ids;
}
const ACTIVITY_TYPES = new Set([
  "expense",
  "income",
  "transfer",
  "debt_payment",
  "goal_contribution",
  "refund",
]);

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface DayRhythm {
  label: string; // "L", "M", … day-of-week initial
  amount: number;
  isToday: boolean;
}

const DAY_INITIALS = ["D", "L", "M", "X", "J", "V", "S"];

// Spending per day for the last `days` days (oldest → newest). Card and cash
// expenses both count as spending rhythm; transfers/adjustments/reversals don't.
export function computeSpendingRhythm(
  rows: RecentTxLite[],
  now: Date,
  days = 7,
): DayRhythm[] {
  const reversed = reversedOriginalIds(rows);
  const byDay = new Map<string, number>();
  for (const row of rows) {
    if (!SPEND_TYPES.has(row.type)) continue;
    if (row.id && reversed.has(row.id)) continue; // undone / corrected away
    const d = new Date(row.occurred_at);
    const key = dayKey(d);
    byDay.set(key, (byDay.get(key) ?? 0) + Math.abs(Number(row.base_amount) || 0));
  }
  const out: DayRhythm[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = startOfDay(new Date(now.getTime() - i * 86_400_000));
    out.push({
      label: DAY_INITIALS[d.getDay()],
      amount: roundMoney(byDay.get(dayKey(d)) ?? 0),
      isToday: i === 0,
    });
  }
  return out;
}

// Spending so far this week (Monday → now) and today.
export function computeWeekSpend(
  rows: RecentTxLite[],
  now: Date,
): { weekSpend: number; todaySpend: number } {
  const today = startOfDay(now);
  const dow = now.getDay(); // Sunday = 0
  const daysSinceMonday = (dow + 6) % 7;
  const monday = new Date(today.getTime() - daysSinceMonday * 86_400_000);
  const reversed = reversedOriginalIds(rows);
  let weekSpend = 0;
  let todaySpend = 0;
  for (const row of rows) {
    if (!SPEND_TYPES.has(row.type)) continue;
    if (row.id && reversed.has(row.id)) continue; // undone / corrected away
    const d = new Date(row.occurred_at);
    const amount = Math.abs(Number(row.base_amount) || 0);
    if (d >= monday) weekSpend += amount;
    if (d >= today) todaySpend += amount;
  }
  return { weekSpend: roundMoney(weekSpend), todaySpend: roundMoney(todaySpend) };
}

// Consecutive days (ending today or yesterday) with at least one real
// movement logged. The habit signal behind "Kipu knows your real life".
export function computeStreakDays(rows: RecentTxLite[], now: Date): number {
  const daysWithActivity = new Set<string>();
  for (const row of rows) {
    if (!ACTIVITY_TYPES.has(row.type)) continue;
    daysWithActivity.add(dayKey(new Date(row.occurred_at)));
  }
  const today = startOfDay(now);
  let cursor = today;
  // A streak survives if today has no log yet but yesterday does.
  if (!daysWithActivity.has(dayKey(cursor))) {
    cursor = new Date(cursor.getTime() - 86_400_000);
    if (!daysWithActivity.has(dayKey(cursor))) return 0;
  }
  let streak = 0;
  while (daysWithActivity.has(dayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return streak;
}
