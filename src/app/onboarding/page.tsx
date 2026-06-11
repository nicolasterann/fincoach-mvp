import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import OnboardingInterview from "./onboarding-interview";

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
      <ErrorScreen
        title="No pude leer tu perfil"
        message={profileReadError.message}
      />
    );
  }

  const profile: Profile | null =
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
      <ErrorScreen
        title="No pude leer tus cuentas"
        message={accountsError.message}
      />
    );
  }

  const { data: debtAccounts, error: debtAccountsError } = await supabase
    .from("debt_accounts")
    .select("id, name, type, currency, current_balance_base, due_day")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true });

  if (debtAccountsError) {
    return (
      <ErrorScreen
        title="No pude leer tus deudas"
        message={debtAccountsError.message}
      />
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
      <ErrorScreen
        title="No pude leer tus metas"
        message={goalsError.message}
      />
    );
  }

  const safeAccounts: Account[] = accounts ?? [];
  const safeDebtAccounts: DebtAccount[] = debtAccounts ?? [];
  const safeGoals: Goal[] = goals ?? [];

  // Already onboarded with real data → the product lives in /app. Re-entering
  // onboarding used to allow duplicate inserts; an intentional re-onboarding
  // flow (explicit reset) is a future, separate feature.
  if (profile.onboarding_completed && safeAccounts.length > 0 && safeGoals.length > 0) {
    redirect("/app");
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-zinc-50">
      <div className="mx-auto max-w-5xl px-6 py-10 lg:px-12">

        {/* ── Conversational interview (client component) ─────────── */}
        <OnboardingInterview
          initialProfile={profile}
          initialAccounts={safeAccounts}
          initialDebtAccounts={safeDebtAccounts}
          initialGoals={safeGoals}
          userEmail={session.user.email ?? ""}
        />


      </div>
    </main>
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
