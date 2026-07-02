import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Settings — data export. Downloads the user's OWN financial data as JSON.
// Runs on the AUTHENTICATED server client, so RLS enforces ownership on every
// select; no service-role access here. Read-only: nothing is mutated.
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const userId = session.user.id;

  const [profile, accounts, incomeSources, fixedExpenses, debtAccounts, goals, budgetCategories, transactions] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("accounts").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
      supabase.from("income_sources").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
      supabase.from("fixed_expenses").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
      supabase.from("debt_accounts").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
      supabase.from("goals").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
      supabase.from("budget_categories").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
      supabase
        .from("transactions")
        .select("*")
        .eq("user_id", userId)
        .order("occurred_at", { ascending: false })
        .limit(1000),
    ]);

  // scheduled_payments may not exist on every environment (staged migrations) —
  // degrade to an empty list instead of failing the whole export.
  let scheduledPayments: unknown[] = [];
  try {
    const { data } = await supabase
      .from("scheduled_payments")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    scheduledPayments = data ?? [];
  } catch {
    scheduledPayments = [];
  }

  const txRows = transactions.data ?? [];
  const payload = {
    exportedAt: new Date().toISOString(),
    note: "Estos son tus datos tal como Kipu los guarda. Los movimientos y cuentas llevan su moneda original (original_*) y su re-expresión en tu moneda base (base_*); lo demás guarda su monto con la moneda indicada en cada fila.",
    // Honest scope: the movements list is capped; say so instead of implying completeness.
    transactionsScope:
      txRows.length >= 1000
        ? "Incluye tus últimos 1000 movimientos; los anteriores siguen guardados en Kipu."
        : "Incluye todos tus movimientos.",
    profile: profile.data ?? null,
    accounts: accounts.data ?? [],
    incomeSources: incomeSources.data ?? [],
    fixedExpenses: fixedExpenses.data ?? [],
    debtAccounts: debtAccounts.data ?? [],
    goals: goals.data ?? [],
    budgetCategories: budgetCategories.data ?? [],
    transactions: txRows,
    scheduledPayments,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="kipu-mis-datos.json"',
      "Cache-Control": "no-store",
    },
  });
}
