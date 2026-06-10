import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { MovementRow } from "../components/MovementRow";
import { describeMovement, formatDayLabel } from "../components/app-dashboard-helpers";

interface TxRow {
  id: string;
  description: string;
  category: string | null;
  base_amount: number | string;
  base_currency: string;
  type: string;
  occurred_at: string;
  debt_account_id: string | null;
  goal_id: string | null;
}

// Activity = the financial timeline. Reads like a wellness feed (human labels,
// Kipu money, grouped by day), never a ledger export.
export default async function ActivityPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect("/login");
  }

  const { data } = await supabase
    .from("transactions")
    .select("id, description, category, base_amount, base_currency, type, occurred_at, debt_account_id, goal_id")
    .eq("user_id", session.user.id)
    .order("occurred_at", { ascending: false })
    .limit(80);

  const txList = (data ?? []) as TxRow[];

  // Group by day for calm scanning.
  const groups: { day: string; items: TxRow[] }[] = [];
  for (const tx of txList) {
    const day = formatDayLabel(tx.occurred_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(tx);
    else groups.push({ day, items: [tx] });
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Tu historial</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-50">Actividad</h1>
      </header>

      {txList.length === 0 ? (
        <section className="rounded-3xl border border-white/5 bg-zinc-900 p-6 text-center">
          <p className="text-sm font-medium text-zinc-200">Todavía no hay movimientos</p>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            Cuéntale a Kipu tu primer gasto o ingreso y aparecerá aquí.
          </p>
          <Link
            href="/app/chat"
            className="mt-4 inline-block rounded-full bg-emerald-400 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          >
            Hablar con Kipu
          </Link>
        </section>
      ) : (
        groups.map((group) => (
          <section key={group.day}>
            <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-widest text-zinc-600">
              {group.day}
            </p>
            <div className="divide-y divide-white/5 rounded-3xl border border-white/5 bg-zinc-900 px-5">
              {group.items.map((tx) => (
                <MovementRow key={tx.id} view={describeMovement(tx)} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
