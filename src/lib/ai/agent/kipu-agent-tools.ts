import type OpenAI from "openai";
import {
  applyChatTransactionIntent,
  correctTransactionByReplacement,
  correctTransactionMetadata,
  reverseStoredTransaction,
} from "@/lib/ai/apply-chat-transaction-intent";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import {
  applyReceivableRepayment,
  createFixedExpense,
  createReceivable,
  createScheduledPayment,
  findSimilarFixedExpenses,
  updateFixedExpenseAmount,
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
  channel?: ChatChannel;
  chatId?: string | null;
  rawMessage: string;
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
        },
        required: ["type", "amount", "description"],
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
      name: "update_fixed_expense",
      description:
        "Permanently change the amount of an existing fixed expense going forward (find the id via list/context). Set payNow=true to also log today's payment at the new amount.",
      parameters: {
        type: "object",
        properties: {
          fixedExpenseId: { type: "string" },
          newAmount: { type: "number" },
          payNow: { type: "boolean" },
          sourceAccountId: { type: "string" },
        },
        required: ["fixedExpenseId", "newAmount"],
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

function accountCurrency(account?: Account): CurrencyCode {
  return (account?.currency as CurrencyCode) ?? "USD";
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

async function executeLogMovement(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const type = args.type as string;
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { status: "needs_info", summary: "Missing or invalid amount." };
  }
  const description = String(args.description ?? "").trim() || "Movimiento";
  const sourceAccount = ctx.accounts.find((a) => a.id === args.sourceAccountId);
  const debtAccount = ctx.debtAccounts.find((d) => d.id === args.debtAccountId);
  const destAccount = ctx.accounts.find((a) => a.id === args.destinationAccountId);
  const goal = ctx.goals.find((g) => g.id === args.goalId);

  try {
    if (type === "expense") {
      if (!sourceAccount && !debtAccount) {
        return { status: "needs_info", summary: "Expense needs a source account or card." };
      }
      const intent: ExpenseIntent = {
        type: "expense",
        description,
        category: category(args.category, "other"),
        originalAmount: amount,
        originalCurrency: accountCurrency(sourceAccount),
        confidenceScore: 0.9,
        status: "ready",
        sourceAccountId: sourceAccount?.id,
        debtAccountId: debtAccount?.id,
      };
      const fixedExpenseId =
        typeof args.fixedExpenseId === "string" && args.fixedExpenseId ? args.fixedExpenseId : undefined;
      await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, recurringExpenseId: fixedExpenseId, channel: ctx.channel, chatId: ctx.chatId });
      return { status: "done", summary: `Expense ${amount} recorded${debtAccount ? ` on card ${debtAccount.name} (debt up, no cash out today)` : sourceAccount ? ` from ${sourceAccount.name}` : ""}${fixedExpenseId ? " (linked to its recurring/fixed expense, not extra spending)" : ""}.` };
    }
    if (type === "income") {
      if (!destAccount) return { status: "needs_info", summary: "Income needs a destination account." };
      const intent: IncomeIntent = { type: "income", description, category: "income", originalAmount: amount, originalCurrency: accountCurrency(destAccount), confidenceScore: 0.9, status: "ready", destinationAccountId: destAccount.id };
      await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId });
      return { status: "done", summary: `Income ${amount} recorded to ${destAccount.name}.` };
    }
    if (type === "debt_payment") {
      if (!sourceAccount || !debtAccount) return { status: "needs_info", summary: "Debt payment needs a source account and a debt/card." };
      const intent: DebtPaymentIntent = { type: "debt_payment", description, category: "debt", originalAmount: amount, originalCurrency: accountCurrency(sourceAccount), confidenceScore: 0.9, status: "ready", sourceAccountId: sourceAccount.id, debtAccountId: debtAccount.id };
      await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId });
      return { status: "done", summary: `Debt payment ${amount} from ${sourceAccount.name} to ${debtAccount.name} (account down, debt down, not a new expense).` };
    }
    if (type === "goal_contribution") {
      if (!sourceAccount || !goal) return { status: "needs_info", summary: "Goal contribution needs a source account and a goal." };
      const goalAccountId = goal.goalAccountId ?? ctx.accounts.find((a) => a.isGoalAccount)?.id ?? "";
      const intent: GoalContributionIntent = { type: "goal_contribution", description, category: "savings", originalAmount: amount, originalCurrency: accountCurrency(sourceAccount), confidenceScore: 0.9, status: "ready", sourceAccountId: sourceAccount.id, destinationAccountId: goalAccountId, goalId: goal.id };
      await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId });
      return { status: "done", summary: `Goal contribution ${amount} from ${sourceAccount.name} to ${goal.name}.` };
    }
    return { status: "refused", summary: `Unsupported movement type: ${type}.` };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "log_movement failed" };
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
  try {
    const intent: TransferIntent = { type: "transfer", description: String(args.description ?? "Movimiento entre cuentas"), category: "other", originalAmount: amount, originalCurrency: accountCurrency(source), confidenceScore: 0.9, status: "ready", sourceAccountId: source.id, destinationAccountId: destination.id };
    await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId });
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
      const currency = accountCurrency(account);
      const who = person ? ` a ${person}` : "";
      const intent: ExpenseIntent = {
        type: "expense",
        description: isLoan ? `Préstamo${who}${reason ? ` (${reason})` : ""}` : `${reason || "transferencia"}${who}`,
        category: isLoan ? "other" : category(args.category, "other"),
        originalAmount: amount,
        originalCurrency: currency,
        confidenceScore: 0.9,
        status: "ready",
        sourceAccountId: account?.id,
        debtAccountId: debt?.id,
      };
      await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId });
      if (isLoan) {
        await createReceivable({ userId: ctx.userId, counterparty: person || "alguien", direction: "owed_to_user", amount, currency, reason: reason || undefined });
        return { status: "done", summary: `Registré préstamo ${money(amount, currency)}${who} y lo guardé como dinero que te deben.` };
      }
      return { status: "done", summary: `Registré ${money(amount, currency)}${who} como gasto desde ${account?.name ?? debt?.name}.` };
    }
    // direction === "in"
    if (!account) return { status: "needs_info", summary: "¿A qué cuenta te llegó?" };
    const inflowKind = args.inflowKind === "refund" || args.inflowKind === "loan_repayment" ? args.inflowKind : "income";
    const currency = accountCurrency(account);
    const who = person ? ` de ${person}` : "";
    if (inflowKind === "refund") {
      const intent: RefundIntent = { type: "refund", description: `Reembolso${who}${reason ? ` (${reason})` : ""}`, originalAmount: amount, originalCurrency: currency, confidenceScore: 0.9, status: "ready", destinationAccountId: account.id, category: category(args.category, "other") };
      await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId });
      return { status: "done", summary: `Registré reembolso ${money(amount, currency)}${who} a ${account.name} (no lo cuento como ingreso nuevo).` };
    }
    const intent: IncomeIntent = { type: "income", description: inflowKind === "loan_repayment" ? `Devolución de préstamo${who}` : `Ingreso${who}${reason ? ` (${reason})` : ""}`, originalAmount: amount, originalCurrency: currency, confidenceScore: 0.9, status: "ready", destinationAccountId: account.id, category: "income" };
    await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId });
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
  const currency = accountCurrency(account);
  const created = await createFixedExpense({ userId: ctx.userId, name, amount, currency, category: category(args.category, "other"), frequency, startDate, paymentSourceType: account ? "account" : undefined, paymentSourceId: account?.id });
  if (!created) return { status: "error", summary: "No pude guardar el gasto fijo." };

  if (args.payNow === true && !startDate) {
    const intent: ExpenseIntent = { type: "expense", description: name, category: category(args.category, "other"), originalAmount: amount, originalCurrency: currency, confidenceScore: 0.9, status: "ready", sourceAccountId: account?.id };
    if (account) {
      await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, recurringExpenseId: created.id, fixedExpenseName: name, channel: ctx.channel, chatId: ctx.chatId });
      return { status: "done", summary: `Creé el gasto fijo ${name} (${money(amount, currency)} ${frequency}) y registré el pago de hoy.` };
    }
  }
  return { status: "done", summary: `Creé el gasto fijo ${name} (${money(amount, currency)} ${frequency})${startDate ? `, empieza el ${startDate}` : ""}. No registro un pago hoy.` };
}

async function executeUpdateFixed(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const id = typeof args.fixedExpenseId === "string" ? args.fixedExpenseId : "";
  const newAmount = Number(args.newAmount);
  if (!id) return { status: "needs_info", summary: "Falta el id del gasto fijo." };
  if (!Number.isFinite(newAmount) || newAmount <= 0) return { status: "needs_info", summary: "¿A cuánto queda?" };
  const ok = await updateFixedExpenseAmount({ userId: ctx.userId, id, amount: newAmount });
  if (!ok) return { status: "error", summary: "No pude actualizar el gasto fijo." };
  const account = ctx.accounts.find((a) => a.id === args.sourceAccountId);
  if (args.payNow === true) {
    const currency = accountCurrency(account);
    const intent: ExpenseIntent = { type: "expense", description: "Gasto fijo", category: "other", originalAmount: newAmount, originalCurrency: currency, confidenceScore: 0.9, status: "ready", sourceAccountId: account?.id };
    if (account) {
      await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, recurringExpenseId: id, channel: ctx.channel, chatId: ctx.chatId });
      return { status: "done", summary: `Actualicé el gasto fijo a ${money(newAmount, currency)} de ahora en adelante y registré el pago de hoy.` };
    }
  }
  return { status: "done", summary: `Actualicé el gasto fijo a ${money(newAmount, "USD")} de ahora en adelante. No registro un pago hoy.` };
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

  if (recurring) {
    const created = await createFixedExpense({ userId: ctx.userId, name, amount: amount ?? 0, currency: "USD", category: category(args.category, "other"), frequency: "monthly", startDate: dueDate });
    if (!created) return { status: "error", summary: "No pude guardar el gasto futuro." };
    return { status: "done", summary: `Anotado: ${name}${amount ? ` ${money(amount, "USD")}` : ""} mensual, empieza el ${dueDate}. No lo cuento hasta que arranque.` };
  }
  const created = await createScheduledPayment({ userId: ctx.userId, name, amount, currency: "USD", category: category(args.category, "other"), dueDate, recurring: false, rawInput: ctx.rawMessage });
  if (!created) return { status: "error", summary: "No pude guardar el recordatorio." };
  return { status: "done", summary: `Listo, te recuerdo ${name}${amount ? ` por ${money(amount, "USD")}` : ""} el ${dueDate}. No lo registro como gasto hasta que lo pagues.` };
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

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  switch (name) {
    case "get_financial_context":
      return { status: "done", summary: "Context already provided in the system message; re-read it there." };
    case "log_movement":
      return executeLogMovement(args, ctx);
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
    case "remember_fact":
      return executeRememberFact(args, ctx);
    default:
      return { status: "refused", summary: `Unknown tool: ${name}` };
  }
}
