"use server";

import { redirect } from "next/navigation";
import { handleChatTransactionMessage } from "@/lib/ai/chat-transaction-handler";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function testChatHandlerAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const message = String(formData.get("message") ?? "").trim();

  if (!message) {
    redirect("/dev/chat-handler-test?status=needs_clarification&code=empty-message&response=Escribe%20un%20mensaje%20para%20probar%20el%20handler.");
  }

  const result = await handleChatTransactionMessage({
    userId: session.user.id,
    message,
  });

  const params = new URLSearchParams({
    status: result.chatResponse.status,
    code: result.redirectCode,
    response: result.chatResponse.message,
  });

  redirect(`/dev/chat-handler-test?${params.toString()}`);
}
