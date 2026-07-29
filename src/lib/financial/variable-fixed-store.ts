import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildLedgerEntryPayload,
  type LedgerEntryInput,
} from "@/lib/ai/apply-chat-transaction-intent";
import { variableFixedCycleKey } from "@/lib/financial/financial-calendar";
import type { PaymentFrequency } from "@/types/financial";

export type VariableFixedConfidence = "baseline" | "low" | "medium" | "high";

export interface VariableFixedForecast {
  fixedExpenseId: string;
  userId: string;
  regime: number;
  declaredAmount: number;
  planningAmount: number;
  currency: string;
  cadence: PaymentFrequency;
  sampleCount: number;
  confidence: VariableFixedConfidence;
  method: "declared" | "conservative_p75";
  lastCycleDate: string | null;
  /** Timestamp at which this learning regime began. An occurrence fabricated
   * later for an older cycle must not inherit the current regime. */
  regimeStartedAt: string;
  updatedAt: string;
}

export type VariableFixedForecastRead =
  | { ok: true; complete: true; forecasts: VariableFixedForecast[] }
  | { ok: true; complete: false; partial: VariableFixedForecast[] }
  | { ok: false; complete: false };

export interface KnownVariableFixedBill {
  occurrenceId: string;
  fixedExpenseId: string;
  occurrenceDate: string;
  /** Cadence snapshotted on the occurrence. It is historical truth: changing
   * the plan later must not reinterpret the cycle this invoice belongs to. */
  cadence: PaymentFrequency;
  amount: number;
  currency: string;
  status: "observed" | "dismissed" | "confirmed" | "corrected";
  /** A settled cycle replaces the forecast with no future cash reservation.
   * Positive settled facts prove their payment transaction; a zero invoice is
   * settled without one. */
  settled: boolean;
}

export type KnownVariableFixedBillsRead =
  | { ok: true; complete: true; bills: KnownVariableFixedBill[] }
  | { ok: true; complete: false; partial: KnownVariableFixedBill[] }
  | { ok: false; complete: false };

export type KnownVariableFixedBillMatch =
  | { ok: true; bill: KnownVariableFixedBill | null }
  | { ok: false; reason: "ambiguous" };

export function knownVariableFixedBillIdentity(
  bill: Pick<
    KnownVariableFixedBill,
    "fixedExpenseId" | "occurrenceDate" | "cadence"
  >,
): string {
  return `${bill.fixedExpenseId}:${bill.cadence}:${variableFixedCycleKey(
    bill.cadence,
    bill.occurrenceDate,
  )}`;
}

type Row = Record<string, unknown>;
// Forecast rows also persist after a plan stops being variable. A global
// CAP+1 eventually turns one healthy active plan into an unreadable feed merely
// because the user accumulated enough historical plans. Page by the immutable
// fixed-expense UUID and prove the final short page instead.
const FORECAST_PAGE = 200;
const FORECAST_MAX_PAGES = 100;
// Unlike forecasts, known invoices grow forever. A single CAP+1 query would
// eventually turn a healthy user's whole Saldo off merely because they had a
// long history. Page by the immutable UUID key and prove the final short page.
// The max is a safety fuse, not a silent cutoff: exhausting it returns
// complete:false and every money consumer fails closed.
const KNOWN_BILLS_PAGE = 200;
const KNOWN_BILLS_MAX_PAGES = 100;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONFIDENCES = new Set<VariableFixedConfidence>([
  "baseline",
  "low",
  "medium",
  "high",
]);
const METHODS = new Set<VariableFixedForecast["method"]>([
  "declared",
  "conservative_p75",
]);
const CADENCES = new Set<PaymentFrequency>([
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
  "custom",
]);

function finiteNumberField(value: unknown): number | null {
  if (
    value == null ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function variableFixedForecastMatchesPlan(
  forecast: VariableFixedForecast,
  plan: {
    amount: number;
    currency: string;
    frequency: string;
  },
): boolean {
  const planAmount = Number(plan.amount);
  return (
    Number.isFinite(planAmount) &&
    Math.abs(forecast.declaredAmount - planAmount) < 0.005 &&
    forecast.currency === plan.currency.trim().toUpperCase() &&
    forecast.cadence === plan.frequency
  );
}

function validDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day
  );
}

export function decodeVariableFixedForecast(
  row: Row,
): VariableFixedForecast | null {
  const fixedExpenseId = String(row.fixed_expense_id ?? "");
  const userId = String(row.user_id ?? "");
  const regime = finiteNumberField(row.regime);
  const declaredAmount = finiteNumberField(row.declared_amount);
  const planningAmount = finiteNumberField(row.planning_amount);
  const rawCurrency = String(row.currency ?? "").trim();
  const currency = rawCurrency.toUpperCase();
  const cadence = String(row.cadence ?? "") as PaymentFrequency;
  const sampleCount = finiteNumberField(row.sample_count);
  const confidence = String(row.confidence ?? "") as VariableFixedConfidence;
  const method = String(row.method ?? "") as VariableFixedForecast["method"];
  const lastCycleDate =
    row.last_cycle_date == null
      ? null
      : String(row.last_cycle_date).slice(0, 10);
  const regimeStartedAt = String(row.regime_started_at ?? "");
  const updatedAt = String(row.updated_at ?? "");
  if (
    !UUID_RE.test(fixedExpenseId) ||
    !UUID_RE.test(userId) ||
    regime == null ||
    !Number.isInteger(regime) ||
    regime <= 0 ||
    declaredAmount == null ||
    declaredAmount < 0 ||
    planningAmount == null ||
    planningAmount < 0 ||
    rawCurrency !== currency ||
    !CURRENCY_RE.test(currency) ||
    !CADENCES.has(cadence) ||
    sampleCount == null ||
    !Number.isInteger(sampleCount) ||
    sampleCount < 0 ||
    !CONFIDENCES.has(confidence) ||
    !METHODS.has(method) ||
    (lastCycleDate != null &&
      (!DATE_RE.test(lastCycleDate) || !validDateOnly(lastCycleDate))) ||
    !Number.isFinite(Date.parse(regimeStartedAt)) ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    Date.parse(updatedAt) < Date.parse(regimeStartedAt)
  ) {
    return null;
  }
  const declaredProjection =
    method === "declared" &&
    Math.abs(planningAmount - declaredAmount) < 0.005;
  const coherentState =
    (sampleCount === 0 &&
      confidence === "baseline" &&
      declaredProjection &&
      lastCycleDate == null) ||
    (sampleCount >= 1 &&
      sampleCount <= 2 &&
      confidence === "low" &&
      declaredProjection &&
      lastCycleDate != null) ||
    (sampleCount >= 3 &&
      sampleCount <= 5 &&
      confidence === "medium" &&
      method === "conservative_p75" &&
      lastCycleDate != null) ||
    (sampleCount >= 6 &&
      (confidence === "medium" || confidence === "high") &&
      method === "conservative_p75" &&
      lastCycleDate != null);
  if (!coherentState) return null;
  return {
    fixedExpenseId,
    userId,
    regime,
    declaredAmount,
    planningAmount,
    currency,
    cadence,
    sampleCount,
    confidence,
    method,
    lastCycleDate,
    regimeStartedAt,
    updatedAt,
  };
}

export async function readVariableFixedForecasts(
  userId: string,
): Promise<VariableFixedForecastRead> {
  try {
    const sb = createSupabaseAdminClient();
    return await readVariableFixedForecastsWith(
      async (afterFixedExpenseId, limit) => {
        let query = sb
          .from("fixed_expense_forecasts")
          .select(
            "fixed_expense_id, user_id, regime, declared_amount, planning_amount, currency, cadence, sample_count, confidence, method, last_cycle_date, regime_started_at, updated_at",
          )
          .eq("user_id", userId)
          .order("fixed_expense_id", { ascending: true })
          .limit(limit);
        if (afterFixedExpenseId) {
          query = query.gt("fixed_expense_id", afterFixedExpenseId);
        }
        const { data, error } = await query;
        return {
          rows: data as Row[] | null,
          error: error ? { message: error.message } : null,
        };
      },
    );
  } catch {
    return { ok: false, complete: false };
  }
}

export type VariableFixedForecastsPageReader = (
  afterFixedExpenseId: string | null,
  limit: number,
) => Promise<{
  rows: Row[] | null;
  error: { message?: string } | null;
}>;

/** Injectable forecast keyset engine. Later-page read/decode failures are
 * failures, never an invented end-of-feed; exhausting the safety fuse exposes
 * a partial, non-publishable result. */
export async function readVariableFixedForecastsWith(
  readPage: VariableFixedForecastsPageReader,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<VariableFixedForecastRead> {
  const pageSize = Math.max(
    1,
    Math.min(500, Math.floor(options.pageSize ?? FORECAST_PAGE)),
  );
  const maxPages = Math.max(
    1,
    Math.min(
      FORECAST_MAX_PAGES,
      Math.floor(options.maxPages ?? FORECAST_MAX_PAGES),
    ),
  );
  const forecasts: VariableFixedForecast[] = [];
  let afterFixedExpenseId: string | null = null;
  try {
    for (let page = 0; page < maxPages; page += 1) {
      const result = await readPage(afterFixedExpenseId, pageSize + 1);
      if (result.error || !result.rows) {
        return { ok: false, complete: false };
      }
      const pageRows = result.rows.slice(0, pageSize);
      const decoded = pageRows.map(decodeVariableFixedForecast);
      if (decoded.some((forecast) => forecast == null)) {
        return { ok: false, complete: false };
      }
      forecasts.push(...(decoded as VariableFixedForecast[]));
      if (result.rows.length <= pageSize) {
        return { ok: true, complete: true, forecasts };
      }
      const nextId = String(pageRows.at(-1)?.fixed_expense_id ?? "");
      if (!UUID_RE.test(nextId) || nextId === afterFixedExpenseId) {
        return { ok: false, complete: false };
      }
      afterFixedExpenseId = nextId;
    }
    return { ok: true, complete: false, partial: forecasts };
  } catch {
    return { ok: false, complete: false };
  }
}

export function decodeKnownVariableFixedBill(
  row: Row,
): KnownVariableFixedBill | null {
  const occurrenceId = String(row.id ?? "");
  const fixedExpenseId = String(row.fixed_expense_id ?? "");
  const occurrenceDate = String(row.occurrence_date ?? "").slice(0, 10);
  const cadence = String(row.fixed_expense_cadence ?? "") as PaymentFrequency;
  const amount = finiteNumberField(row.resolved_amount);
  const rawCurrency = String(row.resolved_currency ?? "").trim();
  const currency = rawCurrency.toUpperCase();
  const status = String(row.status ?? "");
  const transactionId =
    row.created_transaction_id == null
      ? null
      : String(row.created_transaction_id);
  const settled = status === "confirmed" || status === "corrected";
  if (
    !UUID_RE.test(occurrenceId) ||
    !UUID_RE.test(fixedExpenseId) ||
    !DATE_RE.test(occurrenceDate) ||
    !validDateOnly(occurrenceDate) ||
    !CADENCES.has(cadence) ||
    amount == null ||
    amount < 0 ||
    rawCurrency !== currency ||
    !CURRENCY_RE.test(currency) ||
    !["observed", "dismissed", "confirmed", "corrected"].includes(status) ||
    (!settled && transactionId != null) ||
    (settled && amount > 0 && !UUID_RE.test(transactionId ?? "")) ||
    (settled && amount === 0 && transactionId != null)
  ) {
    return null;
  }
  return {
    occurrenceId,
    fixedExpenseId,
    occurrenceDate,
    cadence,
    amount,
    currency,
    status: status as KnownVariableFixedBill["status"],
    settled,
  };
}

export function matchKnownVariableFixedBillCycle(input: {
  bills: KnownVariableFixedBill[];
  fixedExpenseId: string;
  cycleDate?: string | null;
  /** Corrections/retractions may target a paid historical fact. A normal
   * payment report must not infer that an old settled bill is today's cycle. */
  includeSettled?: boolean;
}): KnownVariableFixedBillMatch {
  const matches = input.bills.filter(
    (bill) =>
      (input.includeSettled || !bill.settled) &&
      bill.fixedExpenseId === input.fixedExpenseId &&
      (input.cycleDate == null ||
        variableFixedCycleKey(bill.cadence, bill.occurrenceDate) ===
          variableFixedCycleKey(bill.cadence, input.cycleDate)),
  );
  if (matches.length > 1) return { ok: false, reason: "ambiguous" };
  return { ok: true, bill: matches[0] ?? null };
}

/**
 * Bills whose native amount is already a durable fact. Unpaid facts override
 * the forecast with their exact amount; settled/zero facts suppress that
 * cycle's future reservation. `dismissed` remains deliberately: it means
 * “stop asking”, not “the invoice disappeared”.
 */
export async function readKnownVariableFixedBills(
  userId: string,
): Promise<KnownVariableFixedBillsRead> {
  try {
    const sb = createSupabaseAdminClient();
    return await readKnownVariableFixedBillsWith(async (afterId, limit) => {
      let query = sb
        .from("recurring_occurrences")
        .select(
          "id, fixed_expense_id, occurrence_date, fixed_expense_cadence, resolved_amount, resolved_currency, status, created_transaction_id",
        )
        .eq("user_id", userId)
        .in("status", ["observed", "dismissed", "confirmed", "corrected"])
        .not("fixed_expense_id", "is", null)
        .not("resolved_amount", "is", null)
        .order("id", { ascending: true })
        .limit(limit);
      if (afterId) query = query.gt("id", afterId);
      const { data, error } = await query;
      return {
        rows: data as Row[] | null,
        error: error ? { message: error.message } : null,
      };
    });
  } catch {
    return { ok: false, complete: false };
  }
}

export type KnownVariableFixedBillsPageReader = (
  afterId: string | null,
  limit: number,
) => Promise<{
  rows: Row[] | null;
  error: { message?: string } | null;
}>;

/** Injectable keyset engine used by the live reader and by the adversarial
 * gate. A later-page failure is not "the history ended there", and a repeated
 * cursor is not progress. Both make the result non-publishable. */
export async function readKnownVariableFixedBillsWith(
  readPage: KnownVariableFixedBillsPageReader,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<KnownVariableFixedBillsRead> {
  const pageSize = Math.max(
    1,
    Math.min(500, Math.floor(options.pageSize ?? KNOWN_BILLS_PAGE)),
  );
  const maxPages = Math.max(
    1,
    Math.min(
      KNOWN_BILLS_MAX_PAGES,
      Math.floor(options.maxPages ?? KNOWN_BILLS_MAX_PAGES),
    ),
  );
  const bills: KnownVariableFixedBill[] = [];
  let afterId: string | null = null;
  try {
    for (let page = 0; page < maxPages; page += 1) {
      const result = await readPage(afterId, pageSize + 1);
      if (result.error || !result.rows) {
        return { ok: false, complete: false };
      }
      const pageRows = result.rows.slice(0, pageSize);
      const decoded = pageRows.map(decodeKnownVariableFixedBill);
      if (decoded.some((bill) => bill == null)) {
        return { ok: false, complete: false };
      }
      bills.push(...(decoded as KnownVariableFixedBill[]));
      if (result.rows.length <= pageSize) {
        return { ok: true, complete: true, bills };
      }
      const nextId = String(pageRows.at(-1)?.id ?? "");
      if (!UUID_RE.test(nextId) || nextId === afterId) {
        return { ok: false, complete: false };
      }
      afterId = nextId;
    }
    return { ok: true, complete: false, partial: bills };
  } catch {
    return { ok: false, complete: false };
  }
}

export type RecordVariableFixedResult =
  | {
      ok: true;
      replayed: boolean;
      observationId: string;
      transactionId: string | null;
      occurrenceStatus: "observed" | "confirmed" | "corrected" | "skipped";
      planningAmount: number;
      sampleCount: number;
      confidence: VariableFixedConfidence;
    }
  | { ok: false; reason: "unsafe" | "failed"; detail?: string };

export interface RecordVariableFixedInput {
  userId: string;
  occurrenceId: string;
  amount: number;
  currency: string;
  /** `zero` is a paid-bill correction: reverse the prior cash movement and
   * retain a canonical zero invoice in the same transaction. */
  action: "observe" | "pay" | "retract" | "zero";
  scope: "once" | "from_now";
  dedupeKey: string;
  expectedOccurrenceStatus: string;
  expectedResolvedAmount: number | null;
  expectedTransactionId: string | null;
  entry?: LedgerEntryInput | null;
}

function rpcFailure(error: { message?: string | null } | null): RecordVariableFixedResult {
  const message = error?.message ?? "";
  return {
    ok: false,
    reason: /KIPU_(VALIDATION|OWNERSHIP|DEDUPE_MISMATCH|CONFLICT)/.test(message)
      ? "unsafe"
      : "failed",
    detail: message.slice(0, 240),
  };
}

export function decodeRecordVariableFixedResult(
  row: Row,
  expectedAction: RecordVariableFixedInput["action"],
): Extract<RecordVariableFixedResult, { ok: true }> | null {
  const status = String(row.occurrence_status ?? "");
  const observationId = String(row.observation_id ?? "");
  const transactionId =
    row.transaction_id == null ? null : String(row.transaction_id);
  const planningAmount = finiteNumberField(row.planning_amount);
  const sampleCount = finiteNumberField(row.sample_count);
  const confidence = String(row.confidence ?? "") as VariableFixedConfidence;
  const actionMatchesResult =
    expectedAction === "pay"
      ? transactionId != null &&
        (status === "confirmed" || status === "corrected")
      : expectedAction === "observe"
        ? transactionId == null &&
          (status === "observed" || status === "confirmed")
        : expectedAction === "zero"
          ? transactionId == null && status === "corrected"
          : transactionId == null && status === "skipped";
  const confidenceMatchesSample =
    sampleCount === 0
      ? confidence === "baseline"
      : sampleCount != null && sampleCount <= 2
        ? confidence === "low"
        : sampleCount != null && sampleCount <= 5
          ? confidence === "medium"
          : sampleCount != null && sampleCount >= 6
            ? confidence === "medium" || confidence === "high"
            : false;
  if (
    typeof row.replayed !== "boolean" ||
    !["observed", "confirmed", "corrected", "skipped"].includes(status) ||
    !UUID_RE.test(observationId) ||
    (transactionId != null && !UUID_RE.test(transactionId)) ||
    !actionMatchesResult ||
    planningAmount == null ||
    planningAmount < 0 ||
    sampleCount == null ||
    !Number.isInteger(sampleCount) ||
    sampleCount < 0 ||
    !CONFIDENCES.has(confidence) ||
    !confidenceMatchesSample
  ) {
    return null;
  }
  return {
    ok: true,
    replayed: row.replayed,
    observationId,
    transactionId,
    occurrenceStatus: status as
      | "observed"
      | "confirmed"
      | "corrected"
      | "skipped",
    planningAmount,
    sampleCount,
    confidence,
  };
}

export async function recordVariableFixedObservation(
  input: RecordVariableFixedInput,
): Promise<RecordVariableFixedResult> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_record_variable_fixed_observation", {
      p: {
        user_id: input.userId,
        occurrence_id: input.occurrenceId,
        amount: input.amount,
        currency: input.currency.trim().toUpperCase(),
        action: input.action,
        scope: input.scope,
        dedupe_key: input.dedupeKey,
        expected_occurrence_status: input.expectedOccurrenceStatus,
        expected_resolved_amount: input.expectedResolvedAmount,
        expected_transaction_id: input.expectedTransactionId,
        entry: input.entry ? buildLedgerEntryPayload(input.entry) : null,
      },
    });
    if (error || !data || typeof data !== "object") return rpcFailure(error);
    const row = data as Row;
    return (
      decodeRecordVariableFixedResult(row, input.action) ?? {
        ok: false,
        reason: "failed",
        detail: "invalid RPC result",
      }
    );
  } catch (error) {
    return rpcFailure({
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
