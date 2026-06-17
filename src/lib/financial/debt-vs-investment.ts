import { roundMoney } from "@/lib/financial/money";

// Stage 14 — debt-vs-investment / opportunity-cost reasoning. PURE.
//
// This is PERSONAL-FINANCE guidance, NOT securities advice: it compares the
// GUARANTEED return of paying debt (the debt's interest rate) against an
// UNCERTAIN expected investment return, and protects an emergency reserve. It
// never recommends skipping a minimum payment to invest, and never claims a
// specific investment will achieve a return.

export type DebtVsInvestmentVerdict =
  | "pay_debt"
  | "invest_or_keep_cash"
  | "split"
  | "insufficient_data";

export interface DebtVsInvestmentInput {
  debtAnnualRatePct: number | null; // the debt's rate (guaranteed saving). null = unknown
  expectedAnnualReturnPct?: number | null; // user/assumption. null = unknown
  cashAvailable: number; // discretionary cash being considered
  reserveTarget?: number | null; // emergency reserve the user should keep
  currentLiquidReserve?: number | null; // how much liquid the user holds now
}

export interface DebtVsInvestmentResult {
  verdict: DebtVsInvestmentVerdict;
  guaranteedSavingPct: number | null; // = debt rate
  expectedReturnPct: number | null;
  spreadPct: number | null; // expected return − debt rate (positive favors investing)
  reserveShortfall: number; // how much reserve would be missing if all cash went to debt
  highInterest: boolean;
  reasons: string[];
  estimate: true;
}

// Thresholds chosen conservatively for LatAm consumer finance.
const HIGH_INTEREST_PCT = 15; // at/above this, paying debt almost always wins
const LOW_INTEREST_PCT = 6; // at/below this, investing/keeping cash can make sense
const MARGIN_PCT = 3; // expected return must clear the debt rate by this to favor investing

export function compareDebtVsInvestment(input: DebtVsInvestmentInput): DebtVsInvestmentResult {
  const debtRate = input.debtAnnualRatePct != null && Number.isFinite(input.debtAnnualRatePct) ? input.debtAnnualRatePct : null;
  const ret = input.expectedAnnualReturnPct != null && Number.isFinite(input.expectedAnnualReturnPct) ? input.expectedAnnualReturnPct : null;
  const reasons: string[] = [];

  const reserveTarget = input.reserveTarget != null && input.reserveTarget > 0 ? roundMoney(input.reserveTarget) : 0;
  const reserveNow = input.currentLiquidReserve != null ? roundMoney(Math.max(0, input.currentLiquidReserve)) : null;
  // If the user spent all this cash on debt, how far below the reserve would they fall?
  const reserveAfter = reserveNow != null ? roundMoney(reserveNow - roundMoney(Math.max(0, input.cashAvailable))) : null;
  const reserveShortfall = reserveAfter != null && reserveTarget > 0 ? roundMoney(Math.max(0, reserveTarget - reserveAfter)) : 0;

  if (debtRate == null) {
    reasons.push("No conozco la tasa de esa deuda; con ella te digo si pagarla gana a invertir. ¿La tienes a la mano?");
    return { verdict: "insufficient_data", guaranteedSavingPct: null, expectedReturnPct: ret, spreadPct: null, reserveShortfall, highInterest: false, reasons, estimate: true };
  }

  const highInterest = debtRate >= HIGH_INTEREST_PCT;
  const spread = ret != null ? roundMoney(ret - debtRate) : null;

  // Reserve protection comes first: don't drain the emergency cushion to pay debt.
  if (reserveShortfall > 0) {
    reasons.push(`Pagar toda esa deuda te dejaría por debajo de tu reserva (faltarían ${reserveShortfall}). Conviene cuidar el colchón antes de descapitalizarte.`);
  }

  if (highInterest) {
    reasons.push(`La deuda cobra ${debtRate}% al año: ese ahorro es casi seguro y normalmente le gana a un retorno incierto de inversión.`);
    return {
      verdict: reserveShortfall > 0 ? "split" : "pay_debt",
      guaranteedSavingPct: debtRate,
      expectedReturnPct: ret,
      spreadPct: spread,
      reserveShortfall,
      highInterest,
      reasons,
      estimate: true,
    };
  }

  if (ret == null) {
    reasons.push(`La tasa de la deuda es ${debtRate}%. Para comparar con invertir necesito un retorno esperado realista; el de la deuda es un ahorro garantizado y el de inversión es incierto.`);
    if (debtRate <= LOW_INTEREST_PCT) {
      reasons.push("Como la tasa es baja, no es urgente descapitalizarte para pagarla.");
    }
    return { verdict: debtRate <= LOW_INTEREST_PCT ? "invest_or_keep_cash" : "insufficient_data", guaranteedSavingPct: debtRate, expectedReturnPct: null, spreadPct: null, reserveShortfall, highInterest, reasons, estimate: true };
  }

  // Both rates known and debt is not high-interest.
  if (spread != null && spread >= MARGIN_PCT) {
    reasons.push(`Tu retorno esperado (${ret}%) supera la tasa de la deuda (${debtRate}%) con margen; pero recuerda que el retorno es incierto y el ahorro de pagar deuda es seguro.`);
    return { verdict: reserveShortfall > 0 ? "split" : "invest_or_keep_cash", guaranteedSavingPct: debtRate, expectedReturnPct: ret, spreadPct: spread, reserveShortfall, highInterest, reasons, estimate: true };
  }
  reasons.push(`El retorno esperado (${ret}%) no supera con claridad la tasa de la deuda (${debtRate}%): pagar deuda da un ahorro garantizado y suele ser la opción más tranquila.`);
  return { verdict: reserveShortfall > 0 ? "split" : "pay_debt", guaranteedSavingPct: debtRate, expectedReturnPct: ret, spreadPct: spread, reserveShortfall, highInterest, reasons, estimate: true };
}
