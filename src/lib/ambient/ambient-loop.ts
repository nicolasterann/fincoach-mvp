import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { generateAmbientMessage } from "@/lib/ambient/ambient-message";
import {
  decideAmbientNudge,
  type AmbientDecisionInput,
} from "@/lib/ambient/ambient-decision";
import {
  claimAmbientNudge,
  deactivateContextNotes,
  failAmbientClaimBeforeDelivery,
  loadAmbientPrefs,
  loadEligibleAmbientUsers,
  loadFiredReminderNotes,
  loadLastUserMessageMs,
  PROACTIVE_TOTAL_CAP,
  readProactiveBudgetUsage,
  recordAmbientOutcome,
  recordAmbientSkip,
  type AmbientCandidate,
} from "@/lib/ambient/ambient-store";
import {
  appendChatMessage,
  getRecentChatMessages,
} from "@/lib/chat-memory/chat-messages";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { loadEngagement, loadNudgeLog, recordNudgeSurfaced } from "@/lib/financial/coach-state-store";
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
    return { userId, status: "skipped", reason: "context_unavailable" };
  }

  const prefs = await loadAmbientPrefs(userId);
  const engagement = await loadEngagement(userId);
  const snapshot = deriveAdvisorySnapshot(ctx);
  const briefing = await buildCoachingBriefing({ userId, ctx, snapshot, surfaceNudges: false }).catch(() => null);
  if (!briefing) return { userId, status: "skipped", reason: "briefing_unavailable" };

  const tz = prefs.timezone ?? DEFAULT_TZ;
  const { hour, weekday, dayBucket } = localTimeIn(tz, nowMs);

  // Cross-channel recency: the user's last inbound message on ANY channel.
  const lastChatMs = await loadLastUserMessageMs(userId);

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

  const nudgeLog = await loadNudgeLog(userId);
  const budgetRead = await readProactiveBudgetUsage(userId, dayBucket, "coach");
  if (!budgetRead.ok) {
    return { userId, status: "failed", reason: "proactive_budget_unavailable" };
  }
  // S31 (item 2.2) — fired scheduled reminders waiting for delivery. Loaded
  // here (not in the pure decision layer) and deactivated after ONE delivery
  // so a reminder can't nag forever nor rot active in the memory digest.
  const firedReminders = await loadFiredReminderNotes(userId);

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

  let delivered = true;
  let tgError: string | null = null;
  try {
    await sendTelegramMessage({ chatId: candidate.chatId, text: message });
  } catch (e) {
    delivered = false;
    tgError = e instanceof Error ? e.message : "telegram send failed";
  }
  const outcomeRecorded = await recordAmbientOutcome({
    id: claim.id,
    userId,
    token: claim.token,
    delivered,
    telegramError: tgError,
    messagePreview: message,
  });
  if (!outcomeRecorded) {
    return { userId, status: "failed", topic, reason: "outcome_unavailable" };
  }

  if (delivered) {
    // Feed the per-topic cooldown and persist the message so chat history +
    // cross-channel freshness reflect that Kipu reached out.
    await recordNudgeSurfaced(userId, topic);
    await appendChatMessage({
      userId,
      channel: "telegram",
      chatId: candidate.chatId,
      role: "assistant",
      content: message,
      messageType: "advisory",
    }).catch(() => {});
    // A delivered reminder is DONE: deactivate its note(s) so it surfaces
    // exactly once (the entity note / scheduled change keep the durable truth).
    if (topic === "scheduled_reminder_due" && firedReminders.length > 0) {
      await deactivateContextNotes(userId, firedReminders.map((r) => r.id));
    }
  }
  return { userId, status: delivered ? "sent" : "failed", topic, reason };
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
  const candidates = await loadEligibleAmbientUsers(opts?.limit ?? 100);
  const result: AmbientLoopResult = { considered: candidates.length, sent: 0, skipped: 0, failed: 0, byReason: {} };
  for (const c of candidates) {
    let r: AmbientUserResult;
    try {
      r = await runAmbientNudgeForUser(c, nowMs);
    } catch {
      r = { userId: c.userId, status: "skipped", reason: "user_error" };
    }
    result[r.status] += 1;
    // Aggregate on the non-sensitive TOPIC for sent/failed (a sent decision's
    // reason carries instrument/payment names); skip reasons are already generic.
    const key = r.topic ?? r.reason;
    result.byReason[key] = (result.byReason[key] ?? 0) + 1;
  }
  return result;
}
