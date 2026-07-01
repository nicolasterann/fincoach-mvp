import { formatKipuMoney } from "@/lib/financial/money";
import { formatDisplay, type DisplayFormatter } from "@/lib/financial/display-money";
import type { FxRate } from "@/lib/fx/fx-rates";
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

// Visual identity per metric (Athlytic-style): each metric has its own accent
// color and icon so the grid reads as a system of distinct signals, not six
// copies of the same card.
export type MetricAccent = "emerald" | "violet" | "orange" | "sky" | "teal" | "amber";
export type MetricIcon = "pulse" | "target" | "card" | "wind" | "check" | "spark";

export interface MetricView {
  label: string;
  value: string;
  message: string;
  status: MetricStatus;
  accent: MetricAccent;
  icon: MetricIcon;
  // 0–100 fill for the card's progress bar (the metric's wellness score).
  score: number;
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
  // Stage 24 — optional display re-expression (web toggle). Defaults to native format.
  formatMoney?: DisplayFormatter;
}): MetricView[] {
  const m = input.metrics;
  const fmt: (amount: number, currency?: CurrencyCode) => string =
    input.formatMoney ?? formatKipuMoney;
  const band = (score: number, good: string, mid: string, low: string) =>
    score >= 72 ? good : score >= 45 ? mid : low;

  const goalMessage = (() => {
    if (input.goalTarget <= 0) return "Define un monto para volverla un plan.";
    const progress = `${fmt(input.goalCurrent, input.goalCurrency)} de ${fmt(input.goalTarget, input.goalCurrency)}`;
    if (!input.goalHasDeadline) return `${progress} — falta fecha para volverla un plan.`;
    return `${progress} — vas en camino.`;
  })();

  return [
    {
      label: "Readiness",
      value: scoreLabel(m.financialReadiness),
      status: metricStatusFromScore(m.financialReadiness),
      accent: "emerald",
      icon: "pulse",
      score: m.financialReadiness,
      message: band(
        m.financialReadiness,
        "Tienes margen y tus pagos cercanos están considerados.",
        "Vas estable; cuida un poco el ritmo esta semana.",
        "Semana exigente; prioricemos lo esencial.",
      ),
      href: "/app/readiness",
    },
    {
      label: "Meta",
      value: input.goalTarget > 0 ? `${input.goalProgressPct}%` : "—",
      status: metricStatusFromScore(m.goalMomentum),
      accent: "violet",
      icon: "target",
      score: input.goalTarget > 0 ? Math.min(100, input.goalProgressPct) : m.goalMomentum,
      message: goalMessage,
      href: "/app/goals",
    },
    {
      label: "Deuda",
      value: translateDebtPressure(input.debtLevel),
      status: metricStatusFromScore(m.debtPressure),
      accent: "orange",
      icon: "card",
      score: m.debtPressure,
      message: band(
        m.debtPressure,
        "Tus pagos no están apretando tu semana.",
        "La deuda pide algo de espacio este mes.",
        "La deuda está apretando; cuidémosla.",
      ),
      href: "/app/debt",
    },
    {
      label: "Flexibilidad",
      value: scoreLabel(m.spendingFlexibility),
      status: metricStatusFromScore(m.spendingFlexibility),
      accent: "sky",
      icon: "wind",
      score: m.spendingFlexibility,
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
      accent: "teal",
      icon: "check",
      score: m.financialAccuracy,
      message: band(
        m.financialAccuracy,
        "Tus saldos principales están al día.",
        "Buen mapa; registra seguido para afinar.",
        "Faltan datos para afinar tus números.",
      ),
      href: "/app/precision",
    },
    {
      label: "Realidad",
      value: scoreLabel(m.budgetReality),
      status: metricStatusFromScore(m.budgetReality),
      accent: "amber",
      icon: "spark",
      score: m.budgetReality,
      message: band(
        m.budgetReality,
        "Ya entiendo bien cómo se mueve tu gasto.",
        "Estoy aprendiendo cómo se mueve tu gasto real.",
        "Todavía conociendo tu gasto real.",
      ),
      href: "/app/reality",
    },
  ];
}

// ── Dashboard insight (the one thing worth saying today) ─────────────────────
// Deterministic, specific, decision-ready. Built from the real state: margen,
// today's pace, cards due, goal plan. Never generic filler, never repeats what
// Kipu already absorbed unless the user must act.
export interface DashboardInsight {
  kicker: string;
  text: string;
  href?: string;
  cta?: string;
}

export function buildDashboardInsight(input: {
  margenWeekly: number;
  margenDaily: number;
  margenStatus: "healthy" | "tight" | "negative";
  daysRemainingInWeek: number;
  todaySpend: number;
  weekSpend: number;
  cardsDueSoon: { name: string; inDays: number }[];
  goalName: string;
  goalHasDeadline: boolean;
  goalTarget: number;
  baseCurrency: CurrencyCode;
  // Stage 24 — optional display re-expression (web toggle). Defaults to native format.
  formatMoney?: DisplayFormatter;
}): DashboardInsight {
  const fmt: (amount: number, currency?: CurrencyCode) => string =
    input.formatMoney ?? formatKipuMoney;
  const money = (v: number) => fmt(v, input.baseCurrency);

  if (input.margenStatus === "negative") {
    return {
      kicker: "Semana pasada de lo seguro",
      text: `Esta semana ya va ${money(Math.abs(input.margenWeekly))} sobre tu margen. Si frenas lo no esencial hasta tu próximo ingreso, se reacomoda solo — tu meta sigue protegida.`,
      href: "/app/margen",
      cta: "Ver mi margen",
    };
  }

  const nearCard = input.cardsDueSoon.find((c) => c.inDays <= 3);
  if (nearCard) {
    return {
      kicker: "Pago cercano, ya considerado",
      text: `${nearCard.name} vence ${nearCard.inDays <= 0 ? "hoy" : `en ${nearCard.inDays} día${nearCard.inDays === 1 ? "" : "s"}`}. Ya lo conté en tu Margen, así que no te descuadra la semana — solo acuérdate de hacer el pago.`,
      href: "/app/debt",
      cta: "Ver mis pagos",
    };
  }

  if (input.todaySpend > input.margenDaily * 1.35 && input.margenDaily > 0) {
    return {
      kicker: "Ritmo de hoy",
      text: `Hoy ya llevas ${money(input.todaySpend)}, por encima de tu ritmo cómodo de ${money(input.margenDaily)} al día. Si lo dejas aquí, llegas al domingo sin apretarte.`,
      href: "/app/margen",
      cta: "Ver mi ritmo",
    };
  }

  if (!input.goalHasDeadline && input.goalTarget > 0 && input.margenStatus === "healthy") {
    return {
      kicker: "Tu meta puede ser un plan",
      text: `Ponle fecha a "${input.goalName}" y te digo exactamente cuánto apartar por semana — sin tocar tu margen para vivir.`,
      href: "/app/goals",
      cta: "Ponerle fecha",
    };
  }

  if (input.margenStatus === "tight") {
    return {
      kicker: "Semana justa, no rota",
      text: `Te quedan ${money(input.margenWeekly)} para ${input.daysRemainingInWeek} día${input.daysRemainingInWeek === 1 ? "" : "s"}. Con compras pequeñas llegas bien; lo grande mejor déjalo para después de tu próximo ingreso.`,
      href: "/app/margen",
      cta: "Ver el detalle",
    };
  }

  if (input.todaySpend === 0) {
    return {
      kicker: "Hoy",
      text: `Puedes moverte con hasta ${money(input.margenDaily)} hoy sin tocar pagos, ahorro ni tu meta. Todo lo demás ya está considerado.`,
    };
  }

  return {
    kicker: "Vas bien",
    text: `Llevas ${money(input.todaySpend)} hoy de un ritmo cómodo de ${money(input.margenDaily)} al día. Tus pagos y tu meta ya están cubiertos en el cálculo.`,
  };
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

// "Préstamo a mi hermano (Préstamo)" → "Préstamo a mi hermano": drop a
// parenthetical that just repeats a word already present in the title.
function dedupeTitle(raw: string): string {
  const match = raw.match(/^(.*)\s\(([^)]+)\)\s*$/);
  if (!match) return raw;
  const [, head, paren] = match;
  const headLower = head.toLowerCase();
  const parenLower = paren.trim().toLowerCase();
  if (headLower.includes(parenLower)) return head.trim();
  return raw;
}

export function describeMovement(
  tx: RawMovement,
  opts?: { displayCurrency?: CurrencyCode; rates?: FxRate[] },
): MovementView {
  const amountNum = Math.abs(Number(tx.base_amount) || 0);
  // Each row converts from ITS OWN base_currency (rows can differ) into the display
  // currency; no rate → native (formatDisplay fallback). Defaults to native format.
  const amount = formatDisplay(
    amountNum,
    tx.base_currency as CurrencyCode,
    opts?.displayCurrency,
    opts?.rates ?? [],
  );
  const desc = dedupeTitle((tx.description ?? "").trim());

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
