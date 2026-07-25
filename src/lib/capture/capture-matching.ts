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
  // S5 near-duplicate only: a tight merchant grouping token + category. Optional so
  // the exact-duplicate matcher (which ignores them) is completely unaffected.
  merchantToken?: string | null;
  category?: string | null;
  // J-2: la corrección necesita SEÑALAR la fila a corregir, no solo saber que existe.
  // Opcionales por la misma razón: los dos matchers de arriba no los miran.
  id?: string;
  description?: string | null;
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
  return (
    /\bno (era|fue|eran|fueron|iba|es)\b/.test(m) ||
    /\b(me )?equivoque\b/.test(m) ||
    /\bcorrige|corrigelo|corregir|correccion\b/.test(m) ||
    /\ben realidad (era|fue|eran|fueron|es|son|no)\b/.test(m) ||
    /\bquise decir\b/.test(m) ||
    /\bperdon,? (era|fue|eran|fueron)\b/.test(m)
  );
}

/** Los movimientos recientes a los que esa reformulación puede referirse, del más
 *  nuevo al más viejo. Vacío ⇒ no hay nada que corregir y la captura sigue su
 *  curso normal (p. ej. «gasté 100… no era, eran 150» antes de registrar nada).
 *  Empareja por lo que la corrección NO cambia: el mismo monto (cambió la cuenta,
 *  la categoría o la fecha) o el mismo comercio (cambió el monto). */
export function movementCorrectionTargets(
  message: string,
  candidate: RecentMovementKey,
  recent: RecentMovementKey[],
  opts: { windowMs: number },
): RecentMovementKey[] {
  if (!correctivePhrasing(message)) return [];
  if (!Number.isFinite(candidate.occurredAtMs)) return [];
  const token = (candidate.merchantToken ?? "").trim();
  const cur = (candidate.currency || "").toUpperCase();
  return recent
    .filter((r) => {
      if (r.type !== candidate.type) return false;
      if (!Number.isFinite(r.occurredAtMs)) return false;
      if (Math.abs(r.occurredAtMs - candidate.occurredAtMs) > opts.windowMs) return false;
      const sameAmount = r.cents === candidate.cents && (r.currency || "").toUpperCase() === cur;
      const sameMerchant = token.length >= 3 && (r.merchantToken ?? "") === token;
      return sameAmount || sameMerchant;
    })
    .sort((a, b) => b.occurredAtMs - a.occurredAtMs);
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
