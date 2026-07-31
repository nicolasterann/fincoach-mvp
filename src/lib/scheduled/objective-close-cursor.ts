import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type ObjectiveCloseCursorRead =
  | { ok: true; lastEvaluatedMonth: string | null }
  | { ok: false };

export function previousMonth(monthOrDateISO: string): string | null {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(monthOrDateISO);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return date.toISOString().slice(0, 7);
}

export function nextMonth(monthISO: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthISO);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return date.toISOString().slice(0, 7);
}

export function pendingObjectiveCloseMonth(
  localTodayISO: string,
  lastEvaluatedMonth: string | null,
): string | null {
  const latestClosable = previousMonth(localTodayISO);
  if (!latestClosable) return null;
  if (!lastEvaluatedMonth) return latestClosable;
  const candidate = nextMonth(lastEvaluatedMonth);
  return candidate && candidate <= latestClosable ? candidate : null;
}

export async function readObjectiveCloseCursor(
  userId: string,
): Promise<ObjectiveCloseCursorRead> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from("objective_close_cursors")
      .select("last_evaluated_month")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { ok: false };
    return {
      ok: true,
      lastEvaluatedMonth: data?.last_evaluated_month
        ? String(data.last_evaluated_month).slice(0, 7)
        : null,
    };
  } catch {
    return { ok: false };
  }
}

export async function advanceObjectiveCloseCursor(
  userId: string,
  month: string,
): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_advance_objective_close_cursor", {
      p_user_id: userId,
      p_month: month,
    });
    const stored = String((data as { last_evaluated_month?: unknown } | null)?.last_evaluated_month ?? "");
    return !error && /^\d{4}-\d{2}$/.test(stored) && stored >= month;
  } catch {
    return false;
  }
}
