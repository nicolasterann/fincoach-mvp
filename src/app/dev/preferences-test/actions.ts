"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function saveDefaultPaymentMethodAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Not authenticated");
  }

  const defaultSourceValue = String(formData.get("default_source") ?? "");

  if (!defaultSourceValue) {
    throw new Error("Missing default source");
  }

  const [defaultSourceType, defaultSourceId] = defaultSourceValue.split(":");

  if (
    (defaultSourceType !== "account" && defaultSourceType !== "debt_account") ||
    !defaultSourceId
  ) {
    throw new Error("Invalid default source");
  }

  const { error } = await supabase.from("user_financial_preferences").upsert({
    user_id: session.user.id,
    default_source_type: defaultSourceType,
    default_source_id: defaultSourceId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/dev/preferences-test");
  revalidatePath("/app");

  return;
}
