import { createSupabaseServerClient } from "@/lib/supabase-server";

const onboardingTables = [
  "income_sources",
  "fixed_expenses",
  "coach_preferences",
  "budget_categories",
  "spending_alert_rules",
  "user_context_notes",
  "financial_context_snapshots",
] as const;

export default async function SupabaseTestPage() {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getSession();

  const onboardingChecks = await Promise.all(
    onboardingTables.map(async (tableName) => {
      const { error: tableError } = await supabase
        .from(tableName)
        .select("*", { count: "exact", head: true });

      return {
        tableName,
        ok: !tableError,
        error: tableError?.message ?? null,
      };
    }),
  );

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
          <h2 className="text-xl font-bold">
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

        <section className="rounded-3xl bg-white p-5 text-zinc-950">
          <h2 className="text-xl font-bold">Onboarding Context Tables</h2>
          <p className="mt-3 text-sm text-zinc-600">
            Esta sección prueba lectura básica de las nuevas tablas de onboarding/contexto financiero con el cliente Supabase autenticado.
          </p>

          <div className="mt-4 grid gap-3">
            {onboardingChecks.map((check) => (
              <div
                className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                key={check.tableName}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-sm font-bold">{check.tableName}</p>
                  <span
                    className={
                      check.ok
                        ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700"
                        : "rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700"
                    }
                  >
                    {check.ok ? "OK" : "ERROR"}
                  </span>
                </div>
                {check.error ? (
                  <p className="mt-2 text-xs leading-5 text-red-700">{check.error}</p>
                ) : null}
              </div>
            ))}
          </div>

          <pre className="mt-4 overflow-x-auto rounded-2xl bg-zinc-100 p-4 text-xs">
            {JSON.stringify(onboardingChecks, null, 2)}
          </pre>
        </section>
      </section>
    </main>
  );
}
