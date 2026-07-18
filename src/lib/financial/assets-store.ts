import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { Asset } from "@/types/financial";

// Stage 30 — ASSETS reader (from public.investment_accounts, Stage 17 / migration
// 025). Service-role only, READ-ONLY. Mirrors the `Asset` DATA-CONTRACT shape so
// the financial context can surface the user's assets to the agent every turn.
//
// MONEY RULE: an asset is NEVER liquid/spendable-this-week money — the caller must
// keep these OUT of any account/liquid sum. They count toward NET WORTH only.
//
// Bloque I — WHERE THIS GOES (traced, don't assume): this reader feeds ONLY the
// PATRIMONIO/insight surface — `ctx.assets` → the agent prompt's asset listing and
// the resolve step of update_asset / remove_asset / set_entity_note. It does NOT
// feed the tank (margen-kipu sums `accounts`, never assets) and it does NOT feed
// computeNetWorth: the net-worth math reads the SAME table through its own reader
// in goals-wealth-store.ts. So a failure here degrades an insight, it can't inflate
// the Saldo — hence a typed contract, NOT a fail-closed.
//
// It still can't be allowed to lie. The old contract swallowed every failure into
// `[]` under a "pre-025 grace" that expired long ago (migrations 001–055 are
// applied — a missing table today IS an error, not an old schema). Downstream, `[]`
// reads as the FACT "no tiene activos": the prompt prints "- (ninguno)" and
// remove_asset answers "No tiene activos registrados" to a user who owns three —
// or worse, Kipu offers to register something the user already has. "No pude
// leerlos" has to be a different sentence.
//
// Writes live below + in the Wave-2 agent tools.

type Row = Record<string, unknown>;

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

function mapAssetRow(r: Row): Asset {
  return {
    id: String(r.id),
    name: String(r.name ?? "Activo"),
    assetClass: str(r.asset_class) ?? "investment",
    valueBase: num(r.value_base),
    valueOriginal: r.value_original != null ? num(r.value_original) : null,
    currency: str(r.currency) ?? null,
    liquid: typeof r.liquid === "boolean" ? r.liquid : false,
    includeInNetWorth:
      typeof r.include_in_net_worth === "boolean" ? r.include_in_net_worth : true,
    expectedReturnPct: r.expected_return_pct != null ? num(r.expected_return_pct) : null,
    returnKind: str(r.return_kind) ?? null,
    linkedGoalId: str(r.linked_goal_id) ?? null,
    notes: str(r.notes) ?? null,
  };
}

export type UserAssetsRead =
  | { ok: true; complete: true; assets: Asset[] }
  /** Lista topada o no probada: sirve para MOSTRAR, jamás para afirmar ausencia
   *  ni totales (re-auditoría 2, puntos 7+9). */
  | { ok: true; complete: false; partial: Asset[] }
  | { ok: false; complete: false };

const ASSETS_CAP = 200;

/** La lectura de activos que reporta sobre sí misma. `complete` aquí = "los vi
 *  todos", NO "los valué": estos rows salen con el `value_base` GUARDADO, y la
 *  revaluación a la tasa viva de un activo en moneda extranjera la hace el context
 *  builder después (assetsBased). Esa mitad la responde quien convierte. */
export async function readUserAssets(userId: string): Promise<UserAssetsRead> {
  try {
    const supabase = createSupabaseAdminClient();
    // `select("*")` tolera columnas ausentes. Pedimos CAP+1: la fila de más es la
    // PRUEBA de que había cola — sin ella, quien tiene exactamente el tope se lee
    // igual que quien quedó truncado.
    const { data, error } = await supabase
      .from("investment_accounts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(ASSETS_CAP + 1);
    // PostgREST devuelve { data: null, error } SIN lanzar: sin este chequeo el
    // fallo baja disfrazado de "no tiene activos".
    if (error) return { ok: false, complete: false };
    // `data` nulo sin `error` no es ausencia: una lista vacía real llega como [].
    // No falló nada, pero tampoco podemos probar que la vimos.
    if (!data) return { ok: true, complete: false, partial: [] };
    const rows = data as Row[];
    const assets = rows.slice(0, ASSETS_CAP).map(mapAssetRow);
    return rows.length > ASSETS_CAP
      ? { ok: true, complete: false, partial: assets }
      : { ok: true, complete: true, assets };
  } catch {
    return { ok: false, complete: false };
  }
}

/** Colapsa el fallo a lista vacía — el nombre está para que su mal uso se vea.
 *  Úsalo solo donde una lista incompleta no pueda convertirse en una AFIRMACIÓN
 *  ("no tienes activos", un total). Si necesitas distinguir "no tiene" de "no pude
 *  leer", usa readUserAssets. */
export async function loadUserAssetsForDisplay(userId: string): Promise<Asset[]> {
  const read = await readUserAssets(userId);
  return read.ok ? (read.complete ? read.assets : read.partial) : [];
}

// ── Stage 30 WRITES — chat-controlled assets (the founder's "sección propia con
// distintos tipos"). Every write is service-role, user-scoped, and NEVER a hard
// delete: `removeAssetRow` flips include_in_net_worth to false so the asset stops
// counting toward net worth while the row (its history) is preserved. MONEY RULE
// holds on every path: an asset is NEVER liquid/spendable-this-week money; these
// writes only touch the patrimonio surface, never the ledger, accounts, or Margen.

export interface InsertAssetArgs {
  userId: string;
  name: string;
  assetClass: string;
  // ALWAYS the user's BASE-currency value (S31 item 5.10). When the user stated
  // the value in another currency, the CALLER converts it with a KNOWN fx rate
  // (or asks) BEFORE calling — this store never converts and never assumes 1:1.
  valueBase: number;
  currency?: string | null;
  // The value as the user stated it, in `currency`, when it differed from base
  // (so the native figure is never lost). Written best-effort: the column is
  // additive DDL and the insert degrades gracefully before it is applied.
  valueOriginal?: number | null;
  liquid?: boolean;
  includeInNetWorth?: boolean;
  expectedReturnPct?: number | null;
  returnKind?: string | null;
  notes?: string | null;
}

// Insert a new asset. `value_base` is the user's own stated value expressed in
// their base currency (we never fabricate a market price OR an fx rate); a
// negative is rejected upstream. Returns the id so the caller can immediately
// note/adjust it in the same turn.
export async function insertAssetRow(a: InsertAssetArgs): Promise<{ ok: boolean; id?: string }> {
  if (!a.name.trim() || !Number.isFinite(a.valueBase) || a.valueBase < 0) return { ok: false };
  try {
    const supabase = createSupabaseAdminClient();
    const row: Record<string, unknown> = {
      user_id: a.userId,
      name: a.name.trim().slice(0, 120),
      asset_class: a.assetClass,
      value_base: a.valueBase,
      currency: a.currency ?? "USD",
      liquid: a.liquid ?? false,
      include_in_net_worth: a.includeInNetWorth ?? true,
      expected_return_pct: a.expectedReturnPct ?? null,
      return_kind: a.returnKind ?? null,
      notes: a.notes?.trim() ? a.notes.trim().slice(0, 500) : null,
      valuation_date: new Date().toISOString().slice(0, 10),
    };
    if (a.valueOriginal != null && Number.isFinite(a.valueOriginal)) row.value_original = a.valueOriginal;
    let { data, error } = await supabase.from("investment_accounts").insert(row).select("id").single();
    // Pre-DDL grace: retry without value_original if the column doesn't exist yet.
    if (error && "value_original" in row) {
      delete row.value_original;
      ({ data, error } = await supabase.from("investment_accounts").insert(row).select("id").single());
    }
    if (error || !data) return { ok: false };
    return { ok: true, id: String(data.id) };
  } catch {
    return { ok: false };
  }
}

export interface UpdateAssetArgs {
  userId: string;
  id: string;
  name?: string;
  // ALWAYS the base-currency value (S31 item 5.10) — callers convert foreign
  // values with a KNOWN rate (or ask) before calling; never 1:1.
  valueBase?: number;
  valueOriginal?: number | null;
  currency?: string | null;
  liquid?: boolean;
  includeInNetWorth?: boolean;
  expectedReturnPct?: number | null;
  notes?: string | null;
}

// Patch an existing asset (rename, revalue, toggle liquid/net-worth, set a note).
// `.select()` confirms a row actually matched (user + id), so updating a stale or
// non-owned asset returns false instead of a false "done". `updated_at` is
// stamped when the column exists; a value revalue also refreshes valuation_date.
export async function updateAssetRow(a: UpdateAssetArgs): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  if (a.name !== undefined && a.name.trim()) patch.name = a.name.trim().slice(0, 120);
  if (a.valueBase !== undefined && Number.isFinite(a.valueBase) && a.valueBase >= 0) {
    patch.value_base = a.valueBase;
    patch.valuation_date = new Date().toISOString().slice(0, 10);
    // Keep the native figure in sync with the revalue: explicit when given,
    // cleared otherwise so a stale original can never shadow the new value.
    patch.value_original = a.valueOriginal != null && Number.isFinite(a.valueOriginal) ? a.valueOriginal : null;
  }
  if (a.currency !== undefined && a.currency) patch.currency = a.currency;
  if (a.liquid !== undefined) patch.liquid = a.liquid;
  if (a.includeInNetWorth !== undefined) patch.include_in_net_worth = a.includeInNetWorth;
  if (a.expectedReturnPct !== undefined) patch.expected_return_pct = a.expectedReturnPct;
  if (a.notes !== undefined) patch.notes = a.notes && a.notes.trim() ? a.notes.trim().slice(0, 500) : null;
  if (Object.keys(patch).length === 0) return false;
  patch.updated_at = new Date().toISOString();
  try {
    const supabase = createSupabaseAdminClient();
    let { data, error } = await supabase
      .from("investment_accounts")
      .update(patch)
      .eq("id", a.id)
      .eq("user_id", a.userId)
      .select("id");
    // Pre-DDL grace: retry without value_original if the column doesn't exist yet.
    if (error && "value_original" in patch) {
      delete patch.value_original;
      ({ data, error } = await supabase
        .from("investment_accounts")
        .update(patch)
        .eq("id", a.id)
        .eq("user_id", a.userId)
        .select("id"));
    }
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// Soft-remove: never a hard delete. Flip include_in_net_worth to false so the
// asset stops counting toward net worth (net-worth.ts filters on that flag) while
// the row and its history are preserved for audit. Returns false when no row
// matched, so Kipu never claims a removal that didn't happen.
export async function removeAssetRow(input: { userId: string; id: string }): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("investment_accounts")
      .update({ include_in_net_worth: false, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("user_id", input.userId)
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// Bloque C — move a monthly investment contribution INTO an asset: increment its value by a delta
// (paired with a source-account debit in the ledger so the whole thing is net-worth-neutral).
// Read-modify-write (reserves are low-frequency, single-user), floored at 0. `deltaBase` is in
// base currency, `deltaOriginal` in the asset's OWN currency (equal when same-currency). A
// negative delta un-does the contribution (used when a confirm is later skipped/corrected).
// Returns true on success. Assets are soft, manually-revalued numbers — the exact money side is
// the ledger account debit; this keeps net worth honest between the user's own revaluations.
export async function incrementAssetValue(
  userId: string,
  assetId: string,
  deltaBase: number,
  deltaOriginal: number,
): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("investment_accounts")
      .select("value_base, value_original")
      .eq("id", assetId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return false;
    const patch: Record<string, unknown> = {
      value_base: Math.max(0, Math.round((num(data.value_base) + deltaBase) * 100) / 100),
      updated_at: new Date().toISOString(),
    };
    if (data.value_original != null) {
      patch.value_original = Math.max(0, Math.round((num(data.value_original) + deltaOriginal) * 100) / 100);
    }
    const { error: upErr } = await supabase
      .from("investment_accounts")
      .update(patch)
      .eq("id", assetId)
      .eq("user_id", userId);
    return !upErr;
  } catch {
    return false;
  }
}
