import { roundMoney } from "@/lib/financial/money";

// Stage 17 — MINI-GOAL builder + purchase evaluation. The heart of "Kipu lets you
// keep living without debt": when the user wants to buy something, decide if it's
// safe TODAY (against the timing-aware safe spend, not the bank balance), and if
// not, turn it into a cashflow-safe MINI-GOAL — a small weekly set-aside from the
// DISCRETIONARY surplus that reaches the item without touching card payments,
// fixed expenses, debt minimums, the main goal, the emergency reserve or the
// investment plan. PURE. Never says only "no"; says "yes, in the right timing".

const DAY_MS = 86_400_000;

export interface MiniGoalPlan {
  price: number;
  weeklyContribution: number;
  weeks: number;
  targetDateISO: string | null;
  cadence: "weekly";
  feasibleFromDiscretionary: boolean; // reserved from joy money → breaks nothing
  rationale: string; // structured Spanish fact
}

export interface PurchaseEvaluation {
  price: number;
  safeToday: number; // timing-aware safe spend today
  safeThisWeek: number;
  discretionaryAfterPlanWeekly: number; // weekly joy money left after the goal plan
  canBuyToday: boolean;
  buyingTodayIsTight: boolean; // affordable this week but compresses it
  pressureReason: string | null; // why buying today pressures things (card/runway)
  recommendation: "buy_today" | "mini_goal" | "wait_or_adjust";
  miniGoal: MiniGoalPlan | null;
}

function isoOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Build a cashflow-safe mini-goal: a weekly set-aside from discretionary money
// that reaches `price` in a realistic time. Leaves ~30% of discretionary as joy
// even while saving, so the plan never feels like deprivation.
export function planMiniGoal(input: {
  price: number;
  discretionaryWeekly: number;
  nowMs: number;
  targetWeeksHint?: number; // preferred horizon (default ~4)
}): MiniGoalPlan {
  const price = roundMoney(Math.max(0, input.price));
  const maxWeekly = roundMoney(Math.max(0, input.discretionaryWeekly * 0.7)); // keep 30% joy
  const hint = Math.max(1, input.targetWeeksHint ?? 4);

  if (price <= 0) {
    return { price, weeklyContribution: 0, weeks: 0, targetDateISO: isoOf(input.nowMs), cadence: "weekly", feasibleFromDiscretionary: true, rationale: "Sin precio no puedo armar la mini-meta." };
  }
  if (maxWeekly <= 0) {
    return {
      price,
      weeklyContribution: 0,
      weeks: 0,
      targetDateISO: null,
      cadence: "weekly",
      feasibleFromDiscretionary: false,
      rationale: "Ahora mismo no hay plata libre para apartar sin tocar tus pagos o metas; mejor esperar a que se libere algo o ajustar otra prioridad.",
    };
  }

  // Aim for the hint horizon, but cap the weekly at what discretionary allows
  // (which may stretch the horizon — that's honest, not deprivation).
  const idealWeekly = roundMoney(price / hint);
  const weeklyContribution = roundMoney(Math.min(idealWeekly, maxWeekly));
  // If the feasible weekly rounds to 0 (tiny discretionary vs a tiny price),
  // don't divide by zero → treat as not feasible this week.
  if (weeklyContribution <= 0) {
    return { price, weeklyContribution: 0, weeks: 0, targetDateISO: null, cadence: "weekly", feasibleFromDiscretionary: false, rationale: "El margen libre es demasiado chico para una mini-meta cómoda esta semana; mejor esperar o ajustar otra prioridad." };
  }
  const weeks = Math.max(1, Math.ceil(price / weeklyContribution));
  const targetDateISO = isoOf(input.nowMs + weeks * 7 * DAY_MS);
  return {
    price,
    weeklyContribution,
    weeks,
    targetDateISO,
    cadence: "weekly",
    feasibleFromDiscretionary: true,
    rationale: `Apartando ~${weeklyContribution}/sem llegas a ${price} en ${weeks} semana(s) (≈ ${targetDateISO}) sin tocar tus pagos, tu meta principal ni tu fondo.`,
  };
}

export function evaluatePurchase(input: {
  price: number;
  safeToday: number;
  safeThisWeek: number;
  discretionaryAfterPlanWeekly: number;
  nowMs: number;
  onCard?: boolean;
  cardDueSoonAmount?: number; // a card payment due within the week
  runwayOk?: boolean;
  targetWeeksHint?: number;
}): PurchaseEvaluation {
  const price = roundMoney(Math.max(0, input.price));
  const safeToday = roundMoney(Math.max(0, input.safeToday));
  const safeThisWeek = roundMoney(Math.max(0, input.safeThisWeek));

  // Buying today is safe only if it fits today's timing-aware safe spend AND
  // doesn't collide with a card payment due this week or a broken runway.
  const fitsToday = price <= safeToday + 0.01;
  const fitsThisWeek = price <= safeThisWeek + 0.01;
  const cardPressure = (input.cardDueSoonAmount ?? 0) > 0 && price + (input.cardDueSoonAmount ?? 0) > safeThisWeek + 0.01;
  const runwayBroken = input.runwayOk === false;

  let pressureReason: string | null = null;
  if (cardPressure) pressureReason = "tienes un pago de tarjeta cerca y comprarlo hoy te dejaría justo para cubrirlo";
  else if (runwayBroken) pressureReason = "tu proyección ya viene apretada antes de tu próximo ingreso";
  else if (!fitsToday && fitsThisWeek) pressureReason = "cabe en tu semana pero comprarlo hoy te comprime los próximos días";
  else if (!fitsThisWeek) pressureReason = "supera lo que puedes gastar tranquilo esta semana";

  const canBuyToday = fitsToday && !cardPressure && !runwayBroken;
  const buyingTodayIsTight = !canBuyToday && fitsThisWeek && !cardPressure && !runwayBroken;

  const miniGoal = planMiniGoal({ price, discretionaryWeekly: input.discretionaryAfterPlanWeekly, nowMs: input.nowMs, targetWeeksHint: input.targetWeeksHint });

  let recommendation: PurchaseEvaluation["recommendation"];
  if (canBuyToday) recommendation = "buy_today";
  else if (miniGoal.feasibleFromDiscretionary) recommendation = "mini_goal";
  else recommendation = "wait_or_adjust";

  return {
    price,
    safeToday,
    safeThisWeek,
    discretionaryAfterPlanWeekly: roundMoney(Math.max(0, input.discretionaryAfterPlanWeekly)),
    canBuyToday,
    buyingTodayIsTight,
    pressureReason,
    recommendation,
    miniGoal: recommendation === "buy_today" && !miniGoal.feasibleFromDiscretionary ? null : miniGoal,
  };
}
