import type { OnboardingDraftPatch } from "@/lib/ai/onboarding/onboarding-conversation-contract";
import type {
  DebtAmountInterpretation,
  OnboardingDraft,
  OnboardingDraftAccount,
  OnboardingDraftContextNote,
  OnboardingDraftDebtAccount,
  OnboardingDraftFixedExpense,
  OnboardingDraftGoal,
  OnboardingDraftIncomeSource,
  OnboardingGoalArchetype,
} from "@/lib/onboarding/draft-types";
import type { OnboardingStep } from "@/lib/onboarding/steps";
import type { DebtAccountType } from "@/types/financial";

const VALID_ONBOARDING_STEPS = new Set<OnboardingStep>([
  "welcome",
  "profile",
  "accounts",
  "debt_accounts",
  "income_sources",
  "fixed_expenses",
  "goals",
  "coach_preferences",
  "review",
  "completed",
]);

interface DraftItemWithId {
  draftId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidStep(value: string): value is OnboardingStep {
  return VALID_ONBOARDING_STEPS.has(value as OnboardingStep);
}

function cloneDraft(draft: OnboardingDraft): OnboardingDraft {
  return {
    profile: { ...draft.profile },
    accounts: draft.accounts.map((item) => ({ ...item })),
    debtAccounts: draft.debtAccounts.map((item) => ({ ...item })),
    incomeSources: draft.incomeSources.map((item) => ({ ...item })),
    fixedExpenses: draft.fixedExpenses.map((item) => ({ ...item })),
    goals: draft.goals.map((item) => ({ ...item })),
    coachPreferences: { ...draft.coachPreferences },
    userContextNotes: draft.userContextNotes.map((note) => ({ ...note })),
    ...(draft.explicitlyEmptySteps
      ? { explicitlyEmptySteps: [...draft.explicitlyEmptySteps] }
      : {}),
  };
}

function mergeCollectionByDraftId<T extends DraftItemWithId>(
  current: T[],
  collectionPatch: unknown,
): T[] {
  if (!isRecord(collectionPatch)) {
    return current.map((item) => ({ ...item }));
  }

  const removeIds = new Set<string>();

  if (Array.isArray(collectionPatch.remove)) {
    for (const id of collectionPatch.remove) {
      if (typeof id === "string" && id.trim()) {
        removeIds.add(id);
      }
    }
  }

  const next = current
    .filter((item) => !removeIds.has(item.draftId))
    .map((item) => ({ ...item }));

  if (!Array.isArray(collectionPatch.upsert)) {
    return next;
  }

  const indexById = new Map(next.map((item, index) => [item.draftId, index]));

  for (const incoming of collectionPatch.upsert) {
    if (!isRecord(incoming)) {
      continue;
    }

    const draftId = incoming.draftId;
    if (typeof draftId !== "string" || !draftId.trim()) {
      continue;
    }

    const existingIndex = indexById.get(draftId);

    if (existingIndex !== undefined) {
      next[existingIndex] = { ...next[existingIndex], ...(incoming as T) };
      continue;
    }

    next.push({ ...(incoming as T) });
    indexById.set(draftId, next.length - 1);
  }

  return next;
}

function mergeUserContextNotes(
  current: OnboardingDraftContextNote[],
  incoming: unknown,
): OnboardingDraftContextNote[] {
  const notes = current.map((note) => ({ ...note }));
  const existingIds = new Set(notes.map((note) => note.draftId));

  if (!Array.isArray(incoming)) {
    return notes;
  }

  for (const note of incoming) {
    if (!isRecord(note)) {
      continue;
    }

    if (typeof note.draftId !== "string" || !note.draftId.trim()) {
      continue;
    }

    if (typeof note.content !== "string" || !note.content.trim()) {
      continue;
    }

    if (existingIds.has(note.draftId)) {
      continue;
    }

    const contextNote: OnboardingDraftContextNote = {
      draftId: note.draftId,
      content: note.content.trim(),
      createdAt:
        typeof note.createdAt === "string" && note.createdAt.trim()
          ? note.createdAt
          : new Date().toISOString(),
      ...(typeof note.noteType === "string"
        ? { noteType: note.noteType as OnboardingDraftContextNote["noteType"] }
        : {}),
      ...(note.source === "onboarding" ||
      note.source === "manual" ||
      note.source === "ai" ||
      note.source === "system"
        ? { source: note.source }
        : {}),
    };

    notes.push(contextNote);
    existingIds.add(note.draftId);
  }

  return notes;
}

function mergeExplicitlyEmptySteps(
  current: string[] | undefined,
  incoming: unknown,
): OnboardingStep[] | undefined {
  if (!Array.isArray(incoming)) {
    const validCurrent = (current ?? []).filter((step): step is OnboardingStep =>
      isValidStep(step),
    );
    return validCurrent.length > 0 ? validCurrent : undefined;
  }

  const merged = new Set<OnboardingStep>(
    (current ?? []).filter((step): step is OnboardingStep => isValidStep(step)),
  );

  for (const step of incoming) {
    if (typeof step === "string" && isValidStep(step)) {
      merged.add(step);
    }
  }

  return merged.size > 0 ? [...merged] : undefined;
}

function ensureMissingField(
  missingFields: string[] | undefined,
  field: string,
): string[] {
  const fields = missingFields ? [...missingFields] : [];
  if (!fields.includes(field)) {
    fields.push(field);
  }
  return fields;
}

function defaultGoalNameFromArchetype(
  archetype?: OnboardingGoalArchetype,
): string {
  switch (archetype) {
    case "organize_month":
      return "Ordenar mi mes";
    case "pay_down_debt":
      return "Bajar lo que debo";
    case "emergency_savings":
      return "Colchón de emergencia";
    case "specific_purchase":
    case "other":
    default:
      return "Meta principal";
  }
}

function inferDebtAccountType(debt: OnboardingDraftDebtAccount): DebtAccountType {
  if (debt.type) {
    return debt.type;
  }

  const name = (debt.name ?? "").toLowerCase();
  if (/tarjeta|card|visa|master|amex|diners|cr[eé]dito|credit/.test(name)) {
    return "credit_card";
  }

  return "other_debt";
}

function inferDebtAmountInterpretation(
  debt: OnboardingDraftDebtAccount,
): DebtAmountInterpretation | undefined {
  if (debt.amountInterpretation) {
    return debt.amountInterpretation;
  }

  const hasTotal = typeof debt.totalBalance === "number";
  const hasMin = typeof debt.minimumPayment === "number";
  const hasMonth = typeof debt.currentMonthPayment === "number";
  const hasAccum = typeof debt.accumulatedBalance === "number";
  const amountFieldCount = [hasTotal, hasMin, hasMonth, hasAccum].filter(Boolean).length;

  if (amountFieldCount === 0) {
    return undefined;
  }

  if (amountFieldCount === 1) {
    if (hasTotal || hasAccum) {
      return "total_balance";
    }
    if (hasMin) {
      return "minimum_payment";
    }
    if (hasMonth) {
      return "current_month_payment";
    }
  }

  return "unknown";
}

function normalizeAccount(account: OnboardingDraftAccount): OnboardingDraftAccount {
  const next: OnboardingDraftAccount = { ...account };

  if (next.name?.trim() && !next.type) {
    next.type = "bank";
  }

  if (typeof next.currentBalance !== "number") {
    next.missingFields = ensureMissingField(next.missingFields, "currentBalance");
  }

  return next;
}

function normalizeDebtAccount(
  debt: OnboardingDraftDebtAccount,
): OnboardingDraftDebtAccount {
  const next: OnboardingDraftDebtAccount = { ...debt };

  if (next.name?.trim() && !next.type) {
    next.type = inferDebtAccountType(next);
  }

  const interpretation = inferDebtAmountInterpretation(next);
  if (interpretation) {
    next.amountInterpretation = interpretation;
  }

  return next;
}

function normalizeIncomeSource(
  income: OnboardingDraftIncomeSource,
): OnboardingDraftIncomeSource {
  const next: OnboardingDraftIncomeSource = { ...income };
  const hasAmount =
    typeof next.amount === "number" ||
    typeof next.minExpectedAmount === "number" ||
    typeof next.maxExpectedAmount === "number";

  if ((next.name?.trim() || hasAmount) && !next.kind) {
    next.kind = "other";
  }

  if (hasAmount && !next.frequency) {
    next.frequency = "monthly";
  }

  return next;
}

function normalizeFixedExpense(
  expense: OnboardingDraftFixedExpense,
): OnboardingDraftFixedExpense {
  const next: OnboardingDraftFixedExpense = { ...expense };

  if (typeof next.amount === "number" && !next.name?.trim()) {
    next.name = "Gasto fijo";
  }

  return next;
}

function normalizeGoal(goal: OnboardingDraftGoal): OnboardingDraftGoal {
  const next: OnboardingDraftGoal = { ...goal };

  if (next.archetype && !next.name?.trim()) {
    next.name = defaultGoalNameFromArchetype(next.archetype);
  }

  return next;
}

function normalizeOnboardingDraft(draft: OnboardingDraft): OnboardingDraft {
  return {
    ...draft,
    accounts: draft.accounts.map(normalizeAccount),
    debtAccounts: draft.debtAccounts.map(normalizeDebtAccount),
    incomeSources: draft.incomeSources.map(normalizeIncomeSource),
    fixedExpenses: draft.fixedExpenses.map(normalizeFixedExpense),
    goals: draft.goals.map(normalizeGoal),
  };
}

export function applyOnboardingDraftPatch(
  draft: OnboardingDraft,
  patch: OnboardingDraftPatch,
): OnboardingDraft {
  if (!isRecord(patch) || Object.keys(patch).length === 0) {
    return normalizeOnboardingDraft(cloneDraft(draft));
  }

  const next = cloneDraft(draft);

  if (isRecord(patch.profile)) {
    next.profile = { ...next.profile, ...patch.profile };
  }

  if (patch.accounts !== undefined) {
    next.accounts = mergeCollectionByDraftId<OnboardingDraftAccount>(
      next.accounts,
      patch.accounts,
    );
  }

  if (patch.debtAccounts !== undefined) {
    next.debtAccounts = mergeCollectionByDraftId<OnboardingDraftDebtAccount>(
      next.debtAccounts,
      patch.debtAccounts,
    );
  }

  if (patch.incomeSources !== undefined) {
    next.incomeSources = mergeCollectionByDraftId<OnboardingDraftIncomeSource>(
      next.incomeSources,
      patch.incomeSources,
    );
  }

  if (patch.fixedExpenses !== undefined) {
    next.fixedExpenses = mergeCollectionByDraftId<OnboardingDraftFixedExpense>(
      next.fixedExpenses,
      patch.fixedExpenses,
    );
  }

  if (patch.goals !== undefined) {
    next.goals = mergeCollectionByDraftId<OnboardingDraftGoal>(
      next.goals,
      patch.goals,
    );
  }

  if (isRecord(patch.coachPreferences)) {
    next.coachPreferences = {
      ...next.coachPreferences,
      ...patch.coachPreferences,
    };
  }

  if (patch.userContextNotes !== undefined) {
    next.userContextNotes = mergeUserContextNotes(
      next.userContextNotes,
      patch.userContextNotes,
    );
  }

  if (patch.markStepsExplicitlyEmpty !== undefined) {
    next.explicitlyEmptySteps = mergeExplicitlyEmptySteps(
      next.explicitlyEmptySteps,
      patch.markStepsExplicitlyEmpty,
    );
  }

  return normalizeOnboardingDraft(next);
}
