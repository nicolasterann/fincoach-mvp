import type { AmbitionMode, FinancialPhilosophy } from "@/types/financial";
import type { DashboardDensity, DetailLevel, NudgeSensitivity, PersonalizationProfile, ToneKind } from "@/lib/financial/personalization-profile";

// Stage 18 — PERSONALIZATION DECISIONS. Turns the profile into SAFE, concrete
// adaptations for tone / detail / dashboard surfaces / nudge timing / allocation
// posture. PURE. Iron rules encoded here: (1) defaultBrevity is ALWAYS true — no
// personalization makes routine confirmations longer; (2) detail is available on
// request / in dashboards, never forced; (3) the financial-philosophy lever only
// changes the allocation POSTURE (joy floor via ambition) + FRAMING, never the
// money math, obligations, minimums or cashflow truth.

export interface PersonalizationDecisions {
  responseStyle: {
    tone: ToneKind;
    detail: DetailLevel;
    defaultBrevity: true; // invariant — routine actions stay short regardless of mode
  };
  framing: FinancialPhilosophy; // how to FRAME advice (experiences vs wealth …)
  // The philosophy-derived ambition the allocation should use WHEN the user has
  // not set an explicit ambition_mode. Shapes the joy floor only.
  effectiveAmbition: AmbitionMode;
  promotedSurfaces: string[]; // dashboard cards to surface first
  collapsedSurfaces: string[]; // advanced cards to collapse by default
  nudge: {
    sensitivity: NudgeSensitivity;
    suppressBelowPriority: number; // ambient: skip candidates below this priority
    preferWindow: PersonalizationProfile["registrationWindow"];
  };
  captureSuggestion: string | null; // easiest capture method to surface in empty states
  onboardingMode: "simple" | "power";
  dashboardDensity: DashboardDensity;
  notes: string; // compact structured fact for the agent digest (never shown raw)
}

function philosophyToAmbition(p: FinancialPhilosophy): AmbitionMode {
  switch (p) {
    case "experiences":
      return "light_touch";
    case "wealth":
      return "power_builder";
    case "builder":
      return "steady";
    case "balanced":
      return "steady";
    default:
      return "steady";
  }
}

// High nudge sensitivity → only the genuinely important nudges get through.
// "normal" must equal Stage 13 behavior (NO floor): a default-population user who
// never asked for fewer nudges must not silently lose gentle re-engagement nudges.
// Only an EXPLICIT "high" applies the full 50 floor; an INFERRED "high" (from an
// "ignoring" engagement signal) is capped at 25 so it trims chatter without ever
// approaching protected obligation priorities. Protection topics are additionally
// never gated (see PERSONALIZATION_PROTECTED_TOPICS in ambient-decision.ts).
function suppressThreshold(s: NudgeSensitivity, inferred: boolean): number {
  if (s !== "high") return 0;
  return inferred ? 25 : 50;
}

export function derivePersonalizationDecisions(profile: PersonalizationProfile, explicitAmbition?: AmbitionMode | null): PersonalizationDecisions {
  const framing = profile.financialPhilosophy;
  const effectiveAmbition = explicitAmbition ?? philosophyToAmbition(framing);

  // Promoted/collapsed surfaces by orientation + density. Minimal, never clutter.
  const promoted: string[] = [];
  const collapsed: string[] = [];
  switch (profile.financialOrientation) {
    case "lifestyle":
      promoted.push("joy_budget", "mini_goals");
      collapsed.push("net_worth", "investments");
      break;
    case "wealth_builder":
    case "investor":
      promoted.push("net_worth", "goals", "investments");
      break;
    case "goal_builder":
      promoted.push("goals", "mini_goals");
      break;
    case "debt_cleanup":
      promoted.push("debt", "safe_spend");
      collapsed.push("investments", "net_worth");
      break;
    case "stability":
      promoted.push("safe_spend");
      collapsed.push("investments", "net_worth");
      break;
    default:
      promoted.push("safe_spend");
  }
  if (profile.dashboardDensity === "minimal") collapsed.push("assumptions", "category_detail");
  if (profile.dashboardDensity === "rich" && !promoted.includes("category_detail")) promoted.push("category_detail");

  // Capture suggestion for empty states (from usage / preference).
  const cap = profile.preferredCapture;
  const captureSuggestion =
    cap === "statement" ? "subir tu estado de cuenta" : cap === "voice" ? "mandar un audio" : cap === "photo" ? "mandar una foto del recibo" : cap === "telegram" ? "escribirle por Telegram" : null;

  const notes = [
    `filosofía=${framing}`,
    `orientación=${profile.financialOrientation}`,
    `tono=${profile.tone}`,
    `detalle=${profile.detailLevel}`,
    `modo=${profile.userMode}`,
    profile.nudgeSensitivity !== "normal" ? `nudges=${profile.nudgeSensitivity}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return {
    responseStyle: { tone: profile.tone, detail: profile.detailLevel, defaultBrevity: true },
    framing,
    effectiveAmbition,
    promotedSurfaces: [...new Set(promoted)],
    collapsedSurfaces: [...new Set(collapsed)],
    nudge: {
      sensitivity: profile.nudgeSensitivity,
      suppressBelowPriority: suppressThreshold(profile.nudgeSensitivity, profile.provenance.nudgeSensitivity !== "explicit"),
      // DEFERRED: preferred logging window. Computed (honest inferred data) but NOT
      // yet consumed — the once-daily 14:00-UTC cron has no window to honor. Wire
      // into decideAmbientNudge only when cron cadence becomes sub-daily.
      preferWindow: profile.registrationWindow,
    },
    captureSuggestion,
    onboardingMode: profile.userMode === "power" || profile.userMode === "expert" ? "power" : "simple",
    dashboardDensity: profile.dashboardDensity,
    notes,
  };
}
