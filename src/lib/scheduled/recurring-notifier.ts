import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  appendChatMessage,
  getRecentChatMessages,
  removeChatMessage,
} from "@/lib/chat-memory/chat-messages";
import { sendTelegramMessage } from "@/lib/telegram/send-message";
import { generateAmbientMessage } from "@/lib/ambient/ambient-message";
import {
  readOpenOccurrences,
  type RecurringOccurrence,
} from "@/lib/financial/recurring-occurrences-store";
import {
  readOccurrenceNames,
} from "@/lib/financial/recurring-resolve";
import { pageDiscoveryUserIds } from "@/lib/scheduled/recurring-materializer";
import { planDigest, type DigestItem, type DigestPlan } from "@/lib/scheduled/digest-plan";
import {
  claimAmbientNudge,
  failAmbientClaimBeforeDelivery,
  PROACTIVE_TOTAL_CAP,
  publishCalendarDigest,
  recordAmbientOutcome,
  type CalendarDigestClaimPayload,
  type CalendarDigestPublishResult,
  type ProactiveClaimResult,
} from "@/lib/ambient/ambient-store";

// Bloque C — deliver the recurring-flow notifications the materializer queued:
//   - AUTO-booked (status 'booked', notified=false) → a ONE-TIME correctable confirmation
//     ("registré tu sueldo, ¿todo bien?").
//   - ASK (status 'pending'|'observed') → a PERSISTENT question ("¿cuánto vino la luz?" /
//     "¿ya pagaste la factura que anotamos?" /
//     sueldo?"), re-asked with the 0/+3/+7 backoff, honoring snooze_until and skipping
//     dismissed ones. After the 3rd ask it stops nagging but stays visibly "sin confirmar".
// The message is ALWAYS AI-generated (never a hardcoded template): deterministic code builds
// the FACTS (what was booked / what to ask, the amount, the label) and the model turns them
// into ONE natural, guilt-free line — the same "structured facts → AI copy" path the ambient
// loop uses. If the model can't produce a clean line, we send NOTHING this pass and DON'T burn
// state (notified stays false / the ask isn't counted), so the next run retries; we never fall
// back to canned copy. Web message + occurrence transitions are one DB transaction; Telegram
// is a secondary copy with explicit provenance. Timezone is the user's local day.

const DEFAULT_TZ = "America/Guayaquil";
function localDay(now: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = get("year");
    const m = get("month");
    const d = get("day");
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fall through */
  }
  return now.toISOString().slice(0, 10);
}

// LatAm number format: thousands with ".", decimals with "," and only shown when non-zero.
function fmt(amount: number | null, currency: string | null): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  const [int, dec] = amount.toFixed(hasCents ? 2 : 0).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const num = dec ? `${grouped},${dec}` : grouped;
  const cur = (currency ?? "").toUpperCase();
  if (!cur || cur === "USD") return `${num}$`;
  return `${num} ${cur}`;
}

// Deterministic FACTS for an AUTO-booked occurrence the model turns into a natural confirmation.
// Never sent verbatim — it's the truth + what to offer, phrased by the AI.
function autoFacts(o: RecurringOccurrence, label: string): string {
  const amt = fmt(o.expectedAmount, o.currency);
  if (o.kind === "income") {
    return `Acabas de registrar automáticamente el ingreso recurrente "${label}" por ${amt}, con fecha de hoy. Confírmale de forma cálida que ya quedó registrado y pregúntale casualmente si el monto está bien; ofrécele avisarte si en realidad entró otro monto, si cambió para siempre, o si todavía no llegó.`;
  }
  if (o.kind === "debt_payment") {
    return `Acabas de registrar automáticamente la cuota de "${label}" por ${amt}, con fecha de hoy (bajó tu cuenta y tu deuda). Confírmale que quedó registrada y ofrécele corregir el monto o avisarte si este mes no la pagó.`;
  }
  return `Acabas de registrar automáticamente el gasto fijo recurrente "${label}" por ${amt}, con fecha de hoy. Confírmale que ya quedó registrado y ofrécele corregir el monto o avisarte si este mes fue distinto o si no lo pagó.`;
}

// Deterministic FACTS for an ASK (variable flow, or an auto flow that couldn't book) the model
// turns into a natural, single question. Never sent verbatim.
export function askFacts(o: RecurringOccurrence, label: string, today?: string): string {
  const amt = o.expectedAmount != null ? fmt(o.expectedAmount, o.currency) : null;
  // J-4 — el re-ask dejaba de ser cierto: repetía "hoy es el día de corte" el
  // segundo y el tercer intento. Cuando la fecha ya pasó, se dice como lo que es.
  const esHoy = !today || o.occurrenceDate === today;
  const cuando = esHoy ? "Hoy" : `El ${o.occurrenceDate} (sigue pendiente)`;
  if (o.kind === "income") {
    const hint = amt ? ` La última vez fueron ${amt}, pero suele variar.` : "";
    return `${cuando} ${esHoy ? "toca" : "tocaba"} el ingreso recurrente "${label}", pero el monto varía y no lo tienes aún.${hint} Pregúntale si ya le entró y cuánto, para registrarlo. Es válido que responda el monto exacto, "todavía no" si no llegó, o "te digo mañana".`;
  }
  if (o.kind === "card_statement") {
    // The CORTE ask on the cutoff day — capture the statement amount (no money moves yet).
    const hint = amt ? ` Suele venir alrededor de ${amt}.` : "";
    return `${cuando} ${esHoy ? "es" : "fue"} el día de corte de "${label}".${hint} Pregúntale si ya le llegó el estado de cuenta y de cuánto es el pago del mes, para dejarlo anotado. Es válido que responda el monto del corte, "todavía no llegó", o "te digo después". Explica en una frase normal que no mueve dinero todavía; solo permite saber cuánto tendrá que pagar el día de pago.`;
  }
  if (o.kind === "debt_payment") {
    // Cards + family/other debts: confirm the payment (and how much) on the due day.
    const hint = amt ? ` El corte/cuota pendiente es de ${amt}.` : "";
    return `${cuando} ${esHoy ? "es" : "fue"} el día de pago de "${label}".${hint} Pregúntale si ya la pagó y cuánto, para registrarlo (bajará su cuenta y su deuda). Es válido que responda el monto pagado, "todavía no", o "te digo mañana".`;
  }
  if (o.kind === "investment") {
    const hint = amt ? ` Tu meta de este mes es ${amt}.` : "";
    return `${cuando} ${esHoy ? "arranca el mes y toca" : "tocaba"} tu inversión ("${label}").${hint} Pregúntale, sin presión, si ya invirtió ese dinero este mes. Al confirmar puede que se mueva de su cuenta a su activo (si lo tiene configurado así), o simplemente quede anotado. Es válido que confirme, diga cuánto invirtió, "este mes no", o "te digo después".`;
  }
  if (o.kind === "savings") {
    const hint = amt ? ` Tu meta de este mes es ${amt}.` : "";
    return `${cuando} ${esHoy ? "arranca el mes y toca" : "tocaba"} tu ahorro ("${label}").${hint} Pregúntale, sin presión, si ya apartó ese dinero este mes. Es una reserva (no mueve el ledger): basta que confirme, diga cuánto apartó, "este mes no", o "te digo después".`;
  }
  if (o.kind === "expense" && o.status === "observed") {
    const observed = fmt(o.resolvedAmount, o.resolvedCurrency ?? o.currency);
    return `${cuando} ${esHoy ? "vence" : "vencía"} el gasto "${label}". La factura ya quedó anotada en ${observed}, pero NO consta como pagada. Pregúntale solo si ya la pagó y desde qué cuenta/tarjeta; no vuelvas a pedirle el monto ni registres caja hasta que lo confirme. Si responde que todavía no pagó, usa unpaid (conserva la factura); retract solo si dice que esa factura nunca existió o se anotó por error.`;
  }
  const hint = amt ? ` La última vez fueron ${amt}, pero puede cambiar.` : "";
  return `${cuando} ${esHoy ? "vence" : "vencía"} el gasto "${label}", y no tienes el monto exacto.${hint} Pregúntale cuánto le salió este mes y si ya lo pagó. Informar la factura NO mueve caja: solo registra el pago si lo confirma y dice desde qué cuenta/tarjeta. Es válido que responda el monto, "todavía no lo pagué", o "te digo mañana".`;
}

// The occurrence's source discriminator as a stable key (mirrors recurring-resolve.sourceKey).
function sourceKey(o: RecurringOccurrence): string {
  return (
    o.incomeSourceId ??
    o.fixedExpenseId ??
    o.debtAccountId ??
    o.savingsPlanId ??
    o.scheduledPaymentId ??
    (o.commitmentKind ? `commit:${o.commitmentKind}` : "")
  );
}

export type CardDueDaysRead =
  | { ok: true; dueDays: Map<string, number | null> }
  | { ok: false };

export function cardDueDaysFromRows(
  debtIds: string[],
  read: {
    data: Record<string, unknown>[] | null;
    error: { message?: string } | null;
  },
): CardDueDaysRead {
  if (read.error || !read.data) return { ok: false };
  const wanted = new Set(debtIds);
  const dueDays = new Map<string, number | null>();
  for (const row of read.data) {
    const id = typeof row.id === "string" ? row.id : "";
    if (!wanted.has(id)) continue;
    const raw = row.due_day;
    if (raw == null) {
      dueDays.set(id, null);
      continue;
    }
    const day = Number(raw);
    if (!Number.isInteger(day) || day < 1 || day > 31) return { ok: false };
    dueDays.set(id, day);
  }
  return debtIds.every((id) => dueDays.has(id))
    ? { ok: true, dueDays }
    : { ok: false };
}

export async function readCardDueDaysForOccurrences(
  userId: string,
  occurrences: RecurringOccurrence[],
): Promise<CardDueDaysRead> {
  const debtIds = [
    ...new Set(
      occurrences
        .filter((o) => o.kind === "card_statement")
        .map((o) => o.debtAccountId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (debtIds.length === 0) return { ok: true, dueDays: new Map() };
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from("debt_accounts")
      .select("id, due_day")
      .eq("user_id", userId)
      .in("id", debtIds);
    return cardDueDaysFromRows(
      debtIds,
      {
        data: data as Record<string, unknown>[] | null,
        error,
      },
    );
  } catch {
    return { ok: false };
  }
}

async function telegramChatId(userId: string): Promise<string | null> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb
      .from("telegram_user_links")
      .select("telegram_chat_id")
      .eq("user_id", userId)
      .maybeSingle();
    const id = data?.telegram_chat_id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

interface UserVoice {
  firstName: string | null;
  tone: string | null;
}

// The user's name + coach tone, so the AI copy matches how Kipu talks to THEM (mirrors the
// ambient loop's voice sourcing). Best-effort: nulls just yield slightly more generic copy.
async function loadVoice(userId: string): Promise<UserVoice> {
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

// Turn deterministic FACTS into ONE natural line via the model, then deliver it (web chat +
// Telegram push if linked). Returns true only if a clean message was produced AND landed in the
// web chat; false if the model couldn't run (→ caller sends nothing this pass and retries next
// run, never a canned template). A failed Telegram push alone never fails the call — the web
// chat is the durable surface.
// J-4 — los FACTS de UN resumen, no de N mensajes. El orden ya viene decidido por
// `planDigest` (lo que mueve dinero hoy arriba). Dos instrucciones importan tanto
// como los datos: que sea UN mensaje corto, y que el usuario pueda contestar
// VARIOS puntos de una sola vez — si el resumen junta cinco preguntas y Kipu solo
// sabe procesar una respuesta, el resumen empeora las cosas en vez de arreglarlas.
function digestFacts(plan: DigestPlan, itemFacts: (i: DigestItem) => string): string {
  const line = (i: DigestItem) => `- ${itemFacts(i)}`;
  const bloques: string[] = [];
  if (plan.confirms.length > 0) {
    bloques.push(`YA REGISTRADO SOLO (confírmaselo, no lo preguntes de nuevo):\n${plan.confirms.map(line).join("\n")}`);
  }
  if (plan.asks.length > 0) {
    bloques.push(`NECESITAS SU RESPUESTA:\n${plan.asks.map(line).join("\n")}`);
  }
  if (plan.standing.length > 0) {
    bloques.push(
      `SIGUE PENDIENTE de días anteriores (menciónalo en UNA línea al final, sin volver a interrogar):\n${plan.standing
        .map((i) => `- ${i.label}: sigue pendiente el ${i.occurrenceDate}${i.amount != null ? ` (${fmt(i.amount, i.currency)})` : ""}`)
        .join("\n")}`,
    );
  }
  return [
    "Es el RESUMEN DIARIO: UN solo mensaje con todo lo del día, no varios. Agrúpalo, corto y humano, en el orden en que te lo doy (lo que mueve plata hoy va primero).",
    ...bloques,
    "Cierra invitándolo a contestar TODO junto en un solo mensaje si quiere (\"ya me entró el sueldo, la Diners son 554, de la otra todavía no sé\"). Si algo no lo sabe aún, decirlo también es una respuesta válida y no pasa nada.",
    "No inventes montos ni fechas que no estén acá. Nada de listas numeradas ni tablas: se lee como un mensaje de alguien que te conoce.",
  ].join("\n\n");
}

async function generateDigestMessage(
  userId: string,
  voice: UserVoice,
  facts: string,
): Promise<string | null> {
  const recent = await getRecentChatMessages({ userId, channel: "web", limit: 6, windowMinutes: 60 * 24 * 3 }).catch(() => []);
  return generateAmbientMessage({
    topic: "calendar_digest",
    facts,
    firstName: voice.firstName,
    tone: voice.tone,
    recentMessages: recent.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
  });
}

export interface CalendarDigestDeliveryDeps {
  claim: () => Promise<ProactiveClaimResult>;
  generate: () => Promise<string | null>;
  failBeforeDelivery: (claimId: string, claimToken: string, reason: string) => Promise<boolean>;
  publish: (
    claimId: string,
    claimToken: string,
    content: string,
  ) => Promise<CalendarDigestPublishResult>;
}

export type CalendarDigestDeliveryResult =
  | {
      ok: true;
      outcome: "published";
      claimId: string;
      claimToken: string;
      text: string;
      autoNotified: number;
      asked: number;
      replayed: boolean;
    }
  | {
      ok: true;
      outcome: "skipped";
      reason: "already_delivered" | "already_attempted" | "in_progress" | "cap_reached";
    }
  | { ok: false; reason: "claim_failed" | "generation_failed" | "release_failed" | "publish_failed" };

export async function deliverCalendarDigestWith(
  deps: CalendarDigestDeliveryDeps,
): Promise<CalendarDigestDeliveryResult> {
  const claim = await deps.claim();
  if (!claim.ok) return { ok: false, reason: "claim_failed" };
  if (claim.outcome !== "claimed") {
    return { ok: true, outcome: "skipped", reason: claim.outcome };
  }

  const text = await deps.generate();
  if (!text?.trim()) {
    const released = await deps.failBeforeDelivery(claim.id, claim.token, "ai_unavailable");
    return released
      ? { ok: false, reason: "generation_failed" }
      : { ok: false, reason: "release_failed" };
  }

  // The publication RPC is idempotent. A second call closes the
  // "commit landed but the response was lost" ambiguity without another message.
  let published = await deps.publish(claim.id, claim.token, text);
  if (!published.ok) {
    published = await deps.publish(claim.id, claim.token, text);
  }
  if (!published.ok) return { ok: false, reason: "publish_failed" };
  return {
    ok: true,
    outcome: "published",
    claimId: claim.id,
    claimToken: claim.token,
    text,
    autoNotified: published.autoNotified,
    asked: published.asked,
    replayed: published.replayed,
  };
}

async function deliverDigestTelegramCopy(input: {
  userId: string;
  chatId: string | null;
  claimId: string;
  claimToken: string;
  text: string;
}): Promise<{ infrastructureOk: boolean; pushed: boolean }> {
  if (!input.chatId) return { infrastructureOk: true, pushed: false };
  const telegramMessageId = await appendChatMessage({
    userId: input.userId,
    channel: "telegram",
    chatId: input.chatId,
    role: "assistant",
    content: input.text,
    messageType: "advisory",
    metadata: {
      source: "recurring",
      calendarDigestClaimId: input.claimId,
    },
  });
  if (!telegramMessageId) {
    const recorded = await recordAmbientOutcome({
      id: input.claimId,
      userId: input.userId,
      token: input.claimToken,
      delivered: true,
      telegramError: "telegram_provenance_unavailable",
      messagePreview: input.text,
    });
    return { infrastructureOk: recorded, pushed: false };
  }

  try {
    await sendTelegramMessage({ chatId: input.chatId, text: input.text });
    const recorded = await recordAmbientOutcome({
      id: input.claimId,
      userId: input.userId,
      token: input.claimToken,
      delivered: true,
      messagePreview: input.text,
    });
    return { infrastructureOk: recorded, pushed: true };
  } catch (error) {
    const removed = await removeChatMessage(input.userId, telegramMessageId);
    const recorded = await recordAmbientOutcome({
      id: input.claimId,
      userId: input.userId,
      token: input.claimToken,
      delivered: true,
      telegramError: error instanceof Error ? error.message : "telegram send failed",
      messagePreview: input.text,
    });
    return { infrastructureOk: removed && recorded, pushed: false };
  }
}

export interface NotifyResult {
  usersScanned: number;
  autoNotified: number;
  asked: number;
  skipped: number;
  /** Fallos de LECTURA del descubrimiento — un push de Telegram caído sigue siendo
   *  no-fatal por diseño, pero "no pude leer quién tiene pendientes" no es "nadie
   *  tiene pendientes" (re-auditoría 2, punto 10). */
  errors: number;
}

export async function deliverDueRecurringMessages(now: Date = new Date()): Promise<NotifyResult> {
  const out: NotifyResult = { usersScanned: 0, autoNotified: 0, asked: 0, skipped: 0, errors: 0 };
  const sb = createSupabaseAdminClient();
  // Distinct users with open occurrences. Re-auditoría 3 (punto 3): el CAP 5000+1
  // era una prueba imposible (max-rows ~1000 recorta antes de la fila 5001) — el
  // descubrimiento pagina por keyset con final PROBADO; fallo o tope ⇒ error (5xx).
  const disc = await pageDiscoveryUserIds([
    (a, l) => { let q = sb.from("recurring_occurrences").select("id, user_id").in("status", ["pending", "observed", "booked"]).is("satisfied_fact_id", null).order("id", { ascending: true }).limit(l); if (a) q = q.gt("id", a); return q; },
  ]);
  if (!disc.ok) out.errors += 1;
  const userIds = disc.ids;

  for (const userId of userIds) {
    out.usersScanned += 1;
    // Bloque M0: all domains share one fact↔occurrence identity. The discovery
    // and typed open read already exclude rows with satisfied_fact_id; there is
    // no card-specific repair call whose failure can diverge from another kind.
    // "No pude leerte" ≠ "no tenías nada" — y una lista TOPADA tampoco es "todos
    // tus pendientes": ambos cuentan error (el route lo vuelve 5xx) en vez de
    // saltarse la noche en silencio.
    const openRead = await readOpenOccurrences(userId);
    if (!openRead.ok || !openRead.complete) {
      out.errors += 1;
      continue;
    }
    const open = openRead.occurrences;
    if (open.length === 0) continue;
    // Zona PROBADA o el usuario se salta esta noche: enviar con Guayaquil por
    // accidente pregunta el día equivocado Y consume askCount/lastAskedOn.
    const tzRead = await readUserTimezone(userId);
    if (!tzRead.ok) {
      out.errors += 1;
      continue;
    }
    const today = localDay(now, tzRead.tz);
    // The digest consumes askCount and can make a financial question disappear
    // from the next run. Names and card due-days are therefore typed reads:
    // a partial/defaulted label is not evidence enough to advance state.
    const [namesRead, dueRead] = await Promise.all([
      readOccurrenceNames(userId, open),
      readCardDueDaysForOccurrences(userId, open),
    ]);
    if (!namesRead.ok || !dueRead.ok) {
      out.errors += 1;
      continue;
    }
    const labels = namesRead.names;
    const dueDays = dueRead.dueDays;
    // Defense in depth against a future divergence between the shared reader
    // and this join: never replace a missing financial identity with a generic
    // label (that would consume the ask while asking about the wrong thing).
    if (open.some((occurrence) => !labels.has(sourceKey(occurrence)))) {
      out.errors += 1;
      continue;
    }

    // J-4 — UNA decisión pura para todo el usuario: qué entra al resumen, en qué
    // orden, y qué se calla (dormido, fuera de ventana, o esperando su backoff).
    const plan = planDigest({
      occurrences: open,
      today,
      nowMs: now.getTime(),
      labelFor: (o) => labels.get(sourceKey(o)) as string,
      dueDayFor: (o) => (o.debtAccountId ? dueDays.get(o.debtAccountId) ?? null : null),
    });
    out.skipped += plan.held.length;
    if (!plan.send) continue;

    const chatId = await telegramChatId(userId);
    const voice = await loadVoice(userId);
    const byId = new Map(open.map((o) => [o.id, o] as const));
    const itemFacts = (i: DigestItem): string => {
      const o = byId.get(i.occurrenceId);
      if (!o) return i.label;
      return i.slot === "confirm" ? autoFacts(o, i.label) : askFacts(o, i.label, today);
    };

    const payload: CalendarDigestClaimPayload = {
      version: 1,
      today,
      confirms: plan.confirms.map((item) => ({ id: item.occurrenceId })),
      asks: plan.asks.map((item) => {
        const occurrence = byId.get(item.occurrenceId);
        if (!occurrence) {
          throw new Error(`digest occurrence ${item.occurrenceId} missing from proven read`);
        }
        return {
          id: item.occurrenceId,
          expectedAskCount: occurrence.askCount,
        };
      }),
    };

    // The cap and claim are serialized in DB. Publication then commits the WEB
    // message and every occurrence transition in one transaction, so there is
    // no state in which the user saw a question that Kipu forgot (or vice versa).
    const delivery = await deliverCalendarDigestWith({
      claim: () =>
        claimAmbientNudge({
          userId,
          topic: "calendar_digest",
          dayBucket: today,
          reason: `digest: ${plan.confirms.length} confirmar / ${plan.asks.length} preguntar / ${plan.standing.length} pendientes`,
          priority: plan.items[0]?.priority ?? 1,
          channel: "web",
          budgetLane: "calendar",
          laneCap: 1,
          totalCap: PROACTIVE_TOTAL_CAP,
          payload,
        }),
      generate: () =>
        generateDigestMessage(userId, voice, digestFacts(plan, itemFacts)),
      failBeforeDelivery: (claimId, claimToken, reason) =>
        failAmbientClaimBeforeDelivery({
          id: claimId,
          userId,
          token: claimToken,
          reason,
        }),
      publish: (claimId, claimToken, content) =>
        publishCalendarDigest({
          userId,
          claimId,
          claimToken,
          content,
        }),
    });

    if (!delivery.ok) {
      out.errors += 1;
      out.skipped += plan.items.length;
      continue;
    }
    if (delivery.outcome === "skipped") {
      out.skipped += plan.items.length;
      continue;
    }

    out.autoNotified += delivery.autoNotified;
    out.asked += delivery.asked;
    const telegram = await deliverDigestTelegramCopy({
      userId,
      chatId,
      claimId: delivery.claimId,
      claimToken: delivery.claimToken,
      text: delivery.text,
    });
    if (!telegram.infrastructureOk) out.errors += 1;
  }
  return out;
}

// ── Auditoría 4 (punto 5) — la zona del notifier se PRUEBA o el usuario se salta ──
// El fallback viejo (error/catch → Guayaquil, sin validar IANA) podía preguntar en
// el DÍA equivocado y consumir askCount/lastAskedOn con una zona inventada. La
// decisión es pura (gate-able): lectura caída o zona inválida ⇒ {ok:false} — el
// caller cuenta error y NO envía ni consume nada; fila ausente ⇒ default legítimo.
export function pickNotifierTimezone(
  read: { ok: boolean; row: { timezone: string | null } | null },
): { ok: true; tz: string } | { ok: false } {
  if (!read.ok) return { ok: false };
  const tz = String(read.row?.timezone ?? DEFAULT_TZ) || DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return { ok: false };
  }
  return { ok: true, tz };
}

async function readUserTimezone(userId: string): Promise<{ ok: true; tz: string } | { ok: false }> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.from("user_engagement").select("timezone").eq("user_id", userId).maybeSingle();
    if (error) return pickNotifierTimezone({ ok: false, row: null });
    return pickNotifierTimezone({ ok: true, row: (data as { timezone: string | null } | null) ?? null });
  } catch {
    return { ok: false };
  }
}
