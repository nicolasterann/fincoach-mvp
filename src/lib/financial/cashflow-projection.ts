import { roundMoney } from "@/lib/financial/money";
import type { CalendarEvent, EventConfidence, FinancialCalendar } from "@/lib/financial/financial-calendar";

// Stage 15 — the CASHFLOW PROJECTION engine. Deterministic and forward-looking.
// It walks the financial calendar day by day from the current liquid cash,
// applying expected income (+), required/flexible outflows (−) on their real
// dates, and a continuous essential burn, to find: the day-by-day balance curve,
// the LOWEST projected balance (the runway trough), risk windows, and — the
// heart of Stage 15 — a TIMING-AWARE safe daily/weekly spend that respects WHEN
// money leaves, not just how much. Every number carries a confidence and the
// assumptions behind it. It never moves money and never hides uncertainty.

const DAY_MS = 86_400_000;

export interface CashflowConfidenceInput {
  hasIncomeSource: boolean;
  incomeDateKnown: boolean;
  balanceStale: boolean; // no recent reconcile / balance confirmation
  hasFixedExpenses: boolean;
  recentActivity: boolean; // logged something recently
  foreignUnconverted: boolean; // a non-base account without trusted FX
  // false when the everyday essential burn is UNKNOWN (no configured estimate and
  // too little spend history), so the projection does NOT discount daily spend and
  // the safe-spend reads over-optimistically. Optional for backward compatibility;
  // defaults to "known" so existing callers/tests are unchanged. When false the
  // projection can never be "high" confidence and says so in `missing`.
  essentialBurnKnown?: boolean;
}

export interface CashflowProjectionInput {
  calendar: FinancialCalendar;
  monthlyEssentialEstimate: number; // continuous non-discretionary burn (food, transport…)
  reserveFloor?: number; // emergency cushion to never dip below (default 0)
  now?: Date;
  confidence: CashflowConfidenceInput;
  // Stage 32 — remaining-based TWO-PHASE essential burn (budget-category users).
  // When both are present (daysLeftInMonth ≥ 1): the horizon days still inside
  // the CURRENT calendar month burn remainingEssentialThisMonth/daysLeftInMonth
  // per day (only what actually REMAINS of the month's budgets — money already
  // spent/seeded is never re-reserved on top of the lower balance), and horizon
  // days in the NEXT month burn the full monthlyEssentialEstimate/30 rate.
  // Absent ⇒ the flat legacy burn (lump-estimate users keep today's behavior).
  remainingEssentialThisMonth?: number;
  daysLeftInMonth?: number;
}

export interface RiskWindow {
  dateISO: string;
  balance: number;
  label: string; // the driving outflow, human
}

export interface CashflowProjection {
  liquidCash: number;
  reserveFloor: number;
  horizonDays: number;
  daysRemainingInWeek: number;
  dailyEssential: number;
  nextIncome: { dateISO: string; amount: number; confidence: EventConfidence } | null;

  // The heart: timing-aware safe spend (discretionary, on top of essentials).
  safeToday: number;
  safeThisWeek: number;
  safeUntilIncome: number;

  // Stage 32 — the essential burn actually reserved across the whole horizon:
  // flat mode = dailyEssential × (horizonDays+1); two-phase mode = the current
  // month's remaining + the next month's full-rate days. Margen's breakdown
  // reads THIS so the expandable math always matches the projection it walked.
  essentialBurnTotal: number;
  // true when the two-phase remaining-based burn was applied (budget users).
  remainingBasedEssentials: boolean;

  lowestProjectedBalance: number;
  lowestDateISO: string | null;
  projectedEndOfWeek: number;
  projectedEndOfMonth: number;
  projectedAtHorizonEnd: number;
  runwayOk: boolean; // makes it to the next income without dipping below the floor

  totalExpectedIncome: number;
  totalReservedOutflows: number;
  riskWindows: RiskWindow[];

  status: "healthy" | "tight" | "negative";
  confidence: EventConfidence;
  assumptions: string[];
  missing: string[];
  curve: { dateISO: string; balance: number }[];
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function deriveConfidence(c: CashflowConfidenceInput): { level: EventConfidence; assumptions: string[]; missing: string[] } {
  const missing: string[] = [];
  const assumptions: string[] = [];
  const essentialBurnKnown = c.essentialBurnKnown !== false; // default known (back-compat)
  if (!c.hasIncomeSource) missing.push("no tengo un ingreso registrado, así que proyecto hasta fin de mes en vez de hasta tu próximo sueldo");
  else if (!c.incomeDateKnown) missing.push("tu ingreso es irregular, no sé la fecha exacta del próximo");
  if (c.balanceStale) missing.push("hace un rato no confirmamos tu saldo");
  if (!c.hasFixedExpenses) assumptions.push("asumo que no tienes gastos fijos más allá de lo registrado");
  if (c.foreignUnconverted) missing.push("tienes saldo en otra moneda sin tipo de cambio confiable");
  if (!c.recentActivity) assumptions.push("hace unos días no registras movimientos, el saldo podría haber cambiado");
  // The everyday burn is unknown → the projection did NOT subtract any daily spend,
  // so what's "safe" looks higher than it really is. Flag it honestly; never fake a burn.
  if (!essentialBurnKnown) missing.push("aún no sé cuánto gastas al día — esto no descuenta tu gasto diario");

  let level: EventConfidence = "high";
  const hardUnknowns = (!c.hasIncomeSource ? 1 : 0) + (c.balanceStale ? 1 : 0) + (c.foreignUnconverted ? 1 : 0);
  if (hardUnknowns >= 2 || !c.hasIncomeSource) level = "low";
  else if (hardUnknowns === 1 || !c.incomeDateKnown || !c.hasFixedExpenses || !c.recentActivity || !essentialBurnKnown) level = "medium";
  return { level, assumptions, missing };
}

export function projectCashflow(input: CashflowProjectionInput): CashflowProjection {
  const now = input.now ?? new Date();
  const today = startOfDay(now);
  const cal = input.calendar;
  const horizonDays = cal.horizonDays;
  const floor = roundMoney(Math.max(0, input.reserveFloor ?? 0));
  // `dailyEssential` stays the month-agnostic FULL rate (estimate/30): it is the
  // sustainable reference (status thresholds, next-month burn). The two-phase
  // mode only changes how the CURRENT month's days burn.
  const dailyEssential = roundMoney(Math.max(0, input.monthlyEssentialEstimate) / 30);
  const monthDaysLeft = input.daysLeftInMonth ?? 0;
  const remainingBasedEssentials = input.remainingEssentialThisMonth != null && monthDaysLeft >= 1;
  const currentMonthDaily = remainingBasedEssentials
    ? Math.max(0, input.remainingEssentialThisMonth ?? 0) / monthDaysLeft
    : dailyEssential;
  // Cumulative essential burn through day offset d (piecewise closed form — no
  // per-day accumulation drift). Day offsets 0..monthDaysLeft-1 are the current
  // calendar month (daysLeftInMonth counts today inclusive); later days burn
  // the full monthly rate.
  const essentialThrough = (d: number): number => {
    const days = d + 1;
    if (!remainingBasedEssentials) return dailyEssential * days;
    const inMonth = Math.min(days, monthDaysLeft);
    return currentMonthDaily * inMonth + dailyEssential * Math.max(0, days - monthDaysLeft);
  };

  // Net signed cashflow applied on each day offset (income +, reserved outflow −).
  const cashEvents = cal.events.filter((e): e is CalendarEvent => e.cashflowAffecting);
  const netByDay = new Map<number, number>();
  let totalIncome = 0;
  let totalOutflow = 0;
  for (const e of cashEvents) {
    // Only events inside the horizon move the projected balance; an income that
    // slips past the horizon (e.g. a delayed paycheck) must NOT be counted.
    if (e.daysFromNow < 0 || e.daysFromNow > horizonDays) continue;
    netByDay.set(e.daysFromNow, (netByDay.get(e.daysFromNow) ?? 0) + e.signedAmount);
    if (e.signedAmount > 0) totalIncome += e.signedAmount;
    else totalOutflow += -e.signedAmount;
  }

  // Day-by-day balance BEFORE any discretionary spend.
  const curve: { dateISO: string; balance: number }[] = [];
  let running = cal.liquidCash;
  let lowest = Infinity;
  let lowestDay = 0;
  for (let d = 0; d <= horizonDays; d++) {
    running += netByDay.get(d) ?? 0;
    const balanceAfterEssentials = roundMoney(running - essentialThrough(d));
    const dateISO = isoOf(new Date(today.getTime() + d * DAY_MS));
    curve.push({ dateISO, balance: balanceAfterEssentials });
    if (balanceAfterEssentials < lowest) {
      lowest = balanceAfterEssentials;
      lowestDay = d;
    }
  }

  // Timing-aware safe DAILY discretionary: the max constant D such that on every
  // day the balance stays at/above the floor → D = min_d (balance[d] − floor)/(d+1).
  let safeDaily = Infinity;
  for (let d = 0; d <= horizonDays; d++) {
    const headroom = (curve[d].balance - floor) / (d + 1);
    if (headroom < safeDaily) safeDaily = headroom;
  }
  const safeToday = roundMoney(Math.max(0, safeDaily));

  const dow = now.getDay();
  const daysRemainingInWeek = ((7 - dow) % 7) + 1; // today → Sunday inclusive
  const weekSlice = Math.min(daysRemainingInWeek, horizonDays + 1);
  const safeThisWeek = roundMoney(safeToday * weekSlice);
  const safeUntilIncome = roundMoney(safeToday * (horizonDays + 1));

  // End-of-week / end-of-month / horizon projected balances (nearest curve point).
  const endOfWeekDay = Math.min(horizonDays, daysRemainingInWeek - 1);
  const endOfMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const endOfMonthDay = Math.min(horizonDays, Math.max(0, Math.round((startOfDay(endOfMonthDate).getTime() - today.getTime()) / DAY_MS)));
  const projectedEndOfWeek = curve[endOfWeekDay]?.balance ?? curve[curve.length - 1].balance;
  const projectedEndOfMonth = curve[endOfMonthDay]?.balance ?? curve[curve.length - 1].balance;
  const projectedAtHorizonEnd = curve[curve.length - 1].balance;
  const lowestProjectedBalance = roundMoney(lowest === Infinity ? cal.liquidCash : lowest);
  const runwayOk = lowestProjectedBalance >= floor;

  // Risk windows: the biggest required outflows that push the balance to its low.
  const riskWindows: RiskWindow[] = cashEvents
    .filter((e) => e.signedAmount < 0 && e.daysFromNow <= lowestDay && (e.requirement === "required" || e.reserves))
    .sort((a, b) => a.signedAmount - b.signedAmount)
    .slice(0, 2)
    .map((e) => ({ dateISO: e.date, balance: curve[Math.max(0, Math.min(horizonDays, e.daysFromNow))]?.balance ?? 0, label: e.label }));

  const { level, assumptions, missing } = deriveConfidence(input.confidence);

  const status: CashflowProjection["status"] =
    lowestProjectedBalance < floor ? "negative" : safeToday <= dailyEssential * 0.5 || safeThisWeek <= 0 ? "tight" : "healthy";

  return {
    liquidCash: roundMoney(cal.liquidCash),
    reserveFloor: floor,
    horizonDays,
    daysRemainingInWeek,
    dailyEssential,
    nextIncome: cal.nextIncome,
    safeToday,
    safeThisWeek,
    safeUntilIncome,
    essentialBurnTotal: roundMoney(essentialThrough(horizonDays)),
    remainingBasedEssentials,
    lowestProjectedBalance,
    lowestDateISO: curve[lowestDay]?.dateISO ?? null,
    projectedEndOfWeek,
    projectedEndOfMonth,
    projectedAtHorizonEnd,
    runwayOk,
    totalExpectedIncome: roundMoney(totalIncome),
    totalReservedOutflows: roundMoney(totalOutflow),
    riskWindows,
    status,
    confidence: level,
    assumptions,
    missing,
    curve,
  };
}
