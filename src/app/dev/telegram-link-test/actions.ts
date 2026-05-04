"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function linkTelegramChatAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const telegramChatId = String(formData.get("telegram_chat_id") ?? "").trim();
  const telegramUsername = String(formData.get("telegram_username") ?? "").trim();

  if (!telegramChatId) {
    redirect("/dev/telegram-link-test?message=telegram-chat-id-required");
  }

  const { error } = await supabase.from("telegram_user_links").upsert(
    {
      user_id: session.user.id,
      telegram_chat_id: telegramChatId,
      telegram_username: telegramUsername || null,
      is_active: true,
      last_message_at: null,
    },
    {
      onConflict: "telegram_chat_id",
    },
  );

  if (error) {
    redirect(`/dev/telegram-link-test?message=${encodeURIComponent(error.message)}`);
  }

  redirect("/dev/telegram-link-test?message=telegram-linked");
}
