"use client";

import Link from "next/link";

// Stage 21 — calm error boundary for the /app/* routes. A thrown render/data error
// should never show a raw stack or a white screen to a beta user; Kipu apologizes
// briefly, offers to retry or go back, and never exposes internals.
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="rounded-3xl border border-line/10 bg-zinc-900 p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Ups</p>
        <h1 className="mt-2 text-xl font-bold text-zinc-50">Algo se trabó por un momento</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          No es tu plata, es Kipu. Tus datos están a salvo. Prueba de nuevo; si sigue, vuelve al inicio y cuéntame qué hacías.
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
            className="kipu-press flex min-h-11 items-center justify-center rounded-2xl border border-line/10 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-line/20"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
