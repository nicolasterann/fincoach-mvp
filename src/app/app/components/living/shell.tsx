import Link from "next/link";
import type { ReactNode } from "react";

// Stage 27 — shared scaffolding for metric detail pages and tappable cards.
// Server components; motion is CSS-only.

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
    <header className="kipu-fade-up">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            aria-label="Volver"
            className="kipu-press flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line/10 text-zinc-400 hover:bg-line/5 hover:text-zinc-200"
            href={backHref}
          >
            ←
          </Link>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">{kicker}</p>
            <h1 className="truncate text-2xl font-bold tracking-tight text-zinc-50">{title}</h1>
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
    <section className={`mt-5 ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">{kicker}</p>
        {aside}
      </div>
      <div className="rounded-3xl border border-line/5 bg-zinc-900 p-5">{children}</div>
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
      className="kipu-press mt-6 block rounded-2xl border border-line/10 px-4 py-3.5 text-center text-sm font-semibold text-zinc-300 hover:bg-line/5"
    >
      {label}
    </Link>
  );
}
