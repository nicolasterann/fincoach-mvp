import Link from "next/link";
import type { CurrencyCode } from "@/types/financial";
import { formatKipuMoney } from "@/lib/financial/money";
import { Sparkline, MiniBars, ProgressRing, StackedBar, TrendPill, CashflowTimeline, type ChartAccent } from "./Charts";

// Stage 20 PASS 2 (Micro-stage B) — the new Whoop-style dashboard surfaces. Each is
// a PURE server card taking plain props (the page maps briefing → props), so the
// cards never import heavy briefing types and stay easy to gate-reason about. Calm,
// honest (empty states say so — never a fabricated chart), mobile-first.

const CARD = "rounded-3xl border border-white/5 bg-zinc-900 p-5";
const LABEL = "text-xs font-semibold uppercase tracking-widest text-zinc-600";

// ── ¿Qué cambió? — honest day-over-day trend strip ──────────────────────────
export interface TrendItem {
  label: string;
  direction: "up" | "down" | "flat" | "no_prior";
  deltaPct: number | null;
  isImprovement: boolean | null;
}

export function TrendStrip({
  items,
  series,
  hasHistory,
}: {
  items: TrendItem[];
  series: number[];
  hasHistory: boolean;
}) {
  const moved = items.filter((i) => i.direction === "up" || i.direction === "down");
  return (
    <section className={CARD}>
      <p className={LABEL}>¿Qué cambió?</p>
      {!hasHistory && series.length < 2 ? (
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          Estoy juntando tu historial. En unos días verás aquí cómo evolucionan tu Margen, tu patrimonio y tu Pulso — con datos reales, sin inventar.
        </p>
      ) : (
        <>
          {series.length >= 2 && (
            <div className="mt-3">
              <Sparkline points={series} accent="emerald" height={44} ariaLabel="Tendencia de tu Margen" />
              <p className="mt-1 text-[11px] font-medium text-zinc-600">Tu Margen, últimos días</p>
            </div>
          )}
          {moved.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              {moved.map((i) => (
                <span key={i.label} className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-500">{i.label}</span>
                  <TrendPill direction={i.direction} deltaPct={i.deltaPct} isImprovement={i.isImprovement} />
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-zinc-500">Sin cambios notables desde la última foto. Vas estable.</p>
          )}
        </>
      )}
    </section>
  );
}

// ── Spending pressure — where the money is going ─────────────────────────────
export function SpendingPressureCard({
  bars,
  headline,
}: {
  bars: { label: string; value: number; accent?: ChartAccent }[];
  headline: string | null;
}) {
  return (
    <Link href="/app/reality" className={`${CARD} block transition hover:border-white/15`}>
      <div className="flex items-center justify-between">
        <p className={LABEL}>Tu gasto</p>
        <span className="text-xs font-semibold text-emerald-400">Ver detalle →</span>
      </div>
      {bars.length > 0 ? (
        <div className="mt-4">
          <MiniBars bars={bars} accent="sky" height={70} />
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-zinc-500">Todavía conociendo cómo se mueve tu gasto. Registra unos días y aparece aquí.</p>
      )}
      {headline && <p className="mt-3 text-sm leading-6 text-zinc-400">{headline}</p>}
    </Link>
  );
}

// ── Compartido — household / shared finance (privacy-safe: only shared truth) ─
export function HouseholdCard({
  name,
  nextAction,
  toPay,
  toCollect,
  pendingReimbursements,
  sharedGoal,
  baseCurrency,
}: {
  name: string;
  nextAction: string;
  toPay: { toName: string; amountBase: number }[];
  toCollect: { fromName: string; amountBase: number }[];
  pendingReimbursements: number;
  sharedGoal: { name: string; progressPct: number } | null;
  baseCurrency: CurrencyCode;
}) {
  const money = (v: number) => formatKipuMoney(v, baseCurrency);
  return (
    <Link href="/app/household" className={`${CARD} block transition hover:border-white/15`}>
      <div className="flex items-center justify-between">
        <p className={LABEL}>Compartido · {name}</p>
        <span className="text-xs font-semibold text-emerald-400">Abrir →</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-300">{nextAction}</p>
      {(toPay.length > 0 || toCollect.length > 0) && (
        <div className="mt-3 space-y-1.5">
          {toPay.map((t) => (
            <div key={`p${t.toName}`} className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Le pasas a {t.toName}</span>
              <span className="font-semibold text-amber-300">{money(t.amountBase)}</span>
            </div>
          ))}
          {toCollect.map((t) => (
            <div key={`c${t.fromName}`} className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Te pasa {t.fromName}</span>
              <span className="font-semibold text-emerald-300">{money(t.amountBase)}</span>
            </div>
          ))}
        </div>
      )}
      {sharedGoal && (
        <p className="mt-3 text-xs font-medium text-violet-300">
          Meta compartida “{sharedGoal.name}”: {sharedGoal.progressPct}%
        </p>
      )}
      {pendingReimbursements > 0 && (
        <p className="mt-2 text-[11px] font-medium text-zinc-600">{pendingReimbursements} reembolso(s) marcado(s) pendiente(s).</p>
      )}
    </Link>
  );
}

// ── Patrimonio — net worth + composition + wealth target ─────────────────────
export function WealthCard({
  netWorth,
  liquid,
  invested,
  wealthTarget,
  wealthProgressPct,
  series,
  baseCurrency,
}: {
  netWorth: number;
  liquid: number;
  invested: number;
  wealthTarget: number | null;
  wealthProgressPct: number;
  series: number[];
  baseCurrency: CurrencyCode;
}) {
  const money = (v: number) => formatKipuMoney(v, baseCurrency);
  return (
    <section className={CARD}>
      <p className={LABEL}>Patrimonio</p>
      <div className="mt-3 flex items-center gap-5">
        {wealthTarget && wealthTarget > 0 ? (
          <ProgressRing fraction={wealthProgressPct / 100} accent="teal" size={96} stroke={9}>
            <p className="text-lg font-black text-teal-300">{wealthProgressPct}%</p>
          </ProgressRing>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-black tracking-tight text-zinc-50">≈ {money(netWorth)}</p>
          <p className="mt-1 text-xs text-zinc-600">estimado</p>
          {wealthTarget && wealthTarget > 0 && (
            <p className="mt-1 text-xs text-zinc-500">Meta de patrimonio: {money(wealthTarget)}</p>
          )}
        </div>
      </div>
      {invested > 0 && (
        <div className="mt-4">
          <StackedBar
            ariaLabel="Composición de patrimonio"
            segments={[
              { label: "Líquido", value: Math.max(0, liquid), accent: "emerald" },
              { label: "Invertido", value: Math.max(0, invested), accent: "teal" },
            ]}
          />
        </div>
      )}
      {series.length >= 2 && (
        <div className="mt-4">
          <Sparkline points={series} accent="teal" height={36} ariaLabel="Tendencia de patrimonio" />
        </div>
      )}
    </section>
  );
}

// ── Kipu Fit — personality / life-philosophy ─────────────────────────────────
export function KipuFitCard({ taken, archetypeLabel }: { taken: boolean; archetypeLabel: string | null }) {
  return (
    <Link href="/app/kipu-fit" className={`${CARD} block transition hover:border-white/15`}>
      <div className="flex items-center justify-between">
        <p className={LABEL}>Kipu Fit</p>
        <span className="text-xs font-semibold text-emerald-400">{taken ? "Ver / rehacer →" : "Hacer el test →"}</span>
      </div>
      {taken ? (
        <>
          <p className="mt-3 text-sm font-semibold leading-6 text-zinc-200">{archetypeLabel ?? "Kipu está adaptado a ti"}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-600">Kipu adapta cómo te habla y te aconseja a tu forma de ver el dinero. Puedes cambiarlo cuando quieras.</p>
        </>
      ) : (
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Un test corto y sin rollo para que Kipu se adapte mejor a ti — para acompañarte como te late, no para juzgarte.
        </p>
      )}
    </Link>
  );
}

// ── Monedas — FX / multicurrency (honest about missing rates) ────────────────
export function FxCard({
  base,
  lines,
}: {
  base: string;
  lines: { code: string; rateToBase: number | null; source: string | null }[];
}) {
  return (
    <Link href="/app/chat" className={`${CARD} block transition hover:border-white/15`}>
      <p className={LABEL}>Monedas</p>
      <div className="mt-3 space-y-1.5">
        {lines.map((l) => (
          <div key={l.code} className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">1 {l.code}</span>
            {l.rateToBase !== null ? (
              <span className="font-semibold text-zinc-200">
                ≈ {l.rateToBase} {base}
                <span className="ml-1.5 text-[10px] font-medium text-zinc-600">{l.source === "manual" ? "tuya" : "referencia"}</span>
              </span>
            ) : (
              <span className="text-xs font-medium text-zinc-600">sin tasa — pregúntame</span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-4 text-zinc-700">Tasa de referencia, no la del banco. Nunca invento una.</p>
    </Link>
  );
}

// ── Próximos movimientos — calm cashflow timeline ────────────────────────────
export function CashflowTimelineCard({
  events,
  horizonDays,
  safeThisWeek,
  nextIncomeLabel,
  baseCurrency,
}: {
  events: { daysFromNow: number; kind: string; label: string; risk?: boolean }[];
  horizonDays: number;
  safeThisWeek: number;
  nextIncomeLabel: string | null;
  baseCurrency: CurrencyCode;
}) {
  return (
    <Link href="/app/margen" className={`${CARD} block transition hover:border-white/15`}>
      <div className="flex items-center justify-between">
        <p className={LABEL}>Lo que viene</p>
        <span className="text-xs font-semibold text-emerald-400">Ver →</span>
      </div>
      {events.length > 0 ? (
        <div className="mt-4">
          <CashflowTimeline events={events} horizonDays={horizonDays} />
        </div>
      ) : (
        <p className="mt-3 text-xs leading-5 text-zinc-600">
          No tienes pagos ni ingresos con fecha próxima. Cuando registres fechas (un ingreso, un pago, una tarjeta), aparecen aquí.
        </p>
      )}
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        Esta semana puedes gastar ≈ <span className="font-semibold text-emerald-300">{formatKipuMoney(safeThisWeek, baseCurrency)}</span> con calma.
        {nextIncomeLabel ? ` Próximo ingreso: ${nextIncomeLabel}.` : ""}
      </p>
    </Link>
  );
}
