import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { saveDefaultPaymentMethodAction } from "./actions";

export default async function PreferencesTestPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const [{ data: accounts }, { data: debtAccounts }, { data: preferences }] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, type, is_goal_account")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("debt_accounts")
        .select("id, name, type")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("user_financial_preferences")
        .select("default_source_type, default_source_id")
        .eq("user_id", session.user.id)
        .maybeSingle(),
    ]);

  const currentValue =
    preferences?.default_source_type && preferences.default_source_id
      ? `${preferences.default_source_type}:${preferences.default_source_id}`
      : "";

  const currentLabel =
    preferences?.default_source_type === "account"
      ? (accounts ?? []).find((account) => account.id === preferences.default_source_id)?.name
      : preferences?.default_source_type === "debt_account"
        ? (debtAccounts ?? []).find((debt) => debt.id === preferences.default_source_id)?.name
        : null;

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
      <section className="mx-auto max-w-md rounded-3xl bg-white p-5 text-zinc-950 shadow-2xl">
        <p className="text-sm font-medium text-emerald-600">FinCoach dev</p>
        <h1 className="mt-2 text-2xl font-black">Método de pago por defecto</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Esta pantalla temporal define qué fuente usar cuando escribes algo como
          “café 3” sin decir cuenta o tarjeta.
        </p>

        <form action={saveDefaultPaymentMethodAction} className="mt-5 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-bold text-zinc-700">Fuente por defecto</span>
            <select
              className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
              defaultValue={currentValue}
              name="default_source"
              required
            >
              <option value="">Selecciona una fuente</option>

              <optgroup label="Cuentas">
                {(accounts ?? [])
                  .filter((account) => !account.is_goal_account)
                  .map((account) => (
                    <option key={account.id} value={`account:${account.id}`}>
                      {account.name}
                    </option>
                  ))}
              </optgroup>

              <optgroup label="Tarjetas / deudas">
                {(debtAccounts ?? []).map((debt) => (
                  <option key={debt.id} value={`debt_account:${debt.id}`}>
                    {debt.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>

          <button
            className="rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-black text-white transition hover:bg-zinc-800"
            type="submit"
          >
            Guardar método por defecto
          </button>
        </form>

        <div className="mt-5 rounded-2xl bg-zinc-100 p-4 text-sm text-zinc-600">
          <p className="font-bold text-zinc-950">Valor actual</p>
          <p className="mt-1">{currentLabel ?? "Sin método por defecto"}</p>
        </div>
      </section>
    </main>
  );
}
