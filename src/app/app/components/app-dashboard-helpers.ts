import type { Account, CoachTone, DebtAccount, FinancialGoal } from "@/types/financial";

export type MetricStatus = "good" | "ok" | "warn" | "bad" | "neutral";
export type ReadinessMode = "stable" | "adjusted" | "defense" | "risk";

export interface ReadinessResult {
  score: number;
  mode: ReadinessMode;
  modeLabel: string;
  message: string;
}

export interface BudgetRealityState {
  label: string;
  message: string;
}

export function computeFinancialReadiness(
  flexibleSpending: number,
  debtLevel: string,
  goalProgressPct: number,
  weeklyPlanStatus: string,
): ReadinessResult {
  let score = 60;

  if (flexibleSpending > 150) score += 15;
  else if (flexibleSpending > 50) score += 10;
  else if (flexibleSpending > 0) score += 4;
  else score -= 15;

  if (debtLevel === "none") score += 10;
  else if (debtLevel === "low") score += 5;
  else if (debtLevel === "high") score -= 12;
  else if (debtLevel === "critical") score -= 22;

  if (goalProgressPct >= 10) score += 8;
  else if (goalProgressPct > 0) score += 4;

  if (weeklyPlanStatus === "healthy") score += 7;
  else if (weeklyPlanStatus === "negative") score -= 10;

  score = Math.min(95, Math.max(10, score));

  let mode: ReadinessMode;
  let modeLabel: string;
  if (score >= 75) {
    mode = "stable";
    modeLabel = "Estable";
  } else if (score >= 55) {
    mode = "adjusted";
    modeLabel = "Ajustado";
  } else if (score >= 35) {
    mode = "defense";
    modeLabel = "Modo defensa";
  } else {
    mode = "risk";
    modeLabel = "Necesita atención";
  }

  const messages: Record<ReadinessMode, string> = {
    stable: "Tienes margen, tu meta avanza y los compromisos están cubiertos. Sigue así.",
    adjusted:
      "Esta semana toca cuidar el margen. Primero cubramos compromisos y luego vemos qué espacio queda.",
    defense:
      "Semana apretada, pero no rota. Ordenemos pagos críticos y protejamos la meta sin forzarla.",
    risk: "Esta semana toca cuidar cada paso. Primero los pagos críticos — la meta está protegida, no cancelada.",
  };

  return { score, mode, modeLabel, message: messages[mode] };
}

export function computeFinancialAccuracy(
  hasIncomeSources: boolean,
  hasFixedExpenses: boolean,
  transactionCount: number,
  hasDebtAccounts: boolean,
  accountCount: number,
): number {
  let score = 40;
  if (hasIncomeSources) score += 20;
  if (hasFixedExpenses) score += 15;
  if (transactionCount > 0) score += 15;
  if (hasDebtAccounts || accountCount >= 2) score += 10;
  if (transactionCount === 0) return Math.min(score, 65);
  if (transactionCount < 5) return Math.min(score, 75);
  return Math.min(score, 85);
}

export function getBudgetRealityState(transactionCount: number): BudgetRealityState {
  if (transactionCount === 0) {
    return { label: "Sin datos", message: "Todavía estoy conociendo tu vida real." };
  }
  if (transactionCount < 5) {
    return { label: "Primeras señales", message: "Ya tengo primeras señales reales." };
  }
  return { label: "Aprendiendo", message: "Empiezo a ver tu patrón de gasto." };
}

export function getReadinessClasses(mode: ReadinessMode): {
  bg: string;
  score: string;
  bar: string;
  badge: string;
} {
  const map: Record<ReadinessMode, { bg: string; score: string; bar: string; badge: string }> = {
    stable: {
      bg: "border border-emerald-500/20 bg-emerald-950/50",
      score: "text-emerald-300",
      bar: "bg-emerald-400",
      badge: "bg-emerald-400/20 text-emerald-300",
    },
    adjusted: {
      bg: "border border-amber-500/20 bg-amber-950/50",
      score: "text-amber-300",
      bar: "bg-amber-400",
      badge: "bg-amber-400/20 text-amber-300",
    },
    defense: {
      bg: "border border-orange-500/20 bg-orange-950/50",
      score: "text-orange-300",
      bar: "bg-orange-400",
      badge: "bg-orange-400/20 text-orange-300",
    },
    risk: {
      bg: "border border-rose-500/20 bg-rose-950/50",
      score: "text-rose-300",
      bar: "bg-rose-400",
      badge: "bg-rose-400/20 text-rose-300",
    },
  };
  return map[mode];
}

export function getAccuracyMessage(transactionCount: number): string {
  if (transactionCount === 0) return "Buen mapa inicial, falta vida real.";
  if (transactionCount < 5) return "Primeros datos reales, aún aprendiendo.";
  return "Datos útiles, seguimos afinando.";
}

export function computeNextStep(
  mainGoal: FinancialGoal,
  availableCash: number,
  totalDebt: number,
  noTransactions: boolean,
  flexibleSpending: number,
  debtPressureLevel: string,
): { title: string; description: string } {
  if (noTransactions) {
    return {
      title: "Registra tu primer movimiento",
      description:
        "Cuéntale a Kipu qué pasó con tu plata hoy. Puede ser cualquier gasto, ingreso, o pago.",
    };
  }
  if (flexibleSpending <= 0) {
    return {
      title: "Cuidemos la semana antes de pensar en la meta",
      description:
        "Tu margen está en negativo. Primero aseguremos los compromisos principales — la meta no se cancela, solo la protegemos.",
    };
  }
  if (debtPressureLevel === "high" || debtPressureLevel === "critical") {
    return {
      title: "Revisemos la presión de deuda",
      description:
        "La deuda está ocupando bastante espacio. Entendamos qué hay que pagar esta semana antes de considerar un aporte extra.",
    };
  }
  if (mainGoal.currentAmount === 0 && mainGoal.targetAmount > 0) {
    return {
      title: `Haz tu primer aporte a "${mainGoal.name}"`,
      description:
        "Ya tienes la meta lista y hay margen. El siguiente paso es mover el primer peso hacia ella, aunque sea poco.",
    };
  }
  if (totalDebt > availableCash && totalDebt > 0) {
    return {
      title: "Revisa tu plan de deudas",
      description:
        "Tienes más deuda que efectivo disponible. No es una crisis, pero vale la pena tener un plan claro.",
    };
  }
  return {
    title: "Sigue registrando cada movimiento",
    description:
      "El hábito es lo que hace funcionar a Kipu. Entre más registres, más precisa es la guía.",
  };
}

export function buildChatExamples(
  accounts: Account[],
  debtAccounts: DebtAccount[],
  mainGoal: FinancialGoal,
): string[] {
  const firstAccount = accounts.find((a) => !a.isGoalAccount);
  const firstDebt = debtAccounts[0];
  const acctName = firstAccount?.name ?? "mi cuenta";

  const examples: string[] = [
    `Gasté 6 en café con ${acctName}`,
    `Me pagaron 100 en ${acctName}`,
  ];

  if (firstDebt) {
    examples.push(`Pagué 50 de ${firstDebt.name} desde ${acctName}`);
  }

  examples.push(`Mandé 20 a mi meta "${mainGoal.name}"`);
  return examples.slice(0, 4);
}

export function translateCoachTone(tone: CoachTone): string {
  const labels: Record<CoachTone, string> = {
    clear: "Directo y claro",
    coach_like: "Coach motivador",
    playful: "Juguetón y cercano",
  };
  return labels[tone] ?? tone;
}

export function getFlexibleSpendingHelperText(flexibleSpending: number): string {
  if (flexibleSpending < 0) {
    return "Estás en margen negativo. Si gastas más estarías tocando pagos importantes o tu meta.";
  }
  if (flexibleSpending <= 20) {
    return "Te queda poco margen. Cuida compras impulsivas hasta que entre más plata.";
  }
  return "Esto es lo que podrías gastar sin dañar tu meta ni fallar pagos importantes.";
}

export function translateDebtPressure(level: string): string {
  const labels: Record<string, string> = {
    none: "Nula",
    low: "Baja",
    medium: "Media",
    high: "Alta",
    critical: "Crítica",
  };
  return labels[level] ?? level;
}

export function getGoalStatusColor(status: string): string {
  const colors: Record<string, string> = {
    achieved: "text-emerald-400",
    on_track: "text-emerald-400",
    tight: "text-amber-400",
    at_risk: "text-orange-400",
    not_realistic: "text-rose-400",
    blocked_by_debt_or_margin: "text-zinc-400",
    missing_deadline: "text-zinc-500",
    missing_target: "text-zinc-500",
    no_goal: "text-zinc-500",
  };
  return colors[status] ?? "text-zinc-500";
}

export function getTransactionDisplayLabel(transaction: {
  type: string;
  debt_account_id?: string | null;
}): string {
  if (transaction.type === "expense" && transaction.debt_account_id) {
    return "Gasto con tarjeta";
  }
  return translateTransactionType(transaction.type);
}

export function formatTransactionDisplayAmount(transaction: {
  type: string;
  base_amount: number | string;
  base_currency: string;
}): string {
  const amount = Number(transaction.base_amount).toFixed(2);
  if (transaction.type === "income" || transaction.type === "refund") {
    return `+ ${transaction.base_currency} ${amount}`;
  }
  if (
    transaction.type === "expense" ||
    transaction.type === "goal_contribution" ||
    transaction.type === "debt_payment"
  ) {
    return `- ${transaction.base_currency} ${amount}`;
  }
  return `${transaction.base_currency} ${amount}`;
}

export function translateTransactionType(type: string): string {
  const labels: Record<string, string> = {
    expense: "Gasto",
    income: "Ingreso",
    transfer: "Transferencia",
    debt_payment: "Pago de deuda",
    goal_contribution: "Aporte a meta",
    refund: "Reembolso",
    reversal: "Reverso",
    adjustment: "Ajuste",
  };
  return labels[type] ?? type;
}

export function translateTransactionCategory(category: string | null): string {
  const labels: Record<string, string> = {
    food: "Comida",
    transport: "Transporte",
    shopping: "Compras",
    entertainment: "Entretenimiento",
    health: "Salud",
    travel: "Viaje",
    income: "Ingreso",
    savings: "Ahorro",
    debt: "Deuda",
    other: "Otro",
  };
  if (!category) return "Sin categoría";
  return labels[category] ?? category;
}
