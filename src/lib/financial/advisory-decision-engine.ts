import type { DebtPressureLevel } from "@/lib/financial/debt-pressure";
import { roundMoney } from "@/lib/financial/money";

// Read-only advisory engine. Given a candidate purchase/spending amount
// and the user's real financial snapshot, it returns a deterministic
// recommendation plus the numbers needed to explain it. It never writes
// to the database and never registers a movement — it only reasons about
// "should I?" questions. The AI layer humanizes the result; this code
// owns the financial truth.

export type AdvisoryRecommendation =
  | "yes"
  | "caution"
  | "wait"
  | "no"
  | "need_more_info";

export type AdvisorySeverity = "low" | "medium" | "high";

export type AdvisoryPaymentMethodType = "account" | "card" | "unknown";

// Coarse semantic kind of the thing the user is asking about. It only
// shapes the *wording* (and whether offering a mini-meta makes sense); it
// never changes the financial math. A mini-meta ("guárdalo como meta") is
// only sensible for a durable/wishlist item you can save up for — never
// for a coffee, a dinner, a night out, or a recurring subscription.
export type AdvisoryItemKind =
  | "durable"
  | "consumable"
  | "experience"
  | "subscription"
  | "unknown";

function normalizeItemText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const SUBSCRIPTION_WORDS = [
  "suscripcion",
  "membresia",
  "mensualidad",
  "al mes",
  "mensual",
  "netflix",
  "spotify",
  "disney",
  "hbo",
  "gimnasio",
  "gym",
  "plan mensual",
];

const CONSUMABLE_WORDS = [
  "cafe",
  "cena",
  "almuerzo",
  "desayuno",
  "comida",
  "comer",
  "cenar",
  "almorzar",
  "sushi",
  "pizza",
  "hamburguesa",
  "antojo",
  "postre",
  "snack",
  "merienda",
  "bebida",
  "trago",
  "cerveza",
  "helado",
  "domicilio",
  "delivery",
];

const EXPERIENCE_WORDS = [
  "salir",
  "salida",
  "finde",
  "fin de semana",
  "fiesta",
  "concierto",
  "cine",
  "paseo",
  "evento",
  "boletos",
  "entradas",
  "rumba",
  "carrete",
];

const DURABLE_WORDS = [
  "zapatos",
  "zapatillas",
  "tenis",
  "reloj",
  "audifonos",
  "auriculares",
  "mochila",
  "chaqueta",
  "abrigo",
  "ropa",
  "vestido",
  "celular",
  "telefono",
  "laptop",
  "computadora",
  "consola",
  "mueble",
  "bicicleta",
  "camara",
  "lentes",
  "gafas",
  "bolso",
  "cartera",
  "juguete",
  "perfume",
];

// Classify the item being discussed from its description (and the raw
// message as backup). Keyword-based on purpose: this only nudges wording,
// the AI humanizer does the nuanced phrasing on top. Order matters —
// subscription wins over a consumable word that might also appear.
export function classifyAdvisoryItemKind(input: {
  itemDescription: string | null;
  message?: string | null;
}): AdvisoryItemKind {
  const haystack = normalizeItemText(
    `${input.itemDescription ?? ""} ${input.message ?? ""}`,
  ).trim();
  if (!haystack) return "unknown";
  if (SUBSCRIPTION_WORDS.some((w) => haystack.includes(w))) return "subscription";
  if (CONSUMABLE_WORDS.some((w) => haystack.includes(w))) return "consumable";
  if (EXPERIENCE_WORDS.some((w) => haystack.includes(w))) return "experience";
  if (DURABLE_WORDS.some((w) => haystack.includes(w))) return "durable";
  return "unknown";
}

export interface AdvisoryDecisionInput {
  amount: number | null;
  paymentMethodType: AdvisoryPaymentMethodType;
  itemKind: AdvisoryItemKind;
  // Weekly cash margin the user actually has left (can be negative).
  weeklyRemaining: number;
  dailySuggested: number;
  daysRemainingInWeek: number;
  debtPressureLevel: DebtPressureLevel;
  totalDebt: number;
  availableCash: number;
  suppressContributionPush: boolean;
  baseCurrency: string;
}

export interface AdvisoryDecision {
  recommendation: AdvisoryRecommendation;
  severity: AdvisorySeverity;
  reasonCodes: string[];
  amount: number | null;
  paymentMethodType: AdvisoryPaymentMethodType;
  itemKind: AdvisoryItemKind;
  weeklyRemainingBefore: number | null;
  weeklyRemainingAfter: number | null;
  dailyRemainingBefore: number | null;
  dailyRemainingAfter: number | null;
  cashImpact: number | null;
  debtImpact: number | null;
  goalImpactNote: string | null;
  shortReason: string;
  baseCurrency: string;
}

// The current per-day figure the user already has, as a WHOLE dollar
// amount for chat. Advisory copy never shows cents for daily numbers
// (e.g. "más o menos 27$ por día", never "26.67$").
function currentDailyFigure(
  weeklyRemaining: number,
  daysRemainingInWeek: number,
): number | null {
  if (!Number.isFinite(weeklyRemaining) || weeklyRemaining <= 0) return null;
  if (daysRemainingInWeek <= 0) return null;
  return Math.round(weeklyRemaining / daysRemainingInWeek);
}

function needMoreInfo(
  input: AdvisoryDecisionInput,
  reasonCode: string,
  shortReason: string,
): AdvisoryDecision {
  return {
    recommendation: "need_more_info",
    severity: "low",
    reasonCodes: [reasonCode],
    amount: input.amount,
    paymentMethodType: input.paymentMethodType,
    itemKind: input.itemKind,
    weeklyRemainingBefore: Number.isFinite(input.weeklyRemaining)
      ? roundMoney(input.weeklyRemaining)
      : null,
    weeklyRemainingAfter: null,
    dailyRemainingBefore: currentDailyFigure(
      input.weeklyRemaining,
      input.daysRemainingInWeek,
    ),
    dailyRemainingAfter: null,
    cashImpact: null,
    debtImpact: null,
    goalImpactNote: null,
    shortReason,
    baseCurrency: input.baseCurrency,
  };
}

export function evaluateAdvisoryDecision(
  input: AdvisoryDecisionInput,
): AdvisoryDecision {
  const {
    amount,
    paymentMethodType,
    itemKind,
    weeklyRemaining,
    daysRemainingInWeek,
    debtPressureLevel,
    suppressContributionPush,
    baseCurrency,
  } = input;

  // A mini-meta ("guárdalo como meta") only makes sense for a durable
  // item you can save toward. Never propose it for food, a night out, or
  // a recurring subscription.
  const miniGoalApplies = itemKind === "durable";

  if (amount === null || !Number.isFinite(amount)) {
    return needMoreInfo(
      input,
      "missing_amount",
      "No tengo el monto todavía.",
    );
  }

  if (amount <= 0) {
    return needMoreInfo(
      input,
      "non_positive_amount",
      "El monto no es válido.",
    );
  }

  const weeklyBefore = roundMoney(weeklyRemaining);
  const highDebt =
    debtPressureLevel === "high" || debtPressureLevel === "critical";
  const reasonCodes: string[] = [];
  if (suppressContributionPush) reasonCodes.push("goal_suppressed");
  if (debtPressureLevel === "critical") reasonCodes.push("debt_pressure_critical");
  else if (debtPressureLevel === "high") reasonCodes.push("debt_pressure_high");

  const goalImpactNote = suppressContributionPush
    ? "Tu meta está protegida; esta semana conviene cuidar el margen."
    : null;

  // ── Card path: cash today is untouched, but debt rises. We never let
  // the user feel a card purchase is "free" — it moves the pressure, it
  // doesn't erase it.
  if (paymentMethodType === "card") {
    let recommendation: AdvisoryRecommendation;
    let severity: AdvisorySeverity;

    if (debtPressureLevel === "critical") {
      recommendation = "no";
      severity = "high";
    } else if (debtPressureLevel === "high") {
      recommendation = "caution";
      severity = "high";
    } else if (debtPressureLevel === "medium") {
      recommendation = "caution";
      severity = "medium";
    } else {
      recommendation = "caution";
      severity = "low";
    }

    reasonCodes.unshift("card_adds_debt");
    if (recommendation === "no" && miniGoalApplies) {
      reasonCodes.push("consider_mini_goal");
    }

    return {
      recommendation,
      severity,
      reasonCodes,
      amount: roundMoney(amount),
      paymentMethodType,
      itemKind,
      weeklyRemainingBefore: weeklyBefore,
      weeklyRemainingAfter: weeklyBefore,
      dailyRemainingBefore: null,
      dailyRemainingAfter: null,
      cashImpact: 0,
      debtImpact: roundMoney(amount),
      goalImpactNote,
      shortReason: highDebt
        ? "Con tarjeta sube la deuda y ya está apretada."
        : "Con tarjeta no baja tu efectivo hoy, pero sube la deuda.",
      baseCurrency,
    };
  }

  // ── Cash path (account or unknown). Unknown is treated as cash because
  // that is the more protective assumption for the user's weekly margin.
  const weeklyAfter = roundMoney(weeklyBefore - amount);
  // Daily figures are whole dollars for chat (no cents in "X$ por día").
  const dailyAfter =
    daysRemainingInWeek > 0
      ? Math.round(Math.max(weeklyAfter, 0) / daysRemainingInWeek)
      : 0;
  const dailyBefore = currentDailyFigure(weeklyBefore, daysRemainingInWeek);

  let recommendation: AdvisoryRecommendation;
  let severity: AdvisorySeverity;
  let shortReason: string;

  if (weeklyBefore <= 0) {
    recommendation = "no";
    severity = "high";
    reasonCodes.push("no_weekly_margin");
    shortReason = "No te queda margen esta semana.";
  } else if (amount > weeklyBefore) {
    recommendation = "no";
    severity = "high";
    reasonCodes.push("exceeds_weekly_margin");
    shortReason = "El gasto supera tu margen de la semana.";
  } else {
    const ratio = amount / weeklyBefore;
    if (ratio > 0.5) {
      recommendation = highDebt ? "wait" : "caution";
      severity = "medium";
      reasonCodes.push("large_share_of_week");
      shortReason = "Se comería buena parte de tu semana.";
    } else if (ratio >= 0.2) {
      recommendation = "caution";
      severity = highDebt ? "medium" : "low";
      reasonCodes.push("moderate_share_of_week");
      shortReason = "Entra, pero te ajusta la semana.";
    } else {
      recommendation = highDebt ? "caution" : "yes";
      severity = "low";
      reasonCodes.push(highDebt ? "moderate_share_of_week" : "fits_comfortably");
      shortReason = highDebt
        ? "Entra en tu semana, pero cuida la deuda."
        : "Entra cómodo en tu semana.";
    }
  }

  if ((recommendation === "no" || recommendation === "wait") && miniGoalApplies) {
    reasonCodes.push("consider_mini_goal");
  }

  return {
    recommendation,
    severity,
    reasonCodes,
    amount: roundMoney(amount),
    paymentMethodType,
    itemKind,
    weeklyRemainingBefore: weeklyBefore,
    weeklyRemainingAfter: weeklyAfter,
    dailyRemainingBefore: dailyBefore,
    dailyRemainingAfter: dailyAfter,
    cashImpact: roundMoney(amount),
    debtImpact: 0,
    goalImpactNote,
    shortReason,
    baseCurrency,
  };
}
