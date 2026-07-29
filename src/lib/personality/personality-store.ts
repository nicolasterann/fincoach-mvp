import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { PersonalityResult, Archetype, Dimension } from "@/lib/personality/personality-test";

// Stage 20 (micro-stage C) — personality-test persistence. Service-role, graceful
// (select * / try-catch → production unchanged until migration 028 is applied).

export interface StoredPersonalityResult {
  archetype: Archetype;
  archetypeLabel: string;
  dimensions: Record<Dimension, number>;
  version: number;
  confidence: "low" | "medium" | "high";
  takenAtMs: number;
}

export type PersonalityResultRead =
  | { ok: true; found: false }
  | { ok: true; found: true; result: StoredPersonalityResult }
  | { ok: false };

export type PersonalityResultReader = () => PromiseLike<{
  data: unknown;
  error: unknown;
}>;

export async function savePersonalityResult(userId: string, result: PersonalityResult): Promise<boolean> {
  try {
    const sb = createSupabaseAdminClient();
    const { error } = await sb.from("user_personality_test").upsert(
      { user_id: userId, archetype: result.archetype, dimensions: result.dimensions, version: result.version, confidence: result.confidence, taken_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    return !error;
  } catch {
    return false;
  }
}

export async function readPersonalityResultWith(
  reader: PersonalityResultReader,
): Promise<PersonalityResultRead> {
  try {
    const { data, error } = await reader();
    if (error) return { ok: false };
    if (!data) return { ok: true, found: false };
    const r = data as Record<string, unknown>;
    const archetype = String(r.archetype ?? "equilibrista") as Archetype;
    return {
      ok: true,
      found: true,
      result: {
        archetype,
        archetypeLabel: archetypeLabel(archetype),
        dimensions:
          (r.dimensions as Record<Dimension, number>) ??
          ({} as Record<Dimension, number>),
        version: typeof r.version === "number" ? r.version : 1,
        confidence: String(r.confidence ?? "low") as
          | "low"
          | "medium"
          | "high",
        takenAtMs: new Date(String(r.taken_at ?? "")).getTime() || 0,
      },
    };
  } catch {
    return { ok: false };
  }
}

export async function readPersonalityResult(
  userId: string,
): Promise<PersonalityResultRead> {
  const sb = createSupabaseAdminClient();
  return readPersonalityResultWith(() =>
    sb
      .from("user_personality_test")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
  );
}

export type PersonalityResultDeleter = () => PromiseLike<{ error: unknown }>;

export async function deletePersonalityResultWith(
  deleter: PersonalityResultDeleter,
): Promise<boolean> {
  try {
    const { error } = await deleter();
    return !error;
  } catch {
    return false;
  }
}

export async function deletePersonalityResult(userId: string): Promise<boolean> {
  const sb = createSupabaseAdminClient();
  return deletePersonalityResultWith(() =>
    sb
      .from("user_personality_test")
      .delete()
      .eq("user_id", userId),
  );
}

function archetypeLabel(a: Archetype): string {
  const m: Record<Archetype, string> = {
    explorador: "Explorador/a — vives por experiencias y disfrutar tu dinero",
    constructor: "Constructor/a — te mueve construir patrimonio y libertad",
    guardian: "Guardián/a — priorizas la seguridad y la tranquilidad",
    ambicioso: "Ambicioso/a — vas por el crecimiento, toleras más riesgo",
    realizador: "Realizador/a — te enfocas en cumplir metas concretas",
    equilibrista: "Equilibrista — buscas balance entre disfrutar y construir",
  };
  return m[a] ?? a;
}
