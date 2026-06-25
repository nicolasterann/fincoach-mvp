"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Disconnect Telegram for the current user. Deactivates their link rows (under
// RLS, a user can only touch their own). The webhook then treats that chat as
// unlinked again. No hard delete — auditable and reversible by reconnecting.
export async function disconnectTelegramAction() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  await supabase
    .from("telegram_user_links")
    .update({ is_active: false })
    .eq("user_id", session.user.id)
    .eq("is_active", true);

  revalidatePath("/app/settings");
}
