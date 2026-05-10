import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { updateProfileAction } from "./actions";
import { createAccountAction, createDebtAccountAction, createGoalAction } from "./financial-actions";

const SELECT_CLASS =
  "rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10";

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
    return <ErrorScreen title="No pude leer tu perfil" message={profileReadError.message} />;
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

  const { data: debtAccounts, error: debtAccountsError } = await supabase
    .from("debt_accounts")
    .select("id, name, type, currency, current_balance_base, due_day")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true });

  if (debtAccountsError) {
    return <ErrorScreen title="No pude leer tus deudas" message={debtAccountsError.message} />;
  }

  const { data: goals, error: goalsError } = await supabase
    .from("goals")
    .select("id, name, target_amount, currency, current_amount, target_date, status, goal_account_id")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true });

  if (goalsError) {
    return <ErrorScreen title="No pude leer tus metas" message={goalsError.message} />;
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-10 text-zinc-50">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">

        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-300">
            Onboarding
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            Primero conozcamos tu estilo
          </h1>
          <p className="mt-3 text-sm leading-7 text-zinc-300">
            Antes de cargar deudas y metas, vamos a guardar tus preferencias y tus
            primeras cuentas reales.
          </p>
        </header>

        {/* ── Perfil ─────────────────────────────────────────────── */}
        <SectionLabel step="1" title="Tu perfil" />
        <div className="grid gap-6 md:grid-cols-2">

          <Card>
            <CardTitle>Perfil actual</CardTitle>
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
          </Card>

          <Card>
            <CardTitle>Actualizar preferencias</CardTitle>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Esto nos ayuda a personalizar el coach antes de pasar al onboarding financiero.
            </p>

            <form action={updateProfileAction} className="mt-6 flex flex-col gap-4">
              <TextInput
                defaultValue={profile.full_name ?? ""}
                label="Nombre"
                name="full_name"
                placeholder="Nico"
              />

              <TextInput
                defaultValue={profile.country ?? ""}
                label="País"
                name="country"
                placeholder="Ecuador"
              />

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-700">Moneda base</span>
                <select className={SELECT_CLASS} defaultValue={profile.base_currency} name="base_currency">
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-700">Tono del coach</span>
                <select className={SELECT_CLASS} defaultValue={profile.tone_preference} name="tone_preference">
                  <option value="playful">Cercano y juguetón</option>
                  <option value="calm">Calmado y claro</option>
                  <option value="direct">Directo y práctico</option>
                </select>
              </label>

              <PrimaryButton label="Guardar preferencias" />
            </form>
          </Card>

        </div>

        {/* ── Cuentas ────────────────────────────────────────────── */}
        <SectionLabel step="2" title="Tus cuentas" />
        <div className="grid gap-6 md:grid-cols-2">

          <Card>
            <CardTitle>Cuentas registradas</CardTitle>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Aquí guardaremos los lugares donde tu dinero realmente existe: banco,
              efectivo, wallet o cuenta separada para tu meta.
            </p>

            <div className="mt-5 space-y-3">
              {(accounts ?? []).length === 0 ? (
                <EmptyState text="Todavía no tienes cuentas registradas." />
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
          </Card>

          <Card>
            <CardTitle>Agregar cuenta</CardTitle>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Empecemos con una cuenta real. Por ejemplo: Pichincha, Efectivo o Cuenta Brasil.
            </p>

            <form action={createAccountAction} className="mt-6 flex flex-col gap-4">
              <TextInput label="Nombre de la cuenta" name="name" placeholder="Pichincha" required />

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-700">Tipo</span>
                <select className={SELECT_CLASS} defaultValue="bank" name="type">
                  <option value="bank">Banco</option>
                  <option value="cash">Efectivo</option>
                  <option value="wallet">Wallet</option>
                  <option value="goal_account">Cuenta de meta</option>
                </select>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-700">Moneda</span>
                <select className={SELECT_CLASS} defaultValue={profile.base_currency} name="currency">
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-700">Saldo actual</span>
                <input
                  className={SELECT_CLASS}
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
          </Card>

        </div>

        {/* ── Deudas y tarjetas ──────────────────────────────────── */}
        <SectionLabel step="3" title="Deudas y tarjetas" />
        <div className="grid gap-6 md:grid-cols-2">

          <Card>
            <CardTitle>Deudas registradas</CardTitle>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Las tarjetas se tratan como deuda, no como dinero disponible. Aquí guardamos
              lo que debes pagar.
            </p>

            <div className="mt-5 space-y-3">
              {(debtAccounts ?? []).length === 0 ? (
                <EmptyState text="Todavía no tienes deudas o tarjetas registradas." />
              ) : (
                debtAccounts?.map((debt) => (
                  <div className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm" key={debt.id}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-bold text-zinc-950">{debt.name}</p>
                        <p className="text-xs text-zinc-500">
                          {translateDebtType(debt.type)}
                          {debt.due_day ? ` · Pago día ${debt.due_day}` : ""}
                        </p>
                      </div>
                      <p className="font-black text-zinc-950">
                        {debt.currency} {Number(debt.current_balance_base).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>Agregar deuda o tarjeta</CardTitle>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Si usas tarjeta, regístrala aquí. Comprar con tarjeta aumenta deuda,
              no baja efectivo hoy.
            </p>

            <form action={createDebtAccountAction} className="mt-6 flex flex-col gap-4">
              <TextInput label="Nombre" name="name" placeholder="Visa Pichincha" required />

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-700">Tipo</span>
                <select className={SELECT_CLASS} defaultValue="credit_card" name="type">
                  <option value="credit_card">Tarjeta de crédito</option>
                  <option value="loan">Préstamo</option>
                  <option value="family_debt">Deuda familiar</option>
                  <option value="other_debt">Otra deuda</option>
                </select>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-700">Moneda</span>
                <select className={SELECT_CLASS} defaultValue={profile.base_currency} name="currency">
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>

              <NumberInput label="Saldo / deuda actual" name="current_balance" placeholder="80.00" />
              <NumberInput label="Pago mínimo" name="minimum_payment" placeholder="20.00" />
              <NumberInput label="Pago total del mes" name="full_payment_due" placeholder="80.00" />

              <div className="grid grid-cols-2 gap-3">
                <NumberInput label="Día de pago" name="due_day" placeholder="29" />
                <NumberInput label="Día de corte" name="cutoff_day" placeholder="15" />
              </div>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-700">
                  Cuenta desde donde sueles pagar
                </span>
                <select className={SELECT_CLASS} defaultValue="" name="default_payment_account_id">
                  <option value="">Sin definir todavía</option>
                  {accounts?.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>

              <PrimaryButton label="Guardar deuda o tarjeta" />
            </form>
          </Card>

        </div>

        {/* ── Meta principal ─────────────────────────────────────── */}
        <SectionLabel step="4" title="Tu meta principal" />
        <div className="grid gap-6 md:grid-cols-2">

          <Card>
            <CardTitle>Meta registrada</CardTitle>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              El MVP se enfoca en una meta principal para que el coach pueda acompañarte
              con claridad.
            </p>

            <div className="mt-5 space-y-3">
              {(goals ?? []).length === 0 ? (
                <EmptyState text="Todavía no tienes una meta registrada." />
              ) : (
                goals?.map((goal) => (
                  <div className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm" key={goal.id}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-bold text-zinc-950">{goal.name}</p>
                        <p className="text-xs text-zinc-500">
                          {goal.target_date
                            ? `Fecha objetivo: ${goal.target_date}`
                            : "Sin fecha objetivo"}
                        </p>
                      </div>
                      <p className="font-black text-zinc-950">
                        {goal.currency} {Number(goal.current_amount).toFixed(2)} /{" "}
                        {Number(goal.target_amount).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>Crear meta principal</CardTitle>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Define una meta concreta. El coach usará esta meta para darte seguimiento diario.
            </p>

            <form action={createGoalAction} className="mt-6 flex flex-col gap-4">
              <TextInput label="Nombre de la meta" name="name" placeholder="Viaje a Brasil" required />
              <NumberInput label="Monto objetivo" name="target_amount" placeholder="800.00" />
              <NumberInput label="Monto ya ahorrado" name="current_amount" placeholder="0.00" />

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-700">Moneda</span>
                <select className={SELECT_CLASS} defaultValue={profile.base_currency} name="currency">
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-700">Fecha objetivo</span>
                <input className={SELECT_CLASS} name="target_date" type="date" />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-700">
                  Cuenta donde guardarás esta meta
                </span>
                <select className={SELECT_CLASS} defaultValue="" name="goal_account_id">
                  <option value="">Sin cuenta asignada todavía</option>
                  {accounts
                    ?.filter((account) => account.is_goal_account)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                </select>
              </label>

              <PrimaryButton label="Guardar meta" />
            </form>
          </Card>

        </div>

      </div>
    </main>
  );
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function SectionLabel({ step, title }: { step: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-zinc-950">
        {step}
      </span>
      <h2 className="text-lg font-semibold text-zinc-200">{title}</h2>
      <div className="h-px flex-1 bg-white/10" />
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-6 text-zinc-950 shadow-2xl">{children}</section>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xl font-bold">{children}</h3>;
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-500">{text}</p>
  );
}

// ── Error screen ────────────────────────────────────────────────────────────

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-10 text-zinc-50">
      <section className="mx-auto max-w-md rounded-3xl bg-white p-6 text-zinc-950">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-3 text-sm text-zinc-600">{message}</p>
      </section>
    </main>
  );
}

// ── Form primitives ─────────────────────────────────────────────────────────

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

function NumberInput({
  label,
  name,
  placeholder,
}: {
  label: string;
  name: string;
  placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
        inputMode="decimal"
        min="0"
        name={name}
        placeholder={placeholder}
        step="0.01"
        type="number"
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

// ── Translation helpers ─────────────────────────────────────────────────────

function translateAccountType(type: string): string {
  const labels: Record<string, string> = {
    bank: "Banco",
    cash: "Efectivo",
    wallet: "Wallet",
    goal_account: "Cuenta de meta",
  };

  return labels[type] ?? type;
}

function translateDebtType(type: string): string {
  const labels: Record<string, string> = {
    credit_card: "Tarjeta de crédito",
    loan: "Préstamo",
    family_debt: "Deuda familiar",
    other_debt: "Otra deuda",
  };

  return labels[type] ?? type;
}

function translateTone(tone: string): string {
  return (
    {
      playful: "Cercano y juguetón",
      calm: "Calmado y claro",
      direct: "Directo y práctico",
    }[tone] ?? tone
  );
}

// ── Profile row ─────────────────────────────────────────────────────────────

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-100 px-4 py-3">
      <dt className="font-medium text-zinc-500">{label}</dt>
      <dd className="text-right font-bold text-zinc-950">{value}</dd>
    </div>
  );
}
