// Stage D — ONE Spanish date formatter for user-facing copy. The spec bans raw
// ISO dates anywhere a user can read; every surface imports this instead of
// keeping a local copy. Pure, no effects.

export const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

/** "2026-07-25" → "25 de julio". Falls back to the input on malformed dates. */
export function formatDateEs(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} de ${MONTHS_ES[d.getMonth()]}`;
}

/** "2026-07-25" → "25 jul" (short, for chart labels). */
export function formatDateEsShort(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()].slice(0, 3)}`;
}
