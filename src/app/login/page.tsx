import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { signInAction } from "./actions";
import { authNotice } from "@/lib/auth-messages";
import { SubmitButton } from "@/components/ui/SubmitButton";

// Kipu login — returning users only (Stage 21.2). Signup lives at /signup. One
// clear action ("Entrar"), a visible link to create an account, and humanized
// notices for every auth state (wrong password, unconfirmed email, expired
// link, etc.). Behavior preserved: signInAction → /app.

export const metadata = {
  title: "Entrar",
  description: "Inicia sesión en Kipu, tu coach financiero de bolsillo.",
};

const NOTICE_STYLES: Record<string, string> = {
  error: "border-rose-500/30 bg-rose-950/40 text-rose-200",
  info: "border-emerald-500/30 bg-emerald-950/40 text-emerald-200",
  success: "border-emerald-400/40 bg-emerald-950/50 text-emerald-100",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  // An already-signed-in user typing the URL should land in the product, not a
  // form that implies they were logged out.
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) redirect("/app");

  const notice = authNotice(message);

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-950 px-5 py-8 text-zinc-50">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="kipu-breathe absolute -top-32 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-[120px]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-md flex-col gap-6">
        <Link href="/" className="inline-flex items-center gap-2 self-start text-lg font-black tracking-tight">
          <svg aria-hidden viewBox="0 0 64 64" className="h-6 w-6">
            <rect width="64" height="64" rx="16" fill="#0a0a0b" />
            <circle cx="32" cy="32" r="22" fill="none" stroke="#34d399" strokeWidth="5" strokeLinecap="round" strokeDasharray="104 138" transform="rotate(-90 32 32)" />
            <path d="M26 20v24M26 32l12-11M26 32l13 12" fill="none" stroke="#e4e4e7" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-emerald-300">Kipu</span>
        </Link>

        <div>
          <h1 className="text-3xl font-black tracking-tight">Bienvenido de vuelta</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Entra y retomamos tu plata justo donde la dejaste.
          </p>
        </div>

        <section className="rounded-3xl border border-white/10 bg-zinc-900/70 p-6 shadow-2xl backdrop-blur">
          {notice && (
            <div className={`mb-5 rounded-2xl border px-4 py-3 text-sm font-medium ${NOTICE_STYLES[notice.tone]}`}>
              {notice.text}
            </div>
          )}

          <form action={signInAction} className="flex flex-col gap-4">
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
                placeholder="Tu contraseña"
                autoComplete="current-password"
                required
              />
            </label>

            <SubmitButton
              className="mt-2 rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300"
              pendingLabel="Entrando…"
            >
              Entrar
            </SubmitButton>
            <Link
              href="/login/reset"
              className="text-center text-xs font-semibold text-zinc-500 transition hover:text-zinc-300"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </form>
        </section>

        <p className="text-center text-sm text-zinc-400">
          ¿Nuevo en Kipu?{" "}
          <Link href="/signup" className="font-semibold text-emerald-300 transition hover:text-emerald-200">
            Crea tu cuenta
          </Link>
        </p>

        <p className="px-2 text-center text-xs leading-5 text-zinc-600">
          Beta privada. Kipu no conecta tu banco ni pide claves bancarias.
        </p>
      </div>
    </main>
  );
}
