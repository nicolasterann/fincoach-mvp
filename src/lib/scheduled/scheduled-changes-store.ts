import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { roundMoney } from "@/lib/financial/money";
import type { MoneyReadStatus } from "@/lib/financial/money-read";

// Stage 26 — scheduled FUTURE changes ("en 3 meses mi sueldo sube a 1500",
// "cada 3 meses sube 3% el arriendo", "pausa Netflix desde julio"). A row here
// is a PLAN; the daily cron applies due plans through the same typed updates
// the chat uses. The LLM never mutates anything directly — it only creates,
// lists and cancels plans through these validated functions.
//
// Graceful pre-migration (033): every function catches a missing-table error
// and returns empty/false so nothing crashes before the DDL is applied.

export type ScheduledTargetType = "income_source" | "fixed_expense" | "goal" | "reminder" | "savings_plan";
// Stage 37 — which PLAN number a change touches. For savings_plan: the monthly
// savings/investment commitments or the essential estimate (user_financial_preferences,
// base currency). For goal: "contribution" schedules the APORTE (contribution_amount,
// goal currency) instead of the target amount.
export type ScheduledPlanField = "savings" | "investment" | "essential" | "contribution";
export type ScheduledChangeKind =
  | "set_amount"
  | "adjust_percent"
  | "adjust_fixed"
  | "pause"
  | "resume"
  | "set_frequency"
  | "reminder";
export type ScheduledCadence = "once" | "monthly" | "quarterly" | "semiannual" | "yearly";

export interface ScheduledChange {
  id: string;
  userId: string;
  targetType: ScheduledTargetType;
  targetId: string | null;
  targetField: ScheduledPlanField | null;
  targetLabel: string;
  changeKind: ScheduledChangeKind;
  amount: number | null;
  currency: string | null;
  newFrequency: string | null;
  effectiveDate: string;
  cadence: ScheduledCadence;
  nextRunDate: string;
  lastAppliedOn: string | null;
  runsCount: number;
  status: "pending" | "applied" | "cancelled" | "failed";
  note: string | null;
  // Bloque I (re-auditoría, migración 056) — el protocolo de lease del ejecutor:
  // claimed_at/claim_run = quién tiene la fila en vuelo; pending_value/pending_prev
  // = la INTENCIÓN durable (el valor absoluto ya calculado y la base leída), que es
  // lo que le permite a la recuperación saber exactamente dónde quedó el vuelo.
  claimedAt: string | null;
  claimRun: string | null;
  pendingValue: number | null;
  pendingPrev: number | null;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const PLAN_FIELDS = new Set<ScheduledPlanField>(["savings", "investment", "essential", "contribution"]);

function mapRow(r: Row): ScheduledChange {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    targetType: String(r.target_type) as ScheduledTargetType,
    targetId: str(r.target_id),
    targetField: PLAN_FIELDS.has(str(r.target_field) as ScheduledPlanField) ? (str(r.target_field) as ScheduledPlanField) : null,
    targetLabel: String(r.target_label ?? ""),
    changeKind: String(r.change_kind) as ScheduledChangeKind,
    amount: num(r.amount),
    currency: str(r.currency),
    newFrequency: str(r.new_frequency),
    effectiveDate: String(r.effective_date),
    cadence: String(r.cadence ?? "once") as ScheduledCadence,
    nextRunDate: String(r.next_run_date),
    lastAppliedOn: str(r.last_applied_on),
    runsCount: Number(r.runs_count ?? 0),
    status: String(r.status ?? "pending") as ScheduledChange["status"],
    note: str(r.note),
    claimedAt: str(r.claimed_at),
    claimRun: str(r.claim_run),
    pendingValue: num(r.pending_value),
    pendingPrev: num(r.pending_prev),
  };
}

// ── Pure helpers (gate-tested) ───────────────────────────────────────────────

/** Next run date for a recurring cadence, from the given ISO date. */
export function advanceCadence(dateISO: string, cadence: ScheduledCadence): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const months = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : cadence === "semiannual" ? 6 : 12;
  // Clamp to day 28 so "31 de enero + 1 mes" never rolls into March.
  const day = Math.min(d, 28);
  const next = new Date(y, m - 1 + months, day);
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${next.getFullYear()}-${mm}-${dd}`;
}

/** The new amount a change produces from the current one. Null = invalid. */
export function applyAmountChange(
  current: number,
  kind: ScheduledChangeKind,
  amount: number | null,
): number | null {
  if (kind === "set_amount") {
    return amount != null && amount > 0 ? roundMoney(amount) : null;
  }
  if (kind === "adjust_percent") {
    if (amount == null || !Number.isFinite(amount) || Math.abs(amount) > 100) return null;
    const next = roundMoney(current * (1 + amount / 100));
    return next > 0 ? next : null;
  }
  if (kind === "adjust_fixed") {
    if (amount == null || !Number.isFinite(amount)) return null;
    const next = roundMoney(current + amount);
    return next > 0 ? next : null;
  }
  return null;
}

/**
 * Stage 37 — new value for a PLAN commitment (ahorro/inversión/esenciales or a
 * goal's contribution). Unlike applyAmountChange, 0 is a VALID result: "bajo mi
 * ahorro a 0" means stop apartando, and adjustments floor at 0 instead of failing.
 */
export function applyCommitmentChange(
  current: number,
  kind: ScheduledChangeKind,
  amount: number | null,
): number | null {
  if (kind === "set_amount") {
    return amount != null && Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
  }
  if (kind === "adjust_percent") {
    if (amount == null || !Number.isFinite(amount) || Math.abs(amount) > 100) return null;
    return roundMoney(Math.max(0, current * (1 + amount / 100)));
  }
  if (kind === "adjust_fixed") {
    if (amount == null || !Number.isFinite(amount)) return null;
    return roundMoney(Math.max(0, current + amount));
  }
  return null;
}

export function validISO(d: unknown): string | null {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

const VALID_FREQUENCIES = new Set(["weekly", "biweekly", "monthly", "yearly"]);

const TARGET_TABLES: Record<Exclude<ScheduledTargetType, "reminder" | "savings_plan">, string> = {
  income_source: "income_sources",
  fixed_expense: "fixed_expenses",
  goal: "goals",
};

// Why a failed plan couldn't apply, in Kipu's voice — this lands in the row's
// note, which the agent reads back to the user; raw DB text must never leak.
const FAIL_PHRASES: Record<string, string> = {
  objetivo_no_existe: "el destino del cambio ya no existe",
  monto_invalido: "el monto resultante no era válido",
  falta_frecuencia: "faltó la nueva frecuencia",
  moneda_distinta: "la moneda del cambio no coincide con la del objetivo",
  no_aplica: "ese cambio no aplica para una meta",
  falta_campo: "faltó decir si es ahorro, inversión o esenciales",
  no_se_pudo_aplicar: "no se pudo aplicar",
};

// user_financial_preferences column per plan field (base currency, upserted by user_id).
const PLAN_COLUMNS: Record<Exclude<ScheduledPlanField, "contribution">, string> = {
  savings: "monthly_savings_commitment",
  investment: "monthly_investment_commitment",
  essential: "essential_monthly_estimate",
};

/**
 * El monto actual es la BASE de un ajuste y esta rama ESCRIBE el resultado encima.
 * `null` (columna vacía, fila sin monto todavía) SÍ es un 0 legítimo; un valor
 * guardado que no se puede leer como número NO lo es: tratarlo como 0 convierte
 * "no pude valuarlo" en un compromiso borrado, y JSON.stringify(NaN) es `null`,
 * así que el upsert lo dejaría escrito. Ver `money-read.ts` para el porqué.
 */
function currentAmount(raw: unknown): number | null {
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// La doctrina "retry solo cuando PROBAMOS que no se escribió nada" vive ahora en
// IntentResolution (resolveIntent) + el protocolo de lease: un fallo de LECTURA se
// aplaza; un fallo de ESCRITURA deja la intención durable y recovery verifica contra
// el destino en vez de adivinar.

// ── Store ────────────────────────────────────────────────────────────────────

export interface CreateScheduledChangeInput {
  targetType: ScheduledTargetType;
  targetId?: string | null;
  targetField?: ScheduledPlanField | null;
  targetLabel: string;
  changeKind: ScheduledChangeKind;
  amount?: number | null;
  currency?: string | null;
  newFrequency?: string | null;
  effectiveDate: string;
  cadence?: ScheduledCadence;
  note?: string | null;
}

export async function createScheduledChange(
  userId: string,
  input: CreateScheduledChangeInput,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const effective = validISO(input.effectiveDate);
  if (!effective) return { ok: false, reason: "fecha_invalida" };
  const cadence: ScheduledCadence = input.cadence ?? "once";
  const kind = input.changeKind;
  const needsAmount = kind === "set_amount" || kind === "adjust_percent" || kind === "adjust_fixed";
  // Stage 37 — plan targets: the savings/investment/essential commitments (no
  // target row; base currency) and a goal's APORTE. For these, set_amount 0 is
  // legítimo ("bajo mi ahorro a 0" = dejar de apartar).
  const isPlanCommitment = input.targetType === "savings_plan";
  const isGoalContribution = input.targetType === "goal" && input.targetField === "contribution";
  if (isPlanCommitment) {
    if (!input.targetField || input.targetField === "contribution") {
      return { ok: false, reason: "falta_campo" };
    }
    if (!needsAmount) return { ok: false, reason: "no_aplica" };
  }
  if (needsAmount && (input.amount == null || !Number.isFinite(input.amount))) {
    return { ok: false, reason: "monto_invalido" };
  }
  if (kind === "adjust_percent" && Math.abs(Number(input.amount)) > 100) {
    return { ok: false, reason: "porcentaje_fuera_de_rango" };
  }
  if (kind === "set_amount" && Number(input.amount) <= 0 && !(isPlanCommitment || isGoalContribution)) {
    return { ok: false, reason: "monto_invalido" };
  }
  if (kind === "set_amount" && Number(input.amount) < 0) {
    return { ok: false, reason: "monto_invalido" };
  }
  if (kind === "set_frequency" && !VALID_FREQUENCIES.has(String(input.newFrequency))) {
    return { ok: false, reason: "falta_frecuencia" };
  }
  if (input.targetType !== "reminder" && !isPlanCommitment && !input.targetId) {
    return { ok: false, reason: "falta_objetivo" };
  }
  try {
    const sb = createSupabaseAdminClient();
    // Commitments live in the user's BASE currency: a plan stated in another
    // currency would re-denominate at apply time (implicit 1:1) — refuse up front.
    if (isPlanCommitment && input.currency) {
      const { data: prof, error: profErr } = await sb
        .from("profiles")
        .select("base_currency")
        .eq("id", userId)
        .maybeSingle();
      // Un guard cuya lectura falla no es un guard que pasó: sin la moneda base no
      // podemos PROBAR que coinciden, y applyOne NO vuelve a mirar la moneda de un
      // compromiso — escribiría 1500 EUR como 1500 USD. Rechazar es gratis (el
      // agente dice "intenta de nuevo en un rato" y nada se pierde); dejar pasar
      // re-denomina plata a 1:1 meses después, sin que nadie lo note.
      if (profErr) return { ok: false, reason: "no_disponible" };
      const baseCur = str((prof as Row | null)?.base_currency);
      if (baseCur && baseCur.toUpperCase() !== input.currency.toUpperCase()) {
        return { ok: false, reason: "moneda_distinta" };
      }
    }
    // A plan denominated in another currency than its target would silently
    // re-denominate money at apply time (implicit 1:1). Refuse up front so the
    // agent can ask; applyOne re-checks in case the target changes later.
    if (input.targetType !== "reminder" && !isPlanCommitment && input.targetId && input.currency && needsAmount) {
      const table = TARGET_TABLES[input.targetType as Exclude<ScheduledTargetType, "reminder" | "savings_plan">];
      const { data: target, error: targetErr } = await sb
        .from(table)
        .select("currency")
        .eq("id", input.targetId)
        .eq("user_id", userId)
        .maybeSingle();
      // Misma regla: si la lectura falla, `targetCurrency` salía null y el guard se
      // saltaba solo. Un destino que no se pudo leer no autoriza nada.
      if (targetErr) return { ok: false, reason: "no_disponible" };
      const targetCurrency = str((target as Row | null)?.currency);
      if (targetCurrency && targetCurrency.toUpperCase() !== input.currency.toUpperCase()) {
        return { ok: false, reason: "moneda_distinta" };
      }
    }
    const { data, error } = await sb
      .from("scheduled_changes")
      .insert({
        user_id: userId,
        target_type: input.targetType,
        target_id: isPlanCommitment ? null : input.targetId ?? null,
        target_label: input.targetLabel.slice(0, 120),
        change_kind: kind,
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        new_frequency: input.newFrequency ?? null,
        effective_date: effective,
        cadence,
        next_run_date: effective,
        note: input.note?.slice(0, 300) ?? null,
        // Only sent when set, so legacy plans keep working before migration 039.
        ...(input.targetField ? { target_field: input.targetField } : {}),
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, reason: "no_disponible" };
    return { ok: true, id: String((data as Row).id) };
  } catch {
    return { ok: false, reason: "no_disponible" };
  }
}

/** Una lectura de planes que reporta sobre sí misma. Ver `money-read.ts` para el porqué. */
export type ScheduledChangesRead = MoneyReadStatus & { changes: ScheduledChange[] };

// Nadie tiene 30 cambios programados; el tope es una cota de cordura. Pero "vi 30" y
// "hay 30" no pueden ser la misma frase: pedimos uno más del que aceptamos y dejamos
// que la fila extra pruebe que hay cola que no vimos.
const CHANGES_CAP = 30;

/**
 * La lectura HONESTA de los planes. Existe porque este listado no es telemetría:
 * de él sale un veredicto sobre el dinero futuro del usuario. Con `catch { return [] }`,
 * "no pude leer" salía como "no tienes cambios programados" — y ese hecho falso hace
 * que Kipu conteste "no tienes ninguno que cancelar" a quien pidió cancelar el aumento
 * del arriendo: el usuario lo da por cancelado y el cron lo aplica igual el mes que
 * viene. También esconde los planes `failed`, que son justo los que el agente tiene
 * que confesar. Un cero legítimo (no programó nada) es ok:true con lista vacía.
 */
export async function readScheduledChanges(userId: string): Promise<ScheduledChangesRead> {
  try {
    const sb = createSupabaseAdminClient();
    // PostgREST reporta una consulta fallida como { data: null, error } SIN lanzar.
    const { data, error } = await sb
      .from("scheduled_changes")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["pending", "applied", "failed"])
      .order("next_run_date", { ascending: true })
      .limit(CHANGES_CAP + 1);
    if (error) return { ok: false, complete: false, changes: [] };
    const rows = (data ?? []) as Row[];
    const capped = rows.length > CHANGES_CAP;
    return { ok: true, complete: !capped, changes: rows.slice(0, CHANGES_CAP).map(mapRow) };
  } catch {
    return { ok: false, complete: false, changes: [] };
  }
}

/**
 * SOLO DISPLAY — colapsa una lectura fallida en una lista vacía, que es exactamente
 * la mentira de arriba. Nunca decidas con esto: si de la respuesta sale "no tienes
 * ninguno" o se cancela algo, usa `readScheduledChanges` y honra su veredicto.
 */
export async function listScheduledChanges(userId: string): Promise<ScheduledChange[]> {
  return (await readScheduledChanges(userId)).changes;
}

export async function cancelScheduledChange(userId: string, id: string): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from("scheduled_changes")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// ── Executor (called by the daily cron; idempotent per day) ─────────────────

async function noteApplied(sb: ReturnType<typeof createSupabaseAdminClient>, userId: string, text: string) {
  try {
    await sb.from("user_context_notes").insert({
      user_id: userId,
      note_type: "general",
      content: text.slice(0, 480),
      source: "system",
      is_active: true,
    });
  } catch {
    /* best-effort audit note */
  }
}

// ── Bloque I (re-auditoría, punto 4): el ejecutor crash-safe ─────────────────
//
// El diseño viejo hacía claim-que-adelanta-el-plan ANTES de tocar el destino: una
// caída entre el claim y la escritura perdía un cambio `once` para siempre (fila
// 'applied', destino intacto); una respuesta perdida del claim dejaba la fila
// adelantada mientras el código la contaba como 'skipped'; y el revert compensatorio
// podía fallar dejando solo un log. Además la cola leía `.limit(200)` sin probar
// que no hubiera cola detrás.
//
// El protocolo nuevo (migración 056):
//   CLAIM   — lease (claimed_at/claim_run), SIN adelantar el plan. Perder la
//             respuesta del claim solo cuesta esperar a que el lease venza.
//   RESOLVE — leer el destino y calcular el valor ABSOLUTO nuevo (sin escribir).
//   INTENT  — persistir pending_value/pending_prev. adjust_percent se computa UNA
//             vez; cualquier reintento re-escribe el absoluto, jamás re-compone el %.
//   WRITE   — el destino se escribe con CAS contra pending_prev.
//   FINAL   — recién ahí se adelanta/cierra el plan y se limpia el lease.
// RECOVERY (al inicio de cada corrida): un lease vencido dice dónde quedó el vuelo:
//   pending_value == destino → la escritura aterrizó → finalizar (exactamente una
//   vez); destino == pending_prev → nunca aterrizó → re-escribir; otra cosa → el
//   usuario editó en el medio → soltar el lease y recalcular en el próximo run;
//   pending_value NULL → no se escribió nada → soltar el lease.
// La orquestación es un PUERTO inyectable: el gate la recorre con un puerto en
// memoria e inyecta caídas exactamente donde duelen.

/** Qué hay que escribir, resuelto SIN escribir. `amount` lleva la base leída
 *  (prevRaw, para el CAS — puede ser null en DB) y el absoluto ya calculado. */
export type ChangeIntent =
  | { mode: "note" }
  | { mode: "idempotent"; table: string; patch: Record<string, unknown>; human: string }
  | {
      mode: "amount";
      target: "prefs" | "row";
      table: string;
      column: string;
      prevRaw: unknown;
      prev: number;
      next: number;
      human: string;
      extraPatch?: Record<string, unknown>;
      prefsRowMissing?: boolean;
    };

export type IntentResolution =
  | { ok: true; intent: ChangeIntent }
  | { ok: false; detail: string; retry: boolean };

export interface ScheduledChangesPort {
  fetchDueBatch(asOfISO: string, afterId: string | null, limit: number, staleBeforeISO: string): Promise<{ rows: ScheduledChange[] | null; failed: boolean }>;
  claim(id: string, asOfISO: string, staleBeforeISO: string): Promise<{ claimed: boolean; failed: boolean }>;
  resolveIntent(c: ScheduledChange): Promise<IntentResolution>;
  persistIntent(id: string, asOfISO: string, next: number, prev: number): Promise<boolean>;
  applyWrite(c: ScheduledChange, intent: ChangeIntent): Promise<{ applied: boolean; conflict: boolean; failed: boolean }>;
  finalize(c: ScheduledChange, claimRunISO: string): Promise<boolean>;
  releaseClaim(id: string, claimRunISO: string): Promise<boolean>;
  markFailed(c: ScheduledChange, detail: string): Promise<void>;
  listExpiredClaims(staleBeforeISO: string): Promise<{ rows: ScheduledChange[] | null; failed: boolean }>;
  readTargetValue(c: ScheduledChange): Promise<{ value: number | null; missing: boolean; failed: boolean }>;
  note(userId: string, text: string): Promise<void>;
}

export interface ScheduledRunResult {
  ok: boolean;
  complete: boolean;
  applied: number;
  failed: number;
  skipped: number;
  deferred: number;
  recovered: number;
}

const RUN_PAGE = 200;
const RUN_MAX_BATCHES = 20;
export const CLAIM_LEASE_MS = 15 * 60_000;

/** La orquestación entera, con el puerto inyectado — el gate la recorre de verdad. */
export async function runScheduledChangesWith(
  port: ScheduledChangesPort,
  asOfISO: string,
  nowMs: number,
  opts?: { page?: number; maxBatches?: number },
): Promise<ScheduledRunResult> {
  const out: ScheduledRunResult = { ok: true, complete: true, applied: 0, failed: 0, skipped: 0, deferred: 0, recovered: 0 };
  const page = opts?.page ?? RUN_PAGE;
  const maxBatches = opts?.maxBatches ?? RUN_MAX_BATCHES;
  const staleBefore = new Date(nowMs - CLAIM_LEASE_MS).toISOString();

  // ── RECOVERY: los vuelos que una corrida anterior dejó a medias ──
  const expired = await port.listExpiredClaims(staleBefore);
  if (expired.failed || !expired.rows) {
    // No poder LISTAR los vuelos colgados no borra nada (los leases siguen ahí),
    // pero la corrida no puede llamarse sana.
    out.ok = false;
  } else {
    for (const r of expired.rows) {
      const run = r.claimRun ?? asOfISO;
      if (r.pendingValue == null) {
        // Nada se escribió (la intención se persiste ANTES que el destino): soltar
        // el lease devuelve la fila a la cola tal como estaba.
        await port.releaseClaim(r.id, run);
        continue;
      }
      const t = await port.readTargetValue(r);
      if (t.failed) continue; // el lease sigue; lo intenta la próxima corrida
      if (!t.missing && t.value != null && Math.abs(t.value - r.pendingValue) < 0.005) {
        // La escritura ATERRIZÓ y solo faltó finalizar: finalizar ahora es lo que
        // hace al `once` exactamente-una-vez (el valor absoluto ya está aplicado).
        if (await port.finalize(r, run)) {
          out.recovered += 1;
          out.applied += 1;
        }
        continue;
      }
      if (!t.missing && t.value != null && r.pendingPrev != null && Math.abs(t.value - r.pendingPrev) < 0.005) {
        // Nunca aterrizó: re-escribir el ABSOLUTO persistido (jamás re-computar un
        // porcentaje) y finalizar.
        const w = await port.applyWrite(r, {
          mode: "amount",
          target: r.targetType === "savings_plan" ? "prefs" : "row",
          table: "",
          column: "",
          prevRaw: r.pendingPrev,
          prev: r.pendingPrev,
          next: r.pendingValue,
          human: `${r.targetLabel}: ${r.pendingPrev} → ${r.pendingValue}`,
        });
        if (w.applied && (await port.finalize(r, run))) {
          out.recovered += 1;
          out.applied += 1;
        }
        continue;
      }
      // El destino ya no coincide con nada nuestro: el usuario (u otro proceso)
      // editó en el medio. Recalcular desde cero en el próximo run — soltar todo.
      await port.releaseClaim(r.id, run);
      out.deferred += 1;
    }
  }

  // ── MAIN: la cola, por keyset hasta página corta (la cola PROBADA vacía) ──
  let afterId: string | null = null;
  for (let batch = 0; batch < maxBatches; batch++) {
    const due = await port.fetchDueBatch(asOfISO, afterId, page + 1, staleBefore);
    if (due.failed || !due.rows) {
      // Una cola que no se pudo leer NO es "hoy no vencía nada".
      out.ok = false;
      out.complete = false;
      return out;
    }
    const hasTail = due.rows.length > page;
    for (const c of due.rows.slice(0, page)) {
      afterId = c.id;
      if (c.lastAppliedOn === asOfISO) {
        out.skipped += 1;
        continue;
      }
      const cl = await port.claim(c.id, asOfISO, staleBefore);
      if (cl.failed) {
        // Respuesta perdida: el UPDATE pudo aterrizar igual. NO se cuenta aplicado
        // ni se toca el destino — el lease (nuestro o de nadie) lo resuelve: si
        // aterrizó, vence en 15 min con pending NULL y recovery lo suelta intacto.
        out.deferred += 1;
        continue;
      }
      if (!cl.claimed) {
        out.skipped += 1;
        continue;
      }
      const res = await port.resolveIntent(c);
      if (!res.ok) {
        if (res.retry) {
          await port.releaseClaim(c.id, asOfISO);
          out.deferred += 1;
        } else {
          await port.markFailed(c, res.detail);
          out.failed += 1;
        }
        continue;
      }
      const intent = res.intent;
      if (intent.mode === "note") {
        await port.note(c.userId, `RECORDATORIO (${c.nextRunDate}): ${c.targetLabel}${c.note ? ` — ${c.note}` : ""}`);
        if (await port.finalize(c, asOfISO)) out.applied += 1;
        else out.deferred += 1; // recovery: pending NULL → suelta → re-avisa (una nota repetida no es dinero)
        continue;
      }
      if (intent.mode === "idempotent") {
        // pause/resume/set_frequency son escrituras ABSOLUTAS re-aplicables: si el
        // write falla con respuesta perdida, soltar el lease y reintentar es seguro.
        const w = await port.applyWrite(c, intent);
        if (w.failed || w.conflict) {
          await port.releaseClaim(c.id, asOfISO);
          out.deferred += 1;
          continue;
        }
        await port.note(c.userId, `Cambio programado aplicado: ${intent.human || c.targetLabel}.`);
        if (await port.finalize(c, asOfISO)) out.applied += 1;
        else out.deferred += 1;
        continue;
      }
      // amount — el protocolo completo.
      const persisted = await port.persistIntent(c.id, asOfISO, intent.next, intent.prev);
      if (!persisted) {
        await port.releaseClaim(c.id, asOfISO);
        out.deferred += 1;
        continue;
      }
      const w = await port.applyWrite(c, intent);
      if (w.conflict) {
        // El destino cambió entre la lectura y el CAS: recalcular en el próximo run.
        await port.releaseClaim(c.id, asOfISO);
        out.deferred += 1;
        continue;
      }
      if (w.failed) {
        // Estado DESCONOCIDO (la escritura pudo aterrizar): NO soltar el lease ni
        // revertir a ciegas — la intención durable deja que recovery verifique
        // contra el destino y decida. Esto reemplaza al viejo revert compensatorio.
        out.deferred += 1;
        continue;
      }
      await port.note(c.userId, `Cambio programado aplicado: ${intent.human}.`);
      if (await port.finalize(c, asOfISO)) {
        out.applied += 1;
      } else {
        // La plata YA se movió; solo faltó adelantar el plan. Recovery finaliza
        // (destino == pending_value) sin re-aplicar: se cuenta aplicado.
        console.error("[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará", c.id);
        out.applied += 1;
      }
    }
    if (!hasTail) return out;
  }
  // Tope de vueltas con cola pendiente: nada falló, pero la corrida no puede
  // llamarse completa — el route lo reporta y el próximo cron sigue.
  out.complete = false;
  return out;
}

// ── El puerto real (Supabase) ────────────────────────────────────────────────

/** Dónde vive el monto de un cambio de tipo amount. */
function amountLocator(c: ScheduledChange): { target: "prefs" | "row"; table: string; column: string } | null {
  if (c.targetType === "savings_plan") {
    const field = c.targetField;
    if (!field || field === "contribution") return null;
    return { target: "prefs", table: "user_financial_preferences", column: PLAN_COLUMNS[field] };
  }
  if (c.targetType === "reminder") return null;
  const table = TARGET_TABLES[c.targetType as Exclude<ScheduledTargetType, "reminder" | "savings_plan">];
  const isContribution = c.targetType === "goal" && c.targetField === "contribution";
  const column = isContribution ? "contribution_amount" : c.targetType === "goal" ? "target_amount" : "amount";
  return { target: "row", table, column };
}

export function supabaseScheduledChangesPort(
  sb: ReturnType<typeof createSupabaseAdminClient>,
): ScheduledChangesPort {
  return {
    async fetchDueBatch(asOfISO, afterId, limit, staleBeforeISO) {
      let q = sb
        .from("scheduled_changes")
        .select("*")
        .eq("status", "pending")
        .lte("next_run_date", asOfISO)
        .or(`claimed_at.is.null,claimed_at.lt.${staleBeforeISO}`)
        .order("id", { ascending: true })
        .limit(limit);
      if (afterId) q = q.gt("id", afterId);
      const { data, error } = await q;
      if (error || !data) return { rows: null, failed: true };
      return { rows: (data as Row[]).map(mapRow), failed: false };
    },
    async claim(id, asOfISO, staleBeforeISO) {
      const { data, error } = await sb
        .from("scheduled_changes")
        .update({ claimed_at: new Date().toISOString(), claim_run: asOfISO, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "pending")
        .or(`claimed_at.is.null,claimed_at.lt.${staleBeforeISO}`)
        .select("id");
      if (error) return { claimed: false, failed: true };
      return { claimed: (data?.length ?? 0) > 0, failed: false };
    },
    async resolveIntent(c) {
      if (c.targetType === "reminder" || c.changeKind === "reminder") return { ok: true, intent: { mode: "note" } };
      if (c.targetType === "savings_plan") {
        const loc = amountLocator(c);
        if (!loc) return { ok: false, detail: "falta_campo", retry: false };
        const { data: prefs, error: prefReadErr } = await sb
          .from("user_financial_preferences")
          .select(loc.column)
          .eq("user_id", c.userId)
          .maybeSingle();
        // La lectura es la BASE del ajuste. Un error no es "no aparta nada":
        // escribir encima borraría el compromiso real (ver money-read.ts).
        if (prefReadErr) return { ok: false, detail: "no_se_pudo_leer", retry: true };
        const raw = (prefs as Row | null)?.[loc.column];
        const current = currentAmount(raw);
        if (current == null) return { ok: false, detail: "monto_invalido", retry: false };
        const next = applyCommitmentChange(current, c.changeKind, c.amount);
        if (next == null) return { ok: false, detail: "monto_invalido", retry: false };
        return {
          ok: true,
          intent: {
            mode: "amount", target: "prefs", table: loc.table, column: loc.column,
            prevRaw: prefs == null ? undefined : raw, prev: current, next,
            human: `${c.targetLabel}: ${current} → ${next}`,
            prefsRowMissing: prefs == null,
          },
        };
      }
      const table = TARGET_TABLES[c.targetType as Exclude<ScheduledTargetType, "reminder" | "savings_plan">];
      const { data: rowData, error: readErr } = await sb
        .from(table)
        .select("*")
        .eq("id", c.targetId)
        .eq("user_id", c.userId)
        .maybeSingle();
      // "No pude leer" ≠ "el destino ya no existe": solo un maybeSingle SIN error
      // prueba la ausencia; un error se reintenta mañana, no entierra el plan.
      if (readErr) return { ok: false, detail: "no_se_pudo_leer", retry: true };
      if (!rowData) return { ok: false, detail: "objetivo_no_existe", retry: false };
      const row = rowData as Row;
      if (c.changeKind === "pause" || c.changeKind === "resume") {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (c.targetType === "fixed_expense") patch.is_active = c.changeKind === "resume";
        else patch.status = c.changeKind === "resume" ? "active" : "paused";
        return { ok: true, intent: { mode: "idempotent", table, patch, human: c.changeKind === "pause" ? "pausado" : "reactivado" } };
      }
      if (c.changeKind === "set_frequency") {
        if (!c.newFrequency) return { ok: false, detail: "falta_frecuencia", retry: false };
        if (c.targetType === "goal") return { ok: false, detail: "no_aplica", retry: false };
        return { ok: true, intent: { mode: "idempotent", table, patch: { frequency: c.newFrequency, updated_at: new Date().toISOString() }, human: `frecuencia → ${c.newFrequency}` } };
      }
      // amount — en la MONEDA del destino, jamás convertida aquí.
      const rowCurrency = str(row.currency);
      if (c.currency && rowCurrency && c.currency.toUpperCase() !== rowCurrency.toUpperCase()) {
        return { ok: false, detail: "moneda_distinta", retry: false };
      }
      const isContribution = c.targetType === "goal" && c.targetField === "contribution";
      const column = isContribution ? "contribution_amount" : c.targetType === "goal" ? "target_amount" : "amount";
      const current = currentAmount(row[column]);
      if (current == null) return { ok: false, detail: "monto_invalido", retry: false };
      const next = isContribution
        ? applyCommitmentChange(current, c.changeKind, c.amount)
        : applyAmountChange(current, c.changeKind, c.amount);
      if (next == null) return { ok: false, detail: "monto_invalido", retry: false };
      const extraPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (isContribution && next > 0 && !row.cadence) extraPatch.cadence = "monthly";
      return {
        ok: true,
        intent: {
          mode: "amount", target: "row", table, column,
          prevRaw: row[column], prev: current, next,
          human: `${c.targetLabel}: ${current} → ${next}`, extraPatch,
        },
      };
    },
    async persistIntent(id, asOfISO, next, prev) {
      const { data, error } = await sb
        .from("scheduled_changes")
        .update({ pending_value: next, pending_prev: prev, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("claim_run", asOfISO)
        .eq("status", "pending")
        .select("id");
      return !error && (data?.length ?? 0) > 0;
    },
    async applyWrite(c, intent) {
      if (intent.mode === "note") return { applied: true, conflict: false, failed: false };
      if (intent.mode === "idempotent") {
        const { data, error } = await sb
          .from(intent.table)
          .update(intent.patch)
          .eq("id", c.targetId)
          .eq("user_id", c.userId)
          .select("id");
        if (error) return { applied: false, conflict: false, failed: true };
        return { applied: (data?.length ?? 0) > 0, conflict: (data?.length ?? 0) === 0, failed: false };
      }
      // amount. En recovery la intención viene reconstruida sin locator: resolverlo.
      const loc = intent.table
        ? { target: intent.target, table: intent.table, column: intent.column }
        : amountLocator(c);
      if (!loc) return { applied: false, conflict: false, failed: true };
      if (loc.target === "prefs") {
        if (intent.prefsRowMissing) {
          // Sin fila de prefs: un INSERT desnudo PIERDE ante una fila concurrente
          // (23505 → conflicto → recalcular), en vez de pisarla con upsert.
          const { error } = await sb
            .from("user_financial_preferences")
            .insert({ user_id: c.userId, [loc.column]: intent.next });
          if (!error) return { applied: true, conflict: false, failed: false };
          if ((error as { code?: string }).code === "23505") return { applied: false, conflict: true, failed: false };
          return { applied: false, conflict: false, failed: true };
        }
        let q = sb
          .from("user_financial_preferences")
          .update({ [loc.column]: intent.next })
          .eq("user_id", c.userId);
        q = intent.prevRaw == null ? q.is(loc.column, null) : q.eq(loc.column, intent.prevRaw as number);
        const { data, error } = await q.select("user_id");
        if (error) return { applied: false, conflict: false, failed: true };
        return { applied: (data?.length ?? 0) > 0, conflict: (data?.length ?? 0) === 0, failed: false };
      }
      let q = sb
        .from(loc.table)
        .update({ [loc.column]: intent.next, ...(intent.extraPatch ?? {}) })
        .eq("id", c.targetId)
        .eq("user_id", c.userId);
      // CAS contra lo LEÍDO: si el destino cambió en el medio (el usuario editó su
      // sueldo a mano), este write no matchea nada y se recalcula — nunca se pisa.
      q = intent.prevRaw == null ? q.is(loc.column, null) : q.eq(loc.column, intent.prevRaw as number);
      const { data, error } = await q.select("id");
      if (error) return { applied: false, conflict: false, failed: true };
      return { applied: (data?.length ?? 0) > 0, conflict: (data?.length ?? 0) === 0, failed: false };
    },
    async finalize(c, claimRunISO) {
      let nextRun = advanceCadence(c.nextRunDate, c.cadence);
      while (nextRun <= claimRunISO) nextRun = advanceCadence(nextRun, c.cadence);
      const patch: Record<string, unknown> = {
        last_applied_on: claimRunISO,
        runs_count: c.runsCount + 1,
        claimed_at: null,
        claim_run: null,
        pending_value: null,
        pending_prev: null,
        updated_at: new Date().toISOString(),
      };
      if (c.cadence === "once") patch.status = "applied";
      else patch.next_run_date = nextRun;
      const { data, error } = await sb
        .from("scheduled_changes")
        .update(patch)
        .eq("id", c.id)
        .eq("claim_run", claimRunISO)
        .select("id");
      return !error && (data?.length ?? 0) > 0;
    },
    async releaseClaim(id, claimRunISO) {
      const { data, error } = await sb
        .from("scheduled_changes")
        .update({ claimed_at: null, claim_run: null, pending_value: null, pending_prev: null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("claim_run", claimRunISO)
        .select("id");
      return !error && (data?.length ?? 0) > 0;
    },
    async markFailed(c, detail) {
      const phrase = FAIL_PHRASES[detail] ?? FAIL_PHRASES.no_se_pudo_aplicar;
      const { error } = await sb
        .from("scheduled_changes")
        .update({
          status: "failed",
          note: `${c.note ?? ""} [no aplicado: ${phrase}]`.trim().slice(0, 300),
          claimed_at: null,
          claim_run: null,
          pending_value: null,
          pending_prev: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", c.id);
      if (error) console.error("[kipu.cron.scheduled-changes] fail-mark failed", c.id, error.message);
    },
    async listExpiredClaims(staleBeforeISO) {
      const { data, error } = await sb
        .from("scheduled_changes")
        .select("*")
        .eq("status", "pending")
        .not("claimed_at", "is", null)
        .lt("claimed_at", staleBeforeISO)
        .limit(200);
      if (error || !data) return { rows: null, failed: true };
      return { rows: (data as Row[]).map(mapRow), failed: false };
    },
    async readTargetValue(c) {
      const loc = amountLocator(c);
      if (!loc) return { value: null, missing: true, failed: false };
      if (loc.target === "prefs") {
        const { data, error } = await sb
          .from("user_financial_preferences")
          .select(loc.column)
          .eq("user_id", c.userId)
          .maybeSingle();
        if (error) return { value: null, missing: false, failed: true };
        if (!data) return { value: 0, missing: false, failed: false };
        return { value: currentAmount((data as unknown as Row)[loc.column]), missing: false, failed: false };
      }
      const { data, error } = await sb
        .from(loc.table)
        .select(loc.column)
        .eq("id", c.targetId)
        .eq("user_id", c.userId)
        .maybeSingle();
      if (error) return { value: null, missing: false, failed: true };
      if (!data) return { value: null, missing: true, failed: false };
      return { value: currentAmount((data as unknown as Row)[loc.column]), missing: false, failed: false };
    },
    async note(userId, text) {
      await noteApplied(sb, userId, text);
    },
  };
}

/**
 * Apply every due pending change. Idempotente por día vía last_applied_on, crash-safe
 * vía el protocolo de lease + intención durable (arriba). `complete:false` = quedó
 * cola sin procesar (tope de vueltas) — el route lo reporta.
 */
export async function runDueScheduledChanges(asOfISO: string): Promise<ScheduledRunResult> {
  try {
    const sb = createSupabaseAdminClient();
    return await runScheduledChangesWith(supabaseScheduledChangesPort(sb), asOfISO, Date.now());
  } catch (err) {
    console.error("[kipu.cron.scheduled-changes] run crashed", err instanceof Error ? err.message : err);
    return { ok: false, complete: false, applied: 0, failed: 0, skipped: 0, deferred: 0, recovered: 0 };
  }
}
