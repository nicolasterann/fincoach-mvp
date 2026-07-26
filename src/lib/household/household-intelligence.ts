import { roundMoney } from "@/lib/financial/money";
import { computeSettlement, memberNextSteps, type SettlementResult } from "@/lib/household/settlement-engine";
import { upcomingBillsWithin, type Cadence } from "@/lib/household/recurring-shared";

export type HouseholdPrivacyMode = "minimal" | "standard" | "full";

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
export interface LoadedRecurringBill {
  description: string;
  amountBase: number;
  cadence: Cadence;
  anchorDay: number | null;
}
export interface LoadedHousehold {
  id: string;
  name: string;
  type: HouseholdType;
  baseCurrency: string;
  privacyMode: HouseholdPrivacyMode; // minimal | standard | full
  selfMemberId: string; // the requesting user's member id in THIS household
  members: LoadedMember[];
  expenses: LoadedSharedExpense[]; // status != cancelled
  settlements: LoadedSettlement[];
  sharedGoals: LoadedSharedGoal[];
  recurringBills: LoadedRecurringBill[]; // shared bill TEMPLATES (Stage 20 PASS 2)
}

export interface HouseholdSummaryView {
  householdId: string;
  name: string;
  type: HouseholdType;
  privacyMode: HouseholdPrivacyMode;
  memberCount: number;
  settlement: SettlementResult;
  // Visibility-aware who-owes-whom: in 'minimal' privacy ONLY transfers involving
  // the requesting member (their own position); in standard/full, the full graph.
  // The dashboard/digest render THIS, never settlement.transfers raw.
  visibleTransfers: SettlementResult["transfers"];
  myNetBase: number; // >0 owed to me, <0 I owe
  myToPay: { toName: string; amountBase: number }[];
  myToCollect: { fromName: string; amountBase: number }[];
  sharedSpendThisMonthBase: number;
  pendingReimbursements: number;
  sharedGoals: { name: string; progressPct: number; myWeeklyBase: number }[];
  upcomingSharedBills: { description: string; amountBase: number; dueISO: string; dueInDays: number }[];
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
    // Re-auditoría 3 (punto 4): el cuadre incluye a todo miembro REFERENCIADO por
    // dinero aunque ya no esté activo — su deuda no desaparece del resumen.
    const liveExpenses = h.expenses.filter((e) => e.status !== "cancelled");
    const referencedIds = new Set<string>();
    for (const e of liveExpenses) {
      referencedIds.add(e.payerMemberId);
      for (const s of e.splits) referencedIds.add(s.memberId);
    }
    for (const st of h.settlements) {
      referencedIds.add(st.fromMemberId);
      referencedIds.add(st.toMemberId);
    }
    const settlement = computeSettlement({
      members: h.members
        .filter((m) => m.status === "active" || referencedIds.has(m.memberId))
        .map((m) => ({ memberId: m.memberId, displayName: m.displayName })),
      expenses: liveExpenses.map((e) => ({ payerMemberId: e.payerMemberId, totalBase: e.totalBase, splits: e.splits.map((s) => ({ memberId: s.memberId, shareBase: s.shareBase })) })),
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
    const upcomingSharedBills = upcomingBillsWithin(
      h.recurringBills.map((b) => ({ description: b.description, amountBase: b.amountBase, cadence: b.cadence, anchorDay: b.anchorDay })),
      input.nowMs,
      14,
    );

    // Visibility enforcement: in 'minimal' privacy a member sees ONLY their own
    // position in the who-owes-whom graph (never the full graph among others).
    // standard/full expose the full settlement transfers. Personal data of any
    // member is structurally never here regardless of mode.
    const visibleTransfers =
      h.privacyMode === "minimal"
        ? settlement.transfers.filter((t) => t.fromMemberId === h.selfMemberId || t.toMemberId === h.selfMemberId)
        : settlement.transfers;

    let nextAction: string;
    if (next.toPay.length > 0) nextAction = `Te toca pasar ${next.toPay.map((t) => `${t.amountBase} a ${t.toName}`).join(" y ")}.`;
    else if (next.toCollect.length > 0) nextAction = `Te deben: ${next.toCollect.map((t) => `${t.fromName} ${t.amountBase}`).join(", ")}.`;
    else if (upcomingSharedBills.length > 0) nextAction = `Viene ${upcomingSharedBills[0].description} (${upcomingSharedBills[0].amountBase}) en ${upcomingSharedBills[0].dueInDays} día(s).`;
    else if (settlement.allSettled && h.expenses.length > 0) nextAction = "Las cuentas del grupo están cuadradas.";
    else nextAction = "Nada pendiente por ahora.";

    return {
      householdId: h.id,
      name: h.name,
      type: h.type,
      privacyMode: h.privacyMode,
      memberCount: h.members.filter((m) => m.status === "active").length,
      settlement,
      visibleTransfers,
      myNetBase: myNet,
      myToPay: next.toPay.map((t) => ({ toName: t.toName, amountBase: t.amountBase })),
      myToCollect: next.toCollect.map((t) => ({ fromName: t.fromName, amountBase: t.amountBase })),
      sharedSpendThisMonthBase: sharedSpendThisMonth,
      pendingReimbursements: settlement.pending.length,
      sharedGoals,
      upcomingSharedBills,
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
    "REGLAS DURAS: NUNCA culpes ni digas 'gastaste más' salvo que lo pidan y esté permitido; NUNCA expongas datos personales/privados de otro miembro (la verdad personal de cada uno —su Saldo, su ledger, su deuda— NO está aquí y no se comparte); habla de 'saldos pendientes', no de 'deudas' con tono de reclamo; un reembolso NO es ingreso nuevo; un gasto compartido se cuenta UNA sola vez; la personalización del hogar cambia el encuadre, nunca la verdad del dinero ni el Saldo personal.",
  ];
  for (const v of views) {
    lines.push(`— ${v.name} (${styleFor(v.type)}; ${v.memberCount} personas; privacidad ${v.privacyMode}). Gasto compartido este mes: ${v.sharedSpendThisMonthBase}. ${v.nextAction}`);
    // Visibility-aware: only the transfers this member is allowed to see (minimal =
    // their own position only). Never narrate other members' full balance graph in minimal.
    if (v.visibleTransfers.length) lines.push(`  ${v.privacyMode === "minimal" ? "Tu parte para cuadrar" : "Camino más simple para cuadrar"}: ${v.visibleTransfers.map((t) => `${t.fromName}→${t.toName} ${t.amountBase}`).join("; ")}.`);
    if (v.upcomingSharedBills.length) lines.push(`  Gastos compartidos que vienen: ${v.upcomingSharedBills.map((b) => `${b.description} ${b.amountBase} (en ${b.dueInDays}d)`).join("; ")}.`);
    if (v.pendingReimbursements) lines.push(`  Reembolsos marcados pendientes: ${v.pendingReimbursements}.`);
    for (const g of v.sharedGoals) lines.push(`  Meta compartida "${g.name}": ${g.progressPct}%${g.myWeeklyBase ? `, tu aporte ${g.myWeeklyBase}/sem` : ""}.`);
  }
  return lines.join("\n");
}

// Plain-language answer to "¿qué puede ver mi hogar?" — for the agent / a dashboard
// note. Honest about the privacy boundary, never exposes another member's data.
export function householdVisibilityExplainer(view: HouseholdSummaryView): string {
  const shared =
    "Tu hogar SOLO ve lo compartido: los gastos compartidos que registran, cómo se dividen, los saldos pendientes entre ustedes y las metas compartidas. NUNCA ve tus cuentas, tu saldo, tu Saldo, tus deudas ni tus gastos personales.";
  const mode =
    view.privacyMode === "minimal"
      ? "Estás en modo MÍNIMO: cada quien ve principalmente su propia parte (lo que debe o le deben), no el detalle de los saldos entre los demás."
      : view.privacyMode === "standard"
        ? "Estás en modo ESTÁNDAR: todos ven los saldos compartidos y el camino para cuadrar."
        : "Estás en modo COMPLETO: todos ven el detalle compartido del grupo.";
  return `${shared} ${mode}`;
}
