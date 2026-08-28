import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AppContent } from "./components/AppContent";
import { TimezoneCapture } from "./components/TimezoneCapture";

// Auth and timezone stay shared across the whole /app tree. AppContent keeps
// the sanctuary edge-to-edge and gives detail routes their measured wrapper;
// every detail owns its visible return to the sanctuary.
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
      <AppContent>{children}</AppContent>
    </div>
  );
}
