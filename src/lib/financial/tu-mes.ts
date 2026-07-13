import { roundMoney } from "./money";
import type { MargenCapacity } from "./margen-kipu";

// Stage 37 — "Tu mes" as a live dashboard surface. Pure mapping from the ONE
// capacity the engine already computes (margen-kipu) to the Sankey flows and the
// derived planning metrics the /app/mes page shows. PLANNING language only:
// everything here is repartir/apartar — the daily "gastar" number is the Margen.

export type TuMesTone = "income" | "fixed" | "debt" | "essential" | "reserve" | "goal" | "free";

export interface TuMesFlow {
  key: string;
  label: string;
  amount: number;
  tone: TuMesTone;
}

// Peel order mirrors the month's real priority: obligations first (fijos, deuda,
// esenciales), then what the user chose to apart (ahorro, inversión, metas), and
// what survives is "Libre para repartir". Zero flows are dropped; a negative
// leftover is clamped to 0 here (the metrics carry the honest overcommit flag).
export function buildTuMesFlows(c: MargenCapacity): TuMesFlow[] {
  const flows: TuMesFlow[] = [
    { key: "fixed", label: "Gastos fijos", amount: c.monthlyFixed, tone: "fixed" },
    { key: "debt", label: "Deudas", amount: c.monthlyDebtService, tone: "debt" },
    { key: "installments", label: "Cuotas activas", amount: c.monthlyInstallments, tone: "debt" },
    { key: "essential", label: "Lo esencial", amount: c.monthlyEssentials, tone: "essential" },
    { key: "savings", label: "Ahorro", amount: c.monthlyProtected.savings, tone: "reserve" },
    { key: "investment", label: "Inversión", amount: c.monthlyProtected.investment, tone: "reserve" },
    { key: "goals", label: "Metas", amount: c.monthlyProtected.goals, tone: "goal" },
    { key: "free", label: "Libre para repartir", amount: Math.max(0, c.monthlyTrulyFree), tone: "free" },
  ];
  return flows.filter((f) => f.amount > 0.005);
}

export interface TuMesMetrics {
  monthlyIncome: number;
  monthlyFixed: number;
  monthlyDebtService: number;
  /** Stage G — carga mensual de cuotas activas (baja el ritmo mientras corren) */
  monthlyInstallments: number;
  monthlyEssentials: number;
  /** ahorro + inversión + metas (lo que el usuario aparta a propósito) */
  monthlyApartado: number;
  /** lo que queda sin asignar después de TODO (puede ser negativo = sobre-repartido) */
  monthlyFreeReal: number;
  fixedPct: number;
  debtPct: number;
  installmentsPct: number;
  essentialPct: number;
  apartadoPct: number;
  freePct: number;
  /** apartado sostenido 12 meses (proyección simple, sin rendimiento) */
  apartadoYearly: number;
  overcommitted: boolean;
}

// Mirror of the engine's reserve math (goal-portfolio cadenceToWeekly × 30/7):
// what a contribution reserves PER MONTH. one_time/flexible reserve nothing.
const GOAL_MONTHLY_FACTOR: Record<string, number> = {
  monthly: 1,
  weekly: 30 / 7,
  biweekly: 30 / 14,
};

export function goalMonthlyEquivalent(amount: number, cadence: string | null | undefined): number {
  if (!(amount > 0)) return 0;
  const factor = GOAL_MONTHLY_FACTOR[cadence ?? "monthly"];
  return factor ? roundMoney(amount * factor) : 0;
}

const pctOf = (part: number, whole: number): number =>
  whole > 0 ? Math.round((Math.max(0, part) / whole) * 100) : 0;

export function buildTuMesMetrics(c: MargenCapacity): TuMesMetrics {
  const apartado = roundMoney(
    c.monthlyProtected.savings + c.monthlyProtected.investment + c.monthlyProtected.goals,
  );
  return {
    monthlyIncome: c.monthlyIncome,
    monthlyFixed: c.monthlyFixed,
    monthlyDebtService: c.monthlyDebtService,
    monthlyInstallments: c.monthlyInstallments,
    monthlyEssentials: c.monthlyEssentials,
    monthlyApartado: apartado,
    monthlyFreeReal: c.monthlyTrulyFree,
    fixedPct: pctOf(c.monthlyFixed, c.monthlyIncome),
    debtPct: pctOf(c.monthlyDebtService, c.monthlyIncome),
    installmentsPct: pctOf(c.monthlyInstallments, c.monthlyIncome),
    essentialPct: pctOf(c.monthlyEssentials, c.monthlyIncome),
    apartadoPct: pctOf(apartado, c.monthlyIncome),
    freePct: pctOf(c.monthlyTrulyFree, c.monthlyIncome),
    apartadoYearly: roundMoney(apartado * 12),
    overcommitted: c.monthlyTrulyFree < -0.005,
  };
}
