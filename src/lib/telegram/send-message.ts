export interface SendTelegramMessageInput {
  chatId: string;
  text: string;
}

/** Telegram receives only the small formatting surface Kipu already authors.
 * Escape HTML first, then translate balanced Markdown emphasis/code markers.
 * No webhook identity, delivery or dedupe behavior lives here. */
export function telegramHtmlFromMarkdown(text: string): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return escaped
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

export async function sendTelegramMessage({
  chatId,
  text,
}: SendTelegramMessageInput): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: telegramHtmlFromMarkdown(text),
      parse_mode: "HTML",
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Telegram sendMessage failed: ${errorBody}`);
  }
}
