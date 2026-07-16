"use client";

import { useEffect } from "react";
import { ensureUserTimezoneAction } from "../timezone-actions";
import {
  timezoneCaptureCacheKey,
  timezoneCaptureShouldCache,
} from "@/lib/financial/timezone-capture";

// Renders nothing. The browser is the only thing that knows the user's real zone,
// and onboarding was the only place that ever asked — so this asks once per user per
// tab on the first /app load and lets the server fill it in if it is still empty.
// Silent and non-blocking: nothing on screen depends on it.
export function TimezoneCapture({ userId }: { userId: string }) {
  useEffect(() => {
    // Scoped to the user, not the tab: a tab outlives a session, and a bare flag
    // would let one account's check speak for the next one that signs in here.
    const key = timezoneCaptureCacheKey(userId);
    // sessionStorage can throw outright (private mode, blocked storage). That is a
    // reason not to REMEMBER the check — never a reason to skip it. Its own try, so
    // a storage failure cannot swallow the capture along with it.
    let alreadyAsked = false;
    try {
      alreadyAsked = sessionStorage.getItem(key) === "1";
    } catch {
      alreadyAsked = false;
    }
    if (alreadyAsked) return;

    let tz: string | null = null;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      tz = null;
    }
    if (!tz) return;

    void ensureUserTimezoneAction(tz)
      .then((result) => {
        // Only a SETTLED outcome earns the cache. Caching a failure is what broke the
        // first version: any error left the tab believing it had checked, so the
        // retry the next load would have given us never happened.
        if (!timezoneCaptureShouldCache(result)) return;
        try {
          sessionStorage.setItem(key, "1");
        } catch {
          /* storage blocked — we simply ask again next load */
        }
      })
      .catch(() => {
        /* transient: no cache written, so the next load retries */
      });
  }, [userId]);
  return null;
}
