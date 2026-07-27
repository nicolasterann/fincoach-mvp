import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { AmbientPrefs } from "@/lib/ambient/ambient-decision";
import type { EngagementMode } from "@/lib/financial/coach-state-store";
import { randomUUID } from "node:crypto";

// Stage 13 — persistence for the ambient loop: user preferences (on the existing
// user_engagement row) and the idempotent, auditable ambient_nudges ledger.
// Display/profile preferences remain best-effort; proactive budget/claim reads
// are typed and fail closed because a false zero can exceed the user's message
// cap. The ledger RPC is the serialization boundary for concurrent producers.

export const DEFAULT_AMBIENT_PREFS: AmbientPrefs = {
  ambientEnabled: true,
  mode: "normal",
  pausedUntilMs: null,
  timezone: null,
  quietHoursStart: 22, // sensible default quiet window 22:00–07:00 local
  quietHoursEnd: 7,
  frequency: "auto",
  nudgeWeekdays: null,
  maxNudgesPerDay: 1,
};

interface EngagementRow {
  mode: EngagementMode | null;
  paused_until: string | null;
  ambient_enabled: boolean | null;
  timezone: string | null;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  frequency: string | null;
  nudge_weekdays: number[] | null;
  max_nudges_per_day: number | null;
}

export type AmbientPrefsRead =
  | { ok: true; prefs: AmbientPrefs }
  | { ok: false };

// Sending despite an unreadable preference row can bypass ambient_enabled,
// pause/light mode or quiet hours. The sender must fail closed; display callers
// may explicitly use loadAmbientPrefs() below.
export async function readAmbientPrefs(userId: string): Promise<AmbientPrefsRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("user_engagement")
      .select(
        "mode, paused_until, ambient_enabled, timezone, quiet_hours_start, quiet_hours_end, frequency, nudge_weekdays, max_nudges_per_day",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { ok: false };
    if (!data) return { ok: true, prefs: { ...DEFAULT_AMBIENT_PREFS } };
    const r = data as EngagementRow;
    const freq = r.frequency === "daily" || r.frequency === "weekly" || r.frequency === "off" ? r.frequency : "auto";
    return {
      ok: true,
      prefs: {
        ambientEnabled: r.ambient_enabled ?? DEFAULT_AMBIENT_PREFS.ambientEnabled,
        mode: r.mode ?? "normal",
        pausedUntilMs: r.paused_until ? new Date(r.paused_until).getTime() : null,
        timezone: r.timezone ?? null,
        quietHoursStart: r.quiet_hours_start ?? DEFAULT_AMBIENT_PREFS.quietHoursStart,
        quietHoursEnd: r.quiet_hours_end ?? DEFAULT_AMBIENT_PREFS.quietHoursEnd,
        frequency: freq,
        nudgeWeekdays: r.nudge_weekdays ?? null,
        maxNudgesPerDay: r.max_nudges_per_day ?? DEFAULT_AMBIENT_PREFS.maxNudgesPerDay,
      },
    };
  } catch {
    return { ok: false };
  }
}

export async function loadAmbientPrefs(userId: string): Promise<AmbientPrefs> {
  const read = await readAmbientPrefs(userId);
  return read.ok ? read.prefs : { ...DEFAULT_AMBIENT_PREFS };
}

export interface AmbientPrefPatch {
  ambientEnabled?: boolean;
  mode?: EngagementMode;
  pausedUntilISO?: string | null;
  timezone?: string | null;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  frequency?: "auto" | "daily" | "weekly" | "off";
  nudgeWeekdays?: number[] | null;
  maxNudgesPerDay?: number;
}

export async function saveAmbientPrefs(userId: string, patch: AmbientPrefPatch): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const row: Record<string, unknown> = { user_id: userId };
    if (patch.ambientEnabled !== undefined) row.ambient_enabled = patch.ambientEnabled;
    if (patch.mode !== undefined) row.mode = patch.mode;
    if (patch.pausedUntilISO !== undefined) row.paused_until = patch.pausedUntilISO;
    if (patch.timezone !== undefined) row.timezone = patch.timezone;
    if (patch.quietHoursStart !== undefined) row.quiet_hours_start = patch.quietHoursStart;
    if (patch.quietHoursEnd !== undefined) row.quiet_hours_end = patch.quietHoursEnd;
    if (patch.frequency !== undefined) row.frequency = patch.frequency;
    if (patch.nudgeWeekdays !== undefined) row.nudge_weekdays = patch.nudgeWeekdays;
    if (patch.maxNudgesPerDay !== undefined) row.max_nudges_per_day = patch.maxNudgesPerDay;
    const { error } = await supabase.from("user_engagement").upsert(row, { onConflict: "user_id" });
    return !error;
  } catch {
    return false;
  }
}

export interface AmbientCandidate {
  userId: string;
  chatId: string;
  firstName: string | null;
  lastTelegramAtMs: number | null;
}

export const PROACTIVE_TOTAL_CAP = 2;
export type ProactiveBudgetLane = "coach" | "calendar";

export interface CalendarDigestClaimPayload {
  version: 1;
  today: string;
  confirms: { id: string }[];
  asks: { id: string; expectedAskCount: number }[];
}

export type ProactiveBudgetRead =
  | { ok: true; totalCount: number; laneCount: number }
  | { ok: false };

export async function readProactiveBudgetUsage(
  userId: string,
  dayBucket: string,
  lane: ProactiveBudgetLane,
): Promise<ProactiveBudgetRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const base = () =>
      supabase
        .from("ambient_nudges")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("day_bucket", dayBucket)
        .eq("status", "sent");
    const [total, laneRead] = await Promise.all([
      base(),
      base().eq("budget_lane", lane),
    ]);
    if (total.error || laneRead.error || total.count == null || laneRead.count == null) {
      return { ok: false };
    }
    return { ok: true, totalCount: total.count, laneCount: laneRead.count };
  } catch {
    return { ok: false };
  }
}

export type AmbientCandidatesRead =
  | { ok: true; complete: true; candidates: AmbientCandidate[] }
  | { ok: true; complete: false }
  | { ok: false; complete: false };

export function ambientCandidatesFromResult(
  result: { data: unknown; error: unknown },
  limit: number,
): AmbientCandidatesRead {
  if (result.error || !Array.isArray(result.data)) {
    return { ok: false, complete: false };
  }
  if (result.data.length > limit) return { ok: true, complete: false };
  const rows = result.data as {
    user_id?: unknown;
    telegram_chat_id?: unknown;
    telegram_first_name?: unknown;
    last_message_at?: unknown;
  }[];
  if (rows.some((row) =>
    typeof row.user_id !== "string" ||
    typeof row.telegram_chat_id !== "string" ||
    !row.user_id ||
    !row.telegram_chat_id
  )) {
    return { ok: false, complete: false };
  }
  return {
    ok: true,
    complete: true,
    candidates: rows.map((row) => ({
      userId: row.user_id as string,
      chatId: row.telegram_chat_id as string,
      firstName:
        typeof row.telegram_first_name === "string"
          ? row.telegram_first_name
          : null,
      lastTelegramAtMs:
        typeof row.last_message_at === "string"
          ? new Date(row.last_message_at).getTime()
          : null,
    })),
  };
}

// Active Telegram-linked users (the ONLY ambient channel). This is the queue of
// proactive work: an unreadable/truncated queue can never mean "there was nobody
// to consider". CAP+1 makes the caller's bound explicit and falsifiable.
export async function readEligibleAmbientUsers(limit = 100): Promise<AmbientCandidatesRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("telegram_user_links")
      .select("user_id, telegram_chat_id, telegram_first_name, last_message_at")
      .eq("is_active", true)
      .order("user_id", { ascending: true })
      .limit(limit + 1);
    return ambientCandidatesFromResult({ data, error }, limit);
  } catch {
    return { ok: false, complete: false };
  }
}

/** Display-only compatibility. The cron uses `readEligibleAmbientUsers`. */
export async function loadEligibleAmbientUsers(limit = 100): Promise<AmbientCandidate[]> {
  const read = await readEligibleAmbientUsers(limit);
  return read.ok && read.complete ? read.candidates : [];
}

// Cross-channel recency: epoch ms of the user's LAST inbound message on ANY
// channel (web, Telegram, …). Folded into the idle gate so a user who's active
// in the web chat is never nudged on Telegram as if they'd gone quiet.
export type LastUserMessageRead =
  | { ok: true; lastMessageMs: number | null }
  | { ok: false };

export async function readLastUserMessageMs(userId: string): Promise<LastUserMessageRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("chat_messages")
      .select("created_at")
      .eq("user_id", userId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false };
    return {
      ok: true,
      lastMessageMs: data?.created_at ? new Date(data.created_at as string).getTime() : null,
    };
  } catch {
    return { ok: false };
  }
}

export async function loadLastUserMessageMs(userId: string): Promise<number | null> {
  const read = await readLastUserMessageMs(userId);
  return read.ok ? read.lastMessageMs : null;
}

export type ProactiveClaimResult =
  | {
      ok: true;
      outcome: "claimed";
      id: string;
      token: string;
      recovered: boolean;
    }
  | {
      ok: true;
      outcome: "already_delivered" | "already_attempted" | "in_progress" | "cap_reached";
      id?: string;
    }
  | { ok: false };

export interface ProactiveClaimRpc {
  call: (input: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function claimAmbientNudgeWith(
  input: {
    userId: string;
    topic: string;
    dayBucket: string;
    reason: string;
    priority: number;
    channel: "telegram" | "web";
    budgetLane: ProactiveBudgetLane;
    laneCap: number;
    totalCap?: number;
    payload?: CalendarDigestClaimPayload | Record<string, unknown>;
  },
  rpc: ProactiveClaimRpc,
): Promise<ProactiveClaimResult> {
  const token = randomUUID();
  try {
    const { data, error } = await rpc.call({
      p_user_id: input.userId,
      p_topic: input.topic,
      p_day_bucket: input.dayBucket,
      p_reason: input.reason.slice(0, 200),
      p_priority: input.priority,
      p_channel: input.channel,
      p_total_cap: input.totalCap ?? PROACTIVE_TOTAL_CAP,
      p_budget_lane: input.budgetLane,
      p_lane_cap: input.laneCap,
      p_claim_token: token,
      p_claim_payload: input.payload ?? {},
    });
    if (error) return { ok: false };
    const row = recordValue(data);
    const outcome = row?.outcome;
    if (row && outcome === "claimed" && typeof row.id === "string") {
      return {
        ok: true,
        outcome,
        id: row.id,
        token,
        recovered: row.recovered === true,
      };
    }
    if (
      outcome === "already_delivered" ||
      outcome === "already_attempted" ||
      outcome === "in_progress" ||
      outcome === "cap_reached"
    ) {
      return {
        ok: true,
        outcome,
        ...(typeof row?.id === "string" ? { id: row.id } : {}),
      };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function claimAmbientNudge(input: {
  userId: string;
  topic: string;
  dayBucket: string;
  reason: string;
  priority: number;
  channel: "telegram" | "web";
  budgetLane: ProactiveBudgetLane;
  laneCap: number;
  totalCap?: number;
  payload?: CalendarDigestClaimPayload | Record<string, unknown>;
}): Promise<ProactiveClaimResult> {
  const supabase = createSupabaseAdminClient();
  return claimAmbientNudgeWith(input, {
    call: async (params) => {
      const { data, error } = await supabase.rpc("kipu_claim_proactive_nudge", params);
      return { data, error };
    },
  });
}

export async function failAmbientClaimBeforeDelivery(input: {
  id: string;
  userId: string;
  token: string;
  reason: string;
}): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.rpc("kipu_fail_proactive_claim", {
      p_user_id: input.userId,
      p_claim_id: input.id,
      p_claim_token: input.token,
      p_reason: input.reason.slice(0, 300),
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function recordAmbientOutcome(input: {
  id: string;
  userId: string;
  token: string;
  delivered: boolean;
  telegramError?: string | null;
  messagePreview?: string | null;
}): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("ambient_nudges")
      .update({
        delivered: input.delivered,
        telegram_error: input.telegramError ? input.telegramError.slice(0, 300) : null,
        message_preview: input.messagePreview ? input.messagePreview.slice(0, 160) : null,
        finalized_at: new Date().toISOString(),
        lease_until: null,
      })
      .eq("id", input.id)
      .eq("user_id", input.userId)
      .eq("claim_token", input.token)
      .select("id")
      .maybeSingle();
    return !error && Boolean(data?.id);
  } catch {
    return false;
  }
}

export type CalendarDigestPublishResult =
  | {
      ok: true;
      webMessageId: string;
      autoNotified: number;
      asked: number;
      replayed: boolean;
    }
  | { ok: false };

export interface CalendarDigestPublishRpc {
  call: (input: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

export async function publishCalendarDigestWith(
  input: {
    userId: string;
    claimId: string;
    claimToken: string;
    content: string;
  },
  rpc: CalendarDigestPublishRpc,
): Promise<CalendarDigestPublishResult> {
  const content = input.content.trim();
  if (!content) return { ok: false };
  try {
    const { data, error } = await rpc.call({
      p_user_id: input.userId,
      p_claim_id: input.claimId,
      p_claim_token: input.claimToken,
      p_content: content.slice(0, 2000),
    });
    if (error) return { ok: false };
    const row = recordValue(data);
    if (
      (row?.outcome === "published" || row?.outcome === "replayed") &&
      typeof row.web_message_id === "string"
    ) {
      return {
        ok: true,
        webMessageId: row.web_message_id,
        autoNotified: Number(row.auto_notified ?? 0),
        asked: Number(row.asked ?? 0),
        replayed: row.outcome === "replayed",
      };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function publishCalendarDigest(input: {
  userId: string;
  claimId: string;
  claimToken: string;
  content: string;
}): Promise<CalendarDigestPublishResult> {
  const supabase = createSupabaseAdminClient();
  return publishCalendarDigestWith(input, {
    call: async (params) => {
      const { data, error } = await supabase.rpc("kipu_publish_calendar_digest_v2", params);
      return { data, error };
    },
  });
}

export type AmbientCoachPublishResult =
  | { ok: true; outcome: "published" | "replayed"; webMessageId: string }
  | { ok: false; reason: "conflict" | "write_failed" };

export interface AmbientCoachPublishRpc {
  call: (input: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

// J-7, auditoría externa: provenance is durable BEFORE the external Telegram
// effect. The old append happened after send and returned null on failure, so a
// real delivered message could disappear from the only review surface.
export async function publishAmbientCoachMessageWith(
  input: {
    userId: string;
    claimId: string;
    claimToken: string;
    chatId: string;
    topic: string;
    content: string;
  },
  rpc: AmbientCoachPublishRpc,
): Promise<AmbientCoachPublishResult> {
  const content = input.content.trim();
  if (!content || content.length > 2000 || !input.chatId.trim() || !input.topic.trim()) {
    return { ok: false, reason: "write_failed" };
  }
  try {
    const { data, error } = await rpc.call({
      p_user_id: input.userId,
      p_claim_id: input.claimId,
      p_claim_token: input.claimToken,
      p_chat_id: input.chatId,
      p_topic: input.topic,
      p_content: content,
    });
    if (error) {
      const conflict =
        error.code === "22023" ||
        error.code === "40001" ||
        error.code === "42501" ||
        /KIPU_(CONFLICT|VALIDATION|OWNERSHIP)/.test(error.message ?? "");
      return { ok: false, reason: conflict ? "conflict" : "write_failed" };
    }
    const row = recordValue(data);
    if (
      (row?.outcome === "published" || row?.outcome === "replayed") &&
      typeof row.web_message_id === "string"
    ) {
      return {
        ok: true,
        outcome: row.outcome,
        webMessageId: row.web_message_id,
      };
    }
    return { ok: false, reason: "write_failed" };
  } catch {
    return { ok: false, reason: "write_failed" };
  }
}

export async function publishAmbientCoachMessageReliablyWith(
  input: Parameters<typeof publishAmbientCoachMessageWith>[0],
  publish: (
    value: Parameters<typeof publishAmbientCoachMessageWith>[0],
  ) => Promise<AmbientCoachPublishResult>,
): Promise<AmbientCoachPublishResult> {
  const first = await publish(input);
  if (first.ok || first.reason === "conflict") return first;
  // Same identity, one retry: a lost response becomes `replayed`; a proven
  // conflict is deterministic and is never hammered.
  return publish(input);
}

export async function publishAmbientCoachMessageReliably(
  input: Parameters<typeof publishAmbientCoachMessageWith>[0],
): Promise<AmbientCoachPublishResult> {
  const supabase = createSupabaseAdminClient();
  const call = async (params: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(
      "kipu_publish_ambient_coach_message_v2",
      params,
    );
    return { data, error };
  };
  return publishAmbientCoachMessageReliablyWith(
    input,
    (value) => publishAmbientCoachMessageWith(value, { call }),
  );
}

export async function recordAmbientTelegramError(input: {
  id: string;
  userId: string;
  token: string;
  error: string | null;
}): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("ambient_nudges")
      .update({
        telegram_error: input.error ? input.error.slice(0, 300) : null,
      })
      .eq("id", input.id)
      .eq("user_id", input.userId)
      .eq("claim_token", input.token)
      .eq("delivered", true)
      .select("id")
      .maybeSingle();
    return !error && Boolean(data?.id);
  } catch {
    return false;
  }
}

// Non-actionable observability row (skip reasons), so we can answer "why didn't
// Kipu nudge". Never conflicts with the 'sent' unique index.
export async function recordAmbientSkip(input: {
  userId: string;
  topic: string;
  dayBucket: string;
  reason: string;
}): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.from("ambient_nudges").insert({
      user_id: input.userId,
      topic: input.topic,
      day_bucket: input.dayBucket,
      channel: "telegram",
      status: "skipped",
      reason: input.reason.slice(0, 200),
    });
  } catch {
    // best-effort
  }
}

// ── S31 (item 2.2) — scheduled-reminder DELIVERY ────────────────────────────
// The scheduled-changes cron fires a reminder by writing an active context note
// "RECORDATORIO (YYYY-MM-DD): …". Before S31 that note went into a void (never
// pushed, active forever). The ambient loop now loads the undelivered ones,
// pings the user once (topic scheduled_reminder_due), and deactivates them so
// they can't nag forever or rot in the memory digest.

export interface FiredReminderNote {
  id: string;
  content: string;
}

export type FiredReminderNotesRead =
  | { ok: true; notes: FiredReminderNote[] }
  | { ok: false };

// Cap matches what one nudge message can honestly cover (all surfaced ones are
// deactivated after delivery, so never load more than we surface).
const FIRED_REMINDERS_MAX = 3;

export async function readFiredReminderNotes(userId: string): Promise<FiredReminderNotesRead> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("user_context_notes")
      .select("id, content")
      .eq("user_id", userId)
      .eq("is_active", true)
      .eq("source", "system")
      .like("content", "RECORDATORIO%")
      .order("created_at", { ascending: true })
      .limit(FIRED_REMINDERS_MAX);
    if (error || !data) return { ok: false };
    return {
      ok: true,
      notes: data
      .map((r) => ({ id: String((r as Record<string, unknown>).id), content: String((r as Record<string, unknown>).content ?? "").trim() }))
      .filter((r) => r.id && r.content),
    };
  } catch {
    return { ok: false };
  }
}

export async function loadFiredReminderNotes(userId: string): Promise<FiredReminderNote[]> {
  const read = await readFiredReminderNotes(userId);
  return read.ok ? read.notes : [];
}

// Deactivate (never delete) the reminder notes that were just delivered — the
// standard append-only pattern for user_context_notes.
export async function deactivateContextNotes(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("user_context_notes")
      .update({ is_active: false })
      .eq("user_id", userId)
      .in("id", ids);
  } catch {
    // best-effort: an undeactivated note only means it may surface once more
  }
}

// Mark a recently-delivered nudge as replied when the user sends a message — a
// learning signal and observability for "did the nudge land". Recency-based (no
// timezone needed): any delivered, not-yet-replied nudge in the last ~26h.
export async function markAmbientReplied(userId: string): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    const sinceISO = new Date(Date.now() - 26 * 3_600_000).toISOString();
    await supabase
      .from("ambient_nudges")
      .update({ replied: true })
      .eq("user_id", userId)
      .eq("status", "sent")
      .eq("replied", false)
      .gte("created_at", sinceISO);
  } catch {
    // best-effort
  }
}
