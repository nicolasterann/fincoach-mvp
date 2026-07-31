import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getRecentChatMessages } from "@/lib/chat-memory/chat-messages";
import { sendTelegramMessage } from "@/lib/telegram/send-message";
import { generateAmbientMessage } from "@/lib/ambient/ambient-message";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { classifyForIntel, toIntelTxn } from "@/lib/financial/spending-intelligence";
import { loadMerchantMemory } from "@/lib/financial/merchant-memory-store";
import { makeDayKey, DEFAULT_USER_TZ } from "@/lib/financial/margen-kipu";
import { computeObjectiveMonthClose, isObjectiveCategory, type ObjectiveFeedTxn } from "@/lib/financial/objectives";
import { moneyReadPublishable } from "@/lib/financial/money-read";
import { publishObjectiveMonthCloseReliably, readHasMonthClose } from "@/lib/financial/objective-closes-store";
import { loadObjectiveVersions, versionsToBase, type ObjectiveVersionsRead } from "@/lib/financial/objective-versions-store";
import { readFxRates } from "@/lib/fx/fx-store";
import { formatKipuMoney } from "@/lib/financial/money";
import {
  claimAmbientNudge,
  failAmbientClaimBeforeDelivery,
  PROACTIVE_TOTAL_CAP,
} from "@/lib/ambient/ambient-store";
import {
  advanceObjectiveCloseCursor,
  pendingObjectiveCloseMonth,
  readObjectiveCloseCursor,
} from "@/lib/scheduled/objective-close-cursor";

// Stage H — the monthly OBJECTIVE CLOSE (nightly cron, durable month cursor).
// For every user with food/transport objectives whose next pending user-tz month
// has no close record yet: compute the honest close from the ledger (objective
// X, cerraste en Y — overflow INCLUDED; extraordinary reported SEPARATELY and
// never pushing the objective up), deliver ONE AI-written report (web chat +
// Telegram — the recurring-notifier pattern, never a canned template), then
// persist the close rows (the idempotency gate). The surplus DEFAULT is
// Reservas — a NO-WRITE: the unspent money stays in the accounts and the
// computed Reserva absorbs it; the user can redirect by replying (the agent
// records it via resolve_objective_close and executes any real movement
// through the existing typed tools). The objective itself is a DECISION:
// Kipu reports and asks — it NEVER auto-adjusts the number.

interface CloseRunResult {
  /** false = la corrida entera no es confiable (el descubrimiento de usuarios
   *  falló o no pudo probarse completo): el route debe responder 500 para que
   *  Vercel lo vea, no un 200 con cara de éxito. */
  ok: boolean;
  usersScanned: number;
  closed: number;
  skipped: number;
  errors: number;
}

// ————————————————————————————————————————————————————————————————————————
// Lectura paginada COMPLETA con lectura inyectada — el patrón readMoneyTxnFeed
// (coaching-signals) aplicado al cierre mensual, que es todavía menos perdonable:
// el close es PERMANENTE (hasMonthClose da el mes por cerrado para siempre), así
// que un feed truncado no produce un número malo un día — lo congela.
//
// Reglas idénticas al original: paginación por CURSOR sobre un orden TOTAL (el
// reader recibe la última fila cruda y construye el seek; offsets se corren con
// cualquier escritura concurrente), dedupe por `id`, una página corta prueba el
// final, UNA sola página es un statement = un snapshot (atómica, no necesita
// prueba), y multi-página se verifica contra el conteo exacto del lado del
// servidor: si no cuadra, no podemos PROBAR que tenemos el set entero ⇒ no
// publicable. El tope de página queda muy por debajo del cap silencioso de
// PostgREST (~1000): una query sin .limit() explícito también trunca en silencio.
// ————————————————————————————————————————————————————————————————————————
export type CloseFeedPage = { rows: unknown[] | null; failed: boolean };
export type CloseFeedReader = {
  /** `cursorRow` = la última fila cruda de la página anterior (null = primera).
   *  El reader arma el seek estricto en SU orden total; toda fila debe traer `id`. */
  page: (cursorRow: Record<string, unknown> | null, limit: number) => Promise<CloseFeedPage>;
  /** Cuántas filas tiene la ventana AHORA MISMO — la prueba de que el set armado
   *  a través de páginas es el que existe de verdad. */
  count: () => Promise<{ count: number | null; failed: boolean }>;
};
export type CloseFeedRead =
  | { ok: true; complete: true; rows: unknown[] }
  | { ok: true; complete: false; partial: unknown[] }
  | { ok: false; complete: false };

export const CLOSE_FEED_PAGE = 400; // < 1000: nunca depender del cap del servidor
const CLOSE_FEED_MAX_PAGES = 20; // 8000 filas de cota sanitaria, no de truncación

export async function readCompleteSet(
  reader: CloseFeedReader,
  pageSize: number = CLOSE_FEED_PAGE,
  maxPages: number = CLOSE_FEED_MAX_PAGES,
): Promise<CloseFeedRead> {
  const unavailable: CloseFeedRead = { ok: false, complete: false };
  // Por id: una edición concurrente que mueva una fila a través del cursor nos la
  // entregaría dos veces, y contarla dos veces infla el gasto del cierre.
  const byId = new Map<string, unknown>();
  try {
    let cursorRow: Record<string, unknown> | null = null;
    let pages = 0;
    let reachedEnd = false;
    while (pages < maxPages) {
      const page = await reader.page(cursorRow, pageSize);
      // Una página fallida NO es "ahí terminaba el mes": reportar indisponible en
      // vez de las filas parciales — el caller reintenta mañana, nunca cierra corto.
      if (page.failed) return unavailable;
      const got = (page.rows ?? []) as Record<string, unknown>[];
      pages += 1;
      for (const r of got) byId.set(String(r.id), r);
      if (got.length < pageSize) {
        reachedEnd = true;
        break;
      }
      cursorRow = got[got.length - 1];
    }
    const rows = () => [...byId.values()];
    // Cayó en el tope con todas las páginas llenas: nada falló, pero es
    // indistinguible de un feed que sigue. Declarar esto completo es EL bug.
    if (!reachedEnd) return { ok: true, complete: false, partial: rows() };
    // Una página = un statement = un snapshot: atómica, sin ventana para que el
    // ledger se mueva debajo. (También el camino de casi todos los usuarios.)
    if (pages === 1) return { ok: true, complete: true, rows: rows() };
    // Multi-página: el ledger PUDO moverse entre páginas. El dedupe atrapó
    // dobles lecturas; nada local detecta una fila que se deslizó del lado no
    // leído al leído. Exigir que el conteo del servidor cuadre exacto: un
    // desajuste cuesta un reintento, nunca un cierre subestimado.
    const total = await reader.count();
    if (total.failed || total.count === null) return unavailable;
    if (total.count !== byId.size) return { ok: true, complete: false, partial: rows() };
    return { ok: true, complete: true, rows: rows() };
  } catch {
    return unavailable;
  }
}

type CloseTimezoneRead =
  | { ok: true; timezone: string }
  | { ok: false };

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

async function readCloseTimezone(userId: string): Promise<CloseTimezoneRead> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from("user_engagement")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { ok: false };
    const timezone = data?.timezone ? String(data.timezone) : DEFAULT_USER_TZ;
    return validTimezone(timezone)
      ? { ok: true, timezone }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

// The closed month's classified feed: month-bounded query (±2d padding so the
// user-tz day mapping never clips a boundary txn), reversal-netted exactly like
// the engine's pattern loader, classified with merchant memory.
async function loadMonthFeed(userId: string, monthISO: string, tz: string): Promise<ObjectiveFeedTxn[]> {
  const [y, m] = monthISO.split("-").map(Number);
  const fromISO = new Date(Date.UTC(y, m - 1, 1) - 2 * 86_400_000).toISOString();
  const toISO = new Date(Date.UTC(y, m, 1) + 2 * 86_400_000).toISOString();
  // Antes: un solo query con .limit(2000) tratando la página como completa — un
  // mes con más movimientos cerraba con gasto SUBESTIMADO, y el close es
  // permanente. Ahora la lectura pagina por cursor y tiene que PROBAR
  // completitud; si no puede, se lanza y el caller reintenta la noche siguiente.
  const read = await readCompleteSet({
    page: async (cursorRow, limit) => {
      try {
        const sb = createSupabaseAdminClient();
        let q = sb
          .from("transactions")
          .select("id, occurred_at, base_amount, type, category, description, related_transaction_id, recurring_expense_id, external_ref, budget_treatment")
          .eq("user_id", userId)
          .gte("occurred_at", fromISO)
          .lt("occurred_at", toISO);
        if (cursorRow) {
          // Seek estricto pasado la última fila en el orden total (occurred_at, id)
          // DESC — occurred_at solo no es único y los empates no tienen orden.
          q = q.or(
            `occurred_at.lt."${String(cursorRow.occurred_at)}",and(occurred_at.eq."${String(cursorRow.occurred_at)}",id.lt.${String(cursorRow.id)})`,
          );
        }
        // PostgREST reporta un query fallido como { data: null, error } SIN lanzar:
        // ambas formas de fallo colapsan en un solo flag.
        const { data, error } = await q
          .order("occurred_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit);
        return { rows: data ?? null, failed: !!error };
      } catch {
        return { rows: null, failed: true };
      }
    },
    count: async () => {
      try {
        const sb = createSupabaseAdminClient();
        const { count, error } = await sb
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("occurred_at", fromISO)
          .lt("occurred_at", toISO);
        return { count: count ?? null, failed: !!error };
      } catch {
        return { count: null, failed: true };
      }
    },
  });
  // Nunca construir un cierre desde un feed que falló o no probó estar entero:
  // reportaría "cerraste en X" con X corto y lo congelaría para siempre. Lanzar
  // para que el try/catch del caller lo cuente como error y reintente mañana.
  if (!moneyReadPublishable(read)) {
    throw new Error(`objective-close feed not provably complete (ok=${read.ok} complete=${read.complete})`);
  }
  const rows = (read.rows as { id: string; occurred_at: string; base_amount: number | string; type: string; category?: string | null; description?: string | null; related_transaction_id?: string | null; recurring_expense_id?: string | null; external_ref?: string | null; budget_treatment?: string | null }[])
    // La lectura llega en DESC (orden del cursor); el resto del pipeline siempre
    // trabajó en ASC — restaurarlo con el mismo orden total, determinista.
    .slice()
    .sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const reversedIds = new Set<string>();
  for (const r of rows) {
    if (String(r.type) === "reversal" && r.related_transaction_id) reversedIds.add(String(r.related_transaction_id));
  }
  const kept = rows.filter((r) => String(r.type) !== "reversal" && !reversedIds.has(String(r.id)));
  const merchantMemory = await loadMerchantMemory(userId).catch(() => []);
  const classified = classifyForIntel(
    kept.map((r) =>
      toIntelTxn({
        occurredAtMs: new Date(r.occurred_at).getTime(),
        baseAmount: typeof r.base_amount === "number" ? r.base_amount : Number(r.base_amount),
        type: String(r.type),
        category: r.category ? String(r.category) : undefined,
        description: r.description ? String(r.description) : undefined,
        externalRef: r.external_ref ? String(r.external_ref) : null,
      }),
    ),
    merchantMemory,
  );
  const dayKey = makeDayKey(tz);
  return classified.map((c, i) => {
    const src = kept[i];
    return {
      dateISO: dayKey(new Date(src.occurred_at)),
      category: c.category,
      baseAmount: c.spendingType === "refund" ? (typeof src.base_amount === "number" ? src.base_amount : Number(src.base_amount)) : c.baseAmount,
      spendingType: c.spendingType,
      isSpend: c.isSpend,
      recurringExpenseId: src.recurring_expense_id ? String(src.recurring_expense_id) : null,
      externalRef: src.external_ref ? String(src.external_ref) : null,
      budgetTreatment: src.budget_treatment ? String(src.budget_treatment) : null,
    };
  });
}

async function loadVoice(userId: string): Promise<{ firstName: string | null; tone: string | null }> {
  try {
    const sb = createSupabaseAdminClient();
    const [prof, coach] = await Promise.all([
      sb.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      sb.from("coach_preferences").select("tone").eq("user_id", userId).maybeSingle(),
    ]);
    const full = prof.data?.full_name ? String(prof.data.full_name) : null;
    return { firstName: full ? full.split(" ")[0] : null, tone: coach.data?.tone ? String(coach.data.tone) : null };
  } catch {
    return { firstName: null, tone: null };
  }
}

async function loadTelegramChatId(userId: string): Promise<string | null> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb.from("telegram_user_links").select("telegram_chat_id").eq("user_id", userId).maybeSingle();
    const id = data?.telegram_chat_id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

export async function runObjectiveMonthCloses(now: Date = new Date()): Promise<CloseRunResult> {
  const out: CloseRunResult = { ok: true, usersScanned: 0, closed: 0, skipped: 0, errors: 0 };
  // El descubrimiento ignoraba su `error` (un fallo = lista vacía = "no hay nadie
  // que cerrar" con cara de éxito) y no tenía .limit() explícito, o sea heredaba
  // el cap silencioso del servidor (~1000 filas). Misma doctrina que el feed:
  // cursor sobre `id` (único ⇒ orden total) + prueba de completitud; si no se
  // puede probar la lista de usuarios, la corrida entera reporta ok:false.
  const discovery = await readCompleteSet({
    page: async (cursorRow, limit) => {
      try {
        const sb = createSupabaseAdminClient();
        let q = sb
          .from("budget_categories")
          .select("id, user_id, category")
          .eq("is_active", true)
          .in("category", ["food", "transport"]);
        if (cursorRow) q = q.gt("id", String(cursorRow.id));
        const { data, error } = await q.order("id", { ascending: true }).limit(limit);
        return { rows: data ?? null, failed: !!error };
      } catch {
        return { rows: null, failed: true };
      }
    },
    count: async () => {
      try {
        const sb = createSupabaseAdminClient();
        const { count, error } = await sb
          .from("budget_categories")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .in("category", ["food", "transport"]);
        return { count: count ?? null, failed: !!error };
      } catch {
        return { count: null, failed: true };
      }
    },
  });
  if (!moneyReadPublishable(discovery)) {
    return { ...out, ok: false, errors: out.errors + 1 };
  }
  const userIds = Array.from(new Set((discovery.rows as { user_id: unknown }[]).map((r) => String(r.user_id))));

  for (const userId of userIds) {
    out.usersScanned += 1;
    try {
      const timezoneRead = await readCloseTimezone(userId);
      if (!timezoneRead.ok) {
        // A failed timezone read can close the wrong calendar month permanently.
        out.errors += 1;
        continue;
      }
      const tz = timezoneRead.timezone;
      const localToday = makeDayKey(tz)(now);
      const cursorRead = await readObjectiveCloseCursor(userId);
      if (!cursorRead.ok) {
        out.errors += 1;
        continue;
      }
      const closedMonth = pendingObjectiveCloseMonth(
        localToday,
        cursorRead.lastEvaluatedMonth,
      );
      if (!closedMonth) {
        out.skipped += 1;
        continue;
      }
      const closeGate = await readHasMonthClose(userId, closedMonth);
      if (!closeGate.ok) {
        // Fail closed for publication, but never disguise an unreadable
        // permanent idempotency gate as an ordinary "already closed" skip.
        out.errors += 1;
        continue;
      }
      if (closeGate.exists) {
        if (await advanceObjectiveCloseCursor(userId, closedMonth)) out.skipped += 1;
        else out.errors += 1;
        continue;
      }
      const ctx = await buildUserFinancialContext(userId);
      const objectives = ctx.budgetCategories
        .filter((c) => c.isActive && isObjectiveCategory(c.category) && c.amount > 0)
        .map((c) => ({ category: c.category, amountBase: c.amount, mtdSeed: c.mtdSeed, seedMonth: c.seedMonth, isActive: c.isActive }));
      if (objectives.length === 0) {
        if (await advanceObjectiveCloseCursor(userId, closedMonth)) out.skipped += 1;
        else out.errors += 1;
        continue;
      }
      const feed = await loadMonthFeed(userId, closedMonth, tz);
      // Stage H (P1-1) — report the closed month against the objective that was
      // IN EFFECT then, not whatever the user's objective is today (they may have
      // changed it on the 1st, before this close ran).
      // The close is PERMANENT (it persists objective_base): never write one
      // from an unreadable history — it could report the month against today's
      // objective and freeze that lie forever. Retry next night instead.
      const versionsRead = await loadObjectiveVersions(userId).catch(
        (): ObjectiveVersionsRead => ({ ok: false, complete: false }),
      );
      // Publicable, no solo ok (punto 9): un scan de versiones TOPADO perdió la más
      // antigua — el ancla de todo mes pre-historia — y el cierre es permanente.
      if (!moneyReadPublishable(versionsRead)) {
        out.errors += 1;
        continue;
      }
      // Sin tasas, un objetivo en moneda extranjera no se puede valuar y el cierre
      // reportaría un mes comparado contra un objetivo que no supo leer. El close es
      // PERMANENTE (hasMonthClose lo da por cerrado para siempre), así que se salta
      // y se reintenta mañana en vez de escribir un reporte equivocado.
      const fxRead = await readFxRates(userId);
      if (!moneyReadPublishable(fxRead)) {
        out.errors += 1;
        continue;
      }
      const versions = versionsToBase(versionsRead.rows, ctx.profile.baseCurrency, fxRead.rates);
      const computed = computeObjectiveMonthClose({ objectives, txns: feed, monthISO: closedMonth, currentMonthISO: localToday.slice(0, 7), versions });
      // ALL or NONE: a close is permanent and hasMonthClose treats a single row as
      // "month closed", so persisting food while transport stayed unresolved would
      // bury transport forever. Retry the whole month next night instead.
      if (computed.unresolved.length > 0) {
        out.errors += 1;
        continue;
      }
      const closes = computed.closes.filter(
        // Nothing to report for a category with zero activity that month — this
        // is what prevents a day-1-3 onboarder (whose objective didn't exist last
        // month) from getting a fabricated "objetivo 300, cerraste en 0" close.
        (c) => c.spentBase > 0 || c.extraordinaryBase > 0,
      );
      if (closes.length === 0) {
        if (await advanceObjectiveCloseCursor(userId, closedMonth)) out.skipped += 1;
        else out.errors += 1;
        continue;
      }

      const base = ctx.profile.baseCurrency;
      const fmt = (n: number) => formatKipuMoney(n, base);
      const totalSurplus = closes.reduce((t, c) => t + c.surplusBase, 0);
      // ONE comparison per objective — nothing else. The user's mental model is
      // "objetivo vs lo que gasté"; the machinery (exceso drenado, extraordinarios,
      // capas) is DETAIL, available only if they ask. A close that recites every
      // concept at once is exactly the complexity this doctrine exists to avoid.
      const lines = closes.map((c) => `${c.labelEs}: te pusiste ${fmt(c.objectiveBase)} y cerraste en ${fmt(c.spentBase)}`);
      // ONE question, and only when there is something to decide.
      const ask =
        totalSurplus > 0
          ? ` Le sobraron ${fmt(totalSurplus)}: van a su Reserva salvo que prefiera otra cosa. Pregúntaselo en UNA línea, suave, sin presión.`
          : ` No hay nada que decidir: solo cierra el mes en buena onda y, si quiere, que te diga si mantiene su objetivo.`;
      const detail = closes
        .map((c) => {
          const bits: string[] = [];
          if (c.excessBase > 0) bits.push(`se pasó ${fmt(c.excessBase)}${c.excessDrainedBase > 0 ? ` (${fmt(c.excessDrainedBase)} ya habían salido de su Saldo en su momento, no es un cobro nuevo)` : ""}`);
          if (c.extraordinaryBase > 0) bits.push(`${fmt(c.extraordinaryBase)} extraordinarios aparte que no entran en esta comparación`);
          return bits.length ? `${c.labelEs}: ${bits.join("; ")}` : "";
        })
        .filter(Boolean)
        .join(" · ");
      const facts = `Cierre de mes de sus objetivos (REPORTE, cero culpa, tono de cerrar un capítulo). DI SOLO ESTO, corto y humano: ${lines.join(" · ")}.${ask}
NO recites mecánica (nada de "exceso drenado", "capas", "acumulador") — el usuario entiende Saldo y objetivo, el resto pasa solo. Nunca le sugieras subir el objetivo: es SU decisión y mantenerlo también es válido.
DETALLE (solo si él pregunta "¿por qué?" o pide números): ${detail || "sin detalles extra"}.`;

      // J-7 (barrido 2). Este era el TERCER emisor proactivo y el único que no
      // reclamaba asiento: J-4 declaró un techo de 2/día COMPARTIDO y el cierre
      // mensual lo esquivaba, así que al cerrar el mes el usuario podía recibir coach
      // + digest + cierre en la misma noche. Corre en el MISMO cron que el digest
      // (21:00 BA), de modo que sin claim el tope no era un tope. Toma carril
      // `coach` — es un reporte de coaching, escrito por generateAmbientMessage —
      // con el tope total compartido; si el día ya está lleno, el cursor durable
      // deja ese mes pendiente y reintenta mañana en vez de romper el techo.
      const claim = await claimAmbientNudge({
        userId,
        topic: "objective_month_close",
        dayBucket: localToday,
        reason: `cierre de objetivos ${closedMonth}`,
        priority: 2,
        channel: "web",
        budgetLane: "coach",
        laneCap: PROACTIVE_TOTAL_CAP,
        totalCap: PROACTIVE_TOTAL_CAP,
        // The publication RPC v2 binds the permanent close to the month this
        // seat was claimed for. A valid claim can no longer publish an
        // arbitrary historical/future month because of a caller bug.
        payload: { objectiveCloseMonth: closedMonth },
      });
      if (!claim.ok) {
        // "No obtuve asiento" is retry-worthy infrastructure, not evidence
        // that the shared daily cap was legitimately full.
        out.errors += 1;
        continue;
      }
      if (claim.outcome !== "claimed") {
        // Techo lleno, ya intentado hoy o en curso: NO avanzar el cursor, para que
        // el mes pendiente se vuelva a intentar. No es un error.
        out.skipped += 1;
        continue;
      }
      // Un fallo ANTES de entregar libera el asiento explícitamente (mismo contrato
      // que el digest): quemar el intento del día por una copia que nunca salió
      // dejaría el reporte del mes sin mandar.
      const releaseSeat = async (reason: string): Promise<boolean> =>
        failAmbientClaimBeforeDelivery({
          id: claim.id,
          userId,
          token: claim.token,
          reason,
        }).catch(() => false);

      const [voice, chatId, recent] = await Promise.all([
        loadVoice(userId),
        loadTelegramChatId(userId),
        getRecentChatMessages({ userId, channel: "web", limit: 6, windowMinutes: 60 * 24 * 3 }).catch(() => []),
      ]);
      const text = await generateAmbientMessage({
        topic: "objective_month_close",
        facts,
        firstName: voice.firstName,
        tone: voice.tone,
        recentMessages: recent.map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content })),
      });
      if (!text) {
        // No clean AI copy → send nothing, don't advance: the durable cursor retries.
        const released = await releaseSeat("objective_close: sin copia");
        // A failed release is infrastructure work left in-flight, not a benign
        // skip. Reporting it as green hid a burned proactive seat and made the
        // monitor claim the monthly-close run completed cleanly.
        if (released) out.skipped += 1;
        else out.errors += 1;
        continue;
      }
      // Mensaje web + filas permanentes + claim finalizado aterrizan juntos.
      // Reintentamos UNA vez con la misma identidad: si la primera transacción
      // commiteó pero se perdió la respuesta, la RPC devuelve `replayed` sin
      // duplicar ni el mensaje ni el cierre.
      const publication = await publishObjectiveMonthCloseReliably({
        userId,
        claimId: claim.id,
        claimToken: claim.token,
        month: closedMonth,
        content: text,
        closes,
      });
      if (!publication.ok) {
        // No liberamos una escritura ambigua: si el commit sí aterrizó, liberar
        // permitiría otra publicación. Una caída probada antes de la RPC ya fue
        // cubierta arriba con releaseSeat.
        out.errors += 1;
        continue;
      }
      if (chatId) {
        try {
          await sendTelegramMessage({ chatId, text });
        } catch {
          /* Telegram push is best-effort; the web chat already has it */
        }
      }
      if (await advanceObjectiveCloseCursor(userId, closedMonth)) out.closed += 1;
      else out.errors += 1;
    } catch {
      out.errors += 1;
    }
  }
  return out;
}
