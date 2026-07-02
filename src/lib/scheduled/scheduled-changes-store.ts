import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { roundMoney } from "@/lib/financial/money";

// Stage 26 — scheduled FUTURE changes ("en 3 meses mi sueldo sube a 1500",
// "cada 3 meses sube 3% el arriendo", "pausa Netflix desde julio"). A row here
// is a PLAN; the daily cron applies due plans through the same typed updates
// the chat uses. The LLM never mutates anything directly — it only creates,
// lists and cancels plans through these validated functions.
//
// Graceful pre-migration (033): every function catches a missing-table error
// and returns empty/false so nothing crashes before the DDL is applied.

export type ScheduledTargetType = "income_source" | "fixed_expense" | "goal" | "reminder";
export type ScheduledChangeKind =
  | "set_amount"
  | "adjust_percent"
  | "adjust_fixed"
  | "pause"
  | "resume"
  | "set_frequency"
  | "reminder";
export type ScheduledCadence = "once" | "monthly" | "quarterly" | "semiannual" | "yearly";

export interface ScheduledChange {
  id: string;
  userId: string;
  targetType: ScheduledTargetType;
  targetId: string | null;
  targetLabel: string;
  changeKind: ScheduledChangeKind;
  amount: number | null;
  currency: string | null;
  newFrequency: string | null;
  effectiveDate: string;
  cadence: ScheduledCadence;
  nextRunDate: string;
  lastAppliedOn: string | null;
  runsCount: number;
  status: "pending" | "applied" | "cancelled" | "failed";
  note: string | null;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));

function mapRow(r: Row): ScheduledChange {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    targetType: String(r.target_type) as ScheduledTargetType,
    targetId: str(r.target_id),
    targetLabel: String(r.target_label ?? ""),
    changeKind: String(r.change_kind) as ScheduledChangeKind,
    amount: num(r.amount),
    currency: str(r.currency),
    newFrequency: str(r.new_frequency),
    effectiveDate: String(r.effective_date),
    cadence: String(r.cadence ?? "once") as ScheduledCadence,
    nextRunDate: String(r.next_run_date),
    lastAppliedOn: str(r.last_applied_on),
    runsCount: Number(r.runs_count ?? 0),
    status: String(r.status ?? "pending") as ScheduledChange["status"],
    note: str(r.note),
  };
}

// ── Pure helpers (gate-tested) ───────────────────────────────────────────────

/** Next run date for a recurring cadence, from the given ISO date. */
export function advanceCadence(dateISO: string, cadence: ScheduledCadence): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const months = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : cadence === "semiannual" ? 6 : 12;
  // Clamp to day 28 so "31 de enero + 1 mes" never rolls into March.
  const day = Math.min(d, 28);
  const next = new Date(y, m - 1 + months, day);
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${next.getFullYear()}-${mm}-${dd}`;
}

/** The new amount a change produces from the current one. Null = invalid. */
export function applyAmountChange(
  current: number,
  kind: ScheduledChangeKind,
  amount: number | null,
): number | null {
  if (kind === "set_amount") {
    return amount != null && amount > 0 ? roundMoney(amount) : null;
  }
  if (kind === "adjust_percent") {
    if (amount == null || !Number.isFinite(amount) || Math.abs(amount) > 100) return null;
    const next = roundMoney(current * (1 + amount / 100));
    return next > 0 ? next : null;
  }
  if (kind === "adjust_fixed") {
    if (amount == null || !Number.isFinite(amount)) return null;
    const next = roundMoney(current + amount);
    return next > 0 ? next : null;
  }
  return null;
}

export function validISO(d: unknown): string | null {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

const VALID_FREQUENCIES = new Set(["weekly", "biweekly", "monthly", "yearly"]);

const TARGET_TABLES: Record<Exclude<ScheduledTargetType, "reminder">, string> = {
  income_source: "income_sources",
  fixed_expense: "fixed_expenses",
  goal: "goals",
};

// Why a failed plan couldn't apply, in Kipu's voice — this lands in the row's
// note, which the agent reads back to the user; raw DB text must never leak.
const FAIL_PHRASES: Record<string, string> = {
  objetivo_no_existe: "el destino del cambio ya no existe",
  monto_invalido: "el monto resultante no era válido",
  falta_frecuencia: "faltó la nueva frecuencia",
  moneda_distinta: "la moneda del cambio no coincide con la del objetivo",
  no_aplica: "ese cambio no aplica para una meta",
  no_se_pudo_aplicar: "no se pudo aplicar",
};

// ── Store ────────────────────────────────────────────────────────────────────

export interface CreateScheduledChangeInput {
  targetType: ScheduledTargetType;
  targetId?: string | null;
  targetLabel: string;
  changeKind: ScheduledChangeKind;
  amount?: number | null;
  currency?: string | null;
  newFrequency?: string | null;
  effectiveDate: string;
  cadence?: ScheduledCadence;
  note?: string | null;
}

export async function createScheduledChange(
  userId: string,
  input: CreateScheduledChangeInput,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const effective = validISO(input.effectiveDate);
  if (!effective) return { ok: false, reason: "fecha_invalida" };
  const cadence: ScheduledCadence = input.cadence ?? "once";
  const kind = input.changeKind;
  const needsAmount = kind === "set_amount" || kind === "adjust_percent" || kind === "adjust_fixed";
  if (needsAmount && (input.amount == null || !Number.isFinite(input.amount))) {
    return { ok: false, reason: "monto_invalido" };
  }
  if (kind === "adjust_percent" && Math.abs(Number(input.amount)) > 100) {
    return { ok: false, reason: "porcentaje_fuera_de_rango" };
  }
  if (kind === "set_amount" && Number(input.amount) <= 0) {
    return { ok: false, reason: "monto_invalido" };
  }
  if (kind === "set_frequency" && !VALID_FREQUENCIES.has(String(input.newFrequency))) {
    return { ok: false, reason: "falta_frecuencia" };
  }
  if (input.targetType !== "reminder" && !input.targetId) {
    return { ok: false, reason: "falta_objetivo" };
  }
  try {
    const sb = createSupabaseAdminClient();
    // A plan denominated in another currency than its target would silently
    // re-denominate money at apply time (implicit 1:1). Refuse up front so the
    // agent can ask; applyOne re-checks in case the target changes later.
    if (input.targetType !== "reminder" && input.targetId && input.currency && needsAmount) {
      const table = TARGET_TABLES[input.targetType];
      const { data: target } = await sb
        .from(table)
        .select("currency")
        .eq("id", input.targetId)
        .eq("user_id", userId)
        .maybeSingle();
      const targetCurrency = str((target as Row | null)?.currency);
      if (targetCurrency && targetCurrency.toUpperCase() !== input.currency.toUpperCase()) {
        return { ok: false, reason: "moneda_distinta" };
      }
    }
    const { data, error } = await sb
      .from("scheduled_changes")
      .insert({
        user_id: userId,
        target_type: input.targetType,
        target_id: input.targetId ?? null,
        target_label: input.targetLabel.slice(0, 120),
        change_kind: kind,
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        new_frequency: input.newFrequency ?? null,
        effective_date: effective,
        cadence,
        next_run_date: effective,
        note: input.note?.slice(0, 300) ?? null,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, reason: "no_disponible" };
    return { ok: true, id: String((data as Row).id) };
  } catch {
    return { ok: false, reason: "no_disponible" };
  }
}

export async function listScheduledChanges(userId: string): Promise<ScheduledChange[]> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb
      .from("scheduled_changes")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["pending", "applied", "failed"])
      .order("next_run_date", { ascending: true })
      .limit(30);
    return ((data ?? []) as Row[]).map(mapRow);
  } catch {
    return [];
  }
}

export async function cancelScheduledChange(userId: string, id: string): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from("scheduled_changes")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// ── Executor (called by the daily cron; idempotent per day) ─────────────────

async function noteApplied(sb: ReturnType<typeof createSupabaseAdminClient>, userId: string, text: string) {
  try {
    await sb.from("user_context_notes").insert({
      user_id: userId,
      note_type: "general",
      content: text.slice(0, 480),
      source: "system",
      is_active: true,
    });
  } catch {
    /* best-effort audit note */
  }
}

async function applyOne(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  c: ScheduledChange,
): Promise<{ ok: boolean; detail: string }> {
  if (c.targetType === "reminder") {
    await noteApplied(sb, c.userId, `RECORDATORIO programado (hoy): ${c.targetLabel}${c.note ? ` — ${c.note}` : ""}`);
    return { ok: true, detail: "reminder" };
  }

  const table = c.targetType === "income_source" ? "income_sources" : c.targetType === "fixed_expense" ? "fixed_expenses" : "goals";
  const { data: rowData, error: readErr } = await sb
    .from(table)
    .select("*")
    .eq("id", c.targetId)
    .eq("user_id", c.userId)
    .maybeSingle();
  if (readErr || !rowData) return { ok: false, detail: "objetivo_no_existe" };
  const row = rowData as Row;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let human = "";

  if (c.changeKind === "pause" || c.changeKind === "resume") {
    if (c.targetType === "fixed_expense") {
      patch.is_active = c.changeKind === "resume";
    } else if (c.targetType === "income_source") {
      patch.status = c.changeKind === "resume" ? "active" : "paused";
    } else {
      patch.status = c.changeKind === "resume" ? "active" : "paused";
    }
    human = c.changeKind === "pause" ? "pausado" : "reactivado";
  } else if (c.changeKind === "set_frequency") {
    if (!c.newFrequency) return { ok: false, detail: "falta_frecuencia" };
    if (c.targetType === "goal") return { ok: false, detail: "no_aplica" };
    patch.frequency = c.newFrequency;
    human = `frecuencia → ${c.newFrequency}`;
  } else {
    // amount changes — applied in the TARGET row's own currency (never converted
    // here; the context builder normalizes for the engines at read time). A plan
    // denominated in another currency than the row would silently restate the
    // amount 1:1 — refuse instead (create-time also checks, but the target's
    // currency can change between plan creation and this run).
    const rowCurrency = str(row.currency);
    if (c.currency && rowCurrency && c.currency.toUpperCase() !== rowCurrency.toUpperCase()) {
      return { ok: false, detail: "moneda_distinta" };
    }
    const amountField = c.targetType === "goal" ? "target_amount" : "amount";
    const current = Number(row[amountField] ?? 0);
    const next = applyAmountChange(current, c.changeKind, c.amount);
    if (next == null) return { ok: false, detail: "monto_invalido" };
    patch[amountField] = next;
    human = `${c.targetLabel}: ${current} → ${next}`;
  }

  const { error: updErr } = await sb.from(table).update(patch).eq("id", c.targetId).eq("user_id", c.userId);
  if (updErr) {
    console.error("[kipu.cron.scheduled-changes] apply update failed", c.id, updErr.message);
    return { ok: false, detail: "no_se_pudo_aplicar" };
  }
  await noteApplied(sb, c.userId, `Cambio programado aplicado: ${human || c.targetLabel}.`);
  return { ok: true, detail: human };
}

/** Apply every due pending change. Idempotent per day via last_applied_on. */
export async function runDueScheduledChanges(asOfISO: string): Promise<{ applied: number; failed: number; skipped: number }> {
  const out = { applied: 0, failed: 0, skipped: 0 };
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb
      .from("scheduled_changes")
      .select("*")
      .eq("status", "pending")
      .lte("next_run_date", asOfISO)
      .limit(200);
    for (const r of (data ?? []) as Row[]) {
      const c = mapRow(r);
      // Day-level idempotency: a re-run (or a crashed reschedule) never applies twice.
      if (c.lastAppliedOn === asOfISO) {
        out.skipped += 1;
        continue;
      }
      // Fast-forward past asOf so a backdated plan applies ONCE at the next run
      // and never drip-compounds one cadence step per day catching up.
      let nextRun = advanceCadence(c.nextRunDate, c.cadence);
      while (nextRun <= asOfISO) nextRun = advanceCadence(nextRun, c.cadence);
      // Claim + reschedule in ONE atomic write (CAS on last_applied_on): a
      // concurrent run can't double-claim, and a crash right after the claim
      // can only SKIP this cycle — it can never apply the same money change
      // twice (the row is already advanced/closed before the target mutates).
      const claimPatch: Record<string, unknown> = {
        last_applied_on: asOfISO,
        runs_count: c.runsCount + 1,
        updated_at: new Date().toISOString(),
      };
      if (c.cadence === "once") claimPatch.status = "applied";
      else claimPatch.next_run_date = nextRun;
      let claim = sb.from("scheduled_changes").update(claimPatch).eq("id", c.id).eq("status", "pending");
      claim = c.lastAppliedOn === null ? claim.is("last_applied_on", null) : claim.eq("last_applied_on", c.lastAppliedOn);
      const { data: claimed } = await claim.select("id");
      if (!claimed || claimed.length === 0) {
        out.skipped += 1;
        continue;
      }
      const res = await applyOne(sb, c);
      if (!res.ok) {
        const phrase = FAIL_PHRASES[res.detail] ?? FAIL_PHRASES.no_se_pudo_aplicar;
        const { error: failErr } = await sb
          .from("scheduled_changes")
          .update({
            status: "failed",
            note: `${c.note ?? ""} [no aplicado: ${phrase}]`.trim().slice(0, 300),
            updated_at: new Date().toISOString(),
          })
          .eq("id", c.id);
        if (failErr) console.error("[kipu.cron.scheduled-changes] fail-mark failed", c.id, failErr.message);
        out.failed += 1;
        continue;
      }
      out.applied += 1;
    }
    return out;
  } catch {
    return out;
  }
}
