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
  // Portion of the purchase that actually drains Saldo. Usually equal to
  // amount; food/transport inside its monthly objective can make it smaller.
  // Bank cash and card debt still move by the full `amount`.
  saldoCost?: number | null;
  paymentMethodType: AdvisoryPaymentMethodType;
  itemKind: AdvisoryItemKind;
  // The canonical current Saldo Kipu and its independent daily refill.
  // Never pass the legacy weekly-plan projection into these fields.
  currentSaldo: number;
  dailyRefill: number;
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
  saldoBefore: number | null;
  saldoAfter: number | null;
  dailyRefill: number | null;
  saldoImpact: number | null;
  cashImpact: number | null;
  debtImpact: number | null;
  goalImpactNote: string | null;
  shortReason: string;
  baseCurrency: string;
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
    saldoBefore: Number.isFinite(input.currentSaldo)
      ? roundMoney(Math.max(input.currentSaldo, 0))
      : null,
    saldoAfter: null,
    dailyRefill: Number.isFinite(input.dailyRefill)
      ? roundMoney(Math.max(input.dailyRefill, 0))
      : null,
    saldoImpact: null,
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
    currentSaldo,
    dailyRefill,
    saldoCost: rawSaldoCost,
    debtPressureLevel,
    suppressContributionPush,
    baseCurrency,
  } = input;

  // A mini-meta ("guárdalo como meta") only makes sense for a durable
  // item you can save toward. Never propose it for food, a night out, or
  // a recurring subscription.
  const miniGoalApplies = itemKind === "durable";

  if (!Number.isFinite(currentSaldo)) {
    return needMoreInfo(
      input,
      "saldo_unavailable",
      "No puedo comprobar tu Saldo ahora mismo.",
    );
  }

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

  const saldoCost = rawSaldoCost == null ? amount : rawSaldoCost;
  if (
    !Number.isFinite(saldoCost) ||
    saldoCost < 0 ||
    saldoCost > amount + 0.005
  ) {
    return needMoreInfo(
      input,
      "invalid_saldo_cost",
      "No puedo comprobar cuánto de la compra saldría de tu Saldo.",
    );
  }

  const saldoBefore = roundMoney(Math.max(currentSaldo, 0));
  const saldoImpact = roundMoney(saldoCost);
  const saldoAfter = roundMoney(Math.max(saldoBefore - saldoImpact, 0));
  const crossesSaldoLayer = saldoImpact > saldoBefore;
  const highDebt =
    debtPressureLevel === "high" || debtPressureLevel === "critical";
  const reasonCodes: string[] = [];
  if (suppressContributionPush) reasonCodes.push("goal_suppressed");
  if (debtPressureLevel === "critical") reasonCodes.push("debt_pressure_critical");
  else if (debtPressureLevel === "high") reasonCodes.push("debt_pressure_high");

  const goalImpactNote = suppressContributionPush
    ? "Tu meta está protegida; conviene cuidar tu Saldo."
    : null;

  // ── Card path: bank cash today is untouched, but the purchase still drains
  // the Saldo allowance and raises debt. Saldo is not an account balance.
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
    if (crossesSaldoLayer) {
      reasonCodes.push("crosses_saldo_layer");
      severity = "high";
    }
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
      saldoBefore,
      saldoAfter,
      dailyRefill: Number.isFinite(dailyRefill)
        ? roundMoney(Math.max(dailyRefill, 0))
        : null,
      saldoImpact,
      cashImpact: 0,
      debtImpact: roundMoney(amount),
      goalImpactNote,
      shortReason: highDebt
        ? saldoImpact > 0
          ? "La compra baja tu Saldo y sube una deuda que ya está apretada."
          : "La compra no toca tu Saldo, pero sube una deuda que ya está apretada."
        : crossesSaldoLayer
          ? "No baja tu efectivo hoy, pero sube la deuda y cruza tu Saldo."
          : saldoImpact > 0
            ? "No baja tu efectivo hoy, pero baja tu Saldo y sube la deuda."
            : "No baja tu efectivo ni toca tu Saldo, pero sube la deuda.",
      baseCurrency,
    };
  }

  // ── Cash path (account or unknown). Unknown is treated as cash because
  // that is the more protective assumption. The comparison is against the
  // current Saldo tank, never against a seven-day projection.
  let recommendation: AdvisoryRecommendation;
  let severity: AdvisorySeverity;
  let shortReason: string;

  if (saldoImpact <= 0.005) {
    recommendation = "yes";
    severity = "low";
    reasonCodes.push("no_saldo_impact");
    shortReason = "La compra no toca tu Saldo.";
  } else if (saldoBefore <= 0 || crossesSaldoLayer) {
    // Cruzar una capa AVISA, nunca bloquea: por sí solo jamás pasa de `caution`.
    // Pero la rama hacía short-circuit ANTES de mirar la deuda, y eso INVERTÍA el
    // consejo: gastar 120 de 200 con deuda crítica daba `wait`, y gastar 3000 de
    // 200 —15 veces el Saldo, cruzando la capa, con la misma deuda crítica— daba
    // el consejo más SUAVE. La causa independiente (deuda apretada) tiene que
    // seguir contando; si no, el peor caso recibe la menor advertencia.
    recommendation = highDebt ? "wait" : "caution";
    severity = "high";
    reasonCodes.push("crosses_saldo_layer");
    shortReason =
      saldoBefore <= 0
        ? "La compra saldría de una capa protegida."
        : "El gasto supera tu Saldo y cruza de capa.";
  } else {
    const ratio = saldoImpact / saldoBefore;
    if (ratio > 0.5) {
      recommendation = highDebt ? "wait" : "caution";
      severity = "medium";
      reasonCodes.push("large_share_of_saldo");
      shortReason = "Se comería buena parte de tu Saldo.";
    } else if (ratio >= 0.2) {
      recommendation = "caution";
      severity = highDebt ? "medium" : "low";
      reasonCodes.push("moderate_share_of_saldo");
      shortReason = "Entra, pero te ajusta el Saldo.";
    } else {
      recommendation = highDebt ? "caution" : "yes";
      severity = "low";
      reasonCodes.push(highDebt ? "moderate_share_of_saldo" : "fits_comfortably");
      shortReason = highDebt
        ? "Entra en tu Saldo, pero cuida la deuda."
        : "Entra cómodo en tu Saldo.";
    }
  }

  if (recommendation === "wait" && miniGoalApplies) {
    reasonCodes.push("consider_mini_goal");
  }

  return {
    recommendation,
    severity,
    reasonCodes,
    amount: roundMoney(amount),
    paymentMethodType,
    itemKind,
    saldoBefore,
    saldoAfter,
    dailyRefill: Number.isFinite(dailyRefill)
      ? roundMoney(Math.max(dailyRefill, 0))
      : null,
    saldoImpact,
    cashImpact: roundMoney(amount),
    debtImpact: 0,
    goalImpactNote,
    shortReason,
    baseCurrency,
  };
}
