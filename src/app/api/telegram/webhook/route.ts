import { NextRequest, NextResponse } from "next/server";

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

  return NextResponse.json({
    ok: true,
    chatId,
    text,
    message:
      "Telegram webhook shell received the message. User lookup and transaction handling will be connected next.",
  });
}
