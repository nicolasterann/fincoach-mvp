import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDisplay } from "@/lib/financial/display-money";
import { formatKipuMoney } from "@/lib/financial/money";
import { loadFxRates } from "@/lib/fx/fx-store";
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
  related_transaction_id: string | null;
}

type Filter = "all" | "out" | "in";

const OUT_TYPES = new Set(["expense", "debt_payment", "goal_contribution"]);
const IN_TYPES = new Set(["income", "refund"]);

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todo" },
  { key: "out", label: "Salidas" },
  { key: "in", label: "Entradas" },
];

// Day-total semantics follow the ACTIVE filter, so the number always matches
// the rows the user is looking at: "Salidas" sums every outflow type shown,
// "Entradas" sums the inflows, "Todo" keeps pure spending (labeled precisely).
const DAY_TOTAL: Record<Filter, { types: Set<string>; label: string }> = {
  all: { types: new Set(["expense"]), label: "Gastado" },
  out: { types: OUT_TYPES, label: "Salió" },
  in: { types: IN_TYPES, label: "Entró" },
};

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

  // Stage 24 — WEB-ONLY display re-expression. The profile is the source of
  // truth for the BASE currency (never inferred from a transaction row).
  const [{ data }, { data: profileRow }, rates] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, description, category, base_amount, base_currency, type, occurred_at, debt_account_id, goal_id, related_transaction_id")
      .eq("user_id", session.user.id)
      .order("occurred_at", { ascending: false })
      .limit(120),
    supabase
      .from("profiles")
      .select("base_currency, display_currency")
      .eq("id", session.user.id)
      .maybeSingle(),
    loadFxRates(session.user.id),
  ]);

  const all = (data ?? []) as TxRow[];
  const baseCurrency = ((profileRow?.base_currency as string | null | undefined) ?? "USD") as CurrencyCode;
  const displayCurrency = (profileRow?.display_currency as string | null | undefined) ?? undefined; // undefined => native no-op

  // Reversed originals stay visible in the feed (honesty) but must NOT count in
  // any SUM — same netting the dashboard/margen engines apply.
  const reversedIds = new Set(
    all.filter((r) => r.type === "reversal" && r.related_transaction_id).map((r) => String(r.related_transaction_id)),
  );

  const txList = all.filter((tx) => {
    if (filter === "out") return OUT_TYPES.has(tx.type);
    if (filter === "in") return IN_TYPES.has(tx.type);
    return true;
  });

  // Group by day; the day total counts ONLY the types the active filter shows.
  const dayTotal = DAY_TOTAL[filter];
  const groups: { day: string; items: TxRow[]; dayTotal: number }[] = [];
  for (const tx of txList) {
    const day = formatDayLabel(tx.occurred_at);
    let group = groups[groups.length - 1];
    if (!group || group.day !== day) {
      group = { day, items: [], dayTotal: 0 };
      groups.push(group);
    }
    group.items.push(tx);
    if (dayTotal.types.has(tx.type) && !reversedIds.has(tx.id)) {
      group.dayTotal += Math.abs(Number(tx.base_amount) || 0);
    }
  }

  // Honest week summary: only when the loaded window fully covers the last 7
  // days (real sums only — never extrapolated from a truncated page).
  const weekAgoMs = new Date().getTime() - 7 * 86_400_000;
  const oldestLoadedMs = all.length > 0 ? new Date(all[all.length - 1].occurred_at).getTime() : 0;
  const weekCovered = all.length > 0 && (all.length < 120 || oldestLoadedMs <= weekAgoMs);
  let weekOut = 0;
  let weekIn = 0;
  if (weekCovered) {
    for (const tx of all) {
      if (new Date(tx.occurred_at).getTime() < weekAgoMs) continue;
      if (reversedIds.has(tx.id)) continue;
      const amt = Math.abs(Number(tx.base_amount) || 0);
      if (OUT_TYPES.has(tx.type)) weekOut += amt;
      else if (IN_TYPES.has(tx.type)) weekIn += amt;
    }
  }
  const money = (v: number) => formatDisplay(v, baseCurrency, displayCurrency, rates);

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Tu historial</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-50">Actividad</h1>
        {weekCovered && (weekOut > 0 || weekIn > 0) && (
          <p className="mt-2 text-sm text-zinc-500">
            Últimos 7 días:{" "}
            {weekOut > 0 && (
              <span>
                salió <span className="font-semibold tabular-nums text-zinc-300">{money(weekOut)}</span>
              </span>
            )}
            {weekOut > 0 && weekIn > 0 && " · "}
            {weekIn > 0 && (
              <span>
                entró <span className="font-semibold tabular-nums text-emerald-300">{money(weekIn)}</span>
              </span>
            )}
          </p>
        )}
      </header>

      {/* Filter chips — 44px touch targets */}
      <div className="mt-4 flex gap-2">
        {FILTERS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "all" ? "/app/activity" : `/app/activity?f=${item.key}`}
            className={`kipu-press inline-flex min-h-11 items-center rounded-full px-4 text-xs font-semibold transition ${
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
            className="kipu-press mt-4 inline-block rounded-full bg-emerald-400 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          >
            Hablar con Kipu
          </Link>
        </section>
      ) : (
        <div className="kipu-stagger mt-5 space-y-5">
          {groups.map((group) => (
            <section key={group.day}>
              <div className="mb-1 flex items-center justify-between px-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
                  {group.day}
                </p>
                {group.dayTotal > 0 && (
                  <p className="text-xs font-medium tabular-nums text-zinc-600">
                    {dayTotal.label} {money(group.dayTotal)}
                  </p>
                )}
              </div>
              <div className="divide-y divide-white/5 rounded-3xl border border-white/5 bg-zinc-900 px-5">
                {group.items.map((tx) => {
                  const view = describeMovement(tx, { displayCurrency: displayCurrency as CurrencyCode | undefined, rates });
                  // Tapping a row hands it to chat pre-named — Kipu confirms
                  // any correction before touching the ledger (non-destructive).
                  // The prefill carries the LEDGER amount (base), never the
                  // cosmetic display re-expression — the agent reasons in base.
                  const ledgerAmount = formatKipuMoney(
                    Math.abs(Number(tx.base_amount) || 0),
                    tx.base_currency as CurrencyCode,
                  );
                  return (
                    <Link
                      key={tx.id}
                      href={`/app/chat?share=${encodeURIComponent(`corrige: ${view.title} ${ledgerAmount}`)}`}
                      className="kipu-press -mx-2 block rounded-xl px-2 transition hover:bg-white/[0.03]"
                    >
                      <MovementRow view={view} />
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
