import type { ReactNode } from "react";

// Stage 20 PASS 2 (Micro-stage B) — Kipu's chart primitives. PURE, server-rendered
// SVG + Tailwind. NO charting dependency: these match the hand-rolled PulsoOrb /
// MargenRing style, render on the server with zero hydration cost, work on mobile,
// and never fabricate data — a caller with too few points shows an honest empty
// state instead of inventing a curve. Calm, not Excel: a sparkline, a soft bar set,
// a progress ring, a composition bar, a delta pill, and a compact cashflow timeline.

export type ChartAccent = "emerald" | "violet" | "orange" | "sky" | "teal" | "amber" | "rose" | "zinc";

export const CHART_COLOR: Record<ChartAccent, { stroke: string; glow: string; soft: string }> = {
  emerald: { stroke: "#34d399", glow: "rgba(52,211,153,0.30)", soft: "rgba(52,211,153,0.14)" },
  violet: { stroke: "#a78bfa", glow: "rgba(167,139,250,0.30)", soft: "rgba(167,139,250,0.14)" },
  orange: { stroke: "#fb923c", glow: "rgba(251,146,60,0.30)", soft: "rgba(251,146,60,0.14)" },
  sky: { stroke: "#38bdf8", glow: "rgba(56,189,248,0.30)", soft: "rgba(56,189,248,0.14)" },
  teal: { stroke: "#2dd4bf", glow: "rgba(45,212,191,0.30)", soft: "rgba(45,212,191,0.14)" },
  amber: { stroke: "#fbbf24", glow: "rgba(251,191,36,0.30)", soft: "rgba(251,191,36,0.14)" },
  rose: { stroke: "#fb7185", glow: "rgba(251,113,133,0.30)", soft: "rgba(251,113,133,0.14)" },
  zinc: { stroke: "#a1a1aa", glow: "rgba(161,161,170,0.20)", soft: "rgba(161,161,170,0.10)" },
};

// ── Sparkline ────────────────────────────────────────────────────────────────
// A small line over a numeric series (oldest→newest). The caller is responsible
// for only rendering this when there are ≥2 real points; with <2 it degrades to a
// flat baseline rather than a misleading shape.
export function Sparkline({
  points,
  accent = "emerald",
  height = 40,
  showArea = true,
  ariaLabel,
}: {
  points: number[];
  accent?: ChartAccent;
  height?: number;
  showArea?: boolean;
  ariaLabel?: string;
}) {
  const W = 100;
  const H = height;
  const pad = 3;
  const c = CHART_COLOR[accent];
  const n = points.length;

  if (n < 2) {
    return (
      <svg className="w-full" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
        <line x1={pad} x2={W - pad} y1={H / 2} y2={H / 2} stroke="rgba(255,255,255,0.10)" strokeWidth={1.5} strokeDasharray="2 4" />
      </svg>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(2)},${H} L${x(0).toFixed(2)},${H} Z`;
  const lastX = x(n - 1);
  const lastY = y(points[n - 1]);

  return (
    <svg className="w-full" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
      {showArea && <path d={area} fill={c.soft} stroke="none" />}
      <path d={line} fill="none" stroke={c.stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r={2.6} fill={c.stroke} />
    </svg>
  );
}

// ── MiniBars ─────────────────────────────────────────────────────────────────
// A soft vertical bar set (e.g. spending by category). Heights are relative to the
// largest bar; an explicit per-bar accent overrides the default.
export function MiniBars({
  bars,
  accent = "sky",
  height = 64,
}: {
  bars: { label: string; value: number; accent?: ChartAccent }[];
  accent?: ChartAccent;
  height?: number;
}) {
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {bars.map((b) => {
        const col = CHART_COLOR[b.accent ?? accent];
        const h = Math.max(4, (Math.abs(b.value) / max) * (height - 18));
        return (
          <div key={b.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div
              className="w-full rounded-md"
              style={{ height: h, background: `linear-gradient(180deg, ${col.stroke} 0%, ${col.soft} 100%)` }}
            />
            <span className="w-full truncate text-center text-[9px] font-medium text-zinc-600">{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── ProgressRing ───────────────────────────────────────────────────────────────
// A generic circular progress ring (the Margen-agnostic sibling of MargenRing).
// Used for goal / wealth / shared-goal progress.
export function ProgressRing({
  fraction,
  accent = "violet",
  size = 132,
  stroke = 10,
  children,
}: {
  fraction: number;
  accent?: ChartAccent;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const c = CHART_COLOR[accent];
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const safe = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg aria-hidden className="-rotate-90" height={size} width={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} fill="none" r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={r}
          stroke={c.stroke}
          strokeDasharray={`${circ * safe} ${circ}`}
          strokeLinecap="round"
          strokeWidth={stroke}
          style={{ filter: `drop-shadow(0 0 8px ${c.glow})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

// ── StackedBar ───────────────────────────────────────────────────────────────
// One horizontal bar split into proportional segments (e.g. Margen reserves, or
// net-worth liquid vs invested). Calm composition, no pie chart. Zero-total → a
// quiet empty track.
export function StackedBar({
  segments,
  ariaLabel,
}: {
  segments: { label: string; value: number; accent: ChartAccent }[];
  ariaLabel?: string;
}) {
  const positive = segments.filter((s) => s.value > 0);
  const total = positive.reduce((s, x) => s + x.value, 0);
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/8">
        {total > 0 &&
          positive.map((s) => (
            <div
              key={s.label}
              style={{ width: `${(s.value / total) * 100}%`, background: CHART_COLOR[s.accent].stroke }}
              className="h-full"
            />
          ))}
      </div>
      {total > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {positive.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5 text-[10px] font-medium text-zinc-500">
              <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLOR[s.accent].stroke }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── TrendPill ──────────────────────────────────────────────────────────────────
// Tiny delta indicator for a snapshot trend. Color follows the GOOD direction
// (improvement = emerald, worse = rose), never raw up/down. Silent for no-prior.
export function TrendPill({
  direction,
  deltaPct,
  isImprovement,
}: {
  direction: "up" | "down" | "flat" | "no_prior";
  deltaPct: number | null;
  isImprovement: boolean | null;
}) {
  if (direction === "no_prior") return null;
  if (direction === "flat") {
    return <span className="text-[10px] font-semibold text-zinc-600">estable</span>;
  }
  const tone = isImprovement ? "text-emerald-300" : "text-rose-300";
  const arrow = direction === "up" ? "↑" : "↓";
  const pct = deltaPct !== null ? `${Math.abs(deltaPct)}%` : "";
  return (
    <span className={`text-[10px] font-bold ${tone}`}>
      {arrow} {pct}
    </span>
  );
}

// ── CashflowTimeline ─────────────────────────────────────────────────────────
// A compact, calm upcoming-money timeline (NOT a spreadsheet). A baseline marks
// the horizon; each dated event is a colored dot positioned by how soon it lands;
// risk windows shade their band. Income/bill/card/goal each have a color. Empty →
// nothing rendered (the caller shows the empty state).
const TIMELINE_DOT: Record<string, ChartAccent> = {
  income: "emerald",
  fixed: "amber",
  scheduled: "amber",
  card: "orange",
  debt: "orange",
  goal: "violet",
  savings: "teal",
};

export function CashflowTimeline({
  events,
  horizonDays,
}: {
  events: { daysFromNow: number; kind: string; label: string; risk?: boolean }[];
  horizonDays: number;
}) {
  const span = Math.max(7, horizonDays);
  const shown = events.filter((e) => e.daysFromNow >= 0 && e.daysFromNow <= span).slice(0, 14);
  if (shown.length === 0) return null;
  const pos = (d: number) => `${Math.min(98, Math.max(2, (d / span) * 100))}%`;
  return (
    <div className="relative h-12 w-full">
      {/* baseline */}
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
      {/* risk shading */}
      {shown
        .filter((e) => e.risk)
        .map((e, i) => (
          <div
            key={`r${i}`}
            className="absolute top-1/2 h-6 w-3 -translate-y-1/2 rounded-sm"
            style={{ left: pos(e.daysFromNow), background: "rgba(251,113,133,0.16)" }}
          />
        ))}
      {/* event dots */}
      {shown.map((e, i) => {
        const col = CHART_COLOR[TIMELINE_DOT[e.kind] ?? "zinc"];
        return (
          <span
            key={`e${i}`}
            title={`${e.label} · ${e.daysFromNow === 0 ? "hoy" : `en ${e.daysFromNow}d`}`}
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-zinc-950"
            style={{ left: pos(e.daysFromNow), background: col.stroke }}
          />
        );
      })}
      <span className="absolute left-0 top-0 text-[9px] font-medium text-zinc-600">hoy</span>
      <span className="absolute right-0 top-0 text-[9px] font-medium text-zinc-600">{span}d</span>
    </div>
  );
}
