import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { AmbientPrefs } from "@/lib/ambient/ambient-decision";
import type { EngagementMode } from "@/lib/financial/coach-state-store";

// Stage 13 — persistence for the ambient loop: user preferences (on the existing
// user_engagement row) and the idempotent, auditable ambient_nudges ledger. All
// reads are best-effort (defaults if the migration isn't applied yet); the ledger
// claim is the idempotency boundary that makes cron repeats / retries /
// concurrent workers safe.

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

export async function loadAmbientPrefs(userId: string): Promise<AmbientPrefs> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("user_engagement")
      .select(
        "mode, paused_until, ambient_enabled, timezone, quiet_hours_start, quiet_hours_end, frequency, nudge_weekdays, max_nudges_per_day",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return { ...DEFAULT_AMBIENT_PREFS };
    const r = data as EngagementRow;
    const freq = r.frequency === "daily" || r.frequency === "weekly" || r.frequency === "off" ? r.frequency : "auto";
    return {
      ambientEnabled: r.ambient_enabled ?? DEFAULT_AMBIENT_PREFS.ambientEnabled,
      mode: r.mode ?? "normal",
      pausedUntilMs: r.paused_until ? new Date(r.paused_until).getTime() : null,
      timezone: r.timezone ?? null,
      quietHoursStart: r.quiet_hours_start ?? DEFAULT_AMBIENT_PREFS.quietHoursStart,
      quietHoursEnd: r.quiet_hours_end ?? DEFAULT_AMBIENT_PREFS.quietHoursEnd,
      frequency: freq,
      nudgeWeekdays: r.nudge_weekdays ?? null,
      maxNudgesPerDay: r.max_nudges_per_day ?? DEFAULT_AMBIENT_PREFS.maxNudgesPerDay,
    };
  } catch {
    return { ...DEFAULT_AMBIENT_PREFS };
  }
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

// Active Telegram-linked users (the ONLY ambient channel). Onboarding/eligibility
// is decided per-user by the freshness/decision layer. Bounded for runtime.
export async function loadEligibleAmbientUsers(limit = 100): Promise<AmbientCandidate[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("telegram_user_links")
      .select("user_id, telegram_chat_id, telegram_first_name, last_message_at")
      .eq("is_active", true)
      .order("user_id", { ascending: true })
      .limit(limit);
    return (data ?? [])
      .filter((r): r is { user_id: string; telegram_chat_id: string; telegram_first_name: string | null; last_message_at: string | null } => Boolean(r?.user_id && r?.telegram_chat_id))
      .map((r) => ({
        userId: r.user_id,
        chatId: r.telegram_chat_id,
        firstName: r.telegram_first_name,
        lastTelegramAtMs: r.last_message_at ? new Date(r.last_message_at).getTime() : null,
      }));
  } catch {
    return [];
  }
}

// Cross-channel recency: epoch ms of the user's LAST inbound message on ANY
// channel (web, Telegram, …). Folded into the idle gate so a user who's active
// in the web chat is never nudged on Telegram as if they'd gone quiet.
export async function loadLastUserMessageMs(userId: string): Promise<number | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("chat_messages")
      .select("created_at")
      .eq("user_id", userId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.created_at ? new Date(data.created_at as string).getTime() : null;
  } catch {
    return null;
  }
}

// Idempotency CLAIM: at most one 'sent' nudge per user/topic/local-day. Returns
// the new row id when this caller won the claim, or null when another delivery
// already owns it (the unique partial index is the race winner). This makes cron
// repeats, retries and concurrent workers safe — only the winner sends.
export async function claimAmbientNudge(input: {
  userId: string;
  topic: string;
  dayBucket: string; // YYYY-MM-DD (local day)
  reason: string;
  priority: number;
}): Promise<string | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("ambient_nudges")
      .insert({
        user_id: input.userId,
        topic: input.topic,
        day_bucket: input.dayBucket,
        channel: "telegram",
        status: "sent",
        reason: input.reason.slice(0, 200),
        priority: input.priority,
      })
      .select("id")
      .maybeSingle();
    if (error || !data) return null; // unique violation → already claimed
    return data.id as string;
  } catch {
    return null;
  }
}

// Finalize a claimed nudge with its real delivery outcome. The claim stays
// 'sent' (the day's slot for this topic is PERMANENTLY used) even if delivery
// failed — so a transient Telegram error (incl. "delivered but the response was
// lost") can NEVER cause a same-day re-send. A failed delivery just records the
// error and is re-evaluated the next day; this guarantees "no duplicate nudges".
export async function recordAmbientOutcome(input: {
  id: string;
  userId: string;
  delivered: boolean;
  telegramError?: string | null;
  messagePreview?: string | null;
}): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("ambient_nudges")
      .update({
        delivered: input.delivered,
        telegram_error: input.telegramError ? input.telegramError.slice(0, 300) : null,
        message_preview: input.messagePreview ? input.messagePreview.slice(0, 160) : null,
      })
      .eq("id", input.id)
      .eq("user_id", input.userId);
  } catch {
    // best-effort audit
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

export async function countAmbientSentToday(userId: string, dayBucket: string): Promise<number> {
  try {
    const supabase = createSupabaseAdminClient();
    const { count } = await supabase
      .from("ambient_nudges")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("day_bucket", dayBucket)
      .eq("status", "sent");
    return count ?? 0;
  } catch {
    return 0;
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

// Cap matches what one nudge message can honestly cover (all surfaced ones are
// deactivated after delivery, so never load more than we surface).
const FIRED_REMINDERS_MAX = 3;

export async function loadFiredReminderNotes(userId: string): Promise<FiredReminderNote[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("user_context_notes")
      .select("id, content")
      .eq("user_id", userId)
      .eq("is_active", true)
      .eq("source", "system")
      .like("content", "RECORDATORIO%")
      .order("created_at", { ascending: true })
      .limit(FIRED_REMINDERS_MAX);
    return (data ?? [])
      .map((r) => ({ id: String((r as Record<string, unknown>).id), content: String((r as Record<string, unknown>).content ?? "").trim() }))
      .filter((r) => r.id && r.content);
  } catch {
    return [];
  }
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
