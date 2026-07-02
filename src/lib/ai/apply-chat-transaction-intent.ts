import { randomUUID } from "crypto";
import {
  buildChatActionResult,
  buildChatTransactionSuccessResult,
  type ChatTransactionResult,
} from "@/lib/ai/chat-transaction-result";
import type { ChatResponseFinancialContext } from "@/lib/ai/chat-response-mapper";
import type { GoalPlanSummary } from "@/lib/ai/goal-aware-response-copy";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import type { StoredTransaction } from "@/lib/financial/transaction-recovery";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { Account, DebtAccount, FinancialGoal } from "@/types/financial";
import type { TransactionParserResult } from "@/lib/ai/transaction-parser-contract";
import type { TransactionIntent } from "@/types/transaction-intents";

// Money in Kipu voice for the deterministic confirmation copy this module
// owns (transfer / undo / correction): "50$" / "3.50$", sign after the number.
function kipuMoney(amount: number, currency: string): string {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

export function channelToInputChannel(channel?: ChatChannel): string {
  return channel === "web" ? "web" : "chat";
}

// ── Canonical atomic ledger writer ──────────────────────────────────────────
// Every transaction-ledger mutation (forward, reversal, adjustment, manual) goes
// through ONE Postgres function (migration 019). The function inserts the row
// AND applies balance/debt/goal effects as DELTAS against the authoritative
// current DB state, all in a single transaction. This is what makes multiple
// movements to the same account in one turn accumulate correctly (C1), makes a
// reverse-then-reapply correction use post-reversal state (C2), and makes the
// row + its balance effect one all-or-nothing unit (H2). The LLM never writes
// the DB directly; it calls typed executors that call this writer.

export type LedgerEffectType =
  | "expense"
  | "income"
  | "transfer"
  | "debt_payment"
  | "goal_contribution"
  | "refund"
  | "adjustment";

export interface LedgerEntryInput {
  userId: string;
  // The stored transaction_type (e.g. "reversal" for a reversal row).
  type: string;
  // Which delta pattern to apply; defaults to `type` when omitted.
  effectType: LedgerEffectType;
  // +1 normal, -1 to reverse the effect (reversal rows).
  sign?: 1 | -1;
  description: string;
  // Optional: the DB function defaults a missing/blank category to 'other'.
  category?: string;
  originalAmount: number;
  originalCurrency: string;
  exchangeRateToBase?: number;
  baseAmount?: number;
  baseCurrency?: string;
  sourceAccountId?: string | null;
  destinationAccountId?: string | null;
  debtAccountId?: string | null;
  goalId?: string | null;
  relatedTransactionId?: string | null;
  recurringExpenseId?: string | null;
  confidenceScore?: number;
  rawInput?: string;
  inputChannel?: string;
  occurredAtISO?: string | null;
  evidenceId?: string | null;
  externalRef?: string | null;
  // Optional durable idempotency key: a repeated call with the same key returns
  // the already-committed id instead of writing again (Phase 3 web support).
  dedupeKey?: string | null;
}

// Error that preserves the Postgres SQLSTATE so callers can distinguish a
// unique-violation (e.g. an already-existing reversal) from other failures.
export class LedgerWriteError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "LedgerWriteError";
    this.code = code;
  }
}

export function mapWriteError(error: { code?: string; message: string; details?: string }): Error {
  return new LedgerWriteError(error.message, error.code);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof LedgerWriteError && error.code === "23505";
}

export function isOwnershipViolation(error: unknown): boolean {
  return (
    error instanceof LedgerWriteError &&
    (error.code === "42501" || /KIPU_OWNERSHIP/.test(error.message))
  );
}

// Serialize a ledger entry into the jsonb payload the DB function expects.
// Exported so manual dashboard server actions (which use the authenticated,
// RLS-scoped client) can call the same atomic function without re-implementing
// balance math.
export function buildLedgerEntryPayload(e: LedgerEntryInput): Record<string, unknown> {
  const rate = e.exchangeRateToBase ?? 1;
  return {
    user_id: e.userId,
    type: e.type,
    effect_type: e.effectType,
    sign: e.sign ?? 1,
    description: e.description,
    category: e.category ?? null,
    original_amount: e.originalAmount,
    original_currency: e.originalCurrency,
    exchange_rate_to_base: rate,
    base_amount: e.baseAmount ?? e.originalAmount * rate,
    base_currency: e.baseCurrency ?? e.originalCurrency,
    source_account_id: e.sourceAccountId ?? null,
    destination_account_id: e.destinationAccountId ?? null,
    debt_account_id: e.debtAccountId ?? null,
    goal_id: e.goalId ?? null,
    related_transaction_id: e.relatedTransactionId ?? null,
    recurring_expense_id: e.recurringExpenseId ?? null,
    confidence_score: e.confidenceScore ?? 1,
    raw_input: e.rawInput ?? null,
    input_channel: e.inputChannel ?? "web",
    occurred_at: e.occurredAtISO ?? new Date().toISOString(),
    evidence_id: e.evidenceId ?? null,
    external_ref: e.externalRef ?? null,
    dedupe_key: e.dedupeKey ?? null,
  };
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

// Apply ONE ledger entry atomically. Returns the inserted (or, for an
// idempotency-key hit, the existing) transaction id.
export async function applyLedgerEntry(
  supabase: AdminClient,
  entry: LedgerEntryInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("kipu_apply_ledger_entry", {
    p_entry: buildLedgerEntryPayload(entry),
  });
  if (error) throw mapWriteError(error);
  return data as string;
}

// Apply SEVERAL entries as one all-or-nothing transaction. Either every row
// commits (balances to the same account accumulate correctly) or none does.
export async function applyLedgerEntriesAtomic(
  entries: LedgerEntryInput[],
): Promise<string[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_apply_ledger_batch", {
    p_entries: entries.map(buildLedgerEntryPayload),
  });
  if (error) throw mapWriteError(error);
  return (data as string[] | null) ?? [];
}

export interface ApplyChatTransactionIntentInput {
  userId: string;
  message: string;
  intent: TransactionIntent;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  parserSource?: TransactionParserResult["source"];
  parserConfidenceScore?: number;
  recurringExpenseId?: string;
  fixedExpenseName?: string;
  channel?: ChatChannel;
  chatId?: string | null;
  // Trusted provenance (set by the capture pipeline, never by the model): the
  // evidence row this movement came from, the bank reference (surfaced to the
  // matcher for cross-channel dedup), and the real occurrence date.
  evidenceId?: string | null;
  externalRef?: string | null;
  occurredAtISO?: string | null;
  // Phase 3 — deterministic per-movement idempotency key (operation namespace +
  // fingerprint + occurrence). Makes a redelivered single-movement turn (transfer,
  // person payment, legacy parse) idempotent at the ledger.
  dedupeKey?: string | null;
  // When set, the success result uses this exact message and skips the
  // coach-response/OpenAI call entirely (caller already owns final copy).
  coachMessageOverride?: string;
}

export async function applyChatTransactionIntent({
  userId,
  message,
  intent,
  accounts,
  debtAccounts,
  goals,
  parserSource,
  parserConfidenceScore,
  recurringExpenseId,
  fixedExpenseName,
  channel,
  chatId,
  evidenceId,
  externalRef,
  occurredAtISO,
  dedupeKey,
  coachMessageOverride,
}: ApplyChatTransactionIntentInput) {
  const supabase = createSupabaseAdminClient();
  const inputChannel = channelToInputChannel(channel);
  // Honest FX at the writer boundary: when the intent's currency differs from the
  // user's base, a missing/implicit rate must NOT silently become 1 (that lie then
  // pollutes every base_amount sum: Margen, activity, week pace). Resolve from the
  // user's KNOWN rates (manual outranks cached); if none exist, keep the prior
  // behavior unchanged — Kipu never invents a rate. Base-currency intents (the vast
  // majority) take the exact previous path.
  let rate = intent.exchangeRateToBase ?? 1;
  let resolvedBaseCurrency = intent.baseCurrency ?? intent.originalCurrency;
  const intentCurrency = (intent.originalCurrency ?? "").trim().toUpperCase();
  if (intentCurrency) {
    const { data: profRow } = await supabase
      .from("profiles")
      .select("base_currency")
      .eq("id", userId)
      .maybeSingle();
    const profileBase = (
      ((profRow as { base_currency?: string | null } | null)?.base_currency ??
        resolvedBaseCurrency) || "USD"
    )
      .trim()
      .toUpperCase();
    if (intentCurrency !== profileBase) {
      resolvedBaseCurrency = profileBase;
      const rateMissing = intent.exchangeRateToBase == null || intent.exchangeRateToBase === 1;
      if (rateMissing) {
        const { loadFxRates, loadLatestCachedRates } = await import("@/lib/fx/fx-store");
        const { convert } = await import("@/lib/fx/fx-rates");
        const [manual, cached] = await Promise.all([
          loadFxRates(userId),
          loadLatestCachedRates(intentCurrency, profileBase),
        ]);
        const res = convert(intent.originalAmount, intentCurrency, profileBase, [
          ...manual,
          ...cached,
        ]);
        if (res.ok) rate = res.rate;
      }
    }
  }
  // Shared provenance + base-amount math for every entry in this call.
  const common = {
    userId,
    rawInput: message,
    inputChannel,
    evidenceId: evidenceId ?? null,
    externalRef: externalRef ?? null,
    occurredAtISO: occurredAtISO ?? null,
    dedupeKey: dedupeKey ?? null,
    confidenceScore: intent.confidenceScore,
  };

  if (intent.type === "income") {
    const destinationAccount = accounts.find(
      (account) => account.id === intent.destinationAccountId,
    );
    if (!destinationAccount) {
      throw new Error("chat-income-account-not-found");
    }

    await applyLedgerEntry(supabase, {
      ...common,
      type: "income",
      effectType: "income",
      description: intent.description,
      category: intent.category,
      originalAmount: intent.originalAmount,
      originalCurrency: intent.originalCurrency,
      exchangeRateToBase: rate,
      baseAmount: intent.originalAmount * rate,
      baseCurrency: resolvedBaseCurrency,
      destinationAccountId: intent.destinationAccountId,
    });

    const financialContext = await loadChatResponseFinancialContext(userId);
    return buildChatTransactionSuccessResult({
      intent,
      accountName: destinationAccount.name,
      financialContext,
      parserSource,
      parserConfidenceScore,
      userId,
      channel,
      chatId,
    });
  }

  if (intent.type === "debt_payment") {
    const sourceAccount = accounts.find((account) => account.id === intent.sourceAccountId);
    const debtAccount = debtAccounts.find((debt) => debt.id === intent.debtAccountId);
    if (!sourceAccount) {
      throw new Error("chat-parser-account-not-found");
    }
    if (!debtAccount) {
      throw new Error("chat-parser-debt-account-not-found");
    }

    await applyLedgerEntry(supabase, {
      ...common,
      type: "debt_payment",
      effectType: "debt_payment",
      description: intent.description,
      category: intent.category,
      originalAmount: intent.originalAmount,
      originalCurrency: intent.originalCurrency,
      exchangeRateToBase: rate,
      baseAmount: intent.originalAmount * rate,
      baseCurrency: resolvedBaseCurrency,
      sourceAccountId: intent.sourceAccountId,
      debtAccountId: intent.debtAccountId,
    });

    const financialContext = await loadChatResponseFinancialContext(userId);
    return buildChatTransactionSuccessResult({
      intent,
      accountName: sourceAccount.name,
      debtAccountName: debtAccount.name,
      financialContext,
      parserSource,
      parserConfidenceScore,
      userId,
      channel,
      chatId,
    });
  }

  if (intent.type === "goal_contribution") {
    const sourceAccount = accounts.find((account) => account.id === intent.sourceAccountId);
    const goal = goals.find((item) => item.id === intent.goalId);
    if (!sourceAccount) {
      throw new Error("chat-parser-account-not-found");
    }
    if (!goal) {
      throw new Error("chat-parser-goal-not-found");
    }

    await applyLedgerEntry(supabase, {
      ...common,
      type: "goal_contribution",
      effectType: "goal_contribution",
      description: intent.description,
      category: intent.category,
      originalAmount: intent.originalAmount,
      originalCurrency: intent.originalCurrency,
      exchangeRateToBase: rate,
      baseAmount: intent.originalAmount * rate,
      baseCurrency: resolvedBaseCurrency,
      sourceAccountId: intent.sourceAccountId,
      destinationAccountId: intent.destinationAccountId || null,
      goalId: intent.goalId,
    });

    const financialContext = await loadChatResponseFinancialContext(userId);
    return buildChatTransactionSuccessResult({
      intent,
      goalName: goal.name,
      financialContext,
      parserSource,
      parserConfidenceScore,
      userId,
      channel,
      chatId,
    });
  }

  if (intent.type === "expense") {
    const account = intent.sourceAccountId
      ? accounts.find((item) => item.id === intent.sourceAccountId)
      : undefined;
    const debtAccount = intent.debtAccountId
      ? debtAccounts.find((item) => item.id === intent.debtAccountId)
      : undefined;
    if (intent.sourceAccountId && !account) {
      throw new Error("chat-parser-account-not-found");
    }
    if (intent.debtAccountId && !debtAccount) {
      throw new Error("chat-parser-debt-account-not-found");
    }

    await applyLedgerEntry(supabase, {
      ...common,
      type: "expense",
      effectType: "expense",
      description: intent.description,
      category: intent.category,
      originalAmount: intent.originalAmount,
      originalCurrency: intent.originalCurrency,
      exchangeRateToBase: rate,
      baseAmount: intent.originalAmount * rate,
      baseCurrency: resolvedBaseCurrency,
      sourceAccountId: intent.sourceAccountId ?? null,
      debtAccountId: intent.debtAccountId ?? null,
      recurringExpenseId: recurringExpenseId ?? null,
    });

    const financialContext = await loadChatResponseFinancialContext(userId);
    return buildChatTransactionSuccessResult({
      intent,
      accountName: account?.name,
      debtAccountName: debtAccount?.name,
      financialContext,
      parserSource,
      parserConfidenceScore,
      fixedExpenseName,
      userId,
      channel,
      chatId,
      coachMessageOverride,
    });
  }

  if (intent.type === "refund") {
    const destination = accounts.find((item) => item.id === intent.destinationAccountId);
    if (!destination) {
      throw new Error("chat-refund-account-not-found");
    }

    await applyLedgerEntry(supabase, {
      ...common,
      type: "refund",
      effectType: "refund",
      description: intent.description,
      category: intent.category ?? "other",
      originalAmount: intent.originalAmount,
      originalCurrency: intent.originalCurrency,
      exchangeRateToBase: rate,
      baseAmount: intent.originalAmount * rate,
      baseCurrency: resolvedBaseCurrency,
      destinationAccountId: intent.destinationAccountId,
      relatedTransactionId: intent.relatedTransactionId ?? null,
    });

    const amountText = kipuMoney(intent.originalAmount, intent.originalCurrency);
    return buildChatActionResult({
      redirectCode: "chat-income-created",
      message: `Listo, registré ${amountText} que te devolvieron a ${destination.name}. Lo cuento como reembolso, no como ingreso nuevo, para no inflar lo que ganas.`,
    });
  }

  if (intent.type === "transfer") {
    const source = accounts.find((item) => item.id === intent.sourceAccountId);
    const destination = accounts.find((item) => item.id === intent.destinationAccountId);
    if (!source) {
      throw new Error("chat-transfer-source-not-found");
    }
    if (!destination) {
      throw new Error("chat-transfer-destination-not-found");
    }

    await applyLedgerEntry(supabase, {
      ...common,
      type: "transfer",
      effectType: "transfer",
      description: intent.description,
      category: intent.category ?? "other",
      originalAmount: intent.originalAmount,
      originalCurrency: intent.originalCurrency,
      exchangeRateToBase: rate,
      baseAmount: intent.originalAmount * rate,
      baseCurrency: resolvedBaseCurrency,
      sourceAccountId: intent.sourceAccountId,
      destinationAccountId: intent.destinationAccountId,
    });

    const amountText = kipuMoney(intent.originalAmount, intent.originalCurrency);
    return buildChatActionResult({
      redirectCode: "chat-transfer-created",
      message: `Listo, moví ${amountText} de ${source.name} a ${destination.name}. Es solo un movimiento entre tus cuentas, no lo cuento como gasto ni ingreso.`,
    });
  }

  throw new Error("chat-parser-unsupported");
}

// ── Audit-safe reversal + correction writers ────────────────────────────────
// Reversal is append-only (a `reversal` row linked via related_transaction_id)
// and idempotent — never a hard delete. The atomic writer applies the EXACT
// inverse balance effect (sign = -1 on the original's effect type) in the same
// transaction as the reversal row. A partial unique index (migration 019)
// guarantees at most one reversal per original even under a concurrent double-undo.

export interface ReverseStoredTransactionResult {
  ok: boolean;
  alreadyReversed: boolean;
}

// Append a `reversal` row + apply the exact inverse effect, deriving EVERYTHING
// (effect, amounts, currencies, accounts) from the original row INSIDE the DB —
// the caller is trusted only for the owned original id. Idempotent and
// race-safe (the function returns the existing reversal; the unique index is the
// backstop). Returns the reversal/original id, or null if nothing was written.
export async function applyLedgerReversal(
  supabase: AdminClient,
  input: {
    userId: string;
    originalTransactionId: string;
    rawInput?: string;
    inputChannel?: string;
    occurredAtISO?: string;
  },
): Promise<string | null> {
  const { data, error } = await supabase.rpc("kipu_apply_ledger_entry", {
    p_entry: {
      user_id: input.userId,
      type: "reversal",
      sign: -1,
      related_transaction_id: input.originalTransactionId,
      raw_input: input.rawInput ?? null,
      input_channel: input.inputChannel ?? "web",
      occurred_at: input.occurredAtISO ?? new Date().toISOString(),
    },
  });
  if (error) throw mapWriteError(error);
  return (data as string | null) ?? null;
}

// Idempotently reverse one stored transaction. Safe to call twice — the second
// call is a no-op (pre-check, the in-function check, OR the unique index).
export async function reverseStoredTransaction(input: {
  userId: string;
  transaction: StoredTransaction;
  message: string;
  channel?: ChatChannel;
}): Promise<ReverseStoredTransactionResult> {
  const supabase = createSupabaseAdminClient();
  const { userId, transaction: tx } = input;

  // A reversal/adjustment-of-adjustment is not reversed here; the DB also rejects
  // reversing a reversal.
  if (tx.type === "reversal") {
    return { ok: false, alreadyReversed: true };
  }

  const { count } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "reversal")
    .eq("related_transaction_id", tx.id);
  if ((count ?? 0) > 0) {
    return { ok: false, alreadyReversed: true };
  }

  try {
    await applyLedgerReversal(supabase, {
      userId,
      originalTransactionId: tx.id,
      rawInput: input.message,
      inputChannel: channelToInputChannel(input.channel),
    });
  } catch (error) {
    // Lost the race to another reversal of the same original → already reversed.
    if (isUniqueViolation(error)) {
      return { ok: false, alreadyReversed: true };
    }
    throw error;
  }

  return { ok: true, alreadyReversed: false };
}

// Update only descriptive metadata (category / description) in place. No
// balance change — safe for "era comida, no transporte" style corrections.
// Surfaces DB errors and requires exactly one OWNED row to be updated, so a
// cross-user/nonexistent id can never be reported as a successful correction.
export async function correctTransactionMetadata(input: {
  userId: string;
  transactionId: string;
  category?: string;
  description?: string;
}): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const patch: Record<string, string> = {};
  if (input.category) patch.category = input.category;
  if (input.description) patch.description = input.description;
  if (Object.keys(patch).length === 0) return;
  const { data, error } = await supabase
    .from("transactions")
    .update(patch)
    .eq("id", input.transactionId)
    .eq("user_id", input.userId)
    .select("id")
    .maybeSingle();
  if (error) throw mapWriteError(error);
  if (!data?.id) {
    throw new LedgerWriteError("KIPU_NOT_FOUND: transaction not found or not owned");
  }
}

export interface ReconcileAccountResult {
  ok: boolean;
  delta: number;
  newBalanceBase: number;
  alreadyMatched: boolean;
}

// Reconcile one account to a TARGET balance (migration 020). The delta is
// computed from the AUTHORITATIVE live balance under a row lock, so the account
// equals the target at THIS transaction's serialization point; a normal movement
// serialized afterward applies normally on top (nothing is lost). Durable
// idempotency: a trusted server-generated operation id makes a retry of the SAME
// request return the original result instead of recalculating against a later
// balance. Only an account whose currency equals the user's base currency can be
// reconciled here; a non-base account is rejected (KIPU_FX_REQUIRED).
//
// `operationId` should be stable across retries of the SAME logical request. It
// is generated server-side here (never from model content); wiring a
// channel-stable token across genuine HTTP retries is Phase 3.
export async function reconcileAccountBalance(input: {
  userId: string;
  account: Account;
  targetBalanceBase: number;
  message: string;
  channel?: ChatChannel;
  operationId?: string;
}): Promise<ReconcileAccountResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_reconcile_account_balance", {
    p: {
      user_id: input.userId,
      account_id: input.account.id,
      target_base: input.targetBalanceBase,
      operation_id: input.operationId ?? randomUUID(),
      raw_input: input.message,
      input_channel: channelToInputChannel(input.channel),
    },
  });
  if (error) throw mapWriteError(error);
  const r = (data ?? {}) as { delta?: number; new_balance?: number; already_matched?: boolean };
  return {
    ok: true,
    delta: Number(r.delta ?? 0),
    newBalanceBase: Number(r.new_balance ?? input.account.currentBalanceBase),
    alreadyMatched: !!r.already_matched,
  };
}

// Build the canonical ledger entry for a parsed intent (shared by the correction
// workflow). Mirrors the per-type mapping the chat writer uses.
function intentToLedgerEntry(
  intent: TransactionIntent,
  base: {
    userId: string;
    rawInput?: string;
    inputChannel?: string;
    evidenceId?: string | null;
    externalRef?: string | null;
    occurredAtISO?: string | null;
    recurringExpenseId?: string | null;
  },
): LedgerEntryInput {
  const rate = intent.exchangeRateToBase ?? 1;
  const common = {
    userId: base.userId,
    rawInput: base.rawInput,
    inputChannel: base.inputChannel,
    evidenceId: base.evidenceId ?? null,
    externalRef: base.externalRef ?? null,
    occurredAtISO: base.occurredAtISO ?? null,
    confidenceScore: intent.confidenceScore,
    description: intent.description,
    originalAmount: intent.originalAmount,
    originalCurrency: intent.originalCurrency,
    exchangeRateToBase: rate,
    baseAmount: intent.originalAmount * rate,
    baseCurrency: intent.baseCurrency ?? intent.originalCurrency,
  };
  switch (intent.type) {
    case "income":
      return { ...common, type: "income", effectType: "income", category: intent.category, destinationAccountId: intent.destinationAccountId };
    case "debt_payment":
      return { ...common, type: "debt_payment", effectType: "debt_payment", category: intent.category, sourceAccountId: intent.sourceAccountId, debtAccountId: intent.debtAccountId };
    case "goal_contribution":
      return { ...common, type: "goal_contribution", effectType: "goal_contribution", category: intent.category, sourceAccountId: intent.sourceAccountId, destinationAccountId: intent.destinationAccountId || null, goalId: intent.goalId };
    case "expense":
      return { ...common, type: "expense", effectType: "expense", category: intent.category, sourceAccountId: intent.sourceAccountId ?? null, debtAccountId: intent.debtAccountId ?? null, recurringExpenseId: base.recurringExpenseId ?? null };
    case "refund":
      return { ...common, type: "refund", effectType: "refund", category: intent.category ?? "other", destinationAccountId: intent.destinationAccountId, relatedTransactionId: intent.relatedTransactionId ?? null };
    case "transfer":
      return { ...common, type: "transfer", effectType: "transfer", category: intent.category ?? "other", sourceAccountId: intent.sourceAccountId, destinationAccountId: intent.destinationAccountId };
    default:
      throw new LedgerWriteError("chat-parser-unsupported");
  }
}

// Balance-impacting correction as ONE atomic financial operation (migration
// 020): the reversal of the original AND the corrected replacement either both
// commit or neither does — never the original-reversed-without-replacement
// partial state. Idempotent: the reversal is one-per-original, and the corrected
// row carries a server-derived dedupe key, so a retry can't double-reverse or
// duplicate the replacement.
export async function correctTransactionByReplacement(input: {
  userId: string;
  original: StoredTransaction;
  correctedIntent: TransactionIntent;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  message: string;
  channel?: ChatChannel;
  chatId?: string | null;
}): Promise<ChatTransactionResult> {
  const supabase = createSupabaseAdminClient();
  const corrected = intentToLedgerEntry(input.correctedIntent, {
    userId: input.userId,
    rawInput: input.message,
    inputChannel: channelToInputChannel(input.channel),
  });
  const { error } = await supabase.rpc("kipu_correct_ledger_entry", {
    p_correction: {
      user_id: input.userId,
      original_transaction_id: input.original.id,
      corrected: buildLedgerEntryPayload(corrected),
      raw_input: input.message,
      input_channel: channelToInputChannel(input.channel),
    },
  });
  if (error) throw mapWriteError(error);
  // Neither consumer (legacy recovery handler, agent tool) renders this message
  // — they build their own copy — so a concise confirmation is sufficient.
  return buildChatActionResult({
    redirectCode: "chat-correction-created",
    message: "Listo, corregí el movimiento y ajusté tus saldos.",
  });
}

async function loadChatResponseFinancialContext(
  userId: string,
): Promise<ChatResponseFinancialContext | undefined> {
  let context;
  try {
    context = await buildUserFinancialContext(userId);
  } catch {
    return undefined;
  }

  if (!context.dashboard) {
    return undefined;
  }

  // One truth: the post-log confirmation quotes the SAME Margen Kipu the
  // dashboard hero shows (not the older flexible-spending weekly plan), so the
  // number the user just saw on /app and the number Kipu says after logging a
  // gasto can never disagree. Best-effort: briefing failure falls back.
  let weeklyLeft = context.dashboard.flexibleSpending.flexibleSpending;
  let dailyLeft = context.dashboard.weeklyPlan.dailySuggestedLimit;
  try {
    const { deriveAdvisorySnapshot } = await import("@/lib/ai/advisory-handler");
    const { buildCoachingBriefing } = await import("@/lib/financial/coaching-signals");
    const briefing = await buildCoachingBriefing({
      userId,
      ctx: context,
      snapshot: deriveAdvisorySnapshot(context),
      surfaceNudges: false,
    });
    weeklyLeft = briefing.margenKipu.margenWeekly;
    dailyLeft = briefing.margenKipu.margenDaily;
  } catch {
    // keep legacy figures
  }

  return {
    flexibleSpending: weeklyLeft,
    dailySuggestedLimit: dailyLeft,
    baseCurrency: context.dashboard.weeklyPlan.baseCurrency,
    goalPlanSummary: toGoalPlanSummary(context.mainGoal, context.goalPlan),
  };
}

function toGoalPlanSummary(
  mainGoal: FinancialGoal | null,
  goalPlan: Awaited<ReturnType<typeof buildUserFinancialContext>>["goalPlan"],
): GoalPlanSummary | undefined {
  if (!mainGoal) {
    return undefined;
  }

  return {
    status: goalPlan.status,
    goalName: mainGoal.name,
    hasGoal: true,
    hasDeadline: !!goalPlan.targetDate,
    suppressContributionPush: goalPlan.suppressContributionPush,
  };
}
