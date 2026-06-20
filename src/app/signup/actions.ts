"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSiteUrl } from "@/lib/site-url";

// New-account creation. Key Stage 21.2 changes vs the old combined flow:
//  1. Passes an explicit emailRedirectTo on the production domain, so the
//     confirmation email links back to /auth/confirm at www.soykipu.com — never
//     localhost.
//  2. Does NOT assume a session exists after signUp. With email confirmation
//     ON, signUp returns no session; instead of bouncing the user into a gated
//     /onboarding (which would dead-end at /login), we send them to a clear
//     "revisa tu correo" state. If confirmation is OFF (session present), we go
//     straight to onboarding.
//  3. Detects the obfuscated "already registered" signal (a user with an empty
//     identities array) and routes to a friendly "inicia sesión" state.
//
// Profile-row seeding is intentionally NOT done here anymore: with confirmation
// ON there is no session yet (so the anon write would hit RLS), and onboarding
// already creates the profile idempotently once the session is established.
export async function signUpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/signup?message=missing-fields");
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=/onboarding`,
    },
  });

  if (error) {
    redirect(`/signup?message=${encodeURIComponent(error.message)}`);
  }

  const alreadyRegistered =
    !!data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
  if (alreadyRegistered) {
    redirect("/signup?message=already-registered");
  }

  if (data.session) {
    // Email confirmation is disabled → the user is signed in immediately.
    redirect("/onboarding");
  }

  // Email confirmation is required → no session yet. Show the check-email state.
  redirect(`/signup?sent=${encodeURIComponent(email)}`);
}
