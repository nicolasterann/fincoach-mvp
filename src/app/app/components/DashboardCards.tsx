import Link from "next/link";
import type { CurrencyCode } from "@/types/financial";
import { formatDisplay } from "@/lib/financial/display-money";
import type { FxRate } from "@/lib/fx/fx-rates";
import { Sparkline, MiniBars, ProgressRing, StackedBar, TrendPill, CashflowTimeline, type ChartAccent } from "./Charts";
import { Chevron, PressCard } from "./living/shell";

// Stage 20 PASS 2 (Micro-stage B) — the new Whoop-style dashboard surfaces. Each is
// a PURE server card taking plain props (the page maps briefing → props), so the
// cards never import heavy briefing types and stay easy to gate-reason about. Calm,
// honest (empty states say so — never a fabricated chart), mobile-first.

const CARD = "rounded-3xl border border-line/5 bg-zinc-900 p-5";
const LABEL = "text-xs font-semibold uppercase tracking-widest text-zinc-600";

// ── ¿Qué cambió? — honest day-over-day trend strip ──────────────────────────
export interface TrendItem {
  label: string;
  href: string;
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
            <div className="mt-3 flex flex-wrap gap-2">
              {moved.map((i) => (
                <Link
                  key={i.label}
                  href={i.href}
                  className="kipu-press group -my-1 flex min-h-11 items-center gap-1.5 rounded-full border border-line/5 bg-line/[0.04] px-3 py-1.5 hover:border-line/15 hover:bg-line/[0.07]"
                >
                  <span className="text-xs text-zinc-500 transition group-hover:text-zinc-300">{i.label}</span>
                  <TrendPill direction={i.direction} deltaPct={i.deltaPct} isImprovement={i.isImprovement} />
                  <Chevron className="text-xs" />
                </Link>
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
    <PressCard href="/app/spending" ariaLabel="Tu gasto — ver el detalle" className="p-5">
      <div className="flex items-center justify-between">
        <p className={LABEL}>Tu gasto</p>
        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
          Ver detalle
          <Chevron />
        </span>
      </div>
      {bars.length > 0 ? (
        <div className="mt-4">
          <MiniBars bars={bars} accent="sky" height={70} />
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-zinc-500">Todavía conociendo cómo se mueve tu gasto. Registra unos días y aparece aquí.</p>
      )}
      {headline && <p className="mt-3 text-sm leading-6 text-zinc-400">{headline}</p>}
    </PressCard>
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
  displayCurrency,
  rates = [],
}: {
  name: string;
  nextAction: string;
  toPay: { toName: string; amountBase: number }[];
  toCollect: { fromName: string; amountBase: number }[];
  pendingReimbursements: number;
  sharedGoal: { name: string; progressPct: number } | null;
  baseCurrency: CurrencyCode;
  displayCurrency?: CurrencyCode;
  rates?: FxRate[];
}) {
  const money = (v: number) => formatDisplay(v, baseCurrency, displayCurrency, rates);
  return (
    <PressCard href="/app/household" ariaLabel={`Compartido con ${name} — abrir`} className="p-5">
      <div className="flex items-center justify-between">
        <p className={LABEL}>Compartido · {name}</p>
        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
          Abrir
          <Chevron />
        </span>
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
        <p className="mt-2 text-[11px] font-medium text-zinc-600">
          {pendingReimbursements === 1
            ? "1 reembolso marcado pendiente."
            : `${pendingReimbursements} reembolsos marcados pendientes.`}
        </p>
      )}
    </PressCard>
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
  displayCurrency,
  rates = [],
}: {
  netWorth: number;
  liquid: number;
  invested: number;
  wealthTarget: number | null;
  wealthProgressPct: number;
  series: number[];
  baseCurrency: CurrencyCode;
  displayCurrency?: CurrencyCode;
  rates?: FxRate[];
}) {
  const money = (v: number) => formatDisplay(v, baseCurrency, displayCurrency, rates);
  return (
    <PressCard href="/app/wealth" ariaLabel="Patrimonio — ver el detalle" className="p-5">
      <div className="flex items-center justify-between">
        <p className={LABEL}>Patrimonio</p>
        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
          Ver detalle
          <Chevron />
        </span>
      </div>
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
    </PressCard>
  );
}

// ── Kipu Fit — personality / life-philosophy ─────────────────────────────────
export function KipuFitCard({ taken, archetypeLabel }: { taken: boolean; archetypeLabel: string | null }) {
  return (
    <PressCard href="/app/kipu-fit" ariaLabel="Kipu Fit — abrir" className="p-5">
      <div className="flex items-center justify-between">
        <p className={LABEL}>Kipu Fit</p>
        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
          {taken ? "Ver / rehacer" : "Hacer el test"}
          <Chevron />
        </span>
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
    </PressCard>
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
    <PressCard href="/app/fx" ariaLabel="Monedas — ver el detalle" className="p-5">
      <div className="flex items-center justify-between">
        <p className={LABEL}>Monedas</p>
        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
          Ver detalle
          <Chevron />
        </span>
      </div>
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
              <span className="text-xs font-medium text-zinc-600">sin tasa — configúrala aquí</span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-4 text-zinc-700">Tasa de referencia, no la del banco. Nunca invento una.</p>
    </PressCard>
  );
}

// ── Próximos movimientos — calm cashflow timeline ────────────────────────────
export function CashflowTimelineCard({
  events,
  horizonDays,
  safeThisWeek,
  nextIncomeLabel,
  baseCurrency,
  displayCurrency,
  rates = [],
}: {
  events: { daysFromNow: number; kind: string; label: string; risk?: boolean }[];
  horizonDays: number;
  safeThisWeek: number;
  nextIncomeLabel: string | null;
  baseCurrency: CurrencyCode;
  displayCurrency?: CurrencyCode;
  rates?: FxRate[];
}) {
  return (
    <PressCard href="/app/cashflow" ariaLabel="Lo que viene — ver el detalle" className="p-5">
      <div className="flex items-center justify-between">
        <p className={LABEL}>Lo que viene</p>
        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
          Ver
          <Chevron />
        </span>
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
        Esta semana puedes gastar ≈ <span className="font-semibold text-emerald-300">{formatDisplay(safeThisWeek, baseCurrency, displayCurrency, rates)}</span> con calma.
        {nextIncomeLabel ? ` Próximo ingreso: ${nextIncomeLabel}.` : ""}
      </p>
    </PressCard>
  );
}
