// Pre-parse safety net for chat / Telegram daily logging.
//
// The basic and AI transaction parsers each handle their own ambiguity,
// but a few common LatAm message shapes are unsafe to send through them
// because they would silently lose information or fake a registration
// the financial engine cannot honor. This module catches those shapes
// FIRST and returns a tailored clarification, so the user gets one
// direct question instead of an incorrect record.
//
// Catches:
// - multi-transaction messages joined by "y" / "e" / "también" / "además"
// - transfers between own accounts (not supported in MVP)
// - refunds / devoluciones (not supported in MVP)
// - subscription cancellations (not supported as a movement)
// - "pagué X" with no debt/card and no source mentioned
// - "compré algo de X" / "gasté algo en X" — vague purchase
// - "me invitaron …" — no money out, nothing to register
//
// The handler must call this BEFORE the parser router. A `null` return
// means "let the parser try"; a match returns the exact clarification
// text to send back to the user.

export type TransactionPrefilterKind =
  | "profile_edit"
  | "multi_transaction"
  | "transfer_unsupported"
  | "refund_unsupported"
  | "cancel_subscription_unsupported"
  | "vague_payment"
  | "vague_purchase"
  | "invited_no_money";

export interface TransactionPrefilterMatch {
  kind: TransactionPrefilterKind;
  clarificationQuestion: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

// Conversational / comparison cues. A message that compares options or asks an
// opinion ("el de 4 o el de 10", "la otra opción sería uno de 10", "¿4 o 10?")
// is NOT a multi-transaction logging attempt — it must reach the coach, not get
// blocked. Bare "más" is excluded from the connector list below for the same
// reason (it collides with comparatives like "lo más barato").
const COMPARISON_OR_QUESTION_CUES =
  /(\?|¿|\bla\s+otra\b|\botra\s+opcion\b|\bopcion\b|\bser[ií]a\b|\bmas\s+barat[oa]\b|\bmas\s+car[oa]\b|\bmejor\b|\ben\s+vez\s+de\b|\ben\s+lugar\s+de\b|\bcomparad[oa]\b|\bvs\b|\bo\s+(?:el|la|uno|una|los|las)\b|\bcual\b|\bque\s+tal\b)/;

// Two standalone amounts joined by an obvious "and/also" connector.
// Conservative on purpose: only fires when both amounts AND a connector
// are present, so messages like "tengo 1.200 en pichincha" don't trip
// it — and never on a comparison/question, which belongs to the coach.
function looksLikeMultiTransaction(normalized: string): boolean {
  if (COMPARISON_OR_QUESTION_CUES.test(normalized)) return false;
  const pattern =
    /\b\d+(?:[.,]\d{1,2})?\b[^\d]*?\b(?:y|e|tambien|ademas|y\s+tambien|y\s+ademas|mas\s+otro|mas\s+otra)\b[^\d]*?\b\d+(?:[.,]\d{1,2})?\b/;
  return pattern.test(normalized);
}

function looksLikeTransfer(normalized: string): boolean {
  return /\b(transfer[ií]|transferi|transfer|mov[ií]|movi)\b/.test(normalized);
}

function looksLikeRefund(normalized: string): boolean {
  return /\bme\s+(devolvieron|devolvio|reembolsaron|reembolso|regresaron|regreso|retornaron|retorno)\b/.test(
    normalized,
  );
}

function looksLikeCancellation(normalized: string): boolean {
  return /\b(cancel[eé]|cancele|di\s+de\s+baja|deje\s+de\s+pagar|eliminé|elimine)\b/.test(
    normalized,
  );
}

function looksLikeInvitedNoMoney(normalized: string): boolean {
  return /\bme\s+invitaron\b/.test(normalized);
}

function looksLikeVaguePayment(normalized: string): boolean {
  // "pagué 20" or "pague 20." with no further context.
  // Must NOT match "pagué 20 de visa" or "pagué 30 en café".
  return /^pagu[eé]\s+\d+(?:[.,]\d{1,2})?[.!?,]*\s*$/.test(normalized);
}

function looksLikeVaguePurchase(normalized: string): boolean {
  return /\b(compr[eé]\s+algo|gast[eé]\s+algo|compr[eé]\s+una\s+cosa)\b/.test(
    normalized,
  );
}

// Profile edits and corrections ("cambia mi sueldo, ahora gano 1400", "corrige
// eso, no era con Visa") must NEVER be booked as movements by the basic parser —
// the amount in them is a NEW VALUE, not money that moved today.
function looksLikeProfileEditOrCorrection(normalized: string): boolean {
  return (
    /\b(cambia|actualiza|ajusta|sube|baja)\s+(mi|el|la)\s+(sueldo|salario|ingreso|arriendo|renta|alquiler|meta|presupuesto)\b/.test(normalized) ||
    /\bahora\s+(gano|cobro|pago|recibo)\b/.test(normalized) ||
    /\bdesde\s+(el\s+)?(pr[oó]ximo|siguiente)\s+mes\b/.test(normalized) ||
    /\b(me\s+subieron|me\s+bajaron)\s+(el\s+)?(sueldo|salario)\b/.test(normalized)
  );
}

export function detectTransactionPrefilter(
  rawMessage: string,
): TransactionPrefilterMatch | null {
  const normalized = normalize(rawMessage);

  if (!normalized) return null;

  if (looksLikeProfileEditOrCorrection(normalized)) {
    return {
      kind: "profile_edit",
      clarificationQuestion:
        "Entendido — eso suena a un cambio en tus datos (no a un gasto de hoy), así que no registré ningún movimiento. Cuéntamelo así y lo actualizo: \"mi sueldo ahora es 1400 al mes\" o \"el arriendo subió a 850\".",
    };
  }

  // Order matters when shapes overlap. Multi-transaction first since a
  // sentence like "pagué 20 y aporté 30" should not be treated as a
  // vague payment.
  if (looksLikeMultiTransaction(normalized)) {
    return {
      kind: "multi_transaction",
      clarificationQuestion:
        "Te entendí dos movimientos en un mismo mensaje. Para no descuadrar tus saldos, mándamelos por separado. Por ejemplo: \"uber 12 efectivo\" y luego \"almuerzo 8 pichincha\".",
    };
  }

  if (looksLikeTransfer(normalized)) {
    return {
      kind: "transfer_unsupported",
      clarificationQuestion:
        "Las transferencias entre tus propias cuentas todavía no las manejo bien aquí. Si fue para pagar una deuda, dime \"pagué X de Visa desde Pichincha\". Si fue un aporte a tu meta, dime \"aporté X a [meta] desde Pichincha\".",
    };
  }

  if (looksLikeRefund(normalized)) {
    return {
      kind: "refund_unsupported",
      clarificationQuestion:
        "Aún no registro devoluciones con seguridad desde aquí. Si fue alguien que te pagó, mándamelo como ingreso: \"me pagaron X a [cuenta]\". Si fue una compra anulada, ajústalo desde la web por ahora para no descuadrar saldos.",
    };
  }

  if (looksLikeCancellation(normalized)) {
    return {
      kind: "cancel_subscription_unsupported",
      clarificationQuestion:
        "Cancelar una suscripción no mueve tus saldos hoy. Cuando dejes de pagarla, deja de aparecer. Si quieres quitarla de tus gastos fijos, hazlo desde la web por ahora.",
    };
  }

  if (looksLikeInvitedNoMoney(normalized)) {
    return {
      kind: "invited_no_money",
      clarificationQuestion:
        "Si te invitaron y no salió plata de tus cuentas, no registro nada. Tu Saldo queda intacto. Si tú sí pagaste una parte, dime cuánto y con qué pagaste.",
    };
  }

  if (looksLikeVaguePayment(normalized)) {
    return {
      kind: "vague_payment",
      clarificationQuestion:
        "¿Pagaste una deuda/tarjeta o fue un gasto? Dime algo como \"pagué 20 de Visa desde Pichincha\" o \"pagué 20 en café con Pichincha\".",
    };
  }

  if (looksLikeVaguePurchase(normalized)) {
    return {
      kind: "vague_purchase",
      clarificationQuestion:
        "¿Con qué pagaste? Puede ser efectivo, Pichincha, Visa, Diners, etc. Mándamelo así: \"[qué fue] [monto] [cuenta o tarjeta]\".",
    };
  }

  return null;
}
