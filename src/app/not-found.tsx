import Link from "next/link";

// Calm 404 in Kipu voice — a mistyped or dead link should feel like a gentle
// redirect home, never an error page in English.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 text-zinc-50">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-900 p-8 text-center">
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
            className="kipu-press flex min-h-11 items-center justify-center rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-white/20"
          >
            Ir al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
