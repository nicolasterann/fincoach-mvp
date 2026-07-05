import { CHART_COLOR, type ChartAccent } from "../Charts";

// Stage 27 — goal progress as a quipu cord: the filled strand grows to the
// real progress and a knot marks where the user stands; optional milestone
// knots (e.g. mini-goals) sit along the cord — reached ones glow, pending ones
// stay faint. Pure CSS animation (kipu-rise / kipu-pop), server-rendered.

export function ProgressStrand({
  fraction,
  accent = "violet",
  milestones = [],
  ariaLabel,
}: {
  fraction: number; // 0..1 real progress
  accent?: ChartAccent;
  /** fractions 0..1 along the cord (e.g. mini-goal targets) */
  milestones?: { fraction: number; label?: string; reached: boolean }[];
  ariaLabel?: string;
}) {
  const c = CHART_COLOR[accent];
  const safe = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return (
    <div role="img" aria-label={ariaLabel} className="relative h-6 w-full">
      {/* Cord track */}
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line/8" />
      {/* Filled strand */}
      <div
        className="kipu-rise absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
        style={{
          width: `${Math.max(1.5, safe * 100)}%`,
          background: `linear-gradient(90deg, ${c.soft} 0%, ${c.stroke} 100%)`,
          boxShadow: `0 0 10px ${c.glow}`,
        }}
      />
      {/* Milestone knots */}
      {milestones.map((m, i) => (
        <span
          key={i}
          title={m.label}
          className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-zinc-950"
          style={{
            left: `${Math.max(1, Math.min(99, m.fraction * 100))}%`,
            background: m.reached ? c.stroke : "color-mix(in srgb, var(--color-line) 18%, transparent)",
          }}
        />
      ))}
      {/* The user's knot */}
      <span
        className="kipu-pop absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-zinc-950"
        style={{
          left: `${Math.max(1.5, Math.min(98.5, safe * 100))}%`,
          background: c.stroke,
          boxShadow: `0 0 12px ${c.glow}`,
          animationDelay: "0.5s",
        }}
      />
    </div>
  );
}
