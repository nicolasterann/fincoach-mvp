/** What the first-load timezone backfill actually did.
 *  - `stored`      — the zone was empty and we filled it.
 *  - `already_set` — a zone is on file. Never ours to overwrite.
 *  - `retry`       — nothing settled: a read/write failed, or there was no session.
 *    The distinction is the point: the previous version returned void for all four
 *    outcomes, so the client cached "checked" after a FAILURE and never asked again
 *    for the rest of the tab's life. */
export type TimezoneCaptureResult = "stored" | "already_set" | "retry";

/** Whether the client may remember it already asked, for this tab.
 *  Only a settled answer earns the cache: `retry` means we still do not know whether
 *  the user has a zone, and the next page load must ask again. */
export function timezoneCaptureShouldCache(result: TimezoneCaptureResult): boolean {
  return result === "stored" || result === "already_set";
}

/** The cache key is PER USER. A tab outlives a session: sign out, sign in as someone
 *  else, and a bare "already checked" flag would speak for an account it never
 *  checked — the second user would never get their zone backfilled. */
export function timezoneCaptureCacheKey(userId: string): string {
  return `kipu.tz.checked:${userId}`;
}
