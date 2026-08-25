import { redirect } from "next/navigation";
import { readThreadView } from "@/lib/chat-memory/thread-view";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ChatView } from "../components/ChatView";

// Server actions invoked from this route (send message, upload evidence) can run
// a long statement import in one turn — give the route the platform max.
export const maxDuration = 300;

// The dedicated Kipu chat — its own focused conversation space (feed vs DMs).
// History respects the user's "new conversation" point (chat_cleared_at), so
// old fallback-era replies never misrepresent the current agent.
// ?share= receives text shared from other apps (PWA share target).
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ share?: string; turn?: string }>;
}) {
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

  const thread = await readThreadView({
    client: supabase,
    userId: session.user.id,
    since: (prefs?.chat_cleared_at as string | null) ?? null,
  });

  const firstName = (profile?.full_name as string | null)?.split(" ")[0] ?? "";
  const { share, turn } = await searchParams;
  const initialShareText = share?.trim().slice(0, 1000) || undefined;
  const initialTurnId =
    typeof turn === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(turn)
      ? turn
      : undefined;

  return (
    <ChatView
      firstName={firstName}
      initialMessages={thread.turns}
      initialShareText={initialShareText}
      initialTurnId={initialTurnId}
      threadComplete={thread.complete}
      threadReadFailed={thread.readFailed}
    />
  );
}
