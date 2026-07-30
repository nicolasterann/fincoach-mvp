// Stage 12 — the deterministic heart of universal capture.
//
// Many evidence sources (text, voice, receipts, screenshots, statements,
// forwarded emails) describe ONE financial reality. The AI extracts candidate
// events; THIS module decides — deterministically — whether a candidate is the
// same real-world transaction as something already recorded, a possible match
// that deserves one short question, or a genuinely new movement. Pure
// functions only: every rule here is exercised by the build-time gate.

import type { StoredTransaction } from "@/lib/financial/transaction-recovery";

// ── Candidate events (what extraction produces) ──────────────────────────────

export type CandidateKind =
  | "expense"
  | "income"
  | "transfer"
  | "card_payment"
  | "refund"
  | "unknown";

export interface CandidateEvent {
  kind: CandidateKind;
  amount: number;
  /** ISO currency when the evidence SHOWS it. Undefined = unknown (never
   *  silently assumed USD); resolved later from trusted account context. */
  currency?: string;
  /** Merchant / counterparty / concept as seen in the evidence. */
  merchant?: string;
  /** ISO date (YYYY-MM-DD) when the evidence states one. */
  dateISO?: string;
  /** Bank reference / authorization code — the strongest identity signal. */
  externalRef?: string;
  /** Account or card NAME hinted by the evidence (e.g. "Visa", "Pichincha"). */
  accountHint?: string;
  /** True when the evidence marks it as pending/authorization, not posted. */
  pending?: boolean;
  /** Extraction confidence 0..1 (model-reported, clamped). */
  confidence?: number;
  /** A short visible fragment from the evidence, for audit/clarification. */
  sourceSnippet?: string;
}

// ── Match verdicts ───────────────────────────────────────────────────────────

export type MatchVerdict =
  | "duplicate" // same real-world transaction, do NOT write again
  | "likely_match" // probably the same — ask one short question
  | "new"; // genuinely new movement

export interface MatchResult {
  verdict: MatchVerdict;
  matchedTransactionId?: string;
  matchedDescription?: string;
  reason: string;
}

const DAY_MS = 86_400_000;

function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Token-overlap similarity, robust to "MCDONALDS GUAYAQUIL EC" vs "McDonald's".
export function merchantSimilarity(a: string, b: string): number {
  const ta = new Set(normText(a).split(" ").filter((w) => w.length >= 3));
  const tb = new Set(normText(b).split(" ").filter((w) => w.length >= 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const w of ta) {
    if (tb.has(w)) hits += 1;
    else {
      for (const v of tb) {
        if (v.includes(w) || w.includes(v)) {
          hits += 0.7;
          break;
        }
      }
    }
  }
  return Math.min(1, hits / Math.min(ta.size, tb.size));
}

// Strict calendar validation: rejects 2026-02-31, 2026-13-01, etc. (JS Date
// would silently roll these over). Pure and shared with extraction normalize.
export function isValidISODate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function daysApart(aISO: string | undefined, bISO: string): number | null {
  if (!aISO || !isValidISODate(aISO)) return null;
  const a = Date.parse(`${aISO}T00:00:00Z`);
  const b = new Date(bISO).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b) / DAY_MS;
}

// EXACT to the cent. Only an exact amount can support a silent duplicate.
function amountExact(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.01;
}

// Close but NOT exact (tips/FX drift). Supports asking a clarifying question,
// never a silent merge — different amounts must never be merged automatically.
function amountApprox(a: number, b: number): boolean {
  if (amountExact(a, b)) return false;
  return Math.abs(a - b) / Math.max(a, b) <= 0.02;
}

// A candidate kind is compatible with a ledger row type when they could
// describe the same real movement. Used so an identical bank reference on, say,
// an income row never gets merged with an expense candidate.
function typeCompatible(kind: CandidateKind, txType: string): boolean {
  const t = txType.toLowerCase();
  switch (kind) {
    case "expense":
      return t === "expense";
    case "income":
      return t === "income";
    case "refund":
      return t === "refund" || t === "income" || t === "reversal";
    case "card_payment":
      return t === "debt_payment";
    case "transfer":
      return t === "transfer" || t === "goal_contribution";
    case "unknown":
      return true; // can't constrain an unknown kind
    default:
      return true;
  }
}

// Names of the accounts/cards a ledger row touches, when resolvable.
function txSourceLabels(
  tx: StoredTransaction,
  labels?: Map<string, string>,
): string[] {
  if (!labels) return [];
  return [tx.sourceAccountId, tx.destinationAccountId, tx.debtAccountId]
    .filter((id): id is string => Boolean(id))
    .map((id) => labels.get(id))
    .filter((name): name is string => Boolean(name));
}

// True only when the evidence explicitly names a source AND we can resolve the
// row's source(s) AND none of them match the hint — i.e. the SAME reference
// seen on a DIFFERENT card/account. When the row's source can't be resolved we
// return false (don't manufacture a conflict from missing data).
function sourceConflicts(
  candidate: CandidateEvent,
  tx: StoredTransaction,
  labels?: Map<string, string>,
): boolean {
  if (!candidate.accountHint) return false;
  const names = txSourceLabels(tx, labels);
  if (names.length === 0) return false;
  return !names.some((name) => merchantSimilarity(candidate.accountHint as string, name) >= 0.5);
}

export interface MatchOptions {
  now?: Date;
  /** id → lowercased account/card name, to scope a bank reference to its
   *  financial source. When omitted, source scoping is simply skipped. */
  accountLabels?: Map<string, string>;
}

// Strength of a candidate↔row pairing. Higher always wins, so the matcher
// returns the STRONGEST match in the whole recent set, not the first plausible
// one (a weak likely_match can never hide a later exact-reference duplicate).
//   30 exact reference + amount + currency + type + same source → duplicate
//   20 exact amount + near date + similar merchant + same source → duplicate
//   12 exact reference, supporting signal disagrees                → ask
//   11 exact amount + near date, weak merchant OR source conflict  → ask
//   10 approximate amount + near date                              → ask
//    0 no relation
interface Scored {
  strength: number;
  verdict: MatchVerdict;
  tx: StoredTransaction;
  reason: string;
  tiebreak: number; // higher = better within the same strength
}

function scorePair(
  candidate: CandidateEvent,
  tx: StoredTransaction,
  options: MatchOptions,
  now: Date,
): Scored | null {
  if (tx.type === "reversal" || tx.type === "adjustment") return null;

  const exact = amountExact(candidate.amount, tx.originalAmount);
  const approx = amountApprox(candidate.amount, tx.originalAmount);
  const currencyOk =
    !candidate.currency || !tx.originalCurrency || candidate.currency === tx.originalCurrency;
  const typeOk = typeCompatible(candidate.kind, tx.type);
  const conflict = sourceConflicts(candidate, tx, options.accountLabels);
  const sim = candidate.merchant ? merchantSimilarity(candidate.merchant, tx.description) : 0;

  const gap = daysApart(candidate.dateISO, tx.occurredAt);
  const createdGap = Math.abs(now.getTime() - new Date(tx.createdAt).getTime()) / DAY_MS;
  const dateNear = gap !== null ? gap <= 2 : createdGap <= 2;
  const dateScore = gap !== null ? Math.max(0, 2 - gap) : Math.max(0, 2 - createdGap);

  const txRef = (tx as StoredTransaction & { externalRef?: string | null }).externalRef;
  const refEqual = Boolean(
    candidate.externalRef && txRef && normText(candidate.externalRef) === normText(txRef),
  );

  // Exact reference is the strongest identity, but ONLY with consistent amount,
  // currency, type and source. Otherwise it can only ASK (and only when the
  // amount is at least close — a bare ref collision on an unrelated amount is
  // not even a question).
  if (refEqual) {
    if (exact && currencyOk && typeOk && !conflict) {
      return {
        strength: 30,
        verdict: "duplicate",
        tx,
        tiebreak: 1 + sim,
        reason: `misma referencia bancaria (${candidate.externalRef}) con monto, tipo y origen consistentes`,
      };
    }
    if ((exact || approx) && currencyOk) {
      return {
        strength: 12,
        verdict: "likely_match",
        tx,
        tiebreak: sim,
        reason: `referencia ${candidate.externalRef} parecida a "${tx.description}" pero con algún dato distinto (monto/tipo/cuenta) — confirma si es el mismo`,
      };
    }
  }

  if (!currencyOk || !dateNear) return null;

  if (exact) {
    if (sim >= 0.5 && !conflict) {
      return {
        strength: 20,
        verdict: "duplicate",
        tx,
        tiebreak: sim + dateScore,
        reason: `mismo monto (${candidate.amount}), fecha cercana y comercio parecido ("${tx.description}")`,
      };
    }
    return {
      strength: 11,
      verdict: "likely_match",
      tx,
      tiebreak: sim + dateScore,
      reason: conflict
        ? `mismo monto (${candidate.amount}) que "${tx.description}" pero en otra cuenta/tarjeta — confirma si es el mismo`
        : `mismo monto (${candidate.amount}) y fecha cercana a "${tx.description}" — podría ser el mismo`,
    };
  }

  if (approx) {
    return {
      strength: 10,
      verdict: "likely_match",
      tx,
      tiebreak: sim + dateScore,
      reason: `monto parecido (${candidate.amount} vs ${tx.originalAmount}) y fecha cercana a "${tx.description}" — confirma si es el mismo o un cobro aparte`,
    };
  }

  return null;
}

// Evaluate the candidate against ALL recent rows and return the STRONGEST
// match. A duplicate verdict requires an exact amount (never approximate) plus
// either a consistent bank reference or a near-date similar-merchant match on
// the same financial source.
export function matchCandidate(
  candidate: CandidateEvent,
  recent: StoredTransaction[],
  options?: MatchOptions,
): MatchResult {
  const now = options?.now ?? new Date();
  const opts = options ?? {};

  let best: Scored | null = null;
  for (const tx of recent) {
    const scored = scorePair(candidate, tx, opts, now);
    if (!scored) continue;
    if (
      !best ||
      scored.strength > best.strength ||
      (scored.strength === best.strength && scored.tiebreak > best.tiebreak)
    ) {
      best = scored;
    }
  }

  if (!best) return { verdict: "new", reason: "sin coincidencias en movimientos recientes" };
  return {
    verdict: best.verdict,
    matchedTransactionId: best.tx.id,
    matchedDescription: best.tx.description,
    reason: best.reason,
  };
}

// ── Semantic real-world duplicate safeguard (typed/voice after evidence) ─────
// SEPARATE from technical replay idempotency (operation namespace + dedupe key,
// which only catches a redelivery of the SAME channel operation). This catches
// the SAME real-world event expressed through a DIFFERENT operation identity —
// e.g. a receipt wrote it, then the user types it again. It is deliberately
// conservative: a strong EXACT match (same type, amount, currency, source/card
// AND date proximity) returns true so the agent ASKS one short question; it
// never suppresses, and "same merchant + amount" alone is NOT enough (merchant
// is not even considered). The user can confirm it is a different movement.
export interface RecentMovementKey {
  type: string;
  cents: number;
  currency: string;
  /** source account OR debt/card the money moved through. */
  sourceId: string | null;
  occurredAtMs: number;
  /** Momento en que Kipu registró la fila. Una corrección se vincula a una
   *  captura reciente aunque cambie precisamente la fecha contable. */
  createdAtMs?: number;
  // S5 near-duplicate only: a tight merchant grouping token + category. Optional so
  // the exact-duplicate matcher (which ignores them) is completely unaffected.
  merchantToken?: string | null;
  /** Identidad estrecha de descripción para correcciones de monto en ingresos,
   *  pagos y aportes (near-duplicate sigue limitado a gastos). */
  correctionToken?: string | null;
  category?: string | null;
  // J-2: la corrección necesita SEÑALAR la fila a corregir, no solo saber que existe.
  // Opcionales por la misma razón: los dos matchers de arriba no los miran.
  id?: string;
  description?: string | null;
  /** L-1: un reembolso HEREDA el registro del original (Bloque H), así que la
   *  derivación necesita también cómo se registró aquel gasto. */
  budgetTreatment?: string | null;
  /** Refunds persist this link. It lets a later partial refund compare against
   *  the still-unrefunded native amount instead of crediting the same purchase
   *  twice. */
  relatedTransactionId?: string | null;
  /** Provenance that determines whether the original was already reserved by
   * the recurring/installment engines and therefore never drained Saldo. */
  recurringExpenseId?: string | null;
  externalRef?: string | null;
}

export interface RefundOriginalMatch {
  id: string;
  category: string | null;
  budgetTreatment: string | null;
  description: string | null;
  originalCents: number;
  remainingCents: number;
  occurredAtMs: number;
  recurringExpenseId: string | null;
  externalRef: string | null;
}

export type RefundOriginalResult =
  | { outcome: "unique"; original: RefundOriginalMatch }
  | { outcome: "none" }
  | { outcome: "invalid_id"; originalTransactionId: string }
  | {
      outcome: "ambiguous";
      count: number;
      candidates: readonly RefundOriginalMatch[];
    };

/**
 * L-1 — de qué compra es este reembolso.
 *
 * El Bloque H ya dice que un reembolso hereda el registro del original, pero eso
 * vivía SOLO como instrucción del prompt, y una instrucción de prompt no es un
 * guard: el ejecutor caía a `category: "other"`, con lo que el reembolso no
 * neteaba el objetivo ni restauraba el tanque.
 *
 * Deliberadamente estrecho: sólo un GASTO no revertido, misma moneda y monto
 * todavía no reembolsado suficiente. Un parcial exige el comercio inequívoco o
 * un transaction id probado; jamás se deriva sólo porque exista una compra más
 * grande. Con varios candidatos, la ambigüedad pregunta y nunca elige la primera
 * fila.
 */
export function refundOriginalTarget(input: {
  amount: number;
  currency: string;
  message: string;
  recent: readonly RecentMovementKey[];
  nowMs: number;
  originalTransactionId?: string | null;
  windowDays?: number;
}): RefundOriginalResult {
  const cents = Math.round(input.amount * 100);
  if (!Number.isFinite(cents) || cents <= 0) return { outcome: "none" };
  const currency = (input.currency || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { outcome: "none" };
  const windowMs = Math.max(1, input.windowDays ?? 60) * 24 * 60 * 60 * 1000;
  const refundedByOriginal = new Map<string, number>();
  for (const row of input.recent) {
    if (row.type !== "refund" || !row.relatedTransactionId) continue;
    refundedByOriginal.set(
      row.relatedTransactionId,
      (refundedByOriginal.get(row.relatedTransactionId) ?? 0) + row.cents,
    );
  }
  const candidates = input.recent.flatMap((row) => {
    if (row.type !== "expense" || !row.id) return [];
    if ((row.currency || "").toUpperCase() !== currency) return [];
    const at = row.createdAtMs ?? row.occurredAtMs;
    if (!Number.isFinite(at)) return [];
    if (input.nowMs - at > windowMs || at - input.nowMs > 5 * 60_000) {
      return [];
    }
    const remainingCents =
      row.cents - (refundedByOriginal.get(row.id) ?? 0);
    return remainingCents >= cents ? [{ row, remainingCents }] : [];
  });
  const explicitId = input.originalTransactionId?.trim();
  if (candidates.length === 0) {
    return explicitId
      ? { outcome: "invalid_id", originalTransactionId: explicitId }
      : { outcome: "none" };
  }
  const asMatch = ({
    row,
    remainingCents,
  }: {
    row: RecentMovementKey;
    remainingCents: number;
  }): RefundOriginalMatch => ({
    id: row.id as string,
    category: row.category ?? null,
    budgetTreatment: row.budgetTreatment ?? null,
    description: row.description ?? null,
    originalCents: row.cents,
    remainingCents,
    occurredAtMs: row.occurredAtMs,
    recurringExpenseId: row.recurringExpenseId ?? null,
    externalRef: row.externalRef ?? null,
  });
  const pick = (
    rows: readonly { row: RecentMovementKey; remainingCents: number }[],
  ): RefundOriginalResult =>
    rows.length === 1
      ? {
          outcome: "unique",
          original: asMatch(rows[0]),
        }
      : {
          outcome: "ambiguous",
          count: rows.length,
          candidates: rows.map(asMatch),
        };

  if (explicitId) {
    const exactId = candidates.filter(({ row }) => row.id === explicitId);
    return exactId.length === 1
      ? pick(exactId)
      : { outcome: "invalid_id", originalTransactionId: explicitId };
  }

  // A full refund (or the exact remaining part after a prior partial refund)
  // may be matched by native cents. A partial refund requires stronger merchant
  // evidence; amount alone is deliberately insufficient.
  const exactAmount = candidates.filter(
    ({ remainingCents }) => remainingCents === cents,
  );
  if (exactAmount.length === 1) return pick(exactAmount);
  // Desempate por el comercio que el mensaje NOMBRA. `merchantSimilarity` ya es
  // el criterio del resto de la captura; un token de menos de 3 caracteres no
  // sujeta nada y no se usa para elegir dinero.
  const merchantPool = exactAmount.length > 1 ? exactAmount : candidates;
  const named = merchantPool.filter(({ row }) => {
    const token = (row.merchantToken ?? "").trim();
    if (token.length < 3) return false;
    return merchantSimilarity(token, input.message) >= 0.6;
  });
  return named.length === 1
    ? pick(named)
    : {
        outcome: "ambiguous",
        count: merchantPool.length,
        candidates: merchantPool.map(asMatch),
      };
}

export function recentExactDuplicate(
  candidate: RecentMovementKey,
  recent: RecentMovementKey[],
  opts: { windowMs: number },
): boolean {
  if (!Number.isFinite(candidate.occurredAtMs)) return false;
  return recent.some(
    (r) =>
      r.type === candidate.type &&
      r.cents === candidate.cents &&
      (r.currency || "").toUpperCase() === (candidate.currency || "").toUpperCase() &&
      (r.sourceId ?? "") === (candidate.sourceId ?? "") &&
      Number.isFinite(r.occurredAtMs) &&
      Math.abs(r.occurredAtMs - candidate.occurredAtMs) <= opts.windowMs,
  );
}

// Only block on a category MISMATCH when BOTH name a specific (non-empty, non-"other")
// category — otherwise merchant+amount+date already carry the signal and we don't want
// a blank/other category to suppress a real near-duplicate.
function sameSpecificCategory(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = (a ?? "").trim().toLowerCase();
  const nb = (b ?? "").trim().toLowerCase();
  if (!na || !nb || na === "other" || nb === "other") return true;
  return na === nb;
}

// S5 — NEAR-duplicate safeguard. The exact matcher above requires the SAME source, so
// it misses the same real-world expense re-entered against a DIFFERENT account/card —
// e.g. "McDonald's on the card" vs "McDonalds on cash" (the founder's real case). This
// fires ONLY for expenses that carry a confident merchant token, with the exact same
// amount + currency, a matching category (when both name a specific one), and date
// proximity — regardless of which account/card. Like the exact check it is an ASK
// signal (the agent asks "¿el mismo o dos compras?"); it NEVER suppresses a write.
// Deliberately conservative to avoid nagging on genuine repeats.
export function recentNearDuplicate(
  candidate: RecentMovementKey,
  recent: RecentMovementKey[],
  opts: { windowMs: number },
): boolean {
  if (candidate.type !== "expense") return false;
  const token = (candidate.merchantToken ?? "").trim();
  if (token.length < 3) return false;
  if (!Number.isFinite(candidate.occurredAtMs)) return false;
  return recent.some(
    (r) =>
      r.type === "expense" &&
      r.cents === candidate.cents &&
      (r.currency || "").toUpperCase() === (candidate.currency || "").toUpperCase() &&
      (r.merchantToken ?? "") === token &&
      sameSpecificCategory(r.category, candidate.category) &&
      Number.isFinite(r.occurredAtMs) &&
      Math.abs(r.occurredAtMs - candidate.occurredAtMs) <= opts.windowMs,
  );
}

// ── Una CORRECCIÓN no es un movimiento nuevo ────────────────────────────────
// El error real del founder: «no era con Pichincha, era Supervielle» terminó
// registrando un gasto NUEVO en vez de corregir el que ya existía — dos veces el
// mismo dinero. Las dos defensas de arriba no lo ven, y no por casualidad:
//   · `recentExactDuplicate` exige el MISMO `sourceId`, y corregir la cuenta
//     cambia el `sourceId` por definición ⇒ jamás puede dispararse.
//   · `recentNearDuplicate` solo cubre `expense` CON token de comercio, así que
//     corregir la cuenta de un ingreso, un pago de deuda o un aporte a meta —o de
//     un gasto que el agente redescribió— no tiene ninguna defensa.
// La señal que sí es determinista: el usuario está REFORMULANDO algo, y existe un
// movimiento reciente compatible al que se refiere. Las dos condiciones juntas, y
// calculadas por el ejecutor (nunca un booleano que el LLM se auto-asigna).

/** Reformulación correctiva en español LatAm. Deliberadamente estrecha: exige el
 *  verbo de la corrección, no un «no» suelto («no, gasté 50 en el súper» es una
 *  captura nueva y NO debe entrar aquí). */
export function correctivePhrasing(message: string): boolean {
  const m = (message ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  if (!m.trim()) return false;

  // Señales FUERTES: el usuario nombra la corrección, contrapone dos montos,
  // dos categorías/fechas o dos instrumentos. No usamos un blacklist de
  // locuciones después de `no + preposición`: es imposible enumerar lenguaje
  // natural ("no en realidad", "no por mucho", "no con ganas"...), y desde
  // que una corrección sin target falla cerrada cada falso positivo bloquea un
  // movimiento legítimo.
  // Un `de` OPCIONAL entre el verbo y el valor: «no era de 200, era de 250» y
  // «no era de comida, era de transporte» son correcciones corrientes y se
  // perdían. No afloja la estructura — el contraste de DOS lados sigue siendo
  // obligatorio —, solo deja de exigir que el valor pegue con el verbo. Un
  // falso negativo aquí reabre el duplicado, que es el bug que J-2 existe para
  // impedir.
  const explicitCorrection =
    /\b(?:me equivoque|corrige(?:me|lo|la|melo|mela)?|corregir|correccion|quise decir)\b/.test(m);
  const amountContrast =
    /\bno (?:era|fue|eran|fueron|es|son) (?:de )?[-+]?\d+(?:[.,]\d+)?\b[^,;:.!?]{0,20}(?:[,;:]|\bsino\b)\s*(?:(?:era|fue|eran|fueron|es|son)\s+)?(?:de )?[-+]?\d+(?:[.,]\d+)?\b/.test(m);
  const namedFieldContrast =
    /\bno (?:era|fue|eran|fueron|es|son) (?:de )?(?:ayer|hoy|anteayer|comida|transporte|compras?|salud|educacion|entretenimiento|viaje|vivienda|servicios?|suscripciones?)\b[^,;:.!?]{0,20}(?:[,;:]|\bsino\b)\s*(?:(?:era|fue|eran|fueron|es|son)\s+)?(?:de )?(?:ayer|hoy|anteayer|comida|transporte|compras?|salud|educacion|entretenimiento|viaje|vivienda|servicios?|suscripciones?)\b/.test(m);
  // Orden "no era con X, era Y". El segundo verbo es obligatorio: evita que
  // "no era con ganas, gasté 500" se convierta en corrección. Pero NO puede
  // limitarse a ser/ir: «no fue a Pichincha, entró a Supervielle» es la
  // corrección de la cuenta de un INGRESO, y ese caso no tiene ninguna otra
  // defensa (la cercana solo mira gastos). Se admite el mismo juego de verbos de
  // movimiento que el orden inverso de abajo; la estructura —dos instrumentos en
  // dos cláusulas— sigue siendo obligatoria.
  // La distinción no es el verbo, es la SEGUNDA cláusula: una corrección nombra
  // otro destino («entró a Supervielle»), una captura solo dice cuánto («gasté
  // 500»). Por eso ser/ir admite preposición opcional —«era Supervielle»— y todo
  // verbo de movimiento la EXIGE. Así «no era con ganas, gasté 500» sigue siendo
  // una captura y «no fue a Pichincha, entró a Supervielle» vuelve a ser la
  // corrección de la cuenta de un ingreso.
  const correctedInstrumentFirst =
    /\bno (?:era|fue|es) (?:con|desde|a|via) [^,;:.!?]{1,40}[,;:]\s*(?:sino\s+)?(?:(?:era|fue|es)\s+(?:(?:con|desde|de|a|en|por|via)\s+)?[\p{L}\p{N}]|(?:salio|entro|entraron|pague|pagaron|gaste|cobre|cobraron|deposite|depositaron|transferi|transfirieron)\s+(?:con|desde|de|a|en|por|via)\s+[\p{L}\p{N}])/u.test(m);
  // Orden real del founder: "fue desde Supervielle, no desde Pichincha".
  // Exige un verbo de movimiento Y dos lados con preposición; un `no en serio`
  // aislado nunca alcanza.
  const originalThenCorrection =
    /\b(?:fue|era|salio|entro|pague|gaste|cobre|deposite|transferi)\s+(?:con|desde|a|via)\s+[^,;:.!?]{1,48}?(?:[,;:]?\s+)no\s+(?:con|desde|a|via)\s+[\p{L}\p{N}]/u.test(m);
  const realityCorrection =
    /\ben realidad (?:era|fue|eran|fueron|es|son) (?:con|desde|a|via|ayer|hoy|anteayer|[-+]?\d)/.test(m);
  // J-8 — una FAMILIA ENTERA que J-2 no veía, encontrada revisando el chat real:
  // el usuario NO usa la forma «no era X, era Y». Afirma el valor correcto y
  // CUESTIONA el que Kipu escribió: «Pero el pago fue de $743.93, ¿de dónde
  // sacaste el $552.77?». Sobre esa frase `correctivePhrasing` daba false, así que
  // la corrección se convirtió en un pago NUEVO y la deuda bajó dos veces.
  //
  // Se mantiene la exigencia estructural del resto del archivo —dos lados, nunca
  // una palabra suelta— porque un falso positivo falla CERRADO y bloquearía una
  // captura legítima:
  //   · o el usuario interpela una cifra ATRIBUIDA a Kipu («de dónde sacaste N»),
  //   · o contrapone su cifra con un «pero/en realidad» Y hay OTRA cifra en el
  //     mensaje (una sola cifra tras «pero» puede ser una captura corriente).
  const challengedFigure =
    /\b(?:de donde (?:sacaste|salio|saliste)|por que (?:pusiste|registraste|anotaste|cargaste|cobraste)|quien te dijo)\b[^?.!]{0,40}[-+]?\d/.test(m);
  const twoFigures = (m.match(/[-+]?\d+(?:[.,]\d+)?/g) ?? []).length >= 2;
  const contrastiveRestatement =
    twoFigures &&
    /\b(?:pero|en realidad|realmente)\b[^.!?]{0,45}\b(?:era|fue|eran|fueron|es|son)\s+(?:de\s+)?[-+]?\d/.test(m);
  // "¿Por qué anotaste 30? Ese es OTRO pago nuevo" cuestiona el contexto, no
  // reemplaza el movimiento anterior. Desde J-2 un falso positivo falla
  // cerrado, así que la evidencia explícita de una operación ADICIONAL debe
  // vencer a challengedFigure. No se activa por "más" suelto: exige nuevo/otro
  // movimiento o una secuencia temporal con un segundo verbo financiero.
  const explicitlyAdditional =
    /\b(?:ese|este|esto)\s+(?:es|fue)\s+(?:otro|un)\s+(?:pago|gasto|abono|movimiento)\s+nuevo\b/.test(m) ||
    /\b(?:otro|un\s+nuevo)\s+(?:pago|gasto|abono|movimiento)\b/.test(m) ||
    /\b(?:luego|despues|más tarde)\s+(?:pague|abone|gaste|transferi|cobre|deposite)\b/.test(m);

  return (
    explicitCorrection ||
    amountContrast ||
    namedFieldContrast ||
    correctedInstrumentFirst ||
    originalThenCorrection ||
    realityCorrection ||
    (challengedFigure && !explicitlyAdditional) ||
    (contrastiveRestatement && !explicitlyAdditional) ||
    /\bperdon,? (?:era|fue|eran|fueron) (?:con|desde|a|via|[-+]?\d)/.test(m)
  );
}

export function correctionIdentityToken(description: string | null | undefined): string {
  return normText(description ?? "");
}

/** Los movimientos recientes a los que esa reformulación puede referirse, del más
 *  nuevo al más viejo. Vacío NO autoriza una escritura: el caller debe pedir
 *  precisión, porque la intención ya fue clasificada como corrección.
 *  Empareja por lo que la corrección NO cambia: el mismo monto (cambió la cuenta,
 *  la categoría o la fecha) o la misma identidad descriptiva (cambió el monto). */
export function movementCorrectionTargets(
  message: string,
  candidate: RecentMovementKey,
  recent: RecentMovementKey[],
  opts: { windowMs: number },
): RecentMovementKey[] {
  if (!correctivePhrasing(message)) return [];
  const candidateCapturedAt = candidate.createdAtMs ?? candidate.occurredAtMs;
  if (!Number.isFinite(candidateCapturedAt)) return [];
  const token = (candidate.correctionToken ?? "").trim();
  const cur = (candidate.currency || "").toUpperCase();
  return recent
    .filter((r) => {
      if (r.type !== candidate.type) return false;
      const capturedAt = r.createdAtMs ?? r.occurredAtMs;
      if (!Number.isFinite(capturedAt)) return false;
      if (Math.abs(capturedAt - candidateCapturedAt) > opts.windowMs) return false;
      const sameAmount = r.cents === candidate.cents && (r.currency || "").toUpperCase() === cur;
      const sameIdentity = token.length >= 3 && (r.correctionToken ?? "") === token;
      return sameAmount || sameIdentity;
    })
    .sort(
      (a, b) =>
        (b.createdAtMs ?? b.occurredAtMs) -
        (a.createdAtMs ?? a.occurredAtMs),
    );
}

export type RefundRegistrationDecision =
  | {
      outcome: "resolved";
      category: string;
      budgetTreatment: "saldo" | "objective" | null;
      relatedTransactionId: string | null;
      recurringExpenseId: string | null;
      originalExternalRef: string | null;
      derived: boolean;
    }
  | {
      outcome: "ask";
      reason: "ambiguous" | "unknown" | "unreadable" | "invalid_original";
      candidates: number;
      options: readonly RefundOriginalMatch[];
    };

/**
 * L-1 — decisión PURA de con qué registro entra un reembolso.
 *
 * Reglas, en este orden:
 *  1. Lectura ilegible/incompleta ⇒ preguntar. El payload del modelo no reemplaza
 *     una lectura financiera.
 *  2. Un original ÚNICO gana: categoría, `budget_treatment` (incluido NULL) e id
 *     se heredan literalmente.
 *  3. Varios originales ⇒ preguntar. La ambigüedad no se abre con una categoría
 *     propuesta por el modelo.
 *  4. Sin original, sólo la confirmación explícita de que nunca se registró
 *     permite mover caja como `other`, sin tocar objetivo ni Saldo.
 */
export function refundRegistrationDecision(input: {
  original: RefundOriginalResult | null;
  confirmedUnrecorded: boolean;
  isValidCategory: (value: string) => boolean;
}): RefundRegistrationDecision {
  const found = input.original;
  if (found === null) {
    return {
      outcome: "ask",
      reason: "unreadable",
      candidates: 0,
      options: [],
    };
  }
  if (found?.outcome === "unique") {
    const inherited = found.original.category;
    const treatment = found.original.budgetTreatment;
    if (
      !inherited ||
      !input.isValidCategory(inherited) ||
      (treatment !== null &&
        treatment !== "saldo" &&
        treatment !== "objective") ||
      (treatment !== null &&
        inherited !== "food" &&
        inherited !== "transport")
    ) {
      return {
        outcome: "ask",
        reason: "invalid_original",
        candidates: 1,
        options: [found.original],
      };
    }
    return {
      outcome: "resolved",
      category: inherited,
      // NULL is a real historical fact: objective-by-default. Never replace it
      // with a model proposal.
      budgetTreatment: treatment,
      relatedTransactionId: found.original.id,
      recurringExpenseId: found.original.recurringExpenseId,
      originalExternalRef: found.original.externalRef,
      derived: true,
    };
  }
  if (found?.outcome === "ambiguous") {
    return {
      outcome: "ask",
      reason: "ambiguous",
      candidates: found.count,
      options: found.candidates,
    };
  }
  if (found?.outcome === "invalid_id") {
    return {
      outcome: "ask",
      reason: "invalid_original",
      candidates: 0,
      options: [],
    };
  }
  if (input.confirmedUnrecorded) {
    return {
      outcome: "resolved",
      // The cash really arrived, but no original exists in Kipu to net. `other`
      // moves the account without fabricating objective or Saldo capacity.
      category: "other",
      budgetTreatment: null,
      relatedTransactionId: null,
      recurringExpenseId: null,
      originalExternalRef: null,
      derived: false,
    };
  }
  return {
    outcome: "ask",
    reason: "unknown",
    candidates: 0,
    options: [],
  };
}

/** Evidence gate for the only safe unlinked refund path. The model's boolean is
 * not authority by itself: the user's current message must explicitly say that
 * the original purchase was never recorded in Kipu. */
export function refundOriginalWasNotRecorded(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const directStatement =
    /^(?:no|nunca)\s+(?:lo|la)\s+(?:registre|anote|cargue)$/.test(
      normalized,
    ) ||
    /\b(?:no|nunca)\s+(?:lo|la|esa compra|ese gasto)?\s*(?:registre|anote|cargue)\s+(?:en\s+kipu|aqui|en\s+la\s+app|como\s+(?:gasto|compra))\b/.test(
      normalized,
    );
  return (
    directStatement ||
    /\b(?:no|nunca)\s+(?:esta|estaba|aparece|aparecia)\s+(?:registrad[oa]\s+)?(?:en\s+)?kipu\b/.test(
      normalized,
    ) ||
    /\b(?:la|esa|aquella)\s+compra\s+(?:no|nunca)\s+(?:esta|estaba|fue)\s+(?:registrada|anotada)\b/.test(
      normalized,
    ) ||
    /\b(?:el|ese|aquel)\s+gasto\s+(?:no|nunca)\s+(?:esta|estaba|fue)\s+(?:registrado|anotado)\b/.test(
      normalized,
    )
  );
}

// Statement reconciliation: classify every row in one pass.
export interface StatementRowResult {
  candidate: CandidateEvent;
  match: MatchResult;
}

export function reconcileStatementRows(
  rows: CandidateEvent[],
  recent: StoredTransaction[],
  options?: MatchOptions,
): {
  known: StatementRowResult[];
  uncertain: StatementRowResult[];
  fresh: StatementRowResult[];
} {
  const known: StatementRowResult[] = [];
  const uncertain: StatementRowResult[] = [];
  const fresh: StatementRowResult[] = [];
  // Match against a shrinking pool so one recorded tx can't "absorb" two
  // different statement rows (two real same-amount purchases stay separate).
  const pool = [...recent];
  for (const candidate of rows) {
    const match = matchCandidate(candidate, pool, options);
    if (match.verdict === "duplicate") {
      known.push({ candidate, match });
      const idx = pool.findIndex((t) => t.id === match.matchedTransactionId);
      if (idx >= 0) pool.splice(idx, 1);
    } else if (match.verdict === "likely_match") {
      uncertain.push({ candidate, match });
    } else {
      fresh.push({ candidate, match });
    }
  }
  return { known, uncertain, fresh };
}

// ── Statement → registered card resolution ───────────────────────────────────
// A card statement belongs to ONE registered card. Resolving it deterministically
// (here, not per-turn in the LLM) means the SAME card is used for the obligations
// update AND for any payment/abono row the statement contains — so an unresolved
// payment can never be re-matched to a DIFFERENT card in a later turn. It is
// conservative: it returns a single match ONLY when one card is clearly ahead;
// otherwise it asks (ambiguous) or flags the card as unregistered (offer to add).
export interface DebtAccountLite {
  id: string;
  name: string;
  currency?: string;
}

export type StatementCardResolution =
  | { kind: "matched"; account: DebtAccountLite }
  | { kind: "ambiguous"; candidates: DebtAccountLite[] }
  | { kind: "unregistered" };

const STATEMENT_CARD_STRONG = 0.6; // top score to accept a single card outright
const STATEMENT_CARD_WEAK = 0.34; // below this against every card → unregistered
const STATEMENT_CARD_MARGIN = 0.2; // top must beat the runner-up by this to win

// Generic bank/network/tier words that should NOT drive a confident card match
// — "Banco Pichincha Mastercard" must not match "Mastercard Produbanco" on the
// shared network word (the real-incident failure). The DISTINCTIVE part (the
// bank/owner brand, e.g. "pichincha") is what identifies the card.
const GENERIC_CARD_WORDS = new Set([
  "banco", "bank", "tarjeta", "card", "credito", "credit", "debito", "debit",
  "visa", "mastercard", "master", "amex", "american", "express", "diners",
  "discover", "oro", "gold", "platinum", "black", "clasica", "classic",
  "signature", "infinite", "credencial", "cuenta", "estado",
]);

function distinctiveCardText(name: string): string {
  return normText(name)
    .split(" ")
    .filter((w) => w.length >= 3 && !GENERIC_CARD_WORDS.has(w))
    .join(" ");
}

// Card name similarity that ignores generic bank/network words when both names
// still have a distinctive part; falls back to the full name when one side is
// only generic words (e.g. a card literally named "Visa").
function cardNameScore(statementName: string, cardName: string): number {
  const ds = distinctiveCardText(statementName);
  const dc = distinctiveCardText(cardName);
  if (!ds || !dc) return merchantSimilarity(statementName, cardName);
  return merchantSimilarity(ds, dc);
}

// The card NETWORK detectable in a name/label, so a Mastercard statement is not
// confidently matched to a same-bank VISA card (different physical card). We
// can't compare last4 (not stored on debt accounts), so network is the guard.
const CARD_NETWORKS = ["visa", "mastercard", "amex", "american express", "diners", "discover"];
function cardNetwork(text?: string | null): string | undefined {
  if (!text) return undefined;
  const n = normText(text);
  const hit = CARD_NETWORKS.find((w) => n.includes(w));
  return hit === "american express" ? "amex" : hit;
}

export function resolveStatementCard(
  statementName: string | undefined,
  debtAccounts: DebtAccountLite[],
  opts?: { network?: string | null; last4?: string | null },
): StatementCardResolution {
  const stmtNet = cardNetwork(opts?.network);
  // A KNOWN, DIFFERENT network on the registered card → never a confident match
  // (it's a different card); surface as a question instead.
  const networkConflict = (cardName: string): boolean => {
    if (!stmtNet) return false;
    const cn = cardNetwork(cardName);
    return cn !== undefined && cn !== stmtNet;
  };
  if (debtAccounts.length === 0) return { kind: "unregistered" };
  if (debtAccounts.length === 1) {
    const only = debtAccounts[0];
    if (networkConflict(only.name)) return { kind: "ambiguous", candidates: [only] };
    if (!statementName) return { kind: "matched", account: only };
    return cardNameScore(statementName, only.name) >= STATEMENT_CARD_WEAK
      ? { kind: "matched", account: only }
      : { kind: "unregistered" };
  }
  if (!statementName) {
    // Several cards and the statement didn't name one → cannot pick safely.
    return { kind: "ambiguous", candidates: debtAccounts.slice(0, 4) };
  }
  const scored = debtAccounts
    .map((a) => ({ a, s: cardNameScore(statementName, a.name) }))
    .sort((x, y) => y.s - x.s);
  const top = scored[0];
  const second = scored[1];
  if (top.s < STATEMENT_CARD_WEAK) return { kind: "unregistered" };
  if (
    top.s >= STATEMENT_CARD_STRONG &&
    top.s - (second?.s ?? 0) >= STATEMENT_CARD_MARGIN &&
    !networkConflict(top.a.name)
  ) {
    return { kind: "matched", account: top.a };
  }
  // Plausible but not clearly one card (or a network conflict) → ask first.
  return {
    kind: "ambiguous",
    candidates: scored.filter((x) => x.s >= STATEMENT_CARD_WEAK).slice(0, 4).map((x) => x.a),
  };
}

// ── File-safety validation (pure: magic bytes, mime, size) ───────────────────

export type EvidenceFileKind = "image" | "audio" | "pdf";

export interface FileValidation {
  ok: boolean;
  kind?: EvidenceFileKind;
  reason?: string;
}

export const MAX_EVIDENCE_BYTES = 12 * 1024 * 1024; // 12MB

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO_MIMES = new Set([
  "audio/ogg",
  "audio/oga",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/webm",
]);

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  return sig.every((b, i) => bytes[offset + i] === b);
}

// Magic-byte sniffing so a renamed .exe can never reach a model or storage.
export function sniffFileKind(bytes: Uint8Array): EvidenceFileKind | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image"; // JPEG
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image"; // PNG
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return "image"; // WEBP
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return "audio"; // OGG
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return "audio"; // MP3 (ID3)
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "audio"; // MP3 frame
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) return "audio"; // MP4/M4A
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8)
  )
    return "audio"; // WAV
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "audio"; // WEBM/Matroska
  return null;
}

export function validateEvidenceFile(input: {
  bytes: Uint8Array;
  mimeType?: string | null;
}): FileValidation {
  if (input.bytes.length === 0) return { ok: false, reason: "archivo vacío" };
  if (input.bytes.length > MAX_EVIDENCE_BYTES) {
    return { ok: false, reason: "archivo demasiado grande (máx. 12MB)" };
  }
  const sniffed = sniffFileKind(input.bytes);
  if (!sniffed) {
    return {
      ok: false,
      reason: "formato no soportado (acepto fotos, notas de voz y PDF)",
    };
  }
  // If a mime is declared it must not contradict the magic bytes.
  const mime = (input.mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (mime) {
    const mimeKind: EvidenceFileKind | null = IMAGE_MIMES.has(mime)
      ? "image"
      : AUDIO_MIMES.has(mime)
        ? "audio"
        : mime === "application/pdf"
          ? "pdf"
          : null;
    if (mimeKind && mimeKind !== sniffed) {
      return { ok: false, reason: "el contenido no coincide con el tipo declarado" };
    }
  }
  return { ok: true, kind: sniffed };
}
