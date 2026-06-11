import type {
  OnboardingDraft,
  OnboardingDraftDebtAccount,
} from "@/lib/onboarding/draft-types";
import type { OnboardingDraftPatch } from "@/lib/ai/onboarding/onboarding-conversation-contract";

// Deterministic guards around the conversational onboarding (Stage 11.2).
// Pure functions so the loop-breaker and the structured debt editor can be
// QA'd without any AI call — the card/debt clarification loop must be
// impossible to ship again.

// ── Stall / clarification-loop breaker ───────────────────────────────────────

// A turn "stalls" when the AI answered but produced NO draft change and NO
// step advance inside a collection step — i.e. it is only re-asking. Two
// consecutive stalls = a loop; the client then forces a calm move-on instead
// of letting the user fight the model.
export const STALL_BREAK_THRESHOLD = 2;

export function isDraftUnchanged(a: OnboardingDraft, b: OnboardingDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function countStalledTurn(input: {
  previousStalls: number;
  draftChanged: boolean;
  stepAdvanced: boolean;
  isCollectionStep: boolean;
}): number {
  if (input.draftChanged || input.stepAdvanced || !input.isCollectionStep) return 0;
  return input.previousStalls + 1;
}

export function shouldBreakStall(stalledTurns: number): boolean {
  return stalledTurns >= STALL_BREAK_THRESHOLD;
}

export const STALL_BREAK_PREFIX =
  "Mejor no nos enredamos con esto: lo dejo apuntado tal como me lo contaste y lo afinas en la revisión final cuando quieras. Sigamos. ";

// ── AI-first advance decision ────────────────────────────────────────────────

// The same principle as the daily agent: the AI is the human↔code translator
// (it decides whether "ahí estamos ok", "dale", "hasta ahí" means "advance");
// deterministic code validates SEED QUALITY only — never phrasing. There is no
// phrase list here on purpose: if the model proposes advancing and the step's
// draft data meets the minimum seed, we advance. The only legitimate vetoes
// are data-quality vetoes.
export function resolveCollectionAdvance(input: {
  /** The AI proposed moving to the immediate next step this turn. */
  aiProposedAdvance: boolean;
  /** Deterministic seed check over the DRAFT (isStepComplete). */
  stepComplete: boolean;
  /** The patch explicitly marked this step as empty ("no tengo deudas"). */
  markedEmptyByPatch: boolean;
  /** Fallback signals (legacy closure regex / prior confirmation). Only used
   *  when the AI did NOT propose anything — never to veto the AI. */
  userClosedFallback: boolean;
}): "advance" | "stay" {
  if (input.markedEmptyByPatch) return "advance";
  if (!input.stepComplete) return "stay";
  if (input.aiProposedAdvance) return "advance";
  return input.userClosedFallback ? "advance" : "stay";
}

// ── Goal hygiene ─────────────────────────────────────────────────────────────

// "Pagar la tarjeta/deuda" is NOT a savings goal: debts are already mapped in
// debt_accounts and planned there. A dead "monto por definir" payoff goal in
// the review/persistence erodes trust (field QA). Shared by the review filter
// and the save filter so they can never disagree again.
export function isDebtPayoffGoalWithoutAmount(
  name: string | undefined,
  targetAmount: number | undefined,
): boolean {
  const lower = (name ?? "").toLowerCase();
  const looksLikePayoff =
    /\b(pagar|bajar|salir de|liquidar)\b.*\b(deuda|tarjeta|pr[eé]stamo)\b|\b(deuda|tarjeta)\b.*\b(pagar|bajar)\b/.test(
      lower,
    );
  return looksLikePayoff && (targetAmount ?? 0) <= 0;
}

// ── Structured debt quick-form → deterministic patch ─────────────────────────

export type DebtAmountKind = "total" | "month" | "minimum";

export interface DebtQuickFormRow {
  /** Existing draftId to update, or empty/undefined to create a new item. */
  draftId?: string;
  name: string;
  /** False = the card exists but owes nothing right now. */
  hasDebt: boolean;
  amount?: number;
  kind: DebtAmountKind;
  dueDay?: number;
}

function validDay(day: number | undefined): number | undefined {
  return day !== undefined && Number.isFinite(day) && day >= 1 && day <= 31
    ? Math.round(day)
    : undefined;
}

// Builds the exact upsert patch for the quick form. No AI involved: the
// attribution (amount→card) and interpretation (total/month/minimum) come
// straight from the structured rows, so the QA loop class cannot happen here.
export function buildDebtQuickFormPatch(
  rows: DebtQuickFormRow[],
  existing: OnboardingDraft["debtAccounts"],
): OnboardingDraftPatch {
  const upsert: OnboardingDraftDebtAccount[] = [];

  rows.forEach((row, index) => {
    const name = row.name.trim();
    if (!name) return;
    const prior = existing.find((d) => d.draftId === row.draftId);
    const draftId = row.draftId?.trim() || `debt-form-${Date.now()}-${index}`;

    const item: OnboardingDraftDebtAccount = {
      ...(prior ?? {}),
      draftId,
      name,
      type: prior?.type ?? "credit_card",
      isConfirmed: true,
      confidence: "high",
    };

    if (!row.hasDebt || !row.amount || row.amount <= 0) {
      // Card exists, owes nothing: clear amounts explicitly so a stale value
      // never survives the user saying "no debo nada".
      item.totalBalance = 0;
      item.minimumPayment = undefined;
      item.currentMonthPayment = undefined;
      item.amountInterpretation = "total_balance";
    } else if (row.kind === "total") {
      item.totalBalance = row.amount;
      item.amountInterpretation = "total_balance";
    } else if (row.kind === "month") {
      item.currentMonthPayment = row.amount;
      item.amountInterpretation = "current_month_payment";
    } else {
      item.minimumPayment = row.amount;
      item.amountInterpretation = "minimum_payment";
    }

    const due = validDay(row.dueDay);
    if (due !== undefined) item.dueDay = due;

    upsert.push(item);
  });

  return upsert.length > 0 ? { debtAccounts: { upsert } } : {};
}

// Human one-line summary for the chat confirmation after applying the form.
export function describeDebtQuickFormResult(rows: DebtQuickFormRow[]): string {
  const parts = rows
    .filter((r) => r.name.trim())
    .map((r) => {
      if (!r.hasDebt || !r.amount || r.amount <= 0) return `${r.name.trim()} sin deuda`;
      const kind =
        r.kind === "total" ? "debes" : r.kind === "month" ? "este mes" : "mínimo";
      return `${r.name.trim()} ${kind} ${r.amount}`;
    });
  return parts.join(", ");
}
