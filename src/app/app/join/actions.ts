"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { acceptInviteByToken, declineInviteByToken } from "@/lib/household/household-store";

// Stage 20 PASS 2 (Micro-stage F) — accept/decline a household invite by link/token.
// The token IS the credential; the store re-validates (pending, not expired, target
// match) before adding the member. No email infra — the link is shared by the user.

export async function acceptInviteAction(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim() || undefined;
  if (!token) redirect("/app/household?error=token");
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");
  // Surface failures instead of silently pretending success (a household membership
  // must never be silently masked): on failure, return to the invite with the reason.
  const result = await acceptInviteByToken(session.user.id, token, displayName);
  if (!result.ok) redirect(`/app/join/${token}?error=${encodeURIComponent(result.reason ?? "no_pude_unirte")}`);
  redirect("/app/household");
}

export async function declineInviteAction(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/app");
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");
  await declineInviteByToken(session.user.id, token);
  redirect("/app");
}
