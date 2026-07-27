import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { generateAmbientMessage } from "@/lib/ambient/ambient-message";
import {
  decideAmbientNudge,
  type AmbientDecisionInput,
} from "@/lib/ambient/ambient-decision";
import {
  claimAmbientNudge,
  failAmbientClaimBeforeDelivery,
  PROACTIVE_TOTAL_CAP,
  publishAmbientCoachMessageReliably,
  readAmbientPrefs,
  readEligibleAmbientUsers,
  readFiredReminderNotes,
  readLastUserMessageMs,
  readProactiveBudgetUsage,
  recordAmbientTelegramError,
  recordAmbientSkip,
  type AmbientCandidate,
} from "@/lib/ambient/ambient-store";
import { getRecentChatMessages } from "@/lib/chat-memory/chat-messages";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { readEngagement, readNudgeLog } from "@/lib/financial/coach-state-store";
import { classifyFreshness } from "@/lib/financial/freshness";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { sendTelegramMessage } from "@/lib/telegram/send-message";
import type { FixedExpense } from "@/types/financial";

// Stage 13 — the ambient loop orchestrator. For each eligible Telegram-linked
// user it assembles the SAME live financial truth the chat/dashboard use, lets
// the deterministic decision layer choose whether/what to nudge, CLAIMS the nudge
// idempotently, has the AI write the message, sends it via Telegram, and records
// the real outcome. A failed send never corrupts state and never blocks anything.

const DAY_MS = 86_400_000;
const DEFAULT_TZ = "America/Guayaquil"; // LatAm default when the user hasn't set one

export interface AmbientUserResult {
  userId: string;
  status: "sent" | "skipped" | "failed";
  topic?: string;
  reason: string;
}

// Local hour / weekday / day-string in the user's timezone (for quiet hours,
// weekly frequency and the per-day idempotency bucket).
function localTimeIn(tz: string, nowMs: number): { hour: number; weekday: number; dayBucket: string } {
  const date = new Date(nowMs);
  let hour = 0;
  let dayBucket = date.toISOString().slice(0, 10);
  let weekday = date.getUTCDay();
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      weekday: "short",
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = get("year");
    const m = get("month");
    const d = get("day");
    const h = get("hour");
    if (y && m && d) dayBucket = `${y}-${m}-${d}`;
    if (h !== undefined) hour = (parseInt(h, 10) % 24 + 24) % 24;
    const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const wk = get("weekday");
    if (wk && wk in wd) weekday = wd[wk];
  } catch {
    // fall back to UTC parts already set
  }
  return { hour, weekday, dayBucket };
}

// Evaluate (and maybe send) a single user's ambient nudge. Pure of cron concerns.
export async function runAmbientNudgeForUser(
  candidate: AmbientCandidate,
  nowMs: number,
): Promise<AmbientUserResult> {
  const userId = candidate.userId;
  let ctx;
  try {
    ctx = await buildUserFinancialContext(userId);
  } catch {
    return { userId, status: "failed", reason: "context_unavailable" };
  }

  const [prefsRead, engagementRead] = await Promise.all([
    readAmbientPrefs(userId),
    readEngagement(userId),
  ]);
  if (!prefsRead.ok || !engagementRead.ok) {
    // Never turn an unreadable opt-out/pause/quiet-hours row into defaults that
    // authorize a proactive message.
    return { userId, status: "failed", reason: "engagement_unavailable" };
  }
  const prefs = prefsRead.prefs;
  const engagement = engagementRead.engagement;
  const snapshot = deriveAdvisorySnapshot(ctx);
  const briefing = await buildCoachingBriefing({ userId, ctx, snapshot, surfaceNudges: false }).catch(() => null);
  if (!briefing) return { userId, status: "failed", reason: "briefing_unavailable" };

  const tz = prefs.timezone ?? DEFAULT_TZ;
  const { hour, weekday, dayBucket } = localTimeIn(tz, nowMs);

  // Cross-channel recency: the user's last inbound message on ANY channel.
  const lastChatRead = await readLastUserMessageMs(userId);
  if (!lastChatRead.ok) {
    // Missing recency would make an active user look idle and eligible.
    return { userId, status: "failed", reason: "chat_recency_unavailable" };
  }
  const lastChatMs = lastChatRead.lastMessageMs;

  // Freshness inputs from the real context.
  const daysSinceActivity = briefing.daysSinceLastActivity;
  const daysSinceTelegram =
    candidate.lastTelegramAtMs !== null
      ? Math.floor((nowMs - candidate.lastTelegramAtMs) / DAY_MS)
      : null;
  const daysSinceChat =
    lastChatMs !== null ? Math.floor((nowMs - lastChatMs) / DAY_MS) : null;
  const idleDays =
    daysSinceActivity === null && daysSinceTelegram === null && daysSinceChat === null
      ? null
      : Math.min(
          daysSinceActivity ?? Infinity,
          daysSinceTelegram ?? Infinity,
          daysSinceChat ?? Infinity,
        );
  const daysSinceReconcile = engagement.lastReconciledAt
    ? Math.floor((nowMs - new Date(engagement.lastReconciledAt).getTime()) / DAY_MS)
    : null;
  const spendingAccounts = ctx.accounts.filter((a) => !a.isGoalAccount);
  const accountAgeDays = spendingAccounts.length
    ? Math.floor(
        (nowMs - Math.min(...spendingAccounts.map((a) => new Date(a.createdAt).getTime()))) / DAY_MS,
      )
    : null;
  const ambientPaused =
    prefs.mode === "paused" || (prefs.pausedUntilMs !== null && prefs.pausedUntilMs > nowMs);

  const freshness = classifyFreshness({
    onboardingCompleted: ctx.profile.onboardingCompleted,
    ambientPaused,
    accountsCount: spendingAccounts.length,
    hasIncome: ctx.incomeSources.some((s) => s.status === "active"),
    hasFixedExpenses: ctx.fixedExpenses.some((f) => f.isActive),
    idleDays: Number.isFinite(idleDays as number) ? (idleDays as number) : null,
    daysSinceReconcile,
    accountAgeDays,
    hasGoal: Boolean(ctx.mainGoal),
  });

  const idleHours = (() => {
    const tg = candidate.lastTelegramAtMs !== null ? (nowMs - candidate.lastTelegramAtMs) / 3_600_000 : null;
    const act = daysSinceActivity !== null ? daysSinceActivity * 24 : null;
    const chat = lastChatMs !== null ? (nowMs - lastChatMs) / 3_600_000 : null;
    const vals = [tg, act, chat].filter((v): v is number => v !== null);
    return vals.length ? Math.min(...vals) : null;
  })();

  const nudgeRead = await readNudgeLog(userId);
  if (!nudgeRead.ok) {
    return { userId, status: "failed", reason: "nudge_cooldown_unavailable" };
  }
  const nudgeLog = nudgeRead.log;
  const budgetRead = await readProactiveBudgetUsage(userId, dayBucket, "coach");
  if (!budgetRead.ok) {
    return { userId, status: "failed", reason: "proactive_budget_unavailable" };
  }
  // S31 (item 2.2) — fired scheduled reminders waiting for delivery. Loaded
  // here (not in the pure decision layer) and deactivated after ONE delivery
  // so a reminder can't nag forever nor rot active in the memory digest.
  const remindersRead = await readFiredReminderNotes(userId);
  if (!remindersRead.ok) {
    return { userId, status: "failed", reason: "scheduled_reminders_unavailable" };
  }
  const firedReminders = remindersRead.notes;

  const decisionInput: AmbientDecisionInput = {
    telegramLinked: true,
    prefs,
    freshness,
    briefing,
    idleHours,
    nudgeLog,
    sentToday: budgetRead.laneCount,
    nowMs,
    localHour: hour,
    localWeekday: weekday,
    // Stage 18 — personalization: honor the user's nudge sensitivity (only the
    // important nudges fire when sensitivity is high), on top of all Stage 13 limits.
    suppressBelowPriority: briefing.personalization?.decisions.nudge.suppressBelowPriority ?? 0,
    dueReminders: firedReminders.map((r) => ({ content: r.content })),
    // Stage 32 (Item B) — active month-to-month variable fixed expenses, so the
    // decision layer can ask "¿cuánto te salió X este mes?" until the user's
    // answer (update_fixed_expense) stamps last_confirmed_month. The field
    // arrives via the ENGINE mapping (migration 038); read defensively so a
    // build where that mapping hasn't landed yet treats it as "never confirmed".
    localDateISO: dayBucket,
    variableExpenses: ctx.fixedExpenses
      .filter((f) => f.isActive && f.isVariable)
      .map((f) => ({
        name: f.name,
        amount: f.amount,
        currency: f.currency,
        lastConfirmedMonth:
          (f as FixedExpense & { lastConfirmedMonth?: string | null }).lastConfirmedMonth ?? null,
      })),
  };
  const decision = decideAmbientNudge(decisionInput);

  if (!decision.send) {
    // Observability: record WHY not (non-sensitive). Keep one skip row per topic/day light.
    await recordAmbientSkip({ userId, topic: "decision", dayBucket, reason: decision.skipReason });
    return { userId, status: "skipped", reason: decision.skipReason };
  }

  const { topic, priority, reason, facts } = decision.nudge;

  const claim = await claimAmbientNudge({
    userId,
    topic,
    dayBucket,
    reason,
    priority,
    channel: "telegram",
    budgetLane: "coach",
    laneCap: Math.max(0, prefs.maxNudgesPerDay),
    totalCap: PROACTIVE_TOTAL_CAP,
    payload:
      topic === "scheduled_reminder_due"
        ? { reminderIds: firedReminders.map((reminder) => reminder.id) }
        : {},
  });
  if (!claim.ok) return { userId, status: "failed", topic, reason: "claim_unavailable" };
  if (claim.outcome !== "claimed") {
    return { userId, status: "skipped", topic, reason: claim.outcome };
  }

  // AI writes the message. If it can't run cleanly, send NOTHING (no template).
  const recent = await getRecentChatMessages({ userId, channel: "telegram", chatId: candidate.chatId, limit: 6 }).catch(() => []);
  const message = await generateAmbientMessage({
    topic,
    facts,
    firstName: candidate.firstName ?? ctx.profile.fullName?.split(" ")[0] ?? null,
    tone: ctx.coachPreferences?.tone ?? null,
    recentMessages: recent.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
  });
  if (!message) {
    const released = await failAmbientClaimBeforeDelivery({
      id: claim.id,
      userId,
      token: claim.token,
      reason: "ai_unavailable",
    });
    return {
      userId,
      status: "failed",
      topic,
      reason: released ? "ai_unavailable" : "claim_release_failed",
    };
  }

  // Persist the auditable, attributed chat turn before touching Telegram. The
  // RPC also finalizes the claim; retrying the same identity after a lost
  // response returns replayed without duplicating the web message.
  const publication = await publishAmbientCoachMessageReliably({
    userId,
    claimId: claim.id,
    claimToken: claim.token,
    chatId: candidate.chatId,
    topic,
    content: message,
  });
  if (!publication.ok) {
    // Do not release an ambiguous publication: if it committed, another claim
    // could produce a second proactive turn. The durable RPC is the authority.
    return { userId, status: "failed", topic, reason: "publication_unavailable" };
  }

  let deliveredToTelegram = true;
  let tgError: string | null = null;
  try {
    await sendTelegramMessage({ chatId: candidate.chatId, text: message });
  } catch (e) {
    deliveredToTelegram = false;
    tgError = e instanceof Error ? e.message : "telegram send failed";
  }
  const telegramOutcomeRecorded = await recordAmbientTelegramError({
    id: claim.id,
    userId,
    token: claim.token,
    error: tgError,
  });
  if (!telegramOutcomeRecorded) {
    return { userId, status: "failed", topic, reason: "telegram_outcome_unavailable" };
  }

  // The v2 publication RPC already persisted the cooldown and consumed any
  // scheduled reminder notes in the SAME transaction as the chat turn + claim.
  // Telegram remains the only external at-most-once effect.
  return {
    userId,
    status: deliveredToTelegram ? "sent" : "failed",
    topic,
    reason: deliveredToTelegram ? reason : "telegram_send_failed",
  };
}

export interface AmbientLoopResult {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  byReason: Record<string, number>;
}

// Run one bounded pass of the ambient loop (used by the cron). Sequential per
// user keeps within model rate limits and runtime; the limit caps the batch.
export async function runAmbientLoop(opts?: { limit?: number; nowMs?: number }): Promise<AmbientLoopResult> {
  const nowMs = opts?.nowMs ?? Date.now();
  const candidatesRead = await readEligibleAmbientUsers(opts?.limit ?? 100);
  if (!candidatesRead.ok || !candidatesRead.complete) {
    return {
      considered: 0,
      sent: 0,
      skipped: 0,
      failed: 1,
      byReason: {
        [candidatesRead.ok ? "candidate_queue_incomplete" : "candidate_queue_unavailable"]: 1,
      },
    };
  }
  const candidates = candidatesRead.candidates;
  const result: AmbientLoopResult = { considered: candidates.length, sent: 0, skipped: 0, failed: 0, byReason: {} };
  for (const c of candidates) {
    let r: AmbientUserResult;
    try {
      r = await runAmbientNudgeForUser(c, nowMs);
    } catch {
      // An unexpected per-user exception means work was NOT completed. Calling
      // it "skipped" made the cron's `ok` stay green and hid the retry-worthy
      // failure from observability.
      r = { userId: c.userId, status: "failed", reason: "user_error" };
    }
    result[r.status] += 1;
    // Aggregate on the non-sensitive TOPIC for sent/failed (a sent decision's
    // reason carries instrument/payment names); skip reasons are already generic.
    const key = r.topic ?? r.reason;
    result.byReason[key] = (result.byReason[key] ?? 0) + 1;
  }
  return result;
}
