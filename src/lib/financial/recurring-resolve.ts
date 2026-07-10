import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { loadFxRates } from "@/lib/fx/fx-store";
import { bookRecurring, reverseRecurring } from "@/lib/financial/recurring-ledger";
import { updateIncomeSourceFields } from "@/lib/financial/income-store";
import { updateFixedExpenseFields } from "@/lib/financial/commitments-store";
import {
  getOccurrence,
  updateOccurrence,
  listOpenOccurrences,
  type RecurringOccurrence,
} from "@/lib/financial/recurring-occurrences-store";

// Bloque C — resolve a recurring occurrence from chat. The agent maps the user's natural-
// language reply to one action; this module does the money + plan + state work safely and
// self-contained (loads the flow/account/FX itself so the agent tool stays thin). Every ledger
// write goes through the shared recurring-ledger (single writer, append-only reversal).
//
//   confirm  → booked: mark confirmed (no ledger change). pending: book the expected amount now.
//   correct  → book the REAL amount (reverse the auto-booked one first). scope 'from_now' also
//              updates the recurring PLAN. scope 'once' leaves the plan untouched.
//   skip     → didn't arrive: reverse the booking (if any) and mark skipped.
//   snooze   → keep pending, re-ask after snoozeUntil.
//   dismiss  → stop asking about this occurrence (mark dismissed).

export type ResolveAction = "confirm" | "correct" | "skip" | "snooze" | "dismiss";

export interface ResolveInput {
  userId: string;
  occurrenceId: string;
  action: ResolveAction;
  amount?: number; // native amount, required for 'correct'
  scope?: "once" | "from_now"; // for 'correct'; default 'once'
  snoozeUntilISO?: string; // for 'snooze'
}

interface FlowInfo {
  name: string;
  currency: string | null;
  accountId: string | null;
  accountCurrency: string | null;
  isCard: boolean;
}

async function loadFlowInfo(userId: string, occ: RecurringOccurrence): Promise<FlowInfo | null> {
  const sb = createSupabaseAdminClient();
  const { data: accData } = await sb.from("accounts").select("*").eq("user_id", userId);
  const accounts = (accData ?? []).map((r) => r as Record<string, unknown>).filter((a) => a.status !== "closed");
  const pick = (preferredId: string | null): { id: string; currency: string | null } | null => {
    const match = preferredId ? accounts.find((a) => String(a.id) === preferredId) : null;
    const chosen = match ?? accounts.find((a) => a.is_primary === true) ?? accounts[0];
    return chosen ? { id: String(chosen.id), currency: chosen.currency == null ? null : String(chosen.currency) } : null;
  };
  if (occ.incomeSourceId) {
    const { data } = await sb
      .from("income_sources")
      .select("name, currency, destination_account_id")
      .eq("user_id", userId)
      .eq("id", occ.incomeSourceId)
      .maybeSingle();
    if (!data) return null;
    const acc = pick(data.destination_account_id ? String(data.destination_account_id) : null);
    return {
      name: String(data.name ?? "ingreso"),
      currency: data.currency == null ? occ.currency : String(data.currency),
      accountId: acc?.id ?? null,
      accountCurrency: acc?.currency ?? null,
      isCard: false,
    };
  }
  if (occ.fixedExpenseId) {
    const { data } = await sb
      .from("fixed_expenses")
      .select("name, currency, payment_source_type, payment_source_id")
      .eq("user_id", userId)
      .eq("id", occ.fixedExpenseId)
      .maybeSingle();
    if (!data) return null;
    const isCard = data.payment_source_type === "debt_account" && !!data.payment_source_id;
    if (isCard) {
      return {
        name: String(data.name ?? "gasto"),
        currency: data.currency == null ? occ.currency : String(data.currency),
        accountId: String(data.payment_source_id),
        accountCurrency: null,
        isCard: true,
      };
    }
    const acc = pick(data.payment_source_type === "account" && data.payment_source_id ? String(data.payment_source_id) : null);
    return {
      name: String(data.name ?? "gasto"),
      currency: data.currency == null ? occ.currency : String(data.currency),
      accountId: acc?.id ?? null,
      accountCurrency: acc?.currency ?? null,
      isCard: false,
    };
  }
  return null;
}

async function bookAmount(
  userId: string,
  occ: RecurringOccurrence,
  flow: FlowInfo,
  nativeAmount: number,
): Promise<string | null> {
  if (!flow.accountId) return null;
  const sb = createSupabaseAdminClient();
  const { data: prof } = await sb.from("profiles").select("base_currency").eq("id", userId).maybeSingle();
  const base = String(prof?.base_currency ?? "USD").toUpperCase();
  const rates = await loadFxRates(userId);
  const linkId = occ.incomeSourceId ?? occ.fixedExpenseId ?? occ.id;
  // Amount-based key (NOT the auto-book `:${date}` key): so a correction rebooking after the
  // auto row was reversed is not blocked by the reversed row's dedupe key, while re-confirming
  // the SAME amount stays idempotent. bookRecurring still runs findAlreadyRecorded, so a manual
  // log or an orphaned auto-booking of this amount is reused, never double-booked.
  const booked = await bookRecurring({
    userId,
    kind: occ.kind,
    nativeAmount,
    nativeCurrency: flow.currency,
    base,
    rates,
    accountId: flow.accountId,
    accountCurrency: flow.accountCurrency,
    isCard: flow.isCard,
    dedupeKey: `recurring-${occ.kind}:${linkId}:${occ.occurrenceDate}:r${Math.round(nativeAmount * 100)}`,
    occurredAtISO: `${occ.occurrenceDate}T12:00:00.000Z`,
    occurrenceDateISO: occ.occurrenceDate,
    description: flow.name,
    sourceLinkId: linkId,
  });
  return booked?.txId ?? null;
}

async function updatePlanAmount(userId: string, occ: RecurringOccurrence, amount: number): Promise<boolean> {
  if (occ.incomeSourceId) {
    return updateIncomeSourceFields(userId, occ.incomeSourceId, { amount });
  }
  if (occ.fixedExpenseId) {
    return updateFixedExpenseFields({ userId, id: occ.fixedExpenseId, amount });
  }
  return false;
}

export async function resolveOccurrence(input: ResolveInput): Promise<{ ok: boolean; detail: string }> {
  const occ = await getOccurrence(input.userId, input.occurrenceId);
  if (!occ) return { ok: false, detail: "no encuentro ese movimiento recurrente" };
  if (["confirmed", "corrected", "skipped", "dismissed"].includes(occ.status)) {
    return { ok: false, detail: "ese movimiento ya estaba resuelto" };
  }

  switch (input.action) {
    case "snooze": {
      const until = input.snoozeUntilISO && !Number.isNaN(Date.parse(input.snoozeUntilISO))
        ? input.snoozeUntilISO
        : new Date(Date.now() + 86_400_000).toISOString();
      await updateOccurrence(input.userId, occ.id, { snoozeUntil: until });
      return { ok: true, detail: "listo, te lo recuerdo más tarde" };
    }
    case "dismiss": {
      await updateOccurrence(input.userId, occ.id, { status: "dismissed" });
      return { ok: true, detail: "ok, no te pregunto más por esto" };
    }
    case "skip": {
      if (occ.status === "booked" && occ.createdTransactionId) {
        const rev = await reverseRecurring(input.userId, occ.createdTransactionId);
        if (!rev) {
          // Reversal did not commit → do NOT mark terminal (would leave the tx applied while
          // telling the user it was removed). Leave it open to retry.
          return { ok: false, detail: "no pude revertir el registro anterior; reintentá en un momento" };
        }
      }
      await updateOccurrence(input.userId, occ.id, { status: "skipped" });
      return { ok: true, detail: "lo saqué del cálculo; no se registró nada" };
    }
    case "confirm": {
      if (occ.status === "booked") {
        await updateOccurrence(input.userId, occ.id, { status: "confirmed" });
        return { ok: true, detail: "confirmado" };
      }
      // pending → book the expected amount now.
      const flow = await loadFlowInfo(input.userId, occ);
      if (!flow || occ.expectedAmount == null) {
        return { ok: false, detail: "necesito el monto para registrarlo; ¿cuánto fue?" };
      }
      const txId = await bookAmount(input.userId, occ, flow, occ.expectedAmount);
      if (!txId) return { ok: false, detail: "no pude registrarlo (¿falta cuenta o tipo de cambio?)" };
      await updateOccurrence(input.userId, occ.id, { status: "confirmed", createdTransactionId: txId });
      return { ok: true, detail: "registrado" };
    }
    case "correct": {
      if (input.amount == null || !(input.amount > 0)) {
        return { ok: false, detail: "¿cuál es el monto correcto?" };
      }
      const flow = await loadFlowInfo(input.userId, occ);
      if (!flow) return { ok: false, detail: "no pude cargar los datos del flujo" };
      // Reverse the auto-booking (if any) BEFORE rebooking at the real amount — and abort if the
      // reversal did not commit, so we never leave the original applied AND book a second row.
      if (occ.status === "booked" && occ.createdTransactionId) {
        const rev = await reverseRecurring(input.userId, occ.createdTransactionId);
        if (!rev) return { ok: false, detail: "no pude revertir el registro anterior; reintentá en un momento" };
      }
      const txId = await bookAmount(input.userId, occ, flow, input.amount);
      if (!txId) return { ok: false, detail: "no pude registrar el monto corregido" };
      await updateOccurrence(input.userId, occ.id, { status: "corrected", createdTransactionId: txId });
      if (input.scope === "from_now") {
        const planOk = await updatePlanAmount(input.userId, occ, input.amount);
        return planOk
          ? { ok: true, detail: "corregido, y actualicé el plan de ahora en más" }
          : { ok: true, detail: "corregido por esta vez; el plan no se pudo actualizar, decímelo de nuevo para dejarlo fijo" };
      }
      return { ok: true, detail: "corregido solo por esta vez; el plan queda igual" };
    }
    default:
      return { ok: false, detail: "acción no reconocida" };
  }
}

// ── Agent surfacing ──────────────────────────────────────────────────────────
// A compact facts block for the agent prompt + a resolver's-eye name map, so the
// agent can map a reply ("sí", "fueron 45000", "no vino") to the right occurrence id.

async function occurrenceNames(userId: string, occ: RecurringOccurrence[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (occ.length === 0) return names;
  try {
    const sb = createSupabaseAdminClient();
    const [inc, fix] = await Promise.all([
      sb.from("income_sources").select("id, name").eq("user_id", userId),
      sb.from("fixed_expenses").select("id, name").eq("user_id", userId),
    ]);
    for (const r of (inc.data ?? []) as Record<string, unknown>[]) names.set(String(r.id), String(r.name ?? "ingreso"));
    for (const r of (fix.data ?? []) as Record<string, unknown>[]) names.set(String(r.id), String(r.name ?? "gasto"));
  } catch {
    /* names best-effort */
  }
  return names;
}

function fmtAmt(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  const cur = (currency ?? "USD").toUpperCase();
  return cur === "USD" ? `${amount}$` : `${amount} ${cur}`;
}

// Returns a facts string for the agent (empty when nothing is open).
export async function describeOpenOccurrencesForAgent(userId: string): Promise<string> {
  const open = await listOpenOccurrences(userId);
  if (open.length === 0) return "";
  const names = await occurrenceNames(userId, open);
  const lines = open.map((o) => {
    const label = names.get(o.incomeSourceId ?? o.fixedExpenseId ?? "") ?? (o.kind === "income" ? "ingreso" : "gasto");
    const amt = fmtAmt(o.expectedAmount, o.currency);
    const state =
      o.status === "booked"
        ? `registrado ${amt} el ${o.occurrenceDate}, esperando tu OK`
        : `esperado ${amt} el ${o.occurrenceDate}, sin confirmar`;
    return `- occurrenceId=${o.id} · "${label}" (${o.kind === "income" ? "ingreso" : "gasto"}) · ${state}`;
  });
  return [
    "FLUJOS RECURRENTES SIN CONFIRMAR — si el usuario responde a uno (\"sí\"/\"entró\"/\"fueron X\"/\"no vino\"/\"no me preguntes\"/\"te digo mañana\"), llamá resolve_recurring_occurrence con el occurrenceId correcto:",
    ...lines,
  ].join("\n");
}

// Match a resolve request to an open occurrence: explicit id wins; else by flow name +
// kind; else the single open one. Returns the occurrence id or null (agent should ask).
export async function matchOpenOccurrence(
  userId: string,
  ref: { occurrenceId?: string | null; flowName?: string | null; kind?: "income" | "expense" | null },
): Promise<string | null> {
  if (ref.occurrenceId) return ref.occurrenceId;
  const open = await listOpenOccurrences(userId);
  if (open.length === 0) return null;
  const want = (ref.flowName ?? "").trim().toLowerCase();
  const names = await occurrenceNames(userId, open);
  const candidates = open.filter((o) => (ref.kind ? o.kind === ref.kind : true));
  // A NAME (or kind) was given → it MUST match. Never fall back to a lone open occurrence when
  // the user named a different flow: resolving the wrong (real, booked) movement corrupts the
  // ledger. Mismatch → null (the agent asks which one).
  if (want) {
    const byName = candidates.find((o) => {
      const nm = (names.get(o.incomeSourceId ?? o.fixedExpenseId ?? "") ?? "").toLowerCase();
      return nm && (nm.includes(want) || want.includes(nm));
    });
    return byName ? byName.id : null;
  }
  // No name given → the single-open default is safe only when there is exactly one candidate.
  return candidates.length === 1 ? candidates[0].id : null;
}
