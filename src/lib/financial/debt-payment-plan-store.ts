import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type SetDebtPaymentPlanStateResult =
  | {
      ok: true;
      outcome: "updated" | "replayed";
      debtAccountId: string;
      paused: boolean;
      dismissedOccurrenceCount: number;
      movedMoney: false;
    }
  | {
      ok: false;
      reason: "ownership" | "validation" | "conflict" | "unavailable";
    };

export function debtPaymentPlanRpcReason(error: {
  message?: string | null;
  code?: string | null;
}) {
  const message = String(error.message ?? "");
  if (message.includes("KIPU_OWNERSHIP")) return "ownership" as const;
  if (message.includes("KIPU_VALIDATION")) return "validation" as const;
  if (message.includes("KIPU_CONFLICT")) return "conflict" as const;
  return "unavailable" as const;
}

export async function setDebtPaymentPlanState(input: {
  userId: string;
  debtAccountId: string;
  action: "pause" | "resume";
}): Promise<SetDebtPaymentPlanStateResult> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    "kipu_set_debt_payment_plan_state",
    {
      p: {
        user_id: input.userId,
        debt_account_id: input.debtAccountId,
        action: input.action,
      },
    },
  );
  if (error) return { ok: false, reason: debtPaymentPlanRpcReason(error) };
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "unavailable" };
  }
  const row = data as Record<string, unknown>;
  if (
    (row.outcome !== "updated" && row.outcome !== "replayed") ||
    typeof row.debt_account_id !== "string" ||
    typeof row.debt_payment_plan_paused !== "boolean" ||
    row.moved_money !== false
  ) {
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    outcome: row.outcome,
    debtAccountId: row.debt_account_id,
    paused: row.debt_payment_plan_paused,
    dismissedOccurrenceCount: Number(row.dismissed_occurrence_count ?? 0),
    movedMoney: false,
  };
}
