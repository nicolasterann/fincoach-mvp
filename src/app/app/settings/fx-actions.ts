"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { upsertFxRate } from "@/lib/fx/fx-store";

// Settings — save/update a manual exchange rate (Stage 23). fx_rates is
// service-role only (no client grants), so the write goes through the admin
// store from this server action. This is the user's source of truth: the
// dashboard + onboarding preview read it via loadFxRates.
export async function saveFxRateAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect("/login");
  }

  const from = String(formData.get("from") ?? "").trim().toUpperCase();
  const to = String(formData.get("to") ?? "").trim().toUpperCase();
  const rate = Number(String(formData.get("rate") ?? "").replace(/[^0-9.]/g, ""));

  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to || !Number.isFinite(rate) || rate <= 0) {
    redirect("/app/settings?fx=invalid");
  }

  const ok = await upsertFxRate(session.user.id, from, to, rate, "manual");
  revalidatePath("/app/settings");
  redirect(ok ? "/app/settings?fx=saved" : "/app/settings?fx=error");
}
