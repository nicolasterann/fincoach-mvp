import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { appendChatMessage } from "@/lib/chat-memory/chat-messages";
import { sendTelegramMessage } from "@/lib/telegram/send-message";
import {
  listOpenOccurrences,
  updateOccurrence,
  type RecurringOccurrence,
} from "@/lib/financial/recurring-occurrences-store";

// Bloque C — deliver the recurring-flow notifications the materializer queued:
//   - AUTO-booked (status 'booked', notified=false) → a ONE-TIME correctable confirmation
//     ("Registré tu sueldo: X. ¿Todo bien?"). Deterministic copy (no hallucinated amount).
//   - ASK (status 'pending') → a PERSISTENT question ("¿Cuánto vino la luz?" / "¿Entró tu
//     sueldo?"), re-asked once per day up to 3 times, honoring snooze_until and skipping
//     dismissed ones. After the 3rd ask it stops nagging but stays visibly "sin confirmar".
// Delivery = append to the web chat (visible in the app) + Telegram push if linked. Timezone
// is the user's local day (so "today" for the once-per-day re-ask matches the user).

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

function autoMessage(o: RecurringOccurrence, label: string): string {
  const amt = fmt(o.expectedAmount, o.currency);
  if (o.kind === "income") {
    return `Registré tu ingreso de ${label}: ${amt}. ¿Todo bien? Si entró otro monto o cambió para siempre, decímelo y lo ajusto.`;
  }
  return `Registré tu gasto fijo de ${label}: ${amt}. ¿Todo bien? Si fue otro monto o cambió, decímelo y lo corrijo.`;
}

function askMessage(o: RecurringOccurrence, label: string): string {
  const hint = o.expectedAmount != null ? ` (la última vez fueron ${fmt(o.expectedAmount, o.currency)})` : "";
  if (o.kind === "income") {
    return `¿Ya te entró tu ingreso de ${label}?${hint} Decime el monto y lo registro — o "todavía no" si no llegó.`;
  }
  return `¿Cuánto te vino ${label} este mes?${hint} Decime el monto y lo registro.`;
}

async function labelsFor(userId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const sb = createSupabaseAdminClient();
    const [inc, fix] = await Promise.all([
      sb.from("income_sources").select("id, name").eq("user_id", userId),
      sb.from("fixed_expenses").select("id, name").eq("user_id", userId),
    ]);
    for (const r of (inc.data ?? []) as Record<string, unknown>[]) map.set(String(r.id), String(r.name ?? "ingreso"));
    for (const r of (fix.data ?? []) as Record<string, unknown>[]) map.set(String(r.id), String(r.name ?? "gasto"));
  } catch {
    /* labels are best-effort */
  }
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

async function deliver(userId: string, chatId: string | null, text: string): Promise<void> {
  // Web chat history (visible in the app for every user).
  await appendChatMessage({ userId, channel: "web", role: "assistant", content: text, messageType: "advisory", metadata: { source: "recurring" } });
  // Telegram push if linked.
  if (chatId) {
    try {
      await sendTelegramMessage({ chatId, text });
    } catch {
      /* a failed push never corrupts state */
    }
  }
}

export interface NotifyResult {
  usersScanned: number;
  autoNotified: number;
  asked: number;
  skipped: number;
}

export async function deliverDueRecurringMessages(now: Date = new Date()): Promise<NotifyResult> {
  const out: NotifyResult = { usersScanned: 0, autoNotified: 0, asked: 0, skipped: 0 };
  const sb = createSupabaseAdminClient();
  // Distinct users with open occurrences.
  const { data: openRows } = await sb
    .from("recurring_occurrences")
    .select("user_id")
    .in("status", ["pending", "booked"]);
  const userIds = Array.from(new Set((openRows ?? []).map((r) => String((r as Record<string, unknown>).user_id))));

  for (const userId of userIds) {
    out.usersScanned += 1;
    const open = await listOpenOccurrences(userId);
    if (open.length === 0) continue;
    const tz = await userTimezone(userId);
    const today = localDay(now, tz);
    const labels = await labelsFor(userId);
    const chatId = await telegramChatId(userId);

    for (const o of open) {
      const label = labels.get(o.incomeSourceId ?? o.fixedExpenseId ?? "") ?? (o.kind === "income" ? "tu ingreso" : "tu gasto");
      if (o.status === "booked") {
        if (o.notified) continue; // one-time confirmation already sent
        await deliver(userId, chatId, autoMessage(o, label));
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
      await deliver(userId, chatId, askMessage(o, label));
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
