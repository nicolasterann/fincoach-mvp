import { formatKipuMoney } from "@/lib/financial/money";
import type { CurrencyCode } from "@/types/financial";

export type MetricStatus = "good" | "ok" | "warn" | "bad" | "neutral";

// ── Margen Kipu hero styling ─────────────────────────────────────────────────

export type MargenStatus = "healthy" | "tight" | "negative";

// Hero card styling keyed off the Margen Kipu engine's own status, so the
// dashboard's color matches the chat coach's read of the week.
export function getMargenHeroClasses(status: MargenStatus): {
  bg: string;
  value: string;
  badge: string;
  badgeLabel: string;
} {
  const map: Record<MargenStatus, { bg: string; value: string; badge: string; badgeLabel: string }> = {
    healthy: {
      bg: "border border-emerald-500/20 bg-emerald-950/50",
      value: "text-emerald-300",
      badge: "bg-emerald-400/20 text-emerald-300",
      badgeLabel: "Con aire",
    },
    tight: {
      bg: "border border-amber-500/20 bg-amber-950/50",
      value: "text-amber-300",
      badge: "bg-amber-400/20 text-amber-300",
      badgeLabel: "Cuida el ritmo",
    },
    negative: {
      bg: "border border-rose-500/20 bg-rose-950/50",
      value: "text-rose-300",
      badge: "bg-rose-400/20 text-rose-300",
      badgeLabel: "Sobre lo seguro",
    },
  };
  return map[status];
}

// ── Whoop-style metric translation ───────────────────────────────────────────

export interface MetricView {
  label: string;
  value: string;
  message: string;
  status: MetricStatus;
  href?: string;
}

// 0–100 wellness score → dot color. Higher is always healthier.
export function metricStatusFromScore(score: number): MetricStatus {
  if (score >= 72) return "good";
  if (score >= 55) return "ok";
  if (score >= 38) return "warn";
  return "bad";
}

// Human, calm one-word read of a 0–100 score (never a raw number dump).
export function scoreLabel(score: number): string {
  if (score >= 72) return "Bien";
  if (score >= 55) return "Estable";
  if (score >= 38) return "Ojo";
  return "Atención";
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

// Meaningful, calm metric cards (Stage 8). Each card either tells the user
// something useful immediately or invites a deeper view — never an abstract
// score with no meaning. Messages adapt to the real numbers, in Kipu's voice.
export function buildMetricViews(input: {
  metrics: {
    financialReadiness: number;
    goalMomentum: number;
    debtPressure: number;
    spendingFlexibility: number;
    financialAccuracy: number;
    budgetReality: number;
  };
  goalCurrent: number;
  goalTarget: number;
  goalCurrency: CurrencyCode;
  goalHasDeadline: boolean;
  goalProgressPct: number;
  debtLevel: string;
  baseCurrency: CurrencyCode;
}): MetricView[] {
  const m = input.metrics;
  const band = (score: number, good: string, mid: string, low: string) =>
    score >= 72 ? good : score >= 45 ? mid : low;

  const goalMessage = (() => {
    if (input.goalTarget <= 0) return "Define un monto para volverla un plan.";
    const progress = `${formatKipuMoney(input.goalCurrent, input.goalCurrency)} de ${formatKipuMoney(input.goalTarget, input.goalCurrency)}`;
    if (!input.goalHasDeadline) return `${progress} — falta fecha para volverla un plan.`;
    return `${progress} — vas en camino.`;
  })();

  return [
    {
      label: "Readiness",
      value: scoreLabel(m.financialReadiness),
      status: metricStatusFromScore(m.financialReadiness),
      message: band(
        m.financialReadiness,
        "Tienes margen y tus pagos cercanos están considerados.",
        "Vas estable; cuida un poco el ritmo esta semana.",
        "Semana exigente; prioricemos lo esencial.",
      ),
    },
    {
      label: "Meta",
      value: input.goalTarget > 0 ? `${input.goalProgressPct}%` : "—",
      status: metricStatusFromScore(m.goalMomentum),
      message: goalMessage,
      href: "/app/goals",
    },
    {
      label: "Presión de deuda",
      value: translateDebtPressure(input.debtLevel),
      status: metricStatusFromScore(m.debtPressure),
      message: band(
        m.debtPressure,
        "Tus pagos no están apretando tu semana.",
        "La deuda pide algo de espacio este mes.",
        "La deuda está apretando; cuidémosla.",
      ),
    },
    {
      label: "Flexibilidad",
      value: scoreLabel(m.spendingFlexibility),
      status: metricStatusFromScore(m.spendingFlexibility),
      message: band(
        m.spendingFlexibility,
        "Puedes gastar sin tocar pagos ni meta.",
        "Tienes algo de aire, sin pasarte.",
        "Poco aire; mejor ir suave esta semana.",
      ),
      href: "/app/margen",
    },
    {
      label: "Precisión",
      value: scoreLabel(m.financialAccuracy),
      status: metricStatusFromScore(m.financialAccuracy),
      message: band(
        m.financialAccuracy,
        "Tus saldos principales están al día.",
        "Buen mapa; registra seguido para afinar.",
        "Faltan datos para afinar tus números.",
      ),
    },
    {
      label: "Realidad",
      value: scoreLabel(m.budgetReality),
      status: metricStatusFromScore(m.budgetReality),
      message: band(
        m.budgetReality,
        "Ya entiendo bien cómo se mueve tu gasto.",
        "Estoy aprendiendo cómo se mueve tu gasto real.",
        "Todavía conociendo tu gasto real.",
      ),
    },
  ];
}

// ── Activity feed: human-readable movements ──────────────────────────────────
// Turns a raw ledger row into something that reads like a wellness activity
// feed, not an accounting export: "Reverso: Café" → "Café (revertido)", the
// confusing "Ingreso · Ingreso" adjustment label fixed, money Kipu-style.

// Calm day label for grouping the activity feed: "Hoy" / "Ayer" / "5 jun".
export function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diffDays <= 0) return "Hoy";
  if (diffDays === 1) return "Ayer";
  return d.toLocaleDateString("es", { day: "numeric", month: "short" });
}

export type MovementTone = "in" | "out" | "neutral";

export interface MovementView {
  title: string;
  sublabel: string;
  amount: string; // magnitude, Kipu-style (no sign); the sign comes from tone
  tone: MovementTone;
}

interface RawMovement {
  type: string;
  description: string;
  category?: string | null;
  base_amount: number | string;
  base_currency: string;
  debt_account_id?: string | null;
  goal_id?: string | null;
}

export function describeMovement(tx: RawMovement): MovementView {
  const amountNum = Math.abs(Number(tx.base_amount) || 0);
  const amount = formatKipuMoney(amountNum, tx.base_currency as CurrencyCode);
  const desc = (tx.description ?? "").trim();

  switch (tx.type) {
    case "expense":
      return {
        title: desc || "Gasto",
        sublabel: tx.debt_account_id ? "Con tarjeta" : translateTransactionCategory(tx.category ?? null),
        amount,
        tone: "out",
      };
    case "income":
      return { title: desc || "Ingreso", sublabel: "Entró a tu cuenta", amount, tone: "in" };
    case "refund":
      return { title: desc || "Reembolso", sublabel: "Te devolvieron", amount, tone: "in" };
    case "debt_payment":
      return { title: desc || "Pago de deuda", sublabel: "Bajaste deuda", amount, tone: "out" };
    case "goal_contribution":
      return { title: desc || "Aporte a tu meta", sublabel: "Hacia tu meta", amount, tone: "out" };
    case "transfer":
      return { title: desc || "Transferencia", sublabel: "Entre tus cuentas", amount, tone: "neutral" };
    case "reversal": {
      // Stored as "Reverso: Café" → show the original cleanly as reverted.
      const original = desc.replace(/^reverso:\s*/i, "").trim();
      return {
        title: original ? `${original} (revertido)` : "Movimiento revertido",
        sublabel: "Lo dejamos sin efecto",
        amount,
        tone: "neutral",
      };
    }
    case "adjustment":
      return {
        title: "Ajuste de saldo",
        sublabel: "Para cuadrar tu cuenta",
        amount,
        tone: "neutral",
      };
    default:
      return { title: desc || "Movimiento", sublabel: "", amount, tone: "neutral" };
  }
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
