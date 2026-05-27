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

  if (!amount) {
    return {
      type: "adjustment",
      description: input.message,
      originalAmount: 0,
      originalCurrency: baseCurrency,
      baseCurrency,
      confidenceScore: 0.1,
      status: "needs_clarification",
      category: "other",
    };
  }

  const explicitDebtAccount = findDebtAccount(normalizedMessage, input.debtAccounts);
  const explicitAccount = findAccount(normalizedMessage, input.accounts);
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
      originalCurrency: baseCurrency,
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
      originalCurrency: baseCurrency,
      baseCurrency,
      sourceAccountId: account?.id ?? "",
      debtAccountId: debtAccount?.id ?? "",
      confidenceScore: account && debtAccount ? 0.86 : 0.55,
      status: account && debtAccount ? "ready" : "needs_clarification",
      category: "debt",
    };
  }

  if (isGoalContribution(normalizedMessage)) {
    const namedTarget = extractGoalTargetPhrase(normalizedMessage);
    const reducedTarget = namedTarget ? reduceTargetToName(namedTarget) : "";

    // Named-goal resolution:
    //   • If the user named a specific target (non-generic), only accept
    //     it when it matches an existing goal. This prevents silently
    //     applying "mandé 20 a boda" to "Viaje a Brasil".
    //   • Generic references like "mi meta" or "mis ahorros" fall back
    //     to the main goal.
    let goal: FinancialGoal | undefined;
    let unresolvedGoalName: string | undefined;

    if (namedTarget && reducedTarget) {
      goal = findGoalByReducedTarget(reducedTarget, input.goals ?? []);
      if (!goal) {
        unresolvedGoalName = namedTarget;
      }
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
        originalCurrency: baseCurrency,
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
      originalCurrency: baseCurrency,
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
      originalCurrency: baseCurrency,
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
    originalCurrency: baseCurrency,
    baseCurrency,
    category,
    sourceAccountId: account?.id,
    confidenceScore: account ? 0.78 : 0.52,
    status: account ? "ready" : "needs_clarification",
  };
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
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function extractFirstAmount(message: string): number | null {
  const match = message.match(/(?:\$|\busd\s*)?(\d+(?:[.,]\d{1,2})?)/i);
  if (!match?.[1]) return null;

  return Number(match[1].replace(",", "."));
}

// Generic banking words that show up inside long account names like
// "Cuenta de ahorro Produbanco". They must not count as a match on their
// own, otherwise messages like "me pagaron 100 en produbanco" would
// silently pick the wrong account just because both contain "cuenta".
const GENERIC_ACCOUNT_TOKENS = new Set([
  "cuenta",
  "cuentas",
  "ahorro",
  "ahorros",
  "corriente",
  "corrientes",
  "banco",
  "bancos",
  "de",
  "del",
  "la",
  "el",
  "mi",
  "tu",
  "una",
  "uno",
  "en",
  "para",
]);

function findAccount(message: string, accounts: Account[]): Account | undefined {
  // First try the full normalized name (most specific). This keeps the
  // historical behavior for short names like "Pichincha".
  const fullMatch = accounts.find((account) =>
    message.includes(normalize(account.name)),
  );
  if (fullMatch) return fullMatch;

  // Fall back to distinctive tokens so "Cuenta de ahorro Produbanco"
  // still matches a message that only mentions "produbanco".
  return accounts.find((account) => {
    const tokens = normalize(account.name)
      .split(/\s+/)
      .filter(
        (token) => token.length >= 4 && !GENERIC_ACCOUNT_TOKENS.has(token),
      );
    return tokens.some((token) => message.includes(token));
  });
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

function findDebtAccount(
  message: string,
  debtAccounts: DebtAccount[],
): DebtAccount | undefined {
  return debtAccounts.find((debtAccount) => {
    const debtName = normalize(debtAccount.name);
    const tokens = debtName.split(" ");
    return message.includes(debtName) || tokens.some((token) => message.includes(token));
  });
}

// Extracts the substring the user wrote after "a"/"para" and before
// "desde …" (the source clause). Returns null when the message has no
// explicit target phrase, e.g. "aporté 20 desde pichincha".
function extractGoalTargetPhrase(normalizedMessage: string): string | null {
  const amountMatch = normalizedMessage.match(/(?:\$|\busd\s*)?(\d+(?:[.,]\d{1,2})?)/i);
  if (!amountMatch || amountMatch.index === undefined) return null;

  const afterAmount = normalizedMessage
    .slice(amountMatch.index + amountMatch[0].length)
    .trim();
  if (!afterAmount) return null;

  const desdeMatch = afterAmount.match(/\bdesde\b/);
  const candidate = desdeMatch
    ? afterAmount.slice(0, desdeMatch.index).trim()
    : afterAmount.trim();
  if (!candidate) return null;

  // Strip the leading preposition (a / para / al / hacia) so what
  // remains is the user's bare target phrase.
  const trimmed = candidate.replace(/^(?:a|para|al|hacia)\s+/, "").trim();
  if (!trimmed) return null;

  return trimmed;
}

// Removes generic words ("mi", "la", "meta", "ahorro", connectors like
// "de" / "del") and returns the distinctive part of the target. Returns
// "" for fully generic references like "mi meta", which means: fall
// back to the main goal.
function reduceTargetToName(target: string): string {
  return target
    .replace(/^(?:la|el|mi|mis|tu|tus|una|un|los|las)\s+/, "")
    .replace(/\b(?:la|el|mi|mis|tu|tus|una|un|los|las)\b/g, "")
    .replace(/\b(?:meta|metas|ahorro|ahorros|sueno|objetivo|objetivos)\b/g, "")
    .replace(/\b(?:de|del|para|hacia|al|a)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findGoalByReducedTarget(
  reducedTarget: string,
  goals: FinancialGoal[],
): FinancialGoal | undefined {
  const targetTokens = reducedTarget
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  if (targetTokens.length === 0) return undefined;

  return goals.find((goal) => {
    const goalName = normalize(goal.name);
    if (goalName === reducedTarget) return true;
    if (goalName.includes(reducedTarget) || reducedTarget.includes(goalName)) {
      return true;
    }
    const goalTokens = goalName
      .split(/\s+/)
      .filter((token) => token.length >= 3);
    return targetTokens.some((targetToken) => goalTokens.includes(targetToken));
  });
}

function inferCategory(message: string): FinancialCategory {
  const match = categoryKeywords.find((item) =>
    item.keywords.some((keyword) => message.includes(normalize(keyword))),
  );

  return match?.category ?? "other";
}

function hasDebtSignal(message: string): boolean {
  const debtSignals = [
    "visa",
    "mastercard",
    "amex",
    "diners",
    "discover",
    "tarjeta",
    "credito",
    "crédito",
    "tc",
  ];

  return debtSignals.some((signal) => message.includes(normalize(signal)));
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
