import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { addDays, isoLocal, startOfDay } from "@/lib/financial/recurring-occurrence";

export const NORMAL_MATERIALIZATION_LOOKBACK_DAYS = 2;
export const MAX_CATCHUP_DAYS_PER_RUN = 31;

export type MaterializationCursorRead =
  | { ok: true; lastMaterializedLocalDate: string | null; timezone: string | null }
  | { ok: false };

export interface MaterializationWindow {
  from: Date;
  through: Date;
  fromISO: string;
  throughISO: string;
  lookbackDays: number;
  catchingUp: boolean;
}

function parseISODateLocal(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isoLocal(parsed) === value ? parsed : null;
}

function daysBetween(from: Date, through: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(through.getFullYear(), through.getMonth(), through.getDate());
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Missing cursors deliberately bootstrap at the old two-day window: applying
 * the migration must not resurrect years of historical flows. Once a cursor
 * exists, every unprocessed local day is visited, at most 31 per run.
 */
export function planMaterializationWindow(
  todayInput: Date,
  lastMaterializedLocalDate: string | null,
): MaterializationWindow {
  const today = startOfDay(todayInput);
  const cursor = parseISODateLocal(lastMaterializedLocalDate);
  let from =
    cursor && cursor.getTime() <= today.getTime()
      ? addDays(cursor, 1)
      : addDays(today, -NORMAL_MATERIALIZATION_LOOKBACK_DAYS);
  if (from.getTime() > today.getTime()) from = today;
  const maxThrough = addDays(from, MAX_CATCHUP_DAYS_PER_RUN - 1);
  const through = maxThrough.getTime() < today.getTime() ? maxThrough : today;
  const lookbackDays = daysBetween(from, through);
  return {
    from,
    through,
    fromISO: isoLocal(from),
    throughISO: isoLocal(through),
    lookbackDays,
    catchingUp: through.getTime() < today.getTime() || from.getTime() < addDays(today, -NORMAL_MATERIALIZATION_LOOKBACK_DAYS).getTime(),
  };
}

export function occurrenceIsLate(
  occurrenceDate: string,
  realToday: Date,
  normalLookbackDays: number = NORMAL_MATERIALIZATION_LOOKBACK_DAYS,
): boolean {
  return occurrenceDate < isoLocal(addDays(startOfDay(realToday), -normalLookbackDays));
}

export async function readMaterializationCursor(
  userId: string,
): Promise<MaterializationCursorRead> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from("recurring_materialization_cursors")
      .select("last_materialized_local_date, timezone")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { ok: false };
    return {
      ok: true,
      lastMaterializedLocalDate: data?.last_materialized_local_date
        ? String(data.last_materialized_local_date).slice(0, 10)
        : null,
      timezone: data?.timezone == null ? null : String(data.timezone),
    };
  } catch {
    return { ok: false };
  }
}

export async function advanceMaterializationCursor(input: {
  userId: string;
  throughISO: string;
  timezone: string;
}): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_advance_recurring_materialization_cursor", {
      p_user_id: input.userId,
      p_through: input.throughISO,
      p_timezone: input.timezone,
    });
    const stored = String((data as { last_materialized_local_date?: unknown } | null)?.last_materialized_local_date ?? "");
    return !error && /^\d{4}-\d{2}-\d{2}$/.test(stored) && stored >= input.throughISO;
  } catch {
    return false;
  }
}
