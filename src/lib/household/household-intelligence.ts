import { roundMoney } from "@/lib/financial/money";
import { computeSettlement, memberNextSteps, type SettlementResult } from "@/lib/household/settlement-engine";

// Stage 19 — HOUSEHOLD INTELLIGENCE orchestrator. PURE. Turns the loaded shared
// data (the households the requesting user is an ACTIVE member of) into one calm,
// permission-safe summary + a Spanish digest the agent reads to answer "¿quién le
// debe a quién?", "¿cuánto me debe X?", "¿cerramos cuentas?" simply and NEUTRALLY.
// Privacy is structural: only SHARED data ever reaches these tables/this engine —
// a member's private personal ledger/Margen never enters here. Never blames.

export type HouseholdType = "couple" | "family" | "roommates" | "trip" | "custom";

export interface LoadedMember {
  memberId: string;
  userId: string | null; // null = non-user participant ("mi mamá")
  displayName: string;
  role: string; // owner | admin | member | viewer | contributor | external
  status: string; // active | invited | left | removed
}
export interface LoadedSharedExpense {
  id: string;
  payerMemberId: string;
  description: string;
  category: string | null;
  totalBase: number;
  occurredAtMs: number;
  splitMethod: string;
  status: string; // open | settled | cancelled
  splits: { memberId: string; shareBase: number; settledBase: number }[];
}
export interface LoadedSettlement {
  fromMemberId: string;
  toMemberId: string;
  amountBase: number;
  status: "pending" | "paid";
}
export interface LoadedSharedGoal {
  goalId: string;
  name: string;
  targetBase: number;
  currentBase: number;
  contributions: { memberId: string; weeklyBase: number }[];
}
export interface LoadedHousehold {
  id: string;
  name: string;
  type: HouseholdType;
  baseCurrency: string;
  selfMemberId: string; // the requesting user's member id in THIS household
  members: LoadedMember[];
  expenses: LoadedSharedExpense[]; // status != cancelled
  settlements: LoadedSettlement[];
  sharedGoals: LoadedSharedGoal[];
}

export interface HouseholdSummaryView {
  householdId: string;
  name: string;
  type: HouseholdType;
  memberCount: number;
  settlement: SettlementResult;
  myNetBase: number; // >0 owed to me, <0 I owe
  myToPay: { toName: string; amountBase: number }[];
  myToCollect: { fromName: string; amountBase: number }[];
  sharedSpendThisMonthBase: number;
  pendingReimbursements: number;
  sharedGoals: { name: string; progressPct: number; myWeeklyBase: number }[];
  nextAction: string;
}

export interface HouseholdIntelligence {
  hasHousehold: boolean;
  households: HouseholdSummaryView[];
  digest: string;
}

export function emptyHouseholdIntelligence(): HouseholdIntelligence {
  return { hasHousehold: false, households: [], digest: "" };
}

function monthStartMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function buildHouseholdIntelligence(input: { households: LoadedHousehold[]; nowMs: number }): HouseholdIntelligence {
  const active = input.households.filter((h) => h.members.some((m) => m.memberId === h.selfMemberId && m.status === "active"));
  if (active.length === 0) return emptyHouseholdIntelligence();

  const views: HouseholdSummaryView[] = active.map((h) => {
    const settlement = computeSettlement({
      members: h.members.filter((m) => m.status === "active" || m.userId === null).map((m) => ({ memberId: m.memberId, displayName: m.displayName })),
      expenses: h.expenses.filter((e) => e.status !== "cancelled").map((e) => ({ payerMemberId: e.payerMemberId, totalBase: e.totalBase, splits: e.splits.map((s) => ({ memberId: s.memberId, shareBase: s.shareBase })) })),
      settlements: h.settlements,
    });
    const next = memberNextSteps(settlement, h.selfMemberId);
    const myNet = settlement.balances.find((b) => b.memberId === h.selfMemberId)?.netBase ?? 0;
    const mStart = monthStartMs(input.nowMs);
    const sharedSpendThisMonth = roundMoney(h.expenses.filter((e) => e.status !== "cancelled" && e.occurredAtMs >= mStart).reduce((s, e) => s + e.totalBase, 0));
    const sharedGoals = h.sharedGoals.map((g) => ({
      name: g.name,
      progressPct: g.targetBase > 0 ? Math.min(100, Math.round((g.currentBase / g.targetBase) * 100)) : 0,
      myWeeklyBase: roundMoney(g.contributions.filter((c) => c.memberId === h.selfMemberId).reduce((s, c) => s + c.weeklyBase, 0)),
    }));

    let nextAction: string;
    if (next.toPay.length > 0) nextAction = `Te toca pasar ${next.toPay.map((t) => `${t.amountBase} a ${t.toName}`).join(" y ")}.`;
    else if (next.toCollect.length > 0) nextAction = `Te deben: ${next.toCollect.map((t) => `${t.fromName} ${t.amountBase}`).join(", ")}.`;
    else if (settlement.allSettled && h.expenses.length > 0) nextAction = "Las cuentas del grupo están cuadradas.";
    else nextAction = "Nada pendiente por ahora.";

    return {
      householdId: h.id,
      name: h.name,
      type: h.type,
      memberCount: h.members.filter((m) => m.status === "active" || m.userId === null).length,
      settlement,
      myNetBase: myNet,
      myToPay: next.toPay.map((t) => ({ toName: t.toName, amountBase: t.amountBase })),
      myToCollect: next.toCollect.map((t) => ({ fromName: t.fromName, amountBase: t.amountBase })),
      sharedSpendThisMonthBase: sharedSpendThisMonth,
      pendingReimbursements: settlement.pending.length,
      sharedGoals,
      nextAction,
    };
  });

  return { hasHousehold: true, households: views, digest: buildHouseholdDigest(views) };
}

function styleFor(type: HouseholdType): string {
  switch (type) {
    case "couple": return "pareja — tono colaborativo y tranquilo, sin llevar la cuenta como auditoría";
    case "roommates": return "convivientes — enfócate en cerrar cuentas claro y simple";
    case "trip": return "viaje — ligero y temporal; al final ayuda a cuadrar todo";
    case "family": return "familia — respetuoso y privado";
    default: return "grupo — simple y neutral";
  }
}

function buildHouseholdDigest(views: HouseholdSummaryView[]): string {
  const lines: string[] = [
    "HOGAR / FINANZAS COMPARTIDAS (genio adentro, simple afuera): coordina dinero compartido SIN tensión.",
    "REGLAS DURAS: NUNCA culpes ni digas 'gastaste más' salvo que lo pidan y esté permitido; NUNCA expongas datos personales/privados de otro miembro (la verdad personal de cada uno —su Margen, su ledger, su deuda— NO está aquí y no se comparte); habla de 'saldos pendientes', no de 'deudas' con tono de reclamo; un reembolso NO es ingreso nuevo; un gasto compartido se cuenta UNA sola vez; la personalización del hogar cambia el encuadre, nunca la verdad del dinero ni el Margen personal.",
  ];
  for (const v of views) {
    lines.push(`— ${v.name} (${styleFor(v.type)}; ${v.memberCount} personas). Gasto compartido este mes: ${v.sharedSpendThisMonthBase}. ${v.nextAction}`);
    if (v.settlement.transfers.length) lines.push(`  Camino más simple para cuadrar: ${v.settlement.transfers.map((t) => `${t.fromName}→${t.toName} ${t.amountBase}`).join("; ")}.`);
    if (v.pendingReimbursements) lines.push(`  Reembolsos marcados pendientes: ${v.pendingReimbursements}.`);
    for (const g of v.sharedGoals) lines.push(`  Meta compartida "${g.name}": ${g.progressPct}%${g.myWeeklyBase ? `, tu aporte ${g.myWeeklyBase}/sem` : ""}.`);
  }
  return lines.join("\n");
}
