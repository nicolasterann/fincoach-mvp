import OpenAI from "openai";
import type { AdvisoryRecentMessage } from "@/lib/ai/advisory-classifier";
import { applyChatTransactionIntent } from "@/lib/ai/apply-chat-transaction-intent";
import {
  buildChatActionResult,
  buildChatTransactionClarificationResult,
  buildChatTransactionFailedResult,
  type ChatTransactionResult,
} from "@/lib/ai/chat-transaction-result";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import {
  applyReceivableRepayment,
  createReceivable,
} from "@/lib/financial/commitments-store";
import { logChatRoute } from "@/lib/observability/route-telemetry";
import type {
  Account,
  CurrencyCode,
  DebtAccount,
  FinancialCategory,
  FinancialGoal,
} from "@/types/financial";
import type {
  ExpenseIntent,
  IncomeIntent,
  RefundIntent,
  TransferIntent,
} from "@/types/transaction-intents";

// Transfers, both internal (between the user's OWN accounts) and
// person-to-person (an expense out to someone, or an inflow from someone).
// The AI classifies the natural-language intent; deterministic code resolves
// the real accounts, enforces completeness, and writes through the single
// writer. Internal transfers are never counted as spending/income; outgoing
// person transfers are expenses; incoming ones are income or a reimbursement
// (refund) — never overstating income when it was money coming back.

export type TransferKind =
  | "internal"
  | "person_out"
  | "person_in"
  | "debt_related"
  | "not_transfer"
  | "unclear";

export type InflowKind = "income" | "refund" | "loan_repayment" | null;

export interface TransferClassification {
  kind: TransferKind;
  amount: number | null;
  sourceName: string | null;
  destinationName: string | null;
  personName: string | null;
  reason: string | null;
  category: FinancialCategory | null;
  inflowKind: InflowKind;
  isLoan: boolean;
  confidence: number;
}

// Short-lived collection state carried on the assistant chat_messages metadata
// so a multi-turn person/internal transfer ("le transferí a Juan" → "20 del
// Pichincha" → "era de comida") can be completed without a new pending DB kind.
export interface TransferPendingState {
  kind: "transfer_pending";
  transferKind: TransferKind;
  amount: number | null;
  sourceName: string | null;
  destinationName: string | null;
  personName: string | null;
  reason: string | null;
  category: FinancialCategory | null;
  inflowKind: InflowKind;
  isLoan: boolean;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

// Cheap gate: does this message even look like a transfer? Excludes clean
// income ("me pagaron") and debt payments ("pagué de visa") which the parser
// already handles correctly. The classifier makes the final call.
export function looksLikeTransferish(message: string): boolean {
  const n = normalize(message);
  if (/\btransfer\w*/.test(n)) return true;
  if (/\ble\s+(?:mand|pas|gir|envi|deposit|preste|presto)\w*/.test(n)) return true;
  if (/\bme\s+(?:transfir|devolv|reembols|deposit|presto|presta|paso|pago\s+de\s+vuelta)\w*/.test(n)) {
    return true;
  }
  if (/\b(?:movi|pase|pasé|meti|metí|saque|saqué)\b/.test(n)) return true;
  if (/\bpreste\b|\bpresté\b|\bme\s+debe\b|\bme\s+pago\b.*\bpresta/.test(n)) return true;
  return false;
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

function transferAiEnabled(): boolean {
  return (process.env.TRANSACTION_PARSER_MODE ?? "basic") !== "basic";
}

const TRANSFER_SYSTEM_PROMPT = `
You read ONE user message to Kipu (a money assistant) plus recent chat and the user's account/card names. The message is about MOVING money. Classify it and extract fields. You ONLY classify and extract; deterministic code resolves the real accounts and writes safely. Interpret natural LatAm Spanish, not fixed phrases.

"kind":
- "internal": money moved between the user's OWN accounts/balances (bank ↔ cash, Pichincha ↔ ahorro). NOT spending. Examples of intent: "pasé 50 de Pichincha a efectivo", "metí 40 al banco", "transferí entre mis cuentas".
- "person_out": the user sent money to ANOTHER person (mom, a friend, Juan) for a reason — gas, food, rent, their share of a bill, or a loan. This is spending (or a loan), not an internal transfer. Examples: "le transferí 20 a mi mamá de la gasolina", "le mandé mi parte de la cena a Ana".
- "person_in": the user RECEIVED money from another person — salary/payment, a reimbursement for something they paid, or a loan repayment.
- "debt_related": the move involves a credit card / debt and it is unclear whether it is a debt payment, cash advance, or refund.
- "not_transfer": it is actually a normal expense/income/debt payment with no transfer meaning, just talk, OR the destination is one of the user's savings GOALS (that is a goal contribution handled elsewhere, not a transfer).
- "unclear": cannot tell.

Fields (null when unknown — NEVER invent):
- amount (number)
- sourceName: the OWN account/card the money left from.
- destinationName: the OWN account it went to (only for internal).
- personName: the other person (person_out / person_in).
- reason: the purpose ("gasolina", "cena", "renta", "mi parte").
- category: best of food, transport, shopping, subscriptions, travel, housing, utilities, health, education, entertainment, family, debt, savings, income, other.
- inflowKind (person_in only): "income" (salary/payment/gift), "refund" (reimbursement for something they paid), or "loan_repayment".
- isLoan (boolean): true if person_out is explicitly a loan ("le presté").
- confidence: 0..1.

Respond with STRICT JSON only:
{"kind": "...", "amount": number|null, "sourceName": string|null, "destinationName": string|null, "personName": string|null, "reason": string|null, "category": string|null, "inflowKind": "income"|"refund"|"loan_repayment"|null, "isLoan": boolean, "confidence": number}
`;

function emptyClassification(): TransferClassification {
  return {
    kind: "unclear",
    amount: null,
    sourceName: null,
    destinationName: null,
    personName: null,
    reason: null,
    category: null,
    inflowKind: null,
    isLoan: false,
    confidence: 0,
  };
}

export async function classifyTransfer(input: {
  message: string;
  recentMessages: AdvisoryRecentMessage[];
  accountNames: string[];
  debtNames: string[];
  goalNames: string[];
}): Promise<TransferClassification> {
  if (!transferAiEnabled()) return emptyClassification();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return emptyClassification();

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_TRANSACTION_PARSER_MODEL ?? "gpt-5.4-mini";

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: TRANSFER_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            message: input.message,
            recentMessages: input.recentMessages.slice(-8),
            accountNames: input.accountNames,
            debtNames: input.debtNames,
            goalNames: input.goalNames,
          }),
        },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) return emptyClassification();
    const parsed = JSON.parse(content) as Record<string, unknown>;

    const kind: TransferKind = [
      "internal",
      "person_out",
      "person_in",
      "debt_related",
      "not_transfer",
      "unclear",
    ].includes(parsed.kind as string)
      ? (parsed.kind as TransferKind)
      : "unclear";

    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
    const str = (v: unknown, max = 60): string | null => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t ? t.slice(0, max) : null;
    };
    const category =
      typeof parsed.category === "string" &&
      VALID_CATEGORIES.has(parsed.category as FinancialCategory)
        ? (parsed.category as FinancialCategory)
        : null;
    const inflowKind: InflowKind =
      parsed.inflowKind === "income" ||
      parsed.inflowKind === "refund" ||
      parsed.inflowKind === "loan_repayment"
        ? parsed.inflowKind
        : null;

    return {
      kind,
      amount: num(parsed.amount),
      sourceName: str(parsed.sourceName),
      destinationName: str(parsed.destinationName),
      personName: str(parsed.personName),
      reason: str(parsed.reason, 80),
      category,
      inflowKind,
      isLoan: parsed.isLoan === true,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
    };
  } catch {
    return emptyClassification();
  }
}

function nameMatch(candidate: string, target: string): boolean {
  const a = normalize(candidate);
  const b = normalize(target);
  return a.includes(b) || b.includes(a);
}

function resolveOwnAccount(name: string | null, accounts: Account[]): Account | undefined {
  if (!name) return undefined;
  return accounts.find((a) => !a.isGoalAccount && nameMatch(a.name, name));
}

function resolveCardOrAccount(
  name: string | null,
  accounts: Account[],
  debtAccounts: DebtAccount[],
): { account?: Account; debt?: DebtAccount } {
  if (!name) return {};
  const account = resolveOwnAccount(name, accounts);
  if (account) return { account };
  const debt = debtAccounts.find((d) => nameMatch(d.name, name));
  return debt ? { debt } : {};
}

function money(amount: number, currency: string): string {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

// Merge a fresh classification over the carried pending state (new values win;
// older collected fields fill gaps), so each follow-up adds what it knows.
function merge(
  prior: TransferPendingState | undefined,
  fresh: TransferClassification,
): TransferClassification {
  if (!prior) return fresh;
  return {
    kind: fresh.kind !== "unclear" && fresh.kind !== "not_transfer" ? fresh.kind : prior.transferKind,
    amount: fresh.amount ?? prior.amount,
    sourceName: fresh.sourceName ?? prior.sourceName,
    destinationName: fresh.destinationName ?? prior.destinationName,
    personName: fresh.personName ?? prior.personName,
    reason: fresh.reason ?? prior.reason,
    category: fresh.category ?? prior.category,
    inflowKind: fresh.inflowKind ?? prior.inflowKind,
    isLoan: fresh.isLoan || prior.isLoan,
    confidence: fresh.confidence,
  };
}

function toPending(c: TransferClassification): TransferPendingState {
  return {
    kind: "transfer_pending",
    transferKind: c.kind,
    amount: c.amount,
    sourceName: c.sourceName,
    destinationName: c.destinationName,
    personName: c.personName,
    reason: c.reason,
    category: c.category,
    inflowKind: c.inflowKind,
    isLoan: c.isLoan,
  };
}

function ask(question: string, pending: TransferPendingState): ChatTransactionResult {
  // Carry the partial state so the next reply completes it.
  return {
    ...buildChatTransactionClarificationResult({ clarificationQuestion: question }),
    assistantMetadata: { transferPending: pending },
  };
}

export interface TransferHandlerInput {
  userId: string;
  message: string;
  recentMessages: AdvisoryRecentMessage[];
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  channel?: ChatChannel;
  chatId?: string | null;
  prior?: TransferPendingState;
}

// Returns a result when this is a transfer (or a transfer follow-up), or null
// when the classifier decides it is not a transfer at all (fall through to the
// normal pipeline). Never writes without the minimum safe fields.
export async function handleTransferMessage(
  input: TransferHandlerInput,
): Promise<ChatTransactionResult | null> {
  const fresh = await classifyTransfer({
    message: input.message,
    recentMessages: input.recentMessages,
    accountNames: input.accounts.filter((a) => !a.isGoalAccount).map((a) => a.name),
    debtNames: input.debtAccounts.map((d) => d.name),
    goalNames: input.goals.map((g) => g.name),
  });

  const c = merge(input.prior, fresh);

  if (c.kind === "not_transfer") return null;
  if (c.kind === "unclear" && !input.prior) return null;

  const currencyFor = (account?: Account): CurrencyCode =>
    (account?.currency as CurrencyCode) ?? "USD";

  if (c.kind === "internal") {
    const source = resolveOwnAccount(c.sourceName, input.accounts);
    const destination = resolveOwnAccount(c.destinationName, input.accounts);
    if (!c.amount) {
      return ask("¿Cuánto moviste entre tus cuentas?", toPending(c));
    }
    if (!source) {
      return ask("¿De qué cuenta salió ese dinero?", toPending(c));
    }
    if (!destination) {
      return ask("¿A qué cuenta lo pasaste?", toPending(c));
    }
    if (source.id === destination.id) {
      return ask("Esas dos parecen la misma cuenta. ¿Cuál es el origen y cuál el destino?", toPending(c));
    }
    const intent: TransferIntent = {
      type: "transfer",
      description: c.reason ?? "Movimiento entre cuentas",
      originalAmount: c.amount,
      originalCurrency: currencyFor(source),
      confidenceScore: 0.9,
      status: "ready",
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      category: "other",
    };
    try {
      const result = await applyChatTransactionIntent({
        userId: input.userId,
        message: input.message,
        intent,
        accounts: input.accounts,
        debtAccounts: input.debtAccounts,
        goals: input.goals,
        parserSource: "ai",
        parserConfidenceScore: c.confidence,
        channel: input.channel,
        chatId: input.chatId,
      });
      logChatRoute({
        route: "internal_transfer",
        channel: input.channel,
        outcome: "internal_transfer",
        dbWrite: true,
      });
      return result;
    } catch {
      return buildChatTransactionFailedResult();
    }
  }

  if (c.kind === "debt_related") {
    logChatRoute({
      route: "transfer_debt_related",
      channel: input.channel,
      outcome: "clarification",
      dbWrite: false,
      validationReason: "debt_transfer_ambiguous",
    });
    return ask(
      "Eso toca una tarjeta. ¿Fue un pago de tu tarjeta, un adelanto de efectivo, o un reembolso? Dime cuál y lo registro bien.",
      toPending(c),
    );
  }

  if (c.kind === "person_out") {
    const { account, debt } = resolveCardOrAccount(
      c.sourceName,
      input.accounts,
      input.debtAccounts,
    );
    const missing: string[] = [];
    if (!c.amount) missing.push("amount");
    if (!account && !debt) missing.push("source");
    if (!c.reason && !c.category) missing.push("reason");

    if (missing.length > 0) {
      logChatRoute({
        route: "person_transfer",
        channel: input.channel,
        outcome: "person_transfer",
        dbWrite: false,
        missingFields: missing,
      });
      const who = c.personName ? ` a ${c.personName}` : "";
      const question = !c.amount
        ? `¿Cuánto le transferiste${who}?`
        : !account && !debt
          ? "¿De qué cuenta o tarjeta salió?"
          : `¿Para qué fue${who}? (comida, gasolina, su parte, etc.)`;
      return ask(question, toPending(c));
    }

    const recipient = c.personName ? ` a ${c.personName}` : "";
    const reasonText = c.reason ? `${c.reason}${recipient}` : `transferencia${recipient}`;
    const intent: ExpenseIntent = {
      type: "expense",
      description: c.isLoan
        ? `Préstamo${recipient}${c.reason ? ` (${c.reason})` : ""}`
        : reasonText,
      category: c.isLoan ? "other" : (c.category ?? "other"),
      originalAmount: c.amount as number,
      originalCurrency: currencyFor(account),
      confidenceScore: 0.9,
      status: "ready",
      sourceAccountId: account?.id,
      debtAccountId: debt?.id,
    };
    try {
      const result = await applyChatTransactionIntent({
        userId: input.userId,
        message: input.message,
        intent,
        accounts: input.accounts,
        debtAccounts: input.debtAccounts,
        goals: input.goals,
        parserSource: "ai",
        parserConfidenceScore: c.confidence,
        channel: input.channel,
        chatId: input.chatId,
      });
      logChatRoute({
        route: "person_transfer",
        channel: input.channel,
        outcome: "person_transfer",
        dbWrite: true,
        transactionType: c.isLoan ? "expense(loan)" : "expense",
      });
      // For a loan, also open a receivable so the money owed back is tracked
      // separately from ordinary spending.
      if (c.isLoan) {
        const amountText = money(c.amount as number, currencyFor(account));
        await createReceivable({
          userId: input.userId,
          counterparty: c.personName ?? "alguien",
          direction: "owed_to_user",
          amount: c.amount as number,
          currency: currencyFor(account),
          reason: c.reason ?? undefined,
        });
        logChatRoute({
          route: "person_transfer",
          channel: input.channel,
          outcome: "person_transfer",
          dbWrite: true,
          transactionType: "receivable_open",
        });
        return buildChatActionResult({
          redirectCode: "chat-expense-created",
          message: `Anotado el préstamo de ${amountText}${recipient}. Lo guardo como dinero que te deben; cuando te lo devuelvan, dímelo y lo cierro.`,
        });
      }
      return result;
    } catch {
      return buildChatTransactionFailedResult();
    }
  }

  if (c.kind === "person_in") {
    const destination = resolveOwnAccount(c.destinationName, input.accounts);
    const missing: string[] = [];
    if (!c.amount) missing.push("amount");
    if (!destination) missing.push("destination");
    if (!c.inflowKind) missing.push("meaning");

    if (missing.length > 0) {
      logChatRoute({
        route: "person_transfer",
        channel: input.channel,
        outcome: "person_transfer",
        dbWrite: false,
        missingFields: missing,
      });
      const question = !c.amount
        ? "¿Cuánto te transfirieron?"
        : !destination
          ? "¿A qué cuenta te llegó?"
          : "¿Qué fue: un pago/ingreso, un reembolso de algo que pagaste, o que te devolvieran un préstamo?";
      return ask(question, toPending(c));
    }

    const dest = destination as Account;
    const who = c.personName ? ` de ${c.personName}` : "";
    if (c.inflowKind === "refund") {
      const intent: RefundIntent = {
        type: "refund",
        description: `Reembolso${who}${c.reason ? ` (${c.reason})` : ""}`,
        originalAmount: c.amount as number,
        originalCurrency: currencyFor(dest),
        confidenceScore: 0.9,
        status: "ready",
        destinationAccountId: dest.id,
        category: c.category ?? "other",
      };
      try {
        const result = await applyChatTransactionIntent({
          userId: input.userId,
          message: input.message,
          intent,
          accounts: input.accounts,
          debtAccounts: input.debtAccounts,
          goals: input.goals,
          parserSource: "ai",
          parserConfidenceScore: c.confidence,
          channel: input.channel,
          chatId: input.chatId,
        });
        logChatRoute({
          route: "person_transfer",
          channel: input.channel,
          outcome: "person_transfer",
          dbWrite: true,
          transactionType: "refund",
        });
        return result;
      } catch {
        return buildChatTransactionFailedResult();
      }
    }

    // income or loan_repayment → inflow to the account. Loan repayments are
    // tagged in the description until the receivable ledger lands.
    const intent: IncomeIntent = {
      type: "income",
      description:
        c.inflowKind === "loan_repayment"
          ? `Devolución de préstamo${who}`
          : `Ingreso${who}${c.reason ? ` (${c.reason})` : ""}`,
      originalAmount: c.amount as number,
      originalCurrency: currencyFor(dest),
      confidenceScore: 0.9,
      status: "ready",
      destinationAccountId: dest.id,
      category: "income",
    };
    try {
      const result = await applyChatTransactionIntent({
        userId: input.userId,
        message: input.message,
        intent,
        accounts: input.accounts,
        debtAccounts: input.debtAccounts,
        goals: input.goals,
        parserSource: "ai",
        parserConfidenceScore: c.confidence,
        channel: input.channel,
        chatId: input.chatId,
      });
      logChatRoute({
        route: "person_transfer",
        channel: input.channel,
        outcome: "person_transfer",
        dbWrite: true,
        transactionType: c.inflowKind === "loan_repayment" ? "income(repayment)" : "income",
      });
      // A repayment also closes (or reduces) the matching receivable.
      if (c.inflowKind === "loan_repayment") {
        const { matched } = await applyReceivableRepayment({
          userId: input.userId,
          counterparty: c.personName,
          amount: c.amount as number,
        });
        if (matched > 0) {
          return buildChatActionResult({
            redirectCode: "chat-income-created",
            message: `Listo, registré la devolución de ${money(c.amount as number, currencyFor(dest))}${who} y la desconté de lo que te debían.`,
          });
        }
      }
      return result;
    } catch {
      return buildChatTransactionFailedResult();
    }
  }

  // unclear but we had prior context → ask to keep collecting.
  return ask(
    "¿Esto fue un movimiento entre tus cuentas, o le transferiste a alguien? Dime para registrarlo bien.",
    toPending(c),
  );
}
