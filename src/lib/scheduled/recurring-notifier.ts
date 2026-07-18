import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { appendChatMessage, getRecentChatMessages } from "@/lib/chat-memory/chat-messages";
import { sendTelegramMessage } from "@/lib/telegram/send-message";
import { generateAmbientMessage } from "@/lib/ambient/ambient-message";
import {
  readOpenOccurrences,
  updateOccurrence,
  type RecurringOccurrence,
} from "@/lib/financial/recurring-occurrences-store";

// Bloque C — deliver the recurring-flow notifications the materializer queued:
//   - AUTO-booked (status 'booked', notified=false) → a ONE-TIME correctable confirmation
//     ("registré tu sueldo, ¿todo bien?").
//   - ASK (status 'pending') → a PERSISTENT question ("¿cuánto vino la luz?" / "¿entró tu
//     sueldo?"), re-asked once per day up to 3 times, honoring snooze_until and skipping
//     dismissed ones. After the 3rd ask it stops nagging but stays visibly "sin confirmar".
// The message is ALWAYS AI-generated (never a hardcoded template): deterministic code builds
// the FACTS (what was booked / what to ask, the amount, the label) and the model turns them
// into ONE natural, guilt-free line — the same "structured facts → AI copy" path the ambient
// loop uses. If the model can't produce a clean line, we send NOTHING this pass and DON'T burn
// state (notified stays false / the ask isn't counted), so the next run retries; we never fall
// back to canned copy. Delivery = append to the web chat (visible in the app) + Telegram push
// if linked. Timezone is the user's local day (so "today" for the once-per-day re-ask matches).

const DEFAULT_TZ = "America/Guayaquil";
const MAX_ASKS = 3;

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
function askFacts(o: RecurringOccurrence, label: string): string {
  const amt = o.expectedAmount != null ? fmt(o.expectedAmount, o.currency) : null;
  if (o.kind === "income") {
    const hint = amt ? ` La última vez fueron ${amt}, pero suele variar.` : "";
    return `Hoy toca el ingreso recurrente "${label}", pero el monto varía y no lo tienes aún.${hint} Pregúntale si ya le entró y cuánto, para registrarlo. Es válido que responda el monto exacto, "todavía no" si no llegó, o "te digo mañana".`;
  }
  if (o.kind === "card_statement") {
    // The CORTE ask on the cutoff day — capture the statement amount (no money moves yet).
    const hint = amt ? ` Suele venir alrededor de ${amt}.` : "";
    return `Hoy es el día de corte de "${label}".${hint} Pregúntale si ya le llegó el estado de cuenta y de cuánto es el pago del mes, para dejarlo anotado. Es válido que responda el monto del corte, "todavía no llegó", o "te digo después". Aclara suave que no mueve plata todavía; es solo para saber cuánto tendrá que pagar el día de pago.`;
  }
  if (o.kind === "debt_payment") {
    // Cards + family/other debts: confirm the payment (and how much) on the due day.
    const hint = amt ? ` El corte/cuota pendiente es de ${amt}.` : "";
    return `Hoy es el día de pago de "${label}".${hint} Pregúntale si ya la pagó y cuánto, para registrarlo (bajará su cuenta y su deuda). Es válido que responda el monto pagado, "todavía no", o "te digo mañana".`;
  }
  if (o.kind === "investment") {
    const hint = amt ? ` Tu meta de este mes es ${amt}.` : "";
    return `Hoy arranca el mes y toca tu inversión ("${label}").${hint} Pregúntale, sin presión, si ya invirtió ese dinero este mes. Al confirmar puede que se mueva de su cuenta a su activo (si lo tiene configurado así), o simplemente quede anotado. Es válido que confirme, diga cuánto invirtió, "este mes no", o "te digo después".`;
  }
  if (o.kind === "savings") {
    const hint = amt ? ` Tu meta de este mes es ${amt}.` : "";
    return `Hoy arranca el mes y toca tu ahorro ("${label}").${hint} Pregúntale, sin presión, si ya apartó ese dinero este mes. Es una reserva (no mueve el ledger): basta que confirme, diga cuánto apartó, "este mes no", o "te digo después".`;
  }
  const hint = amt ? ` La última vez fueron ${amt}, pero puede cambiar.` : "";
  return `Hoy vence el gasto "${label}", y no tienes el monto exacto.${hint} Pregúntale cuánto le salió este mes para registrarlo. Es válido que responda el monto, "no lo pagué", o "te digo mañana".`;
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

async function labelsFor(userId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const sb = createSupabaseAdminClient();
    const [inc, fix, debt, sav, sched] = await Promise.all([
      sb.from("income_sources").select("id, name").eq("user_id", userId),
      sb.from("fixed_expenses").select("id, name").eq("user_id", userId),
      sb.from("debt_accounts").select("id, name").eq("user_id", userId),
      sb.from("savings_plans").select("id, name").eq("user_id", userId),
      sb.from("scheduled_payments").select("id, name").eq("user_id", userId),
    ]);
    for (const r of (inc.data ?? []) as Record<string, unknown>[]) map.set(String(r.id), String(r.name ?? "ingreso"));
    for (const r of (fix.data ?? []) as Record<string, unknown>[]) map.set(String(r.id), String(r.name ?? "gasto"));
    for (const r of (debt.data ?? []) as Record<string, unknown>[]) map.set(String(r.id), String(r.name ?? "deuda"));
    for (const r of (sav.data ?? []) as Record<string, unknown>[]) map.set(String(r.id), String(r.name ?? "reserva"));
    for (const r of (sched.data ?? []) as Record<string, unknown>[]) map.set(String(r.id), String(r.name ?? "pago programado"));
  } catch {
    /* labels are best-effort */
  }
  map.set("commit:savings", "ahorro");
  map.set("commit:investment", "inversión");
  return map;
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
async function composeAndDeliver(
  userId: string,
  chatId: string | null,
  voice: UserVoice,
  topic: string,
  facts: string,
): Promise<boolean> {
  const recent = await getRecentChatMessages({ userId, channel: "web", limit: 6, windowMinutes: 60 * 24 * 3 }).catch(() => []);
  const text = await generateAmbientMessage({
    topic,
    facts,
    firstName: voice.firstName,
    tone: voice.tone,
    recentMessages: recent.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
  });
  if (!text) return false; // no hardcoded fallback — send nothing, retry next run
  try {
    await appendChatMessage({ userId, channel: "web", role: "assistant", content: text, messageType: "advisory", metadata: { source: "recurring" } });
  } catch {
    return false; // couldn't persist to the durable surface → don't burn state
  }
  if (chatId) {
    try {
      await sendTelegramMessage({ chatId, text });
    } catch {
      /* a failed push never corrupts state; the web chat already has it */
    }
  }
  return true;
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

const NOTIFY_DISCOVERY_CAP = 5000;

export async function deliverDueRecurringMessages(now: Date = new Date()): Promise<NotifyResult> {
  const out: NotifyResult = { usersScanned: 0, autoNotified: 0, asked: 0, skipped: 0, errors: 0 };
  const sb = createSupabaseAdminClient();
  // Distinct users with open occurrences. La select reporta su error y prueba su
  // final (CAP+1): antes un fallo llegaba como "nadie tiene pendientes" con 200.
  const { data: openRows, error: openErr } = await sb
    .from("recurring_occurrences")
    .select("user_id")
    .in("status", ["pending", "booked"])
    .limit(NOTIFY_DISCOVERY_CAP + 1);
  if (openErr || !openRows || openRows.length > NOTIFY_DISCOVERY_CAP) out.errors += 1;
  const userIds = Array.from(new Set((openRows ?? []).map((r) => String((r as Record<string, unknown>).user_id))));

  for (const userId of userIds) {
    out.usersScanned += 1;
    // "No pude leerte" ≠ "no tenías nada": un fallo por-usuario cuenta como error
    // de la corrida (el route lo vuelve 5xx) en vez de saltarse la noche en silencio.
    const openRead = await readOpenOccurrences(userId);
    if (!openRead.ok) {
      out.errors += 1;
      continue;
    }
    const open = openRead.occurrences;
    if (open.length === 0) continue;
    const tz = await userTimezone(userId);
    const today = localDay(now, tz);
    const labels = await labelsFor(userId);
    const chatId = await telegramChatId(userId);
    const voice = await loadVoice(userId);

    for (const o of open) {
      const label = labels.get(sourceKey(o)) ?? (o.kind === "income" ? "tu ingreso" : "tu gasto");
      if (o.status === "booked") {
        if (o.notified) continue; // one-time confirmation already sent
        const sent = await composeAndDeliver(userId, chatId, voice, "recurring_auto_confirm", autoFacts(o, label));
        if (!sent) { out.skipped += 1; continue; } // AI unavailable → retry next run
        await updateOccurrence(userId, o.id, { notified: true });
        out.autoNotified += 1;
        continue;
      }
      // status === 'pending' → an ASK (variable flow, or an auto flow that couldn't book).
      if (o.snoozeUntil && new Date(o.snoozeUntil).getTime() > now.getTime()) {
        out.skipped += 1;
        continue;
      }
      if (o.askCount >= MAX_ASKS) {
        out.skipped += 1; // stop nagging; stays "sin confirmar" for the Margen
        continue;
      }
      if (o.lastAskedOn === today) {
        out.skipped += 1; // already asked today
        continue;
      }
      const sent = await composeAndDeliver(userId, chatId, voice, "recurring_ask", askFacts(o, label));
      // Only count the ask the user actually received: if the AI couldn't run, don't burn an
      // ask (askCount/lastAskedOn untouched) so the next run tries again.
      if (!sent) { out.skipped += 1; continue; }
      await updateOccurrence(userId, o.id, { askCount: o.askCount + 1, lastAskedOn: today, notified: true });
      out.asked += 1;
    }
  }
  return out;
}

async function userTimezone(userId: string): Promise<string> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb.from("user_engagement").select("timezone").eq("user_id", userId).maybeSingle();
    return String(data?.timezone ?? DEFAULT_TZ) || DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}
