// Stage 20 PASS 2 (Micro-stage B) — DASHBOARD VIEW-MODEL. PURE + deterministic +
// gate-tested. Turns the live briefing signals + the Stage-18 personalization
// decisions into ONE ordered, personalization-aware list of dashboard surfaces:
// which cards show, which are promoted, which are de-emphasized (collapsed) — and,
// IRON RULE, obligations are NEVER collapsed or hidden. "Collapsed" means lower in
// the visual hierarchy / behind a calm "ver más", never removed: financial truth is
// always reachable. Genius inside (personalization), simple outside (fewer cards
// for simple users, the right things first). No money math here — only presentation.

export type SurfaceKey =
  | "pulso"
  | "margen"
  | "cashflow"
  | "debt"
  | "spending"
  | "goals"
  | "wealth"
  | "household"
  | "personality"
  | "fx";

// The narrowed signals the model needs (kept tiny so the builder is pure + testable
// without the whole CoachingBriefing).
export interface DashboardSignals {
  marginStatus: "healthy" | "tight" | "negative";
  cardsDueSoonCount: number;
  hasOverdueOrDueToday: boolean;
  debtPressureHigh: boolean; // pressureLevel high|critical
  runwayOk: boolean;
  cashflowConfidence: "high" | "medium" | "low";
  hasDebt: boolean;
  hasGoals: boolean;
  hasWealth: boolean;
  hasHousehold: boolean;
  hasSpendingData: boolean;
  hasFx: boolean;
  hasPersonalityTest: boolean;
}

export interface PersonalizationView {
  promotedSurfaces: string[];
  collapsedSurfaces: string[];
  dashboardDensity: "minimal" | "balanced" | "rich";
  densityExplicit: boolean; // provenance.dashboardDensity === 'explicit'
}

export interface DashboardSurface {
  key: SurfaceKey;
  present: boolean;
  obligation: boolean; // active obligation → pinned, NEVER collapsed
  promoted: boolean;
  collapsed: boolean; // de-emphasized (still rendered + reachable), never for obligations
  rank: number; // lower = higher on the page
  reason: string; // transparency: why this surface is where it is
}

export interface DashboardModel {
  surfaces: DashboardSurface[]; // ordered (visible first), obligations always on top
  density: "minimal" | "balanced" | "rich";
  obligationsCount: number;
}

// Base ordering (lower = higher). Obligation upgrades override these into a top band.
const BASE_RANK: Record<SurfaceKey, number> = {
  pulso: 5,
  margen: 8,
  cashflow: 30,
  debt: 35,
  goals: 25,
  spending: 42,
  wealth: 55,
  household: 28,
  fx: 60,
  personality: 85,
};

// Which Stage-18 personalization surface names map onto each dashboard surface, so
// promotedSurfaces / collapsedSurfaces (orientation-derived) drive emphasis here.
const PERSONALIZATION_NAMES: Record<SurfaceKey, string[]> = {
  pulso: [],
  margen: ["safe_spend"],
  cashflow: ["safe_spend", "assumptions"],
  debt: ["debt"],
  goals: ["goals", "mini_goals", "joy_budget"],
  spending: ["category_detail", "advanced_analytics"],
  wealth: ["net_worth", "investments"],
  household: [],
  fx: [],
  personality: [],
};

// Optional analytics surfaces that an EXPLICIT 'minimal' density may de-emphasize.
// Pulso/Margen/Cashflow/Goals/Debt/Household are never collapsed by density alone.
const MINIMAL_DENSITY_COLLAPSIBLE = new Set<SurfaceKey>(["spending", "wealth", "fx", "personality"]);

function isPresent(key: SurfaceKey, s: DashboardSignals, obligation: boolean): boolean {
  switch (key) {
    case "pulso":
    case "margen":
    case "cashflow":
      return true; // always the calm core
    case "debt":
      return s.hasDebt || obligation;
    case "goals":
      return s.hasGoals;
    case "spending":
      return s.hasSpendingData;
    case "wealth":
      return s.hasWealth;
    case "household":
      return s.hasHousehold;
    case "fx":
      return s.hasFx;
    case "personality":
      return true; // always present — either as a gentle offer or an "adapted to you" state
  }
}

function isObligation(key: SurfaceKey, s: DashboardSignals): boolean {
  switch (key) {
    case "debt":
      return s.hasOverdueOrDueToday || s.cardsDueSoonCount > 0 || s.debtPressureHigh;
    case "margen":
      return s.marginStatus === "negative";
    case "cashflow":
      return !s.runwayOk && s.cashflowConfidence !== "low";
    default:
      return false;
  }
}

export function buildDashboardModel(input: {
  signals: DashboardSignals;
  personalization: PersonalizationView;
}): DashboardModel {
  const s = input.signals;
  const p = input.personalization;
  const keys: SurfaceKey[] = ["pulso", "margen", "cashflow", "debt", "goals", "spending", "wealth", "household", "fx", "personality"];

  const surfaces: DashboardSurface[] = keys.map((key) => {
    const obligation = isObligation(key, s);
    const present = isPresent(key, s, obligation);
    const names = PERSONALIZATION_NAMES[key];
    const promoted = names.some((n) => p.promotedSurfaces.includes(n));
    const collapsedByPref = names.some((n) => p.collapsedSurfaces.includes(n));
    const collapsedByDensity = p.dashboardDensity === "minimal" && p.densityExplicit && MINIMAL_DENSITY_COLLAPSIBLE.has(key);

    // IRON RULE: an active obligation is never collapsed, whatever personalization says.
    const collapsed = obligation ? false : collapsedByPref || collapsedByDensity;

    let rank = BASE_RANK[key];
    let reason = "default";
    if (obligation) {
      rank = key === "margen" ? 1 : key === "cashflow" ? 2 : 3; // top band, ahead of everything optional
      reason = "obligation_pinned";
    } else if (promoted) {
      rank -= 18;
      reason = "promoted";
    }
    if (collapsed) {
      rank += 50; // pushed down, still rendered + reachable
      reason = collapsedByPref ? "collapsed_by_preference" : "collapsed_minimal_density";
    }

    return { key, present, obligation, promoted, collapsed, rank, reason };
  });

  // Stable sort by rank, then by base rank for deterministic ties.
  surfaces.sort((a, b) => a.rank - b.rank || BASE_RANK[a.key] - BASE_RANK[b.key]);

  return {
    surfaces,
    density: p.dashboardDensity,
    obligationsCount: surfaces.filter((x) => x.present && x.obligation).length,
  };
}

// Convenience: ordered surfaces that should actually render (present), with the
// visible (non-collapsed) ones first, collapsed ones after — but obligations always
// lead. Callers can render the visible block, then a calm "ver más" block.
export function visibleSurfaces(model: DashboardModel): DashboardSurface[] {
  return model.surfaces.filter((x) => x.present);
}
