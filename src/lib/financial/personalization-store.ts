import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { FinancialPhilosophy } from "@/types/financial";
import type { CaptureEvent } from "@/lib/financial/personalization-signals";
import { toCoachTone, toCoachDetail, type DashboardDensity, type LifeContextItem, type NudgeSensitivity } from "@/lib/financial/personalization-profile";

// Stage 18 — the personalization persistence layer (migration 026). Service-role
// only. EVERY read uses `select *` / tolerates missing tables, and every write is
// try/catch → production behavior is UNCHANGED until 026 is applied. Reads only
// what isn't already loaded by the briefing (tone/detail live in coach_preferences,
// ambition/risk in user_financial_preferences); inferred behavior stays derived.

const DAY_MS = 86_400_000;
type Row = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length ? v : undefined);

export interface PersonalizationData {
  explicitPersonalization: {
    financialPhilosophy?: FinancialPhilosophy | null;
    nudgeSensitivity?: NudgeSensitivity | null;
    dashboardDensity?: DashboardDensity | null;
    preferredCapture?: string | null;
    onboardingMode?: "simple" | "power" | null;
  };
  lifeContext: LifeContextItem[];
  captureEvents: CaptureEvent[];
  nudgeEngagement: { sent: number; replied: number };
  correctionCount: number;
}

export interface PersonalizationDataRead {
  ok: boolean;
  data: PersonalizationData;
}

export async function readPersonalizationData(
  userId: string,
  nowMs: number,
): Promise<PersonalizationDataRead> {
  const sb = createSupabaseAdminClient();
  const out: PersonalizationData = { explicitPersonalization: {}, lifeContext: [], captureEvents: [], nudgeEngagement: { sent: 0, replied: 0 }, correctionCount: 0 };
  let ok = true;

  // These are non-money signals, so a partial read may still safely guide a
  // neutral tone. But it must report itself: explain_personalization must never
  // turn "one table failed" into "you never configured this".
  try {
    const { data, error } = await sb.from("user_personalization").select("*").eq("user_id", userId).maybeSingle();
    if (error) ok = false;
    if (data) {
      const r = data as Row;
      out.explicitPersonalization = {
        financialPhilosophy: str(r.financial_philosophy) as FinancialPhilosophy | undefined,
        nudgeSensitivity: str(r.nudge_sensitivity) as NudgeSensitivity | undefined,
        dashboardDensity: str(r.dashboard_density) as DashboardDensity | undefined,
        preferredCapture: str(r.preferred_capture),
        onboardingMode: str(r.onboarding_mode) as "simple" | "power" | undefined,
      };
    }
  } catch { ok = false; }

  // User-declared life context.
  try {
    const { data, error } = await sb.from("user_life_context").select("kind, label").eq("user_id", userId).limit(20);
    if (!error && data) out.lifeContext = data.map((r0) => { const r = r0 as Row; return { kind: String(r.kind ?? "other"), label: String(r.label ?? "") }; }).filter((c) => c.label);
    else if (error || !data) ok = false;
  } catch { ok = false; }

  // Inferred-behavior raw inputs (always available): capture events + nudge feedback + corrections.
  try {
    const sinceISO = new Date(nowMs - 60 * DAY_MS).toISOString();
    const { data, error } = await sb.from("transactions").select("created_at, input_channel").eq("user_id", userId).gte("created_at", sinceISO).order("created_at", { ascending: false }).limit(300);
    if (error || !data) ok = false;
    else out.captureEvents = data.map((r0) => { const r = r0 as Row; return { createdAtMs: new Date(String(r.created_at)).getTime(), inputChannel: str(r.input_channel) ?? null }; });
  } catch { ok = false; }

  try {
    const { data, error } = await sb.from("ambient_nudges").select("status, replied").eq("user_id", userId).limit(200);
    if (error || !data) ok = false;
    if (data) {
      out.nudgeEngagement = data.reduce((acc, r0) => {
        const r = r0 as Row;
        if (r.status === "sent") acc.sent += 1;
        if (r.replied === true) acc.replied += 1;
        return acc;
      }, { sent: 0, replied: 0 });
    }
  } catch { ok = false; }

  try {
    const { count, error } = await sb.from("user_merchant_memory").select("*", { count: "exact", head: true }).eq("user_id", userId);
    if (error || count == null) ok = false;
    else out.correctionCount = count;
  } catch { ok = false; }

  return { ok, data: out };
}

// ── Writes (all try/catch; honest false on failure / pre-migration) ──────────

export async function setPersonalizationPref(
  userId: string,
  patch: { financialPhilosophy?: FinancialPhilosophy; nudgeSensitivity?: NudgeSensitivity; dashboardDensity?: DashboardDensity; preferredCapture?: string; onboardingMode?: "simple" | "power" },
): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const row: Row = { user_id: userId, updated_at: new Date().toISOString() };
    if (patch.financialPhilosophy) row.financial_philosophy = patch.financialPhilosophy;
    if (patch.nudgeSensitivity) row.nudge_sensitivity = patch.nudgeSensitivity;
    if (patch.dashboardDensity) row.dashboard_density = patch.dashboardDensity;
    if (patch.preferredCapture) row.preferred_capture = patch.preferredCapture;
    if (patch.onboardingMode) row.onboarding_mode = patch.onboardingMode;
    const { error } = await sb.from("user_personalization").upsert(row, { onConflict: "user_id" });
    return !error;
  } catch {
    return false;
  }
}

export async function setCommunicationPref(userId: string, patch: { tone?: string; detailLevel?: string }): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    // Map the rich Stage-18 vocabulary to the values the coach_preferences CHECK
    // accepts (tone in clear|coach_like|playful; detail_level in short|medium|detailed).
    // Writing the raw enum would fail the CHECK and silently lose the preference.
    const tone = toCoachTone(patch.tone);
    const detailLevel = toCoachDetail(patch.detailLevel);
    if (!tone && !detailLevel) return false;
    const row: Row = { user_id: userId, updated_at: new Date().toISOString() };
    if (tone) row.tone = tone;
    if (detailLevel) row.detail_level = detailLevel;
    const { error } = await sb.from("coach_preferences").upsert(row, { onConflict: "user_id" });
    return !error;
  } catch {
    return false;
  }
}

export async function upsertLifeContext(userId: string, kind: string, label: string): Promise<boolean> {
  if (!kind || !label) return false;
  try {
    const sb = createSupabaseAdminClient();
    const { error } = await sb.from("user_life_context").upsert({ user_id: userId, kind, label: label.slice(0, 120), source: "user_stated" }, { onConflict: "user_id,kind" });
    return !error;
  } catch {
    return false;
  }
}

export async function removeLifeContext(userId: string, kind: string): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { error } = await sb.from("user_life_context").delete().eq("user_id", userId).eq("kind", kind);
    return !error;
  } catch {
    return false;
  }
}

// Reset the personalization Kipu OWNS: the philosophy + UX preferences
// (user_personalization) and the user-declared life context. Deliberately does
// NOT touch coach_preferences (tone/detail are NOT NULL with a CHECK and shared
// with onboarding) nor user_financial_preferences (risk/ambition + financial
// facts) — those revert via their own setters, and the confirmation copy says so.
export async function resetPersonalization(userId: string): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.rpc("kipu_reset_personalization", {
      p_user_id: userId,
    });
    return !error && (data as { outcome?: unknown } | null)?.outcome === "reset";
  } catch {
    return false;
  }
}

export async function logPreferenceEvent(userId: string, eventType: string, value: string | null, source = "chat"): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { error } = await sb.from("user_preference_events").insert({ user_id: userId, event_type: eventType, value: value ? value.slice(0, 200) : null, source });
    return !error;
  } catch {
    return false;
  }
}
