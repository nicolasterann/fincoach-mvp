import { roundMoney } from "@/lib/financial/money";
import { investmentProjection } from "@/lib/financial/investment-math";
import { monthlyRateDecimal } from "@/lib/financial/interest-math";

// Stage 17 — NET WORTH & WEALTH TARGET. PURE, estimate-labeled. Assets − debts,
// split into liquid / invested / other. NEVER invents asset values or market
// prices — it sums ONLY what the user entered (manual) or a verified connection
// provided. Wealth-target progress + a projected timeline use the user's own
// expected return; no fabricated returns, clearly an estimate.

export type AssetClass = "cash" | "investment" | "fixed_term" | "crypto" | "property" | "vehicle" | "business" | "receivable" | "other";

export interface AssetLike {
  name: string;
  assetClass: AssetClass;
  valueBase: number; // current value in base currency (user-provided / verified)
  liquid: boolean;
  includeInNetWorth: boolean;
  valuationConfidence?: "high" | "medium" | "low";
}

export interface NetWorthResult {
  liquidAssets: number; // cash/bank + assets the user marked liquid (any class)
  investedAssets: number; // investment/fixed_term/crypto/business (full value)
  otherAssets: number; // NON-liquid property/vehicle/receivable/other
  // Stage 31 (5.4a) — money in non-goal accounts the user marked GUARDADA
  // (liquidity "non_liquid"): real money that must count in patrimonio even
  // though it is never spendable margin. Counted in totalAssets, NOT in
  // liquidAssets (conservative: the user said it's not touchable now).
  nonLiquidAccounts: number;
  totalAssets: number;
  totalDebt: number;
  liquidNetWorth: number; // liquid assets − debt
  totalNetWorth: number; // all assets − debt
  wealthTarget: number | null;
  wealthProgressPct: number | null;
  requiredMonthlyForTarget: number | null; // to hit target by horizon (estimate)
  projectedMonthsToTarget: number | null; // at current contribution + return (estimate)
  confidence: "high" | "medium" | "low";
  assetCount: number;
}

const INVESTED: AssetClass[] = ["investment", "fixed_term", "crypto", "business"];
const OTHER: AssetClass[] = ["property", "vehicle", "receivable", "other"];

export function computeNetWorth(input: {
  liquidAccountsBase: number; // sum of non-goal liquid account base balances
  // Stage 31 (5.4a) — sum of non-goal accounts flagged non-spendable (GUARDADA).
  // Their money is the user's and belongs in net worth; it never counts as
  // liquid. Lives in `accounts`, NOT `investment_accounts` — no double count.
  nonLiquidAccountsBase?: number;
  totalDebtBase: number;
  assets: AssetLike[];
  wealthTarget?: number | null;
  monthlyContribution?: number; // current monthly toward wealth (estimate)
  expectedAnnualReturnPct?: number; // user-provided; no fabrication
  horizonMonths?: number; // for required-monthly calc (default 120 = 10y)
}): NetWorthResult {
  const assets = input.assets.filter((a) => a.includeInNetWorth);
  let investedAssets = 0;
  let otherAssetsAll = 0;
  let liquidInvest = 0;
  let liquidOther = 0;
  for (const a of assets) {
    const v = Math.max(0, a.valueBase);
    if (INVESTED.includes(a.assetClass)) {
      investedAssets += v;
      if (a.liquid) liquidInvest += v;
    } else if (OTHER.includes(a.assetClass)) {
      otherAssetsAll += v;
      // Stage 31 (5.4d) — the user's `liquid` flag is honored for EVERY class:
      // a receivable/other asset marked liquid counts as liquid patrimonio.
      if (a.liquid) liquidOther += v;
    } else {
      // 'cash' asset → liquid by definition (the flag can't demote cash).
      liquidInvest += v;
    }
  }
  const nonLiquidAccounts = roundMoney(Math.max(0, input.nonLiquidAccountsBase ?? 0));
  const liquidAssets = roundMoney(Math.max(0, input.liquidAccountsBase) + liquidInvest + liquidOther);
  investedAssets = roundMoney(investedAssets);
  // `otherAssets` exposes only the NON-liquid other-class value so the three
  // buckets (+ nonLiquidAccounts) sum exactly to totalAssets with no double count.
  const otherAssets = roundMoney(Math.max(0, otherAssetsAll - liquidOther));
  // Count each asset once: liquidAssets already includes liquid investments/cash/
  // other, so total adds only the NON-liquid invested portion + non-liquid other
  // assets + saved (guardada) account money.
  const nonLiquidInvested = roundMoney(Math.max(0, investedAssets - liquidInvest));
  const totalAssetsClean = roundMoney(liquidAssets + nonLiquidInvested + otherAssets + nonLiquidAccounts);
  const totalDebt = roundMoney(Math.max(0, input.totalDebtBase));
  const liquidNetWorth = roundMoney(liquidAssets - totalDebt);
  const totalNetWorth = roundMoney(totalAssetsClean - totalDebt);

  let wealthProgressPct: number | null = null;
  let requiredMonthlyForTarget: number | null = null;
  let projectedMonthsToTarget: number | null = null;
  const target = input.wealthTarget ?? null;
  if (target && target > 0) {
    wealthProgressPct = Math.max(0, Math.min(100, Math.round((totalNetWorth / target) * 100)));
    const horizon = Math.max(12, input.horizonMonths ?? 120);
    const ret = input.expectedAnnualReturnPct;
    // Required monthly (estimate): solve via projection search if a return is given,
    // else a flat (target−current)/horizon.
    const gap = target - totalNetWorth;
    if (gap <= 0) {
      requiredMonthlyForTarget = 0;
      projectedMonthsToTarget = 0;
    } else if (!ret || ret <= 0) {
      requiredMonthlyForTarget = roundMoney(gap / horizon);
      const c = input.monthlyContribution ?? 0;
      projectedMonthsToTarget = c > 0 ? Math.ceil(gap / c) : null;
    } else {
      // Binary-search the monthly contribution that reaches target in `horizon`.
      let lo = 0;
      let hi = Math.max(gap / horizon * 2, 10);
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const fv = investmentProjection({ startValue: totalNetWorth, rate: ret, rateKind: "annual_nominal", months: horizon, contributionPerMonth: mid }).projectedValue;
        if (fv >= target) hi = mid;
        else lo = mid;
      }
      requiredMonthlyForTarget = roundMoney(hi);
      // Months to target at the user's CURRENT contribution + return.
      const c = input.monthlyContribution ?? 0;
      if (c > 0) {
        let months: number | null = null;
        let bal = totalNetWorth;
        // Use the SAME rate model as the binary search (investmentProjection →
        // monthlyRateDecimal, annual_nominal) so requiredMonthly and the timeline
        // never contradict each other.
        const monthlyRet = monthlyRateDecimal(ret, "annual_nominal");
        for (let m = 1; m <= 1200; m++) {
          bal = bal * (1 + monthlyRet) + c;
          if (bal >= target) { months = m; break; }
        }
        projectedMonthsToTarget = months;
      }
    }
  }

  const confidence: NetWorthResult["confidence"] = assets.length >= 2 || input.liquidAccountsBase > 0 ? "medium" : "low";
  return {
    liquidAssets,
    investedAssets,
    otherAssets,
    nonLiquidAccounts,
    totalAssets: totalAssetsClean,
    totalDebt,
    liquidNetWorth,
    totalNetWorth,
    wealthTarget: target,
    wealthProgressPct,
    requiredMonthlyForTarget,
    projectedMonthsToTarget,
    confidence,
    assetCount: assets.length,
  };
}
