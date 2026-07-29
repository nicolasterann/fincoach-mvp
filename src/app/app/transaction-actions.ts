"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { handleChatTransactionMessage } from "@/lib/ai/chat-transaction-handler";
import { buildLedgerEntryPayload } from "@/lib/ai/apply-chat-transaction-intent";
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
    const suppliedId = String(formData.get("submissionId") ?? "");
    await handleChatTransactionMessage({
      userId: session.user.id,
      message,
      channel: "web",
      chatId: session.user.id,
      requestId: /^[A-Za-z0-9_-]{8,64}$/.test(suppliedId)
        ? suppliedId
        : randomUUID(),
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

  // Honest FX: the quick-contribution amount is stated in the goal/base currency,
  // but the SOURCE account may live in another currency (e.g. an ARS account
  // funding a USD goal). The ledger applies original_amount to the source's
  // native balance, so it must be re-expressed in the SOURCE currency with a
  // KNOWN rate — never an implicit 1. No known rate → friendly ask, no write.
  let originalAmount = amount;
  let originalCurrency = currency;
  const rate = { value: 1 };
  {
    const { data: src } = await supabase
      .from("accounts")
      .select("currency")
      .eq("id", sourceAccountId)
      .eq("user_id", session.user.id)
      .maybeSingle();
    const srcCurrency = ((src as { currency?: string } | null)?.currency ?? currency)
      .trim()
      .toUpperCase();
    const goalCurrency = currency.trim().toUpperCase();
    if (srcCurrency !== goalCurrency) {
      const { readFxRates, usableRates } = await import("@/lib/fx/fx-store");
      const { convert } = await import("@/lib/fx/fx-rates");
      // Una lectura fallida deja rates=[] y convert falla → cae en el rechazo de
      // abajo (goal-contribution-fx-missing), que es exactamente lo correcto: no
      // convertir a una tasa inventada ni mover plata a ciegas.
      const rates = usableRates(await readFxRates(session.user.id));
      const res = convert(amount, goalCurrency, srcCurrency, rates);
      if (!res.ok) {
        redirect(`${returnTo}?message=goal-contribution-fx-missing`);
      }
      originalAmount = res.baseAmount;
      originalCurrency = srcCurrency;
      rate.value = res.rate > 0 ? 1 / res.rate : 1; // original→base rate
    }
  }

  // Atomic: source down, goal account up (if set), goal progress up — one unit.
  const { error: writeError } = await supabase.rpc("kipu_apply_ledger_entry", {
    p_entry: buildLedgerEntryPayload({
      userId: session.user.id,
      type: "goal_contribution",
      effectType: "goal_contribution",
      description,
      category: "savings",
      originalAmount,
      originalCurrency,
      exchangeRateToBase: rate.value,
      baseAmount: amount,
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
// to any UI (verified: zero call sites outside this definition). Safe to delete
// in a cleanup pass.
//
// MONEY-SAFETY GUARD: the legacy body did DIRECT `transactions.insert`s with
// `exchange_rate_to_base: intent.exchangeRateToBase ?? 1` (a fabricated 1:1 for
// any non-base currency) plus hand-rolled balance mutations, bypassing the single
// ledger writer and its FX/coherence validation. It was already dead (zero call
// sites) and unsafe, so it is removed: this action now routes through the SAME
// safe pipeline the live UI uses (honest FX, atomic ledger, dedupe). No financial
// rows are touched by this change. Do NOT reintroduce a direct-insert path —
// extend the pipeline / agent tools instead.
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

  // Safe path only: never fabricate FX, never bypass the ledger — the unsafe
  // legacy direct-insert body was removed.
  try {
    await handleChatTransactionMessage({
      userId: session.user.id,
      message,
      channel: "web",
      chatId: session.user.id,
      requestId: randomUUID(),
    });
  } catch {
    redirect("/app?message=chat-parser-failed");
  }
  redirect("/app");
}
