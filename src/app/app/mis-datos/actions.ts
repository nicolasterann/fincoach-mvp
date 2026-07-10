"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { loadFxRates } from "@/lib/fx/fx-store";
import { convert } from "@/lib/fx/fx-rates";
import type { FinancialCategory, PaymentFrequency } from "@/types/financial";
import {
  createIncomeSource,
  updateIncomeSourceFields,
} from "@/lib/financial/income-store";
import {
  createFixedExpense,
  updateFixedExpenseFields,
} from "@/lib/financial/commitments-store";
import { updateSavingsPlanFields, setSavingsPlanStatus } from "@/lib/financial/savings-plans-store";
import { updateGoalRow } from "@/lib/financial/goals-wealth-store";
import { updateAssetRow, removeAssetRow } from "@/lib/financial/assets-store";

// S8 — "Mis datos" editable section. Three generic server actions (save / delete /
// add) that dispatch by `entity`. EVERY action guards the session and scopes to
// session.user.id (the *-store writers use the service role, so the user_id scoping IS
// the ownership guard; the direct-SQL accounts/debts writers add .eq("user_id") too).
// Deletes are the same SOFT-close convention as the rest of Kipu — never a hard delete
// of a financial row. Result comes back via ?saved / ?error so the page confirms.

const ENTITIES = ["account", "income", "fixed", "debt", "reserve", "goal", "asset"] as const;
type Entity = (typeof ENTITIES)[number];
const PAGE = "/app/mis-datos";
const SECTION: Record<Entity, string> = {
  account: "cuentas",
  income: "ingresos",
  fixed: "gastos-fijos",
  debt: "deudas",
  reserve: "reservas",
  goal: "metas",
  asset: "activos",
};
const VALID_CATEGORIES = new Set<FinancialCategory>([
  "housing", "utilities", "food", "transport", "health", "education", "subscriptions",
  "debt", "shopping", "entertainment", "family", "travel", "savings", "income", "other",
]);
const VALID_FREQ = new Set<PaymentFrequency>(["weekly", "biweekly", "monthly", "yearly", "custom"]);

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
// LOCALE-AWARE money parse — the SAME algorithm onboarding uses (parseMoney): the last
// separator is a decimal only when 1–2 digits follow it, otherwise every separator is
// grouping. So "150.000" → 150000 and "1.250,50" → 1250.50 (the LatAm audience), never
// the naïve Number("150.000") = 150.
function num(fd: FormData, key: string): number | null {
  let s = str(fd, key).replace(/[^0-9.,-]/g, "");
  if (!s) return null;
  const negative = s.startsWith("-");
  s = s.replace(/-/g, "");
  if (!/[0-9]/.test(s)) return null;
  const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  let intPart = s;
  let fracPart = "";
  if (lastSep !== -1) {
    const after = s.slice(lastSep + 1);
    if (after.length === 1 || after.length === 2) {
      intPart = s.slice(0, lastSep);
      fracPart = after;
    }
  }
  intPart = intPart.replace(/[.,]/g, "");
  fracPart = fracPart.replace(/[.,]/g, "");
  const n = Number(fracPart ? `${intPart}.${fracPart}` : intPart || "0");
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}
// A toggle always submits a hidden "false" companion plus, when checked, "on" — so read
// ALL values (an unchecked box that omits itself no longer looks like "unchanged").
function bool(fd: FormData, key: string): boolean {
  return fd.getAll(key).some((v) => v === "on" || v === "true");
}
function cur(fd: FormData, key: string, fallback: string): string {
  const c = str(fd, key).toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : fallback;
}
function freq(fd: FormData, key: string): PaymentFrequency | undefined {
  const f = str(fd, key) as PaymentFrequency;
  return VALID_FREQ.has(f) ? f : undefined;
}
function finish(entity: Entity | null, ok: boolean, reason?: "fx"): never {
  revalidatePath(PAGE);
  const anchor = entity ? `#${SECTION[entity]}` : "";
  const q = ok ? "saved=1" : reason ? `error=1&reason=${reason}` : "error=1";
  redirect(`${PAGE}?${q}${anchor}`);
}

async function guard() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");
  return { supabase, userId: session.user.id };
}

async function baseCurrencyFor(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
): Promise<string> {
  const { data } = await supabase.from("profiles").select("base_currency").eq("id", userId).maybeSingle();
  return String(data?.base_currency ?? "USD").toUpperCase();
}

// Convert to base with a KNOWN rate only. Same currency → identical. NO rate for a
// foreign amount → null (the caller must REFUSE, exactly like onboarding's FX gate) —
// writing the native figure into the base column would fabricate a 1:1 rate and count,
// e.g., 500.000 ARS as 500.000 USD. Never do that.
async function toBase(userId: string, amount: number, currency: string, base: string): Promise<number | null> {
  const from = (currency || base).toUpperCase();
  if (from === base.toUpperCase()) return amount;
  const rates = await loadFxRates(userId);
  const res = convert(amount, from, base, rates);
  return res.ok ? res.baseAmount : null;
}

export async function saveDataAction(formData: FormData) {
  const entity = str(formData, "entity") as Entity;
  const id = str(formData, "id");
  if (!ENTITIES.includes(entity) || !id) finish(null, false);
  const { supabase, userId } = await guard();
  let ok = false;

  if (entity === "account") {
    const name = str(formData, "name");
    const balance = num(formData, "balance");
    if (name || balance !== null) {
      const { data: row } = await supabase.from("accounts").select("currency").eq("id", id).eq("user_id", userId).maybeSingle();
      const patch: Record<string, unknown> = {};
      if (name) patch.name = name.slice(0, 80);
      if (balance !== null) {
        const base = await baseCurrencyFor(supabase, userId);
        const nb = await toBase(userId, balance, String(row?.currency ?? base), base);
        if (nb === null) finish(entity, false, "fx"); // foreign + no known rate → ask, never fabricate
        patch.current_balance_original = balance;
        patch.current_balance_base = nb;
      }
      const { error } = await supabase.from("accounts").update(patch).eq("id", id).eq("user_id", userId);
      ok = !error;
    }
  } else if (entity === "income") {
    ok = await updateIncomeSourceFields(userId, id, {
      name: str(formData, "name") || undefined,
      amount: num(formData, "amount") ?? undefined,
      frequency: freq(formData, "frequency"),
      isOccasional: formData.has("isOccasional") ? bool(formData, "isOccasional") : undefined,
    });
  } else if (entity === "fixed") {
    ok = await updateFixedExpenseFields({
      userId,
      id,
      name: str(formData, "name") || undefined,
      amount: num(formData, "amount") ?? undefined,
      isVariable: formData.has("isVariable") ? bool(formData, "isVariable") : undefined,
    });
  } else if (entity === "debt") {
    const patch: Record<string, unknown> = {};
    const name = str(formData, "name");
    const min = num(formData, "minimum");
    const full = num(formData, "full");
    const balance = num(formData, "balance");
    if (name) patch.name = name.slice(0, 80);
    if (min !== null) patch.minimum_payment = Math.max(0, min);
    if (full !== null) patch.full_payment_due = Math.max(0, full);
    if (balance !== null) patch.current_balance_original = Math.max(0, balance);
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("debt_accounts").update(patch).eq("id", id).eq("user_id", userId);
      ok = !error;
    }
  } else if (entity === "reserve") {
    ok = await updateSavingsPlanFields({
      userId,
      id,
      amountBase: num(formData, "amount") ?? undefined,
      frequency: freq(formData, "frequency"),
    });
  } else if (entity === "goal") {
    const patch: Record<string, unknown> = {};
    const name = str(formData, "name");
    const target = num(formData, "target");
    const date = str(formData, "targetDate");
    if (name) patch.name = name.slice(0, 120);
    if (target !== null) patch.target_amount = Math.max(0, target);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) patch.target_date = date;
    if (Object.keys(patch).length > 0) ok = await updateGoalRow(userId, id, patch);
  } else if (entity === "asset") {
    ok = await updateAssetRow({
      userId,
      id,
      name: str(formData, "name") || undefined,
      valueBase: num(formData, "value") ?? undefined,
      liquid: formData.has("liquid") ? bool(formData, "liquid") : undefined,
    });
  }
  finish(entity, ok);
}

export async function deleteDataAction(formData: FormData) {
  const entity = str(formData, "entity") as Entity;
  const id = str(formData, "id");
  if (!ENTITIES.includes(entity) || !id) finish(null, false);
  const { supabase, userId } = await guard();
  let ok = false;

  if (entity === "account") {
    // Soft-close (mirror executeCloseAccount): zero the balance, mark closed. Never a
    // hard delete. The user is correcting their own map, so no reconcile tx is required.
    const { error } = await supabase
      .from("accounts")
      .update({ status: "closed", current_balance_original: 0, current_balance_base: 0 })
      .eq("id", id)
      .eq("user_id", userId);
    ok = !error;
  } else if (entity === "income") {
    ok = await updateIncomeSourceFields(userId, id, { status: "cancelled" });
  } else if (entity === "fixed") {
    ok = await updateFixedExpenseFields({ userId, id, isActive: false });
  } else if (entity === "debt") {
    const { error } = await supabase.from("debt_accounts").update({ status: "closed" }).eq("id", id).eq("user_id", userId);
    ok = !error;
  } else if (entity === "reserve") {
    ok = await setSavingsPlanStatus({ userId, id, status: "cancelled" });
  } else if (entity === "goal") {
    ok = await updateGoalRow(userId, id, { status: "cancelled" });
  } else if (entity === "asset") {
    ok = await removeAssetRow({ userId, id });
  }
  finish(entity, ok);
}

export async function addDataAction(formData: FormData) {
  const entity = str(formData, "entity") as Entity;
  if (!ENTITIES.includes(entity)) finish(null, false);
  const { supabase, userId } = await guard();
  const base = await baseCurrencyFor(supabase, userId);
  let ok = false;

  if (entity === "account") {
    const name = str(formData, "name");
    if (name) {
      const balance = num(formData, "balance") ?? 0;
      const currency = cur(formData, "currency", base);
      const nb = await toBase(userId, balance, currency, base);
      if (nb === null) finish("account", false, "fx"); // foreign + no known rate → ask, never fabricate
      const { error } = await supabase.from("accounts").insert({
        user_id: userId,
        name: name.slice(0, 80),
        type: str(formData, "type") || "cash",
        currency,
        current_balance_original: balance,
        current_balance_base: nb,
        is_goal_account: false,
        liquidity: "liquid",
      });
      ok = !error;
    }
  } else if (entity === "income") {
    const name = str(formData, "name");
    const amount = num(formData, "amount");
    if (name && amount !== null && amount > 0) {
      const created = await createIncomeSource(userId, {
        name,
        amount,
        currency: cur(formData, "currency", base),
        frequency: freq(formData, "frequency") ?? "monthly",
        isOccasional: bool(formData, "isOccasional"),
      });
      ok = !!created;
    }
  } else if (entity === "fixed") {
    const name = str(formData, "name");
    const amount = num(formData, "amount");
    if (name && amount !== null && amount > 0) {
      const category = str(formData, "category") as FinancialCategory;
      const created = await createFixedExpense({
        userId,
        name,
        amount,
        currency: cur(formData, "currency", base),
        category: VALID_CATEGORIES.has(category) ? category : "other",
        frequency: "monthly",
        isEssential: bool(formData, "isEssential"),
      });
      ok = !!created;
    }
  }
  // reserves / goals / debts / assets: adding is richer — kept in chat for now (the page
  // links there). Editing + deleting them here is fully supported.
  finish(ENTITIES.includes(entity) ? entity : null, ok);
}
