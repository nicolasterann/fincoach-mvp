import type { DebtAccount } from "@/types/financial";
import { roundMoney } from "@/lib/financial/money";
import { recurringMonthlyDebtObligation } from "@/lib/financial/card-cycle";

export type DebtPressureLevel = "none" | "low" | "medium" | "high" | "critical";

export interface DebtPressureInput {
  debtAccounts: DebtAccount[];
  monthlyIncome: number;
}

export interface DebtPressureResult {
  totalDebt: number;
  monthlyDebtDue: number;
  debtToIncomeRatio: number;
  level: DebtPressureLevel;
  message: string;
}

export function calculateDebtPressure(input: DebtPressureInput): DebtPressureResult {
  const totalDebt = roundMoney(
    input.debtAccounts.reduce((total, debt) => total + debt.currentBalanceBase, 0),
  );

  // Recurring monthly obligation (cards → minimum, not the full statement; loans →
  // cuota) so debt-to-income never over-states pressure for a paid-off-monthly card.
  // Same ONE rule as capacity/flexible-spending; totalDebt above still carries the
  // full balances, so "how much you owe" is unaffected.
  const monthlyDebtDue = roundMoney(
    input.debtAccounts.reduce((total, debt) => total + recurringMonthlyDebtObligation(debt), 0),
  );

  const monthlyIncome = Math.max(input.monthlyIncome, 0);
  const debtToIncomeRatio =
    monthlyIncome === 0 ? 0 : roundMoney(monthlyDebtDue / monthlyIncome);

  if (totalDebt <= 0) {
    return {
      totalDebt,
      monthlyDebtDue,
      debtToIncomeRatio,
      level: "none",
      message: "No tienes deuda registrada. Hermoso, cuidemos esa paz financiera.",
    };
  }

  if (monthlyIncome <= 0) {
    return {
      totalDebt,
      monthlyDebtDue,
      debtToIncomeRatio,
      level: "critical",
      message:
        "Hay deuda registrada, pero no tenemos ingresos mensuales claros. Necesitamos ordenar esto antes de prometer metas agresivas.",
    };
  }

  if (debtToIncomeRatio <= 0.1) {
    return {
      totalDebt,
      monthlyDebtDue,
      debtToIncomeRatio,
      level: "low",
      message: "Tu presión de deuda es baja. Podemos avanzar con la meta sin descuidarla.",
    };
  }

  if (debtToIncomeRatio <= 0.25) {
    return {
      totalDebt,
      monthlyDebtDue,
      debtToIncomeRatio,
      level: "medium",
      message:
        "Tu presión de deuda es media. La meta sigue viva, pero debemos cuidaros pagos.",
    };
  }

  if (debtToIncomeRatio <= 0.4) {
    return {
      totalDebt,
      monthlyDebtDue,
      debtToIncomeRatio,
      level: "high",
      message:
        "Tu deuda está presionando bastante tu flujo. Antes de acelerar la meta, cuidemos pagos e intereses.",
    };
  }

  return {
    totalDebt,
    monthlyDebtDue,
    debtToIncomeRatio,
    level: "critical",
    message:
      "La deuda está en zona crítica. No vamos a matar tus metas, pero primero necesitamos proteger tu estabilidad financiera.",
  };
}
