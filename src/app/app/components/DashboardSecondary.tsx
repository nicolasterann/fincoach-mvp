import type { CurrencyCode } from "@/types/financial";
import type { FxRate } from "@/lib/fx/fx-rates";
import type { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildDashboardModel, type DashboardSignals, type SurfaceKey } from "@/lib/dashboard/dashboard-model";
import {
  SpendingPressureCard,
  HouseholdCard,
  WealthCard,
  KipuFitCard,
  FxCard,
  CashflowTimelineCard,
} from "./DashboardCards";
import { translateTransactionCategory } from "./app-dashboard-helpers";

type Briefing = Awaited<ReturnType<typeof buildCoachingBriefing>>;

// Stage 20 PASS 2 (Micro-stage B) — the personalization-aware secondary surface
// region of the dashboard. It consumes the SAME briefing the core uses, builds the
// view-model (which orders + collapses surfaces, NEVER hiding obligations), and
// renders the present secondary cards in that order. Collapsed (de-emphasized)
// cards still render — tucked into a calm "Ver más" — so the financial truth is
// always reachable. The proven core (Margen hero, Pulso, metrics) is untouched.

const DAY = 86_400_000;

function daysFromNowISO(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((t - nowMs) / DAY);
}

function buildTimelineEvents(b: Briefing, nowMs: number): { daysFromNow: number; kind: string; label: string; risk?: boolean }[] {
  const out: { daysFromNow: number; kind: string; label: string; risk?: boolean }[] = [];
  const inc = b.cashflow.nextIncome;
  if (inc) {
    const d = daysFromNowISO(inc.dateISO, nowMs);
    if (d !== null && d >= 0) out.push({ daysFromNow: d, kind: "income", label: "Ingreso" });
  }
  for (const c of b.cardsDueSoon) {
    if (c.inDays >= 0) out.push({ daysFromNow: c.inDays, kind: "card", label: c.name });
  }
  for (const p of b.upcomingPayments) {
    const d = daysFromNowISO(p.dueDate, nowMs);
    if (d !== null && d >= 0) out.push({ daysFromNow: d, kind: "scheduled", label: p.name });
  }
  for (const w of b.cashflow.riskWindows) {
    const d = daysFromNowISO(w.dateISO, nowMs);
    if (d !== null && d >= 0) out.push({ daysFromNow: d, kind: "debt", label: w.label, risk: true });
  }
  return out;
}

function deriveSignals(b: Briefing, hasFx: boolean, hasPersonalityTest: boolean): DashboardSignals {
  const dh = b.debtHealth;
  const overdueOrToday = dh.cards.some((c) => c.states.includes("overdue") || c.states.includes("due_today"));
  return {
    marginStatus: b.margenKipu.status,
    cardsDueSoonCount: b.cardsDueSoon.length,
    hasOverdueOrDueToday: overdueOrToday,
    debtPressureHigh: dh.pressureLevel === "high" || dh.pressureLevel === "critical",
    runwayOk: b.cashflow.runwayOk,
    cashflowConfidence: b.cashflow.confidence as "high" | "medium" | "low",
    hasDebt: dh.hasAnyDebt,
    hasGoals: (b.goalsIntel.portfolio.activeCount ?? 0) > 0 || Boolean(b.goalsIntel.portfolio.primary),
    hasWealth: Boolean(b.goalsIntel.netWorth && b.goalsIntel.netWorth.totalNetWorth > 0),
    hasHousehold: b.household.hasHousehold,
    hasSpendingData: b.spendingIntel.baselines.categories.length > 0,
    hasFx,
    hasPersonalityTest,
  };
}

export function DashboardSecondary({
  briefing,
  baseCurrency,
  nowMs,
  netWorthSeries,
  personality,
  fx,
  displayCurrency,
  rates = [],
}: {
  briefing: Briefing;
  baseCurrency: CurrencyCode;
  nowMs: number;
  netWorthSeries: number[];
  personality: { taken: boolean; archetypeLabel: string | null };
  fx: { base: string; lines: { code: string; rateToBase: number | null; source: string | null }[] } | null;
  displayCurrency?: CurrencyCode;
  rates?: FxRate[];
}) {
  const b = briefing;
  const model = buildDashboardModel({
    signals: deriveSignals(b, Boolean(fx && fx.lines.length > 0), personality.taken),
    personalization: {
      promotedSurfaces: b.personalization.decisions.promotedSurfaces ?? [],
      collapsedSurfaces: b.personalization.decisions.collapsedSurfaces ?? [],
      dashboardDensity: b.personalization.decisions.dashboardDensity,
      densityExplicit: b.personalization.profile.provenance?.dashboardDensity === "explicit",
    },
  });

  // Only the SECONDARY keys render here; the core (pulso/margen/debt/goals) lives in
  // the page layout + metric grid. Keep model order, split visible vs collapsed.
  const SECONDARY = new Set<SurfaceKey>(["cashflow", "spending", "household", "wealth", "fx", "personality"]);
  const secondary = model.surfaces.filter((sfc) => sfc.present && SECONDARY.has(sfc.key));

  const renderCard = (key: SurfaceKey) => {
    switch (key) {
      case "cashflow": {
        const inc = b.cashflow.nextIncome;
        const incD = inc ? daysFromNowISO(inc.dateISO, nowMs) : null;
        const nextIncomeLabel = inc && incD !== null ? (incD === 0 ? "hoy" : `en ${incD} día${incD === 1 ? "" : "s"}`) : null;
        return (
          <CashflowTimelineCard
            key={key}
            events={buildTimelineEvents(b, nowMs)}
            horizonDays={b.cashflow.horizonDays}
            safeThisWeek={b.margenKipu.margenWeekly}
            nextIncomeLabel={nextIncomeLabel}
            baseCurrency={baseCurrency}
            displayCurrency={displayCurrency}
            rates={rates}
          />
        );
      }
      case "spending": {
        const cats = [...b.spendingIntel.baselines.categories]
          .sort((a, c) => c.weeklyAvg - a.weeklyAvg)
          .slice(0, 5)
          .map((c) => ({ label: translateTransactionCategory(c.parentCategory), value: c.weeklyAvg }));
        const over = b.spendingIntel.budget.overCategories[0];
        const headline = over
          ? `${translateTransactionCategory(over.parentCategory)} va ~${Math.round(over.pctVsNormal * 100)}% sobre tu normal.`
          : b.spendingIntel.insights.theOneThing?.title ?? null;
        return <SpendingPressureCard key={key} bars={cats} headline={headline} />;
      }
      case "household": {
        const h = b.household.households[0];
        if (!h) return null;
        return (
          <HouseholdCard
            key={key}
            name={h.name}
            nextAction={h.nextAction}
            toPay={h.myToPay}
            toCollect={h.myToCollect}
            pendingReimbursements={h.pendingReimbursements}
            sharedGoal={h.sharedGoals[0] ? { name: h.sharedGoals[0].name, progressPct: h.sharedGoals[0].progressPct } : null}
            baseCurrency={baseCurrency}
            displayCurrency={displayCurrency}
            rates={rates}
          />
        );
      }
      case "wealth": {
        const nw = b.goalsIntel.netWorth;
        if (!nw) return null;
        const invested = b.goalsIntel.investment?.totalValue ?? 0;
        return (
          <WealthCard
            key={key}
            netWorth={nw.totalNetWorth}
            liquid={Math.max(0, nw.liquidNetWorth)}
            invested={invested}
            wealthTarget={nw.wealthTarget}
            wealthProgressPct={nw.wealthProgressPct ?? 0}
            series={netWorthSeries}
            baseCurrency={baseCurrency}
            displayCurrency={displayCurrency}
            rates={rates}
          />
        );
      }
      case "fx":
        return fx ? <FxCard key={key} base={fx.base} lines={fx.lines} /> : null;
      case "personality":
        return <KipuFitCard key={key} taken={personality.taken} archetypeLabel={personality.archetypeLabel} />;
      default:
        return null;
    }
  };

  const visible = secondary.filter((s) => !s.collapsed);
  const collapsed = secondary.filter((s) => s.collapsed);
  if (visible.length === 0 && collapsed.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      {visible.map((s) => renderCard(s.key))}
      {collapsed.length > 0 && (
        <details className="group rounded-3xl border border-white/5 bg-zinc-950/40">
          <summary className="cursor-pointer list-none px-5 py-3 text-xs font-semibold uppercase tracking-widest text-zinc-500 transition hover:text-zinc-300">
            Ver más ({collapsed.length})
          </summary>
          <div className="flex flex-col gap-4 px-1 pb-1">{collapsed.map((s) => renderCard(s.key))}</div>
        </details>
      )}
    </section>
  );
}
