import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// Read-only recovery store. Loads recent transactions and provides pure
// helpers to pick a safe undo target and detect duplicate pairs. It NEVER
// writes — the canonical writer (apply-chat-transaction-intent) performs the
// audit-safe reversal. Financial truth stays in accounts/debts/goals balances;
// transactions are the audit log we reason over here.

export interface StoredTransaction {
  id: string;
  type: string;
  description: string;
  category: string;
  originalAmount: number;
  originalCurrency: string;
  baseAmount: number;
  baseCurrency: string;
  exchangeRateToBase: number;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  debtAccountId: string | null;
  goalId: string | null;
  relatedTransactionId: string | null;
  recurringExpenseId: string | null;
  occurredAt: string;
  createdAt: string;
}

// Movement types whose balance effect we know how to reverse. Reversal and
// adjustment rows are themselves audit entries and are never undo targets.
const REVERSIBLE_TYPES = new Set([
  "expense",
  "income",
  "transfer",
  "debt_payment",
  "goal_contribution",
  "refund",
]);

const DEFAULT_WINDOW_HOURS = 72;
const DEFAULT_LIMIT = 25;

interface TransactionRow {
  id: string;
  type: string;
  description: string;
  category: string;
  original_amount: string | number;
  original_currency: string;
  base_amount: string | number;
  base_currency: string;
  exchange_rate_to_base: string | number;
  source_account_id: string | null;
  destination_account_id: string | null;
  debt_account_id: string | null;
  goal_id: string | null;
  related_transaction_id: string | null;
  recurring_expense_id: string | null;
  occurred_at: string;
  created_at: string;
}

function mapRow(row: TransactionRow): StoredTransaction {
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    category: row.category,
    originalAmount: Number(row.original_amount),
    originalCurrency: row.original_currency,
    baseAmount: Number(row.base_amount),
    baseCurrency: row.base_currency,
    exchangeRateToBase: Number(row.exchange_rate_to_base),
    sourceAccountId: row.source_account_id,
    destinationAccountId: row.destination_account_id,
    debtAccountId: row.debt_account_id,
    goalId: row.goal_id,
    relatedTransactionId: row.related_transaction_id,
    recurringExpenseId: row.recurring_expense_id,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

export interface RecentTransactions {
  transactions: StoredTransaction[];
  // Ids of original transactions that already have a reversal row pointing at
  // them — never reverse these again (idempotency).
  reversedOriginalIds: Set<string>;
}

export async function loadRecentTransactions(
  userId: string,
  options: { windowHours?: number; limit?: number } = {},
): Promise<RecentTransactions> {
  const windowHours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const sinceIso = new Date(Date.now() - windowHours * 3_600_000).toISOString();

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, type, description, category, original_amount, original_currency, base_amount, base_currency, exchange_rate_to_base, source_account_id, destination_account_id, debt_account_id, goal_id, related_transaction_id, recurring_expense_id, occurred_at, created_at",
    )
    .eq("user_id", userId)
    .gt("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return { transactions: [], reversedOriginalIds: new Set() };
  }

  const transactions = (data as TransactionRow[]).map(mapRow);
  const reversedOriginalIds = new Set<string>();
  for (const tx of transactions) {
    if (tx.type === "reversal" && tx.relatedTransactionId) {
      reversedOriginalIds.add(tx.relatedTransactionId);
    }
  }

  return { transactions, reversedOriginalIds };
}

// A transaction is eligible to undo when its effect is reversible, it is not
// itself an audit row, and it has not already been reversed.
export function isUndoEligible(
  tx: StoredTransaction,
  reversedOriginalIds: Set<string>,
): boolean {
  if (!REVERSIBLE_TYPES.has(tx.type)) return false;
  if (reversedOriginalIds.has(tx.id)) return false;
  return true;
}

export function eligibleTransactions(
  recent: RecentTransactions,
): StoredTransaction[] {
  return recent.transactions.filter((tx) =>
    isUndoEligible(tx, recent.reversedOriginalIds),
  );
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Loose match of a free-text hint ("el café", "los 3", "la compra de ayer")
// against a transaction's description/category/amount. Used only to narrow an
// undo target; never to decide financial truth.
function transactionMatchesHint(tx: StoredTransaction, hint: string): boolean {
  const h = normalize(hint);
  if (!h.trim()) return true; // no hint → matches (caller falls back to recency)
  const haystack = `${normalize(tx.description)} ${normalize(tx.category)}`;
  const words = h.split(/\s+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  if (words.some((w) => haystack.includes(w))) return true;
  // Amount hint: any number in the hint matching the transaction amount.
  const amounts = h.match(/\d+(?:[.,]\d{1,2})?/g) ?? [];
  return amounts.some((raw) => {
    const value = Number(raw.replace(",", "."));
    return Number.isFinite(value) && Math.round(value) === Math.round(tx.originalAmount);
  });
}

export interface UndoTargetResult {
  status: "found" | "ambiguous" | "none";
  target?: StoredTransaction;
  // When ambiguous, the candidates the user might mean (most recent first).
  candidates?: StoredTransaction[];
}

// Pick the transaction to undo. With no hint, the most recent eligible movement
// wins. With a hint, we narrow to matches; one match → that, several → ask.
export function findUndoTarget(
  recent: RecentTransactions,
  hint: string,
): UndoTargetResult {
  const eligible = eligibleTransactions(recent);
  if (eligible.length === 0) return { status: "none" };

  const trimmed = hint.trim();
  if (!trimmed) {
    return { status: "found", target: eligible[0] };
  }

  const matches = eligible.filter((tx) => transactionMatchesHint(tx, trimmed));
  if (matches.length === 0) {
    // Hint didn't match anything specific; fall back to most recent but flag
    // it as ambiguous so the caller asks for confirmation.
    return { status: "ambiguous", candidates: eligible.slice(0, 3) };
  }
  if (matches.length === 1) {
    return { status: "found", target: matches[0] };
  }
  return { status: "ambiguous", candidates: matches.slice(0, 3) };
}

function sameTarget(a: StoredTransaction, b: StoredTransaction): boolean {
  return (
    (a.sourceAccountId ?? "") === (b.sourceAccountId ?? "") &&
    (a.destinationAccountId ?? "") === (b.destinationAccountId ?? "") &&
    (a.debtAccountId ?? "") === (b.debtAccountId ?? "") &&
    (a.goalId ?? "") === (b.goalId ?? "")
  );
}

const DUPLICATE_WINDOW_MS = 6 * 3_600_000;

export interface DuplicateResult {
  status: "found" | "ambiguous" | "none";
  // The duplicate to reverse (the MORE RECENT of the matched pair).
  remove?: StoredTransaction;
  keep?: StoredTransaction;
  pairs?: { remove: StoredTransaction; keep: StoredTransaction }[];
}

// Find likely duplicate pairs among eligible transactions: same type, amount,
// currency, category and target, close in time. Returns the most-recent member
// to reverse. Never both. If several distinct pairs exist, ask.
export function findDuplicateCandidates(
  recent: RecentTransactions,
): DuplicateResult {
  const eligible = eligibleTransactions(recent);
  const pairs: { remove: StoredTransaction; keep: StoredTransaction }[] = [];

  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      const a = eligible[i];
      const b = eligible[j];
      if (a.type !== b.type) continue;
      if (Math.round(a.originalAmount) !== Math.round(b.originalAmount)) continue;
      if (a.originalCurrency !== b.originalCurrency) continue;
      if (a.category !== b.category) continue;
      if (!sameTarget(a, b)) continue;
      const dt = Math.abs(
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      if (dt > DUPLICATE_WINDOW_MS) continue;
      // eligible is newest-first, so `a` is the more recent → remove it.
      pairs.push({ remove: a, keep: b });
    }
  }

  if (pairs.length === 0) return { status: "none" };
  if (pairs.length === 1) {
    return { status: "found", remove: pairs[0].remove, keep: pairs[0].keep };
  }
  return { status: "ambiguous", pairs: pairs.slice(0, 3) };
}
