import type { DatedSnapshot } from "@/lib/trends/snapshot-store";

export type PerspectiveTone = "good" | "watch" | "over" | "neutral";

export interface PerspectiveRing {
  key: "ritmo" | "comida" | "transporte";
  label: string;
  amountLabel: string;
  percentLabel: string | null;
  dashArray: string;
  denominatorLabel: string | null;
  note: string | null;
  tone: PerspectiveTone;
}

export interface PerspectiveMonthSegment {
  key: string;
  label: string;
  amountLabel: string;
  shareLabel: string | null;
  widthCss: string;
  tone: "fixed" | "debt" | "essential" | "reserve" | "goal" | "free";
}

export interface PerspectiveCordKnot {
  dateISO: string;
  dateLabel: string;
  amountLabel: string | null;
  x: number;
  y: number | null;
  tone: PerspectiveTone | null;
  connectedToPrevious: boolean;
}

export type PerspectiveCord =
  | { status: "hidden" }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      knots: PerspectiveCordKnot[];
      paths: string[];
      missingCount: number;
      gapCopy: string;
    };

export interface PerspectiveProgressItem {
  key: "goal" | "reserve" | "debt";
  title: string;
  href: string;
  amountLabel: string | null;
  detailLabel: string;
  percentLabel: string | null;
  widthCss: string | null;
  denominatorLabel: string | null;
  tone: PerspectiveTone;
}

export interface PerspectiveWealth {
  status: "ready" | "empty" | "failed";
  title: string;
  href: "/app/wealth";
  amountLabel: string | null;
  detailLabel: string;
}

export interface PerspectiveUpcomingRow {
  key: string;
  label: string;
  whenLabel: string;
  amountLabel: string | null;
  tone: PerspectiveTone;
  sortKey: number;
}

export interface ShellPerspective {
  today: {
    title: "Hoy";
    question: "¿Cómo voy hoy?";
    href: "/app/spending";
    rings: PerspectiveRing[];
  };
  month: {
    title: "Tu mes";
    question: "¿Cómo se reparte?";
    href: "/app/mes";
    incomeLabel: string;
    denominatorLabel: string | null;
    barVisible: boolean;
    segments: PerspectiveMonthSegment[];
    note: string;
  };
  saldoHistory: PerspectiveCord;
  progress: {
    title: "Tus progresos";
    question: "¿Hacia dónde voy?";
    items: PerspectiveProgressItem[];
    wealth: PerspectiveWealth;
  };
  upcoming: {
    title: "Lo que viene";
    question: "¿Qué se viene?";
    href: "/app/cuentas";
    rows: PerspectiveUpcomingRow[];
    emptyCopy: string;
  };
}

export interface ShellPerspectiveInput {
  today: {
    spent: number;
    fill: number;
    objectives: Array<{
      category: string;
      label: string;
      spent: number;
      objective: number;
      crossed: boolean;
      projectedCrossDateISO: string | null;
    }>;
  };
  month: {
    income: number;
    fixed: number;
    debt: number;
    installments: number;
    essentials: number;
    savings: number;
    investment: number;
    goals: number;
    free: number;
  };
  history: {
    ok: boolean;
    snapshots: DatedSnapshot[];
    todayISO: string;
  };
  progress: {
    primaryGoal: {
      name: string;
      current: number;
      target: number;
      percent: number | null;
    } | null;
    reserve: {
      readOk: boolean;
      amount: number;
      target: number | null;
    };
    debt: {
      amount: number;
    };
    wealth: {
      readOk: boolean;
      amount: number | null;
    };
  };
  upcoming: {
    cards: Array<{
      name: string;
      inDays: number;
      balance: number;
      due: number | null;
    }>;
    payments: Array<{
      name: string;
      amount: number | null;
      dueDate: string;
    }>;
  };
  formatMoney: (amount: number) => string;
}

const clampVisual = (percent: number): number =>
  Math.min(100, Math.max(0, Math.round(percent)));

const percentOf = (numerator: number, denominator: number): number | null =>
  denominator > 0
    ? Math.round((Math.max(0, numerator) / denominator) * 100)
    : null;

const percentView = (percent: number | null) => ({
  percentLabel: percent == null ? null : `${Math.round(percent)}%`,
  widthCss: percent == null ? null : `${clampVisual(percent)}%`,
  dashArray: percent == null ? "0 100" : `${clampVisual(percent)} 100`,
});

function shortDate(dateISO: string): string {
  const date = new Date(`${dateISO}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateISO;
  return new Intl.DateTimeFormat("es-419", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function ringTone(
  percent: number | null,
  crossed = false,
  projectedCrossDateISO: string | null = null,
): PerspectiveTone {
  if (percent == null) return "neutral";
  if (crossed || percent > 100) return "over";
  if (percent >= 80 || projectedCrossDateISO) return "watch";
  return "good";
}

function buildRing(input: {
  key: PerspectiveRing["key"];
  label: string;
  amount: number;
  denominator: number;
  denominatorName: string;
  crossed?: boolean;
  projectedCrossDateISO?: string | null;
  formatMoney: (amount: number) => string;
}): PerspectiveRing {
  const percent = percentOf(input.amount, input.denominator);
  const view = percentView(percent);
  const projected = input.projectedCrossDateISO ?? null;
  return {
    key: input.key,
    label: input.label,
    amountLabel: input.formatMoney(input.amount),
    percentLabel: view.percentLabel,
    dashArray: view.dashArray,
    denominatorLabel:
      percent == null
        ? null
        : `${input.denominatorName}: ${input.formatMoney(input.denominator)}`,
    note: input.crossed
      ? "Ya cruzó su objetivo del mes."
      : projected
        ? `A este ritmo lo cruza el ${shortDate(projected)}.`
        : null,
    tone: ringTone(percent, input.crossed, projected),
  };
}

function monthSegment(input: {
  key: string;
  label: string;
  amount: number;
  income: number;
  tone: PerspectiveMonthSegment["tone"];
  formatMoney: (amount: number) => string;
}): PerspectiveMonthSegment {
  const share = percentOf(input.amount, input.income);
  const view = percentView(share);
  return {
    key: input.key,
    label: input.label,
    amountLabel: input.formatMoney(input.amount),
    shareLabel: view.percentLabel,
    widthCss: view.widthCss ?? "0%",
    tone: input.tone,
  };
}

function isoDaysEndingAt(todayISO: string, count: number): string[] {
  const end = new Date(`${todayISO}T12:00:00Z`);
  if (Number.isNaN(end.getTime())) return [];
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (count - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}

/** Server-side geometry: blank dates stay blank and each contiguous run gets
 * its own SVG path. A path can therefore never bridge a missing snapshot. */
export function buildSaldoCord(input: {
  read: { ok: boolean; snapshots: DatedSnapshot[] };
  todayISO: string;
  formatMoney: (amount: number) => string;
}): PerspectiveCord {
  if (!input.read.ok) {
    return { status: "failed", message: "No pude leer esto ahora." };
  }

  const byDate = new Map(
    input.read.snapshots.map((snapshot) => [snapshot.dateISO, snapshot.saldoKipu]),
  );
  const dates = isoDaysEndingAt(input.todayISO, 18);
  const values = dates
    .map((dateISO) => byDate.get(dateISO) ?? null)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (values.length < 2) return { status: "hidden" };

  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = high - low;
  const knots: PerspectiveCordKnot[] = dates.map((dateISO, index) => {
    const value = byDate.get(dateISO);
    const valid = value != null && Number.isFinite(value);
    const previousDate = index > 0 ? dates[index - 1] : null;
    const previousValue = previousDate ? byDate.get(previousDate) : null;
    return {
      dateISO,
      dateLabel: shortDate(dateISO),
      amountLabel: valid ? input.formatMoney(value) : null,
      x: 8 + index * 18,
      y: valid
        ? Math.round((spread <= 0 ? 43 : 68 - ((value - low) / spread) * 50) * 10) / 10
        : null,
      tone: valid
        ? value < -0.005
          ? "over"
          : value <= 0.005
            ? "watch"
            : "good"
        : null,
      connectedToPrevious:
        valid && previousValue != null && Number.isFinite(previousValue),
    };
  });

  const paths: string[] = [];
  let run: PerspectiveCordKnot[] = [];
  const flush = () => {
    if (run.length >= 2) {
      paths.push(
        run
          .map((knot, index) =>
            `${index === 0 ? "M" : "L"} ${knot.x} ${knot.y as number}`,
          )
          .join(" "),
      );
    }
    run = [];
  };
  for (const knot of knots) {
    if (knot.y == null) flush();
    else run.push(knot);
  }
  flush();

  return {
    status: "ready",
    knots,
    paths,
    missingCount: knots.filter((knot) => knot.y == null).length,
    gapCopy: "Los días sin registro quedan en blanco, no inventados.",
  };
}

export function buildReserveProgress(input: {
  readOk: boolean;
  amount: number;
  target: number | null;
  formatMoney: (amount: number) => string;
}): PerspectiveProgressItem {
  const amountLabel = input.formatMoney(input.amount);
  if (!input.readOk) {
    return {
      key: "reserve",
      title: "Reserva",
      href: "/app/saldo",
      amountLabel: null,
      detailLabel: "No pude leer esto ahora.",
      percentLabel: null,
      widthCss: null,
      denominatorLabel: null,
      tone: "neutral",
    };
  }
  if (input.target == null || input.target <= 0) {
    return {
      key: "reserve",
      title: "Reserva",
      href: "/app/chat?share=quiero%20definir%20mi%20objetivo%20de%20Reserva",
      amountLabel,
      detailLabel: `Tu respaldo va en ${amountLabel}. Dime cuánto quieres tener y te muestro cuánto te falta.`,
      percentLabel: null,
      widthCss: null,
      denominatorLabel: null,
      tone: "neutral",
    };
  }
  const percent = percentOf(input.amount, input.target);
  const view = percentView(percent);
  return {
    key: "reserve",
    title: "Reserva",
    href: "/app/saldo",
    amountLabel,
    detailLabel: `${amountLabel} de ${input.formatMoney(input.target)}`,
    percentLabel: view.percentLabel,
    widthCss: view.widthCss,
    denominatorLabel: `Objetivo de Reserva: ${input.formatMoney(input.target)}`,
    tone: percent != null && percent >= 100 ? "good" : "watch",
  };
}

function buildGoalProgress(
  primary: ShellPerspectiveInput["progress"]["primaryGoal"],
  formatMoney: (amount: number) => string,
): PerspectiveProgressItem {
  if (!primary) {
    return {
      key: "goal",
      title: "Tu meta principal",
      href: "/app/chat?share=quiero%20crear%20mi%20primera%20meta",
      amountLabel: null,
      detailLabel: "¿Qué estás soñando? Ponle nombre y lo seguimos juntos.",
      percentLabel: null,
      widthCss: null,
      denominatorLabel: null,
      tone: "neutral",
    };
  }
  const measurable = primary.target > 0 && primary.percent != null;
  const view = percentView(measurable ? primary.percent : null);
  return {
    key: "goal",
    title: primary.name,
    href: "/app/goals",
    amountLabel: formatMoney(primary.current),
    detailLabel: measurable
      ? `${formatMoney(primary.current)} de ${formatMoney(primary.target)}`
      : `${formatMoney(primary.current)} reunidos`,
    percentLabel: view.percentLabel,
    widthCss: view.widthCss,
    denominatorLabel: measurable
      ? `Meta declarada: ${formatMoney(primary.target)}`
      : null,
    tone: measurable && (primary.percent as number) >= 100 ? "good" : "neutral",
  };
}

function historyChange(
  current: number,
  snapshots: DatedSnapshot[],
  pick: (snapshot: DatedSnapshot) => number,
  formatMoney: (amount: number) => string,
): { first: number; firstDate: string; detail: string } | null {
  if (snapshots.length < 2) return null;
  const firstSnapshot = snapshots[0];
  if (!firstSnapshot) return null;
  const first = pick(firstSnapshot);
  const delta = current - first;
  const detail =
    Math.abs(delta) <= 0.005
      ? `Sin cambio desde ${shortDate(firstSnapshot.dateISO)}.`
      : delta > 0
        ? `Subió ${formatMoney(Math.abs(delta))} desde ${shortDate(firstSnapshot.dateISO)}.`
        : `Bajó ${formatMoney(Math.abs(delta))} desde ${shortDate(firstSnapshot.dateISO)}.`;
  return { first, firstDate: firstSnapshot.dateISO, detail };
}

function buildDebtProgress(input: {
  amount: number;
  snapshots: DatedSnapshot[];
  formatMoney: (amount: number) => string;
}): PerspectiveProgressItem {
  const change = historyChange(
    input.amount,
    input.snapshots,
    (snapshot) => snapshot.totalDebt,
    input.formatMoney,
  );
  const reduction =
    change && change.first > 0 && input.amount < change.first
      ? percentOf(change.first - input.amount, change.first)
      : null;
  const view = percentView(reduction);
  return {
    key: "debt",
    title: "Salida de deuda",
    href: "/app/debt",
    amountLabel: input.formatMoney(input.amount),
    detailLabel:
      input.amount <= 0.005
        ? "No tienes deuda registrada."
        : change?.detail ?? "Aún no hay historia suficiente para medir el camino.",
    percentLabel: view.percentLabel,
    widthCss: view.widthCss,
    denominatorLabel:
      reduction == null || !change
        ? null
        : `Deuda registrada el ${shortDate(change.firstDate)}: ${input.formatMoney(change.first)}`,
    tone:
      change && input.amount < change.first
        ? "good"
        : change && input.amount > change.first
          ? "watch"
          : "neutral",
  };
}

function buildWealth(input: {
  readOk: boolean;
  amount: number | null;
  snapshots: DatedSnapshot[];
  formatMoney: (amount: number) => string;
}): PerspectiveWealth {
  if (!input.readOk) {
    return {
      status: "failed",
      title: "Patrimonio total",
      href: "/app/wealth",
      amountLabel: null,
      detailLabel: "No pude leer esto ahora.",
    };
  }
  if (input.amount == null) {
    return {
      status: "empty",
      title: "Patrimonio total",
      href: "/app/wealth",
      amountLabel: null,
      detailLabel: "Cuéntame qué tienes y qué debes para empezar su historia.",
    };
  }
  const change = historyChange(
    input.amount,
    input.snapshots,
    (snapshot) => snapshot.netWorth,
    input.formatMoney,
  );
  return {
    status: "ready",
    title: "Patrimonio total",
    href: "/app/wealth",
    amountLabel: input.formatMoney(input.amount),
    detailLabel:
      change?.detail ?? "La historia aparece cuando hay dos días registrados.",
  };
}

function upcomingRows(
  input: ShellPerspectiveInput["upcoming"],
  formatMoney: (amount: number) => string,
): PerspectiveUpcomingRow[] {
  const cards = input.cards.map((card, index) => ({
    key: `card-${card.name}-${index}`,
    label: card.name,
    whenLabel:
      card.inDays <= 0
        ? "hoy"
        : `en ${card.inDays} día${card.inDays === 1 ? "" : "s"}`,
    amountLabel: formatMoney(card.due ?? card.balance),
    tone: "watch" as const,
    sortKey: card.inDays,
  }));
  const payments = input.payments.map((payment, index) => {
    const distance = Math.max(
      0,
      Math.round(
        (new Date(`${payment.dueDate}T12:00:00Z`).getTime() - Date.now()) /
          86_400_000,
      ),
    );
    return {
      key: `payment-${payment.name}-${payment.dueDate}-${index}`,
      label: payment.name,
      whenLabel: shortDate(payment.dueDate),
      amountLabel:
        payment.amount == null ? null : formatMoney(payment.amount),
      tone: "neutral" as const,
      sortKey: distance,
    };
  });
  return [...cards, ...payments]
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, 6);
}

export function buildShellPerspective(
  input: ShellPerspectiveInput,
): ShellPerspective {
  const rhythm = buildRing({
    key: "ritmo",
    label: "Ritmo",
    amount: input.today.spent,
    denominator: input.today.fill,
    denominatorName: "Recarga de hoy",
    formatMoney: input.formatMoney,
  });
  const objectiveRings = input.today.objectives
    .filter((objective) => {
      const key = `${objective.category} ${objective.label}`.toLowerCase();
      return key.includes("food") || key.includes("comida") ||
        key.includes("transport") || key.includes("transporte");
    })
    .slice(0, 2)
    .map((objective) => {
      const key = `${objective.category} ${objective.label}`.toLowerCase();
      return buildRing({
        key: key.includes("transport") ? "transporte" : "comida",
        label: key.includes("transport") ? "Transporte" : "Comida",
        amount: objective.spent,
        denominator: objective.objective,
        denominatorName: "Objetivo del mes",
        crossed: objective.crossed,
        projectedCrossDateISO: objective.projectedCrossDateISO,
        formatMoney: input.formatMoney,
      });
    });

  const monthParts = [
    { key: "fixed", label: "Fijos", amount: input.month.fixed, tone: "fixed" as const },
    { key: "debt", label: "Deuda", amount: input.month.debt + input.month.installments, tone: "debt" as const },
    { key: "essential", label: "Esencial", amount: input.month.essentials, tone: "essential" as const },
    { key: "reserve", label: "Ahorro e inversión", amount: input.month.savings + input.month.investment, tone: "reserve" as const },
    { key: "goal", label: "Metas", amount: input.month.goals, tone: "goal" as const },
    { key: "free", label: "Libre", amount: Math.max(0, input.month.free), tone: "free" as const },
  ].filter((part) => part.amount > 0.005);
  const monthSegments = monthParts.map((part) =>
    monthSegment({
      ...part,
      income: input.month.income,
      formatMoney: input.formatMoney,
    }),
  );
  const assigned = monthParts.reduce((sum, part) => sum + part.amount, 0);
  const monthOver = input.month.income > 0 && assigned > input.month.income + 0.005;
  const cord = buildSaldoCord({
    read: { ok: input.history.ok, snapshots: input.history.snapshots },
    todayISO: input.history.todayISO,
    formatMoney: input.formatMoney,
  });
  const historyForProgress = input.history.ok
    ? input.history.snapshots
    : [];

  return {
    today: {
      title: "Hoy",
      question: "¿Cómo voy hoy?",
      href: "/app/spending",
      rings: [rhythm, ...objectiveRings],
    },
    month: {
      title: "Tu mes",
      question: "¿Cómo se reparte?",
      href: "/app/mes",
      incomeLabel: input.formatMoney(input.month.income),
      denominatorLabel:
        input.month.income > 0
          ? `Ingreso mensual: ${input.formatMoney(input.month.income)}`
          : null,
      barVisible: input.month.income > 0 && monthSegments.length > 0,
      segments: monthSegments,
      note:
        input.month.income <= 0
          ? "Cuéntame tu ingreso y te muestro cómo se reparte el mes."
          : monthOver
            ? "Hay más asignado que ingreso. Lo revisamos sin borrar ninguna prioridad."
            : "Lo libre queda después de fijos, deuda, esenciales y lo que apartas.",
    },
    saldoHistory: cord,
    progress: {
      title: "Tus progresos",
      question: "¿Hacia dónde voy?",
      items: [
        buildGoalProgress(input.progress.primaryGoal, input.formatMoney),
        buildReserveProgress({
          ...input.progress.reserve,
          formatMoney: input.formatMoney,
        }),
        buildDebtProgress({
          amount: input.progress.debt.amount,
          snapshots: historyForProgress,
          formatMoney: input.formatMoney,
        }),
      ],
      wealth: buildWealth({
        ...input.progress.wealth,
        snapshots: historyForProgress,
        formatMoney: input.formatMoney,
      }),
    },
    upcoming: {
      title: "Lo que viene",
      question: "¿Qué se viene?",
      href: "/app/cuentas",
      rows: upcomingRows(input.upcoming, input.formatMoney),
      emptyCopy: "Nada fuerte en los próximos días — respira.",
    },
  };
}
