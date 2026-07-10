import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { Asset } from "@/types/financial";

// Stage 30 — ASSETS reader (from public.investment_accounts, Stage 17 / migration
// 025). Service-role only, READ-ONLY. Mirrors the `Asset` DATA-CONTRACT shape so
// the financial context can surface the user's assets to the agent every turn and
// net worth reads a consistent shape.
//
// MONEY RULE: an asset is NEVER liquid/spendable-this-week money — the caller must
// keep these OUT of any account/liquid sum. They count toward NET WORTH only.
//
// Graceful degradation is total: a missing table (pre-025), a missing column, or
// any query error degrades to `[]` (never throws), so the context build is
// unaffected on a database that predates the assets table. Writes live in the
// goals/wealth store + the Wave-2 agent tools, never here.

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

export async function loadUserAssets(userId: string): Promise<Asset[]> {
  try {
    const supabase = createSupabaseAdminClient();
    // `select("*")` tolerates absent columns; a missing table returns an error we
    // swallow → [].
    const { data, error } = await supabase
      .from("investment_accounts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error || !data) return [];
    return data.map((r) => mapAssetRow(r as Row));
  } catch {
    return [];
  }
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
