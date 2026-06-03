import type OpenAI from "openai";
import {
  applyChatTransactionIntent,
  reverseStoredTransaction,
} from "@/lib/ai/apply-chat-transaction-intent";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import {
  findUndoTarget,
  loadRecentTransactions,
} from "@/lib/financial/transaction-recovery";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type {
  Account,
  CurrencyCode,
  DebtAccount,
  FinancialCategory,
  FinancialGoal,
} from "@/types/financial";
import type {
  DebtPaymentIntent,
  ExpenseIntent,
  GoalContributionIntent,
  IncomeIntent,
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
          description: { type: "string" },
          category: { type: "string" },
          sourceAccountId: { type: "string", description: "Account the money left from (expense/debt_payment/goal_contribution)." },
          debtAccountId: { type: "string", description: "Card/debt: for an expense it is the card used; for a debt_payment it is the debt being paid." },
          destinationAccountId: { type: "string", description: "Account the money arrived to (income), or the goal's account (goal_contribution)." },
          goalId: { type: "string" },
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
      name: "undo_last_movement",
      description:
        "Reverse a recent movement (append-only, idempotent, balance restored). Pass an optional hint describing which one ('el café', 'los 90'). With no hint, the most recent eligible movement is undone. If several match, this returns candidates so you can confirm with the user.",
      parameters: {
        type: "object",
        properties: { hint: { type: "string" } },
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
      await applyChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId });
      return { status: "done", summary: `Expense ${amount} recorded${debtAccount ? ` on card ${debtAccount.name} (debt up, no cash out today)` : sourceAccount ? ` from ${sourceAccount.name}` : ""}.` };
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

async function executeUndo(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const recent = await loadRecentTransactions(ctx.userId);
  const found = findUndoTarget(recent, typeof args.hint === "string" ? args.hint : "");
  if (found.status === "none") return { status: "needs_info", summary: "No recent eligible movement found to undo." };
  if (found.status === "ambiguous" && found.candidates) {
    return { status: "needs_info", summary: `Several movements match. Candidates: ${found.candidates.map((t) => `${t.description} ${t.originalAmount}${t.originalCurrency}`).join("; ")}. Ask which one.` };
  }
  if (!found.target) return { status: "error", summary: "Could not resolve a target." };
  try {
    const result = await reverseStoredTransaction({ userId: ctx.userId, transaction: found.target, message: ctx.rawMessage, channel: ctx.channel });
    if (!result.ok && result.alreadyReversed) return { status: "done", summary: `That movement (${found.target.description} ${found.target.originalAmount}) was already reversed; nothing changed.` };
    return { status: "done", summary: `Reversed ${found.target.description} ${found.target.originalAmount}${found.target.originalCurrency}; balance restored.` };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "undo failed" };
  }
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
    case "undo_last_movement":
      return executeUndo(args, ctx);
    case "remember_fact":
      return executeRememberFact(args, ctx);
    default:
      return { status: "refused", summary: `Unknown tool: ${name}` };
  }
}
