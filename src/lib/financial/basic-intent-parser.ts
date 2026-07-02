import { resolveGoalTarget } from "@/lib/financial/goal-target-resolver";
import {
  findExplicitAccount,
  findExplicitDebtAccount,
  hasDebtSignal,
  normalizeForSourceMatch,
} from "@/lib/financial/payment-source-resolver";
import type { Account, DebtAccount, FinancialCategory, FinancialGoal, UserFinancialPreferences } from "@/types/financial";
import type { TransactionIntent } from "@/types/transaction-intents";

export interface BasicIntentParserInput {
  message: string;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals?: FinancialGoal[];
  mainGoal?: FinancialGoal | null;
  preferences?: UserFinancialPreferences | null;
  baseCurrency?: string;
}

const categoryKeywords: Array<{
  keywords: string[];
  category: FinancialCategory;
}> = [
  { keywords: ["cafe", "café", "almuerzo", "comida", "mc", "mcdonald", "restaurante"], category: "food" },
  { keywords: ["uber", "taxi", "bus", "transporte"], category: "transport" },
  { keywords: ["zapatos", "ropa", "vestido", "camisa"], category: "shopping" },
  { keywords: ["netflix", "spotify", "suscripcion", "suscripción"], category: "subscriptions" },
  { keywords: ["viaje", "brasil", "punta cana"], category: "travel" },
];

export function parseBasicTransactionIntent(
  input: BasicIntentParserInput,
): TransactionIntent {
  const normalizedMessage = normalize(input.message);
  const amount = extractFirstAmount(normalizedMessage);
  const baseCurrency = input.baseCurrency ?? "USD";
  // "gasté 20000 pesos" must NOT be stamped as the base currency (a founder with
  // base USD would get a 20,000$ expense). Detect an explicitly-named currency;
  // bare "pesos" resolves against the user's own currencies (accounts/debts/base).
  // Nothing detected → base, exactly as before.
  const detectedCurrency = detectExplicitCurrency(normalizedMessage, input);

  if (!amount) {
    return {
      type: "adjustment",
      description: input.message,
      originalAmount: 0,
      originalCurrency: detectedCurrency ?? baseCurrency,
      baseCurrency,
      confidenceScore: 0.1,
      status: "needs_clarification",
      category: "other",
    };
  }

  const explicitDebtAccount = findExplicitDebtAccount(normalizedMessage, input.debtAccounts);
  const explicitAccount = findExplicitAccount(normalizedMessage, input.accounts);
  const defaultSource = resolveDefaultSource(input);
  const debtAccount = explicitDebtAccount ?? defaultSource.debtAccount;
  const account = explicitAccount ?? defaultSource.account;
  const hasExplicitPaymentSource = Boolean(explicitDebtAccount || explicitAccount);
  const category = inferCategory(normalizedMessage);

  if (isIncome(normalizedMessage)) {
    return {
      type: "income",
      description: input.message,
      originalAmount: amount,
      originalCurrency: detectedCurrency ?? baseCurrency,
      baseCurrency,
      destinationAccountId: account?.id ?? "",
      confidenceScore: account ? 0.82 : 0.55,
      status: account ? "ready" : "needs_clarification",
      category: "income",
    };
  }

  if (isDebtPayment(normalizedMessage)) {
    return {
      type: "debt_payment",
      description: input.message,
      originalAmount: amount,
      originalCurrency: detectedCurrency ?? baseCurrency,
      baseCurrency,
      sourceAccountId: account?.id ?? "",
      debtAccountId: debtAccount?.id ?? "",
      confidenceScore: account && debtAccount ? 0.86 : 0.55,
      status: account && debtAccount ? "ready" : "needs_clarification",
      category: "debt",
    };
  }

  if (isGoalContribution(normalizedMessage)) {
    // Named-goal resolution:
    //   • If the user named a specific target (non-generic), only accept
    //     it when it matches an existing goal. This prevents silently
    //     applying "mandé 20 a boda" to "Viaje a Brasil".
    //   • Generic references like "mi meta" or "mis ahorros" fall back
    //     to the main goal.
    const resolution = resolveGoalTarget(input.message, input.goals ?? []);
    let goal: FinancialGoal | undefined;
    let unresolvedGoalName: string | undefined;

    if (resolution.kind === "matched") {
      goal = resolution.matchedGoal;
    } else if (resolution.kind === "unresolved") {
      unresolvedGoalName = resolution.unresolvedName;
    } else {
      goal = input.mainGoal ?? input.goals?.[0];
    }

    const goalAccount = goal?.goalAccountId
      ? input.accounts.find((item) => item.id === goal.goalAccountId)
      : input.accounts.find((item) => item.isGoalAccount);

    // Source resolution order for goal contributions:
    //   1. explicit account name in the message (already in `account`)
    //   2. user's default source from preferences (also in `account`)
    //   3. if exactly one non-goal account exists, use it
    // Otherwise stay at needs_clarification so the adapter can ask which
    // account the contribution came from.
    const sourceAccount =
      account ?? findSingleNonGoalAccount(input.accounts, goal?.goalAccountId);

    if (unresolvedGoalName) {
      return {
        type: "goal_contribution",
        description: input.message,
        originalAmount: amount,
        originalCurrency: detectedCurrency ?? baseCurrency,
        baseCurrency,
        sourceAccountId: sourceAccount?.id ?? "",
        destinationAccountId: goalAccount?.id ?? "",
        goalId: "",
        confidenceScore: 0.45,
        status: "needs_clarification",
        category: "savings",
        unresolvedGoalName,
      };
    }

    return {
      type: "goal_contribution",
      description: input.message,
      originalAmount: amount,
      originalCurrency: detectedCurrency ?? baseCurrency,
      baseCurrency,
      sourceAccountId: sourceAccount?.id ?? "",
      destinationAccountId: goalAccount?.id ?? "",
      goalId: goal?.id ?? "",
      confidenceScore: sourceAccount && goal ? 0.84 : 0.55,
      status: sourceAccount && goal ? "ready" : "needs_clarification",
      category: "savings",
    };
  }

  const shouldUseDebtAccount =
    debtAccount &&
    (!account || hasDebtSignal(normalizedMessage) || !hasExplicitPaymentSource);

  if (shouldUseDebtAccount) {
    return {
      type: "expense",
      description: input.message,
      originalAmount: amount,
      originalCurrency: detectedCurrency ?? baseCurrency,
      baseCurrency,
      category,
      debtAccountId: debtAccount.id,
      confidenceScore: 0.82,
      status: "ready",
    };
  }

  return {
    type: "expense",
    description: input.message,
    originalAmount: amount,
    originalCurrency: detectedCurrency ?? baseCurrency,
    baseCurrency,
    category,
    sourceAccountId: account?.id,
    confidenceScore: account ? 0.78 : 0.52,
    status: account ? "ready" : "needs_clarification",
  };
}

// Explicitly-named currency in the message. Codes and unambiguous words map
// directly; the bare word "pesos" is ambiguous across LatAm, so it resolves
// against the currencies THIS user actually has (accounts/debts/base): exactly
// one peso-family currency → that one; otherwise null (fall back to base, the
// pre-existing behavior — never guess a currency the user doesn't use).
const PESO_FAMILY = ["ARS", "COP", "CLP", "MXN", "UYU"];
export function detectExplicitCurrency(
  normalizedMessage: string,
  input: Pick<BasicIntentParserInput, "accounts" | "debtAccounts" | "baseCurrency">,
): string | null {
  const m = ` ${normalizedMessage} `;
  const has = (re: RegExp) => re.test(m);
  if (has(/\b(usd|dolar(es)?)\b/) || m.includes("u$s")) return "USD";
  if (has(/\b(eur|euros?)\b/) || m.includes("€")) return "EUR";
  if (has(/\bars\b/)) return "ARS";
  if (has(/\bcop\b/)) return "COP";
  if (has(/\bclp\b/)) return "CLP";
  if (has(/\bmxn\b/)) return "MXN";
  if (has(/\b(pen|soles?)\b/)) return "PEN";
  if (has(/\b(brl|reales?)\b/)) return "BRL";
  if (has(/\bpesos?\b/)) {
    const base = (input.baseCurrency ?? "USD").toUpperCase();
    if (PESO_FAMILY.includes(base)) return base; // "pesos" = the user's own peso
    const userCurrencies = new Set(
      [...input.accounts, ...input.debtAccounts]
        .map((a) => (a.currency ?? "").toUpperCase())
        .filter(Boolean),
    );
    const pesoMatches = PESO_FAMILY.filter((code) => userCurrencies.has(code));
    if (pesoMatches.length === 1) return pesoMatches[0];
  }
  return null;
}

function resolveDefaultSource(input: BasicIntentParserInput): {
  account?: Account;
  debtAccount?: DebtAccount;
} {
  if (!input.preferences?.defaultSourceType || !input.preferences.defaultSourceId) {
    return {};
  }

  if (input.preferences.defaultSourceType === "account") {
    return {
      account: input.accounts.find(
        (account) => account.id === input.preferences?.defaultSourceId,
      ),
    };
  }

  if (input.preferences.defaultSourceType === "debt_account") {
    return {
      debtAccount: input.debtAccounts.find(
        (debtAccount) => debtAccount.id === input.preferences?.defaultSourceId,
      ),
    };
  }

  return {};
}

function normalize(value: string): string {
  return normalizeForSourceMatch(value);
}

function extractFirstAmount(message: string): number | null {
  const match = message.match(/(?:\$|\busd\s*)?(\d+(?:[.,]\d{1,2})?)/i);
  if (!match?.[1]) return null;

  return Number(match[1].replace(",", "."));
}

// If the user has exactly one non-goal account, treat it as the implicit
// source for "mandé 20 a boda" so single-account users are not blocked
// for not naming it. Returns undefined when there are zero or multiple
// candidates (we must clarify instead of guessing).
function findSingleNonGoalAccount(
  accounts: Account[],
  goalAccountId?: string,
): Account | undefined {
  const candidates = accounts.filter(
    (account) => !account.isGoalAccount && account.id !== goalAccountId,
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}


function inferCategory(message: string): FinancialCategory {
  const match = categoryKeywords.find((item) =>
    item.keywords.some((keyword) => message.includes(normalize(keyword))),
  );

  return match?.category ?? "other";
}

function isIncome(message: string): boolean {
  const incomeSignals = [
    "me pagaron",
    "recibi",
    "recibí",
    "entro",
    "entró",
    "ingreso",
    "sueldo",
    "salario",
    "freelance",
    "cobre",
    "cobré",
    "depositaron",
    "me depositaron",
  ];

  return incomeSignals.some((signal) => message.includes(normalize(signal)));
}

function isDebtPayment(message: string): boolean {
  return message.includes("pague") || message.includes("pago") || message.includes("pagar");
}

function isGoalContribution(message: string): boolean {
  // `message` arrives normalized (lowercase, diacritics stripped) so we
  // only need the unaccented forms here.
  return (
    message.includes("mande") ||
    message.includes("aporte") ||
    message.includes("ahorre") ||
    message.includes("meti") ||
    message.includes("guarde")
  );
}
