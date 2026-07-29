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
  externalRef?: string | null;
  budgetTreatment?: string | null;
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
export const CORRECTION_RECENT_WINDOW_HOURS = 72;
export const CORRECTION_RECENT_PAGE_SIZE = 200;
const CORRECTION_RECENT_MAX_PAGES = 10;

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
  external_ref: string | null;
  budget_treatment: string | null;
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
    externalRef: row.external_ref,
    budgetTreatment: row.budget_treatment,
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

export type CompleteRecentTransactionsRead =
  | { ok: true; complete: true; recent: RecentTransactions }
  | { ok: true; complete: false; partial: RecentTransactions }
  | { ok: false; complete: false };

export interface CompleteRecentTransactionsReader {
  page: (
    sinceISO: string,
    cursor: { createdAt: string; id: string } | null,
    limit: number,
  ) => Promise<{ rows: StoredTransaction[] | null; failed: boolean }>;
  count: (sinceISO: string) => Promise<{ count: number | null; failed: boolean }>;
}

function recentFromRows(rows: StoredTransaction[]): RecentTransactions {
  const sorted = rows.slice().sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  const reversedOriginalIds = new Set<string>();
  for (const tx of sorted) {
    if (tx.type === "reversal" && tx.relatedTransactionId) {
      reversedOriginalIds.add(tx.relatedTransactionId);
    }
  }
  return { transactions: sorted, reversedOriginalIds };
}

export async function readCompleteRecentTransactionsWith(
  reader: CompleteRecentTransactionsReader,
  options: {
    sinceISO: string;
    pageSize?: number;
    maxPages?: number;
  },
): Promise<CompleteRecentTransactionsRead> {
  const unavailable: CompleteRecentTransactionsRead = { ok: false, complete: false };
  const pageSize = options.pageSize ?? CORRECTION_RECENT_PAGE_SIZE;
  const maxPages = options.maxPages ?? CORRECTION_RECENT_MAX_PAGES;
  const byId = new Map<string, StoredTransaction>();
  let cursor: { createdAt: string; id: string } | null = null;
  let pages = 0;
  let reachedEnd = false;

  try {
    while (pages < maxPages) {
      const page = await reader.page(options.sinceISO, cursor, pageSize);
      if (page.failed || page.rows === null) return unavailable;
      const got = page.rows;
      pages += 1;
      for (const row of got) byId.set(row.id, row);
      if (got.length < pageSize) {
        reachedEnd = true;
        break;
      }
      const last = got[got.length - 1];
      if (!last?.id || !last.createdAt) return unavailable;
      const nextCursor = { createdAt: last.createdAt, id: last.id };
      if (cursor && cursor.createdAt === nextCursor.createdAt && cursor.id === nextCursor.id) {
        return { ok: true, complete: false, partial: recentFromRows([...byId.values()]) };
      }
      cursor = nextCursor;
    }

    const recent = () => recentFromRows([...byId.values()]);
    if (!reachedEnd) return { ok: true, complete: false, partial: recent() };
    if (pages === 1) return { ok: true, complete: true, recent: recent() };

    const total = await reader.count(options.sinceISO);
    if (total.failed || total.count === null) return unavailable;
    if (total.count !== byId.size) {
      return { ok: true, complete: false, partial: recent() };
    }
    return { ok: true, complete: true, recent: recent() };
  } catch {
    return unavailable;
  }
}

export async function readRecentTransactionsForCorrection(
  userId: string,
  options: { nowMs?: number; windowHours?: number } = {},
): Promise<CompleteRecentTransactionsRead> {
  const nowMs = options.nowMs ?? Date.now();
  const windowHours = options.windowHours ?? CORRECTION_RECENT_WINDOW_HOURS;
  const sinceISO = new Date(nowMs - windowHours * 3_600_000).toISOString();

  return readCompleteRecentTransactionsWith(
    {
      page: async (fromISO, cursor, limit) => {
        try {
          const supabase = createSupabaseAdminClient();
          let query = supabase
            .from("transactions")
            .select(
              "id, type, description, category, original_amount, original_currency, base_amount, base_currency, exchange_rate_to_base, source_account_id, destination_account_id, debt_account_id, goal_id, related_transaction_id, recurring_expense_id, external_ref, budget_treatment, occurred_at, created_at",
            )
            .eq("user_id", userId)
            // Corrección = algo REGISTRADO hace poco, aunque su fecha contable
            // sea antigua ("el gasto del lunes pasado"). Ventanear por
            // occurred_at deja ese movimiento fuera inmediatamente y vuelve a
            // abrir el duplicado. El cursor total usa (created_at, id).
            .gte("created_at", fromISO);
          if (cursor) {
            query = query.or(
              `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`,
            );
          }
          const { data, error } = await query
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(limit);
          return {
            rows: error || !data ? null : (data as TransactionRow[]).map(mapRow),
            failed: !!error,
          };
        } catch {
          return { rows: null, failed: true };
        }
      },
      count: async (fromISO) => {
        try {
          const supabase = createSupabaseAdminClient();
          const { count, error } = await supabase
            .from("transactions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .gte("created_at", fromISO);
          return { count: count ?? null, failed: !!error };
        } catch {
          return { count: null, failed: true };
        }
      },
    },
    { sinceISO },
  );
}

export type TransactionByIdRead =
  | { ok: true; found: true; transaction: StoredTransaction; reversed: boolean }
  | { ok: true; found: false }
  | { ok: false };

export async function readTransactionById(
  userId: string,
  transactionId: string,
): Promise<TransactionByIdRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id, type, description, category, original_amount, original_currency, base_amount, base_currency, exchange_rate_to_base, source_account_id, destination_account_id, debt_account_id, goal_id, related_transaction_id, recurring_expense_id, external_ref, budget_treatment, occurred_at, created_at",
      )
      .eq("user_id", userId)
      .eq("id", transactionId)
      .maybeSingle();
    if (error) return { ok: false };
    if (!data) return { ok: true, found: false };

    const { data: reversals, error: reversalError } = await supabase
      .from("transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "reversal")
      .eq("related_transaction_id", transactionId)
      .limit(1);
    if (reversalError || !reversals) return { ok: false };
    return {
      ok: true,
      found: true,
      transaction: mapRow(data as TransactionRow),
      reversed: reversals.length > 0,
    };
  } catch {
    return { ok: false };
  }
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
      "id, type, description, category, original_amount, original_currency, base_amount, base_currency, exchange_rate_to_base, source_account_id, destination_account_id, debt_account_id, goal_id, related_transaction_id, recurring_expense_id, external_ref, budget_treatment, occurred_at, created_at",
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
  // A cross-currency exchange is two adjustment rows under one durable group.
  // Generic reversal/correction/duplicate paths operate on a single row and
  // must never tear that operation in half. `undo_movement` recognizes this
  // marker before this predicate and routes it to the group reversal RPC.
  if (
    tx.type === "adjustment" &&
    tx.externalRef?.startsWith("fx-transfer:")
  ) {
    return false;
  }
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

/** Only an actually resolved target authorizes a correction/reversal. An
 * ambiguous candidate list is display data for a clarification, never a
 * license to take its first row. */
export function confirmedUndoTarget(
  result: UndoTargetResult,
): StoredTransaction | null {
  return result.status === "found" && result.target ? result.target : null;
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
