// Download a Telegram file (photo / voice note / document) via the Bot API.
// Size is checked BEFORE downloading (from the update metadata) and after, so
// oversized files never reach extraction. Server-only (uses the bot token).

import { MAX_EVIDENCE_BYTES } from "@/lib/capture/capture-matching";

export interface TelegramFileDownload {
  ok: boolean;
  bytes?: Uint8Array;
  reason?: string;
}

const META_TIMEOUT_MS = 8_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadTelegramFile(
  fileId: string,
  declaredSize?: number,
): Promise<TelegramFileDownload> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return { ok: false, reason: "bot no configurado" };
  if (declaredSize && declaredSize > MAX_EVIDENCE_BYTES) {
    return { ok: false, reason: "archivo demasiado grande (máx. 12MB)" };
  }

  try {
    const metaRes = await fetchWithTimeout(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
      META_TIMEOUT_MS,
    );
    const meta = (await metaRes.json()) as {
      ok?: boolean;
      result?: { file_path?: string; file_size?: number };
    };
    const filePath = meta.result?.file_path;
    if (!meta.ok || !filePath) return { ok: false, reason: "no pude obtener el archivo" };
    if ((meta.result?.file_size ?? 0) > MAX_EVIDENCE_BYTES) {
      return { ok: false, reason: "archivo demasiado grande (máx. 12MB)" };
    }

    const fileRes = await fetchWithTimeout(
      `https://api.telegram.org/file/bot${botToken}/${filePath}`,
      DOWNLOAD_TIMEOUT_MS,
    );
    if (!fileRes.ok) return { ok: false, reason: "descarga fallida" };
    const buffer = await fileRes.arrayBuffer();
    if (buffer.byteLength > MAX_EVIDENCE_BYTES) {
      return { ok: false, reason: "archivo demasiado grande (máx. 12MB)" };
    }
    return { ok: true, bytes: new Uint8Array(buffer) };
  } catch {
    return { ok: false, reason: "descarga fallida" };
  }
}
