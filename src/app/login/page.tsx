import Link from "next/link";
import { signInAction, signUpAction } from "./actions";

// Kipu login (Stage 21.1 redesign). Premium, aligned with the landing. The flow is
// PRESERVED from Stage 21: "Entrar" → signInAction → /app; "Crear cuenta" →
// signUpAction → /onboarding; auth errors stay visible and humanized (never raw
// provider text).

function friendlyMessage(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.toLowerCase();
  if (raw === "missing-fields") return "Escribe tu email y tu contraseña.";
  if (m.includes("invalid login")) return "Email o contraseña incorrectos. Probá de nuevo.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Ya hay una cuenta con ese email. Inicia sesión.";
  if (m.includes("password") && m.includes("least")) return "La contraseña necesita al menos 6 caracteres.";
  if (m.includes("email") && m.includes("valid")) return "Revisá el email, parece tener un error.";
  return "No pude continuar. Probá de nuevo en un momento.";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  const error = friendlyMessage(message);

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
          <h1 className="text-3xl font-black tracking-tight">Entra a tu coach financiero</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Vamos a ordenar tu plata sin hacerte sentir que estás llenando un Excel.
          </p>
        </div>

        <section className="rounded-3xl border border-white/10 bg-zinc-900/70 p-6 shadow-2xl backdrop-blur">
          {error && (
            <div className="mb-5 rounded-2xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm font-medium text-rose-200">
              {error}
            </div>
          )}

          <form className="flex flex-col gap-4">
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
                autoComplete="current-password"
                required
              />
            </label>

            <button
              className="mt-2 rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300"
              formAction={signInAction}
              type="submit"
            >
              Entrar
            </button>
            <button
              className="rounded-2xl border border-white/15 px-5 py-3.5 text-sm font-semibold text-zinc-200 transition hover:border-white/30"
              formAction={signUpAction}
              type="submit"
            >
              Crear cuenta nueva
            </button>
          </form>
        </section>

        <p className="px-2 text-center text-xs leading-5 text-zinc-600">
          Beta privada. Kipu no conecta tu banco ni pide claves bancarias.
        </p>
      </div>
    </main>
  );
}
