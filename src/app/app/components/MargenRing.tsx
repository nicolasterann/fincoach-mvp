import type { ReactNode } from "react";
import type { MargenStatus } from "./app-dashboard-helpers";

// The iconic Margen Kipu ring: the arc is the share of this week's spending air
// still available. Alive, not static — a breathing glow and a slow shimmer
// orbiting the track (CSS only; respects prefers-reduced-motion). Pure SVG,
// server-rendered.
export function MargenRing({
  fraction,
  status,
  size = 168,
  children,
}: {
  fraction: number; // 0..1 of the week's air remaining
  status: MargenStatus;
  size?: number;
  children: ReactNode;
}) {
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const safe = Math.max(0, Math.min(1, fraction));
  const arcColor =
    status === "healthy" ? "#34d399" : status === "tight" ? "#fbbf24" : "#fb7185";
  const glow =
    status === "healthy"
      ? "rgba(52,211,153,0.30)"
      : status === "tight"
        ? "rgba(251,191,36,0.26)"
        : "rgba(251,113,133,0.26)";

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {/* Breathing aura behind the ring */}
      <div
        className="kipu-breathe absolute inset-3 rounded-full blur-xl"
        style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 70%)` }}
      />
      {/* Slow shimmer orbiting the track */}
      <div
        className="kipu-spin-slow absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(from 0deg, transparent 0deg, ${arcColor}33 60deg, transparent 130deg, transparent 360deg)`,
          mask: `radial-gradient(circle, transparent ${((r - stroke / 2 - 1) / (size / 2)) * 100}%, black ${((r - stroke / 2) / (size / 2)) * 100}%, black ${((r + stroke / 2) / (size / 2)) * 100}%, transparent ${((r + stroke / 2 + 1) / (size / 2)) * 100}%)`,
          WebkitMask: `radial-gradient(circle, transparent ${((r - stroke / 2 - 1) / (size / 2)) * 100}%, black ${((r - stroke / 2) / (size / 2)) * 100}%, black ${((r + stroke / 2) / (size / 2)) * 100}%, transparent ${((r + stroke / 2 + 1) / (size / 2)) * 100}%)`,
        }}
      />
      <svg
        aria-hidden
        className="relative -rotate-90"
        height={size}
        width={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* Tick field (the "instrument" feel) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={r - stroke / 2 - 5}
          stroke="color-mix(in srgb, var(--color-line) 10%, transparent)"
          strokeDasharray="1.5 6"
          strokeWidth={3}
        />
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={r}
          stroke="color-mix(in srgb, var(--color-line) 8%, transparent)"
          strokeWidth={stroke}
        />
        {/* Live arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={r}
          stroke={arcColor}
          strokeDasharray={`${c * safe} ${c}`}
          strokeLinecap="round"
          strokeWidth={stroke}
          style={{ filter: `drop-shadow(0 0 12px ${glow})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
}
