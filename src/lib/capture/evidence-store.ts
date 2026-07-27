import { createHash, randomBytes } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { StoredTransaction } from "@/lib/financial/transaction-recovery";

// Evidence persistence + idempotency (Stage 12). The SAME receipt/voice/PDF
// sent twice is detected by content hash BEFORE any model call or write —
// retries, duplicated webhooks and double-taps are free. Best-effort writes:
// capture must keep working even if the audit table is briefly unavailable.

export type EvidenceSource =
  | "web_chat"
  | "web_upload"
  | "telegram_text"
  | "telegram_photo"
  | "telegram_voice"
  | "telegram_document"
  | "email";

export type EvidenceKind = "text" | "image" | "audio" | "pdf";

export type EvidenceStatus =
  | "processing"
  | "processed"
  | "needs_clarification"
  | "failed"
  | "rejected";

export function hashEvidence(content: Uint8Array | string): string {
  const h = createHash("sha256");
  h.update(typeof content === "string" ? Buffer.from(content, "utf8") : content);
  return h.digest("hex");
}

export interface RegisteredEvidence {
  /** id of the row this caller now OWNS (only set when duplicate === false). */
  id: string | null;
  /** true → another delivery already owns/owned this content; do not process. */
  duplicate: boolean;
  /** true → the duplicate is a FRESH in-flight claim (still being processed by
   *  another request), not a terminal one. Drives honest user copy. */
  inFlight?: boolean;
  previousSummary?: string | null;
  status?: EvidenceStatus | null;
  /** The updated_at this caller wrote as owner — the finalize guard. Only a
   *  caller holding the current version may finalize the row. */
  claimVersion?: string;
  /** true → the claim store failed unexpectedly. The caller MUST fail closed
   *  (do not process evidence unguarded); the attempt is retryable. */
  error?: boolean;
  /** For a duplicate of a row awaiting clarification: its durable resumable
   *  session (the full statement digest), so a re-upload can CONTINUE instead of
   *  dead-ending with "already processed". */
  clarificationContext?: string | null;
  /** updated_at of the existing row — the optimistic-lock version a resume uses
   *  to finalize without owning the original claim. */
  existingVersion?: string;
}

// How long a 'processing' row may sit before it is considered interrupted
// (crashed mid-extraction) and may be reclaimed by a new delivery. This is a
// MACHINE timeout (worker crash), measured in minutes.
const STALE_PROCESSING_MS = 5 * 60_000;

// How long a 'needs_clarification' row stays awaiting a HUMAN answer before a
// re-upload is allowed to start fresh. Phase 1 finding M3: a normal human delay
// of minutes or hours must NOT be treated like a crashed worker. This is a
// human-response timeout, measured in weeks, deliberately far longer than the
// machine timeout — within it, re-uploading just shows the pending question.
const STALE_CLARIFICATION_MS = 14 * 24 * 60 * 60_000;

export type ClaimDecision = "duplicate" | "reclaim" | "inflight";

// Pure decision over an EXISTING (user_id, content_hash) row when a new
// delivery loses the insert race. Deterministic and unit-tested in the build
// gate; the actual atomic INSERT/UPDATE race lives in the live sim.
//   processed / rejected        → terminal, real duplicate.
//   failed                      → previous attempt died; let the new delivery retry.
//   processing (fresh)          → another delivery is mid-flight; do NOT double-run.
//   processing (stale, minutes) → interrupted worker; reclaim and retry.
//   needs_clarification (within human window) → the agent asked a question; the
//       user should answer in chat. Re-uploading shows the pending question and
//       spends no model call.
//   needs_clarification (beyond the human window, weeks) → effectively abandoned;
//       allow a fresh attempt (reclaim).
export function decideExistingClaim(
  existing: { status: string; updatedAtMs: number },
  opts: { nowMs: number; staleProcessingMs: number; staleClarificationMs: number },
): ClaimDecision {
  switch (existing.status) {
    case "failed":
      return "reclaim";
    case "needs_clarification":
      return existing.updatedAtMs <= opts.nowMs - opts.staleClarificationMs
        ? "reclaim"
        : "duplicate";
    case "processing":
      return existing.updatedAtMs <= opts.nowMs - opts.staleProcessingMs
        ? "reclaim"
        : "inflight";
    case "processed":
    case "rejected":
      return "duplicate";
    default:
      return "duplicate"; // unknown status → conservative: treat as handled
  }
}

// Atomically CLAIM evidence for processing. The UNIQUE (user_id, content_hash)
// index turns the insert into the claim: only one concurrent delivery wins a
// fresh insert. Losers read the existing row and either short-circuit
// (duplicate / in-flight) or reclaim a failed/interrupted row via an
// optimistic lock on updated_at (exactly one concurrent reclaimer wins).
export async function registerEvidence(input: {
  userId: string;
  source: EvidenceSource;
  kind: EvidenceKind;
  contentHash: string;
  staleProcessingMs?: number;
  staleClarificationMs?: number;
}): Promise<RegisteredEvidence> {
  try {
    const supabase = createSupabaseAdminClient();
    const nowISO = new Date().toISOString();

    // 1. Claim by insert.
    const insert = await supabase
      .from("capture_evidence")
      .insert({
        user_id: input.userId,
        source: input.source,
        kind: input.kind,
        content_hash: input.contentHash,
        status: "processing",
        updated_at: nowISO,
      })
      .select("id")
      .single();
    if (!insert.error && insert.data) {
      return { id: insert.data.id, duplicate: false, status: "processing", claimVersion: nowISO };
    }
    // Any non-uniqueness error is an UNEXPECTED store failure → fail closed
    // (retryable). We must never process evidence without the idempotency guard.
    if (!insert.error || insert.error.code !== "23505") {
      return { id: null, duplicate: false, error: true };
    }

    // 2. Lost the insert race → inspect the existing claim.
    const { data: existing, error: selectError } = await supabase
      .from("capture_evidence")
      .select("id, status, summary, updated_at, clarification_context")
      .eq("user_id", input.userId)
      .eq("content_hash", input.contentHash)
      .maybeSingle();
    if (selectError) return { id: null, duplicate: false, error: true };
    if (!existing) {
      // Conflict but the row vanished (rolled back): fail closed and let the
      // caller retry rather than process unguarded.
      return { id: null, duplicate: false, error: true };
    }

    const decision = decideExistingClaim(
      { status: existing.status, updatedAtMs: Date.parse(existing.updated_at) },
      {
        nowMs: Date.now(),
        staleProcessingMs: input.staleProcessingMs ?? STALE_PROCESSING_MS,
        staleClarificationMs: input.staleClarificationMs ?? STALE_CLARIFICATION_MS,
      },
    );
    if (decision === "duplicate") {
      return {
        id: existing.id,
        duplicate: true,
        inFlight: false,
        previousSummary: existing.summary,
        status: existing.status as EvidenceStatus,
        clarificationContext: existing.clarification_context ?? null,
        existingVersion: existing.updated_at,
      };
    }
    if (decision === "inflight") {
      return {
        id: existing.id,
        duplicate: true,
        inFlight: true,
        previousSummary: existing.summary,
        status: existing.status as EvidenceStatus,
        clarificationContext: existing.clarification_context ?? null,
        existingVersion: existing.updated_at,
      };
    }

    // 3. Reclaim a failed/interrupted row. Optimistic lock on the exact
    //    updated_at we observed: the first reclaimer bumps it, so any
    //    concurrent reclaimer's guard no longer matches and affects 0 rows.
    const reclaimISO = new Date().toISOString();
    const reclaim = await supabase
      .from("capture_evidence")
      .update({
        status: "processing",
        source: input.source,
        kind: input.kind,
        summary: null,
        updated_at: reclaimISO,
      })
      .eq("id", existing.id)
      .eq("updated_at", existing.updated_at)
      .select("id")
      .maybeSingle();
    if (reclaim.data) {
      return { id: reclaim.data.id, duplicate: false, status: "processing", claimVersion: reclaimISO };
    }
    // Lost the reclaim race → another delivery owns it now (in flight).
    return {
      id: existing.id,
      duplicate: true,
      inFlight: true,
      previousSummary: existing.summary,
      status: "processing",
    };
  } catch {
    return { id: null, duplicate: false, error: true };
  }
}

// Finalize a claimed row to its terminal state. Only the CURRENT claim owner
// may finalize: when expectedVersion is given, the update is guarded on the
// exact updated_at this owner wrote, so a stale worker that was already
// superseded by a reclaim (newer updated_at) silently affects 0 rows and
// cannot overwrite the new owner's result. Always bumps updated_at so a later
// stale-reclaim can't resurrect a row that just finished. Returns whether THIS
// caller actually finalized the row.
export async function updateEvidenceSummary(
  evidenceId: string | null,
  summary: string,
  status: "processed" | "needs_clarification" | "failed" | "rejected" = "processed",
  expectedVersion?: string,
  // When set, also writes the persistent clarification context (a compact
  // description of the pending movement(s)) so the user can answer in a later
  // chat turn. Pass null to CLEAR it (e.g. when finalizing a resolved
  // clarification to processed). Left untouched when undefined, so normal
  // finalization has no dependency on the clarification_context column.
  clarificationContext?: string | null,
): Promise<boolean> {
  if (!evidenceId) return false;
  try {
    const supabase = createSupabaseAdminClient();
    const patch: Record<string, unknown> = {
      summary: summary.slice(0, 800),
      status,
      updated_at: new Date().toISOString(),
    };
    if (clarificationContext !== undefined) {
      // Holds a durable, resumable statement session (the full extracted digest),
      // not just a one-line hint — so a long statement can be continued without a
      // re-upload. Bounded high (the column is text) and never silently dropped.
      patch.clarification_context = clarificationContext
        ? clarificationContext.slice(0, 30000)
        : null;
    }
    let query = supabase.from("capture_evidence").update(patch).eq("id", evidenceId);
    if (expectedVersion) query = query.eq("updated_at", expectedVersion);
    const { data } = await query.select("id").maybeSingle();
    return Boolean(data?.id);
  } catch {
    return false;
  }
}

// Take an optimistic claim on a needs_clarification evidence row before resuming
// its import (re-upload path), so two concurrent re-uploads don't each run a full
// agent statement import. Flips status to 'processing' guarded on the observed
// updated_at; only ONE caller wins. Returns the new version to finalize on, or
// null if another caller already claimed it. The 'processing' state self-heals
// via the stale-processing reclaim if the winner crashes mid-import.
export async function claimEvidenceForResume(
  evidenceId: string,
  expectedVersion: string,
): Promise<{ version: string } | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const nowISO = new Date().toISOString();
    const { data } = await supabase
      .from("capture_evidence")
      .update({ status: "processing", updated_at: nowISO })
      .eq("id", evidenceId)
      .eq("updated_at", expectedVersion)
      .select("id")
      .maybeSingle();
    return data?.id ? { version: nowISO } : null;
  } catch {
    return null;
  }
}

// Find the user's SINGLE open clarification awaiting a human answer (Phase 1
// finding M4). Returns null when there is none OR when more than one is pending
// (ambiguous → never auto-resolve the wrong one). Best-effort: any store error
// (including the column not existing pre-migration) yields null, degrading to
// "no continuation" rather than failing the chat turn. Scoped strictly by user.
export interface OpenClarificationEvidence {
  id: string;
  version: string; // updated_at — the finalize guard
  summary: string | null;
  clarificationContext: string | null;
}

export async function loadOpenClarificationEvidence(
  userId: string,
  opts?: { windowMs?: number; nowMs?: number },
): Promise<OpenClarificationEvidence | null> {
  try {
    const supabase = createSupabaseAdminClient();
    // Human-answer continuation window: an answer typically arrives soon after
    // the question. Beyond this we don't auto-link a later movement.
    const windowMs = opts?.windowMs ?? 6 * 60 * 60_000;
    const sinceISO = new Date((opts?.nowMs ?? Date.now()) - windowMs).toISOString();
    const { data, error } = await supabase
      .from("capture_evidence")
      .select("id, updated_at, summary, clarification_context")
      .eq("user_id", userId)
      .eq("status", "needs_clarification")
      .gte("updated_at", sinceISO)
      .order("updated_at", { ascending: false })
      .limit(2);
    if (error || !data || data.length !== 1) return null;
    const row = data[0];
    return {
      id: row.id,
      version: row.updated_at,
      summary: row.summary ?? null,
      clarificationContext: row.clarification_context ?? null,
    };
  } catch {
    return null;
  }
}

// Recent transactions WITH external_ref for the matcher. Tolerates the column
// not existing yet (pre-migration deploys) by falling back to the plain set.
export interface MatchableTransaction extends StoredTransaction {
  externalRef?: string | null;
}

export const MATCHABLE_TX_PAGE = 200;
const MATCHABLE_TX_MAX_PAGES = 20;

const TX_COLUMNS =
  "id, type, description, category, original_amount, original_currency, base_amount, base_currency, exchange_rate_to_base, source_account_id, destination_account_id, debt_account_id, goal_id, related_transaction_id, recurring_expense_id, occurred_at, created_at";

interface TxRow {
  id: string;
  type: string;
  description: string;
  category: string;
  original_amount: number | string;
  original_currency: string;
  base_amount: number | string;
  base_currency: string;
  exchange_rate_to_base: number | string;
  source_account_id: string | null;
  destination_account_id: string | null;
  debt_account_id: string | null;
  goal_id: string | null;
  related_transaction_id: string | null;
  recurring_expense_id: string | null;
  occurred_at: string;
  created_at: string;
  external_ref?: string | null;
}

function mapTx(row: TxRow): MatchableTransaction {
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
    externalRef: row.external_ref ?? null,
  };
}

export type MatchableTransactionsRead =
  | { ok: true; complete: true; transactions: MatchableTransaction[] }
  | { ok: true; complete: false; partial: MatchableTransaction[] }
  | { ok: false; complete: false };

export interface MatchableTransactionsReader {
  page: (
    sinceISO: string,
    cursor: { occurredAt: string; id: string } | null,
    limit: number,
  ) => Promise<{ rows: MatchableTransaction[] | null; failed: boolean }>;
  count: (sinceISO: string) => Promise<{ count: number | null; failed: boolean }>;
}

function sortMatchableTransactions(rows: MatchableTransaction[]): MatchableTransaction[] {
  return rows.slice().sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** Reads the WHOLE matching window. A fixed `.limit(N)` is not a performance
 * optimization here: it silently turns an older duplicate into a new movement.
 * Cursor by the total order `(occurred_at,id)`, dedupe edits that cross the
 * cursor, and verify multi-page reads against an exact count. */
export async function readCompleteMatchableTransactionsWith(
  reader: MatchableTransactionsReader,
  options: { sinceISO: string; pageSize?: number; maxPages?: number },
): Promise<MatchableTransactionsRead> {
  const unavailable: MatchableTransactionsRead = { ok: false, complete: false };
  const pageSize = options.pageSize ?? MATCHABLE_TX_PAGE;
  const maxPages = options.maxPages ?? MATCHABLE_TX_MAX_PAGES;
  const byId = new Map<string, MatchableTransaction>();
  let cursor: { occurredAt: string; id: string } | null = null;
  let pages = 0;
  let reachedEnd = false;

  try {
    while (pages < maxPages) {
      const page = await reader.page(options.sinceISO, cursor, pageSize);
      if (page.failed || page.rows === null) return unavailable;
      pages += 1;
      for (const row of page.rows) byId.set(row.id, row);
      if (page.rows.length < pageSize) {
        reachedEnd = true;
        break;
      }
      const last = page.rows[page.rows.length - 1];
      if (!last?.id || !last.occurredAt) return unavailable;
      const nextCursor = { occurredAt: last.occurredAt, id: last.id };
      if (cursor && cursor.occurredAt === nextCursor.occurredAt && cursor.id === nextCursor.id) {
        return {
          ok: true,
          complete: false,
          partial: sortMatchableTransactions([...byId.values()]),
        };
      }
      cursor = nextCursor;
    }

    const rows = () => sortMatchableTransactions([...byId.values()]);
    if (!reachedEnd) return { ok: true, complete: false, partial: rows() };
    if (pages === 1) return { ok: true, complete: true, transactions: rows() };

    const total = await reader.count(options.sinceISO);
    if (total.failed || total.count === null) return unavailable;
    if (total.count !== byId.size) {
      return { ok: true, complete: false, partial: rows() };
    }
    return { ok: true, complete: true, transactions: rows() };
  } catch {
    return unavailable;
  }
}

export async function loadMatchableTransactions(
  userId: string,
  options?: { days?: number; limit?: number },
): Promise<MatchableTransaction[]> {
  const days = options?.days ?? 45;
  const pageSize = Math.max(1, Math.min(options?.limit ?? MATCHABLE_TX_PAGE, 500));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const read = await readCompleteMatchableTransactionsWith(
    {
      page: async (sinceISO, cursor, limit) => {
        try {
          const supabase = createSupabaseAdminClient();
          let query = supabase
            .from("transactions")
            .select(`${TX_COLUMNS}, external_ref`)
            .eq("user_id", userId)
            .gte("occurred_at", sinceISO);
          if (cursor) {
            query = query.or(
              `occurred_at.lt."${cursor.occurredAt}",and(occurred_at.eq."${cursor.occurredAt}",id.lt.${cursor.id})`,
            );
          }
          const { data, error } = await query
            .order("occurred_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(limit);
          return {
            rows: error || !data ? null : (data as TxRow[]).map(mapTx),
            failed: !!error,
          };
        } catch {
          return { rows: null, failed: true };
        }
      },
      count: async (sinceISO) => {
        try {
          const supabase = createSupabaseAdminClient();
          const { count, error } = await supabase
            .from("transactions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .gte("occurred_at", sinceISO);
          return { count: count ?? null, failed: !!error };
        } catch {
          return { count: null, failed: true };
        }
      },
    },
    { sinceISO: since, pageSize },
  );
  if (!read.ok || !read.complete) {
    throw new Error("loadMatchableTransactions incomplete");
  }
  return read.transactions;
}

// id → lowercased name for the user's accounts AND debt accounts/cards, so the
// matcher can scope a (non-unique) bank reference to the right financial
// source and refuse to merge an identical ref seen on a different card.
export const ACCOUNT_LABELS_CAP = 200;
type AccountLabelRow = { id: string; name: string };
export type AccountLabelsRead =
  | { ok: true; complete: true; labels: Map<string, string> }
  | { ok: true; complete: false }
  | { ok: false; complete: false };

export function accountLabelsFromResults(
  accounts: { data: unknown; error: unknown },
  debts: { data: unknown; error: unknown },
): AccountLabelsRead {
  if (
    accounts.error ||
    debts.error ||
    !Array.isArray(accounts.data) ||
    !Array.isArray(debts.data)
  ) {
    return { ok: false, complete: false };
  }
  if (accounts.data.length > ACCOUNT_LABELS_CAP || debts.data.length > ACCOUNT_LABELS_CAP) {
    return { ok: true, complete: false };
  }

  const labels = new Map<string, string>();
  for (const row of accounts.data as AccountLabelRow[]) {
    if (row?.id && typeof row.name === "string") labels.set(row.id, row.name.toLowerCase());
  }
  for (const row of debts.data as AccountLabelRow[]) {
    if (row?.id && typeof row.name === "string") labels.set(row.id, row.name.toLowerCase());
  }
  return { ok: true, complete: true, labels };
}

export async function loadAccountLabels(userId: string): Promise<Map<string, string>> {
  try {
    const supabase = createSupabaseAdminClient();
    const [accounts, debts] = await Promise.all([
      supabase
        .from("accounts")
        .select("id, name")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .limit(ACCOUNT_LABELS_CAP + 1),
      supabase
        .from("debt_accounts")
        .select("id, name")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .limit(ACCOUNT_LABELS_CAP + 1),
    ]);
    const read = accountLabelsFromResults(accounts, debts);
    if (!read.ok || !read.complete) throw new Error("account labels incomplete");
    return read.labels;
  } catch (error) {
    throw new Error(
      `loadAccountLabels failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

// The user's debt accounts (cards/loans), lite, for deterministic statement →
// card resolution at digest-build time. Statement ingestion consumes the typed
// contract below and refuses both failed and unproven-complete inventories.
export type DebtAccountLite = { id: string; name: string; currency?: string };
export const DEBT_ACCOUNTS_LITE_CAP = 200;
export type DebtAccountsLiteRead =
  | { ok: true; complete: true; accounts: DebtAccountLite[] }
  | { ok: true; complete: false; partial: DebtAccountLite[] }
  | { ok: false; complete: false };

export function debtAccountsLiteFromResult(result: {
  data: unknown;
  error: unknown;
}): DebtAccountsLiteRead {
  if (result.error || !Array.isArray(result.data)) {
    return { ok: false, complete: false };
  }
  const accounts = result.data
      .slice(0, DEBT_ACCOUNTS_LITE_CAP)
      .filter(
        (r): r is { id: string; name: string; currency: string | null } =>
          Boolean(
            r &&
              typeof r === "object" &&
              "id" in r &&
              "name" in r &&
              (r as { id?: unknown }).id &&
              (r as { name?: unknown }).name,
          ),
      )
      .map((r) => ({ id: r.id, name: r.name, currency: r.currency ?? undefined }));
  return result.data.length > DEBT_ACCOUNTS_LITE_CAP
    ? { ok: true, complete: false, partial: accounts }
    : { ok: true, complete: true, accounts };
}

export async function readDebtAccountsLite(
  userId: string,
): Promise<DebtAccountsLiteRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("debt_accounts")
      .select("id, name, currency")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(DEBT_ACCOUNTS_LITE_CAP + 1);
    return debtAccountsLiteFromResult({ data, error });
  } catch {
    return { ok: false, complete: false };
  }
}

/** Display-only compatibility wrapper. Statement ingestion must use the typed
 * read above: "no cards" and "could not read cards" are different facts. */
export async function loadDebtAccountsLite(userId: string): Promise<DebtAccountLite[]> {
  const read = await readDebtAccountsLite(userId);
  return read.ok ? (read.complete ? read.accounts : read.partial) : [];
}

// Per-user inbound email token (the identity behind token@inbox domain).
// Race-safe: the token is only ever set when still null (so two concurrent
// requests can't clobber each other into different tokens), and both callers
// converge on the persisted winner.
export async function getOrCreateInboundEmailToken(
  userId: string,
): Promise<string | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data: existing } = await supabase
      .from("user_financial_preferences")
      .select("inbound_email_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.inbound_email_token) return existing.inbound_email_token;

    const token = `k${randomBytes(9).toString("hex")}`;
    // Set only if still null on an existing prefs row (race-safe update).
    const upd = await supabase
      .from("user_financial_preferences")
      .update({ inbound_email_token: token })
      .eq("user_id", userId)
      .is("inbound_email_token", null)
      .select("inbound_email_token")
      .maybeSingle();
    if (upd.data?.inbound_email_token) return upd.data.inbound_email_token;

    // No prefs row yet: create it without clobbering a concurrent winner.
    await supabase
      .from("user_financial_preferences")
      .upsert({ user_id: userId, inbound_email_token: token }, {
        onConflict: "user_id",
        ignoreDuplicates: true,
      });
    const { data: final } = await supabase
      .from("user_financial_preferences")
      .select("inbound_email_token")
      .eq("user_id", userId)
      .maybeSingle();
    return final?.inbound_email_token ?? null;
  } catch {
    return null;
  }
}

export async function findUserByInboundToken(token: string): Promise<string | null> {
  if (!/^k[a-f0-9]{18}$/.test(token)) return null;
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("user_financial_preferences")
      .select("user_id")
      .eq("inbound_email_token", token)
      .maybeSingle();
    return data?.user_id ?? null;
  } catch {
    return null;
  }
}
