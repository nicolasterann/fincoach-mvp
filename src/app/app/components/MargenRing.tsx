import type { ReactNode } from "react";
import type { MargenStatus } from "./app-dashboard-helpers";

// The iconic Margen Kipu ring (Whoop-style): the arc is the share of this
// week's spending air that is still available. Pure SVG — renders on the
// server, no client JS.
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
      ? "rgba(52,211,153,0.25)"
      : status === "tight"
        ? "rgba(251,191,36,0.22)"
        : "rgba(251,113,133,0.22)";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        aria-hidden
        className="-rotate-90"
        height={size}
        width={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={r}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
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
