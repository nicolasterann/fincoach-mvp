"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useTransition,
} from "react";
import { processOnboardingTurnAction } from "./ai-actions";
import { saveOnboardingDraftAction } from "./save-actions";
import { DebtQuickForm } from "./DebtQuickForm";
import { buildDraftMargenPreview } from "@/lib/onboarding/draft-margen-preview";
import {
  buildDebtQuickFormPatch,
  countStalledTurn,
  describeDebtQuickFormResult,
  isDebtPayoffGoalWithoutAmount,
  isDraftUnchanged,
  resolveCollectionAdvance,
  shouldBreakStall,
  STALL_BREAK_PREFIX,
  type DebtQuickFormRow,
} from "@/lib/onboarding/onboarding-guards";
import { formatKipuMoney } from "@/lib/financial/money";
import type { CurrencyCode } from "@/types/financial";
import { applyOnboardingDraftPatch } from "@/lib/ai/onboarding/apply-onboarding-draft-patch";
import type {
  OnboardingDraftPatch,
  OnboardingTurnOutput,
} from "@/lib/ai/onboarding/onboarding-conversation-contract";
import { ONBOARDING_STEP_METADATA } from "@/lib/onboarding/step-metadata";
import { ONBOARDING_STEP_ORDER } from "@/lib/onboarding/steps";
import type { OnboardingStep } from "@/lib/onboarding/steps";
import {
  createInitialOnboardingConversationState,
  getNextOnboardingStep,
  getOnboardingProgress,
  isStepComplete,
} from "@/lib/onboarding/helpers";
import type { OnboardingConversationState } from "@/lib/onboarding/conversation-state";
import type {
  OnboardingDraft,
  DebtAmountInterpretation,
  OnboardingIncomeKind,
  OnboardingGoalArchetype,
} from "@/lib/onboarding/draft-types";
import {
  applyCoachToneFromUserMessage,
  normalizeCoachTone,
} from "@/lib/onboarding/normalize-coach-tone";

// ── Props ──────────────────────────────────────────────────────────────────

export type InterviewProfile = {
  full_name: string | null;
  country: string | null;
  base_currency: string;
  tone_preference: string;
  onboarding_completed: boolean;
};

export type InterviewAccount = {
  id: string;
  name: string;
  type: string;
  currency: string;
  current_balance_base: number;
  is_goal_account: boolean;
};

export type InterviewDebtAccount = {
  id: string;
  name: string;
  type: string;
  currency: string;
  current_balance_base: number;
  due_day: number | null;
};

export type InterviewGoal = {
  id: string;
  name: string;
  target_amount: number;
  currency: string;
  current_amount: number;
  target_date: string | null;
  status: string;
  goal_account_id: string | null;
};

export interface OnboardingInterviewProps {
  initialProfile: InterviewProfile;
  initialAccounts: InterviewAccount[];
  initialDebtAccounts: InterviewDebtAccount[];
  initialGoals: InterviewGoal[];
  userEmail: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const PROGRESS_STEPS = ONBOARDING_STEP_ORDER.filter(
  (s) => s !== "completed",
) as OnboardingStep[];

// Collection steps that require explicit user confirmation before advancing
const COLLECTION_STEPS = new Set<OnboardingStep>([
  "accounts",
  "debt_accounts",
  "income_sources",
  "fixed_expenses",
  "goals",
]);

// Local copy overrides — do not modify src/lib/onboarding/step-metadata.ts here.
// These replace or supplement the metadata's primaryQuestion for specific steps.
const STEP_QUESTION_OVERRIDES: Partial<Record<OnboardingStep, string>> = {
  accounts:
    "¿En qué cuentas o lugares guardas tu dinero hoy? Sé que esta parte puede dar un poco de pereza, pero vale la pena hacerla bien una vez. Dame el nombre y un saldo aproximado realista; no tiene que ser perfecto, pero sí lo más completo posible.",
  coach_preferences:
    "Para que esto funcione bien, lo ideal es que me cuentes cada día lo importante: un gasto, un ingreso, un pago. No tiene que ser perfecto; mensajes cortos bastan. ¿Cómo prefieres que te lo recuerde: con tono relajado, directo o un poco más juguetón?",
};

function getStepQuestion(step: OnboardingStep): string {
  return STEP_QUESTION_OVERRIDES[step] ?? ONBOARDING_STEP_METADATA[step].primaryQuestion;
}

// ── Local types ────────────────────────────────────────────────────────────

type DisplayMessage = { id: string; role: "kipu" | "user"; text: string };

type ConfirmedCollectionSteps = Partial<Record<OnboardingStep, boolean>>;

type PanelGoal = { name: string; current: number; target: number; currency: string };

type ResponseCtx = {
  prevStep: OnboardingStep;
  nextStep: OnboardingStep;
  draft: OnboardingDraft;
  prevDraft: OnboardingDraft;
  markedEmpty: boolean;
  probingTurn: number;
};

type LocalMockTurnResult = {
  finalState: OnboardingConversationState;
  response: string;
  newConfirmed: ConfirmedCollectionSteps;
};

function isPatchEmpty(patch: OnboardingTurnOutput["patch"]): boolean {
  return !patch || Object.keys(patch).length === 0;
}

// Drop keys whose value is undefined or null. Used to prevent AI patches
// from accidentally wiping existing fields via shallow merge — e.g. a
// follow-up patch that adds totalBalance to an existing debt MUST NOT
// also send minimumPayment: undefined, since the shallow merge in
// applyOnboardingDraftPatch would then clear the previously-captured value.
function stripNullishKeys<T extends Record<string, unknown>>(obj: T): T {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      cleaned[key] = value;
    }
  }
  return cleaned as T;
}

function stripNullishFromCollection<T extends { draftId?: string }>(
  collectionPatch:
    | { upsert?: T[]; remove?: string[] }
    | undefined,
): { upsert?: T[]; remove?: string[] } | undefined {
  if (!collectionPatch) return collectionPatch;
  const next: { upsert?: T[]; remove?: string[] } = {};
  if (Array.isArray(collectionPatch.upsert)) {
    next.upsert = collectionPatch.upsert.map(
      (item) =>
        stripNullishKeys(item as unknown as Record<string, unknown>) as unknown as T,
    );
  }
  if (Array.isArray(collectionPatch.remove)) {
    next.remove = collectionPatch.remove;
  }
  return next;
}

// Filter AI patches so the AI cannot mark future or past steps as empty
// (only the current step is allowed in markStepsExplicitlyEmpty), and so
// that nullish keys in upsert items cannot wipe existing draft fields.
function sanitizeAiPatchForCurrentStep(
  patch: OnboardingTurnOutput["patch"],
  currentStep: OnboardingStep,
): OnboardingTurnOutput["patch"] {
  if (!patch || Object.keys(patch).length === 0) return {};

  const sanitized: OnboardingTurnOutput["patch"] = { ...patch };

  if (patch.markStepsExplicitlyEmpty !== undefined) {
    const filtered = patch.markStepsExplicitlyEmpty.filter(
      (step) => step === currentStep,
    );
    if (filtered.length > 0) {
      sanitized.markStepsExplicitlyEmpty = filtered;
    } else {
      delete sanitized.markStepsExplicitlyEmpty;
    }
  }

  if (patch.profile) {
    sanitized.profile = stripNullishKeys(patch.profile);
  }
  if (patch.coachPreferences) {
    const cleaned = stripNullishKeys(patch.coachPreferences) as Record<
      string,
      unknown
    >;
    if (cleaned.tone !== undefined) {
      const normalized = normalizeCoachTone(String(cleaned.tone));
      if (normalized) {
        cleaned.tone = normalized;
      } else {
        delete cleaned.tone;
      }
    }
    sanitized.coachPreferences = cleaned as typeof patch.coachPreferences;
  }
  if (patch.accounts) {
    sanitized.accounts = stripNullishFromCollection(patch.accounts);
  }
  if (patch.debtAccounts) {
    sanitized.debtAccounts = stripNullishFromCollection(patch.debtAccounts);
  }
  if (patch.incomeSources) {
    sanitized.incomeSources = stripNullishFromCollection(patch.incomeSources);
  }
  if (patch.fixedExpenses) {
    sanitized.fixedExpenses = stripNullishFromCollection(patch.fixedExpenses);
  }
  if (patch.goals) {
    sanitized.goals = stripNullishFromCollection(patch.goals);
  }

  return sanitized;
}

function isUsefulAiResult(result: OnboardingTurnOutput): boolean {
  const message =
    typeof result.assistantMessage === "string" ? result.assistantMessage.trim() : "";
  const patchEmpty = isPatchEmpty(result.patch);
  const isFailureOrFallbackMessage =
    message.toLowerCase().includes("modo mock local") ||
    message.toLowerCase().includes("modo básico") ||
    message.toLowerCase().includes("ia de onboarding") ||
    message.toLowerCase().includes("no pude conectar") ||
    message.toLowerCase().includes("no pude usar la ia") ||
    message.toLowerCase().includes("sigamos con el modo básico");

  if (isFailureOrFallbackMessage && patchEmpty && result.confidenceScore === 0) {
    return false;
  }

  if (!message && patchEmpty) {
    return false;
  }

  if (!message && !patchEmpty) {
    return true;
  }

  return result.confidenceScore !== 0 || !patchEmpty || !isFailureOrFallbackMessage;
}

function resolveAiAssistantMessage(result: OnboardingTurnOutput): string {
  const trimmed = result.assistantMessage?.trim();
  if (trimmed) {
    return trimmed;
  }

  if (!isPatchEmpty(result.patch)) {
    return "Listo, lo tengo. Sigamos.";
  }

  return "";
}

function isLaterStepByExactlyOne(
  current: OnboardingStep,
  proposed: OnboardingStep,
): boolean {
  const currentIndex = ONBOARDING_STEP_ORDER.indexOf(current);
  const proposedIndex = ONBOARDING_STEP_ORDER.indexOf(proposed);
  return proposedIndex === currentIndex + 1;
}

const LATER_STEP_MESSAGE_HINTS: Partial<Record<OnboardingStep, RegExp>> = {
  debt_accounts: /\bdeud|tarjet|pr[eé]stam|visa|mastercard|amex|cr[eé]dit/i,
  income_sources: /\bingres|sueldo|salario|freelance|comision|entra\b/i,
  fixed_expenses: /\bgast|alquiler|arriend|renta|servicio|suscrip|sale fijo/i,
  goals: /\bmeta|objetiv|ahorr|emergencia|prioridad\b/i,
  coach_preferences: /\btono|estilo|recordatorio|check.?in|preferenc/i,
  review: /\brevis|confirm|resumen final/i,
};

function isTransitionLikelyForDifferentStep(
  message: string,
  currentStep: OnboardingStep,
  validatedNextStep: OnboardingStep,
): boolean {
  if (validatedNextStep !== currentStep) {
    return false;
  }

  const currentIndex = ONBOARDING_STEP_ORDER.indexOf(currentStep);
  for (let i = currentIndex + 1; i < ONBOARDING_STEP_ORDER.length; i++) {
    const step = ONBOARDING_STEP_ORDER[i];
    const pattern = LATER_STEP_MESSAGE_HINTS[step];
    if (pattern?.test(message)) {
      return true;
    }
  }

  return false;
}

// Decide whether to show the AI's assistantMessage or fall back to a local
// deterministic response. The AI's message is only trusted when:
//   1. The AI did not try to mark any step other than currentStep as empty
//      (sanitization strips those, but the AI's message likely still assumes
//      them, so we fall back).
//   2. The AI's intended next step (advanceToStep ?? prevStep) matches what
//      validation actually allowed.
//   3. When we stay on the same step, the message does not drift into
//      keywords that belong to a different section.
function shouldUseLocalResponse(
  aiResult: OnboardingTurnOutput,
  rawPatch: OnboardingTurnOutput["patch"],
  sanitizedPatch: OnboardingTurnOutput["patch"],
  prevStep: OnboardingStep,
  nextStep: OnboardingStep,
  response: string,
): boolean {
  const rawMarks = rawPatch.markStepsExplicitlyEmpty ?? [];
  const safeMarks = sanitizedPatch.markStepsExplicitlyEmpty ?? [];
  if (rawMarks.length !== safeMarks.length) {
    return true;
  }

  const aiIntended = aiResult.advanceToStep ?? prevStep;
  if (aiIntended !== nextStep) {
    return true;
  }

  if (nextStep === prevStep) {
    if (aiResult.intentKind === "transition") {
      return true;
    }
    if (isTransitionLikelyForDifferentStep(response, prevStep, nextStep)) {
      return true;
    }
  }

  // On a real transition, the AI message must be actionable for the new step:
  // it must contain a question mark AND mention the next step's topic. Otherwise
  // we fall back to the deterministic local transition (ack + step question).
  if (nextStep !== prevStep) {
    if (!response.includes("?") && !response.includes("¿")) {
      return true;
    }
    const nextHint = LATER_STEP_MESSAGE_HINTS[nextStep];
    if (nextHint && !nextHint.test(response)) {
      return true;
    }
  }

  return false;
}

function resolveAiTurnResponse(
  aiResult: OnboardingTurnOutput,
  rawPatch: OnboardingTurnOutput["patch"],
  sanitizedPatch: OnboardingTurnOutput["patch"],
  ctx: {
    prevStep: OnboardingStep;
    nextStep: OnboardingStep;
    draft: OnboardingDraft;
    prevDraft: OnboardingDraft;
    probingTurn: number;
  },
): string {
  const markedEmpty =
    sanitizedPatch.markStepsExplicitlyEmpty?.includes(ctx.prevStep) ?? false;
  const localResponse = generateKipuResponse({
    prevStep: ctx.prevStep,
    nextStep: ctx.nextStep,
    draft: ctx.draft,
    prevDraft: ctx.prevDraft,
    markedEmpty,
    probingTurn: ctx.probingTurn,
  });
  const aiMessage = resolveAiAssistantMessage(aiResult);

  if (!aiMessage) {
    return localResponse;
  }

  if (
    shouldUseLocalResponse(
      aiResult,
      rawPatch,
      sanitizedPatch,
      ctx.prevStep,
      ctx.nextStep,
      aiMessage,
    )
  ) {
    return localResponse;
  }

  return aiMessage;
}

// Validate where the conversation should land after applying the AI's
// (sanitized) patch. Rules:
//   - Collection steps never advance unless the user explicitly closed the
//     section ("eso es todo" / "no tengo más" / etc.) or the sanitized patch
//     marks the current step as empty.
//   - Advance at most one canonical step per turn.
//   - "completed" only valid when leaving "review".
function resolveAiNextStep(
  snapshot: OnboardingConversationState,
  patchedDraft: OnboardingDraft,
  sanitizedPatch: OnboardingTurnOutput["patch"],
  aiResult: OnboardingTurnOutput,
  latestUserMessage: string,
  currentConfirmed: ConfirmedCollectionSteps,
): OnboardingStep {
  const prevStep = snapshot.currentStep;
  const isCollection = COLLECTION_STEPS.has(prevStep);
  const markedEmptyByPatch =
    sanitizedPatch.markStepsExplicitlyEmpty?.includes(prevStep) ?? false;
  const stepComplete = isStepComplete(prevStep, patchedDraft);
  const lowerMessage = latestUserMessage.toLowerCase();
  // Fallback closure signals — ONLY consulted when the AI proposed nothing.
  // They never veto an AI advance: the model is the language interpreter
  // ("ahí estamos ok", "dale", "hasta ahí"…), the code only checks the seed.
  const priorClosure = currentConfirmed[prevStep] === true;
  const userClosed = userConfirmedNoMore(lowerMessage) || priorClosure;
  const userClosedPriority =
    prevStep === "goals" &&
    patchedDraft.goals.length > 0 &&
    (userConfirmedPriority(lowerMessage) || priorClosure);
  const aiProposedAdvance =
    Boolean(aiResult.advanceToStep) &&
    aiResult.advanceToStep !== "completed" &&
    isLaterStepByExactlyOne(prevStep, aiResult.advanceToStep as OnboardingStep);

  if (isCollection) {
    const decision = resolveCollectionAdvance({
      aiProposedAdvance,
      stepComplete,
      markedEmptyByPatch,
      userClosedFallback: userClosed || userClosedPriority,
    });
    if (decision === "stay") {
      // The only legitimate stay reasons are seed-quality reasons (e.g. a
      // money goal still has no targetAmount) or genuinely no signal at all.
      return prevStep;
    }
  }

  const updatedState: OnboardingConversationState = {
    ...snapshot,
    draft: patchedDraft,
    updatedAt: new Date().toISOString(),
  };

  let nextStep = getNextOnboardingStep(updatedState);
  const prevIndex = ONBOARDING_STEP_ORDER.indexOf(prevStep);

  if (
    aiResult.advanceToStep &&
    aiResult.advanceToStep !== "completed" &&
    isLaterStepByExactlyOne(prevStep, aiResult.advanceToStep) &&
    (stepComplete || markedEmptyByPatch || !isCollection)
  ) {
    nextStep = aiResult.advanceToStep;
  }

  const nextIndex = ONBOARDING_STEP_ORDER.indexOf(nextStep);
  if (nextIndex > prevIndex + 1) {
    nextStep = ONBOARDING_STEP_ORDER[prevIndex + 1] ?? prevStep;
  }

  if (nextStep === "completed" && prevStep !== "review") {
    nextStep = "review";
  }

  return nextStep;
}

function resolveLocalMockTurn(
  text: string,
  snapshot: OnboardingConversationState,
  currentConfirmed: ConfirmedCollectionSteps,
  currentProbingTurn: number,
): LocalMockTurnResult {
  const lower = text.toLowerCase().trim();
  let { draft, markedEmpty } = mockInterpret(text, snapshot);

  const prevStep = snapshot.currentStep;
  const isCollection = COLLECTION_STEPS.has(prevStep);
  const didConfirm = userConfirmedNoMore(lower);
  const didConfirmPriority =
    prevStep === "goals" &&
    draft.goals.length > 0 &&
    userConfirmedPriority(lower);

  if ((didConfirm || didConfirmPriority) && isCollection && !markedEmpty) {
    const isEmpty =
      (prevStep === "accounts" && draft.accounts.length === 0) ||
      (prevStep === "debt_accounts" && draft.debtAccounts.length === 0) ||
      (prevStep === "income_sources" && draft.incomeSources.length === 0) ||
      (prevStep === "fixed_expenses" && draft.fixedExpenses.length === 0) ||
      (prevStep === "goals" && draft.goals.length === 0);
    if (isEmpty) {
      draft = {
        ...draft,
        explicitlyEmptySteps: [
          ...(draft.explicitlyEmptySteps ?? []),
          prevStep,
        ],
      };
      markedEmpty = true;
    }
  }

  const newConfirmed: ConfirmedCollectionSteps = { ...currentConfirmed };
  if ((didConfirm || didConfirmPriority) && isCollection) {
    newConfirmed[prevStep] = true;
  }

  let nextStep: OnboardingStep;
  const stepConfirmedNow = newConfirmed[prevStep] === true;

  if (isCollection && !markedEmpty && !stepConfirmedNow) {
    nextStep = prevStep;
  } else {
    const updatedState: OnboardingConversationState = {
      ...snapshot,
      draft,
      updatedAt: new Date().toISOString(),
    };
    nextStep = getNextOnboardingStep(updatedState);
  }

  const newCompleted =
    nextStep !== prevStep && !snapshot.completedSteps.includes(prevStep)
      ? [...snapshot.completedSteps, prevStep]
      : snapshot.completedSteps;

  const finalState: OnboardingConversationState = {
    ...snapshot,
    draft,
    currentStep: nextStep,
    completedSteps: newCompleted,
    updatedAt: new Date().toISOString(),
  };

  const response = generateKipuResponse({
    prevStep,
    nextStep,
    draft,
    prevDraft: snapshot.draft,
    markedEmpty,
    probingTurn: currentProbingTurn,
  });

  return { finalState, response, newConfirmed };
}

// ── Utility ────────────────────────────────────────────────────────────────

// Show two decimals when the amount actually has cents (e.g. 13.40 -> "13.40$"),
// otherwise drop them (950 -> "950$"). Keeps the existing currency-symbol fallback.
function formatShort(amount: number, currency: string): string {
  const fixed = amount.toFixed(2);
  const value = fixed.endsWith(".00") ? fixed.slice(0, -3) : fixed;
  if (currency === "EUR") return `${value}€`;
  return `${value}$`;
}

function deepCloneDraft(draft: OnboardingDraft): OnboardingDraft {
  return {
    ...draft,
    profile: { ...draft.profile },
    accounts: draft.accounts.map((a) => ({ ...a })),
    debtAccounts: draft.debtAccounts.map((d) => ({ ...d })),
    incomeSources: draft.incomeSources.map((i) => ({ ...i })),
    fixedExpenses: draft.fixedExpenses.map((e) => ({ ...e })),
    goals: draft.goals.map((g) => ({ ...g })),
    coachPreferences: { ...draft.coachPreferences },
    userContextNotes: draft.userContextNotes.map((n) => ({ ...n })),
    explicitlyEmptySteps: [...(draft.explicitlyEmptySteps ?? [])],
  };
}

function extractFirstNumber(text: string): number | null {
  const match = text.match(/\b(\d{1,7}(?:[.,]\d{1,2})?)\b/);
  if (!match) return null;
  const n = parseFloat(match[1].replace(",", "."));
  return isNaN(n) ? null : n;
}

const GENERIC_ACCOUNT_WORDS = new Set([
  "tengo",
  "también",
  "tambien",
  "hay",
  "uso",
  "guardo",
  "mantengo",
  "cuenta",
  "banco",
  "ahorro",
  "corriente",
  "mi",
]);

function isGenericAccountName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;

  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.length === 1 && GENERIC_ACCOUNT_WORDS.has(words[0])) return true;
  if (words.every((w) => GENERIC_ACCOUNT_WORDS.has(w))) return true;

  return false;
}

function normalizeExtractedAccountName(raw: string): string | null {
  let name = raw.trim();
  name = name.replace(/^(?:mi\s+)?cuenta\s+/i, "");
  name = name.replace(/\s+con\s+.*$/i, "");
  name = name.replace(/[.,;:!?]+$/, "").trim();

  if (!name || isGenericAccountName(name)) return null;
  return name;
}

function extractAccountName(original: string, lower: string): string | null {
  const keywords: Record<string, string> = {
    pichincha: "Pichincha",
    guayaquil: "Banco Guayaquil",
    produbanco: "Produbanco",
    galicia: "Galicia",
    santander: "Santander",
    "itaú": "Itaú",
    itau: "Itaú",
    nubank: "Nubank",
    "mercado pago": "Mercado Pago",
    mercadopago: "Mercado Pago",
    payoneer: "Payoneer",
    brubank: "Brubank",
    efectivo: "Efectivo",
    nequi: "Nequi",
    daviplata: "Daviplata",
    wise: "Wise",
  };

  const enCuentaMatch = original.match(
    /\ben\s+(?:mi\s+)?cuenta\s+(.+?)(?:\s+con\s|\s*$|[.,;:!?])/i,
  );
  if (enCuentaMatch) {
    const extracted = normalizeExtractedAccountName(enCuentaMatch[1]);
    if (extracted) return extracted;
  }

  const cuentaLeadMatch = original.match(
    /^\s*(?:tengo\s+\d[\d.,]*\s+)?cuenta\s+(.+?)(?:\s+con\s|\s*$|[.,;:!?])/i,
  );
  if (cuentaLeadMatch) {
    const extracted = normalizeExtractedAccountName(cuentaLeadMatch[1]);
    if (extracted) return extracted;
  }

  const cuentaInlineMatch = original.match(
    /\bcuenta\s+([A-Za-zÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9\s-]+?)(?:\s+con\s+\d|\s*$|[.,;:!?])/i,
  );
  if (cuentaInlineMatch) {
    const extracted = normalizeExtractedAccountName(cuentaInlineMatch[1]);
    if (extracted) return extracted;
  }

  for (const [kw, label] of Object.entries(keywords)) {
    if (lower.includes(kw)) return label;
  }

  const cleanedOriginal = original
    .replace(/^\s*(tengo|también tengo|tambien tengo|hay|uso|guardo|mantengo)\s+/i, "")
    .replace(/\d+([.,]\d+)?/g, " ")
    .replace(/\b(con|como|aprox\.?|aproximadamente|unos?|unas?|en|mi|cuenta)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const match = cleanedOriginal.match(
    /\b([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ]{2,}(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ]{2,})*)\b/,
  );
  if (match) {
    const extracted = normalizeExtractedAccountName(match[1]);
    if (extracted) return extracted;
  }

  return null;
}

function extractDebtName(original: string, lower: string): string | null {
  if (/\bvisa\b/i.test(lower)) return "Visa";
  if (/mastercard|master card/i.test(lower)) return "Mastercard";
  if (/american express|amex/i.test(lower)) return "Amex";
  if (/diners/i.test(lower)) return "Diners";
  const accountName = extractAccountName(original, lower);
  if (accountName) return accountName;
  if (/tarjeta/i.test(lower)) return "Tarjeta";
  if (/préstamo|prestamo/i.test(lower)) return "Préstamo";
  if (/familiar/i.test(lower)) return "Deuda familiar";
  return null;
}

function extractIncomeKind(lower: string): OnboardingIncomeKind | null {
  if (/\b(sueldo|salario)\b/i.test(lower)) return "fixed_salary";
  if (/freelance/i.test(lower)) return "freelance";
  if (/comisiones?/i.test(lower)) return "commissions";
  if (/negocio|emprendimiento/i.test(lower)) return "business";
  if (/familiar|familia|padres|ayuda/i.test(lower)) return "family_support";
  if (/renta.*cobr|inversi/i.test(lower)) return "passive";
  return null;
}

function extractGoalArchetype(lower: string): OnboardingGoalArchetype | null {
  if (/viaje|vacaciones/i.test(lower)) return "specific_purchase";
  if (/emergencia|colchón|fondo/i.test(lower)) return "emergency_savings";
  if (/deuda|tarjeta|pagar|saldar/i.test(lower)) return "pay_down_debt";
  if (/organiz|orden|mes|control/i.test(lower)) return "organize_month";
  if (/comprar|carro|auto|casa|celular|compu/i.test(lower)) return "specific_purchase";
  return null;
}

function extractGoalName(original: string): string | null {
  const patterns = [
    /(?:ahorrar para|viaje a|ir a|comprar)\s+(.+?)(?:\s+\d|[.,]|$)/i,
    /(?:quiero|quisiera|me gustaría)\s+(.+?)(?:\s+\d|[.,]|$)/i,
  ];
  for (const p of patterns) {
    const m = original.match(p);
    if (m?.[1]) {
      const name = m[1].trim().slice(0, 40);
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  return null;
}

function extractDebtAmountInterpretation(
  lower: string,
): DebtAmountInterpretation | null {
  if (/total|todo lo que debo|saldo total|deuda total/i.test(lower))
    return "total_balance";
  if (/mínimo|minimo|pago mínimo/i.test(lower)) return "minimum_payment";
  if (/\b(mes|del mes|este mes|mensual|cuota del mes)\b/i.test(lower))
    return "current_month_payment";
  return null;
}

// ── Intent classification helpers ──────────────────────────────────────────

/**
 * Short, standalone affirmations / confirmations with no real data content.
 * Guards against creating bogus entities from messages like "sí", "ok", "eso es todo".
 */
function isGenericConfirmation(lower: string): boolean {
  return /^(s[íi]|si|ok|listo|claro|vale|entendido|eso es todo|nada m[aá]s|no tengo m[aá]s|solo eso|con eso|nada|de acuerdo|correcto|exacto|genial|bien|perfecto|ya|bueno)[.,!\s]*$/.test(
    lower.trim(),
  );
}

/**
 * True when the user signals there is nothing more to add to the current
 * collection step. Recognizes generic phrases ("eso es todo", "nada más"),
 * "(con)? eso/esa (meta)? (estamos | estoy | está bien | basta | me quedo |
 * es suficiente | quiero empezar)" patterns, the partial "con esa (meta)?
 * es …" closer, and bare "con eso" / "con esa" closures. Closure, not
 * deletion: existing items in the collection are preserved.
 */
function userConfirmedNoMore(lower: string): boolean {
  const trimmed = lower.trim();

  // Generic closure phrases
  if (
    /\b(eso es todo|nada m[aá]s|no tengo m[aá]s|solo eso|solo esa|por ahora solo esa|por ahora esa|por ahora eso|no hay m[aá]s|no\s+m[aá]s\s+prioridades|no\s+tengo\s+m[aá]s\s+prioridades|creo que eso|ya no hay|no m[aá]s|s[íi].*eso es|no.*nada m[aá]s|listo con (?:eso|esa)|nada que (?:me acuerde|recuerde)|no se me ocurre|no recuerdo (?:m[aá]s|nada)|ninguno m[aá]s|ninguna m[aá]s)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  // "(con)? (eso|esa) (meta)? (estamos | estoy | está bien | basta | me quedo |
  // es suficiente | quiero empezar)". Covers, among others:
  //   "con esa estamos bien", "con esa está bien", "con esa me quedo",
  //   "con esa quiero empezar", "con esa basta", "con esa es suficiente",
  //   "esa está bien", "esa meta está bien", "con eso estamos".
  if (
    /\b(?:con\s+)?(?:eso|esa)(?:\s+meta)?\s+(?:estamos|estoy|est[aá]\s+bien|basta|me\s+quedo|es\s+suficiente|quiero\s+empezar)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  // "con (eso|esa) (meta)? es …" OR "(eso|esa) meta es …" — covers partial
  // / open-ended closers like "con esa meta es" without false-positiving on
  // a bare "esa es" (which is too generic to interpret as closure).
  if (
    /\b(?:con\s+(?:eso|esa)(?:\s+meta)?|(?:eso|esa)\s+meta)\s+es(?:\s|[.,!?]|$)/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  // bare "con eso" / "con esa" as the whole message
  if (/^con\s+(?:eso|esa)[.,!?\s]*$/i.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * True when the user is confirming that the current goal is their priority,
 * not describing a new goal. Accepts bare "sí" / "esa" and phrases like
 * "esa es la más importante", "me quedo con esa".
 */
function userConfirmedPriority(lower: string): boolean {
  const trimmed = lower.trim();
  if (/^s[íi][.,!\s]*$/i.test(trimmed)) return true;
  if (/^esa[.,!\s]*$/i.test(trimmed)) return true;
  return /\b(s[íi]|correcto|exacto|esa es( la| mi)?( principal| m[aá]s importante| que m[aá]s me importa)?|esa es mi|es mi prioridad|prioridad principal|me quedo con esa|quiero empezar con esa|con esa quiero empezar|s[íi][,.]?\s*esa)\b/i.test(
    trimmed,
  );
}

/**
 * True when the text contains meaningful goal-related content — not just
 * a confirmation or a generic short phrase.
 */
function hasMeaningfulGoalText(lower: string): boolean {
  return (
    /viaje|vacacion|emergencia|colch[oó]n|fondo|deuda|pagar|saldar|organiz|orden|control|comprar|carro|auto|casa|celular|compu|ahorrar|guardar|salir de|independ/.test(
      lower,
    ) || extractFirstNumber(lower) !== null
  );
}

/**
 * Returns which broad types of accounts the draft already contains.
 * Used to avoid repeating "¿tienes efectivo?" after cash is already captured.
 */
function getCapturedAccountTypes(draft: OnboardingDraft): {
  hasCash: boolean;
  hasWallet: boolean;
  bankCount: number;
} {
  let hasCash = false;
  let hasWallet = false;
  let bankCount = 0;
  for (const a of draft.accounts) {
    const n = (a.name ?? "").toLowerCase();
    if (/efectivo|cash/i.test(n)) hasCash = true;
    else if (
      /payoneer|nequi|daviplata|mercado pago|mercadopago|wise|wallet/i.test(n)
    )
      hasWallet = true;
    else bankCount++;
  }
  return { hasCash, hasWallet, bankCount };
}

// ── Mock interpreter ────────────────────────────────────────────────────────
// TODO: Replace with AI onboarding engine (src/lib/ai/onboarding) once integrated.
// This is a temporary pattern-matching stub. No Supabase writes, no OpenAI calls.

function mockInterpret(
  userText: string,
  state: OnboardingConversationState,
): { draft: OnboardingDraft; markedEmpty: boolean } {
  const original = userText;
  const lower = userText.toLowerCase().trim();
  const draft = deepCloneDraft(state.draft);

  // "No tengo X" = explicitly none — only when the collection is still empty.
  // "No tengo más" = confirmation that there's nothing else — handled in handleSubmit.
  const isExplicitlyEmpty =
    /\b(no tengo|nada|ninguna?|no hay|sin deuda|no debo)\b/i.test(lower);

  const firstNum = extractFirstNumber(lower);

  switch (state.currentStep) {
    case "welcome":
      break;

    case "profile": {
      if (!draft.profile.fullName) {
        const nm = original.match(/^([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ]+)/);
        if (nm) draft.profile.fullName = nm[1];
      }
      const countries: Record<string, string> = {
        ecuador: "Ecuador", argentina: "Argentina", colombia: "Colombia",
        mexico: "México", méxico: "México", perú: "Perú", peru: "Perú",
        chile: "Chile", uruguay: "Uruguay", venezuela: "Venezuela",
        españa: "España", spain: "España", brasil: "Brasil",
        brazil: "Brasil", bolivia: "Bolivia", paraguay: "Paraguay",
      };
      for (const [key, val] of Object.entries(countries)) {
        if (lower.includes(key)) { draft.profile.country = val; break; }
      }
      if (/\b(usd|dólares?|dolares?)\b/i.test(lower))
        draft.profile.baseCurrency = "USD";
      else if (/\b(ars|pesos? argentin)\b/i.test(lower))
        draft.profile.baseCurrency = "ARS";
      else if (/\b(eur|euros?)\b/i.test(lower))
        draft.profile.baseCurrency = "EUR";
      break;
    }

    case "accounts": {
      // Only mark empty when collection is truly empty (not "no more")
      if (isExplicitlyEmpty && draft.accounts.length === 0) {
        draft.explicitlyEmptySteps = [
          ...(draft.explicitlyEmptySteps ?? []),
          "accounts",
        ];
        return { draft, markedEmpty: true };
      }
      // Don't create accounts from short confirmations or "no more" messages
      if (isGenericConfirmation(lower) || userConfirmedNoMore(lower)) break;
      const name = extractAccountName(original, lower);
      if (name || firstNum !== null) {
        draft.accounts.push({
          draftId: `acc-${Date.now()}`,
          name: name ?? "Cuenta",
          type: "bank",
          currentBalance: firstNum ?? undefined,
          missingFields: firstNum === null ? ["currentBalance"] : [],
          confidence: firstNum !== null ? "medium" : "low",
        });
      }
      break;
    }

    case "debt_accounts": {
      // Only mark truly empty (no debts at all)
      if (isExplicitlyEmpty && draft.debtAccounts.length === 0) {
        draft.explicitlyEmptySteps = [
          ...(draft.explicitlyEmptySteps ?? []),
          "debt_accounts",
        ];
        return { draft, markedEmpty: true };
      }
      if (isGenericConfirmation(lower) || userConfirmedNoMore(lower)) break;

      // Priority 1: fill in total balance when we already know it's a minimum payment
      const needsTotalBalance = draft.debtAccounts.filter(
        (d) =>
          d.amountInterpretation === "minimum_payment" &&
          d.totalBalance === undefined,
      );
      if (needsTotalBalance.length > 0 && firstNum !== null) {
        for (const d of needsTotalBalance) d.totalBalance = firstNum;
        return { draft, markedEmpty: false };
      }

      // Priority 2: resolve pending amount interpretation
      const pendingInterp = draft.debtAccounts.filter(
        (d) => d.amountInterpretation === "unknown",
      );
      if (pendingInterp.length > 0) {
        const interp = extractDebtAmountInterpretation(lower);
        if (interp) {
          for (const d of pendingInterp) {
            // Move amount from totalBalance placeholder to the correct field
            if (interp === "minimum_payment") {
              d.minimumPayment = d.totalBalance;
              d.totalBalance = undefined;
            } else if (interp === "current_month_payment") {
              d.currentMonthPayment = d.totalBalance;
              d.totalBalance = undefined;
            }
            d.amountInterpretation = interp;
          }
          return { draft, markedEmpty: false };
        }
      }

      // Priority 3: add new debt entry
      const debtName = extractDebtName(original, lower);
      if (debtName || firstNum !== null) {
        draft.debtAccounts.push({
          draftId: `debt-${Date.now()}`,
          name: debtName ?? "Deuda",
          type: /tarjeta|visa|master|crédit|credit/i.test(lower)
            ? "credit_card"
            : "other_debt",
          totalBalance: firstNum ?? undefined,
          amountInterpretation: firstNum !== null ? "unknown" : undefined,
          missingFields: firstNum === null ? ["totalBalance"] : [],
        });
      }
      break;
    }

    case "income_sources": {
      if (isExplicitlyEmpty && draft.incomeSources.length === 0) {
        draft.explicitlyEmptySteps = [
          ...(draft.explicitlyEmptySteps ?? []),
          "income_sources",
        ];
        return { draft, markedEmpty: true };
      }
      if (isGenericConfirmation(lower) || userConfirmedNoMore(lower)) break;
      const kind = extractIncomeKind(lower);
      const kindLabels: Partial<Record<OnboardingIncomeKind, string>> = {
        fixed_salary: "Sueldo", freelance: "Freelance",
        commissions: "Comisiones", business: "Negocio",
        family_support: "Ayuda familiar", passive: "Ingreso pasivo",
      };
      if (kind || firstNum !== null) {
        draft.incomeSources.push({
          draftId: `inc-${Date.now()}`,
          name: (kind ? kindLabels[kind] : undefined) ?? "Ingreso",
          kind: kind ?? "other",
          amount: firstNum ?? undefined,
          frequency: "monthly",
          missingFields: firstNum === null ? ["amount"] : [],
          confidence: firstNum !== null ? "medium" : "low",
        });
      }
      break;
    }

    case "fixed_expenses": {
      if (isExplicitlyEmpty && draft.fixedExpenses.length === 0) {
        draft.explicitlyEmptySteps = [
          ...(draft.explicitlyEmptySteps ?? []),
          "fixed_expenses",
        ];
        return { draft, markedEmpty: true };
      }
      if (isGenericConfirmation(lower) || userConfirmedNoMore(lower)) break;
      const expenseCategories: Array<[RegExp, string]> = [
        [/arriendo|alquiler|renta\b/i, "Arriendo"],
        [/internet|wifi/i, "Internet"],
        [/celular|móvil|movil/i, "Celular"],
        [/gym|gimnasio/i, "Gimnasio"],
        [/netflix|spotify|disney|hbo|suscripc/i, "Suscripciones"],
        [/transporte|bus|colectivo|taxi|uber/i, "Transporte"],
        [/comida|mercado|supermercado|super\b/i, "Comida"],
        [/salud|médico|medico|medicament/i, "Salud"],
        [/servicios?|luz\b|agua\b|gas\b/i, "Servicios"],
      ];
      const allNums = [
        ...lower.matchAll(/\b(\d{1,6}(?:[.,]\d{1,2})?)\b/g),
      ]
        .map((m) => parseFloat(m[1].replace(",", ".")))
        .filter((n) => !isNaN(n));
      let matched = false;
      for (const [rx, label] of expenseCategories) {
        if (rx.test(lower)) {
          draft.fixedExpenses.push({
            draftId: `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: label,
            amount: allNums.shift() ?? undefined,
            confidence: "medium",
          });
          matched = true;
        }
      }
      if (!matched && firstNum !== null) {
        draft.fixedExpenses.push({
          draftId: `exp-${Date.now()}`,
          name: "Gasto fijo",
          amount: firstNum,
          confidence: "low",
        });
      }
      break;
    }

    case "goals": {
      if (isExplicitlyEmpty && draft.goals.length === 0) {
        draft.explicitlyEmptySteps = [
          ...(draft.explicitlyEmptySteps ?? []),
          "goals",
        ];
        return { draft, markedEmpty: true };
      }
      // Don't create goals from confirmations, priority answers, or vague short text
      if (
        isGenericConfirmation(lower) ||
        userConfirmedNoMore(lower) ||
        userConfirmedPriority(lower)
      )
        break;

      // If there's already a goal waiting for a target amount and the user's
      // message is essentially just a number (no new goal keywords), apply
      // it to the existing pending goal rather than creating a duplicate.
      const pendingGoal = draft.goals.find(
        (g) => g.targetAmount === undefined && g.archetype !== "organize_month",
      );
      const hasArchetypeKeyword = extractGoalArchetype(lower) !== null;
      const hasExtractedName = extractGoalName(original) !== null;
      const isBareAmount =
        firstNum !== null && !hasArchetypeKeyword && !hasExtractedName;
      if (pendingGoal && isBareAmount) {
        pendingGoal.targetAmount = firstNum ?? undefined;
        pendingGoal.confidence = "medium";
        pendingGoal.missingFields = (pendingGoal.missingFields ?? []).filter(
          (f) => f !== "targetAmount",
        );
        break;
      }

      if (hasMeaningfulGoalText(lower)) {
        const archetype = extractGoalArchetype(lower);
        draft.goals.push({
          draftId: `goal-${Date.now()}`,
          name: extractGoalName(original) ?? "Mi meta",
          archetype: archetype ?? "other",
          targetAmount: firstNum ?? undefined,
          missingFields: firstNum === null ? ["targetAmount"] : [],
          confidence: firstNum !== null ? "medium" : "low",
        });
      }
      break;
    }

    case "coach_preferences": {
      draft.coachPreferences.dailyCheckinEnabled = true;
      applyCoachToneFromUserMessage(draft, original);
      break;
    }

    case "review":
      break;
  }

  return { draft, markedEmpty: false };
}

// ── Step-specific stay responses ────────────────────────────────────────────
// TODO: Replace with AI-generated responses once the engine is integrated.

// Generic placeholder names we never want to surface as if they were the
// user's real names. Used by newlyAddedNames to ignore noise from the mock.
const PLACEHOLDER_ITEM_NAMES = new Set([
  "Cuenta",
  "Deuda",
  "Mi meta",
  "Ingreso",
  "Gasto fijo",
  "Tarjeta",
]);

function newlyAddedNames<T extends { draftId: string; name?: string }>(
  prev: T[],
  curr: T[],
): string[] {
  const prevIds = new Set(prev.map((p) => p.draftId));
  const names: string[] = [];
  for (const item of curr) {
    if (prevIds.has(item.draftId)) continue;
    const trimmed = item.name?.trim();
    if (!trimmed) continue;
    if (PLACEHOLDER_ITEM_NAMES.has(trimmed)) continue;
    names.push(trimmed);
  }
  return names;
}

// "A", "A y B", "A, B y C"
function joinSpanishList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

function accountsStayResponse(
  draft: OnboardingDraft,
  prevDraft: OnboardingDraft,
): string {
  if (draft.accounts.length === 0) {
    return getStepQuestion("accounts");
  }
  const justAdded = draft.accounts.length > prevDraft.accounts.length;
  const { hasCash, hasWallet, bankCount } = getCapturedAccountTypes(draft);

  if (justAdded) {
    const addedNames = newlyAddedNames(prevDraft.accounts, draft.accounts);
    const name =
      addedNames.length > 0
        ? joinSpanishList(addedNames)
        : (draft.accounts.at(-1)?.name ?? "esa cuenta");
    // Tailor ask based on what's already captured
    if (!hasCash && !hasWallet) {
      return `Listo, anoté ${name}. Mientras más completo me lo cuentes, mejor. ¿Guardas también algo en efectivo, en una wallet como Nequi o PayPal, o en otra cuenta?`;
    }
    if (hasCash && !hasWallet) {
      return `Anotado. ¿Y tienes algo en alguna wallet digital, cuenta de otro banco, o dinero guardado en otro lado?`;
    }
    if (!hasCash && hasWallet) {
      return `Perfecto. ¿Hay también efectivo guardado, o alguna otra cuenta o lugar donde tengas dinero?`;
    }
    // bank + cash + wallet → ask final check
    return `Bien, tenemos ${bankCount > 1 ? "varias cuentas" : "la cuenta"}, efectivo y wallet. ¿Hay algún otro dinero que debamos incluir, aunque sea en otra moneda?`;
  }

  // Not just added — didn't understand the last input
  if (!hasCash) {
    return "Si no recuerdas el saldo exacto, un aproximado realista sirve. ¿Y tienes también efectivo o alguna wallet digital?";
  }
  return "Para que no se nos escape nada: ¿hay alguna otra cuenta, ahorro separado o dinero guardado en otro lado?";
}

function debtStayResponse(
  draft: OnboardingDraft,
  prevDraft: OnboardingDraft,
): string {
  // Priority 1: amount interpretation still unknown → ask to clarify
  if (draft.debtAccounts.some((d) => d.amountInterpretation === "unknown")) {
    return "Pregunta importante: ese monto que mencionaste, ¿es el total que debes en la tarjeta o solo el pago mínimo de este mes?";
  }

  // Priority 2: minimum payment known but total balance still missing → ask for total
  const needsTotal = draft.debtAccounts.find(
    (d) =>
      d.amountInterpretation === "minimum_payment" &&
      d.totalBalance === undefined,
  );
  if (needsTotal) {
    const min = needsTotal.minimumPayment;
    const name = needsTotal.name ?? "esa tarjeta";
    return min !== undefined
      ? `Entendido, esos ${Math.round(min)}$ son el pago mínimo. Para no quedarnos cortos: ¿cuánto debes en total en ${name}, aunque sea aproximado?`
      : `Entendido el mínimo. ¿Cuánto debes en total en esa tarjeta, aunque sea aproximado?`;
  }

  // Priority 3: all resolved → ask for more debts
  if (draft.debtAccounts.length === 0) {
    return ONBOARDING_STEP_METADATA["debt_accounts"].primaryQuestion;
  }
  const justAdded = draft.debtAccounts.length > prevDraft.debtAccounts.length;
  const justResolvedTotal =
    prevDraft.debtAccounts.some(
      (d) =>
        d.amountInterpretation === "minimum_payment" &&
        d.totalBalance === undefined,
    ) &&
    !draft.debtAccounts.some(
      (d) =>
        d.amountInterpretation === "minimum_payment" &&
        d.totalBalance === undefined,
    );

  if (justAdded || justResolvedTotal) {
    const addedNames = newlyAddedNames(prevDraft.debtAccounts, draft.debtAccounts);
    const prefix =
      addedNames.length > 0 ? `Listo, anoté ${joinSpanishList(addedNames)}. ` : "";
    return `${prefix}¿Y tienes otra tarjeta, préstamo, deuda familiar o algo informal que también debamos tomar en cuenta?`;
  }
  return "Para asegurarnos de no dejar ninguna deuda afuera: ¿hay algo más, aunque sea pequeño o informal?";
}

function incomeStayResponse(
  draft: OnboardingDraft,
  prevDraft: OnboardingDraft,
): string {
  if (draft.incomeSources.length === 0) {
    return ONBOARDING_STEP_METADATA["income_sources"].primaryQuestion;
  }
  const justAdded = draft.incomeSources.length > prevDraft.incomeSources.length;
  if (justAdded) {
    const addedNames = newlyAddedNames(prevDraft.incomeSources, draft.incomeSources);
    const prefix =
      addedNames.length > 0 ? `Listo, anoté ${joinSpanishList(addedNames)}. ` : "";
    return `${prefix}Además de eso, ¿hay algo que entre de vez en cuando? Freelance, comisiones, ventas, ayuda familiar o algún ingreso irregular.`;
  }
  return "¿Hay algún otro ingreso, aunque sea variable o de vez en cuando, que también debamos tener en cuenta?";
}

function expensesStayResponse(
  draft: OnboardingDraft,
  prevDraft: OnboardingDraft,
): string {
  if (draft.fixedExpenses.length === 0) {
    return ONBOARDING_STEP_METADATA["fixed_expenses"].primaryQuestion;
  }
  const justAdded =
    draft.fixedExpenses.length > prevDraft.fixedExpenses.length;
  if (justAdded) {
    const addedNames = newlyAddedNames(prevDraft.fixedExpenses, draft.fixedExpenses);
    const prefix =
      addedNames.length > 0 ? `Listo, anoté ${joinSpanishList(addedNames)}. ` : "";
    return `${prefix}Ahora pensemos en los que suelen escaparse: celular, transporte, comida fija, suscripciones, ayuda familiar o pagos anuales. ¿Hay alguno más?`;
  }
  return "¿Algún otro gasto que aparezca casi todos los meses, aunque sea pequeño o poco frecuente?";
}

function goalNeedsAmount(g: OnboardingDraft["goals"][number]): boolean {
  return g.targetAmount === undefined && g.archetype !== "organize_month";
}

function goalsStayResponse(
  draft: OnboardingDraft,
  prevDraft: OnboardingDraft,
  probingTurn: number,
): string {
  if (draft.goals.length === 0) {
    if (probingTurn > 0) {
      return "Si no tienes una meta clara todavía, no hay problema. Te doy algunas opciones: ordenar el mes para llegar al final sin susto, bajar lo que debes, tener un colchón de emergencia, o ahorrar para algo concreto. ¿Alguna resuena?";
    }
    return ONBOARDING_STEP_METADATA["goals"].primaryQuestion;
  }

  // Highest priority: a savings/purchase/emergency/debt-payoff goal without
  // a target amount cannot move forward. Ask for it (or for a rough range).
  const goalMissingAmount = draft.goals.find(goalNeedsAmount);
  if (goalMissingAmount) {
    const rawName = goalMissingAmount.name?.trim();
    const friendly =
      rawName && rawName !== "Mi meta" ? rawName.toLowerCase() : "esa meta";
    return `Buenísima meta. Para poder ayudarte de verdad necesito ponerle un número: ¿cuánto quieres ahorrar para ${friendly}, aunque sea un aproximado realista o un rango (por ejemplo 8.000–12.000)?`;
  }

  const justAdded = draft.goals.length > prevDraft.goals.length;
  const justResolvedAmount =
    prevDraft.goals.some(goalNeedsAmount) &&
    !draft.goals.some(goalNeedsAmount);

  if (justAdded || justResolvedAmount) {
    return "¿Esa sería tu prioridad principal? Si tienes deudas que presionan, a veces tiene más sentido atacarlas primero. ¿O es esa la meta que más te importa ahora?";
  }
  return "¿Hay algo más que te gustaría lograr, o con esa meta está bien para empezar?";
}

// ── Response generator ──────────────────────────────────────────────────────

function generateKipuResponse(ctx: ResponseCtx): string {
  const { prevStep, nextStep, draft, prevDraft, markedEmpty, probingTurn } = ctx;
  const prevMeta = ONBOARDING_STEP_METADATA[prevStep];

  // ── Advancing to a new step ──────────────────────────────────────────────
  if (nextStep !== prevStep) {
    if (markedEmpty) {
      const empties: Partial<Record<OnboardingStep, string>> = {
        accounts: "Entendido. ",
        debt_accounts: "Perfecto, sin deudas por ahora. ",
        income_sources: "Anotado. ",
        fixed_expenses: "Bien, lo dejamos abierto. ",
        goals: "Sin problema, lo vemos después. ",
      };
      return (empties[prevStep] ?? "Entendido. ") + getStepQuestion(nextStep);
    }
    const acks: Partial<Record<OnboardingStep, string>> = {
      welcome: "",
      profile: "Perfecto. ",
      accounts: "Listo, lo tenemos completo. ",
      debt_accounts: "Bien, lo tenemos claro. ",
      income_sources: "Perfecto, anotado. ",
      fixed_expenses: "Listo. ",
      goals: "Bien, ya sé hacia dónde vamos. ",
      coach_preferences: "Anotado, así lo voy a hacer. ",
      review: "Perfecto. ",
    };
    return (acks[prevStep] ?? "") + getStepQuestion(nextStep);
  }

  // ── Staying on the same step ─────────────────────────────────────────────
  switch (prevStep) {
    case "welcome": {
      const probes = prevMeta.probingQuestions;
      return probes.length > 0
        ? probes[probingTurn % probes.length]
        : prevMeta.primaryQuestion;
    }
    case "profile": {
      if (!draft.profile.fullName) {
        return prevMeta.primaryQuestion;
      }
      if (!draft.profile.baseCurrency) {
        return "Perfecto. ¿En qué moneda piensas tu día a día: USD, ARS, EUR u otra?";
      }
      return prevMeta.primaryQuestion;
    }
    case "accounts":
      return accountsStayResponse(draft, prevDraft);
    case "debt_accounts":
      return debtStayResponse(draft, prevDraft);
    case "income_sources":
      return incomeStayResponse(draft, prevDraft);
    case "fixed_expenses":
      return expensesStayResponse(draft, prevDraft);
    case "goals":
      return goalsStayResponse(draft, prevDraft, probingTurn);
    case "coach_preferences": {
      const probes = prevMeta.probingQuestions;
      return probes.length > 0
        ? probes[probingTurn % probes.length]
        : getStepQuestion("coach_preferences");
    }
    default:
      return prevMeta.primaryQuestion;
  }
}

// ── Review panel filtering helpers ─────────────────────────────────────────

function isReviewableAccount(
  a: OnboardingDraft["accounts"][number],
): boolean {
  // Exclude nameless placeholders with no balance
  if (!a.name || a.name === "Cuenta") return a.currentBalance !== undefined;
  return true;
}

function isReviewableDebt(
  d: OnboardingDraft["debtAccounts"][number],
): boolean {
  const hasAmount =
    d.totalBalance !== undefined ||
    d.minimumPayment !== undefined ||
    d.currentMonthPayment !== undefined;
  return hasAmount;
}

function formatDebtReviewValue(
  d: OnboardingDraft["debtAccounts"][number],
  baseCurrency: string,
): string {
  const parts: string[] = [];
  if (d.totalBalance !== undefined) {
    parts.push(`debes ${formatShort(d.totalBalance, baseCurrency)}`);
  }
  if (d.currentMonthPayment !== undefined) {
    parts.push(`este mes ${formatShort(d.currentMonthPayment, baseCurrency)}`);
  }
  if (d.minimumPayment !== undefined) {
    parts.push(`mínimo ${formatShort(d.minimumPayment, baseCurrency)}`);
  }
  if (d.dueDay !== undefined && d.dueDay >= 1 && d.dueDay <= 31) {
    parts.push(`pagas el ${d.dueDay}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

// Honest assumptions the engine is making with the current draft. Shown at
// review so missing timing/dates never become silent false confidence.
function buildReviewAssumptions(draft: OnboardingDraft): string[] {
  const out: string[] = [];

  const mainIncome = draft.incomeSources.find((s) => (s.amount ?? 0) > 0);
  if (mainIncome && mainIncome.expectedDay === undefined && mainIncome.expectedWeekday === undefined) {
    out.push("No sé qué día te llega tu ingreso; por ahora asumo inicio de mes.");
  }

  const cardsWithDebtNoDue = draft.debtAccounts.filter(
    (d) =>
      ((d.totalBalance ?? 0) > 0 || (d.currentMonthPayment ?? 0) > 0 || (d.minimumPayment ?? 0) > 0) &&
      d.type !== "family_debt" &&
      d.type !== "other_debt" &&
      d.dueDay === undefined,
  );
  if (cardsWithDebtNoDue.length > 0) {
    const names = cardsWithDebtNoDue.map((d) => d.name ?? "tu tarjeta").slice(0, 2).join(" y ");
    out.push(`Aún no sé qué día pagas ${names}; reparto ese pago en el mes.`);
  }

  const fixedNoDay = draft.fixedExpenses.filter(
    (f) => (f.amount ?? 0) > 0 && f.expectedDay === undefined && f.expectedWeekday === undefined,
  );
  if (fixedNoDay.length >= 2) {
    out.push("Tus gastos fijos no tienen fecha de cobro; los reparto a lo largo del mes.");
  }

  const moneyGoal = draft.goals.find(
    (g) => (g.targetAmount ?? 0) > 0 && g.archetype !== "organize_month",
  );
  if (moneyGoal && !moneyGoal.targetDate) {
    out.push(`"${moneyGoal.name ?? "Tu meta"}" no tiene fecha aún; con fecha te digo cuánto apartar por semana.`);
  }

  if ((draft.profile.essentialMonthlyEstimate ?? 0) === 0) {
    out.push("No tengo un estimado de comida/transporte; el margen puede verse más holgado de lo real.");
  }

  return out.slice(0, 4);
}

function isReviewableExpense(
  e: OnboardingDraft["fixedExpenses"][number],
): boolean {
  // A named expense WITHOUT an amount stays visible (as "añadir monto") so a
  // user-mentioned item like Netflix can never be lost silently (field QA).
  // Persistence still requires an amount; the review makes the gap editable.
  if (e.amount !== undefined) return true;
  const name = (e.name ?? "").trim();
  return Boolean(name && name !== "Gasto fijo");
}

function isReviewableGoal(g: OnboardingDraft["goals"][number]): boolean {
  // "Pagar la deuda/tarjeta" without an amount is not a savings goal — shared
  // filter with persistence so review and save can never disagree (field QA).
  if (isDebtPayoffGoalWithoutAmount(g.name, g.targetAmount)) return false;
  // Must have a real name (not generic fallback) OR a target amount
  const hasRealName = g.name && g.name !== "Mi meta";
  return Boolean(hasRealName || g.targetAmount !== undefined);
}

// ── Main component ──────────────────────────────────────────────────────────

export default function OnboardingInterview({
  initialProfile,
  initialAccounts,
  initialDebtAccounts,
  initialGoals,
  userEmail,
}: OnboardingInterviewProps) {
  const [convState, setConvState] = useState<OnboardingConversationState>(() =>
    createInitialOnboardingConversationState(),
  );
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>(
    () => [
      {
        id: "init-0",
        role: "kipu",
        text: ONBOARDING_STEP_METADATA["welcome"].primaryQuestion,
      },
    ],
  );
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [probingTurn, setProbingTurn] = useState(0);
  // Local tracking: which collection steps the user has explicitly confirmed are done
  const [confirmedSteps, setConfirmedSteps] = useState<ConfirmedCollectionSteps>({});
  // Consecutive AI turns that re-asked without progress (loop detector).
  const [stalledTurns, setStalledTurns] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // ── Draft persistence (Stage 11) ─────────────────────────────────────────
  // A 10-minute conversation must survive a refresh or an accidental tab
  // close. The in-progress draft lives in localStorage (per user) until the
  // final save; nothing is written to the DB before the user confirms.
  const storageKey = `kipu-onboarding-v1:${userEmail || "anon"}`;
  const [hydrated, setHydrated] = useState(false);

  // One-time post-mount restore. setState inside this effect is intentional:
  // reading localStorage in the useState initializer would diverge from the
  // server-rendered HTML and break hydration, so the restore must run after
  // mount. It fires exactly once and cannot cascade.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as {
          convState?: OnboardingConversationState;
          displayMessages?: DisplayMessage[];
          confirmedSteps?: ConfirmedCollectionSteps;
          probingTurn?: number;
        };
        if (
          saved.convState?.currentStep &&
          saved.convState.currentStep !== "completed"
        ) {
          setConvState(saved.convState);
          if (saved.displayMessages?.length) {
            setDisplayMessages(saved.displayMessages);
          }
          if (saved.confirmedSteps) setConfirmedSteps(saved.confirmedSteps);
          if (typeof saved.probingTurn === "number") {
            setProbingTurn(saved.probingTurn);
          }
        }
      }
    } catch {
      // Corrupted draft → fresh start; never block onboarding on storage.
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          convState,
          displayMessages: displayMessages.slice(-40),
          confirmedSteps,
          probingTurn,
        }),
      );
    } catch {
      // Storage full/blocked: continue without persistence.
    }
  }, [hydrated, storageKey, convState, displayMessages, confirmedSteps, probingTurn]);

  const clearDraftStorage = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // best-effort
    }
  }, [storageKey]);

  // "Empezar de nuevo": resets ONLY the local draft conversation. Nothing in
  // the database is touched (the draft is never persisted until confirm).
  const handleRestart = useCallback(() => {
    const ok = window.confirm(
      "¿Empezamos la conversación de nuevo? Solo se borra este borrador; nada guardado se pierde.",
    );
    if (!ok) return;
    clearDraftStorage();
    setConvState(createInitialOnboardingConversationState());
    setDisplayMessages([
      {
        id: "init-0",
        role: "kipu",
        text: ONBOARDING_STEP_METADATA["welcome"].primaryQuestion,
      },
    ]);
    setConfirmedSteps({});
    setProbingTurn(0);
    setStalledTurns(0);
    setInputValue("");
  }, [clearDraftStorage]);

  // Structured debt editor (hybrid onboarding): applies a deterministic patch
  // — attribution and interpretation come from the form rows, no AI involved.
  const handleDebtFormApply = useCallback(
    (rows: DebtQuickFormRow[]) => {
      const patch = buildDebtQuickFormPatch(rows, convState.draft.debtAccounts);
      const patchedDraft = applyOnboardingDraftPatch(convState.draft, patch);
      setConvState({
        ...convState,
        draft: patchedDraft,
        updatedAt: new Date().toISOString(),
      });
      setStalledTurns(0);
      setDisplayMessages((prev) => [
        ...prev,
        {
          id: `k-${Date.now()}`,
          role: "kipu",
          text: `Listo, dejé tus tarjetas así: ${describeDebtQuickFormResult(rows)}. Si hay alguna otra deuda cuéntame; si no, dime "listo" y seguimos.`,
        },
      ]);
    },
    [convState],
  );

  const handleNoDebts = useCallback(() => {
    const patchedDraft = applyOnboardingDraftPatch(convState.draft, {
      markStepsExplicitlyEmpty: ["debt_accounts"],
    });
    setConvState({
      ...convState,
      draft: patchedDraft,
      currentStep: "income_sources",
      completedSteps: convState.completedSteps.includes("debt_accounts")
        ? convState.completedSteps
        : [...convState.completedSteps, "debt_accounts"],
      updatedAt: new Date().toISOString(),
    });
    setConfirmedSteps((prev) => ({ ...prev, debt_accounts: true }));
    setStalledTurns(0);
    setDisplayMessages((prev) => [
      ...prev,
      {
        id: `k-${Date.now()}`,
        role: "kipu",
        text: `Perfecto, sin deudas por ahora — ojalá siga así. ${ONBOARDING_STEP_METADATA["income_sources"].primaryQuestion}`,
      },
    ]);
  }, [convState]);

  // Autofocus the chat input — but NEVER on the review/completed screens: the
  // browser scrolls to the focused input at the bottom, burying the first
  // Margen Kipu (the magic moment must land at the top).
  useEffect(() => {
    if (convState.currentStep === "review" || convState.currentStep === "completed") {
      return;
    }
    inputRef.current?.focus();
  }, [isTyping, convState.currentStep]);

  // Direct edits from the review (no chat round-trip): applies a deterministic
  // patch to the draft; the first Margen Kipu recomputes live.
  const handleReviewPatch = useCallback(
    (patch: OnboardingDraftPatch) => {
      const patchedDraft = applyOnboardingDraftPatch(convState.draft, patch);
      setConvState({
        ...convState,
        draft: patchedDraft,
        updatedAt: new Date().toISOString(),
      });
    },
    [convState],
  );

  const handleSubmit = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isTyping) return;

    setInputValue("");

    const userMsg: DisplayMessage = { id: `u-${Date.now()}`, role: "user", text };
    setDisplayMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    const snapshot = convState;
    const currentConfirmed = confirmedSteps;
    const currentProbingTurn = probingTurn;
    const currentStalls = stalledTurns;
    // Last turns (oldest first) so the engine can resolve "ya te dije…" —
    // without this the model is amnesic and clarification loops are possible.
    const recentForEngine = displayMessages.slice(-12).map((m) => ({
      from: m.role === "kipu" ? ("kipu" as const) : ("user" as const),
      text: m.text,
    }));

    setTimeout(() => {
      void (async () => {
        try {
          const aiResult = await processOnboardingTurnAction({
            state: snapshot,
            latestUserMessage: text,
            recentMessages: recentForEngine,
            localeHint: "es-LATAM",
          });

          if (isUsefulAiResult(aiResult)) {
            const rawPatch = aiResult.patch;
            const sanitizedPatch = sanitizeAiPatchForCurrentStep(
              rawPatch,
              snapshot.currentStep,
            );
            const patchedDraft = applyOnboardingDraftPatch(
              snapshot.draft,
              sanitizedPatch,
            );
            if (snapshot.currentStep === "coach_preferences") {
              applyCoachToneFromUserMessage(patchedDraft, text);
            }
            const prevStep = snapshot.currentStep;
            const nextStep = resolveAiNextStep(
              snapshot,
              patchedDraft,
              sanitizedPatch,
              aiResult,
              text,
              currentConfirmed,
            );

            const newCompleted =
              nextStep !== prevStep && !snapshot.completedSteps.includes(prevStep)
                ? [...snapshot.completedSteps, prevStep]
                : snapshot.completedSteps;

            const finalState: OnboardingConversationState = {
              ...snapshot,
              draft: patchedDraft,
              currentStep: nextStep,
              completedSteps: newCompleted,
              updatedAt: new Date().toISOString(),
            };

            const newConfirmed: ConfirmedCollectionSteps = { ...currentConfirmed };
            if (COLLECTION_STEPS.has(prevStep)) {
              const lowerText = text.toLowerCase();
              const detectedClosure =
                userConfirmedNoMore(lowerText) ||
                (prevStep === "goals" &&
                  patchedDraft.goals.length > 0 &&
                  userConfirmedPriority(lowerText));
              if (detectedClosure || nextStep !== prevStep) {
                newConfirmed[prevStep] = true;
              }
            }

            const response = resolveAiTurnResponse(
              aiResult,
              rawPatch,
              sanitizedPatch,
              {
                prevStep,
                nextStep,
                draft: patchedDraft,
                prevDraft: snapshot.draft,
                probingTurn: currentProbingTurn,
              },
            );

            // ── Clarification-loop breaker ──────────────────────────────
            // Two consecutive turns with no draft change and no advance in a
            // collection step = the AI is re-asking. Force a calm move-on:
            // the user must never have to fight the model (field QA bug).
            const newStalls = countStalledTurn({
              previousStalls: currentStalls,
              draftChanged: !isDraftUnchanged(snapshot.draft, patchedDraft),
              stepAdvanced: nextStep !== prevStep,
              isCollectionStep: COLLECTION_STEPS.has(prevStep),
            });

            if (shouldBreakStall(newStalls)) {
              const stepIdx = ONBOARDING_STEP_ORDER.indexOf(prevStep);
              const forcedNext =
                ONBOARDING_STEP_ORDER[
                  Math.min(stepIdx + 1, ONBOARDING_STEP_ORDER.indexOf("review"))
                ];
              const forcedState: OnboardingConversationState = {
                ...snapshot,
                draft: patchedDraft,
                currentStep: forcedNext,
                completedSteps: snapshot.completedSteps.includes(prevStep)
                  ? snapshot.completedSteps
                  : [...snapshot.completedSteps, prevStep],
                updatedAt: new Date().toISOString(),
              };
              const forcedConfirmed: ConfirmedCollectionSteps = {
                ...currentConfirmed,
              };
              if (COLLECTION_STEPS.has(prevStep)) forcedConfirmed[prevStep] = true;

              setConvState(forcedState);
              setConfirmedSteps(forcedConfirmed);
              setStalledTurns(0);
              setDisplayMessages((prev) => [
                ...prev,
                {
                  id: `k-${Date.now()}`,
                  role: "kipu",
                  text:
                    STALL_BREAK_PREFIX +
                    (ONBOARDING_STEP_METADATA[forcedNext]?.primaryQuestion ?? ""),
                },
              ]);
              setProbingTurn((t) => t + 1);
              setIsTyping(false);
              return;
            }

            setStalledTurns(newStalls);
            setConvState(finalState);
            setConfirmedSteps(newConfirmed);
            setDisplayMessages((prev) => [
              ...prev,
              { id: `k-${Date.now()}`, role: "kipu", text: response },
            ]);
            setProbingTurn((t) => t + 1);
            setIsTyping(false);
            return;
          }
        } catch {
          // Fall back to the local mock path below.
        }

        const mockTurn = resolveLocalMockTurn(
          text,
          snapshot,
          currentConfirmed,
          currentProbingTurn,
        );

        setConvState(mockTurn.finalState);
        setConfirmedSteps(mockTurn.newConfirmed);
        setStalledTurns(0);
        setDisplayMessages((prev) => [
          ...prev,
          { id: `k-${Date.now()}`, role: "kipu", text: mockTurn.response },
        ]);
        setProbingTurn((t) => t + 1);
        setIsTyping(false);
      })();
    }, 550);
  }, [inputValue, isTyping, convState, confirmedSteps, probingTurn, stalledTurns, displayMessages]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // ── Derived display state ──────────────────────────────────────────────

  const progress = getOnboardingProgress(convState);
  const currentStepIndex = PROGRESS_STEPS.indexOf(convState.currentStep);
  const currentMeta = ONBOARDING_STEP_METADATA[convState.currentStep];

  const lastKipuIdx = displayMessages.reduceRight<number>(
    (found, m, i) => (found === -1 && m.role === "kipu" ? i : found),
    -1,
  );
  const currentKipuText =
    lastKipuIdx >= 0
      ? displayMessages[lastKipuIdx].text
      : getStepQuestion(convState.currentStep);
  const historyMessages = displayMessages
    .filter((_, i) => i !== lastKipuIdx)
    .slice(-5);

  // ── Ya entendí: merge draft + initial Supabase data ────────────────────

  const draft = convState.draft;
  const panelName = draft.profile.fullName ?? initialProfile.full_name ?? "—";
  const panelCountry = draft.profile.country ?? initialProfile.country ?? "—";
  const panelCurrency = draft.profile.baseCurrency ?? initialProfile.base_currency;

  const draftBalance = draft.accounts.reduce(
    (s, a) => s + (a.currentBalance ?? 0),
    0,
  );
  const totalBalance =
    draft.accounts.length > 0
      ? draftBalance
      : initialAccounts.length > 0
        ? initialAccounts.reduce((s, a) => s + Number(a.current_balance_base), 0)
        : null;

  const draftDebt = draft.debtAccounts.reduce(
    (s, d) =>
      s + (d.totalBalance ?? d.currentMonthPayment ?? d.minimumPayment ?? 0),
    0,
  );
  const totalDebt =
    draft.debtAccounts.length > 0
      ? draftDebt
      : initialDebtAccounts.length > 0
        ? initialDebtAccounts.reduce(
            (s, d) => s + Number(d.current_balance_base),
            0,
          )
        : null;

  const totalIncome =
    draft.incomeSources.length > 0
      ? draft.incomeSources.reduce((s, i) => s + (i.amount ?? 0), 0) || null
      : null;

  const totalExpenses =
    draft.fixedExpenses.length > 0
      ? draft.fixedExpenses.reduce((s, e) => s + (e.amount ?? 0), 0) || null
      : null;

  const firstDraftGoal = draft.goals.find(
    (g) => g.name !== "Mi meta" || g.targetAmount !== undefined,
  );
  const firstInitialGoal = initialGoals[0];
  const panelGoal: PanelGoal | null = firstDraftGoal
    ? {
        name: firstDraftGoal.name ?? "Meta",
        current: firstDraftGoal.currentAmount ?? 0,
        target: firstDraftGoal.targetAmount ?? 0,
        currency: firstDraftGoal.currency ?? panelCurrency,
      }
    : firstInitialGoal
      ? {
          name: firstInitialGoal.name,
          current: Number(firstInitialGoal.current_amount),
          target: Number(firstInitialGoal.target_amount),
          currency: firstInitialGoal.currency,
        }
      : null;

  const isAtReview =
    convState.currentStep === "review" ||
    convState.currentStep === "completed";

  // Dynamic typography: very long questions get slightly smaller type
  // to maintain the editorial feel without feeling brusque.
  const isLongQuestion = currentKipuText.length > 90;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Top bar */}
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight text-zinc-100">
          Kipu
        </span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-600">
            {currentMeta.title} · Paso {Math.max(1, currentStepIndex + 1)} de{" "}
            {PROGRESS_STEPS.length}
          </span>
          {convState.currentStep !== "completed" && (
            <button
              className="text-xs font-medium text-zinc-700 transition hover:text-zinc-400"
              onClick={handleRestart}
              type="button"
            >
              Empezar de nuevo
            </button>
          )}
        </div>
      </header>

      {/* Progress line */}
      <ProgressLine percent={progress.percent} />

      {/* Fixed, subtle detail-quality legend — the education lives here, not
          inside the conversation (field QA: the welcome was a manual and the
          inline tips landed out of context). Hidden on review. */}
      {!isAtReview && (
        <p className="mt-3 text-xs leading-5 text-zinc-600">
          Aproximados bienvenidos. Y mientras más detalle des (monto, fecha, cuenta), más preciso
          es tu margen.
        </p>
      )}

      {/* Two-column layout */}
      <div className="mt-20 grid gap-16 lg:grid-cols-[1fr_220px] lg:items-start">

        {/* ── Interview column ────────────────────────────────────── */}
        <div className="flex flex-col gap-8">

          {/* Quiet conversation history */}
          {historyMessages.length > 0 && (
            <div className="flex flex-col gap-2">
              {historyMessages.map((msg) => (
                <p
                  key={msg.id}
                  className={`text-xs leading-relaxed ${
                    msg.role === "kipu"
                      ? "text-zinc-700"
                      : "text-right text-zinc-600"
                  }`}
                >
                  {msg.text.length > 130
                    ? msg.text.slice(0, 130) + "…"
                    : msg.text}
                </p>
              ))}
            </div>
          )}

          {/* Typing indicator */}
          {isTyping && <TypingIndicator />}

          {/* ── Review / completed layout ───────────────────────── */}
          {isAtReview ? (
            <ReviewPanel
              draft={draft}
              baseCurrency={panelCurrency}
              isCompleted={convState.currentStep === "completed"}
              onBeforeSave={clearDraftStorage}
              onPatchDraft={handleReviewPatch}
            />
          ) : (
            <>
              {/* Current question — visual hero */}
              <p
                key={currentKipuText.slice(0, 30)}
                className={[
                  "font-light leading-relaxed tracking-tight text-zinc-100",
                  isLongQuestion
                    ? "text-xl sm:text-2xl"
                    : "text-2xl sm:text-3xl sm:leading-snug",
                ].join(" ")}
              >
                {currentKipuText}
              </p>

              {/* Inline example hint — only on the step's primary question */}
              {currentMeta.examples.length > 0 &&
                !isTyping &&
                currentKipuText === getStepQuestion(convState.currentStep) && (
                  <p className="text-sm text-zinc-500">
                    Puedes responder algo como:{" "}
                    <span className="text-zinc-400">
                      &ldquo;{currentMeta.examples[0]}&rdquo;
                    </span>
                  </p>
                )}
            </>
          )}

          {/* Live input — available on every step EXCEPT the final completed
              screen, so the user can also CORRECT things on the review screen
              ("cambia mi nombre", "mi sueldo es 1400") before confirming. The
              correction flows through the same draft-patch engine. */}
          {convState.currentStep !== "completed" && (
            <>
              {convState.currentStep === "review" && (
                <p className="text-sm text-zinc-500">
                  ¿Algo no cuadra? Dímelo aquí y lo corrijo antes de empezar — por
                  ejemplo &ldquo;cambia mi nombre a…&rdquo; o &ldquo;mi sueldo es
                  1400&rdquo;.
                </p>
              )}
              <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 px-5 py-3.5 transition-colors focus-within:border-zinc-700">
                <input
                  ref={inputRef}
                  autoComplete="off"
                  className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-600 outline-none"
                  disabled={isTyping}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Escribe tu respuesta..."
                  value={inputValue}
                />
                <button
                  aria-label="Enviar"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 transition hover:bg-zinc-700 disabled:opacity-30"
                  disabled={!inputValue.trim() || isTyping}
                  onClick={handleSubmit}
                  type="button"
                >
                  <svg
                    className="h-3.5 w-3.5 text-zinc-300"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M5 12h14M12 5l7 7-7 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              {/* Structured shortcut where chat is weakest: the card/debt
                  matrix. Chat stays the spine; this kills ambiguity. */}
              {convState.currentStep === "debt_accounts" && (
                <DebtQuickForm
                  currency={draft.profile.baseCurrency ?? "USD"}
                  debts={draft.debtAccounts}
                  onApply={handleDebtFormApply}
                  onNoDebts={handleNoDebts}
                />
              )}
            </>
          )}
        </div>

        {/* ── Ya entendí panel (desktop-only: on mobile it duplicates the
              review and pushes the conversation around) ──────────── */}
        <div className="hidden lg:sticky lg:top-10 lg:block">
          <YaEntendiPanel
            name={panelName}
            country={panelCountry}
            currency={panelCurrency}
            email={userEmail}
            totalBalance={totalBalance}
            totalDebt={totalDebt}
            totalIncome={totalIncome}
            totalExpenses={totalExpenses}
            goal={panelGoal}
          />
        </div>

      </div>
    </div>
  );
}

// ── UI sub-components ──────────────────────────────────────────────────────

function ProgressLine({ percent }: { percent: number }) {
  return (
    <div className="relative mt-6 h-px w-full overflow-hidden rounded-full bg-zinc-800">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-zinc-500 transition-all duration-700"
        style={{ width: `${Math.max(4, percent)}%` }}
      />
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-700"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

function YaEntendiPanel({
  name,
  country,
  currency,
  totalBalance,
  totalDebt,
  totalIncome,
  totalExpenses,
  goal,
}: {
  name: string;
  country: string;
  currency: string;
  email: string;
  totalBalance: number | null;
  totalDebt: number | null;
  totalIncome: number | null;
  totalExpenses: number | null;
  goal: PanelGoal | null;
}) {
  const hasFinancials =
    totalBalance !== null ||
    totalDebt !== null ||
    totalIncome !== null ||
    totalExpenses !== null ||
    goal !== null;

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 px-5 py-6">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
        Ya entendí
      </p>
      <div className="mt-5 space-y-4">
        <PanelRow label="Nombre" value={name} />
        <PanelRow label="País" value={country} />
        <PanelRow label="Moneda" value={currency} />
      </div>

      {hasFinancials && (
        <div className="mt-5 space-y-4 border-t border-zinc-800 pt-5">
          {totalBalance !== null && (
            <PanelRow
              label="En cuentas"
              value={formatShort(totalBalance, currency)}
            />
          )}
          {totalDebt !== null && (
            <PanelRow
              label="En tarjetas"
              value={formatShort(totalDebt, currency)}
            />
          )}
          {totalIncome !== null && (
            <PanelRow
              label="Lo que entra"
              value={formatShort(totalIncome, currency) + "/mes"}
            />
          )}
          {totalExpenses !== null && (
            <PanelRow
              label="Lo que sale fijo"
              value={formatShort(totalExpenses, currency) + "/mes"}
            />
          )}
          {goal !== null && goal.target > 0 && (
            <PanelRow
              label="Meta"
              value={`${formatShort(goal.current, goal.currency)} de ${formatShort(goal.target, goal.currency)}`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PanelRow({ label, value }: { label: string; value: string }) {
  const isEmpty = value === "—";
  return (
    // flex-wrap + nowrap value: a long money value ("988.50$/mes") drops to
    // its own full line instead of breaking mid-word ("988.50$/m" + "es").
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <span className="shrink-0 text-xs text-zinc-600">{label}</span>
      <span
        className={[
          "ml-auto whitespace-nowrap text-right text-sm font-medium",
          isEmpty ? "text-zinc-700" : "text-zinc-300",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

function ReviewPanel({
  draft,
  baseCurrency,
  isCompleted,
  onBeforeSave,
  onPatchDraft,
}: {
  draft: OnboardingDraft;
  baseCurrency: string;
  isCompleted: boolean;
  onBeforeSave?: () => void;
  onPatchDraft?: (patch: OnboardingDraftPatch) => void;
}) {
  const [isSaving, startSaveTransition] = useTransition();

  // The first Margen Kipu moment: the REAL engine computes the user's first
  // safe-to-spend number from the draft, before anything is saved. This is the
  // "aha" — the margin is lower than the bank balance, and Kipu explains why.
  const margenPreview = useMemo(() => buildDraftMargenPreview(draft), [draft]);
  const previewCurrency = (draft.profile.baseCurrency ?? baseCurrency ?? "USD") as CurrencyCode;
  const isNegative = (margenPreview?.margenWeekly ?? 0) < 0;
  const canEdit = !isCompleted && Boolean(onPatchDraft);

  // The magic moment must be SEEN: when the review appears, land at the
  // Margen card (after layout settles — and the chat autofocus is disabled on
  // this screen so nothing scrolls the user back down to the input).
  const margenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      margenRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => clearTimeout(t);
  }, []);

  const handleConfirm = () => {
    onBeforeSave?.();
    startSaveTransition(() => {
      saveOnboardingDraftAction(draft);
    });
  };

  const headerText = isCompleted
    ? ONBOARDING_STEP_METADATA["completed"].primaryQuestion
    : ONBOARDING_STEP_METADATA["review"].primaryQuestion;

  // Filter out bogus entries before display
  const reviewAccounts = draft.accounts.filter(isReviewableAccount);
  const reviewDebts = draft.debtAccounts.filter(isReviewableDebt);
  const reviewExpenses = draft.fixedExpenses.filter(isReviewableExpense);
  // Deduplicate goals: remove repeated generic placeholders
  const seenGoalNames = new Set<string>();
  const reviewGoals = draft.goals.filter((g) => {
    if (!isReviewableGoal(g)) return false;
    const key = g.name ?? "Mi meta";
    if (seenGoalNames.has(key) && key === "Mi meta") return false;
    seenGoalNames.add(key);
    return true;
  });

  const isLong = headerText.length > 90;

  return (
    <div className="flex flex-col gap-8">
      <p
        className={[
          "font-light leading-relaxed tracking-tight text-zinc-100",
          isLong ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl sm:leading-snug",
        ].join(" ")}
      >
        {headerText}
      </p>

      {/* The first Margen Kipu — the product promise, before saving anything */}
      {margenPreview && !isNegative ? (
        <section
          ref={margenRef}
          className="scroll-mt-6 rounded-2xl border border-emerald-400/25 bg-gradient-to-b from-emerald-950/50 to-zinc-900 p-6"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/70">
            Tu primer Margen Kipu
          </p>
          <p className="mt-3 text-5xl font-black tracking-tight text-emerald-300">
            {formatKipuMoney(margenPreview.margenWeekly, previewCurrency)}
          </p>
          <p className="mt-2 text-sm font-medium text-zinc-400">
            para esta semana · ≈{" "}
            {formatKipuMoney(margenPreview.margenDaily, previewCurrency)} por día
          </p>
          <p className="mt-4 text-sm leading-6 text-zinc-300">
            Esto es lo que podrías gastar tranquilo: de tus{" "}
            {formatKipuMoney(margenPreview.breakdown.liquidCash, previewCurrency)} líquidos ya
            aparté{" "}
            {formatKipuMoney(margenPreview.breakdown.totalReserved, previewCurrency)} para tus
            pagos, gastos necesarios, deudas y ahorro
            {margenPreview.nextIncomeDate
              ? ` hasta tu próximo ingreso (${margenPreview.nextIncomeDate})`
              : ""}
            .
          </p>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            Es mi primera foto, hecha con lo que me contaste — varios números son aproximados y
            los iremos afinando juntos con tu vida real. Tú vives; yo calculo.
          </p>
          <p className="mt-2 text-xs leading-5 text-zinc-600">
            Solo cuento dinero que ya tienes: lo que te llegue después (sueldo, ventas, lo que te
            deben) entra al margen cuando llegue de verdad.
          </p>
        </section>
      ) : margenPreview && isNegative ? (
        /* Negative first margin: truth without punishment. Explain what it
           means, give the recovery path, and invite correction — the most
           common cause is a big payment (rent) already made this month. */
        <section
          ref={margenRef}
          className="scroll-mt-6 rounded-2xl border border-amber-400/25 bg-gradient-to-b from-amber-950/40 to-zinc-900 p-6"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-300/70">
            Tu primer Margen Kipu
          </p>
          <p className="mt-3 text-4xl font-black tracking-tight text-amber-300">
            Esta semana va justa
          </p>
          <p className="mt-2 text-sm font-medium text-zinc-400">
            margen de la semana:{" "}
            {formatKipuMoney(margenPreview.margenWeekly, previewCurrency)}
          </p>
          <p className="mt-4 text-sm leading-6 text-zinc-300">
            Tus pagos y gastos de aquí a tu próximo ingreso
            {margenPreview.nextIncomeDate ? ` (${margenPreview.nextIncomeDate})` : ""} suman{" "}
            {formatKipuMoney(margenPreview.breakdown.totalReserved, previewCurrency)}, un poco
            más que tus{" "}
            {formatKipuMoney(margenPreview.breakdown.liquidCash, previewCurrency)} líquidos de
            hoy. No es deuda nueva ni una mala nota: solo significa que esta semana conviene
            moverse con lo esencial.
          </p>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            {margenPreview.nextIncomeDate
              ? `Cuando llegue tu ingreso (${margenPreview.nextIncomeDate}), el margen respira de nuevo — y yo te acompaño hasta ahí.`
              : "Cuando llegue tu próximo ingreso, el margen respira de nuevo — y yo te acompaño hasta ahí."}
          </p>
          <p className="mt-3 rounded-xl bg-white/5 px-3 py-2.5 text-xs leading-5 text-amber-100/80">
            Ojo: si alguno de esos pagos grandes ya lo hiciste este mes (por ejemplo el
            arriendo), corrígelo aquí abajo o dímelo en el chat — el número cambia al instante.
          </p>
        </section>
      ) : (
        <section ref={margenRef} className="scroll-mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <p className="text-sm leading-6 text-zinc-400">
            Cuando tengamos al menos una cuenta con saldo y tu ingreso, te muestro aquí tu primer
            Margen Kipu: cuánto puedes gastar tranquilo cada semana. Puedes decírmelo en el chat
            ahora mismo.
          </p>
        </section>
      )}

      {/* The hypotheses Kipu will refine + what it assumed — honest, not
          scary, and DIRECTLY EDITABLE. The three commitment rows are always
          visible (with an "add" affordance), so even if the conversation
          skipped savings/investment, the user can set them right here. */}
      {(() => {
        const estimateRows: {
          label: string;
          key: "essentialMonthlyEstimate" | "monthlySavings" | "monthlyInvestment";
          prefix?: string;
        }[] = [
          { label: "Comida, transporte y esenciales", key: "essentialMonthlyEstimate", prefix: "~" },
          { label: "Ahorro mensual", key: "monthlySavings" },
          { label: "Inversión mensual", key: "monthlyInvestment" },
        ];
        const assumptions = buildReviewAssumptions(draft);
        return (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                Estimados que iré afinando
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-600">
                Si cada mes apartas plata (ahorro, inversión) o quieres ajustar un estimado, ponlo
                aquí — lo protejo antes de calcular tu margen.
              </p>
              <div className="mt-3 space-y-2.5">
                {estimateRows.map((row) => {
                  const current = draft.profile[row.key];
                  const display =
                    current !== undefined && current > 0
                      ? `${row.prefix ?? ""}${formatKipuMoney(current, previewCurrency)}/mes`
                      : "—";
                  return canEdit ? (
                    <EditableReviewItem
                      key={row.key}
                      label={row.label}
                      display={display}
                      emptyHint="añadir"
                      initial={current}
                      onSave={(v) => onPatchDraft?.({ profile: { [row.key]: v } })}
                    />
                  ) : (
                    <ReviewItem key={row.key} label={row.label} value={display} />
                  );
                })}
              </div>
            </div>
            {assumptions.length > 0 && (
              <div className="mt-5 border-t border-zinc-800 pt-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                  Lo que asumí por ahora
                </p>
                <ul className="mt-3 space-y-1.5">
                  {assumptions.map((a) => (
                    <li key={a} className="flex gap-2 text-xs leading-5 text-zinc-500">
                      <span className="text-zinc-700">·</span>
                      {a}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs leading-5 text-zinc-600">
                  Nada de esto te bloquea: corrígelo aquí mismo o cuéntamelo en el chat y lo afino.
                  Mientras más detalle me des de cada cosa (monto, motivo, fecha, cuenta), más
                  preciso es tu margen.
                </p>
              </div>
            )}
          </section>
        );
      })()}

      <div className="space-y-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
        <ReviewSection title="Perfil">
          <ReviewItem label="Nombre" value={draft.profile.fullName ?? "—"} />
          <ReviewItem label="País" value={draft.profile.country ?? "—"} />
          <ReviewItem
            label="Moneda"
            value={draft.profile.baseCurrency ?? baseCurrency}
          />
        </ReviewSection>

        {reviewAccounts.length > 0 && (
          <ReviewSection title="Cuentas">
            {reviewAccounts.map((a) =>
              canEdit ? (
                <EditableReviewItem
                  key={a.draftId}
                  label={a.name ?? "Cuenta"}
                  display={
                    a.currentBalance !== undefined
                      ? formatShort(a.currentBalance, baseCurrency)
                      : "—"
                  }
                  initial={a.currentBalance}
                  onSave={(v) =>
                    onPatchDraft?.({
                      accounts: { upsert: [{ draftId: a.draftId, currentBalance: v }] },
                    })
                  }
                />
              ) : (
                <ReviewItem
                  key={a.draftId}
                  label={a.name ?? "Cuenta"}
                  value={
                    a.currentBalance !== undefined
                      ? formatShort(a.currentBalance, baseCurrency)
                      : "—"
                  }
                />
              ),
            )}
          </ReviewSection>
        )}

        {reviewDebts.length > 0 && (
          <ReviewSection title="Tarjetas y deudas">
            {reviewDebts.map((d) => {
              const activeField =
                d.totalBalance !== undefined
                  ? ("totalBalance" as const)
                  : d.currentMonthPayment !== undefined
                    ? ("currentMonthPayment" as const)
                    : d.minimumPayment !== undefined
                      ? ("minimumPayment" as const)
                      : ("totalBalance" as const);
              const activeValue =
                d.totalBalance ?? d.currentMonthPayment ?? d.minimumPayment;
              return canEdit ? (
                <EditableReviewItem
                  key={d.draftId}
                  label={d.name ?? "Deuda"}
                  display={formatDebtReviewValue(d, baseCurrency)}
                  initial={activeValue}
                  withDay
                  dayInitial={d.dueDay}
                  onSave={(v, day) =>
                    onPatchDraft?.({
                      debtAccounts: {
                        upsert: [
                          {
                            draftId: d.draftId,
                            [activeField]: v,
                            ...(day !== undefined ? { dueDay: day } : {}),
                          },
                        ],
                      },
                    })
                  }
                />
              ) : (
                <ReviewItem
                  key={d.draftId}
                  label={d.name ?? "Deuda"}
                  value={formatDebtReviewValue(d, baseCurrency)}
                />
              );
            })}
          </ReviewSection>
        )}

        {draft.incomeSources.length > 0 && (
          <ReviewSection title="Lo que entra">
            {draft.incomeSources.map((i) => {
              const display =
                i.amount !== undefined
                  ? `${formatShort(i.amount, baseCurrency)}/mes${i.expectedDay ? ` · día ${i.expectedDay}` : ""}`
                  : i.minExpectedAmount !== undefined && i.maxExpectedAmount !== undefined
                    ? `${formatShort(i.minExpectedAmount, baseCurrency)}–${formatShort(i.maxExpectedAmount, baseCurrency)}/mes (variable)`
                    : i.minExpectedAmount !== undefined
                      ? `desde ${formatShort(i.minExpectedAmount, baseCurrency)}/mes (variable)`
                      : "variable";
              return canEdit && i.amount !== undefined ? (
                <EditableReviewItem
                  key={i.draftId}
                  label={i.name ?? "Ingreso"}
                  display={display}
                  initial={i.amount}
                  withDay
                  dayInitial={i.expectedDay}
                  onSave={(v, day) =>
                    onPatchDraft?.({
                      incomeSources: {
                        upsert: [
                          {
                            draftId: i.draftId,
                            amount: v,
                            ...(day !== undefined ? { expectedDay: day } : {}),
                          },
                        ],
                      },
                    })
                  }
                />
              ) : (
                <ReviewItem key={i.draftId} label={i.name ?? "Ingreso"} value={display} />
              );
            })}
          </ReviewSection>
        )}

        {reviewExpenses.length > 0 && (
          <ReviewSection title="Lo que sale fijo">
            {reviewExpenses.map((e) => {
              const display =
                e.amount !== undefined
                  ? `${formatShort(e.amount, baseCurrency)}${e.expectedDay ? ` · día ${e.expectedDay}` : ""}`
                  : "—";
              return canEdit ? (
                <EditableReviewItem
                  key={e.draftId}
                  label={e.name ?? "Gasto"}
                  display={display}
                  emptyHint="añadir monto"
                  initial={e.amount}
                  withDay
                  dayInitial={e.expectedDay}
                  onSave={(v, day) =>
                    onPatchDraft?.({
                      fixedExpenses: {
                        upsert: [
                          {
                            draftId: e.draftId,
                            amount: v,
                            ...(day !== undefined ? { expectedDay: day } : {}),
                          },
                        ],
                      },
                    })
                  }
                />
              ) : (
                <ReviewItem key={e.draftId} label={e.name ?? "Gasto"} value={display} />
              );
            })}
          </ReviewSection>
        )}

        {reviewGoals.length > 0 && (
          <ReviewSection title={reviewGoals.length > 1 ? "Tus metas" : "Tu meta"}>
            {reviewGoals.map((g, goalIdx) => {
              // Hierarchy must be visible: the main (now) goal vs long-term
              // ones — never two goals competing without order (field QA).
              const isMain =
                g.priority === "high" || (goalIdx === 0 && !reviewGoals.some((x) => x.priority === "high"));
              const suffix =
                reviewGoals.length > 1 ? (isMain ? " · principal ahora" : " · más adelante") : "";
              const display =
                (g.targetAmount !== undefined
                  ? formatShort(g.targetAmount, baseCurrency)
                  : g.archetype === "organize_month"
                    ? "sin monto fijo"
                    : "monto por definir") + suffix;
              return canEdit && g.archetype !== "organize_month" ? (
                <EditableReviewItem
                  key={g.draftId}
                  label={g.name ?? "Meta"}
                  display={display}
                  initial={g.targetAmount}
                  onSave={(v) =>
                    onPatchDraft?.({
                      goals: { upsert: [{ draftId: g.draftId, targetAmount: v }] },
                    })
                  }
                />
              ) : (
                <ReviewItem key={g.draftId} label={g.name ?? "Meta"} value={display} />
              );
            })}
          </ReviewSection>
        )}
      </div>

      {!isCompleted && (
        <button
          className="w-full rounded-2xl border border-emerald-800/60 bg-emerald-950/40 px-5 py-4 text-center text-sm font-medium text-emerald-200 transition hover:bg-emerald-950/60 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isSaving}
          onClick={handleConfirm}
          type="button"
        >
          {isSaving ? "Guardando..." : "Confirmar y empezar"}
        </button>
      )}
    </div>
  );
}

function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
        {title}
      </p>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-sm font-medium text-zinc-200">{value}</span>
    </div>
  );
}

// Review row with inline editing (Stage 11.3/11.4): the user fixes an amount
// — and, where it applies, the DAY (payment day, income day, due day) — right
// there, no chat round-trip; the first Margen Kipu recomputes live. The commit
// is a single combined patch so amount+day never race each other.
function EditableReviewItem({
  label,
  display,
  initial,
  emptyHint,
  withDay,
  dayInitial,
  onSave,
}: {
  label: string;
  display: string;
  initial?: number;
  emptyHint?: string;
  /** Show a 1–31 day field next to the amount (cobro/pago/ingreso day). */
  withDay?: boolean;
  dayInitial?: number;
  onSave: (value: number, day?: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial !== undefined ? String(initial) : "");
  const [dayValue, setDayValue] = useState(dayInitial !== undefined ? String(dayInitial) : "");

  const commit = () => {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) {
      const d = Number(dayValue);
      const day = withDay && Number.isFinite(d) && d >= 1 && d <= 31 ? Math.round(d) : undefined;
      onSave(num, day);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-zinc-500">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <input
            autoFocus
            className="kipu-input w-24 rounded-lg border border-emerald-400/40 bg-zinc-950 px-2 py-1 text-right text-sm text-zinc-100 outline-none"
            inputMode="decimal"
            min="0"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            type="number"
            value={value}
          />
          {withDay && (
            <input
              aria-label="Día (1–31)"
              className="kipu-input w-16 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-sm text-zinc-100 outline-none focus:border-emerald-400/40"
              inputMode="numeric"
              max="31"
              min="1"
              onChange={(e) => setDayValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder="día"
              type="number"
              value={dayValue}
            />
          )}
          <button
            aria-label="Guardar"
            className="rounded-md bg-emerald-400 px-2 py-1 text-xs font-bold text-zinc-950"
            onClick={commit}
            type="button"
          >
            ✓
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between gap-4">
      <span className="min-w-0 text-sm text-zinc-500">{label}</span>
      <button
        className="flex shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-zinc-200 transition hover:bg-white/5"
        onClick={() => {
          setValue(initial !== undefined ? String(initial) : "");
          setDayValue(dayInitial !== undefined ? String(dayInitial) : "");
          setEditing(true);
        }}
        type="button"
      >
        <span className={display === "—" ? "text-zinc-600" : ""}>
          {display === "—" && emptyHint ? emptyHint : display}
        </span>
        <svg
          aria-hidden
          className="h-3 w-3 text-zinc-600 transition group-hover:text-zinc-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
