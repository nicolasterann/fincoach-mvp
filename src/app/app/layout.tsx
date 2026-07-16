import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AppBottomNav, AppSidebar } from "./components/AppNav";
import { TimezoneCapture } from "./components/TimezoneCapture";

// App shell: persistent navigation around every /app page. Sidebar on desktop,
// bottom tab bar on mobile (hidden on chat so the conversation owns the
// keyboard). Pages own their max width — the dashboard uses the full canvas on
// desktop; reading pages stay column-width. Auth is enforced once here.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <TimezoneCapture userId={session.user.id} />
      <div className="mx-auto flex w-full max-w-7xl">
        <AppSidebar />
        <main className="min-w-0 flex-1 px-5 pt-6 sm:px-8">{children}</main>
      </div>
      <AppBottomNav />
    </div>
  );
}
