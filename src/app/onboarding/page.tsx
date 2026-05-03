import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { updateProfileAction } from "./actions";
import { createAccountAction } from "./financial-actions";

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const { data: existingProfile, error: profileReadError } = await supabase
    .from("profiles")
    .select("full_name, country, base_currency, tone_preference, onboarding_completed")
    .eq("id", session.user.id)
    .maybeSingle();

  if (profileReadError) {
    return (
      <ErrorScreen title="No pude leer tu perfil" message={profileReadError.message} />
    );
  }

  const profile =
    existingProfile ??
    (
      await supabase
        .from("profiles")
        .insert({
          id: session.user.id,
          full_name: null,
          country: null,
          base_currency: "USD",
          tone_preference: "playful",
          onboarding_completed: false,
        })
        .select("full_name, country, base_currency, tone_preference, onboarding_completed")
        .single()
    ).data;

  if (!profile) {
    return (
      <ErrorScreen
        title="No pude crear tu perfil"
        message="Intenta recargar la página. Si persiste, revisamos las políticas de Supabase."
      />
    );
  }

  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id, name, type, currency, current_balance_base, is_goal_account")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true });

  if (accountsError) {
    return <ErrorScreen title="No pude leer tus cuentas" message={accountsError.message} />;
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
      <section className="mx-auto flex w-full max-w-md flex-col gap-6">       <header className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl">
          <p className="text-sm font-medium text-emerald-300">Onboarding</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Primero conozcamos tu estilo
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Antes de cargar deudas y metas, vamos a guardar tus preferencias y tus
            primeras cuentas reales.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-6 text-zinc-950 shadow-2xl">
          <h2 className="text-xl font-bold">Perfil actual</h2>

          <dl className="mt-5 space-y-3 text-sm">
            <ProfileRow label="Email" value={session.user.email ?? "Sin email"} />
            <ProfileRow label="Nombre" value={profile.full_name ?? "Pendiente"} />
            <ProfileRow label="País" value={profile.country ?? "Pendiente"} />
            <ProfileRow label="Moneda base" value={profile.base_currency} />
            <ProfileRow label="Tono" value={translateTone(profile.tone_preference)} />
            <ProfileRow
              label="Onboarding completo"
              value={profile.onboarding_completed ? "Sí" : "No"}
            />
          </dl>
        </section>

        <section className="rounded-3xl bg-white p-6 text-zinc-950 shadow-2xl">
          <div className="space-y-2">
            <h2 className="text-xl font-bold">Actualizar preferencias</h2>
            <p className="text-sm leading-6 text-zinc-500">
              Esto nos ayuda a personalizar el coach antes de pasar al onboarding financiero.
            </p>
          </div>

          <form action={updateProfileAction} className="mt-6 flex flex-col gap-4">
            <TextInput
              defaultValue={profile.full_name ?? ""}
              label="Nombre"
              name="full_name"
              placeholder="Nico"
            />

            <TextInput
              defaultValue={profile.country ?? ""}
              label="País"             name="country"
              placeholder="Ecuador"
            />

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Moneda base</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={profile.base_currency}
                name="base_currency"
              >
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
                <option value="EUR">EUR</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Tono del coach</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={profile.tone_preference}
                name="tone_preference"
              >
                <option value="playful">Cercano y juguetón</option>
                <option value="calm">Calmado y claro</option>
                <option value="direct">Directo y práctico</option>
              </select>
            </label>

            <PrimaryButton label="Guardar preferencias" />
          </form>
        </section>

        <section className="rounded-3xl bg-white p-6 text-zinc-950 shadow-2xl">
          <div className="space-y-2">
            <h2 className="text-xl font-bold">Tus cuentas</h2>
            <p className="text-sm leading-6 text-zinc-500">
              Aquí guardaremos los lugares donde tu dinero realmente existe: banco,
              efectivo, wallet o cuenta separada para tu meta.
            </p>
          </div>

          <div className="mt-5 space-y-3">
            {(accounts ?? []).length === 0 ? (
              <p className="rounded- bg-zinc-100 px-4 py-3 text-sm text-zinc-500">
                Todavía no tienes cuentas registradas.
              </p>
            ) : (
              accounts?.map((account) => (
                <div
                  className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-100 px-4 py-3 text-sm"
                  key={account.id}
                >
                  <div>
                    <p className="font-bold text-zinc-950">{account.name}</p>
                    <p className="text-xs text-zinc-500">
                      {translateAccountType(account.type)}
                      {account.is_goal_account ? " · Meta" : ""}
                    </p>
                  </div>
                  <p className="font-black text-zinc-950">
                    {account.currency} {Number(account.current_balance_base).toFixed(2)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 te-zinc-950 shadow-2xl">
          <div className="space-y-2">
            <h2 className="text-xl font-bold">Agregar cuenta</h2>
            <p className="text-sm leading-6 text-zinc-500">
              Empecemos con una cuenta real. Por ejemplo: Pichincha, Efectivo o Cuenta Brasil.
            </p>
          </div>

          <form action={createAccountAction} className="mt-6 flex flex-col gap-4">
            <TextInput label="Nombre de la cuenta" name="name" placeholder="Pichincha" required />

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Tipo</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue="bank"
                name="type"
              >
                <option value="bank">Banco</option>
                <option value="cash">Efectivo</option>
                <option value="wallet">Wallet</option>
                <option value="goal_account">Cuenta de meta</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Moneda</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={profile.base_currency}
                name="currency"
              >
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
                <option value="EUR">EUR</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Saldo actual</span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                inputMode="decimal"
                min="0"
                name="current_balance"
                placeholder="0.00"
                step="0.01"
                type="number"
              />
            </label>

            <label className="flex items-center gap-3 rounded-2xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-700">
              <input name="is_goal_account" type="checkbox" />
              Esta cuenta será para guardar el dinero de mi meta
            </label>

            <PrimaryButton label="Guardar cuenta" />
          </form>
        </section>
      </section>
    </main>
  );
}

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
      <section className="mx-auto max-w-md rounded-3xl bg-white p-6 text-zinc-950">
        <h1 className="text-2xl font-bold">{title}</h1>
       <p className="mt-3 text-sm text-zinc-600">{message}</p>
      </section>
    </main>
  );
}

function TextInput({
  defaultValue,
  label,
  name,
  placeholder,
  required = false,
}: {
  defaultValue?: string;
  label: string;
  name: string;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
        type="text"
      />
    </label>
  );
}

function PrimaryButton({ label }: { label: string }) {
  return (
    <button
      className="mt-2 rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-zinc-800"
      type="submit"
    >
      {label}
    </button>
  );
}

function translateAccountType(type: string): string {
  const labels: Record<string, string> = {
    bank: "Banco",
    cash: "Efectivo",
    wallet: "Wallet",
    goal_account: "Cuenta de meta",
  };

  return labels[type] ?? type;
}

function translateTone(tone: string): string {
  const labels: Record<string, string> = {
    playful: "Cercano y juguetón",
    calm: "Calmado y claro",
    direct: "Directo y práctico",
  };

  return labels[tone] ?? tone;
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-100 px-4 py-3">
      <dt className="font-medium text-zinc-500">{label}</dt>
      <dd className="text-right font-bold text-zinc-950">{value}</dd>
    </div>
  );
}
