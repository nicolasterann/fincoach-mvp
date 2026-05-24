"use client";

import { useState, useRef, useEffect, useCallback, useTransition } from "react";
import { processOnboardingTurnAction } from "./ai-actions";
import { saveOnboardingDraftAction } from "./save-actions";
import { applyOnboardingDraftPatch } from "@/lib/ai/onboarding/apply-onboarding-draft-patch";
import type { OnboardingTurnOutput } from "@/lib/ai/onboarding/onboarding-conversation-contract";
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

function resolveAiNextStep(
  snapshot: OnboardingConversationState,
  patchedDraft: OnboardingDraft,
  aiResult: OnboardingTurnOutput,
): OnboardingStep {
  const prevStep = snapshot.currentStep;
  const isCollection = COLLECTION_STEPS.has(prevStep);
  const markedEmptyByPatch =
    aiResult.patch.markStepsExplicitlyEmpty?.includes(prevStep) ?? false;

  const updatedState: OnboardingConversationState = {
    ...snapshot,
    draft: patchedDraft,
    updatedAt: new Date().toISOString(),
  };

  if (isCollection && !aiResult.advanceToStep && !markedEmptyByPatch) {
    return prevStep;
  }

  let nextStep = getNextOnboardingStep(updatedState);

  if (
    aiResult.advanceToStep &&
    aiResult.advanceToStep !== "completed" &&
    (!isCollection || isStepComplete(prevStep, patchedDraft))
  ) {
    const proposed = aiResult.advanceToStep;
    const proposedIndex = ONBOARDING_STEP_ORDER.indexOf(proposed);
    const machineIndex = ONBOARDING_STEP_ORDER.indexOf(nextStep);

    if (proposedIndex >= 0 && proposedIndex <= machineIndex) {
      nextStep = proposed;
    }
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

function formatShort(amount: number, currency: string): string {
  const n = Math.round(amount);
  if (currency === "EUR") return `${n}€`;
  return `${n}$`;
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
 * collection step.
 */
function userConfirmedNoMore(lower: string): boolean {
  return /\b(eso es todo|nada m[aá]s|no tengo m[aá]s|solo eso|s[íi].*eso es|no.*nada m[aá]s|no hay m[aá]s|creo que eso|por ahora eso|ya no hay|no m[aá]s|con eso)\b/i.test(
    lower,
  );
}

/**
 * True when the user is confirming that a goal is their priority,
 * not describing a new goal.
 */
function userConfirmedPriority(lower: string): boolean {
  return /\b(s[íi]|esa es|es mi prioridad|prioridad principal|esa[,.]?$|correcto|exacto|s[íi][,.]?\s*esa|esa es mi)\b/i.test(
    lower,
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
      // Daily check-in is the recommended default; this step just asks for tone preference.
      draft.coachPreferences.dailyCheckinEnabled = true;
      if (/directo|al grano/i.test(lower)) {
        draft.coachPreferences.tone = "coach_like";
      } else if (
        /relajado|tranquilo|calmado|claro|suave|cortos?|pausado/i.test(lower)
      ) {
        draft.coachPreferences.tone = "clear";
      } else if (
        /juguetón|cercano|playful|informal|divertido|con humor/i.test(lower)
      ) {
        draft.coachPreferences.tone = "playful";
      } else {
        // Default: relaxed tone if nothing specific was detected
        draft.coachPreferences.tone = "clear";
      }
      break;
    }

    case "review":
      break;
  }

  return { draft, markedEmpty: false };
}

// ── Step-specific stay responses ────────────────────────────────────────────
// TODO: Replace with AI-generated responses once the engine is integrated.

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
    const name = draft.accounts.at(-1)?.name ?? "esa cuenta";
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
    return "¿Y tienes otra tarjeta, préstamo, deuda familiar o algo informal que también debamos tomar en cuenta?";
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
    return "Además de eso, ¿hay algo que entre de vez en cuando? Freelance, comisiones, ventas, ayuda familiar o algún ingreso irregular.";
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
    return "Bien. Ahora pensemos en los que suelen escaparse: celular, transporte, comida fija, suscripciones, ayuda familiar o pagos anuales. ¿Hay alguno más?";
  }
  return "¿Algún otro gasto que aparezca casi todos los meses, aunque sea pequeño o poco frecuente?";
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
  const justAdded = draft.goals.length > prevDraft.goals.length;
  if (justAdded) {
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

function isReviewableExpense(
  e: OnboardingDraft["fixedExpenses"][number],
): boolean {
  return e.amount !== undefined;
}

function isReviewableGoal(g: OnboardingDraft["goals"][number]): boolean {
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

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [isTyping]);

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

    setTimeout(() => {
      void (async () => {
        try {
          const aiResult = await processOnboardingTurnAction({
            state: snapshot,
            latestUserMessage: text,
            localeHint: "es-LATAM",
          });

          if (isUsefulAiResult(aiResult)) {
            const patchedDraft = applyOnboardingDraftPatch(
              snapshot.draft,
              aiResult.patch,
            );
            const prevStep = snapshot.currentStep;
            const nextStep = resolveAiNextStep(snapshot, patchedDraft, aiResult);

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
            if (COLLECTION_STEPS.has(prevStep) && nextStep !== prevStep) {
              newConfirmed[prevStep] = true;
            }

            const response = resolveAiAssistantMessage(aiResult);

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
        setDisplayMessages((prev) => [
          ...prev,
          { id: `k-${Date.now()}`, role: "kipu", text: mockTurn.response },
        ]);
        setProbingTurn((t) => t + 1);
        setIsTyping(false);
      })();
    }, 550);
  }, [inputValue, isTyping, convState, confirmedSteps, probingTurn]);

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
        <span className="text-sm text-zinc-600">
          {currentMeta.title} · Paso {Math.max(1, currentStepIndex + 1)} de{" "}
          {PROGRESS_STEPS.length}
        </span>
      </header>

      {/* Progress line */}
      <ProgressLine percent={progress.percent} />

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

              {/* Live input */}
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
            </>
          )}
        </div>

        {/* ── Ya entendí panel ──────────────────────────────────── */}
        <div className="lg:sticky lg:top-10">
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
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-xs text-zinc-600">{label}</span>
      <span
        className={[
          "truncate text-right text-sm font-medium",
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
}: {
  draft: OnboardingDraft;
  baseCurrency: string;
  isCompleted: boolean;
}) {
  const [isSaving, startSaveTransition] = useTransition();

  const handleConfirm = () => {
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
            {reviewAccounts.map((a) => (
              <ReviewItem
                key={a.draftId}
                label={a.name ?? "Cuenta"}
                value={
                  a.currentBalance !== undefined
                    ? formatShort(a.currentBalance, baseCurrency)
                    : "—"
                }
              />
            ))}
          </ReviewSection>
        )}

        {reviewDebts.length > 0 && (
          <ReviewSection title="Tarjetas y deudas">
            {reviewDebts.map((d) => (
              <ReviewItem
                key={d.draftId}
                label={d.name ?? "Deuda"}
                value={
                  [
                    d.totalBalance !== undefined
                      ? `total ${formatShort(d.totalBalance, baseCurrency)}`
                      : null,

                    d.minimumPayment !== undefined
                      ? `mín. ${formatShort(d.minimumPayment, baseCurrency)}`
                      : null,

                    d.currentMonthPayment !== undefined
                      ? `mes ${formatShort(d.currentMonthPayment, baseCurrency)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"
                }
              />
            ))}
          </ReviewSection>
        )}

        {draft.incomeSources.length > 0 && (
          <ReviewSection title="Lo que entra">
            {draft.incomeSources.map((i) => (
              <ReviewItem
                key={i.draftId}
                label={i.name ?? "Ingreso"}
                value={
                  i.amount !== undefined
                    ? formatShort(i.amount, baseCurrency) + "/mes"
                    : "—"
                }
              />
            ))}
          </ReviewSection>
        )}

        {reviewExpenses.length > 0 && (
          <ReviewSection title="Lo que sale fijo">
            {reviewExpenses.map((e) => (
              <ReviewItem
                key={e.draftId}
                label={e.name ?? "Gasto"}
                value={formatShort(e.amount!, baseCurrency)}
              />
            ))}
          </ReviewSection>
        )}

        {reviewGoals.length > 0 && (
          <ReviewSection title="Tu meta">
            {reviewGoals.map((g) => (
              <ReviewItem
                key={g.draftId}
                label={g.name ?? "Meta"}
                value={
                  g.targetAmount !== undefined
                    ? formatShort(g.targetAmount, baseCurrency)
                    : "—"
                }
              />
            ))}
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
