"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { buildChatTransactionSuccessResult } from "@/lib/ai/chat-transaction-result";
import { handleChatTransactionMessage } from "@/lib/ai/chat-transaction-handler";
import { buildLedgerEntryPayload } from "@/lib/ai/apply-chat-transaction-intent";
import { parseTransaction } from "@/lib/ai/transaction-parser-router";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Web chat parity: route the web chat box through the SAME core pipeline as
// Telegram (Universal Router → coach → recovery/transfers/parser → single
// writer), with channel="web" and a stable chatId so recent chat memory,
// coach follow-ups, recovery confirmations and multi-turn transfer collection
// all work on web too. The handler persists both chat turns to chat_messages.
export async function sendWebChatMessageAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const message = String(formData.get("message") ?? "").trim();
  // Where to return after sending. Defaults to the dashboard for backward
  // compatibility; the dedicated chat page passes "/app/chat".
  const rawRedirect = String(formData.get("redirectTo") ?? "/app");
  const redirectTo = rawRedirect.startsWith("/app") ? rawRedirect : "/app";
  if (!message) {
    redirect(`${redirectTo}?message=chat-message-required`);
  }

  try {
    await handleChatTransactionMessage({
      userId: session.user.id,
      message,
      channel: "web",
      chatId: session.user.id,
    });
  } catch {
    redirect(`${redirectTo}?message=chat-parser-failed`);
  }

  redirect(redirectTo);
}

// Live chat send for the dedicated chat page: runs the SAME pipeline (agent →
// fallback, both turns persisted to chat_messages) but RETURNS Kipu's reply so
// the client can render an optimistic conversation without a page reload.
// `submissionId` is a trusted client-generated id for ONE user submission,
// stable if the client retries the SAME submission and distinct for a new one.
// It becomes the turn's operation namespace, so a double-submit / retry of the
// same submission converges to a single financial result via deterministic
// dedupe keys (M1). It is an idempotency hint only — never an authorization
// value (the user is the authenticated session; movements are validated by the
// ledger function against the session user's own accounts).
export async function sendChatMessageAndGetReply(
  message: string,
  submissionId?: string,
): Promise<{ reply: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const trimmed = String(message ?? "").trim();
  if (!trimmed) {
    return { reply: "No me llegó tu mensaje — ¿me lo repites?" };
  }

  // Only accept a well-formed client submission id; otherwise fall back to a
  // fresh server id (no cross-retry dedup, but never a cross-user collision).
  const requestId =
    typeof submissionId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(submissionId)
      ? submissionId
      : randomUUID();

  try {
    const result = await handleChatTransactionMessage({
      userId: session.user.id,
      message: trimmed.slice(0, 1000),
      channel: "web",
      chatId: session.user.id,
      requestId,
    });
    return { reply: result.chatResponse.message };
  } catch {
    return {
      reply: "Se me cruzaron los cables un segundo. ¿Me lo dices otra vez?",
    };
  }
}

// Universal capture from the web (Stage 12): a receipt photo, screenshot or
// PDF dropped/pasted/attached in chat goes through the SAME evidence pipeline
// as Telegram media. Returns the reply for the optimistic chat UI.
export async function sendWebEvidenceAction(formData: FormData): Promise<{
  reply: string;
}> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { reply: "No me llegó ningún archivo. Intenta de nuevo con una foto o un PDF." };
  }

  const caption = String(formData.get("caption") ?? "").trim().slice(0, 500);
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { handleEvidenceCapture } = await import("@/lib/capture/evidence-capture");
  const result = await handleEvidenceCapture({
    userId: session.user.id,
    channel: "web",
    chatId: session.user.id,
    source: "web_upload",
    file: { bytes, mimeType: file.type, filename: file.name },
    caption: caption || undefined,
  });
  return { reply: result.reply };
}

// "Nueva conversación": hides everything before now from the chat VIEW. Nothing
// is deleted — the conversation ledger stays intact for memory and audit; the
// user just gets a clean starting point (and old fallback-era replies stop
// misrepresenting the current Kipu).
export async function clearChatHistoryAction() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  await supabase
    .from("user_financial_preferences")
    .upsert(
      { user_id: session.user.id, chat_cleared_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

  redirect("/app/chat");
}

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

  // One atomic operation (insert + balance/debt delta), same canonical writer
  // the chat/capture agent uses. Runs under the user's RLS session.
  const { error: writeError } = await supabase.rpc("kipu_apply_ledger_entry", {
    p_entry: buildLedgerEntryPayload({
      userId: session.user.id,
      type: "expense",
      effectType: "expense",
      description,
      category,
      originalAmount: amount,
      originalCurrency: currency,
      baseCurrency: currency,
      sourceAccountId: sourceAccountId || null,
      debtAccountId: debtAccountId || null,
      inputChannel: "web",
      rawInput: description,
    }),
  });

  if (writeError) {
    redirect(`/app?message=${encodeURIComponent(writeError.message)}`);
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

  const { error: writeError } = await supabase.rpc("kipu_apply_ledger_entry", {
    p_entry: buildLedgerEntryPayload({
      userId: session.user.id,
      type: "income",
      effectType: "income",
      description,
      category,
      originalAmount: amount,
      originalCurrency: currency,
      baseCurrency: currency,
      destinationAccountId,
      inputChannel: "web",
      rawInput: description,
    }),
  });

  if (writeError) {
    redirect(`/app?message=${encodeURIComponent(writeError.message)}`);
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
  // Quick actions (e.g. the goals page) return to their own surface.
  const rawReturn = String(formData.get("redirectTo") ?? "/app");
  const returnTo = rawReturn.startsWith("/app") ? rawReturn : "/app";

  if (!Number.isFinite(amount) || amount <= 0) {
    redirect(`${returnTo}?message=goal-contribution-amount-required`);
  }

  if (!sourceAccountId) {
    redirect(`${returnTo}?message=goal-contribution-source-required`);
  }

  if (!goalId) {
    redirect(`${returnTo}?message=goal-contribution-goal-required`);
  }

  // Atomic: source down, goal account up (if set), goal progress up — one unit.
  const { error: writeError } = await supabase.rpc("kipu_apply_ledger_entry", {
    p_entry: buildLedgerEntryPayload({
      userId: session.user.id,
      type: "goal_contribution",
      effectType: "goal_contribution",
      description,
      category: "savings",
      originalAmount: amount,
      originalCurrency: currency,
      baseCurrency: currency,
      sourceAccountId,
      destinationAccountId: goalAccountId || null,
      goalId,
      inputChannel: "web",
      rawInput: description,
    }),
  });

  if (writeError) {
    redirect(`/app?message=${encodeURIComponent(writeError.message)}`);
  }

  redirect(`${returnTo}?message=goal-contribution-created`);
}

// DEPRECATED: superseded by sendWebChatMessageAction, which routes web chat
// through the unified core pipeline (router/coach/recovery/transfers/memory).
// Retained only as a reference for the legacy form-post flow; no longer wired
// to any UI. Safe to delete in a cleanup pass.
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

  const [accountsResult, debtAccountsResult, goalsResult] = await Promise.all([
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
    supabase
      .from("goals")
      .select("id, user_id, name, target_amount, currency, current_amount, target_date, goal_account_id, status, feasibility_status, weekly_required_amount, monthly_required_amount, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true }),
  ]);

  if (accountsResult.error) {
    redirect(`/app?message=${encodeURIComponent(accountsResult.error.message)}`);
  }

  if (debtAccountsResult.error) {
    redirect(`/app?message=${encodeURIComponent(debtAccountsResult.error.message)}`);
  }

  if (goalsResult.error) {
    redirect(`/app?message=${encodeURIComponent(goalsResult.error.message)}`);
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

  const goals = (goalsResult.data ?? []).map((goal) => ({
    id: goal.id,
    userId: goal.user_id,
    name: goal.name,
    targetAmount: Number(goal.target_amount),
    currency: goal.currency,
    currentAmount: Number(goal.current_amount),
    targetDate: goal.target_date ?? "",
    goalAccountId: goal.goal_account_id ?? undefined,
    status: goal.status,
    feasibilityStatus: goal.feasibility_status,
    weeklyRequiredAmount: Number(goal.weekly_required_amount),
    monthlyRequiredAmount: Number(goal.monthly_required_amount),
    createdAt: goal.created_at,
  }));

  const parserResult = await parseTransaction({
    message,
    context: {
      userId: session.user.id,
      baseCurrency: goals[0]?.currency ?? "USD",
      accounts,
      debtAccounts,
      goals,
      mainGoal: goals[0] ?? null,
    },
  });

  if (parserResult.status !== "ready" || !parserResult.intent) {
    redirect("/app?message=chat-parser-needs-clarification");
  }

  const intent = parserResult.intent;

  if (intent.type === "goal_contribution") {
    if (!intent.sourceAccountId || !intent.goalId) {
      redirect("/app?message=chat-goal-contribution-needs-clarification");
    }

    const { error: transactionError } = await supabase.from("transactions").insert({
      user_id: session.user.id,
      type: "goal_contribution",
      description: intent.description,
      category: intent.category,
      original_amount: intent.originalAmount,
      original_currency: intent.originalCurrency,
      exchange_rate_to_base: intent.exchangeRateToBase ?? 1,
      base_amount: intent.originalAmount * (intent.exchangeRateToBase ?? 1),
      base_currency: intent.baseCurrency ?? intent.originalCurrency,
      source_account_id: intent.sourceAccountId,
      destination_account_id: intent.destinationAccountId || null,
      goal_id: intent.goalId,
      confidence_score: intent.confidenceScore,
      raw_input: message,
      input_channel: "chat",
      occurred_at: new Date().toISOString(),
    });

    if (transactionError) {
      redirect(`/app?message=${encodeURIComponent(transactionError.message)}`);
    }

    const sourceAccount = accounts.find((item) => item.id === intent.sourceAccountId);

    if (!sourceAccount) {
      redirect("/app?message=chat-parser-account-not-found");
    }

    const { error: sourceAccountUpdateError } = await supabase
      .from("accounts")
      .update({
        current_balance_original: sourceAccount.currentBalanceOriginal - intent.originalAmount,
        current_balance_base: sourceAccount.currentBalanceBase - intent.originalAmount,
      })
      .eq("id", intent.sourceAccountId)
      .eq("user_id", session.user.id);

    if (sourceAccountUpdateError) {
      redirect(`/app?message=${encodeURIComponent(sourceAccountUpdateError.message)}`);
    }

    if (intent.destinationAccountId) {
      const goalAccount = accounts.find((item) => item.id === intent.destinationAccountId);

      if (goalAccount) {
        const { error: goalAccountUpdateError } = await supabase
          .from("accounts")
          .update({
            current_balance_original:
              goalAccount.currentBalanceOriginal + intent.originalAmount,
            current_balance_base: goalAccount.currentBalanceBase + intent.originalAmount,
          })
          .eq("id", intent.destinationAccountId)
          .eq("user_id", session.user.id);

        if (goalAccountUpdateError) {
          redirect(`/app?message=${encodeURIComponent(goalAccountUpdateError.message)}`);
        }
      }
    }

    const goal = goals.find((item) => item.id === intent.goalId);

    if (!goal) {
      redirect("/app?message=chat-parser-goal-not-found");
    }

    const { error: goalUpdateError } = await supabase
      .from("goals")
      .update({
        current_amount: goal.currentAmount + intent.originalAmount,
      })
      .eq("id", intent.goalId)
      .eq("user_id", session.user.id);

    if (goalUpdateError) {
      redirect(`/app?message=${encodeURIComponent(goalUpdateError.message)}`);
    }

    const result = await buildChatTransactionSuccessResult({
      intent,
      goalName: goal.name,
    });

    redirect(`/app?message=${result.redirectCode}`);
  }

  if (intent.type === "income") {
    if (!intent.destinationAccountId) {
      redirect("/app?message=chat-income-needs-destination-account");
    }

    const { error: transactionError } = await supabase.from("transactions").insert({
      user_id: session.user.id,
      type: "income",
      description: intent.description,
      category: intent.category,
      original_amount: intent.originalAmount,
      original_currency: intent.originalCurrency,
      exchange_rate_to_base: intent.exchangeRateToBase ?? 1,
      base_amount: intent.originalAmount * (intent.exchangeRateToBase ?? 1),
      base_currency: intent.baseCurrency ?? intent.originalCurrency,
      destination_account_id: intent.destinationAccountId,
      confidence_score: intent.confidenceScore,
      raw_input: message,
      input_channel: "chat",
      occurred_at: new Date().toISOString(),
    });

    if (transactionError) {
      redirect(`/app?message=${encodeURIComponent(transactionError.message)}`);
    }

    const destinationAccount = accounts.find(
      (item) => item.id === intent.destinationAccountId,
    );

    if (!destinationAccount) {
      redirect("/app?message=chat-income-account-not-found");
    }

    const { error: accountUpdateError } = await supabase
      .from("accounts")
      .update({
        current_balance_original:
          destinationAccount.currentBalanceOriginal + intent.originalAmount,
        current_balance_base:
          destinationAccount.currentBalanceBase + intent.originalAmount,
      })
      .eq("id", intent.destinationAccountId)
      .eq("user_id", session.user.id);

    if (accountUpdateError) {
      redirect(`/app?message=${encodeURIComponent(accountUpdateError.message)}`);
    }

    const result = await buildChatTransactionSuccessResult({
      intent,
      accountName: destinationAccount.name,
    });

    redirect(`/app?message=${result.redirectCode}`);
  }

  if (intent.type !== "expense") {
    redirect("/app?message=chat-parser-only-expense-goal-income-supported-now");
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

  const result = await buildChatTransactionSuccessResult({
    intent,
    accountName: intent.sourceAccountId
      ? accounts.find((item) => item.id === intent.sourceAccountId)?.name
      : undefined,
    debtAccountName: intent.debtAccountId
      ? debtAccounts.find((item) => item.id === intent.debtAccountId)?.name
      : undefined,
  });

  redirect(`/app?message=${result.redirectCode}`);
}
