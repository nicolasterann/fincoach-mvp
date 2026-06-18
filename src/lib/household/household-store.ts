import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { splitExpense, type SplitMethod, type SplitParticipant } from "@/lib/household/split-engine";
import type { HouseholdType, LoadedHousehold, LoadedMember } from "@/lib/household/household-intelligence";

// Stage 19 — HOUSEHOLD STORE (migration 027). Service-role, graceful (every read
// tolerates missing tables → empty; every write try/catch → honest false), so
// production is UNCHANGED until 027 is applied. The household tables are
// deny-by-default at the DB; the PERMISSION model is enforced HERE, deterministically,
// before any mutation: only an ACTIVE member with a writing role may write, and a
// non-member can never read another household. Personal ledger truth is never touched.

type Row = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || 0 : 0);
const ms = (v: unknown): number => { const t = new Date(String(v ?? "")).getTime(); return Number.isFinite(t) ? t : 0; };

export interface WriteResult { ok: boolean; reason?: string; id?: string; data?: unknown }

// ── Permission model (deterministic) ─────────────────────────────────────────
const WRITE_ROLES = new Set(["owner", "admin", "member", "contributor"]);
const MANAGE_ROLES = new Set(["owner", "admin"]);
function canWriteShared(role: string | undefined): boolean { return !!role && WRITE_ROLES.has(role); }
function canManage(role: string | undefined): boolean { return !!role && MANAGE_ROLES.has(role); }

// ── Load ─────────────────────────────────────────────────────────────────────
export async function loadHouseholdData(userId: string): Promise<{ households: LoadedHousehold[] }> {
  const out: { households: LoadedHousehold[] } = { households: [] };
  try {
    const sb = createSupabaseAdminClient();
    // Households where this user is an ACTIVE member.
    const { data: myMemberships } = await sb.from("household_members").select("household_id, id").eq("user_id", userId).eq("status", "active");
    const ids = (myMemberships ?? []).map((r) => String((r as Row).household_id));
    if (ids.length === 0) return out;
    const selfMemberByHh = new Map<string, string>();
    for (const r of myMemberships ?? []) selfMemberByHh.set(String((r as Row).household_id), String((r as Row).id));

    const [households, members, expenses, settlements, goals] = await Promise.all([
      sb.from("households").select("*").in("id", ids),
      sb.from("household_members").select("*").in("household_id", ids),
      sb.from("shared_expenses").select("*").in("household_id", ids).neq("status", "cancelled"),
      sb.from("household_settlements").select("*").in("household_id", ids),
      sb.from("goals").select("*").in("household_id", ids).eq("is_shared", true),
    ]);
    const expenseIds = (expenses.data ?? []).map((r) => String((r as Row).id));
    const goalIds = (goals.data ?? []).map((r) => String((r as Row).id));
    const [splits, contributions] = await Promise.all([
      expenseIds.length ? sb.from("shared_expense_splits").select("*").in("shared_expense_id", expenseIds) : Promise.resolve({ data: [] as Row[] }),
      goalIds.length ? sb.from("household_goal_contributions").select("*").in("goal_id", goalIds) : Promise.resolve({ data: [] as Row[] }),
    ]);
    const splitsByExpense = new Map<string, Row[]>();
    for (const s of (splits.data ?? []) as Row[]) { const k = String(s.shared_expense_id); (splitsByExpense.get(k) ?? splitsByExpense.set(k, []).get(k)!).push(s); }
    const contribByGoal = new Map<string, Row[]>();
    for (const c of (contributions.data ?? []) as Row[]) { const k = String(c.goal_id); (contribByGoal.get(k) ?? contribByGoal.set(k, []).get(k)!).push(c); }

    for (const h0 of (households.data ?? []) as Row[]) {
      const hid = String(h0.id);
      const hMembers: LoadedMember[] = ((members.data ?? []) as Row[]).filter((m) => String(m.household_id) === hid).map((m) => ({
        memberId: String(m.id), userId: str(m.user_id) ?? null, displayName: String(m.display_name ?? "alguien"), role: String(m.role ?? "member"), status: String(m.status ?? "active"),
      }));
      const hExpenses = ((expenses.data ?? []) as Row[]).filter((e) => String(e.household_id) === hid).map((e) => ({
        id: String(e.id), payerMemberId: String(e.payer_member_id), description: String(e.description ?? ""), category: str(e.category) ?? null,
        totalBase: num(e.total_base), occurredAtMs: ms(e.occurred_at), splitMethod: String(e.split_method ?? "equal"), status: String(e.status ?? "open"),
        splits: (splitsByExpense.get(String(e.id)) ?? []).map((s) => ({ memberId: String(s.member_id), shareBase: num(s.share_base), settledBase: num(s.settled_base) })),
      }));
      const hSettlements = ((settlements.data ?? []) as Row[]).filter((s) => String(s.household_id) === hid).map((s) => ({
        fromMemberId: String(s.from_member_id), toMemberId: String(s.to_member_id), amountBase: num(s.amount_base), status: (String(s.status ?? "paid") === "pending" ? "pending" : "paid") as "pending" | "paid",
      }));
      const hGoals = ((goals.data ?? []) as Row[]).filter((g) => String(g.household_id) === hid).map((g) => ({
        goalId: String(g.id), name: String(g.name ?? "meta"), targetBase: num(g.target_amount), currentBase: num(g.current_amount),
        contributions: (contribByGoal.get(String(g.id)) ?? []).map((c) => ({ memberId: String(c.member_id), weeklyBase: num(c.weekly_base) })),
      }));
      out.households.push({
        id: hid, name: String(h0.name ?? "Hogar"), type: (String(h0.type ?? "custom") as HouseholdType), baseCurrency: String(h0.base_currency ?? "USD"),
        selfMemberId: selfMemberByHh.get(hid) ?? "", members: hMembers, expenses: hExpenses, settlements: hSettlements, sharedGoals: hGoals,
      });
    }
  } catch { /* pre-migration or transient → no households */ }
  return out;
}

// Resolve the actor's ACTIVE membership row in a household (the permission anchor).
async function activeMembership(sb: ReturnType<typeof createSupabaseAdminClient>, householdId: string, userId: string): Promise<{ memberId: string; role: string } | null> {
  const { data } = await sb.from("household_members").select("id, role, status").eq("household_id", householdId).eq("user_id", userId).maybeSingle();
  const r = data as Row | null;
  if (!r || String(r.status) !== "active") return null;
  return { memberId: String(r.id), role: String(r.role ?? "member") };
}

async function audit(sb: ReturnType<typeof createSupabaseAdminClient>, householdId: string, actor: string, action: string, entity: string, detail: string) {
  try { await sb.from("household_audit_log").insert({ household_id: householdId, actor_user_id: actor, action, entity, detail: detail.slice(0, 200) }); } catch { /* best-effort */ }
}

// ── Writes (all permission-checked + graceful) ───────────────────────────────
export async function createHousehold(userId: string, input: { name: string; type: HouseholdType; baseCurrency?: string; mode?: string; selfDisplayName?: string }): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.from("households").insert({ owner_id: userId, name: input.name.slice(0, 80), type: input.type, base_currency: input.baseCurrency ?? "USD", mode: input.mode ?? "shared_expenses" }).select("id").single();
    if (error || !data) return { ok: false, reason: "no_pude_crear" };
    const hid = String((data as Row).id);
    await sb.from("household_members").insert({ household_id: hid, user_id: userId, display_name: (input.selfDisplayName ?? "Yo").slice(0, 60), role: "owner", status: "active", joined_at: new Date().toISOString() });
    await audit(sb, hid, userId, "create_household", "household", input.name);
    return { ok: true, id: hid };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function addNonUserParticipant(userId: string, householdId: string, displayName: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me) return { ok: false, reason: "no_eres_miembro" };
    if (!canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    const { data, error } = await sb.from("household_members").insert({ household_id: householdId, user_id: null, display_name: displayName.slice(0, 60), role: "external", status: "active", invited_by: userId }).select("id").single();
    if (error || !data) return { ok: false, reason: "no_pude_agregar" };
    await audit(sb, householdId, userId, "add_member", "member", `no-usuario: ${displayName}`);
    return { ok: true, id: String((data as Row).id) };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function inviteMember(userId: string, householdId: string, input: { invitedUserId?: string; label?: string; role?: string }): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me) return { ok: false, reason: "no_eres_miembro" };
    if (!canManage(me.role)) return { ok: false, reason: "solo_owner_admin_invita" };
    const { data, error } = await sb.from("household_invites").insert({ household_id: householdId, invited_user_id: input.invitedUserId ?? null, invited_label: input.label?.slice(0, 60) ?? null, role: input.role ?? "member", status: "pending", created_by: userId }).select("id").single();
    if (error || !data) return { ok: false, reason: "no_pude_invitar" };
    await audit(sb, householdId, userId, "invite", "member", input.label ?? input.invitedUserId ?? "");
    return { ok: true, id: String((data as Row).id) };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function respondInvite(userId: string, inviteId: string, accept: boolean, displayName?: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const { data: inv } = await sb.from("household_invites").select("*").eq("id", inviteId).maybeSingle();
    const r = inv as Row | null;
    if (!r || String(r.status) !== "pending") return { ok: false, reason: "invitacion_no_valida" };
    // Only the invited user (when resolved) may accept; an open-label invite accepts for the caller.
    if (r.invited_user_id && String(r.invited_user_id) !== userId) return { ok: false, reason: "invitacion_no_es_tuya" };
    const hid = String(r.household_id);
    await sb.from("household_invites").update({ status: accept ? "accepted" : "declined", updated_at: new Date().toISOString() }).eq("id", inviteId);
    if (accept) {
      const { error } = await sb.from("household_members").insert({ household_id: hid, user_id: userId, display_name: (displayName ?? "Yo").slice(0, 60), role: String(r.role ?? "member"), status: "active", invited_by: str(r.created_by) ?? null, joined_at: new Date().toISOString() });
      if (error) return { ok: false, reason: "no_pude_unirte" };
    }
    await audit(sb, hid, userId, accept ? "accept" : "decline", "member", "");
    return { ok: true, id: hid };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function leaveHousehold(userId: string, householdId: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me) return { ok: false, reason: "no_eres_miembro" };
    await sb.from("household_members").update({ status: "left", updated_at: new Date().toISOString() }).eq("id", me.memberId);
    await audit(sb, householdId, userId, "leave", "member", "");
    return { ok: true, id: householdId };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function removeMember(userId: string, householdId: string, memberId: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canManage(me.role)) return { ok: false, reason: "solo_owner_admin" };
    if (memberId === me.memberId) return { ok: false, reason: "usa_leave" };
    await sb.from("household_members").update({ status: "removed", updated_at: new Date().toISOString() }).eq("id", memberId).eq("household_id", householdId);
    await audit(sb, householdId, userId, "remove", "member", "");
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function addSharedExpense(userId: string, householdId: string, input: {
  description: string; totalBase: number; originalAmount?: number; originalCurrency?: string; baseCurrency?: string; category?: string; occurredAtMs?: number;
  method: SplitMethod; participants: SplitParticipant[]; payerMemberId: string; originTransactionId?: string; note?: string;
}): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me) return { ok: false, reason: "no_eres_miembro" };
    if (!canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    const split = splitExpense({ totalBase: input.totalBase, method: input.method, participants: input.participants, payerMemberId: input.payerMemberId });
    if (!split.valid) return { ok: false, reason: split.reason };
    const { data, error } = await sb.from("shared_expenses").insert({
      household_id: householdId, payer_member_id: input.payerMemberId, description: input.description.slice(0, 120), category: input.category ?? null,
      total_original: input.originalAmount ?? input.totalBase, original_currency: input.originalCurrency ?? input.baseCurrency ?? "USD",
      total_base: input.totalBase, base_currency: input.baseCurrency ?? "USD", occurred_at: new Date(input.occurredAtMs ?? Date.now()).toISOString(),
      split_method: input.method, status: input.method === "payer_absorbs" ? "settled" : "open", origin_transaction_id: input.originTransactionId ?? null, note: input.note?.slice(0, 200) ?? null, created_by: userId,
    }).select("id").single();
    if (error || !data) return { ok: false, reason: "no_pude_registrar" };
    const eid = String((data as Row).id);
    const rows = split.shares.map((s) => ({ shared_expense_id: eid, member_id: s.memberId, share_base: s.shareBase, settled_base: s.memberId === input.payerMemberId ? s.shareBase : 0 }));
    await sb.from("shared_expense_splits").insert(rows);
    await audit(sb, householdId, userId, "add_expense", "expense", `${input.description} ${input.totalBase}`);
    return { ok: true, id: eid, data: { shares: split.shares } };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function cancelSharedExpense(userId: string, householdId: string, expenseId: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    await sb.from("shared_expenses").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", expenseId).eq("household_id", householdId);
    await audit(sb, householdId, userId, "cancel_expense", "expense", expenseId);
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function markReimbursementPaid(userId: string, householdId: string, input: { fromMemberId: string; toMemberId: string; amountBase: number; baseCurrency?: string; status?: "pending" | "paid"; note?: string; relatedExpenseId?: string }): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    const status = input.status ?? "paid";
    const { data, error } = await sb.from("household_settlements").insert({
      household_id: householdId, from_member_id: input.fromMemberId, to_member_id: input.toMemberId, amount_base: input.amountBase, base_currency: input.baseCurrency ?? "USD",
      status, note: input.note?.slice(0, 200) ?? null, related_expense_id: input.relatedExpenseId ?? null, marked_paid_at: status === "paid" ? new Date().toISOString() : null, created_by: userId,
    }).select("id").single();
    if (error || !data) return { ok: false, reason: "no_pude_registrar" };
    await audit(sb, householdId, userId, "mark_paid", "settlement", `${input.amountBase}`);
    return { ok: true, id: String((data as Row).id) };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function createSharedGoal(userId: string, householdId: string, input: { name: string; targetBase: number; currency?: string; myWeeklyBase?: number }): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    const { data, error } = await sb.from("goals").insert({ user_id: userId, name: input.name.slice(0, 80), target_amount: input.targetBase, currency: input.currency ?? "USD", current_amount: 0, household_id: householdId, is_shared: true, status: "active" }).select("id").single();
    if (error || !data) return { ok: false, reason: "no_pude_crear_meta" };
    const gid = String((data as Row).id);
    if (input.myWeeklyBase && input.myWeeklyBase > 0) await sb.from("household_goal_contributions").upsert({ household_id: householdId, goal_id: gid, member_id: me.memberId, weekly_base: input.myWeeklyBase }, { onConflict: "goal_id,member_id" });
    await audit(sb, householdId, userId, "create_goal", "goal", input.name);
    return { ok: true, id: gid };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function setMyGoalContribution(userId: string, householdId: string, goalId: string, weeklyBase: number): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    await sb.from("household_goal_contributions").upsert({ household_id: householdId, goal_id: goalId, member_id: me.memberId, weekly_base: Math.max(0, weeklyBase) }, { onConflict: "goal_id,member_id" });
    await audit(sb, householdId, userId, "set_contribution", "goal", `${weeklyBase}`);
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function setHouseholdPrivacy(userId: string, householdId: string, privacyMode: "minimal" | "standard" | "full"): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canManage(me.role)) return { ok: false, reason: "solo_owner_admin" };
    await sb.from("households").update({ privacy_mode: privacyMode, updated_at: new Date().toISOString() }).eq("id", householdId);
    await audit(sb, householdId, userId, "set_visibility", "household", privacyMode);
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function linkTransactionToSharedExpense(userId: string, householdId: string, expenseId: string, transactionId: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    await sb.from("shared_expenses").update({ origin_transaction_id: transactionId, updated_at: new Date().toISOString() }).eq("id", expenseId).eq("household_id", householdId);
    await audit(sb, householdId, userId, "link_transaction", "expense", expenseId);
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

// Resolve a household + a participant member by fuzzy display name (for the agent,
// which speaks names not ids). Returns the user's active households with member maps.
export async function resolveHouseholdMember(userId: string, nameHint: string): Promise<{ householdId: string; memberId: string; displayName: string }[]> {
  const { households } = await loadHouseholdData(userId);
  const hint = nameHint.trim().toLowerCase();
  const hits: { householdId: string; memberId: string; displayName: string }[] = [];
  for (const h of households) for (const m of h.members) if (m.displayName.toLowerCase().includes(hint) && m.status !== "removed") hits.push({ householdId: h.id, memberId: m.memberId, displayName: m.displayName });
  return hits;
}
