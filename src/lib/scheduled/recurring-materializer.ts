import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { bookRecurring, reverseRecurring } from "@/lib/financial/recurring-ledger";
import { loadFxRates } from "@/lib/fx/fx-store";
import {
  mapSupabaseIncomeSource,
  mapSupabaseFixedExpense,
  type SupabaseIncomeSourceRow,
  type SupabaseFixedExpenseRow,
} from "@/lib/financial/onboarding-context-mappers";
import { occurrencesDueUpTo, materializationMode } from "@/lib/financial/recurring-occurrence";
import { createOccurrenceIfAbsent, updateOccurrence } from "@/lib/financial/recurring-occurrences-store";
import type { FxRate } from "@/lib/fx/fx-rates";

// Bloque C — the materialization orchestration. Runs from an evening cron. For each user with
// active recurring flows it, in the user's LOCAL day:
//   - fixed-amount flows (is_variable=false) → AUTO-book the due occurrence into the ledger
//     (via the single writer, native amount + resolved FX, idempotent) and mark it 'booked';
//   - variable-amount flows (is_variable=true) → create a 'pending' occurrence to ASK the user.
// Occasional/windfall income and paused/inactive flows are skipped (never projected as a
// scheduled payday). Idempotency is doubled: one occurrence row per (source,date) AND a ledger
// dedupeKey per (source,period). Nothing here is silent — the cron then delivers notify/ask.

const DEFAULT_TZ = "America/Guayaquil";

// The user's current LOCAL calendar day as a local-midnight Date (so the pure occurrence math,
// which reads local Y/M/D, matches the user's timezone rather than the server's UTC).
function userLocalToday(now: Date, tz: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = Number(get("year"));
    const m = Number(get("month"));
    const d = Number(get("day"));
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) return new Date(y, m - 1, d);
  } catch {
    /* fall through to server-local */
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

interface LiteAccount {
  id: string;
  name: string;
  currency: string | null;
  isPrimary: boolean;
  closed: boolean;
}

interface UserBundle {
  baseCurrency: string;
  fxRates: FxRate[];
  timezone: string;
  accounts: LiteAccount[];
  income: ReturnType<typeof mapSupabaseIncomeSource>[];
  fixed: ReturnType<typeof mapSupabaseFixedExpense>[];
}

async function loadUserBundle(userId: string): Promise<UserBundle | null> {
  try {
    const sb = createSupabaseAdminClient();
    const [profRes, incRes, fixRes, accRes, engRes, rates] = await Promise.all([
      sb.from("profiles").select("base_currency").eq("id", userId).maybeSingle(),
      sb.from("income_sources").select("*").eq("user_id", userId).eq("status", "active"),
      sb.from("fixed_expenses").select("*").eq("user_id", userId).eq("is_active", true),
      sb.from("accounts").select("*").eq("user_id", userId),
      sb.from("user_engagement").select("timezone").eq("user_id", userId).maybeSingle(),
      loadFxRates(userId),
    ]);
    const baseCurrency = String(profRes.data?.base_currency ?? "USD").toUpperCase();
    const timezone = String(engRes.data?.timezone ?? DEFAULT_TZ) || DEFAULT_TZ;
    const accounts: LiteAccount[] = (accRes.data ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        name: String(row.name ?? "cuenta"),
        currency: row.currency == null ? null : String(row.currency),
        isPrimary: row.is_primary === true,
        closed: row.status === "closed",
      };
    });
    const income = ((incRes.data ?? []) as SupabaseIncomeSourceRow[])
      .map(mapSupabaseIncomeSource)
      .filter((i) => !i.isOccasional); // windfalls are never a scheduled payday
    const fixed = ((fixRes.data ?? []) as SupabaseFixedExpenseRow[]).map(mapSupabaseFixedExpense);
    return { baseCurrency, fxRates: rates, timezone, accounts, income, fixed };
  } catch {
    return null;
  }
}

function pickAccount(accounts: LiteAccount[], preferredId: string | null | undefined): LiteAccount | null {
  const open = accounts.filter((a) => !a.closed);
  if (preferredId) {
    const match = open.find((a) => a.id === preferredId);
    if (match) return match;
  }
  return open.find((a) => a.isPrimary) ?? open[0] ?? null;
}

export interface MaterializeResult {
  usersScanned: number;
  occurrencesCreated: number;
  autoBooked: number;
  asksCreated: number;
  skipped: number;
  errors: number;
}


// Mark a just-booked occurrence; if the state write fails after a FRESH booking, reverse the
// ledger row so we never leave an orphan that a later ask/confirm would double-book (the book
// and the state transition are two writes, not one transaction).
async function markBookedOrReverse(
  userId: string,
  occurrenceId: string,
  booked: { txId: string; preexisting: boolean },
  out: MaterializeResult,
): Promise<void> {
  const upd = await updateOccurrence(userId, occurrenceId, {
    status: booked.preexisting ? "confirmed" : "booked",
    createdTransactionId: booked.txId,
    notified: booked.preexisting,
  });
  if (upd) {
    out.autoBooked += 1;
    return;
  }
  // State write failed. A pre-existing tx was not ours to undo; a FRESH booking must be reversed
  // so the still-'pending' occurrence re-books cleanly next run instead of orphaning a live row.
  if (!booked.preexisting) await reverseRecurring(userId, booked.txId);
  out.errors += 1;
}

export async function runDueRecurringMaterializations(
  now: Date = new Date(),
  onlyUserId?: string,
): Promise<MaterializeResult> {
  const out: MaterializeResult = {
    usersScanned: 0,
    occurrencesCreated: 0,
    autoBooked: 0,
    asksCreated: 0,
    skipped: 0,
    errors: 0,
  };
  const sb = createSupabaseAdminClient();
  // Users with at least one active recurring flow (optionally scoped to a single user, e.g. a
  // manual catch-up run for one account).
  const [incU, fixU] = await Promise.all([
    sb.from("income_sources").select("user_id").eq("status", "active"),
    sb.from("fixed_expenses").select("user_id").eq("is_active", true),
  ]);
  const userIds = Array.from(
    new Set([...(incU.data ?? []), ...(fixU.data ?? [])].map((r) => String((r as Record<string, unknown>).user_id))),
  ).filter((id) => !onlyUserId || id === onlyUserId);

  for (const userId of userIds) {
    out.usersScanned += 1;
    const bundle = await loadUserBundle(userId);
    if (!bundle) {
      out.errors += 1;
      continue;
    }
    const today = userLocalToday(now, bundle.timezone);

    // ── Income flows ──────────────────────────────────────────────────────────
    for (const inc of bundle.income) {
      const dueDates = occurrencesDueUpTo(
        {
          frequency: inc.frequency,
          expectedDay: inc.expectedDay ?? null,
          expectedWeekday: inc.expectedWeekday ?? null,
          payAnchorDate: inc.payAnchorDate ?? null,
        },
        today,
      );
      for (const dateISO of dueDates) {
        const mode = materializationMode(inc.isVariable);
        const created = await createOccurrenceIfAbsent({
          userId,
          incomeSourceId: inc.id,
          occurrenceDate: dateISO,
          kind: "income",
          mode,
          expectedAmount: inc.amount ?? null,
          currency: inc.currency ?? null,
        });
        if (!created) {
          out.errors += 1;
          continue;
        }
        if (!created.created) continue; // already handled a prior run
        out.occurrencesCreated += 1;
        if (mode === "ask") {
          out.asksCreated += 1;
          continue;
        }
        const account = pickAccount(bundle.accounts, inc.destinationAccountId);
        if (!account) {
          out.skipped += 1;
          continue;
        }
        const booked = await bookRecurring({
          userId,
          kind: "income",
          nativeAmount: inc.amount ?? 0,
          nativeCurrency: inc.currency ?? bundle.baseCurrency,
          base: bundle.baseCurrency,
          rates: bundle.fxRates,
          accountId: account.id,
          accountCurrency: account.currency,
          isCard: false,
          dedupeKey: `recurring-income:${inc.id}:${dateISO}`,
          occurredAtISO: `${dateISO}T12:00:00.000Z`,
          occurrenceDateISO: dateISO,
          description: inc.name || "Ingreso recurrente",
          sourceLinkId: inc.id,
        });
        if (booked) {
          await markBookedOrReverse(userId, created.occurrence.id, booked, out);
        } else {
          // Could not book safely (no account / no FX) — the row stays 'pending' so the user
          // is ASKED instead of the flow silently vanishing (C5 asks every open occurrence).
          out.skipped += 1;
        }
      }
    }

    // ── Fixed expense flows ───────────────────────────────────────────────────
    for (const fe of bundle.fixed) {
      const dueDates = occurrencesDueUpTo(
        {
          frequency: fe.frequency,
          expectedDay: fe.expectedDay ?? null,
          expectedWeekday: fe.expectedWeekday ?? null,
          payAnchorDate: fe.payAnchorDate ?? null,
        },
        today,
      );
      for (const dateISO of dueDates) {
        // A fixed expense with a FUTURE start_date must not be booked before it begins (mirrors
        // financial-calendar's start-date guard so the ledger and the projection agree).
        if (fe.startDate && dateISO < String(fe.startDate).slice(0, 10)) continue;
        const mode = materializationMode(fe.isVariable);
        const created = await createOccurrenceIfAbsent({
          userId,
          fixedExpenseId: fe.id,
          occurrenceDate: dateISO,
          kind: "expense",
          mode,
          expectedAmount: fe.amount ?? null,
          currency: fe.currency ?? null,
        });
        if (!created) {
          out.errors += 1;
          continue;
        }
        if (!created.created) continue;
        out.occurrencesCreated += 1;
        if (mode === "ask") {
          out.asksCreated += 1;
          continue;
        }
        // Card-paid fixed expense (payment_source_type='debt_account') → charge the card
        // (debt up, no cash out). paymentSourceId is a DEBT account id, not in `accounts`.
        const isCard = fe.paymentSourceType === "debt_account" && !!fe.paymentSourceId;
        let accountId: string;
        let accountCurrency: string | null;
        if (isCard) {
          accountId = fe.paymentSourceId as string; // ownership enforced by the ledger RPC
          accountCurrency = null;
        } else {
          const account = pickAccount(
            bundle.accounts,
            fe.paymentSourceType === "account" ? fe.paymentSourceId : null,
          );
          if (!account) {
            out.skipped += 1;
            continue;
          }
          accountId = account.id;
          accountCurrency = account.currency;
        }
        const booked = await bookRecurring({
          userId,
          kind: "expense",
          nativeAmount: fe.amount ?? 0,
          nativeCurrency: fe.currency ?? bundle.baseCurrency,
          base: bundle.baseCurrency,
          rates: bundle.fxRates,
          accountId,
          accountCurrency,
          isCard,
          dedupeKey: `recurring-expense:${fe.id}:${dateISO}`,
          occurredAtISO: `${dateISO}T12:00:00.000Z`,
          occurrenceDateISO: dateISO,
          description: fe.name || "Gasto fijo",
          sourceLinkId: fe.id,
        });
        if (booked) {
          await markBookedOrReverse(userId, created.occurrence.id, booked, out);
        } else {
          // Stays 'pending' → asked instead of silently vanishing.
          out.skipped += 1;
        }
      }
    }
  }
  return out;
}
