import type { ThreadTurn } from "@/lib/chat-memory/thread-view-contract";

export interface ShellPillSignal {
  kind: string;
  severity: "positive" | "info" | "watch" | "urgent";
  text: string;
}

export interface ShellPendingOccurrence {
  kind:
    | "income"
    | "expense"
    | "debt_payment"
    | "savings"
    | "investment"
    | "card_statement";
  dateLabel: string;
}

export type ShellPendingRead =
  | { ok: false }
  | { ok: true; first: ShellPendingOccurrence | null };

export interface ShellOrbWriteSignal {
  level: number;
  receiptKey: string;
}

const severityRank: Record<ShellPillSignal["severity"], number> = {
  urgent: 3,
  watch: 2,
  info: 1,
  positive: 0,
};

function pendingQuestion(item: ShellPendingOccurrence): string {
  switch (item.kind) {
    case "income":
      return `¿Ya recibiste el ingreso previsto para ${item.dateLabel}?`;
    case "expense":
      return `¿Cuánto pagaste por el compromiso de ${item.dateLabel}?`;
    case "debt_payment":
      return `¿Ya hiciste el pago previsto para ${item.dateLabel}?`;
    case "savings":
      return `¿Pudiste separar el ahorro de ${item.dateLabel}?`;
    case "investment":
      return `¿Pudiste hacer la inversión de ${item.dateLabel}?`;
    case "card_statement":
      return `¿Cuánto cerró tu tarjeta el ${item.dateLabel}?`;
  }
}

/**
 * N1 (ronda 2, O2) · Qué dibuja la cinta del último movimiento.
 *
 * Es CONDUCTA, no orden de texto: el gate la EJECUTA (N1-3) y el santuario sólo
 * consume el resultado. Antes de esto, la promesa titular de N1 estaba sujeta
 * por una comparación de posiciones en el fuente — y desactivar la rama con
 * `if (false)` pasaba el gate mientras la pantalla dibujaba la cinta vacía
 * prohibida.
 *
 * La regla que sujeta es la doctrina monetaria del proyecto: **«no pude leer» ≠
 * «no hay nada»**. Una lectura caída se dibuja `sin-dato` —con su frase honesta
 * y su `—`—, jamás como la cinta vacía, que afirmaría que no hubo movimientos.
 * Y un movimiento vivo (el recibo recién escrito) gana siempre: si hay algo que
 * mostrar, se muestra, aunque la lectura persistida se haya caído.
 */
export type ShellCintaState = "real" | "sin-dato" | "vacio";

export function cintaState<T>(input: {
  movement: T | null | undefined;
  readFailed: boolean;
}): ShellCintaState {
  if (input.movement != null) return "real";
  return input.readFailed ? "sin-dato" : "vacio";
}

/** Priority is data, not presentation: a failed pending read blocks every
 * lower rung so it can never masquerade as "there are no pending questions". */
export function buildShellPillLines(input: {
  pending: ShellPendingRead;
  nextCommitment: string | null;
  signals: ShellPillSignal[];
}): string[] {
  if (!input.pending.ok) return ["No pude revisar tus pendientes ahora."];

  const lines: string[] = [];
  if (input.pending.first) lines.push(pendingQuestion(input.pending.first));
  if (input.nextCommitment?.trim()) lines.push(input.nextCommitment.trim());

  const objective = input.signals.find(
    (signal) =>
      signal.kind === "objective_pace" || signal.kind === "objective_crossed",
  );
  if (objective?.text.trim()) lines.push(objective.text.trim());

  const insight = input.signals
    .filter(
      (signal) =>
        signal.kind !== "objective_pace" &&
        signal.kind !== "objective_crossed" &&
        signal.kind !== "all_good" &&
        signal.text.trim(),
    )
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity])[0];
  if (insight?.text.trim()) lines.push(insight.text.trim());

  return [...new Set(lines)];
}

/** A receipt proves the operation landed; the level still has to come from a
 * separate server financial read. Either missing half means no money motion. */
export function verifiedOrbWriteSignal(input: {
  turn: ThreadTurn | null;
  serverLevel: number | null;
}): ShellOrbWriteSignal | null {
  if (
    !input.turn?.receipt ||
    input.serverLevel == null ||
    !Number.isFinite(input.serverLevel) ||
    input.serverLevel < 0 ||
    input.serverLevel > 1
  ) {
    return null;
  }
  return { level: input.serverLevel, receiptKey: input.turn.id };
}
