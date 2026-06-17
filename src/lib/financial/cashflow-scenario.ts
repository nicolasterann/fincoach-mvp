import { roundMoney } from "@/lib/financial/money";
import type { CalendarEvent, FinancialCalendar } from "@/lib/financial/financial-calendar";
import { projectCashflow, type CashflowConfidenceInput, type CashflowProjection } from "@/lib/financial/cashflow-projection";

// Stage 15 — the deterministic SCENARIO SIMULATOR. Given the live calendar +
// projection, it answers "what happens if…": buy something now, pay a card
// full/min, add an extra payment, get paid earlier/later, add an expense,
// change a goal contribution, or protect an emergency reserve. It re-projects
// the modified cashflow and returns the change in today's/this week's safe spend,
// runway and end-of-month balance, plus an honest verdict. It never moves money.

export type ScenarioKind =
  | "spend_today" // buy something / pay an amount now (reduces liquid today)
  | "income_earlier"
  | "income_later"
  | "add_monthly_expense"
  | "change_goal_contribution"
  | "protect_reserve";

export interface ScenarioSpec {
  kind: ScenarioKind;
  amount?: number; // spend_today: amount spent now
  days?: number; // income_earlier/later: shift in days
  monthlyAmount?: number; // add_monthly_expense
  weeklyDelta?: number; // change_goal_contribution: +/− per week
  reserveAmount?: number; // protect_reserve: floor to hold
  label?: string;
}

interface Snapshot {
  safeToday: number;
  safeThisWeek: number;
  lowestProjectedBalance: number;
  projectedEndOfMonth: number;
  runwayOk: boolean;
  status: CashflowProjection["status"];
}

export interface ScenarioResult {
  scenario: string;
  base: Snapshot;
  after: Snapshot;
  deltaSafeToday: number;
  deltaSafeThisWeek: number;
  deltaLowest: number;
  deltaEndOfMonth: number;
  verdict: "recommended" | "possible_but_tight" | "not_recommended";
  riskLevel: "ok" | "tight" | "risky";
  assumptions: string[];
  uncertainties: string[];
}

export interface ScenarioBase {
  calendar: FinancialCalendar;
  monthlyEssentialEstimate: number;
  reserveFloor?: number;
  now?: Date;
  confidence: CashflowConfidenceInput;
}

function snap(p: CashflowProjection): Snapshot {
  return {
    safeToday: p.safeToday,
    safeThisWeek: p.safeThisWeek,
    lowestProjectedBalance: p.lowestProjectedBalance,
    projectedEndOfMonth: p.projectedEndOfMonth,
    runwayOk: p.runwayOk,
    status: p.status,
  };
}

function cloneCalendar(cal: FinancialCalendar): FinancialCalendar {
  return { ...cal, events: cal.events.map((e) => ({ ...e })), nextIncome: cal.nextIncome ? { ...cal.nextIncome } : null };
}

export function simulateScenario(base: ScenarioBase, spec: ScenarioSpec): ScenarioResult {
  const baseProj = projectCashflow({ calendar: base.calendar, monthlyEssentialEstimate: base.monthlyEssentialEstimate, reserveFloor: base.reserveFloor, now: base.now, confidence: base.confidence });

  const cal = cloneCalendar(base.calendar);
  let monthlyEssential = base.monthlyEssentialEstimate;
  let reserveFloor = base.reserveFloor ?? 0;
  const assumptions: string[] = [];
  const uncertainties: string[] = [];

  const shiftIncome = (deltaDays: number) => {
    for (const e of cal.events) {
      if (e.type === "income") e.daysFromNow = e.daysFromNow + deltaDays;
    }
    if (cal.nextIncome) uncertainties.push("la fecha exacta del ingreso puede variar");
  };

  switch (spec.kind) {
    case "spend_today": {
      const amt = roundMoney(Math.max(0, spec.amount ?? 0));
      cal.liquidCash = roundMoney(cal.liquidCash - amt);
      break;
    }
    case "income_earlier":
      shiftIncome(-Math.max(1, Math.round(spec.days ?? 0)));
      break;
    case "income_later":
      shiftIncome(Math.max(1, Math.round(spec.days ?? 0)));
      assumptions.push("si el ingreso se atrasa, el margen de los últimos días se aprieta");
      break;
    case "add_monthly_expense": {
      // A new recurring outflow lands ~a week out and recurs; model as a burn.
      monthlyEssential = roundMoney(monthlyEssential + Math.max(0, spec.monthlyAmount ?? 0));
      break;
    }
    case "change_goal_contribution": {
      const weeks = Math.max(1, Math.round(cal.horizonDays / 7));
      const delta = roundMoney((spec.weeklyDelta ?? 0) * weeks); // + = contribute more (outflow)
      if (delta !== 0) {
        const ev: CalendarEvent = {
          id: `scenario:goal:${delta}`,
          date: cal.events[0]?.date ?? new Date().toISOString().slice(0, 10),
          daysFromNow: 1,
          amount: Math.abs(delta),
          signedAmount: -delta, // contributing more reduces free cash
          type: "goal_contribution",
          label: "Ajuste de aporte a meta",
          requirement: "flexible",
          confidence: "medium",
          cashflowAffecting: true,
          isInternalTransfer: true,
          isPaid: false,
          reserves: true,
          origin: "goal",
        };
        cal.events.push(ev);
      }
      break;
    }
    case "protect_reserve":
      reserveFloor = roundMoney(Math.max(reserveFloor, spec.reserveAmount ?? 0));
      break;
  }

  const afterProj = projectCashflow({ calendar: cal, monthlyEssentialEstimate: monthlyEssential, reserveFloor, now: base.now, confidence: base.confidence });

  const base_ = snap(baseProj);
  const after = snap(afterProj);
  const deltaSafeToday = roundMoney(after.safeToday - base_.safeToday);
  const deltaSafeThisWeek = roundMoney(after.safeThisWeek - base_.safeThisWeek);
  const deltaLowest = roundMoney(after.lowestProjectedBalance - base_.lowestProjectedBalance);
  const deltaEndOfMonth = roundMoney(after.projectedEndOfMonth - base_.projectedEndOfMonth);

  let verdict: ScenarioResult["verdict"] = "recommended";
  let riskLevel: ScenarioResult["riskLevel"] = "ok";
  if (after.status === "negative" || !after.runwayOk) {
    verdict = "not_recommended";
    riskLevel = "risky";
  } else if (after.status === "tight" || after.safeThisWeek <= 0) {
    verdict = "possible_but_tight";
    riskLevel = "tight";
  }
  if (baseProj.confidence === "low") uncertainties.push("la proyección base tiene baja confianza; confírmame tu saldo para afinarla");

  return {
    scenario: spec.label ?? spec.kind,
    base: base_,
    after,
    deltaSafeToday,
    deltaSafeThisWeek,
    deltaLowest,
    deltaEndOfMonth,
    verdict,
    riskLevel,
    assumptions: [...assumptions, ...afterProj.assumptions],
    uncertainties: [...new Set([...uncertainties, ...afterProj.missing])],
  };
}
