export type ChatReviewRow = {
  id: string;
  role: string;
  channel: string | null;
  content: string;
  message_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type ChatReviewRead =
  | { ok: true; complete: true; rows: ChatReviewRow[] }
  | { ok: true; complete: false; partial: ChatReviewRow[] }
  | { ok: false; complete: false; detail: string };

export interface ChatReviewReader {
  page(
    cursor: { createdAt: string; id: string } | null,
    limit: number,
  ): Promise<{ rows: ChatReviewRow[] | null; error: string | null }>;
  count(): Promise<{ count: number | null; error: string | null }>;
}

export const REVIEW_PAGE = 400;
export const REVIEW_MAX_PAGES = 20;

// El review no puede anunciar “X/X turnos” sobre un `.limit(400)` silencioso.
// Cursor total + dedupe + count para multi-página: si no podemos probar el
// final, mostramos lo recuperado como PARCIAL y nunca como cobertura total.
export async function readCompleteChatReviewWith(
  reader: ChatReviewReader,
  pageSize = REVIEW_PAGE,
  maxPages = REVIEW_MAX_PAGES,
): Promise<ChatReviewRead> {
  const byId = new Map<string, ChatReviewRow>();
  let cursor: { createdAt: string; id: string } | null = null;
  let reachedEnd = false;
  let pages = 0;
  try {
    while (pages < maxPages) {
      const page = await reader.page(cursor, pageSize);
      if (page.error || page.rows === null) {
        return { ok: false, complete: false, detail: page.error ?? "lectura incompleta" };
      }
      pages += 1;
      for (const row of page.rows) byId.set(row.id, row);
      if (page.rows.length < pageSize) {
        reachedEnd = true;
        break;
      }
      const last = page.rows[page.rows.length - 1];
      if (!last?.id || !last.created_at) {
        return { ok: false, complete: false, detail: "cursor inválido" };
      }
      const next = { createdAt: last.created_at, id: last.id };
      if (cursor && cursor.createdAt === next.createdAt && cursor.id === next.id) {
        return { ok: true, complete: false, partial: [...byId.values()] };
      }
      cursor = next;
    }
    const rows = [...byId.values()];
    if (!reachedEnd) return { ok: true, complete: false, partial: rows };
    if (pages <= 1) return { ok: true, complete: true, rows };
    const total = await reader.count();
    if (total.error || total.count === null) {
      return { ok: false, complete: false, detail: total.error ?? "conteo no disponible" };
    }
    return total.count === byId.size
      ? { ok: true, complete: true, rows }
      : { ok: true, complete: false, partial: rows };
  } catch (error) {
    return {
      ok: false,
      complete: false,
      detail: error instanceof Error ? error.message : "lectura fallida",
    };
  }
}
