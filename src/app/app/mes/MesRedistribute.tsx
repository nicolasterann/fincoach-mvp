"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatKipuMoney } from "@/lib/financial/money";
import { goalMonthlyEquivalent } from "@/lib/financial/tu-mes";
import type { CurrencyCode } from "@/types/financial";
import { updateGoalContributionAction, updateReservesAction } from "./actions";

// Stage 37 — redistribute "Tu mes" directly from the page. Controlled inputs with
// a LIVE "quedaría libre" preview (mirrors the engine's reserve math), one save
// for everything dirty. Over-repartir warns honestly, never blocks (founder rule).

export interface MesGoalRow {
  id: string;
  name: string;
  contributionAmount: number;
  cadence: string | null;
  currency: string;
  protected: boolean;
}

const cadenceSuffix = (cadence: string | null): string =>
  cadence === "weekly" ? "/semana" : cadence === "biweekly" ? "/quincena" : "/mes";

const sanitize = (v: string): number => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function MesRedistribute({
  base,
  savings,
  investment,
  disposable,
  foreignGoalsMonthlyBase,
  goals,
}: {
  base: CurrencyCode;
  savings: number;
  investment: number;
  disposable: number;
  /** reserva mensual (en base) de metas en OTRA moneda — constante al editar */
  foreignGoalsMonthlyBase: number;
  goals: MesGoalRow[];
}) {
  const formatMoney = (n: number) => formatKipuMoney(n, base);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savingsStr, setSavingsStr] = useState(String(savings));
  const [investmentStr, setInvestmentStr] = useState(String(investment));
  const [goalStrs, setGoalStrs] = useState<Record<string, string>>(
    () => Object.fromEntries(goals.map((g) => [g.id, String(g.contributionAmount)])),
  );

  const baseGoalsMonthly = useMemo(
    () =>
      goals
        .filter((g) => g.protected && g.currency.toUpperCase() === base.toUpperCase())
        .reduce((sum, g) => sum + goalMonthlyEquivalent(sanitize(goalStrs[g.id] ?? "0"), g.cadence), 0),
    [goals, goalStrs, base],
  );
  const freePreview = disposable - sanitize(savingsStr) - sanitize(investmentStr) - baseGoalsMonthly - foreignGoalsMonthlyBase;

  const dirty =
    sanitize(savingsStr) !== savings ||
    sanitize(investmentStr) !== investment ||
    goals.some((g) => sanitize(goalStrs[g.id] ?? "0") !== g.contributionAmount);

  const save = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      if (sanitize(savingsStr) !== savings || sanitize(investmentStr) !== investment) {
        const fd = new FormData();
        fd.set("savings", String(sanitize(savingsStr)));
        fd.set("investment", String(sanitize(investmentStr)));
        const res = await updateReservesAction(fd);
        if (!res.ok) {
          setError(res.message ?? "No pude guardar.");
          return;
        }
      }
      for (const g of goals) {
        const next = sanitize(goalStrs[g.id] ?? "0");
        if (next !== g.contributionAmount) {
          const fd = new FormData();
          fd.set("goal_id", g.id);
          fd.set("amount", String(next));
          const res = await updateGoalContributionAction(fd);
          if (!res.ok) {
            setError(`${g.name}: ${res.message ?? "no pude guardar."}`);
            return;
          }
        }
      }
      setSaved(true);
      router.refresh();
    });
  };

  const inputClass =
    "w-28 rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-right text-sm font-semibold text-zinc-100 tabular-nums outline-none transition focus:border-emerald-400/50";

  return (
    <div>
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-zinc-300">Ahorro mensual</span>
          <span className="flex items-center gap-2 text-xs text-zinc-500">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={savingsStr}
              onChange={(e) => setSavingsStr(e.target.value)}
              className={inputClass}
              aria-label="Ahorro mensual"
            />
            {base}/mes
          </span>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-zinc-300">Inversión mensual</span>
          <span className="flex items-center gap-2 text-xs text-zinc-500">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={investmentStr}
              onChange={(e) => setInvestmentStr(e.target.value)}
              className={inputClass}
              aria-label="Inversión mensual"
            />
            {base}/mes
          </span>
        </label>
        {goals.map((g) => (
          <label key={g.id} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-zinc-300">
              Meta · {g.name}
              {!g.protected && <span className="ml-1 text-xs text-zinc-600">(no reservado)</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={goalStrs[g.id] ?? "0"}
                onChange={(e) => setGoalStrs((s) => ({ ...s, [g.id]: e.target.value }))}
                className={inputClass}
                aria-label={`Aporte a ${g.name}`}
              />
              {g.currency}
              {cadenceSuffix(g.cadence)}
            </span>
          </label>
        ))}
      </div>

      <div
        className={`mt-4 rounded-2xl border p-3 text-sm ${
          freePreview < -0.005
            ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
            : "border-emerald-400/20 bg-emerald-500/5 text-emerald-200"
        }`}
      >
        {freePreview < -0.005 ? (
          <>
            Así repartes <span className="font-bold">{formatMoney(Math.abs(freePreview))}</span> más de lo
            que tu mes rinde. Puedes guardarlo igual, pero algo va a apretar.
          </>
        ) : (
          <>
            Quedaría libre <span className="font-bold">{formatMoney(freePreview)}</span>/mes sin asignar.
          </>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {saved && !dirty && !error && <p className="mt-2 text-xs text-emerald-300">Guardado — tu mes ya refleja el nuevo reparto.</p>}

      <button
        type="button"
        onClick={save}
        disabled={!dirty || isPending}
        className="kipu-press mt-4 w-full rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
      >
        {isPending ? "Guardando…" : "Guardar reparto"}
      </button>
      <p className="mt-2 text-center text-xs text-zinc-600">
        También puedes decirle a Kipu: “desde el próximo mes bajo mi inversión a 500”.
      </p>
    </div>
  );
}
