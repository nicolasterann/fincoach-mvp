import { formatKipuMoney } from "@/lib/financial/money";
import type { CurrencyCode } from "@/types/financial";

// Stage 36 — "Tu mes" as a Sankey. A single-source flow: income on the left
// branches into its outflows (fijos, deuda, esenciales, ahorro, inversión, metas)
// and what's LEFT to distribute. Pure SVG, no dependencies. The point isn't a
// spendable number — it's SEEING how a typical month splits. So the copy that
// wraps this must say "repartir / apartar", never "gastar" (that's the Margen).

export type SankeyTone = "income" | "fixed" | "debt" | "essential" | "reserve" | "goal" | "free";

export interface SankeyFlow {
  key: string;
  label: string;
  amount: number;
  tone: SankeyTone;
}

const TONE: Record<SankeyTone, { bar: string; ribbon: string; text: string }> = {
  income: { bar: "#34d399", ribbon: "#34d399", text: "#a7f3d0" },
  fixed: { bar: "#a1a1aa", ribbon: "#71717a", text: "#e4e4e7" },
  debt: { bar: "#fb7185", ribbon: "#e11d48", text: "#fecdd3" },
  essential: { bar: "#fbbf24", ribbon: "#d97706", text: "#fde68a" },
  reserve: { bar: "#38bdf8", ribbon: "#0ea5e9", text: "#bae6fd" },
  goal: { bar: "#a78bfa", ribbon: "#8b5cf6", text: "#ddd6fe" },
  free: { bar: "#34d399", ribbon: "#10b981", text: "#a7f3d0" },
};

// A smooth ribbon from the left income slice (yl0..yl1) to a right node (yr0..yr1).
function ribbonPath(xL: number, xR: number, yl0: number, yl1: number, yr0: number, yr1: number): string {
  const cx = (xL + xR) / 2;
  return [
    `M ${xL} ${yl0}`,
    `C ${cx} ${yl0}, ${cx} ${yr0}, ${xR} ${yr0}`,
    `L ${xR} ${yr1}`,
    `C ${cx} ${yr1}, ${cx} ${yl1}, ${xL} ${yl1}`,
    "Z",
  ].join(" ");
}

interface LaidOutRow {
  f: SankeyFlow;
  yl0: number; // left slice (TRUE proportion — the ribbon width is honest)
  yl1: number;
  yr0: number; // right node (TRUE proportion, floored a touch so a tiny one is visible)
  yr1: number;
  labelY: number; // de-collided label center (may differ from the node mid)
}

// Pure layout (outside the component so the React compiler doesn't flag the running
// cursors as render-scope mutation). Ribbons/nodes keep TRUE proportions (honest
// widths); LABELS are pushed apart to a minimum spacing so thin nodes stay legible,
// with a connector drawn from the node to its label.
function layoutSankey(rows: SankeyFlow[], income: number, usableH: number): { items: LaidOutRow[]; totalH: number } {
  const gap = 6;
  const minNodeH = 10;
  const labelSlot = 62; // vertical room a two-line label needs
  const nodes: { f: SankeyFlow; yl0: number; yl1: number; yr0: number; yr1: number; mid: number }[] = [];
  let ylCursor = 0;
  let yrCursor = 0;
  for (const f of rows) {
    const hTrue = (f.amount / income) * usableH;
    const yl0 = ylCursor;
    const yl1 = ylCursor + hTrue;
    ylCursor = yl1;
    const hNode = Math.max(minNodeH, hTrue);
    const yr0 = yrCursor;
    const yr1 = yrCursor + hNode;
    yrCursor = yr1 + gap;
    nodes.push({ f, yl0, yl1, yr0, yr1, mid: (yr0 + yr1) / 2 });
  }
  // De-collide labels: each at least labelSlot below the previous.
  const labelYs: number[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const target = nodes[i].mid;
    const floor = i === 0 ? labelSlot / 2 : labelYs[i - 1] + labelSlot;
    labelYs.push(Math.max(target, floor));
  }
  const items: LaidOutRow[] = nodes.map((n, i) => ({ f: n.f, yl0: n.yl0, yl1: n.yl1, yr0: n.yr0, yr1: n.yr1, labelY: labelYs[i] }));
  const totalH = Math.max(nodes.length ? nodes[nodes.length - 1].yr1 : 0, labelYs.length ? labelYs[labelYs.length - 1] + labelSlot / 2 : 0);
  return { items, totalH };
}

/**
 * Single-source Sankey. `flows` are the right-side nodes (outflows + the leftover);
 * their amounts should sum to `income` (the caller computes the leftover so it
 * balances). Zero/negative flows are dropped.
 */
export function MonthSankey({
  income,
  flows,
  base,
  className,
}: {
  income: number;
  flows: SankeyFlow[];
  base: CurrencyCode;
  className?: string;
}) {
  const rows = flows.filter((f) => f.amount > 0.005);
  const total = rows.reduce((s, f) => s + f.amount, 0);
  if (income <= 0 || total <= 0 || rows.length === 0) {
    return (
      <div className={`rounded-2xl border border-white/10 bg-zinc-900/40 p-5 text-center text-sm text-zinc-400 ${className ?? ""}`}>
        Cuéntame tus ingresos y gastos y aquí ves cómo se reparte tu mes.
      </div>
    );
  }

  const W = 1000;
  const usableH = Math.max(200, rows.length * 52);
  const nodeW = 22;
  const xLeftR = nodeW;
  const xRightL = W * 0.40;
  const xRightR = xRightL + nodeW;
  const labelX = xRightR + 18;

  const { items, totalH } = layoutSankey(rows, income, usableH);
  const svgH = Math.max(usableH, totalH) + 44; // room for the income caption

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${svgH}`} className="w-full" role="img" aria-label="Cómo se reparte tu mes" preserveAspectRatio="xMidYMid meet">
        <rect x={0} y={0} width={nodeW} height={usableH} rx={5} fill={TONE.income.bar} opacity={0.92} />
        {items.map(({ f, yl0, yl1, yr0, yr1 }) => (
          <path key={`r-${f.key}`} d={ribbonPath(xLeftR, xRightL, yl0, yl1, yr0, yr1)} fill={TONE[f.tone].ribbon} opacity={f.tone === "free" ? 0.4 : 0.26} />
        ))}
        {items.map(({ f, yr0, yr1, labelY }) => {
          const mid = (yr0 + yr1) / 2;
          const t = TONE[f.tone];
          return (
            <g key={`n-${f.key}`}>
              <rect x={xRightL} y={yr0} width={nodeW} height={yr1 - yr0} rx={4} fill={t.bar} opacity={0.95} />
              {/* connector when the label was pushed off the node's center */}
              {Math.abs(labelY - mid) > 3 && (
                <path d={`M ${xRightR} ${mid} C ${xRightR + 9} ${mid}, ${xRightR + 9} ${labelY}, ${labelX - 4} ${labelY}`} stroke={t.bar} strokeWidth={1.5} fill="none" opacity={0.5} />
              )}
              <text x={labelX} y={labelY - 5} fontSize={25} fontWeight={700} fill={t.text}>
                {f.label}
              </text>
              <text x={labelX} y={labelY + 22} fontSize={23} fill="#a1a1aa" className="tabular-nums">
                {formatKipuMoney(f.amount, base)}
              </text>
            </g>
          );
        })}
        <text x={0} y={usableH + 30} fontSize={22} fontWeight={600} fill={TONE.income.text}>
          Entra {formatKipuMoney(income, base)}
        </text>
      </svg>
    </div>
  );
}
