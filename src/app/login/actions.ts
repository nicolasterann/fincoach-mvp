"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Returning-user sign-in. New-account creation lives in ../signup/actions.ts so
// the two flows are fully separate (Stage 21.2). On success → /app, which
// bounces to /onboarding when onboarding isn't complete. Errors are surfaced as
// a sentinel/raw message on /login and humanized by the page.
export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?message=missing-fields");
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/login?message=${encodeURIComponent(error.message)}`);
  }

  redirect("/app");
}
