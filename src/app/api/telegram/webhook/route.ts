import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

interface TelegramWebhookUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: {
      id?: number | string;
      type?: string;
    };
    from?: {
      id?: number | string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
  };
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token");

  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "Telegram webhook secret is not configured." },
      { status: 500 },
    );
  }

  if (receivedSecret !== expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "Invalid Telegram webhook secret." },
      { status: 401 },
    );
  }

  let update: TelegramWebhookUpdate;

  try {
    update = (await request.json()) as TelegramWebhookUpdate;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid Telegram update payload." },
      { status: 400 },
    );
  }

  const chatId = update.message?.chat?.id?.toString();
  const text = update.message?.text?.trim();

  if (!chatId) {
    return NextResponse.json({ ok: true, skipped: "No chat id found." });
  }

  if (!text) {
    return NextResponse.json({
      ok: true,
      chatId,
      skipped: "No text message found.",
    });
  }

  const supabase = createSupabaseAdminClient();

  const { data: telegramLink, error: telegramLinkError } = await supabase
    .from("telegram_user_links")
    .select("user_id, telegram_chat_id, is_active")
    .eq("telegram_chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();

  if (telegramLinkError) {
    return NextResponse.json(
      {
        ok: false,
        chatId,
        error: telegramLinkError.message,
      },
      { status: 500 },
    );
  }

  if (!telegramLink) {
    return NextResponse.json({
      ok: true,
      chatId,
      linked: false,
      message:
        "Todavía no tengo este Telegram vinculado a una cuenta de FinCoach. Primero debemos conectar tu usuario.",
    });
  }

  return NextResponse.json({
    ok: true,
    chatId,
    linked: true,
    userId: telegramLink.user_id,
    text,
    message:
      "Telegram chat is linked. Transaction handling will be enabled after lookup validation.",
  });
}
