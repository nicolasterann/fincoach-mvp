import { formatKipuMoney } from "@/lib/financial/money";
import type { CurrencyCode } from "@/types/financial";

// Stage 36.1 — "Tu mes" as a multi-stage income-statement Sankey (founder's
// reference: App Economy Insights' Micron/Walmart charts). One wide income flow
// enters at the left and moves right through junction bars; at each junction one
// obligation DIVES OFF as its own colored ribbon into its own node below, so the
// surviving emerald flow visibly narrows stage by stage until what reaches the
// right edge is "Libre para repartir". Planning language only: the copy around
// this says repartir/apartar, never "gastar" (that's the Margen, the daily hero).
// Pure SVG, no dependencies; on mobile the whole canvas simply scales down.

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

const round1 = (n: number): number => Math.round(n * 10) / 10;

// Geometry (viewBox units; the svg scales to its container).
const W = 1000;
const TOP_LABEL_Y = 34; // running amounts ride just above the bars
const Y_TOP = 46;
const HT = 240; // income bar height (everything else is proportional)
const NODE_W = 20;
const JUNCTION_W = 14;
const DEST_W = 16;
const X_FINAL = 750; // final bar left edge; the right margin holds the hero label
const FINAL_LABEL_X = X_FINAL + NODE_W + 12;
const DEST_GAP = 26; // how far below the income bar the outflow nodes hang

// Constant-thickness sankey link: top edge cubic, right face, bottom edge back.
function sankeyLink(x0: number, y0: number, x1: number, y1: number, t: number): string {
  const cx = (x0 + x1) / 2;
  return [
    `M ${round1(x0)} ${round1(y0)}`,
    `C ${round1(cx)} ${round1(y0)}, ${round1(cx)} ${round1(y1)}, ${round1(x1)} ${round1(y1)}`,
    `L ${round1(x1)} ${round1(y1 + t)}`,
    `C ${round1(cx)} ${round1(y1 + t)}, ${round1(cx)} ${round1(y0 + t)}, ${round1(x0)} ${round1(y0 + t)}`,
    "Z",
  ].join(" ");
}

interface MainSeg {
  key: number;
  x: number;
  w: number;
  t: number;
}

interface JunctionBar {
  key: number;
  x: number;
  h: number;
  cx: number;
  remaining: number;
}

interface DestNode {
  f: SankeyFlow;
  ribbon: string | null;
  barX: number;
  barY: number;
  barH: number;
  nameY: number;
  amountY: number;
}

interface FlowLayout {
  mainSegs: MainSeg[];
  junctions: JunctionBar[];
  dests: DestNode[];
  finalT: number;
  svgH: number;
}

// Pure layout (outside the component so the React compiler doesn't flag the
// running cursors as render-scope mutation). The flow keeps TRUE proportions —
// ribbon thickness is honest money; only the tiny outflow NODES are floored so a
// small obligation stays visible and clickable to the eye.
function layoutMonthFlow(peelers: SankeyFlow[], income: number): FlowLayout {
  const s = HT / income;
  const n = peelers.length;
  if (n === 0) {
    return {
      mainSegs: [{ key: 0, x: NODE_W, w: X_FINAL - NODE_W, t: HT }],
      junctions: [],
      dests: [],
      finalT: HT,
      svgH: Y_TOP + HT + 20,
    };
  }

  // Remaining money after each peel; clamped so over-allocation can't go negative.
  const A: number[] = [income];
  for (const p of peelers) A.push(Math.max(0, A[A.length - 1] - p.amount));

  // Bar edges: bar 0 = income, bars 1..n-1 = junctions, bar n = final.
  const barL: number[] = [0];
  const barR: number[] = [NODE_W];
  for (let k = 1; k < n; k += 1) {
    const cx = NODE_W + ((X_FINAL - NODE_W) * k) / n;
    barL.push(cx - JUNCTION_W / 2);
    barR.push(cx + JUNCTION_W / 2);
  }
  barL.push(X_FINAL);
  barR.push(X_FINAL + NODE_W);

  const mainSegs: MainSeg[] = [];
  for (let k = 0; k < n; k += 1) {
    const t = A[k + 1] * s;
    if (t > 0.5) mainSegs.push({ key: k, x: barR[k], w: barL[k + 1] - barR[k], t });
  }

  const junctions: JunctionBar[] = [];
  for (let k = 1; k < n; k += 1) {
    junctions.push({
      key: k,
      x: barL[k],
      h: Math.max(A[k] * s, 6),
      cx: NODE_W + ((X_FINAL - NODE_W) * k) / n,
      remaining: A[k],
    });
  }

  const destTop = Y_TOP + HT + DEST_GAP;
  const dests: DestNode[] = peelers.map((f, k) => {
    const t = (A[k] - A[k + 1]) * s;
    const tDraw = Math.max(t, 5);
    const barX = barR[k] + (barL[k + 1] - barR[k]) * 0.55 - DEST_W / 2;
    const barH = Math.max(t, 10);
    // The ribbon leaves from the BOTTOM slice of bar k (hugging its lower edge).
    const ribbon = t > 0.3 ? sankeyLink(barR[k], Y_TOP + A[k] * s - tDraw, barX, destTop, tDraw) : null;
    const bottom = destTop + barH;
    return { f, ribbon, barX, barY: destTop, barH, nameY: bottom + 26, amountY: bottom + 50 };
  });

  const finalT = A[n] > 0.005 ? Math.max(A[n] * s, 6) : 0;
  const deepest = Math.max(...dests.map((d) => d.amountY));
  return { mainSegs, junctions, dests, finalT, svgH: Math.max(deepest + 16, Y_TOP + HT + 20) };
}

/**
 * Multi-stage horizontal Sankey. `flows` are the outflows plus the leftover (the
 * caller passes the "free" flow so it balances to `income`). Non-free flows peel
 * off left→right in the given order; the "free" flow is what survives to the
 * right edge. Zero/negative flows are dropped.
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

  const peelers = rows.filter((f) => f.tone !== "free");
  const survivor = rows.find((f) => f.tone === "free") ?? null;
  const { mainSegs, junctions, dests, finalT, svgH } = layoutMonthFlow(peelers, income);

  // The real onboarding case is 3 obligations + libre and reads at full size; if a
  // future surface feeds more flows, labels shrink so each stays in its own column.
  const labelScale = peelers.length <= 3 ? 1 : peelers.length === 4 ? 0.8 : Math.max(0.5, 2.4 / peelers.length);
  const nameSize = Math.max(12, Math.round(23 * labelScale));
  const amountSize = Math.max(11, Math.round(21 * labelScale));
  const showRunning = junctions.length > 0 && peelers.length <= 3;
  const finalMid = Y_TOP + finalT / 2;

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${svgH}`}
        className="w-full"
        role="img"
        aria-label="Cómo se reparte tu mes: entra tu ingreso, cada gasto se desvía por su propio flujo y queda lo libre para repartir"
        preserveAspectRatio="xMidYMid meet"
      >
        {mainSegs.map((m) => (
          <rect key={`m-${m.key}`} x={round1(m.x)} y={Y_TOP} width={round1(m.w)} height={round1(m.t)} fill={TONE.income.bar} opacity={0.3} />
        ))}
        {dests.map((d) =>
          d.ribbon ? <path key={`rb-${d.f.key}`} d={d.ribbon} fill={TONE[d.f.tone].bar} opacity={0.45} /> : null,
        )}

        <rect x={0} y={Y_TOP} width={NODE_W} height={HT} rx={5} fill={TONE.income.bar} opacity={0.95} />
        {junctions.map((j) => (
          <rect key={`j-${j.key}`} x={round1(j.x)} y={Y_TOP} width={JUNCTION_W} height={round1(j.h)} rx={3} fill={TONE.income.bar} opacity={0.9} />
        ))}
        {finalT > 0 && <rect x={X_FINAL} y={Y_TOP} width={NODE_W} height={round1(finalT)} rx={5} fill={TONE.free.bar} opacity={0.98} />}

        {dests.map((d) => {
          const t = TONE[d.f.tone];
          return (
            <g key={`d-${d.f.key}`}>
              <rect x={round1(d.barX)} y={round1(d.barY)} width={DEST_W} height={round1(d.barH)} rx={3} fill={t.bar} opacity={0.96} />
              <text x={round1(d.barX)} y={round1(d.nameY)} fontSize={nameSize} fontWeight={700} fill={t.text}>
                {d.f.label}
              </text>
              <text x={round1(d.barX)} y={round1(d.amountY)} fontSize={amountSize} fill="#a1a1aa" className="tabular-nums">
                {formatKipuMoney(d.f.amount, base)}
              </text>
            </g>
          );
        })}

        <text x={0} y={TOP_LABEL_Y} fontSize={22} fontWeight={600} fill={TONE.income.text}>
          Entra {formatKipuMoney(income, base)}
        </text>
        {showRunning &&
          junctions.map((j) => (
            <text key={`jr-${j.key}`} x={round1(j.cx)} y={TOP_LABEL_Y} fontSize={17} fill="#71717a" textAnchor="middle" className="tabular-nums">
              {formatKipuMoney(j.remaining, base)}
            </text>
          ))}

        {survivor && finalT > 0 && (
          <g>
            <text x={FINAL_LABEL_X} y={round1(finalMid - 8)} fontSize={22} fontWeight={700} fill={TONE.free.text}>
              {survivor.label}
            </text>
            <text x={FINAL_LABEL_X} y={round1(finalMid + 28)} fontSize={32} fontWeight={800} fill="#6ee7b7" className="tabular-nums">
              {formatKipuMoney(survivor.amount, base)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
