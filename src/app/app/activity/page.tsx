import Link from "next/link";
import { redirect } from "next/navigation";
import { formatKipuMoney } from "@/lib/financial/money";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { MovementRow } from "../components/MovementRow";
import { describeMovement, formatDayLabel } from "../components/app-dashboard-helpers";
import type { CurrencyCode } from "@/types/financial";

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

type Filter = "all" | "out" | "in";

const OUT_TYPES = new Set(["expense", "debt_payment", "goal_contribution"]);
const IN_TYPES = new Set(["income", "refund"]);

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todo" },
  { key: "out", label: "Salidas" },
  { key: "in", label: "Entradas" },
];

// Activity = the financial timeline. Reads like a wellness feed (human labels,
// Kipu money, grouped by day with day totals), never a ledger export.
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect("/login");
  }

  const { f } = await searchParams;
  const filter: Filter = f === "out" || f === "in" ? f : "all";

  const { data } = await supabase
    .from("transactions")
    .select("id, description, category, base_amount, base_currency, type, occurred_at, debt_account_id, goal_id")
    .eq("user_id", session.user.id)
    .order("occurred_at", { ascending: false })
    .limit(120);

  const all = (data ?? []) as TxRow[];
  const txList = all.filter((tx) => {
    if (filter === "out") return OUT_TYPES.has(tx.type);
    if (filter === "in") return IN_TYPES.has(tx.type);
    return true;
  });

  // Group by day, with the day's outflow as a calm total.
  const groups: { day: string; items: TxRow[]; dayOut: number }[] = [];
  for (const tx of txList) {
    const day = formatDayLabel(tx.occurred_at);
    let group = groups[groups.length - 1];
    if (!group || group.day !== day) {
      group = { day, items: [], dayOut: 0 };
      groups.push(group);
    }
    group.items.push(tx);
    if (tx.type === "expense") {
      group.dayOut += Math.abs(Number(tx.base_amount) || 0);
    }
  }
  const baseCurrency = (all[0]?.base_currency ?? "USD") as CurrencyCode;

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Tu historial</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-50">Actividad</h1>
      </header>

      {/* Filter chips */}
      <div className="mt-4 flex gap-2">
        {FILTERS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "all" ? "/app/activity" : `/app/activity?f=${item.key}`}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
              filter === item.key
                ? "bg-emerald-400 text-zinc-950"
                : "border border-white/10 text-zinc-400 hover:bg-white/5"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {txList.length === 0 ? (
        <section className="mt-5 rounded-3xl border border-white/5 bg-zinc-900 p-6 text-center">
          <p className="text-sm font-medium text-zinc-200">
            {filter === "all" ? "Todavía no hay movimientos" : "Nada por aquí con este filtro"}
          </p>
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
        <div className="mt-5 space-y-5">
          {groups.map((group) => (
            <section key={group.day}>
              <div className="mb-1 flex items-center justify-between px-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
                  {group.day}
                </p>
                {group.dayOut > 0 && (
                  <p className="text-xs font-medium tabular-nums text-zinc-600">
                    Salió {formatKipuMoney(group.dayOut, baseCurrency)}
                  </p>
                )}
              </div>
              <div className="divide-y divide-white/5 rounded-3xl border border-white/5 bg-zinc-900 px-5">
                {group.items.map((tx) => (
                  <MovementRow key={tx.id} view={describeMovement(tx)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
