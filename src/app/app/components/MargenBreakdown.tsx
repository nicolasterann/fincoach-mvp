import Link from "next/link";
import type { MargenCapacity, MargenKipuBreakdown } from "@/lib/financial/margen-kipu";

// Stage 30 (feedback #9) — "¿de dónde sale este número?". A presentational,
// server-only reveal of the REAL math behind Saldo Kipu, straight from the
// engine's `breakdown` (liquid + itemized reservations) and `capacity` (the
// monthly income → disposable → truly-free story). It NEVER recomputes a number
// in the UI: every figure is engine-owned; this component only orders, labels
// and formats them. Money is rendered by the passed `format` (sign after the
// number, e.g. "615$"). Meant to feel like understanding, not accounting.

type Money = (amount: number) => string;

// The one-sentence "understanding" line: líquido → protejo lo grande → te queda
// ~N$/mes = ~D$/día. All values engine-owned. `tone` picks the copy palette so
// this reads calm on a light hero and legible on the zinc detail card.
function StoryLine({
  capacity,
  margenDaily,
  format,
  tone,
}: {
  capacity: MargenCapacity;
  margenDaily: number;
  format: Money;
  tone: "hero" | "detail";
}) {
  const muted = tone === "hero" ? "text-line/55" : "text-zinc-500";
  const strong = tone === "hero" ? "text-line/85" : "text-zinc-200";
  const free = Math.max(0, capacity.monthlyTrulyFree);
  const investment = capacity.monthlyProtected.investment;
  return (
    <p className={`text-xs leading-6 ${muted}`}>
      De tu ingreso de <span className={`font-semibold ${strong}`}>{format(capacity.monthlyIncome)}</span> al
      mes aparto lo tuyo —{" "}
      {investment > 0 && (
        <>
          inversión <span className={`font-semibold ${strong}`}>{format(investment)}</span>,{" "}
        </>
      )}
      fijos <span className={`font-semibold ${strong}`}>{format(capacity.monthlyFixed)}</span>,
      deuda <span className={`font-semibold ${strong}`}>{format(capacity.monthlyDebtService)}</span>{" "}
      y tu gasto normal{" "}
      <span className={`font-semibold ${strong}`}>{format(capacity.monthlyEssentials)}</span> —
      y lo que sobra para tus gustos es{" "}
      <span className={`font-semibold ${tone === "hero" ? "text-emerald-300" : "text-emerald-400"}`}>
        ~{format(free)}/mes
      </span>{" "}
      ≈ <span className={`font-semibold ${strong}`}>{format(margenDaily)}/día</span>.
    </p>
  );
}

// The itemized ledger: Líquido, then each non-zero reservation as a "− label",
// then the truly-free monthly + the daily pace. Pure list rendering over the
// engine breakdown/capacity — no arithmetic here.
function Ledger({
  breakdown,
  capacity,
  margenDaily,
  format,
  tone,
}: {
  breakdown: MargenKipuBreakdown;
  capacity: MargenCapacity;
  margenDaily: number;
  format: Money;
  tone: "hero" | "detail";
}) {
  // Monthly FLOW rows (they really sum: income − rows = libre para ti). The
  // cycle's cash reservations (stock) are a separate line below — mixing the
  // two made the receipt "not add up" (red-team finding).
  const flowRows = [
    { key: "fixed", label: "Gastos fijos", color: "bg-zinc-400", value: capacity.monthlyFixed },
    { key: "debt", label: "Tarjetas / deuda", color: "bg-orange-400", value: capacity.monthlyDebtService },
    { key: "essentials", label: "Tu gasto normal del mes", color: "bg-sky-400", value: capacity.monthlyEssentials },
    { key: "savings", label: "Ahorro", color: "bg-teal-400", value: capacity.monthlyProtected.savings },
    { key: "investment", label: "Inversión", color: "bg-cyan-400", value: capacity.monthlyProtected.investment },
    { key: "goals", label: "Tus metas", color: "bg-violet-400", value: capacity.monthlyProtected.goals },
  ].filter((r) => r.value > 0);
  const labelColor = tone === "hero" ? "text-line/60" : "text-zinc-500";
  const valueColor = tone === "hero" ? "text-line/70" : "text-zinc-400";
  const topLabel = tone === "hero" ? "text-line/75" : "text-zinc-400";
  const topValue = tone === "hero" ? "text-line/90" : "text-zinc-100";
  const divider = tone === "hero" ? "border-line/10" : "border-line/10";
  const free = Math.max(0, capacity.monthlyTrulyFree);
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex items-center justify-between py-1">
        <span className={topLabel}>Ingresos del mes</span>
        <span className={`font-semibold tabular-nums ${topValue}`}>{format(capacity.monthlyIncome)}</span>
      </div>
      {flowRows.map((r) => (
        <div key={r.key} className="flex items-center justify-between py-1">
          <span className={`flex items-center gap-2 ${labelColor}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${r.color}`} />− {r.label}
          </span>
          <span className={`tabular-nums ${valueColor}`}>{format(r.value)}</span>
        </div>
      ))}
      <div className={`mt-1 border-t pt-3 ${divider}`}>
        <div className="flex items-center justify-between">
          <span className={`font-medium ${topLabel}`}>Libre para ti cada mes</span>
          <span
            className={`font-semibold tabular-nums ${tone === "hero" ? "text-emerald-300" : "text-emerald-400"}`}
          >
            ~{format(free)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className={`text-xs ${labelColor}`}>Tu recarga diaria</span>
          <span className={`text-xs font-semibold tabular-nums ${valueColor}`}>
            ≈ {format(margenDaily)}/día
          </span>
        </div>
        <p className={`mt-3 text-xs leading-5 ${labelColor}`}>
          Aparte, de tus {format(breakdown.liquidCash)} líquidos el calendario ya tiene apartados{" "}
          {format(breakdown.totalReserved)} para lo que viene del ciclo.
        </p>
      </div>
    </div>
  );
}

// ── Inline panel (margen detail page) ─────────────────────────────────────────
// Always-open version for the detail page, where the user came to understand. The
// capacity story sits above the ledger, and the truly-free vs disposable line
// teaches WHY the daily number is what it is (#7 support).
export function MargenBreakdownPanel({
  breakdown,
  capacity,
  margenDaily,
  format,
}: {
  breakdown: MargenKipuBreakdown;
  capacity: MargenCapacity;
  margenDaily: number;
  format: Money;
}) {
  const disposable = Math.max(0, capacity.monthlyDisposableBeforeAllocations);
  const investment = capacity.monthlyProtected.investment;
  const free = Math.max(0, capacity.monthlyTrulyFree);
  const hasCapacityStory = capacity.monthlyIncome > 0;
  return (
    <div>
      <StoryLine
        capacity={capacity}
        margenDaily={margenDaily}
        format={format}
        tone="detail"
      />
      <div className="mt-5">
        <Ledger
          breakdown={breakdown}
          capacity={capacity}
          margenDaily={margenDaily}
          format={format}
          tone="detail"
        />
      </div>
      {hasCapacityStory && (
        <div className="mt-5 rounded-2xl border border-line/5 bg-line/[0.03] p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Tu capacidad</p>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Cada mes te quedan{" "}
            <span className="font-semibold text-zinc-200">{format(disposable)}</span> después de fijos,
            deuda y esenciales.
            {investment > 0 ? (
              <>
                {" "}Con <span className="font-semibold text-zinc-200">{format(investment)}</span> a
                inversión protegida, quedan{" "}
                <span className="font-semibold text-emerald-400">~{format(free)} libres</span> — y por
                eso tu Saldo se recarga ≈ {format(margenDaily)}/día.
              </>
            ) : (
              <>
                {" "}De ahí sale tu recarga de ≈{" "}
                <span className="font-semibold text-emerald-400">{format(margenDaily)}/día</span>.
              </>
            )}
          </p>
          <Link
            href="/app/mes"
            className="mt-2 inline-block text-xs font-semibold text-emerald-400 hover:text-emerald-300"
          >
            Ver cómo se reparte tu mes →
          </Link>
        </div>
      )}
    </div>
  );
}
