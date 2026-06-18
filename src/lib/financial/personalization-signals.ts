// Stage 18 — PERSONALIZATION SIGNALS. Derives INFERRED behavior (how/when/where
// the user logs, how they engage with nudges, how often they correct) from raw
// usage data. PURE and CAUTIOUS: every signal carries a confidence and degrades
// to "unknown" on thin data — Kipu never over-personalizes from weak signals and
// NEVER infers sensitive attributes or emotional states. Explicit preferences
// (set by the user) ALWAYS override these inferred signals downstream.

const DAY_MS = 86_400_000;

export type TimeWindow = "morning" | "afternoon" | "night" | "unknown";
export type ChannelKind = "telegram" | "web" | "app" | "mixed" | "unknown";
export type ModalityKind = "text" | "voice" | "photo" | "statement" | "manual" | "mixed" | "unknown";
export type Confidence = "low" | "medium" | "high";

export interface CaptureEvent {
  createdAtMs: number;
  inputChannel?: string | null; // raw transactions.input_channel (app-specific)
}

export interface PersonalizationSignals {
  rhythm: { dominantWindow: TimeWindow; weekendBatch: boolean; weeklyBatch: boolean; medianGapDays: number | null; confidence: Confidence };
  channel: { dominant: ChannelKind; confidence: Confidence };
  modality: { dominant: ModalityKind; confidence: Confidence };
  nudgeEngagement: { sent: number; replied: number; replyRate: number | null; signal: "engaged" | "ignoring" | "unknown" };
  correctionTendency: "low" | "some" | "frequent" | "unknown";
  activityLevel: "new" | "light" | "regular" | "heavy";
  sampleSize: number;
  confidence: Confidence;
}

// Map a raw input_channel string to a coarse channel + modality, cautiously.
// NOTE (Stage 18): production currently writes only "web"/"chat" for input_channel
// (see channelToInputChannel), so the telegram/voice/photo/statement branches are
// FORWARD-LOOKING — they activate when capture modality/channel is tagged at write
// time (a future, migration-gated change that must NOT touch the canonical ledger
// writer / dedupe namespacing). Until then channel resolves to web/unknown and
// modality to text/unknown; the explicit preferredCapture path is the live one.
function classifyChannel(raw: string | null | undefined): { channel: ChannelKind; modality: ModalityKind } {
  const s = (raw ?? "").toLowerCase();
  if (!s) return { channel: "unknown", modality: "unknown" };
  const channel: ChannelKind = /telegram|tg\b/.test(s) ? "telegram" : /web|browser/.test(s) ? "web" : /app|pwa|mobile/.test(s) ? "app" : "unknown";
  const modality: ModalityKind =
    /voice|audio/.test(s) ? "voice" : /image|photo|picture|receipt/.test(s) ? "photo" : /statement|pdf|import/.test(s) ? "statement" : /manual|form/.test(s) ? "manual" : /text|chat|message/.test(s) ? "text" : "unknown";
  return { channel, modality };
}

function dominant<T extends string>(counts: Map<T, number>, total: number, threshold = 0.55): { value: T | "mixed" | "unknown"; confidence: Confidence } {
  if (total === 0) return { value: "unknown", confidence: "low" };
  let topKey: T | null = null;
  let topN = 0;
  for (const [k, n] of counts) if (n > topN) { topN = n; topKey = k; }
  if (!topKey) return { value: "unknown", confidence: "low" };
  const share = topN / total;
  const confidence: Confidence = total >= 12 && share >= 0.7 ? "high" : total >= 5 && share >= threshold ? "medium" : "low";
  return { value: share >= threshold ? topKey : "mixed", confidence };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

export function derivePersonalizationSignals(input: {
  captureEvents: CaptureEvent[];
  nudgeEngagement?: { sent: number; replied: number };
  correctionCount?: number; // e.g. learned merchant corrections
  nowMs: number;
}): PersonalizationSignals {
  const events = input.captureEvents.filter((e) => Number.isFinite(e.createdAtMs)).sort((a, b) => a.createdAtMs - b.createdAtMs);
  const sampleSize = events.length;

  // ── Rhythm: time-of-day window (UTC buckets — coarse, not a precise clock) ──
  const windowCounts = new Map<TimeWindow, number>();
  let weekend = 0;
  for (const e of events) {
    const d = new Date(e.createdAtMs);
    const h = d.getUTCHours();
    const w: TimeWindow = h >= 5 && h < 12 ? "morning" : h >= 12 && h < 19 ? "afternoon" : "night";
    windowCounts.set(w, (windowCounts.get(w) ?? 0) + 1);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) weekend += 1;
  }
  const win = dominant(windowCounts, sampleSize);
  const gaps: number[] = [];
  for (let i = 1; i < events.length; i++) gaps.push((events[i].createdAtMs - events[i - 1].createdAtMs) / DAY_MS);
  const medGap = median(gaps);
  const weekendBatch = sampleSize >= 5 && weekend / sampleSize >= 0.6;
  const weeklyBatch = medGap != null && medGap >= 5 && medGap <= 9;

  // ── Channel + modality ──────────────────────────────────────────────────
  const channelCounts = new Map<ChannelKind, number>();
  const modalityCounts = new Map<ModalityKind, number>();
  let channelKnown = 0;
  let modalityKnown = 0;
  for (const e of events) {
    const { channel, modality } = classifyChannel(e.inputChannel);
    if (channel !== "unknown") { channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1); channelKnown += 1; }
    if (modality !== "unknown") { modalityCounts.set(modality, (modalityCounts.get(modality) ?? 0) + 1); modalityKnown += 1; }
  }
  const ch = dominant(channelCounts, channelKnown);
  const mod = dominant(modalityCounts, modalityKnown);

  // ── Nudge engagement (cautious; weak signal) ────────────────────────────
  const sent = input.nudgeEngagement?.sent ?? 0;
  const replied = input.nudgeEngagement?.replied ?? 0;
  const replyRate = sent > 0 ? replied / sent : null;
  const nudgeSignal: "engaged" | "ignoring" | "unknown" = sent < 4 ? "unknown" : replyRate != null && replyRate >= 0.4 ? "engaged" : replyRate != null && replyRate <= 0.1 ? "ignoring" : "unknown";

  // ── Correction tendency (proxy: learned corrections) ────────────────────
  const corr = input.correctionCount ?? 0;
  const correctionTendency = sampleSize < 5 ? "unknown" : corr >= 5 ? "frequent" : corr >= 1 ? "some" : "low";

  // ── Activity level (last 30d cadence) ───────────────────────────────────
  const recent = events.filter((e) => e.createdAtMs >= input.nowMs - 30 * DAY_MS).length;
  const activityLevel: PersonalizationSignals["activityLevel"] = sampleSize === 0 ? "new" : recent >= 30 ? "heavy" : recent >= 8 ? "regular" : "light";

  const confidence: Confidence = sampleSize >= 15 ? "high" : sampleSize >= 6 ? "medium" : "low";

  return {
    rhythm: { dominantWindow: (win.value === "mixed" ? "unknown" : win.value) as TimeWindow, weekendBatch, weeklyBatch, medianGapDays: medGap != null ? Math.round(medGap * 10) / 10 : null, confidence: win.confidence },
    channel: { dominant: ch.value as ChannelKind, confidence: ch.confidence },
    modality: { dominant: mod.value as ModalityKind, confidence: mod.confidence },
    nudgeEngagement: { sent, replied, replyRate: replyRate != null ? Math.round(replyRate * 100) / 100 : null, signal: nudgeSignal },
    correctionTendency,
    activityLevel,
    sampleSize,
    confidence,
  };
}
