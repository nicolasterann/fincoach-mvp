"use client";

import { useEffect } from "react";
import { ensureUserTimezoneAction } from "../timezone-actions";

// Renders nothing. The browser is the only thing that knows the user's real zone,
// and onboarding was the only place that ever asked — so this asks once per session
// on the first /app load and lets the server fill it in if it is still empty.
// Silent and non-blocking: nothing on screen depends on it.
const ONCE_KEY = "kipu.tz.checked";

export function TimezoneCapture() {
  useEffect(() => {
    let tz: string | null = null;
    try {
      // Already asked this tab: the answer cannot change mid-session, and the server
      // would just re-read a zone it already has. Skip the round-trip.
      if (sessionStorage.getItem(ONCE_KEY)) return;
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      // No Intl zone, or storage blocked (private mode / strict settings). Either way
      // there is nothing to report, and nothing here is worth breaking a page over.
      return;
    }
    if (!tz) return;
    void ensureUserTimezoneAction(tz)
      .then(() => {
        try {
          sessionStorage.setItem(ONCE_KEY, "1");
        } catch {
          /* storage blocked — we just ask again next load */
        }
      })
      .catch(() => {});
  }, []);
  return null;
}
