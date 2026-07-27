// Bloque J (J-7) — la PROCEDENCIA de un turno del chat, como decisión pura.
//
// La mitad humana del bloque es revisar el chat real mensaje a mensaje. Eso solo
// es diagnosticable si cada turno del asistente se puede atribuir a su autor: el
// agente, el calendario, el coach ambient, el cierre de mes, o —el hallazgo— nadie.
// Un turno de dinero sin autor no se puede auditar después de que ocurrió.
//
// "sin_atribuir" NO es una categoría más entre pares: es el defecto. Puede
// significar que el pipeline legacy (el fallback de emergencia) contestó, o que
// hay un emisor que no deja rastro. Las dos cosas hay que verlas.

export type TurnAuthor =
  | "usuario"
  | "agente"
  | "calendario"
  | "coach"
  | "cierre_de_mes"
  | "otro"
  | "sin_atribuir";

export interface TurnForProvenance {
  role: string;
  metadata?: Record<string, unknown> | null;
}

export function turnAuthor(turn: TurnForProvenance): TurnAuthor {
  if (turn.role !== "assistant") return "usuario";
  const meta = turn.metadata ?? {};
  // El agente marca `agent`; la marca viaja como boolean o como string según el
  // canal que la persistió, así que se aceptan las dos y NADA más (un "false"
  // no puede leerse como presencia).
  if (meta.agent === true || meta.agent === "true") return "agente";
  const source = typeof meta.source === "string" ? meta.source.trim() : "";
  if (source === "recurring") return "calendario";
  if (source === "ambient") return "coach";
  if (source === "objective_close") return "cierre_de_mes";
  if (source) return "otro";
  return "sin_atribuir";
}

export const AUTHOR_LABEL: Record<TurnAuthor, string> = {
  usuario: "usuario",
  agente: "agente",
  calendario: "calendario",
  coach: "coach",
  cierre_de_mes: "cierre de mes",
  otro: "otro emisor",
  sin_atribuir: "SIN ATRIBUIR",
};

export function toolsUsedOf(turn: TurnForProvenance): string[] {
  const raw = (turn.metadata ?? {}).toolsUsed;
  if (Array.isArray(raw)) return raw.map((t) => String(t)).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return raw.split(/[,\s]+/).filter(Boolean);
  return [];
}

// Las cifras que el turno CITA. El contrato del producto es que agente, chat,
// ambient y fallback citen el MISMO saldo que el dashboard; revisarlo exige ver
// de un vistazo qué números salieron por la boca de Kipu.
export function citedNumbers(text: string): string[] {
  const found = text.match(/-?\d[\d.,]*\s*(?:\$|USD|ARS|EUR|pesos|d[óo]lares)?/gi) ?? [];
  return Array.from(new Set(found.map((n) => n.trim()).filter((n) => /\d/.test(n)))).slice(0, 12);
}
