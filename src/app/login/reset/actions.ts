"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSiteUrl } from "@/lib/site-url";

// Password recovery request. Always lands on the "sent" state — we never reveal
// whether an email exists in Kipu (account enumeration). The email link comes
// back through /auth/confirm (type=recovery) which establishes the session and
// forwards to /reset-password.
export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    redirect("/login/reset?message=missing-email");
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getSiteUrl()}/auth/confirm?next=/reset-password`,
  });

  redirect(`/login/reset?sent=${encodeURIComponent(email)}`);
}
