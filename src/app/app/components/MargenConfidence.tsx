import Link from "next/link";
import type { MargenConfidence, MarginGap, MarginGapCode } from "@/lib/financial/margen-kipu";

// Honest confidence surface for Margen Kipu. Kipu NEVER presents a spendable
// number as trustworthy when it knows the data is weak — it flags it and offers
// ONE clear action that prefills the chat (never auto-sends). Pure server
// component; the action is the existing `/app/chat?share=` prefill pattern.

// Each gap maps to a single, calm next action. The prefill lands the user in
// chat with the sentence half-written so filling the number is one tap away.
const GAP_ACTION: Record<
  MarginGapCode,
  { label: string; prefill?: string; href?: string }
> = {
  essentials_unknown: {
    label: "Dime tu gasto diario típico y afino tu Margen",
    prefill: "Mi gasto diario típico es de ",
  },
  no_income: {
    label: "Agrega tu ingreso para calcular tu Margen",
    prefill: "Mi ingreso es ",
  },
  no_income_date: {
    label: "¿Qué día te pagan? Así proyecto mejor",
    prefill: "Me pagan el día ",
  },
  stale_data: {
    label: "Registra lo de estos días y actualizo tu Margen",
    prefill: "Hoy gasté ",
  },
  unconverted_currency: {
    label: "Ponme la tasa de tu otra moneda",
    href: "/app/settings",
  },
  card_confirm: {
    label: "¿Ya pagaste esa tarjeta? Confírmame para afinar",
    prefill: "Sobre mi tarjeta: ",
  },
};

// The first gap that has a defined action drives the honest line + action.
function primaryGap(gaps: MarginGap[]): MarginGap | null {
  return gaps.find((g) => GAP_ACTION[g.code]) ?? gaps[0] ?? null;
}

function actionHref(gap: MarginGap): string {
  const action = GAP_ACTION[gap.code];
  if (action?.href) return action.href;
  if (action?.prefill) return `/app/chat?share=${encodeURIComponent(action.prefill)}`;
  return "/app/chat";
}

// ── Small chip shown right next to the Margen number ──────────────────────────
// solid → calm/positive (or nothing); estimated/preliminary → honest label.
export function ConfidenceChip({
  confidence,
  className = "",
}: {
  confidence: MargenConfidence;
  className?: string;
}) {
  if (confidence === "solid") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-line/10 px-2.5 py-0.5 text-[10px] font-semibold text-line/60 ${className}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        con datos frescos
      </span>
    );
  }
  const label = confidence === "estimated" ? "estimado" : "preliminar";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-line/15 bg-line/5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-line/70 ${className}`}
    >
      {label}
    </span>
  );
}

// ── The honest note + single action (dashboard hero) ──────────────────────────
// Renders NOTHING when confidence is solid. Otherwise: one short honest line
// from the first relevant gap + one tappable action that prefills the chat.
export function ConfidenceNote({
  confidence,
  marginGaps,
  className = "",
}: {
  confidence: MargenConfidence;
  marginGaps: MarginGap[];
  className?: string;
}) {
  if (confidence === "solid") return null;
  const gap = primaryGap(marginGaps);
  if (!gap) return null;
  const action = GAP_ACTION[gap.code];

  return (
    <div
      className={`rounded-2xl border border-line/10 bg-black/20 p-3.5 ${className}`}
    >
      <p className="text-xs leading-5 text-line/70">
        {confidence === "preliminary"
          ? `Este Margen es preliminar: ${gap.label}.`
          : `Ojo, es un estimado: ${gap.label}.`}
      </p>
      {action && (
        <Link
          href={actionHref(gap)}
          className="kipu-press group mt-2 inline-flex items-center gap-1 text-xs font-bold text-emerald-300"
        >
          {action.label}
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
            ›
          </span>
        </Link>
      )}
    </div>
  );
}

// ── Empty state (brand-new user: no liquid money and/or no income) ────────────
// Never a bald "0$" with an amber scold. Says exactly what unlocks the number
// and offers the same prefill actions.
export function MargenEmptyState({
  marginGaps,
}: {
  marginGaps: MarginGap[];
}) {
  // Prefer the income and essentials asks — those are what actually births a Margen.
  const ordered: MarginGapCode[] = [
    "no_income",
    "essentials_unknown",
    "no_income_date",
    "unconverted_currency",
    "stale_data",
  ];
  const actions = ordered
    .filter((code) => marginGaps.some((g) => g.code === code))
    .slice(0, 2)
    .map((code) => ({ code, ...GAP_ACTION[code] }));

  // Always offer at least the two core asks even if the engine reported no gaps
  // (e.g. a fresh account with zero balance and no income yet).
  const fallback = [
    { code: "no_income" as MarginGapCode, ...GAP_ACTION.no_income },
    { code: "essentials_unknown" as MarginGapCode, ...GAP_ACTION.essentials_unknown },
  ];
  const shown = actions.length > 0 ? actions : fallback;

  return (
    <div className="rounded-2xl border border-line/10 bg-black/20 p-4">
      <p className="text-sm font-semibold text-line/80">
        Agrega tu saldo y un ingreso y calculo tu Margen
      </p>
      <p className="mt-1 text-xs leading-5 text-line/55">
        Aún no tengo lo suficiente para decirte un número real — no es un cero de
        alarma, es que todavía no me lo cuentas. En cuanto lo hagas, este número
        cobra vida.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {shown.map((a) => (
          <Link
            key={a.code}
            href={a.href ? a.href : `/app/chat?share=${encodeURIComponent(a.prefill ?? "")}`}
            className="kipu-press group inline-flex items-center gap-1 text-xs font-bold text-emerald-300"
          >
            {a.label}
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
              ›
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
