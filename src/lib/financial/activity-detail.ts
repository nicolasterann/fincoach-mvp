// M7 · D-M7.2 — server-side view model for the Activity detail. Reversals,
// grouping and totals used to live inside the page. This is the same formula,
// moved intact so a presentation component cannot become a second money engine.

export interface ActivityTransaction {
  id: string;
  description: string;
  category: string | null;
  base_amount: number | string;
  base_currency: string;
  type: string;
  occurred_at: string;
  debt_account_id: string | null;
  goal_id: string | null;
  related_transaction_id: string | null;
}

export type ActivityFilter = "all" | "out" | "in";

export const ACTIVITY_FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: "all", label: "Todo" },
  { key: "out", label: "Salidas" },
  { key: "in", label: "Entradas" },
];

const OUT_TYPES = new Set(["expense", "debt_payment", "goal_contribution"]);
const IN_TYPES = new Set(["income", "refund"]);

const DAY_TOTAL: Record<
  ActivityFilter,
  { types: Set<string>; label: string }
> = {
  all: { types: new Set(["expense"]), label: "Gastado" },
  out: { types: OUT_TYPES, label: "Salió" },
  in: { types: IN_TYPES, label: "Entró" },
};

export interface ActivityDayGroup {
  day: string;
  items: ActivityTransaction[];
  dayTotal: number;
}

export function buildActivityDetail({
  rows,
  filter,
  formatDay,
  nowMs = new Date().getTime(),
}: {
  rows: ActivityTransaction[];
  filter: ActivityFilter;
  formatDay: (iso: string) => string;
  nowMs?: number;
}): {
  transactions: ActivityTransaction[];
  groups: ActivityDayGroup[];
  dayTotalLabel: string;
  weekCovered: boolean;
  weekOut: number;
  weekIn: number;
} {
  const reversedIds = new Set(
    rows
      .filter(
        (row) => row.type === "reversal" && row.related_transaction_id,
      )
      .map((row) => String(row.related_transaction_id)),
  );

  const transactions = rows.filter((transaction) => {
    if (filter === "out") return OUT_TYPES.has(transaction.type);
    if (filter === "in") return IN_TYPES.has(transaction.type);
    return true;
  });

  const dayTotal = DAY_TOTAL[filter];
  const groups: ActivityDayGroup[] = [];
  for (const transaction of transactions) {
    const day = formatDay(transaction.occurred_at);
    let group = groups[groups.length - 1];
    if (!group || group.day !== day) {
      group = { day, items: [], dayTotal: 0 };
      groups.push(group);
    }
    group.items.push(transaction);
    if (
      dayTotal.types.has(transaction.type) &&
      !reversedIds.has(transaction.id)
    ) {
      group.dayTotal += Math.abs(Number(transaction.base_amount) || 0);
    }
  }

  const weekAgoMs = nowMs - 7 * 86_400_000;
  const oldestLoadedMs =
    rows.length > 0
      ? new Date(rows[rows.length - 1]!.occurred_at).getTime()
      : 0;
  const weekCovered =
    rows.length > 0 && (rows.length < 120 || oldestLoadedMs <= weekAgoMs);
  let weekOut = 0;
  let weekIn = 0;
  if (weekCovered) {
    for (const transaction of rows) {
      if (new Date(transaction.occurred_at).getTime() < weekAgoMs) continue;
      if (reversedIds.has(transaction.id)) continue;
      const amount = Math.abs(Number(transaction.base_amount) || 0);
      if (OUT_TYPES.has(transaction.type)) weekOut += amount;
      else if (IN_TYPES.has(transaction.type)) weekIn += amount;
    }
  }

  return {
    transactions,
    groups,
    dayTotalLabel: dayTotal.label,
    weekCovered,
    weekOut,
    weekIn,
  };
}

export function activityLedgerAmount(transaction: ActivityTransaction): number {
  return Math.abs(Number(transaction.base_amount) || 0);
}
