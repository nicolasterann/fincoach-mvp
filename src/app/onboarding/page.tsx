import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import OnboardingWizardClient from "./onboarding-wizard-client";
import type { CurrencyCode } from "@/types/financial";

// Stage 22 — structured onboarding. The server gate (auth, lazy profile, and the
// "already onboarded → /app" forward redirect) is preserved; the chat interview
// is replaced by a guided <OnboardingWizard/> that builds the same OnboardingDraft
// and saves through the unchanged saveOnboardingDraftAction.

type Profile = {
  full_name: string | null;
  country: string | null;
  base_currency: string;
  tone_preference: string;
  onboarding_completed: boolean;
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
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

  let profile: Profile | null = existingProfile;
  if (!profile) {
    const inserted = await supabase
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
      .single();
    profile = inserted.data;
    // Two concurrent renders (prefetch + navigation) can both see "no profile" and
    // race the insert; the loser gets a duplicate-key error even though the profile
    // now exists — and right at the commit boundary a single immediate re-read can
    // still miss it. Retry briefly instead of showing a scary error on the user's
    // first second with Kipu.
    if (!profile) {
      if (inserted.error) {
        console.error("onboarding profile insert failed:", inserted.error.code, inserted.error.message);
      }
      for (let attempt = 0; attempt < 3 && !profile; attempt += 1) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 200));
        const reread = await supabase
          .from("profiles")
          .select("full_name, country, base_currency, tone_preference, onboarding_completed")
          .eq("id", session.user.id)
          .maybeSingle();
        profile = reread.data;
      }
    }
  }

  if (!profile) {
    return (
      <ErrorScreen
        title="No pude crear tu perfil"
        message="Intenta recargar la página. Si persiste, escríbenos."
      />
    );
  }

  // Already onboarded with real data → the product lives in /app (mirrors the
  // /app gate of >=1 account AND >=1 goal, plus onboarding_completed).
  const [{ count: accountCount }, { count: goalCount }] = await Promise.all([
    supabase.from("accounts").select("id", { count: "exact", head: true }).eq("user_id", session.user.id),
    supabase.from("goals").select("id", { count: "exact", head: true }).eq("user_id", session.user.id),
  ]);

  if (profile.onboarding_completed && (accountCount ?? 0) > 0 && (goalCount ?? 0) > 0) {
    redirect("/app");
  }

  return (
    <OnboardingWizardClient
      userEmail={session.user.email ?? ""}
      defaultBaseCurrency={(profile.base_currency || "USD") as CurrencyCode}
      saveErrored={Boolean(message)}
    />
  );
}

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-10 text-zinc-50">
      <section className="mx-auto max-w-md rounded-3xl border border-white/10 bg-zinc-900 p-6">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-3 text-sm text-zinc-400">{message}</p>
      </section>
    </main>
  );
}
