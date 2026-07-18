import { roundMoney } from "@/lib/financial/money";

// Stage 19 — SETTLEMENT ENGINE. PURE. From the household's shared expenses (each
// with a payer + per-member shares) and the reimbursements already recorded,
// computes each member's NET position (owed to them vs they owe), the SIMPLEST
// set of transfers that clears all balances (greedy min-transfers), and what is
// still pending. Signed math handles partial reimbursements and overpayments
// naturally. NEVER blames: outputs are neutral balances + a clear next step.
//
// Convention: netBase > 0 → the member is OWED that much (others should pay them);
// netBase < 0 → the member OWES that much. Sum of all nets is ~0 (conservation).

export interface SettlementMemberInput {
  memberId: string;
  displayName: string;
}
export interface SettlementExpenseInput {
  payerMemberId: string;
  totalBase: number;
  splits: { memberId: string; shareBase: number }[];
}
export interface RecordedSettlement {
  fromMemberId: string; // who paid the reimbursement
  toMemberId: string; // who received it
  amountBase: number;
  status: "pending" | "paid";
}

export interface MemberBalance {
  memberId: string;
  displayName: string;
  netBase: number; // >0 owed to them, <0 they owe
}
export interface SettlementTransfer {
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amountBase: number;
}
export interface SettlementResult {
  balances: MemberBalance[];
  transfers: SettlementTransfer[]; // simplest path to clear all debts
  pending: RecordedSettlement[]; // recorded-but-not-yet-paid reimbursements
  totalSharedBase: number; // sum of all shared-expense totals (the household truth, counted ONCE)
  outstandingBase: number; // total still owed across the household
  allSettled: boolean;
}

const toCents = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100);
const fromCents = (c: number) => roundMoney(c / 100);

export function computeSettlement(input: {
  members: SettlementMemberInput[];
  expenses: SettlementExpenseInput[];
  settlements: RecordedSettlement[];
}): SettlementResult {
  const name = new Map(input.members.map((m) => [m.memberId, m.displayName]));
  const net = new Map<string, number>(); // memberId → net cents
  const bump = (id: string, c: number) => net.set(id, (net.get(id) ?? 0) + c);
  for (const m of input.members) net.set(m.memberId, 0);
  // Re-auditoría 3 (punto 4): el cuadre incluye a TODO miembro REFERENCIADO por
  // dinero (payer, splits, settlements), esté o no en `members`. Antes, la deuda de
  // un miembro removido se COMPUTABA en `net` y luego se descartaba al mapear
  // balances solo sobre `members` — su transferencia desaparecía en silencio y la
  // suma de balances dejaba de ser cero. "Activo" limita operaciones nuevas, no
  // borra obligaciones ya contraídas.
  const referenced = new Set(input.members.map((m) => m.memberId));
  for (const e of input.expenses) {
    referenced.add(e.payerMemberId);
    for (const s of e.splits) referenced.add(s.memberId);
  }
  for (const st of input.settlements) {
    referenced.add(st.fromMemberId);
    referenced.add(st.toMemberId);
  }

  let totalSharedCents = 0;
  for (const e of input.expenses) {
    const totalC = toCents(e.totalBase);
    totalSharedCents += totalC;
    // Payer fronted the whole total → credited the total.
    bump(e.payerMemberId, totalC);
    // Each participant is debited their share.
    for (const s of e.splits) bump(s.memberId, -toCents(s.shareBase));
  }

  // Apply PAID reimbursements: A→B of X means A reduced its debt (A net += X) and
  // B reduced its credit (B net −= X). Pending ones don't move the balance yet.
  for (const st of input.settlements) {
    if (st.status !== "paid") continue;
    const c = toCents(st.amountBase);
    bump(st.fromMemberId, c);
    bump(st.toMemberId, -c);
  }

  const balances: MemberBalance[] = [...referenced].map((id) => ({ memberId: id, displayName: name.get(id) ?? "alguien", netBase: fromCents(net.get(id) ?? 0) }));

  // Greedy minimal transfers: match biggest debtor to biggest creditor until clear.
  const creditors = balances.filter((b) => toCents(b.netBase) > 0).map((b) => ({ id: b.memberId, c: toCents(b.netBase) })).sort((a, b) => b.c - a.c);
  const debtors = balances.filter((b) => toCents(b.netBase) < 0).map((b) => ({ id: b.memberId, c: -toCents(b.netBase) })).sort((a, b) => b.c - a.c);
  const transfers: SettlementTransfer[] = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const give = Math.min(creditors[ci].c, debtors[di].c);
    if (give > 0) {
      transfers.push({
        fromMemberId: debtors[di].id, fromName: name.get(debtors[di].id) ?? "alguien",
        toMemberId: creditors[ci].id, toName: name.get(creditors[ci].id) ?? "alguien",
        amountBase: fromCents(give),
      });
    }
    creditors[ci].c -= give;
    debtors[di].c -= give;
    if (creditors[ci].c <= 0) ci++;
    if (debtors[di].c <= 0) di++;
  }

  const outstandingCents = balances.reduce((sum, b) => sum + Math.max(0, toCents(b.netBase)), 0);
  return {
    balances,
    transfers,
    pending: input.settlements.filter((s) => s.status === "pending"),
    totalSharedBase: fromCents(totalSharedCents),
    outstandingBase: fromCents(outstandingCents),
    allSettled: outstandingCents === 0,
  };
}

// What does a single member need to do now? Neutral, never blameful: returns the
// transfers that involve THIS member (to pay or to collect), from the simplest path.
export function memberNextSteps(result: SettlementResult, memberId: string): { toPay: SettlementTransfer[]; toCollect: SettlementTransfer[] } {
  return {
    toPay: result.transfers.filter((t) => t.fromMemberId === memberId),
    toCollect: result.transfers.filter((t) => t.toMemberId === memberId),
  };
}
