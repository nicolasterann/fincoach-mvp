import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  applyLedgerEntry,
  applyLedgerReversal,
  type LedgerEntryInput,
} from "@/lib/ai/apply-chat-transaction-intent";
import { resolveMovementCurrency } from "@/lib/financial/currency-resolver";
import { roundMoney } from "@/lib/financial/money";
import type { FxRate } from "@/lib/fx/fx-rates";

// Bloque C — the ONE place recurring occurrences touch the money ledger. Both the evening
// materializer (auto-book) and the chat resolver (confirm/correct/skip) book and reverse
// through here so they share the exact FX/idempotency/money-safety rules. Every write goes
// through the single atomic writer (applyLedgerEntry / applyLedgerReversal) — never raw SQL,
// never a fabricated 1:1 rate.

export interface BookInput {
  userId: string;
  kind: "income" | "expense";
  nativeAmount: number;
  nativeCurrency: string | null;
  base: string;
  rates: FxRate[];
  accountId: string; // destination (income) / source (cash expense) / debt (card expense)
  accountCurrency: string | null; // for FX resolution fallback; null when a card currency is unknown
  isCard: boolean; // expense charged to a credit card (debt up, no cash out today)
  dedupeKey: string;
  occurredAtISO: string;
  occurrenceDateISO: string;
  description: string;
  sourceLinkId: string;
}

// Did the user (or a prior stuck cron) ALREADY record this movement — a manual chat log OR an
// orphaned auto-booking — near this date? Prevents double-booking on top of it. Matches on
// kind + native amount/currency + the involved account, within ±3 days, EXCLUDING already-
// reversed rows. `ok:false` = the check itself failed (query error) → the caller MUST fail
// closed (never book on an unverifiable duplicate check). The tx column is `type`, not
// `transaction_type` (that is only the enum TYPE name, not a column).
export async function findAlreadyRecorded(input: BookInput): Promise<{ ok: boolean; txId: string | null }> {
  try {
    const sb = createSupabaseAdminClient();
    const amount = roundMoney(input.nativeAmount);
    const from = new Date(`${input.occurrenceDateISO}T00:00:00.000Z`);
    const to = new Date(from.getTime());
    from.setUTCDate(from.getUTCDate() - 3);
    to.setUTCDate(to.getUTCDate() + 3);
    const candRes = await sb
      .from("transactions")
      .select("id, original_amount, original_currency, source_account_id, destination_account_id, debt_account_id")
      .eq("user_id", input.userId)
      .eq("type", input.kind)
      .gte("occurred_at", from.toISOString())
      .lte("occurred_at", to.toISOString())
      .limit(200);
    if (candRes.error) return { ok: false, txId: null };
    const candidates = (candRes.data ?? []) as Record<string, unknown>[];
    const candidateIds = candidates.map((r) => String(r.id));
    // Which of THESE candidates were already reversed? Scope the reversal lookup to the exact
    // candidate ids (bounded + exact) rather than a globally-capped list that could miss one.
    let reversed = new Set<string>();
    if (candidateIds.length > 0) {
      const revRes = await sb
        .from("transactions")
        .select("related_transaction_id")
        .eq("user_id", input.userId)
        .eq("type", "reversal")
        .in("related_transaction_id", candidateIds);
      if (revRes.error) return { ok: false, txId: null };
      reversed = new Set(
        (revRes.data ?? [])
          .map((r) => String((r as Record<string, unknown>).related_transaction_id ?? ""))
          .filter(Boolean),
      );
    }
    const tol = Math.max(0.01, amount * 0.02); // 2% or a cent, whichever is larger
    for (const r of candidates) {
      if (reversed.has(String(r.id))) continue; // already reversed → not a live duplicate
      const rowAmt = Number(r.original_amount);
      const rowCur = String(r.original_currency ?? "").toUpperCase();
      if (input.nativeCurrency && rowCur && rowCur !== String(input.nativeCurrency).toUpperCase()) continue;
      if (!Number.isFinite(rowAmt) || Math.abs(rowAmt - amount) > tol) continue;
      const acct =
        input.kind === "income"
          ? String(r.destination_account_id ?? "")
          : String(r.source_account_id ?? r.debt_account_id ?? "");
      if (acct && acct === input.accountId) return { ok: true, txId: String(r.id) };
      if (!acct) return { ok: true, txId: String(r.id) };
    }
    return { ok: true, txId: null };
  } catch {
    return { ok: false, txId: null };
  }
}

// Book ONE occurrence into the ledger (native amount + resolved FX). Returns the ledger
// transaction id + whether it pre-existed (already recorded), or null if it could not be booked
// safely (no trusted FX rate → never a fabricated 1:1, OR the duplicate check failed → fail
// closed). ALWAYS runs the duplicate check (a manual log or an orphaned auto-book must never be
// double-booked); the dedupeKey is a second net for cron reruns.
export async function bookRecurring(
  input: BookInput,
): Promise<{ txId: string; preexisting: boolean } | null> {
  const amount = roundMoney(input.nativeAmount);
  if (!(amount > 0)) return null;
  const dup = await findAlreadyRecorded(input);
  if (!dup.ok) return null; // could not verify → never double-book
  if (dup.txId) return { txId: dup.txId, preexisting: true };
  const cr = resolveMovementCurrency({
    explicit: input.nativeCurrency, // the flow's OWN currency is the source of truth
    instruments: [input.accountCurrency],
    primary: input.base,
    knownRates: input.rates,
  });
  if (!cr.ok) return null; // unresolved / fx_unavailable → never guess a rate
  const currencyFields = {
    originalCurrency: cr.resolution.original,
    baseCurrency: cr.resolution.base,
    exchangeRateToBase: cr.resolution.exchangeRateToBase,
  };
  const entry: LedgerEntryInput =
    input.kind === "income"
      ? {
          userId: input.userId,
          type: "income",
          effectType: "income",
          category: "income",
          description: input.description,
          originalAmount: amount,
          ...currencyFields,
          destinationAccountId: input.accountId,
          occurredAtISO: input.occurredAtISO,
          inputChannel: "system",
          rawInput: "auto: ingreso recurrente",
          dedupeKey: input.dedupeKey,
        }
      : {
          userId: input.userId,
          type: "expense",
          effectType: "expense",
          category: "other",
          description: input.description,
          originalAmount: amount,
          ...currencyFields,
          sourceAccountId: input.isCard ? null : input.accountId,
          debtAccountId: input.isCard ? input.accountId : null,
          recurringExpenseId: input.sourceLinkId,
          occurredAtISO: input.occurredAtISO,
          inputChannel: "system",
          rawInput: "auto: gasto fijo recurrente",
          dedupeKey: input.dedupeKey,
        };
  try {
    const sb = createSupabaseAdminClient();
    const txId = await applyLedgerEntry(sb, entry);
    return { txId, preexisting: false };
  } catch {
    return null;
  }
}

// Append-only reversal of a previously-booked occurrence (used on "no vino" / a correction).
// Idempotent: a second call returns the existing reversal id. Returns the reversal id or null.
export async function reverseRecurring(userId: string, transactionId: string): Promise<string | null> {
  try {
    const sb = createSupabaseAdminClient();
    return await applyLedgerReversal(sb, {
      userId,
      originalTransactionId: transactionId,
      rawInput: "recurring: reversa (no vino / corrección)",
      inputChannel: "system",
    });
  } catch {
    return null;
  }
}
