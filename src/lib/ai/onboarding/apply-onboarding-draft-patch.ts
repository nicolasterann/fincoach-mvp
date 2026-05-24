import type { OnboardingDraftPatch } from "@/lib/ai/onboarding/onboarding-conversation-contract";
import type {
  OnboardingDraft,
  OnboardingDraftAccount,
  OnboardingDraftContextNote,
  OnboardingDraftDebtAccount,
  OnboardingDraftFixedExpense,
  OnboardingDraftGoal,
  OnboardingDraftIncomeSource,
} from "@/lib/onboarding/draft-types";
import type { OnboardingStep } from "@/lib/onboarding/steps";

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

export function applyOnboardingDraftPatch(
  draft: OnboardingDraft,
  patch: OnboardingDraftPatch,
): OnboardingDraft {
  if (!isRecord(patch) || Object.keys(patch).length === 0) {
    return cloneDraft(draft);
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

  return next;
}
