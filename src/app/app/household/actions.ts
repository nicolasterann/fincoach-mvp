"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createInviteLink } from "@/lib/household/household-store";

// Direct action: generate a shareable invite link for a household. The store
// enforces the permission model deterministically (only an ACTIVE owner/admin
// may invite); this action just authenticates and surfaces the token.
export async function createHouseholdInviteAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const householdId = String(formData.get("household_id") ?? "").trim();
  const requestId = String(formData.get("request_id") ?? "").trim();
  if (!householdId || !requestId) redirect("/app/household?invite=error");

  const result = await createInviteLink(session.user.id, householdId, {
    dedupeKey: `ui:household-invite:${requestId}`,
  });
  const token = result.ok
    ? (result.data as { token?: string } | undefined)?.token
    : undefined;

  if (!token) redirect("/app/household?invite=error");

  redirect(`/app/household?invite=${encodeURIComponent(token)}`);
}
