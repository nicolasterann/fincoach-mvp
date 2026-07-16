import Link from "next/link";
import type { SaldoKipu } from "@/lib/financial/margen-kipu";
import type { TransferAlert } from "@/lib/financial/coaching-signals";
import { Chevron, PressCard } from "./living/shell";
import { formatDateEs } from "@/lib/format/dates-es";

// Stage D — the Saldo Kipu hero: a vertical quipu cord whose KNOTS rise as the
// saldo accumulates and drop as the user spends. The shape explains itself:
// height = how full; the hairline is "hoy" (the line between your spendable
// saldo and the protected layers below); when the saldo is empty the next layer
// glows below the line. No ring, no score, no status words, no explainer
// paragraphs — the form and the exact amount carry the meaning (per the design
// spec). Server-rendered SVG + CSS only; respects prefers-reduced-motion.

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

/** The home hero card. Only: "Saldo Kipu" + exact amount + the quipu + the next
 *  layer when it matters. Everything else lives one tap away (/app/saldo). */
export function SaldoKipuHero({
  saldo,
  amountLabel,
  runwayLine,
}: {
  saldo: SaldoKipu;
  amountLabel: string;
  /** Present ONLY in runway mode (income stopped) — a concrete, decision-ready line. */
  runwayLine?: string | null;
}) {
  const fraction = saldo.cap > 0 ? saldo.saldo / saldo.cap : 0;
  const tone = knotTone(fraction);
  const empty = saldo.cap <= 0 || saldo.saldo <= 0.01;
  return (
    <Link
      href="/app/saldo"
      aria-label="Saldo Kipu — ver el detalle"
      className="kipu-press group block rounded-3xl border border-line/5 bg-gradient-to-b from-zinc-900 to-zinc-950 p-6 shadow-2xl sm:p-8"
    >
      <div className="flex items-center gap-6 sm:gap-8">
        <QuipuCord saldo={saldo} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-500">Saldo Kipu</p>
          <p className="mt-2 text-4xl font-black leading-none tracking-tight sm:text-5xl" style={{ color: tone.fill }}>
            {amountLabel}
          </p>
          {runwayLine ? (
            <p className="mt-4 text-sm leading-6 text-zinc-400">{runwayLine}</p>
          ) : empty ? (
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              Se recarga solo cada día. Lo de abajo es tu{" "}
              <span className="font-semibold text-sky-300">Reserva</span> — protegida, se toca solo si tú decides.
            </p>
          ) : null}
          <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-zinc-600 transition group-hover:text-zinc-400">
            Ver el detalle
            <Chevron />
          </span>
        </div>
      </div>
    </Link>
  );
}

/** "Hoy" — what recharged and what went to gustos today. Concrete, no scores. */
export function HoyCard({
  fillLabel,
  spentLabel,
  spentIsZero,
}: {
  fillLabel: string;
  spentLabel: string;
  spentIsZero: boolean;
}) {
  return (
    <PressCard href="/app/activity" className="p-5" ariaLabel="Hoy — recarga y gustos del día">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-zinc-300">Hoy</p>
        <Chevron className="shrink-0" />
      </div>
      <div className="mt-3 flex items-center gap-6">
        <div>
          <p className="text-lg font-bold text-emerald-300">+{fillLabel}</p>
          <p className="text-[11px] text-zinc-600">se recargó</p>
        </div>
        <div>
          <p className={`text-lg font-bold ${spentIsZero ? "text-zinc-500" : "text-zinc-200"}`}>−{spentLabel}</p>
          <p className="text-[11px] text-zinc-600">del Saldo</p>
        </div>
      </div>
    </PressCard>
  );
}

/** "Reserva" — the protected surplus, separate from the saldo by design. */
export function ReservaCard({ amountLabel }: { amountLabel: string }) {
  return (
    <PressCard href="/app/cuentas" className="p-5" ariaLabel="Reserva — tu capa protegida, mira dónde vive">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-300">Reserva</p>
          <p className="mt-1 text-xl font-bold text-sky-300">{amountLabel}</p>
          <p className="mt-1 text-[11px] text-zinc-600">protegida · mira dónde vive</p>
        </div>
        <Chevron className="shrink-0" />
      </div>
    </PressCard>
  );
}

/** "Meta principal" — name + progress, nothing graded. */
export function MetaPrincipalCard({
  name,
  progressPct,
  amountLine,
}: {
  name: string;
  progressPct: number;
  amountLine: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progressPct)));
  return (
    <PressCard href="/app/goals" className="p-5" ariaLabel={`Meta principal: ${name}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-300">Meta principal</p>
          <p className="mt-1 truncate text-base font-bold text-zinc-100">{name}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/8">
            <div className="kipu-rise h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-600">{amountLine}</p>
        </div>
        <Chevron className="shrink-0" />
      </div>
    </PressCard>
  );
}

/** "Próximo pago" — the nearest dated obligation: name, amount, date. */
export function ProximoPagoCard({
  name,
  amountLabel,
  dateLabel,
}: {
  name: string;
  amountLabel: string;
  dateLabel: string;
}) {
  return (
    <PressCard href="/app/cashflow" className="p-5" ariaLabel={`Próximo pago: ${name}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-300">Próximo pago</p>
          <p className="mt-1 truncate text-base font-bold text-zinc-100">{name}</p>
          <p className="mt-0.5 text-sm text-zinc-500">
            <span className="font-bold text-amber-300">{amountLabel}</span> · {dateLabel}
          </p>
        </div>
        <Chevron className="shrink-0" />
      </div>
    </PressCard>
  );
}

/** ONE concrete action card — shown ONLY when something needs the user (a
 *  transfer, a stale balance, an unconfirmed movement). Never a score. */
export function AccionCard({ text, href }: { text: string; href: string }) {
  return (
    <Link
      href={href}
      className="kipu-press group flex items-center justify-between gap-3 rounded-2xl border border-amber-400/25 bg-amber-950/30 px-4 py-3.5 hover:border-amber-400/40"
    >
      <p className="text-sm font-medium leading-5 text-amber-100">{text}</p>
      <Chevron className="shrink-0 text-amber-300" />
    </Link>
  );
}

/** Pick the ONE most useful action (or none). Priority: move money before a
 *  bounce > confirm a big card payment > confirm pending recurrents > refresh
 *  stale balances > teach Kipu the essentials. */
export function pickAccion(input: {
  transferAlerts: TransferAlert[];
  marginGaps: { code: string; label: string }[];
  formatMoney: (n: number) => string;
}): { text: string; href: string } | null {
  const ta = input.transferAlerts[0];
  if (ta) {
    return {
      text: `Mueve ${input.formatMoney(ta.missing)} a ${ta.accountName}${ta.byDateISO ? ` antes del ${formatDateEs(ta.byDateISO)}` : " cuanto antes"} (${ta.obligations[0] ?? "pago"}).`,
      href: "/app/cuentas",
    };
  }
  const gap = (code: string) => input.marginGaps.find((g) => g.code === code);
  if (gap("card_confirm")) return { text: "Confirma si tu tarjeta ya está pagada.", href: "/app/chat" };
  if (gap("recurring_unconfirmed")) return { text: "Tienes movimientos recurrentes por confirmar.", href: "/app/chat" };
  if (gap("stale_data")) return { text: "Actualiza tus saldos — hace días que no cuadramos.", href: "/app/chat" };
  if (gap("essentials_unknown")) return { text: "Cuéntale a Kipu tu gasto típico del mes para afinar tu Saldo.", href: "/app/chat" };
  if (gap("no_income")) return { text: "Registra tu ingreso para que tu Saldo se calcule completo.", href: "/app/chat" };
  return null;
}
