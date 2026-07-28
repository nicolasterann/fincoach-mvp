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
  /** Nombres de cuentas, préstamos y tarjetas del usuario. */
  instrumentNames: string[];
  /** Total que se quiere repartir, cuando el caller ya lo conoce. */
  totalAmount?: number | null;
}

export type MultiSourcePlan =
  | { ok: true; mentioned?: string[]; allocations?: { name: string; amount: number }[] }
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

const NAME_STOPWORDS = new Set([
  "banco", "cuenta", "caja", "ahorro", "ahorros", "tarjeta", "credito",
  "debito", "visa", "mastercard", "master", "amex", "usd", "ars", "eur",
  "mi", "la", "el", "de", "del",
]);

function distinctiveTokens(name: string): string[] {
  return norm(name)
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !NAME_STOPWORDS.has(token));
}

/** Instrumentos realmente nombrados. Acepta el nombre completo o un token
 * distintivo ("Produbanco" reconoce "Banco Produbanco USD"), pero jamás una
 * marca genérica como Visa/Banco. Un alias que identifica dos filas queda
 * ambiguo y no se devuelve como match probado. */
export function instrumentsMentioned(rawMessage: string, names: string[]): string[] {
  const hay = norm(rawMessage);
  const msgTokens = new Set(hay.split(/\s+/));
  const seen = new Set<string>();
  for (const raw of names) {
    const n = norm(raw);
    if (n.length < 3) continue;
    if (hay.includes(n)) seen.add(raw);
  }
  const tokenOwners = new Map<string, string[]>();
  for (const raw of names) {
    for (const token of distinctiveTokens(raw)) {
      const list = tokenOwners.get(token) ?? [];
      list.push(raw);
      tokenOwners.set(token, list);
    }
  }
  for (const [token, owners] of tokenOwners) {
    if (msgTokens.has(token) && owners.length === 1) seen.add(owners[0]);
  }
  return [...seen];
}

const searchable = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.,\s]/g, " ")
    .replace(/\s+/g, " ");

function aliasesFor(name: string): string[] {
  const full = norm(name);
  return [full, ...distinctiveTokens(name)].filter((v, i, a) => v.length >= 3 && a.indexOf(v) === i);
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nearestNamedAmount(rawMessage: string, name: string): number | null {
  const text = searchable(rawMessage);
  const aliases = aliasesFor(name);
  const number = "(?:usd|ars|eur)?\\s*\\$?\\s*([-+]?\\d+(?:[.,]\\d+)?)";
  for (const alias of aliases) {
    const a = regexEscape(alias);
    // Both natural orders, but with a grammatical bond. Pure proximity was
    // unsafe: in "Alpaca 271 y Produbanco la diferencia", the same 271 sat
    // within 42 chars of BOTH names and the follow-up became an infinite ask.
    const patterns = [
      new RegExp(`${number}\\s+(?:de|desde|con|por)\\s+(?:la\\s+|el\\s+)?${a}\\b`, "i"),
      new RegExp(`\\b${a}\\b\\s*(?::|=|por|con)?\\s*${number}`, "i"),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const raw = match?.[1];
      const amount = raw == null ? Number.NaN : Number(raw.replace(",", "."));
      if (Number.isFinite(amount) && amount > 0) {
        return Math.round(amount * 100) / 100;
      }
    }
  }
  return null;
}

export function inferMultiSourceAllocations(
  rawMessage: string,
  names: string[],
  totalAmount: number,
): { name: string; amount: number }[] | null {
  const mentioned = instrumentsMentioned(rawMessage, names);
  if (mentioned.length !== 2 || !(totalAmount > 0)) return null;
  const allocations = mentioned.map((name) => ({ name, amount: nearestNamedAmount(rawMessage, name) }));
  const known = allocations.filter((a): a is { name: string; amount: number } => a.amount != null);
  if (known.length === 2) {
    const sum = Math.round((known[0].amount + known[1].amount) * 100) / 100;
    return Math.abs(sum - Math.round(totalAmount * 100) / 100) <= 0.01 ? known : null;
  }
  const saysDifference = /\b(?:la\s+)?diferencia\b|\b(?:el\s+)?resto\b/i.test(rawMessage);
  if (known.length === 1 && saysDifference) {
    const rest = Math.round((totalAmount - known[0].amount) * 100) / 100;
    if (!(rest > 0)) return null;
    return allocations.map((a) =>
      a.amount == null ? { name: a.name, amount: rest } : { name: a.name, amount: a.amount },
    );
  }
  return null;
}

export function planMultiSourcePayment(input: MultiSourceInput): MultiSourcePlan {
  const mentioned = instrumentsMentioned(input.rawMessage, input.instrumentNames);
  // Dos repartos explícitos ("471 de A y 272 de B") no necesitan la palabra
  // "más"; la aritmética y las dos identidades ya prueban que hay dos fuentes.
  const inferred = input.totalAmount != null
    ? inferMultiSourceAllocations(input.rawMessage, input.instrumentNames, input.totalAmount)
    : null;
  if (inferred) return { ok: true, mentioned, allocations: inferred };
  // Two independently stated named amounts are also a split, even without the
  // word "más". If they do not sum to the total, asking is mandatory; silently
  // falling back to a single source would discard one of them.
  const namedAmounts = mentioned.filter(
    (name) => nearestNamedAmount(input.rawMessage, name) != null,
  );
  if (!hasAdditiveSecondSource(input.rawMessage) && namedAmounts.length < 2) {
    return { ok: true };
  }
  // A second source can be explicit even before the user names its instrument:
  // "con Produbanco más dinero prestado" already proves that a one-source write
  // would be partial. The old `< 2 => ok` reopened the original defect whenever
  // the lender/account name was omitted. Keep "y el resto mañana" out: it has
  // no source noun/preposition and is a payment schedule, not a funding split.
  const unnamedSecondSource =
    /\b(?:m[áa]s|con)\s+(?:un\s+|una\s+|algo\s+de\s+)?(?:dinero|plata)\s+prestad[oa]\b/i.test(input.rawMessage) ||
    /\b(?:el\s+)?(?:resto|diferencia)\s+(?:sali[óo]\s+)?(?:de|desde|con|por)\b/i.test(input.rawMessage) ||
    /\bcomplet[ée]\s+con\s+(?:un\s+|una\s+)?(?:pr[ée]stamo|dinero|plata|otra\s+cuenta)\b/i.test(input.rawMessage);
  if (mentioned.length < 2 && !unnamedSecondSource) return { ok: true };
  return {
    ok: false,
    mentioned,
    reason:
      `Ese pago salió de DOS lados${mentioned.length ? ` (${mentioned.join(" y ")})` : ""} y todavía no tengo un reparto completo que sume el total. ` +
      `NO registré nada —escribir sólo una parte dejaría la otra fuera—. ` +
      `Preguntá en UNA frase cuál fue el otro origen y cuánto salió de cada uno; con ambos montos puedo registrarlo como UNA operación atómica.`,
  };
}
