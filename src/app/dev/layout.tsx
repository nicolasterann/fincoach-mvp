import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Stage 20 PASS 2 (Micro-stage H) — CENTRAL guard for every internal /dev/* tool.
// These pages run deterministic gates AND live-model simulators (real API cost).
// Previously each page did its own session check, so a logged-in BETA user could
// still reach them. This layout wraps all /dev/* routes and adds a stricter,
// fail-closed admin gate on top — without weakening any per-page check.
//
// Access rule:
//  • Always require an authenticated session (→ /login).
//  • In production: additionally require the email to be in KIPU_INTERNAL_EMAILS
//    (comma-separated allowlist). If the allowlist is unset, NO ONE gets in
//    (fail-closed) — beta users never reach internal tools or live-model sims.
//  • Outside production (local dev): any authenticated user may use the tools, so
//    local QA / the deterministic gate keep working unchanged.

export const dynamic = "force-dynamic";

function internalEmails(): string[] {
  return (process.env.KIPU_INTERNAL_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export default async function DevLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  if (process.env.NODE_ENV === "production") {
    const email = (session.user.email ?? "").toLowerCase();
    if (!email || !internalEmails().includes(email)) redirect("/app");
  }

  return <>{children}</>;
}
