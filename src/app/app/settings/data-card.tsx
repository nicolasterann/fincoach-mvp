import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { formatKipuMoney } from "@/lib/financial/money";
import {
  decodeVariableFixedForecast,
  variableFixedForecastMatchesPlan,
} from "@/lib/financial/variable-fixed-store";
import type { CurrencyCode } from "@/types/financial";

// Settings — "Mis datos": a compact, read-only inventory of what Kipu knows
// (accounts, income, fixed expenses, goals) so the user can audit their own
// map at a glance. Corrections happen by chat (agent-native), not forms here.
// Reads run on the AUTHENTICATED server client, so RLS scopes every select.

const MAX_ROWS = 6;

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: "Cada semana",
  biweekly: "Cada 2 semanas",
  monthly: "Cada mes",
  yearly: "Una vez al año",
  custom: "Variable",
};

function chatHref(prompt: string) {
  return `/app/chat?share=${encodeURIComponent(prompt)}`;
}

function Group({
  title,
  rows,
  chatPrompt,
}: {
  title: string;
  rows: { name: string; value: string }[];
  chatPrompt: string;
}) {
  if (rows.length === 0) return null;
  const visible = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - visible.length;
  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">{title}</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {visible.map((r, i) => (
          <li key={`${r.name}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-zinc-400">{r.name}</span>
            <span className="shrink-0 font-semibold text-zinc-200">{r.value}</span>
          </li>
        ))}
        {hidden > 0 && <li className="text-xs text-zinc-600">+{hidden} más</li>}
      </ul>
      <Link href={chatHref(chatPrompt)} className="mt-1.5 inline-block text-[11px] font-semibold text-emerald-400">
        Corrige esto por chat →
      </Link>
    </div>
  );
}

export async function DataCard({ userId }: { userId: string }) {
  const supabase = await createSupabaseServerClient();

  const [accountsRes, incomesRes, fixedRes, fixedForecastRes, goalsRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("name, currency, current_balance_original")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("income_sources")
      .select("name, amount, currency, frequency")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    supabase
      .from("fixed_expenses")
      .select("id, name, amount, currency, frequency, is_variable")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(501),
    supabase
      .from("fixed_expense_forecasts")
      .select("fixed_expense_id, user_id, regime, declared_amount, planning_amount, currency, cadence, sample_count, confidence, method, last_cycle_date, regime_started_at, updated_at")
      .eq("user_id", userId)
      .limit(501),
    supabase
      .from("goals")
      .select("name, target_amount, currency")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
  ]);

  const money = (v: unknown, c: unknown) =>
    formatKipuMoney(Number(v) || 0, String(c || "USD") as CurrencyCode);

  const accounts = (accountsRes.data ?? []).map((a) => ({
    name: String(a.name ?? "Cuenta"),
    value: money(a.current_balance_original, a.currency),
  }));
  const incomes = (incomesRes.data ?? []).map((i) => ({
    name: String(i.name ?? "Ingreso"),
    value: `${money(i.amount, i.currency)} · ${FREQUENCY_LABEL[String(i.frequency)] ?? "Cada mes"}`,
  }));
  const fixedForecastRows = fixedForecastRes.data ?? [];
  const fixedRows = fixedRes.data ?? [];
  const decodedFixedForecasts = fixedForecastRows
    .slice(0, 500)
    .map((row) =>
      decodeVariableFixedForecast(row as Record<string, unknown>),
    );
  const fixedExpensesAvailable =
    !fixedRes.error && fixedRows.length <= 500;
  const fixedForecastsAvailable =
    !fixedForecastRes.error &&
    fixedForecastRows.length <= 500 &&
    decodedFixedForecasts.every((forecast) => forecast != null);
  const fixedForecasts = new Map(
    decodedFixedForecasts
      .filter((forecast) => forecast != null)
      .map((forecast) => [forecast.fixedExpenseId, forecast] as const),
  );
  const fixed = (fixedExpensesAvailable ? fixedRows.slice(0, 500) : []).map((f) => {
    const forecast = fixedForecasts.get(String(f.id));
    const forecastMatches =
      forecast &&
      variableFixedForecastMatchesPlan(forecast, {
        amount: Number(f.amount),
        currency: String(f.currency ?? ""),
        frequency: String(f.frequency ?? ""),
      });
    return {
      name: String(f.name ?? "Gasto fijo"),
      value:
        f.is_variable && !fixedForecastsAvailable
          ? `${money(f.amount, f.currency)} declarados · no pude cargar la estimación`
          : f.is_variable && forecast && !forecastMatches
            ? `${money(f.amount, f.currency)} declarados · no pude validar la estimación contra el plan actual`
          : f.is_variable && forecastMatches
          ? `${money(forecast.planningAmount, forecast.currency)} planificados · ${money(f.amount, f.currency)} declarados`
          : f.is_variable
            ? `${money(f.amount, f.currency)} declarados · falta la estimación durable de este plan`
            : money(f.amount, f.currency),
    };
  });
  if (!fixedExpensesAvailable) {
    fixed.push({
      name: "Gastos fijos",
      value: "No pude cargar la lista completa",
    });
  }
  const goals = (goalsRes.data ?? []).map((g) => ({
    name: String(g.name ?? "Meta"),
    value: money(g.target_amount, g.currency),
  }));

  const empty = accounts.length + incomes.length + fixed.length + goals.length === 0;

  return (
    <div className="rounded-2xl border border-line/5 bg-zinc-900 p-4">
      <p className="text-sm font-semibold text-zinc-100">Mis datos</p>
      <p className="mt-1 text-xs leading-5 text-zinc-500">
        Lo que Kipu sabe de tu plata. Cualquier cosa se corrige por chat.
      </p>

      {empty ? (
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          Aún no tengo tu mapa financiero — cuéntamelo por chat y lo armamos juntos.
        </p>
      ) : (
        <>
          <Group title="Cuentas" rows={accounts} chatPrompt="Quiero corregir una cuenta" />
          <Group title="Ingresos" rows={incomes} chatPrompt="Quiero corregir un ingreso" />
          <Group title="Gastos fijos" rows={fixed} chatPrompt="Quiero corregir un gasto fijo" />
          <Group title="Metas activas" rows={goals} chatPrompt="Quiero corregir una meta" />
        </>
      )}

      <div className="mt-4 border-t border-line/5 pt-3">
        <a
          href="/app/settings/export"
          className="text-xs font-semibold text-zinc-500 transition hover:text-zinc-300"
        >
          Descargar mis datos financieros (JSON) ↓
        </a>
        <p className="mt-1 text-[11px] leading-4 text-zinc-600">
          Incluye perfil, cuentas, ingresos, gastos fijos, deudas, metas, presupuestos,
          todos tus movimientos y pagos programados. No incluye el historial del chat.
        </p>
      </div>
    </div>
  );
}
