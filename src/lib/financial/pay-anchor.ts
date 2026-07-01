// Stage 24 — a KNOWN payday anchors a weekly (7d) / biweekly (14d) cadence so BOTH
// date engines (financial-calendar + margen-kipu) project the SAME next paycheck
// instead of guessing a weekday. Pure and DST-safe (whole-day modular arithmetic on
// local midnights). Honest: a malformed / absent anchor returns null, so every caller
// falls straight through to its existing expectedWeekday / default-Friday path and a
// non-anchored user is byte-for-byte unchanged.
//
// Convention: the NEXT strictly-future occurrence. A payday that is "today" projects
// the next cycle (matches margen's historical delta===0 ? step behavior — the money
// already landed today, so the horizon looks to the next one).

const DAY_MS = 86_400_000;

export function nextAnchoredDate(
  anchorIso: string | undefined | null,
  stepDays: 7 | 14,
  today: Date,
): Date | null {
  if (!anchorIso || !/^\d{4}-\d{2}-\d{2}$/.test(anchorIso)) return null;
  const [y, m, d] = anchorIso.split("-").map(Number);
  const anchor = new Date(y, m - 1, d);
  // Reject impossible dates (e.g. 2026-02-31 rolling over) — must round-trip exactly.
  if (
    anchor.getFullYear() !== y ||
    anchor.getMonth() !== m - 1 ||
    anchor.getDate() !== d
  ) {
    return null;
  }
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Whole-day delta via the local-midnight difference (Math.round absorbs the ±1h a
  // DST transition adds to the raw ms gap, so the day count stays exact).
  const diffDays = Math.round((start.getTime() - anchor.getTime()) / DAY_MS);
  // diffDays < 0  → anchor is in the future: use it directly (k = 0).
  // diffDays >= 0 → step to the first occurrence STRICTLY after today.
  const k = diffDays < 0 ? 0 : Math.floor(diffDays / stepDays) + 1;
  // Reconstruct via local calendar fields (Date normalizes day overflow) so the
  // result is a TRUE local midnight — never 23:00/01:00 across a DST boundary, which
  // would make the calendar's local iso() and margen's UTC slice disagree by a day.
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + k * stepDays);
}
