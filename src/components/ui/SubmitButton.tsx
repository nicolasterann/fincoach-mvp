"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

// Double-tap protection for server-action forms: while the action is pending
// the button disables itself and shows a pulsing dot + pending label. Callers
// pass their full styles via className so every form keeps its own look.
export function SubmitButton({
  children,
  pendingLabel,
  className = "",
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} disabled:cursor-wait disabled:opacity-70`}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" />
          {pendingLabel ?? children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
