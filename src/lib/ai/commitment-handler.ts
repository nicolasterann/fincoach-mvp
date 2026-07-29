import {
  classifyCommitment,
  type CommitmentAction,
  type CommitmentIntent,
} from "@/lib/ai/commitment-classifier";
import type { AdvisoryRecentMessage } from "@/lib/ai/advisory-classifier";
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
import { moneyReadPublishable } from "@/lib/financial/money-read";
import { logChatRoute } from "@/lib/observability/route-telemetry";
import type {
  Account,
  CurrencyCode,
  DebtAccount,
  FinancialCategory,
  FinancialGoal,
  PaymentFrequency,
} from "@/types/financial";

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
  /** Snapshot used only to make the emergency fallback fail closed. `null`
   *  includes pre-K pending metadata whose variability was never proved. */
  existingFixedIsVariable: boolean | null;
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
): CommitmentIntent & {
  existingFixedId: string | null;
  existingFixedIsVariable: boolean | null;
  awaitingChoice: boolean;
} {
  if (!prior) {
    return {
      ...fresh,
      existingFixedId: null,
      existingFixedIsVariable: null,
      awaitingChoice: false,
    };
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
    existingFixedIsVariable: prior.existingFixedIsVariable ?? null,
    awaitingChoice: prior.awaitingChoice,
  };
}

function toPending(
  c: CommitmentIntent & {
    existingFixedId?: string | null;
    existingFixedIsVariable?: boolean | null;
    awaitingChoice?: boolean;
  },
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
    existingFixedIsVariable: c.existingFixedIsVariable ?? null,
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

// Costura para que el gate pruebe el TRAYECTO (handler real, lectura que falla →
// el writer NO se llama) sin red ni LLM. Default = stores reales; mismo patrón que
// readInstallmentPlansWith / readMoneyTxnFeed. El classifier también entra porque
// sin él no se puede invocar el handler real de forma determinista.
export interface CommitmentHandlerDeps {
  classifyCommitment: typeof classifyCommitment;
  readSimilarFixedExpenses: typeof readSimilarFixedExpenses;
  createFixedExpense: typeof createFixedExpense;
  updateFixedExpenseAmount?: typeof updateFixedExpenseAmount;
}

const defaultDeps: CommitmentHandlerDeps = {
  classifyCommitment,
  readSimilarFixedExpenses,
  createFixedExpense,
};

export async function handleCommitmentMessage(
  input: CommitmentHandlerInput,
  deps: CommitmentHandlerDeps = defaultDeps,
): Promise<ChatTransactionResult | null> {
  // If we previously asked "update vs create", resolve that choice first.
  if (input.prior?.awaitingChoice && input.prior.existingFixedId) {
    const choice = readUpdateVsCreate(input.message);
    if (choice === "update") {
      if (input.prior.existingFixedIsVariable !== false) {
        return buildChatTransactionClarificationResult({
          clarificationQuestion:
            "No cambié ese gasto por la ruta de respaldo porque no pude probar que sea un monto realmente fijo. Reintenta en un momento para distinguir una factura del ciclo de un cambio permanente.",
        });
      }
      return finishUpdateFixed(
        input,
        input.prior,
        input.prior.existingFixedId,
        deps,
      );
    }
    if (choice === "create") {
      return finishCreateFixed(
        input,
        {
          ...mergeToIntent(input.prior),
          existingFixedId: null,
          existingFixedIsVariable: null,
          awaitingChoice: false,
        },
        deps,
      );
    }
    // Unclear → re-ask, keep pending.
    return ask(
      `¿Lo sumo como un gasto fijo NUEVO o actualizo el que ya tienes?`,
      input.prior,
    );
  }

  const fresh = await deps.classifyCommitment({
    message: input.message,
    recentMessages: input.recentMessages,
  });
  const c = merge(input.prior, fresh);

  if (c.action === "none" && !input.prior) return null;

  if (c.action === "schedule_payment") {
    return finishSchedule(input, c, deps);
  }
  if (c.action === "update_fixed") {
    return startUpdateFixed(input, c, deps);
  }
  // create_fixed (and the fallback when we had prior commitment context)
  return startCreateFixed(input, c, deps);
}

type MergedIntent = CommitmentIntent & {
  existingFixedId: string | null;
  existingFixedIsVariable: boolean | null;
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
  deps: CommitmentHandlerDeps,
): Promise<ChatTransactionResult> {
  if (!c.name) {
    return ask("¿De qué es el gasto fijo nuevo?", toPending(c));
  }
  if (!c.amount) {
    return ask(`¿De cuánto es ${c.name} y cada cuánto lo pagas?`, toPending(c));
  }

  // Similar already exists → ask update vs create (Script 23 / Phase 11 #23).
  const similarRead = await deps.readSimilarFixedExpenses({ userId: input.userId, name: c.name });
  // Un guard que no pudo leer NO autoriza: si esta lectura falla, `matches` vacío
  // significaría "no hay ninguno parecido" y el fijo entraría DUPLICADO, restando
  // dos veces del ritmo. Sin veredicto publicable, no se crea nada.
  if (!moneyReadPublishable(similarRead)) {
    logChatRoute({
      route: "commitment",
      channel: input.channel,
      outcome: "fixed_expense_clarification",
      dbWrite: false,
      transactionType: "fixed_expense_create",
    });
    return buildChatActionResult({
      redirectCode: "chat-correction-created",
      message:
        "No pude revisar si ya tienes ese gasto fijo guardado, así que no lo creo todavía para no duplicarlo. Intenta de nuevo en un momento.",
    });
  }
  const similar = similarRead.matches;
  if (similar.length > 0) {
    const existing: ExistingFixedExpense = similar[0];
    const pending = toPending({
      ...c,
      existingFixedId: existing.id,
      existingFixedIsVariable: existing.isVariable === true,
      awaitingChoice: true,
    });
    return ask(
      `Ya tienes ${existing.name} por ${money(existing.amount, existing.currency)}. ¿Actualizo ese o creo uno nuevo aparte?`,
      pending,
    );
  }

  return finishCreateFixed(input, c, deps);
}

async function finishCreateFixed(
  input: CommitmentHandlerInput,
  c: MergedIntent,
  deps: CommitmentHandlerDeps,
): Promise<ChatTransactionResult> {
  const name = c.name as string;
  const amount = c.amount as number;
  const frequency: PaymentFrequency = c.frequency ?? "monthly";
  const category: FinancialCategory = c.category ?? "other";
  const { account, debt } = resolveSource(c.paymentSourceName, input.accounts, input.debtAccounts);
  const currency: CurrencyCode =
    (account?.currency as CurrencyCode) ??
    (debt?.currency as CurrencyCode) ??
    "USD";

  // This handler is the emergency legacy fallback. Definition + "paid today"
  // used to be two writes and swallowed the second failure while claiming both
  // succeeded. The primary agent owns the atomic RPC. The fallback must refuse
  // the compound operation rather than recreate the saga or leave a half-truth.
  if (c.payNow && !c.startDate) {
    return buildChatTransactionClarificationResult({
      clarificationQuestion:
        "No guardé nada: registrar el gasto fijo y su pago de hoy tiene que aterrizar junto. Reintenta en un momento para que Kipu haga ambas cosas de forma segura.",
    });
  }

  const created = await deps.createFixedExpense({
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

  return buildChatActionResult({
    redirectCode: "chat-correction-created",
    message: `Listo, lo guardé como gasto fijo: ${name}, ${amountText}.${startText} No registro un pago hoy; lo tendré en cuenta para tu plan.`,
  });
}

async function startUpdateFixed(
  input: CommitmentHandlerInput,
  c: MergedIntent,
  deps: CommitmentHandlerDeps,
): Promise<ChatTransactionResult> {
  if (!c.name) {
    return ask("¿Cuál gasto fijo cambió?", toPending(c));
  }
  if (!c.amount) {
    return ask(`¿A cuánto queda ${c.name} de ahora en adelante?`, toPending(c));
  }
  const similarRead = await deps.readSimilarFixedExpenses({ userId: input.userId, name: c.name });
  // Mismo fail-closed que en create: una lectura fallida aquí diría "no existe" y
  // ofrecería CREARLO de nuevo (pending pasa a create_fixed) — el mismo duplicado
  // por otra puerta. Sin veredicto, ni actualizamos ni ofrecemos crear.
  if (!moneyReadPublishable(similarRead)) {
    logChatRoute({
      route: "commitment",
      channel: input.channel,
      outcome: "fixed_expense_clarification",
      dbWrite: false,
      transactionType: "fixed_expense_update",
    });
    return buildChatActionResult({
      redirectCode: "chat-correction-created",
      message:
        "No pude revisar tus gastos fijos ahora, así que no cambio nada todavía. Intenta de nuevo en un momento.",
    });
  }
  const similar = similarRead.matches;
  if (similar.length === 0) {
    // Nothing to update — offer to create instead.
    return ask(
      `No tengo "${c.name}" como gasto fijo todavía. ¿Lo creo nuevo con ese monto?`,
      toPending({ ...c, action: "create_fixed" }),
    );
  }
  if (similar[0].isVariable) {
    // Emergency legacy fallback has no atomic observation/occurrence writer.
    // Letting it reuse the old permanent amount writer would turn “la luz vino
    // en 42.000” into a plan rewrite. The primary agent can observe/pay it
    // safely; the fallback must fail closed instead of extending a second K
    // lifecycle.
    return buildChatTransactionClarificationResult({
      clarificationQuestion:
        `"${similar[0].name}" es un gasto variable. No cambié su plan ni registré un pago por esta ruta de respaldo; reintenta en un momento para anotar la factura del ciclo de forma segura.`,
    });
  }
  return finishUpdateFixed(input, toPending(c), similar[0].id, deps);
}

async function finishUpdateFixed(
  input: CommitmentHandlerInput,
  c: CommitmentPendingState,
  fixedId: string,
  deps: CommitmentHandlerDeps,
): Promise<ChatTransactionResult> {
  const amount = c.amount as number;
  const name = c.name ?? "tu gasto fijo";
  if (c.payNow) {
    return buildChatTransactionClarificationResult({
      clarificationQuestion:
        "No cambié nada: actualizar el gasto fijo y registrar el pago de hoy tiene que aterrizar junto. Reintenta en un momento para que Kipu haga ambas cosas de forma segura.",
    });
  }
  const ok = await (deps.updateFixedExpenseAmount ?? updateFixedExpenseAmount)({
    userId: input.userId,
    id: fixedId,
    amount,
  });

  const { account, debt } = resolveSource(c.paymentSourceName, input.accounts, input.debtAccounts);
  const currency: CurrencyCode =
    (account?.currency as CurrencyCode) ??
    (debt?.currency as CurrencyCode) ??
    "USD";

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

  return buildChatActionResult({
    redirectCode: "chat-correction-created",
    message: `Hecho, actualicé ${name} a ${money(amount, currency)} de ahora en adelante. No registro un pago hoy.`,
  });
}

async function finishSchedule(
  input: CommitmentHandlerInput,
  c: MergedIntent,
  deps: CommitmentHandlerDeps,
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
    const created = await deps.createFixedExpense({
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
