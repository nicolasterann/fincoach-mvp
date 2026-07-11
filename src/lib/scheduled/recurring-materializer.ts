import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { bookRecurring, reverseRecurring } from "@/lib/financial/recurring-ledger";
import { loadFxRates } from "@/lib/fx/fx-store";
import {
  mapSupabaseIncomeSource,
  mapSupabaseFixedExpense,
  type SupabaseIncomeSourceRow,
  type SupabaseFixedExpenseRow,
} from "@/lib/financial/onboarding-context-mappers";
import { loadActiveSavingsPlans, type SavingsPlanRecord } from "@/lib/financial/savings-plans-store";
import { occurrencesDueUpTo, materializationMode, isoLocal, addDays, startOfDay, clampDom } from "@/lib/financial/recurring-occurrence";
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

// A debt/loan/card (recurring payment). `type` decides materialization: loan → auto-book the
// fixed cuota; credit_card → ask on the pay day only when a statement amount exists; family/
// other → ask (irregular).
interface LiteDebt {
  id: string;
  name: string;
  type: string;
  dueDay: number | null;
  cutoffDay: number | null; // credit-card statement close day → the CORTE ask fires here
  minimumPayment: number | null;
  fullPaymentDue: number | null;
  currentBalance: number | null; // base currency; a card with no balance has no cut to report
  currency: string | null;
  defaultPaymentAccountId: string | null;
}

// A one-off planned payment on an exact date.
interface LiteScheduled {
  id: string;
  name: string;
  amount: number | null;
  currency: string | null;
  dueDate: string; // YYYY-MM-DD
}

interface UserBundle {
  baseCurrency: string;
  fxRates: FxRate[];
  timezone: string;
  accounts: LiteAccount[];
  income: ReturnType<typeof mapSupabaseIncomeSource>[];
  fixed: ReturnType<typeof mapSupabaseFixedExpense>[];
  debts: LiteDebt[];
  savingsPlans: SavingsPlanRecord[];
  scheduled: LiteScheduled[];
  monthlySavings: number; // legacy aggregate reserve scalar (used only when no savings plan)
  monthlyInvestment: number;
}

async function loadUserBundle(userId: string): Promise<UserBundle | null> {
  try {
    const sb = createSupabaseAdminClient();
    const [profRes, incRes, fixRes, accRes, engRes, debtRes, schedRes, prefRes, plans, rates] = await Promise.all([
      sb.from("profiles").select("base_currency").eq("id", userId).maybeSingle(),
      sb.from("income_sources").select("*").eq("user_id", userId).eq("status", "active"),
      sb.from("fixed_expenses").select("*").eq("user_id", userId).eq("is_active", true),
      sb.from("accounts").select("*").eq("user_id", userId),
      sb.from("user_engagement").select("timezone").eq("user_id", userId).maybeSingle(),
      sb.from("debt_accounts").select("id, name, type, due_day, cutoff_day, minimum_payment, full_payment_due, current_balance_base, currency, default_payment_account_id").eq("user_id", userId).eq("status", "active"),
      sb.from("scheduled_payments").select("id, name, amount, currency, due_date").eq("user_id", userId).eq("status", "scheduled"),
      sb.from("user_financial_preferences").select("monthly_savings_commitment, monthly_investment_commitment").eq("user_id", userId).maybeSingle(),
      loadActiveSavingsPlans(userId),
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
    const debts: LiteDebt[] = (debtRes.data ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        name: String(row.name ?? "deuda"),
        type: String(row.type ?? "other_debt"),
        dueDay: row.due_day == null ? null : Number(row.due_day),
        cutoffDay: row.cutoff_day == null ? null : Number(row.cutoff_day),
        minimumPayment: row.minimum_payment == null ? null : Number(row.minimum_payment),
        fullPaymentDue: row.full_payment_due == null ? null : Number(row.full_payment_due),
        currentBalance: row.current_balance_base == null ? null : Number(row.current_balance_base),
        currency: row.currency == null ? null : String(row.currency),
        defaultPaymentAccountId: row.default_payment_account_id == null ? null : String(row.default_payment_account_id),
      };
    });
    const scheduled: LiteScheduled[] = (schedRes.data ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id),
        name: String(row.name ?? "pago programado"),
        amount: row.amount == null ? null : Number(row.amount),
        currency: row.currency == null ? null : String(row.currency),
        dueDate: String(row.due_date ?? "").slice(0, 10),
      };
    });
    const monthlySavings = Number(prefRes.data?.monthly_savings_commitment ?? 0) || 0;
    const monthlyInvestment = Number(prefRes.data?.monthly_investment_commitment ?? 0) || 0;
    return {
      baseCurrency,
      fxRates: rates,
      timezone,
      accounts,
      income,
      fixed,
      debts,
      savingsPlans: plans,
      scheduled,
      monthlySavings,
      monthlyInvestment,
    };
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
  // Users with at least one active scheduled flow of ANY calendar type (optionally scoped to a
  // single user, e.g. a manual catch-up run for one account). Reserves via preferences scalars
  // are covered because such users always have income/fixed too — but include them explicitly.
  const [incU, fixU, debtU, savU, schedU, prefU] = await Promise.all([
    sb.from("income_sources").select("user_id").eq("status", "active"),
    sb.from("fixed_expenses").select("user_id").eq("is_active", true),
    sb.from("debt_accounts").select("user_id").eq("status", "active"),
    sb.from("savings_plans").select("user_id").eq("status", "active"),
    sb.from("scheduled_payments").select("user_id").eq("status", "scheduled"),
    sb.from("user_financial_preferences").select("user_id").or("monthly_savings_commitment.gt.0,monthly_investment_commitment.gt.0"),
  ]);
  const userIds = Array.from(
    new Set(
      [
        ...(incU.data ?? []),
        ...(fixU.data ?? []),
        ...(debtU.data ?? []),
        ...(savU.data ?? []),
        ...(schedU.data ?? []),
        ...(prefU.data ?? []),
      ].map((r) => String((r as Record<string, unknown>).user_id)),
    ),
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
          recurringExpenseId: fe.id, // this IS a fixed expense → valid recurring_expense_id
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

    // ── Every OTHER calendar flow now uses the same loop ──────────────────────
    await materializeDebts(userId, bundle, today, out);
    await materializeSavingsPlans(userId, bundle, today, out);
    await materializeScheduled(userId, bundle, today, out);
    await materializeCommitments(userId, bundle, today, out);
  }
  return out;
}

// ── Debts (loans / cards / family) ───────────────────────────────────────────
// A loan auto-books its fixed cuota (like a fixed expense). A credit card is ASKED on its pay
// day, but ONLY when a closed statement exists to pay (full_payment_due > 0) — it never auto-
// moves cash, and it stays in its own cycle (excluded from the Margen). Family/other debts are
// irregular → ASK. Every payment books as effectType 'debt_payment' (source cash down + debt
// down; card statement reduced on confirm) through the shared ledger.
async function materializeDebts(userId: string, bundle: UserBundle, today: Date, out: MaterializeResult): Promise<void> {
  for (const debt of bundle.debts) {
    // ── CORTE ask: a credit card with any activity asks on its cutoff day whether the statement
    //    arrived + how much, which SETS full_payment_due for the pago ask that follows. ──────────
    if (debt.type === "credit_card" && debt.cutoffDay != null && ((debt.currentBalance ?? 0) > 0 || (debt.fullPaymentDue ?? 0) > 0)) {
      const corteDates = occurrencesDueUpTo({ frequency: "monthly", expectedDay: debt.cutoffDay }, today);
      for (const dateISO of corteDates) {
        const created = await createOccurrenceIfAbsent({
          userId,
          debtAccountId: debt.id,
          occurrenceDate: dateISO,
          kind: "card_statement",
          mode: "ask",
          expectedAmount: (debt.fullPaymentDue ?? 0) > 0 ? debt.fullPaymentDue : null, // last cut as a hint
          currency: debt.currency ?? null,
        });
        if (!created) {
          out.errors += 1;
          continue;
        }
        if (!created.created) continue;
        out.occurrencesCreated += 1;
        out.asksCreated += 1;
      }
    }
    if (debt.dueDay == null) continue; // no scheduled pay day → nothing to fire
    const isLoan = debt.type === "loan";
    const isCard = debt.type === "credit_card";
    // A card whose statement-close day coincides with its pay day would fire the CORTE ask and the
    // PAGO ask on the same day. The corte owns that day (it captures the amount), so skip the pago
    // this cycle — it fires next cycle, once the corte has set the statement.
    if (isCard && debt.cutoffDay != null && clampDom(debt.cutoffDay) === clampDom(debt.dueDay)) continue;
    const dueDates = occurrencesDueUpTo({ frequency: "monthly", expectedDay: debt.dueDay }, today);
    for (const dateISO of dueDates) {
      // Loan → the fixed cuota; card → the closed statement; family/other → a soft target.
      const expected = isCard
        ? debt.fullPaymentDue ?? 0
        : debt.fullPaymentDue ?? debt.minimumPayment ?? 0;
      // A card with no live statement has nothing to pay this cycle — don't nag.
      if (isCard && !(expected > 0)) continue;
      // A loan AUTO-books only when its funding account is EXPLICITLY known (never guess an account
      // and mis-attribute a cuota); otherwise it ASKS. Family/other/cards always ask.
      const loanFunding =
        isLoan && debt.defaultPaymentAccountId
          ? bundle.accounts.find((a) => a.id === debt.defaultPaymentAccountId && !a.closed) ?? null
          : null;
      const mode = isLoan && expected > 0 && loanFunding ? "auto" : "ask";
      const created = await createOccurrenceIfAbsent({
        userId,
        debtAccountId: debt.id,
        occurrenceDate: dateISO,
        kind: "debt_payment",
        mode,
        expectedAmount: expected > 0 ? expected : null,
        currency: debt.currency ?? null,
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
      // AUTO loan: cash out of the EXPLICIT payment account (guaranteed by the mode check) + the
      // loan balance down.
      const source = loanFunding!;
      const booked = await bookRecurring({
        userId,
        kind: "debt_payment",
        nativeAmount: expected,
        nativeCurrency: debt.currency ?? bundle.baseCurrency,
        base: bundle.baseCurrency,
        rates: bundle.fxRates,
        accountId: source.id,
        accountCurrency: source.currency,
        isCard: false,
        debtAccountId: debt.id,
        debtCurrency: debt.currency,
        cardStatementDue: null, // loans carry no statement to reduce
        dedupeKey: `recurring-debt:${debt.id}:${dateISO}`,
        occurredAtISO: `${dateISO}T12:00:00.000Z`,
        occurrenceDateISO: dateISO,
        description: debt.name || "Pago de deuda",
        sourceLinkId: debt.id,
      });
      if (booked) await markBookedOrReverse(userId, created.occurrence.id, booked, out);
      else out.skipped += 1;
    }
  }
}

// ── Savings / investment reserve plans (Stage 38) ────────────────────────────
// A reserve is ALWAYS ask: Kipu never silently assumes the user moved money aside. On confirm
// the resolver acknowledges it (a reserve is a Margen allocation, not necessarily a ledger move).
async function materializeSavingsPlans(userId: string, bundle: UserBundle, today: Date, out: MaterializeResult): Promise<void> {
  for (const plan of bundle.savingsPlans) {
    // A reserve is acknowledge-only (no phantom-money risk), so default a missing day to the 1st
    // rather than dropping the reserve entirely (income/fixed instead skip when the date is unknown).
    const dueDates = occurrencesDueUpTo(
      { frequency: plan.frequency, expectedDay: plan.expectedDay ?? 1, payAnchorDate: plan.payAnchorDate },
      today,
    );
    for (const dateISO of dueDates) {
      const created = await createOccurrenceIfAbsent({
        userId,
        savingsPlanId: plan.id,
        occurrenceDate: dateISO,
        kind: plan.kind, // 'savings' | 'investment'
        mode: "ask",
        expectedAmount: plan.originalAmount ?? plan.amountBase ?? null,
        currency: plan.originalCurrency ?? bundle.baseCurrency,
      });
      if (!created) {
        out.errors += 1;
        continue;
      }
      if (!created.created) continue;
      out.occurrencesCreated += 1;
      out.asksCreated += 1;
    }
  }
}

// ── One-off scheduled payments ───────────────────────────────────────────────
// Fires ONCE on the exact due_date (within the small look-back window). ASK before booking — a
// planned payment is a discrete act, not a guaranteed debit. Amountless ones are dropped (the
// calendar does the same). Books as a normal expense on confirm.
async function materializeScheduled(userId: string, bundle: UserBundle, today: Date, out: MaterializeResult): Promise<void> {
  const t = startOfDay(today);
  const todayIso = isoLocal(t);
  const windowStart = isoLocal(addDays(t, -2));
  for (const sp of bundle.scheduled) {
    if (!sp.dueDate || sp.amount == null || !(sp.amount > 0)) continue;
    if (sp.dueDate < windowStart || sp.dueDate > todayIso) continue; // only fire in the window
    const created = await createOccurrenceIfAbsent({
      userId,
      scheduledPaymentId: sp.id,
      occurrenceDate: sp.dueDate,
      kind: "expense",
      mode: "ask",
      expectedAmount: sp.amount,
      currency: sp.currency ?? bundle.baseCurrency,
    });
    if (!created) {
      out.errors += 1;
      continue;
    }
    if (!created.created) continue;
    out.occurrencesCreated += 1;
    out.asksCreated += 1;
  }
}

// ── Legacy aggregate reserve scalars ─────────────────────────────────────────
// For a user with a monthly savings/investment commitment but NO per-reserve plan, a monthly
// reserve check-in ("¿ya apartaste tus X?") on day 1. Skipped per-kind when a plan supersedes
// the scalar (so the reserve is never double-materialized). ASK, acknowledge-only on confirm.
async function materializeCommitments(userId: string, bundle: UserBundle, today: Date, out: MaterializeResult): Promise<void> {
  const hasSavingsPlan = bundle.savingsPlans.some((p) => p.kind === "savings");
  const hasInvestPlan = bundle.savingsPlans.some((p) => p.kind === "investment");
  const dueDates = occurrencesDueUpTo({ frequency: "monthly", expectedDay: 1 }, today);
  for (const dateISO of dueDates) {
    const scalars: { kind: "savings" | "investment"; amount: number; skip: boolean }[] = [
      { kind: "savings", amount: bundle.monthlySavings, skip: hasSavingsPlan },
      { kind: "investment", amount: bundle.monthlyInvestment, skip: hasInvestPlan },
    ];
    for (const s of scalars) {
      if (s.skip || !(s.amount > 0)) continue;
      const created = await createOccurrenceIfAbsent({
        userId,
        commitmentKind: s.kind,
        occurrenceDate: dateISO,
        kind: s.kind,
        mode: "ask",
        expectedAmount: s.amount,
        currency: bundle.baseCurrency,
      });
      if (!created) {
        out.errors += 1;
        continue;
      }
      if (!created.created) continue;
      out.occurrencesCreated += 1;
      out.asksCreated += 1;
    }
  }
}
