import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { ObjectiveMonthClose } from "@/lib/financial/objectives";

// Stage H — persisted month-close records (migration 051). One row per
// (user, closed month, objective category). The row is BOTH the idempotency
// gate for the nightly close (fire once per month, day 1-3 user-local) and the
// honest history the report/resolve tool read. destination defaults to
// 'reservas' — a NO-WRITE default: unspent objective money physically stays in
// the accounts and the computed Reserva layer absorbs it; a redirect is only
// RECORDED here — the actual movement (goal contribution, extra debt payment)
// happens through the existing typed tools the agent calls.

export interface ObjectiveCloseRecord {
  month: string; // "YYYY-MM" (user-tz month)
  category: string;
  labelEs?: string;
  objectiveBase: number;
  spentBase: number; // overflow INCLUDED (the refine-loop comparison figure)
  extraordinaryBase: number; // separate line — never pushes the objective up
  surplusBase: number;
  excessBase: number;
  destination: string;
  resolvedAt: string | null;
}

export async function hasMonthClose(userId: string, month: string): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("objective_month_closes")
      .select("id")
      .eq("user_id", userId)
      .eq("month", month)
      .limit(1);
    // A Supabase query error returns {data:null, error} WITHOUT throwing — treat
    // an unreadable gate as "already closed" so a transient failure can never
    // double-fire the report (it just retries a future night).
    if (error) return true;
    return (data ?? []).length > 0;
  } catch {
    // Unreadable state must NEVER double-fire a report — claim "already closed".
    return true;
  }
}

export async function insertMonthCloses(
  userId: string,
  month: string,
  closes: ObjectiveMonthClose[],
): Promise<boolean> {
  if (closes.length === 0) return false;
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("objective_month_closes").insert(
      closes.map((c) => ({
        user_id: userId,
        month,
        category: c.category,
        objective_base: c.objectiveBase,
        spent_base: c.spentBase,
        extraordinary_base: c.extraordinaryBase,
        surplus_base: c.surplusBase,
        excess_base: c.excessBase,
        destination: "reservas",
      })),
    );
    return !error;
  } catch {
    return false;
  }
}

// Record the user's decision for a closed month's surplus. Updates every
// category row of that month (the surplus is resolved as one decision).
export async function resolveMonthClose(
  userId: string,
  month: string,
  destination: string,
): Promise<number> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("objective_month_closes")
      .update({ destination, resolved_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("month", month)
      .select("id");
    if (error) return 0;
    return (data ?? []).length;
  } catch {
    return 0;
  }
}

// The most recent close (for the agent's resolve tool and report questions).
export async function loadLatestClose(
  userId: string,
): Promise<{ month: string; rows: ObjectiveCloseRecord[] } | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("objective_month_closes")
      .select("month, category, objective_base, spent_base, extraordinary_base, surplus_base, excess_base, destination, resolved_at")
      .eq("user_id", userId)
      .order("month", { ascending: false })
      .limit(12);
    const rows = (data ?? []) as {
      month: string; category: string; objective_base: number | string; spent_base: number | string;
      extraordinary_base: number | string; surplus_base: number | string; excess_base: number | string;
      destination: string; resolved_at: string | null;
    }[];
    if (rows.length === 0) return null;
    const month = rows[0].month;
    return {
      month,
      rows: rows
        .filter((r) => r.month === month)
        .map((r) => ({
          month: r.month,
          category: r.category,
          objectiveBase: Number(r.objective_base),
          spentBase: Number(r.spent_base),
          extraordinaryBase: Number(r.extraordinary_base),
          surplusBase: Number(r.surplus_base),
          excessBase: Number(r.excess_base),
          destination: r.destination,
          resolvedAt: r.resolved_at,
        })),
    };
  } catch {
    return null;
  }
}
