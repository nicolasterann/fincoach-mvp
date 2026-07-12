"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { setMargenCommitments } from "@/lib/financial/coach-state-store";

// Stage 37 — direct redistribution from the "Tu mes" page (lowest friction beats
// chat for structured edits). Same writers the chat tools use: commitments via
// setMargenCommitments, goal contributions via an RLS-scoped goals update. Both
// re-render the page so the Sankey reflects the new reparto immediately.

export interface MesActionResult {
  ok: boolean;
  message?: string;
}

const MAX_MONTHLY = 100_000_000;

function parseAmount(v: FormDataEntryValue | null): number | null {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONTHLY) return null;
  return Math.round(n * 100) / 100;
}

function revalidateMes() {
  revalidatePath("/app/mes");
  revalidatePath("/app");
  revalidatePath("/app/saldo");
}

export async function updateReservesAction(formData: FormData): Promise<MesActionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, message: "Sesión expirada; vuelve a entrar." };

  const hasSavings = formData.get("savings") != null;
  const hasInvestment = formData.get("investment") != null;
  const savings = parseAmount(formData.get("savings"));
  const investment = parseAmount(formData.get("investment"));
  if ((hasSavings && savings == null) || (hasInvestment && investment == null)) {
    return { ok: false, message: "Monto inválido: usa un número desde 0." };
  }
  if (!hasSavings && !hasInvestment) return { ok: false, message: "Nada que guardar." };

  const ok = await setMargenCommitments({
    userId: session.user.id,
    ...(hasSavings ? { monthlySavings: savings } : {}),
    ...(hasInvestment ? { monthlyInvestment: investment } : {}),
  });
  if (!ok) return { ok: false, message: "No pude guardar tu reparto; intenta de nuevo." };
  revalidateMes();
  return { ok: true };
}

export async function updateGoalContributionAction(formData: FormData): Promise<MesActionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, message: "Sesión expirada; vuelve a entrar." };

  const goalId = String(formData.get("goal_id") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  if (!goalId || amount == null) return { ok: false, message: "Monto inválido: usa un número desde 0." };

  // RLS-scoped read+write (same pattern as goals/actions.ts): the engine needs a
  // cadence to reserve a positive aporte — default monthly, never override one.
  const { data: goal, error: readErr } = await supabase
    .from("goals")
    .select("id, cadence")
    .eq("id", goalId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (readErr || !goal) return { ok: false, message: "No encontré esa meta." };

  const patch: Record<string, unknown> = { contribution_amount: amount };
  if (amount > 0 && !goal.cadence) patch.cadence = "monthly";
  const { error } = await supabase
    .from("goals")
    .update(patch)
    .eq("id", goalId)
    .eq("user_id", session.user.id);
  if (error) return { ok: false, message: "No pude guardar el aporte; intenta de nuevo." };
  revalidateMes();
  revalidatePath("/app/goals");
  return { ok: true };
}
