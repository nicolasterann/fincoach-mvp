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

export type MonthCloseGateRead =
  | { ok: true; exists: boolean }
  | { ok: false };

export async function readHasMonthClose(
  userId: string,
  month: string,
): Promise<MonthCloseGateRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("objective_month_closes")
      .select("id")
      .eq("user_id", userId)
      .eq("month", month)
      .limit(1);
    // Fail closed for the write, but keep the failure observable. Returning
    // `exists:true` here prevented a duplicate yet made the cron report a green
    // skip, so an outage could silently suppress every monthly close.
    if (error || !data) return { ok: false };
    return { ok: true, exists: data.length > 0 };
  } catch {
    return { ok: false };
  }
}

/** Compatibility for display/non-cron callers. The close runner uses the typed read. */
export async function hasMonthClose(userId: string, month: string): Promise<boolean> {
  const read = await readHasMonthClose(userId, month);
  return !read.ok || read.exists;
}

export type ObjectiveClosePublishResult =
  | { ok: true; outcome: "published" | "replayed"; webMessageId: string }
  | { ok: false; reason: "conflict" | "write_failed" };

export interface ObjectiveClosePublisher {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

// Bloque J-7, auditoría externa: el mensaje web, las filas permanentes del
// cierre y la finalización del asiento proactivo son UN solo hecho durable.
// Antes eran tres writes independientes y appendChatMessage devolvía null sin
// lanzar: el cron podía creer que publicó, mandar Telegram y congelar el cierre
// aunque el chat no tuviera el mensaje. El seam permite probar el caller sin DB.
export async function publishObjectiveMonthCloseWith(
  publisher: ObjectiveClosePublisher,
  input: {
    userId: string;
    claimId: string;
    claimToken: string;
    month: string;
    content: string;
    closes: ObjectiveMonthClose[];
  },
): Promise<ObjectiveClosePublishResult> {
  let response: Awaited<ReturnType<ObjectiveClosePublisher["rpc"]>>;
  try {
    response = await publisher.rpc("kipu_publish_objective_month_close_v2", {
      p_user_id: input.userId,
      p_claim_id: input.claimId,
      p_claim_token: input.claimToken,
      p_month: input.month,
      p_content: input.content,
      p_closes: input.closes.map((close) => ({
        category: close.category,
        objectiveBase: close.objectiveBase,
        spentBase: close.spentBase,
        extraordinaryBase: close.extraordinaryBase,
        surplusBase: close.surplusBase,
        excessBase: close.excessBase,
      })),
    });
  } catch {
    return { ok: false, reason: "write_failed" };
  }
  const { data, error } = response;
  if (error) {
    const conflict =
      error.code === "22023" ||
      error.code === "40001" ||
      error.code === "42501" ||
      /KIPU_(CONFLICT|VALIDATION|OWNERSHIP)/.test(error.message ?? "");
    return { ok: false, reason: conflict ? "conflict" : "write_failed" };
  }
  const row = data as { outcome?: unknown; web_message_id?: unknown } | null;
  const outcome = row?.outcome;
  const webMessageId = String(row?.web_message_id ?? "");
  if ((outcome !== "published" && outcome !== "replayed") || !webMessageId) {
    return { ok: false, reason: "write_failed" };
  }
  return { ok: true, outcome, webMessageId };
}

export async function publishObjectiveMonthClose(input: {
  userId: string;
  claimId: string;
  claimToken: string;
  month: string;
  content: string;
  closes: ObjectiveMonthClose[];
}): Promise<ObjectiveClosePublishResult> {
  return publishObjectiveMonthCloseWith(createSupabaseAdminClient(), input);
}

export type ObjectiveMonthClosePublicationInput = Parameters<typeof publishObjectiveMonthClose>[0];

export async function publishObjectiveMonthCloseReliablyWith(
  input: ObjectiveMonthClosePublicationInput,
  publish: (value: ObjectiveMonthClosePublicationInput) => Promise<ObjectiveClosePublishResult>,
): Promise<ObjectiveClosePublishResult> {
  const first = await publish(input);
  if (first.ok || first.reason === "conflict") return first;
  // Sólo retry de infraestructura/resultado perdido. Un conflicto es un hecho
  // determinista y repetirlo no lo vuelve seguro.
  return publish(input);
}

export async function publishObjectiveMonthCloseReliably(
  input: ObjectiveMonthClosePublicationInput,
): Promise<ObjectiveClosePublishResult> {
  return publishObjectiveMonthCloseReliablyWith(input, publishObjectiveMonthClose);
}

// Record the user's decision for a closed month's surplus. Updates every
// category row of that month (the surplus is resolved as one decision).
export type ResolveMonthCloseResult =
  | { ok: true; updated: number }
  | { ok: false };

export async function resolveMonthClose(
  userId: string,
  month: string,
  destination: string,
): Promise<ResolveMonthCloseResult> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("objective_month_closes")
      .update({ destination, resolved_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("month", month)
      .select("id");
    if (error || !data) return { ok: false };
    return { ok: true, updated: data.length };
  } catch {
    return { ok: false };
  }
}

// The most recent close (for the agent's resolve tool and report questions).
export type LatestCloseRead =
  | { ok: true; close: { month: string; rows: ObjectiveCloseRecord[] } | null }
  | { ok: false };

export async function readLatestClose(
  userId: string,
): Promise<LatestCloseRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("objective_month_closes")
      .select("month, category, objective_base, spent_base, extraordinary_base, surplus_base, excess_base, destination, resolved_at")
      .eq("user_id", userId)
      .order("month", { ascending: false })
      .limit(12);
    if (error || !data) return { ok: false };
    const rows = (data ?? []) as {
      month: string; category: string; objective_base: number | string; spent_base: number | string;
      extraordinary_base: number | string; surplus_base: number | string; excess_base: number | string;
      destination: string; resolved_at: string | null;
    }[];
    if (rows.length === 0) return { ok: true, close: null };
    const month = rows[0].month;
    return {
      ok: true,
      close: {
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
      },
    };
  } catch {
    return { ok: false };
  }
}

/** Display-only compatibility. Writers must use `readLatestClose`. */
export async function loadLatestClose(
  userId: string,
): Promise<{ month: string; rows: ObjectiveCloseRecord[] } | null> {
  const read = await readLatestClose(userId);
  return read.ok ? read.close : null;
}
