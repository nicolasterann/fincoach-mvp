"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// The sanctuary owns the full viewport. Detail routes retain the same measured
// reading wrapper and safe-area protection; their MetricShell/TuKipuHeader
// components provide the visible return to /app.
export function AppContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const sanctuary = pathname === "/app";

  return (
    <div
      className={
        sanctuary
          ? "mx-auto flex w-full"
          : "mx-auto flex w-full max-w-7xl pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      }
      data-app-content={sanctuary ? "sanctuary" : "detail"}
    >
      <main className={sanctuary ? "min-w-0 flex-1" : "min-w-0 flex-1 px-5 pt-6 sm:px-8"}>
        {children}
      </main>
    </div>
  );
}
