// Bloque N0 — el metro, en lógica pura.
//
// Sin `server-only` y sin efectos: el gate headless tiene que poder ejecutarlo.
// La regla "una medición que no ocurrió se escribe —, jamás 0" no se reimplementa
// aquí: se importa de `state-contract`, que es su dueño (N0_SPEC §5).

import {
  formatMetric,
  isMeasured,
  KIPU_UNMEASURED,
} from "@/app/app/components/state/state-contract";

export { KIPU_UNMEASURED };

// ── 1. El servidor ──────────────────────────────────────────────────────────

/**
 * Un TRAMO por cada `await` medido de `buildShellPayload`. Los nombres son
 * tokens ASCII porque usan la gramática de una cabecera HTTP.
 *
 * N1 · `hilo` YA NO ESTÁ, y su ausencia es la prueba de que el hilo salió de la
 * pantalla de inicio: ya no hay un `await readThreadView` que medir aquí. El
 * hilo se lee cuando se abre la conversación (`loadThreadAction`).
 */
export const SHELL_TIMING_TRAMOS = [
  "contexto",
  "cliente",
  "briefing",
  "cotizaciones",
  "preferencias",
  "movimiento",
  "recibo",
  "historia",
] as const;

/**
 * N1 · Los HITOS no son tramos: son «cuántos ms desde que arrancó el builder
 * hasta que este grupo estuvo listo». El builder dejó de tener una sola línea
 * de meta (`total`) y pasó a tener tres, porque ahora entrega en tres tandas:
 * el orbe primero, la píldora y la cinta después, la perspectiva al final.
 */
export const SHELL_TIMING_MILESTONES = ["orbe", "pill", "perspectiva"] as const;

export const SHELL_TIMING_SEGMENTS = [
  ...SHELL_TIMING_TRAMOS,
  ...SHELL_TIMING_MILESTONES,
] as const;

export type ShellTimingTramo = (typeof SHELL_TIMING_TRAMOS)[number];
export type ShellTimingMilestone = (typeof SHELL_TIMING_MILESTONES)[number];
export type ShellTimingSegment = (typeof SHELL_TIMING_SEGMENTS)[number];

/** Qué tramos viajan con cada tanda. El orden es el de aparición en pantalla. */
export const SHELL_TIMING_GROUPS = {
  orbe: ["contexto", "cliente", "briefing", "cotizaciones"],
  pill: ["preferencias", "movimiento", "recibo"],
  perspectiva: ["historia"],
} as const satisfies Record<ShellTimingMilestone, readonly ShellTimingTramo[]>;

export interface ServerTimingMark {
  name: string;
  ms: number;
}

const TOKEN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** Gramática estándar de `Server-Timing`: `nombre;dur=12.3, otro;dur=4.5`. */
export function formatServerTiming(marks: readonly ServerTimingMark[]): string {
  return marks
    .filter((mark) => TOKEN.test(mark.name) && Number.isFinite(mark.ms))
    .map((mark) => `${mark.name};dur=${Math.round(mark.ms * 10) / 10}`)
    .join(", ");
}

/** Lee la misma gramática. Lo que no se pueda leer NO se inventa: se descarta. */
export function parseServerTiming(header: string | null | undefined): ServerTimingMark[] {
  if (!header) return [];
  const marks: ServerTimingMark[] = [];
  for (const raw of header.split(",")) {
    const parts = raw.trim().split(";");
    const name = (parts.shift() ?? "").trim();
    if (!TOKEN.test(name)) continue;
    let ms: number | null = null;
    for (const param of parts) {
      const [key, value] = param.split("=");
      if ((key ?? "").trim().toLowerCase() !== "dur") continue;
      const parsed = Number((value ?? "").trim());
      if (Number.isFinite(parsed)) ms = parsed;
    }
    if (ms == null) continue;
    marks.push({ name, ms });
  }
  return marks;
}

/** El valor de un tramo, o `null` si ese tramo no se midió. Nunca cero por defecto. */
export function segmentMs(
  marks: readonly ServerTimingMark[],
  name: string,
): number | null {
  const found = marks.find((mark) => mark.name === name);
  return found && isMeasured(found.ms) ? found.ms : null;
}

// ── 2. El teléfono ──────────────────────────────────────────────────────────

export type MetroMetricName = "TTFB" | "LCP" | "INP" | "CLS";

export const METRO_METRICS: readonly MetroMetricName[] = [
  "TTFB",
  "LCP",
  "INP",
  "CLS",
] as const;

export type MetroVerdict = "sin-medir" | "bueno" | "regular" | "malo";

interface MetroThreshold {
  good: number;
  poor: number;
  digits: number;
  unit: string | null;
}

const THRESHOLDS: Record<MetroMetricName, MetroThreshold> = {
  TTFB: { good: 800, poor: 1800, digits: 0, unit: "ms" },
  LCP: { good: 2500, poor: 4000, digits: 0, unit: "ms" },
  INP: { good: 200, poor: 500, digits: 0, unit: "ms" },
  CLS: { good: 0.1, poor: 0.25, digits: 3, unit: null },
};

/** Sin medición no hay juicio: `sin-medir` no es "malo", es ausencia. */
export function metroVerdict(
  name: MetroMetricName,
  value: number | null | undefined,
): MetroVerdict {
  if (!isMeasured(value)) return "sin-medir";
  const limits = THRESHOLDS[name];
  if (value <= limits.good) return "bueno";
  if (value <= limits.poor) return "regular";
  return "malo";
}

/** El texto de una casilla del overlay. Sin medir ⇒ `—`, nunca `0`. */
export function formatMetroValue(
  name: MetroMetricName,
  value: number | null | undefined,
): string {
  const limits = THRESHOLDS[name];
  return formatMetric(value, {
    digits: limits.digits,
    ...(limits.unit ? { unit: limits.unit } : {}),
  });
}

/** El texto de un tramo del servidor. Mismo trato: sin medir ⇒ `—`. */
export function formatSegmentValue(value: number | null | undefined): string {
  return formatMetric(value, { digits: 0, unit: "ms" });
}

/** El overlay sólo existe con `?metro=1`. Cualquier otra cosa es "no". */
export function metroRequested(value: string | string[] | undefined): boolean {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "1";
}
