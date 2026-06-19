import { signInAction, signUpAction } from "./actions";

// Map raw auth errors to calm, human, on-brand Spanish (never expose raw provider text).
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
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
      <section className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl">
          <p className="text-sm font-medium text-emerald-300">Kipu</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Entra a tu coach financiero
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Vamos a ordenar tu plata sin hacerte sentir que estás llenando un Excel.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-6 text-zinc-950 shadow-2xl">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">Iniciar sesión</h2>
            <p className="text-sm text-zinc-500">
              Usa tu email y contraseña para entrar o crear tu cuenta.
            </p>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {error}
            </div>
          )}

          <form className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Email</span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                type="email"
                name="email"
                placeholder="tu@email.com"
                required
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Contraseña</span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                type="password"
                name="password"
                placeholder="Mínimo 6 caracteres"
                required
              />
            </label>

            <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
              <button
                className="rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-zinc-800"
                formAction={signInAction}
                type="submit"
              >
                Entrar
              </button>
              <button
                className="rounded-2xl border border-zinc-200 px-5 py-3 text-sm font-bold text-zinc-950 transition hover:bg-zinc-100"
                formAction={signUpAction}
                type="submit"
              >
                Crear cuenta
              </button>
            </div>
          </form>
        </section>

        <p className="px-2 text-center text-xs leading-5 text-zinc-500">
          Beta privada. No conectes bancos ni compartas claves bancarias.
        </p>
      </section>
    </main>
  );
}
