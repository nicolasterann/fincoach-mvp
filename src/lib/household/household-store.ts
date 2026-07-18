import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { splitExpense, type SplitMethod, type SplitParticipant } from "@/lib/household/split-engine";
import { computeSettlement } from "@/lib/household/settlement-engine";
import { moneyReadPublishable } from "@/lib/financial/money-read";
import type { Cadence } from "@/lib/household/recurring-shared";
import type { HouseholdType, HouseholdPrivacyMode, LoadedHousehold, LoadedMember, LoadedRecurringBill } from "@/lib/household/household-intelligence";

const INVITE_TTL_MS = 14 * 86_400_000; // pending invites expire after 14 days (computed; no schema column)

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

/** Resultado crudo de una RPC household (migración 060) — inyectable para que el
 *  gate recorra los writers sin base. */
export type HouseholdRpcResult = { data: unknown; error: { code?: string; message?: string } | null };
const rpcConflict = (e: { code?: string; message?: string } | null): boolean =>
  !!e && (e.code === "40001" || /KIPU_CONFLICT/.test(e.message ?? ""));

// ── Permission model (deterministic) ─────────────────────────────────────────
const WRITE_ROLES = new Set(["owner", "admin", "member", "contributor"]);
const MANAGE_ROLES = new Set(["owner", "admin"]);
function canWriteShared(role: string | undefined): boolean { return !!role && WRITE_ROLES.has(role); }
function canManage(role: string | undefined): boolean { return !!role && MANAGE_ROLES.has(role); }

// ── Load ─────────────────────────────────────────────────────────────────────

/** Una lectura del hogar que reporta sobre sí misma. Ver `money-read.ts`.
 *  No tener hogares es `ok:true` con lista vacía — la ausencia es legítima; el fallo
 *  es otra frase. */
export type HouseholdRead =
  | { ok: true; complete: true; households: LoadedHousehold[] }
  | { ok: true; complete: false; partial: LoadedHousehold[] }
  | { ok: false; complete: false };

const failedHouseholdRead = (): HouseholdRead => ({ ok: false, complete: false });

// Caps de sanidad por consulta. PostgREST tiene un tope de SERVIDOR (~1000 filas)
// que trunca EN SILENCIO cualquier query sin `.limit()` — y NINGUNA de estas nueve
// lo tenía, así que "lo vi todo" era una suposición. Cada consulta pide CAP+1: la
// fila extra ES la prueba de que había cola que no vimos ⇒ complete:false. Todos
// los caps quedan por debajo de 1000 para que el tope explícito mande siempre.
export const HOUSEHOLD_READ_CAPS = {
  memberships: 50, // hogares por usuario
  households: 50,
  members: 200,
  expenses: 500,
  settlements: 500,
  goals: 200,
  splits: 900, // la más voluminosa (gastos × miembros); 900 < tope de servidor
  contributions: 900,
  recurring: 200,
} as const;

type FetchedPage = { rows: Row[] | null; failed: boolean };

/** La lectura, inyectada — el mismo seam que `readInstallmentPlansWith`: los caminos
 *  que importan (una consulta fallida, un tope alcanzado) se ejercitan de verdad en
 *  el gate, no contra un fixture que imagina la forma de la respuesta. */
export type HouseholdReadDeps = {
  fetchMyMemberships: (limit: number) => Promise<FetchedPage>;
  fetchHouseholds: (ids: string[], limit: number) => Promise<FetchedPage>;
  fetchMembers: (ids: string[], limit: number) => Promise<FetchedPage>;
  fetchExpenses: (ids: string[], limit: number) => Promise<FetchedPage>;
  fetchSettlements: (ids: string[], limit: number) => Promise<FetchedPage>;
  fetchGoals: (ids: string[], limit: number) => Promise<FetchedPage>;
  fetchSplits: (expenseIds: string[], limit: number) => Promise<FetchedPage>;
  fetchContributions: (goalIds: string[], limit: number) => Promise<FetchedPage>;
  fetchRecurring: (ids: string[], limit: number) => Promise<FetchedPage>;
};

/** Toda la lógica de confiabilidad de la lectura del hogar.
 *
 *  Un fallo (error de PostgREST o excepción) ⇒ ok:false, lista vacía: una foto
 *  parcial del hogar es peor que ninguna. Un TOPE alcanzado en cualquier página ⇒
 *  ok:true pero complete:false: nada falló, pero no podemos PROBAR que vimos todo
 *  — el display puede degradarse con la foto recortada; el dinero
 *  (`moneyReadPublishable`) rehúsa. */
export async function readHouseholdDataWith(deps: HouseholdReadDeps): Promise<HouseholdRead> {
  const out: LoadedHousehold[] = [];
  try {
    let capped = false;
    // Pedimos cap+1 y aceptamos cap: la fila extra solo existe para probar la cola.
    const take = (p: FetchedPage, cap: number): Row[] | null => {
      if (p.failed || !p.rows) return null;
      if (p.rows.length > cap) { capped = true; return p.rows.slice(0, cap); }
      return p.rows;
    };
    const CAPS = HOUSEHOLD_READ_CAPS;
    // Households where this user is an ACTIVE member.
    const myMemberships = take(await deps.fetchMyMemberships(CAPS.memberships + 1), CAPS.memberships);
    if (!myMemberships) return failedHouseholdRead();
    const ids = myMemberships.map((r) => String(r.household_id));
    // Ausencia legítima: este usuario no comparte gastos con nadie. Eso SÍ es publicable.
    if (ids.length === 0) return { ok: true, complete: true, households: out };
    const selfMemberByHh = new Map<string, string>();
    for (const r of myMemberships) selfMemberByHh.set(String(r.household_id), String(r.id));

    const [householdsPage, membersPage, expensesPage, settlementsPage, goalsPage] = await Promise.all([
      deps.fetchHouseholds(ids, CAPS.households + 1),
      deps.fetchMembers(ids, CAPS.members + 1),
      deps.fetchExpenses(ids, CAPS.expenses + 1),
      deps.fetchSettlements(ids, CAPS.settlements + 1),
      deps.fetchGoals(ids, CAPS.goals + 1),
    ]);
    const householdRows = take(householdsPage, CAPS.households);
    const memberRows = take(membersPage, CAPS.members);
    const expenseRows = take(expensesPage, CAPS.expenses);
    const settlementRows = take(settlementsPage, CAPS.settlements);
    const goalRows = take(goalsPage, CAPS.goals);
    if (!householdRows || !memberRows || !expenseRows || !settlementRows || !goalRows) return failedHouseholdRead();
    const expenseIds = expenseRows.map((r) => String(r.id));
    const goalIds = goalRows.map((r) => String(r.id));
    const emptyPage: FetchedPage = { rows: [], failed: false };
    const [splitsPage, contributionsPage] = await Promise.all([
      expenseIds.length ? deps.fetchSplits(expenseIds, CAPS.splits + 1) : Promise.resolve(emptyPage),
      goalIds.length ? deps.fetchContributions(goalIds, CAPS.contributions + 1) : Promise.resolve(emptyPage),
    ]);
    // Sin los splits, un gasto queda con payer y total pero sin quién carga qué: el
    // pagador aparece acreedor del total entero contra nadie.
    const splitRows = take(splitsPage, CAPS.splits);
    const contributionRows = take(contributionsPage, CAPS.contributions);
    if (!splitRows || !contributionRows) return failedHouseholdRead();
    const splitsByExpense = new Map<string, Row[]>();
    for (const s of splitRows) { const k = String(s.shared_expense_id); (splitsByExpense.get(k) ?? splitsByExpense.set(k, []).get(k)!).push(s); }
    const contribByGoal = new Map<string, Row[]>();
    for (const c of contributionRows) { const k = String(c.goal_id); (contribByGoal.get(k) ?? contribByGoal.set(k, []).get(k)!).push(c); }

    // Recurring shared bills (Stage 20 PASS 2, migration 031) — loaded SEPARATELY +
    // guarded so a pre-migration project never breaks household loading.
    // No tumban `ok` (son un CALENDARIO, no plata ya gastada: perderlos no reescribe
    // ningún balance), pero sí `complete`: sin ellos el hogar subestima lo que viene,
    // que es otra vez el número MEJOR que el real. Un tope aquí es la misma frase:
    // vimos parte del calendario y no podemos probar cuánta.
    const recurringByHh = new Map<string, LoadedRecurringBill[]>();
    let recurringComplete = true;
    try {
      const recurringPage = await deps.fetchRecurring(ids, CAPS.recurring + 1);
      let recurringRows: Row[] = [];
      if (recurringPage.failed || !recurringPage.rows) recurringComplete = false;
      else if (recurringPage.rows.length > CAPS.recurring) { recurringComplete = false; recurringRows = recurringPage.rows.slice(0, CAPS.recurring); }
      else recurringRows = recurringPage.rows;
      for (const r of recurringRows) {
        const k = String(r.household_id);
        const list = recurringByHh.get(k) ?? [];
        list.push({
          description: String(r.description ?? ""),
          amountBase: num(r.amount_base),
          cadence: (String(r.cadence ?? "monthly") as Cadence),
          anchorDay: r.anchor_day == null ? null : (typeof r.anchor_day === "number" ? r.anchor_day : parseInt(String(r.anchor_day)) || null),
        });
        recurringByHh.set(k, list);
      }
    } catch { recurringComplete = false; /* pre-migration → no recurring bills */ }

    for (const h0 of householdRows) {
      const hid = String(h0.id);
      const hMembers: LoadedMember[] = memberRows.filter((m) => String(m.household_id) === hid).map((m) => ({
        memberId: String(m.id), userId: str(m.user_id) ?? null, displayName: String(m.display_name ?? "alguien"), role: String(m.role ?? "member"), status: String(m.status ?? "active"),
      }));
      const hExpenses = expenseRows.filter((e) => String(e.household_id) === hid).map((e) => ({
        id: String(e.id), payerMemberId: String(e.payer_member_id), description: String(e.description ?? ""), category: str(e.category) ?? null,
        totalBase: num(e.total_base), occurredAtMs: ms(e.occurred_at), splitMethod: String(e.split_method ?? "equal"), status: String(e.status ?? "open"),
        splits: (splitsByExpense.get(String(e.id)) ?? []).map((s) => ({ memberId: String(s.member_id), shareBase: num(s.share_base), settledBase: num(s.settled_base) })),
      }));
      const hSettlements = settlementRows.filter((s) => String(s.household_id) === hid).map((s) => ({
        fromMemberId: String(s.from_member_id), toMemberId: String(s.to_member_id), amountBase: num(s.amount_base), status: (String(s.status ?? "paid") === "pending" ? "pending" : "paid") as "pending" | "paid",
      }));
      const hGoals = goalRows.filter((g) => String(g.household_id) === hid).map((g) => ({
        goalId: String(g.id), name: String(g.name ?? "meta"), targetBase: num(g.target_amount), currentBase: num(g.current_amount),
        contributions: (contribByGoal.get(String(g.id)) ?? []).map((c) => ({ memberId: String(c.member_id), weeklyBase: num(c.weekly_base) })),
      }));
      out.push({
        id: hid, name: String(h0.name ?? "Hogar"), type: (String(h0.type ?? "custom") as HouseholdType), baseCurrency: String(h0.base_currency ?? "USD"),
        privacyMode: (["minimal", "standard", "full"].includes(String(h0.privacy_mode)) ? String(h0.privacy_mode) : "minimal") as HouseholdPrivacyMode,
        selfMemberId: selfMemberByHh.get(hid) ?? "", members: hMembers, expenses: hExpenses, settlements: hSettlements, sharedGoals: hGoals,
        recurringBills: recurringByHh.get(hid) ?? [],
      });
    }
    return !capped && recurringComplete
      ? { ok: true, complete: true, households: out }
      : { ok: true, complete: false, partial: out };
  } catch {
    return failedHouseholdRead();
  }
}

/** La lectura HONESTA del hogar.
 *
 *  Ninguna de las consultas miraba su `error`, y PostgREST reporta un fallo como
 *  {data:null,error} SIN lanzar: el fallo llegaba río abajo disfrazado de un hecho.
 *  El peor de los seis es `household_settlements`: al perderse (por error O por
 *  truncación), los reembolsos YA PAGADOS desaparecen y computeSettlement vuelve a
 *  ver deudas que alguien ya saldó — el balance compartido acusa de deber a quien ya
 *  pagó, y settleHousehold llega a RE-INSERTAR esas transferencias como pagadas
 *  (doble reembolso, escrito). */
export async function readHouseholdData(userId: string): Promise<HouseholdRead> {
  let sb: ReturnType<typeof createSupabaseAdminClient>;
  try { sb = createSupabaseAdminClient(); } catch { return failedHouseholdRead(); }
  // PostgREST reporta un fallo como { data: null, error } SIN lanzar; cada fetcher
  // lo normaliza al contrato de página y el helper decide con eso.
  const q = async (run: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<FetchedPage> => {
    try {
      const { data, error } = await run();
      return { rows: (data as Row[] | null) ?? null, failed: !!error };
    } catch {
      return { rows: null, failed: true };
    }
  };
  return readHouseholdDataWith({
    fetchMyMemberships: (limit) => q(() => sb.from("household_members").select("household_id, id").eq("user_id", userId).eq("status", "active").limit(limit)),
    fetchHouseholds: (ids, limit) => q(() => sb.from("households").select("*").in("id", ids).limit(limit)),
    fetchMembers: (ids, limit) => q(() => sb.from("household_members").select("*").in("household_id", ids).limit(limit)),
    fetchExpenses: (ids, limit) => q(() => sb.from("shared_expenses").select("*").in("household_id", ids).neq("status", "cancelled").limit(limit)),
    fetchSettlements: (ids, limit) => q(() => sb.from("household_settlements").select("*").in("household_id", ids).limit(limit)),
    fetchGoals: (ids, limit) => q(() => sb.from("goals").select("*").in("household_id", ids).eq("is_shared", true).limit(limit)),
    fetchSplits: (expenseIds, limit) => q(() => sb.from("shared_expense_splits").select("*").in("shared_expense_id", expenseIds).limit(limit)),
    fetchContributions: (goalIds, limit) => q(() => sb.from("household_goal_contributions").select("*").in("goal_id", goalIds).limit(limit)),
    fetchRecurring: (ids, limit) => q(() => sb.from("household_recurring_expenses").select("*").in("household_id", ids).eq("active", true).limit(limit)),
  });
}

/** DISPLAY / best-effort: colapsa el fallo a "no tienes hogares" — justo la confusión
 *  que `money-read.ts` existe para impedir. Sirve a quien solo LISTA o resuelve
 *  nombres. Para decidir dinero (saldar, registrar un gasto compartido) usa
 *  `readHouseholdData` y respeta su veredicto. */
export async function loadHouseholdData(userId: string): Promise<{ households: LoadedHousehold[] }> {
  const read = await readHouseholdData(userId);
  return { households: read.ok ? (read.complete ? read.households : read.partial) : [] };
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
    // El owner-member es el ANCLA de permisos: sin él, nace un hogar al que nadie
    // puede escribir jamás (activeMembership siempre null). Si su insert falla, el
    // hogar recién creado se limpia (fila vacía de este mismo call, sin datos) y la
    // operación FALLA de verdad en vez de confirmar un éxito inservible.
    const { error: memberErr } = await sb.from("household_members").insert({ household_id: hid, user_id: userId, display_name: (input.selfDisplayName ?? "Yo").slice(0, 60), role: "owner", status: "active", joined_at: new Date().toISOString() });
    if (memberErr) {
      await sb.from("households").delete().eq("id", hid).eq("owner_id", userId);
      return { ok: false, reason: "no_pude_crear" };
    }
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
    // El MIEMBRO primero, el estado del invite después (mismo orden que
    // acceptInviteByToken): marcar 'accepted' antes de un insert que falla dejaba
    // el invite consumido sin miembro — media aceptación irreversible.
    if (accept) {
      const { error } = await sb.from("household_members").insert({ household_id: hid, user_id: userId, display_name: (displayName ?? "Yo").slice(0, 60), role: String(r.role ?? "member"), status: "active", invited_by: str(r.created_by) ?? null, joined_at: new Date().toISOString() });
      if (error) return { ok: false, reason: "no_pude_unirte" };
    }
    const { error: invErr } = await sb.from("household_invites").update({ status: accept ? "accepted" : "declined", updated_at: new Date().toISOString() }).eq("id", inviteId);
    if (invErr && !accept) return { ok: false, reason: "no_disponible" };
    // accept con update fallido: el miembro YA está dentro (lo importante aterrizó);
    // el invite pendiente se re-acepta idempotente (el unique index absorbe el dup).
    await audit(sb, hid, userId, accept ? "accept" : "decline", "member", "");
    return { ok: true, id: hid };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function leaveHousehold(userId: string, householdId: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me) return { ok: false, reason: "no_eres_miembro" };
    const { error: leaveErr } = await sb.from("household_members").update({ status: "left", updated_at: new Date().toISOString() }).eq("id", me.memberId);
    if (leaveErr) return { ok: false, reason: "no_disponible" };
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
    // Role hierarchy: nobody removes the owner, and only the owner removes an
    // admin — an admin must never be able to take over by expelling upward.
    // El `?? "member"` de abajo es el default PERMISIVO: un error de lectura hacía
    // pasar al objetivo por "member" y la jerarquía entera se caía — un admin echaba
    // al dueño con una consulta fallida. Un fallo no prueba un rol.
    const { data: targetRow, error: targetErr } = await sb.from("household_members").select("role").eq("id", memberId).eq("household_id", householdId).maybeSingle();
    if (targetErr) return { ok: false, reason: "no_disponible" };
    if (!targetRow) return { ok: false, reason: "no_encontrado" };
    const targetRole = String((targetRow as Row).role ?? "member");
    if (targetRole === "owner") return { ok: false, reason: "no_puedes_sacar_al_dueno" };
    if (targetRole === "admin" && me.role !== "owner") return { ok: false, reason: "solo_owner_saca_admin" };
    const { error: removeErr } = await sb.from("household_members").update({ status: "removed", updated_at: new Date().toISOString() }).eq("id", memberId).eq("household_id", householdId);
    if (removeErr) return { ok: false, reason: "no_disponible" };
    await audit(sb, householdId, userId, "remove", "member", "");
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export type AddSharedExpenseInput = {
  description: string; totalBase: number; originalAmount?: number; originalCurrency?: string; baseCurrency?: string; category?: string; occurredAtMs?: number;
  method: SplitMethod; participants: SplitParticipant[]; payerMemberId: string; originTransactionId?: string; note?: string;
};

/** Deps inyectables del writer, para que el gate recorra el trayecto sin base. */
export interface SharedExpenseWriteDeps {
  membership: (householdId: string) => Promise<{ memberId: string; role: string } | null>;
  rpc: (payload: Record<string, unknown>) => Promise<HouseholdRpcResult>;
}

/** Re-auditoría 2 (punto 6): el gasto y sus splits aterrizan JUNTOS o no aterriza
 *  nada — la RPC kipu_add_shared_expense (migración 060) los inserta en una
 *  transacción y valida en la DB que sum(splits) cuadre con el total y que cada
 *  miembro esté activo. El flujo viejo insertaba el gasto y luego IGNORABA el error
 *  de los splits: quedaba un gasto sin reparto (el pagador acreedor del total contra
 *  nadie), settleHousehold escribía transferencias sobre esa foto rota, y el agente
 *  narraba un desglose que nunca existió. */
export async function addSharedExpenseWith(
  deps: SharedExpenseWriteDeps,
  userId: string,
  householdId: string,
  input: AddSharedExpenseInput,
): Promise<WriteResult> {
  const me = await deps.membership(householdId);
  if (!me) return { ok: false, reason: "no_eres_miembro" };
  if (!canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
  const split = splitExpense({ totalBase: input.totalBase, method: input.method, participants: input.participants, payerMemberId: input.payerMemberId });
  if (!split.valid) return { ok: false, reason: split.reason };
  const { data, error } = await deps.rpc({
    household_id: householdId,
    payer_member_id: input.payerMemberId,
    created_by: userId,
    description: input.description.slice(0, 120),
    category: input.category ?? null,
    total_original: input.originalAmount ?? input.totalBase,
    original_currency: input.originalCurrency ?? input.baseCurrency ?? "USD",
    total_base: input.totalBase,
    base_currency: input.baseCurrency ?? "USD",
    occurred_at: new Date(input.occurredAtMs ?? Date.now()).toISOString(),
    split_method: input.method,
    status: input.method === "payer_absorbs" ? "settled" : "open",
    origin_transaction_id: input.originTransactionId ?? null,
    note: input.note?.slice(0, 200) ?? null,
    splits: split.shares.map((s) => ({
      member_id: s.memberId,
      share_base: s.shareBase,
      settled_base: s.memberId === input.payerMemberId ? s.shareBase : 0,
    })),
  });
  if (error) {
    // 40001 = el movimiento ya estaba compartido (dup-guard por origin_transaction_id
    // dentro de la transacción) y 23505 = la CARRERA concurrente que el count no ve,
    // perdida contra el índice único parcial (migración 061). Cualquier otro error =
    // nada aterrizó.
    const dup = rpcConflict(error) || error.code === "23505";
    return { ok: false, reason: dup ? "ya_compartido" : "no_pude_registrar" };
  }
  const eid = String((data as Row | null)?.expense_id ?? "");
  if (!eid) return { ok: false, reason: "no_pude_registrar" };
  return { ok: true, id: eid, data: { shares: split.shares } };
}

export async function addSharedExpense(userId: string, householdId: string, input: AddSharedExpenseInput): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const res = await addSharedExpenseWith(
      {
        membership: (hid) => activeMembership(sb, hid, userId),
        rpc: async (payload) => {
          const { data, error } = await sb.rpc("kipu_add_shared_expense", { p: payload });
          return { data, error };
        },
      },
      userId,
      householdId,
      input,
    );
    if (res.ok) await audit(sb, householdId, userId, "add_expense", "expense", `${input.description} ${input.totalBase}`);
    return res;
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function cancelSharedExpense(userId: string, householdId: string, expenseId: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    // MONETARIO: si esta cancelación no aterriza, el gasto sigue 'open' y sigue
    // contando en computeSettlement — el resultado del update se verifica.
    const { data: cData, error: cErr } = await sb.from("shared_expenses").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", expenseId).eq("household_id", householdId).select("id");
    if (cErr) return { ok: false, reason: "no_pude_cancelar" };
    if ((cData?.length ?? 0) === 0) return { ok: false, reason: "gasto_no_existe" };
    await audit(sb, householdId, userId, "cancel_expense", "expense", expenseId);
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

// Edit an OPEN shared expense (amount and/or description). Only equal splits are
// re-derived automatically; a custom split with money already settled by someone
// other than the payer refuses (settle first) so nobody's paid share silently moves.
export async function updateSharedExpense(
  userId: string,
  householdId: string,
  expenseId: string,
  patch: { totalBase?: number; description?: string },
): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    const { data: expData } = await sb.from("shared_expenses").select("*").eq("id", expenseId).eq("household_id", householdId).maybeSingle();
    const exp = expData as Row | null;
    if (!exp || String(exp.status) === "cancelled") return { ok: false, reason: "gasto_no_existe" };
    if (String(exp.status) === "settled") return { ok: false, reason: "ya_saldado" };

    if (patch.totalBase !== undefined) {
      if (!(patch.totalBase > 0)) return { ok: false, reason: "monto_invalido" };
      if (String(exp.split_method) !== "equal") return { ok: false, reason: "split_personalizado" };
      // Estos splits deciden DOS cosas: si alguien ya pagó (foreignSettled) y entre
      // quiénes se reparte el nuevo monto. Leerlos vacíos por un error decía "nadie
      // pagó todavía" — el guard de lectura queda, y la RPC RE-VERIFICA foreignSettled
      // DENTRO de la transacción (el read-decide-write de aquí no llevaba CAS).
      const { data: splitRows, error: splitsErr } = await sb.from("shared_expense_splits").select("*").eq("shared_expense_id", expenseId);
      if (splitsErr || !splitRows) return { ok: false, reason: "no_disponible" };
      const splits = splitRows as Row[];
      const payerId = String(exp.payer_member_id);
      const foreignSettled = splits.some((sp) => String(sp.member_id) !== payerId && Number(sp.settled_base ?? 0) > 0);
      if (foreignSettled) return { ok: false, reason: "ya_hay_pagos" };
      const participants = splits.map((sp) => ({ memberId: String(sp.member_id) }));
      const redo = splitExpense({ totalBase: patch.totalBase, method: "equal", participants, payerMemberId: payerId });
      if (!redo.valid) return { ok: false, reason: redo.reason };
      // Re-auditoría 2 (punto 6): splits + total en UNA transacción (RPC, migración
      // 060). El loop viejo podía morir a la mitad dejando sum(share_base) ≠
      // total_base, y el update del total tampoco verificaba su resultado.
      const { error: updErr } = await sb.rpc("kipu_update_shared_expense", {
        p: {
          household_id: householdId,
          expense_id: expenseId,
          description: patch.description?.trim() ? patch.description.trim().slice(0, 120) : null,
          total_base: patch.totalBase,
          shares: redo.shares.map((sh) => ({
            member_id: sh.memberId,
            share_base: sh.shareBase,
            settled_base: sh.memberId === payerId ? sh.shareBase : 0,
          })),
        },
      });
      if (updErr) {
        return { ok: false, reason: rpcConflict(updErr) ? "ya_hay_pagos" : "no_pude_registrar" };
      }
      await audit(sb, householdId, userId, "edit_expense", "expense", expenseId);
      return { ok: true, id: expenseId };
    }

    if (patch.description?.trim()) {
      const { error: descErr } = await sb.rpc("kipu_update_shared_expense", {
        p: { household_id: householdId, expense_id: expenseId, description: patch.description.trim().slice(0, 120) },
      });
      if (descErr) return { ok: false, reason: "no_pude_registrar" };
    }
    await audit(sb, householdId, userId, "edit_expense", "expense", expenseId);
    return { ok: true, id: expenseId };
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
    if (input.myWeeklyBase && input.myWeeklyBase > 0) {
      // El aporte semanal alimenta la meta compartida: si no aterriza, la meta nace
      // sin tu compromiso y el resumen igual lo narraba.
      const { error: contribErr } = await sb.from("household_goal_contributions").upsert({ household_id: householdId, goal_id: gid, member_id: me.memberId, weekly_base: input.myWeeklyBase }, { onConflict: "goal_id,member_id" });
      if (contribErr) return { ok: true, id: gid, reason: "meta_sin_aporte", data: { contributionSaved: false } };
    }
    await audit(sb, householdId, userId, "create_goal", "goal", input.name);
    return { ok: true, id: gid };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function setMyGoalContribution(userId: string, householdId: string, goalId: string, weeklyBase: number): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    const { error: setErr } = await sb.from("household_goal_contributions").upsert({ household_id: householdId, goal_id: goalId, member_id: me.memberId, weekly_base: Math.max(0, weeklyBase) }, { onConflict: "goal_id,member_id" });
    if (setErr) return { ok: false, reason: "no_disponible" };
    await audit(sb, householdId, userId, "set_contribution", "goal", `${weeklyBase}`);
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function setHouseholdPrivacy(userId: string, householdId: string, privacyMode: "minimal" | "standard" | "full"): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canManage(me.role)) return { ok: false, reason: "solo_owner_admin" };
    const { error: privErr } = await sb.from("households").update({ privacy_mode: privacyMode, updated_at: new Date().toISOString() }).eq("id", householdId);
    if (privErr) return { ok: false, reason: "no_disponible" };
    await audit(sb, householdId, userId, "set_visibility", "household", privacyMode);
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function linkTransactionToSharedExpense(userId: string, householdId: string, expenseId: string, transactionId: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    const { error: linkErr } = await sb.from("shared_expenses").update({ origin_transaction_id: transactionId, updated_at: new Date().toISOString() }).eq("id", expenseId).eq("household_id", householdId);
    if (linkErr) return { ok: false, reason: "no_disponible" };
    await audit(sb, householdId, userId, "link_transaction", "expense", expenseId);
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

// ── Stage 20 PASS 2 — invite-by-link / token lifecycle ──────────────────────
// The invite token (already in the 027 schema) IS the credential. A user accepts
// by opening the link/code; only the targeted user (when set) may accept; pending
// invites older than 14 days are treated as expired (computed — no schema column).

function inviteExpired(createdAt: unknown): boolean {
  const t = ms(createdAt);
  return t > 0 && Date.now() - t > INVITE_TTL_MS;
}

// Create an invite and RETURN its token so the agent can hand the user a shareable
// link/code (manager-only). Wraps inviteMember semantics with token surfacing.
export async function createInviteLink(userId: string, householdId: string, input: { invitedUserId?: string; label?: string; role?: string }): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me) return { ok: false, reason: "no_eres_miembro" };
    if (!canManage(me.role)) return { ok: false, reason: "solo_owner_admin_invita" };
    const { data, error } = await sb
      .from("household_invites")
      .insert({ household_id: householdId, invited_user_id: input.invitedUserId ?? null, invited_label: input.label?.slice(0, 60) ?? null, role: input.role ?? "member", status: "pending", created_by: userId })
      .select("id, token")
      .single();
    if (error || !data) return { ok: false, reason: "no_pude_invitar" };
    await audit(sb, householdId, userId, "invite", "member", input.label ?? input.invitedUserId ?? "");
    return { ok: true, id: String((data as Row).id), data: { token: String((data as Row).token) } };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

// Whether a user is currently an ACTIVE member of a household (safe read used by
// the join page to keep an inviter from consuming their own link).
export async function isActiveHouseholdMember(householdId: string, userId: string): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    return (await activeMembership(sb, householdId, userId)) !== null;
  } catch { return false; }
}

// Safe public-ish read of an invite by token (the token is the credential). Returns
// only non-sensitive fields. Marks an old pending invite as expired opportunistically.
export async function loadInviteByToken(token: string): Promise<{ householdId: string; householdName: string; role: string; status: string; invitedUserId: string | null; expired: boolean } | null> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb.from("household_invites").select("*").eq("token", token).maybeSingle();
    const r = data as Row | null;
    if (!r) return null;
    const expired = String(r.status) === "pending" && inviteExpired(r.created_at);
    // Conditional on status='pending' so concurrent reads don't re-update (idempotent, no contention).
    if (expired) await sb.from("household_invites").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", String(r.id)).eq("status", "pending");
    const { data: hh } = await sb.from("households").select("name").eq("id", String(r.household_id)).maybeSingle();
    return {
      householdId: String(r.household_id),
      householdName: String((hh as Row | null)?.name ?? "Hogar"),
      role: String(r.role ?? "member"),
      status: expired ? "expired" : String(r.status ?? "pending"),
      invitedUserId: str(r.invited_user_id) ?? null,
      expired,
    };
  } catch { return null; }
}

export async function acceptInviteByToken(userId: string, token: string, displayName?: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb.from("household_invites").select("*").eq("token", token).maybeSingle();
    const r = data as Row | null;
    if (!r || String(r.status) !== "pending") return { ok: false, reason: "invitacion_no_valida" };
    if (inviteExpired(r.created_at)) {
      await sb.from("household_invites").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", String(r.id));
      return { ok: false, reason: "invitacion_expirada" };
    }
    if (r.invited_user_id && String(r.invited_user_id) !== userId) return { ok: false, reason: "invitacion_no_es_tuya" };
    const hid = String(r.household_id);
    // An EXISTING member opening the link (e.g. the owner testing their own invite)
    // must NOT consume it: return ok, leave the invite PENDING so the person it was
    // meant for can still use it.
    if ((await activeMembership(sb, hid, userId)) !== null) {
      return { ok: true, id: hid };
    }
    // Membership FIRST, then mark accepted — so a failed insert leaves the invite
    // PENDING (the user can retry) instead of stranding it as accepted-without-member.
    // Default the visible name to the invite's label ("Milena"), never "Yo" — the
    // rest of the group sees this name.
    const inviteLabel = str(r.invited_label);
    const memberName = (displayName ?? inviteLabel ?? "Yo").slice(0, 60);
    let isMember = (await activeMembership(sb, hid, userId)) !== null;
    if (!isMember && inviteLabel) {
      // The owner often adds the person as a NON-USER participant first ("crea un
      // hogar con Milena") and invites later. Claim that existing external row
      // (link the user) instead of inserting a duplicate "Milena".
      const { data: ext } = await sb
        .from("household_members")
        .select("id")
        .eq("household_id", hid)
        .is("user_id", null)
        .eq("status", "active")
        .ilike("display_name", inviteLabel)
        .maybeSingle();
      if (ext) {
        const { error: claimErr } = await sb
          .from("household_members")
          .update({ user_id: userId, display_name: memberName, role: String(r.role ?? "member"), joined_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", String((ext as Row).id))
          .is("user_id", null);
        if (!claimErr) isMember = (await activeMembership(sb, hid, userId)) !== null;
      }
    }
    if (!isMember) {
      const { error } = await sb.from("household_members").insert({ household_id: hid, user_id: userId, display_name: memberName, role: String(r.role ?? "member"), status: "active", invited_by: str(r.created_by) ?? null, joined_at: new Date().toISOString() });
      if (error) {
        // A concurrent accept (two tabs) hits the unique (household_id,user_id) index.
        // Re-check: if we ARE now a member, that's success; otherwise leave it pending.
        isMember = (await activeMembership(sb, hid, userId)) !== null;
        if (!isMember) return { ok: false, reason: "no_pude_unirte" };
      }
    }
    await sb.from("household_invites").update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", String(r.id)).eq("status", "pending");
    await audit(sb, hid, userId, "accept", "member", "por enlace");
    return { ok: true, id: hid };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function declineInviteByToken(userId: string, token: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb.from("household_invites").select("id, household_id, invited_user_id, status").eq("token", token).maybeSingle();
    const r = data as Row | null;
    if (!r || String(r.status) !== "pending") return { ok: false, reason: "invitacion_no_valida" };
    if (r.invited_user_id && String(r.invited_user_id) !== userId) return { ok: false, reason: "invitacion_no_es_tuya" };
    const { error: declErr } = await sb.from("household_invites").update({ status: "declined", updated_at: new Date().toISOString() }).eq("id", String(r.id));
    if (declErr) return { ok: false, reason: "no_disponible" };
    await audit(sb, String(r.household_id), userId, "decline", "member", "por enlace");
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function cancelInvite(userId: string, householdId: string, inviteId: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canManage(me.role)) return { ok: false, reason: "solo_owner_admin" };
    const { error: cancelErr } = await sb.from("household_invites").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", inviteId).eq("household_id", householdId).eq("status", "pending");
    if (cancelErr) return { ok: false, reason: "no_disponible" };
    await audit(sb, householdId, userId, "cancel_invite", "member", inviteId);
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function listHouseholdInvites(userId: string, householdId: string): Promise<{ id: string; label: string | null; role: string; status: string; expired: boolean }[]> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canManage(me.role)) return [];
    const { data } = await sb.from("household_invites").select("*").eq("household_id", householdId).order("created_at", { ascending: false }).limit(50);
    return ((data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      label: str(r.invited_label) ?? null,
      role: String(r.role ?? "member"),
      status: String(r.status) === "pending" && inviteExpired(r.created_at) ? "expired" : String(r.status ?? "pending"),
      expired: String(r.status) === "pending" && inviteExpired(r.created_at),
    }));
  } catch { return []; }
}

// The household page renders a "tu link está listo" banner from ?invite=. Only
// tokens the viewer could actually have minted (owner/admin of the invite's
// household) qualify — a well-formed token from another household renders
// nothing, so nobody can be tricked into forwarding a foreign invite as theirs.
export async function inviteTokenIsMine(userId: string, token: string): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb.from("household_invites").select("household_id").eq("token", token).maybeSingle();
    if (!data) return false;
    const me = await activeMembership(sb, String((data as Row).household_id), userId);
    return Boolean(me && canManage(me.role));
  } catch { return false; }
}

// ── Stage 20 PASS 2 — recurring shared bills (migration 031, graceful) ─────────
export async function createRecurringSharedExpense(userId: string, householdId: string, input: {
  description: string; amountBase: number; baseCurrency?: string; category?: string; payerMemberId: string; splitMethod?: SplitMethod; cadence?: Cadence; anchorDay?: number | null; note?: string;
}): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me) return { ok: false, reason: "no_eres_miembro" };
    if (!canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    if (!(input.amountBase > 0)) return { ok: false, reason: "monto_invalido" };
    const { data, error } = await sb.from("household_recurring_expenses").insert({
      household_id: householdId, payer_member_id: input.payerMemberId, description: input.description.slice(0, 120), category: input.category ?? null,
      amount_base: input.amountBase, base_currency: input.baseCurrency ?? "USD", split_method: input.splitMethod ?? "equal", cadence: input.cadence ?? "monthly",
      anchor_day: input.anchorDay ?? null, active: true, note: input.note?.slice(0, 200) ?? null, created_by: userId,
    }).select("id").single();
    if (error || !data) return { ok: false, reason: "no_disponible" }; // pre-migration or transient
    await audit(sb, householdId, userId, "add_recurring", "recurring", `${input.description} ${input.amountBase}`);
    return { ok: true, id: String((data as Row).id) };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

export async function listRecurringSharedExpenses(userId: string, householdId: string): Promise<{ id: string; description: string; amountBase: number; cadence: string; anchorDay: number | null }[]> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me) return [];
    const { data } = await sb.from("household_recurring_expenses").select("*").eq("household_id", householdId).eq("active", true).limit(50);
    return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), description: String(r.description ?? ""), amountBase: num(r.amount_base), cadence: String(r.cadence ?? "monthly"), anchorDay: r.anchor_day == null ? null : Number(r.anchor_day) }));
  } catch { return []; }
}

export async function removeRecurringSharedExpense(userId: string, householdId: string, id: string): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    // MONETARIO: si esta baja no aterriza, la plantilla sigue activa y el próximo
    // ciclo se puede volver a registrar como gasto real.
    const { error: rmErr } = await sb.from("household_recurring_expenses").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id).eq("household_id", householdId);
    if (rmErr) return { ok: false, reason: "no_disponible" };
    await audit(sb, householdId, userId, "remove_recurring", "recurring", id);
    return { ok: true };
  } catch { return { ok: false, reason: "no_disponible" }; }
}

// Log THIS cycle of a recurring bill as a real one-shot shared expense (the only
// money event — the template is just a schedule, never double-counted). Equal split
// across active members unless the template is payer_absorbs.
export async function logRecurringSharedExpense(userId: string, householdId: string, recurringId: string, occurredAtMs?: number): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const me = await activeMembership(sb, householdId, userId);
    if (!me || !canWriteShared(me.role)) return { ok: false, reason: "sin_permiso" };
    const { data } = await sb.from("household_recurring_expenses").select("*").eq("id", recurringId).eq("household_id", householdId).maybeSingle();
    const r = data as Row | null;
    if (!r) return { ok: false, reason: "no_encontrada" };
    // La lista de miembros DEFINE entre cuántos se divide: leerla a medias reparte
    // el recibo entre los que sobrevivieron a la consulta y le carga de más a cada uno.
    const read = await readHouseholdData(userId);
    if (!moneyReadPublishable(read)) return { ok: false, reason: "no_disponible" };
    const h = read.households.find((x) => x.id === householdId);
    if (!h) return { ok: false, reason: "no_eres_miembro" };
    const method = (String(r.split_method ?? "equal") as SplitMethod);
    const payer = String(r.payer_member_id);
    const participants: SplitParticipant[] = method === "payer_absorbs"
      ? [{ memberId: payer }]
      : h.members.filter((m) => m.status === "active").map((m) => ({ memberId: m.memberId }));
    return await addSharedExpense(userId, householdId, {
      description: String(r.description ?? "Gasto compartido"), totalBase: num(r.amount_base), baseCurrency: String(r.base_currency ?? "USD"),
      category: str(r.category), method, participants, payerMemberId: payer, occurredAtMs, note: "recurrente",
    });
  } catch { return { ok: false, reason: "no_disponible" }; }
}

/** Deps inyectables del settle, para que el gate recorra el trayecto sin base. */
export interface SettleHouseholdDeps {
  membership: (householdId: string) => Promise<{ memberId: string; role: string } | null>;
  readHousehold: () => Promise<HouseholdRead>;
  rpc: (payload: Record<string, unknown>) => Promise<HouseholdRpcResult>;
}

// "Cerramos cuentas / cuadrar el viaje": record the current simplest settlement
// transfers as PAID so balances zero out. Reuses computeSettlement; no money moves
// in Kipu (it records that members reimbursed each other). Manager-only.
//
// Re-auditoría 2 (punto 6): las transferencias + el archivado aterrizan JUNTOS vía
// la RPC kipu_settle_household (migración 060), que además exige un CAS del
// snapshot (expected counts del MISMO read publicable con el que se computó el
// settlement): si otro miembro registró un gasto o un pago en el medio, TODO
// revierte (40001) y se re-lee — cuesta un reintento, nunca un doble reembolso.
// El flujo viejo ignoraba el resultado del insert (podía archivar el hogar y
// narrar "quedaron a mano" sin haber guardado ningún settlement) y el early-return
// con cero transferencias se saltaba el archivado pedido.
export async function settleHouseholdWith(
  deps: SettleHouseholdDeps,
  userId: string,
  householdId: string,
  archive?: boolean,
): Promise<WriteResult> {
  const me = await deps.membership(householdId);
  if (!me || !canManage(me.role)) return { ok: false, reason: "solo_owner_admin" };
  // El caso que obliga a esto: si SOLO falla la consulta de household_settlements,
  // los reembolsos ya pagados se leen como "nadie pagó nada" y esta función escribe
  // las mismas transferencias otra vez, marcadas como pagadas. Cobrar dos veces
  // exige que la foto esté entera, no que la consulta no haya lanzado.
  const read = await deps.readHousehold();
  if (!moneyReadPublishable(read)) return { ok: false, reason: "no_disponible" };
  const h = read.households.find((x) => x.id === householdId);
  if (!h) return { ok: false, reason: "no_eres_miembro" };
  const settlement = computeSettlement({
    members: h.members.filter((m) => m.status === "active").map((m) => ({ memberId: m.memberId, displayName: m.displayName })),
    expenses: h.expenses.filter((e) => e.status !== "cancelled").map((e) => ({ payerMemberId: e.payerMemberId, totalBase: e.totalBase, splits: e.splits.map((s) => ({ memberId: s.memberId, shareBase: s.shareBase })) })),
    settlements: h.settlements,
  });
  if (settlement.transfers.length === 0 && !archive) return { ok: true, data: { settled: 0 } };
  const { data, error } = await deps.rpc({
    household_id: householdId,
    created_by: userId,
    archive: archive === true,
    base_currency: h.baseCurrency,
    // El CAS del snapshot: counts Y TOTALES del MISMO read publicable (complete ⇒
    // son los reales) con el que computeSettlement corrió. Los counts solos no ven
    // una EDICIÓN de monto (updateSharedExpense cambia total_base sin mover filas):
    // sin los totales, un settle con snapshot viejo escribía transfers stale.
    expected_settlement_count: h.settlements.length,
    expected_open_expense_count: h.expenses.filter((e) => e.status !== "cancelled").length,
    expected_expense_total_base: Math.round(h.expenses.filter((e) => e.status !== "cancelled").reduce((s, e) => s + e.totalBase, 0) * 100) / 100,
    expected_settlement_total_base: Math.round(h.settlements.reduce((s, x) => s + x.amountBase, 0) * 100) / 100,
    transfers: settlement.transfers.map((t) => ({
      from_member_id: t.fromMemberId,
      to_member_id: t.toMemberId,
      amount_base: t.amountBase,
    })),
  });
  if (error) {
    return { ok: false, reason: rpcConflict(error) ? "cambio_en_el_medio" : "no_pude_registrar" };
  }
  return { ok: true, data: { settled: Number((data as Row | null)?.settled ?? 0) } };
}

export async function settleHousehold(userId: string, householdId: string, archive?: boolean): Promise<WriteResult> {
  try {
    const sb = createSupabaseAdminClient();
    const res = await settleHouseholdWith(
      {
        membership: (hid) => activeMembership(sb, hid, userId),
        readHousehold: () => readHouseholdData(userId),
        rpc: async (payload) => {
          const { data, error } = await sb.rpc("kipu_settle_household", { p: payload });
          return { data, error };
        },
      },
      userId,
      householdId,
      archive,
    );
    if (res.ok) {
      const settled = Number((res.data as { settled?: number } | undefined)?.settled ?? 0);
      await audit(sb, householdId, userId, "settle_household", "settlement", `${settled} transferencias`);
    }
    return res;
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
