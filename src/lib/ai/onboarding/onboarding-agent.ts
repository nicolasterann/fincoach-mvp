import OpenAI from "openai";
import { applyOnboardingDraftPatch } from "@/lib/ai/onboarding/apply-onboarding-draft-patch";
import type { OnboardingDraftPatch } from "@/lib/ai/onboarding/onboarding-conversation-contract";
import type {
  OnboardingDraft,
  OnboardingDraftDebtAccount,
} from "@/lib/onboarding/draft-types";

// Stage 11.6 — onboarding as an AGENT WITH TOOLS, the same philosophy as the
// daily Kipu chat: the LLM owns the conversation (it interprets ANY phrasing,
// decides whether the user is answering, adding, correcting or closing, and
// chooses tools); deterministic executors validate and apply every draft
// change; a deterministic SEED GATE (`finish_onboarding`) is the only veto.
// No step machine scripts the dialog, no canned responses override the model,
// no closure-phrase lists exist anywhere in this path.

const MAX_TOOL_TURNS = 5;

// ── Seed gate (pure, exported for the deterministic test harness) ────────────

export interface SeedGateResult {
  ready: boolean;
  /** Blocking gaps, in user-facing Spanish (the agent asks for these). */
  missing: string[];
  /** Non-blocking heads-up items (become review assumptions). */
  warnings: string[];
}

function isCreditCard(d: OnboardingDraftDebtAccount): boolean {
  return (d.type ?? "credit_card") === "credit_card";
}

function cardHasActivity(d: OnboardingDraftDebtAccount): boolean {
  return (
    (d.minimumPayment ?? 0) > 0 ||
    (d.currentMonthPayment ?? 0) > 0 ||
    (d.totalBalance ?? 0) > 0
  );
}

export function evaluateSeedGate(
  draft: OnboardingDraft,
  options?: { confirmNoGoalDate?: boolean; confirmNoFixedExpenses?: boolean },
): SeedGateResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!draft.profile.fullName?.trim()) missing.push("el nombre del usuario");
  if (!draft.profile.country?.trim()) missing.push("el país");
  if (!draft.profile.baseCurrency) missing.push("la moneda");

  const accountsWithBalance = draft.accounts.filter(
    (a) => a.name?.trim() && a.currentBalance !== undefined,
  );
  if (accountsWithBalance.length === 0) {
    missing.push("al menos una cuenta con su saldo aproximado");
  }

  const hasDebts = draft.debtAccounts.some((d) => d.name?.trim());
  const debtsExplicitlyEmpty =
    draft.explicitlyEmptySteps?.includes("debt_accounts") ?? false;
  if (!hasDebts && !debtsExplicitlyEmpty) {
    missing.push("sus tarjetas/deudas (o confirmar que no tiene)");
  }

  // Card safety (founder requirement): a card with activity must carry the
  // TOTAL payment due this month — minimum-only seeds inflate Margen Kipu and
  // nudge users toward the minimum-payment trap.
  for (const d of draft.debtAccounts) {
    if (!isCreditCard(d) || !cardHasActivity(d)) continue;
    if ((d.currentMonthPayment ?? 0) <= 0 && (d.totalBalance ?? 0) <= 0) {
      missing.push(
        `el pago TOTAL de este mes de ${d.name ?? "la tarjeta"} (solo tengo el mínimo)`,
      );
    } else if ((d.minimumPayment ?? 0) > 0 && (d.currentMonthPayment ?? 0) <= 0) {
      warnings.push(
        `${d.name ?? "Una tarjeta"}: tengo mínimo y saldo, pero no el pago de este mes.`,
      );
    }
    if (d.dueDay === undefined) {
      warnings.push(`${d.name ?? "Una tarjeta"}: sin día de pago.`);
    }
  }

  const hasIncome = draft.incomeSources.some(
    (s) => (s.amount ?? s.minExpectedAmount ?? 0) > 0,
  );
  if (!hasIncome) missing.push("al menos un ingreso con monto");

  // Fixed expenses are load-bearing for the margin (rent alone can flip it).
  // The agent must ASK — a sim run proved it can otherwise skip the whole
  // section and "complete" with cero fijos and a wildly wrong first margin.
  const hasFixedWithAmount = draft.fixedExpenses.some((f) => (f.amount ?? 0) > 0);
  if (!hasFixedWithAmount && !options?.confirmNoFixedExpenses) {
    missing.push(
      "sus gastos fijos con monto (arriendo, internet, planes…) o confirmar que no tiene ninguno (confirmNoFixedExpenses)",
    );
  }

  // Named fixed expenses must never lose their amount silently (Netflix bug).
  const namedNoAmount = draft.fixedExpenses.filter(
    (f) => f.name?.trim() && f.name !== "Gasto fijo" && f.amount === undefined,
  );
  if (namedNoAmount.length > 0) {
    missing.push(
      `el monto de ${namedNoAmount.map((f) => f.name).join(", ")}`,
    );
  }

  if ((draft.profile.essentialMonthlyEstimate ?? 0) <= 0) {
    missing.push("un aproximado mensual de comida/transporte/esenciales");
  }
  if (
    draft.profile.monthlySavings === undefined &&
    draft.profile.monthlyInvestment === undefined
  ) {
    missing.push("si aparta algo fijo al mes para ahorro/inversión (0 vale)");
  }

  const mainGoal = draft.goals.find((g) => (g.targetAmount ?? 0) > 0);
  if (!mainGoal) {
    missing.push("una meta principal con monto aproximado");
  } else {
    if (mainGoal.currentAmount === undefined) {
      missing.push("cuánto lleva guardado para la meta (0 vale)");
    }
    if (!mainGoal.targetDate && !options?.confirmNoGoalDate) {
      missing.push(
        "la fecha aproximada de la meta (o confirmar que no la sabe con confirmNoGoalDate)",
      );
    }
  }

  if (!draft.coachPreferences.tone) {
    missing.push("el tono preferido (relajado/directo/juguetón)");
  }

  return { ready: missing.length === 0, missing, warnings };
}

// ── Tool executors (deterministic; every change goes through the patch
//    applier; names resolve to existing draftIds so re-mentions update
//    in place instead of duplicating) ─────────────────────────────────────────

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function findByName<T extends { draftId: string; name?: string }>(
  items: T[],
  name: string,
): T | undefined {
  const target = norm(name);
  return (
    items.find((i) => norm(i.name ?? "") === target) ??
    items.find(
      (i) =>
        norm(i.name ?? "").includes(target) || target.includes(norm(i.name ?? "")),
    )
  );
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function day(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 31 ? Math.round(n) : undefined;
}

interface ToolOutcome {
  patch: OnboardingDraftPatch;
  summary: string;
}

function execSetProfile(args: Record<string, unknown>): ToolOutcome {
  const profile: OnboardingDraftPatch["profile"] = {};
  if (typeof args.fullName === "string" && args.fullName.trim()) {
    profile.fullName = args.fullName.trim();
  }
  if (typeof args.country === "string" && args.country.trim()) {
    profile.country = args.country.trim();
  }
  if (typeof args.currency === "string" && args.currency.trim()) {
    profile.baseCurrency = args.currency.trim().toUpperCase() as never;
  }
  return { patch: { profile }, summary: `Perfil actualizado: ${JSON.stringify(profile)}` };
}

function execUpsertAccounts(
  args: Record<string, unknown>,
  draft: OnboardingDraft,
): ToolOutcome {
  const rows = Array.isArray(args.accounts) ? args.accounts : [];
  const upsert = rows
    .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
    .map((r, i) => {
      const name = String(r.name ?? "").trim();
      const prior = name ? findByName(draft.accounts, name) : undefined;
      const type =
        r.type === "cash" || r.type === "wallet" || r.type === "bank"
          ? r.type
          : prior?.type ?? "bank";
      return {
        draftId: prior?.draftId ?? `acc-agent-${Date.now()}-${i}`,
        name: name || prior?.name || "Cuenta",
        type,
        currentBalance: num(r.balance) ?? prior?.currentBalance,
        isPrimary: r.isPrimary === true ? true : prior?.isPrimary,
        liquidity: r.nonLiquid === true ? ("non_liquid" as const) : prior?.liquidity,
        isConfirmed: true,
        confidence: "high" as const,
      };
    })
    .filter((r) => r.name);
  return {
    patch: { accounts: { upsert } },
    summary: `Cuentas registradas: ${upsert.map((u) => `${u.name} (${u.currentBalance ?? "sin saldo"})`).join(", ")}`,
  };
}

function execUpsertDebts(
  args: Record<string, unknown>,
  draft: OnboardingDraft,
): ToolOutcome {
  const rows = Array.isArray(args.debts) ? args.debts : [];
  const upsert = rows
    .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
    .map((r, i) => {
      const name = String(r.name ?? "").trim();
      const prior = name ? findByName(draft.debtAccounts, name) : undefined;
      const kind =
        r.kind === "loan" || r.kind === "family_debt" || r.kind === "other_debt"
          ? r.kind
          : r.kind === "credit_card"
            ? "credit_card"
            : prior?.type ?? "credit_card";
      const item: OnboardingDraftDebtAccount = {
        ...(prior ?? {}),
        draftId: prior?.draftId ?? `debt-agent-${Date.now()}-${i}`,
        name: name || prior?.name || "Deuda",
        type: kind,
        isConfirmed: true,
        confidence: "high",
      };
      const min = num(r.minimumPayment);
      const month = num(r.monthPaymentDue);
      const total = num(r.totalBalance);
      if (min !== undefined) item.minimumPayment = min;
      if (month !== undefined) {
        item.currentMonthPayment = month;
        item.amountInterpretation = "current_month_payment";
      }
      if (total !== undefined) {
        item.totalBalance = total;
        if (month === undefined) item.amountInterpretation = "total_balance";
      }
      if (min !== undefined && month === undefined && total === undefined) {
        item.amountInterpretation = "minimum_payment";
      }
      const due = day(r.dueDay);
      if (due !== undefined) item.dueDay = due;
      return item;
    })
    .filter((r) => r.name);
  return {
    patch: { debtAccounts: { upsert } },
    summary: `Deudas registradas: ${upsert.map((u) => u.name).join(", ")}`,
  };
}

function execMarkNoDebts(): ToolOutcome {
  return {
    patch: { markStepsExplicitlyEmpty: ["debt_accounts"] },
    summary: "Confirmado: sin deudas por ahora.",
  };
}

function execUpsertIncomes(
  args: Record<string, unknown>,
  draft: OnboardingDraft,
): ToolOutcome {
  const rows = Array.isArray(args.incomes) ? args.incomes : [];
  const upsert = rows
    .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
    .map((r, i) => {
      const name = String(r.name ?? "").trim();
      const prior = name ? findByName(draft.incomeSources, name) : undefined;
      const destName = String(r.destinationAccountName ?? "").trim();
      const destination = destName ? findByName(draft.accounts, destName) : undefined;
      const minA = num(r.minAmount);
      const maxA = num(r.maxAmount);
      return {
        draftId: prior?.draftId ?? `inc-agent-${Date.now()}-${i}`,
        name: name || prior?.name || "Ingreso",
        amount: num(r.amount) ?? prior?.amount,
        minExpectedAmount: minA ?? prior?.minExpectedAmount,
        maxExpectedAmount: maxA ?? prior?.maxExpectedAmount,
        isVariable: minA !== undefined || maxA !== undefined || prior?.isVariable,
        frequency:
          r.frequency === "weekly" || r.frequency === "biweekly" || r.frequency === "monthly"
            ? r.frequency
            : prior?.frequency ?? "monthly",
        expectedDay: day(r.expectedDay) ?? prior?.expectedDay,
        destinationAccountDraftId:
          destination?.draftId ?? prior?.destinationAccountDraftId,
        isConfirmed: true,
        confidence: "high" as const,
      };
    })
    .filter((r) => r.name);
  return {
    patch: { incomeSources: { upsert } },
    summary: `Ingresos registrados: ${upsert.map((u) => u.name).join(", ")}`,
  };
}

function execUpsertFixed(
  args: Record<string, unknown>,
  draft: OnboardingDraft,
): ToolOutcome {
  const rows = Array.isArray(args.expenses) ? args.expenses : [];
  const upsert = rows
    .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
    .map((r, i) => {
      const name = String(r.name ?? "").trim();
      const prior = name ? findByName(draft.fixedExpenses, name) : undefined;
      return {
        draftId: prior?.draftId ?? `exp-agent-${Date.now()}-${i}`,
        name: name || prior?.name || "Gasto fijo",
        amount: num(r.amount) ?? prior?.amount,
        expectedDay: day(r.expectedDay) ?? prior?.expectedDay,
        isEssential: prior?.isEssential ?? true,
        isConfirmed: true,
        confidence: "high" as const,
      };
    })
    .filter((r) => r.name);
  return {
    patch: { fixedExpenses: { upsert } },
    summary: `Gastos fijos registrados: ${upsert.map((u) => `${u.name}${u.amount !== undefined ? ` ${u.amount}` : " (sin monto AÚN — pídelo)"}`).join(", ")}`,
  };
}

function execSetCommitments(args: Record<string, unknown>): ToolOutcome {
  const profile: OnboardingDraftPatch["profile"] = {};
  const ess = num(args.essentialMonthly);
  const sav = num(args.monthlySavings);
  const inv = num(args.monthlyInvestment);
  if (ess !== undefined) profile.essentialMonthlyEstimate = ess;
  if (sav !== undefined) profile.monthlySavings = sav;
  if (inv !== undefined) profile.monthlyInvestment = inv;
  return {
    patch: { profile },
    summary: `Compromisos: esenciales ${ess ?? "—"}, ahorro ${sav ?? "—"}, inversión ${inv ?? "—"}`,
  };
}

function execUpsertGoal(
  args: Record<string, unknown>,
  draft: OnboardingDraft,
): ToolOutcome {
  const name = String(args.name ?? "").trim();
  const prior = name ? findByName(draft.goals, name) : draft.goals[0];
  const targetDate =
    typeof args.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.targetDate)
      ? args.targetDate
      : undefined;
  const upsert = [
    {
      draftId: prior?.draftId ?? `goal-agent-${Date.now()}`,
      name: name || prior?.name || "Mi meta",
      archetype: prior?.archetype ?? ("specific_purchase" as const),
      targetAmount: num(args.targetAmount) ?? prior?.targetAmount,
      currentAmount: num(args.currentAmount) ?? prior?.currentAmount,
      targetDate: targetDate ?? prior?.targetDate,
      priority:
        args.longTerm === true ? ("low" as const) : prior?.priority ?? ("high" as const),
      isConfirmed: true,
      confidence: "high" as const,
    },
  ];
  return {
    patch: { goals: { upsert } },
    summary: `Meta: ${upsert[0].name} (${upsert[0].targetAmount ?? "sin monto"}, guardado ${upsert[0].currentAmount ?? "?"}, fecha ${upsert[0].targetDate ?? "—"})`,
  };
}

function execSetTone(args: Record<string, unknown>): ToolOutcome {
  const tone =
    args.tone === "clear" || args.tone === "coach_like" || args.tone === "playful"
      ? args.tone
      : "clear";
  return {
    patch: { coachPreferences: { tone, dailyCheckinEnabled: true } },
    summary: `Tono preferido: ${tone}`,
  };
}

function execRememberNote(args: Record<string, unknown>): ToolOutcome {
  const content = String(args.content ?? "").trim();
  const noteType =
    args.noteType === "preference" ||
    args.noteType === "constraint" ||
    args.noteType === "goal_context" ||
    args.noteType === "risk_context" ||
    args.noteType === "behavior_pattern"
      ? args.noteType
      : "general";
  if (!content) return { patch: {}, summary: "Nota vacía: ignorada." };
  return {
    patch: {
      userContextNotes: [
        {
          draftId: `note-agent-${Date.now()}`,
          content: content.slice(0, 400),
          noteType,
          createdAt: new Date().toISOString(),
        },
      ],
    },
    summary: `Nota guardada (${noteType}).`,
  };
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "set_profile",
      description: "Guarda nombre, país y/o moneda del usuario.",
      parameters: {
        type: "object",
        properties: {
          fullName: { type: "string" },
          country: { type: "string", description: "País completo, p.ej. 'Ecuador' (acepta abreviaturas del usuario como 'ec')." },
          currency: { type: "string", description: "Código ISO, p.ej. USD." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_accounts",
      description:
        "Registra o actualiza cuentas/efectivo/billeteras (varias a la vez). Re-mencionar un nombre existente ACTUALIZA esa cuenta, no duplica.",
      parameters: {
        type: "object",
        properties: {
          accounts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                balance: { type: "number", description: "Saldo aproximado." },
                type: { type: "string", enum: ["bank", "cash", "wallet"] },
                isPrimary: { type: "boolean", description: "true si es la cuenta del día a día." },
                nonLiquid: { type: "boolean", description: "true si es ahorro/inversión que NO toca para gastar." },
              },
              required: ["name"],
              additionalProperties: false,
            },
          },
        },
        required: ["accounts"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_debts",
      description:
        "Registra o actualiza tarjetas y deudas. Distingue SIEMPRE: minimumPayment (pago mínimo), monthPaymentDue (pago TOTAL de este mes — el dato más importante para el margen) y totalBalance (deuda acumulada total). dueDay = día de pago.",
      parameters: {
        type: "object",
        properties: {
          debts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                kind: { type: "string", enum: ["credit_card", "loan", "family_debt", "other_debt"] },
                minimumPayment: { type: "number" },
                monthPaymentDue: { type: "number", description: "Pago TOTAL que debe hacer este mes." },
                totalBalance: { type: "number", description: "Deuda total acumulada." },
                dueDay: { type: "number", description: "Día de pago 1-31." },
              },
              required: ["name"],
              additionalProperties: false,
            },
          },
        },
        required: ["debts"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_no_debts",
      description: "El usuario confirmó que NO tiene tarjetas ni deudas.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_incomes",
      description:
        "Registra ingresos. Sueldo dividido = dos entradas con nombres claros ('Sueldo (fin de mes)' / 'Sueldo (inicio de mes)'). Variable = minAmount/maxAmount. expectedDay = día que cae. destinationAccountName = a qué cuenta llega (por nombre).",
      parameters: {
        type: "object",
        properties: {
          incomes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                amount: { type: "number" },
                minAmount: { type: "number" },
                maxAmount: { type: "number" },
                frequency: { type: "string", enum: ["monthly", "biweekly", "weekly"] },
                expectedDay: { type: "number" },
                destinationAccountName: { type: "string" },
              },
              required: ["name"],
              additionalProperties: false,
            },
          },
        },
        required: ["incomes"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_fixed_expenses",
      description:
        "Registra gastos fijos (cuotas iguales cada mes: arriendo, internet, suscripciones). NUNCA comida/transporte (eso va en set_commitments). expectedDay = día de cobro. Un fijo nombrado sin monto queda pendiente — consíguele monto antes de cerrar.",
      parameters: {
        type: "object",
        properties: {
          expenses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                amount: { type: "number", description: "Si varía (servicios 20-80), usa el promedio y guarda nota." },
                expectedDay: { type: "number" },
              },
              required: ["name"],
              additionalProperties: false,
            },
          },
        },
        required: ["expenses"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_commitments",
      description:
        "Guarda el estimado mensual de esenciales (comida/transporte/día a día) y el ahorro/inversión mensual apartado. 0 es válido (= no aparta).",
      parameters: {
        type: "object",
        properties: {
          essentialMonthly: { type: "number" },
          monthlySavings: { type: "number" },
          monthlyInvestment: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_goal",
      description:
        "Registra/actualiza la meta. targetDate YYYY-MM-DD (fechas vagas como 'el próximo año' → fecha aproximada razonable + remember_note con la frase literal). currentAmount = lo ya guardado (0 vale). longTerm=true para una segunda meta de largo plazo.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          targetAmount: { type: "number" },
          currentAmount: { type: "number" },
          targetDate: { type: "string" },
          longTerm: { type: "boolean" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_tone",
      description: "Guarda el tono preferido: clear (relajado/claro), coach_like (directo/firme), playful (juguetón).",
      parameters: {
        type: "object",
        properties: {
          tone: { type: "string", enum: ["clear", "coach_like", "playful"] },
        },
        required: ["tone"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_note",
      description:
        "Guarda un hecho de contexto que no cabe en filas: 'el arriendo sube cada 3 meses', 'servicios varían 20-80', 'aparta 250 sin especificar ahorro o inversión', 'meta para el próximo año (aprox)'.",
      parameters: {
        type: "object",
        properties: {
          noteType: {
            type: "string",
            enum: ["general", "preference", "constraint", "goal_context", "risk_context", "behavior_pattern"],
          },
          content: { type: "string" },
        },
        required: ["noteType", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish_onboarding",
      description:
        "Llámala cuando creas que la semilla está completa. El sistema valida DATOS (no fraseo): si falta algo te devuelve la lista exacta para preguntarlo; si está completa, pasa a la revisión final. confirmNoGoalDate=true solo si el usuario dijo que no sabe la fecha de su meta; confirmNoFixedExpenses=true solo si confirmó que no tiene ningún gasto fijo.",
      parameters: {
        type: "object",
        properties: {
          confirmNoGoalDate: { type: "boolean" },
          confirmNoFixedExpenses: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  },
];

// ── Prompt ───────────────────────────────────────────────────────────────────

function summarizeDraft(draft: OnboardingDraft): string {
  const acc = draft.accounts
    .map((a) => `${a.name}: ${a.currentBalance ?? "?"}${a.isPrimary ? " (principal)" : ""}`)
    .join("; ");
  const debts = draft.debtAccounts
    .map(
      (d) =>
        `${d.name}: mín ${d.minimumPayment ?? "—"}, mes ${d.currentMonthPayment ?? "—"}, total ${d.totalBalance ?? "—"}, paga el ${d.dueDay ?? "—"}`,
    )
    .join("; ");
  const inc = draft.incomeSources
    .map((s) => `${s.name}: ${s.amount ?? `${s.minExpectedAmount ?? "?"}-${s.maxExpectedAmount ?? "?"}`} (día ${s.expectedDay ?? "—"})`)
    .join("; ");
  const fixed = draft.fixedExpenses
    .map((f) => `${f.name}: ${f.amount ?? "SIN MONTO"} (día ${f.expectedDay ?? "—"})`)
    .join("; ");
  const goal = draft.goals
    .map((g) => `${g.name}: ${g.targetAmount ?? "?"} (guardado ${g.currentAmount ?? "?"}, fecha ${g.targetDate ?? "—"}, ${g.priority ?? "—"})`)
    .join("; ");
  const p = draft.profile;
  return [
    `Perfil: ${p.fullName ?? "—"}, ${p.country ?? "—"}, ${p.baseCurrency ?? "—"}; esenciales ${p.essentialMonthlyEstimate ?? "—"}, ahorro ${p.monthlySavings ?? "—"}, inversión ${p.monthlyInvestment ?? "—"}; tono ${draft.coachPreferences.tone ?? "—"}`,
    `Cuentas: ${acc || "ninguna"}`,
    `Deudas: ${debts || (draft.explicitlyEmptySteps?.includes("debt_accounts") ? "confirmado sin deudas" : "ninguna aún")}`,
    `Ingresos: ${inc || "ninguno"}`,
    `Fijos: ${fixed || "ninguno"}`,
    `Meta: ${goal || "ninguna"}`,
  ].join("\n");
}

function buildSystemPrompt(draft: OnboardingDraft): string {
  const gate = evaluateSeedGate(draft);
  return `Eres Kipu, un coach financiero cálido haciendo el onboarding conversacional de un usuario LatAm normal (no financiero). Tu trabajo: en una conversación corta y humana, sembrar su realidad financiera mínima para calcular su primer Margen Kipu. TÚ conduces la conversación y TÚ interpretas el lenguaje; las herramientas guardan los datos; el sistema solo valida que la semilla esté completa.

REGLAS DE ORO:
- UNA pregunta por turno, máximo 2 frases antes. Cálido, natural, cero jerga (nada de "liquidez", "flujo de caja"). PROHIBIDO "clavar/clavarlo" y PROHIBIDO prometer recordatorios/avisos ("recordar", "te aviso" — esa capacidad no existe aún).
- Aproximados y números redondos siempre bienvenidos. "No sé" es válido: propone TÚ un redondo razonable y sigue.
- CIERRES: cualquier frase humana de cierre ("es todo", "ahí estamos ok", "dale", "ya", "sigamos") la interpretas TÚ y pasas al siguiente tema SIN re-preguntar. Re-preguntar tras un cierre es el peor error posible.
- Lo que el usuario YA dijo (mira el historial y el estado) NUNCA se re-pregunta. Si corrige o repite con fastidio, aplica literal y avanza.
- Multi-ítem en un mensaje → captúralos TODOS en una sola llamada de herramienta y confírmalos por nombre.
- FIDELIDAD: usa exactamente los números del mensaje del usuario.
- Detalles DENTRO de la pregunta cuando aplique: "¿cuánto y más o menos qué día?" (fijos, tarjetas, ingresos). Comida/transporte NO son fijos → set_commitments.
- TARJETAS (crítico para no empujar a la trampa del pago mínimo): si te dan solo el MÍNIMO, pregunta UNA vez el pago TOTAL de este mes ("¿y en total cuánto te toca pagar este mes en esa tarjeta?"). Si no lo sabe, usa monthPaymentDue = mínimo y guarda remember_note de que solo conocemos el mínimo. Captura también el día de pago. Deudas informales (amigo/familia): solo monto total, sin interrogatorio.
- AHORRO/INVERSIÓN: pregunta cuánto aparta al mes, si es ahorro o inversión y cuándo. Ambiguo → UNA aclaración; si no precisa → monthlySavings + nota.
- META: con monto fijado, pregunta (una vez cada una) cuánto lleva guardado y para cuándo aproximadamente. Fechas vagas ("el próximo año") → tradúcelas a una targetDate razonable + remember_note con la frase literal; NUNCA las pierdas. Si no sabe el costo, propón un redondo. UNA meta principal basta; no invites a más.
- Contexto vital ("el arriendo sube cada 3 meses", "varía entre 20 y 80") → remember_note SIEMPRE, en el mismo turno.
- Cuando creas que está todo, llama finish_onboarding: si falta algo, el sistema te dice exactamente qué — pregúntalo natural. No anuncies "voy a guardar"; simplemente conversa.

ORDEN SUGERIDO (flexible, sigue el hilo humano): nombre → país/moneda → cuentas (+cuál es la del día a día) → tarjetas/deudas (montos: mínimo/mes/total + día) → ingresos (monto + día + cuenta) → fijos (monto + día) → esenciales → ahorro/inversión → meta (monto + guardado + fecha) → tono → finish_onboarding.

=== ESTADO ACTUAL DEL BORRADOR ===
${summarizeDraft(draft)}

=== LO QUE AÚN FALTA (según el validador) ===
${gate.missing.length > 0 ? gate.missing.map((m) => `- ${m}`).join("\n") : "- nada: llama finish_onboarding"}
${gate.warnings.length > 0 ? `Avisos: ${gate.warnings.join(" | ")}` : ""}

Responde SIEMPRE en español LatAm natural. Tu mensaje final del turno es solo texto humano (sin JSON ni nombres de herramientas).`;
}

// ── Agent loop ───────────────────────────────────────────────────────────────

export interface OnboardingAgentTurnInput {
  draft: OnboardingDraft;
  recentMessages: { from: "kipu" | "user"; text: string }[];
  latestUserMessage: string;
}

export interface OnboardingAgentTurnResult {
  ok: boolean;
  reply?: string;
  draft?: OnboardingDraft;
  /** True when the seed gate passed and the UI should show the review. */
  done?: boolean;
  toolsUsed?: string[];
}

export async function runOnboardingAgentTurn(
  input: OnboardingAgentTurnInput,
): Promise<OnboardingAgentTurnResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false };

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_ONBOARDING_MODEL ?? "gpt-5.4";

  let draft = input.draft;
  let done = false;
  const toolsUsed: string[] = [];

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(draft) },
    ...input.recentMessages.slice(-14).map((m) => ({
      role: m.from === "kipu" ? ("assistant" as const) : ("user" as const),
      content: m.text,
    })),
    { role: "user", content: input.latestUserMessage },
  ];

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.3,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      });
      const choice = completion.choices[0]?.message;
      if (!choice) return { ok: false };

      messages.push(choice);
      const toolCalls = choice.tool_calls ?? [];

      if (toolCalls.length === 0) {
        const reply = (choice.content ?? "").trim();
        if (!reply) return { ok: false };
        return { ok: true, reply, draft, done, toolsUsed };
      }

      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        toolsUsed.push(call.function.name);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        let resultSummary: string;
        if (call.function.name === "finish_onboarding") {
          const gate = evaluateSeedGate(draft, {
            confirmNoGoalDate: args.confirmNoGoalDate === true,
            confirmNoFixedExpenses: args.confirmNoFixedExpenses === true,
          });
          if (gate.ready) {
            done = true;
            resultSummary =
              "Semilla completa. Despídete en UNA frase cálida anunciando que le muestras su primer Margen Kipu (la revisión aparece automáticamente).";
          } else {
            resultSummary = `Aún falta: ${gate.missing.join("; ")}. Pregunta lo siguiente de forma natural (una cosa a la vez).`;
          }
        } else {
          const outcome = executeOnboardingTool(call.function.name, args, draft);
          draft = applyOnboardingDraftPatch(draft, outcome.patch);
          resultSummary = outcome.summary;
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: resultSummary,
        });
      }
      // Refresh the system prompt's draft state for the next reasoning turn.
      messages[0] = { role: "system", content: buildSystemPrompt(draft) };
    }

    // Tool budget exhausted: force a final natural reply.
    const final = await client.chat.completions.create({
      model,
      temperature: 0.3,
      messages: [
        ...messages,
        {
          role: "system",
          content: "Responde ya al usuario en una frase natural, sin más herramientas.",
        },
      ],
    });
    const reply = (final.choices[0]?.message?.content ?? "").trim();
    if (!reply) return { ok: false };
    return { ok: true, reply, draft, done, toolsUsed };
  } catch {
    return { ok: false };
  }
}

// Exported for the deterministic field-test harness: lets QA drive the exact
// tool layer the live agent uses, with zero AI involved.
export function executeOnboardingTool(
  name: string,
  args: Record<string, unknown>,
  draft: OnboardingDraft,
): ToolOutcome {
  switch (name) {
    case "set_profile":
      return execSetProfile(args);
    case "upsert_accounts":
      return execUpsertAccounts(args, draft);
    case "upsert_debts":
      return execUpsertDebts(args, draft);
    case "mark_no_debts":
      return execMarkNoDebts();
    case "upsert_incomes":
      return execUpsertIncomes(args, draft);
    case "upsert_fixed_expenses":
      return execUpsertFixed(args, draft);
    case "set_commitments":
      return execSetCommitments(args);
    case "upsert_goal":
      return execUpsertGoal(args, draft);
    case "set_tone":
      return execSetTone(args);
    case "remember_note":
      return execRememberNote(args);
    default:
      return { patch: {}, summary: `Herramienta desconocida: ${name}` };
  }
}
