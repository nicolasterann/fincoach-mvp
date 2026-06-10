import { redirect } from "next/navigation";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ManualAdvancedSection } from "@/app/app/components/ManualAdvancedSection";

// Dev-only manual register. Kept OUT of the customer-facing product (the primary
// input is natural language through Kipu). Reachable directly at /dev/manual-entry
// for testing/admin, never linked from the app navigation.
export default async function ManualEntryDevPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect("/login");
  }

  const ctx = await buildUserFinancialContext(session.user.id);
  if (!ctx.mainGoal || ctx.accounts.length === 0) {
    redirect("/onboarding");
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto w-full max-w-md">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-600">
          Dev · registro manual
        </p>
        <ManualAdvancedSection
          accounts={ctx.accounts}
          debtAccounts={ctx.debtAccounts}
          mainGoal={ctx.mainGoal}
        />
      </section>
    </main>
  );
}
