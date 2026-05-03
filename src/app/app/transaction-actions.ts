"use server";

import { redirect } from "next/navigation";
import { parseBasicTransactionIntent } from "@/lib/financial/basic-intent-parser";
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

  if (sourceAccountId && debtAccountId) {
    redirect("/app?message=transaction-only-one-source-allowed");
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

export async function createManualIncomeAction(formData: FormData) {
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
  const category = String(formData.get("category") ?? "income").trim();
  const destinationAccountId = String(formData.get("destination_account_id") ?? "").trim();

  if (!description) {
    redirect("/app?message=income-description-required");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    redirect("/app?message=income-amount-required");
  }

  if (!destinationAccountId) {
    redirect("/app?message=income-destination-required");
  }

  const { error: transactionError } = await supabase.from("transactions").insert({
    user_id: session.user.id,
    type: "income",
    description,
    category,
    original_amount: amount,
    original_currency: currency,
    exchange_rate_to_base: 1,
    base_amount: amount,
    base_currency: currency,
    destination_account_id: destinationAccountId,
    confidence_score: 1,
    raw_input: description,
    input_channel: "web",
    occurred_at: new Date().toISOString(),
  });

  if (transactionError) {
    redirect(`/app?message=${encodeURIComponent(transactionError.message)}`);
  }

  const { data: account, error: accountReadError } = await supabase
    .from("accounts")
    .select("current_balance_original, current_balance_base")
    .eq("id", destinationAccountId)
    .eq("user_id", session.user.id)
    .single();

  if (accountReadError) {
    redirect(`/app?message=${encodeURIComponent(accountReadError.message)}`);
  }

  const nextOriginalBalance = Number(account.current_balance_original) + amount;
  const nextBaseBalance = Number(account.current_balance_base) + amount;

  const { error: accountUpdateError } = await supabase
    .from("accounts")
    .update({
      current_balance_original: nextOriginalBalance,
      current_balance_base: nextBaseBalance,
    })
    .eq("id", destinationAccountId)
    .eq("user_id", session.user.id);

  if (accountUpdateError) {
    redirect(`/app?message=${encodeURIComponent(accountUpdateError.message)}`);
  }

  redirect("/app?message=income-created");
}

export async function createGoalContributionAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const description = String(formData.get("description") ?? "Aporte a meta").trim();
  const amount = Number(formData.get("amount") ?? 0);
  const currency = String(formData.get("currency") ?? "USD").trim();
  const sourceAccountId = String(formData.get("source_account_id") ?? "").trim();
  const goalId = String(formData.get("goal_id") ?? "").trim();
  const goalAccountId = String(formData.get("goal_account_id") ?? "").trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    redirect("/app?message=goal-contribution-amount-required");
  }

  if (!sourceAccountId) {
    redirect("/app?message=goal-contribution-source-required");
  }

  if (!goalId) {
    redirect("/app?message=goal-contribution-goal-required");
  }

  const { error: transactionError } = await supabase.from("transactions").insert({
    user_id: session.user.id,
    type: "goal_contribution",
    description,
    category: "savings",
    original_amount: amount,
    original_currency: currency,
    exchange_rate_to_base: 1,
    base_amount: amount,
    base_currency: currency,
    source_account_id: sourceAccountId,
    destination_account_id: goalAccountId || null,
    goal_id: goalId,
    confidence_score: 1,
    raw_input: description,
    input_channel: "web",
    occurred_at: new Date().toISOString(),
  });

  if (transactionError) {
    redirect(`/app?message=${encodeURIComponent(transactionError.message)}`);
  }

  const { data: sourceAccount, error: sourceAccountReadError } = await supabase
    .from("accounts")
    .select("current_balance_original, current_balance_base")
    .eq("id", sourceAccountId)
    .eq("user_id", session.user.id)
    .single();

  if (sourceAccountReadError) {
    redirect(`/app?message=${encodeURIComponent(sourceAccountReadError.message)}`);
  }

  const { error: sourceAccountUpdateError } = await supabase
    .from("accounts")
    .update({
      current_balance_original: Number(sourceAccount.current_balance_original) - amount,
      current_balance_base: Number(sourceAccount.current_balance_base) - amount,
    })
    .eq("id", sourceAccountId)
    .eq("user_id", session.user.id);

  if (sourceAccountUpdateError) {
    redirect(`/app?message=${encodeURIComponent(sourceAccountUpdateError.message)}`);
  }

  if (goalAccountId) {
    const { data: goalAccount, error: goalAccountReadError } = await supabase
      .from("accounts")
      .select("current_balance_original, current_balance_base")
      .eq("id", goalAccountId)
      .eq("user_id", session.user.id)
      .single();

    if (goalAccountReadError) {
      redirect(`/app?message=${encodeURIComponent(goalAccountReadError.message)}`);
    }

    const { error: goalAccountUpdateError } = await supabase
      .from("accounts")
      .update({
        current_balance_original: Number(goalAccount.current_balance_original) + amount,
        current_balance_base: Number(goalAccount.current_balance_base) + amount,
      })
      .eq("id", goalAccountId)
      .eq("user_id", session.user.id);

    if (goalAccountUpdateError) {
      redirect(`/app?message=${encodeURIComponent(goalAccountUpdateError.message)}`);
    }
  }

  const { data: goal, error: goalReadError } = await supabase
    .from("goals")
    .select("current_amount")
    .eq("id", goalId)
    .eq("user_id", session.user.id)
    .single();

  if (goalReadError) {
    redirect(`/app?message=${encodeURIComponent(goalReadError.message)}`);
  }

  const { error: goalUpdateError } = await supabase
    .from("goals")
    .update({
      current_amount: Number(goal.current_amount) + amount,
    })
    .eq("id", goalId)
    .eq("user_id", session.user.id);

  if (goalUpdateError) {
    redirect(`/app?message=${encodeURIComponent(goalUpdateError.message)}`);
  }

  redirect("/app?message=goal-contribution-created");
}

export async function createChatParsedTransactionAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const message = String(formData.get("message") ?? "").trim();

  if (!message) {
    redirect("/app?message=chat-message-required");
  }

  const [accountsResult, debtAccountsResult] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, user_id, name, type, currency, current_balance_original, current_balance_base, is_goal_account, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("debt_accounts")
      .select("id, user_id, name, type, currency, current_balance_original, current_balance_base, minimum_payment, full_payment_due, due_day, cutoff_day, interest_rate, default_payment_account_id, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true }),
  ]);

  if (accountsResult.error) {
    redirect(`/app?message=${encodeURIComponent(accountsResult.error.message)}`);
  }

  if (debtAccountsResult.error) {
    redirect(`/app?message=${encodeURIComponent(debtAccountsResult.error.message)}`);
  }

  const accounts = (accountsResult.data ?? []).map((account) => ({
    id: account.id,
    userId: account.user_id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    currentBalanceOriginal: Number(account.current_balance_original),
    currentBalanceBase: Number(account.current_balance_base),
    isGoalAccount: account.is_goal_account,
    createdAt: account.created_at,
  }));

  const debtAccounts = (debtAccountsResult.data ?? []).map((debt) => ({
    id: debt.id,
    userId: debt.user_id,
    name: debt.name,
    type: debt.type,
    currency: debt.currency,
    currentBalanceOriginal: Number(debt.current_balance_original),
    currentBalanceBase: Number(debt.current_balance_base),
    minimumPayment: debt.minimum_payment === null ? undefined : Number(debt.minimum_payment),
    fullPaymentDue: debt.full_payment_due === null ? undefined : Number(debt.full_payment_due),
    dueDay: debt.due_day ?? undefined,
    cutoffDay: debt.cutoff_day ?? undefined,
    interestRate: debt.interest_rate === null ? undefined : Number(debt.interest_rate),
    defaultPaymentAccountId: debt.default_payment_account_id ?? undefined,
    createdAt: debt.created_at,
  }));

  const intent = parseBasicTransactionIntent({
    message,
    accounts,
    debtAccounts,
    baseCurrency: "USD",
  });

  if (intent.status !== "ready") {
    redirect("/app?message=chat-parser-needs-clarification");
  }

  if (intent.type !== "expense") {
    redirect("/app?message=chat-parser-only-expense-supported-now");
  }

  const { error: transactionError } = await supabase.from("transactions").insert({
    user_id: session.user.id,
    type: "expense",
    description: intent.description,
    category: intent.category,
    original_amount: intent.originalAmount,
    original_currency: intent.originalCurrency,
    exchange_rate_to_base: intent.exchangeRateToBase ?? 1,
    base_amount: intent.originalAmount * (intent.exchangeRateToBase ?? 1),
    base_currency: intent.baseCurrency ?? intent.originalCurrency,
    source_account_id: intent.sourceAccountId ?? null,
    debt_account_id: intent.debtAccountId ?? null,
    confidence_score: intent.confidenceScore,
    raw_input: message,
    input_channel: "chat",
    occurred_at: new Date().toISOString(),
  });

  if (transactionError) {
    redirect(`/app?message=${encodeURIComponent(transactionError.message)}`);
  }

  if (intent.sourceAccountId) {
    const account = accounts.find((item) => item.id === intent.sourceAccountId);

    if (!account) {
      redirect("/app?message=chat-parser-account-not-found");
    }

    const { error: accountUpdateError } = await supabase
      .from("accounts")
      .update({
        current_balance_original: account.currentBalanceOriginal - intent.originalAmount,
        current_balance_base: account.currentBalanceBase - intent.originalAmount,
      })
      .eq("id", intent.sourceAccountId)
      .eq("user_id", session.user.id);

    if (accountUpdateError) {
      redirect(`/app?message=${encodeURIComponent(accountUpdateError.message)}`);
    }
  }

  if (intent.debtAccountId) {
    const debtAccount = debtAccounts.find((item) => item.id === intent.debtAccountId);

    if (!debtAccount) {
      redirect("/app?message=chat-parser-debt-account-not-found");
    }

    const { error: debtUpdateError } = await supabase
      .from("debt_accounts")
      .update({
        current_balance_original: debtAccount.currentBalanceOriginal + intent.originalAmount,
        current_balance_base: debtAccount.currentBalanceBase + intent.originalAmount,
      })
      .eq("id", intent.debtAccountId)
      .eq("user_id", session.user.id);

    if (debtUpdateError) {
      redirect(`/app?message=${encodeURIComponent(debtUpdateError.message)}`);
    }
  }

  redirect("/app?message=chat-expense-created");
}
