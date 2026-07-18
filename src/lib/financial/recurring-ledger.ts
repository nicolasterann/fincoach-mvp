import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  applyCardPaymentEntry,
  applyLedgerEntry,
  applyLedgerReversal,
  type LedgerEntryInput,
} from "@/lib/ai/apply-chat-transaction-intent";
import { incrementAssetValue } from "@/lib/financial/assets-store";
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
  kind: "income" | "expense" | "debt_payment";
  nativeAmount: number;
  nativeCurrency: string | null;
  base: string;
  rates: FxRate[];
  accountId: string; // destination (income) / source (cash expense OR debt_payment) / debt (card expense)
  accountCurrency: string | null; // for FX resolution fallback; null when a card currency is unknown
  isCard: boolean; // expense charged to a credit card (debt up, no cash out today)
  // debt_payment only: the debt (loan / family / card) being paid DOWN. accountId is the CASH
  // source; debtAccountId is the liability whose balance drops. debtCurrency helps FX resolve.
  debtAccountId?: string | null;
  debtCurrency?: string | null;
  // debt_payment on a CREDIT CARD: the card's current statement ("pago del mes"). After booking,
  // the F2 reduction lowers full_payment_due by what was paid (in the card's own currency).
  cardStatementDue?: number | null;
  // Only a FIXED-EXPENSE-backed expense may set this (the RPC validates it against fixed_expenses
  // and rejects any other id). Null for a scheduled payment / income / debt / reserve.
  recurringExpenseId?: string | null;
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
    // A cash-flow (income/expense) is matched in a tight ±3-day window. A DEBT payment (a monthly
    // cuota / card statement) may have been logged manually anywhere earlier in the cycle, so look
    // back a full ~month to avoid auto-booking a second payment on top of it (amount+debt still
    // must match, so a legitimately different extra payment is not falsely deduped).
    from.setUTCDate(from.getUTCDate() - (input.kind === "debt_payment" ? 27 : 3));
    to.setUTCDate(to.getUTCDate() + 3);
    const tol = Math.max(0.01, amount * 0.02); // 2% or a cent, whichever is larger
    // Narrow the candidates BY AMOUNT in the query so the row cap only ever applies to rows that
    // could actually match (a busy account could otherwise push the real duplicate past the cap).
    const candRes = await sb
      .from("transactions")
      .select("id, original_amount, original_currency, source_account_id, destination_account_id, debt_account_id")
      .eq("user_id", input.userId)
      .eq("type", input.kind)
      .gte("occurred_at", from.toISOString())
      .lte("occurred_at", to.toISOString())
      .gte("original_amount", amount - tol)
      .lte("original_amount", amount + tol)
      .limit(200);
    if (candRes.error) return { ok: false, txId: null };
    const candidates = (candRes.data ?? []) as Record<string, unknown>[];
    const candidateIds = candidates.map((r) => String(r.id));
    // Which of THESE candidates are already reversed, or are themselves a recurring flow's OWN
    // booked row (claimed by an occurrence)? Both are excluded. Excluding occurrence-claimed rows
    // is the key cross-flow guard: findAlreadyRecorded exists ONLY to avoid double-booking on top
    // of a MANUAL log — same-flow reruns are handled by the occurrence unique index + the
    // per-occurrence dedupeKey, so another flow's auto-book (same amount, shared account, ±3 days)
    // must NOT be mistaken for this flow's duplicate. debt_payment is already source-exact via
    // debt_account_id; this makes income/expense equally safe. Both lookups are scoped to the
    // exact candidate ids (bounded + exact).
    let excluded = new Set<string>();
    if (candidateIds.length > 0) {
      const [revRes, claimRes] = await Promise.all([
        sb.from("transactions").select("related_transaction_id").eq("user_id", input.userId).eq("type", "reversal").in("related_transaction_id", candidateIds),
        sb.from("recurring_occurrences").select("created_transaction_id").eq("user_id", input.userId).in("created_transaction_id", candidateIds),
      ]);
      if (revRes.error || claimRes.error) return { ok: false, txId: null };
      excluded = new Set([
        ...(revRes.data ?? []).map((r) => String((r as Record<string, unknown>).related_transaction_id ?? "")),
        ...(claimRes.data ?? []).map((r) => String((r as Record<string, unknown>).created_transaction_id ?? "")),
      ].filter(Boolean));
    }
    // The account that identifies THIS movement: income → destination; debt_payment → the debt
    // being paid (stable id, source may vary); cash/card expense → source or the charged card.
    const wantAcct =
      input.kind === "debt_payment" ? (input.debtAccountId ?? input.accountId) : input.accountId;
    for (const r of candidates) {
      if (excluded.has(String(r.id))) continue; // reversed OR another recurring flow's own row
      const rowAmt = Number(r.original_amount);
      const rowCur = String(r.original_currency ?? "").toUpperCase();
      if (input.nativeCurrency && rowCur && rowCur !== String(input.nativeCurrency).toUpperCase()) continue;
      if (!Number.isFinite(rowAmt) || Math.abs(rowAmt - amount) > tol) continue;
      const acct =
        input.kind === "income"
          ? String(r.destination_account_id ?? "")
          : input.kind === "debt_payment"
            ? String(r.debt_account_id ?? "")
            : String(r.source_account_id ?? r.debt_account_id ?? "");
      if (acct && acct === wantAcct) return { ok: true, txId: String(r.id) };
      if (!acct) return { ok: true, txId: String(r.id) };
    }
    return { ok: true, txId: null };
  } catch {
    return { ok: false, txId: null };
  }
}

// Book ONE occurrence into the ledger (native amount + resolved FX).
//
// Re-auditoría 3 (punto 2): el retorno es una UNIÓN DISCRIMINADA — el `null` viejo
// mezclaba tres cosas MUY distintas: "no se puede por diseño" (sin tasa confiable,
// monto inválido), "no pude VERIFICAR" (dup-check ilegible) y "el write del ledger
// falló". El caller las contaba todas como `skipped` con el cron verde, y un gasto
// fijo podía quedar fuera del ledger indefinidamente (el Saldo inflado mientras
// tanto). Ahora: `blocked` = funcional (queda pending y el usuario resuelve por
// chat); `failed` = INFRA (cuenta error ⇒ 5xx y la ocurrencia queda REINTENTABLE).
// ALWAYS runs the duplicate check (a manual log or an orphaned auto-book must never
// be double-booked); the dedupeKey is a second net for cron reruns.
export type BookRecurringResult =
  | { status: "booked"; txId: string; preexisting: boolean }
  | { status: "blocked"; reason: "invalid_amount" | "missing_debt" | "fx_unavailable" }
  | { status: "failed" };

// Auditoría 4 (punto 4) — seam inyectable para probar el TRAYECTO del caller real
// (mismo patrón que updateSharedExpenseWith): el gate recorre atómico/plano/replay/
// conflicto sin base de datos; bookRecurring lo cablea con los ejecutores reales.
export interface BookRecurringDeps {
  findDup: (input: BookInput) => Promise<{ ok: boolean; txId: string | null }>;
  applyEntry: (entry: LedgerEntryInput) => Promise<string>;
  applyCardPayment: (
    entry: LedgerEntryInput,
    statement: { debtAccountId: string; expectedDue: number; paidInCardCurrency: number },
  ) => Promise<
    | { ok: true; transactionId: string; replayed: boolean; statementReduced: boolean }
    | { ok: false; reason: "conflict" | "write_failed" }
  >;
}

export async function bookRecurring(input: BookInput): Promise<BookRecurringResult> {
  return bookRecurringWith(
    {
      findDup: findAlreadyRecorded,
      applyEntry: (entry) => applyLedgerEntry(createSupabaseAdminClient(), entry),
      applyCardPayment: applyCardPaymentEntry,
    },
    input,
  );
}

export async function bookRecurringWith(deps: BookRecurringDeps, input: BookInput): Promise<BookRecurringResult> {
  const amount = roundMoney(input.nativeAmount);
  if (!(amount > 0)) return { status: "blocked", reason: "invalid_amount" };
  if (input.kind === "debt_payment" && !input.debtAccountId) return { status: "blocked", reason: "missing_debt" }; // must know the debt
  const dup = await deps.findDup(input);
  if (!dup.ok) return { status: "failed" }; // could not VERIFY → never double-book, y es infra
  if (dup.txId) return { status: "booked", txId: dup.txId, preexisting: true };
  const cr = resolveMovementCurrency({
    explicit: input.nativeCurrency, // the flow's OWN currency is the source of truth
    instruments: [input.accountCurrency, input.debtCurrency ?? null],
    primary: input.base,
    knownRates: input.rates,
  });
  if (!cr.ok) return { status: "blocked", reason: "fx_unavailable" }; // never guess a rate
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
      : input.kind === "debt_payment"
        ? {
            // A loan/card/family-debt payment: cash out of the source account AND the debt's
            // accumulated balance down (the RPC applies both). full_payment_due is reduced
            // separately below (F2), only for a credit card.
            userId: input.userId,
            type: "debt_payment",
            effectType: "debt_payment",
            category: "debt", // the financial_category enum value for a debt payment
            description: input.description,
            originalAmount: amount,
            ...currencyFields,
            sourceAccountId: input.accountId,
            debtAccountId: input.debtAccountId,
            occurredAtISO: input.occurredAtISO,
            inputChannel: "system",
            rawInput: "auto: pago recurrente de deuda",
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
            recurringExpenseId: input.recurringExpenseId ?? null, // ONLY a real fixed_expense id (RPC-validated)
            occurredAtISO: input.occurredAtISO,
            inputChannel: "system",
            rawInput: "auto: gasto fijo recurrente",
            dedupeKey: input.dedupeKey,
          };
  try {
    // F2 — a card statement payment also lowers the pending "pago del mes", but ONLY when the
    // paid amount is expressible in the card's own currency (no fabricated FX). Auditoría 4
    // (punto 4): ledger + baja de full_payment_due van JUNTOS por la RPC atómica
    // (kipu_apply_card_payment, migración 063) — el flujo viejo llamaba
    // reduceCardStatementDue después del ledger IGNORANDO su booleano y el cron podía
    // reportar "booked" con el estado de cuenta intacto. Un replay por dedupe valida
    // contra el ledger sin re-reducir (→ preexisting); un CAS perdido revierte TODO y
    // queda `failed` (reintentable con lectura fresca la próxima corrida).
    if (
      input.kind === "debt_payment" &&
      input.debtAccountId &&
      input.cardStatementDue != null &&
      input.cardStatementDue > 0 &&
      input.debtCurrency &&
      input.nativeCurrency &&
      String(input.debtCurrency).toUpperCase() === String(input.nativeCurrency).toUpperCase()
    ) {
      const applied = await deps.applyCardPayment(entry, {
        debtAccountId: input.debtAccountId,
        expectedDue: input.cardStatementDue,
        paidInCardCurrency: amount,
      });
      if (!applied.ok) return { status: "failed" };
      return { status: "booked", txId: applied.transactionId, preexisting: applied.replayed };
    }
    const txId = await deps.applyEntry(entry);
    return { status: "booked", txId, preexisting: false };
  } catch {
    // El write del ledger no aterrizó (o no lo pudimos probar): INFRA, reintentable.
    return { status: "failed" };
  }
}

// Bloque C — realize an INVESTMENT reserve as a net-worth-NEUTRAL move: the source cash account
// goes DOWN (a ledger row, reversible) and the destination investment asset goes UP by the same,
// so patrimonio neto doesn't change (the money became an asset, it didn't vanish). Used when the
// user confirms "sí, invertí los X" on the monthly investment reserve. If the ledger write lands
// but the asset bump fails, the ledger row is reversed so we never leave cash down without the
// asset up. Returns the tx id + the base/original amounts (for a later reversal), or null.
export async function bookReserveInvestment(input: {
  userId: string;
  sourceAccountId: string;
  sourceAccountCurrency: string | null;
  assetId: string;
  nativeAmount: number;
  nativeCurrency: string | null;
  base: string;
  rates: FxRate[];
  dedupeKey: string;
  occurredAtISO: string;
  description: string;
}): Promise<{ txId: string; baseAmount: number; originalAmount: number } | null> {
  const amount = roundMoney(input.nativeAmount);
  if (!(amount > 0)) return null;
  const cr = resolveMovementCurrency({
    explicit: input.nativeCurrency,
    instruments: [input.sourceAccountCurrency],
    primary: input.base,
    knownRates: input.rates,
  });
  if (!cr.ok) return null; // never fabricate a rate
  const baseAmount = roundMoney(amount * cr.resolution.exchangeRateToBase);
  const entry: LedgerEntryInput = {
    userId: input.userId,
    // The RPC requires type === effectType for normal ops; use 'adjustment' (the only single-sided
    // effect) to reduce ONLY the source account — the asset side is tracked outside the ledger.
    type: "adjustment",
    effectType: "adjustment",
    category: "savings",
    description: input.description,
    originalAmount: amount,
    originalCurrency: cr.resolution.original,
    baseCurrency: cr.resolution.base,
    exchangeRateToBase: cr.resolution.exchangeRateToBase,
    sourceAccountId: input.sourceAccountId,
    occurredAtISO: input.occurredAtISO,
    inputChannel: "system",
    rawInput: "auto: inversión mensual → activo",
    dedupeKey: input.dedupeKey,
  };
  let txId: string;
  try {
    const sb = createSupabaseAdminClient();
    txId = await applyLedgerEntry(sb, entry);
  } catch {
    return null;
  }
  const bumped = await incrementAssetValue(input.userId, input.assetId, baseAmount, amount);
  if (!bumped) {
    await reverseRecurring(input.userId, txId); // keep it net-worth-neutral: undo the cash debit
    return null;
  }
  return { txId, baseAmount, originalAmount: amount };
}

// Undo a booked investment reserve: reverse the cash debit (re-credits the source) AND decrement
// the asset by the same amount, so a skip/correction stays net-worth-neutral. The account side is
// exact (append-only reversal); the asset side is best-effort (a soft, user-revalued number).
export async function reverseReserveInvestment(input: {
  userId: string;
  transactionId: string;
  assetId: string;
  baseAmount: number;
  originalAmount: number;
}): Promise<string | null> {
  const rev = await reverseRecurring(input.userId, input.transactionId);
  if (rev) await incrementAssetValue(input.userId, input.assetId, -input.baseAmount, -input.originalAmount);
  return rev;
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
