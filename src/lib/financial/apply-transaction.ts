import type { Account, DebtAccount } from "@/types/financial";
import type {
  DebtPaymentIntent,
  ExpenseIntent,
  GoalContributionIntent,
  IncomeIntent,
  TransactionIntent,
  TransferIntent,
} from "@/types/transaction-intents";
import { roundMoney } from "@/lib/financial/money";

export interface ApplyTransactionInput<TIntent extends TransactionIntent = TransactionIntent> {
  accounts: Account[];
  debtAccounts: DebtAccount[];
  intent: TIntent;
}

export interface ApplyTransactionResult {
  accounts: Account[];
  debtAccounts: DebtAccount[];
  message: string;
}

export function applyTransactionIntent(
  input: ApplyTransactionInput,
): ApplyTransactionResult {
  switch (input.intent.type) {
    case "expense":
      return applyExpense({ ...input, intent: input.intent });
    case "income":
      return applyIncome({ ...input, intent: input.intent });
    case "transfer":
      return applyTransfer({ ...input, intent: input.intent });
    case "debt_payment":
      return applyDebtPayment({ ...input, intent: input.intent });
    case "goal_contribution":
      return applyGoalContribution({ ...input, intent: input.intent });
    default:
      return {
        accounts: input.accounts,
        debtAccounts: input.debtAccounts,
        message: "Este tipo de movimiento todavía no está implementado en el motor.",
      };
  }
}

function applyExpense(input: ApplyTransactionInput<ExpenseIntent>): ApplyTransactionResult {
  const amount = getBaseAmount(input.intent);

  if (input.intent.debtAccountId) {
    const debtAccounts = input.debtAccounts.map((debt) => {
      if (debt.id !== input.intent.debtAccountId) return debt;

      return {
        ...debt,
        currentBalanceBase: roundMoney(debt.currentBalanceBase + amount),
        currentBalanceOriginal: roundMoney(debt.currentBalanceOriginal + amount),
      };
    });

    return {
      accounts: input.accounts,
      debtAccounts,
      message:
        "Gasto registrado con tarjeta: aumenta la deuda, pero no baja tu efectivo hoy.",
    };
  }

  if (!input.intent.sourceAccountId) {
    return {
      accounts: input.accounts,
      debtAccounts: input.debtAccounts,
      message:
        "Me falta saber desde dónde salió este gasto para actualizar tus saldos.",
    };
  }

  const accounts = input.accounts.map((account) => {
    if (account.id !== input.intent.sourceAccountId) return account;

    return {
      ...account,
      currentBalanceBase: roundMoney(account.currentBalanceBase - amount),
      currentBalanceOriginal: roundMoney(account.currentBalanceOriginal - amount),
    };
  });

  return {
    accounts,
    debtAccounts: input.debtAccounts,
    message: "Gasto registrado: baja tu saldo disponible.",
  };
}

function applyIncome(input: ApplyTransactionInput<IncomeIntent>): ApplyTransactionResult {
  const amount = getBaseAmount(input.intent);

  const accounts = input.accounts.map((account) => {
    if (account.id !== input.intent.destinationAccountId) return account;

    return {
      ...account,
      currentBalanceBase: roundMoney(account.currentBalanceBase + amount),
      currentBalanceOriginal: roundMoney(account.currentBalanceOriginal + amount),
    };
  });

  return {
    accounts,
    debtAccounts: input.debtAccounts,
    message: "Ingreso registrado: sube tu saldo disponible.",
  };
}

function applyTransfer(input: ApplyTransactionInput<TransferIntent>): ApplyTransactionResult {
  const amount = getBaseAmount(input.intent);

  const accounts = input.accounts.map((account) => {
    if (account.id === input.intent.sourceAccountId) {
      return {
        ...account,
        currentBalanceBase: roundMoney(account.currentBalanceBase - amount),
        currentBalanceOriginal: roundMoney(account.currentBalanceOriginal - amount),
      };
    }

    if (account.id === input.intent.destinationAccountId) {
      return {
        ...account,
        currentBalanceBase: roundMoney(account.currentBalanceBase + amount),
        currentBalanceOriginal: roundMoney(account.currentBalanceOriginal + amount),
      };
    }

    return account;
  });

  return {
    accounts,
    debtAccounts: input.debtAccounts,
    message: "Transferencia registrada: movimos dinero entre tus cuentas.",
  };
}

function applyDebtPayment(input: ApplyTransactionInput<DebtPaymentIntent>): ApplyTransactionResult {
  const amount = getBaseAmount(input.intent);

  const accounts = input.accounts.map((account) => {
    if (account.id !== input.intent.sourceAccountId) return account;

    return {
      ...account,
      currentBalanceBase: roundMoney(account.currentBalanceBase - amount),
      currentBalanceOriginal: roundMoney(account.currentBalanceOriginal - amount),
    };
  });

  const debtAccounts = input.debtAccounts.map((debt) => {
    if (debt.id !== input.intent.debtAccountId) return debt;

    return {
      ...debt,
      currentBalanceBase: roundMoney(Math.max(debt.currentBalanceBase - amount, 0)),
      currentBalanceOriginal: roundMoney(Math.max(debt.currentBalanceOriginal - amount, 0)),
    };
  });

  return {
    accounts,
    debtAccounts,
    message:
      "Pago de deuda registrado: baja tu cuenta, pero no cuenta como gasto nuevo.",
  };
}

function applyGoalContribution(input: ApplyTransactionInput<GoalContributionIntent>): ApplyTransactionResult {
  const amount = getBaseAmount(input.intent);

  const accounts = input.accounts.map((account) => {
    if (account.id === input.intent.sourceAccountId) {
      return {
        ...account,
        currentBalanceBase: roundMoney(account.currentBalanceBase - amount),
        currentBalanceOriginal: roundMoney(account.currentBalanceOriginal - amount),
      };
    }

    if (account.id === input.intent.destinationAccountId) {
      return {
        ...account,
        currentBalanceBase: roundMoney(account.currentBalanceBase + amount),
        currentBalanceOriginal: roundMoney(account.currentBalanceOriginal + amount),
      };
    }

    return account;
  });

  return {
    accounts,
    debtAccounts: input.debtAccounts,
    message: "Aporte a la meta registrado: ese dinero ya vive en su lugar.",
  };
}

function getBaseAmount(intent: TransactionIntent): number {
  const exchangeRateToBase = intent.exchangeRateToBase ?? 1;
  return roundMoney(intent.originalAmount * exchangeRateToBase);
}
