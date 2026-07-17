import {
  classifyCommitment,
  type CommitmentAction,
  type CommitmentIntent,
} from "@/lib/ai/commitment-classifier";
import type { AdvisoryRecentMessage } from "@/lib/ai/advisory-classifier";
import { applyChatTransactionIntent } from "@/lib/ai/apply-chat-transaction-intent";
import {
  buildChatActionResult,
  buildChatTransactionClarificationResult,
  type ChatTransactionResult,
} from "@/lib/ai/chat-transaction-result";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import {
  createFixedExpense,
  createScheduledPayment,
  readSimilarFixedExpenses,
  updateFixedExpenseAmount,
  type ExistingFixedExpense,
} from "@/lib/financial/commitments-store";
import { logChatRoute } from "@/lib/observability/route-telemetry";
import type {
  Account,
  CurrencyCode,
  DebtAccount,
  FinancialCategory,
  FinancialGoal,
  PaymentFrequency,
} from "@/types/financial";
import type { ExpenseIntent } from "@/types/transaction-intents";

// Carried on the assistant chat_messages metadata so a multi-turn commitment
// ("nuevo gasto fijo de gimnasio" → "25 al mes" → "desde el 1") completes
// without a new pending DB kind. Also carries the existing fixed expense id
// when we asked "update vs create".
export interface CommitmentPendingState {
  kind: "commitment_pending";
  action: CommitmentAction;
  name: string | null;
  amount: number | null;
  frequency: PaymentFrequency | null;
  category: FinancialCategory | null;
  dueDate: string | null;
  startDate: string | null;
  recurring: boolean;
  payNow: boolean;
  paymentSourceName: string | null;
  existingFixedId: string | null;
  awaitingChoice: boolean;
}

export interface CommitmentHandlerInput {
  userId: string;
  message: string;
  recentMessages: AdvisoryRecentMessage[];
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  channel?: ChatChannel;
  chatId?: string | null;
  prior?: CommitmentPendingState;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function money(amount: number, currency: string): string {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

function frequencyLabel(freq: PaymentFrequency): string {
  switch (freq) {
    case "weekly":
      return "a la semana";
    case "biweekly":
      return "cada quincena";
    case "yearly":
      return "al año";
    case "monthly":
    default:
      return "al mes";
  }
}

function resolveSource(
  name: string | null,
  accounts: Account[],
  debtAccounts: DebtAccount[],
): { account?: Account; debt?: DebtAccount } {
  if (!name) return {};
  const n = normalize(name);
  const account = accounts.find(
    (a) => !a.isGoalAccount && (normalize(a.name).includes(n) || n.includes(normalize(a.name))),
  );
  if (account) return { account };
  const debt = debtAccounts.find(
    (d) => normalize(d.name).includes(n) || n.includes(normalize(d.name)),
  );
  return debt ? { debt } : {};
}

function merge(
  prior: CommitmentPendingState | undefined,
  fresh: CommitmentIntent,
): CommitmentIntent & { existingFixedId: string | null; awaitingChoice: boolean } {
  if (!prior) {
    return { ...fresh, existingFixedId: null, awaitingChoice: false };
  }
  return {
    action: fresh.action !== "none" ? fresh.action : prior.action,
    name: fresh.name ?? prior.name,
    amount: fresh.amount ?? prior.amount,
    frequency: fresh.frequency ?? prior.frequency,
    category: fresh.category ?? prior.category,
    dueDate: fresh.dueDate ?? prior.dueDate,
    startDate: fresh.startDate ?? prior.startDate,
    recurring: fresh.recurring || prior.recurring,
    payNow: fresh.payNow || prior.payNow,
    paymentSourceName: fresh.paymentSourceName ?? prior.paymentSourceName,
    confidence: fresh.confidence,
    existingFixedId: prior.existingFixedId,
    awaitingChoice: prior.awaitingChoice,
  };
}

function toPending(
  c: CommitmentIntent & { existingFixedId?: string | null; awaitingChoice?: boolean },
): CommitmentPendingState {
  return {
    kind: "commitment_pending",
    action: c.action,
    name: c.name,
    amount: c.amount,
    frequency: c.frequency,
    category: c.category,
    dueDate: c.dueDate,
    startDate: c.startDate,
    recurring: c.recurring,
    payNow: c.payNow,
    paymentSourceName: c.paymentSourceName,
    existingFixedId: c.existingFixedId ?? null,
    awaitingChoice: c.awaitingChoice ?? false,
  };
}

function ask(
  question: string,
  pending: CommitmentPendingState,
): ChatTransactionResult {
  return {
    ...buildChatTransactionClarificationResult({ clarificationQuestion: question }),
    assistantMetadata: { commitmentPending: pending },
  };
}

// "actualízalo / el mismo" → update; "nuevo / otro / aparte" → create new.
function readUpdateVsCreate(message: string): "update" | "create" | null {
  const n = normalize(message);
  if (/\b(nuevo|otra|otro|aparte|distinto|adicional|adema|es\s+otro)\b/.test(n)) {
    return "create";
  }
  if (/\b(actualiza|actualizalo|el\s+mismo|ese\s+mismo|si|sip|claro|subio|cambialo|el\s+de\s+siempre|ese)\b/.test(n)) {
    return "update";
  }
  return null;
}

async function logExpensePayment(input: {
  userId: string;
  name: string;
  amount: number;
  currency: CurrencyCode;
  category: FinancialCategory;
  account?: Account;
  debt?: DebtAccount;
  recurringExpenseId?: string;
  message: string;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  channel?: ChatChannel;
  chatId?: string | null;
}): Promise<void> {
  const intent: ExpenseIntent = {
    type: "expense",
    description: input.name,
    category: input.category,
    originalAmount: input.amount,
    originalCurrency: input.currency,
    confidenceScore: 0.9,
    status: "ready",
    sourceAccountId: input.account?.id,
    debtAccountId: input.debt?.id,
  };
  try {
    await applyChatTransactionIntent({
      userId: input.userId,
      message: input.message,
      intent,
      accounts: input.accounts,
      debtAccounts: input.debtAccounts,
      goals: input.goals,
      parserSource: "ai",
      parserConfidenceScore: 0.9,
      recurringExpenseId: input.recurringExpenseId,
      fixedExpenseName: input.name,
      channel: input.channel,
      chatId: input.chatId,
    });
  } catch {
    // Payment logging is best-effort here; the fixed expense itself is saved.
  }
}

export async function handleCommitmentMessage(
  input: CommitmentHandlerInput,
): Promise<ChatTransactionResult | null> {
  // If we previously asked "update vs create", resolve that choice first.
  if (input.prior?.awaitingChoice && input.prior.existingFixedId) {
    const choice = readUpdateVsCreate(input.message);
    if (choice === "update") {
      return finishUpdateFixed(input, input.prior, input.prior.existingFixedId);
    }
    if (choice === "create") {
      return finishCreateFixed(input, {
        ...mergeToIntent(input.prior),
        existingFixedId: null,
        awaitingChoice: false,
      });
    }
    // Unclear → re-ask, keep pending.
    return ask(
      `¿Lo sumo como un gasto fijo NUEVO o actualizo el que ya tienes?`,
      input.prior,
    );
  }

  const fresh = await classifyCommitment({
    message: input.message,
    recentMessages: input.recentMessages,
  });
  const c = merge(input.prior, fresh);

  if (c.action === "none" && !input.prior) return null;

  if (c.action === "schedule_payment") {
    return finishSchedule(input, c);
  }
  if (c.action === "update_fixed") {
    return startUpdateFixed(input, c);
  }
  // create_fixed (and the fallback when we had prior commitment context)
  return startCreateFixed(input, c);
}

type MergedIntent = CommitmentIntent & {
  existingFixedId: string | null;
  awaitingChoice: boolean;
};

function mergeToIntent(prior: CommitmentPendingState): CommitmentIntent {
  return {
    action: prior.action,
    name: prior.name,
    amount: prior.amount,
    frequency: prior.frequency,
    category: prior.category,
    dueDate: prior.dueDate,
    startDate: prior.startDate,
    recurring: prior.recurring,
    payNow: prior.payNow,
    paymentSourceName: prior.paymentSourceName,
    confidence: 1,
  };
}

async function startCreateFixed(
  input: CommitmentHandlerInput,
  c: MergedIntent,
): Promise<ChatTransactionResult> {
  if (!c.name) {
    return ask("¿De qué es el gasto fijo nuevo?", toPending(c));
  }
  if (!c.amount) {
    return ask(`¿De cuánto es ${c.name} y cada cuánto lo pagas?`, toPending(c));
  }

  // Similar already exists → ask update vs create (Script 23 / Phase 11 #23).
  const similar = (await readSimilarFixedExpenses({ userId: input.userId, name: c.name })).matches;
  if (similar.length > 0) {
    const existing: ExistingFixedExpense = similar[0];
    const pending = toPending({ ...c, existingFixedId: existing.id, awaitingChoice: true });
    return ask(
      `Ya tienes ${existing.name} por ${money(existing.amount, existing.currency)}. ¿Actualizo ese o creo uno nuevo aparte?`,
      pending,
    );
  }

  return finishCreateFixed(input, c);
}

async function finishCreateFixed(
  input: CommitmentHandlerInput,
  c: MergedIntent,
): Promise<ChatTransactionResult> {
  const name = c.name as string;
  const amount = c.amount as number;
  const frequency: PaymentFrequency = c.frequency ?? "monthly";
  const category: FinancialCategory = c.category ?? "other";
  const { account, debt } = resolveSource(c.paymentSourceName, input.accounts, input.debtAccounts);
  const currency: CurrencyCode = (account?.currency as CurrencyCode) ?? "USD";

  const created = await createFixedExpense({
    userId: input.userId,
    name,
    amount,
    currency,
    category,
    frequency,
    startDate: c.startDate ?? null,
    paymentSourceType: account ? "account" : debt ? "debt_account" : undefined,
    paymentSourceId: account?.id ?? debt?.id,
  });

  logChatRoute({
    route: "commitment",
    channel: input.channel,
    outcome: "fixed_expense_clarification",
    dbWrite: Boolean(created),
    transactionType: "fixed_expense_create",
  });

  if (!created) {
    return buildChatActionResult({
      redirectCode: "chat-correction-created",
      message: "No pude guardar ese gasto fijo ahora. Intenta de nuevo en un momento.",
    });
  }

  const amountText = `${money(amount, currency)} ${frequencyLabel(frequency)}`;
  const startText = c.startDate
    ? ` Empieza el ${c.startDate}, así que no lo cuento todavía.`
    : "";

  if (c.payNow && !c.startDate) {
    await logExpensePayment({
      userId: input.userId,
      name,
      amount,
      currency,
      category,
      account,
      debt,
      recurringExpenseId: created.id,
      message: input.message,
      accounts: input.accounts,
      debtAccounts: input.debtAccounts,
      goals: input.goals,
      channel: input.channel,
      chatId: input.chatId,
    });
    return buildChatActionResult({
      redirectCode: "chat-expense-created",
      message: `Listo, lo guardé como gasto fijo (${amountText}) y registré el pago de hoy.`,
    });
  }

  return buildChatActionResult({
    redirectCode: "chat-correction-created",
    message: `Listo, lo guardé como gasto fijo: ${name}, ${amountText}.${startText} No registro un pago hoy; lo tendré en cuenta para tu plan.`,
  });
}

async function startUpdateFixed(
  input: CommitmentHandlerInput,
  c: MergedIntent,
): Promise<ChatTransactionResult> {
  if (!c.name) {
    return ask("¿Cuál gasto fijo cambió?", toPending(c));
  }
  if (!c.amount) {
    return ask(`¿A cuánto queda ${c.name} de ahora en adelante?`, toPending(c));
  }
  const similar = (await readSimilarFixedExpenses({ userId: input.userId, name: c.name })).matches;
  if (similar.length === 0) {
    // Nothing to update — offer to create instead.
    return ask(
      `No tengo "${c.name}" como gasto fijo todavía. ¿Lo creo nuevo con ese monto?`,
      toPending({ ...c, action: "create_fixed" }),
    );
  }
  return finishUpdateFixed(input, toPending(c), similar[0].id);
}

async function finishUpdateFixed(
  input: CommitmentHandlerInput,
  c: CommitmentPendingState,
  fixedId: string,
): Promise<ChatTransactionResult> {
  const amount = c.amount as number;
  const name = c.name ?? "tu gasto fijo";
  const ok = await updateFixedExpenseAmount({ userId: input.userId, id: fixedId, amount });

  const { account, debt } = resolveSource(c.paymentSourceName, input.accounts, input.debtAccounts);
  const currency: CurrencyCode = (account?.currency as CurrencyCode) ?? "USD";

  logChatRoute({
    route: "commitment",
    channel: input.channel,
    outcome: "fixed_expense_clarification",
    dbWrite: ok,
    transactionType: "fixed_expense_update",
  });

  if (!ok) {
    return buildChatActionResult({
      redirectCode: "chat-correction-created",
      message: "No pude actualizar ese gasto fijo ahora. Intenta de nuevo en un momento.",
    });
  }

  if (c.payNow) {
    await logExpensePayment({
      userId: input.userId,
      name,
      amount,
      currency,
      category: (c.category as FinancialCategory) ?? "other",
      account,
      debt,
      recurringExpenseId: fixedId,
      message: input.message,
      accounts: input.accounts,
      debtAccounts: input.debtAccounts,
      goals: input.goals,
      channel: input.channel,
      chatId: input.chatId,
    });
    return buildChatActionResult({
      redirectCode: "chat-expense-created",
      message: `Listo: registré el pago de ${money(amount, currency)} y dejé ${name} en ese monto de ahora en adelante.`,
    });
  }

  return buildChatActionResult({
    redirectCode: "chat-correction-created",
    message: `Hecho, actualicé ${name} a ${money(amount, currency)} de ahora en adelante. No registro un pago hoy.`,
  });
}

async function finishSchedule(
  input: CommitmentHandlerInput,
  c: MergedIntent,
): Promise<ChatTransactionResult> {
  if (!c.name) {
    return ask("¿Qué pago futuro quieres que recuerde?", toPending(c));
  }
  if (!c.dueDate) {
    return ask(`¿Para qué fecha es el pago de ${c.name}?`, toPending(c));
  }
  if (!c.amount) {
    return ask(`¿De cuánto será ${c.name}?`, toPending(c));
  }

  const { account, debt } = resolveSource(c.paymentSourceName, input.accounts, input.debtAccounts);
  const currency: CurrencyCode = (account?.currency as CurrencyCode) ?? "USD";
  const category: FinancialCategory = c.category ?? "other";

  // A future-recurring commitment becomes a future-starting fixed expense.
  if (c.recurring) {
    const created = await createFixedExpense({
      userId: input.userId,
      name: c.name,
      amount: c.amount,
      currency,
      category,
      frequency: c.frequency ?? "monthly",
      startDate: c.dueDate,
      paymentSourceType: account ? "account" : debt ? "debt_account" : undefined,
      paymentSourceId: account?.id ?? debt?.id,
    });
    logChatRoute({
      route: "commitment",
      channel: input.channel,
      outcome: "fixed_expense_clarification",
      dbWrite: Boolean(created),
      transactionType: "fixed_expense_future_recurring",
    });
    return buildChatActionResult({
      redirectCode: "chat-correction-created",
      message: `Anotado: ${c.name} por ${money(c.amount, currency)} ${frequencyLabel(c.frequency ?? "monthly")}, empezando el ${c.dueDate}. No lo cuento hasta que arranque.`,
    });
  }

  // One-time future payment → scheduled_payments (no money moves today).
  const created = await createScheduledPayment({
    userId: input.userId,
    name: c.name,
    amount: c.amount,
    currency,
    category,
    dueDate: c.dueDate,
    recurring: false,
    paymentSourceType: account ? "account" : debt ? "debt_account" : undefined,
    paymentSourceId: account?.id ?? debt?.id,
    rawInput: input.message,
  });
  logChatRoute({
    route: "commitment",
    channel: input.channel,
    outcome: "fixed_expense_clarification",
    dbWrite: Boolean(created),
    transactionType: "scheduled_payment",
  });
  return buildChatActionResult({
    redirectCode: "chat-correction-created",
    message: `Listo, te lo recuerdo: ${c.name} por ${money(c.amount, currency)} el ${c.dueDate}. No lo registro como gasto hasta que lo pagues; ese día dime y lo anoto.`,
  });
}
