import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { appendChatMessage, getRecentChatMessages } from "@/lib/chat-memory/chat-messages";
import { sendTelegramMessage } from "@/lib/telegram/send-message";
import { generateAmbientMessage } from "@/lib/ambient/ambient-message";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { classifyForIntel, toIntelTxn } from "@/lib/financial/spending-intelligence";
import { loadMerchantMemory } from "@/lib/financial/merchant-memory-store";
import { makeDayKey, DEFAULT_USER_TZ } from "@/lib/financial/margen-kipu";
import { computeObjectiveMonthClose, isObjectiveCategory, type ObjectiveFeedTxn } from "@/lib/financial/objectives";
import { hasMonthClose, insertMonthCloses } from "@/lib/financial/objective-closes-store";
import { formatKipuMoney } from "@/lib/financial/money";

// Stage H — the monthly OBJECTIVE CLOSE (nightly cron, user-local day 1-3).
// For every user with food/transport objectives whose previous user-tz month
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
  usersScanned: number;
  closed: number;
  skipped: number;
  errors: number;
}

function prevMonthOf(localISO: string): string {
  const [y, m] = localISO.slice(0, 7).split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function loadTimezone(userId: string): Promise<string> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb.from("user_engagement").select("timezone").eq("user_id", userId).maybeSingle();
    return data?.timezone ? String(data.timezone) : DEFAULT_USER_TZ;
  } catch {
    return DEFAULT_USER_TZ;
  }
}

// The closed month's classified feed: month-bounded query (±2d padding so the
// user-tz day mapping never clips a boundary txn), reversal-netted exactly like
// the engine's pattern loader, classified with merchant memory.
async function loadMonthFeed(userId: string, monthISO: string, tz: string): Promise<ObjectiveFeedTxn[]> {
  const sb = createSupabaseAdminClient();
  const [y, m] = monthISO.split("-").map(Number);
  const fromISO = new Date(Date.UTC(y, m - 1, 1) - 2 * 86_400_000).toISOString();
  const toISO = new Date(Date.UTC(y, m, 1) + 2 * 86_400_000).toISOString();
  const { data, error } = await sb
    .from("transactions")
    .select("id, occurred_at, base_amount, type, category, description, related_transaction_id, recurring_expense_id, external_ref, budget_treatment")
    .eq("user_id", userId)
    .gte("occurred_at", fromISO)
    .lt("occurred_at", toISO)
    .order("occurred_at", { ascending: true })
    .limit(2000);
  // A failed query returns {data:null,error} WITHOUT throwing — never build a
  // close from an empty feed (it would confidently report "cerró en 0"). Throw
  // so the caller's try/catch counts it an error and retries next night.
  if (error) throw new Error(`objective-close feed query failed: ${error.message}`);
  const rows = (data ?? []) as { id: string; occurred_at: string; base_amount: number | string; type: string; category?: string | null; description?: string | null; related_transaction_id?: string | null; recurring_expense_id?: string | null; external_ref?: string | null; budget_treatment?: string | null }[];
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
  const out: CloseRunResult = { usersScanned: 0, closed: 0, skipped: 0, errors: 0 };
  const sb = createSupabaseAdminClient();
  const { data } = await sb
    .from("budget_categories")
    .select("user_id, category")
    .eq("is_active", true)
    .in("category", ["food", "transport"]);
  const userIds = Array.from(new Set((data ?? []).map((r) => String((r as { user_id: unknown }).user_id))));

  for (const userId of userIds) {
    out.usersScanned += 1;
    try {
      const tz = await loadTimezone(userId);
      const localToday = makeDayKey(tz)(now);
      const dayOfMonth = Number(localToday.slice(8, 10));
      if (dayOfMonth > 3) {
        out.skipped += 1;
        continue;
      }
      const closedMonth = prevMonthOf(localToday);
      if (await hasMonthClose(userId, closedMonth)) {
        out.skipped += 1;
        continue;
      }
      const ctx = await buildUserFinancialContext(userId);
      const objectives = ctx.budgetCategories
        .filter((c) => c.isActive && isObjectiveCategory(c.category) && c.amount > 0)
        .map((c) => ({ category: c.category, amountBase: c.amount, mtdSeed: c.mtdSeed, seedMonth: c.seedMonth, isActive: c.isActive }));
      if (objectives.length === 0) {
        out.skipped += 1;
        continue;
      }
      const feed = await loadMonthFeed(userId, closedMonth, tz);
      const closes = computeObjectiveMonthClose({ objectives, txns: feed, monthISO: closedMonth }).filter(
        // Nothing to report for a category with zero activity that month — this
        // is what prevents a day-1-3 onboarder (whose objective didn't exist last
        // month) from getting a fabricated "objetivo 300, cerraste en 0" close.
        (c) => c.spentBase > 0 || c.extraordinaryBase > 0,
      );
      if (closes.length === 0) {
        out.skipped += 1;
        continue;
      }

      const base = ctx.profile.baseCurrency;
      const fmt = (n: number) => formatKipuMoney(n, base);
      const totalSurplus = closes.reduce((t, c) => t + c.surplusBase, 0);
      const lines = closes.map((c) => {
        let line = `${c.labelEs}: objetivo ${fmt(c.objectiveBase)}, cerró en ${fmt(c.spentBase)}`;
        if (c.excessBase > 0) {
          line += ` (se pasó por ${fmt(c.excessBase)}`;
          if (c.excessDrainedBase > 0) line += ` — de eso, ${fmt(c.excessDrainedBase)} YA salió de su Saldo en su momento, no es un cobro nuevo`;
          line += `)`;
        }
        else if (c.surplusBase > 0) line += ` (le sobraron ${fmt(c.surplusBase)})`;
        if (c.extraordinaryBase > 0) line += `; además ${fmt(c.extraordinaryBase)} extraordinarios que salieron directo del Saldo y NO cuentan en esta comparación`;
        return line;
      });
      const surplusFact =
        totalSurplus > 0
          ? ` Le sobraron ${fmt(totalSurplus)} en total: por defecto se quedan protegidos en su Reserva (no hay que mover nada); pregúntale suave si los deja ahí o los manda a otra parte (una meta, pagar deuda extra) — él decide, sin presión.`
          : "";
      const facts = `Cierre del mes pasado de sus objetivos de comida/transporte (es un REPORTE con lo aprendido, cero culpa, tono de cierre de capítulo): ${lines.join(" · ")}.${surplusFact} Pregunta también si mantiene sus objetivos como están o quiere cambiarlos — es SU decisión, Kipu nunca los ajusta solo; si se pasó, mantenerlo también es válido (es su forma de ajustar el comportamiento).`;

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
        // No clean AI copy → send nothing, don't persist: the day 1-3 window retries.
        out.skipped += 1;
        continue;
      }
      try {
        await appendChatMessage({ userId, channel: "web", role: "assistant", content: text, messageType: "advisory", metadata: { source: "objective_close", month: closedMonth } });
      } catch {
        out.errors += 1;
        continue; // durable surface failed → don't persist, retry next run
      }
      if (chatId) {
        try {
          await sendTelegramMessage({ chatId, text });
        } catch {
          /* Telegram push is best-effort; the web chat already has it */
        }
      }
      // Persist the idempotency gate AFTER delivery (never burn state on an AI
      // failure). Retry a few times so a transient DB hiccup doesn't leave the
      // gate unwritten and re-send the report next night.
      let persisted = false;
      for (let attempt = 0; attempt < 3 && !persisted; attempt++) {
        persisted = await insertMonthCloses(userId, closedMonth, closes);
      }
      if (persisted) out.closed += 1;
      else out.errors += 1;
    } catch {
      out.errors += 1;
    }
  }
  return out;
}
