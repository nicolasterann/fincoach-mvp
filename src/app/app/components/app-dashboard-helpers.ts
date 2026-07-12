import { formatDisplay } from "@/lib/financial/display-money";
import type { FxRate } from "@/lib/fx/fx-rates";
import type { CurrencyCode } from "@/types/financial";

export function translateDebtPressure(level: string): string {
  const labels: Record<string, string> = {
    none: "Nula",
    low: "Baja",
    medium: "Media",
    high: "Alta",
    critical: "Crítica",
  };
  // Unknown level → calm middle read, never a raw enum in user copy.
  return labels[level] ?? "Media";
}

// Meaningful, calm metric cards (Stage 8). Each card either tells the user
// something useful immediately or invites a deeper view — never an abstract
// score with no meaning. Messages adapt to the real numbers, in Kipu's voice.

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

// Complete map over FinancialCategory (types/financial.ts) + humanized fallback:
// an unknown value renders capitalized without underscores, never a raw enum.
export function translateTransactionCategory(category: string | null): string {
  const labels: Record<string, string> = {
    housing: "Vivienda",
    utilities: "Servicios",
    food: "Comida",
    transport: "Transporte",
    health: "Salud",
    education: "Educación",
    subscriptions: "Suscripciones",
    shopping: "Compras",
    entertainment: "Entretenimiento",
    family: "Familia",
    travel: "Viaje",
    income: "Ingreso",
    savings: "Ahorro",
    debt: "Deuda",
    other: "Otro",
  };
  if (!category) return "Sin categoría";
  const known = labels[category];
  if (known) return known;
  const humanized = category.replace(/[_-]+/g, " ").trim();
  if (!humanized) return "Sin categoría";
  return humanized.charAt(0).toUpperCase() + humanized.slice(1).toLowerCase();
}
