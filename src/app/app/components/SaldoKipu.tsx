import type { SaldoKipu } from "@/lib/financial/margen-kipu";

// The cord survives as history and identity in /app/saldo; it is no longer the
// home hero. Its rendering stays byte-for-byte equivalent to the accepted M9
// implementation.
const KNOT_SLOTS = 10; // cap = 10 días de gustos → one knot per day of calm

function knotTone(fraction: number): { fill: string; glow: string; dim: string } {
  if (fraction <= 0.02) return { fill: "#fb7185", glow: "rgba(251,113,133,0.45)", dim: "rgba(251,113,133,0.15)" };
  if (fraction < 0.3) return { fill: "#fbbf24", glow: "rgba(251,191,36,0.45)", dim: "rgba(251,191,36,0.15)" };
  return { fill: "#34d399", glow: "rgba(52,211,153,0.45)", dim: "rgba(52,211,153,0.15)" };
}

/** The quipu cord visual. Pure SVG; sized by `height`. */
export function QuipuCord({
  saldo,
  height = 232,
  showLayerKnots = true,
}: {
  saldo: SaldoKipu;
  height?: number;
  showLayerKnots?: boolean;
}) {
  const fraction = saldo.cap > 0 ? Math.max(0, Math.min(1, saldo.saldo / saldo.cap)) : 0;
  const filled = saldo.cap > 0 ? Math.max(fraction > 0 ? 1 : 0, Math.round(fraction * KNOT_SLOTS)) : 0;
  const tone = knotTone(fraction);
  const width = 72;
  const cx = width / 2;
  const spacing = (height - 64) / KNOT_SLOTS;
  const baselineY = height - 40; // "hoy" line; layer knots live below it
  const knotY = (i: number) => baselineY - 10 - i * spacing; // slot 0 just above the line
  const empty = filled === 0;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Saldo Kipu: ${filled} de ${KNOT_SLOTS} nudos`}
      className="shrink-0"
    >
      {/* the cord — one continuous strand, quipu DNA */}
      <line x1={cx} y1={10} x2={cx} y2={height - 8} stroke="currentColor" strokeOpacity={0.14} strokeWidth={1.6} strokeLinecap="round" className="text-line" />
      {/* "hoy" baseline — separates the saldo from the protected layers */}
      <line x1={6} y1={baselineY} x2={width - 6} y2={baselineY} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1.2} className="text-line" strokeDasharray="1 4" strokeLinecap="round" />
      {/* knot slots (faint) + filled knots */}
      {Array.from({ length: KNOT_SLOTS }, (_, i) => {
        const y = knotY(i);
        const isFilled = i < filled;
        const isTop = i === filled - 1;
        return (
          <g key={i}>
            {isFilled ? (
              <>
                {isTop && (
                  <circle cx={cx} cy={y} r={11} fill={tone.glow} opacity={0.5} className="kipu-breathe" style={{ transformOrigin: `${cx}px ${y}px` }} />
                )}
                <ellipse cx={cx} cy={y} rx={8.5} ry={6.5} fill={tone.fill} opacity={isTop ? 1 : 0.88} />
                <ellipse cx={cx - 2} cy={y - 2} rx={2.6} ry={1.8} fill="#ffffff" opacity={0.35} />
              </>
            ) : (
              <circle cx={cx} cy={y} r={2.6} fill="currentColor" opacity={0.10} className="text-line" />
            )}
          </g>
        );
      })}
      {/* protected layers below the line — sealed knots; the first glows when the
          saldo is empty (the visual "descends into the next layer") */}
      {showLayerKnots && (
        <>
          <ellipse cx={cx} cy={baselineY + 14} rx={7} ry={5.5} fill={empty ? "#38bdf8" : "rgba(56,189,248,0.30)"} opacity={empty ? 0.95 : 0.6} />
          {empty && <circle cx={cx} cy={baselineY + 14} r={10.5} fill="rgba(56,189,248,0.35)" opacity={0.5} className="kipu-breathe" style={{ transformOrigin: `${cx}px ${baselineY + 14}px` }} />}
          <ellipse cx={cx} cy={baselineY + 27} rx={5.5} ry={4.5} fill="currentColor" opacity={0.12} className="text-line" />
        </>
      )}
    </svg>
  );
}

