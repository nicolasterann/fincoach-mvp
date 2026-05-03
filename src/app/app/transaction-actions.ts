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

  const { error: transactionError } = await supabase.from("transactions").insert({
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

  if (transactionError) {
    redirect(`/app?message=${encodeURIComponent(transactionError.message)}`);
  }

  if (sourceAccountId) {
    const { data: account, error: accountReadError } = await supabase
      .from("accounts")
      .select("current_balance_original, current_balance_base")
      .eq("id", sourceAccountId)
      .eq("user_id", session.user.id)
      .single();

    if (accountReadError) {
      redirect(`/app?message=${encodeURIComponent(accountReadError.message)}`);
    }

    const nextOriginalBalance = Number(account.current_balance_original) - amount;
    const nextBaseBalance = Number(account.current_balance_base) - amount;

    const { error: accountUpdateError } = await supabase
      .from("accounts")
      .update({
        current_balance_original: nextOriginalBalance,
        current_balance_base: nextBaseBalance,
      })
      .eq("id", sourceAccountId)
      .eq("user_id", session.user.id);

    if (accountUpdateError) {
      redirect(`/app?message=${encodeURIComponent(accountUpdateError.message)}`);
    }
  }

  if (debtAccountId) {
    const { data: debtAccount, error: debtReadError } = await supabase
      .from("debt_accounts")
      .select("current_balance_original, current_balance_base")
      .eq("id", debtAccountId)
      .eq("user_id", session.user.id)
      .single();

    if (debtReadError) {
      redirect(`/app?message=${encodeURIComponent(debtReadError.message)}`);
    }

    const nextOriginalDebtBalance = Number(debtAccount.current_balance_original) + amount;
    const nextBaseDebtBalance = Number(debtAccount.current_balance_base) + amount;

    const { error: debtUpdateError } = await supabase
      .from("debt_accounts")
      .update({
        current_balance_original: nextOriginalDebtBalance,
        current_balance_base: nextBaseDebtBalance,
      })
      .eq("id", debtAccountId)
      .eq("user_id", session.user.id);

    if (debtUpdateError) {
      redirect(`/app?message=${encodeURIComponent(debtUpdateError.message)}`);
    }
  }

  redirect("/app?message=expense-created");
}
