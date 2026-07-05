import type { ReactNode } from "react";

// Stage 27 — Kipu's signature living visual: a woven ring of quipu strands
// (the Andean knotted-cord ledger) slowly weaving around a hero metric. Three
// strands rotate at different speeds/directions with knots along the cords;
// color follows the metric's real state. Pure server-rendered SVG + CSS
// animation: zero hydration, zero JS, respects prefers-reduced-motion (the
// strands simply hold still).

export type ThreadTone = "healthy" | "tight" | "alert" | "violet" | "teal" | "neutral";

const TONE: Record<ThreadTone, { a: string; b: string; glow: string }> = {
  healthy: { a: "#34d399", b: "#2dd4bf", glow: "rgba(52,211,153,0.22)" },
  tight: { a: "#fbbf24", b: "#fb923c", glow: "rgba(251,191,36,0.20)" },
  alert: { a: "#fb7185", b: "#f472b6", glow: "rgba(251,113,133,0.20)" },
  violet: { a: "#a78bfa", b: "#818cf8", glow: "rgba(167,139,250,0.22)" },
  teal: { a: "#2dd4bf", b: "#38bdf8", glow: "rgba(45,212,191,0.20)" },
  neutral: { a: "#a1a1aa", b: "#71717a", glow: "rgba(161,161,170,0.14)" },
};

// Deterministic knot angles (no Math.random — hydration- and RSC-safe).
const KNOTS_A = [18, 92, 167, 241, 313];
const KNOTS_B = [45, 138, 226, 305];

function knotPos(angleDeg: number, r: number, center: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: center + r * Math.cos(rad), y: center + r * Math.sin(rad) };
}

export function LivingThread({
  tone,
  size = 216,
  children,
  className = "",
}: {
  tone: ThreadTone;
  size?: number;
  children: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  const center = size / 2;
  // Three strand radii hugging the outer margin of the wrapped content.
  const rA = center - 5;
  const rB = center - 11;
  const rC = center - 8;

  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {/* Soft state-colored aura */}
      <div
        aria-hidden
        className="kipu-breathe absolute inset-4 rounded-full blur-2xl"
        style={{ background: `radial-gradient(circle, ${t.glow} 0%, transparent 70%)` }}
      />
      <svg aria-hidden className="absolute inset-0" height={size} width={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={`kipu-strand-${tone}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={t.a} />
            <stop offset="100%" stopColor={t.b} />
          </linearGradient>
        </defs>
        {/* Strand A — segmented cord, forward weave, with knots */}
        <g className="kipu-weave-a">
          <circle
            cx={center}
            cy={center}
            r={rA}
            fill="none"
            stroke={`url(#kipu-strand-${tone})`}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeDasharray="30 14 8 18 44 10"
            opacity={0.85}
          />
          {KNOTS_A.map((deg) => {
            const p = knotPos(deg, rA, center);
            return <circle key={deg} cx={p.x} cy={p.y} r={2.6} fill={t.a} opacity={0.95} />;
          })}
        </g>
        {/* Strand B — counter-weave, thinner, quieter */}
        <g className="kipu-weave-b">
          <circle
            cx={center}
            cy={center}
            r={rB}
            fill="none"
            stroke={t.b}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeDasharray="16 22 52 12"
            opacity={0.5}
          />
          {KNOTS_B.map((deg) => {
            const p = knotPos(deg, rB, center);
            return <circle key={deg} cx={p.x} cy={p.y} r={1.9} fill={t.b} opacity={0.7} />;
          })}
        </g>
        {/* Strand C — faint white filament, slowest, gives depth */}
        <g className="kipu-weave-c">
          <circle
            cx={center}
            cy={center}
            r={rC}
            fill="none"
            stroke="color-mix(in srgb, var(--color-line) 22%, transparent)"
            strokeWidth={1}
            strokeDasharray="4 30 22 40"
          />
        </g>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
