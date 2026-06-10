import type { ReactNode } from "react";

// Pulso Kipu — the signature living visual: a breathing, glowing organism that
// embodies the user's financial wellness state. Whoop-Age energy, Kipu truth:
// the score is the real readiness composite (margin, debt, goal, accuracy,
// learned reality), never invented. Pure server-rendered markup + CSS motion;
// respects prefers-reduced-motion.

export type PulsoBand = "high" | "mid" | "low";

export function pulsoBand(score: number): PulsoBand {
  if (score >= 72) return "high";
  if (score >= 45) return "mid";
  return "low";
}

const BAND = {
  high: {
    glow: "rgba(52,211,153,0.35)",
    ring: "rgba(52,211,153,0.55)",
    inner: "rgba(16,185,129,0.16)",
    dot: "bg-emerald-300",
  },
  mid: {
    glow: "rgba(251,191,36,0.30)",
    ring: "rgba(251,191,36,0.50)",
    inner: "rgba(245,158,11,0.14)",
    dot: "bg-amber-300",
  },
  low: {
    glow: "rgba(251,113,133,0.30)",
    ring: "rgba(251,113,133,0.50)",
    inner: "rgba(244,63,94,0.14)",
    dot: "bg-rose-300",
  },
} as const;

// Deterministic particle field (no Math.random — stable across renders).
const PARTICLES: { top: string; left: string; size: number; anim: string }[] = [
  { top: "12%", left: "28%", size: 4, anim: "kipu-float-a" },
  { top: "20%", left: "70%", size: 3, anim: "kipu-float-b" },
  { top: "34%", left: "12%", size: 3, anim: "kipu-float-c" },
  { top: "48%", left: "86%", size: 4, anim: "kipu-float-a" },
  { top: "66%", left: "18%", size: 3, anim: "kipu-float-b" },
  { top: "74%", left: "64%", size: 4, anim: "kipu-float-c" },
  { top: "84%", left: "38%", size: 3, anim: "kipu-float-a" },
  { top: "30%", left: "48%", size: 2, anim: "kipu-float-b" },
];

export function PulsoOrb({
  score,
  size = 180,
  children,
}: {
  score: number;
  size?: number;
  children?: ReactNode;
}) {
  const band = BAND[pulsoBand(score)];

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {/* Breathing outer glow */}
      <div
        className="kipu-breathe absolute inset-0 rounded-full blur-2xl"
        style={{ background: `radial-gradient(circle, ${band.glow} 0%, transparent 70%)` }}
      />
      {/* Slow-rotating halo */}
      <div
        className="kipu-spin-slow absolute inset-1 rounded-full"
        style={{
          background: `conic-gradient(from 0deg, transparent 0deg, ${band.ring} 80deg, transparent 160deg, transparent 360deg)`,
          mask: "radial-gradient(circle, transparent 62%, black 66%, black 72%, transparent 76%)",
          WebkitMask:
            "radial-gradient(circle, transparent 62%, black 66%, black 72%, transparent 76%)",
        }}
      />
      {/* Membrane ring */}
      <div
        className="absolute inset-2 rounded-full border"
        style={{ borderColor: band.ring, boxShadow: `inset 0 0 28px ${band.inner}` }}
      />
      {/* Inner atmosphere */}
      <div
        className="absolute inset-2 rounded-full"
        style={{
          background: `radial-gradient(circle at 38% 32%, ${band.inner} 0%, transparent 55%), radial-gradient(circle at 68% 72%, ${band.inner} 0%, transparent 50%)`,
        }}
      />
      {/* Particle field */}
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className={`absolute rounded-full ${band.dot} ${p.anim}`}
          style={{ top: p.top, left: p.left, width: p.size, height: p.size }}
        />
      ))}
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
}
