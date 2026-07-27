// Bloque J-8 (D3 + D5) — un pago con DOS fuentes no se escribe como si tuviera una.
//
// El caso real (beta, 21/07): «pagué el total con todo lo que tenía en Produbanco
// MÁS un dinero prestado de Alpaca con la diferencia». El executor escribió un
// pago mono-fuente desde Produbanco y, en el MISMO mensaje, preguntó cuánto había
// salido de Alpaca. Escribió una parte sabiendo que faltaba el resto.
//
// Las dos caras del defecto son una sola:
//   · D3 — ningún executor acepta un reparto; el monto es mono-fuente por construcción.
//   · D5 — y por eso escribe lo que puede y pregunta lo que falta, en ese orden.
//
// La regla: si el mensaje declara DOS orígenes para un mismo movimiento, se
// pregunta el reparto ANTES de escribir. No se adivina, no se escribe la mitad.
//
// Deliberadamente conservador: exige una conjunción aditiva EXPLÍCITA («más»,
// «y el resto», «la diferencia», «completé con») entre dos menciones. Una frase
// con dos cuentas pero un solo origen («pasé plata de Galicia a Supervielle») no
// dispara, porque ahí no hay dos fuentes de UN pago.

export interface MultiSourceInput {
  rawMessage: string;
  /** Nombres de cuentas y tarjetas del usuario, para reconocer menciones reales. */
  instrumentNames: string[];
}

export type MultiSourcePlan =
  | { ok: true }
  | { ok: false; mentioned: string[]; reason: string };

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Conjunciones que marcan que un SEGUNDO origen completa el mismo movimiento.
const ADDITIVE = [
  /\bm[áa]s\s+(un|una|el|la|lo|algo|plata|dinero|dolares|d[óo]lares)\b/i,
  /\by\s+(el\s+)?resto\b/i,
  /\bcon\s+la\s+diferencia\b/i,
  /\bla\s+diferencia\s+(con|de|desde)\b/i,
  /\bcomplet[ée]\s+con\b/i,
  /\bel\s+resto\s+(con|de|desde)\b/i,
  /\bparte\s+(con|de|desde)\b.{0,40}\by\s+parte\b/i,
  /\bmitad\b.{0,30}\bmitad\b/i,
];

export function hasAdditiveSecondSource(rawMessage: string): boolean {
  return ADDITIVE.some((re) => re.test(String(rawMessage ?? "")));
}

/** Instrumentos del usuario realmente NOMBRADOS en el mensaje (por nombre completo). */
export function instrumentsMentioned(rawMessage: string, names: string[]): string[] {
  const hay = norm(rawMessage);
  const seen = new Set<string>();
  for (const raw of names) {
    const n = norm(raw);
    if (n.length < 3) continue;
    // Se exige el nombre COMPLETO del instrumento, no una palabra suelta: "banco"
    // aparece en media docena de nombres y no identifica a ninguno.
    if (hay.includes(n)) seen.add(raw);
  }
  return [...seen];
}

export function planMultiSourcePayment(input: MultiSourceInput): MultiSourcePlan {
  if (!hasAdditiveSecondSource(input.rawMessage)) return { ok: true };
  const mentioned = instrumentsMentioned(input.rawMessage, input.instrumentNames);
  if (mentioned.length < 2) return { ok: true };
  return {
    ok: false,
    mentioned,
    reason:
      `Ese pago salió de DOS lados (${mentioned.join(" y ")}) y yo sólo sé registrar un origen por movimiento. ` +
      `NO registré nada todavía —escribir sólo una parte dejaría el otro lado sin contar—. ` +
      `Preguntá en UNA frase cuánto salió de cada uno, y después registrá un movimiento por cada origen.`,
  };
}
