import type OpenAI from "openai";
import {
  applyChatTransactionIntent,
  applyLedgerEntriesAtomic,
  applyLedgerEntry,
  channelToInputChannel,
  correctTransactionByReplacement,
  correctTransactionMetadata,
  isOwnershipViolation,
  reconcileAccountBalance,
  reverseStoredTransaction,
  type LedgerEntryInput,
} from "@/lib/ai/apply-chat-transaction-intent";
import {
  movementFingerprint,
  nextDedupeKey,
  reconcileOperationId,
} from "@/lib/ai/operation-identity";
import { recentExactDuplicate } from "@/lib/capture/capture-matching";
import {
  resolveMovementCurrency,
  type CurrencyResolution,
} from "@/lib/financial/currency-resolver";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import type { AdvisorySnapshot } from "@/lib/ai/advisory-handler";
import {
  classifyAdvisoryItemKind,
  evaluateAdvisoryDecision,
} from "@/lib/financial/advisory-decision-engine";
import { saveAmbientPrefs, type AmbientPrefPatch } from "@/lib/ambient/ambient-store";
import type { CoachingBriefing } from "@/lib/financial/coaching-signals";
import { payoffInputsFromHealth, type CardHealth } from "@/lib/financial/debt-health";
import { decideApplyObligations } from "@/lib/financial/debt-statement";
import { planPayoff, type PayoffStrategy } from "@/lib/financial/debt-payoff";
import { compareDebtVsInvestment } from "@/lib/financial/debt-vs-investment";
import { comparePayments, costOfDelay, type RateKind } from "@/lib/financial/interest-math";
import { simulateScenario, type ScenarioSpec } from "@/lib/financial/cashflow-scenario";
import { merchantKey } from "@/lib/financial/merchant-normalization";
import { saveMerchantCorrection } from "@/lib/financial/merchant-memory-store";
import { createGoalRow, updateGoalRow, registerInvestmentRow, setGoalPrefs, type CreateGoalArgs } from "@/lib/financial/goals-wealth-store";
import { setPersonalizationPref, setCommunicationPref, upsertLifeContext, removeLifeContext, resetPersonalization, logPreferenceEvent } from "@/lib/financial/personalization-store";
import type { FinancialPhilosophy } from "@/types/financial";
import { evaluatePurchase, planMiniGoal } from "@/lib/financial/mini-goal";
import type { AssetClass } from "@/lib/financial/net-worth";
import type { AmbitionMode, GoalArchetype, GoalCadence } from "@/types/financial";
import { formatMoney } from "@/lib/financial/money";
import {
  markWeekReconciled,
  setEngagementMode,
  setMargenCommitments,
} from "@/lib/financial/coach-state-store";
import {
  applyReceivableRepayment,
  createFixedExpense,
  createReceivable,
  createScheduledPayment,
  findSimilarFixedExpenses,
  updateFixedExpenseFields,
} from "@/lib/financial/commitments-store";
import {
  findDuplicateCandidates,
  findUndoTarget,
  isUndoEligible,
  loadRecentTransactions,
  type StoredTransaction,
} from "@/lib/financial/transaction-recovery";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type {
  Account,
  CurrencyCode,
  DebtAccount,
  FinancialCategory,
  FinancialGoal,
  PaymentFrequency,
} from "@/types/financial";
import type {
  DebtPaymentIntent,
  ExpenseIntent,
  GoalContributionIntent,
  IncomeIntent,
  RefundIntent,
  TransferIntent,
} from "@/types/transaction-intents";

// The safe, typed capability surface the Kipu agent can call. The LLM decides
// WHICH tool and WHAT args; these executors VALIDATE against real state and
// execute through the existing single writer (ledger) or domain store. The LLM
// never writes the DB directly and never issues raw SQL. A tool returns a
// structured result so the agent can ask a smart follow-up instead of guessing.

export interface AgentContext {
  userId: string;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  // Derived weekly/debt snapshot, so read-only tools (e.g. evaluate_purchase)
  // can reason about after-purchase state deterministically.
  snapshot: AdvisorySnapshot;
  // Proactive coaching briefing (signals, next-best-action, wellness metrics),
  // computed once per turn so the agent can coach proactively and reconcile.
  briefing: CoachingBriefing;
  channel?: ChatChannel;
  chatId?: string | null;
  rawMessage: string;
  // The user's base/display currency, so card-obligation base conversion stays
  // honest when a card is in another currency.
  baseCurrency: CurrencyCode;
  // Trusted evidence provenance for THIS run, set by the capture pipeline (never
  // by the model). Every movement written this turn is linked to it.
  evidenceId?: string | null;
  // Phase 3 — trusted, server-derived operation namespace for THIS turn, stable
  // across retries of the same delivery (Telegram update_id / web submission id /
  // evidence id). Drives deterministic per-movement dedupe keys so a redelivered
  // turn is idempotent at the ledger boundary. `dedupeOcc` counts identical
  // fingerprints within the turn; `reconcileSeq` numbers reconciliations.
  operationId?: string | null;
  dedupeOcc?: Map<string, number>;
  reconcileSeq?: { n: number };
  // Within-turn freshness: write executors set `dirty` after a successful write
  // so the read-only tools (get_proactive_briefing, evaluate_purchase) refresh
  // the snapshot/briefing BEFORE reasoning — a Margen reported (or a purchase
  // evaluated) after a same-turn write must not use the stale start-of-turn
  // figure. `refresh` rebuilds live financial state in place; it is optional, so
  // callers that build the context directly (gate/sims) keep cached behaviour.
  dirty?: boolean;
  refresh?: () => Promise<void>;
}

export type ToolStatus = "done" | "needs_info" | "refused" | "error";

export interface ToolResult {
  status: ToolStatus;
  // A short FACTUAL summary for the agent to reason over (not the user reply).
  summary: string;
  data?: unknown;
}

const VALID_CATEGORIES = new Set<FinancialCategory>([
  "food",
  "transport",
  "shopping",
  "subscriptions",
  "travel",
  "housing",
  "utilities",
  "health",
  "education",
  "entertainment",
  "family",
  "debt",
  "savings",
  "income",
  "other",
]);

const VALID_NOTE_TYPES = new Set([
  "general",
  "preference",
  "constraint",
  "goal_context",
  "risk_context",
  "behavior_pattern",
]);

// Tool schemas (OpenAI function-calling). Kept small for Stage 1; grows as the
// agent absorbs more of the legacy capability set.
export const KIPU_TOOL_SCHEMAS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_financial_context",
      description:
        "Re-read the user's current financial snapshot (balances, weekly margin, debts, goal, fixed expenses). Use when you need fresh numbers before answering or acting.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "log_movement",
      description:
        "Record a real financial movement the user already made. expense lowers an account OR raises a card debt (card = debt, never available money). income raises an account. debt_payment lowers an account and lowers a debt. goal_contribution lowers an account and raises a goal. Only call when you have a clear amount and source; otherwise ask the user.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["expense", "income", "debt_payment", "goal_contribution"],
          },
          amount: { type: "number" },
          description: { type: "string", description: "Short human label in Spanish, e.g. \"Café\"." },
          category: {
            type: "string",
            enum: [
              "food",
              "transport",
              "shopping",
              "subscriptions",
              "travel",
              "housing",
              "utilities",
              "health",
              "education",
              "entertainment",
              "family",
              "debt",
              "savings",
              "income",
              "other",
            ],
          },
          sourceAccountId: { type: "string", description: "Account the money left from (expense/debt_payment/goal_contribution)." },
          debtAccountId: { type: "string", description: "Card/debt: for an expense it is the card used; for a debt_payment it is the debt being paid." },
          destinationAccountId: { type: "string", description: "Account the money arrived to (income), or the goal's account (goal_contribution)." },
          goalId: { type: "string" },
          fixedExpenseId: { type: "string", description: "If this expense is paying a fixed/recurring expense the user already has (see context), pass its id so it links to that recurring expense and is NOT double-counted as extra spending." },
          externalRef: { type: "string", description: "Bank reference / authorization code when the evidence includes one — the strongest future dedup signal. Pass it verbatim." },
          occurredAtISO: { type: "string", description: "The date the movement actually happened (YYYY-MM-DD), ONLY when the evidence states it. Omit if unknown — never guess." },
          confidence: { type: "number", description: "Extraction confidence 0–1 from the evidence, when known. Omit for clearly typed/spoken input." },
          currency: { type: "string", description: "ISO 4217 code (e.g. USD, ARS, EUR) ONLY when the user explicitly states a currency or the evidence clearly shows one. OMIT for ordinary movements — the system uses the selected account/card currency, or the user's primary currency. Never guess; do not override the instrument's real currency." },
          confirmedNew: { type: "boolean", description: "Set true ONLY after you asked the user whether a very-similar recent movement is the same one or a different one, and they said it is a DIFFERENT/new movement. It skips the recent-duplicate safeguard so the legitimate repeat is recorded." },
        },
        required: ["type", "amount", "description"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_movements_batch",
      description:
        "Record SEVERAL movements in one call (multi-purchase messages, several new statement rows). Same semantics per item as log_movement; max 15. Use this instead of many separate calls.",
      parameters: {
        type: "object",
        properties: {
          movements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["expense", "income", "debt_payment", "goal_contribution"] },
                amount: { type: "number" },
                description: { type: "string" },
                category: { type: "string" },
                sourceAccountId: { type: "string" },
                debtAccountId: { type: "string" },
                destinationAccountId: { type: "string" },
                goalId: { type: "string" },
                fixedExpenseId: { type: "string" },
                externalRef: { type: "string" },
                occurredAtISO: { type: "string", description: "YYYY-MM-DD, only if the evidence states it." },
                confidence: { type: "number" },
                currency: { type: "string", description: "ISO code ONLY when explicitly stated or clearly in the evidence; omit otherwise (uses the instrument or primary currency)." },
              },
              required: ["type", "amount", "description"],
              additionalProperties: false,
            },
          },
        },
        required: ["movements"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_card_obligations",
      description:
        "Update a card/debt's REAL terms: minimum payment, TOTAL payment due this period (the key Margen input), statement balance (total owed), due day, cutoff day, and/or annual interest rate. Use it from a statement OR from chat (\"esta tarjeta cierra el 6 y vence el 21\", \"la tasa es 15.6%\"). Pass ONLY the fields the evidence/user gave. If this comes from a statement, ALWAYS pass statementDate (the statement's emission date): Kipu refuses to overwrite newer obligations with an OLDER statement, and tells the user it kept the current ones. This keeps Margen Kipu and debt protection honest.",
      parameters: {
        type: "object",
        properties: {
          debtAccountId: { type: "string" },
          minimumPayment: { type: "number" },
          totalDueThisMonth: { type: "number" },
          statementBalance: { type: "number", description: "Total accumulated balance owed on the card." },
          dueDay: { type: "number" },
          cutoffDay: { type: "number" },
          interestRate: { type: "number", description: "Annual interest rate in percent (e.g. 15.6). Never invent it; only pass it if the statement or user gave it." },
          interestRateKind: { type: "string", enum: ["annual_nominal", "annual_effective", "monthly"], description: "How to read interestRate. Default annual_nominal." },
          statementDate: { type: "string", description: "Statement emission date YYYY-MM-DD. REQUIRED when the data comes from a statement, so an older statement can't overwrite newer obligations." },
          statementPeriodEnd: { type: "string", description: "Statement period end date YYYY-MM-DD, if shown." },
        },
        required: ["debtAccountId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_debt_health",
      description:
        "Read-only. Returns the deterministic CARD/DEBT HEALTH of the user: per-card state (due soon/today, overdue, needs-payment-confirmation, high-interest, revolving, stale statement), totals, debt pressure, highest-interest card, and the single next action. Use it to answer \"¿cómo van mis tarjetas/deudas?\", \"¿qué tarjeta está en riesgo?\", or before advising on debt. Interest figures are estimates; payment-status flags are cautious (ASK, don't assert).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_debt_payoff",
      description:
        "Read-only. Builds a cashflow-aware debt PAYOFF plan (always pays minimums first, steers extra to one focus debt). Use for \"hazme un plan para salir de deuda\", \"¿qué tarjeta pago primero?\", \"¿conviene abonar 100 extra?\". All months/interest are estimates.",
      parameters: {
        type: "object",
        properties: {
          strategy: { type: "string", enum: ["avalanche", "snowball", "urgency_first", "hybrid"], description: "avalanche=tasa más alta primero; snowball=saldo más chico primero; urgency_first=vencidos/por vencer primero; hybrid=default." },
          extraMonthly: { type: "number", description: "Extra monthly amount the user can put toward debt, if they said one." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_debt_vs_investment",
      description:
        "Read-only PERSONAL-FINANCE guidance (NOT investment advice) comparing paying a debt (guaranteed saving = its rate) vs investing (uncertain return), protecting reserves. Use for \"¿pago deuda o invierto?\". Needs the debt's rate; if missing, it will say so. Never advises skipping a minimum to invest.",
      parameters: {
        type: "object",
        properties: {
          debtAccountId: { type: "string", description: "Which debt; default = highest-interest debt with balance." },
          expectedReturnPct: { type: "number", description: "Expected annual investment return %, if the user gave one." },
          cashAvailable: { type: "number", description: "Cash the user is considering using." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "estimate_card_interest",
      description:
        "Read-only. Estimates the interest cost of a card under FULL vs MINIMUM vs a PARTIAL payment, and the cost of delaying. Use for \"¿pago mínimo o total?\", \"¿cuánto interés me cuesta?\", \"¿cuánto me cuesta esperar una semana?\". Requires the card's rate; if missing, asks for it instead of inventing. All figures are estimates.",
      parameters: {
        type: "object",
        properties: {
          debtAccountId: { type: "string", description: "Which card; default = a card with balance." },
          partialAmount: { type: "number", description: "A partial payment the user is weighing, if any." },
          delayDays: { type: "number", description: "Days the user is considering waiting before paying, if any." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cashflow_outlook",
      description:
        "Read-only. The forward-looking CASHFLOW = the strengthened, timing-aware Margen Kipu: how much the user can safely spend TODAY and THIS WEEK, whether they reach their next income without running short (runway), the next risk to watch, and the confidence. Use for \"¿cuánto puedo gastar hoy/esta semana/hasta mi sueldo?\", \"¿llego a fin de mes?\", \"¿por qué bajó mi margen?\", \"¿qué cuido esta semana?\". Answer SIMPLE: today, this week, one thing to watch.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "simulate_scenario",
      description:
        "Read-only what-if on the cashflow. Use for \"¿puedo comprar esto?\", \"¿qué pasa si gasto 80 hoy?\", \"¿y si me pagan antes/después?\", \"¿y si agrego un gasto fijo?\", \"quiero proteger mi fondo de emergencia\". Returns how today's/this-week's safe spend, runway and end-of-month change, with an honest verdict (recommended / possible but tight / not recommended). All estimates.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["spend_today", "income_earlier", "income_later", "add_monthly_expense", "change_goal_contribution", "protect_reserve"], description: "spend_today=comprar/pagar algo hoy; income_earlier/later=ingreso antes/después; add_monthly_expense=nuevo gasto fijo; change_goal_contribution=cambiar aporte; protect_reserve=apartar un colchón." },
          amount: { type: "number", description: "Para spend_today: monto que gastaría hoy." },
          days: { type: "number", description: "Para income_earlier/later: cuántos días." },
          monthlyAmount: { type: "number", description: "Para add_monthly_expense: monto mensual." },
          weeklyDelta: { type: "number", description: "Para change_goal_contribution: cambio por semana (+ aporta más)." },
          reserveAmount: { type: "number", description: "Para protect_reserve: colchón a mantener." },
          label: { type: "string", description: "Nombre natural del escenario, ej. \"comprar audífonos\"." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_cashflow",
      description:
        "Read-only. Builds a SHORT practical money plan (3–5 steps) from the cashflow: what to spend, what's coming, what to watch. Use for \"organízame la semana\", \"hazme un plan hasta mi sueldo\", \"cómo salgo de la semana sin tocar mis ahorros\", \"qué hago hoy con mi plata\". Supports pessimistic/optimistic tone.",
      parameters: {
        type: "object",
        properties: {
          horizon: { type: "string", enum: ["week", "until_income"], description: "Alcance del plan." },
          tone: { type: "string", enum: ["neutral", "pessimistic", "optimistic"], description: "Tono pedido por el usuario." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "where_did_money_go",
      description:
        "Read-only. Explains WHERE the user's money goes — top spending categories by real impact (per month/week) plus detected recurring/subscription burden — from learned baselines, NOT raw transactions. Use for \"¿en qué se me va la plata?\", \"¿en qué gasto más?\", \"¿por qué se me acaba el dinero?\". Transfers, card payments, refunds and income are NOT spending. Answer simple (the 2–3 things that matter); honest about confidence with little data.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "why_margin_changed",
      description:
        "Read-only. Attributes a drop/change in the user's margin or safe-spend to the few real DRIVERS (a category over its normal, a new recurring charge, a large one-off) — compared against the user's learned normal (there's no day-by-day margin history yet; say so honestly). Use for \"¿por qué bajó mi margen?\", \"¿qué cambió esta semana?\", \"¿qué me está dejando sin plata?\". Name the driver(s), not a wall of numbers.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "spending_anomalies",
      description:
        "Read-only. Surfaces graded, non-noisy anomalies in recent spending: a possible duplicate charge, a charge well above the user's normal, a large one-off that dents the week. Use for \"¿algo raro en mis gastos?\", \"¿me cobraron de más?\", \"¿hay algún cobro extraño?\". NEVER overreact to a single normal purchase; if nothing stands out, say so calmly.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "my_subscriptions",
      description:
        "Read-only. Lists detected recurring charges / subscriptions (merchant, amount, cadence, next charge estimate) and which are NOT yet modeled as fixed expenses. Use for \"¿qué suscripciones tengo?\", \"¿en qué pagos recurrentes se me va?\", \"¿qué me cobran cada mes?\". To CONVERT one into a fixed expense, ASK the user first, then use create_fixed_expense — never auto-create from a weak pattern.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "budget_suggestion",
      description:
        "Read-only. The dynamic, non-shaming budget view: which FEW categories are above the user's learned normal THIS week and the single practical adjustment to get back on track, tied to safe spend. Use for \"¿cómo voy con mis gastos?\", \"¿me estoy pasando?\", \"¿en qué me cuido esta semana?\". Frame as control, never as failing a budget. No 30-category lecture.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_cut",
      description:
        "Read-only. Recommends the single most useful, smallest move to free up room (e.g. \"con bajar ~$18 en delivery vuelves a tu ritmo\") from the behavioral-insight synthesis. Use for \"¿dónde recorto?\", \"ayúdame a ahorrar esta semana\", \"¿qué hago para que me alcance?\". One concrete nudge, zero judgment; never suggest skipping a minimum debt/card payment.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "learn_spending_correction",
      description:
        "Persist a GENERALIZABLE spending correction so Kipu stops repeating it on FUTURE transactions — e.g. \"eso no es comida, es transporte\", \"PAYU*XYZ siempre es mi gym\", \"ese cargo es Uber\". Writes to structured merchant memory keyed by the merchant text, so every future matching charge is categorized right. Use this IN ADDITION to correct_movement when the user is teaching a rule (not just fixing one row). Don't invent a rule the user didn't state.",
      parameters: {
        type: "object",
        properties: {
          merchantText: { type: "string", description: "The merchant text/descriptor the rule is about, as it appears or as the user names it, e.g. \"PAYU*XYZ\", \"Uber\", \"ese cargo de la farmacia\"." },
          category: { type: "string", enum: ["housing", "utilities", "food", "transport", "health", "education", "subscriptions", "debt", "shopping", "entertainment", "family", "savings", "income", "travel", "other"], description: "The correct category, when the user stated/implied it." },
          merchantFamily: { type: "string", description: "Readable merchant name to show, e.g. \"Uber\", \"Mi gimnasio\". Optional." },
          isRecurring: { type: "boolean", description: "True if the user says it's a recurring/subscription charge." },
          note: { type: "string", description: "Short provenance note, e.g. \"el usuario lo aclaró el 17/06\". Optional." },
        },
        required: ["merchantText"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate_purchase_as_goal",
      description:
        "Read-only. The IMPULSE-SAFE purchase check. For \"quiero comprar X\", \"¿puedo comprarlo hoy?\", \"¿de contado o lo ahorro?\": decides if buying TODAY is safe against the TIMING-AWARE safe spend (not the bank balance), explains what it would affect, and — if buying today pressures card payments/main goal/reserve — proposes a cashflow-safe MINI-GOAL (weekly set-aside from the joy budget + realistic date) that touches nothing important. Always offer both options when safe. If the price is unknown, ask for it in one line.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Estimated price of the item. If unknown, omit and the tool will tell you to ask." },
          onCard: { type: "boolean", description: "True if the user would put it on a credit card." },
          label: { type: "string", description: "What it is, e.g. \"AirPods\", for natural phrasing." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_goal",
      description:
        "Create a goal (or wealth/emergency/investment goal). Use for \"quiero viajar a Brasil\", \"quiero ahorrar para mi mamá\", \"quiero una laptop en 3 meses\", \"quiero un fondo de emergencia\". Ask for the amount if missing; the date is optional (flexible goals are fine). Set isPrimary only if the user says it's their main goal. A committed cadence+contribution will RESERVE money in their plan — only set it when the user agrees to a contribution.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          targetAmount: { type: "number" },
          targetDate: { type: "string", description: "ISO date YYYY-MM-DD if the user gave one; omit for a flexible goal." },
          archetype: { type: "string", enum: ["savings", "travel", "purchase", "emergency", "debt_payoff", "investment", "wealth", "family", "lifestyle", "custom"] },
          isPrimary: { type: "boolean" },
          cadence: { type: "string", enum: ["weekly", "biweekly", "monthly"], description: "Only if the user commits to a recurring contribution." },
          contributionAmount: { type: "number", description: "Committed amount per cadence (reserves money). Only with an agreed contribution." },
          currency: { type: "string", description: "ISO code only if stated; omit for the user's primary currency." },
        },
        required: ["name", "targetAmount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_mini_goal",
      description:
        "Create a MINI-GOAL for an impulse-safe purchase the user accepted (after evaluate_purchase_as_goal). Reserves a small weekly amount from the joy budget so they buy it without touching card payments, the main goal or the reserve. If weeklyContribution is omitted, Kipu computes a cashflow-safe amount. Link to a parent goal only if it's a sub-target.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "What they're saving for, e.g. \"AirPods\"." },
          price: { type: "number" },
          weeklyContribution: { type: "number", description: "Weekly set-aside. Omit to let Kipu pick a safe amount." },
          parentGoalId: { type: "string" },
        },
        required: ["name", "price"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prioritize_goals",
      description:
        "Read-only. For \"ordena mis metas\", \"¿qué meta priorizo?\", \"¿cómo reparto entre deuda, metas e inversión?\", \"tengo muchas metas\". Returns the priority order, how the free surplus would be split (reserve → extra debt → goals → joy, human-realistic — never 100% to debt), conflicts (too many goals, deadline impossible, a mini-goal slowing the main one) and the practical next move. Answer simple: which 1–2 to focus, what to pause/extend.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "update_goal",
      description:
        "Update a goal: pause/resume, change target date or committed contribution, make it the primary, or mark it flexible. Use for \"pausa esta meta\", \"sube/baja mi aporte\", \"haz esta mi meta principal\", \"dale más plazo\". Use list/context to resolve which goal; if ambiguous, ask which one. Pausing a goal frees its reserved money for the rest.",
      parameters: {
        type: "object",
        properties: {
          goalId: { type: "string" },
          status: { type: "string", enum: ["active", "paused"] },
          targetDate: { type: "string", description: "New ISO date YYYY-MM-DD." },
          contributionAmount: { type: "number" },
          cadence: { type: "string", enum: ["weekly", "biweekly", "monthly"] },
          makePrimary: { type: "boolean" },
          flexibleDeadline: { type: "boolean" },
        },
        required: ["goalId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "register_investment",
      description:
        "Register an investment/asset the user already has so it counts in net worth and (with a rate) in projections. Use for \"tengo una póliza de 5000 al 5% anual\", \"tengo acciones/ETFs por X\", \"tengo un terreno/carro\", \"me deben un préstamo con interés\". NEVER invent a value, price or return — use only what the user states; if no return is given, it counts for net worth but no growth is projected. NEVER recommend a specific security.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          assetClass: { type: "string", enum: ["cash", "investment", "fixed_term", "crypto", "property", "vehicle", "business", "receivable", "other"] },
          value: { type: "number", description: "Current value the user states (base currency)." },
          expectedReturnPct: { type: "number", description: "Annual % the user states (e.g. 5). Omit if unknown — no fabricated return." },
          returnKind: { type: "string", enum: ["annual_nominal", "annual_effective", "monthly"] },
          liquid: { type: "boolean" },
          currency: { type: "string" },
        },
        required: ["name", "assetClass", "value"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "net_worth",
      description:
        "Read-only. For \"¿cuál es mi patrimonio?\", \"¿cómo voy con mi meta de 500k?\", \"¿cuánto tengo invertido?\". Returns net worth (assets − debts, liquid vs total), investment value + projection, and wealth-target progress + required monthly. Everything ESTIMATED and labeled; never claims real-time market values or a connected broker unless verified.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "set_wealth_target",
      description:
        "Set a long-term net-worth goal. Use for \"quiero llegar a 500k de patrimonio\". Returns current progress + an estimated required monthly. Projections are estimates and depend on a return the user provides.",
      parameters: {
        type: "object",
        properties: { amount: { type: "number" } },
        required: ["amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_ambition_mode",
      description:
        "Set how aggressively Kipu pushes goals vs preserving everyday joy: light_touch (mostly enjoy, gentle goals), steady (balanced, default), power_builder (push goals/debt hard, tighter joy). Use when the user says \"quiero ir paso a paso\" / \"quiero atacar fuerte mis metas\" / \"no quiero dejar de vivir\". Affects the allocation split only, never the safety guardrails.",
      parameters: {
        type: "object",
        properties: { mode: { type: "string", enum: ["light_touch", "steady", "power_builder"] } },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_financial_philosophy",
      description:
        "Set the user's LIFE PHILOSOPHY toward money (the core personalization lever). Use when they reveal it: \"prefiero disfrutar mi plata / vivir experiencias / no me obsesiona ahorrar\" → experiences; \"quiero construir patrimonio / ser disciplinado\" → wealth; \"quiero lograr metas concretas\" → builder; \"equilibrio entre disfrutar y ahorrar\" → balanced. This changes how Kipu FRAMES advice and the joy-vs-goals posture — it NEVER changes the money math, minimums or cashflow. Don't label the user; just set what they expressed.",
      parameters: {
        type: "object",
        properties: { philosophy: { type: "string", enum: ["experiences", "balanced", "builder", "wealth"] } },
        required: ["philosophy"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_personalization_profile",
      description:
        "Read-only. Returns how Kipu is currently adapting to this user (life philosophy, tone, detail level, orientation, risk posture, usage style, nudge sensitivity, confidence) and whether each trait is explicit or inferred. Use for \"¿cómo me tienes configurado?\", or before changing a preference. Speak it simply, no internal labels.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "set_communication_preference",
      description:
        "Set the user's preferred TONE and/or default DETAIL level. Use for \"háblame más directo / más suave / más motivador / más al grano\", \"respuestas cortas\" (detail short), \"explícame con más detalle\" (detail detailed). Tone/detail change how Kipu speaks and how much it expands WHEN ASKED — they never make routine confirmations long.",
      parameters: {
        type: "object",
        properties: {
          tone: { type: "string", enum: ["calm", "direct", "motivating", "analytical", "gentle", "playful", "coach"] },
          detail: { type: "string", enum: ["short", "balanced", "detailed"] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_risk_preference",
      description:
        "Set the user's risk posture: conservative (more cushion, prudent framing), moderate, or aggressive (tolerates more ambitious plans). Use for \"soy conservador / prefiero ir seguro\" or \"soy agresivo / tolero más riesgo\". Affects framing/reserve emphasis only; never changes money math or recommends specific securities.",
      parameters: {
        type: "object",
        properties: { risk: { type: "string", enum: ["conservative", "moderate", "aggressive"] } },
        required: ["risk"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_onboarding_mode",
      description:
        "Set whether the user wants a SIMPLE (minimal, fast, more automation) or POWER (detailed setup, more control, deeper surfaces) experience. Use for \"hazlo simple / no quiero complicarme\" → simple; \"quiero el control / dame todo el detalle\" → power. Even in power mode, default answers stay short.",
      parameters: {
        type: "object",
        properties: { mode: { type: "string", enum: ["simple", "power"] } },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_nudge_sensitivity",
      description:
        "Set how many proactive reminders the user wants: low (more reminders OK), normal, high (only the truly important; fewer). Use for \"mándame menos recordatorios\" → high, \"recuérdame más seguido\" → low. Always respects quiet hours and the daily cap.",
      parameters: {
        type: "object",
        properties: { sensitivity: { type: "string", enum: ["low", "normal", "high"] } },
        required: ["sensitivity"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_life_context",
      description:
        "Record a NON-SENSITIVE, user-stated life context that affects money advice — e.g. \"soy estudiante\", \"trabajo freelance / ingreso irregular\", \"mantengo a mi familia\", \"viajo mucho\", \"tengo sueldo fijo\", \"estoy emprendiendo\". Only store what the user explicitly says; NEVER infer sensitive attributes. Use it to make advice more relevant, not to label them.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", description: "short slug, e.g. student, freelancer, salaried, parent, supporting_family, traveler, entrepreneur, irregular_income" },
          label: { type: "string", description: "short human label as the user said it" },
        },
        required: ["kind", "label"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_life_context",
      description:
        "Retract a life context the user declared before and no longer wants Kipu to consider (\"ya no soy estudiante\", \"olvida que viajo\", \"ya no mantengo a nadie\"). Pass the same kind slug it was stored with. Removes only that declared item; financial data and goals are untouched.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", description: "the kind slug to forget, e.g. student, freelancer, traveler, supporting_family" },
        },
        required: ["kind"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_personalization",
      description:
        "Read-only. Explains WHY Kipu adapted — why a tone, why a dashboard surface, why a nudge was sent or skipped, why an answer was short. Use for \"¿por qué me hablas así?\", \"¿por qué cambió mi dashboard?\", \"¿por qué me preguntas esto?\". Answer honestly from the user's own preferences/usage, simply, never creepy, and remind them they can change it.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "personalization_feedback",
      description:
        "Record explicit feedback about Kipu's behavior so it learns: a nudge was annoying/useful, a recommendation too strict/too soft, the dashboard too busy/too sparse. Use for \"ese recordatorio fue molesto\", \"me gustó ese aviso\", \"me estás restringiendo mucho\", \"quiero que me exijas más\". Explicit feedback overrides inferred behavior; apply the obvious preference change too when clear.",
      parameters: {
        type: "object",
        properties: {
          aspect: { type: "string", enum: ["nudge", "strictness", "detail", "dashboard", "tone"] },
          sentiment: { type: "string", enum: ["too_much", "too_little", "good", "annoying", "useful"] },
          note: { type: "string", description: "short non-sensitive note in the user's words" },
        },
        required: ["aspect", "sentiment"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reset_personalization_preference",
      description:
        "Reset Kipu's personalization back to neutral defaults (clears philosophy/UX preferences; keeps financial facts). Use for \"olvida cómo me tienes configurado\", \"vuelve a lo normal\", \"resetea mis preferencias\". Confirm briefly; financial data and goals are untouched.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "create_card",
      description:
        "Register a NEW card/debt that isn't in the context yet — e.g. the user uploads a statement for a card they never added. Use ONLY after the user confirms they want to add it (never auto-create, never apply a statement to a different existing card). Returns the new card's id so you can immediately update its obligations and import its movements in the same turn.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Card/debt name as the user calls it, e.g. \"Mastercard Pichincha\"." },
          kind: { type: "string", enum: ["credit_card", "loan", "family_debt", "other_debt"], description: "Default credit_card for a card." },
          currency: { type: "string", description: "ISO code ONLY if the user states it or the statement shows it; omit to use the user's primary currency. Never guess." },
          currentBalance: { type: "number", description: "Current debt owed if known (e.g. statement balance). Omit if unknown." },
          minimumPayment: { type: "number" },
          totalDueThisMonth: { type: "number" },
          dueDay: { type: "number" },
          cutoffDay: { type: "number" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_account",
      description:
        "Register a NEW account/payment method the user names but isn't in the context yet — e.g. the source account of a statement payment they want to add from chat. Use ONLY after the user confirms. Returns the new account id so you can use it as a source in the same turn. Not for cards/debts (use create_card).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Account name as the user calls it, e.g. \"Cuenta Pichincha\"." },
          kind: { type: "string", enum: ["bank", "cash", "wallet"], description: "Default bank." },
          currency: { type: "string", description: "ISO code ONLY if stated; omit to use the user's primary currency." },
          currentBalance: { type: "number", description: "Current balance if known; omit if unknown (starts at 0)." },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transfer_between_accounts",
      description:
        "Move money between the user's OWN accounts. Not spending, not income. Requires distinct source and destination accounts and an amount.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number" },
          sourceAccountId: { type: "string" },
          destinationAccountId: { type: "string" },
          description: { type: "string" },
        },
        required: ["amount", "sourceAccountId", "destinationAccountId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_movements",
      description:
        "List the user's recent movements with their id, description, amount, the account/card name they came from, type, and whether they're already reversed. ALWAYS call this to resolve ambiguity before undoing/correcting a specific movement — it gives you the ids and the source names so you can present concrete options and then act by id. Never re-ask the same vague question; list and pick.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undo_movement",
      description:
        "Reverse ONE movement (append-only, idempotent, balance restored). Prefer passing the exact transactionId from list_recent_movements. A free-text hint is allowed but may be ambiguous; if it is, call list_recent_movements and undo by id instead. With neither, the single most recent eligible movement is undone.",
      parameters: {
        type: "object",
        properties: {
          transactionId: { type: "string" },
          hint: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undo_recent_movements",
      description:
        "Reverse the last N eligible movements in one safe batch (for 'borra los últimos dos', 'deshaz los 3 últimos'). Idempotent; skips already-reversed. Use this for count-based multi-undo instead of undoing one by one.",
      parameters: {
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "correct_movement",
      description:
        "Correct one recent movement by id. Amount/source changes reverse the old effect and apply the corrected one safely; category/description changes only update metadata (no balance change). Get the id from list_recent_movements.",
      parameters: {
        type: "object",
        properties: {
          transactionId: { type: "string" },
          newAmount: { type: "number" },
          newSourceAccountId: { type: "string" },
          newDebtAccountId: { type: "string" },
          newCategory: { type: "string" },
          newDescription: { type: "string" },
        },
        required: ["transactionId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_duplicate",
      description:
        "Remove a duplicate movement (something logged twice — sent twice, Telegram delay). Reverses only the MORE RECENT copy and keeps one; never both. Pass transactionId for the exact copy to remove, or leave empty to let Kipu find the obvious duplicate pair. If several possible pairs exist, this returns them so you can confirm which.",
      parameters: {
        type: "object",
        properties: { transactionId: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_person_payment",
      description:
        "Money to/from ANOTHER person (not an internal transfer). direction 'out': the user sent money to someone — records an expense from the chosen account/card (or a loan if isLoan, which also opens a receivable). direction 'in': the user received money — 'income' (salary/gift), 'refund' (reimbursement for something they paid), or 'loan_repayment' (settles a receivable). Requires amount and the user's account; ask if missing.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["out", "in"] },
          amount: { type: "number" },
          person: { type: "string" },
          reason: { type: "string" },
          category: { type: "string" },
          accountId: { type: "string", description: "The user's OWN account the money left from (out) or arrived to (in)." },
          debtAccountId: { type: "string", description: "Card used for an outgoing person payment, if any." },
          isLoan: { type: "boolean" },
          inflowKind: { type: "string", enum: ["income", "refund", "loan_repayment"] },
        },
        required: ["direction", "amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_fixed_expense",
      description:
        "Create a new recurring/fixed expense (gym, rent, subscription). Does NOT log a payment today unless payNow=true. startDate (YYYY-MM-DD) makes it start in the future. If a similar one exists, this returns it so you can ask the user whether to update instead.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number" },
          frequency: { type: "string", enum: ["weekly", "biweekly", "monthly", "yearly"] },
          category: { type: "string" },
          startDate: { type: "string" },
          sourceAccountId: { type: "string" },
          payNow: { type: "boolean" },
        },
        required: ["name", "amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_proactive_briefing",
      description:
        "Read the user's full proactive state: weekly margin, what to watch (cards due, upcoming payments, money owed to them, goal risk), how long since they last logged anything, a single next-best-action, and Whoop-style wellness metrics (0-100). Use it for '¿cómo voy?', '¿qué debo cuidar?', 'ayúdame a cuadrar la semana', when the user comes back after a gap, or to lead proactively. READ-ONLY.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate_purchase",
      description:
        "READ-ONLY 'can I afford / should I buy X?' check for a HYPOTHETICAL purchase the user has NOT made. Returns the weekly margin BEFORE and AFTER that spend plus a recommendation. Use this for any affordability/should-I question; answer from the AFTER state, never by repeating the current margin. Does NOT record anything.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number" },
          onCard: { type: "boolean", description: "true if it would go on a credit card." },
          itemDescription: { type: "string" },
        },
        required: ["amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_fixed_expense",
      description:
        "Permanently change an existing fixed expense going forward (find the id via list/context). Pass newAmount and/or startDate (YYYY-MM-DD) when it begins later. Set payNow=true to also log today's payment at the new amount. Confirm the future start date to the user when one is set.",
      parameters: {
        type: "object",
        properties: {
          fixedExpenseId: { type: "string" },
          newAmount: { type: "number" },
          startDate: { type: "string", description: "YYYY-MM-DD if the change/expense starts in the future." },
          payNow: { type: "boolean" },
          sourceAccountId: { type: "string" },
        },
        required: ["fixedExpenseId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_payment",
      description:
        "Remember a FUTURE payment the user has NOT made yet (a reminder / future cost). No money moves today. dueDate is YYYY-MM-DD; set recurring=true if it repeats monthly. Ask for date/amount if missing.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number" },
          dueDate: { type: "string" },
          recurring: { type: "boolean" },
          category: { type: "string" },
        },
        required: ["name", "dueDate"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_account_liquidity",
      description:
        "Mark one of the user's accounts as 'liquid' (spendable now — bank/cash/wallet) or 'non_liquid' (investments, long-term/protected savings that should NOT count as available-this-week money). Use when the user says an account is for saving/investing or not for daily spending. Non-liquid money is excluded from spendable margin and mentioned separately.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          liquidity: { type: "string", enum: ["liquid", "non_liquid"] },
        },
        required: ["accountId", "liquidity"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reconcile_account_balance",
      description:
        "Set ONE account to the real balance the user reports when it differs from Kipu's and they don't recall the exact missing movement. Records the difference as a balance ADJUSTMENT (never as income/expense, so it doesn't inflate income analysis). Use for 'en el banco tengo X' / cuadrar saldo. Pass the account id and the real balance. Prefer fixing the actual missing movement (log_movement / undo) when the user DOES remember what it was.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          realBalance: { type: "number", description: "The real balance the user reports for that account." },
        },
        required: ["accountId", "realBalance"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_savings_plan",
      description:
        "Save the user's monthly saving / investing commitments and/or their essential-spending estimate (food, transport, basics). These are RESERVED before Kipu computes Margen Kipu, so the user can spend freely knowing savings/investments are protected. Use when the user says how much they save/invest monthly or estimates their essentials. Amounts are monthly, in base currency.",
      parameters: {
        type: "object",
        properties: {
          monthlySavings: { type: "number", description: "Monthly amount the user commits to saving." },
          monthlyInvestment: { type: "number", description: "Monthly amount the user commits to investing." },
          essentialMonthlyEstimate: { type: "number", description: "Estimated monthly essential variable spending (food/transport/basics). A learnable hypothesis." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_engagement_mode",
      description:
        "Set the user's coaching mode: 'paused' (stop proactive reminders/nudges for a while), 'light' (minimal, gentle), or 'normal'. Use when the user asks to pause, go light, or come back. Optionally pauseDays for a temporary pause.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["normal", "light", "paused"] },
          pauseDays: { type: "number" },
        },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_ambient_preferences",
      description:
        "Update how/when Kipu proactively reaches out on Telegram (the ambient check-in loop) when the user expresses it naturally: turn it on/off, snooze for a while or until a date, set quiet hours, set frequency (daily / weekly on specific days / off), max messages per day, or timezone. Interpret the user's intent and pass ONLY the fields they meant. Examples: \"no me escribas por ahora\" → enabled:false; \"recuérdame mañana\" / \"escríbeme el lunes\" → pauseUntilISO; \"solo los viernes\" → frequency:weekly, weekdays:[5]; \"una vez al día\" → maxPerDay:1; \"no me molestes en la noche\" → quietHoursStart/End; \"activa otra vez los recordatorios\" → resume:true.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "Master on/off for proactive ambient messages." },
          resume: { type: "boolean", description: "Clear any pause/snooze and turn ambient back on." },
          pauseDays: { type: "number", description: "Snooze proactive messages for N days." },
          pauseUntilISO: { type: "string", description: "Snooze until this date (YYYY-MM-DD), e.g. mañana / el lunes." },
          quietHoursStart: { type: "number", description: "Local hour 0-23 when quiet hours begin (no messages)." },
          quietHoursEnd: { type: "number", description: "Local hour 0-23 when quiet hours end." },
          frequency: { type: "string", enum: ["auto", "daily", "weekly", "off"], description: "How often: auto (Kipu decides), daily, weekly (use weekdays), or off." },
          weekdays: { type: "array", items: { type: "number" }, description: "For weekly: days 0=Sun..6=Sat (e.g. only Fridays → [5])." },
          maxPerDay: { type: "number", description: "Max proactive messages per day (default 1)." },
          timezone: { type: "string", description: "IANA timezone (e.g. America/Guayaquil) ONLY if the user states their location/timezone." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_week_reconciled",
      description:
        "Record that the user just confirmed their week is reconciled (balances look right). Use after a weekly reconciliation the user agreed with.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description:
        "Persist something you learned about the user so Kipu improves over time: an alias ('Pichincha = the bank account'), a preference, a behavioral pattern, a person, or a correction. Use whenever the user teaches or corrects you.",
      parameters: {
        type: "object",
        properties: {
          noteType: {
            type: "string",
            enum: ["preference", "behavior_pattern", "goal_context", "risk_context", "constraint", "general"],
          },
          content: { type: "string" },
        },
        required: ["noteType", "content"],
        additionalProperties: false,
      },
    },
  },
];

// The currency of a KNOWN owned account — never a USD fallback. Callers must
// have validated the account's presence before calling. Exported for the gate.
export function accountCurrency(account: Account): CurrencyCode {
  return account.currency as CurrencyCode;
}

// The currency a movement is actually denominated in: the source account's, or
// (for a card purchase with no cash account) the CARD's currency — never a
// blind USD fallback that would mis-state a non-USD card. Returns undefined when
// no trusted currency can be derived; the caller must then ask, not invent USD.
// Exported for the gate.
export function movementCurrency(
  source?: Account,
  debt?: DebtAccount,
  dest?: Account,
): CurrencyCode | undefined {
  const c = source?.currency ?? debt?.currency ?? dest?.currency;
  return c ? (c as CurrencyCode) : undefined;
}

// Round to cents to avoid float dust reaching the numeric(14,2) ledger.
function toCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

// Strictly validate a calendar date (rejects 2026-02-31 etc.) and return the
// movement's occurrence timestamp (noon UTC of that day, so timezone shifts
// can't move it across a day boundary). Returns undefined for missing/invalid.
export function validOccurredAtISO(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  // Round-trip check: JS normalizes overflow (Feb 31 → Mar 3), so a valid date
  // must reproduce its own components.
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return undefined;
  }
  // Never accept a future occurrence date from evidence.
  if (dt.getTime() > Date.now() + 86_400_000) return undefined;
  return dt.toISOString();
}

// Real extraction confidence, clamped; falls back to a neutral typed-text value
// when the caller has no model-reported score. Never used as auto-write
// AUTHORITY (that gate is deterministic) — only stored for audit.
function resolveConfidence(value: unknown): number {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return 0.9;
}

function category(value: unknown, fallback: FinancialCategory): FinancialCategory {
  return typeof value === "string" && VALID_CATEGORIES.has(value as FinancialCategory)
    ? (value as FinancialCategory)
    : fallback;
}

function money(value: number, currency: string): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

// Human name of where a movement's money came from / went to, so the agent can
// present concrete options ("el de Pichincha" vs "el de efectivo") and the user
// can disambiguate naturally.
function sourceLabel(
  tx: StoredTransaction,
  accounts: Account[],
  debts: DebtAccount[],
): string {
  if (tx.sourceAccountId) {
    return accounts.find((a) => a.id === tx.sourceAccountId)?.name ?? "una cuenta";
  }
  if (tx.debtAccountId) {
    return debts.find((d) => d.id === tx.debtAccountId)?.name ?? "una tarjeta";
  }
  if (tx.destinationAccountId) {
    return accounts.find((a) => a.id === tx.destinationAccountId)?.name ?? "una cuenta";
  }
  return "efectivo/otro";
}

// Rebuild a same-type intent for a correction, applying amount / source /
// category / description patches. Returns null when the shape is not safely
// supported (the caller asks instead of guessing).
function buildAgentCorrectedIntent(
  original: StoredTransaction,
  patch: {
    newAmount?: number;
    account?: Account;
    debt?: DebtAccount;
    newCategory?: FinancialCategory;
    newDescription?: string;
  },
  accounts: Account[],
): ExpenseIntent | IncomeIntent | DebtPaymentIntent | TransferIntent | GoalContributionIntent | null {
  const amount = patch.newAmount ?? original.originalAmount;
  const currency = original.originalCurrency as CurrencyCode;
  const baseFields = {
    originalAmount: amount,
    originalCurrency: currency,
    exchangeRateToBase: original.exchangeRateToBase,
    baseCurrency: original.baseCurrency as CurrencyCode,
    confidenceScore: 1,
    status: "ready" as const,
    description: patch.newDescription ?? original.description,
  };
  const cat = patch.newCategory ?? (original.category as FinancialCategory);
  switch (original.type) {
    case "expense": {
      let sourceAccountId = original.sourceAccountId ?? undefined;
      let debtAccountId = original.debtAccountId ?? undefined;
      if (patch.account) {
        sourceAccountId = patch.account.id;
        debtAccountId = undefined;
      } else if (patch.debt) {
        debtAccountId = patch.debt.id;
        sourceAccountId = undefined;
      }
      return { ...baseFields, type: "expense", category: cat, sourceAccountId, debtAccountId };
    }
    case "income": {
      const destinationAccountId = patch.account?.id ?? original.destinationAccountId;
      if (!destinationAccountId) return null;
      return { ...baseFields, type: "income", destinationAccountId, category: cat };
    }
    case "debt_payment": {
      const sourceAccountId = patch.account?.id ?? original.sourceAccountId;
      if (!sourceAccountId || !original.debtAccountId) return null;
      return { ...baseFields, type: "debt_payment", sourceAccountId, debtAccountId: original.debtAccountId, category: cat };
    }
    case "transfer": {
      const sourceAccountId = patch.account?.id ?? original.sourceAccountId;
      if (!sourceAccountId || !original.destinationAccountId) return null;
      return { ...baseFields, type: "transfer", sourceAccountId, destinationAccountId: original.destinationAccountId, category: cat };
    }
    case "goal_contribution": {
      const sourceAccountId = patch.account?.id ?? original.sourceAccountId;
      if (!sourceAccountId || !original.goalId) return null;
      const goalAccount = original.destinationAccountId ?? accounts.find((a) => a.isGoalAccount)?.id ?? "";
      return { ...baseFields, type: "goal_contribution", sourceAccountId, destinationAccountId: goalAccount, goalId: original.goalId, category: "savings" };
    }
    default:
      return null;
  }
}

// Build the validated provenance an evidence-derived movement carries into the
// canonical writer: trusted evidence id (from context), bank reference
// (stored for the matcher — cross-channel dedup is application-level, not a
// DB unique constraint), and strictly validated occurrence date.
export function movementProvenance(args: Record<string, unknown>, ctx: AgentContext) {
  const externalRef =
    typeof args.externalRef === "string" && args.externalRef.trim()
      ? args.externalRef.trim().slice(0, 120)
      : null;
  return {
    evidenceId: ctx.evidenceId ?? null,
    externalRef,
    occurredAtISO: validOccurredAtISO(args.occurredAtISO) ?? null,
    parserConfidenceScore: resolveConfidence(args.confidence),
  };
}

// Build the canonical ledger entry for one movement-tool row: validate against
// the user's real accounts/cards/goals (ownership comes from ctx, which is the
// user's own state) and attach deterministic provenance. Returns either a ready
// entry + a short factual summary, or a reason the row can't be written. Shared
// by the single and batch paths so they validate identically.
type BuiltMovement =
  | { ok: true; entry: LedgerEntryInput; summary: string }
  | { ok: false; reason: string; fatal?: boolean };

// Compute the next deterministic dedupe key for a movement in this turn, from
// the operation namespace + the movement's normalized financial content + a
// per-turn occurrence index, so a redelivered turn is idempotent while
// legitimate identical movements still get distinct keys.
function dedupeKeyFor(
  ctx: AgentContext,
  f: {
    type: string;
    amount: number;
    currency: string;
    sourceAccountId?: string | null;
    debtAccountId?: string | null;
    destinationAccountId?: string | null;
    goalId?: string | null;
    occurredDate?: string | null;
  },
): string | null {
  if (!ctx.operationId) return null;
  const occ = (ctx.dedupeOcc ??= new Map<string, number>());
  const fp = movementFingerprint({
    type: f.type,
    cents: Math.round(f.amount * 100),
    currency: f.currency,
    sourceAccountId: f.sourceAccountId,
    debtAccountId: f.debtAccountId,
    destinationAccountId: f.destinationAccountId,
    goalId: f.goalId,
    occurredDate: f.occurredDate,
  });
  return nextDedupeKey(ctx.operationId, fp, occ);
}

function attachDedupeKey(entry: LedgerEntryInput, ctx: AgentContext): void {
  const key = dedupeKeyFor(ctx, {
    type: entry.type,
    amount: entry.originalAmount,
    currency: entry.originalCurrency,
    sourceAccountId: entry.sourceAccountId,
    debtAccountId: entry.debtAccountId,
    destinationAccountId: entry.destinationAccountId,
    goalId: entry.goalId,
    occurredDate: entry.occurredAtISO ? entry.occurredAtISO.slice(0, 10) : null,
  });
  if (key) entry.dedupeKey = key;
}

function buildMovementEntry(
  args: Record<string, unknown>,
  ctx: AgentContext,
): BuiltMovement {
  const type = String(args.type ?? "");
  const amount = toCents(Number(args.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "monto inválido" };
  }
  // Reject a provided-but-impossible date instead of silently dropping it.
  if (
    args.occurredAtISO !== undefined &&
    args.occurredAtISO !== null &&
    validOccurredAtISO(args.occurredAtISO) === undefined
  ) {
    return { ok: false, reason: "fecha inválida" };
  }
  const description = String(args.description ?? "").trim() || "Movimiento";
  const source = ctx.accounts.find((a) => a.id === args.sourceAccountId);
  const debt = ctx.debtAccounts.find((d) => d.id === args.debtAccountId);
  const dest = ctx.accounts.find((a) => a.id === args.destinationAccountId);
  const goal = ctx.goals.find((g) => g.id === args.goalId);
  const prov = movementProvenance(args, ctx);
  const base = {
    userId: ctx.userId,
    description,
    confidenceScore: prov.parserConfidenceScore,
    rawInput: ctx.rawMessage,
    inputChannel: channelToInputChannel(ctx.channel),
    evidenceId: prov.evidenceId,
    externalRef: prov.externalRef,
    occurredAtISO: prov.occurredAtISO,
  };
  // Canonical currency resolution: explicit (user/evidence) → instrument →
  // primary → ask. Base/FX derived only with a trusted rate (no invented USD,
  // no fabricated rate).
  const explicitCurrency = typeof args.currency === "string" ? args.currency : null;
  const resolveCur = (instruments: (string | null | undefined)[]) =>
    resolveMovementCurrency({ explicit: explicitCurrency, instruments, primary: ctx.baseCurrency });
  const currencyError = (cr: { ok: false; reason: "unresolved" } | { ok: false; reason: "fx_unavailable"; original: CurrencyCode; base: CurrencyCode }): BuiltMovement =>
    cr.reason === "fx_unavailable"
      ? { ok: false, reason: `ese movimiento está en ${cr.original}, distinta a tu moneda base ${cr.base}; todavía no puedo convertirlo sin un tipo de cambio confiable — dime el equivalente en ${cr.base} o lo vemos aparte` }
      : { ok: false, reason: "no pude determinar la moneda; ¿en qué moneda fue?" };
  const currencyFields = (r: CurrencyResolution) => ({
    originalCurrency: r.original,
    baseCurrency: r.base,
    exchangeRateToBase: r.exchangeRateToBase,
  });

  if (type === "expense") {
    if (!source && !debt) return { ok: false, reason: "falta cuenta o tarjeta" };
    // Card expense uses the CARD currency; cash expense the account currency.
    const cr = resolveCur([source?.currency, debt?.currency]);
    if (!cr.ok) return currencyError(cr);
    const fixedExpenseId =
      typeof args.fixedExpenseId === "string" && args.fixedExpenseId ? args.fixedExpenseId : null;
    return {
      ok: true,
      summary: `Expense ${amount} recorded${debt ? ` on card ${debt.name} (debt up, no cash out today)` : source ? ` from ${source.name}` : ""}${fixedExpenseId ? " (linked to its recurring/fixed expense, not extra spending)" : ""}.`,
      entry: {
        ...base,
        type: "expense",
        effectType: "expense",
        category: category(args.category, "other"),
        originalAmount: amount,
        ...currencyFields(cr.resolution),
        sourceAccountId: source?.id ?? null,
        debtAccountId: debt?.id ?? null,
        recurringExpenseId: fixedExpenseId,
      },
    };
  }
  if (type === "income") {
    if (!dest) return { ok: false, reason: "falta cuenta destino" };
    const cr = resolveCur([dest.currency]);
    if (!cr.ok) return currencyError(cr);
    return {
      ok: true,
      summary: `Income ${amount} recorded to ${dest.name}.`,
      entry: {
        ...base,
        type: "income",
        effectType: "income",
        category: "income",
        originalAmount: amount,
        ...currencyFields(cr.resolution),
        destinationAccountId: dest.id,
      },
    };
  }
  if (type === "debt_payment") {
    if (!source || !debt) return { ok: false, reason: "falta cuenta de origen o tarjeta" };
    // A cross-currency card payment needs a trusted rate; don't pretend the
    // account and card currencies are equal when they differ.
    if (source.currency !== debt.currency) {
      return { ok: false, reason: `el pago sale de ${source.name} (${source.currency}) hacia ${debt.name} (${debt.currency}) — son monedas distintas y necesito un tipo de cambio confiable; dímelo o lo vemos aparte` };
    }
    const cr = resolveCur([source.currency]);
    if (!cr.ok) return currencyError(cr);
    return {
      ok: true,
      summary: `Debt payment ${amount} from ${source.name} to ${debt.name} (account down, debt down, not a new expense).`,
      entry: {
        ...base,
        type: "debt_payment",
        effectType: "debt_payment",
        category: "debt",
        originalAmount: amount,
        ...currencyFields(cr.resolution),
        sourceAccountId: source.id,
        debtAccountId: debt.id,
      },
    };
  }
  if (type === "goal_contribution") {
    if (!source || !goal) return { ok: false, reason: "falta cuenta de origen o meta" };
    const goalAccountId = goal.goalAccountId ?? ctx.accounts.find((a) => a.isGoalAccount)?.id ?? null;
    const cr = resolveCur([source.currency]);
    if (!cr.ok) return currencyError(cr);
    return {
      ok: true,
      summary: `Goal contribution ${amount} from ${source.name} to ${goal.name}.`,
      entry: {
        ...base,
        type: "goal_contribution",
        effectType: "goal_contribution",
        category: "savings",
        originalAmount: amount,
        ...currencyFields(cr.resolution),
        sourceAccountId: source.id,
        destinationAccountId: goalAccountId,
        goalId: goal.id,
      },
    };
  }
  return { ok: false, reason: `tipo inválido (${type || "vacío"})`, fatal: true };
}

// Record ONE movement through the atomic canonical writer (insert + balance
// delta in a single transaction, against fresh DB state). Provenance (evidence
// id + bank reference) is set AT INSERT TIME. Duplicate detection is handled by
// the application-level matcher before the agent is invoked.
// Conservative SEMANTIC duplicate safeguard for a TYPED/SPOKEN movement (not
// evidence). If a very recent EXACT match exists (same type/amount/currency/
// source AND date proximity), ask one short question instead of silently writing
// a possible re-entry of an already-recorded event. Fail-OPEN on a read error
// (the write is the user's explicit intent; never block it on a DB blip).
async function recentDuplicateQuestion(
  ctx: AgentContext,
  entry: LedgerEntryInput,
): Promise<string | null> {
  let recent;
  try {
    recent = await loadRecentTransactions(ctx.userId, { limit: 40 });
  } catch {
    return null;
  }
  const candidate = {
    type: entry.type,
    cents: Math.round(entry.originalAmount * 100),
    currency: entry.originalCurrency,
    sourceId: entry.sourceAccountId ?? entry.debtAccountId ?? null,
    occurredAtMs: entry.occurredAtISO ? Date.parse(entry.occurredAtISO) : Date.now(),
  };
  const recentKeys = recent.transactions
    .filter((t) => t.type !== "reversal" && t.type !== "adjustment" && !recent.reversedOriginalIds.has(t.id))
    .map((t) => ({
      type: t.type,
      cents: Math.round(t.originalAmount * 100),
      currency: t.originalCurrency,
      sourceId: t.sourceAccountId ?? t.debtAccountId ?? null,
      occurredAtMs: Date.parse(t.occurredAt),
    }));
  if (recentExactDuplicate(candidate, recentKeys, { windowMs: 36 * 60 * 60_000 })) {
    const where = entry.debtAccountId ? "esa tarjeta" : "esa cuenta";
    return `Ya tengo un movimiento igual hace poco (${money(entry.originalAmount, entry.originalCurrency)} en ${where}). ¿Es el mismo que ya registré o fue otro igual? Si fue otro, lo registro.`;
  }
  return null;
}

async function executeLogMovement(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  // Build WITHOUT assigning the dedupe occurrence yet, so the safeguard's
  // needs_info path doesn't consume an occurrence index (which would offset the
  // key if the user then confirms and we re-call).
  const built = buildMovementEntry(args, ctx);
  if (!built.ok) {
    return { status: built.fatal ? "refused" : "needs_info", summary: built.reason };
  }
  // Semantic safeguard: typed/spoken only, and only until the user confirms it is
  // a separate movement (confirmedNew).
  if (!ctx.evidenceId && args.confirmedNew !== true) {
    const question = await recentDuplicateQuestion(ctx, built.entry);
    if (question) return { status: "needs_info", summary: question };
  }
  attachDedupeKey(built.entry, ctx);
  try {
    const supabase = createSupabaseAdminClient();
    await applyLedgerEntry(supabase, built.entry);
    return { status: "done", summary: built.summary };
  } catch (error) {
    if (isOwnershipViolation(error)) {
      return { status: "error", summary: "No pude validar que esa cuenta/tarjeta sea tuya; no registré nada." };
    }
    return { status: "error", summary: error instanceof Error ? error.message : "log_movement failed" };
  }
}

const MAX_BATCH_MOVEMENTS = 15;

function batchRowLabel(r: Record<string, unknown>): string {
  return `${String(r.description ?? r.type ?? "movimiento")} ${toCents(Number(r.amount))}`;
}

// Several movements in one pass. Safety contract: reject >15 explicitly (never
// truncate), validate EVERY row before writing anything, then write the whole
// batch as ONE atomic transaction — either every row commits (balances to the
// same account accumulate correctly) or none does. A partly-failed batch can
// never read as full success, and an interrupted batch leaves nothing to
// duplicate on retry.
export async function executeLogMovementsBatch(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const raw = Array.isArray(args.movements) ? args.movements : [];
  if (raw.length === 0) {
    return { status: "needs_info", summary: "No llegaron movimientos en el lote." };
  }
  if (raw.length > MAX_BATCH_MOVEMENTS) {
    return {
      status: "refused",
      summary: `Llegaron ${raw.length} movimientos; el máximo seguro por lote es ${MAX_BATCH_MOVEMENTS}. No registré nada — pídeme registrarlos en grupos de ${MAX_BATCH_MOVEMENTS} o menos.`,
    };
  }
  const rows = raw.map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : null));

  // 1. Validate + build ALL rows first. If any is malformed, write NOTHING.
  //    Build WITHOUT attaching dedupe keys here: attaching consumes per-turn
  //    occurrence indices, and a REJECTED batch must not advance them (else a
  //    later retry/replay of the same rows gets offset keys → double-import).
  const entries: LedgerEntryInput[] = [];
  const invalid: string[] = [];
  rows.forEach((r, i) => {
    if (!r) {
      invalid.push(`#${i + 1}: fila vacía`);
      return;
    }
    const built = buildMovementEntry(r, ctx);
    if (!built.ok) invalid.push(`#${i + 1} (${batchRowLabel(r)}): ${built.reason}`);
    else entries.push(built.entry);
  });
  if (invalid.length > 0) {
    return {
      status: "needs_info",
      summary: `No registré NADA del lote (${invalid.length}/${rows.length} filas necesitan corrección): ${invalid.join("; ")}. Corrígelas o complétalas y reintenta el lote.`,
    };
  }

  // 2. All valid → assign dedupe keys NOW (only for rows that WILL be written),
  //    then ONE atomic transaction (all-or-nothing).
  for (const entry of entries) attachDedupeKey(entry, ctx);
  try {
    const ids = await applyLedgerEntriesAtomic(entries);
    return {
      status: "done",
      summary: `Lote de ${entries.length}: ${ids.length} registrados (en una sola operación, todo o nada, sin duplicar).`,
      data: { written: ids.length, total: entries.length, partial: false },
    };
  } catch (error) {
    if (isOwnershipViolation(error)) {
      return {
        status: "error",
        summary: "No registré NADA del lote: una de las cuentas/tarjetas no se pudo validar como tuya.",
      };
    }
    return {
      status: "error",
      summary: `No registré NADA del lote por un error al guardar (${error instanceof Error ? error.message : "desconocido"}). No quedó nada a medias; es seguro reintentar.`,
    };
  }
}

// Card obligations from statements/alerts: minimum, TOTAL due this period
// (full_payment_due — the field Margen actually uses), statement balance,
// due/cutoff days. Distinct fields, never conflated. Provided-but-invalid
// values are rejected and reported (never silently dropped behind a success).
// Omitted fields are preserved. Base balance is only set when a trusted 1:1
// conversion exists (card currency === base); otherwise the original is updated
// and the base is left untouched with an explicit note.
export async function executeUpdateCardObligations(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const debt = ctx.debtAccounts.find((d) => d.id === args.debtAccountId);
  if (!debt) {
    return { status: "needs_info", summary: "No reconozco esa tarjeta/deuda; mira sus ids en el contexto." };
  }
  const patch: Record<string, number | string> = {};
  const applied: string[] = [];
  const invalid: string[] = [];
  const provided = (v: unknown) => v !== undefined && v !== null;
  const money = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? toCents(n) : undefined;
  };
  const day = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : undefined;
  };
  const isoDate = (v: unknown): string | undefined =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) ? v : undefined;

  // Stage 14 — DATE-AWARE obligation guard. When this update comes from a
  // statement, only let it overwrite the live obligations (minimum / full / due
  // / cutoff / balance) if the statement is at least as NEW as the one that set
  // them. An older or undated statement keeps current obligations untouched.
  const statementDate = isoDate(args.statementDate);
  const fromStatement = provided(args.statementDate);
  const decision = fromStatement
    ? decideApplyObligations(statementDate ?? null, debt.statementDate ?? null)
    : { apply: true as const, reason: "chat" as const };
  const applyObligations = decision.apply;
  const withheld: string[] = [];

  const setObligation = (
    label: string,
    value: number | undefined,
    invalidLabel: string,
    assign: (v: number) => void,
  ) => {
    if (value === undefined) {
      invalid.push(invalidLabel);
      return;
    }
    if (!applyObligations) {
      withheld.push(label);
      return;
    }
    assign(value);
    applied.push(`${label} ${value}`);
  };

  let baseUntouched = false;
  if (provided(args.minimumPayment)) setObligation("mínimo", money(args.minimumPayment), "pago mínimo", (v) => (patch.minimum_payment = v));
  if (provided(args.totalDueThisMonth)) setObligation("pago del mes", money(args.totalDueThisMonth), "pago del mes", (v) => (patch.full_payment_due = v));
  if (provided(args.statementBalance)) {
    const v = money(args.statementBalance);
    if (v === undefined) invalid.push("saldo");
    else if (!applyObligations) withheld.push("saldo");
    else {
      patch.current_balance_original = v;
      if ((debt.currency as string) === ctx.baseCurrency) patch.current_balance_base = v;
      else baseUntouched = true; // no trusted FX here → don't fabricate a base value
      applied.push(`saldo ${v} ${debt.currency}`);
    }
  }
  if (provided(args.dueDay)) setObligation("paga el", day(args.dueDay), "día de pago (entero 1–31)", (v) => (patch.due_day = v));
  if (provided(args.cutoffDay)) setObligation("corte el", day(args.cutoffDay), "día de corte (entero 1–31)", (v) => (patch.cutoff_day = v));

  // Interest rate is a card TERM (not cycle-specific); accept it from chat or a
  // current statement, but not from an older statement we're declining.
  // A rate is a PERCENT, not money: keep 4 decimals (column is numeric(8,4)),
  // not 2 — toCents would silently truncate 15.456% to 15.46%.
  const rate4 = (n: number) => Math.round(n * 10000) / 10000;
  if (provided(args.interestRate)) {
    const r = Number(args.interestRate);
    if (!Number.isFinite(r) || r < 0 || r > 400) invalid.push("tasa de interés");
    else if (fromStatement && !applyObligations) withheld.push("tasa");
    else {
      patch.interest_rate = rate4(r);
      const kind = args.interestRateKind;
      if (kind === "annual_effective" || kind === "monthly" || kind === "annual_nominal") patch.interest_rate_kind = kind;
      applied.push(`tasa ${rate4(r)}%`);
    }
  }

  // When we DO apply a statement's obligations, stamp its emission date so the
  // next statement can be compared against it.
  if (fromStatement && applyObligations && statementDate) {
    patch.statement_date = statementDate;
    const periodEnd = isoDate(args.statementPeriodEnd);
    if (periodEnd) patch.statement_period_end = periodEnd;
    if (ctx.evidenceId) patch.last_statement_evidence_id = ctx.evidenceId;
  }

  // Best-effort audit of EVERY statement cycle seen (history + observability),
  // whether or not it became the current obligation. Degrades if 023 not applied.
  if (fromStatement) {
    try {
      const supabase = createSupabaseAdminClient();
      await supabase.from("debt_statement_cycles").insert({
        user_id: ctx.userId,
        debt_account_id: debt.id,
        evidence_id: ctx.evidenceId ?? null,
        statement_date: statementDate ?? null,
        period_end: isoDate(args.statementPeriodEnd) ?? null,
        full_payment_due: provided(args.totalDueThisMonth) ? money(args.totalDueThisMonth) ?? null : null,
        minimum_payment: provided(args.minimumPayment) ? money(args.minimumPayment) ?? null : null,
        statement_balance: provided(args.statementBalance) ? money(args.statementBalance) ?? null : null,
        due_day: provided(args.dueDay) ? day(args.dueDay) ?? null : null,
        cutoff_day: provided(args.cutoffDay) ? day(args.cutoffDay) ?? null : null,
        interest_rate: provided(args.interestRate) && Number.isFinite(Number(args.interestRate)) ? rate4(Number(args.interestRate)) : null,
        applied: applyObligations,
        is_current: applyObligations,
        reason: decision.reason,
      });
      // Only dedup is_current when we actually have a comparable date (a null
      // statement_date can't be compared with .neq and would NULL-error).
      if (applyObligations && statementDate) {
        await supabase
          .from("debt_statement_cycles")
          .update({ is_current: false })
          .eq("debt_account_id", debt.id)
          .neq("statement_date", statementDate ?? "")
          .eq("is_current", true);
      }
    } catch {
      // audit table may not exist yet (pre-023) → date-awareness still holds via debt_accounts.statement_date
    }
  }

  // Declined an older/undated statement and nothing else to apply → not an
  // error: we kept the current obligations on purpose.
  if (Object.keys(patch).length === 0 && fromStatement && !applyObligations) {
    return {
      status: "done",
      summary: `Ese estado de "${debt.name}" es más antiguo (o sin fecha clara) que el que ya tengo, así que NO toqué su pago/fecha actuales para no desactualizarlos. Sus movimientos sí se pueden registrar. Cuéntaselo natural y sin tecnicismos.`,
    };
  }
  if (Object.keys(patch).length === 0) {
    return {
      status: "needs_info",
      summary: invalid.length
        ? `No apliqué nada en ${debt.name}: ${invalid.join(", ")} con valor inválido.`
        : "No llegó ningún dato de la tarjeta para actualizar.",
    };
  }
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("debt_accounts").update(patch).eq("id", debt.id).eq("user_id", ctx.userId);
    if (error) return { status: "error", summary: error.message };
    if (ctx.refresh) {
      ctx.dirty = true;
      await ctx.refresh().catch(() => {});
    }
    const notes = [
      invalid.length ? `Ignoré por inválidos: ${invalid.join(", ")}.` : null,
      withheld.length
        ? `Mantuve sin cambios (${withheld.join(", ")}) porque ese estado es más antiguo que el actual; sus movimientos sí se registran.`
        : null,
      baseUntouched
        ? `La tarjeta está en ${debt.currency} (≠ tu moneda base ${ctx.baseCurrency}): actualicé el saldo en su moneda; el equivalente en base se ajusta con el tipo de cambio real, no inventado.`
        : null,
    ].filter(Boolean);
    return {
      status: "done",
      summary: `${debt.name} actualizada: ${applied.join(", ")}. El margen usa el pago del mes (no solo el mínimo).${notes.length ? " " + notes.join(" ") : ""}`,
    };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "update failed" };
  }
}

// ── Stage 14 — read-only debt/card analysis tools ───────────────────────────
// These NEVER write. They turn the deterministic debt-health truth into compact
// factual summaries (estimate-tagged) for the agent to phrase like a human coach.

function monthlyMarginEstimate(ctx: AgentContext): number {
  // Weekly Margen Kipu → rough monthly room for debt (estimate; cashflow guard).
  return Math.max(0, ctx.briefing.weeklyMargin * 4.33);
}

function cardLabel(c: CardHealth, base: string): string {
  const bits = [
    `saldo ${formatMoney(c.balance, base as CurrencyCode)}`,
    c.fullPaymentDue != null ? `pago del mes ${formatMoney(c.fullPaymentDue, base as CurrencyCode)}` : null,
    c.minimumPayment != null ? `mínimo ${formatMoney(c.minimumPayment, base as CurrencyCode)}` : null,
    c.dueInDays != null ? `vence en ${c.dueInDays}d` : null,
    c.interestRatePct != null ? `~${c.interestRatePct}%/año` : "sin tasa registrada",
  ].filter(Boolean);
  return `"${c.name}" (${bits.join(", ")}) — estado: ${c.state}`;
}

async function executeAnalyzeDebtHealth(_args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const dh = ctx.briefing.debtHealth;
  if (!dh.hasAnyDebt) {
    return { status: "done", summary: "El usuario no tiene deuda/tarjetas con saldo registradas. Confírmaselo con calma y celebra esa tranquilidad; no inventes deudas." };
  }
  const base = ctx.baseCurrency;
  const lines = dh.cards.filter((c) => c.balance > 0 || c.states.some((s) => s !== "healthy")).map((c) => cardLabel(c, base));
  const action = dh.topAction ? `Acción sugerida ahora: ${dh.topAction.text}.` : "Nada urgente ahora.";
  return {
    status: "done",
    summary: `Salud de deuda (cifras reales del motor; intereses son ESTIMADOS). Total deuda ${formatMoney(dh.totalDebt, base)}, mínimos ${formatMoney(dh.totalMinimums, base)}, pago del mes ${formatMoney(dh.totalFull, base)}, presión ${dh.pressureLevel}. Tarjetas: ${lines.join(" | ")}. ${action} Explícalo humano, sin tabla, y si un estado dice needs_payment_confirmation/overdue PREGUNTA si ya pagó (no lo afirmes).`,
  };
}

async function executePlanDebtPayoff(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const dh = ctx.briefing.debtHealth;
  if (!dh.hasAnyDebt) {
    return { status: "done", summary: "No hay deudas con saldo para armar un plan. Díselo tranquilo y no inventes deudas." };
  }
  const strategyArg = args.strategy;
  const strategy: PayoffStrategy =
    strategyArg === "avalanche" || strategyArg === "snowball" || strategyArg === "urgency_first" ? strategyArg : "hybrid";
  const extra = Number(args.extraMonthly);
  const inputs = payoffInputsFromHealth(dh, ctx.debtAccounts);
  const plan = planPayoff(inputs, {
    strategy,
    extraMonthlyBudget: Number.isFinite(extra) && extra > 0 ? extra : 0,
    monthlyMarginForDebt: monthlyMarginEstimate(ctx),
  });
  const base = ctx.baseCurrency;
  const focus = plan.focusDebtId ? plan.allocations.find((a) => a.id === plan.focusDebtId) : null;
  const focusText = focus
    ? `Primero el abono extra a "${focus.name}" (${focus.reason})${plan.focusPayoff?.feasible ? `: a ese ritmo saldría en ~${plan.focusPayoff.months} meses (interés estimado ${formatMoney(plan.focusPayoff.totalInterest, base)})` : ""}.`
    : "Sin un foco claro para el extra (faltan tasas o saldos).";
  return {
    status: "done",
    summary: `Plan de pago (${plan.strategy}, ESTIMADO). Paga SIEMPRE los mínimos primero (total ${formatMoney(plan.minimumsTotal, base)}). Extra disponible sin romper tu margen: ${formatMoney(plan.extraBudget, base)}. ${focusText} ${plan.notes.join(" ")} Explícalo simple, sin presión, y deja claro que los tiempos/intereses son estimados.`,
  };
}

async function executeCompareDebtVsInvestment(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const dh = ctx.briefing.debtHealth;
  const target = args.debtAccountId
    ? ctx.debtAccounts.find((d) => d.id === args.debtAccountId)
    : dh.highestInterestCardId
      ? ctx.debtAccounts.find((d) => d.id === dh.highestInterestCardId)
      : ctx.debtAccounts.find((d) => d.currentBalanceBase > 0);
  if (!target) {
    return { status: "done", summary: "No hay una deuda con saldo para comparar contra invertir. Díselo tranquilo." };
  }
  const expected = Number(args.expectedReturnPct);
  const cash = Number(args.cashAvailable);
  const result = compareDebtVsInvestment({
    debtAnnualRatePct: target.interestRate ?? null,
    expectedAnnualReturnPct: Number.isFinite(expected) ? expected : null,
    cashAvailable: Number.isFinite(cash) && cash > 0 ? cash : ctx.briefing.liquid.liquidTotal,
    currentLiquidReserve: ctx.briefing.liquid.liquidTotal,
  });
  const verdictText: Record<string, string> = {
    pay_debt: "normalmente conviene pagar la deuda (ahorro casi seguro)",
    invest_or_keep_cash: "podría tener sentido invertir o conservar liquidez",
    split: "conviene dividir: cuidar reserva y a la vez bajar deuda",
    insufficient_data: "falta dato para decidir bien",
  };
  return {
    status: "done",
    summary: `Deuda vs inversión para "${target.name}" (orientación de finanzas personales, NO recomendación de inversión específica; ESTIMADO): ${verdictText[result.verdict]}. ${result.reasons.join(" ")} Recalca: el ahorro de pagar deuda es casi seguro; el retorno de invertir es incierto. Nunca sugieras dejar de pagar un mínimo para invertir.`,
  };
}

async function executeEstimateCardInterest(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const debt = ctx.debtAccounts.find((d) => d.id === args.debtAccountId) ?? ctx.debtAccounts.find((d) => d.currentBalanceBase > 0);
  if (!debt) return { status: "needs_info", summary: "¿De qué tarjeta/deuda calculo el interés? No veo una con saldo." };
  const base = ctx.baseCurrency;
  const rateKind = (debt.interestRateKind ?? "annual_nominal") as RateKind;
  if (debt.interestRate == null || debt.interestRate <= 0) {
    return { status: "needs_info", summary: `No tengo la tasa de "${debt.name}", y sin ella cualquier interés sería inventado. Pregúntale la tasa (anual) para estimarlo honesto.` };
  }
  const partial = Number(args.partialAmount);
  const cmp = comparePayments({
    balance: debt.currentBalanceBase,
    rate: debt.interestRate,
    fullPaymentDue: debt.fullPaymentDue,
    minimumPayment: debt.minimumPayment,
    partial: Number.isFinite(partial) && partial > 0 ? partial : null,
    kind: rateKind,
  });
  const waitDays = Number(args.delayDays);
  const delay = Number.isFinite(waitDays) && waitDays > 0 ? costOfDelay(debt.currentBalanceBase, debt.interestRate, waitDays, rateKind) : null;
  const parts: string[] = [
    `Pagar el TOTAL (${formatMoney(cmp.full.amount, base)}) evita el interés del próximo ciclo.`,
  ];
  if (cmp.minimum) {
    parts.push(
      `Pagar solo el MÍNIMO (${formatMoney(cmp.minimum.amount, base)}) deja ${formatMoney(cmp.minimum.remaining, base)} corriendo interés (~${formatMoney(cmp.minimum.monthlyInterestNext, base)} el primer mes)` +
        (cmp.minimum.payoff?.feasible ? `; a ese ritmo tardarías ~${cmp.minimum.payoff.months} meses y pagarías ~${formatMoney(cmp.minimum.payoff.totalInterest, base)} de interés` : "; a ese ritmo casi no baja el saldo") +
        ".",
    );
  }
  if (cmp.partial) {
    parts.push(`Un abono de ${formatMoney(cmp.partial.amount, base)} deja ${formatMoney(cmp.partial.remaining, base)} con interés (~${formatMoney(cmp.partial.monthlyInterestNext, base)}/mes).`);
  }
  if (delay != null) parts.push(`Esperar ${waitDays} día(s) costaría ~${formatMoney(delay, base)} de interés.`);
  return {
    status: "done",
    summary: `Interés de "${debt.name}" (tasa ~${debt.interestRate}%/año, TODO ESTIMADO): ${parts.join(" ")} Explícalo claro y humano, deja claro que son estimados y no cifras exactas del banco.`,
  };
}

// ── Stage 15 — read-only cashflow planning tools ────────────────────────────
// These NEVER write. They turn the deterministic forward-looking cashflow truth
// (the strengthened, timing-aware Margen engine) into compact facts the agent
// phrases simply: today's & this week's safe spend, runway, what to watch.

async function executeCashflowOutlook(_args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const cf = ctx.briefing.cashflow;
  const base = ctx.baseCurrency;
  const m = (v: number) => formatMoney(v, base);
  const income =
    cf.nextIncome && cf.nextIncome.confidence !== "low"
      ? `Próximo ingreso ~${m(cf.nextIncome.amount)} el ${cf.nextIncome.dateISO}.`
      : cf.nextIncome
        ? "Hay un ingreso registrado pero NO sé la fecha exacta — pídela (\"¿qué día sueles cobrar?\"); NO inventes la fecha."
        : "No hay un ingreso registrado, proyecto a fin de mes (dilo así, no inventes fecha).";
  const runway = cf.runwayOk
    ? "Llegas a tu próximo ingreso sin quedarte corto."
    : `Cuidado: la proyección baja a ${m(cf.lowestProjectedBalance)} el ${cf.lowestDateISO} (no alcanza tranquilo).`;
  const risk = cf.riskWindows.length ? ` Lo único a cuidar: ${cf.riskWindows.map((r) => `${r.label} (${r.dateISO})`).join(" y ")}.` : "";
  const conf =
    cf.confidence === "high" ? "" : cf.confidence === "medium" ? " (confianza media)" : ` (baja confianza${cf.missing[0] ? `: ${cf.missing[0]}` : ""})`;
  return {
    status: "done",
    summary: `Cashflow (números reales del motor, es Margen Kipu proyectado): HOY puedes gastar hasta ${m(cf.safeToday)} tranquilo; esta SEMANA ${m(cf.safeThisWeek)}. ${runway} ${income}${risk}${conf} Responde SIMPLE: hoy, esta semana y MÁXIMO una cosa a cuidar; nada de listas ni jerga.`,
  };
}

async function executeSimulateScenario(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const base = ctx.baseCurrency;
  const m = (v: number) => formatMoney(v, base);
  const kinds = ["spend_today", "income_earlier", "income_later", "add_monthly_expense", "change_goal_contribution", "protect_reserve"];
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  let kind = typeof args.kind === "string" && kinds.includes(args.kind) ? (args.kind as ScenarioSpec["kind"]) : undefined;
  if (!kind && num(args.amount) !== undefined) kind = "spend_today"; // "¿puedo gastar 80 hoy?" default
  if (!kind) return { status: "needs_info", summary: "¿Qué quieres simular? (un gasto hoy, que te paguen antes/después, un gasto fijo nuevo, cambiar tu aporte, o proteger un colchón)." };
  const spec: ScenarioSpec = {
    kind,
    amount: num(args.amount),
    days: num(args.days),
    monthlyAmount: num(args.monthlyAmount),
    weeklyDelta: num(args.weeklyDelta),
    reserveAmount: num(args.reserveAmount),
    label: typeof args.label === "string" ? args.label : undefined,
  };
  const r = simulateScenario(ctx.briefing.cashflowScenarioBase, spec);
  const verdict =
    r.verdict === "recommended" ? "se puede sin problema" : r.verdict === "possible_but_tight" ? "se puede, pero queda justo" : "mejor no ahora";
  const runway = r.after.runwayOk ? "sigues llegando a tu ingreso" : "romperías tu colchón antes del ingreso";
  const unc = r.uncertainties.length ? ` Ojo: ${r.uncertainties[0]}.` : "";
  return {
    status: "done",
    summary: `Escenario "${r.scenario}" (ESTIMADO): ${verdict}. Tu gasto seguro de HOY pasa de ${m(r.base.safeToday)} a ${m(r.after.safeToday)}; esta semana quedaría ${m(r.after.safeThisWeek)}; ${runway}. Fin de mes proyectado: ${m(r.after.projectedEndOfMonth)} (cambio ${m(r.deltaEndOfMonth)}).${unc} Dilo simple, directo y sin culpa; una recomendación clara.`,
  };
}

async function executePlanCashflow(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const cf = ctx.briefing.cashflow;
  const cal = ctx.briefing.cashflowScenarioBase.calendar;
  const base = ctx.baseCurrency;
  const m = (v: number) => formatMoney(v, base);
  const horizon = args.horizon === "until_income" ? "hasta tu próximo ingreso" : "de esta semana";
  const pays = cal.events
    .filter((e) => e.signedAmount < 0 && (e.requirement === "required" || e.reserves))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4)
    .map((e) => `${e.label} ${m(e.amount)} (${e.date})`);
  const tone =
    args.tone === "pessimistic"
      ? "Tono CONSERVADOR (asume el peor caso, ingreso que se atrasa)."
      : args.tone === "optimistic"
        ? "Tono optimista pero realista, sin prometer de más."
        : "";
  const runway = cf.runwayOk ? "Llegas bien al ingreso." : `Cuida no bajar de tu colchón cerca del ${cf.lowestDateISO}.`;
  const conf = cf.confidence === "low" && cf.missing[0] ? ` Antes de afinar: ${cf.missing[0]}.` : "";
  return {
    status: "done",
    summary: `Plan ${horizon} (estimado, números del motor): disponible HOY ${m(cf.safeToday)}, SEMANA ${m(cf.safeThisWeek)}. Pagos que vienen: ${pays.join("; ") || "ninguno grande"}. ${runway}${conf} Arma un plan CORTO de 3–5 pasos, concreto, directo y sin culpa; céntralo en qué gastar/cuidar, no en teoría. ${tone}`,
  };
}

// ── Stage 16 — behavioral spending OS read tools. All read ctx.briefing.
// spendingIntel (computed once per turn from the same live truth) and return a
// SIMPLE structured fact for the agent to phrase: genius inside, simple outside.
function cadenceEs(c: string): string {
  return c === "weekly" ? "semana" : c === "biweekly" ? "quincena" : c === "annual" ? "año" : "mes";
}

async function executeWhereDidMoneyGo(ctx: AgentContext): Promise<ToolResult> {
  const si = ctx.briefing.spendingIntel;
  const m = (v: number) => formatMoney(v, ctx.baseCurrency);
  if (si.baselines.confidence === "low" && si.spendTxnCount < 8) {
    return { status: "done", summary: "Aún tengo pocos movimientos para decir con certeza en qué se va la plata; con unos días más te lo muestro claro. No inventes categorías ni montos." };
  }
  const top = si.baselines.topByImpact.slice(0, 3).map((c) => `${c.parentCategory} ~${m(c.monthlyAvg)}/mes`).join(", ");
  const subs = si.subscriptions.estimatedMonthlyTotal > 0 ? ` Suscripciones detectadas ~${m(si.subscriptions.estimatedMonthlyTotal)}/mes.` : "";
  const conf = si.baselines.confidence === "high" ? "" : " (es una lectura de los últimos días; se irá afinando — dilo así, sin tecnicismos)";
  return {
    status: "done",
    summary: `En qué se va (gasto controlable, aprox/mes): ${top || "sin un patrón claro todavía"}.${subs}${conf}. Transferencias, pagos de tarjeta, reembolsos e ingresos NO son gasto. Dilo simple: las 2–3 cosas que importan, sin listar todo, sin mostrar etiquetas internas.`,
  };
}

async function executeWhyMarginChanged(ctx: AgentContext): Promise<ToolResult> {
  const ma = ctx.briefing.spendingIntel.margin;
  if (!ma.drivers.length) {
    return { status: "done", summary: `No veo un cambio grande respecto a tu normal esta semana. ${ma.basis} Dilo tranquilo, sin inventar una causa.` };
  }
  const drivers = ma.drivers.slice(0, 3).map((d) => d.note).join(" ");
  return {
    status: "done",
    summary: `Por qué cambió tu margen: ${drivers} ${ma.basis} Nombra el driver principal de forma simple, NO recites cinco números.`,
  };
}

async function executeSpendingAnomalies(ctx: AgentContext): Promise<ToolResult> {
  const a = ctx.briefing.spendingIntel.anomalies;
  if (!a.anomalies.length) {
    return { status: "done", summary: "Nada raro en tus gastos recientes; todo dentro de lo normal. Dilo calmado, sin alarmar." };
  }
  const top = a.anomalies.slice(0, 3).map((x) => x.note).join(" ");
  return {
    status: "done",
    summary: `Cosas a revisar (graduadas, con calma): ${top} Si algo cae dentro de lo normal, no lo hagas sonar a problema; menciona solo lo que de verdad valga la pena, en tono tranquilo.`,
  };
}

async function executeMySubscriptions(ctx: AgentContext): Promise<ToolResult> {
  const s = ctx.briefing.spendingIntel.subscriptions;
  const m = (v: number) => formatMoney(v, ctx.baseCurrency);
  if (!s.subscriptions.length) {
    return { status: "done", summary: "No detecté suscripciones o cargos recurrentes claros todavía. No inventes ninguno; si el usuario menciona uno, puedes anotarlo." };
  }
  const list = s.subscriptions
    .slice(0, 6)
    .map((x) => `${x.merchantFamily} ~${m(x.amount)}/${cadenceEs(x.cadence)}${x.nextChargeISO ? `, próximo ~${x.nextChargeISO}` : ""}${x.alreadyModeled ? " (ya es gasto fijo)" : x.suggestConvert ? " (no está como fijo)" : ""}`)
    .join("; ");
  const convertible = s.subscriptions.filter((x) => x.suggestConvert);
  const ask = convertible.length ? ` Si encaja, PREGUNTA si conviertes ${convertible[0].merchantFamily} en gasto fijo (usa create_fixed_expense solo tras confirmar; no lo crees solo).` : "";
  return {
    status: "done",
    summary: `Suscripciones/recurrentes detectadas: ${list}. Total estimado ~${m(s.estimatedMonthlyTotal)}/mes.${ask}`,
  };
}

async function executeBudgetSuggestion(ctx: AgentContext): Promise<ToolResult> {
  const b = ctx.briefing.spendingIntel.budget;
  const m = (v: number) => formatMoney(v, ctx.baseCurrency);
  if (!b.overCategories.length) {
    return { status: "done", summary: "Vas dentro de tu normal esta semana, nada que apretar. Confírmalo tranquilo, sin sermón ni listas." };
  }
  const tops = b.overCategories
    .slice(0, 2)
    .map((s) => `${s.parentCategory} ~${Math.round(s.pctVsNormal * 100)}% arriba de su normal (proyecta ${m(s.projectedThisWeek)} vs ${m(s.normalWeekly)})`)
    .join("; ");
  const adj = b.oneAdjustment ? ` Un ajuste de ~${m(b.oneAdjustment.saving)} en ${b.oneAdjustment.categories.join(" + ")} reencauza la semana.` : "";
  return {
    status: "done",
    summary: `Presupuesto dinámico (sin sermón): ${tops}.${adj} Frámalo como control, NUNCA como fracaso ni como que "falló su presupuesto".`,
  };
}

async function executeRecommendCut(ctx: AgentContext): Promise<ToolResult> {
  const one = ctx.briefing.spendingIntel.insights.theOneThing;
  if (!one || (!one.actionable && one.kind !== "subscription_unmodeled")) {
    return { status: "done", summary: "Ahora mismo no hay un recorte que te mueva la aguja; vas bien. NUNCA sugieras saltarte un pago mínimo de tarjeta o deuda." };
  }
  const act = one.suggestedAction ? ` Acción concreta: ${one.suggestedAction}` : "";
  return {
    status: "done",
    summary: `Lo más útil para liberar margen: ${one.title}${act}${one.detail ? ` (${one.detail})` : ""}. Una sola sugerencia concreta y sin culpa; JAMÁS recomiendes saltarte un pago mínimo de tarjeta/deuda.`,
  };
}

// Persist a generalizable spending correction to structured merchant memory so it
// applies to FUTURE matching transactions. Degrades gracefully (migration 024):
// if the store isn't there yet, it's honest about not persisting permanently.
async function executeLearnSpendingCorrection(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const text = String(args.merchantText ?? "").trim();
  if (!text) return { status: "needs_info", summary: "¿Sobre qué cobro o comercio es la regla?" };
  const pattern = merchantKey(text);
  if (!pattern || pattern.length < 2) {
    return { status: "needs_info", summary: "No pude identificar bien el comercio; dímelo con el nombre que aparece en el cobro." };
  }
  const cat = typeof args.category === "string" && VALID_CATEGORIES.has(args.category as FinancialCategory) ? (args.category as FinancialCategory) : undefined;
  const family = typeof args.merchantFamily === "string" && args.merchantFamily.trim() ? args.merchantFamily.trim().slice(0, 60) : undefined;
  const isRecurring = typeof args.isRecurring === "boolean" ? args.isRecurring : undefined;
  if (!cat && !family && isRecurring === undefined) {
    return { status: "needs_info", summary: "¿Qué le enseño de ese comercio? Su categoría correcta, su nombre, o que es un cobro recurrente." };
  }
  const note = typeof args.note === "string" && args.note.trim() ? args.note.trim().slice(0, 200) : undefined;
  const ok = await saveMerchantCorrection(ctx.userId, { matchPattern: pattern, category: cat, family, isRecurring, note, source: "user_correction" });
  const what = cat ? `como ${cat}` : family ? `como ${family}` : isRecurring ? "como recurrente" : "según me indicaste";
  if (!ok) {
    return { status: "done", summary: `Tomé nota de que "${family ?? text}" va ${what}, pero no pude guardarlo de forma permanente ahora; aplícalo igual en esta conversación. No prometas que lo recordarás siempre.` };
  }
  return {
    status: "done",
    summary: `Aprendido: de ahora en adelante trataré "${family ?? text}" ${what}${isRecurring ? " (recurrente)" : ""}. Confírmalo natural y breve, sin tecnicismos.`,
  };
}

// ── Stage 17 — Goals, Mini-Goals & Wealth Builder tools. Read tools use
// ctx.briefing.goalsIntel (the single per-turn truth: portfolio, allocation,
// joy budget, net worth). Write tools go through the typed goals-wealth store and
// mark ctx.dirty so a same-turn read refreshes. Genius inside, simple outside.
const VALID_ARCHETYPES = new Set<GoalArchetype>(["savings", "travel", "purchase", "emergency", "debt_payoff", "investment", "wealth", "family", "lifestyle", "custom"]);
const VALID_ASSET_CLASSES = new Set<AssetClass>(["cash", "investment", "fixed_term", "crypto", "property", "vehicle", "business", "receivable", "other"]);
function validISODate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) && !Number.isNaN(new Date(v).getTime()) ? v.trim() : undefined;
}

async function executeEvaluatePurchaseAsGoal(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const price = Number(args.amount);
  const label = typeof args.label === "string" && args.label.trim() ? args.label.trim() : "eso";
  if (!Number.isFinite(price) || price <= 0) {
    return { status: "needs_info", summary: `¿Cuánto cuesta ${label} más o menos? Con el precio te digo si te conviene hoy o como mini-meta.` };
  }
  if (ctx.dirty && ctx.refresh) { await ctx.refresh(); ctx.dirty = false; }
  const gi = ctx.briefing.goalsIntel;
  const cf = ctx.briefing.cashflow;
  const m = (v: number) => formatMoney(v, ctx.baseCurrency);
  const cardDue = ctx.briefing.cardsDueSoon[0]?.balance ?? 0;
  const ev = evaluatePurchase({
    price,
    safeToday: cf.safeToday,
    safeThisWeek: cf.safeThisWeek,
    discretionaryAfterPlanWeekly: gi.weeklyJoyBudget,
    nowMs: Date.now(),
    onCard: args.onCard === true,
    cardDueSoonAmount: cardDue,
    runwayOk: cf.runwayOk,
  });
  const mg = ev.miniGoal && ev.miniGoal.feasibleFromDiscretionary
    ? ` Alternativa mini-meta: ~${m(ev.miniGoal.weeklyContribution)}/sem por ${ev.miniGoal.weeks} sem (lista ~${ev.miniGoal.targetDateISO}), sin tocar pagos ni metas.`
    : "";
  if (ev.recommendation === "buy_today") {
    return { status: "done", summary: `Sí puedes comprar ${label} hoy (${m(price)}) sin apretarte: te cabe en tu gasto seguro.${mg} Ofrécele ambas: comprarlo tranquilo hoy o, si prefiere no mover su semana, la mini-meta. Tono relajado, sin culpa.` };
  }
  if (ev.recommendation === "mini_goal" && ev.miniGoal) {
    return { status: "done", summary: `Comprar ${label} hoy te dejaría apretado (${ev.pressureReason ?? "comprime tu semana"}). NO digas solo "no": propón mini-meta — aparta ~${m(ev.miniGoal.weeklyContribution)}/sem y en ${ev.miniGoal.weeks} semana(s) (≈ ${ev.miniGoal.targetDateISO}) lo compras sin tocar tu tarjeta, tu meta principal ni tu fondo. Celébralo como un plan, no como una negativa.` };
  }
  return { status: "done", summary: `Ahora mismo ${label} (${m(price)}) no entra sin presionar tus pagos${ev.pressureReason ? ` (${ev.pressureReason})` : ""}, y no hay margen libre para una mini-meta cómoda esta semana. Sugiere esperar a que se libere algo o ajustar otra prioridad; con tacto, sin culpa.` };
}

async function executeCreateGoal(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const targetAmount = Number(args.targetAmount);
  if (!name) return { status: "needs_info", summary: "¿Cómo quieres llamar a esta meta?" };
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) return { status: "needs_info", summary: `¿De cuánto es la meta "${name}"?` };
  const cadence = ["weekly", "biweekly", "monthly"].includes(args.cadence as string) ? (args.cadence as GoalCadence) : undefined;
  const contributionAmount = Number(args.contributionAmount);
  const a: CreateGoalArgs = {
    userId: ctx.userId,
    name,
    targetAmount,
    targetDate: validISODate(args.targetDate) ?? null,
    archetype: VALID_ARCHETYPES.has(args.archetype as GoalArchetype) ? (args.archetype as GoalArchetype) : undefined,
    isPrimary: args.isPrimary === true,
    cadence,
    contributionAmount: cadence && Number.isFinite(contributionAmount) && contributionAmount > 0 ? contributionAmount : null,
    currency: typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency) ? args.currency.toUpperCase() : undefined,
  };
  const res = await createGoalRow(a);
  if (!res.ok) return { status: "done", summary: `Anoté la meta "${name}" en la conversación, pero no pude guardarla de forma permanente ahora. No prometas que quedó guardada; ofrécele reintentar.` };
  ctx.dirty = true;
  const committed = a.cadence && a.contributionAmount ? ` Con ~${formatMoney(a.contributionAmount, ctx.baseCurrency)}/${a.cadence === "weekly" ? "sem" : a.cadence === "biweekly" ? "quincena" : "mes"} reservados.` : "";
  return { status: "done", summary: `Creé la meta "${name}" (${formatMoney(targetAmount, ctx.baseCurrency)}${a.targetDate ? `, para ${a.targetDate}` : ", sin fecha fija"}).${committed} Confírmalo natural y, si no hay fecha/aporte, ofrece definirlos para armar el plan.` };
}

async function executeCreateMiniGoal(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const price = Number(args.price);
  if (!name) return { status: "needs_info", summary: "¿Para qué es la mini-meta?" };
  if (!Number.isFinite(price) || price <= 0) return { status: "needs_info", summary: `¿Cuánto cuesta ${name}?` };
  const gi = ctx.briefing.goalsIntel;
  let weekly = Number(args.weeklyContribution);
  if (!Number.isFinite(weekly) || weekly <= 0) {
    const plan = planMiniGoal({ price, discretionaryWeekly: gi.weeklyJoyBudget, nowMs: Date.now() });
    weekly = plan.weeklyContribution;
  }
  if (weekly <= 0) return { status: "done", summary: `Ahora mismo no hay margen libre para apartar sin tocar tus pagos o metas. Mejor esperar a que se libere algo; dilo con tacto, no como un "no" seco.` };
  const weeks = Math.max(1, Math.ceil(price / weekly));
  const targetISO = new Date(Date.now() + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
  const res = await createGoalRow({
    userId: ctx.userId,
    name,
    targetAmount: price,
    targetDate: targetISO,
    goalType: "mini",
    archetype: "purchase",
    cadence: "weekly",
    contributionAmount: weekly,
    parentGoalId: typeof args.parentGoalId === "string" ? args.parentGoalId : null,
  });
  if (!res.ok) return { status: "done", summary: `Pensé la mini-meta de "${name}" (~${formatMoney(weekly, ctx.baseCurrency)}/sem, ${weeks} sem) pero no pude guardarla ahora; ofrécele reintentar.` };
  ctx.dirty = true;
  return { status: "done", summary: `Mini-meta creada: "${name}" — aparta ~${formatMoney(weekly, ctx.baseCurrency)}/sem y en ${weeks} semana(s) (≈ ${targetISO}) lo compras sin tocar tu tarjeta ni tu meta principal. Celébralo: es comprarte el gusto SIN deuda. Le recordaré el avance.` };
}

async function executePrioritizeGoals(ctx: AgentContext): Promise<ToolResult> {
  const gi = ctx.briefing.goalsIntel;
  if (gi.portfolio.activeCount === 0) {
    return { status: "done", summary: "Todavía no hay metas activas para priorizar. Si el usuario quiere, ofrécele crear una meta principal y, si surge un gusto, una mini-meta." };
  }
  const order = gi.portfolio.goals.slice(0, 5).map((g, i) => `${i + 1}) ${g.goal.name}${g.isPrimary ? " (principal)" : g.goalType === "mini" ? " (mini)" : ""} — ${g.plan.statusLabel}`).join("; ");
  const conflicts = gi.portfolio.conflicts.length ? ` A cuidar: ${gi.portfolio.conflicts.slice(0, 2).map((c) => c.note).join(" ")}` : "";
  return {
    status: "done",
    summary: `Orden de prioridad: ${order}. Reparto del margen libre: ${gi.allocation.rationale}${conflicts} Responde SIMPLE: en qué 1–2 enfocarse y qué pausar/extender si compiten; nunca sugieras saltarte un mínimo de deuda. Tono de control y calma.`,
  };
}

async function executeUpdateGoal(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const goalId = typeof args.goalId === "string" ? args.goalId : "";
  if (!goalId) return { status: "needs_info", summary: "¿Cuál meta? Si hay varias parecidas, pregúntale al usuario cuál antes de cambiarla." };
  // The portfolio lists ACTIVE goals only; a paused goal being reactivated won't
  // appear there, so resolve a display name softly and proceed by id (the store
  // update is scoped to user_id + id, and returns false if nothing matched).
  const target = ctx.briefing.goalsIntel.portfolio.goals.find((g) => g.goal.id === goalId);
  const goalName = target?.goal.name ?? "tu meta";
  const patch: Record<string, unknown> = {};
  if (args.status === "paused" || args.status === "active") patch.status = args.status;
  const date = validISODate(args.targetDate);
  if (date) patch.target_date = date;
  const contribution = Number(args.contributionAmount);
  if (Number.isFinite(contribution) && contribution >= 0) patch.contribution_amount = contribution;
  if (["weekly", "biweekly", "monthly"].includes(args.cadence as string)) patch.cadence = args.cadence;
  if (args.makePrimary === true) { patch.is_primary = true; patch.goal_type = "primary"; }
  if (args.flexibleDeadline === true) patch.flexible_deadline = true;
  if (Object.keys(patch).length === 0) return { status: "needs_info", summary: "¿Qué quieres cambiar de la meta: pausarla, su aporte, su fecha, o hacerla principal?" };
  const ok = await updateGoalRow(ctx.userId, goalId, patch);
  if (!ok) return { status: "needs_info", summary: `No encuentro esa meta para actualizar; muéstrale sus metas y que elija cuál.` };
  ctx.dirty = true;
  const what = patch.status === "paused" ? "la pausé (su dinero reservado queda libre para el resto)" : patch.status === "active" ? "la reactivé" : patch.is_primary ? "ahora es tu meta principal" : "la actualicé";
  return { status: "done", summary: `Listo, "${goalName}": ${what}. Confírmalo natural y, si liberó o reservó margen, dilo simple.` };
}

async function executeRegisterInvestment(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const value = Number(args.value);
  const assetClass = VALID_ASSET_CLASSES.has(args.assetClass as AssetClass) ? (args.assetClass as AssetClass) : null;
  if (!name) return { status: "needs_info", summary: "¿Cómo se llama esa inversión o activo?" };
  if (!assetClass) return { status: "needs_info", summary: "¿Qué tipo de activo es? (póliza/plazo fijo, acciones/ETF, cripto, propiedad, vehículo, negocio, préstamo a favor…)" };
  if (!Number.isFinite(value) || value < 0) return { status: "needs_info", summary: `¿Cuál es el valor actual de ${name}? (lo que tú sabes; no invento precios)` };
  const expectedReturnPct = Number(args.expectedReturnPct);
  const res = await registerInvestmentRow({
    userId: ctx.userId,
    name,
    assetClass,
    valueBase: value,
    currency: typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency) ? args.currency.toUpperCase() : undefined,
    liquid: args.liquid === true,
    expectedReturnPct: Number.isFinite(expectedReturnPct) && expectedReturnPct > 0 ? expectedReturnPct : null,
    returnKind: ["annual_nominal", "annual_effective", "monthly"].includes(args.returnKind as string) ? (args.returnKind as "annual_nominal" | "annual_effective" | "monthly") : undefined,
  });
  if (!res.ok) return { status: "done", summary: `Tomé nota de ${name} pero no pude guardarlo ahora; ofrécele reintentar.` };
  ctx.dirty = true;
  const rate = Number.isFinite(expectedReturnPct) && expectedReturnPct > 0 ? ` al ${expectedReturnPct}% (proyectaré su crecimiento, estimado)` : " (sin rendimiento informado: cuenta para tu patrimonio pero no proyecto crecimiento)";
  return { status: "done", summary: `Registré ${name} por ${formatMoney(value, ctx.baseCurrency)}${rate}. Ya entra en tu patrimonio. NUNCA inventes precios ni rendimientos; jamás recomiendes un activo específico.` };
}

async function executeNetWorth(ctx: AgentContext): Promise<ToolResult> {
  const gi = ctx.briefing.goalsIntel;
  const m = (v: number) => formatMoney(v, ctx.baseCurrency);
  if (!gi.netWorth) {
    return { status: "done", summary: "Aún no tengo activos ni inversiones registradas para calcular tu patrimonio. Si quieres, ofrécele registrar lo que tiene (cuentas, pólizas, inversiones, propiedades). No inventes valores." };
  }
  const nw = gi.netWorth;
  const wealth = nw.wealthTarget ? ` Meta de patrimonio ${m(nw.wealthTarget)}: ${nw.wealthProgressPct}%${nw.requiredMonthlyForTarget != null ? `, requiere ~${m(nw.requiredMonthlyForTarget)}/mes` : ""}.` : "";
  const inv = gi.investment ? ` Inversiones: ${gi.investment.count}, valor ~${m(gi.investment.totalValue)}${gi.investment.hasReturns ? `, proyección 12m ~${m(gi.investment.projected12mValue)}` : ""}.` : "";
  return {
    status: "done",
    summary: `Patrimonio (ESTIMADO): neto ~${m(nw.totalNetWorth)} (líquido ~${m(nw.liquidNetWorth)}; activos ~${m(nw.totalAssets)}, deuda ~${m(nw.totalDebt)}).${inv}${wealth} Dilo simple y deja claro que es estimado; nunca afirmes valores de mercado en tiempo real ni un bróker conectado si no lo está.`,
  };
}

async function executeSetWealthTarget(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { status: "needs_info", summary: "¿A qué número de patrimonio quieres llegar?" };
  const ok = await setGoalPrefs(ctx.userId, { wealthTarget: amount });
  if (!ok) return { status: "done", summary: "No pude guardar tu meta de patrimonio ahora; ofrécele reintentar." };
  ctx.dirty = true;
  return { status: "done", summary: `Anoté tu meta de patrimonio: ${formatMoney(amount, ctx.baseCurrency)}. Cuando me preguntes te muestro el avance y el aporte mensual estimado para llegar (es estimado, depende del rendimiento que me des).` };
}

async function executeSetAmbitionMode(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const mode = ["light_touch", "steady", "power_builder"].includes(args.mode as string) ? (args.mode as AmbitionMode) : null;
  if (!mode) return { status: "needs_info", summary: "¿Prefieres ir suave (disfrutar más, metas tranquilas), equilibrado, o atacar fuerte tus metas?" };
  const ok = await setGoalPrefs(ctx.userId, { ambitionMode: mode });
  if (!ok) return { status: "done", summary: "No pude guardar tu preferencia ahora; ofrécele reintentar." };
  ctx.dirty = true;
  const label = mode === "light_touch" ? "suave (priorizo que disfrutes, metas tranquilas)" : mode === "power_builder" ? "fuerte (empujo metas y deuda más duro, gustos más ajustados)" : "equilibrado";
  return { status: "done", summary: `Listo, ajusto tu ritmo a ${label}. Esto cambia cómo reparto tu margen libre, nunca tus pagos mínimos ni la seguridad. Confírmalo natural.` };
}

// ── Stage 18 — Personalization tools. Reads use ctx.briefing.personalization
// (the per-turn profile/decisions); writes go through the typed personalization
// store and mark ctx.dirty. They change TONE/FRAMING/surfaces/nudge prefs only —
// never the money math, the minimums, or the default brevity.
async function executeSetFinancialPhilosophy(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const philosophy = ["experiences", "balanced", "builder", "wealth"].includes(args.philosophy as string) ? (args.philosophy as FinancialPhilosophy) : null;
  if (!philosophy) return { status: "needs_info", summary: "¿Prefieres disfrutar más tu dinero hoy, construir patrimonio, o un equilibrio? No lo etiquetes; solo entiende su filosofía." };
  const ok = await setPersonalizationPref(ctx.userId, { financialPhilosophy: philosophy });
  await logPreferenceEvent(ctx.userId, "philosophy", philosophy);
  if (!ok) return { status: "done", summary: `Entendí tu filosofía pero no pude guardarla ahora; aplícala igual en esta conversación.` };
  ctx.dirty = true;
  const how = philosophy === "experiences" ? "priorizo que disfrutes tu dinero sin endeudarte; no te voy a presionar a ahorrar" : philosophy === "wealth" ? "te voy a ayudar a construir patrimonio y seré menos permisivo con lo discrecional" : philosophy === "builder" ? "priorizo el avance de tus metas con equilibrio" : "mantengo el equilibrio entre disfrutar y construir";
  return { status: "done", summary: `Listo: de ahora en adelante ${how}. Nunca cambia tus pagos ni tu seguridad financiera. Confírmalo natural y breve.` };
}

async function executeGetPersonalizationProfile(ctx: AgentContext): Promise<ToolResult> {
  const p = ctx.briefing.personalization.profile;
  const philo = p.financialPhilosophy === "unknown" ? "sin declarar" : p.financialPhilosophy;
  return {
    status: "done",
    summary: `Config actual (dilo SIMPLE y humano, sin etiquetas internas; confianza ${p.confidence}): filosofía ${philo}, orientación ${p.financialOrientation}, tono ${p.tone}, detalle ${p.detailLevel}, modo ${p.userMode}, riesgo ${p.riskPosture}, recordatorios ${p.nudgeSensitivity}. Puede cambiar cualquiera cuando quiera.`,
  };
}

async function executeSetCommunicationPreference(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const tone = ["calm", "direct", "motivating", "analytical", "gentle", "playful", "coach"].includes(args.tone as string) ? (args.tone as string) : undefined;
  const detail = ["short", "balanced", "detailed"].includes(args.detail as string) ? (args.detail as string) : undefined;
  if (!tone && !detail) return { status: "needs_info", summary: "¿Cómo prefieres que te hable (más directo, suave, motivador) o cuánto detalle (corto, balanceado, detallado)?" };
  const ok = await setCommunicationPref(ctx.userId, { tone, detailLevel: detail });
  if (tone) await logPreferenceEvent(ctx.userId, "tone", tone);
  if (detail) await logPreferenceEvent(ctx.userId, "detail", detail);
  if (!ok) return { status: "done", summary: "Tomé nota de tu preferencia de estilo, pero no pude guardarla ahora; aplícala en esta conversación." };
  ctx.dirty = true;
  return { status: "done", summary: `Listo, ajusto mi estilo${tone ? ` (tono ${tone})` : ""}${detail ? ` (detalle ${detail})` : ""}. El detalle aplica cuando profundizas; las confirmaciones rutinarias siguen cortas. Confírmalo breve.` };
}

async function executeSetRiskPreference(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const risk = ["conservative", "moderate", "aggressive"].includes(args.risk as string) ? (args.risk as "conservative" | "moderate" | "aggressive") : null;
  if (!risk) return { status: "needs_info", summary: "¿Prefieres ir conservador (más colchón), moderado, o tolerar más riesgo?" };
  const ok = await setGoalPrefs(ctx.userId, { riskTolerance: risk });
  await logPreferenceEvent(ctx.userId, "risk", risk);
  if (!ok) return { status: "done", summary: "Tomé nota de tu postura de riesgo pero no pude guardarla ahora." };
  ctx.dirty = true;
  return { status: "done", summary: `Listo, ajusto el encuadre a un perfil ${risk === "conservative" ? "conservador (más colchón y prudencia)" : risk === "aggressive" ? "más tolerante al riesgo (planes algo más ambiciosos, siempre estimados)" : "moderado"}. No cambio la verdad financiera ni recomiendo activos específicos.` };
}

async function executeSetOnboardingMode(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const mode = args.mode === "simple" || args.mode === "power" ? (args.mode as "simple" | "power") : null;
  if (!mode) return { status: "needs_info", summary: "¿Lo quieres simple (lo mínimo, rápido) o power (más detalle y control)?" };
  const ok = await setPersonalizationPref(ctx.userId, { onboardingMode: mode });
  await logPreferenceEvent(ctx.userId, "onboarding", mode);
  if (!ok) return { status: "done", summary: "Tomé nota pero no pude guardarlo ahora." };
  ctx.dirty = true;
  return { status: "done", summary: `Listo, modo ${mode === "simple" ? "simple (lo mínimo y con más automatización)" : "power (más detalle y control disponible)"}. Aun en power, las respuestas por defecto siguen cortas.` };
}

async function executeSetNudgeSensitivity(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const s = ["low", "normal", "high"].includes(args.sensitivity as string) ? (args.sensitivity as "low" | "normal" | "high") : null;
  if (!s) return { status: "needs_info", summary: "¿Quieres más recordatorios, los normales, o solo los importantes?" };
  const ok = await setPersonalizationPref(ctx.userId, { nudgeSensitivity: s });
  await logPreferenceEvent(ctx.userId, "nudge_sensitivity", s);
  if (!ok) return { status: "done", summary: "Tomé nota pero no pude guardarlo ahora." };
  ctx.dirty = true;
  return { status: "done", summary: `Listo: ${s === "high" ? "solo te aviso lo realmente importante" : s === "low" ? "no te filtro recordatorios, te dejo los que puedan ayudarte" : "recordatorios normales"}. Siempre respeto tus horas de silencio y el tope diario; nunca te aviso de más.` };
}

async function executeUpdateLifeContext(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const kind = typeof args.kind === "string" ? args.kind.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40) : "";
  const label = typeof args.label === "string" ? args.label.trim() : "";
  if (!kind || !label) return { status: "needs_info", summary: "¿Qué de tu situación quieres que tenga en cuenta? (solo lo que tú me digas, nada sensible)" };
  const ok = await upsertLifeContext(ctx.userId, kind, label);
  await logPreferenceEvent(ctx.userId, "life_context", kind);
  if (!ok) return { status: "done", summary: `Tomé nota de "${label}" pero no pude guardarlo ahora; lo tengo presente en esta conversación.` };
  ctx.dirty = true;
  return { status: "done", summary: `Anotado: ${label}. Lo tendré en cuenta solo cuando sea relevante para tus recomendaciones, sin sobre-interpretarlo. Confírmalo breve.` };
}

async function executeForgetLifeContext(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const kind = typeof args.kind === "string" ? args.kind.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40) : "";
  if (!kind) return { status: "needs_info", summary: "¿Qué contexto quieres que olvide? (dime cuál, p.ej. que eras estudiante o que viajabas)" };
  const ok = await removeLifeContext(ctx.userId, kind);
  await logPreferenceEvent(ctx.userId, "life_context_removed", kind);
  if (!ok) return { status: "done", summary: "Tomé nota; dejo de tenerlo en cuenta en esta conversación." };
  ctx.dirty = true;
  return { status: "done", summary: "Listo, ya no lo tendré en cuenta. Tus datos y metas siguen igual. Confírmalo breve." };
}

async function executeExplainPersonalization(ctx: AgentContext): Promise<ToolResult> {
  const pi = ctx.briefing.personalization;
  const p = pi.profile;
  const d = pi.decisions;
  const explicitTraits = Object.entries(p.provenance).filter(([, v]) => v === "explicit").map(([k]) => k);
  const densityWhy = p.provenance.dashboardDensity === "explicit" ? "tú la elegiste" : "la inferí de tu uso/filosofía y es ajustable";
  const dash = `Sobre el dashboard: densidad ${d.dashboardDensity} (${densityWhy}); destaco ${d.promotedSurfaces.join(", ") || "lo esencial"}${d.collapsedSurfaces.length ? ` y dejo en segundo plano ${d.collapsedSurfaces.join(", ")}` : ""}; NINGÚN dato financiero real se oculta y puede pedir verlo cuando quiera.`;
  return {
    status: "done",
    summary: `Explica honesto y SIN sonar invasivo (confianza ${p.confidence}): adapto el tono (${p.tone}) y el encuadre a lo que el usuario me ha dicho o a cómo usa la app; ${explicitTraits.length ? `lo explícito que él fijó: ${explicitTraits.join(", ")}` : "casi todo viene de valores por defecto, aún sé poco de él"}. ${dash} Mantengo respuestas simples por defecto, las cifras no cambian por personalización, y puede ajustar o resetear esto cuando quiera. Nada de etiquetas internas ni adivinar cosas personales.`,
  };
}

async function executePersonalizationFeedback(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const aspect = ["nudge", "strictness", "detail", "dashboard", "tone"].includes(args.aspect as string) ? (args.aspect as string) : null;
  const sentiment = ["too_much", "too_little", "good", "annoying", "useful"].includes(args.sentiment as string) ? (args.sentiment as string) : null;
  if (!aspect || !sentiment) return { status: "needs_info", summary: "¿Sobre qué es el feedback (recordatorio, exigencia, detalle, dashboard, tono) y qué sentiste?" };
  await logPreferenceEvent(ctx.userId, `${aspect}_feedback`, sentiment, "chat");
  // Apply the obvious preference change when the feedback is unambiguous.
  // STRICTNESS routes to the ambition_mode lever (the joy-vs-goals allocation
  // posture), NEVER to the explicitly-declared financial philosophy — one weak
  // complaint must not rewrite the user's core life identity, flip their dashboard
  // orientation, or change framing. effectiveAmbition = explicit ambition ??
  // philosophy-derived, so an explicit ambition correctly takes precedence.
  let applied = "";
  if (aspect === "nudge" && (sentiment === "annoying" || sentiment === "too_much")) { await setPersonalizationPref(ctx.userId, { nudgeSensitivity: "high" }); applied = " Te aviso solo lo importante."; }
  else if (aspect === "nudge" && (sentiment === "useful" || sentiment === "good")) { await setPersonalizationPref(ctx.userId, { nudgeSensitivity: "normal" }); applied = " Mantengo este tipo de avisos."; }
  else if (aspect === "detail" && sentiment === "too_much") { await setCommunicationPref(ctx.userId, { detailLevel: "short" }); applied = " Acorto el detalle por defecto."; }
  else if (aspect === "detail" && sentiment === "too_little") { await setCommunicationPref(ctx.userId, { detailLevel: "detailed" }); applied = " Doy más detalle cuando profundices."; }
  else if (aspect === "strictness" && sentiment === "too_much") { await setGoalPrefs(ctx.userId, { ambitionMode: "light_touch" }); applied = " Aflojo el ritmo, priorizo que disfrutes sin presión."; }
  else if (aspect === "strictness" && sentiment === "too_little") { await setGoalPrefs(ctx.userId, { ambitionMode: "power_builder" }); applied = " Te empujo un poco más con tus metas."; }
  else if (aspect === "dashboard" && sentiment === "too_much") { await setPersonalizationPref(ctx.userId, { dashboardDensity: "minimal" }); applied = " Dejo el dashboard más limpio, solo lo esencial."; }
  else if (aspect === "dashboard" && sentiment === "too_little") { await setPersonalizationPref(ctx.userId, { dashboardDensity: "rich" }); applied = " Te muestro más detalle en el dashboard."; }
  ctx.dirty = true;
  return { status: "done", summary: `Gracias, lo tomo en cuenta y lo ajusto.${applied} Agradécelo breve y sin culpa; el feedback explícito manda sobre lo que yo infiera. Nunca cambio tu verdad financiera ni tus mínimos por esto.` };
}

async function executeResetPersonalization(ctx: AgentContext): Promise<ToolResult> {
  const ok = await resetPersonalization(ctx.userId);
  await logPreferenceEvent(ctx.userId, "reset", null);
  if (!ok) return { status: "done", summary: "No pude resetear ahora; ofrécele reintentar." };
  ctx.dirty = true;
  // Honest scope: reset clears user_personalization (filosofía + preferencias de
  // uso) y el contexto de vida declarado. NO toca tono/detalle (coach_preferences)
  // ni riesgo/ambición (user_financial_preferences) ni datos/metas — esos se ajustan
  // con sus propias herramientas. La copia debe decir solo lo que de verdad se borró.
  return { status: "done", summary: `Listo, reinicié a neutral tu filosofía, tus preferencias de uso (recordatorios, densidad del dashboard, modo) y olvidé el contexto que me contaste. Tu tono, nivel de detalle, postura de riesgo, datos y metas siguen como están — esos los cambias con sus propios ajustes cuando quieras. Confírmalo breve.` };
}

// Register a NEW card/debt from chat (e.g. a statement for an unregistered card),
// only after the user confirms. The created card is pushed into the live context
// so the SAME turn can update its obligations and import its movements by id —
// no FX is invented (base balance only set when the card is in the base currency).
async function executeCreateCard(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) return { status: "needs_info", summary: "¿Cómo se llama la tarjeta o deuda que agrego?" };
  // Idempotency: never create a SECOND card for one the user already has — a
  // resumable statement can drive create_card from two paths (chat answer +
  // re-upload). Reuse an existing card whose name matches (the live context is
  // reloaded each turn, so a card committed by a prior run is visible here).
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
  const want = norm(name);
  const already = ctx.debtAccounts.find((d) => {
    const n = norm(d.name);
    return n === want || n.includes(want) || want.includes(n);
  });
  if (already) {
    return {
      status: "done",
      summary: `Ya tienes esa tarjeta ("${already.name}", id=${already.id}); uso ESA, no creo otra. Sigue con sus obligaciones y consumos.`,
      data: { id: already.id, name: already.name, currency: already.currency },
    };
  }
  const type = ["credit_card", "loan", "family_debt", "other_debt"].includes(args.kind as string)
    ? (args.kind as string)
    : "credit_card";
  const explicit =
    typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? (args.currency.trim().toUpperCase() as CurrencyCode)
      : undefined;
  const currency = explicit ?? ctx.baseCurrency;
  const money = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? toCents(n) : undefined;
  };
  const day = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : undefined;
  };
  const balance = money(args.currentBalance) ?? 0;
  const sameCur = currency === ctx.baseCurrency;
  const minimum = money(args.minimumPayment);
  const fullDue = money(args.totalDueThisMonth);
  const dueDay = day(args.dueDay);
  const cutoffDay = day(args.cutoffDay);
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("debt_accounts")
      .insert({
        user_id: ctx.userId,
        name,
        type,
        currency,
        current_balance_original: balance,
        current_balance_base: sameCur ? balance : 0,
        minimum_payment: minimum ?? null,
        full_payment_due: fullDue ?? null,
        due_day: dueDay ?? null,
        cutoff_day: cutoffDay ?? null,
      })
      .select("id")
      .single();
    if (error || !data) return { status: "error", summary: error?.message ?? "No pude crear la tarjeta." };
    const id = data.id as string;
    // Make it usable THIS turn (obligations + imports) without a stale-context miss.
    ctx.debtAccounts.push({
      id,
      userId: ctx.userId,
      name,
      type: type as DebtAccount["type"],
      currency,
      currentBalanceOriginal: balance,
      currentBalanceBase: sameCur ? balance : 0,
      minimumPayment: minimum,
      fullPaymentDue: fullDue,
      dueDay,
      cutoffDay,
      createdAt: new Date().toISOString(),
    } as DebtAccount);
    const note = !sameCur
      ? ` Está en ${currency} (≠ tu base ${ctx.baseCurrency}); su equivalente en base se ajusta con el tipo de cambio real, no inventado.`
      : "";
    return {
      status: "done",
      summary: `Creé la tarjeta "${name}" (id=${id}, ${currency})${balance ? `, saldo ${balance} ${currency}` : ""}. Ahora usa ESE id para update_card_obligations y para registrar los consumos/pagos del estado.${note}`,
      data: { id, name, currency },
    };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "create_card failed" };
  }
}

// Register a NEW account / payment method from chat (e.g. the source account of a
// statement payment the user wants to add), only after the user confirms. Pushed
// into the live context so the SAME turn can use it as a source. Idempotent by
// name (reuses an existing account instead of creating a duplicate).
async function executeCreateAccount(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) return { status: "needs_info", summary: "¿Cómo se llama la cuenta que agrego?" };
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
  const want = norm(name);
  const already = ctx.accounts.find((a) => {
    const n = norm(a.name);
    return n === want || n.includes(want) || want.includes(n);
  });
  if (already) {
    return {
      status: "done",
      summary: `Ya tienes esa cuenta ("${already.name}", id=${already.id}); uso ESA, no creo otra.`,
      data: { id: already.id, name: already.name, currency: already.currency },
    };
  }
  const type = ["bank", "cash", "wallet"].includes(args.kind as string) ? (args.kind as string) : "bank";
  const explicit =
    typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? (args.currency.trim().toUpperCase() as CurrencyCode)
      : undefined;
  const currency = explicit ?? ctx.baseCurrency;
  const n = Number(args.currentBalance);
  const balance = Number.isFinite(n) && n >= 0 ? toCents(n) : 0;
  const sameCur = currency === ctx.baseCurrency;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("accounts")
      .insert({
        user_id: ctx.userId,
        name,
        type,
        currency,
        current_balance_original: balance,
        current_balance_base: sameCur ? balance : 0,
        is_goal_account: false,
        liquidity: "liquid",
      })
      .select("id")
      .single();
    if (error || !data) return { status: "error", summary: error?.message ?? "No pude crear la cuenta." };
    const id = data.id as string;
    ctx.accounts.push({
      id,
      userId: ctx.userId,
      name,
      type: type as Account["type"],
      currency,
      currentBalanceOriginal: balance,
      currentBalanceBase: sameCur ? balance : 0,
      isGoalAccount: false,
      createdAt: new Date().toISOString(),
    } as Account);
    return {
      status: "done",
      summary: `Creé la cuenta "${name}" (id=${id}, ${currency})${balance ? `, saldo ${balance} ${currency}` : ""}. Ya puedes usarla como origen de un pago en este mismo turno.`,
      data: { id, name, currency },
    };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "create_account failed" };
  }
}

async function executeTransfer(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { status: "needs_info", summary: "Transfer needs a valid amount." };
  const source = ctx.accounts.find((a) => a.id === args.sourceAccountId);
  const destination = ctx.accounts.find((a) => a.id === args.destinationAccountId);
  if (!source || !destination) return { status: "needs_info", summary: "Transfer needs a known source and destination account." };
  if (source.id === destination.id) return { status: "refused", summary: "Source and destination are the same account." };
  // A cross-currency transfer needs a trusted rate; don't treat it as an
  // equal-amount move between different currencies.
  if (source.currency !== destination.currency) {
    return { status: "needs_info", summary: `${source.name} está en ${source.currency} y ${destination.name} en ${destination.currency}: una transferencia entre monedas distintas necesita un tipo de cambio confiable. Dímelo o lo vemos aparte; aún no la registro sola.` };
  }
  const cr = resolveMovementCurrency({ instruments: [source.currency], primary: ctx.baseCurrency });
  if (!cr.ok) {
    return { status: "needs_info", summary: cr.reason === "fx_unavailable" ? `Esa transferencia está en ${cr.original}, distinta a tu moneda base ${cr.base}; necesito un tipo de cambio confiable para reflejarla. Dímelo o la vemos aparte.` : "¿En qué moneda es la transferencia?" };
  }
  try {
    const intent: TransferIntent = { type: "transfer", description: String(args.description ?? "Movimiento entre cuentas"), category: "other", originalAmount: amount, originalCurrency: cr.resolution.original, baseCurrency: cr.resolution.base, exchangeRateToBase: cr.resolution.exchangeRateToBase, confidenceScore: 0.9, status: "ready", sourceAccountId: source.id, destinationAccountId: destination.id };
    await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId, dedupeKey: dedupeKeyFor(ctx, { type: "transfer", amount, currency: cr.resolution.original, sourceAccountId: source.id, destinationAccountId: destination.id }) });
    return { status: "done", summary: `Transferred ${amount} from ${source.name} to ${destination.name} (not spending/income).` };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "transfer failed" };
  }
}

async function executeListRecent(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
  const recent = await loadRecentTransactions(ctx.userId, { limit: limit + 10 });
  const items = recent.transactions
    .filter((t) => t.type !== "reversal" && t.type !== "adjustment")
    .slice(0, limit)
    .map((t, i) => ({
      ref: i + 1,
      id: t.id,
      type: t.type,
      description: t.description,
      amount: t.originalAmount,
      currency: t.originalCurrency,
      source: sourceLabel(t, ctx.accounts, ctx.debtAccounts),
      when: t.occurredAt,
      reversed: recent.reversedOriginalIds.has(t.id),
    }));
  if (items.length === 0) {
    return { status: "done", summary: "Sin movimientos recientes." };
  }
  const lines = items
    .map(
      (it) =>
        `${it.ref}. id=${it.id} | ${it.description} ${money(it.amount, it.currency)} | ${it.source} | ${it.type}${it.reversed ? " | YA REVERTIDO" : ""}`,
    )
    .join("\n");
  return {
    status: "done",
    summary: `Movimientos recientes (más nuevo primero). Usa el id exacto para undo_movement/correct_movement:\n${lines}`,
    data: items,
  };
}

async function executeUndoMovement(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const recent = await loadRecentTransactions(ctx.userId);

  if (typeof args.transactionId === "string" && args.transactionId) {
    const tx = recent.transactions.find((t) => t.id === args.transactionId);
    if (!tx) {
      return { status: "needs_info", summary: "No encuentro ese id; vuelve a llamar list_recent_movements." };
    }
    if (!isUndoEligible(tx, recent.reversedOriginalIds)) {
      return { status: "done", summary: `Ese movimiento (${tx.description} ${money(tx.originalAmount, tx.originalCurrency)}) ya estaba revertido o no se puede revertir; nada cambió.` };
    }
    try {
      const r = await reverseStoredTransaction({ userId: ctx.userId, transaction: tx, message: ctx.rawMessage, channel: ctx.channel });
      return { status: "done", summary: r.alreadyReversed ? "Ya estaba revertido; nada cambió." : `Revertí ${tx.description} ${money(tx.originalAmount, tx.originalCurrency)} (${sourceLabel(tx, ctx.accounts, ctx.debtAccounts)}); saldo restaurado.` };
    } catch (error) {
      return { status: "error", summary: error instanceof Error ? error.message : "undo failed" };
    }
  }

  const found = findUndoTarget(recent, typeof args.hint === "string" ? args.hint : "");
  if (found.status === "none") {
    return { status: "needs_info", summary: "No hay un movimiento reciente elegible para deshacer." };
  }
  if (found.status === "ambiguous" && found.candidates) {
    const cands = found.candidates.map((t) => ({ id: t.id, description: t.description, amount: t.originalAmount, currency: t.originalCurrency, source: sourceLabel(t, ctx.accounts, ctx.debtAccounts) }));
    return {
      status: "needs_info",
      summary: `Varias coincidencias para esa pista. NO repitas la pista: muéstrale estas opciones (por su fuente) y luego llama undo_movement con el id exacto. Candidatos: ${cands.map((c) => `id=${c.id} ${c.description} ${money(c.amount, c.currency)} (${c.source})`).join("; ")}`,
      data: cands,
    };
  }
  if (!found.target) return { status: "error", summary: "No pude resolver el movimiento." };
  try {
    const r = await reverseStoredTransaction({ userId: ctx.userId, transaction: found.target, message: ctx.rawMessage, channel: ctx.channel });
    return { status: "done", summary: r.alreadyReversed ? "Ya estaba revertido; nada cambió." : `Revertí ${found.target.description} ${money(found.target.originalAmount, found.target.originalCurrency)}; saldo restaurado.` };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "undo failed" };
  }
}

async function executeUndoRecent(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const count = Math.min(Math.max(Number(args.count) || 1, 1), 10);
  const recent = await loadRecentTransactions(ctx.userId);
  const eligible = recent.transactions
    .filter((t) => isUndoEligible(t, recent.reversedOriginalIds))
    .slice(0, count);
  if (eligible.length === 0) {
    return { status: "needs_info", summary: "No hay movimientos recientes elegibles para deshacer." };
  }
  const done: string[] = [];
  for (const tx of eligible) {
    try {
      const r = await reverseStoredTransaction({ userId: ctx.userId, transaction: tx, message: ctx.rawMessage, channel: ctx.channel });
      if (r.ok || r.alreadyReversed) done.push(`${tx.description} ${money(tx.originalAmount, tx.originalCurrency)}`);
    } catch {
      // skip the one that failed; report the rest
    }
  }
  return { status: "done", summary: `Revertí ${done.length} movimiento(s): ${done.join(", ")}. Saldos restaurados.`, data: { count: done.length } };
}

async function executeRemoveDuplicate(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const recent = await loadRecentTransactions(ctx.userId);

  // Exact id given → reverse that copy (idempotent).
  if (typeof args.transactionId === "string" && args.transactionId) {
    const tx = recent.transactions.find((t) => t.id === args.transactionId);
    if (!tx) return { status: "needs_info", summary: "No encuentro ese id; llama list_recent_movements." };
    if (!isUndoEligible(tx, recent.reversedOriginalIds)) {
      return { status: "done", summary: "Esa copia ya estaba quitada; queda una sola." };
    }
    try {
      await reverseStoredTransaction({ userId: ctx.userId, transaction: tx, message: ctx.rawMessage, channel: ctx.channel });
      return { status: "done", summary: `Quité la copia repetida de ${tx.description} ${money(tx.originalAmount, tx.originalCurrency)} y dejé una.` };
    } catch (error) {
      return { status: "error", summary: error instanceof Error ? error.message : "remove_duplicate failed" };
    }
  }

  const dup = findDuplicateCandidates(recent);
  if (dup.status === "none") {
    return { status: "needs_info", summary: "No veo dos movimientos iguales recientes. ¿Cuál era el repetido? (puedo listar los recientes)." };
  }
  if (dup.status === "ambiguous" && dup.pairs) {
    return {
      status: "needs_info",
      summary: `Hay varios pares parecidos. Muéstrale las opciones y quita por id. Pares: ${dup.pairs.map((p) => `quitar id=${p.remove.id} (${p.remove.description} ${money(p.remove.originalAmount, p.remove.originalCurrency)})`).join("; ")}`,
      data: dup.pairs,
    };
  }
  if (!dup.remove) return { status: "error", summary: "No pude resolver el duplicado." };
  try {
    const r = await reverseStoredTransaction({ userId: ctx.userId, transaction: dup.remove, message: ctx.rawMessage, channel: ctx.channel });
    return { status: "done", summary: r.alreadyReversed ? "Esa copia ya estaba quitada; queda una sola." : `Quité la copia repetida de ${dup.remove.description} ${money(dup.remove.originalAmount, dup.remove.originalCurrency)} y dejé una. Tu saldo ya no la cuenta dos veces.` };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "remove_duplicate failed" };
  }
}

async function executeCorrectMovement(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const id = typeof args.transactionId === "string" ? args.transactionId : "";
  if (!id) return { status: "needs_info", summary: "Falta el id; llama list_recent_movements." };
  const recent = await loadRecentTransactions(ctx.userId);
  const tx = recent.transactions.find((t) => t.id === id);
  if (!tx) return { status: "needs_info", summary: "No encuentro ese id; vuelve a listar los recientes." };
  if (!isUndoEligible(tx, recent.reversedOriginalIds)) {
    return { status: "refused", summary: "Ese movimiento ya fue revertido; no se puede corregir." };
  }

  const newAmount = Number.isFinite(Number(args.newAmount)) && Number(args.newAmount) > 0 ? Number(args.newAmount) : undefined;
  const account = ctx.accounts.find((a) => a.id === args.newSourceAccountId);
  const debt = ctx.debtAccounts.find((d) => d.id === args.newDebtAccountId);
  const newCategory = typeof args.newCategory === "string" && VALID_CATEGORIES.has(args.newCategory as FinancialCategory) ? (args.newCategory as FinancialCategory) : undefined;
  const newDescription = typeof args.newDescription === "string" && args.newDescription.trim() ? args.newDescription.trim() : undefined;

  const balanceChange = newAmount !== undefined || account || debt;

  try {
    if (!balanceChange) {
      if (!newCategory && !newDescription) {
        return { status: "needs_info", summary: "Dime qué corregir: monto, cuenta, categoría o descripción." };
      }
      await correctTransactionMetadata({ userId: ctx.userId, transactionId: id, category: newCategory, description: newDescription });
      return { status: "done", summary: `Corregí ${newCategory ? `la categoría a ${newCategory}` : "la nota"} de ${tx.description}; el saldo no cambia.` };
    }
    const corrected = buildAgentCorrectedIntent(tx, { newAmount, account, debt, newCategory, newDescription }, ctx.accounts);
    if (!corrected) {
      return { status: "needs_info", summary: "No puedo corregir ese movimiento con esos datos; pídele al usuario una sola precisión (monto o cuenta)." };
    }
    await correctTransactionByReplacement({ userId: ctx.userId, original: tx, correctedIntent: corrected, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, message: ctx.rawMessage, channel: ctx.channel, chatId: ctx.chatId });
    return { status: "done", summary: `Corregí ${tx.description}: ${newAmount ? `ahora ${money(newAmount, tx.originalCurrency)}` : ""}${account ? ` ahora desde ${account.name}` : debt ? ` ahora con ${debt.name}` : ""}. Ajusté los saldos.` };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "correct failed" };
  }
}

async function executePersonPayment(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { status: "needs_info", summary: "Falta el monto." };
  const direction = args.direction === "in" ? "in" : "out";
  const person = typeof args.person === "string" ? args.person.trim() : "";
  const account = ctx.accounts.find((a) => a.id === args.accountId);
  const debt = ctx.debtAccounts.find((d) => d.id === args.debtAccountId);
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";

  try {
    if (direction === "out") {
      if (!account && !debt) return { status: "needs_info", summary: "¿De qué cuenta o tarjeta salió?" };
      const isLoan = args.isLoan === true;
      // A card payment is denominated in the CARD currency, not the (absent) cash
      // account's — resolved deterministically (instrument → primary), with no
      // invented USD and no fabricated rate.
      const cr = resolveMovementCurrency({ instruments: [account?.currency, debt?.currency], primary: ctx.baseCurrency });
      if (!cr.ok) return { status: "needs_info", summary: cr.reason === "fx_unavailable" ? `Ese movimiento está en ${cr.original}, distinta a tu moneda base ${cr.base}; necesito un tipo de cambio confiable. Dímelo o lo vemos aparte.` : "¿En qué moneda fue? No pude derivarla de la cuenta/tarjeta." };
      const currency = cr.resolution.original;
      const who = person ? ` a ${person}` : "";
      const intent: ExpenseIntent = {
        type: "expense",
        description: isLoan ? `Préstamo${who}${reason ? ` (${reason})` : ""}` : `${reason || "transferencia"}${who}`,
        category: isLoan ? "other" : category(args.category, "other"),
        originalAmount: amount,
        originalCurrency: currency,
        baseCurrency: cr.resolution.base,
        exchangeRateToBase: cr.resolution.exchangeRateToBase,
        confidenceScore: 0.9,
        status: "ready",
        sourceAccountId: account?.id,
        debtAccountId: debt?.id,
      };
      await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId, dedupeKey: dedupeKeyFor(ctx, { type: "expense", amount, currency, sourceAccountId: account?.id, debtAccountId: debt?.id }) });
      if (isLoan) {
        // Two non-atomic writes: the outflow (ledger) already committed. If the
        // receivable insert fails, be HONEST — never claim "te lo deben" when no
        // receivable exists. The money movement stands; only the loan-tracking
        // note couldn't be saved.
        const receivable = await createReceivable({ userId: ctx.userId, counterparty: person || "alguien", direction: "owed_to_user", amount, currency, reason: reason || undefined });
        if (!receivable) {
          return { status: "done", summary: `Registré que salieron ${money(amount, currency)}${who} desde ${account?.name ?? debt?.name}, pero NO pude guardar el recordatorio de que te lo deben. Dile al usuario que el gasto quedó pero que vuelva a decírtelo para anotar el préstamo, o anótalo luego. No afirmes que ya lo tienes como dinero que te deben.` };
        }
        return { status: "done", summary: `Registré préstamo ${money(amount, currency)}${who} y lo guardé como dinero que te deben.` };
      }
      return { status: "done", summary: `Registré ${money(amount, currency)}${who} como gasto desde ${account?.name ?? debt?.name}.` };
    }
    // direction === "in"
    if (!account) return { status: "needs_info", summary: "¿A qué cuenta te llegó?" };
    const inflowKind = args.inflowKind === "refund" || args.inflowKind === "loan_repayment" ? args.inflowKind : "income";
    const crIn = resolveMovementCurrency({ instruments: [account.currency], primary: ctx.baseCurrency });
    if (!crIn.ok) return { status: "needs_info", summary: crIn.reason === "fx_unavailable" ? `Ese ingreso está en ${crIn.original}, distinta a tu moneda base ${crIn.base}; necesito un tipo de cambio confiable. Dímelo o lo vemos aparte.` : "¿En qué moneda te llegó?" };
    const currency = crIn.resolution.original;
    const who = person ? ` de ${person}` : "";
    if (inflowKind === "refund") {
      const intent: RefundIntent = { type: "refund", description: `Reembolso${who}${reason ? ` (${reason})` : ""}`, originalAmount: amount, originalCurrency: currency, baseCurrency: crIn.resolution.base, exchangeRateToBase: crIn.resolution.exchangeRateToBase, confidenceScore: 0.9, status: "ready", destinationAccountId: account.id, category: category(args.category, "other") };
      await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId, dedupeKey: dedupeKeyFor(ctx, { type: "refund", amount, currency, destinationAccountId: account.id }) });
      return { status: "done", summary: `Registré reembolso ${money(amount, currency)}${who} a ${account.name} (no lo cuento como ingreso nuevo).` };
    }
    const intent: IncomeIntent = { type: "income", description: inflowKind === "loan_repayment" ? `Devolución de préstamo${who}` : `Ingreso${who}${reason ? ` (${reason})` : ""}`, originalAmount: amount, originalCurrency: currency, baseCurrency: crIn.resolution.base, exchangeRateToBase: crIn.resolution.exchangeRateToBase, confidenceScore: 0.9, status: "ready", destinationAccountId: account.id, category: "income" };
    await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId, dedupeKey: dedupeKeyFor(ctx, { type: "income", amount, currency, destinationAccountId: account.id }) });
    if (inflowKind === "loan_repayment") {
      const { matched } = await applyReceivableRepayment({ userId: ctx.userId, counterparty: person || null, amount });
      return { status: "done", summary: `Registré la devolución de ${money(amount, currency)}${who}${matched > 0 ? " y la descontué de lo que te debían" : ""}.` };
    }
    return { status: "done", summary: `Registré ingreso ${money(amount, currency)}${who} a ${account.name}.` };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "person_payment failed" };
  }
}

async function executeCreateFixed(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const amount = Number(args.amount);
  if (!name) return { status: "needs_info", summary: "¿De qué es el gasto fijo?" };
  if (!Number.isFinite(amount) || amount <= 0) return { status: "needs_info", summary: "¿De cuánto es?" };

  const similar = await findSimilarFixedExpenses({ userId: ctx.userId, name });
  if (similar.length > 0) {
    return { status: "needs_info", summary: `Ya existe un gasto fijo parecido: id=${similar[0].id} ${similar[0].name} ${money(similar[0].amount, similar[0].currency)}. Pregúntale si actualizar ese (update_fixed_expense) o crear uno nuevo.`, data: similar };
  }

  const frequency: PaymentFrequency = (["weekly", "biweekly", "monthly", "yearly"].includes(args.frequency as string) ? args.frequency : "monthly") as PaymentFrequency;
  const account = ctx.accounts.find((a) => a.id === args.sourceAccountId);
  const startDate = typeof args.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.startDate) ? args.startDate : null;
  // The commitment is denominated in its source account's currency, or — when no
  // source is given — the user's base currency. Never a blind USD.
  const currency = account ? accountCurrency(account) : ctx.baseCurrency;
  const created = await createFixedExpense({ userId: ctx.userId, name, amount, currency, category: category(args.category, "other"), frequency, startDate, paymentSourceType: account ? "account" : undefined, paymentSourceId: account?.id });
  if (!created) return { status: "error", summary: "No pude guardar el gasto fijo." };

  if (args.payNow === true && !startDate && account) {
    // FX safety: only register today's payment when it is in the user's base
    // currency (real rate 1). A foreign-currency payment needs a trusted rate.
    if (currency !== ctx.baseCurrency) {
      return { status: "done", summary: `Creé el gasto fijo ${name} (${money(amount, currency)} ${frequency}). No registré el pago de hoy porque está en ${currency} (≠ tu moneda base ${ctx.baseCurrency}) y necesito un tipo de cambio confiable — dime el equivalente en ${ctx.baseCurrency} si quieres registrarlo.` };
    }
    const intent: ExpenseIntent = { type: "expense", description: name, category: category(args.category, "other"), originalAmount: amount, originalCurrency: currency, baseCurrency: ctx.baseCurrency, exchangeRateToBase: 1, confidenceScore: 0.9, status: "ready", sourceAccountId: account.id };
    await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, recurringExpenseId: created.id, fixedExpenseName: name, channel: ctx.channel, chatId: ctx.chatId, dedupeKey: dedupeKeyFor(ctx, { type: "expense", amount, currency, sourceAccountId: account.id }) });
    return { status: "done", summary: `Creé el gasto fijo ${name} (${money(amount, currency)} ${frequency}) y registré el pago de hoy.` };
  }
  return { status: "done", summary: `Creé el gasto fijo ${name} (${money(amount, currency)} ${frequency})${startDate ? `, empieza el ${startDate}` : ""}. No registro un pago hoy.` };
}

async function executeUpdateFixed(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const id = typeof args.fixedExpenseId === "string" ? args.fixedExpenseId : "";
  if (!id) return { status: "needs_info", summary: "Falta el id del gasto fijo." };
  const newAmount = Number.isFinite(Number(args.newAmount)) && Number(args.newAmount) > 0 ? Number(args.newAmount) : undefined;
  const startDate = typeof args.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.startDate) ? args.startDate : undefined;
  if (newAmount === undefined && startDate === undefined) {
    return { status: "needs_info", summary: "¿A cuánto queda o desde cuándo?" };
  }
  const ok = await updateFixedExpenseFields({ userId: ctx.userId, id, amount: newAmount, startDate });
  if (!ok) return { status: "error", summary: "No pude actualizar el gasto fijo." };

  const account = ctx.accounts.find((a) => a.id === args.sourceAccountId);
  const currency = account ? accountCurrency(account) : ctx.baseCurrency;
  // A future start date means: keep/update the recurring definition, do NOT
  // charge today — and CONFIRM the future timing back to the user.
  const startText = startDate ? ` Empieza el ${startDate}` : "";
  if (args.payNow === true && !startDate && newAmount !== undefined && account) {
    if (currency !== ctx.baseCurrency) {
      return { status: "done", summary: `Dejé el gasto fijo en ${money(newAmount, currency)} de ahora en adelante. No registré el pago de hoy porque está en ${currency} (≠ tu moneda base ${ctx.baseCurrency}) y necesito un tipo de cambio confiable.` };
    }
    const intent: ExpenseIntent = { type: "expense", description: "Gasto fijo", category: "other", originalAmount: newAmount, originalCurrency: currency, baseCurrency: ctx.baseCurrency, exchangeRateToBase: 1, confidenceScore: 0.9, status: "ready", sourceAccountId: account.id };
    await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, recurringExpenseId: id, channel: ctx.channel, chatId: ctx.chatId, dedupeKey: dedupeKeyFor(ctx, { type: "expense", amount: newAmount, currency, sourceAccountId: account.id }) });
    return { status: "done", summary: `Dejé el gasto fijo en ${money(newAmount, currency)} de ahora en adelante y registré el pago de hoy.` };
  }
  const amountText = newAmount !== undefined ? `en ${money(newAmount, currency)}` : "igual";
  return { status: "done", summary: `Dejé el gasto fijo ${amountText}${startText}. No registré ningún pago hoy. CONFIRMA al usuario el monto y, si hay, la fecha de inicio.` };
}

async function executeSchedule(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const dueDate = typeof args.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.dueDate) ? args.dueDate : "";
  if (!name) return { status: "needs_info", summary: "¿Qué pago futuro recuerdo?" };
  if (!dueDate) return { status: "needs_info", summary: "¿Para qué fecha?" };
  const amount = Number.isFinite(Number(args.amount)) && Number(args.amount) > 0 ? Number(args.amount) : null;
  const recurring = args.recurring === true;

  // A scheduled/recurring commitment is denominated in the user's base currency
  // (no source movement yet), never a blind USD.
  const currency = ctx.baseCurrency;
  if (recurring) {
    const created = await createFixedExpense({ userId: ctx.userId, name, amount: amount ?? 0, currency, category: category(args.category, "other"), frequency: "monthly", startDate: dueDate });
    if (!created) return { status: "error", summary: "No pude guardar el gasto futuro." };
    return { status: "done", summary: `Anotado: ${name}${amount ? ` ${money(amount, currency)}` : ""} mensual, empieza el ${dueDate}. No lo cuento hasta que arranque.` };
  }
  const created = await createScheduledPayment({ userId: ctx.userId, name, amount, currency, category: category(args.category, "other"), dueDate, recurring: false, rawInput: ctx.rawMessage });
  if (!created) return { status: "error", summary: "No pude guardar el recordatorio." };
  return { status: "done", summary: `Listo, te recuerdo ${name}${amount ? ` por ${money(amount, currency)}` : ""} el ${dueDate}. No lo registro como gasto hasta que lo pagues.` };
}

async function executeSetAccountLiquidity(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const accountId = typeof args.accountId === "string" ? args.accountId : "";
  const liquidity = args.liquidity === "non_liquid" ? "non_liquid" : "liquid";
  const acct = ctx.accounts.find((a) => a.id === accountId);
  if (!acct) return { status: "needs_info", summary: "No reconozco esa cuenta; pregúntale cuál es." };
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("accounts")
      .update({ liquidity })
      .eq("id", accountId)
      .eq("user_id", ctx.userId);
    if (error) return { status: "error", summary: error.message };
    return {
      status: "done",
      summary:
        liquidity === "non_liquid"
          ? `${acct.name} marcada como ahorro/inversión: ya NO la cuento como disponible para gastar esta semana, solo la menciono aparte.`
          : `${acct.name} marcada como cuenta para gastar (líquida).`,
    };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "set_account_liquidity failed" };
  }
}

async function executeReconcileBalance(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const accountId = typeof args.accountId === "string" ? args.accountId : "";
  const realBalance = Number(args.realBalance);
  const account = ctx.accounts.find((a) => a.id === accountId);
  if (!account) return { status: "needs_info", summary: "¿Cuál de las cuentas es la que ves distinta?" };
  if (!Number.isFinite(realBalance) || realBalance < 0) {
    return { status: "needs_info", summary: "¿Cuál es el saldo real que ves en esa cuenta?" };
  }
  try {
    // Monotonic per-turn sequence: the 1st reconcile uses seq 1, the 2nd seq 2,
    // etc. — so two reconciliations in one turn cannot collide on the same op id.
    // The counter resets per agent run, so a retry of the whole delivery
    // reproduces the same seq assignments (durable idempotency).
    ctx.reconcileSeq ??= { n: 0 };
    const seq = (ctx.reconcileSeq.n += 1);
    const r = await reconcileAccountBalance({
      userId: ctx.userId,
      account,
      targetBalanceBase: realBalance,
      message: ctx.rawMessage,
      channel: ctx.channel,
      // Stable per-turn reconcile op id → a channel retry reuses it and the
      // durable idempotency (migration 020) returns the original result.
      operationId: reconcileOperationId(ctx.operationId, seq),
    });
    if (r.alreadyMatched) {
      return { status: "done", summary: `${account.name} ya estaba en ${money(realBalance, account.currency)}; no hubo que ajustar nada.` };
    }
    const dir = r.delta > 0 ? "faltaba sumar" : "sobraba";
    return {
      status: "done",
      summary: `Ajusté ${account.name} a ${money(r.newBalanceBase, account.currency)} (${dir} ${money(Math.abs(r.delta), account.currency)}). Lo registré como AJUSTE de cuadre, no como ingreso. Confírmaselo así.`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "reconcile failed";
    if (/KIPU_FX_REQUIRED/.test(msg)) {
      return {
        status: "needs_info",
        summary: `Esa cuenta (${account.name}) está en una moneda distinta a tu moneda base; todavía no puedo cuadrarla sin un tipo de cambio confiable. Dímelo en tu moneda base o lo vemos aparte.`,
      };
    }
    return { status: "error", summary: msg };
  }
}

async function executeSetSavingsPlan(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const pick = (v: unknown): number | undefined =>
    Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
  const monthlySavings = pick(args.monthlySavings);
  const monthlyInvestment = pick(args.monthlyInvestment);
  const essentialMonthlyEstimate = pick(args.essentialMonthlyEstimate);
  if (monthlySavings === undefined && monthlyInvestment === undefined && essentialMonthlyEstimate === undefined) {
    return { status: "needs_info", summary: "Dime cuánto ahorras/inviertes al mes o tu estimado de gastos esenciales." };
  }
  const ok = await setMargenCommitments({
    userId: ctx.userId,
    monthlySavings,
    monthlyInvestment,
    essentialMonthlyEstimate,
  });
  if (!ok) return { status: "error", summary: "No pude guardar el plan de ahorro/inversión." };
  const parts: string[] = [];
  if (monthlySavings !== undefined) parts.push(`ahorro ${money(monthlySavings, ctx.snapshot.baseCurrency)}/mes`);
  if (monthlyInvestment !== undefined) parts.push(`inversión ${money(monthlyInvestment, ctx.snapshot.baseCurrency)}/mes`);
  if (essentialMonthlyEstimate !== undefined) parts.push(`esenciales ~${money(essentialMonthlyEstimate, ctx.snapshot.baseCurrency)}/mes`);
  return {
    status: "done",
    summary: `Guardado: ${parts.join(", ")}. Ahora lo reservo antes de calcular tu Margen Kipu, así puedes gastar tranquilo sin tocar eso. (El Margen Kipu se recalcula en tu próxima consulta.)`,
  };
}

async function executeSetEngagementMode(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const mode = args.mode === "paused" || args.mode === "light" ? args.mode : "normal";
  const pauseDays = Number(args.pauseDays);
  const pausedUntil =
    mode === "paused" && Number.isFinite(pauseDays) && pauseDays > 0
      ? new Date(Date.now() + pauseDays * 86_400_000).toISOString()
      : null;
  const ok = await setEngagementMode({ userId: ctx.userId, mode, pausedUntil });
  if (!ok) return { status: "error", summary: "No pude guardar el modo." };
  const label =
    mode === "paused"
      ? "Pausé los recordatorios proactivos"
      : mode === "light"
        ? "Activé el modo ligero (mínimo y suave)"
        : "Volví al modo normal";
  return {
    status: "done",
    summary: `${label}.${pausedUntil ? " Lo reactivo cuando me digas o cuando pase ese tiempo." : ""} Sin culpa; cuando quieras retomamos.`,
  };
}

async function executeSetAmbientPreferences(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const patch: AmbientPrefPatch = {};
  const parts: string[] = [];
  const hour = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : undefined;
  };
  if (args.resume === true) {
    patch.ambientEnabled = true;
    patch.mode = "normal";
    patch.pausedUntilISO = null;
    parts.push("reactivé los recordatorios");
  } else if (args.enabled === false) {
    patch.ambientEnabled = false;
    parts.push("apagué los mensajes proactivos");
  } else if (args.enabled === true) {
    patch.ambientEnabled = true;
    parts.push("activé los mensajes proactivos");
  }
  const pauseDays = Number(args.pauseDays);
  if (Number.isFinite(pauseDays) && pauseDays > 0) {
    patch.mode = "paused";
    patch.pausedUntilISO = new Date(Date.now() + pauseDays * 86_400_000).toISOString();
    parts.push(`pausé ${Math.round(pauseDays)} día(s)`);
  }
  if (typeof args.pauseUntilISO === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.pauseUntilISO)) {
    patch.mode = "paused";
    // Anchor at midday UTC so a localized "el lunes" snooze lifts on the morning
    // of that day in LatAm timezones (UTC-3..-8), never the night before.
    patch.pausedUntilISO = `${args.pauseUntilISO}T12:00:00.000Z`;
    parts.push(`pausé hasta el ${args.pauseUntilISO}`);
  }
  const qs = hour(args.quietHoursStart);
  const qe = hour(args.quietHoursEnd);
  if (qs !== undefined) patch.quietHoursStart = qs;
  if (qe !== undefined) patch.quietHoursEnd = qe;
  if (qs !== undefined || qe !== undefined) parts.push("ajusté tus horas de silencio");
  if (["auto", "daily", "weekly", "off"].includes(args.frequency as string)) {
    patch.frequency = args.frequency as AmbientPrefPatch["frequency"];
    parts.push(`frecuencia ${args.frequency}`);
  }
  if (Array.isArray(args.weekdays)) {
    const wd = Array.from(new Set(args.weekdays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)));
    if (wd.length > 0) {
      patch.nudgeWeekdays = wd;
      if (patch.frequency === undefined) patch.frequency = "weekly";
      parts.push("días específicos de la semana");
    } else if (args.frequency === "weekly") {
      // "solo los viernes" but no day survived → ask, never silently nudge daily.
      return { status: "needs_info", summary: "¿Qué día(s) de la semana quieres que te escriba?" };
    }
  }
  const mpd = Number(args.maxPerDay);
  if (Number.isFinite(mpd) && mpd >= 0 && mpd <= 10) {
    patch.maxNudgesPerDay = Math.floor(mpd);
    parts.push(Math.floor(mpd) === 0 ? "ninguno por día" : `máximo ${Math.floor(mpd)} al día`);
  }
  if (typeof args.timezone === "string" && args.timezone.trim()) {
    const tz = args.timezone.trim().slice(0, 60);
    // Only persist a REAL IANA zone — a bad value would silently shift quiet hours.
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: tz });
      patch.timezone = tz;
    } catch {
      // ignore invalid timezone
    }
  }
  if (Object.keys(patch).length === 0) {
    return { status: "needs_info", summary: "¿Qué ajusto de los recordatorios: pausar, horario de silencio, frecuencia, o activarlos?" };
  }
  const ok = await saveAmbientPrefs(ctx.userId, patch);
  if (!ok) return { status: "error", summary: "No pude guardar tu preferencia de recordatorios." };
  return {
    status: "done",
    summary: `Ajusté tus recordatorios (${parts.join(", ") || "preferencias"}). Confírmaselo natural, sin tecnicismos, respetando lo que pidió; nada de listas de ajustes.`,
  };
}

async function executeMarkReconciled(ctx: AgentContext): Promise<ToolResult> {
  const ok = await markWeekReconciled(ctx.userId);
  return {
    status: ok ? "done" : "error",
    summary: ok ? "Semana cuadrada y confirmada." : "No pude guardar la conciliación.",
  };
}

async function executeRememberFact(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const content = String(args.content ?? "").trim();
  if (!content) return { status: "needs_info", summary: "No fact content provided." };
  const noteType = VALID_NOTE_TYPES.has(args.noteType as string) ? (args.noteType as string) : "general";
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.from("user_context_notes").insert({ user_id: ctx.userId, note_type: noteType, content: content.slice(0, 500), source: "ai", is_active: true });
    return { status: "done", summary: `Remembered (${noteType}): ${content.slice(0, 120)}` };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "remember_fact failed" };
  }
}

// READ-ONLY affordability check for a HYPOTHETICAL purchase. Computes the
// after-purchase weekly state with the deterministic advisory engine so the
// agent answers about the AFTER margin, not the current one. Writes nothing.
async function executeEvaluatePurchase(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { status: "needs_info", summary: "¿De cuánto sería esa compra?" };
  }
  // If a movement was written earlier this turn, evaluate against the FRESH
  // margin (after-write), never the stale start-of-turn snapshot.
  if (ctx.dirty && ctx.refresh) {
    await ctx.refresh();
    ctx.dirty = false;
  }
  const s = ctx.snapshot;
  const onCard = args.onCard === true;
  const itemKind = classifyAdvisoryItemKind({
    itemDescription: typeof args.itemDescription === "string" ? args.itemDescription : null,
    message: ctx.rawMessage,
  });
  const decision = evaluateAdvisoryDecision({
    amount,
    paymentMethodType: onCard ? "card" : "account",
    itemKind,
    weeklyRemaining: s.weeklyRemaining,
    dailySuggested: s.dailySuggested,
    daysRemainingInWeek: s.daysRemainingInWeek,
    debtPressureLevel: s.debtPressureLevel,
    totalDebt: s.totalDebt,
    availableCash: s.availableCash,
    suppressContributionPush: s.suppressContributionPush,
    baseCurrency: s.baseCurrency,
  });
  const before = money(decision.weeklyRemainingBefore ?? s.weeklyRemaining, s.baseCurrency);
  const after = decision.weeklyRemainingAfter != null ? money(decision.weeklyRemainingAfter, s.baseCurrency) : "—";
  const dailyAfter = decision.dailyRemainingAfter != null ? money(Math.round(decision.dailyRemainingAfter), s.baseCurrency) : "—";
  return {
    status: "done",
    summary: `HIPOTÉTICO, no registrado. Si gasta ${money(amount, s.baseCurrency)}${onCard ? " con tarjeta" : ""}: margen semanal ANTES ${before} → DESPUÉS ${after} (≈${dailyAfter}/día). Recomendación del motor: ${decision.recommendation} (severidad ${decision.severity}). Responde con el estado DESPUÉS de la compra, no el actual; no registres nada.`,
    data: decision,
  };
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  switch (name) {
    case "get_financial_context":
      return { status: "done", summary: "Context already provided in the system message; re-read it there." };
    case "get_proactive_briefing": {
      // Reflect any writes made earlier this turn, so "¿cuánto me queda?" after
      // logging shows the post-write Margen, not the start-of-turn figure.
      if (ctx.dirty && ctx.refresh) {
        await ctx.refresh();
        ctx.dirty = false;
      }
      const b = ctx.briefing;
      return {
        status: "done",
        summary: b.digest,
        data: {
          metrics: b.metrics,
          signals: b.signals,
          nextBestAction: b.nextBestAction,
          upcomingPayments: b.upcomingPayments,
          receivablesOutstanding: b.receivablesOutstanding,
          cardsDueSoon: b.cardsDueSoon,
          daysSinceLastActivity: b.daysSinceLastActivity,
        },
      };
    }
    case "evaluate_purchase":
      return executeEvaluatePurchase(args, ctx);
    case "log_movement":
      return executeLogMovement(args, ctx);
    case "log_movements_batch":
      return executeLogMovementsBatch(args, ctx);
    case "update_card_obligations":
      return executeUpdateCardObligations(args, ctx);
    case "analyze_debt_health":
      return executeAnalyzeDebtHealth(args, ctx);
    case "plan_debt_payoff":
      return executePlanDebtPayoff(args, ctx);
    case "compare_debt_vs_investment":
      return executeCompareDebtVsInvestment(args, ctx);
    case "estimate_card_interest":
      return executeEstimateCardInterest(args, ctx);
    case "cashflow_outlook":
      return executeCashflowOutlook(args, ctx);
    case "simulate_scenario":
      return executeSimulateScenario(args, ctx);
    case "plan_cashflow":
      return executePlanCashflow(args, ctx);
    case "where_did_money_go":
      return executeWhereDidMoneyGo(ctx);
    case "why_margin_changed":
      return executeWhyMarginChanged(ctx);
    case "spending_anomalies":
      return executeSpendingAnomalies(ctx);
    case "my_subscriptions":
      return executeMySubscriptions(ctx);
    case "budget_suggestion":
      return executeBudgetSuggestion(ctx);
    case "recommend_cut":
      return executeRecommendCut(ctx);
    case "learn_spending_correction":
      return executeLearnSpendingCorrection(args, ctx);
    case "evaluate_purchase_as_goal":
      return executeEvaluatePurchaseAsGoal(args, ctx);
    case "create_goal":
      return executeCreateGoal(args, ctx);
    case "create_mini_goal":
      return executeCreateMiniGoal(args, ctx);
    case "prioritize_goals":
      return executePrioritizeGoals(ctx);
    case "update_goal":
      return executeUpdateGoal(args, ctx);
    case "register_investment":
      return executeRegisterInvestment(args, ctx);
    case "net_worth":
      return executeNetWorth(ctx);
    case "set_wealth_target":
      return executeSetWealthTarget(args, ctx);
    case "set_ambition_mode":
      return executeSetAmbitionMode(args, ctx);
    case "set_financial_philosophy":
      return executeSetFinancialPhilosophy(args, ctx);
    case "get_personalization_profile":
      return executeGetPersonalizationProfile(ctx);
    case "set_communication_preference":
      return executeSetCommunicationPreference(args, ctx);
    case "set_risk_preference":
      return executeSetRiskPreference(args, ctx);
    case "set_onboarding_mode":
      return executeSetOnboardingMode(args, ctx);
    case "set_nudge_sensitivity":
      return executeSetNudgeSensitivity(args, ctx);
    case "update_life_context":
      return executeUpdateLifeContext(args, ctx);
    case "forget_life_context":
      return executeForgetLifeContext(args, ctx);
    case "explain_personalization":
      return executeExplainPersonalization(ctx);
    case "personalization_feedback":
      return executePersonalizationFeedback(args, ctx);
    case "reset_personalization_preference":
      return executeResetPersonalization(ctx);
    case "create_card":
      return executeCreateCard(args, ctx);
    case "create_account":
      return executeCreateAccount(args, ctx);
    case "transfer_between_accounts":
      return executeTransfer(args, ctx);
    case "list_recent_movements":
      return executeListRecent(args, ctx);
    case "undo_movement":
      return executeUndoMovement(args, ctx);
    case "undo_recent_movements":
      return executeUndoRecent(args, ctx);
    case "correct_movement":
      return executeCorrectMovement(args, ctx);
    case "remove_duplicate":
      return executeRemoveDuplicate(args, ctx);
    case "record_person_payment":
      return executePersonPayment(args, ctx);
    case "create_fixed_expense":
      return executeCreateFixed(args, ctx);
    case "update_fixed_expense":
      return executeUpdateFixed(args, ctx);
    case "schedule_payment":
      return executeSchedule(args, ctx);
    case "set_account_liquidity":
      return executeSetAccountLiquidity(args, ctx);
    case "reconcile_account_balance":
      return executeReconcileBalance(args, ctx);
    case "set_savings_plan":
      return executeSetSavingsPlan(args, ctx);
    case "set_ambient_preferences":
      return executeSetAmbientPreferences(args, ctx);
    case "set_engagement_mode":
      return executeSetEngagementMode(args, ctx);
    case "mark_week_reconciled":
      return executeMarkReconciled(ctx);
    case "remember_fact":
      return executeRememberFact(args, ctx);
    default:
      return { status: "refused", summary: `Unknown tool: ${name}` };
  }
}
