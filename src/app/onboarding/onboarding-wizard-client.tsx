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
}) {
  return <OnboardingWizard {...props} />;
}
