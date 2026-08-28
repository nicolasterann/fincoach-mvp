import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDisplay } from "@/lib/financial/display-money";
import { formatKipuMoney } from "@/lib/financial/money";
import { loadCurrentFxRatesForDisplay } from "@/lib/fx/fx-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { MovementRow } from "../components/MovementRow";
import { describeMovement, formatDayLabel } from "../components/app-dashboard-helpers";
import type { CurrencyCode } from "@/types/financial";
import {
  ACTIVITY_FILTERS,
  activityLedgerAmount,
  buildActivityDetail,
  type ActivityFilter,
  type ActivityTransaction,
} from "@/lib/financial/activity-detail";
import { DetailSurface, MetricShell } from "../components/living/shell";

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
  const filter: ActivityFilter = f === "out" || f === "in" ? f : "all";

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
    loadCurrentFxRatesForDisplay(session.user.id),
  ]);

  const all = (data ?? []) as ActivityTransaction[];
  const baseCurrency = ((profileRow?.base_currency as string | null | undefined) ?? "USD") as CurrencyCode;
  const displayCurrency = (profileRow?.display_currency as string | null | undefined) ?? undefined; // undefined => native no-op

  const detail = buildActivityDetail({
    rows: all,
    filter,
    formatDay: formatDayLabel,
  });
  const money = (v: number) => formatDisplay(v, baseCurrency, displayCurrency, rates);

  return (
    <DetailSurface layer="saldo">
      <MetricShell kicker="Tu historial" title="Actividad">
        {detail.weekCovered && (detail.weekOut > 0 || detail.weekIn > 0) && (
          <p className="mt-2 text-sm text-zinc-500">
            Últimos 7 días:{" "}
            {detail.weekOut > 0 && (
              <span>
                salió <span className="font-semibold tabular-nums text-zinc-300">{money(detail.weekOut)}</span>
              </span>
            )}
            {detail.weekOut > 0 && detail.weekIn > 0 && " · "}
            {detail.weekIn > 0 && (
              <span>
                entró <span className="font-semibold tabular-nums text-emerald-300">{money(detail.weekIn)}</span>
              </span>
            )}
          </p>
        )}
      </MetricShell>

      {/* Filter chips — 44px touch targets */}
      <div className="mt-4 flex gap-2">
        {ACTIVITY_FILTERS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "all" ? "/app/activity" : `/app/activity?f=${item.key}`}
            className={`kipu-press inline-flex min-h-11 items-center rounded-full px-4 text-xs font-semibold transition ${
              filter === item.key
                ? "bg-emerald-400 text-zinc-950"
                : "border border-line/10 text-zinc-400 hover:bg-line/5"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {detail.transactions.length === 0 ? (
        <section className="mt-5 rounded-3xl border border-line/5 bg-zinc-900 p-6 text-center">
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
          {detail.groups.map((group) => (
            <section key={group.day}>
              <div className="mb-1 flex items-center justify-between px-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
                  {group.day}
                </p>
                {group.dayTotal > 0 && (
                  <p className="text-xs font-medium tabular-nums text-zinc-600">
                    {detail.dayTotalLabel} {money(group.dayTotal)}
                  </p>
                )}
              </div>
              <div className="divide-y divide-line/5 rounded-3xl border border-line/5 bg-zinc-900 px-5">
                {group.items.map((tx) => {
                  const view = describeMovement(tx, { displayCurrency: displayCurrency as CurrencyCode | undefined, rates });
                  // Tapping a row hands it to chat pre-named — Kipu confirms
                  // any correction before touching the ledger (non-destructive).
                  // The prefill carries the LEDGER amount (base), never the
                  // cosmetic display re-expression — the agent reasons in base.
                  const ledgerAmount = formatKipuMoney(
                    activityLedgerAmount(tx),
                    tx.base_currency as CurrencyCode,
                  );
                  return (
                    <Link
                      key={tx.id}
                      href={`/app/chat?share=${encodeURIComponent(`corrige: ${view.title} ${ledgerAmount}`)}`}
                      className="kipu-press -mx-2 block rounded-xl px-2 transition hover:bg-line/[0.03]"
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
    </DetailSurface>
  );
}
