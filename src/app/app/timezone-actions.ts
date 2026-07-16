"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { normalizeIanaTimezone, timezoneBackfillValue } from "@/lib/onboarding/wizard-model";

// Stage H — the user's IANA zone decides when THEIR day and month start: the tank
// walk, the objective version's month, the nightly materializer, the monthly close.
// Onboarding captures it, but that is the only automatic capture in the product, so
// anyone who onboarded before that existed — or whose save-time lookup failed —
// silently runs on the server's America/Guayaquil default forever. This backfills it
// on the first authenticated page load, which every /app route passes through.
//
// FILL ONLY WHEN EMPTY. Never overwrite: the user may have STATED their zone in chat
// (saveAmbientPrefs), and that decision outranks a browser reading. It also means a
// trip abroad cannot silently move someone's month boundary — a browser in another
// country is a traveller, not a relocation, and Kipu is not entitled to guess which.
export async function ensureUserTimezoneAction(rawTimezone: string): Promise<void> {
  const timezone = normalizeIanaTimezone(rawTimezone);
  if (!timezone) return;

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return;
  const userId = session.user.id;

  const { data, error } = await supabase
    .from("user_engagement")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  // A failed READ is not evidence the zone is missing — writing here would be
  // guessing over a decision we could not see. Leave it for the next page load.
  if (error) return;
  const toWrite = timezoneBackfillValue(
    typeof data?.timezone === "string" ? data.timezone : null,
    timezone,
  );
  if (!toWrite) return;

  // Best-effort by design: the zone is a profile fact, not this page's job. A
  // failure just means the next load tries again — unlike onboarding, nothing is
  // being frozen against it right now.
  await supabase
    .from("user_engagement")
    .upsert({ user_id: userId, timezone: toWrite }, { onConflict: "user_id" });
}
