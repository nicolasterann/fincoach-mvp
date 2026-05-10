import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function UserFinancialContextTestPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getSession();

  const userId = data.session?.user.id ?? null;

  let context = null;
  let contextError: string | null = null;

  if (userId) {
    try {
      context = await buildUserFinancialContext(userId);
    } catch (error) {
      contextError =
        error instanceof Error ? error.message : "Unknown financial context error";
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-5">
          <p className="text-sm font-medium text-emerald-300">FinCoach dev</p>
          <h1 className="mt-2 text-3xl font-bold">User Financial Context Test</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Esta página prueba el contexto financiero completo que usará la IA para entender al usuario.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-5 text-zinc-950">
          <h2 className="text-xl font-bold">Sesión</h2>
          <pre className="mt-4 overflow-x-auto rounded-2xl bg-zinc-100 p-4 text-xs">
            {JSON.stringify(
              {
                hasSession: Boolean(data.session),
                userId,
                userEmail: data.session?.user.email ?? null,
                sessionError: error?.message ?? null,
              },
              null,
              2,
            )}
          </pre>
        </section>

        {contextError ? (
          <section className="rounded-3xl border border-red-400/30 bg-red-400/10 p-5">
            <h2 className="text-xl font-bold text-red-100">Context Error</h2>
            <p className="mt-3 text-sm text-red-50">{contextError}</p>
          </section>
        ) : null}

        {!userId ? (
          <section className="rounded-3xl border border-yellow-400/30 bg-yellow-400/10 p-5">
            <h2 className="text-xl font-bold text-yellow-100">Sin sesión</h2>
            <p className="mt-3 text-sm text-yellow-50">
              Inicia sesión para probar el contexto financiero del usuario.
            </p>
          </section>
        ) : null}

        {context ? (
          <>
            <section className="rounded-3xl bg-white p-5 text-zinc-950">
              <h2 className="text-xl font-bold">Summary</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <SummaryCard
                  label="Ingresos activos"
                  value={context.summary.activeIncomeSourcesCount.toString()}
                />
                <SummaryCard
                  label="Gastos fijos activos"
                  value={context.summary.activeFixedExpensesCount.toString()}
                />
                <SummaryCard
                  label="Metas activas"
                  value={context.summary.activeGoalsCount.toString()}
                />
                <SummaryCard
                  label="Deudas"
                  value={context.summary.activeDebtAccountsCount.toString()}
                />
                <SummaryCard
                  label="Balance total"
                  value={`${context.summary.totalAccountBalanceBase.toFixed(2)} ${context.summary.baseCurrency}`}
                />
                <SummaryCard
                  label="Deuda total"
                  value={`${context.summary.totalDebtBalanceBase.toFixed(2)} ${context.summary.baseCurrency}`}
                />
              </div>
            </section>

            <section className="rounded-3xl bg-white p-5 text-zinc-950">
              <h2 className="text-xl font-bold">Context JSON</h2>
              <pre className="mt-4 max-h-[700px] overflow-auto rounded-2xl bg-zinc-100 p-4 text-xs leading-5">
                {JSON.stringify(context, null, 2)}
              </pre>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-zinc-100 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-1 break-words text-lg font-black text-zinc-950">{value}</p>
    </div>
  );
}
