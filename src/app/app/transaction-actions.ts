"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function createManualExpenseAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const description = String(formData.get("description") ?? "").trim();
  const amount = Number(formData.get("amount") ?? 0);
  const currency = String(formData.get("currency") ?? "USD").trim();
  const category = String(formData.get("category") ?? "other").trim();
  const sourceAccountId = String(formData.get("source_account_id") ?? "").trim();
  const debtAccountId = String(formData.get("debt_account_id") ?? "").trim();

  if (!description) {
    redirect("/app?message=transaction-description-required");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    redirect("/app?message=transaction-amount-required");
  }

  if (!sourceAccountId && !debtAccountId) {
    redirect("/app?message=transaction-source-required");
  }

  const { error } = await supabase.from("transactions").insert({
    user_id: session.user.id,
    type: "expense",
    description,
    category,
    original_amount: amount,
    original_currency: currency,
    exchange_rate_to_base: 1,
    base_amount: amount,
    base_currency: currency,
    source_account_id: sourceAccountId || null,
    debt_account_id: debtAccountId || null,
    confidence_score: 1,
    raw_input: description,
    input_channel: "web",
    occurred_at: new Date().toISOString(),
  });

  if (error) {
    redirect(`/app?message=${encodeURIComponent(error.message)}`);
  }

  redirect("/app?message=expense-created");
}
