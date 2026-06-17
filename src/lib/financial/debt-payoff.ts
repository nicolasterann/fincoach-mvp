import { roundMoney } from "@/lib/financial/money";
import { payoffProjection, type PayoffProjection, type RateKind } from "@/lib/financial/interest-math";

// Stage 14 — debt payoff strategy. PURE + cashflow-aware. We ALWAYS pay every
// minimum first (never recommend missing one to fee/late), then steer any extra
// budget to ONE focus debt by the chosen strategy. Nothing here moves money; it
// returns a structured plan the agent phrases. Every figure is an estimate.

export type PayoffStrategy = "avalanche" | "snowball" | "urgency_first" | "hybrid";

export interface PayoffDebtInput {
  id: string;
  name: string;
  balance: number;
  annualRatePct: number | null;
  rateKind?: RateKind;
  minimumPayment: number | null;
  dueInDays?: number | null;
  overdue?: boolean;
}

export interface PayoffAllocation {
  id: string;
  name: string;
  minimum: number; // safety minimum we keep paying
  extra: number; // extra steered here this month
  total: number;
  isFocus: boolean;
  reason: string;
}

export interface PayoffPlan {
  strategy: PayoffStrategy;
  hasDebt: boolean;
  minimumsTotal: number;
  extraBudget: number; // extra actually allocatable (after margin cap)
  extraRequested: number;
  totalMonthlyCommitment: number;
  minimumsExceedMargin: boolean;
  focusDebtId: string | null;
  focusPayoff: PayoffProjection | null; // projection for the focus debt at minimum+extra
  allocations: PayoffAllocation[];
  notes: string[];
  estimate: true;
}

function knownMin(d: PayoffDebtInput): number {
  return d.minimumPayment != null && d.minimumPayment > 0 ? roundMoney(d.minimumPayment) : 0;
}

// Order debts to decide where EXTRA goes first. Urgency (overdue / due-soon)
// always floats relevant debts up; ties broken by the strategy's core metric.
function orderForExtra(debts: PayoffDebtInput[], strategy: PayoffStrategy): PayoffDebtInput[] {
  const withBalance = debts.filter((d) => d.balance > 0.005);
  const cmpStrategy = (a: PayoffDebtInput, b: PayoffDebtInput): number => {
    if (strategy === "snowball") return a.balance - b.balance;
    // avalanche / hybrid / urgency_first all optimize extra by highest rate.
    const ra = a.annualRatePct ?? -1; // unknown rate ranks last (never assumed high)
    const rb = b.annualRatePct ?? -1;
    if (rb !== ra) return rb - ra;
    return a.balance - b.balance; // tie → smaller balance (quicker win)
  };
  const urgencyRank = (d: PayoffDebtInput): number => {
    if (d.overdue) return 0;
    if (d.dueInDays != null && d.dueInDays <= 5) return 1;
    return 2;
  };
  return withBalance.sort((a, b) => {
    if (strategy === "snowball") {
      // snowball ignores urgency for the focus ordering (smallest first),
      // but minimums are still always paid on the urgent ones.
      return cmpStrategy(a, b);
    }
    const ua = urgencyRank(a);
    const ub = urgencyRank(b);
    if (ua !== ub) return ua - ub;
    return cmpStrategy(a, b);
  });
}

export function planPayoff(
  debts: PayoffDebtInput[],
  opts: { strategy?: PayoffStrategy; extraMonthlyBudget?: number; monthlyMarginForDebt?: number | null } = {},
): PayoffPlan {
  const strategy = opts.strategy ?? "hybrid";
  const active = debts.filter((d) => d.balance > 0.005);
  const minimumsTotal = roundMoney(active.reduce((s, d) => s + knownMin(d), 0));
  const extraRequested = roundMoney(Math.max(0, opts.extraMonthlyBudget ?? 0));

  const notes: string[] = [];
  // Cashflow guard: never let the plan's commitment break the user's margin.
  let extraBudget = extraRequested;
  let minimumsExceedMargin = false;
  if (opts.monthlyMarginForDebt != null) {
    const room = roundMoney(opts.monthlyMarginForDebt - minimumsTotal);
    if (room < 0) {
      minimumsExceedMargin = true;
      extraBudget = 0;
      notes.push("Los pagos mínimos ya superan tu margen mensual: primero hay que liberar flujo antes de abonar extra.");
    } else if (extraBudget > room) {
      extraBudget = roundMoney(Math.max(0, room));
      notes.push("Ajusté el abono extra para no romper tu margen mensual.");
    }
  }

  const ordered = orderForExtra(active, strategy);
  const focus = ordered[0] ?? null;
  const focusDebtId = focus?.id ?? null;

  const allocations: PayoffAllocation[] = active.map((d) => {
    const minimum = knownMin(d);
    const isFocus = d.id === focusDebtId && extraBudget > 0;
    const extra = isFocus ? extraBudget : 0;
    return {
      id: d.id,
      name: d.name,
      minimum,
      extra,
      total: roundMoney(minimum + extra),
      isFocus,
      reason: isFocus
        ? strategy === "snowball"
          ? "saldo más pequeño: ciérralo primero para ganar impulso"
          : "tasa más alta: aquí el interés te cuesta más"
        : minimum > 0
          ? "mantén el mínimo para evitar mora e intereses extra"
          : "sin mínimo conocido; confírmalo para incluirlo",
    };
  });

  let focusPayoff: PayoffProjection | null = null;
  if (focus && extraBudget >= 0) {
    const focusTotal = knownMin(focus) + extraBudget;
    if (focusTotal > 0) {
      focusPayoff = payoffProjection({
        balance: focus.balance,
        rate: focus.annualRatePct,
        monthlyPayment: focusTotal,
        kind: focus.rateKind,
      });
    }
  }

  if (active.some((d) => d.minimumPayment == null)) {
    notes.push("Algunas deudas no tienen mínimo registrado; con ese dato el plan es más preciso.");
  }

  return {
    strategy,
    hasDebt: active.length > 0,
    minimumsTotal,
    extraBudget,
    extraRequested,
    totalMonthlyCommitment: roundMoney(minimumsTotal + extraBudget),
    minimumsExceedMargin,
    focusDebtId,
    focusPayoff,
    allocations,
    notes,
    estimate: true,
  };
}
