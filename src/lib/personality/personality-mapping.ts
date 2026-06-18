import type { FinancialPhilosophy, AmbitionMode, RiskTolerance } from "@/types/financial";
import type { PersonalityResult } from "@/lib/personality/personality-test";

// Stage 20 (micro-stage C) — maps a personality-test RESULT to Stage 18
// personalization preferences. PURE. The result is applied as EXPLICIT preferences
// (taking the test is an explicit, intentional act) — but a LATER explicit change
// by the user still wins (Stage 18 explicit-overrides + last-write-wins). Only
// CLEAR signals are mapped (threshold-gated) so a weak/incomplete test never
// over-personalizes. Philosophy is the lever that already drives the joy-floor
// ambition in personalization-decisions, so we set it (not a separate ambition).

export interface PersonalizationFromTest {
  financialPhilosophy?: FinancialPhilosophy;
  riskTolerance?: RiskTolerance;
  detailLevel?: "short" | "balanced" | "detailed";
  nudgeSensitivity?: "low" | "normal" | "high";
  onboardingMode?: "simple" | "power";
  tone?: "direct" | "gentle";
  // The philosophy-derived ambition (informational; effectiveAmbition is recomputed
  // from the philosophy in personalization-decisions — we never hard-set ambition here).
  impliedAmbition: AmbitionMode;
}

const PHILOSOPHY_TO_AMBITION: Record<FinancialPhilosophy, AmbitionMode> = {
  experiences: "light_touch",
  balanced: "steady",
  builder: "steady",
  wealth: "power_builder",
  unknown: "steady",
};

// Philosophy (the joy-floor lever) is driven by the experience↔wealth AXIS directly
// — not the display archetype — so a cautious experiences-lover still maps to
// "experiences", and the founder's core lever stays robust.
function philosophyFromAxis(ew: number, presentFuture: number, structureFlex: number): FinancialPhilosophy {
  if (ew <= -30 || (ew <= -15 && presentFuture <= -20)) return "experiences";
  if (ew >= 40) return "wealth";
  if (ew >= 15 && structureFlex >= 10) return "builder";
  if (ew >= 20) return "wealth";
  return "balanced";
}

export function mapTestToPersonalization(result: PersonalityResult): PersonalizationFromTest {
  const d = result.dimensions;
  const philosophy = philosophyFromAxis(d.experienceWealth, d.presentFuture, d.structureFlex);

  const out: PersonalizationFromTest = { financialPhilosophy: philosophy, impliedAmbition: PHILOSOPHY_TO_AMBITION[philosophy] };

  // Risk posture (only on a CLEAR lean; a single mild "con colchón" answer stays moderate).
  if (d.safetyGrowth <= -35) out.riskTolerance = "conservative";
  else if (d.safetyGrowth >= 35) out.riskTolerance = "aggressive";
  else out.riskTolerance = "moderate";

  // Detail / mode (only on a clear lean — otherwise leave the calm default).
  if (d.simpleDetail <= -20) { out.detailLevel = "short"; out.onboardingMode = "simple"; }
  else if (d.simpleDetail >= 20) { out.detailLevel = "detailed"; out.onboardingMode = "power"; }

  // Reminder tolerance: someone who'd quit over constant "don't spend" wants fewer
  // nudges (high sensitivity = only the important ones). Never maps to MORE nudges.
  if (d.structureFlex <= -40) out.nudgeSensitivity = "high";

  // Coaching tone, only on a clear lean.
  if (d.motivation >= 30) out.tone = "direct";
  else if (d.motivation <= -30) out.tone = "gentle";

  return out;
}
