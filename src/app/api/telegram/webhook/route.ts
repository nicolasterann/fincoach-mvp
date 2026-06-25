import { NextRequest, NextResponse } from "next/server";
import { handleChatTransactionMessage } from "@/lib/ai/chat-transaction-handler";
import { handleEvidenceCapture } from "@/lib/capture/evidence-capture";
import type { EvidenceSource } from "@/lib/capture/evidence-store";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { downloadTelegramFile } from "@/lib/telegram/get-file";
import { sendTelegramMessage } from "@/lib/telegram/send-message";
import { verifyTelegramLinkToken } from "@/lib/telegram/connect-link";

// A long card statement can drive create_card + obligations + several atomic
// <=15-row batches + a payment in one synchronous turn. Give the function room
// (300s is the platform max) so a heavy statement completes instead of timing
// out mid-import. A timeout is still safe — partial rows are durable and the
// re-upload/answer resumes idempotently — but this avoids it for normal use.
export const maxDuration = 300;

interface TelegramFileRef {
  file_id?: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
  width?: number;
}

interface TelegramWebhookUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    photo?: TelegramFileRef[];
    voice?: TelegramFileRef;
    audio?: TelegramFileRef;
    document?: TelegramFileRef;
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

// Universal capture (Stage 12): a photo, a voice note or a PDF sent (or
// forwarded/shared) to the bot IS a financial capture.
interface TelegramMedia {
  fileId: string;
  declaredSize?: number;
  mimeType: string;
  filename?: string;
  source: EvidenceSource;
}

function extractTelegramMedia(
  message: TelegramWebhookUpdate["message"],
): TelegramMedia | null {
  if (!message) return null;
  if (message.photo?.length) {
    // Telegram sends several sizes of the same photo; take the largest.
    const best = [...message.photo].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
    if (best?.file_id) {
      return {
        fileId: best.file_id,
        declaredSize: best.file_size,
        mimeType: "image/jpeg",
        source: "telegram_photo",
      };
    }
  }
  const voice = message.voice ?? message.audio;
  if (voice?.file_id) {
    return {
      fileId: voice.file_id,
      declaredSize: voice.file_size,
      mimeType: voice.mime_type ?? "audio/ogg",
      source: "telegram_voice",
    };
  }
  const doc = message.document;
  if (doc?.file_id) {
    return {
      fileId: doc.file_id,
      declaredSize: doc.file_size,
      mimeType: doc.mime_type ?? "application/octet-stream",
      filename: doc.file_name,
      source: "telegram_document",
    };
  }
  return null;
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
  const media = extractTelegramMedia(update.message);

  if (!chatId) {
    return NextResponse.json({ ok: true, skipped: "No chat id found." });
  }

  if (!text && !media) {
    return NextResponse.json({
      ok: true,
      chatId,
      skipped: "No text or media found.",
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

  // ── Self-serve account linking: /start <token> ──────────────────────────────
  // The token is issued in the app (Ajustes → Conectar Telegram), signed and
  // time-limited, and carries the Kipu user id. We verify it and bind THIS chat
  // to that user — the user never types a chat id, never visits /dev, never
  // touches the database. Runs before the link lookup so an unlinked chat can
  // connect itself. Idempotent (upsert on chat id), so a retried update is safe.
  if (text && text.startsWith("/start ")) {
    const linkedUserId = verifyTelegramLinkToken(text.slice("/start ".length).trim());

    if (!linkedUserId) {
      const invalidMessage =
        'Ese enlace para conectar ya venció o no es válido. Abre Kipu, entra a Ajustes y toca "Conectar Telegram" para generar uno nuevo.';
      try {
        await sendTelegramMessage({ chatId, text: invalidMessage });
      } catch {
        // Keep webhook response safe even if Telegram sendMessage fails.
      }
      return NextResponse.json({ ok: true, chatId, linked: false, code: "telegram-link-invalid" });
    }

    // Defense-in-depth: don't silently rebind a chat already linked to a
    // DIFFERENT Kipu account. A valid token only proves intent for ITS account;
    // if this chat belongs to someone else, ask them to disconnect first rather
    // than overwriting ownership. (telegram_chat_id is UNIQUE → at most one row.)
    const { data: existing } = await supabase
      .from("telegram_user_links")
      .select("user_id")
      .eq("telegram_chat_id", chatId)
      .eq("is_active", true)
      .maybeSingle();
    if (existing && existing.user_id !== linkedUserId) {
      const takenMessage =
        "Este Telegram ya está conectado a otra cuenta de Kipu. Si es tuya, desconéctalo primero desde Ajustes y vuelve a intentar.";
      try {
        await sendTelegramMessage({ chatId, text: takenMessage });
      } catch {
        // Keep webhook response safe even if Telegram sendMessage fails.
      }
      return NextResponse.json({ ok: true, chatId, linked: false, code: "telegram-chat-taken" });
    }

    const from = update.message?.from;
    const { error: linkError } = await supabase.from("telegram_user_links").upsert(
      {
        user_id: linkedUserId,
        telegram_chat_id: chatId,
        telegram_user_id: from?.id?.toString() ?? null,
        telegram_username: from?.username ?? null,
        telegram_first_name: from?.first_name ?? null,
        telegram_last_name: from?.last_name ?? null,
        is_active: true,
        last_message_at: new Date().toISOString(),
      },
      { onConflict: "telegram_chat_id" },
    );

    if (linkError) {
      try {
        await sendTelegramMessage({
          chatId,
          text: "Casi… no pude terminar de conectar. Inténtalo de nuevo desde Ajustes en un momento.",
        });
      } catch {
        // Keep webhook response safe even if Telegram sendMessage fails.
      }
      return NextResponse.json({ ok: false, chatId, error: linkError.message }, { status: 500 });
    }

    const successMessage =
      "¡Listo! 🎉 Tu Telegram quedó conectado a Kipu. Ahora cuéntame tus gastos como hablarías por chat (café 3 pichincha, zapatos 40 visa), mándame una nota de voz, la foto de un recibo o el PDF de tu estado de cuenta — yo me encargo.";
    try {
      await sendTelegramMessage({ chatId, text: successMessage });
    } catch {
      // Keep webhook response safe even if Telegram sendMessage fails.
    }
    return NextResponse.json({ ok: true, chatId, linked: true, userId: linkedUserId, code: "telegram-linked" });
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
        ? 'Hola, soy Kipu, tu coach financiero de bolsillo. Para empezar, conecta este Telegram con tu cuenta: abre Kipu en la app, entra a Ajustes y toca "Conectar Telegram".'
        : 'Todavía no tengo este Telegram conectado a tu cuenta de Kipu. Abre la app, entra a Ajustes y toca "Conectar Telegram"; después podrás escribirme cosas como: café 3 pichincha.';

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
      "Estoy listo. Cuéntame tus movimientos como hablarías por chat (café 3 pichincha, zapatos 40 visa) o mándame una nota de voz, la foto de un recibo, una captura del banco o el PDF de tu estado de cuenta — yo me encargo.";

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

  // ── Media capture: photo / voice note / document → evidence pipeline ──
  // Delivery safety: the dedupe row above stops CONCURRENT duplicate deliveries.
  // But a TRANSIENT failure (download timeout, claim-store blip) must not
  // permanently consume the update — we release the dedupe reservation and
  // return 5xx so Telegram retries, WITHOUT sending a user message (no dup
  // replies). A non-retryable outcome (unsupported file, real answer) is
  // acknowledged with 200 and a reply.
  if (media) {
    const releaseReservation = async () => {
      if (update.update_id === undefined) return;
      await supabase
        .from("telegram_processed_updates")
        .delete()
        .eq("update_id", update.update_id);
    };

    const download = await downloadTelegramFile(media.fileId, media.declaredSize);
    if (!download.ok || !download.bytes) {
      // Oversize is a permanent user error; everything else is transient.
      const permanent = /demasiado grande/.test(download.reason ?? "");
      if (permanent) {
        try {
          await sendTelegramMessage({
            chatId,
            text: `No pude usar ese archivo: ${download.reason}. Mándame una versión más liviana (máx. 12MB).`,
          });
        } catch {
          // keep webhook safe
        }
        return NextResponse.json({ ok: true, chatId, media: media.source, permanentFailure: true });
      }
      await releaseReservation();
      return NextResponse.json(
        { ok: false, chatId, retry: true, error: download.reason ?? "download failed" },
        { status: 503 },
      );
    }

    let captureResult;
    try {
      captureResult = await handleEvidenceCapture({
        userId: telegramLink.user_id,
        channel: "telegram",
        chatId,
        source: media.source,
        file: { bytes: download.bytes, mimeType: media.mimeType, filename: media.filename },
        caption: update.message?.caption ?? text,
      });
    } catch {
      await releaseReservation();
      return NextResponse.json(
        { ok: false, chatId, retry: true, error: "capture threw" },
        { status: 503 },
      );
    }

    // Transient capture failure → release + retry (no message, avoids dup replies).
    if (captureResult.retryable) {
      await releaseReservation();
      return NextResponse.json(
        { ok: false, chatId, retry: true, error: "capture transient" },
        { status: 503 },
      );
    }

    await supabase
      .from("telegram_user_links")
      .update({ last_message_at: new Date().toISOString() })
      .eq("telegram_chat_id", chatId);

    let mediaSendError: string | null = null;
    try {
      await sendTelegramMessage({ chatId, text: captureResult.reply });
    } catch (error) {
      mediaSendError =
        error instanceof Error ? error.message : "Unknown Telegram send error";
    }

    return NextResponse.json({
      ok: true,
      chatId,
      linked: true,
      userId: telegramLink.user_id,
      media: media.source,
      message: captureResult.reply,
      telegramMessageSent: mediaSendError === null,
      telegramSendError: mediaSendError,
    });
  }

  if (!text) {
    return NextResponse.json({ ok: true, chatId, skipped: "Empty message." });
  }

  // H1: the update_id reservation was claimed before processing. If the text
  // pipeline throws (transient model/DB failure) BEFORE a known outcome, release
  // the reservation and 5xx so Telegram retries — the update is never silently
  // consumed. The retry is safe: every movement this turn carries a deterministic
  // dedupe key (operation namespace = the stable update_id), so re-processing
  // cannot double-write. A successful write followed only by a reply-send failure
  // still 200s (no re-process, no double write); the confirmation is the only
  // thing lost.
  const releaseTextReservation = async () => {
    if (update.update_id === undefined) return;
    await supabase
      .from("telegram_processed_updates")
      .delete()
      .eq("update_id", update.update_id);
  };

  let result;
  try {
    result = await handleChatTransactionMessage({
      userId: telegramLink.user_id,
      message: text,
      channel: "telegram",
      chatId,
      requestId: update.update_id !== undefined ? String(update.update_id) : undefined,
    });
  } catch {
    await releaseTextReservation();
    return NextResponse.json(
      { ok: false, chatId, retry: true, error: "text pipeline transient" },
      { status: 503 },
    );
  }

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
    // The FINANCIAL operation is already durable (committed to the ledger) and
    // the assistant reply is persisted to chat_messages; only the Telegram
    // confirmation failed to deliver. We return 200 so the update is NOT
    // reprocessed (no financial rewrite). Observe the delivery failure without
    // logging message content.
    console.warn(
      `[telegram] reply delivery failed (financial outcome preserved) update_id=${update.update_id} chat=${chatId}: ${telegramSendError}`,
    );
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
