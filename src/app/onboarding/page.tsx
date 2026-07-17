import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadFxRatesForDisplay } from "@/lib/fx/fx-store";
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
    console.error("onboarding profile read failed:", profileReadError.code, profileReadError.message);
    return (
      <ErrorScreen
        title="No pude leer tu perfil"
        message="No pude cargar tu perfil ahora. Recarga en un momento."
      />
    );
  }

  const PROFILE_COLUMNS = "full_name, country, base_currency, tone_preference, onboarding_completed";

  let profile: Profile | null = existingProfile;
  if (!profile) {
    // First contact: the row may not exist yet (no signup trigger) AND the session
    // SELECT can miss right after login (auth-cookie race), AND concurrent renders
    // of this page used to race plain INSERTs into 23505. S34 root fix: the ADMIN
    // client is the source of truth here (own user id from the server-verified
    // session — safe). Ensure the row with a conflict-free upsert (ON CONFLICT DO
    // NOTHING — concurrent renders both succeed), then read it back with retries,
    // LOGGING every error instead of swallowing it. NEVER hard-fail the first
    // contact for a recoverable race.
    const defaults = {
      id: session.user.id,
      full_name: null,
      country: null,
      base_currency: "USD",
      tone_preference: "playful",
      onboarding_completed: false,
    };
    try {
      const admin = createSupabaseAdminClient();
      const ensured = await admin
        .from("profiles")
        .upsert(defaults, { onConflict: "id", ignoreDuplicates: true });
      if (ensured.error) {
        console.error("onboarding profile ensure failed:", ensured.error.code, ensured.error.message);
      }
      for (let attempt = 0; attempt < 3 && !profile; attempt += 1) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 250));
        const read = await admin
          .from("profiles")
          .select(PROFILE_COLUMNS)
          .eq("id", session.user.id)
          .maybeSingle();
        if (read.error) {
          console.error("onboarding profile admin read failed:", read.error.code, read.error.message);
        }
        profile = read.data;
      }
    } catch (adminError) {
      console.error(
        "onboarding profile admin path failed:",
        adminError instanceof Error ? adminError.message : String(adminError),
      );
    }
    if (!profile) {
      // Admin unavailable (e.g. missing service key) — last resort via the user
      // client: insert (23505 = concurrent render already created it — fine),
      // then re-read.
      const inserted = await supabase.from("profiles").insert(defaults).select(PROFILE_COLUMNS).single();
      profile = inserted.data;
      if (!profile && inserted.error && inserted.error.code !== "23505") {
        console.error("onboarding profile insert failed:", inserted.error.code, inserted.error.message);
      }
      if (!profile) {
        const reread = await supabase
          .from("profiles")
          .select(PROFILE_COLUMNS)
          .eq("id", session.user.id)
          .maybeSingle();
        if (reread.error) {
          console.error("onboarding profile reread failed:", reread.error.code, reread.error.message);
        }
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

  // S31 (4.1) — the save action crafts human Spanish messages (incl. the honest-FX
  // ask); collapsing them to a Boolean hid the one thing the user needed to read.
  // Pass the real text through (control chars stripped, length-capped); the wizard
  // renders it in the review error box.
  const saveErrorMessage = message
    ? message.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 400) || null
    : null;

  // S31 (5.1f) — rates the user already confirmed (via chat or a previous save
  // attempt) must reach the client FX gate, or it re-asks for a rate the system
  // already knows.
  const knownRates = (await loadFxRatesForDisplay(session.user.id)).map((r) => ({
    from: r.from,
    to: r.to,
    rate: r.rate,
  }));

  return (
    <OnboardingWizardClient
      userEmail={session.user.email ?? ""}
      defaultBaseCurrency={(profile.base_currency || "USD") as CurrencyCode}
      saveErrored={Boolean(message)}
      saveErrorMessage={saveErrorMessage}
      knownRates={knownRates}
    />
  );
}

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-10 text-zinc-50">
      <section className="mx-auto max-w-md rounded-3xl border border-line/10 bg-zinc-900 p-6">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-3 text-sm text-zinc-400">{message}</p>
      </section>
    </main>
  );
}
