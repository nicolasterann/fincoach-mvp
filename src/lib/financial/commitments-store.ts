import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type {
  CurrencyCode,
  FinancialCategory,
  PaymentFrequency,
  PaymentSourceType,
} from "@/types/financial";

// Phase 11 Slice 2 persistence for future commitments and receivables. These
// tables are NOT the transaction ledger — they describe future plans and
// loans — so writes here are independent of applyChatTransactionIntent (which
// stays the sole writer of the `transactions` ledger + balances). When a
// scheduled payment is actually paid or a loan repaid, the ledger write still
// goes through that single writer; this module only links the records.

// ── Fixed / recurring expenses (create + permanent update) ──────────────────

export interface CreateFixedExpenseInput {
  userId: string;
  name: string;
  amount: number;
  currency: CurrencyCode;
  category: FinancialCategory;
  frequency: PaymentFrequency;
  startDate?: string | null;
  paymentSourceType?: PaymentSourceType;
  paymentSourceId?: string;
  isEssential?: boolean;
}

export async function createFixedExpense(
  input: CreateFixedExpenseInput,
): Promise<{ id: string } | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("fixed_expenses")
    .insert({
      user_id: input.userId,
      name: input.name,
      amount: input.amount,
      currency: input.currency,
      category: input.category,
      frequency: input.frequency,
      start_date: input.startDate ?? null,
      payment_source_type: input.paymentSourceType ?? null,
      payment_source_id: input.paymentSourceId ?? null,
      is_essential: input.isEssential ?? false,
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: data.id as string };
}

export async function updateFixedExpenseAmount(input: {
  userId: string;
  id: string;
  amount: number;
}): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("fixed_expenses")
    .update({ amount: input.amount })
    .eq("id", input.id)
    .eq("user_id", input.userId);
  return !error;
}

// Update amount and/or the future start date together, so a permanent change
// that begins later ("desde el 1 del próximo mes pago 25 de gimnasio") keeps
// both the new amount and the start timing. Also covers pause/resume/soft-
// delete (isActive), due day, rename and currency — always scoped to the user.
export async function updateFixedExpenseFields(input: {
  userId: string;
  id: string;
  amount?: number;
  startDate?: string | null;
  isActive?: boolean;
  expectedDay?: number | null;
  name?: string;
  currency?: CurrencyCode;
  // Stage 30 — mark a fixed expense as varying month to month (gas, luz) vs
  // truly fixed (arriendo). The engine treats variable ones with lower
  // confidence. Migration 035: fixed_expenses.is_variable.
  isVariable?: boolean;
  // Stage 30 — free-text note the coach reads as memory. Empty string clears it.
  notes?: string | null;
  // Stage 32 (Item B) — when the user confirms a variable expense's amount for
  // THIS month, stamp the first day of the month (YYYY-MM-01) so the ambient
  // "¿cuánto te salió X este mes?" ask stops until next month. Migration 038:
  // fixed_expenses.last_confirmed_month.
  lastConfirmedMonth?: string;
}): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  if (input.amount !== undefined) patch.amount = input.amount;
  if (input.startDate !== undefined) patch.start_date = input.startDate;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.expectedDay !== undefined) patch.expected_day = input.expectedDay;
  if (input.name !== undefined && input.name.trim()) patch.name = input.name.trim().slice(0, 120);
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.isVariable !== undefined) patch.is_variable = input.isVariable;
  if (input.notes !== undefined) patch.notes = input.notes && input.notes.trim() ? input.notes.trim().slice(0, 500) : null;
  const stampConfirmedMonth =
    input.lastConfirmedMonth !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(input.lastConfirmedMonth);
  if (stampConfirmedMonth) patch.last_confirmed_month = input.lastConfirmedMonth;
  if (Object.keys(patch).length === 0) return true;
  const supabase = createSupabaseAdminClient();
  // Zero matched rows (stale id, someone else's row) must read as failure —
  // otherwise Kipu confirms a pause/rename that never happened.
  let { data, error } = await supabase
    .from("fixed_expenses")
    .update(patch)
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .select("id");
  // Schema guard (like the onboarding save): a pre-038 database must not make
  // the WHOLE update fail because of the confirmation stamp — retry without it.
  const unknownColumn =
    error != null &&
    stampConfirmedMonth &&
    ((error as { code?: string }).code === "PGRST204" ||
      (error as { code?: string }).code === "42703" ||
      /last_confirmed_month|schema cache/i.test(error.message ?? ""));
  if (unknownColumn) {
    delete patch.last_confirmed_month;
    if (Object.keys(patch).length === 0) return true;
    ({ data, error } = await supabase
      .from("fixed_expenses")
      .update(patch)
      .eq("id", input.id)
      .eq("user_id", input.userId)
      .select("id"));
  }
  return !error && (data?.length ?? 0) > 0;
}

// Whether one fixed expense (scoped to the user) is marked month-to-month
// variable. Null when the row doesn't exist; false when the column predates
// migration 035 (absent → truly fixed). Read by the update executor to decide
// if an amount change also counts as this month's confirmation (Stage 32).
export async function getFixedExpenseVariableFlag(input: {
  userId: string;
  id: string;
}): Promise<boolean | null> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("fixed_expenses")
    .select("is_variable")
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!data) return null;
  return (data as { is_variable?: unknown }).is_variable === true;
}

export interface ExistingFixedExpense {
  id: string;
  name: string;
  amount: number;
  currency: string;
  frequency: string;
}

// The stored denomination of one fixed expense (any active state), scoped to
// the user. Null when the row doesn't exist.
/** Distingue "no pude leer" de "no tiene moneda declarada" — con `string | null`
 *  eran el mismo valor y el caller asumía la base, convirtiendo 1:1 a ciegas. */
/** Unión discriminada (re-auditoría 2, punto 9): `currency` solo existe si la
 *  lectura salió bien — un `{ok:false}` con currency null era consumible por
 *  disciplina, no por compilador. maybeSingle ⇒ ok implica completo. */
export type FixedExpenseCurrencyRead =
  | { ok: true; complete: true; currency: string | null }
  | { ok: false; complete: false };

export async function getFixedExpenseCurrency(input: {
  userId: string;
  id: string;
}): Promise<FixedExpenseCurrencyRead> {
  const supabase = createSupabaseAdminClient();
  // Devolver `string | null` hacía que "falló la lectura" y "no tiene moneda" fueran
  // literalmente el mismo valor, y el caller lee null como "asume la base" — o sea,
  // convierte 1:1 sin saberlo. Un `if (error) return null` NO arreglaba nada: en
  // error `data` ya venía null y el retorno ya era null. El tipo es el arreglo.
  const { data, error } = await supabase
    .from("fixed_expenses")
    .select("currency")
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error) return { ok: false, complete: false };
  const cur = (data as { currency?: unknown } | null)?.currency;
  return { ok: true, complete: true, currency: typeof cur === "string" && cur ? cur.toUpperCase() : null };
}

// Loose name match against the user's active fixed expenses, so we can ask
// "update vs create" when something similar already exists.
/** Un guard que no pudo leer NO autoriza. Con `ExistingFixedExpense[]`, una lectura
 *  fallida decía "no hay ninguno parecido" y el fijo duplicado entraba — justo cuando
 *  el guard más hacía falta. */
export type SimilarFixedExpensesRead =
  | { ok: true; complete: true; matches: ExistingFixedExpense[] }
  /** Scan topado: lo visto NO prueba ni el match único ni la ausencia. Display only. */
  | { ok: true; complete: false; partial: ExistingFixedExpense[] }
  | { ok: false; complete: false };

// Nadie tiene 100 gastos fijos activos; el tope es sanitario. El filtro por nombre
// corre en JS POST-consulta, así que la prueba de completitud es sobre el SCAN: sin
// .limit() explícito, PostgREST trunca en ~1000 en silencio y el `complete: true`
// de antes era una afirmación no probada (re-auditoría 2, punto 5).
const SIMILAR_FIXED_CAP = 100;

export async function readSimilarFixedExpenses(input: {
  userId: string;
  name: string;
}): Promise<SimilarFixedExpensesRead> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("fixed_expenses")
    .select("id, name, amount, currency, frequency")
    .eq("user_id", input.userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(SIMILAR_FIXED_CAP + 1);
  // Un guard que no pudo leer NO autoriza. Antes, `[]` significaba "no hay ninguno
  // parecido" y el fijo duplicado entraba — justo cuando el guard más hacía falta.
  if (error || !data) return { ok: false, complete: false };
  // Un scan topado tampoco autoriza: "no vi ninguno parecido" solo vale si los vi
  // TODOS. El slice va antes del filter — el veredicto es sobre las filas crudas.
  const capped = data.length > SIMILAR_FIXED_CAP;
  const rows = data.slice(0, SIMILAR_FIXED_CAP);
  const norm = (t: string) =>
    t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  const target = norm(input.name);
  if (!target) return capped ? { ok: true, complete: false, partial: [] } : { ok: true, complete: true, matches: [] };
  const found = (rows as { id: string; name: string; amount: number | string; currency: string; frequency: string }[])
    .filter((row) => {
      const n = norm(row.name);
      return n.includes(target) || target.includes(n);
    })
    .map((row) => ({
      id: row.id,
      name: row.name,
      amount: Number(row.amount),
      currency: row.currency,
      frequency: row.frequency,
    }));
  return capped ? { ok: true, complete: false, partial: found } : { ok: true, complete: true, matches: found };
}

// ── Scheduled (future, not-yet-paid) payments ───────────────────────────────

export interface CreateScheduledPaymentInput {
  userId: string;
  name: string;
  amount?: number | null;
  currency: CurrencyCode;
  category: FinancialCategory;
  dueDate: string; // YYYY-MM-DD
  recurring: boolean;
  paymentSourceType?: PaymentSourceType;
  paymentSourceId?: string;
  rawInput?: string;
}

export async function createScheduledPayment(
  input: CreateScheduledPaymentInput,
): Promise<{ id: string } | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("scheduled_payments")
    .insert({
      user_id: input.userId,
      name: input.name,
      amount: input.amount ?? null,
      currency: input.currency,
      category: input.category,
      due_date: input.dueDate,
      recurring: input.recurring,
      payment_source_type: input.paymentSourceType ?? null,
      payment_source_id: input.paymentSourceId ?? null,
      status: "scheduled",
      raw_input: input.rawInput ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: data.id as string };
}

export interface UpcomingScheduledPayment {
  id: string;
  name: string;
  amount: number | null;
  currency: string;
  category: string;
  dueDate: string;
  recurring: boolean;
  // Stage D — declared funding source (Tesorería alerts need to know WHICH
  // account must hold the money before the due date).
  paymentSourceType: string | null;
  paymentSourceId: string | null;
}

interface ScheduledPaymentRow {
  id: string;
  name: string;
  amount: number | string | null;
  currency: string;
  category: string;
  due_date: string;
  recurring: boolean;
  payment_source_type: string | null;
  payment_source_id: string | null;
}

function mapScheduled(row: ScheduledPaymentRow): UpcomingScheduledPayment {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency,
    category: row.category,
    dueDate: row.due_date,
    recurring: row.recurring,
    paymentSourceType: row.payment_source_type ?? null,
    paymentSourceId: row.payment_source_id ?? null,
  };
}

/** A scheduled-payments read that reports on itself. See `money-read.ts`. */
export type ScheduledPaymentsRead =
  | { ok: true; complete: true; payments: UpcomingScheduledPayment[] }
  | { ok: true; complete: false; partial: UpcomingScheduledPayment[] }
  | { ok: false; complete: false };

// "Vi N" y "hay N" no pueden ser la misma frase: se pide uno más y la fila extra
// prueba que había cola. El tope escala con la VENTANA: 20 alcanzaba para 45 días,
// pero la tool del agente pide 400 — con un recordatorio mensual se pasaba de 20,
// marcaba complete:false y el guard rechazaba editar o cancelar un pago a quien
// simplemente tiene muchos. Seguro, pero una regresión de UX innecesaria.
const scheduledCapFor = (withinDays: number) => Math.max(20, Math.ceil(withinDays / 45) * 20);

// Upcoming, still-scheduled payments for a user (for coach context / reminders).
export async function readUpcomingScheduledPayments(
  userId: string,
  withinDays = 45,
): Promise<ScheduledPaymentsRead> {
  const supabase = createSupabaseAdminClient();
  const cap = scheduledCapFor(withinDays);
  const until = new Date(Date.now() + withinDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await supabase
    .from("scheduled_payments")
    .select("id, name, amount, currency, category, due_date, recurring, payment_source_type, payment_source_id")
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .lte("due_date", until)
    .order("due_date", { ascending: true })
    .limit(cap + 1);
  // Bloque I — el error se tragaba y el .limit(20) truncaba sin avisar. Los pagos
  // programados son plata que el calendario APARTA: perderlos sube el punto más bajo
  // de la proyección, o sea la cota del calendario del Saldo. "No tiene pagos" y "no
  // pude leer sus pagos" tienen que ser respuestas distintas.
  if (error || !data) return { ok: false, complete: false };
  const capped = data.length > cap;
  const payments = (data.slice(0, cap) as ScheduledPaymentRow[]).map(mapScheduled);
  return capped ? { ok: true, complete: false, partial: payments } : { ok: true, complete: true, payments };
}

/** DISPLAY ONLY — collapses a failed read into an empty list. */
export async function loadUpcomingScheduledPaymentsForDisplay(
  userId: string,
  withinDays = 45,
): Promise<UpcomingScheduledPayment[]> {
  const read = await readUpcomingScheduledPayments(userId, withinDays);
  return read.ok ? (read.complete ? read.payments : read.partial) : [];
}

export interface DueScheduledPayment extends UpcomingScheduledPayment {
  userId: string;
  paymentSourceType: string | null;
  paymentSourceId: string | null;
}

/** Una lectura de vencidos que reporta sobre sí misma. Ver `money-read.ts`. */
export type DueScheduledPaymentsRead =
  | { ok: true; complete: true; payments: DueScheduledPayment[] }
  | { ok: true; complete: false; partial: DueScheduledPayment[] }
  | { ok: false; complete: false };

const DUE_SCHEDULED_CAP = 200;

// Scheduled payments whose due date has arrived (status still 'scheduled').
// Used by the cron route to surface them. Service-role scan. La versión vieja
// (`loadDueScheduledPayments`) devolvía [] ante error y truncaba en 200 sin señal —
// "no pude leer" y "no vence nada" eran la misma respuesta (re-auditoría 2, punto 10).
export async function readDueScheduledPayments(asOfDate: string): Promise<DueScheduledPaymentsRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("scheduled_payments")
      .select(
        "id, user_id, name, amount, currency, category, due_date, recurring, payment_source_type, payment_source_id",
      )
      .eq("status", "scheduled")
      .lte("due_date", asOfDate)
      .order("due_date", { ascending: true })
      .limit(DUE_SCHEDULED_CAP + 1);
    if (error || !data) return { ok: false, complete: false };
    const rows = data as (ScheduledPaymentRow & {
      user_id: string;
      payment_source_type: string | null;
      payment_source_id: string | null;
    })[];
    const capped = rows.length > DUE_SCHEDULED_CAP;
    const payments = rows.slice(0, DUE_SCHEDULED_CAP).map((row) => ({
      ...mapScheduled(row),
      userId: row.user_id,
      paymentSourceType: row.payment_source_type,
      paymentSourceId: row.payment_source_id,
    }));
    return capped ? { ok: true, complete: false, partial: payments } : { ok: true, complete: true, payments };
  } catch {
    return { ok: false, complete: false };
  }
}

export async function setScheduledPaymentStatus(input: {
  userId: string;
  id: string;
  status: "scheduled" | "done" | "cancelled" | "skipped";
  createdTransactionId?: string | null;
}): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { status: input.status };
  if (input.createdTransactionId !== undefined) {
    patch.created_transaction_id = input.createdTransactionId;
  }
  const { error } = await supabase
    .from("scheduled_payments")
    .update(patch)
    .eq("id", input.id)
    .eq("user_id", input.userId);
  return !error;
}

// Edit a still-scheduled payment's amount and/or due date (never its currency —
// that would silently re-denominate). No money moves; this only changes the
// FUTURE plan. `.select()` confirms a row actually matched (user + id + still
// scheduled), so editing a non-existent / already-materialized one returns false
// instead of a false success.
export async function updateScheduledPaymentFields(input: {
  userId: string;
  id: string;
  amount?: number;
  dueDate?: string;
}): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  if (typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount > 0) {
    patch.amount = input.amount;
  }
  if (typeof input.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    patch.due_date = input.dueDate;
  }
  if (Object.keys(patch).length === 0) return false;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("scheduled_payments")
    .update(patch)
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .eq("status", "scheduled")
    .select("id");
  return !error && (data?.length ?? 0) > 0;
}

// ── Receivables (loans out / money owed) ────────────────────────────────────

export interface CreateReceivableInput {
  userId: string;
  counterparty: string;
  direction?: "owed_to_user" | "user_owes";
  amount: number;
  currency: CurrencyCode;
  reason?: string;
  originTransactionId?: string | null;
}

export async function createReceivable(
  input: CreateReceivableInput,
): Promise<{ id: string } | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("receivables")
    .insert({
      user_id: input.userId,
      counterparty: input.counterparty,
      direction: input.direction ?? "owed_to_user",
      original_amount: input.amount,
      outstanding_amount: input.amount,
      currency: input.currency,
      reason: input.reason ?? null,
      status: "open",
      origin_transaction_id: input.originTransactionId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: data.id as string };
}

export interface OpenReceivable {
  id: string;
  counterparty: string;
  direction: string;
  originalAmount: number;
  outstandingAmount: number;
  currency: string;
  reason: string | null;
  status: string;
}

interface ReceivableRow {
  id: string;
  counterparty: string;
  direction: string;
  original_amount: number | string;
  outstanding_amount: number | string;
  currency: string;
  reason: string | null;
  status: string;
}

function mapReceivable(row: ReceivableRow): OpenReceivable {
  return {
    id: row.id,
    counterparty: row.counterparty,
    direction: row.direction,
    originalAmount: Number(row.original_amount),
    outstandingAmount: Number(row.outstanding_amount),
    currency: row.currency,
    reason: row.reason,
    status: row.status,
  };
}

/** A receivables read that reports on itself. See `money-read.ts`. */
export type OpenReceivablesRead =
  | { ok: true; complete: true; receivables: OpenReceivable[] }
  | { ok: true; complete: false; partial: OpenReceivable[] }
  | { ok: false; complete: false };

// Nadie tiene 200 préstamos abiertos; el tope es sanitario. Pero "vi 200" y "hay
// 200" no pueden ser la misma frase: se pide uno más y la fila extra prueba la cola.
const RECEIVABLES_CAP = 200;

/** El MONEY read: esta lista decide contra QUÉ préstamo se descuenta una
 *  devolución. Leer [] cuando la lectura falló significaba "no le debían nada" — el
 *  ingreso se registraba igual y el préstamo quedaba pendiente para siempre. */
export async function readOpenReceivables(
  userId: string,
  direction: "owed_to_user" | "user_owes" = "owed_to_user",
): Promise<OpenReceivablesRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("receivables")
      .select(
        "id, counterparty, direction, original_amount, outstanding_amount, currency, reason, status",
      )
      .eq("user_id", userId)
      .eq("direction", direction)
      .in("status", ["open", "partial"])
      .order("created_at", { ascending: true })
      .limit(RECEIVABLES_CAP + 1);
    if (error || !data) return { ok: false, complete: false };
    const capped = data.length > RECEIVABLES_CAP;
    const receivables = (data.slice(0, RECEIVABLES_CAP) as ReceivableRow[]).map(mapReceivable);
    return capped
      ? { ok: true, complete: false, partial: receivables }
      : { ok: true, complete: true, receivables };
  } catch {
    return { ok: false, complete: false };
  }
}

/** DISPLAY ONLY — collapses a failed read into an empty list. */
export async function loadOpenReceivablesForDisplay(
  userId: string,
  direction: "owed_to_user" | "user_owes" = "owed_to_user",
): Promise<OpenReceivable[]> {
  const read = await readOpenReceivables(userId, direction);
  return read.ok ? (read.complete ? read.receivables : read.partial) : [];
}

/** Una asignación exacta contra receivables abiertos, calculada ANTES de escribir
 *  nada. `expectedOutstanding` es el CAS que la RPC exige: si el préstamo cambió
 *  entre esta lectura y la escritura, TODO se revierte y se reintenta. */
export interface RepaymentAllocation {
  receivableId: string;
  amount: number;
  expectedOutstanding: number;
}

/** PURO — la lógica de matching (más viejo primero, split parcial), extraída para
 *  que el gate la recorra. No toca la base: produce el plan que la RPC ejecuta.
 *
 *  `currency` (re-auditoría 2, punto 4): la devolución solo puede cerrar préstamos
 *  EN SU MISMA MONEDA — receivables lleva una sola columna de moneda y el monto se
 *  reparte numéricamente, así que sin este filtro 100 ARS cerraban 100 USD. Un
 *  préstamo en otra moneda simplemente no es candidato (el agente pregunta o lo
 *  registra como ingreso normal); la RPC re-valida la misma invariante por si un
 *  caller nuevo se salta el plan. */
export function planRepaymentAllocations(
  open: OpenReceivable[],
  counterparty: string | null,
  amount: number,
  currency: string,
): { allocations: RepaymentAllocation[]; matched: number } {
  const norm = (t: string) =>
    t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  const target = counterparty ? norm(counterparty) : null;
  const cur = currency.trim().toUpperCase();
  const sameCurrency = open.filter((r) => (r.currency || "").trim().toUpperCase() === cur);
  const candidates = target
    ? sameCurrency.filter(
        (r) => norm(r.counterparty).includes(target) || target.includes(norm(r.counterparty)),
      )
    : sameCurrency;
  let remaining = amount;
  let matched = 0;
  const allocations: RepaymentAllocation[] = [];
  for (const r of candidates) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, r.outstandingAmount);
    if (applied <= 0) continue;
    allocations.push({
      receivableId: r.id,
      amount: Math.round(applied * 100) / 100,
      expectedOutstanding: r.outstandingAmount,
    });
    remaining -= applied;
    matched += applied;
  }
  return { allocations, matched: Math.round(matched * 100) / 100 };
}

// Bloque I (re-auditoría): el viejo applyReceivableRepayment vivía aquí — leía con
// error→[], escribía DESPUÉS de que el ledger ya había registrado el ingreso, y sin
// CAS. Fue reemplazado por readOpenReceivables + planRepaymentAllocations (arriba) +
// la RPC atómica kipu_apply_repayment (migración 057), invocada desde el módulo del
// single-writer (applyRepaymentEntry en apply-chat-transaction-intent.ts): el ingreso
// y el descuento aterrizan juntos, o ninguno.

// ── Stage 30 — per-row notes + card-cycle paid signal ───────────────────────
// These write the `notes` column the coach reads as memory (migration 035 added
// it to accounts/debt_accounts/goals; fixed_expenses/income_sources already had
// it), and the card `last_payment_date` so the billing cycle can tell "paid this
// statement" from "still owed" (detection B) without a manual "0" movement. No
// money moves here; the ledger writer stays the sole mover of balances.

// The DB table + column that back each note-bearing entity. fixed_expense goes
// through updateFixedExpenseFields (currency/amount safety lives there); the rest
// are simple text columns on a user-scoped, already-RLS'd table.
const NOTE_TABLE_BY_ENTITY: Record<"account" | "debt" | "goal" | "asset" | "income", string> = {
  account: "accounts",
  debt: "debt_accounts",
  goal: "goals",
  asset: "investment_accounts",
  income: "income_sources",
};

// Attach/replace/clear the free-text note on one entity, scoped to the user.
// `.select()` confirms a row matched so a stale id reads as failure. An empty /
// whitespace note clears it (null). Returns false on any error → Kipu never
// claims it saved a note that didn't land.
export async function setEntityNote(input: {
  userId: string;
  entity: "account" | "debt" | "goal" | "asset" | "income";
  id: string;
  note: string | null;
}): Promise<boolean> {
  const table = NOTE_TABLE_BY_ENTITY[input.entity];
  if (!table || !input.id) return false;
  const value = input.note && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from(table)
      .update({ notes: value })
      .eq("id", input.id)
      .eq("user_id", input.userId)
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// Stage-day-to-day F2 — after a credit-card payment, lower the PENDING STATEMENT
// (`full_payment_due`, "pago del mes") by what was paid, floored at 0, so it reflects
// what's LEFT to pay this cycle. The ACCUMULATED balance (`current_balance`) is
// reduced separately by the ledger writer — the two card numbers stay distinct (F4).
// Only credit cards carry a per-cycle statement (the `.eq("type","credit_card")`
// guard makes this a no-op for loans, whose full_payment_due is a recurring cuota).
// `currentDue`/`paidInCardCurrency` are both in the card's OWN currency (the caller
// only passes an amount it could express there — never a fabricated FX).
export async function reduceCardStatementDue(input: {
  userId: string;
  debtAccountId: string;
  currentDue: number;
  paidInCardCurrency: number;
}): Promise<boolean> {
  if (!(input.paidInCardCurrency > 0) || !(input.currentDue > 0)) return true;
  const next = Math.max(0, Math.round((input.currentDue - input.paidInCardCurrency) * 100) / 100);
  if (next === Math.round(input.currentDue * 100) / 100) return true; // nothing to change
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("debt_accounts")
      .update({ full_payment_due: next })
      .eq("id", input.debtAccountId)
      .eq("user_id", input.userId)
      .eq("type", "credit_card");
    return !error;
  } catch {
    return false;
  }
}

// Bloque C — the CORTE ask sets the closed statement ("pago del mes") when the user confirms the
// cut amount on the cutoff day. SETS full_payment_due (unlike reduceCardStatementDue which lowers
// it after a payment) + stamps statement_date. Guarded to credit cards, and refuses to overwrite
// a NEWER statement with an older corte date (same older-over-newer protection as a statement
// import), so a late/duplicate confirm can't clobber a fresher cut. `amount` is in the card's own
// currency. Returns true on success (or a safe no-op).
export async function setCardStatementDue(input: {
  userId: string;
  debtAccountId: string;
  amount: number;
  statementDateISO: string;
}): Promise<boolean> {
  if (!(input.amount >= 0)) return false;
  try {
    const supabase = createSupabaseAdminClient();
    const { data: cur } = await supabase
      .from("debt_accounts")
      .select("statement_date, type")
      .eq("id", input.debtAccountId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (!cur || cur.type !== "credit_card") return false;
    const existing = cur.statement_date ? String(cur.statement_date).slice(0, 10) : null;
    if (existing && input.statementDateISO < existing) return true; // don't clobber a newer statement
    const { error } = await supabase
      .from("debt_accounts")
      .update({ full_payment_due: input.amount, statement_date: input.statementDateISO })
      .eq("id", input.debtAccountId)
      .eq("user_id", input.userId)
      .eq("type", "credit_card");
    return !error;
  } catch {
    return false;
  }
}

// Day-to-day F3 — capitalize BANK-REALISTIC interest onto a carried card balance.
// Increases current_balance by the interest (bank finance charge) and stamps
// last_interest_accrued_on so the monthly cron never double-charges. original/base
// grow in the same ratio the row already has (multi-currency safe). Typed executor
// (mirrors update_card_obligations, which also writes current_balance directly);
// guarded to credit_card. Returns false on any error → the cron logs + moves on.
export interface InterestCandidateCard {
  id: string;
  userId: string;
  currentBalanceBase: number;
  currentBalanceOriginal: number;
  fullPaymentDue: number | null;
  cutoffDay: number | null;
  dueDay: number | null;
  interestRate: number | null;
  interestRateKind: string | null;
  lastInterestAccruedOn: string | null;
}

/** El scan del cron de interés reporta sobre sí mismo. Antes devolvía [] ante error
 *  y no probaba completitud: el cron respondía 200 con cero tarjetas y la deuda
 *  quedaba SUBESTIMADA — el mismo fail-open de siempre, en el único camino que hace
 *  CRECER un saldo de tarjeta. Es un scan GLOBAL multi-usuario, así que un CAP fijo
 *  no alcanza: se pagina por keyset sobre `id` (orden total, sin offsets corridos),
 *  pidiendo PAGE+1 por vuelta — la fila extra prueba que había cola. */
export type InterestCandidatesRead =
  | { ok: true; complete: true; cards: InterestCandidateCard[] }
  /** Tope de vueltas con cola detrás: cada tarjeta vista es acumulable (idempotente
   *  por CAS + last_interest_accrued_on), pero la corrida NO es completa. */
  | { ok: true; complete: false; partial: InterestCandidateCard[] }
  | { ok: false; complete: false };

const INTEREST_PAGE = 500;
const INTEREST_MAX_PAGES = 40;

export async function readCardsForInterestAccrual(): Promise<InterestCandidatesRead> {
  const out: InterestCandidateCard[] = [];
  const seen = new Set<string>();
  try {
    const supabase = createSupabaseAdminClient();
    let afterId: string | null = null;
    for (let page = 0; page < INTEREST_MAX_PAGES; page++) {
      let q = supabase
        .from("debt_accounts")
        .select("id, user_id, current_balance_base, current_balance_original, full_payment_due, cutoff_day, due_day, interest_rate, interest_rate_kind, last_interest_accrued_on")
        .eq("type", "credit_card")
        .gt("current_balance_base", 0)
        .gt("interest_rate", 0)
        .not("cutoff_day", "is", null)
        .not("due_day", "is", null)
        .order("id", { ascending: true })
        .limit(INTEREST_PAGE + 1);
      if (afterId) q = q.gt("id", afterId);
      const { data, error } = await q;
      if (error || !data) return { ok: false, complete: false };
      const hasTail = data.length > INTEREST_PAGE;
      for (const r0 of data.slice(0, INTEREST_PAGE) as Record<string, unknown>[]) {
        const id = String(r0.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        afterId = id;
        out.push({
          id,
          userId: String(r0.user_id),
          currentBalanceBase: Number(r0.current_balance_base) || 0,
          currentBalanceOriginal: Number(r0.current_balance_original) || 0,
          fullPaymentDue: r0.full_payment_due == null ? null : Number(r0.full_payment_due),
          cutoffDay: r0.cutoff_day == null ? null : Number(r0.cutoff_day),
          dueDay: r0.due_day == null ? null : Number(r0.due_day),
          interestRate: r0.interest_rate == null ? null : Number(r0.interest_rate),
          interestRateKind: r0.interest_rate_kind == null ? null : String(r0.interest_rate_kind),
          lastInterestAccruedOn: r0.last_interest_accrued_on == null ? null : String(r0.last_interest_accrued_on),
        });
      }
      // Página corta = PROBADO que no queda cola.
      if (!hasTail) return { ok: true, complete: true, cards: out };
    }
    // Tope de vueltas con cola pendiente: cada tarjeta leída es independiente y
    // acumulable, pero la corrida no puede llamarse completa.
    return { ok: true, complete: false, partial: out };
  } catch {
    return { ok: false, complete: false };
  }
}

/** Resultado discriminado (re-auditoría 2, punto 10): un conflicto de CAS (compra
 *  concurrente; benigno, mañana acumula sobre el saldo correcto) NO es lo mismo que
 *  un error real de escritura — el cron responde 5xx solo con `failed`. */
export type AccrueResult = "applied" | "conflict" | "failed";

export async function accrueCardInterest(input: {
  userId: string;
  debtAccountId: string;
  currentBalanceBase: number;
  currentBalanceOriginal: number;
  interestBase: number;
  todayISO: string;
}): Promise<AccrueResult> {
  if (!(input.interestBase > 0)) return "applied";
  const ratio = input.currentBalanceBase > 0 ? input.currentBalanceOriginal / input.currentBalanceBase : 1;
  const interestOriginal = Math.round(input.interestBase * ratio * 100) / 100;
  const newBase = Math.round((input.currentBalanceBase + input.interestBase) * 100) / 100;
  const newOriginal = Math.round((input.currentBalanceOriginal + interestOriginal) * 100) / 100;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("debt_accounts")
      .update({
        current_balance_base: newBase,
        current_balance_original: newOriginal,
        last_interest_accrued_on: input.todayISO,
      })
      .eq("id", input.debtAccountId)
      .eq("user_id", input.userId)
      .eq("type", "credit_card")
      // COMPARE-AND-SWAP. Esto es un read-modify-write: el saldo se leyó antes y se
      // escribe `leído + interés`. Sin esta condición, una compra registrada ENTRE la
      // lectura y este UPDATE se borraba — el write la pisaba con el saldo viejo más
      // el interés. Si el saldo ya no es el que leímos, no matchea ninguna fila y el
      // cron devuelve false: como `last_interest_accrued_on` tampoco se escribe, el
      // interés se acredita mañana sobre el saldo correcto. Perder un día de interés
      // es recuperable; borrar una compra del usuario, no.
      .eq("current_balance_base", input.currentBalanceBase)
      .select("id");
    if (error) return "failed";
    return (data?.length ?? 0) > 0 ? "applied" : "conflict";
  } catch {
    return "failed";
  }
}

// Record when a card's statement was last paid, so the cycle engine reads it as
// paid (detection B). Only the date is written — the actual money movement (cash
// out, debt down) goes through the ledger's debt_payment writer, NOT here. Scoped
// to the user; `.select()` confirms the row matched.
export async function setDebtLastPaymentDate(input: {
  userId: string;
  debtAccountId: string;
  date: string; // YYYY-MM-DD
}): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return false;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("debt_accounts")
      .update({ last_payment_date: input.date })
      .eq("id", input.debtAccountId)
      .eq("user_id", input.userId)
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
