import Link from "next/link";
import { requestPasswordResetAction } from "./actions";
import { SubmitButton } from "@/components/ui/SubmitButton";

// Minimal, calm password recovery — a beta tester who forgot their password must
// never hit a dead end. Matches the /login visual language.

export const metadata = { title: "Recuperar contraseña · Kipu" };

export default async function ResetRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; message?: string }>;
}) {
  const { sent, message } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-10 text-zinc-50">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 block text-center text-2xl font-black tracking-tight text-emerald-300">
          Kipu
        </Link>
        <section className="rounded-3xl border border-white/10 bg-zinc-900 p-6 sm:p-8">
          {sent ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight">Revisa tu correo</h1>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                Si existe una cuenta con <span className="font-semibold text-zinc-200">{sent}</span>, te enviamos un
                enlace para crear una contraseña nueva. Revisa spam o promociones si no lo ves.
              </p>
              <Link
                href="/login"
                className="mt-6 block rounded-2xl border border-white/10 px-5 py-3 text-center text-sm font-semibold text-zinc-300 transition hover:border-white/20"
              >
                ← Volver a entrar
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight">¿Olvidaste tu contraseña?</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Escribe tu email y te mandamos un enlace para crear una nueva. Tranquilo, pasa en las mejores familias.
              </p>
              {message === "missing-email" && (
                <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                  Escribe tu email primero.
                </p>
              )}
              <form action={requestPasswordResetAction} className="mt-5 flex flex-col gap-4">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-zinc-300">Email</span>
                  <input
                    className="kipu-input rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-base text-zinc-50 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-4 focus:ring-emerald-500/10"
                    type="email"
                    name="email"
                    placeholder="tu@email.com"
                    autoComplete="email"
                    required
                  />
                </label>
                <SubmitButton
                  className="mt-1 rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300"
                  pendingLabel="Enviando…"
                >
                  Enviarme el enlace
                </SubmitButton>
              </form>
              <p className="mt-5 text-center text-sm text-zinc-500">
                <Link href="/login" className="font-semibold text-emerald-300 transition hover:text-emerald-200">
                  ← Volver a entrar
                </Link>
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
