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

export async function createDebtAccountAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "credit_card").trim();
  const currency = String(formData.get("currency") ?? "USD").trim();
  const currentBalance = Number(formData.get("current_balance") ?? 0);
  const minimumPayment = Number(formData.get("minimum_payment") ?? 0);
  const fullPaymentDue = Number(formData.get("full_payment_due") ?? 0);
  const dueDay = Number(formData.get("due_day") ?? 0);
  const cutoffDay = Number(formData.get("cutoff_day") ?? 0);
  const interestRate = Number(formData.get("interest_rate") ?? 0);
  const defaultPaymentAccountId = String(
    formData.get("default_payment_account_id") ?? "",
  ).trim();

  if (!name) {
    redirect("/onboarding?message=debt-name-required");
  }

  const { error } = await supabase.from("debt_accounts").insert({
    user_id: session.user.id,
    name,
    type,
    currency,
    current_balance_original: Number.isFinite(currentBalance) ? currentBalance : 0,
    current_balance_base: Number.isFinite(currentBalance) ? currentBalance : 0,
    minimum_payment: Number.isFinite(minimumPayment) ? minimumPayment : null,
    full_payment_due: Number.isFinite(fullPaymentDue) ? fullPaymentDue : null,
    due_day: dueDay >= 1 && dueDay <= 31 ? dueDay : null,
    cutoff_day: cutoffDay >= 1 && cutoffDay <= 31 ? cutoffDay : null,
    interest_rate: Number.isFinite(interestRate) ? interestRate : null,
    default_payment_account_id: defaultPaymentAccountId || null,
  });

  if (error) {
    redirect(`/onboarding?message=${encodeURIComponent(error.message)}`);
  }

  redirect("/onboarding?message=debt-account-created");
}

export async function createGoalAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const name = String(formData.get("name") ?? "").trim();
  const targetAmount = Number(formData.get("target_amount") ?? 0);
  const currentAmount = Number(formData.get("current_amount") ?? 0);
  const currency = String(formData.get("currency") ?? "USD").trim();
  const targetDate = String(formData.get("target_date") ?? "").trim();
  const goalAccountId = String(formData.get("goal_account_id") ?? "").trim();

  if (!name) {
    redirect("/onboarding?message=goal-name-required");
  }

  if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
    redirect("/onboarding?message=goal-target-required");
  }

  const { error } = await supabase.from("goals").insert({
    user_id: session.user.id,
    name,
    target_amount: targetAmount,
    currency,
    current_amount: Number.isFinite(currentAmount) ? currentAmount : 0,
    target_date: targetDate || null,
    goal_account_id: goalAccountId || null,
    status: "active",
    feasibility_status: "challenging",
    weekly_required_amount: 0,
    monthly_required_amount: 0,
  });

  if (error) {
    redirect(`/onboarding?message=${encodeURIComponent(error.message)}`);
  }

  redirect("/onboarding?message=goal-created");
}
