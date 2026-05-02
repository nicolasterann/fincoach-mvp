"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function updateProfileAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const fullName = String(formData.get("full_name") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();
  const baseCurrency = String(formData.get("base_currency") ?? "USD").trim();
  const tonePreference = String(formData.get("tone_preference") ?? "playful").trim();

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName || null,
      country: country || null,
      base_currency: baseCurrency || "USD",
      tone_preference: tonePreference || "playful",
    })
    .eq("id", session.user.id);

  if (error) {
    redirect(`/onboarding?message=${encodeURIComponent(error.message)}`);
  }

  redirect("/onboarding?message=profile-updated");
}
