import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { formatKipuMoney } from "@/lib/financial/money";
import type { CurrencyCode } from "@/types/financial";
import { DataSection, type SectionSpec, type FieldSpec } from "./data-editor";
import { Fragment } from "react";
import { loadActiveInstallmentPlansForDisplay, installmentProgress } from "@/lib/financial/installment-plans-store";

// S8 — "Mis datos": the onboarding tables, re-openable. View / validate / edit / delete
// everything you entered (accounts, income, fixed expenses, debts, reserves, goals,
// assets) so nothing is "written in stone". Reads run on the AUTHENTICATED client → RLS
// scopes every select; writes go through the session-guarded server actions.

export const dynamic = "force-dynamic";

const FREQ_LABEL: Record<string, string> = {
  weekly: "Cada semana",
  biweekly: "Cada 2 semanas",
  monthly: "Cada mes",
  yearly: "Una vez al año",
  custom: "Variable",
};
const FREQ_OPTIONS = [
  { value: "monthly", label: "Cada mes" },
  { value: "weekly", label: "Cada semana" },
  { value: "biweekly", label: "Cada 2 semanas" },
  { value: "yearly", label: "Una vez al año" },
];
const ACCOUNT_TYPE_OPTIONS = [
  { value: "cash", label: "Efectivo" },
  { value: "checking", label: "Cuenta corriente" },
  { value: "savings", label: "Ahorro" },
];
const CATEGORY_OPTIONS = [
  { value: "housing", label: "Vivienda" },
  { value: "utilities", label: "Servicios" },
  { value: "food", label: "Comida" },
  { value: "transport", label: "Transporte" },
  { value: "subscriptions", label: "Suscripciones" },
  { value: "health", label: "Salud" },
  { value: "other", label: "Otros" },
];

export default async function MisDatosPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; reason?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");
  const userId = session.user.id;
  const { saved, error, reason } = await searchParams;

  const [profileRes, accountsRes, incomesRes, fixedRes, debtsRes, reservesRes, goalsRes, assetsRes] = await Promise.all([
    supabase.from("profiles").select("base_currency").eq("id", userId).maybeSingle(),
    supabase.from("accounts").select("id, name, type, currency, current_balance_original").eq("user_id", userId).neq("status", "closed").order("created_at", { ascending: true }),
    supabase.from("income_sources").select("id, name, amount, currency, frequency, is_occasional").eq("user_id", userId).eq("status", "active").order("created_at", { ascending: true }),
    supabase.from("fixed_expenses").select("id, name, amount, currency, is_variable").eq("user_id", userId).eq("is_active", true).order("created_at", { ascending: true }),
    supabase.from("debt_accounts").select("id, name, type, currency, current_balance_original, minimum_payment, full_payment_due, due_day").eq("user_id", userId).neq("status", "closed").order("created_at", { ascending: true }),
    supabase.from("savings_plans").select("id, name, kind, amount_base, frequency").eq("user_id", userId).eq("status", "active").order("created_at", { ascending: true }),
    supabase.from("goals").select("id, name, target_amount, currency, target_date").eq("user_id", userId).eq("status", "active").order("created_at", { ascending: true }),
    supabase.from("investment_accounts").select("id, name, value_base, currency, liquid").eq("user_id", userId).eq("include_in_net_worth", true).order("created_at", { ascending: true }),
  ]);

  const installmentPlans = (await loadActiveInstallmentPlansForDisplay(userId)).filter(
    (pl) => installmentProgress(pl, new Date()).remaining > 0,
  );

  const base = String(profileRes.data?.base_currency ?? "USD").toUpperCase();
  const money = (v: unknown, c: unknown = base) => formatKipuMoney(Number(v) || 0, String(c || base) as CurrencyCode);
  const currencyField: FieldSpec = { name: "currency", label: "Moneda", type: "text", placeholder: base };

  const RESERVE_KIND: Record<string, string> = { savings: "Ahorro", investment: "Inversión", essentials: "Esenciales" };

  const sections: SectionSpec[] = [
    {
      entity: "account",
      anchor: "cuentas",
      title: "Cuentas",
      hint: "Tu efectivo y cuentas. Corrige un saldo o un nombre; ciérralas si ya no existen.",
      rows: (accountsRes.data ?? []).map((a) => ({
        id: String(a.id),
        title: String(a.name ?? "Cuenta"),
        subtitle: money(a.current_balance_original, a.currency),
        values: { name: String(a.name ?? ""), balance: String(a.current_balance_original ?? "") },
      })),
      editFields: [
        { name: "name", label: "Nombre", type: "text" },
        { name: "balance", label: "Saldo (en su moneda)", type: "money" },
      ],
      addFields: [
        { name: "name", label: "Nombre", type: "text", placeholder: "Banco, efectivo…" },
        { name: "type", label: "Tipo", type: "select", options: ACCOUNT_TYPE_OPTIONS },
        { name: "balance", label: "Saldo", type: "money" },
        currencyField,
      ],
      emptyText: "Aún no tienes cuentas. Agrega una o cuéntamelo por chat.",
      deleteLabel: "Cerrar cuenta",
    },
    {
      entity: "income",
      anchor: "ingresos",
      title: "Ingresos",
      hint: "Sueldos y entradas. Marca como ocasional lo que solo cae a veces (no lo sumo a tu mes).",
      rows: (incomesRes.data ?? []).map((i) => ({
        id: String(i.id),
        title: String(i.name ?? "Ingreso"),
        subtitle: `${money(i.amount, i.currency)} · ${FREQ_LABEL[String(i.frequency)] ?? "Cada mes"}${i.is_occasional ? " · ocasional" : ""}`,
        values: { name: String(i.name ?? ""), amount: String(i.amount ?? ""), frequency: String(i.frequency ?? "monthly"), isOccasional: i.is_occasional ? "true" : "" },
      })),
      editFields: [
        { name: "name", label: "Nombre", type: "text" },
        { name: "amount", label: "Monto por pago", type: "money" },
        { name: "frequency", label: "Cada cuánto", type: "select", options: FREQ_OPTIONS },
        { name: "isOccasional", label: "Es ocasional (no lo sumo al mes)", type: "toggle" },
      ],
      addFields: [
        { name: "name", label: "Nombre", type: "text", placeholder: "Sueldo, freelance…" },
        { name: "amount", label: "Monto por pago", type: "money" },
        { name: "frequency", label: "Cada cuánto", type: "select", options: FREQ_OPTIONS },
        currencyField,
        { name: "isOccasional", label: "Es ocasional (no lo sumo al mes)", type: "toggle" },
      ],
      emptyText: "Aún no tienes ingresos registrados.",
      deleteLabel: "Quitar ingreso",
    },
    {
      entity: "fixed",
      anchor: "gastos-fijos",
      title: "Gastos fijos",
      hint: "Lo que pagas cada mes (renta, servicios, suscripciones).",
      rows: (fixedRes.data ?? []).map((f) => ({
        id: String(f.id),
        title: String(f.name ?? "Gasto fijo"),
        subtitle: `${money(f.amount, f.currency)}${f.is_variable ? " · varía" : ""}`,
        values: { name: String(f.name ?? ""), amount: String(f.amount ?? ""), isVariable: f.is_variable ? "true" : "" },
      })),
      editFields: [
        { name: "name", label: "Nombre", type: "text" },
        { name: "amount", label: "Monto mensual", type: "money" },
        { name: "isVariable", label: "Varía mes a mes", type: "toggle" },
      ],
      addFields: [
        { name: "name", label: "Nombre", type: "text", placeholder: "Renta, luz…" },
        { name: "amount", label: "Monto mensual", type: "money" },
        { name: "category", label: "Categoría", type: "select", options: CATEGORY_OPTIONS },
        currencyField,
        { name: "isEssential", label: "Es esencial", type: "toggle" },
      ],
      emptyText: "Aún no tienes gastos fijos.",
      deleteLabel: "Quitar gasto",
    },
    {
      entity: "debt",
      anchor: "deudas",
      title: "Deudas y tarjetas",
      hint: "Saldo acumulado, mínimo y pago del mes. Agregar una tarjeta o préstamo nuevo se hace por chat.",
      rows: (debtsRes.data ?? []).map((d) => ({
        id: String(d.id),
        title: String(d.name ?? "Deuda"),
        subtitle: `Saldo ${money(d.current_balance_original, d.currency)}${d.full_payment_due ? ` · pago del mes ${money(d.full_payment_due, d.currency)}` : ""}`,
        values: {
          name: String(d.name ?? ""),
          balance: String(d.current_balance_original ?? ""),
          minimum: String(d.minimum_payment ?? ""),
          full: String(d.full_payment_due ?? ""),
        },
      })),
      editFields: [
        { name: "name", label: "Nombre", type: "text" },
        { name: "balance", label: "Saldo acumulado", type: "money" },
        { name: "minimum", label: "Pago mínimo", type: "money" },
        { name: "full", label: "Pago del mes (resumen)", type: "money" },
      ],
      chatAddPrompt: "Quiero agregar una tarjeta o deuda nueva",
      emptyText: "Sin deudas registradas. 🎉",
      deleteLabel: "Cerrar deuda",
    },
    {
      entity: "reserve",
      anchor: "reservas",
      title: "Reservas (ahorro / inversión)",
      hint: "Lo que apartas cada mes. Corrige el monto o la frecuencia; pausa la que ya no hagas.",
      rows: (reservesRes.data ?? []).map((r) => ({
        id: String(r.id),
        title: String(r.name ?? RESERVE_KIND[String(r.kind)] ?? "Reserva"),
        subtitle: `${money(r.amount_base)} · ${FREQ_LABEL[String(r.frequency)] ?? "Cada mes"} · ${RESERVE_KIND[String(r.kind)] ?? String(r.kind)}`,
        values: { name: String(r.name ?? ""), amount: String(r.amount_base ?? ""), frequency: String(r.frequency ?? "monthly") },
      })),
      editFields: [
        { name: "amount", label: "Monto", type: "money" },
        { name: "frequency", label: "Cada cuánto", type: "select", options: FREQ_OPTIONS },
      ],
      chatAddPrompt: "Quiero agregar una reserva de ahorro o inversión",
      emptyText: "Aún no apartas nada fijo. Puedes crear una reserva por chat.",
      deleteLabel: "Quitar reserva",
    },
    {
      entity: "goal",
      anchor: "metas",
      title: "Metas",
      hint: "Objetivos de ahorro. Ajusta el monto o la fecha.",
      rows: (goalsRes.data ?? []).map((g) => ({
        id: String(g.id),
        title: String(g.name ?? "Meta"),
        subtitle: `${money(g.target_amount, g.currency)}${g.target_date ? ` · para ${String(g.target_date)}` : ""}`,
        values: { name: String(g.name ?? ""), target: String(g.target_amount ?? ""), targetDate: g.target_date ? String(g.target_date).slice(0, 10) : "" },
      })),
      editFields: [
        { name: "name", label: "Nombre", type: "text" },
        { name: "target", label: "Monto objetivo", type: "money" },
        { name: "targetDate", label: "Fecha objetivo", type: "date" },
      ],
      chatAddPrompt: "Quiero crear una meta nueva",
      emptyText: "Aún no tienes metas. Crea una por chat.",
      deleteLabel: "Quitar meta",
    },
    {
      entity: "asset",
      anchor: "activos",
      title: "Patrimonio (activos)",
      hint: "Inversiones y bienes. Marca como disponible solo lo que cuentas como plata a la mano.",
      rows: (assetsRes.data ?? []).map((a) => ({
        id: String(a.id),
        title: String(a.name ?? "Activo"),
        subtitle: `${money(a.value_base)}${a.liquid ? " · disponible" : " · invertido"}`,
        values: { name: String(a.name ?? ""), value: String(a.value_base ?? ""), liquid: a.liquid ? "true" : "" },
      })),
      editFields: [
        { name: "name", label: "Nombre", type: "text" },
        { name: "value", label: "Valor (en tu moneda base)", type: "money" },
        { name: "liquid", label: "Lo cuento como disponible (no invertido)", type: "toggle" },
      ],
      chatAddPrompt: "Quiero agregar un activo a mi patrimonio",
      emptyText: "Aún no tienes activos registrados.",
      deleteLabel: "Quitar del patrimonio",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-zinc-50">Mis datos</h1>
        <p className="mt-1 text-sm leading-6 text-zinc-500">
          Todo lo que pusiste en el onboarding, para revisar y corregir cuando quieras. Nada queda escrito en
          piedra. Los cambios ajustan tu Saldo Kipu y tu plan al instante.
        </p>
      </header>

      {saved && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Listo, lo guardé.
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
          {reason === "fx"
            ? "Esa cuenta está en otra moneda y aún no tengo su tipo de cambio, así que no puedo pasarla a tu moneda base sin inventar. Dímelo por chat (\"el dólar está a X\") y lo guardo, luego reintenta."
            : "No pude guardar ese cambio. Reintenta o dímelo por chat."}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {sections.map((s) => (
          <Fragment key={s.entity}>
            <DataSection section={s} />
            {s.entity === "debt" && installmentPlans.length > 0 && (
              <section id="cuotas" className="scroll-mt-20 rounded-2xl border border-line/5 bg-zinc-900 p-4">
                <p className="text-sm font-semibold text-zinc-100">Cuotas activas</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Compras en cuotas sobre tus tarjetas. Su carga mensual ya baja tu recarga diaria mientras
                  duran — no tocan tu Saldo de hoy. Liquidarlas o cancelarlas se hace por chat.
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                  {installmentPlans.map((pl) => {
                    const pr = installmentProgress(pl, new Date());
                    const cardName = (debtsRes.data ?? []).find((d) => String(d.id) === pl.debtAccountId)?.name;
                    const nextDate = pr.nextDueISO
                      ? new Date(`${pr.nextDueISO}T12:00:00`).toLocaleDateString("es", { day: "numeric", month: "short" })
                      : null;
                    return (
                      <li key={pl.id} className="rounded-xl border border-line/5 bg-zinc-950/40 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="min-w-0 truncate text-sm font-medium text-zinc-100">{pl.description}</p>
                          <p className="shrink-0 text-sm font-bold tabular-nums text-zinc-200">
                            {money(pl.installmentBase)}/mes
                          </p>
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Cuota {Math.min(pr.billed + 1, pl.monthsTotal)} de {pl.monthsTotal}
                          {cardName ? ` · ${String(cardName)}` : ""}
                          {nextDate ? ` · próxima ~${nextDate}` : ""}
                          {pl.surchargeBase > 0 ? ` · interés incluido ${money(pl.surchargeBase)}` : " · sin interés"}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                <Link
                  href={`/app/chat?share=${encodeURIComponent("compré algo en cuotas")}`}
                  className="mt-3 inline-block text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  Registrar una compra en cuotas por chat →
                </Link>
              </section>
            )}
          </Fragment>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-zinc-600">
        ¿Algo raro o que no puedes editar aquí?{" "}
        <Link href="/app/chat" className="font-semibold text-emerald-400">
          Dímelo por chat
        </Link>
        .
      </p>
    </div>
  );
}
