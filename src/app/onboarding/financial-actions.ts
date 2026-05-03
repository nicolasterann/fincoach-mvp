"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function createAccountAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "bank").trim();
  const currency = String(formData.get("currency") ?? "USD").trim();
  const currentBalance = Number(formData.get("current_balance") ?? 0);
  const isGoalAccount = formData.get("is_goal_account") === "on";

  if (!name) {
    redirect("/onboarding?message=account-name-required");
  }

  const { error } = await supabase.from("accounts").insert({
    user_id: session.user.id,
    name,
    type,
    currency,
    current_balance_original: Number.isFinite(currentBalance) ? currentBalance : 0,
    current_balance_base: Number.isFinite(currentBalance) ? currentBalance : 0,
    is_goal_account: isGoalAccount || type === "goal_account",
  });

  if (error) {
    redirect(`/onboarding?message=${encodeURIComponent(error.message)}`);
  }

  redirect("/onboarding?message=account-created");
}
