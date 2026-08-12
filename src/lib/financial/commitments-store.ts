import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { insertIdempotentUserRow } from "@/lib/financial/idempotent-user-create";
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
  isVariable?: boolean;
  operationKey?: string | null;
}

export function normalizeFixedExpenseCreateFields(
  input: Pick<CreateFixedExpenseInput, "name" | "amount" | "currency">,
): { name: string; amount: number; currency: CurrencyCode } | null {
  const name = String(input.name ?? "").trim();
  const amount = Number(input.amount);
  const currency = String(input.currency ?? "").trim().toUpperCase();
  if (
    !name ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return null;
  }
  return {
    name,
    amount,
    currency: currency as CurrencyCode,
  };
}

export async function createFixedExpense(
  input: CreateFixedExpenseInput,
): Promise<{ id: string; replayed?: boolean } | null> {
  // This function is a shared writer (agent, onboarding, Mis Datos and the
  // emergency pipeline). Runtime callers do not get to rely on TypeScript's
  // nominal types: an invalid amount/name/currency must stop before the
  // idempotency marker or the regime triggers are touched.
  const normalized = normalizeFixedExpenseCreateFields(input);
  if (!normalized) return null;
  const created = await insertIdempotentUserRow({
    table: "fixed_expenses",
    userId: input.userId,
    row: {
      user_id: input.userId,
      name: normalized.name,
      amount: normalized.amount,
      // Runtime inputs can arrive outside TypeScript (LLM/tool payloads and
      // old callers). Validate and persist the SAME canonical denomination:
      // accepting "ars" but storing it lowercase would make a newly-created
      // plan disagree with the forecast/observation regime that normalizes it.
      currency: normalized.currency,
      category: input.category,
      frequency: input.frequency,
      start_date: input.startDate ?? null,
      payment_source_type: input.paymentSourceType ?? null,
      payment_source_id: input.paymentSourceId ?? null,
      is_essential: input.isEssential ?? false,
      is_variable: input.isVariable ?? false,
      is_active: true,
    },
    identity: input.operationKey
      ? { operationKey: input.operationKey }
      : null,
  });
  return created
    ? { id: created.id, replayed: created.replayed }
    : null;
}

export async function updateFixedExpenseAmount(input: {
  userId: string;
  id: string;
  amount: number;
}): Promise<boolean> {
  if (!Number.isFinite(input.amount) || input.amount < 0) return false;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("fixed_expenses")
    .update({ amount: input.amount })
    .eq("id", input.id)
    .eq("user_id", input.userId)
    // Emergency legacy may span two chat turns. A plan that was stable when
    // the clarification opened may have become variable before confirmation;
    // that stale proposal is not authority to rewrite its learned baseline.
    .eq("is_variable", false)
    .select("id");
  return !error && (data?.length ?? 0) > 0;
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
  /** Optional optimistic contract used by agent flows that first classified
   * the plan as fixed/variable. A concurrent regime change invalidates that
   * proposal instead of letting a stale turn rewrite the new regime. */
  expectedIsVariable?: boolean;
  // Stage 30 — free-text note the coach reads as memory. Empty string clears it.
  notes?: string | null;
}): Promise<boolean> {
  if (
    input.amount !== undefined &&
    (!Number.isFinite(input.amount) || input.amount < 0)
  ) {
    return false;
  }
  const patch: Record<string, unknown> = {};
  if (input.amount !== undefined) patch.amount = input.amount;
  if (input.startDate !== undefined) patch.start_date = input.startDate;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.expectedDay !== undefined) patch.expected_day = input.expectedDay;
  if (input.name !== undefined && input.name.trim()) patch.name = input.name.trim().slice(0, 120);
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.isVariable !== undefined) patch.is_variable = input.isVariable;
  if (input.notes !== undefined) patch.notes = input.notes && input.notes.trim() ? input.notes.trim().slice(0, 500) : null;
  if (Object.keys(patch).length === 0) return true;
  const supabase = createSupabaseAdminClient();
  // Zero matched rows (stale id, someone else's row) must read as failure —
  // otherwise Kipu confirms a pause/rename that never happened.
  let query = supabase
    .from("fixed_expenses")
    .update(patch)
    .eq("id", input.id)
    .eq("user_id", input.userId);
  if (input.expectedIsVariable !== undefined) {
    query = query.eq("is_variable", input.expectedIsVariable);
  }
  const { data, error } = await query.select("id");
  return !error && (data?.length ?? 0) > 0;
}

export interface ExistingFixedExpense {
  id: string;
  name: string;
  amount: number;
  currency: string;
  frequency: string;
  isVariable?: boolean;
  isActive?: boolean;
  expectedDay?: number | null;
  expectedWeekday?: number | null;
  payAnchorDate?: string | null;
  startDate?: string | null;
  /** Present on the complete catalog used for historical-cycle decisions.
   * Similar-name scans do not need or select it. */
  createdAt?: string;
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

const FIXED_CATALOG_PAGE = 200;
const FIXED_CATALOG_MAX_PAGES = 100;

export type FixedExpenseCatalogRead =
  | { ok: true; complete: true; expenses: ExistingFixedExpense[] }
  | { ok: true; complete: false; partial: ExistingFixedExpense[] }
  | { ok: false; complete: false };

type FixedExpenseCatalogRow = {
  id?: unknown;
  name?: unknown;
  amount?: unknown;
  currency?: unknown;
  frequency?: unknown;
  is_variable?: unknown;
  is_active?: unknown;
  expected_day?: unknown;
  expected_weekday?: unknown;
  pay_anchor_date?: unknown;
  start_date?: unknown;
  created_at?: unknown;
};

export type FixedExpenseCatalogPageReader = (
  afterId: string | null,
  limit: number,
) => Promise<{
  rows: FixedExpenseCatalogRow[] | null;
  error: { message?: string } | null;
}>;

const FIXED_CATALOG_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validOptionalDate(value: unknown): value is string | null | undefined {
  if (value == null) return true;
  const date = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month &&
    parsed.getUTCDate() === day
  );
}

function decodeFixedExpenseCatalogRow(
  row: FixedExpenseCatalogRow,
): ExistingFixedExpense | null {
  const id = String(row.id ?? "");
  const name = String(row.name ?? "").trim();
  const amount = Number(row.amount);
  const currency = String(row.currency ?? "").trim().toUpperCase();
  const frequency = String(row.frequency ?? "");
  const expectedDay =
    row.expected_day == null ? null : Number(row.expected_day);
  const expectedWeekday =
    row.expected_weekday == null ? null : Number(row.expected_weekday);
  const createdAt = String(row.created_at ?? "");
  if (
    !FIXED_CATALOG_UUID_RE.test(id) ||
    !name ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    !/^[A-Z]{3}$/.test(currency) ||
    !["weekly", "biweekly", "monthly", "yearly", "custom"].includes(
      frequency,
    ) ||
    (expectedDay != null &&
      (!Number.isInteger(expectedDay) ||
        expectedDay < 1 ||
        expectedDay > 31)) ||
    (expectedWeekday != null &&
      (!Number.isInteger(expectedWeekday) ||
        expectedWeekday < 0 ||
        expectedWeekday > 6)) ||
    !validOptionalDate(row.pay_anchor_date) ||
    !validOptionalDate(row.start_date) ||
    !Number.isFinite(Date.parse(createdAt))
  ) {
    return null;
  }
  return {
    id,
    name,
    amount,
    currency,
    frequency,
    isVariable: row.is_variable === true,
    isActive: row.is_active !== false,
    expectedDay,
    expectedWeekday,
    payAnchorDate:
      row.pay_anchor_date == null
        ? null
        : String(row.pay_anchor_date).slice(0, 10),
    startDate:
      row.start_date == null ? null : String(row.start_date).slice(0, 10),
    createdAt,
  };
}

function catalogInCreationOrder(
  expenses: ExistingFixedExpense[],
): ExistingFixedExpense[] {
  return [...expenses].sort(
    (left, right) =>
      String(left.createdAt).localeCompare(String(right.createdAt)) ||
      left.id.localeCompare(right.id),
  );
}

/** Complete catalog for decisions that start from an internal id.
 *
 * An id chosen by the model is not user authority. Callers need the complete
 * id↔name catalog to prove which human entity that id denotes and, when there
 * are several candidates, verify that the user actually named it.
 */
export async function readFixedExpenseCatalog(
  userId: string,
): Promise<FixedExpenseCatalogRead> {
  try {
    const supabase = createSupabaseAdminClient();
    return await readFixedExpenseCatalogWith(
      async (afterId, limit) => {
        let query = supabase
          .from("fixed_expenses")
          .select(
            "id, name, amount, currency, frequency, is_variable, is_active, expected_day, expected_weekday, pay_anchor_date, start_date, created_at",
          )
          .eq("user_id", userId)
          .order("id", { ascending: true })
          .limit(limit);
        if (afterId) query = query.gt("id", afterId);
        const { data, error } = await query;
        return {
          rows: data as FixedExpenseCatalogRow[] | null,
          error: error ? { message: error.message } : null,
        };
      },
    );
  } catch {
    return { ok: false, complete: false };
  }
}

/** Complete historical catalog by UUID keyset. A lifetime catalog is not an
 * active-set guard: eventually it can exceed any one-page cap. A later-page
 * failure never means "that was the end", and exhausting the large safety
 * fuse exposes only a non-publishable partial result. */
export async function readFixedExpenseCatalogWith(
  readPage: FixedExpenseCatalogPageReader,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<FixedExpenseCatalogRead> {
  const pageSize = Math.max(
    1,
    Math.min(500, Math.floor(options.pageSize ?? FIXED_CATALOG_PAGE)),
  );
  const maxPages = Math.max(
    1,
    Math.min(
      FIXED_CATALOG_MAX_PAGES,
      Math.floor(options.maxPages ?? FIXED_CATALOG_MAX_PAGES),
    ),
  );
  const expenses: ExistingFixedExpense[] = [];
  let afterId: string | null = null;
  try {
    for (let page = 0; page < maxPages; page += 1) {
      const result = await readPage(afterId, pageSize + 1);
      if (result.error || !result.rows) {
        return { ok: false, complete: false };
      }
      const pageRows = result.rows.slice(0, pageSize);
      const decoded = pageRows.map(decodeFixedExpenseCatalogRow);
      if (decoded.some((expense) => expense == null)) {
        return { ok: false, complete: false };
      }
      expenses.push(...(decoded as ExistingFixedExpense[]));
      if (result.rows.length <= pageSize) {
        return {
          ok: true,
          complete: true,
          expenses: catalogInCreationOrder(expenses),
        };
      }
      const nextId = String(pageRows.at(-1)?.id ?? "");
      if (!FIXED_CATALOG_UUID_RE.test(nextId) || nextId === afterId) {
        return { ok: false, complete: false };
      }
      afterId = nextId;
    }
    return {
      ok: true,
      complete: false,
      partial: catalogInCreationOrder(expenses),
    };
  } catch {
    return { ok: false, complete: false };
  }
}

export async function readSimilarFixedExpenses(input: {
  userId: string;
  name: string;
}): Promise<SimilarFixedExpensesRead> {
  return readSimilarFixedExpensesWith(readFixedExpenseCatalog, input);
}

export async function readSimilarFixedExpensesWith(
  readCatalog: (userId: string) => Promise<FixedExpenseCatalogRead>,
  input: { userId: string; name: string },
): Promise<SimilarFixedExpensesRead> {
  // Similarity is a JS post-filter, so it needs the same complete lifetime
  // catalog as id-based decisions. Reusing the keyset reader avoids a second
  // hidden terminal cap at 100 active plans.
  let catalog: FixedExpenseCatalogRead;
  try {
    catalog = await readCatalog(input.userId);
  } catch {
    return { ok: false, complete: false };
  }
  if (!catalog.ok) return { ok: false, complete: false };
  const rows = (
    catalog.complete ? catalog.expenses : catalog.partial
  ).filter((row) => row.isActive !== false);
  const norm = (t: string) =>
    t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  const target = norm(input.name);
  if (!target) {
    return catalog.complete
      ? { ok: true, complete: true, matches: [] }
      : { ok: true, complete: false, partial: [] };
  }
  const found = rows
    .filter((row) => {
      const n = norm(row.name);
      return n.includes(target) || target.includes(n);
    })
    .map(({ id, name, amount, currency, frequency, isVariable }) => ({
      id,
      name,
      amount,
      currency,
      frequency,
      isVariable,
    }));
  return catalog.complete
    ? { ok: true, complete: true, matches: found }
    : { ok: true, complete: false, partial: found };
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
  operationKey?: string | null;
}

export async function createScheduledPayment(
  input: CreateScheduledPaymentInput,
): Promise<{ id: string; replayed?: boolean } | null> {
  const created = await insertIdempotentUserRow({
    table: "scheduled_payments",
    userId: input.userId,
    row: {
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
    },
    identity: input.operationKey
      ? { operationKey: input.operationKey }
      : null,
  });
  return created
    ? { id: created.id, replayed: created.replayed }
    : null;
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
  const { data, error } = await supabase
    .from("scheduled_payments")
    .update(patch)
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .select("id");
  return !error && (data?.length ?? 0) > 0;
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
 *  préstamo en otra moneda simplemente no es candidato (el agente pregunta; nunca
 *  lo degrada a ingreso normal); la RPC re-valida la misma invariante por si un
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

export type RepaymentRegistrationDecision =
  | { outcome: "ready"; allocations: RepaymentAllocation[] }
  | { outcome: "ambiguous"; candidates: number }
  | { outcome: "no_match" }
  | { outcome: "unmatched_amount"; matched: number; remainder: number };

/**
 * Decide whether an asserted loan repayment can be tied to durable receivables.
 *
 * This is intentionally stricter than `planRepaymentAllocations`: the latter is
 * a mechanical oldest-first allocator once the counterparty is known, while this
 * function is the conversational authority boundary.  An omitted counterparty is
 * only safe when exactly one receivable in the native currency is open; an
 * explicit but non-unique fuzzy name is ambiguous; and every cent of the stated
 * amount must reduce a receivable.  No outcome authorises falling through to an
 * ordinary income write.
 */
export function repaymentRegistrationDecision(input: {
  receivables: OpenReceivable[];
  counterparty: string | null;
  amount: number;
  currency: string;
}): RepaymentRegistrationDecision {
  const norm = (text: string) =>
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim();
  const currency = input.currency.trim().toUpperCase();
  const sameCurrency = input.receivables.filter(
    (row) => row.currency.trim().toUpperCase() === currency,
  );
  const statedCounterparty = input.counterparty?.trim() || null;
  let candidates: OpenReceivable[];

  if (!statedCounterparty) {
    if (sameCurrency.length === 0) return { outcome: "no_match" };
    if (sameCurrency.length !== 1) {
      return { outcome: "ambiguous", candidates: sameCurrency.length };
    }
    candidates = sameCurrency;
  } else {
    const target = norm(statedCounterparty);
    const exact = sameCurrency.filter((row) => norm(row.counterparty) === target);
    if (exact.length > 0) {
      candidates = exact;
    } else {
      const fuzzy = sameCurrency.filter((row) => {
        const name = norm(row.counterparty);
        return name.includes(target) || target.includes(name);
      });
      if (fuzzy.length === 0) return { outcome: "no_match" };
      const counterparties = new Set(fuzzy.map((row) => norm(row.counterparty)));
      if (counterparties.size !== 1) {
        return { outcome: "ambiguous", candidates: fuzzy.length };
      }
      candidates = fuzzy;
    }
  }

  const plan = planRepaymentAllocations(
    candidates,
    null,
    input.amount,
    currency,
  );
  if (plan.allocations.length === 0) return { outcome: "no_match" };
  if (Math.abs(plan.matched - input.amount) > 0.005) {
    return {
      outcome: "unmatched_amount",
      matched: plan.matched,
      remainder: Math.round((input.amount - plan.matched) * 100) / 100,
    };
  }
  return { outcome: "ready", allocations: plan.allocations };
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

// Auditoría 4 (punto 4): reduceCardStatementDue vivía aquí — la baja best-effort de
// full_payment_due DESPUÉS del ledger, con su booleano ignorado por ambos callers.
// Hoy la baja viaja DENTRO de kipu_apply_card_payment (migración 063, atómica con el
// ledger + CAS + replay); la función se eliminó para que ningún caller nuevo pueda
// resucitar el patrón de dos escrituras.

// Bloque C — the CORTE ask sets the closed statement ("pago del mes") when the user confirms the
// cut amount on the cutoff day. SETS full_payment_due (unlike the payment-time reduction, which
// runs atomically inside kipu_apply_card_payment) + stamps statement_date, in the card's own
// currency.
//
// Pasada 5 (punto 1): por RPC con lock (kipu_set_card_statement, migración 064) —
// el UPDATE viejo no confirmaba filas afectadas (éxito con cero filas) y su
// read→decide→write no tenía CAS (podía pisar un statement MÁS NUEVO aterrizado
// entre la lectura y el write). El resultado es tipado y con nombre:
//   updated / corrected_same_statement → el corte quedó anotado/corregido
//   safe_same_exists   → retry idempotente; conserva el remanente post-pagos
//   safe_newer_exists  → ya había un corte más nuevo; NO se pisó (aviso viejo)
//   {ok:false}         → fila inexistente, no-tarjeta o infra — nada probado
export type SetCardStatementResult =
  | {
      ok: true;
      outcome: "updated" | "safe_newer_exists" | "safe_same_exists" | "corrected_same_statement";
      remainingDue: number;
      statementCovered: boolean;
      occurrenceResolution: "resolved" | "already_resolved" | "ambiguous" | "none";
      occurrenceId: string | null;
    }
  | { ok: false };

/** Decisión inyectable para que el gate recorra la dependencia REAL del resolver
 *  (cero filas, concurrencia, outcome corrupto) sin base de datos. */
export async function setCardStatementDueWith(
  rpc: (payload: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>,
  input: {
    userId: string;
    debtAccountId: string;
    amount: number;
    statementDateISO: string;
    statementFields?: Record<string, number | string>;
    occurrenceId?: string | null;
  },
): Promise<SetCardStatementResult> {
  if (!(input.amount >= 0)) return { ok: false };
  try {
    const { data, error } = await rpc({
      ...(input.statementFields ?? {}),
      user_id: input.userId,
      debt_account_id: input.debtAccountId,
      amount: input.amount,
      statement_date: input.statementDateISO,
      ...(input.occurrenceId ? { occurrence_id: input.occurrenceId } : {}),
    });
    if (error) return { ok: false };
    const row = data as {
      outcome?: string;
      remaining_due?: unknown;
      statement_covered?: unknown;
      occurrence_resolution?: unknown;
      occurrence_id?: unknown;
    } | null;
    const outcome = String(row?.outcome ?? "");
    const remainingDue = row?.remaining_due == null ? Number.NaN : Number(row.remaining_due);
    if (
      (outcome === "updated" || outcome === "safe_newer_exists" || outcome === "safe_same_exists" || outcome === "corrected_same_statement")
      && Number.isFinite(remainingDue)
      && remainingDue >= 0
      && typeof row?.statement_covered === "boolean"
    ) {
      const occurrenceResolution =
        row.occurrence_resolution === "resolved" ||
        row.occurrence_resolution === "already_resolved" ||
        row.occurrence_resolution === "ambiguous"
          ? row.occurrence_resolution
          : "none";
      return {
        ok: true,
        outcome,
        remainingDue,
        statementCovered: row.statement_covered,
        occurrenceResolution,
        occurrenceId:
          occurrenceResolution !== "none" && typeof row.occurrence_id === "string"
            ? row.occurrence_id
            : null,
      };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

// 065 — el monto pendiente declarado por el usuario también es dinero. Los dos
// escritores UI/agente usan este lock+CAS en lugar de UPDATE directo: una compra,
// pago u otro ajuste concurrente gana el CAS y obliga a releer; nunca se pisa.
export type OverrideDebtDueResult =
  | {
      ok: true;
      remainingDue: number;
      statementCovered: boolean | null;
      occurrenceResolution: "resolved" | "already_resolved" | "ambiguous" | "none";
      occurrenceId: string | null;
    }
  | { ok: false; reason: "conflict" | "write_failed" };

export async function overrideDebtDueWith(
  rpc: (payload: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>,
  input: {
    userId: string;
    debtAccountId: string;
    expectedDue: number | null;
    newDue: number;
    occurrenceId?: string | null;
  },
): Promise<OverrideDebtDueResult> {
  if (!(input.newDue >= 0) || (input.expectedDue != null && !(input.expectedDue >= 0))) {
    return { ok: false, reason: "write_failed" };
  }
  try {
    const { data, error } = await rpc({
      user_id: input.userId,
      debt_account_id: input.debtAccountId,
      expected_due: input.expectedDue,
      expected_due_is_null: input.expectedDue == null,
      new_due: input.newDue,
      ...(input.occurrenceId ? { occurrence_id: input.occurrenceId } : {}),
    });
    if (error) {
      const conflict = error.code === "40001" || /KIPU_CONFLICT/.test(error.message ?? "");
      return { ok: false, reason: conflict ? "conflict" : "write_failed" };
    }
    const row = data as {
      outcome?: string;
      remaining_due?: unknown;
      statement_covered?: unknown;
      occurrence_resolution?: unknown;
      occurrence_id?: unknown;
    } | null;
    const remainingDue = row?.remaining_due == null ? Number.NaN : Number(row.remaining_due);
    if (row?.outcome !== "updated" || !Number.isFinite(remainingDue) || remainingDue < 0) {
      return { ok: false, reason: "write_failed" };
    }
    return {
      ok: true,
      remainingDue,
      statementCovered: typeof row.statement_covered === "boolean" ? row.statement_covered : null,
      occurrenceResolution:
        row.occurrence_resolution === "resolved" ||
        row.occurrence_resolution === "already_resolved" ||
        row.occurrence_resolution === "ambiguous"
          ? row.occurrence_resolution
          : "none",
      occurrenceId:
        (row.occurrence_resolution === "resolved" || row.occurrence_resolution === "already_resolved")
          && typeof row.occurrence_id === "string"
          ? row.occurrence_id
          : null,
    };
  } catch {
    return { ok: false, reason: "write_failed" };
  }
}

export async function overrideDebtDue(input: {
  userId: string;
  debtAccountId: string;
  expectedDue: number | null;
  newDue: number;
  occurrenceId?: string | null;
}): Promise<OverrideDebtDueResult> {
  return overrideDebtDueWith(async (payload) => {
    const supabase = createSupabaseAdminClient();
    return supabase.rpc("kipu_override_debt_due_v2", { p: payload });
  }, input);
}

export type UpdateDebtSnapshotResult =
  | { ok: true; remainingDue: number; statementCovered: boolean | null }
  | { ok: false; reason: "conflict" | "write_failed" };

export async function updateDebtSnapshotWith(
  rpc: (payload: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>,
  input: {
    userId: string;
    debtAccountId: string;
    expectedBalanceOriginal: number;
    expectedBalanceBase: number;
    expectedDue: number | null;
    patch: {
      name?: string;
      minimumPayment?: number;
      fullPaymentDue?: number;
      currentBalanceOriginal?: number;
      currentBalanceBase?: number;
    };
  },
): Promise<UpdateDebtSnapshotResult> {
  try {
    const payload: Record<string, unknown> = {
      user_id: input.userId,
      debt_account_id: input.debtAccountId,
      expected_balance_original: input.expectedBalanceOriginal,
      expected_balance_base: input.expectedBalanceBase,
      expected_due: input.expectedDue,
      expected_due_is_null: input.expectedDue == null,
    };
    if (input.patch.name !== undefined) payload.name = input.patch.name;
    if (input.patch.minimumPayment !== undefined) payload.minimum_payment = input.patch.minimumPayment;
    if (input.patch.fullPaymentDue !== undefined) payload.new_due = input.patch.fullPaymentDue;
    if (input.patch.currentBalanceOriginal !== undefined) payload.current_balance_original = input.patch.currentBalanceOriginal;
    if (input.patch.currentBalanceBase !== undefined) payload.current_balance_base = input.patch.currentBalanceBase;
    const { data, error } = await rpc(payload);
    if (error) {
      const conflict = error.code === "40001" || /KIPU_CONFLICT/.test(error.message ?? "");
      return { ok: false, reason: conflict ? "conflict" : "write_failed" };
    }
    const row = data as { outcome?: string; remaining_due?: unknown; statement_covered?: unknown } | null;
    const remainingDue = row?.remaining_due == null ? Number.NaN : Number(row.remaining_due);
    if (row?.outcome !== "updated" || !Number.isFinite(remainingDue) || remainingDue < 0) {
      return { ok: false, reason: "write_failed" };
    }
    return {
      ok: true,
      remainingDue,
      statementCovered: typeof row.statement_covered === "boolean" ? row.statement_covered : null,
    };
  } catch {
    return { ok: false, reason: "write_failed" };
  }
}

export async function updateDebtSnapshot(input: Parameters<typeof updateDebtSnapshotWith>[1]): Promise<UpdateDebtSnapshotResult> {
  return updateDebtSnapshotWith(async (payload) => {
    const supabase = createSupabaseAdminClient();
    return supabase.rpc("kipu_update_debt_snapshot_v2", { p: payload });
  }, input);
}

export async function setCardStatementDue(input: {
  userId: string;
  debtAccountId: string;
  amount: number;
  statementDateISO: string;
  statementFields?: Record<string, number | string>;
  occurrenceId?: string | null;
}): Promise<SetCardStatementResult> {
  return setCardStatementDueWith(async (payload) => {
    const supabase = createSupabaseAdminClient();
    return supabase.rpc("kipu_set_card_statement_v2", { p: payload });
  }, input);
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
