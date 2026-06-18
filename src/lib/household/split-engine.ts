import { roundMoney } from "@/lib/financial/money";

// Stage 19 — SHARED EXPENSE SPLIT ENGINE. PURE. Given a total and a method,
// computes each participant's share so the shares ALWAYS sum back to the total
// exactly (integer-cent largest-remainder distribution — never a lost or invented
// cent). The payer fronts the whole total; each non-payer's share becomes what
// they owe the payer (the settlement engine nets these across many expenses).
// This NEVER touches the personal ledger: the payer's real outflow is their own
// `expense` transaction; this only derives the SHARED truth (who bears what).

export type SplitMethod = "equal" | "percentage" | "fixed" | "income_weighted" | "custom" | "payer_absorbs";

export interface SplitParticipant {
  memberId: string;
  // method-specific inputs (all optional; only the relevant one is read):
  percent?: number; // percentage method (0..100)
  fixed?: number; // fixed method (absolute base amount)
  weight?: number; // income_weighted method (e.g. monthly income; relative)
  custom?: number; // custom method (explicit base amount)
}

export interface SplitShare {
  memberId: string;
  shareBase: number; // what this member ultimately bears
}

export interface SplitResult {
  method: SplitMethod;
  totalBase: number;
  shares: SplitShare[];
  valid: boolean;
  reason: string; // structured Spanish fact for the agent (only meaningful when invalid)
}

const toCents = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100);
const fromCents = (c: number) => roundMoney(c / 100);

// Distribute `totalCents` across `weights` proportionally with a deterministic
// largest-remainder method so the parts sum EXACTLY to totalCents (no drift).
function proportionalCents(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    // No usable weights → equal split as a safe fallback.
    return equalCents(totalCents, weights.length);
  }
  const raw = weights.map((w) => (totalCents * w) / sum);
  const floor = raw.map((r) => Math.floor(r));
  const remainder = totalCents - floor.reduce((a, b) => a + b, 0);
  // Give the leftover cents to the largest fractional parts (ties → lower index).
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floor];
  for (let k = 0; k < remainder && k < order.length; k++) out[order[k].i] += 1;
  return out;
}

function equalCents(totalCents: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(totalCents / n);
  const rem = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

export function splitExpense(input: {
  totalBase: number;
  method: SplitMethod;
  participants: SplitParticipant[];
  payerMemberId: string;
}): SplitResult {
  const totalCents = toCents(Math.max(0, input.totalBase));
  const parts = input.participants;
  const ok = (shares: SplitShare[]): SplitResult => ({ method: input.method, totalBase: fromCents(totalCents), shares, valid: true, reason: "" });
  const bad = (reason: string): SplitResult => ({ method: input.method, totalBase: fromCents(totalCents), shares: [], valid: false, reason });

  if (totalCents <= 0) return bad("El monto compartido debe ser mayor a cero.");
  if (parts.length === 0) return bad("Necesito saber entre quiénes se divide.");
  const payerIn = parts.some((p) => p.memberId === input.payerMemberId);
  if (!payerIn) return bad("Quien pagó debe estar entre los participantes (o usa 'invitación' si absorbe todo).");

  switch (input.method) {
    case "payer_absorbs": {
      // "Fue mi invitación" — payer bears everything, nobody owes.
      return ok(parts.map((p) => ({ memberId: p.memberId, shareBase: p.memberId === input.payerMemberId ? fromCents(totalCents) : 0 })));
    }
    case "equal": {
      const cents = equalCents(totalCents, parts.length);
      return ok(parts.map((p, i) => ({ memberId: p.memberId, shareBase: fromCents(cents[i]) })));
    }
    case "income_weighted": {
      const weights = parts.map((p) => Math.max(0, p.weight ?? 0));
      if (weights.every((w) => w <= 0)) return bad("Para dividir por ingreso necesito el ingreso (o peso) de cada uno; si no, lo divido en partes iguales.");
      const cents = proportionalCents(totalCents, weights);
      return ok(parts.map((p, i) => ({ memberId: p.memberId, shareBase: fromCents(cents[i]) })));
    }
    case "percentage": {
      const pcts = parts.map((p) => Math.max(0, p.percent ?? 0));
      const sum = pcts.reduce((a, b) => a + b, 0);
      if (sum <= 0) return bad("Faltan los porcentajes de cada uno.");
      if (Math.abs(sum - 100) > 1.0) return bad(`Los porcentajes deben sumar 100 (suman ${Math.round(sum)}). Confírmame el reparto.`);
      const cents = proportionalCents(totalCents, pcts); // normalizes proportionally; sums exact
      return ok(parts.map((p, i) => ({ memberId: p.memberId, shareBase: fromCents(cents[i]) })));
    }
    case "fixed":
    case "custom": {
      const key = input.method === "fixed" ? "fixed" : "custom";
      const vals = parts.map((p) => Math.max(0, (p[key] as number | undefined) ?? 0));
      const assignedCents = vals.map(toCents);
      const assignedSum = assignedCents.reduce((a, b) => a + b, 0);
      if (assignedSum === 0) return bad("Faltan los montos de cada uno.");
      if (assignedSum !== totalCents) {
        // The payer absorbs any rounding/leftover difference so shares still sum to
        // the real total — but a big mismatch is a real error worth confirming.
        const diff = totalCents - assignedSum;
        if (Math.abs(diff) > toCents(0.02) * Math.max(1, parts.length)) {
          return bad(`Los montos asignados (${fromCents(assignedSum)}) no suman el total (${fromCents(totalCents)}). Confírmame el reparto.`);
        }
        const payerIdx = parts.findIndex((p) => p.memberId === input.payerMemberId);
        assignedCents[payerIdx] += diff;
      }
      return ok(parts.map((p, i) => ({ memberId: p.memberId, shareBase: fromCents(assignedCents[i]) })));
    }
    default:
      return bad("Método de división no reconocido.");
  }
}

// Convenience: from a computed split, what each NON-payer owes the payer (their
// share, since the payer fronted the whole total). The payer's own share is what
// they ultimately bear; they are owed the rest.
export function owedToPayer(split: SplitResult, payerMemberId: string): { memberId: string; amountBase: number }[] {
  if (!split.valid) return [];
  return split.shares.filter((s) => s.memberId !== payerMemberId && s.shareBase > 0).map((s) => ({ memberId: s.memberId, amountBase: s.shareBase }));
}
