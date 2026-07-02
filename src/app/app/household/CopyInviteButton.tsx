"use client";

import { useState } from "react";

// A one-tap "copiar invitación" affordance for the household invite link.
// Pure client-side clipboard copy — no backend. Falls back gracefully (the
// full link stays visible and select-all above) if the Clipboard API is
// unavailable (older in-app browsers).
export function CopyInviteButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the user can still select the visible link.
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="kipu-press mt-3 rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
    >
      {copied ? "¡Copiado!" : "Copiar invitación"}
    </button>
  );
}
