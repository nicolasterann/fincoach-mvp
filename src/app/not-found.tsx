import Link from "next/link";

// Calm 404 in Kipu voice — a mistyped or dead link should feel like a gentle
// redirect home, never an error page in English.
export default function NotFound() {
  return (
    <main className="kipu-public-safe flex min-h-screen items-center justify-center bg-[var(--kipu-shell-bg)] text-[var(--kipu-shell-ink-1)]">
      <div className="w-full max-w-md rounded-3xl border border-[var(--kipu-shell-glass-line)] bg-[var(--kipu-shell-card)] p-8 text-center shadow-[var(--kipu-shell-shadow)]">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">404</p>
        <h1 className="mt-2 text-xl font-bold text-zinc-50">Esta página no existe — volvamos a tu plata.</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          El enlace puede estar mal escrito o ya no está disponible. Nada se perdió.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/app"
            className="kipu-press flex min-h-11 items-center justify-center rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          >
            Ir a mi resumen
          </Link>
          <Link
            href="/"
            className="kipu-press flex min-h-11 items-center justify-center rounded-2xl border border-[var(--kipu-shell-glass-line)] px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-emerald-400/30"
          >
            Ir al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
