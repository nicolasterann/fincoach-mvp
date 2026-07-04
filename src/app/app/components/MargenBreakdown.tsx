import Link from "next/link";
import type { MargenCapacity, MargenKipuBreakdown } from "@/lib/financial/margen-kipu";

// Stage 30 (feedback #9) — "¿de dónde sale este número?". A presentational,
// server-only reveal of the REAL math behind Margen Kipu, straight from the
// engine's `breakdown` (liquid + itemized reservations) and `capacity` (the
// monthly income → disposable → truly-free story). It NEVER recomputes a number
// in the UI: every figure is engine-owned; this component only orders, labels
// and formats them. Money is rendered by the passed `format` (sign after the
// number, e.g. "615$"). Meant to feel like understanding, not accounting.

type Money = (amount: number) => string;

// One reservation line. Order is the reading order of the story: what the user's
// liquid cash is quietly protecting before anything is "free".
const RESERVATION_LABELS: {
  key: keyof MargenKipuBreakdown;
  label: string;
  color: string;
}[] = [
  { key: "reservedInvestment", label: "Inversión", color: "bg-cyan-400" },
  { key: "reservedSavings", label: "Ahorro", color: "bg-teal-400" },
  { key: "reservedGoal", label: "Tu meta", color: "bg-violet-400" },
  { key: "reservedFixed", label: "Gastos fijos", color: "bg-zinc-400" },
  { key: "reservedDebt", label: "Tarjetas / deuda", color: "bg-orange-400" },
  { key: "reservedScheduled", label: "Pagos programados", color: "bg-indigo-400" },
  // The reserved figure is the MONTHLY estimate scaled to the projection cycle —
  // calling it "diario" read as broken math next to the monthly prose (S31 QA).
  { key: "reservedEssentials", label: "Tu gasto normal del mes", color: "bg-sky-400" },
];

// The one-sentence "understanding" line: líquido → protejo lo grande → te queda
// ~N$/mes = ~D$/día. All values engine-owned. `tone` picks the copy palette so
// this reads calm on a light hero and legible on the zinc detail card.
function StoryLine({
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
  const muted = tone === "hero" ? "text-white/55" : "text-zinc-500";
  const strong = tone === "hero" ? "text-white/85" : "text-zinc-200";
  const free = Math.max(0, capacity.monthlyTrulyFree);
  const investment = capacity.monthlyProtected.investment;
  return (
    <p className={`text-xs leading-6 ${muted}`}>
      De tus <span className={`font-semibold ${strong}`}>{format(breakdown.liquidCash)}</span>{" "}
      líquidos aparto lo tuyo —{" "}
      {investment > 0 && (
        <>
          inversión <span className={`font-semibold ${strong}`}>{format(investment)}</span>,{" "}
        </>
      )}
      fijos <span className={`font-semibold ${strong}`}>{format(capacity.monthlyFixed)}</span>,
      deuda <span className={`font-semibold ${strong}`}>{format(capacity.monthlyDebtService)}</span>{" "}
      y esenciales{" "}
      <span className={`font-semibold ${strong}`}>{format(capacity.monthlyEssentials)}</span> al mes —
      y lo que sobra para ti es{" "}
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
  const rows = RESERVATION_LABELS.map((r) => ({ ...r, value: breakdown[r.key] })).filter(
    (r) => r.value > 0,
  );
  const labelColor = tone === "hero" ? "text-white/60" : "text-zinc-500";
  const valueColor = tone === "hero" ? "text-white/70" : "text-zinc-400";
  const topLabel = tone === "hero" ? "text-white/75" : "text-zinc-400";
  const topValue = tone === "hero" ? "text-white/90" : "text-zinc-100";
  const divider = tone === "hero" ? "border-white/10" : "border-white/10";
  const free = Math.max(0, capacity.monthlyTrulyFree);
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex items-center justify-between py-1">
        <span className={topLabel}>Dinero líquido</span>
        <span className={`font-semibold tabular-nums ${topValue}`}>{format(breakdown.liquidCash)}</span>
      </div>
      {rows.map((r) => (
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
          <span className={`text-xs ${labelColor}`}>Tu ritmo diario</span>
          <span className={`text-xs font-semibold tabular-nums ${valueColor}`}>
            ≈ {format(margenDaily)}/día
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Compact reveal (dashboard hero) ───────────────────────────────────────────
// A single "¿de dónde sale este número?" line that opens into the story + ledger.
// Native <details> so it stays a pure server component (no client JS), and the
// group-open chevron rotates. Reduce-motion is handled globally in globals.css.
export function MargenBreakdownReveal({
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
  if (breakdown.liquidCash <= 0) return null;
  return (
    <details className="group mt-3 rounded-2xl border border-white/10 bg-black/20">
      <summary className="kipu-press flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 text-xs font-semibold text-white/70 hover:text-white/90">
        ¿De dónde sale este número?
        <svg
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-white/40 transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-white/10 px-3.5 py-3.5">
        <StoryLine
          breakdown={breakdown}
          capacity={capacity}
          margenDaily={margenDaily}
          format={format}
          tone="hero"
        />
        <div className="mt-4">
          <Ledger
            breakdown={breakdown}
            capacity={capacity}
            margenDaily={margenDaily}
            format={format}
            tone="hero"
          />
        </div>
      </div>
    </details>
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
        breakdown={breakdown}
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
        <div className="mt-5 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
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
                eso tu ritmo es ≈ {format(margenDaily)}/día.
              </>
            ) : (
              <>
                {" "}De ahí sale tu ritmo de ≈{" "}
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
