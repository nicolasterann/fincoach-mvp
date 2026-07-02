"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Sets the new password for the RECOVERY session established by /auth/confirm
// (type=recovery). Requires that session — a guest is sent to request a fresh link.
export async function setNewPasswordAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 6) {
    redirect("/reset-password?message=too-short");
  }
  if (password !== confirm) {
    redirect("/reset-password?message=mismatch");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect("/login/reset?message=missing-email");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(`/reset-password?message=${encodeURIComponent(error.message)}`);
  }

  redirect("/app");
}
