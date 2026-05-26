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
    const goal = findGoal(normalizedMessage, input.goals ?? [], input.mainGoal);
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

function findGoal(
  message: string,
  goals: FinancialGoal[],
  mainGoal?: FinancialGoal | null,
): FinancialGoal | undefined {
  const explicitGoal = goals.find((goal) => {
    const goalName = normalize(goal.name);
    const tokens = goalName.split(" ").filter((token) => token.length >= 3);

    return message.includes(goalName) || tokens.some((token) => message.includes(token));
  });

  return explicitGoal ?? mainGoal ?? goals[0];
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
