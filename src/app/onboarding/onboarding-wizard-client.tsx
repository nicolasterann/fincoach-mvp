"use client";

import dynamic from "next/dynamic";
import type { CurrencyCode } from "@/types/financial";

// Client-only boundary for the wizard. ssr:false keeps the localStorage-backed
// draft restore off the server (no hydration mismatch) and must live in a Client
// Component (a Server Component can't pass ssr:false to next/dynamic).
const OnboardingWizard = dynamic(() => import("./onboarding-wizard"), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-zinc-950" aria-hidden />,
});

export default function OnboardingWizardClient(props: {
  userEmail: string;
  defaultBaseCurrency: CurrencyCode;
  saveErrored: boolean;
  /** S31 (4.1) — the real, human save error (e.g. the honest-FX ask) to render
   *  in the review error box instead of a generic "algo falló". */
  saveErrorMessage?: string | null;
  /** S31 (5.1f) — server-loaded fx_rates so a rate set earlier (e.g. via chat)
   *  never re-blocks the client FX gate. */
  knownRates?: { from: string; to: string; rate: number }[];
}) {
  return <OnboardingWizard {...props} />;
}
