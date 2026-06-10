import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AppBottomNav, AppSidebar } from "./components/AppNav";

// App shell: persistent navigation around every /app page. Sidebar on desktop,
// bottom tab bar on mobile. Content is width-capped and centered so the product
// feels intentional on both phone and browser. Auth is enforced once here.
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
      <div className="mx-auto flex w-full max-w-5xl">
        <AppSidebar />
        <main className="min-w-0 flex-1 px-5 pb-28 pt-6 sm:px-8 lg:pb-10">
          <div className="mx-auto w-full max-w-xl">{children}</div>
        </main>
      </div>
      <AppBottomNav />
    </div>
  );
}
