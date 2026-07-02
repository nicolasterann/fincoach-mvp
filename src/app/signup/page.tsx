import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resendConfirmationAction, signUpAction } from "./actions";
import { authNotice } from "@/lib/auth-messages";
import { SubmitButton } from "@/components/ui/SubmitButton";

// Kipu signup — new accounts only (Stage 21.2). Separate from /login. After
// submit, if email confirmation is required, the same route renders a clear
// "revisa tu correo" state (it shows the address, what to do next, and a path
// back to login) instead of dropping the user on a blank/gated screen.

export const metadata = {
  title: "Crear cuenta",
  description: "Crea tu cuenta de Kipu y ordena tu plata sin Excel.",
};

const NOTICE_STYLES: Record<string, string> = {
  error: "border-rose-500/30 bg-rose-950/40 text-rose-200",
  info: "border-emerald-500/30 bg-emerald-950/40 text-emerald-200",
  success: "border-emerald-400/40 bg-emerald-950/50 text-emerald-100",
};

function Wordmark() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 self-start text-lg font-black tracking-tight">
      <svg aria-hidden viewBox="0 0 64 64" className="h-6 w-6">
        <rect width="64" height="64" rx="16" fill="#0a0a0b" />
        <circle cx="32" cy="32" r="22" fill="none" stroke="#34d399" strokeWidth="5" strokeLinecap="round" strokeDasharray="104 138" transform="rotate(-90 32 32)" />
        <path d="M26 20v24M26 32l12-11M26 32l13 12" fill="none" stroke="#e4e4e7" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-emerald-300">Kipu</span>
    </Link>
  );
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; message?: string; resent?: string }>;
}) {
  const { sent, message, resent } = await searchParams;
  // An already-signed-in user typing the URL should land in the product, not a
  // form that implies they were logged out.
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) redirect("/app");


  // ── Check-email state ─────────────────────────────────────────────────────
  if (sent) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-zinc-950 px-5 py-8 text-zinc-50">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="kipu-breathe absolute -top-32 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-[120px]" />
        </div>

        <div className="relative mx-auto flex w-full max-w-md flex-col gap-6">
          <Wordmark />

          <section className="rounded-3xl border border-white/10 bg-zinc-900/70 p-7 shadow-2xl backdrop-blur">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300">
              <svg aria-hidden viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16v12H4z" />
                <path d="m4 7 8 6 8-6" />
              </svg>
            </div>

            <h1 className="mt-5 text-2xl font-black tracking-tight">Revisa tu correo</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              Te enviamos un enlace de confirmación a{" "}
              <span className="font-semibold text-emerald-200">{sent}</span>. Ábrelo para activar tu
              cuenta y entrar directo a Kipu.
            </p>

            <ul className="mt-5 flex flex-col gap-2 text-sm text-zinc-400">
              <li className="flex gap-2">
                <span className="text-emerald-400">1.</span> Abre el correo de Kipu en tu bandeja.
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-400">2.</span> Toca el botón para confirmar.
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-400">3.</span> Listo: arrancamos tu configuración.
              </li>
            </ul>

            <p className="mt-5 rounded-2xl border border-white/10 bg-zinc-950/60 px-4 py-3 text-xs leading-5 text-zinc-500">
              ¿No lo ves? Revisa spam o promociones. El enlace caduca, así que ábrelo pronto.
            </p>
          </section>

          <div className="flex flex-col items-center gap-3">
            <Link
              href="/login"
              className="w-full rounded-2xl bg-emerald-400 px-5 py-3.5 text-center text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300"
            >
              Ya confirmé — entrar
            </Link>
            {resent && (
              <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
                Listo, te lo reenviamos. Dale un minuto y revisa spam o promociones.
              </p>
            )}
            <form action={resendConfirmationAction} className="mt-4">
              <input type="hidden" name="email" value={sent} />
              <SubmitButton
                className="w-full rounded-2xl border border-emerald-400/40 px-5 py-3 text-sm font-semibold text-emerald-300 transition hover:border-emerald-300"
                pendingLabel="Reenviando…"
              >
                ¿No te llegó? Reenviar correo
              </SubmitButton>
            </form>
            <Link href="/signup" className="text-sm text-zinc-400 transition hover:text-zinc-200">
              Usar otro correo
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ── Signup form ───────────────────────────────────────────────────────────
  const notice = authNotice(message);

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-950 px-5 py-8 text-zinc-50">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="kipu-breathe absolute -top-32 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-[120px]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-md flex-col gap-6">
        <Wordmark />

        <div>
          <h1 className="text-3xl font-black tracking-tight">Crea tu cuenta</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Gratis en beta. En dos minutos Kipu ya conoce tu plata y te dice cuánto puedes gastar
            tranquilo.
          </p>
        </div>

        <section className="rounded-3xl border border-white/10 bg-zinc-900/70 p-6 shadow-2xl backdrop-blur">
          {notice && (
            <div className={`mb-5 rounded-2xl border px-4 py-3 text-sm font-medium ${NOTICE_STYLES[notice.tone]}`}>
              {notice.text}
              {message === "already-registered" && (
                <>
                  {" "}
                  <Link href="/login" className="font-semibold underline underline-offset-2">
                    Inicia sesión
                  </Link>
                  .
                </>
              )}
            </div>
          )}

          <form action={signUpAction} className="flex flex-col gap-4">
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

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-300">Contraseña</span>
              <input
                className="kipu-input rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-base text-zinc-50 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-4 focus:ring-emerald-500/10"
                type="password"
                name="password"
                placeholder="Mínimo 6 caracteres"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </label>

            <SubmitButton
              className="mt-2 rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300"
              pendingLabel="Creando tu cuenta…"
            >
              Crear cuenta
            </SubmitButton>
          </form>
        </section>

        <p className="text-center text-sm text-zinc-400">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="font-semibold text-emerald-300 transition hover:text-emerald-200">
            Entra aquí
          </Link>
        </p>

        <p className="px-2 text-center text-xs leading-5 text-zinc-600">
          Beta privada. Kipu no conecta tu banco ni pide claves bancarias.
        </p>
      </div>
    </main>
  );
}
