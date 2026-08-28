// Bloque N0 — el vocabulario de estados, en lógica pura.
//
// Deliberadamente SIN `import "server-only"`: el gate headless
// (`scripts/qa/run-capture-gate.mjs`) tiene que poder EJECUTAR estas funciones,
// y ese import las mataría (lección M3 O1). Aquí no hay efectos: ni DB, ni red,
// ni modelo. Sólo el contrato que los cinco componentes rinden en pantalla.

export type KipuStateKind =
  | "cargando"
  | "vacio"
  | "sin-dato"
  | "sin-senal"
  | "error";

export type KipuStateShape = "orbe" | "tarjeta" | "linea" | "hoja";

export const KIPU_STATE_KINDS: readonly KipuStateKind[] = [
  "cargando",
  "vacio",
  "sin-dato",
  "sin-senal",
  "error",
] as const;

export const KIPU_STATE_SHAPES: readonly KipuStateShape[] = [
  "orbe",
  "tarjeta",
  "linea",
  "hoja",
] as const;

/** Una medición que no ocurrió se escribe así. Jamás un cero. */
export const KIPU_UNMEASURED = "—";

/** Qué afirma el estado sobre el dato. Es el eje que separa vacío de sin-dato. */
export type KipuStateClaim =
  | "en-camino" /** el dato viene; todavía no afirmo nada */
  | "medido-en-cero" /** LEÍ, y hay cero. El cero es un hecho */
  | "no-leido" /** NO pude leer. No afirmo ni cero ni algo */
  | "sin-red" /** no hay señal; prefiero nada antes que una cifra vieja */
  | "roto"; /** algo se rompió; el dinero no */

/** Cómo se dibuja la silueta. */
export type KipuStateSilhouette =
  | "esqueleto" /** la forma de lo que viene, sin contenido */
  | "completa" /** la forma entera, con su contenido en cero */
  | "interrumpida"; /** la forma rota a propósito: no se puede confundir con completa */

export interface KipuStateContract {
  kind: KipuStateKind;
  claim: KipuStateClaim;
  silhouette: KipuStateSilhouette;
  /** ¿este estado puede pintar una cifra propia? */
  showsFigure: boolean;
  /** ¿ofrece volver a intentar la lectura? */
  offersRetry: boolean;
  /** ¿invita a hacer algo para que deje de estar así? */
  offersInvitation: boolean;
  /** el aviso accesible que la superficie anuncia */
  live: "polite" | "assertive" | "off";
  role: "status" | "alert" | "note";
  title: string;
  body: string;
  actionLabel: string | null;
}

const CONTRACT: Record<KipuStateKind, KipuStateContract> = {
  cargando: {
    kind: "cargando",
    claim: "en-camino",
    silhouette: "esqueleto",
    showsFigure: false,
    offersRetry: false,
    offersInvitation: false,
    live: "polite",
    role: "status",
    title: "Cargando",
    body: "Estoy trayendo tus números.",
    actionLabel: null,
  },
  vacio: {
    kind: "vacio",
    claim: "medido-en-cero",
    silhouette: "completa",
    showsFigure: true,
    offersRetry: false,
    offersInvitation: true,
    live: "off",
    role: "note",
    title: "Vacío por ahora",
    body: "Leí bien: aquí todavía no hay nada. Eso tiene arreglo.",
    actionLabel: "Cuéntame",
  },
  "sin-dato": {
    kind: "sin-dato",
    claim: "no-leido",
    silhouette: "interrumpida",
    showsFigure: false,
    offersRetry: true,
    offersInvitation: false,
    live: "polite",
    role: "status",
    title: "No pude leer esto",
    body: "No es que esté en cero: es que no lo pude leer. Prefiero no inventarte un número.",
    actionLabel: "Reintentar",
  },
  "sin-senal": {
    kind: "sin-senal",
    claim: "sin-red",
    silhouette: "interrumpida",
    showsFigure: false,
    offersRetry: true,
    offersInvitation: false,
    live: "polite",
    role: "status",
    title: "Sin conexión",
    body: "Tus números viven en el servidor, así que prefiero no mostrarte uno viejo. Vuelvo apenas haya señal.",
    actionLabel: "Reintentar",
  },
  error: {
    kind: "error",
    claim: "roto",
    silhouette: "interrumpida",
    showsFigure: false,
    offersRetry: true,
    offersInvitation: false,
    live: "assertive",
    role: "alert",
    title: "Algo se trabó",
    body: "Tu plata está a salvo: no se movió nada. Volvamos a intentarlo.",
    actionLabel: "Reintentar",
  },
};

export function kipuStateContract(kind: KipuStateKind): KipuStateContract {
  return CONTRACT[kind];
}

/**
 * La doctrina monetaria del proyecto, hecha visual: "no pude leer" ≠ "no hay
 * nada". Sólo un estado que LEYÓ puede pintar un cero.
 */
export function stateMayRenderZero(kind: KipuStateKind): boolean {
  return CONTRACT[kind].claim === "medido-en-cero";
}

/** Los ejes visuales por los que dos estados se pueden separar a simple vista. */
export const KIPU_STATE_AXES = [
  "claim",
  "silhouette",
  "showsFigure",
  "offersRetry",
  "offersInvitation",
  "title",
  "body",
] as const;

/** En cuántos ejes difieren dos estados. Cero ⇒ son el mismo estado con dos nombres. */
export function stateDifferences(
  a: KipuStateKind,
  b: KipuStateKind,
): string[] {
  const left = CONTRACT[a];
  const right = CONTRACT[b];
  return KIPU_STATE_AXES.filter((axis) => left[axis] !== right[axis]);
}

/**
 * Dos estados son distinguibles cuando difieren en lo que AFIRMAN, en cómo se
 * dibujan y en lo que ofrecen — no sólo en el texto. Tres ejes es el mínimo.
 */
export function statesAreDistinguishable(
  a: KipuStateKind,
  b: KipuStateKind,
): boolean {
  if (a === b) return false;
  const diffs = stateDifferences(a, b);
  return (
    diffs.includes("claim") &&
    diffs.includes("silhouette") &&
    diffs.length >= 3
  );
}

/** Un valor está MEDIDO cuando es un número finito. `null`, `undefined` y `NaN` no lo son. */
export function isMeasured(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export interface FormatMetricOptions {
  /** decimales; por defecto 0 */
  digits?: number;
  /** sufijo con espacio fino, p. ej. "ms" */
  unit?: string;
}

/**
 * REGLA N0 (orden M2 O2): una medición que no ocurrió se escribe `—`, jamás `0`.
 *
 * `formatMetric(null) === "—"`. `formatMetric(0)` devuelve un cero MEDIDO —
 * distinguible del guion — porque un cero leído es un hecho y merece verse.
 */
export function formatMetric(
  value: number | null | undefined,
  options: FormatMetricOptions = {},
): string {
  if (!isMeasured(value)) return KIPU_UNMEASURED;
  const digits = options.digits ?? 0;
  const shown = value.toFixed(digits);
  return options.unit ? `${shown} ${options.unit}` : shown;
}
