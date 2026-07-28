// Bloque J-8 (D1) — el MOTOR manda sobre el monto, no la frase.
//
// El caso real que lo motiva (beta, 21/07): el usuario dijo «pagué el total» de
// una tarjeta cuyo corte guardado era 743.93, y el agente escribió **552.77** —
// que era el SALDO DE LA CUENTA que el usuario había nombrado en la misma frase
// («con todo lo que tenía en Produbanco»). No fue una alucinación: fue tomar un
// número real del estado para responder una pregunta que ese número no responde.
//
// Lo importante: el prompt YA decía «Nunca inventes saldos ni montos». Pasó igual.
// Una instrucción de prompt no es un guard — por eso esta decisión vive acá, en
// código determinista, y no en una frase dirigida al modelo.
//
// La regla es deliberadamente ESTRECHA, para no volverse un cerrojo:
//   · sólo actúa cuando el motor TIENE una expectativa probada (un corte, un
//     saldo pendiente, el monto de un plan). Sin expectativa no hay con qué
//     contrastar y el monto del usuario manda;
//   · sólo actúa cuando el usuario usó una frase TOTALIZADORA («el total»,
//     «todo», «completo»). Si dijo un número explícito, ese número manda —
//     pagar de menos es legítimo y frecuente;
//   · y NUNCA escribe por su cuenta: devuelve `confirm` para que el ejecutor
//     PREGUNTE. Es la doctrina de J-1 — el motor no adivina, pregunta.

export interface StatedAmountInput {
  /** Lo que el LLM propone escribir. */
  statedAmount: number;
  /** Lo que el motor ya sabe que se debe / se espera. `null` = no hay expectativa. */
  engineExpected: number | null;
  /** El mensaje CRUDO del usuario (no la paráfrasis del modelo). */
  rawMessage: string;
  /** Etiqueta para el mensaje ("la tarjeta", "el préstamo"). */
  subject: string;
  /** Cómo nombrar el monto esperado ("el corte", "lo que debías"). */
  expectedLabel: string;
}

export type StatedAmountPlan =
  | { ok: true }
  | { ok: false; kind: "totalizing_mismatch"; reason: string };

// «pagué el total», «lo pagué todo», «la dejé en cero», «pago completo».
// Se exige una locución REAL, no la palabra suelta: "total" aparece en
// "en total gasté 30" sin ser una declaración de saldar la deuda.
const TOTALIZING = [
  /\b(el|lo|la)\s+(pagu[ée]|pago|abon[ée]|cubr[íi])\s+(todo|completa?o?)\b/i,
  /\bpagu[ée]\s+(el\s+)?total\b/i,
  /\bpago\s+total\b/i,
  // "el total era 743, pero pagué 100" NOMBRA el total, no afirma haberlo
  // pagado. Ese caso se decide con `explicitPartialPayment` abajo; no puede
  // entrar por la mera presencia de "el total".
  /\b(?:cubri|cubrí|abone|aboné|pague|pagué)\s+el\s+total\b/i,
  /\btodo\s+lo\s+que\s+deb[íi]a\b/i,
  /\bla\s+dej[ée]\s+en\s+(cero|0)\b/i,
  /\bqued[óo]\s+en\s+(cero|0)\b/i,
  /\bsald[ée]\s+(la|el)\b/i,
  /\bcompleta?o?\b.{0,12}\b(pagu[ée]|pago|abon[ée])\b/i,
  /\b(pagu[ée]|pago|abon[ée])\b.{0,12}\bcompleta?o?\b/i,
];

export function saysTotalPayment(rawMessage: string): boolean {
  const t = String(rawMessage ?? "");
  return TOTALIZING.some((re) => re.test(t));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Una cifra explícitamente presentada como abono/parcial vence a una mención
// informativa del total. La estructura exige verbo de pago o palabra "parcial";
// un número aislado nunca abre la excepción.
export function saysExplicitPartialPayment(rawMessage: string, statedAmount: number): boolean {
  const t = String(rawMessage ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  const amount = round2(statedAmount);
  if (!(amount > 0)) return false;
  const nums = [...t.matchAll(/[-+]?\d+(?:[.,]\d+)?/g)]
    .map((m) => Number(String(m[0]).replace(",", ".")))
    .filter(Number.isFinite)
    .map(round2);
  if (!nums.some((n) => Math.abs(n - amount) <= 0.01)) return false;
  return (
    /\b(?:abono|abone|pago|pague|pagué)\s+(?:solo\s+)?(?:de\s+)?[-+]?\d/.test(t) ||
    /\b(?:pago|abono)\s+parcial\b/.test(t) ||
    /\b(?:solo|unicamente)\s+(?:pague|abone)\b/.test(t) ||
    /\b(?:pero|aunque)\s+(?:solo\s+)?(?:pague|abone)\s+[-+]?\d/.test(t)
  );
}

export function planStatedAmount(input: StatedAmountInput): StatedAmountPlan {
  const stated = Number(input.statedAmount);
  const expected = input.engineExpected == null ? null : Number(input.engineExpected);
  if (!Number.isFinite(stated) || stated <= 0) return { ok: true }; // otro guard se ocupa
  // Sin expectativa probada no hay contraste posible: el usuario manda.
  if (expected == null || !Number.isFinite(expected) || expected < 0) return { ok: true };
  // "El total era X, pero pagué Y" es un abono explícito. Bloquearlo obligaría
  // a mentir diciendo que todo pago debe saldar el corte.
  if (saysExplicitPartialPayment(input.rawMessage, stated)) return { ok: true };
  if (!saysTotalPayment(input.rawMessage)) return { ok: true };
  // Tolerancia de centavos: una diferencia de redondeo no es una contradicción.
  if (Math.abs(round2(stated) - round2(expected)) <= 0.01) return { ok: true };
  return {
    ok: false,
    kind: "totalizing_mismatch",
    reason:
      `Dijo que pagó el TOTAL de ${input.subject}, pero el monto propuesto (${round2(stated)}) ` +
      `no coincide con ${input.expectedLabel} que tengo guardado (${round2(expected)}). ` +
      `NO registré nada. Preguntá cuál de los dos es el correcto en UNA frase corta y natural — ` +
      `y si el monto salió de otro lado (por ejemplo del saldo de una cuenta que mencionó), decíselo, ` +
      `porque ese número no es lo que debía.`,
  };
}
