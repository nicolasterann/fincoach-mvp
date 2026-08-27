import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { SnapshotMetrics } from "@/lib/trends/trend";

// Stage 20 (micro-stage G) — daily snapshot persistence (migration 030). Service-role.
// One row per user per day (idempotent upsert), so re-builds within a day don't
// multiply rows and trends stay day-over-day.

function dayBucket(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Bloque I — la escritura reporta sobre sí misma. Devolvía `void`: un `void` hace
 *  que TODO resultado se vea igual de exitoso, y el error del upsert se tragaba
 *  entero, así que un snapshot que nunca se guardó se veía guardado. Esto persiste
 *  el Saldo del día — el número que mañana lee la curva de /app/saldo y contra el
 *  que se mide el trend — y el hueco no se nota hasta días después, cuando ya no hay
 *  forma de reconstruirlo (el valor vivo de ese día ya no existe). */
export type SnapshotWriteResult = { ok: true } | { ok: false; error: string };

export async function writeDailySnapshot(userId: string, m: SnapshotMetrics, baseCurrency: string, nowMs: number, saldoKipu?: number | null): Promise<SnapshotWriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const { error } = await sb.from("daily_financial_snapshots").upsert(
      // Stage H — NEVER null out a Saldo already recorded for this day: the upsert
      // would destroy the honest value and leave the history with a hole (and, on
      // a day we could not compute, that hole is exactly what a later reader would
      // have to trust). Omit the column instead of writing null over a good row.
      {
        user_id: userId, snapshot_date: dayBucket(nowMs), margen_weekly: m.margenWeekly,
        safe_weekly: m.safeWeekly, net_worth: m.netWorth, total_debt: m.totalDebt,
        readiness: Math.round(m.readiness), base_currency: baseCurrency,
        ...(saldoKipu == null ? {} : { saldo_kipu: saldoKipu }),
      },
      { onConflict: "user_id,snapshot_date" },
    );
    // NO es fail-closed: el briefing ya publicó un Saldo honesto (el fail-closed
    // corre antes y aquí solo llega lo publicable), así que tumbar la respuesta del
    // usuario por no poder ARCHIVAR el número sería peor que el bug. Pero el fallo
    // deja de ser invisible: se registra para que un hueco en la historia tenga una
    // causa buscable en vez de aparecer como un día que el usuario "no usó Kipu".
    if (error) {
      console.error("[kipu.snapshot] daily snapshot upsert failed", userId, dayBucket(nowMs), error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[kipu.snapshot] daily snapshot write threw", userId, dayBucket(nowMs), msg);
    return { ok: false, error: msg };
  }
}

// Stage 20 PASS 2 — the recorded snapshot series for trend CHARTS. Returns the
// stored daily snapshots within the last `daysBack` days, oldest→newest, each with
// its date. HONEST: it returns ONLY rows that actually exist (one per recorded day);
// it never fills gaps or fabricates points. A brand-new user gets [] or one point →
// the dashboard shows "sin historial aún", never an invented curve.
export interface DatedSnapshot extends SnapshotMetrics {
  dateISO: string;
  // Stage D — the recorded Saldo Kipu of that day; null on rows older than
  // migration 048 (charts only plot days that really recorded it).
  saldoKipu: number | null;
}

export type SnapshotSeriesRead =
  | { ok: true; snapshots: DatedSnapshot[] }
  | { ok: false; snapshots: []; error: string };

/** M6 needs to distinguish a legitimate empty history from a failed read. The
 * older array API remains below for existing detail pages, while the shell uses
 * this typed result so a database failure can never look like "no history". */
export async function loadSnapshotSeriesRead(
  userId: string,
  daysBack: number,
  nowMs: number,
): Promise<SnapshotSeriesRead> {
  try {
    const sb = createSupabaseAdminClient();
    const days = Math.max(1, daysBack);
    const fromISO = new Date(nowMs - days * 86400000).toISOString().slice(0, 10);
    const { data, error } = await sb
      .from("daily_financial_snapshots")
      .select("margen_weekly, safe_weekly, net_worth, total_debt, readiness, snapshot_date, saldo_kipu")
      .eq("user_id", userId)
      .gte("snapshot_date", fromISO)
      .order("snapshot_date", { ascending: true })
      // Bloque I — el tope se DERIVA de la ventana en vez de ser un 120 suelto. Hay
      // como mucho una fila por día (onConflict user_id,snapshot_date), así que el
      // número de días acota el de filas y la truncación deja de ser posible en vez
      // de quedar sin reportar. El 120 fijo aguantaba los usos de hoy (30d y 90d) y
      // se habría comido callado la cola de un rango mayor — y como el orden es
      // ascendente, lo truncado son los días MÁS NUEVOS: la curva terminaría meses
      // atrás pareciendo un Saldo que dejó de moverse.
      .limit(days + 2);
    // { data: null, error } no lanza: sin este chequeo un fallo se dibuja igual que
    // un usuario sin historia. La lista queda vacía, pero `ok: false` conserva la
    // diferencia para que el shell muestre fallo de lectura y jamás lo presente
    // como ausencia legítima de datos.
    if (error) {
      console.error("[kipu.snapshot] snapshot series read failed", userId, error.message);
      return { ok: false, snapshots: [], error: error.message };
    }
    const n = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v)) || 0);
    const snapshots = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      dateISO: String(r.snapshot_date ?? ""),
      margenWeekly: n(r.margen_weekly),
      safeWeekly: n(r.safe_weekly),
      netWorth: n(r.net_worth),
      totalDebt: n(r.total_debt),
      readiness: n(r.readiness),
      saldoKipu: r.saldo_kipu == null ? null : n(r.saldo_kipu),
    })).filter((r) => r.dateISO);
    return { ok: true, snapshots };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[kipu.snapshot] snapshot series read threw", userId, message);
    return { ok: false, snapshots: [], error: message };
  }
}

export async function loadSnapshotSeries(
  userId: string,
  daysBack: number,
  nowMs: number,
): Promise<DatedSnapshot[]> {
  const read = await loadSnapshotSeriesRead(userId, daysBack, nowMs);
  return read.ok ? read.snapshots : [];
}

// The most recent snapshot STRICTLY BEFORE today — the honest "last time" to compare
// the live metrics against. Returns null when there's no prior day (→ no fake trend).
//
// Bloque I — este SÍ puede colapsar a null sin contrato tipado, y es a propósito: el
// null cae en `direction: "no_prior"` (trend.ts no compara nada) y en
// `hasPriorSnapshot: false`, que BAJA la confianza del Margen. O sea, el fallo empuja
// a Kipu a ser más prudente, nunca a inflar un número — es la única forma de este
// archivo que falla del lado seguro. Aun así el error se registra: un trend que
// desaparece por un fallo de lectura no debería confundirse con un usuario nuevo.
export async function loadPriorSnapshot(userId: string, nowMs: number): Promise<SnapshotMetrics | null> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from("daily_financial_snapshots")
      .select("margen_weekly, safe_weekly, net_worth, total_debt, readiness, snapshot_date")
      .eq("user_id", userId)
      .lt("snapshot_date", dayBucket(nowMs))
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[kipu.snapshot] prior snapshot read failed", userId, error.message);
      return null;
    }
    if (!data) return null;
    const r = data as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v)) || 0);
    return { margenWeekly: n(r.margen_weekly), safeWeekly: n(r.safe_weekly), netWorth: n(r.net_worth), totalDebt: n(r.total_debt), readiness: n(r.readiness) };
  } catch {
    return null;
  }
}
