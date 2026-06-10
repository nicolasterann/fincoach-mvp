import { redirect } from "next/navigation";
import { getChatHistory } from "@/lib/chat-memory/chat-messages";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ChatView } from "../components/ChatView";

// The dedicated Kipu chat — its own focused conversation space (feed vs DMs).
// History respects the user's "new conversation" point (chat_cleared_at), so
// old fallback-era replies never misrepresent the current agent.
export default async function ChatPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect("/login");
  }

  const [{ data: profile }, { data: prefs }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", session.user.id).maybeSingle(),
    supabase
      .from("user_financial_preferences")
      .select("chat_cleared_at")
      .eq("user_id", session.user.id)
      .maybeSingle(),
  ]);

  const history = await getChatHistory({
    userId: session.user.id,
    channel: "web",
    chatId: session.user.id,
    limit: 40,
    since: (prefs?.chat_cleared_at as string | null) ?? null,
  });

  const firstName = (profile?.full_name as string | null)?.split(" ")[0] ?? "";
  const messages = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  return <ChatView firstName={firstName} initialMessages={messages} />;
}
