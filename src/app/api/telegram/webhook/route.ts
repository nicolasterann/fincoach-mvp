import { NextRequest, NextResponse } from "next/server";
import { handleChatTransactionMessage } from "@/lib/ai/chat-transaction-handler";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sendTelegramMessage } from "@/lib/telegram/send-message";

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

  if (update.update_id !== undefined) {
    const { error: processedUpdateError } = await supabase
      .from("telegram_processed_updates")
      .insert({
        update_id: update.update_id,
        telegram_chat_id: chatId,
        telegram_message_id: update.message?.message_id?.toString() ?? null,
      });

    if (processedUpdateError) {
      if (processedUpdateError.code === "23505") {
        return NextResponse.json({
          ok: true,
          chatId,
          duplicate: true,
          updateId: update.update_id,
          message: "Duplicate Telegram update ignored.",
        });
      }

      return NextResponse.json(
        {
          ok: false,
          chatId,
          error: processedUpdateError.message,
        },
        { status: 500 },
      );
    }
  }

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
    const unlinkedMessage =
      text === "/start"
        ? "Hola, soy tu coach financiero de bolsillo. Para empezar, primero necesito vincular este Telegram con tu cuenta de FinCoach. Entra a la app y conecta tu chat desde la página temporal de vinculación."
        : "Todavía no tengo este Telegram vinculado a una cuenta de FinCoach. Entra a la app, vincula tu chat y después ya puedes escribirme cosas como: café 3 pichincha.";

    try {
      await sendTelegramMessage({
   chatId,
        text: unlinkedMessage,
      });
    } catch {
      // Keep webhook response safe even if Telegram sendMessage fails.
    }

    return NextResponse.json({
      ok: true,
      chatId,
      linked: false,
      message: unlinkedMessage,
    });
  }

  if (text === "/start") {
    const startMessage =
      "Estoy listo. Mándame tus movimientos como hablarías por chat: café 3 pichincha, zapatos 40 visa, me pagaron 50 freelance a pichincha o aporté 20 a brasil desde pichincha.";

    await supabase
      .from("telegram_user_links")
      .update({
        last_message_at: new Date().toISOString(),
      })
      .eq("telegram_chat_id", chatId);

    try {
      await sendTelegramMessage({
        chatId,
        text: startMessage,
      });
    } catch {
      // Keep webhook response safe even if Telegram sendMessage fails.
    }

    return NextResponse.json({
      ok: true,
      chatId,
      linked: true,
      userId: telegramLink.user_id,
      status: "success",
      code: "telegram-start",
      message: startMessage,
    });
  }

  const result = await handleChatTransactionMessage({
    userId: telegramLink.user_id,
    message: text,
    channel: "telegram",
    chatId,
  });

  await supabase
    .from("telegram_user_links")
    .update({
      last_message_at: new Date().toISOString(),
    })
    .eq("telegram_chat_id", chatId);

  let telegramSendError: string | null = null;

  try {
    await sendTelegramMessage({
      chatId,
      text: result.chatResponse.message,
    });
  } catch (error) {
    telegramSendError =
      error instanceof Error ? error.message : "Unknown Telegram send error";
  }

  return NextResponse.json({
    ok: true,
    chatId,
    linked: true,
    userId: telegramLink.user_id,
    text,
    status: result.chatResponse.status,
    code: result.redirectCode,
    message: result.chatResponse.message,
    parserSource: result.parserSource ?? null,
    parserConfidenceScore: result.parserConfidenceScore ?? null,
    coachResponseSource: result.coachResponseSource ?? null,
    coachResponseConfidenceScore: result.coachResponseConfidenceScore ?? null,
    telegramMessageSent: telegramSendError === null,
    telegramSendError,
  });
}
