"use client";

import Link from "next/link";

// Calm root error boundary — anything thrown outside /app/* lands here. Same
// promise as the /app boundary: no stacks, no internals, tus datos a salvo.
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="kipu-public-safe flex min-h-screen items-center justify-center bg-[var(--kipu-shell-bg)] text-[var(--kipu-shell-ink-1)]">
      <div className="w-full max-w-md rounded-3xl border border-[var(--kipu-shell-glass-line)] bg-[var(--kipu-shell-card)] p-8 text-center shadow-[var(--kipu-shell-shadow)]">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Ups</p>
        <h1 className="mt-2 text-xl font-bold text-zinc-50">Algo se trabó por un momento</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          No es tu plata, es Kipu. Tus datos están a salvo. Prueba de nuevo o vuelve al inicio.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={reset}
            className="kipu-press min-h-11 rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          >
            Reintentar
          </button>
          <Link
            href="/app"
            className="kipu-press flex min-h-11 items-center justify-center rounded-2xl border border-[var(--kipu-shell-glass-line)] px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-emerald-400/30"
          >
            Volver a mi plata
          </Link>
          <Link
            href="/"
            className="kipu-press flex min-h-11 items-center justify-center px-5 py-2 text-xs font-semibold text-zinc-500 transition hover:text-zinc-300"
          >
            Ir al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
