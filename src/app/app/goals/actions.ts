"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Direct goal actions (lowest friction beats chat for structured edits): set or
// move the goal's date so the engine can turn the goal into a weekly plan.
// Metadata-only update — no balance is touched.
export async function updateGoalDateAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const goalId = String(formData.get("goal_id") ?? "").trim();
  const targetDate = String(formData.get("target_date") ?? "").trim();

  if (!goalId || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    redirect("/app/goals?message=goal-date-invalid");
  }

  const { error } = await supabase
    .from("goals")
    .update({ target_date: targetDate })
    .eq("id", goalId)
    .eq("user_id", session.user.id);

  if (error) {
    redirect(`/app/goals?message=${encodeURIComponent(error.message)}`);
  }

  redirect("/app/goals?message=goal-date-set");
}
