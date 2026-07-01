"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Stage 24 — persist the WEB-DISPLAY-ONLY currency preference. This NEVER touches
// base_currency or any stored amount; it only changes how the web dashboard re-expresses
// numbers at read time. The agent, Telegram and ambient nudges keep reasoning in base.
// Best-effort: if migration 032 isn't applied yet the update no-ops and we still redirect.
export async function setDisplayCurrencyAction(formData: FormData): Promise<void> {
  const raw = String(formData.get("currency") ?? "").trim().toUpperCase();
  const currency = /^[A-Z]{3}$/.test(raw) ? raw : "";

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  if (currency) {
    // RLS-scoped update on the user's own profile row. Swallow errors (e.g. column
    // absent pre-migration) so the toggle can never break the dashboard.
    await supabase
      .from("profiles")
      .update({ display_currency: currency })
      .eq("id", session.user.id);
  }

  revalidatePath("/app");
}
