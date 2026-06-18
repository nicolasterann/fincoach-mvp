import type { AmbitionMode, FinancialPhilosophy, RiskTolerance } from "@/types/financial";
import type { ChannelKind, Confidence, ModalityKind, PersonalizationSignals, TimeWindow } from "@/lib/financial/personalization-signals";

// Stage 18 — PERSONALIZATION PROFILE. Unifies EXPLICIT preferences (what the user
// set) with INFERRED behavior (signals) into one cautious, explainable profile.
// PURE. Hard rules: explicit ALWAYS overrides inferred; every trait records its
// provenance (explicit | inferred | default); low confidence → conservative
// defaults; NO sensitive-attribute inference; NO creepy labels. This profile only
// shapes FRAMING / detail / surfaces / nudge timing — never the money math.

export type UserMode = "simple" | "guided" | "power" | "expert" | "unknown";
export type DetailLevel = "short" | "balanced" | "detailed";
export type ToneKind = "calm" | "direct" | "motivating" | "analytical" | "gentle" | "playful" | "coach";
export type FinancialOrientation = "stability" | "debt_cleanup" | "lifestyle" | "goal_builder" | "wealth_builder" | "investor" | "unknown";
export type RiskPosture = "cautious" | "balanced" | "growth" | "unknown";
export type NudgeSensitivity = "low" | "normal" | "high";
export type DashboardDensity = "minimal" | "balanced" | "rich";
export type Provenance = "explicit" | "inferred" | "default";

export interface ExplicitPreferences {
  financialPhilosophy?: FinancialPhilosophy | null;
  ambitionMode?: AmbitionMode | null;
  riskTolerance?: RiskTolerance | null;
  communicationTone?: string | null; // from coach_preferences.tone
  detailLevel?: string | null; // from coach_preferences.detail_level
  nudgeSensitivity?: NudgeSensitivity | null;
  dashboardDensity?: DashboardDensity | null;
  preferredCapture?: string | null;
  onboardingMode?: "simple" | "power" | null;
}

export interface LifeContextItem {
  kind: string; // student | freelancer | parent | traveler | salaried | entrepreneur | supporting_family | ...
  label: string;
}

export interface PersonalizationProfile {
  userMode: UserMode;
  detailLevel: DetailLevel;
  tone: ToneKind;
  financialPhilosophy: FinancialPhilosophy;
  financialOrientation: FinancialOrientation;
  riskPosture: RiskPosture;
  usageStyle: ChannelKind;
  preferredCapture: ModalityKind | ChannelKind;
  registrationWindow: TimeWindow;
  weeklyBatch: boolean;
  nudgeSensitivity: NudgeSensitivity;
  dashboardDensity: DashboardDensity;
  lifeContext: LifeContextItem[];
  onboardingCompleteness: number; // 0..1
  confidence: Confidence;
  // Per-trait provenance so Kipu can explain "why" honestly and never over-claim.
  provenance: Record<string, Provenance>;
}

const VALID_TONES: ToneKind[] = ["calm", "direct", "motivating", "analytical", "gentle", "playful", "coach"];
function normTone(t: string | null | undefined): ToneKind | null {
  if (!t) return null;
  const s = t.toLowerCase();
  if (VALID_TONES.includes(s as ToneKind)) return s as ToneKind;
  if (s === "coach_like") return "coach";
  if (s === "clear") return "calm"; // legacy coach_preferences vocab → neutral calm (round-trips set_communication_preference's calm/analytical/gentle)
  if (s === "friendly" || s === "playful") return "playful";
  if (s === "strict") return "direct";
  return null;
}

// Write-side mappers: the rich Stage-18 ToneKind/DetailLevel vocabulary collapsed
// to the values the live `coach_preferences` CHECK accepts (tone in
// clear|coach_like|playful; detail_level in short|medium|detailed). Lossy by
// design (calm/analytical/gentle → clear; direct/motivating/coach → coach_like)
// but it lets explicit tone/detail actually PERSIST instead of failing the CHECK.
// Pure + exported so the gate can verify the round-trip without a DB.
export function toCoachTone(t: string | null | undefined): "clear" | "coach_like" | "playful" | null {
  if (!t) return null;
  const s = t.toLowerCase();
  if (s === "playful") return "playful";
  if (s === "clear" || s === "calm" || s === "analytical" || s === "gentle") return "clear";
  if (s === "coach_like" || s === "direct" || s === "motivating" || s === "coach") return "coach_like";
  return null;
}
export function toCoachDetail(d: string | null | undefined): "short" | "medium" | "detailed" | null {
  if (!d) return null;
  const s = d.toLowerCase();
  if (s === "short") return "short";
  if (s === "detailed") return "detailed";
  if (s === "balanced" || s === "medium") return "medium";
  return null;
}
function normDetail(d: string | null | undefined): DetailLevel | null {
  if (!d) return null;
  const s = d.toLowerCase();
  if (s === "short" || s === "low" || s === "minimal") return "short";
  if (s === "detailed" || s === "high" || s === "full") return "detailed";
  if (s === "balanced" || s === "medium" || s === "normal") return "balanced";
  return null;
}

export function buildPersonalizationProfile(input: {
  explicit: ExplicitPreferences;
  signals: PersonalizationSignals;
  lifeContext: LifeContextItem[];
  // cautious financial facts (NOT sensitive): used only to pick a default orientation.
  hasHighDebtPressure?: boolean;
  hasActiveGoals?: boolean;
  hasInvestments?: boolean;
}): PersonalizationProfile {
  const ex = input.explicit;
  const sig = input.signals;
  const provenance: Record<string, Provenance> = {};

  // ── Financial philosophy (the core lever) — explicit only; never inferred ──
  const financialPhilosophy: FinancialPhilosophy = ex.financialPhilosophy && ex.financialPhilosophy !== "unknown" ? ex.financialPhilosophy : "unknown";
  provenance.financialPhilosophy = financialPhilosophy !== "unknown" ? "explicit" : "default";

  // ── Tone (explicit from coach prefs, else default calm) ──
  const tone = normTone(ex.communicationTone) ?? "calm";
  provenance.tone = normTone(ex.communicationTone) ? "explicit" : "default";

  // ── Detail level (explicit, else balanced) — drives DRILL-DOWN, never default verbosity ──
  const detailLevel = normDetail(ex.detailLevel) ?? "balanced";
  provenance.detailLevel = normDetail(ex.detailLevel) ? "explicit" : "default";

  // ── User mode: explicit onboarding mode wins; else cautiously inferred ──
  let userMode: UserMode;
  if (ex.onboardingMode === "power") { userMode = "power"; provenance.userMode = "explicit"; }
  else if (ex.onboardingMode === "simple") { userMode = "simple"; provenance.userMode = "explicit"; }
  else if (detailLevel === "detailed" || ex.financialPhilosophy === "wealth" || input.hasInvestments) { userMode = "power"; provenance.userMode = (detailLevel === "detailed" || ex.financialPhilosophy === "wealth") ? "explicit" : "inferred"; }
  else if (sig.activityLevel === "heavy" || sig.activityLevel === "regular") { userMode = "guided"; provenance.userMode = "inferred"; }
  else if (sig.activityLevel === "new") { userMode = "unknown"; provenance.userMode = "default"; }
  else { userMode = "simple"; provenance.userMode = "inferred"; }

  // ── Risk posture from explicit risk tolerance ──
  const riskPosture: RiskPosture = ex.riskTolerance === "conservative" ? "cautious" : ex.riskTolerance === "aggressive" ? "growth" : ex.riskTolerance === "moderate" ? "balanced" : "unknown";
  provenance.riskPosture = ex.riskTolerance ? "explicit" : "default";

  // ── Financial orientation (derived from philosophy + cautious facts) ──
  let financialOrientation: FinancialOrientation;
  if (financialPhilosophy === "experiences") financialOrientation = "lifestyle";
  else if (financialPhilosophy === "wealth") financialOrientation = input.hasInvestments ? "investor" : "wealth_builder";
  else if (financialPhilosophy === "builder") financialOrientation = "goal_builder";
  else if (input.hasHighDebtPressure) financialOrientation = "debt_cleanup";
  else if (input.hasActiveGoals) financialOrientation = "goal_builder";
  else financialOrientation = financialPhilosophy === "balanced" ? "lifestyle" : "unknown";
  provenance.financialOrientation = financialPhilosophy !== "unknown" ? "inferred" : input.hasHighDebtPressure || input.hasActiveGoals ? "inferred" : "default";

  // ── Usage style + capture + rhythm (inferred; explicit capture overrides) ──
  const usageStyle = sig.channel.dominant;
  provenance.usageStyle = sig.channel.confidence === "low" ? "default" : "inferred";
  const preferredCapture = ex.preferredCapture ? (ex.preferredCapture as ModalityKind) : sig.modality.dominant !== "unknown" ? sig.modality.dominant : sig.channel.dominant;
  provenance.preferredCapture = ex.preferredCapture ? "explicit" : sig.modality.confidence === "low" ? "default" : "inferred";

  // ── Nudge sensitivity: explicit wins; else cautious from engagement ──
  const nudgeSensitivity: NudgeSensitivity = ex.nudgeSensitivity ?? (sig.nudgeEngagement.signal === "ignoring" ? "high" : "normal");
  provenance.nudgeSensitivity = ex.nudgeSensitivity ? "explicit" : sig.nudgeEngagement.signal === "ignoring" ? "inferred" : "default";

  // ── Dashboard density: explicit wins; else from mode ──
  const dashboardDensity: DashboardDensity = ex.dashboardDensity ?? (userMode === "power" ? "rich" : userMode === "simple" ? "minimal" : "balanced");
  provenance.dashboardDensity = ex.dashboardDensity ? "explicit" : provenance.userMode; // density derives from userMode → inherit its honest provenance (default for new users, not "inferred")

  // ── Onboarding completeness (how many explicit prefs are set) ──
  const explicitSet = [ex.financialPhilosophy && ex.financialPhilosophy !== "unknown", ex.ambitionMode, ex.riskTolerance, normTone(ex.communicationTone), normDetail(ex.detailLevel), ex.nudgeSensitivity, ex.dashboardDensity, ex.onboardingMode, input.lifeContext.length > 0].filter(Boolean).length;
  const onboardingCompleteness = Math.round((explicitSet / 9) * 100) / 100;

  // ── Overall confidence: rises with explicit prefs + signal sample size ──
  const confidence: Confidence = explicitSet >= 3 || sig.confidence === "high" ? "high" : explicitSet >= 1 || sig.confidence === "medium" ? "medium" : "low";

  return {
    userMode,
    detailLevel,
    tone,
    financialPhilosophy,
    financialOrientation,
    riskPosture,
    usageStyle,
    preferredCapture,
    registrationWindow: sig.rhythm.dominantWindow,
    weeklyBatch: sig.rhythm.weeklyBatch || sig.rhythm.weekendBatch,
    nudgeSensitivity,
    dashboardDensity,
    lifeContext: input.lifeContext,
    onboardingCompleteness,
    confidence,
    provenance,
  };
}
