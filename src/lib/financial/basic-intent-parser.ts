import type { Account, DebtAccount, FinancialCategory } from "@/types/financial";
import type { TransactionIntent } from "@/types/transaction-intents";

export interface BasicIntentParserInput {
  message: string;
  accounts: Account[];
  debtAccounts: DebtAccount[];
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
  const normalizedMessage = normaze(input.message);
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

  const debtAccount = findDebtAccount(normalizedMessage, input.debtAccounts);
  const account = findAccount(normalizedMessage, input.accounts);
  const category = inferCategory(normalizedMessage);

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
    const goalAccount = input.accounts.find((item) => item.isGoalAccount);

    return {
      type: "goal_contribution",
      description: input.message,
      originalAmount: amount,
      originalCurrency: baseCurrency,
      baseCurrency,
      sourceAccountId: account?.id ?? "",
      destinationAccountId: goalAccount?.id ?? "",
      goalId: "goal-brazil",
      confidenceScore: account && goalAccount ? 0.82 : 0.55,
      status: account && goalAccount ? "ready" : "needs_clarification",
      category: "savings",
    };
  }

  if (debtAccount) {
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

function findAccount(message: string, accounts: Account[]): Account | undefined {
  return accounts.find((account) => {
    const accountName = normalize(account.name);
    return message.includes(accountName);
  });
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

function inferCategory(message: string): FinancialCategory {
  const match = categoryKeywords.find((item) =>
    item.keywords.some((keyword) => message.includes(normalize(keyword))),
  );

  return match?.category ?? "other";
}

function isDebtPayment(message: string): boolean {
  return message.includes("pague") || message.includes("pago") || message.includes("pagar");
}

function isGoalContribution(message: string): boolean {
  return (
    message.includes("mande") ||
    message.includes("mandé") ||
    message.includes("aporte") ||
    message.includes("ahorre") ||
    message.includes("ahorré")
  );
}
