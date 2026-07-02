import { CHART_COLOR, type ChartAccent } from "../Charts";

// Stage 27 — the detail-page curve: taller than a sparkline, with honest axis
// hints (min/max + first/last labels), a zero line when the series crosses it,
// event/risk markers, and a CSS draw-in (pathLength=1 trick — no JS). Two
// honest modes: "continuous" (a real day-by-day computed series, e.g. the
// cashflow projection — index IS the day) and "dotted" (sparse observed
// points, e.g. daily snapshots with gaps — dots mark REAL observations,
// positioned on a TIME axis via `t`, so a 27-day gap looks like a 27-day gap;
// the faint connecting line is de-emphasized so nobody reads it as data).

export interface CurvePoint {
  label: string; // short human label ("15 jul")
  value: number;
  /** 0..1 position on the time axis (e.g. daysSinceFirst / windowDays).
   * Used by dotted mode so irregular gaps render as real gaps; continuous
   * series omit it (their indices are uniform days). */
  t?: number;
}

export interface CurveMarker {
  index: number; // position in points[]
  label: string;
  tone?: "risk" | "info";
}

/** 0..1 time-axis fractions for sparse dated observations (dotted mode) — a
 * 27-day gap must LOOK like a 27-day gap, never a uniform step. Noon-anchored
 * parse avoids timezone day-shift. */
export function timeFractions(dateISOs: string[]): number[] {
  if (dateISOs.length < 2) return dateISOs.map(() => 0);
  const ts = dateISOs.map((d) => Date.parse(`${d}T12:00:00`));
  const first = ts[0];
  const span = Math.max(1, ts[ts.length - 1] - first);
  return ts.map((t) => (t - first) / span);
}

export function CurveChart({
  points,
  mode = "continuous",
  accent = "emerald",
  height = 128,
  markers = [],
  formatValue,
  ariaLabel,
  anchorZero,
}: {
  points: CurvePoint[];
  mode?: "continuous" | "dotted";
  accent?: ChartAccent;
  height?: number;
  markers?: CurveMarker[];
  formatValue: (v: number) => string;
  ariaLabel?: string;
  /** Anchor the floor at 0 so proportions read honestly (default: continuous
   * mode only — sparse snapshot series keep their own min to show variation). */
  anchorZero?: boolean;
}) {
  const W = 320;
  const H = height;
  const padX = 6;
  const padY = 10;
  const c = CHART_COLOR[accent];
  const n = points.length;
  if (n < 2) return null;

  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const useZero = anchorZero ?? mode === "continuous";
  const lo = useZero ? Math.min(0, ...values) : Math.min(...values);
  const span = max - lo || 1;
  const frac = (i: number) => {
    const t = points[i].t;
    return typeof t === "number" && Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : i / (n - 1);
  };
  const x = (i: number) => padX + frac(i) * (W - padX * 2);
  const y = (v: number) => H - padY - ((v - lo) / span) * (H - padY * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(2)},${H - padY} L${x(0).toFixed(2)},${H - padY} Z`;
  const crossesZero = lo < 0 && max > 0;
  const zeroY = y(0);
  const last = points[n - 1];
  // The svg stretches horizontally (preserveAspectRatio none), so anything with
  // area must be drawn as zero-length round-cap strokes with non-scaling-stroke
  // — a plain <circle> would stretch into an ellipse.
  const dot = (cx: number, cy: number, size: number, color: string, cls?: string) => (
    <path
      d={`M ${cx.toFixed(2)} ${cy.toFixed(2)} l 0 0.001`}
      stroke={color}
      strokeWidth={size}
      strokeLinecap="round"
      fill="none"
      vectorEffect="non-scaling-stroke"
      className={cls}
    />
  );

  return (
    <figure>
      <div className="flex items-baseline justify-between text-[10px] font-medium text-zinc-600">
        <span>{formatValue(max)}</span>
        <span className="text-zinc-500">{formatValue(last.value)} al final</span>
      </div>
      <svg
        className="mt-1 w-full"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
      >
        {mode === "continuous" && <path d={area} fill={c.soft} stroke="none" className="kipu-fade-up" />}
        {crossesZero && (
          <line
            x1={padX}
            x2={W - padX}
            y1={zeroY}
            y2={zeroY}
            stroke="rgba(251,113,133,0.35)"
            strokeWidth={1}
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          d={line}
          fill="none"
          stroke={c.stroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          pathLength={1}
          className="kipu-draw"
          opacity={mode === "dotted" ? 0.18 : 1}
          style={{ filter: `drop-shadow(0 0 6px ${c.glow})` }}
        />
        {mode === "dotted" && points.map((p, i) => <g key={i}>{dot(x(i), y(p.value), 4.8, c.stroke)}</g>)}
        {markers.map((m) => {
          const mi = Math.max(0, Math.min(n - 1, m.index));
          const tone = m.tone === "risk" ? "#fb7185" : "#a1a1aa";
          return (
            <g key={`${m.index}-${m.label}`}>
              <line
                x1={x(mi)}
                x2={x(mi)}
                y1={padY}
                y2={H - padY}
                stroke={tone}
                strokeWidth={1}
                strokeDasharray="2 4"
                opacity={0.55}
                vectorEffect="non-scaling-stroke"
              />
              {dot(x(mi), y(points[mi].value), 6.4, tone, "kipu-pop")}
            </g>
          );
        })}
        {mode === "continuous" && dot(x(n - 1), y(last.value), 6, c.stroke, "kipu-pop")}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] font-medium text-zinc-600">
        <span>{points[0].label}</span>
        <span>{formatValue(lo)}</span>
        <span>{last.label}</span>
      </div>
      {markers.length > 0 && (
        <figcaption className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {markers.slice(0, 3).map((m) => (
            <span key={`${m.index}-cap`} className="flex items-center gap-1.5 text-[10px] font-medium text-zinc-500">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.tone === "risk" ? "#fb7185" : "#a1a1aa" }} />
              {m.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
