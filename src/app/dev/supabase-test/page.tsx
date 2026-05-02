import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function SupabaseTestPage() {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getSession();

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-5">
          <p className="text-sm font-medium text-emerald-300">Dev Test</p>
          <h1 className="mt-2 text-3xl font-bold">Supabase Connection</h1>
          <p className="mt-3 text-sm text-zinc-300">
            Esta página verifica que el cliente de Supabase puede inicializarse con las variables de entorno.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-5 text-zinc-950">
          <h2 className="text-xl font-bod">
            {error ? "Error de conexión" : "Cliente Supabase funcionando"}
          </h2>

          <p className="mt-3 text-sm text-zinc-600">
            {error
              ? error.message
              : "Supabase respondió correctamente. Todavía no hay sesión activa, y eso está bien por ahora."}
          </p>

          <pre className="mt-4 overflow-x-auto rounded-2xl bg-zinc-100 p-4 text-xs">
            {JSON.stringify(
              {
                hasSession: Boolean(data.session),
                userEmail: data.session?.user.email ?? null,
              },
              null,
              2,
            )}
          </pre>
        </section>
      </section>
    </main>
  );
}
