import Link from "next/link";
import type { ReactNode } from "react";

// Stage 27 — shared scaffolding for metric detail pages and tappable cards.
// Server components; motion is CSS-only.

export type DetailLayer = "saldo" | "reserva" | "metas" | "patrimonio" | "deuda";

// M7 — every detail route enters the same visual room as the sanctuary. The
// data attribute only selects presentation tokens; it never selects or derives
// financial state.
export function DetailSurface({
  layer,
  children,
  className = "",
}: {
  layer: DetailLayer;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`kipu-detail kipu-stagger ${className}`} data-detail-layer={layer}>
      <span aria-hidden className="kipu-detail__atmosphere" />
      <div className="kipu-detail__content">{children}</div>
    </div>
  );
}

// A card that IS a link: hover lift, tactile press, chevron affordance and a
// visible keyboard focus. Use for every dashboard card that drills down.
export function PressCard({
  href,
  children,
  className = "",
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`kipu-press group block rounded-3xl border border-line/5 bg-zinc-900 hover:border-line/15 hover:bg-zinc-900/70 ${className}`}
    >
      {children}
    </Link>
  );
}

// The little "this goes somewhere" affordance for card corners.
export function Chevron({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`text-zinc-600 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-zinc-400 ${className}`}
    >
      ›
    </span>
  );
}

// Detail-page header: 44px back target, kicker, title and an optional right
// slot (badge / trend pill). Consistent across every metric page.
export function MetricShell({
  backHref = "/app",
  kicker,
  title,
  right,
  children,
}: {
  backHref?: string;
  kicker: string;
  title: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="kipu-detail-header kipu-fade-up">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            aria-label="Volver"
            className="kipu-detail-back kipu-press"
            href={backHref}
          >
            <span aria-hidden>←</span>
            <span className="sr-only">Volver al santuario</span>
          </Link>
          <div className="min-w-0">
            <p className="kipu-detail-kicker">{kicker}</p>
            <h1 className="kipu-detail-title truncate">{title}</h1>
          </div>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {children}
    </header>
  );
}

// A calm detail section: kicker + optional aside + card body.
export function Section({
  kicker,
  aside,
  children,
  className = "",
}: {
  kicker: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`kipu-detail-section mt-5 ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="kipu-detail-kicker">{kicker}</p>
        {aside}
      </div>
      <div className="kipu-detail-card p-5">{children}</div>
    </section>
  );
}

// Consistent chat handoff at the bottom of detail pages, with an optional
// prefilled prompt (agent-native: land in chat with the question ready).
export function ChatCta({ label, prompt }: { label: string; prompt?: string }) {
  const href = prompt ? `/app/chat?share=${encodeURIComponent(prompt)}` : "/app/chat";
  return (
    <Link
      href={href}
      className="kipu-detail-cta kipu-press mt-6 block px-4 py-3.5 text-center text-sm font-semibold"
    >
      {label}
    </Link>
  );
}

const TU_KIPU_ROUTES = [
  { key: "settings", href: "/app/settings", label: "Ajustes" },
  { key: "fit", href: "/app/kipu-fit", label: "Cómo te conozco" },
  { key: "data", href: "/app/mis-datos", label: "Mis datos" },
] as const;

// Three routes, one destination. Keeping this header shared prevents the
// settings/profile/data seams from becoming three different products again.
export function TuKipuHeader({
  active,
  title,
}: {
  active: (typeof TU_KIPU_ROUTES)[number]["key"];
  title: string;
}) {
  return (
    <>
      <MetricShell kicker="Tu Kipu" title={title} />
      <nav aria-label="Secciones de Tu Kipu" className="kipu-tu-kipu-nav">
        {TU_KIPU_ROUTES.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active === item.key ? "page" : undefined}
            className="kipu-press"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
