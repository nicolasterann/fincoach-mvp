import { convert, type FxRate } from "@/lib/fx/fx-rates";

// Bloque I (re-auditoría) — las dos conversiones monetarias que viven DENTRO del
// briefing, extraídas puras para que el gate pueda recorrer el camino real.
//
// La doctrina del convert no cambia: sin tasa conocida, JAMÁS se fabrica un 1:1.
// Lo que cambia es que el descarte deja de ser silencioso: una meta o un pago
// programado que no se pudo valuar REPORTA `incomplete`, y el publicador de dinero
// se niega. Antes, la fila simplemente desaparecía — menos reservado, cota del
// calendario más alta, tanque más alto — con cara de "no había nada que convertir".
// Para un usuario mono-moneda ninguna conversión se intenta, ninguna puede fallar,
// e `incomplete` queda en false: un blip de fx_rates no le apaga el Saldo.

export interface CommittedGoalLike<C = string> {
  status: string;
  cashflowProtected?: boolean | null;
  contributionAmount?: number | null;
  cadence?: C;
  currency?: string | null;
}

export function sumCommittedGoalReserveWeekly<C>(
  goals: CommittedGoalLike<C>[],
  rates: FxRate[],
  baseCurrency: string,
  cadenceToWeekly: (amount: number, cadence: C | undefined) => number,
): { weekly: number; hasCommitted: boolean; incomplete: boolean } {
  const base = baseCurrency.toUpperCase();
  let hasCommitted = false;
  let incomplete = false;
  const weekly =
    Math.round(
      goals
        .filter((g) => g.status === "active" && g.cashflowProtected !== false)
        .reduce((sum, g) => {
          const w = cadenceToWeekly(g.contributionAmount ?? 0, g.cadence);
          if (!(w > 0)) return sum;
          hasCommitted = true;
          const cur = String(g.currency ?? base).toUpperCase();
          if (cur === base) return sum + w;
          const res = convert(w, cur, base, rates);
          if (!res.ok) {
            // La reserva de esta meta protege plata REAL: perderla en silencio
            // libera monthlyTrulyFree que no está libre.
            incomplete = true;
            return sum;
          }
          return sum + res.baseAmount;
        }, 0) * 100,
    ) / 100;
  return { weekly, hasCommitted, incomplete };
}

export interface ScheduledPaymentLike {
  id: string;
  name: string;
  dueDate: string;
  amount: number | null;
  currency: string | null;
  category?: string | null;
  paymentSourceType?: string | null;
  paymentSourceId?: string | null;
}

export interface ScheduledPaymentBase {
  id: string;
  name: string;
  dueDate: string;
  amountBase: number;
  category?: string;
  paymentSourceType?: string | null;
  paymentSourceId?: string | null;
}

export function convertScheduledToBase(
  rows: ScheduledPaymentLike[],
  rates: FxRate[],
  baseCurrency: string,
): { items: ScheduledPaymentBase[]; incomplete: boolean } {
  const base = baseCurrency.toUpperCase();
  let incomplete = false;
  const items = rows.flatMap((p): ScheduledPaymentBase[] => {
    const amt = p.amount ?? 0;
    if (!(amt > 0)) return [];
    const cur = String(p.currency ?? base).toUpperCase();
    const common = {
      id: p.id,
      name: p.name,
      dueDate: p.dueDate,
      category: p.category ?? undefined,
      paymentSourceType: p.paymentSourceType,
      paymentSourceId: p.paymentSourceId,
    };
    if (cur === base) return [{ ...common, amountBase: amt }];
    const res = convert(amt, cur, base, rates);
    if (!res.ok) {
      // Un pago que el calendario deja de apartar sube el punto más bajo de la
      // proyección — la cota del calendario del Saldo. Desaparecer no es neutro.
      incomplete = true;
      return [];
    }
    return [{ ...common, amountBase: res.baseAmount }];
  });
  return { items, incomplete };
}
