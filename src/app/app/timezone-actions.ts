"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { normalizeIanaTimezone } from "@/lib/onboarding/wizard-model";
import type { TimezoneCaptureResult } from "@/lib/financial/timezone-capture";

// Stage H — the user's IANA zone decides when THEIR day and month start: the tank
// walk, the objective version's month, the nightly materializer, the monthly close.
// Onboarding captures it, but that is the only automatic capture in the product, so
// anyone who onboarded before that existed — or whose save-time lookup failed —
// silently runs on the server's America/Guayaquil default forever. This backfills it
// on the first authenticated page load, which every /app route passes through.
//
// FILL ONLY WHEN EMPTY, and the emptiness test lives in the WRITE — not in a read
// before it. Read-then-upsert looked equivalent and was not: between the two, a chat
// declaration ("vivo en Buenos Aires") could land, and the upsert would silently
// stomp it back to whatever this browser happened to report. The user's stated zone
// outranks a browser reading, always; it also means a trip abroad cannot move
// someone's month boundary, because Kipu cannot tell a traveller from a mover.
export async function ensureUserTimezoneAction(
  rawTimezone: string,
): Promise<TimezoneCaptureResult> {
  const timezone = normalizeIanaTimezone(rawTimezone);
  // Unreachable from our own client (it only sends what Intl produced, which
  // round-trips), so this is a tampered or exotic call: store nothing, claim nothing.
  if (!timezone) return "retry";

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return "retry";
  const userId = session.user.id;

  // One statement: fill the column only if it is STILL empty at write time.
  const { data: filled, error: fillError } = await supabase
    .from("user_engagement")
    .update({ timezone })
    .eq("user_id", userId)
    .or('timezone.is.null,timezone.eq.""')
    .select("user_id");
  if (fillError) return "retry";
  if (filled && filled.length > 0) return "stored";

  // Nothing updated means either there is no row yet, or a zone is already on file.
  // A bare INSERT separates the two atomically — and, unlike an upsert, LOSES to a
  // row that appeared meanwhile instead of overwriting it.
  const { error: insertError } = await supabase
    .from("user_engagement")
    .insert({ user_id: userId, timezone });
  if (!insertError) return "stored";
  // 23505 = unique violation: the row exists and already carries a zone. That is
  // someone's decision, not ours to revise.
  if (insertError.code === "23505") return "already_set";
  return "retry";
}
