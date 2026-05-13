import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { updateProfileAction } from "./actions";
import {
  createAccountAction,
  createDebtAccountAction,
  createGoalAction,
} from "./financial-actions";
import { ONBOARDING_STEP_METADATA } from "@/lib/onboarding/step-metadata";
import { ONBOARDING_STEP_ORDER } from "@/lib/onboarding/steps";
import type { OnboardingStep } from "@/lib/onboarding/steps";

// ── Constants ──────────────────────────────────────────────────────────────

const FIELD_CLASS =
  "rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-400/10";

const PROGRESS_STEPS = ONBOARDING_STEP_ORDER.filter(
  (s) => s !== "completed",
) as OnboardingStep[];

// ── Types ──────────────────────────────────────────────────────────────────

type Profile = {
  full_name: string | null;
  country: string | null;
  base_currency: string;
  tone_preference: string;
  onboarding_completed: boolean;
};

type Account = {
  id: string;
  name: string;
  type: string;
  currency: string;
  current_balance_base: number;
  is_goal_account: boolean;
};

type DebtAccount = {
  id: string;
  name: string;
  type: string;
  currency: string;
  current_balance_base: number;
  due_day: number | null;
};

type Goal = {
  id: string;
  name: string;
  target_amount: number;
  currency: string;
  current_amount: number;
  target_date: string | null;
  status: string;
  goal_account_id: string | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function deriveCurrentStep(
  profile: Profile,
  accountsCount: number,
  debtCount: number,
  goalsCount: number,
): OnboardingStep {
  if (!profile.full_name) return "profile";
  if (accountsCount === 0) return "accounts";
  if (debtCount === 0) return "debt_accounts";
  if (goalsCount === 0) return "goals";
  if (!profile.onboarding_completed) return "coach_preferences";
  return "review";
}

/**
 * User-friendly short amount: "403$" for USD, "403€" for EUR, "403 ARS" otherwise.
 * Intentionally informal — this is coach copy, not accounting output.
 */
function formatShort(amount: number, currency: string): string {
  const n = Math.round(amount);
  if (currency === "EUR") return `${n}€`;
  return `${n}$`;
}

// ── Page ───────────────────────────────────────────────────────────────────

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
    .select(
      "full_name, country, base_currency, tone_preference, onboarding_completed",
    )
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
        .select(
          "full_name, country, base_currency, tone_preference, onboarding_completed",
        )
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
    return (
      <ErrorScreen title="No pude leer tus cuentas" message={accountsError.message} />
    );
  }

  const { data: debtAccounts, error: debtAccountsError } = await supabase
    .from("debt_accounts")
    .select("id, name, type, currency, current_balance_base, due_day")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true });

  if (debtAccountsError) {
    return (
      <ErrorScreen title="No pude leer tus deudas" message={debtAccountsError.message} />
    );
  }

  const { data: goals, error: goalsError } = await supabase
    .from("goals")
    .select(
      "id, name, target_amount, currency, current_amount, target_date, status, goal_account_id",
    )
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true });

  if (goalsError) {
    return (
      <ErrorScreen title="No pude leer tus metas" message={goalsError.message} />
    );
  }

  const safeAccounts: Account[] = accounts ?? [];
  const safeDebtAccounts: DebtAccount[] = debtAccounts ?? [];
  const safeGoals: Goal[] = goals ?? [];

  const currentStep = deriveCurrentStep(
    profile,
    safeAccounts.length,
    safeDebtAccounts.length,
    safeGoals.length,
  );
  const currentStepIndex = PROGRESS_STEPS.indexOf(currentStep);
  const currentMeta = ONBOARDING_STEP_METADATA[currentStep];
  const prevStep =
    currentStepIndex > 0 ? PROGRESS_STEPS[currentStepIndex - 1] : null;

  // Truncate previous question to ~90 chars for quiet context line
  const prevQuestion = prevStep
    ? ONBOARDING_STEP_METADATA[prevStep].primaryQuestion
    : null;
  const prevQuestionShort =
    prevQuestion && prevQuestion.length > 90
      ? prevQuestion.slice(0, 90).trimEnd() + "…"
      : prevQuestion;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-zinc-50">
      <div className="mx-auto max-w-5xl px-6 py-10 lg:px-12">

        {/* ── Top bar ───────────────────────────────────────────────── */}
        <header className="flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight text-zinc-100">
            Kipu
          </span>
          <span className="text-sm text-zinc-600">
            {currentMeta.title} · Paso {currentStepIndex + 1} de{" "}
            {PROGRESS_STEPS.length}
          </span>
        </header>

        {/* ── Thin progress line ────────────────────────────────────── */}
        <ProgressLine
          percent={Math.round(
            (currentStepIndex / (PROGRESS_STEPS.length - 1)) * 100,
          )}
        />

        {/* ── Main layout ───────────────────────────────────────────── */}
        <div className="mt-20 grid gap-16 lg:grid-cols-[1fr_220px] lg:items-start">

          {/* ── Interview column ────────────────────────────────────── */}
          <div className="flex flex-col gap-10">

            {/* Quiet previous context */}
            {prevQuestionShort && (
              <p className="border-l-2 border-zinc-800 pl-4 text-xs leading-relaxed text-zinc-700">
                {prevQuestionShort}
              </p>
            )}

            {/* Current question — visual hero */}
            <p className="text-3xl font-light leading-snug tracking-tight text-zinc-100 sm:text-4xl sm:leading-[1.2]">
              {currentMeta.primaryQuestion}
            </p>

            {/* Inline example hint — not chips */}
            {currentMeta.examples.length > 0 && (
              <p className="text-sm text-zinc-500">
                Puedes responder algo como:{" "}
                <span className="text-zinc-400">
                  &ldquo;{currentMeta.examples[0]}&rdquo;
                </span>
              </p>
            )}

            {/* Disabled interview input */}
            <InterviewInput />

          </div>

          {/* ── Ya entendí panel ──────────────────────────────────────── */}
          <div className="lg:sticky lg:top-10">
            <YaEntendiPanel
              profile={profile}
              accounts={safeAccounts}
              debtAccounts={safeDebtAccounts}
              goals={safeGoals}
            />
          </div>

        </div>

        {/* ── Legacy forms ──────────────────────────────────────────── */}
        <details className="group mt-28">
          <summary className="flex cursor-pointer select-none list-none items-center gap-5 py-2 [&::-webkit-details-marker]:hidden">
            <div className="h-px flex-1 bg-zinc-800" />
            <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-zinc-600 transition-colors hover:text-zinc-400">
              <ChevronIcon />
              Datos actuales · Configuración
            </span>
            <div className="h-px flex-1 bg-zinc-800" />
          </summary>

          <div className="mt-10 flex flex-col gap-10">

            {/* ── Perfil ─────────────────────────────────────────── */}
            <LegacySectionLabel step="1" title="Tu perfil" />
            <div className="grid gap-6 md:grid-cols-2">

              <LegacyCard>
                <LegacyCardTitle>Perfil actual</LegacyCardTitle>
                <dl className="mt-5 space-y-3 text-sm">
                  <ProfileRow label="Email" value={session.user.email ?? "Sin email"} />
                  <ProfileRow label="Nombre" value={profile.full_name ?? "Pendiente"} />
                  <ProfileRow label="País" value={profile.country ?? "Pendiente"} />
                  <ProfileRow label="Moneda base" value={profile.base_currency} />
                  <ProfileRow
                    label="Tono"
                    value={translateTone(profile.tone_preference)}
                  />
                  <ProfileRow
                    label="Onboarding"
                    value={profile.onboarding_completed ? "Completado" : "En progreso"}
                  />
                </dl>
              </LegacyCard>

              <LegacyCard>
                <LegacyCardTitle>Actualizar preferencias</LegacyCardTitle>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  Ajusta tu nombre, país y moneda.
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
                    <span className="text-sm font-medium text-zinc-700">
                      Moneda base
                    </span>
                    <select
                      className={FIELD_CLASS}
                      defaultValue={profile.base_currency}
                      name="base_currency"
                    >
                      <option value="USD">USD</option>
                      <option value="ARS">ARS</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-700">
                      Tono del coach
                    </span>
                    <select
                      className={FIELD_CLASS}
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
              </LegacyCard>

            </div>

            {/* ── Cuentas ────────────────────────────────────────── */}
            <LegacySectionLabel step="2" title="Tus cuentas" />
            <div className="grid gap-6 md:grid-cols-2">

              <LegacyCard>
                <LegacyCardTitle>Cuentas registradas</LegacyCardTitle>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  Los lugares donde tu dinero realmente existe.
                </p>
                <div className="mt-5 space-y-3">
                  {safeAccounts.length === 0 ? (
                    <EmptyState text="Todavía no tienes cuentas registradas." />
                  ) : (
                    safeAccounts.map((account) => (
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
                          {account.currency}{" "}
                          {Number(account.current_balance_base).toFixed(2)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </LegacyCard>

              <LegacyCard>
                <LegacyCardTitle>Agregar cuenta</LegacyCardTitle>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  Empieza con una cuenta real. Por ejemplo: Pichincha, Efectivo o Cuenta Brasil.
                </p>
                <form action={createAccountAction} className="mt-6 flex flex-col gap-4">
                  <TextInput
                    label="Nombre de la cuenta"
                    name="name"
                    placeholder="Pichincha"
                    required
                  />
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-700">Tipo</span>
                    <select className={FIELD_CLASS} defaultValue="bank" name="type">
                      <option value="bank">Banco</option>
                      <option value="cash">Efectivo</option>
                      <option value="wallet">Wallet</option>
                      <option value="goal_account">Cuenta de meta</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-700">Moneda</span>
                    <select
                      className={FIELD_CLASS}
                      defaultValue={profile.base_currency}
                      name="currency"
                    >
                      <option value="USD">USD</option>
                      <option value="ARS">ARS</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-700">
                      Saldo actual
                    </span>
                    <input
                      className={FIELD_CLASS}
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
              </LegacyCard>

            </div>

            {/* ── Deudas ─────────────────────────────────────────── */}
            <LegacySectionLabel step="3" title="Tarjetas y deudas" />
            <div className="grid gap-6 md:grid-cols-2">

              <LegacyCard>
                <LegacyCardTitle>Deudas registradas</LegacyCardTitle>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  Las tarjetas son deuda, no dinero disponible.
                </p>
                <div className="mt-5 space-y-3">
                  {safeDebtAccounts.length === 0 ? (
                    <EmptyState text="Todavía no tienes deudas o tarjetas registradas." />
                  ) : (
                    safeDebtAccounts.map((debt) => (
                      <div
                        className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm"
                        key={debt.id}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-bold text-zinc-950">{debt.name}</p>
                            <p className="text-xs text-zinc-500">
                              {translateDebtType(debt.type)}
                              {debt.due_day ? ` · Pago día ${debt.due_day}` : ""}
                            </p>
                          </div>
                          <p className="font-black text-zinc-950">
                            {debt.currency}{" "}
                            {Number(debt.current_balance_base).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </LegacyCard>

              <LegacyCard>
                <LegacyCardTitle>Agregar deuda o tarjeta</LegacyCardTitle>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  Si usas tarjeta, regístrala aquí. Comprar con tarjeta aumenta deuda.
                </p>
                <form
                  action={createDebtAccountAction}
                  className="mt-6 flex flex-col gap-4"
                >
                  <TextInput
                    label="Nombre"
                    name="name"
                    placeholder="Visa Pichincha"
                    required
                  />
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-700">Tipo</span>
                    <select
                      className={FIELD_CLASS}
                      defaultValue="credit_card"
                      name="type"
                    >
                      <option value="credit_card">Tarjeta de crédito</option>
                      <option value="loan">Préstamo</option>
                      <option value="family_debt">Deuda familiar</option>
                      <option value="other_debt">Otra deuda</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-700">Moneda</span>
                    <select
                      className={FIELD_CLASS}
                      defaultValue={profile.base_currency}
                      name="currency"
                    >
                      <option value="USD">USD</option>
                      <option value="ARS">ARS</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </label>
                  <NumberInput
                    label="Saldo / deuda actual"
                    name="current_balance"
                    placeholder="80.00"
                  />
                  <NumberInput
                    label="Pago mínimo"
                    name="minimum_payment"
                    placeholder="20.00"
                  />
                  <NumberInput
                    label="Pago total del mes"
                    name="full_payment_due"
                    placeholder="80.00"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <NumberInput label="Día de pago" name="due_day" placeholder="29" />
                    <NumberInput
                      label="Día de corte"
                      name="cutoff_day"
                      placeholder="15"
                    />
                  </div>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-700">
                      Cuenta desde donde sueles pagar
                    </span>
                    <select
                      className={FIELD_CLASS}
                      defaultValue=""
                      name="default_payment_account_id"
                    >
                      <option value="">Sin definir todavía</option>
                      {safeAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <PrimaryButton label="Guardar deuda o tarjeta" />
                </form>
              </LegacyCard>

            </div>

            {/* ── Meta ───────────────────────────────────────────── */}
            <LegacySectionLabel step="4" title="Tu meta principal" />
            <div className="grid gap-6 md:grid-cols-2">

              <LegacyCard>
                <LegacyCardTitle>Meta registrada</LegacyCardTitle>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  Una meta clara para que Kipu te acompañe con propósito.
                </p>
                <div className="mt-5 space-y-3">
                  {safeGoals.length === 0 ? (
                    <EmptyState text="Todavía no tienes una meta registrada." />
                  ) : (
                    safeGoals.map((goal) => (
                      <div
                        className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm"
                        key={goal.id}
                      >
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
                            {goal.currency}{" "}
                            {Number(goal.current_amount).toFixed(2)} /{" "}
                            {Number(goal.target_amount).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </LegacyCard>

              <LegacyCard>
                <LegacyCardTitle>Crear meta principal</LegacyCardTitle>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  Define una meta concreta. Kipu usará esta meta para darte seguimiento.
                </p>
                <form action={createGoalAction} className="mt-6 flex flex-col gap-4">
                  <TextInput
                    label="Nombre de la meta"
                    name="name"
                    placeholder="Viaje a Brasil"
                    required
                  />
                  <NumberInput
                    label="Monto objetivo"
                    name="target_amount"
                    placeholder="800.00"
                  />
                  <NumberInput
                    label="Monto ya ahorrado"
                    name="current_amount"
                    placeholder="0.00"
                  />
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-700">Moneda</span>
                    <select
                      className={FIELD_CLASS}
                      defaultValue={profile.base_currency}
                      name="currency"
                    >
                      <option value="USD">USD</option>
                      <option value="ARS">ARS</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-700">
                      Fecha objetivo
                    </span>
                    <input className={FIELD_CLASS} name="target_date" type="date" />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-zinc-700">
                      Cuenta donde guardarás esta meta
                    </span>
                    <select
                      className={FIELD_CLASS}
                      defaultValue=""
                      name="goal_account_id"
                    >
                      <option value="">Sin cuenta asignada todavía</option>
                      {safeAccounts
                        .filter((a) => a.is_goal_account)
                        .map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <PrimaryButton label="Guardar meta" />
                </form>
              </LegacyCard>

            </div>

          </div>
        </details>

        <div className="h-20" />

      </div>
    </main>
  );
}

// ── Interview shell ────────────────────────────────────────────────────────

function ProgressLine({ percent }: { percent: number }) {
  return (
    <div className="relative mt-6 h-px w-full overflow-hidden rounded-full bg-zinc-800">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-zinc-500 transition-all duration-700"
        style={{ width: `${Math.max(4, percent)}%` }}
      />
    </div>
  );
}

function InterviewInput() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 px-5 py-4">
      <span className="flex-1 text-sm text-zinc-600 select-none">
        Escribe tu respuesta...
      </span>
      <span className="shrink-0 text-xs text-zinc-700">Próximamente</span>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800/80">
        <svg
          className="h-3.5 w-3.5 text-zinc-600"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="M5 12h14M12 5l7 7-7 7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

// ── Ya entendí panel ───────────────────────────────────────────────────────

function YaEntendiPanel({
  profile,
  accounts,
  debtAccounts,
  goals,
}: {
  profile: Profile;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: Goal[];
}) {
  const totalBalance = accounts.reduce(
    (s, a) => s + Number(a.current_balance_base),
    0,
  );
  const totalDebt = debtAccounts.reduce(
    (s, d) => s + Number(d.current_balance_base),
    0,
  );
  const mainGoal = goals[0] ?? null;
  const hasFinancials =
    accounts.length > 0 || debtAccounts.length > 0 || mainGoal !== null;

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 px-5 py-6">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
        Ya entendí
      </p>

      <div className="mt-5 space-y-4">
        <PanelRow label="Nombre" value={profile.full_name ?? "—"} />
        <PanelRow label="País" value={profile.country ?? "—"} />
        <PanelRow label="Moneda" value={profile.base_currency} />
      </div>

      {hasFinancials && (
        <div className="mt-5 space-y-4 border-t border-zinc-800 pt-5">
          {accounts.length > 0 && (
            <PanelRow
              label="En cuentas"
              value={formatShort(totalBalance, profile.base_currency)}
            />
          )}
          {debtAccounts.length > 0 && (
            <PanelRow
              label="En tarjetas"
              value={formatShort(totalDebt, profile.base_currency)}
            />
          )}
          {mainGoal !== null && Number(mainGoal.target_amount) > 0 && (
            <PanelRow
              label="Meta"
              value={`${formatShort(Number(mainGoal.current_amount), mainGoal.currency)} de ${formatShort(Number(mainGoal.target_amount), mainGoal.currency)}`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PanelRow({ label, value }: { label: string; value: string }) {
  const isEmpty = value === "—";
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-xs text-zinc-600">{label}</span>
      <span
        className={[
          "truncate text-right text-sm font-medium",
          isEmpty ? "text-zinc-700" : "text-zinc-300",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

// ── Micro icon ─────────────────────────────────────────────────────────────

function ChevronIcon() {
  return (
    <svg
      className="h-3 w-3 transition-transform duration-200 group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Legacy section helpers ─────────────────────────────────────────────────

function LegacySectionLabel({ step, title }: { step: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-500">
        {step}
      </span>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
        {title}
      </h2>
      <div className="h-px flex-1 bg-zinc-800" />
    </div>
  );
}

function LegacyCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-6 text-zinc-950 shadow-xl shadow-black/30">
      {children}
    </section>
  );
}

function LegacyCardTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xl font-bold">{children}</h3>;
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-500">{text}</p>
  );
}

// ── Error screen ───────────────────────────────────────────────────────────

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <main className="min-h-screen bg-[#0a0a0a] px-5 py-10 text-zinc-50">
      <section className="mx-auto max-w-md rounded-3xl bg-white p-6 text-zinc-950">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-3 text-sm text-zinc-600">{message}</p>
      </section>
    </main>
  );
}

// ── Form primitives ────────────────────────────────────────────────────────

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
        className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-400/10"
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
        className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-400/10"
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

// ── Translation helpers ────────────────────────────────────────────────────

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

// ── Profile row ────────────────────────────────────────────────────────────

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-100 px-4 py-3">
      <dt className="font-medium text-zinc-500">{label}</dt>
      <dd className="text-right font-bold text-zinc-950">{value}</dd>
    </div>
  );
}
