"use server";

import { redirect } from "next/navigation";
import OpenAI from "openai";
import type {
  OnboardingDraftAccount,
  OnboardingDraftDebtAccount,
  OnboardingDraftFixedExpense,
  OnboardingDraftGoal,
  OnboardingDraftIncomeSource,
  OnboardingDraftSavingsPlan,
  OnboardingGoalArchetype,
} from "@/lib/onboarding/draft-types";
import { insertSavingsPlansForUser } from "@/lib/financial/savings-plans-store";
import {
  seedMonthISO,
  type OnboardingDraftAsset,
  type OnboardingDraftV2,
} from "@/lib/onboarding/wizard-model";
import { isDebtPayoffGoalWithoutAmount } from "@/lib/onboarding/onboarding-guards";
import { GOAL_DEFAULT_NAMES } from "@/lib/onboarding/wizard-constants";
import { resolveOnboardingCoachTone } from "@/lib/onboarding/normalize-coach-tone";
import { loadFxRates, upsertFxRate } from "@/lib/fx/fx-store";
import { convert } from "@/lib/fx/fx-rates";
import {
  createScheduledChange,
  type ScheduledCadence,
  type ScheduledChangeKind,
  type ScheduledTargetType,
} from "@/lib/scheduled/scheduled-changes-store";
import { setPersonalizationPref } from "@/lib/financial/personalization-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  AccountType,
  DebtAccountType,
  FinancialCategory,
  PaymentFrequency,
  PaymentSourceType,
} from "@/types/financial";

function redirectOnError(message: string): never {
  redirect(`/onboarding?message=${encodeURIComponent(message)}`);
}

// S31 (4.1) — a DB failure must reach the user as a human Spanish message that
// names WHAT couldn't be saved (the wizard renders it verbatim), with the raw
// detail attached for support — never a bare English DB string, never a generic
// "algo falló" with the real reason swallowed.
function redirectOnDbError(
  what: string,
  error: { message?: string | null } | null,
): never {
  const detail = (error?.message ?? "").trim().slice(0, 160);
  redirectOnError(
    `No pude guardar ${what} — tus respuestas siguen aquí, reintenta en un momento.${
      detail ? ` Detalle técnico: ${detail}` : ""
    }`,
  );
}

// S31 (5.1d) — the honest-FX ask, shared by the up-front gate and the in-loop
// belt-and-suspenders checks (goal contribution conversion).
function fxAskMessage(baseUpper: string, missing: string[]): string {
  return `Tienes montos en ${missing.join(", ")} y tu moneda principal es ${baseUpper}. En el paso "¿Cómo quieres que Kipu te hable?" dime el tipo de cambio (ej. "1 ${baseUpper} = 1480 ${missing[0]}") para guardar tus números bien — Kipu nunca inventa una tasa.`;
}

function isReviewableAccount(account: OnboardingDraftAccount): boolean {
  const name = account.name?.trim();
  if (!name || name === "Cuenta") return false;
  return true;
}

function debtHasAmount(debt: OnboardingDraftDebtAccount): boolean {
  return (
    debt.totalBalance !== undefined ||
    debt.minimumPayment !== undefined ||
    debt.currentMonthPayment !== undefined ||
    debt.accumulatedBalance !== undefined
  );
}

function isReviewableDebt(debt: OnboardingDraftDebtAccount): boolean {
  const name = debt.name?.trim();
  const hasMeaningfulName = Boolean(name && name !== "Deuda");
  return hasMeaningfulName || debtHasAmount(debt);
}

function isReviewableGoal(goal: OnboardingDraftGoal): boolean {
  if (goal.name === "Mi meta" && goal.targetAmount === undefined) return false;
  if (isDebtPayoffGoalWithoutAmount(goal.name, goal.targetAmount)) return false;
  const hasRealName = Boolean(goal.name && goal.name !== "Mi meta");
  const hasArchetype = goal.archetype !== undefined;
  if (!hasRealName && !hasArchetype) return false;

  // Savings/purchase/emergency/pay-down-debt goals need a target amount to
  // be usable by the goal engine (feasibility, weekly/monthly required).
  // organize_month is the only archetype that legitimately has no amount.
  const isMoneyGoal = goal.archetype !== "organize_month";
  if (isMoneyGoal && goal.targetAmount === undefined) return false;

  return true;
}

function isReviewableIncome(income: OnboardingDraftIncomeSource): boolean {
  // An income source is only usable (and only persisted) once it carries an amount —
  // consistent with expenses/goals. A name-only entry would persist as 0 and feed a
  // fake paycheck into Margen/cashflow; better not to save it until the amount is known.
  return income.amount !== undefined || income.minExpectedAmount !== undefined;
}

function isReviewableExpense(expense: OnboardingDraftFixedExpense): boolean {
  return expense.amount !== undefined;
}

// S31 (4.7) — single source of truth for goal fallback names: the exported map
// the wizard/review/reviewability already use. This fallback only fires on
// drafts with an empty name (buildOnboardingDraft never emits one), but if it
// ever fires it must match what the user saw on the review screen.
function defaultGoalName(archetype?: OnboardingGoalArchetype): string {
  return GOAL_DEFAULT_NAMES[archetype ?? "other"] ?? GOAL_DEFAULT_NAMES.other;
}

function inferDebtType(debt: OnboardingDraftDebtAccount): DebtAccountType {
  if (debt.type) return debt.type;

  const name = (debt.name ?? "").toLowerCase();
  if (/tarjeta|card|visa|master|amex|cr[eé]dito|credit/.test(name)) {
    return "credit_card";
  }

  return "other_debt";
}

function validDay(day: number | undefined): number | null {
  return day !== undefined && day >= 1 && day <= 31 ? day : null;
}

// Resolve a fixed expense's draft payment-source link to the real inserted
// account/debt id. Returns nulls when unresolved (so a dangling link never
// blocks the insert). Powers Margen Kipu's payment-source awareness.
function resolveFixedExpenseSource(
  expense: OnboardingDraftFixedExpense,
  accountIdByDraft: Map<string, string>,
  debtIdByDraft: Map<string, string>,
): { type: PaymentSourceType | null; id: string | null } {
  const draftId = expense.paymentSourceDraftId;
  if (!draftId) return { type: null, id: null };
  if (expense.paymentSourceType === "debt_account") {
    const id = debtIdByDraft.get(draftId);
    return id ? { type: "debt_account", id } : { type: null, id: null };
  }
  const id = accountIdByDraft.get(draftId);
  return id ? { type: "account", id } : { type: null, id: null };
}

function validWeekday(weekday: number | undefined): number | null {
  return weekday !== undefined && weekday >= 0 && weekday <= 6 ? weekday : null;
}

function normalizeAccountType(type: string | undefined): AccountType {
  if (
    type === "bank" ||
    type === "cash" ||
    type === "wallet" ||
    type === "goal_account"
  ) {
    return type;
  }
  return "bank";
}

function normalizeFrequency(frequency: string | undefined): PaymentFrequency {
  if (
    frequency === "weekly" ||
    frequency === "biweekly" ||
    frequency === "monthly" ||
    frequency === "yearly" ||
    frequency === "custom"
  ) {
    return frequency;
  }
  return "monthly";
}

// investment_accounts.asset_class is free-form text; keep it to the documented set
// (cash|investment|fixed_term|crypto|property|vehicle|business|receivable|other) so
// net-worth.ts can narrow it. Unknown → "other" (still counted in net worth).
function normalizeAssetClass(assetClass: string | undefined): string {
  const valid = new Set([
    "cash",
    "investment",
    "fixed_term",
    "crypto",
    "property",
    "vehicle",
    "business",
    "receivable",
    "other",
  ]);
  const v = (assetClass ?? "").trim().toLowerCase();
  return valid.has(v) ? v : "other";
}

function normalizeCategory(category: string | undefined): FinancialCategory {
  const valid: FinancialCategory[] = [
    "housing",
    "utilities",
    "food",
    "transport",
    "health",
    "education",
    "subscriptions",
    "debt",
    "shopping",
    "entertainment",
    "family",
    "savings",
    "income",
    "travel",
    "other",
  ];
  if (category && valid.includes(category as FinancialCategory)) {
    return category as FinancialCategory;
  }
  return "other";
}

// S31 (1.2) — wizard archetype → goals.archetype (migration 025 vocabulary:
// savings|travel|purchase|emergency|debt_payoff|investment|wealth|family|
// lifestyle|custom). Unlocks emergency-reserve math, purchase nudges and
// goal-portfolio classification for onboarding goals.
const GOAL_ARCHETYPE_DB: Record<OnboardingGoalArchetype, string> = {
  emergency_savings: "emergency",
  specific_purchase: "purchase",
  pay_down_debt: "debt_payoff",
  organize_month: "custom",
  other: "custom",
};

const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function approxEndLabel(now: Date, monthsAhead: number): string {
  const d = new Date(now.getFullYear(), now.getMonth() + monthsAhead, 1);
  return `${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}`;
}

// House money style: two decimals only when cents exist, integer otherwise.
function formatAmountPlain(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// S31 (2.4) — one memory row per sentence/fact instead of a monolithic blob:
// each fact survives digest caps independently and classifies cleaner in the
// notes→action pass. Short notes pass through unchanged.
function splitNoteSentences(content: string): string[] {
  const parts = content
    .split(/(?<=[.!?…])\s+|\n+|;\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  return parts.length > 0 ? parts : [content.trim()];
}

// ── S31 (2.1) — notes → action (best-effort post-save pass) ──────────────────
// Every per-row "Nota para Kipu" + the global note runs through ONE small LLM
// call that ONLY classifies ({none | reminder(date) | recurring_change(...)});
// deterministic code validates every field and creates `scheduled_changes` rows
// via the typed store. The daily cron applies them later — NOTHING mutates an
// amount at save time, and a failure here never breaks onboarding.

interface OnboardingNoteForAction {
  idx: number;
  entityKind: "account" | "debt" | "fixed_expense" | "income" | "goal" | "asset" | "global";
  entityName: string;
  text: string;
  /** Set only for schedulable targets (fixed_expense | income_source | goal). */
  targetType: Extract<ScheduledTargetType, "income_source" | "fixed_expense" | "goal"> | null;
  targetId: string | null;
  /** The target row's own currency (set_amount plans must match it). */
  currency: string | null;
}

const EXTRACTION_CADENCES = new Set<ScheduledCadence>([
  "once",
  "monthly",
  "quarterly",
  "semiannual",
  "yearly",
]);

function noteExtractionSystemPrompt(todayISO: string): string {
  return `
You read notes a user wrote during financial onboarding with Kipu (a personal finance coach). Each note belongs to an entity (an account, a debt/card, a fixed expense, an income source, a goal, an asset) or is a global note. Decide, for EACH note independently, whether it implies a FUTURE, time-anchored action. You ONLY classify; deterministic code validates and writes. Today is ${todayISO}. Notes are natural LatAm Spanish — interpret intent, not fixed phrases.

For each input note (by idx), output one item:
- "action":
  - "recurring_change": the note states an EXPLICIT percent or an EXPLICIT new amount for the entity, with resolvable timing (e.g. "sube 2.5% cada 3 meses desde agosto", "desde enero pago 550"). A stated number with an approximation marker ("~2.5%", "como 550") still counts as explicit. A direction WITHOUT a number ("sube con la inflación", "va a subir") is NOT explicit.
  - "reminder": the note implies something should happen or be checked at a resolvable future date, but the amount/percent is missing or vague, or the kind of change is unclear (e.g. "en agosto renegocio el contrato", "revisar la tasa en diciembre", "me suben el sueldo en enero" without the new amount).
  - "none": no future time-anchored implication (descriptions, preferences, past facts, aliases).
- "dateISO": the FIRST future date the action applies, as YYYY-MM-DD, resolved deterministically relative to today: a month name without a year → day 1 of the NEXT occurrence of that month (strictly after today); "en N meses" → day 1 of the month N months from today; an explicit day/date → that date. null when no date can be resolved — and then action MUST be "none".
- "changeKind": "adjust_percent" when a percent is stated | "set_amount" when a new absolute amount is stated | null otherwise.
- "amount": the percent as a plain number (2.5 for "2.5%") or the new absolute amount. null when not explicit. NEVER invent it.
- "cadence": how it repeats — "once" | "monthly" | "quarterly" ("cada 3 meses") | "semiannual" | "yearly". "once" when it happens a single time or you are unsure.
- "confidence": 0..1.

When in doubt between recurring_change and reminder, choose reminder. When in doubt between reminder and none, choose none. NEVER invent amounts, percents or dates.

Respond with STRICT JSON only:
{"items":[{"idx":number,"action":"none"|"reminder"|"recurring_change","dateISO":string|null,"changeKind":"adjust_percent"|"set_amount"|null,"amount":number|null,"cadence":"once"|"monthly"|"quarterly"|"semiannual"|"yearly"|null,"confidence":number}]}
`;
}

async function runOnboardingNotesToActions(
  userId: string,
  notes: OnboardingNoteForAction[],
  now: Date,
): Promise<void> {
  if (notes.length === 0) return;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  const todayISO = now.toISOString().slice(0, 10);
  const maxISO = `${now.getUTCFullYear() + 3}${todayISO.slice(4)}`;
  const client = new OpenAI({ apiKey, timeout: 20000 });
  const model = process.env.OPENAI_TRANSACTION_PARSER_MODEL ?? "gpt-5.4-mini";

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: noteExtractionSystemPrompt(todayISO) },
      {
        role: "user",
        content: JSON.stringify({
          today: todayISO,
          notes: notes.slice(0, 30).map((n) => ({
            idx: n.idx,
            entity: n.entityKind,
            name: n.entityName,
            note: n.text.slice(0, 400),
          })),
        }),
      },
    ],
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) return;
  const parsed = JSON.parse(content) as { items?: unknown };
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const byIdx = new Map(notes.map((n) => [n.idx, n]));

  let created = 0;
  const createdLog: Record<string, unknown>[] = [];
  for (const raw of items) {
    if (created >= 10) break;
    const it = raw as Record<string, unknown>;
    const src = typeof it.idx === "number" ? byIdx.get(it.idx) : undefined;
    if (!src) continue;
    const action =
      it.action === "reminder" || it.action === "recurring_change" ? it.action : "none";
    if (action === "none") continue;
    // Deterministic guards: real ISO date, today-or-future, capped at 3 years.
    const date =
      typeof it.dateISO === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.dateISO)
        ? it.dateISO
        : null;
    if (!date || date < todayISO || date > maxISO) continue;
    const cadence = EXTRACTION_CADENCES.has(it.cadence as ScheduledCadence)
      ? (it.cadence as ScheduledCadence)
      : "once";
    const changeKind =
      it.changeKind === "adjust_percent" || it.changeKind === "set_amount"
        ? (it.changeKind as ScheduledChangeKind)
        : null;
    const amount =
      typeof it.amount === "number" && Number.isFinite(it.amount) ? it.amount : null;
    const confidence = typeof it.confidence === "number" ? it.confidence : 0;
    // A real amount change ONLY when the note was explicit: schedulable target,
    // valid kind, sane amount, high confidence. Everything else degrades to a
    // reminder — Kipu asks that day instead of guessing a money movement.
    const explicitChange =
      action === "recurring_change" &&
      src.targetType !== null &&
      src.targetId !== null &&
      changeKind !== null &&
      amount !== null &&
      (changeKind === "adjust_percent"
        ? amount !== 0 && Math.abs(amount) <= 100
        : amount > 0) &&
      confidence >= 0.75;

    // Reminders always use targetType "reminder": the cron's reminder path keys
    // off targetType (an entity-typed row with changeKind "reminder" would fall
    // into the amount branch and fail). The entity id still travels in target_id.
    const res = explicitChange
      ? await createScheduledChange(userId, {
          targetType: src.targetType as ScheduledTargetType,
          targetId: src.targetId,
          targetLabel: src.entityName,
          changeKind: changeKind as ScheduledChangeKind,
          amount,
          currency: changeKind === "set_amount" ? src.currency : null,
          effectiveDate: date,
          cadence,
          note: src.text.slice(0, 300),
        })
      : await createScheduledChange(userId, {
          targetType: "reminder",
          targetId: src.targetId,
          targetLabel: src.entityName,
          changeKind: "reminder",
          amount: null,
          currency: null,
          effectiveDate: date,
          cadence,
          note: src.text.slice(0, 300),
        });
    if (res.ok) {
      created += 1;
      createdLog.push({
        kind: explicitChange ? changeKind : "reminder",
        entity: src.entityKind,
        label: src.entityName,
        date,
        cadence,
        ...(explicitChange ? { amount } : {}),
      });
    }
  }
  if (createdLog.length > 0) {
    console.info("[kipu.onboarding.notes-actions] created", JSON.stringify(createdLog));
  }
}

export async function saveOnboardingDraftAction(draft: OnboardingDraftV2) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const userId = session.user.id;
  const baseCurrency = draft.profile.baseCurrency ?? "USD";
  const resolvedTone = resolveOnboardingCoachTone(draft);

  // Double-completion guard (Stage 11): re-running a finished onboarding used
  // to duplicate income sources/accounts. If this user already completed
  // onboarding AND has financial data, never insert again — send them home.
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", userId)
    .maybeSingle();
  if (existingProfile?.onboarding_completed) {
    const { count: existingAccounts } = await supabase
      .from("accounts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((existingAccounts ?? 0) > 0) {
      redirect("/app?message=onboarding-already-completed");
    }
  }

  // S34 — idempotent retry: the inserts below run sequentially without a
  // transaction, so a transient mid-save failure leaves N rows behind with
  // onboarding_completed still false; the retry the error message asks for used
  // to re-insert everything (double balances, double income, double goals).
  // Before the first insert, clear the structure rows a previous PARTIAL attempt
  // created. Scope-guarded three ways: only when onboarding_completed=false
  // (a finished user never reaches here — the guard above redirects), only
  // structure tables (the transactions ledger is append-only and untouched), and
  // only this user's rows. budget_categories/fx upsert idempotently already.
  if (!existingProfile?.onboarding_completed) {
    const structureTables = [
      // Stage 38 — savings_plans FIRST: it FK-references accounts/investment_accounts
      // (on delete set null), and it's configuration (not the append-only ledger), so
      // a re-onboarding must clear it too or a partial retry duplicates reserves.
      "savings_plans",
      "fixed_expenses",
      "income_sources",
      "goals",
      "investment_accounts",
      "debt_accounts",
      "accounts",
    ] as const;
    for (const table of structureTables) {
      const { error: wipeError } = await supabase.from(table).delete().eq("user_id", userId);
      if (wipeError) {
        // Non-fatal (e.g. an FK from a ledger row): the insert path continues as
        // before; worst case matches today's behavior instead of blocking.
        console.error(`onboarding retry-wipe ${table} failed:`, wipeError.code, wipeError.message);
      }
    }
  }

  // onboarding_completed is set at the END (after every insert succeeded): marking
  // it here and failing a later insert would strand the user in a permanent
  // /app <-> /onboarding redirect loop (completed=true but no goal/accounts).
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: draft.profile.fullName?.trim() || null,
      country: draft.profile.country?.trim() || null,
      base_currency: baseCurrency,
      tone_preference: resolvedTone,
    })
    .eq("id", userId);

  if (profileError) {
    redirectOnDbError("tu perfil", profileError);
  }

  // Shared save-time clock (statement stamp, loan end estimate, note extraction).
  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);
  // Derived memory rows (no-debts confirmation, loan cuotas, recovery notes)
  // collected along the way and merged into the user_context_notes insert.
  const extraContextNotes: string[] = [];
  // Per-row notes + their inserted entity ids, for the notes→action pass (2.1).
  const notesForActions: OnboardingNoteForAction[] = [];
  const noteForAction = (
    entityKind: OnboardingNoteForAction["entityKind"],
    entityName: string,
    text: string | undefined,
    target?: { type: OnboardingNoteForAction["targetType"]; id: string | null; currency: string | null },
  ) => {
    const t = text?.trim();
    if (!t) return;
    notesForActions.push({
      idx: notesForActions.length,
      entityKind,
      entityName,
      text: t,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      currency: target?.currency ?? null,
    });
  };

  // FX first (Stage 24, multi-rate since S31 5.1c): every manual reference rate must
  // exist BEFORE we write account/debt base amounts, so a non-base balance is
  // converted honestly instead of stored at an implicit rate 1 (which would pollute
  // every base-currency total). Best-effort.
  const draftFxRates =
    Array.isArray(draft.fxRates) && draft.fxRates.length > 0
      ? draft.fxRates
      : draft.fxRate
        ? [draft.fxRate]
        : [];
  for (const r of draftFxRates) {
    if (r && Number.isFinite(r.rate) && r.rate > 0) {
      await upsertFxRate(userId, r.from, r.to, r.rate, "manual");
    }
  }
  const fxRates = await loadFxRates(userId);
  const baseUpper = baseCurrency.trim().toUpperCase();
  // Honest-FX gate: if any money item is in another currency and we have NO known
  // rate for that pair, STOP with a friendly ask instead of writing a base figure
  // that pretends foreign = base (that lie would poison Margen and every total).
  // S31 (5.1d): covers accounts, debts, incomes, expenses, assets, GOALS and the
  // budget-estimate currency — and only counts rows that actually carry an amount
  // (a currency picked on an amount-less row can't lie, so it must not block).
  // Declared-currency set (also reused below to auto-seed per-currency cash accounts).
  const usedCurrencies = new Set<string>();
  {
    const hasAmt = (n: number | undefined): boolean =>
      n !== undefined && Number.isFinite(n) && n !== 0;
    const addCur = (currency: string | undefined) =>
      usedCurrencies.add((currency ?? baseCurrency).trim().toUpperCase());
    for (const a of draft.accounts.filter(isReviewableAccount)) {
      if (hasAmt(a.currentBalance)) addCur(a.currency);
    }
    for (const d of draft.debtAccounts.filter(isReviewableDebt)) {
      if (
        hasAmt(d.totalBalance) ||
        hasAmt(d.minimumPayment) ||
        hasAmt(d.currentMonthPayment) ||
        hasAmt(d.accumulatedBalance)
      ) {
        addCur(d.currency);
      }
    }
    for (const i of draft.incomeSources.filter(isReviewableIncome)) {
      if (hasAmt(i.amount) || hasAmt(i.minExpectedAmount) || hasAmt(i.maxExpectedAmount)) addCur(i.currency);
    }
    for (const e of draft.fixedExpenses.filter(isReviewableExpense)) {
      if (hasAmt(e.amount)) addCur(e.currency);
    }
    for (const g of draft.goals.filter(isReviewableGoal)) {
      if (hasAmt(g.targetAmount) || hasAmt(g.currentAmount) || hasAmt(g.monthlyContribution)) addCur(g.currency);
    }
    for (const a of draft.assets ?? []) {
      if (hasAmt(a.value)) addCur(a.currency);
    }
    // Budget-estimate currency (defensive: agent-B threads it in parallel). When
    // the client couldn't convert, estimates arrive dropped — gating on the raw
    // currency gives the user the rate instead of silently losing them.
    const v2extra = draft as {
      categoryBudgetCurrency?: string;
      categoryBudgetsRaw?: { amount?: number }[];
    };
    const budgetCurrency = (v2extra.categoryBudgetCurrency ?? "").trim().toUpperCase();
    const hasBudgetAmounts =
      (draft.categoryBudgets ?? []).some((cb) => Number.isFinite(cb.amount) && cb.amount > 0) ||
      (v2extra.categoryBudgetsRaw ?? []).some(
        (cb) => typeof cb.amount === "number" && Number.isFinite(cb.amount) && cb.amount > 0,
      );
    if (budgetCurrency && budgetCurrency !== baseUpper && hasBudgetAmounts) {
      usedCurrencies.add(budgetCurrency);
    }
    const missing = [...usedCurrencies].filter(
      (c) => c !== baseUpper && !convert(1, c, baseUpper, fxRates).ok,
    );
    if (missing.length > 0) {
      redirectOnError(fxAskMessage(baseUpper, missing));
    }
  }
  // Convert an original balance to base using ONLY a known rate. Same currency → trivially
  // identical. No known rate → keep the original figure (unchanged from today's behavior);
  // we never fabricate a rate-1 base that pretends a foreign amount equals the base.
  const toBase = (amount: number, currency: string | undefined): number => {
    const from = (currency ?? baseCurrency).trim().toUpperCase();
    if (from === baseUpper) return amount;
    const res = convert(amount, from, baseCurrency, fxRates);
    return res.ok ? res.baseAmount : amount;
  };

  // Insert accounts and debts one at a time so we can map each draft item to its
  // real inserted id. This is what makes payment sources, the goal account, the
  // income destination, and default-payment accounts persist correctly (they
  // were previously hardcoded to null — a real data-loss bug that broke Margen
  // Kipu's payment-source awareness).
  const accountIdByDraft = new Map<string, string>();
  const debtIdByDraft = new Map<string, string>();

  const reviewableAccounts = draft.accounts.filter(isReviewableAccount);
  for (const account of reviewableAccounts) {
    const type = normalizeAccountType(account.type);
    const balance = account.currentBalance ?? 0;
    const { data, error } = await supabase
      .from("accounts")
      .insert({
        user_id: userId,
        name: account.name!.trim(),
        type,
        currency: account.currency ?? baseCurrency,
        current_balance_original: balance,
        current_balance_base: toBase(balance, account.currency),
        is_goal_account: Boolean(account.isGoalAccount) || type === "goal_account",
        liquidity: account.liquidity === "non_liquid" ? "non_liquid" : "liquid",
        // Stage 30 (#8) — per-row note to Kipu (migration 035).
        notes: account.notes?.trim() || null,
      })
      .select("id")
      .single();
    if (error) {
      redirectOnDbError(`tu cuenta "${account.name!.trim()}"`, error);
    }
    if (data?.id && account.draftId) {
      accountIdByDraft.set(account.draftId, data.id);
    }
    // Account notes can't schedule amount changes (accounts aren't a
    // scheduled-change target) — they still classify into dated reminders.
    noteForAction("account", account.name!.trim(), account.notes);
  }

  // A1 (PRODUCT FIX 1) — auto-seed one cash account per DECLARED currency, so foreign
  // cash never has to land in a base-currency "Efectivo" (which silently mislabels peso
  // cash as USD). The base-currency Efectivo already exists (wizard default); we only add
  // the ADDITIONAL declared currencies that don't already have a cash account, at 0.
  {
    const cashCurrencies = new Set(
      reviewableAccounts
        .filter((a) => normalizeAccountType(a.type) === "cash")
        .map((a) => (a.currency ?? baseCurrency).trim().toUpperCase()),
    );
    for (const cur of usedCurrencies) {
      if (cashCurrencies.has(cur)) continue;
      // Best-effort: an auto-seeded convenience account must NEVER block the user's real
      // onboarding data (unlike a user-entered account, which redirects on error).
      const { error } = await supabase.from("accounts").insert({
        user_id: userId,
        name: cur === baseUpper ? "Efectivo" : `Efectivo ${cur}`,
        type: "cash",
        currency: cur,
        current_balance_original: 0,
        current_balance_base: 0,
        is_goal_account: false,
        liquidity: "liquid",
      });
      if (!error) cashCurrencies.add(cur);
    }
  }

  const reviewableDebts = draft.debtAccounts.filter(isReviewableDebt);
  for (const debt of reviewableDebts) {
    const balance =
      debt.totalBalance ??
      debt.currentMonthPayment ??
      debt.accumulatedBalance ??
      debt.minimumPayment ??
      0;
    const defaultPaymentAccountId = debt.defaultPaymentAccountDraftId
      ? accountIdByDraft.get(debt.defaultPaymentAccountDraftId) ?? null
      : null;
    const debtName = debt.name?.trim() || "Deuda";
    const buildDebtRow = (withStatementDate: boolean) => ({
      user_id: userId,
      name: debtName,
      type: inferDebtType(debt),
      currency: debt.currency ?? baseCurrency,
      current_balance_original: balance,
      current_balance_base: toBase(balance, debt.currency),
      // S34 (fixes S31 5.2's over-correction) — minimum_payment/full_payment_due
      // persist in the DEBT'S OWN currency: the context builder normalizes them to
      // base exactly ONCE ("Engine-base normalization"), and the agent's writers
      // also store native amounts. Converting here made the builder divide an
      // already-base figure a second time (148.000 ARS -> 100$ saved -> 0.07$ read).
      minimum_payment: debt.minimumPayment ?? null,
      full_payment_due: debt.currentMonthPayment ?? null,
      due_day: validDay(debt.dueDay),
      cutoff_day: validDay(debt.cutoffDay),
      interest_rate: debt.interestRate ?? null,
      default_payment_account_id: defaultPaymentAccountId,
      // Stage 30 (#8) — per-row note to Kipu (migration 035).
      notes: debt.notes?.trim() || null,
      // S31 (5.8) — the user just told us this month's obligation: stamp the
      // statement as of today so the figure isn't re-asserted every future cycle
      // and stale_statement can actually fire.
      ...(withStatementDate && debt.currentMonthPayment !== undefined
        ? { statement_date: todayISO }
        : {}),
    });
    let { data, error } = await supabase
      .from("debt_accounts")
      .insert(buildDebtRow(true))
      .select("id")
      .single();
    const unknownColumn =
      error != null &&
      (error.code === "PGRST204" ||
        error.code === "42703" ||
        /statement_date|schema cache/i.test(error.message ?? ""));
    if (unknownColumn) {
      ({ data, error } = await supabase
        .from("debt_accounts")
        .insert(buildDebtRow(false))
        .select("id")
        .single());
    }
    if (error) {
      redirectOnDbError(`tu deuda "${debtName}"`, error);
    }
    if (data?.id && debt.draftId) {
      debtIdByDraft.set(debt.draftId, data.id);
    }
    // Debt notes → dated reminders only (debts aren't a scheduled-change target).
    noteForAction("debt", debtName, debt.notes);
    // S31 (1.4) — loan "cuotas que faltan" becomes durable memory (defensive read:
    // agent B threads installmentsRemaining into the draft in parallel).
    const rawInstallments = (debt as { installmentsRemaining?: number | string })
      .installmentsRemaining;
    const installments =
      typeof rawInstallments === "number"
        ? rawInstallments
        : typeof rawInstallments === "string"
          ? Number.parseInt(rawInstallments.trim(), 10)
          : NaN;
    const cuota = debt.currentMonthPayment ?? debt.minimumPayment;
    if (
      Number.isInteger(installments) &&
      installments > 0 &&
      installments <= 600 &&
      cuota !== undefined &&
      cuota > 0
    ) {
      const cur = (debt.currency ?? baseCurrency).trim().toUpperCase();
      const amountLabel =
        cur === baseUpper ? `${formatAmountPlain(cuota)}$` : `${formatAmountPlain(cuota)} ${cur}`;
      extraContextNotes.push(
        `Al préstamo "${debtName}" le faltan ${installments} cuotas de ${amountLabel} — terminaría aprox. en ${approxEndLabel(now, installments)}.`,
      );
    }
  }

  const reviewableGoals = draft.goals.filter(isReviewableGoal);
  let goalsInsertedCount = 0;
  // Stage 30 (#7) + S31 (W2 fix) — the monthly contribution the user COMMITTED in
  // the allocation step reserves money: persist contribution_amount + monthly
  // cadence + cashflow_protected so the engine treats it as protected. Inserted
  // ONE ROW AT A TIME with homogeneous keys: the previous bulk insert mixed rows
  // with and without the Stage-17 keys, PostgREST filled the missing
  // cashflow_protected (NOT NULL) with null, and the resulting error message
  // matched the schema-guard regex — silently retrying WITHOUT the contribution.
  // That is exactly the live-verified "20$/mes shown in review, NULL in goals".
  for (const goal of reviewableGoals) {
    const goalName = goal.name?.trim() || defaultGoalName(goal.archetype);
    const goalCurrency = (goal.currency ?? baseCurrency).trim().toUpperCase();
    const monthly = goal.monthlyContribution;
    // S31 (5.3) — the contribution was typed/previewed in BASE currency; the goal
    // row (and the engine reading contribution_amount) is in the GOAL's currency.
    // Convert with a KNOWN rate so the engine protects the number the user
    // approved; with no rate we stop with the FX ask — never persist a silently
    // re-denominated amount, never drop it silently.
    let contribution: number | null = null;
    if (typeof monthly === "number" && monthly > 0) {
      if (goalCurrency === baseUpper) {
        contribution = monthly;
      } else {
        const res = convert(monthly, baseUpper, goalCurrency, fxRates);
        if (!res.ok) {
          redirectOnError(fxAskMessage(baseUpper, [goalCurrency]));
        }
        contribution = res.baseAmount;
      }
    }
    const buildGoalRow = (withStage17: boolean) => ({
      user_id: userId,
      name: goalName,
      target_amount: goal.targetAmount ?? 0,
      current_amount: goal.currentAmount ?? 0,
      currency: goal.currency ?? baseCurrency,
      target_date: goal.targetDate ?? null,
      goal_account_id: goal.goalAccountDraftId
        ? accountIdByDraft.get(goal.goalAccountDraftId) ?? null
        : null,
      status: "active" as const,
      feasibility_status: "challenging" as const,
      weekly_required_amount: 0,
      monthly_required_amount: 0,
      // Stage 30 (#8) — per-row note to Kipu (migration 035).
      notes: goal.notes?.trim() || null,
      // Stage 17 columns (migration 025), guarded so a pre-Stage-17 schema still
      // completes onboarding (retry without them). S31 (1.2): the archetype the
      // wizard captured finally reaches the DB — emergency-reserve math, purchase
      // nudges and portfolio classification key off it.
      ...(withStage17
        ? {
            ...(goal.archetype ? { archetype: GOAL_ARCHETYPE_DB[goal.archetype] } : {}),
            contribution_amount: contribution,
            cadence: contribution !== null ? ("monthly" as const) : null,
            cashflow_protected: true,
          }
        : {}),
    });

    let { data, error } = await supabase
      .from("goals")
      .insert(buildGoalRow(true))
      .select("id")
      .single();
    const unknownColumn =
      error != null &&
      (error.code === "PGRST204" ||
        error.code === "42703" ||
        /archetype|contribution_amount|cadence|cashflow_protected|schema cache/i.test(
          error.message ?? "",
        ));
    if (unknownColumn) {
      ({ data, error } = await supabase
        .from("goals")
        .insert(buildGoalRow(false))
        .select("id")
        .single());
    }
    if (error) {
      redirectOnDbError(`tu meta "${goalName}"`, error);
    }
    goalsInsertedCount += 1;
    noteForAction("goal", goalName, goal.notes, {
      type: "goal",
      id: data?.id ? String(data.id) : null,
      currency: goalCurrency,
    });
  }

  const reviewableIncome = draft.incomeSources.filter(isReviewableIncome);
  let incomesInsertedCount = 0;
  for (const income of reviewableIncome) {
    const incomeName = income.name?.trim() || "Ingreso";
    const buildIncomeRow = (withAnchor: boolean) => ({
      user_id: userId,
      name: incomeName,
      amount: income.amount ?? income.minExpectedAmount ?? 0,
      currency: income.currency ?? baseCurrency,
      frequency: normalizeFrequency(income.frequency),
      expected_day: validDay(income.expectedDay),
      expected_weekday: validWeekday(income.expectedWeekday),
      is_variable:
        Boolean(income.isVariable) ||
        income.minExpectedAmount !== undefined ||
        income.maxExpectedAmount !== undefined,
      // A2 (migration 043) — occasional/windfall income, excluded from the monthly plan.
      is_occasional: Boolean(income.isOccasional),
      min_expected_amount: income.minExpectedAmount ?? null,
      max_expected_amount: income.maxExpectedAmount ?? null,
      destination_account_id: income.destinationAccountDraftId
        ? accountIdByDraft.get(income.destinationAccountDraftId) ?? null
        : null,
      status: "active" as const,
      // S31 — per-row "Nota para Kipu" (income_sources.notes pre-exists; the
      // wizard's income NoteField lands via agent B's draft plumbing).
      notes: income.notes?.trim() || null,
      // Stage 24: only present when the column exists (migration 032 applied).
      ...(withAnchor ? { pay_anchor_date: income.payAnchorDate ?? null } : {}),
    });

    // Insert WITH the anchor. If migration 032 isn't applied yet, PostgREST rejects the
    // unknown column (nothing is written on a schema error), so we retry WITHOUT it —
    // onboarding still completes and the optional payday is simply not persisted until
    // the migration lands. A real (non-schema) error surfaces via redirectOnDbError, so
    // a transient failure never silently drops the anchor post-migration.
    let { data, error } = await supabase
      .from("income_sources")
      .insert(buildIncomeRow(true))
      .select("id")
      .single();
    const unknownColumn =
      error != null &&
      (error.code === "PGRST204" ||
        error.code === "42703" ||
        /pay_anchor_date|schema cache/i.test(error.message ?? ""));
    if (unknownColumn) {
      ({ data, error } = await supabase
        .from("income_sources")
        .insert(buildIncomeRow(false))
        .select("id")
        .single());
    }
    if (error) {
      redirectOnDbError(`tu ingreso "${incomeName}"`, error);
    }
    incomesInsertedCount += 1;
    noteForAction("income", incomeName, income.notes, {
      type: "income_source",
      id: data?.id ? String(data.id) : null,
      currency: (income.currency ?? baseCurrency).trim().toUpperCase(),
    });
  }

  const reviewableExpenses = draft.fixedExpenses.filter(isReviewableExpense);
  let expensesInsertedCount = 0;
  for (const expense of reviewableExpenses) {
    const expenseName = expense.name?.trim() || "Gasto fijo";
    // Stage 30 (#2) — is_variable marks month-to-month expenses (gas, luz) so the
    // engine confirms them. S32 (Item C) — pay_anchor_date phases weekly/biweekly
    // expenses to the user's real payment date (migration 038). Both guarded like
    // the income anchor: unknown-column → retry with progressively fewer new
    // columns (anchor first, then is_variable) so onboarding always completes.
    const buildExpenseRow = (withVariable: boolean, withAnchor: boolean) => {
      const source = resolveFixedExpenseSource(expense, accountIdByDraft, debtIdByDraft);
      return {
        user_id: userId,
        name: expenseName,
        amount: expense.amount!,
        currency: expense.currency ?? baseCurrency,
        category: normalizeCategory(expense.category),
        frequency: normalizeFrequency(expense.frequency),
        expected_day: validDay(expense.expectedDay),
        expected_weekday: validWeekday(expense.expectedWeekday),
        payment_source_type: source.type,
        payment_source_id: source.id,
        is_essential: expense.isEssential ?? true,
        is_active: true,
        notes: expense.notes?.trim() || null,
        ...(withVariable
          ? { is_variable: Boolean((expense as { isVariable?: boolean }).isVariable) }
          : {}),
        ...(withAnchor ? { pay_anchor_date: expense.payAnchorDate ?? null } : {}),
      };
    };
    const isUnknownColumn = (e: { code?: string; message?: string | null } | null) =>
      e != null &&
      (e.code === "PGRST204" ||
        e.code === "42703" ||
        /is_variable|pay_anchor_date|schema cache/i.test(e.message ?? ""));

    let { data, error } = await supabase
      .from("fixed_expenses")
      .insert(buildExpenseRow(true, true))
      .select("id")
      .single();
    if (isUnknownColumn(error)) {
      ({ data, error } = await supabase
        .from("fixed_expenses")
        .insert(buildExpenseRow(true, false))
        .select("id")
        .single());
    }
    if (isUnknownColumn(error)) {
      ({ data, error } = await supabase
        .from("fixed_expenses")
        .insert(buildExpenseRow(false, false))
        .select("id")
        .single());
    }
    if (error) {
      redirectOnDbError(`tu gasto fijo "${expenseName}"`, error);
    }
    expensesInsertedCount += 1;
    noteForAction("fixed_expense", expenseName, expense.notes, {
      type: "fixed_expense",
      id: data?.id ? String(data.id) : null,
      currency: (expense.currency ?? baseCurrency).trim().toUpperCase(),
    });
  }

  // Assets / investments (Stage 30 #6) → public.investment_accounts (Stage 17
  // table). An asset is patrimonio, NEVER spendable money: it feeds net worth and
  // never raises the Margen. Best-effort — assets are additive net-worth data, not
  // a gate for entering the app, so a failure here must not strand the user. NOTE:
  // investment_accounts needs authenticated CRUD policies for this user-session
  // write to land (see migration 036_stage30_assets_rls.sql). Until that migration
  // is applied, RLS silently rejects the insert and the rest of onboarding still
  // completes; the asset can be re-added from the app afterwards.
  const reviewableAssets = (draft.assets ?? []).filter(
    (a) => (a.name?.trim().length ?? 0) > 0 || a.value !== undefined,
  );
  let assetsInsertedCount = 0;
  // Stage 38 — a reserve's destination can be an asset (etoro, póliza…); map each
  // inserted asset's draft id to its real id so savings_plans can point at it.
  const assetIdByDraft = new Map<string, string>();
  if (reviewableAssets.length > 0) {
    // Stage 38 — generate each asset's id CLIENT-SIDE so a reserve destination pointing
    // at an asset maps to the exact real id, without relying on the (not-guaranteed)
    // order of a bulk INSERT ... RETURNING. The map is committed only on insert success.
    const assetDraftToId = new Map<string, string>();
    const assetRows = reviewableAssets.map((asset: OnboardingDraftAsset) => {
      const value = asset.value ?? 0;
      const id = crypto.randomUUID();
      if (asset.draftId) assetDraftToId.set(asset.draftId, id);
      return {
        id,
        user_id: userId,
        name: asset.name?.trim() || "Activo",
        asset_class: normalizeAssetClass(asset.assetClass),
        value_base: toBase(value, asset.currency),
        // S31/037 — preserve the amount as the user stated it (asset's own currency),
        // mirroring the ledger's original_*/base_* convention.
        value_original: value,
        currency: asset.currency ?? baseCurrency,
        liquid: Boolean(asset.liquid),
        include_in_net_worth: asset.includeInNetWorth !== false,
        expected_return_pct:
          asset.expectedReturnPct !== undefined && asset.expectedReturnPct >= 0
            ? asset.expectedReturnPct
            : null,
        notes: asset.notes?.trim() || null,
      };
    });
    // S31 (5.9) — still best-effort (assets never block entering the app), but no
    // longer SILENT: log the failure and leave a recovery note the agent reads,
    // so Kipu can ask the user to re-add what was lost instead of nobody knowing.
    const { data: insertedAssets, error: assetError } = await supabase
      .from("investment_accounts")
      .insert(assetRows)
      .select("id");
    if (assetError) {
      console.error(
        "[kipu.onboarding] asset insert failed:",
        assetError.code,
        assetError.message,
      );
      const names = assetRows.map((r) => `"${r.name}"`).join(", ");
      extraContextNotes.push(
        `Los activos que el usuario registró en el onboarding (${names}) no se pudieron guardar por un error técnico. Kipu: pídele con tacto volver a registrarlos desde el chat.`,
      );
    } else {
      assetsInsertedCount = insertedAssets?.length ?? 0;
      // Ids were client-generated → the draft→real-id map is exact (no order assumption).
      for (const [draftId, realId] of assetDraftToId) assetIdByDraft.set(draftId, realId);
      // Asset notes → dated reminders only (assets aren't a scheduled-change target).
      for (const asset of reviewableAssets) {
        noteForAction("asset", asset.name?.trim() || "Activo", asset.notes);
      }
    }
  }

  // Stage 38 — reserves become scheduled, account-linked savings_plans. Each row lands
  // on its real date in the financial calendar (like a debt payment). The aggregate
  // monthly_savings/investment_commitment columns below are the SUMMED monthly-
  // equivalent of these SAME rows (profile.monthly* from sumReservesByKind), so
  // capacity and the per-plan calendar never double-count. Best-effort: a reserve
  // failing to persist must not strand the user (mirrors the assets contract).
  const draftSavingsPlans = (draft as { savingsPlans?: OnboardingDraftSavingsPlan[] }).savingsPlans ?? [];
  if (draftSavingsPlans.length > 0) {
    const planInputs = draftSavingsPlans
      .filter((p) => p.amount > 0)
      .map((p) => {
        // Destination is an account OR an asset (or neither → default at read time).
        const destAccountId = p.destinationDraftId ? accountIdByDraft.get(p.destinationDraftId) ?? null : null;
        const destAssetId =
          p.destinationDraftId && !destAccountId ? assetIdByDraft.get(p.destinationDraftId) ?? null : null;
        return {
          userId,
          kind: p.kind,
          amountBase: p.amount,
          originalAmount: p.originalAmount ?? p.amount,
          originalCurrency: p.originalCurrency ?? baseCurrency,
          baseCurrency,
          frequency: p.frequency ?? "monthly",
          expectedDay: p.expectedDay ?? null,
          payAnchorDate: p.payAnchorDate ?? null,
          destinationAccountId: destAccountId,
          destinationAssetId: destAssetId,
        };
      });
    const { error: plansError } = await insertSavingsPlansForUser(planInputs);
    if (plansError) {
      console.error("[kipu.onboarding] savings_plans insert failed:", plansError);
      extraContextNotes.push(
        "Los planes de ahorro/inversión que el usuario configuró en el onboarding no se pudieron guardar por un error técnico. Kipu: pídele con tacto volver a configurarlos desde el chat. Sus totales mensuales sí quedaron registrados.",
      );
    }
  }

  const { error: coachError } = await supabase.from("coach_preferences").upsert(
    {
      user_id: userId,
      tone: resolvedTone,
      strictness_level:
        draft.coachPreferences.strictnessLevel ??
        draft.profile.strictnessLevel ??
        "balanced",
      humor_level: draft.coachPreferences.humorLevel ?? "medium",
      detail_level: draft.coachPreferences.detailLevel ?? "short",
      proactive_alerts_enabled:
        draft.coachPreferences.proactiveAlertsEnabled ?? true,
      weekly_review_enabled:
        draft.coachPreferences.weeklyReviewEnabled ?? true,
      daily_checkin_enabled:
        draft.coachPreferences.dailyCheckinEnabled ?? true,
      preferred_language:
        draft.coachPreferences.preferredLanguage ??
        draft.profile.preferredLanguage ??
        "es",
      notes: draft.coachPreferences.notes ?? null,
    },
    { onConflict: "user_id" },
  );

  if (coachError) {
    redirectOnDbError("tus preferencias", coachError);
  }

  // S31 (1.9, cheap version) — the strictness answer stops being a dead knob:
  // seed nudge sensitivity through the existing guarded personalization upsert
  // (relaxed → low, strict → high; balanced keeps the adaptive default).
  {
    const strictness =
      draft.coachPreferences.strictnessLevel ?? draft.profile.strictnessLevel;
    const nudgeSensitivity =
      strictness === "relaxed" ? ("low" as const) : strictness === "strict" ? ("high" as const) : null;
    if (nudgeSensitivity) {
      await setPersonalizationPref(userId, { nudgeSensitivity });
    }
  }

  // Financial preferences (Stage 6/7): the Margen Kipu saving/investing &
  // essential-spending reservations, plus the default payment source so the
  // agent can pick a source when the user doesn't name one. Only written when we
  // actually learned something.
  const prefsPatch: Record<string, number | string> = {};
  if (draft.profile.monthlySavings !== undefined && draft.profile.monthlySavings >= 0) {
    prefsPatch.monthly_savings_commitment = draft.profile.monthlySavings;
  }
  if (draft.profile.monthlyInvestment !== undefined && draft.profile.monthlyInvestment >= 0) {
    prefsPatch.monthly_investment_commitment = draft.profile.monthlyInvestment;
  }
  if (
    draft.profile.essentialMonthlyEstimate !== undefined &&
    draft.profile.essentialMonthlyEstimate >= 0
  ) {
    prefsPatch.essential_monthly_estimate = draft.profile.essentialMonthlyEstimate;
  }

  // Default payment source = the primary day-to-day account, resolved to its real
  // id. S31 (5.7): prefer LIQUID non-goal accounts — "isPrimary" is silently the
  // first account added, and defaulting everyday spend to a protected savings pot
  // would drain exactly the money the user asked Kipu to guard. Non-liquid only
  // remains as the last resort when it's all the user has.
  const primaryDraft =
    reviewableAccounts.find(
      (a) => a.isPrimary && !a.isGoalAccount && a.liquidity !== "non_liquid",
    ) ??
    reviewableAccounts.find((a) => !a.isGoalAccount && a.liquidity !== "non_liquid") ??
    reviewableAccounts.find((a) => a.isPrimary && !a.isGoalAccount) ??
    reviewableAccounts.find((a) => !a.isGoalAccount);
  const primaryAccountId = primaryDraft?.draftId
    ? accountIdByDraft.get(primaryDraft.draftId)
    : undefined;
  if (primaryAccountId) {
    prefsPatch.default_source_type = "account";
    prefsPatch.default_source_id = primaryAccountId;
  }

  if (Object.keys(prefsPatch).length > 0) {
    const { error: prefsError } = await supabase
      .from("user_financial_preferences")
      .upsert({ user_id: userId, ...prefsPatch }, { onConflict: "user_id" });
    if (prefsError) {
      redirectOnDbError("tus preferencias financieras", prefsError);
    }
  }

  // Onboarding memory (Stage 11.3): everything the user said that doesn't fit
  // a structured row — "el arriendo sube cada tres meses", "los servicios
  // varían 20–80", "también quiere bajar su deuda" — becomes learned context
  // the agent reads from day one. Best-effort: memory must never block the
  // financial save.
  const VALID_NOTE_TYPES = new Set([
    "general",
    "preference",
    "constraint",
    "goal_context",
    "risk_context",
    "behavior_pattern",
  ]);
  // S31 (1.8) — "No tengo deudas 🎉" is a FACT worth remembering, not an absence:
  // without it, an empty debts table is ambiguous (never asked? confirmed none?).
  if (
    (draft.explicitlyEmptySteps ?? []).includes("debt_accounts") &&
    reviewableDebts.length === 0
  ) {
    extraContextNotes.push(
      "El usuario confirmó en el onboarding que no tiene deudas ni tarjetas.",
    );
  }
  // S31 (2.4) — split each captured note into one row per sentence/fact (≤20,
  // each ≤200 chars) instead of one monolithic blob: facts survive digest caps
  // independently and classify cleaner in the notes→action pass.
  const contextNotes = draft.userContextNotes
    .filter((note) => note.content?.trim())
    .flatMap((note) =>
      splitNoteSentences(note.content.trim()).map((sentence) => ({
        user_id: userId,
        note_type: VALID_NOTE_TYPES.has(note.noteType ?? "")
          ? (note.noteType as string)
          : "general",
        content: sentence.slice(0, 200),
        source: "onboarding",
        is_active: true,
      })),
    )
    .slice(0, 20);
  for (const extra of extraContextNotes.slice(0, 6)) {
    contextNotes.push({
      user_id: userId,
      note_type: "general",
      content: extra.slice(0, 300),
      source: "onboarding",
      is_active: true,
    });
  }
  if (contextNotes.length > 0) {
    const { error: notesError } = await supabase
      .from("user_context_notes")
      .insert(contextNotes);
    if (notesError) {
      // Memory must never block the financial save — but don't lose it silently.
      console.error(
        "[kipu.onboarding] context notes insert failed:",
        notesError.code,
        notesError.message,
      );
    }
  }
  // The global/free-form notes also run through the notes→action pass (2.1) —
  // they can't target an entity, so at most they become dated reminders.
  for (const note of draft.userContextNotes) {
    noteForAction("global", "Nota del onboarding", note.content);
  }

  // Per-category variable-spend estimates (Stage 23). budget_categories has
  // authenticated CRUD, so the user's own session client can write them. Kipu
  // refines each category from real spend over time; the sum already fed the
  // Margen via essential_monthly_estimate above (no double count).
  // S32 — each estimate can carry a month-to-date SEED ("ya gasté 400 de comida
  // este mes"), already converted to base with the SAME rate as the amount.
  // mtd_seed + seed_month (first day of the current month — migration 038) let
  // the engine reserve only what REMAINS of the month. Schema-guarded like the
  // other new columns, with HOMOGENEOUS keys across rows (the S31 goals lesson:
  // mixed-key bulk writes silently drop data).
  const categoryBudgets = (draft.categoryBudgets ?? []).filter((cb) => cb.amount >= 0);
  if (categoryBudgets.length > 0) {
    // S34 — anchor the seed to the CLIENT's month when provided ("¿ya gastaste
    // algo ESTE mes?" means the month the user saw), not the server's UTC month.
    const clientSeedMonth = (draft as { clientSeedMonth?: string }).clientSeedMonth;
    const seedMonth =
      typeof clientSeedMonth === "string" && /^\d{4}-\d{2}-01$/.test(clientSeedMonth)
        ? clientSeedMonth
        : seedMonthISO(now);
    const buildBudgetRows = (withSeed: boolean) =>
      categoryBudgets.map((cb) => {
        const seed =
          typeof cb.mtdSeed === "number" && Number.isFinite(cb.mtdSeed) && cb.mtdSeed > 0
            ? cb.mtdSeed
            : null;
        return {
          user_id: userId,
          category: cb.category,
          amount: cb.amount,
          currency: baseCurrency,
          period: "monthly",
          is_active: true,
          ...(withSeed ? { mtd_seed: seed, seed_month: seed !== null ? seedMonth : null } : {}),
        };
      });
    const hasSeeds = categoryBudgets.some(
      (cb) => typeof cb.mtdSeed === "number" && Number.isFinite(cb.mtdSeed) && cb.mtdSeed > 0,
    );
    let { error: budgetError } = await supabase
      .from("budget_categories")
      .upsert(buildBudgetRows(hasSeeds), { onConflict: "user_id,category,period" });
    const unknownSeedColumn =
      hasSeeds &&
      budgetError != null &&
      (budgetError.code === "PGRST204" ||
        budgetError.code === "42703" ||
        /mtd_seed|seed_month|schema cache/i.test(budgetError.message ?? ""));
    if (unknownSeedColumn) {
      ({ error: budgetError } = await supabase
        .from("budget_categories")
        .upsert(buildBudgetRows(false), { onConflict: "user_id,category,period" }));
    }
    if (budgetError) {
      redirectOnDbError("tus estimados por categoría", budgetError);
    }
  }

  // Manual reference FX rates are written FIRST (see the FX-first block above) so
  // the account/debt base amounts convert against them.

  // S31 (5.9) — post-save sanity check: what we inserted must equal what the
  // review screen showed. Log-only (never blocks the user); a mismatch here is a
  // silent-data-loss bug to chase, not the user's problem.
  {
    const sanity = {
      accounts: { expected: reviewableAccounts.length, inserted: accountIdByDraft.size },
      debts: { expected: reviewableDebts.length, inserted: debtIdByDraft.size },
      goals: { expected: reviewableGoals.length, inserted: goalsInsertedCount },
      incomes: { expected: reviewableIncome.length, inserted: incomesInsertedCount },
      expenses: { expected: reviewableExpenses.length, inserted: expensesInsertedCount },
      assets: { expected: reviewableAssets.length, inserted: assetsInsertedCount },
    };
    const mismatch = Object.values(sanity).some((s) => s.inserted !== s.expected);
    if (mismatch) {
      console.warn("[kipu.onboarding.sanity] insert-count mismatch", JSON.stringify(sanity));
    }
  }

  // Everything the /app gate needs exists now — only then mark onboarding done.
  const { error: completeError } = await supabase
    .from("profiles")
    .update({ onboarding_completed: true })
    .eq("id", userId);
  if (completeError) {
    redirectOnDbError("el cierre del onboarding", completeError);
  }

  // S31 (2.1) — notes → action, the last step: onboarding is fully committed, so
  // a failure here can never strand the user. One LLM call CLASSIFIES the notes;
  // typed code creates pending scheduled_changes/reminders the daily cron applies
  // later. No amount is ever mutated at save time.
  try {
    await runOnboardingNotesToActions(userId, notesForActions, now);
  } catch (error) {
    console.error(
      "[kipu.onboarding.notes-actions] failed:",
      error instanceof Error ? error.message : String(error),
    );
  }

  redirect("/app?message=onboarding-completed");
}
