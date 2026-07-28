import { createHash, randomUUID } from "crypto";
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
  // Stage H — objetivo mensual treatment flag (migration 051). 'saldo' =
  // user-confirmed extraordinary; null = default (objective semantics for
  // food/transport, unchanged behavior elsewhere).
  budgetTreatment?: "objective" | "saldo" | null;
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
    budget_treatment: e.budgetTreatment ?? null,
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

// Bloque I (re-auditoría) — una devolución de préstamo es UNA operación: el ingreso
// al ledger Y el descuento del receivable aterrizan juntos, o ninguno. El flujo viejo
// escribía el ingreso primero y descontaba después con una lectura fail-open: si esa
// segunda mitad no llegaba, el movimiento quedaba registrado y el préstamo pendiente
// para siempre — presentado como éxito. La RPC (kipu_apply_repayment, migraciones
// 057→059) llama al MISMO single-writer del ledger por dentro y exige el outstanding
// leído como CAS: un conflicto revierte TODO. La frontera v2 lo entrega como
// 22023 para que el caller relea; exponer 40001 haría que la infraestructura
// reintente el mismo expected_outstanding hasta un timeout.
//
// Re-auditoría 2 (punto 3): la RPC ahora exige un dedupe_key — la IDENTIDAD del
// repago. Una respuesta perdida seguida de un retry con la misma identidad devuelve
// `replayed: true` SIN volver a descontar receivables (antes: un ingreso, dos bajas
// de deuda). El caller narra "ya estaba registrada", no un descuento nuevo.
export async function applyRepaymentEntry(
  entry: LedgerEntryInput,
  allocations: { receivableId: string; amount: number; expectedOutstanding: number }[],
): Promise<
  | { ok: true; transactionId: string; matched: number; replayed: boolean }
  | { ok: false; reason: "conflict" | "write_failed" }
> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_apply_repayment_v2", {
    p_entry: buildLedgerEntryPayload(entry),
    p_allocations: allocations.map((a) => ({
      receivable_id: a.receivableId,
      amount: a.amount,
      expected_outstanding: a.expectedOutstanding,
    })),
  });
  if (error) {
    const conflict = error.code === "40001" || /KIPU_CONFLICT/.test(error.message ?? "");
    return { ok: false, reason: conflict ? "conflict" : "write_failed" };
  }
  const row = data as { transaction_id?: string; matched?: number; replayed?: boolean } | null;
  return {
    ok: true,
    transactionId: String(row?.transaction_id ?? ""),
    matched: Number(row?.matched ?? 0),
    replayed: row?.replayed === true,
  };
}

// Bloque J (J-1) — la MONEDA manda la cuenta. El error real de la beta: "gasté
// 33000 ars" aterrizó en la cuenta USD que eligió el LLM y el ledger (019/051)
// restó 33000 del balance EN DÓLARES — resta original-sobre-original sin comparar
// monedas. La decisión es pura y compartida por todos los capture-paths.
//
// Re-auditoría J-1: el contrato distingue ELECCIÓN de OMISIÓN — el plan no sabe
// si `chosen` vino de la boca del usuario o de una suposición del LLM, así que
// un instrumento ELEGIDO pero incompatible se PREGUNTA siempre (sustituirlo en
// silencio registraba el gasto en otra tarjeta que el usuario no nombró); el
// auto-assign existe SOLO con instrumento omitido, y solo sobre cuentas
// ORDINARIAS (ni cuenta-de-meta ni no-líquida — si la única compatible es
// protegida, se pregunta). El prompt ordena al LLM omitir el instrumento cuando
// el usuario no lo nombró y no hay preferencia aprendida.
//   ok              → instrumento en la moneda del movimiento (o sin moneda explícita)
//   assign          → instrumento OMITIDO + exactamente UNA cuenta ordinaria compatible
//   ask/chosen_mismatch → el elegido no está en esa moneda ⇒ preguntar, jamás sustituir
//   ask/only_protected  → la única compatible es protegida ⇒ preguntar
//   ask/none · ask/multiple → cero o varias compatibles ⇒ preguntar
// Re-auditoría 2 (P1): una elección en la MISMA moneda tampoco se acepta a ciegas.
// Con varias cuentas compatibles, que el LLM haya mandado una no prueba nada — la
// EVIDENCIA la computa el EXECUTOR (jamás un booleano auto-afirmado por el LLM):
//   "mentioned" → el nombre/alias del instrumento aparece en el mensaje del usuario
//   "learned"   → la cuenta es el default estructurado de esa moneda
//                 (accounts.is_currency_default, migración 068 — se declara con
//                 update_account, no con texto libre en memoria)
//   "none"      → sin evidencia: si hay VARIAS compatibles ⇒ ask/unproven_choice;
//                 si la elegida es la ÚNICA compatible, elegirla no es ambiguo ⇒ ok.
export type CashAccountCurrencyPlan =
  | { route: "ok" }
  // `basis` evita que la confirmación MIENTA: con dos cuentas ARS y una marcada
  // default, decir "su única cuenta en ARS" era falso (re-auditoría 4, P2).
  | { route: "assign"; accountId: string; accountName: string; basis: "unique" | "default" }
  | {
      route: "ask";
      reason: "chosen_mismatch" | "none" | "multiple" | "only_protected" | "unproven_choice";
      candidates: { id: string; name: string }[];
    };

// J-7 (barrido 1) — decisión PURA sobre las patas de cuenta de un movimiento que
// el ledger mueve con UN SOLO monto (transfer: origen y destino; refund: destino).
// Dos fallos distintos, porque el remedio es distinto:
//   · "exchange"  — las patas discrepan ENTRE SÍ (comprar dólares). No es un dato
//     que falte: es una capacidad que el ledger no sabe expresar. Pedir un tipo de
//     cambio acá sería un cerrojo — el usuario lo daría y no pasaría nunca.
//   · "mismatch"  — las patas coinciden pero el movimiento vino en otra moneda.
//     Eso SÍ es un dato: se pregunta.
export type MovementLegsPlan =
  | { ok: true }
  | { ok: false; kind: "exchange" | "mismatch"; reason: string };

export function planMovementLegsCurrency(input: {
  movementCurrency: string | null | undefined;
  legs: { name: string; currency: string | null | undefined }[];
}): MovementLegsPlan {
  const norm = (v: string | null | undefined) => String(v ?? "").trim().toUpperCase();
  const want = norm(input.movementCurrency);
  const known = input.legs.filter((l) => norm(l.currency) !== "");
  const distinct = new Set(known.map((l) => norm(l.currency)));
  if (distinct.size > 1) {
    const [a, b] = known;
    return {
      ok: false,
      kind: "exchange",
      reason: `${a.name} está en ${norm(a.currency)} y ${b.name} en ${norm(b.currency)}. Cambiar de moneda necesita guardar juntos el monto que salió y el monto distinto que entró; Kipu todavía no tiene esa operación segura, así que no anoté nada. No lo registres como gasto + ingreso porque eso alteraría tu Saldo.`,
    };
  }
  if (!want) return { ok: true };
  const off = known.find((l) => norm(l.currency) !== want);
  if (!off) return { ok: true };
  return {
    ok: false,
    kind: "mismatch",
    reason: `ese movimiento está en ${want} pero "${off.name}" está en ${norm(off.currency)}; decime de qué cuenta en ${want} salió (o el monto en ${norm(off.currency)}) — no registré nada para no corromper el balance`,
  };
}

export function planCashAccountForCurrency(input: {
  currency: string | null;
  chosen: { id: string; name: string; currency: string | null } | null;
  candidates: { id: string; name: string; currency: string | null; ordinary?: boolean; isDefault?: boolean }[];
  chosenEvidence?: "mentioned" | "learned" | "none";
}): CashAccountCurrencyPlan {
  const cur = String(input.currency ?? "").trim().toUpperCase();
  if (!cur) return { route: "ok" };
  const matches = input.candidates.filter(
    (a) => String(a.currency ?? "").trim().toUpperCase() === cur,
  );
  const names = (list: { id: string; name: string }[]) => list.map((a) => ({ id: a.id, name: a.name }));
  if (input.chosen) {
    const chosenCur = String(input.chosen.currency ?? "").trim().toUpperCase();
    if (chosenCur !== cur) {
      return { route: "ask", reason: "chosen_mismatch", candidates: names(matches) };
    }
    const evidence = input.chosenEvidence ?? "none";
    if (evidence === "none" && matches.length > 1) {
      return { route: "ask", reason: "unproven_choice", candidates: names(matches) };
    }
    return { route: "ok" };
  }
  const ordinary = matches.filter((a) => a.ordinary !== false);
  if (ordinary.length === 1) {
    return { route: "assign", accountId: ordinary[0].id, accountName: ordinary[0].name, basis: "unique" };
  }
  if (ordinary.length === 0) {
    return matches.length > 0
      ? { route: "ask", reason: "only_protected", candidates: names(matches) }
      : { route: "ask", reason: "none", candidates: [] };
  }
  // Re-auditoría 3 (P1): con VARIAS compatibles, la preferencia estructurada
  // (accounts.is_currency_default, 068/069 — única por moneda y solo sobre
  // cuentas ordinarias activas) DECIDE. Sin ella, recién ahí es ambiguo. Antes
  // el default era write-only: se guardaba y el camino omitido no lo miraba.
  const defaults = ordinary.filter((a) => a.isDefault === true);
  if (defaults.length === 1) {
    return { route: "assign", accountId: defaults[0].id, accountName: defaults[0].name, basis: "default" };
  }
  return { route: "ask", reason: "multiple", candidates: names(ordinary) };
}

// Pasada 5 (puntos 2-3) — la DECISIÓN de qué camino toma un pago de deuda, pura y
// compartida por TODOS los callers (chat, register_card_payment, log_movement,
// batch y el cron vía bookRecurring): una tarjeta con estado de cuenta vigente va
// por la RPC atómica con el pago expresado en SU moneda. Cuenta, entry y deuda
// deben compartir moneda nativa; si no, el camino plano queda PROHIBIDO
// (blocked_fx ⇒ needs_info) — escribir el ledger dejando full_payment_due intacto
// era media operación reportada como éxito. La única excepción válida al camino
// plano es que genuinamente no exista estado pendiente (o no sea una tarjeta).
export type CardPaymentStatementPlan =
  | { route: "plain" }
  | { route: "atomic"; expectedDue: number; paidInCardCurrency: number }
  | { route: "blocked_fx"; cardCurrency: string };

export function planCardPaymentStatement(input: {
  originalAmount: number;
  originalCurrency: string;
  sourceCurrency: string | null;
  baseAmount: number;
  baseCurrency: string;
  cardType: string | null;
  cardCurrency: string | null;
  fullPaymentDue: number | null;
}): CardPaymentStatementPlan {
  if (!input.cardType) return { route: "plain" };
  const cardCur = String(input.cardCurrency ?? "").trim().toUpperCase();
  const sourceCur = String(input.sourceCurrency ?? "").trim().toUpperCase();
  const originalCur = String(input.originalCurrency ?? "").trim().toUpperCase();
  // El writer genérico de debt_payment resta originalAmount tanto de la cuenta
  // como de la deuda. Por construcción solo es correcto si cuenta, entry y
  // tarjeta comparten moneda nativa. Que baseCurrency coincida con la tarjeta NO
  // alcanza: eso convertiría, por ejemplo, 100.000 ARS en 100.000 USD en la deuda.
  if (!cardCur) return { route: "blocked_fx", cardCurrency: "?" };
  if (!sourceCur || sourceCur !== cardCur || originalCur !== cardCur || !(input.originalAmount > 0)) {
    return { route: "blocked_fx", cardCurrency: cardCur };
  }
  if (input.cardType !== "credit_card") return { route: "plain" };
  const due = input.fullPaymentDue ?? 0;
  if (!(due > 0)) return { route: "plain" };
  return { route: "atomic", expectedDue: due, paidInCardCurrency: input.originalAmount };
}

// Re-auditoría 2 de J-1 (P1) — el cambio de moneda de una cuenta, por RPC atómica
// (068): lock + CAS de moneda/balances + re-conteo de movimientos DENTRO de la
// transacción. Seam inyectable para que el gate recorra sano/conflicto/rechazo.
export async function changeAccountCurrencyWith(
  rpc: (payload: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>,
  input: {
    userId: string;
    accountId: string;
    expectedCurrency: string;
    expectedBalanceOriginal: number;
    expectedBalanceBase: number;
    newCurrency: string;
    newOriginal: number;
    newBase: number;
    reinterpret: boolean;
  },
): Promise<{ ok: true } | { ok: false; reason: "conflict" | "refused" }> {
  try {
    const { data, error } = await rpc({
      user_id: input.userId,
      account_id: input.accountId,
      expected_currency: input.expectedCurrency,
      expected_balance_original: input.expectedBalanceOriginal,
      expected_balance_base: input.expectedBalanceBase,
      new_currency: input.newCurrency,
      new_original: input.newOriginal,
      new_base: input.newBase,
      reinterpret: input.reinterpret,
    });
    if (error) {
      const conflict = error.code === "40001" || /KIPU_CONFLICT/.test(error.message ?? "");
      return { ok: false, reason: conflict ? "conflict" : "refused" };
    }
    // Re-auditoría 3 (P2): una respuesta perdida NO puede reportarse como rechazo
    // cuando el cambio SÍ aterrizó — la RPC devuelve `already_changed` cuando la
    // cuenta ya quedó exactamente como este pedido la dejaría (retry idempotente).
    const row = data as { outcome?: string } | null;
    if (row?.outcome !== "changed" && row?.outcome !== "already_changed") {
      return { ok: false, reason: "refused" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "refused" };
  }
}

// Re-auditoría 3 de J-1 (P1) — el cambio de moneda BASE tenía el MISMO
// check-then-update: contaba cuentas/deudas/movimientos y escribía después. La RPC
// (069) bloquea el perfil, re-verifica dentro de la transacción y hace CAS sobre la
// base leída; el validador monetario toma FOR KEY SHARE sobre esa fila, así que una
// captura concurrente espera y valida contra la base NUEVA.
export async function changeBaseCurrencyWith(
  rpc: (payload: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>,
  input: { userId: string; expectedBase: string; newBase: string },
): Promise<{ ok: true } | { ok: false; reason: "conflict" | "refused" }> {
  try {
    const { data, error } = await rpc({
      user_id: input.userId,
      expected_base: input.expectedBase,
      new_base: input.newBase,
    });
    if (error) {
      const conflict = error.code === "40001" || /KIPU_CONFLICT/.test(error.message ?? "");
      return { ok: false, reason: conflict ? "conflict" : "refused" };
    }
    const row = data as { outcome?: string } | null;
    if (row?.outcome !== "changed" && row?.outcome !== "already_changed") {
      return { ok: false, reason: "refused" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "refused" };
  }
}

// Auditoría 4 (punto 4) — un pago de TARJETA con estado de cuenta vigente es UNA
// operación: el ledger Y la baja de full_payment_due aterrizan juntos, o ninguno.
// El flujo viejo escribía el ledger y llamaba reduceCardStatementDue IGNORANDO su
// booleano — "booked" con el pago del mes intacto (y chequear el booleano después
// no alcanza: el ledger ya había commiteado). La RPC (kipu_apply_card_payment,
// migración 063) exige dedupe_key: un replay valida contra el ledger y NO vuelve
// a reducir; un CAS perdido sobre full_payment_due revierte TODO y vuelve como
// conflicto tipado para releer, nunca como un pago a medias ni un retry 40001
// idéntico que termine en timeout.
export async function applyCardPaymentEntry(
  entry: LedgerEntryInput,
  statement: { debtAccountId: string; expectedDue: number; paidInCardCurrency: number },
  captureDraftId?: string | null,
): Promise<
  | { ok: true; transactionId: string; replayed: boolean; statementReduced: boolean; remainingDue: number; statementCovered: boolean }
  | { ok: false; reason: "conflict" | "unsafe" | "write_failed" }
> {
  const supabase = createSupabaseAdminClient();
  const payload = {
    p_entry: buildLedgerEntryPayload(entry),
    p_statement: {
      debt_account_id: statement.debtAccountId,
      expected_due: statement.expectedDue,
      paid_in_card_currency: statement.paidInCardCurrency,
    },
  };
  const { data, error } = captureDraftId
    ? await supabase.rpc("kipu_apply_card_payment_and_resolve_capture", {
        ...payload,
        p_capture_draft_id: captureDraftId,
      })
    : await supabase.rpc("kipu_apply_card_payment_v2", payload);
  if (error) {
    const message = error.message ?? "";
    if (error.code === "40001" || /KIPU_CONFLICT/.test(message)) {
      return { ok: false, reason: "conflict" };
    }
    if (/KIPU_(VALIDATION|OWNERSHIP|DEDUPE_MISMATCH|FX_REQUIRED)/.test(message)) {
      return { ok: false, reason: "unsafe" };
    }
    return { ok: false, reason: "write_failed" };
  }
  const row = data as { transaction_id?: string; replayed?: boolean; statement_reduced?: boolean; remaining_due?: number; statement_covered?: boolean } | null;
  const remainingDue = row?.remaining_due == null ? Number.NaN : Number(row.remaining_due);
  if (!row?.transaction_id || !Number.isFinite(remainingDue) || remainingDue < 0 || typeof row.statement_covered !== "boolean") {
    return { ok: false, reason: "write_failed" };
  }
  return {
    ok: true,
    transactionId: row.transaction_id,
    replayed: row?.replayed === true,
    statementReduced: row?.statement_reduced === true,
    remainingDue,
    statementCovered: row.statement_covered,
  };
}

export interface MultiSourceCardPaymentLeg {
  kind: "account" | "loan";
  instrumentId: string;
  /** Account through which borrowed funds entered and immediately left. Required
   * for a loan leg; omitted for a normal account leg. */
  clearingAccountId?: string | null;
  amount: number;
}

export type MultiSourceCardPaymentResult =
  | {
      ok: true;
      replayed: boolean;
      groupId: string;
      transactionIds: string[];
      remainingDue: number;
      statementCovered: boolean;
    }
  | { ok: false; reason: "conflict" | "unsafe" | "write_failed" };

/** J-8 audit — one card payment may genuinely come from several sources.
 *
 * The previous tool could only write one source, so it either wrote a partial
 * payment or became a permanent clarification loop. Migration 084 owns the
 * whole operation: account legs, borrowed-funds bridge, loan growth, card
 * payments, statement reduction and the durable group marker commit together.
 */
export async function applyMultiSourceCardPayment(input: {
  userId: string;
  dedupeKey: string;
  debtAccountId: string;
  expectedDue: number;
  totalAmount: number;
  originalCurrency: string;
  exchangeRateToBase: number;
  baseCurrency: string;
  occurredAtISO?: string | null;
  rawInput?: string;
  inputChannel?: string;
  captureDraftId?: string | null;
  sources: MultiSourceCardPaymentLeg[];
}): Promise<MultiSourceCardPaymentResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_apply_card_payment_multi_source", {
    p: {
      user_id: input.userId,
      dedupe_key: input.dedupeKey,
      debt_account_id: input.debtAccountId,
      expected_due: input.expectedDue,
      total_amount: input.totalAmount,
      original_currency: input.originalCurrency,
      exchange_rate_to_base: input.exchangeRateToBase,
      base_currency: input.baseCurrency,
      occurred_at: input.occurredAtISO ?? new Date().toISOString(),
      raw_input: input.rawInput ?? null,
      input_channel: input.inputChannel ?? "chat",
      capture_draft_id: input.captureDraftId ?? null,
      sources: input.sources.map((source) => ({
        kind: source.kind,
        instrument_id: source.instrumentId,
        clearing_account_id: source.clearingAccountId ?? null,
        amount: source.amount,
      })),
    },
  });
  if (error) {
    const message = error.message ?? "";
    if (/KIPU_CONFLICT/.test(message)) return { ok: false, reason: "conflict" };
    if (/KIPU_(VALIDATION|FX_REQUIRED|OWNERSHIP|DEDUPE_MISMATCH)/.test(message)) {
      return { ok: false, reason: "unsafe" };
    }
    return { ok: false, reason: "write_failed" };
  }
  const row = data as {
    outcome?: unknown;
    group_id?: unknown;
    transaction_ids?: unknown;
    remaining_due?: unknown;
    statement_covered?: unknown;
  } | null;
  const remainingDue = Number(row?.remaining_due);
  const transactionIds = Array.isArray(row?.transaction_ids)
    ? row.transaction_ids.filter((id): id is string => typeof id === "string")
    : [];
  if (
    (row?.outcome !== "applied" && row?.outcome !== "replayed") ||
    typeof row.group_id !== "string" ||
    !Number.isFinite(remainingDue) ||
    remainingDue < 0 ||
    typeof row.statement_covered !== "boolean" ||
    transactionIds.length !== input.sources.length
  ) {
    return { ok: false, reason: "write_failed" };
  }
  return {
    ok: true,
    replayed: row.outcome === "replayed",
    groupId: row.group_id,
    transactionIds,
    remainingDue,
    statementCovered: row.statement_covered,
  };
}

export type PersonLoanOutResult =
  | { ok: true; replayed: boolean; transactionId: string; receivableId: string }
  | { ok: false; reason: "unsafe" | "write_failed" };

/** Ledger outflow + receivable are one fact. A response loss replays the same
 * transaction/receivable marker; an insert failure rolls the outflow back. */
export async function applyPersonLoanOut(
  entry: LedgerEntryInput,
  receivable: { counterparty: string; amount: number; currency: string; reason?: string | null },
): Promise<PersonLoanOutResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_record_person_loan_out", {
    p_entry: buildLedgerEntryPayload(entry),
    p_receivable: {
      counterparty: receivable.counterparty,
      amount: receivable.amount,
      currency: receivable.currency,
      reason: receivable.reason ?? null,
    },
  });
  if (error) {
    if (/KIPU_(VALIDATION|OWNERSHIP|FX_REQUIRED|DEDUPE_MISMATCH)/.test(error.message ?? "")) {
      return { ok: false, reason: "unsafe" };
    }
    return { ok: false, reason: "write_failed" };
  }
  const row = data as {
    outcome?: unknown;
    transaction_id?: unknown;
    receivable_id?: unknown;
  } | null;
  if (
    (row?.outcome !== "applied" && row?.outcome !== "replayed") ||
    typeof row.transaction_id !== "string" ||
    typeof row.receivable_id !== "string"
  ) {
    return { ok: false, reason: "write_failed" };
  }
  return {
    ok: true,
    replayed: row.outcome === "replayed",
    transactionId: row.transaction_id,
    receivableId: row.receivable_id,
  };
}

export type FixedExpensePaymentResult =
  | { ok: true; replayed: boolean; fixedExpenseId: string; transactionId: string }
  | { ok: false; reason: "unsafe" | "write_failed" };

export async function applyFixedExpenseWithPayment(input: {
  userId: string;
  mode: "create" | "update";
  dedupeKey: string;
  fixedExpenseId?: string | null;
  fixed?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  entry: LedgerEntryInput;
}): Promise<FixedExpensePaymentResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_apply_fixed_expense_with_payment", {
    p: {
      user_id: input.userId,
      mode: input.mode,
      dedupe_key: input.dedupeKey,
      fixed_expense_id: input.fixedExpenseId ?? null,
      fixed: input.fixed ?? {},
      patch: input.patch ?? {},
      entry: buildLedgerEntryPayload(input.entry),
    },
  });
  if (error) {
    if (/KIPU_(VALIDATION|OWNERSHIP|FX_REQUIRED|DEDUPE_MISMATCH)/.test(error.message ?? "")) {
      return { ok: false, reason: "unsafe" };
    }
    return { ok: false, reason: "write_failed" };
  }
  const row = data as {
    outcome?: unknown;
    fixed_expense_id?: unknown;
    transaction_id?: unknown;
  } | null;
  if (
    (row?.outcome !== "applied" && row?.outcome !== "replayed") ||
    typeof row.fixed_expense_id !== "string" ||
    typeof row.transaction_id !== "string"
  ) {
    return { ok: false, reason: "write_failed" };
  }
  return {
    ok: true,
    replayed: row.outcome === "replayed",
    fixedExpenseId: row.fixed_expense_id,
    transactionId: row.transaction_id,
  };
}

export type CloseAccountResult =
  | { ok: true; alreadyClosed: boolean }
  | { ok: false; reason: "unsafe" | "write_failed" };

export async function closeAccountAtomically(input: {
  userId: string;
  accountId: string;
  operationId: string;
  message: string;
  channel?: ChatChannel;
}): Promise<CloseAccountResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_close_account_v2", {
    p: {
      user_id: input.userId,
      account_id: input.accountId,
      operation_id: input.operationId,
      raw_input: input.message,
      input_channel: channelToInputChannel(input.channel),
    },
  });
  if (error) {
    if (/KIPU_(VALIDATION|OWNERSHIP|FX_REQUIRED|DEDUPE_MISMATCH)/.test(error.message ?? "")) {
      return { ok: false, reason: "unsafe" };
    }
    return { ok: false, reason: "write_failed" };
  }
  const outcome = (data as { outcome?: unknown } | null)?.outcome;
  return outcome === "closed" || outcome === "already_closed"
    ? { ok: true, alreadyClosed: outcome === "already_closed" }
    : { ok: false, reason: "write_failed" };
}

export async function reopenAccountAtomically(input: {
  userId: string;
  accountId: string;
  message: string;
  channel?: ChatChannel;
}): Promise<
  | { ok: true; alreadyOpen: boolean }
  | { ok: false; reason: "historical_close" | "unsafe" | "write_failed" }
> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_reopen_account_v2", {
    p: {
      user_id: input.userId,
      account_id: input.accountId,
      raw_input: input.message,
      input_channel: channelToInputChannel(input.channel),
    },
  });
  if (error) {
    if (/KIPU_(VALIDATION|OWNERSHIP|FX_REQUIRED|DEDUPE_MISMATCH)/.test(error.message ?? "")) {
      return { ok: false, reason: "unsafe" };
    }
    return { ok: false, reason: "write_failed" };
  }
  const outcome = (data as { outcome?: unknown } | null)?.outcome;
  if (outcome === "reopened" || outcome === "already_open") {
    return { ok: true, alreadyOpen: outcome === "already_open" };
  }
  return outcome === "historical_close_requires_review"
    ? { ok: false, reason: "historical_close" }
    : { ok: false, reason: "write_failed" };
}

export async function applyInstallmentPlanPurchase(input: {
  userId: string;
  dedupeKey: string;
  plan: {
    debtAccountId: string;
    description: string;
    totalOriginal: number;
    originalCurrency: string;
    totalBase: number;
    baseCurrency: string;
    monthsTotal: number;
    firstStatementDue: string;
    surchargeBase: number;
    anniversaryDay: number | null;
    category: string;
  };
  entry: LedgerEntryInput;
}): Promise<
  | { ok: true; replayed: boolean; planId: string; transactionId: string }
  | { ok: false; reason: "unsafe" | "write_failed" }
> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_create_installment_plan_with_purchase", {
    p: {
      user_id: input.userId,
      dedupe_key: input.dedupeKey,
      plan: {
        debt_account_id: input.plan.debtAccountId,
        description: input.plan.description,
        total_original: input.plan.totalOriginal,
        original_currency: input.plan.originalCurrency,
        total_base: input.plan.totalBase,
        base_currency: input.plan.baseCurrency,
        months_total: input.plan.monthsTotal,
        first_statement_due: input.plan.firstStatementDue,
        surcharge_base: input.plan.surchargeBase,
        anniversary_day: input.plan.anniversaryDay,
        category: input.plan.category,
      },
      entry: buildLedgerEntryPayload({ ...input.entry, dedupeKey: input.dedupeKey }),
    },
  });
  if (error) {
    return /KIPU_(VALIDATION|OWNERSHIP|FX_REQUIRED|DEDUPE_MISMATCH)/.test(error.message ?? "")
      ? { ok: false, reason: "unsafe" }
      : { ok: false, reason: "write_failed" };
  }
  const row = data as {
    outcome?: unknown;
    installment_plan_id?: unknown;
    transaction_id?: unknown;
  } | null;
  if (
    (row?.outcome !== "applied" && row?.outcome !== "replayed") ||
    typeof row.installment_plan_id !== "string" ||
    typeof row.transaction_id !== "string"
  ) {
    return { ok: false, reason: "write_failed" };
  }
  return {
    ok: true,
    replayed: row.outcome === "replayed",
    planId: row.installment_plan_id,
    transactionId: row.transaction_id,
  };
}

export async function closeInstallmentPlanAtomically(input: {
  userId: string;
  planId: string;
  mode: "cancelled" | "paid_off";
  message: string;
  channel?: ChatChannel;
  occurredAtISO?: string | null;
}): Promise<
  | { ok: true; alreadyClosed: boolean; reversedPurchase: boolean }
  | { ok: false; reason: "needs_review" | "unsafe" | "write_failed" }
> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_close_installment_plan_v2", {
    p: {
      user_id: input.userId,
      installment_plan_id: input.planId,
      mode: input.mode,
      raw_input: input.message,
      input_channel: channelToInputChannel(input.channel),
      occurred_at: input.occurredAtISO ?? null,
    },
  });
  if (error) {
    return /KIPU_(VALIDATION|OWNERSHIP|FX_REQUIRED|DEDUPE_MISMATCH)/.test(error.message ?? "")
      ? { ok: false, reason: "unsafe" }
      : { ok: false, reason: "write_failed" };
  }
  const outcome = (data as { outcome?: unknown } | null)?.outcome;
  if (
    outcome === "missing_purchase_requires_review" ||
    outcome === "paid_purchase_requires_review" ||
    outcome === "installment_purchase_paid_requires_review" ||
    outcome === "closed_account_operation_requires_reopen"
  ) {
    return { ok: false, reason: "needs_review" };
  }
  if (
    outcome !== "cancelled" &&
    outcome !== "already_cancelled" &&
    outcome !== "paid_off" &&
    outcome !== "already_paid_off"
  ) {
    return { ok: false, reason: "write_failed" };
  }
  return {
    ok: true,
    alreadyClosed: outcome === "already_cancelled" || outcome === "already_paid_off",
    reversedPurchase: outcome === "cancelled" || outcome === "already_cancelled",
  };
}

export async function closeDebtAccountAtomically(input: {
  userId: string;
  debtAccountId: string;
}): Promise<
  | { ok: true; alreadyClosed: boolean }
  | { ok: false; reason: "outstanding" | "unsafe" | "write_failed" }
> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_close_debt_account_v2", {
    p: {
      user_id: input.userId,
      debt_account_id: input.debtAccountId,
    },
  });
  if (error) {
    return /KIPU_(VALIDATION|OWNERSHIP)/.test(error.message ?? "")
      ? { ok: false, reason: "unsafe" }
      : { ok: false, reason: "write_failed" };
  }
  const outcome = (data as { outcome?: unknown } | null)?.outcome;
  if (
    outcome === "outstanding_debt_requires_payment" ||
    outcome === "closed_with_debt_requires_review"
  ) {
    return { ok: false, reason: "outstanding" };
  }
  if (outcome !== "closed" && outcome !== "already_closed") {
    return { ok: false, reason: "write_failed" };
  }
  return { ok: true, alreadyClosed: outcome === "already_closed" };
}

// 065 — completa la mitad statement de un pago manual/genérico ya existente.
// La RPC valida que la fila sea un debt_payment nativo seguro para esa tarjeta;
// no vuelve a tocar cuenta/deuda del ledger, solo remanente+marca en una txn.
export async function reconcileExistingCardPayment(input: {
  userId: string;
  transactionId: string;
  debtAccountId: string;
  expectedDue: number;
}): Promise<
  | { ok: true; transactionId: string; replayed: boolean; remainingDue: number; statementCovered: boolean }
  | { ok: false; reason: "conflict" | "unsafe" | "write_failed" }
> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_reconcile_existing_card_payment_v2", {
    p: {
      user_id: input.userId,
      transaction_id: input.transactionId,
      debt_account_id: input.debtAccountId,
      expected_due: input.expectedDue,
    },
  });
  if (error) {
    const message = error.message ?? "";
    if (error.code === "40001" || /KIPU_CONFLICT/.test(message)) return { ok: false, reason: "conflict" };
    if (/KIPU_(VALIDATION|FX_REQUIRED|PROFILE_REQUIRED|OWNERSHIP|DEDUPE_MISMATCH)/.test(message)) return { ok: false, reason: "unsafe" };
    return { ok: false, reason: "write_failed" };
  }
  const row = data as { transaction_id?: string; replayed?: boolean; remaining_due?: unknown; statement_covered?: unknown } | null;
  const remainingDue = row?.remaining_due == null ? Number.NaN : Number(row.remaining_due);
  if (!row?.transaction_id || !Number.isFinite(remainingDue) || remainingDue < 0 || typeof row.statement_covered !== "boolean") {
    return { ok: false, reason: "write_failed" };
  }
  return {
    ok: true,
    transactionId: row.transaction_id,
    replayed: row.replayed === true,
    remainingDue,
    statementCovered: row.statement_covered,
  };
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
  /** A reply to a persisted clarification. For ordinary ledger movements the
   * movement and closing this row commit in one RPC; never close it afterwards
   * as a best-effort second write. */
  pendingClarificationId?: string | null;
  /** Explicit retraction of a persisted multi-source card-payment draft. The
   * ordinary card payment and resolving that draft commit together. */
  cardPaymentCaptureDraftId?: string | null;
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
  pendingClarificationId,
  cardPaymentCaptureDraftId,
  coachMessageOverride,
}: ApplyChatTransactionIntentInput) {
  const supabase = createSupabaseAdminClient();
  const applyCanonicalEntry = async (entry: LedgerEntryInput): Promise<string> => {
    if (!pendingClarificationId) {
      return applyLedgerEntry(supabase, entry);
    }
    const { data, error } = await supabase.rpc(
      "kipu_apply_ledger_entry_and_resolve_pending",
      {
        p_entry: buildLedgerEntryPayload(entry),
        p_pending_id: pendingClarificationId,
      },
    );
    if (error) throw mapWriteError(error);
    const row = data as { outcome?: unknown; transaction_id?: unknown } | null;
    if (
      (row?.outcome !== "applied" && row?.outcome !== "replayed") ||
      typeof row.transaction_id !== "string"
    ) {
      throw new LedgerWriteError(
        "KIPU_WRITE_FAILED: movement/pending resolution returned malformed result",
      );
    }
    return row.transaction_id;
  };
  const inputChannel = channelToInputChannel(channel);
  // Honest FX at the writer boundary: when the intent's currency differs from the
  // user's base, a missing/implicit rate must NOT silently become 1 (that lie then
  // pollutes every base_amount sum: Margen, activity, week pace). Resolve from the
  // user's KNOWN rates (manual outranks cached); if none exist, REFUSE (throw
  // KIPU_FX_REQUIRED) instead of persisting a fabricated 1:1 — Kipu never invents a
  // rate. Base-currency intents (the vast majority) take the exact previous path
  // (rate 1 is correct there). The primary agent path already resolves FX before
  // calling here, so in practice this only fires on the legacy/fallback path.
  let rate = intent.exchangeRateToBase ?? 1;
  let resolvedBaseCurrency = intent.baseCurrency ?? intent.originalCurrency;
  const intentCurrency = (intent.originalCurrency ?? "").trim().toUpperCase();
  if (intentCurrency) {
    // Re-auditoría 3 (punto 1, gemelo del transfer-handler): un `error` ignorado
    // aquí hacía caer profileBase a la moneda del intent — y un movimiento
    // extranjero con la lectura del perfil caída se escribía a 1:1 como si su
    // moneda fuera la base real. Una lectura que no prueba la base REHÚSA.
    const { data: profRow, error: profErr } = await supabase
      .from("profiles")
      .select("base_currency")
      .eq("id", userId)
      .maybeSingle();
    if (profErr || !profRow) {
      throw new Error(
        "KIPU_PROFILE_REQUIRED: could not prove the user's base currency; refusing to write a possibly-fabricated base",
      );
    }
    const profileBase = (
      ((profRow as { base_currency?: string | null }).base_currency ??
        resolvedBaseCurrency) || "USD"
    )
      .trim()
      .toUpperCase();
    if (intentCurrency !== profileBase) {
      resolvedBaseCurrency = profileBase;
      // A genuine caller-supplied rate (≠ 1) is trusted; only a missing/implicit
      // 1:1 for a non-base currency needs real resolution.
      const rateMissing = intent.exchangeRateToBase == null || intent.exchangeRateToBase === 1;
      if (rateMissing) {
        const { readFxRates, loadLatestCachedRates, usableRates } = await import("@/lib/fx/fx-store");
        const { convert } = await import("@/lib/fx/fx-rates");
        const [manual, cached] = await Promise.all([
          readFxRates(userId).then(usableRates),
          loadLatestCachedRates(intentCurrency, profileBase),
        ]);
        const res = convert(intent.originalAmount, intentCurrency, profileBase, [
          ...manual,
          ...cached,
        ]);
        if (res.ok) rate = res.rate;
        else {
          // No trusted rate for a non-base currency. Refusing here keeps every
          // base_amount honest: a redelivered turn re-refuses (idempotent), and
          // the caller surfaces a "necesito el tipo de cambio" ask instead of a
          // silent 1:1 write. (Same convention as reconcileAccountBalance.)
          throw new Error(
            `KIPU_FX_REQUIRED: no trusted rate ${intentCurrency}->${profileBase}; refusing to write a fabricated 1:1`,
          );
        }
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
    // Stage H — carry the objetivo treatment through EVERY branch of the inline
    // writer (expense/refund/…) so a confirmed extraordinary — including a
    // food/transport refund that must restore the Saldo, not the objective —
    // isn't silently written as NULL.
    budgetTreatment: intent.budgetTreatment ?? null,
  };

  // J-1 — guard del camino legacy (fallback): el ledger resta original-sobre-
  // original, así que un instrumento en OTRA moneda corrompería su balance. El
  // trigger de la 066 lo pararía en DB; acá se rehúsa antes, con mensaje útil.
  const refuseCurrencyMismatch = (kind: string, name: string, instrumentCurrency: string | null | undefined) => {
    const want = (intent.originalCurrency ?? "").trim().toUpperCase();
    const have = String(instrumentCurrency ?? "").trim().toUpperCase();
    if (want && have && want !== have) {
      throw new Error(
        `KIPU_NEEDS_INFO: ese ${kind} está en ${want} pero "${name}" está en ${have}; decime de qué cuenta en ${want} salió (o el monto en ${have}) — no registré nada para no corromper el balance`,
      );
    }
  };

  if (intent.type === "income") {
    const destinationAccount = accounts.find(
      (account) => account.id === intent.destinationAccountId,
    );
    if (!destinationAccount) {
      throw new Error("chat-income-account-not-found");
    }
    refuseCurrencyMismatch("ingreso", destinationAccount.name, destinationAccount.currency);

    await applyCanonicalEntry({
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
    refuseCurrencyMismatch("pago", sourceAccount.name, sourceAccount.currency);

    const debtEntry: LedgerEntryInput = {
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
    };

    // F2 (card state machine) — a credit-card payment also lowers the PENDING
    // STATEMENT ("pago del mes", full_payment_due) by what was paid, floored at 0.
    // Auditoría 4 (punto 4): ya no es best-effort — ledger y baja del estado de
    // cuenta van JUNTOS por la RPC atómica (el `.catch(() => false)` viejo podía
    // confirmar el pago con el "pago del mes" intacto). Pasada 5 (punto 3): la
    // decisión es el plan compartido y un pago NO expresable en la moneda de la
    // tarjeta ya NO cae al writer plano (eso dejaba media operación como éxito) —
    // pide el equivalente. La RPC exige identidad: los canales sin operationId usan
    // el fallback determinístico sobre contenido + día (convención del repago).
    const plan = planCardPaymentStatement({
      originalAmount: intent.originalAmount,
      originalCurrency: intent.originalCurrency,
      sourceCurrency: sourceAccount.currency ?? null,
      baseAmount: intent.originalAmount * rate,
      baseCurrency: resolvedBaseCurrency,
      cardType: debtAccount.type,
      cardCurrency: debtAccount.currency ?? null,
      fullPaymentDue: debtAccount.fullPaymentDueOriginal ?? debtAccount.fullPaymentDue ?? null,
    });
    if (plan.route === "blocked_fx") {
      throw new Error(
        `KIPU_NEEDS_INFO: el pago sale en ${sourceAccount.currency} y la deuda de "${debtAccount.name}" está en ${plan.cardCurrency}. Por ahora necesito que lo registres desde una cuenta en ${plan.cardCurrency}; no escribí nada porque el ledger aún no puede aplicar dos montos nativos distintos sin corromper uno`,
      );
    }
    if (plan.route === "atomic") {
      if (pendingClarificationId) {
        // No current pending-chat flow reaches a card payment. Keep the future
        // case fail-closed: using the card RPC here would commit the payment
        // without closing the pending row, recreating the saga this option was
        // introduced to remove.
        throw new LedgerWriteError(
          "KIPU_VALIDATION: card-payment pending resolution needs its own atomic boundary",
        );
      }
      const applied = await applyCardPaymentEntry(
        {
          ...debtEntry,
          dedupeKey:
            common.dedupeKey ??
            `chat:cardpay:${createHash("sha256")
              .update(
                [
                  userId,
                  message.trim(),
                  Math.round(intent.originalAmount * 100),
                  (intent.originalCurrency ?? "").toUpperCase(),
                  debtAccount.id,
                  new Date().toISOString().slice(0, 10),
                ].join("|"),
              )
              .digest("hex")
              .slice(0, 32)}`,
        },
        {
          debtAccountId: debtAccount.id,
          expectedDue: plan.expectedDue,
          paidInCardCurrency: plan.paidInCardCurrency,
        },
        cardPaymentCaptureDraftId,
      );
      if (!applied.ok) {
        throw new Error(
          applied.reason === "conflict"
            ? "KIPU_CONFLICT: card statement changed while booking the payment; nothing was written"
            : applied.reason === "unsafe"
              ? "KIPU_NEEDS_INFO: este pago ya no coincide con la captura pendiente o no pasó las validaciones de tarjeta, moneda e identidad; no escribí nada. Relee el estado y confirma el pago de nuevo"
            : "KIPU_WRITE_FAILED: could not prove the card payment landed; nothing was written",
        );
      }
    } else {
      await applyCanonicalEntry(debtEntry);
    }

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
    refuseCurrencyMismatch("aporte", sourceAccount.name, sourceAccount.currency);
    if (!goal) {
      throw new Error("chat-parser-goal-not-found");
    }
    // J-1 re-auditoría (P1): el ledger suma el ORIGINAL a goals.current_amount —
    // la meta acumula en SU moneda nativa (originalCurrency si el contexto la
    // re-expresó a base), así que el aporte debe venir en esa moneda.
    refuseCurrencyMismatch("aporte (la meta acumula en su moneda)", goal.name, goal.originalCurrency ?? goal.currency);

    await applyCanonicalEntry({
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
    if (account) refuseCurrencyMismatch("gasto", account.name, account.currency);
    if (debtAccount) refuseCurrencyMismatch("gasto", debtAccount.name, debtAccount.currency);

    await applyCanonicalEntry({
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
    // J-7 (barrido 1). La 066 eximió refund del trigger con la nota «reglas propias
    // — J-7 los audita aparte», y esas reglas nunca se escribieron: el efecto
    // acredita el ORIGINAL a la cuenta destino sin mirar su moneda, así que una
    // devolución de 33000 ARS a una cuenta USD regalaba 33000 dólares. Es el bug
    // de J-1 por la puerta que J-1 dejó abierta.
    const refundLegs = planMovementLegsCurrency({
      movementCurrency: intent.originalCurrency,
      legs: [destination],
    });
    if (!refundLegs.ok) throw new Error(`KIPU_NEEDS_INFO: ${refundLegs.reason}`);

    await applyCanonicalEntry({
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
    // J-7 (barrido 1). El efecto `transfer` del ledger resta v_eao del origen y
    // suma EL MISMO v_eao al destino: un solo monto para las dos patas. Por eso
    // AMBAS deben estar en la moneda del movimiento — con origen ARS y destino USD
    // la resta es correcta y la suma inventa dólares. Sólo el tool del agente lo
    // rehusaba; el applier (que sirve al fallback legacy, al parser y a la
    // corrección por recovery) no miraba moneda, y el trigger exime transfer.
    const legs = planMovementLegsCurrency({
      movementCurrency: intent.originalCurrency,
      legs: [source, destination],
    });
    if (!legs.ok) throw new Error(`KIPU_NEEDS_INFO: ${legs.reason}`);

    await applyCanonicalEntry({
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

export type CardPaymentReversalAttempt =
  | { matched: false }
  | { matched: true; alreadyReversed: boolean; reversalTransactionIds: string[]; restoredDue: number };

type UniversalFinancialReversalRow = {
  outcome?: unknown;
  reversal_transaction_ids?: unknown;
  restored_due?: unknown;
};

function parseUniversalFinancialReversal(
  value: unknown,
): Extract<CardPaymentReversalAttempt, { matched: true }> {
  const row = value as UniversalFinancialReversalRow | null;
  if (
    row?.outcome === "closed_account_operation_requires_reopen" ||
    row?.outcome === "account_close_correction_requires_undo" ||
    row?.outcome === "installment_purchase_paid_requires_review"
  ) {
    throw new LedgerWriteError(
      row?.outcome === "installment_purchase_paid_requires_review"
        ? "KIPU_NEEDS_INFO: esa compra en cuotas figura liquidada. Revisa primero el pago final de la tarjeta; no deshice la compra ni el plan porque podría crear un crédito falso."
        : "KIPU_NEEDS_INFO: ese movimiento pertenece al cierre de una cuenta anterior y no puedo devolverle dinero mientras siga cerrada. Reabre o revisa esa cuenta primero; no cambié nada.",
      "22023",
    );
  }
  const reversed =
    row?.outcome === "reversed" ||
    row?.outcome === "reversed_account_close" ||
    row?.outcome === "reversed_installment_purchase";
  const alreadyReversed =
    row?.outcome === "already_reversed" ||
    row?.outcome === "already_reversed_account_close" ||
    row?.outcome === "already_reversed_installment_purchase";
  const ids = Array.isArray(row?.reversal_transaction_ids)
    ? row.reversal_transaction_ids.filter((id): id is string => typeof id === "string")
    : [];
  const restoredDue =
    row?.restored_due === undefined || row.restored_due === null
      ? 0
      : Number(row.restored_due);
  if (
    (!reversed && !alreadyReversed) ||
    !Number.isFinite(restoredDue) ||
    restoredDue < 0 ||
    ids.length === 0
  ) {
    throw new LedgerWriteError("KIPU_WRITE_FAILED: malformed financial-operation reversal result");
  }
  return {
    matched: true,
    alreadyReversed,
    reversalTransactionIds: ids,
    restoredDue,
  };
}

export async function reverseCardPaymentOperationIfApplicable(input: {
  userId: string;
  transactionId: string;
  message: string;
  channel?: ChatChannel;
}): Promise<CardPaymentReversalAttempt> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_reverse_financial_operation", {
    p: {
      user_id: input.userId,
      transaction_id: input.transactionId,
      raw_input: input.message,
      input_channel: channelToInputChannel(input.channel),
      occurred_at: new Date().toISOString(),
    },
  });
  if (error) throw mapWriteError(error);
  return parseUniversalFinancialReversal(data);
}

export async function reverseStoredTransactionsAtomically(input: {
  userId: string;
  transactionIds: string[];
  message: string;
  channel?: ChatChannel;
}): Promise<Array<{ transactionId: string; alreadyReversed: boolean }>> {
  const uniqueIds = [...new Set(input.transactionIds.filter(Boolean))];
  if (uniqueIds.length === 0 || uniqueIds.length > 10) {
    throw new LedgerWriteError("KIPU_VALIDATION: between 1 and 10 transaction ids required", "22023");
  }
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("kipu_reverse_financial_operations", {
    p: {
      user_id: input.userId,
      transaction_ids: uniqueIds,
      raw_input: input.message,
      input_channel: channelToInputChannel(input.channel),
      occurred_at: new Date().toISOString(),
    },
  });
  if (error) throw mapWriteError(error);
  const rows = (data as { results?: unknown } | null)?.results;
  if (!Array.isArray(rows) || rows.length !== uniqueIds.length) {
    throw new LedgerWriteError("KIPU_WRITE_FAILED: malformed batch reversal result");
  }
  return rows.map((value, index) => {
    const parsed = parseUniversalFinancialReversal(value);
    return {
      transactionId: uniqueIds[index],
      alreadyReversed: parsed.alreadyReversed,
    };
  });
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
  const { userId, transaction: tx } = input;

  // A reversal/adjustment-of-adjustment is not reversed here; the DB also rejects
  // reversing a reversal.
  if (tx.type === "reversal") {
    return { ok: false, alreadyReversed: true };
  }

  // J-8 audit: card applications and receivables are second financial halves
  // (full_payment_due/statement_covered + durable application marker), and a
  // multi-source payment can also contain a loan increment. Generic reversal
  // only knows the ledger row. Ask the card-aware boundary first; it returns
  // and must be reversed in the same transaction as the ledger row.
  const cardReversal = await reverseCardPaymentOperationIfApplicable({
    userId,
    transactionId: tx.id,
    message: input.message,
    channel: input.channel,
  });
  if (!cardReversal.matched) {
    throw new LedgerWriteError("KIPU_WRITE_FAILED: universal reversal did not classify operation");
  }
  return {
    ok: !cardReversal.alreadyReversed,
    alreadyReversed: cardReversal.alreadyReversed,
  };
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
  // Stage H — flip a movement between objective (default) and saldo
  // (extraordinary). Metadata-only: balances never change; the tank and the
  // objective accumulator re-derive live on the next compute.
  budgetTreatment?: "objective" | "saldo";
}): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const patch: Record<string, string> = {};
  if (input.category) patch.category = input.category;
  if (input.description) patch.description = input.description;
  if (input.budgetTreatment) patch.budget_treatment = input.budgetTreatment;
  if (Object.keys(patch).length === 0) return;
  const { data, error } = await supabase.rpc("kipu_correct_transaction_metadata_v2", {
    p: {
      user_id: input.userId,
      transaction_id: input.transactionId,
      patch,
    },
  });
  if (error) throw mapWriteError(error);
  if ((data as { outcome?: unknown } | null)?.outcome !== "updated") {
    throw new LedgerWriteError("KIPU_WRITE_FAILED: metadata correction returned malformed result");
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
    budgetTreatment: intent.budgetTreatment ?? null,
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
  correctedOccurredAtISO?: string | null;
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
    // Preserve the original's provenance so a correction can't silently un-link
    // a fixed/recurring or installment expense (which would then be counted BOTH
    // in the ritmo AND in the objective accumulator — a Stage H double-count) or
    // reset its date to "now" (wrong month).
    recurringExpenseId: input.original.recurringExpenseId,
    externalRef: input.original.externalRef ?? null,
    occurredAtISO: input.correctedOccurredAtISO ?? input.original.occurredAt ?? null,
  });
  const targetDebt = input.correctedIntent.type === "debt_payment"
    ? input.debtAccounts.find((debt) => debt.id === corrected.debtAccountId) ?? null
    : null;
  const nativeDue = targetDebt
    ? targetDebt.statementCovered === true
      ? 0
      : targetDebt.fullPaymentDueOriginal !== undefined
        ? targetDebt.fullPaymentDueOriginal
        : String(targetDebt.currency).toUpperCase() === String(corrected.baseCurrency).toUpperCase()
          ? targetDebt.fullPaymentDue ?? targetDebt.statementTotalDue ?? 0
          : targetDebt.statementTotalDue ?? 0
    : 0;
  if (input.original.type === "debt_payment" && input.correctedIntent.type === "debt_payment") {
    corrected.dedupeKey = `card-correction:${input.original.id}:${createHash("sha256")
      .update(JSON.stringify({
        amount: corrected.originalAmount,
        currency: corrected.originalCurrency,
        source: corrected.sourceAccountId,
        debt: corrected.debtAccountId,
        date: corrected.occurredAtISO,
      }))
      .digest("hex")
      .slice(0, 24)}`;
  }
  const { data: specialData, error: specialError } = await supabase.rpc(
    "kipu_correct_financial_operation",
    {
      p_user_id: input.userId,
      p_original_transaction_id: input.original.id,
      p_entry: buildLedgerEntryPayload(corrected),
      p_statement: targetDebt
        ? {
            debt_account_id: corrected.debtAccountId,
            expected_due: nativeDue,
            paid_in_card_currency: corrected.originalAmount,
          }
        : {},
      p_raw_input: input.message,
      p_input_channel: channelToInputChannel(input.channel),
    },
  );
  if (specialError) throw mapWriteError(specialError);
  const special = specialData as { outcome?: unknown } | null;
  if (special?.outcome === "corrected" || special?.outcome === "corrected_receivable") {
    return buildChatActionResult({
      redirectCode: "chat-correction-created",
      message:
        special.outcome === "corrected"
          ? "Listo, corregí el pago de tarjeta y su estado de cuenta en una sola operación."
          : "Listo, corregí el préstamo y también lo que te deben en una sola operación.",
    });
  }
  if (special?.outcome === "multi_source_correction_requires_replacement") {
    throw new LedgerWriteError(
      "KIPU_NEEDS_INFO: ese pago salió de varias fuentes y no puedo corregir una sola pata sin desarmar las demás. Deshaz el pago completo y vuelve a registrarlo con el reparto completo; no cambié nada.",
    );
  }
  if (special?.outcome === "installment_correction_requires_cancel") {
    throw new LedgerWriteError(
      "KIPU_NEEDS_INFO: esa fila es la compra que originó un plan de cuotas. Corregir solo el ledger dejaría cuotas y deuda con montos distintos: cancela/deshaz el plan completo y vuelve a crearlo con los datos correctos; no cambié nada.",
      "22023",
    );
  }
  if (
    special?.outcome === "account_close_correction_requires_undo" ||
    special?.outcome === "closed_account_operation_requires_reopen"
  ) {
    throw new LedgerWriteError(
      "KIPU_NEEDS_INFO: ese movimiento pertenece al cierre de una cuenta. Primero deshaz el cierre completo (eso reabre la cuenta) y después registra la corrección; no cambié nada.",
      "22023",
    );
  }
  if (special?.outcome !== "not_special") {
    throw new LedgerWriteError("KIPU_WRITE_FAILED: malformed financial-operation correction result");
  }
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

  // One truth: the post-log confirmation quotes the SAME Saldo Kipu the
  // dashboard hero shows (not the older flexible-spending weekly plan), so the
  // number the user just saw on /app and the number Kipu says after logging a
  // gasto can never disagree.
  //
  // A briefing failure used to "fall back" to the retired flexible-spending
  // figures — seeded from context.dashboard and shipped in the hero's own slot, so
  // the user read a legacy number as their Saldo, right after a write, precisely
  // when the real one was unpublishable. There is no fallback for a money figure:
  // return undefined and let the caller confirm the write without quoting one.
  let saldoAmount: number;
  let saldoFillDaily: number;
  try {
    const { deriveAdvisorySnapshot } = await import("@/lib/ai/advisory-handler");
    const { buildCoachingBriefing } = await import("@/lib/financial/coaching-signals");
    const briefing = await buildCoachingBriefing({
      userId,
      ctx: context,
      snapshot: deriveAdvisorySnapshot(context),
      surfaceNudges: false,
    });
    // Stage D — the hero is the SALDO (accumulating tank); the confirmation
    // quotes it, with the daily recharge as the secondary figure.
    saldoAmount = briefing.margenKipu.saldo.saldo;
    saldoFillDaily = briefing.margenKipu.saldo.fillDaily;
  } catch {
    return undefined;
  }

  if (!Number.isFinite(saldoAmount) || !Number.isFinite(saldoFillDaily)) {
    return undefined;
  }

  return {
    saldoAmount,
    saldoFillDaily,
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
