import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { setNewPasswordAction } from "./actions";

// New-password screen for the recovery flow. Only reachable with the session the
// recovery email established (/auth/confirm?type=recovery&next=/reset-password);
// a guest is sent to request a fresh link.

export const metadata = { title: "Nueva contraseña · Kipu" };

const NOTICES: Record<string, string> = {
  "too-short": "La contraseña necesita al menos 6 caracteres.",
  mismatch: "Las contraseñas no coinciden. Escríbelas de nuevo.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login/reset");

  const notice = message ? (NOTICES[message] ?? "No pude guardarla. Prueba de nuevo.") : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-10 text-zinc-50">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 block text-center text-2xl font-black tracking-tight text-emerald-300">
          Kipu
        </Link>
        <section className="rounded-3xl border border-white/10 bg-zinc-900 p-6 sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">Crea tu nueva contraseña</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">Y listo — retomamos tu plata donde la dejaste.</p>
          {notice && (
            <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
              {notice}
            </p>
          )}
          <form action={setNewPasswordAction} className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-300">Nueva contraseña</span>
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
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-300">Repítela</span>
              <input
                className="kipu-input rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-base text-zinc-50 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-4 focus:ring-emerald-500/10"
                type="password"
                name="confirm"
                placeholder="La misma otra vez"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </label>
            <button
              className="mt-1 rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300"
              type="submit"
            >
              Guardar y entrar
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
