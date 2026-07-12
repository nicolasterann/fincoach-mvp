import type { CurrencyCode } from "@/types/financial";
import { formatDisplay } from "@/lib/financial/display-money";
import type { FxRate } from "@/lib/fx/fx-rates";
import { Chevron, PressCard } from "./living/shell";

// Stage 20 PASS 2 (Micro-stage B) — the new Whoop-style dashboard surfaces. Each is
// a PURE server card taking plain props (the page maps briefing → props), so the
// cards never import heavy briefing types and stay easy to gate-reason about. Calm,
// honest (empty states say so — never a fabricated chart), mobile-first.

const LABEL = "text-xs font-semibold uppercase tracking-widest text-zinc-600";


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

