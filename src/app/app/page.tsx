import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { SantuarioShell } from "./components/shell/SantuarioShell";
import { buildShellPayload } from "./components/shell/shell-payload";

// The living sanctuary is the only product home. The layout owns auth for the
// whole /app tree; this local check keeps the page safe if it is ever rendered
// outside that boundary.
export default async function AppPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const payload = await buildShellPayload(session.user.id);
  return <SantuarioShell payload={payload} />;
}

