import { redirect } from "next/navigation";
import { getChatHistory } from "@/lib/chat-memory/chat-messages";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ChatView } from "../components/ChatView";

// The dedicated Kipu chat — its own focused conversation space (feed vs DMs).
export default async function ChatPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect("/login");
  }

  const [{ data: profile }, history] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", session.user.id).maybeSingle(),
    getChatHistory({ userId: session.user.id, channel: "web", chatId: session.user.id }),
  ]);

  const firstName = (profile?.full_name as string | null)?.split(" ")[0] ?? "";
  const messages = history.map((m) => ({ id: m.id, role: m.role, content: m.content }));

  return <ChatView firstName={firstName} messages={messages} />;
}
