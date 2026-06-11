"use client";

import { useState } from "react";
import type { OnboardingDraft } from "@/lib/onboarding/draft-types";
import type {
  DebtAmountKind,
  DebtQuickFormRow,
} from "@/lib/onboarding/onboarding-guards";

// Structured escape hatch for the debt step (Stage 11.2 hybrid onboarding).
// Cards/debts are a matrix (which card × how much × what kind × what day) —
// exactly where freeform chat is weakest. Here each row binds amount, meaning
// and due day to ONE debt with zero ambiguity, applied as a deterministic
// patch. Chat stays the spine; this is the shortcut where structure wins.

interface RowState {
  draftId?: string;
  name: string;
  hasDebt: boolean;
  amount: string;
  kind: DebtAmountKind;
  dueDay: string;
}

function rowsFromDraft(debts: OnboardingDraft["debtAccounts"]): RowState[] {
  return debts
    .filter((d) => (d.name ?? "").trim())
    .map((d) => {
      const amount =
        d.totalBalance ?? d.currentMonthPayment ?? d.minimumPayment;
      const kind: DebtAmountKind =
        d.totalBalance !== undefined
          ? "total"
          : d.currentMonthPayment !== undefined
            ? "month"
            : "minimum";
      return {
        draftId: d.draftId,
        name: d.name ?? "",
        hasDebt: (amount ?? 0) > 0,
        amount: amount && amount > 0 ? String(amount) : "",
        kind,
        dueDay: d.dueDay ? String(d.dueDay) : "",
      };
    });
}

const EMPTY_ROW: RowState = {
  name: "",
  hasDebt: true,
  amount: "",
  kind: "total",
  dueDay: "",
};

export function DebtQuickForm({
  debts,
  currency,
  onApply,
  onNoDebts,
}: {
  debts: OnboardingDraft["debtAccounts"];
  currency: string;
  onApply: (rows: DebtQuickFormRow[]) => void;
  onNoDebts: () => void;
}) {
  const [rows, setRows] = useState<RowState[]>(() => {
    const fromDraft = rowsFromDraft(debts);
    return fromDraft.length > 0 ? fromDraft : [{ ...EMPTY_ROW }];
  });

  const update = (index: number, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const handleApply = () => {
    const parsed: DebtQuickFormRow[] = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        draftId: r.draftId,
        name: r.name,
        hasDebt: r.hasDebt,
        amount: r.amount ? Number(r.amount) : undefined,
        kind: r.kind,
        dueDay: r.dueDay ? Number(r.dueDay) : undefined,
      }));
    if (parsed.length > 0) onApply(parsed);
  };

  const hasAnyName = rows.some((r) => r.name.trim());

  return (
    <details
      className="group rounded-2xl border border-zinc-800 bg-zinc-900/40"
      open={debts.length > 0}
    >
      <summary className="flex cursor-pointer select-none list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-xs font-medium text-zinc-400">
          ¿Prefieres llenar tus tarjetas directo? Sin chat, sin vueltas
        </span>
        <span className="text-zinc-600 transition group-open:rotate-180">▾</span>
      </summary>

      <div className="space-y-3 border-t border-zinc-800 px-4 py-4">
        {rows.map((row, i) => (
          <div key={row.draftId ?? `new-${i}`} className="rounded-xl bg-zinc-950/60 p-3">
            <div className="flex items-center gap-2">
              <input
                className="kipu-input min-w-0 flex-1 rounded-lg border border-zinc-800 bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Nombre (ej. Visa Pichincha)"
                value={row.name}
              />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-500">
                <input
                  checked={!row.hasDebt}
                  className="h-3.5 w-3.5 accent-emerald-400"
                  onChange={(e) => update(i, { hasDebt: !e.target.checked })}
                  type="checkbox"
                />
                Sin deuda
              </label>
            </div>
            {row.hasDebt && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  className="kipu-input w-24 rounded-lg border border-zinc-800 bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                  inputMode="decimal"
                  min="0"
                  onChange={(e) => update(i, { amount: e.target.value })}
                  placeholder={`Monto ${currency === "USD" ? "$" : currency}`}
                  type="number"
                  value={row.amount}
                />
                <select
                  className="kipu-select rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 outline-none focus:border-emerald-400/40"
                  onChange={(e) => update(i, { kind: e.target.value as DebtAmountKind })}
                  value={row.kind}
                >
                  <option value="total">es lo que debo en total</option>
                  <option value="month">es el pago de este mes</option>
                  <option value="minimum">es el pago mínimo</option>
                </select>
                <input
                  className="kipu-input w-28 rounded-lg border border-zinc-800 bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                  inputMode="numeric"
                  max="31"
                  min="1"
                  onChange={(e) => update(i, { dueDay: e.target.value })}
                  placeholder="Día de pago"
                  type="number"
                  value={row.dueDay}
                />
              </div>
            )}
          </div>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            className="text-xs font-medium text-zinc-500 transition hover:text-zinc-300"
            onClick={() => setRows((prev) => [...prev, { ...EMPTY_ROW }])}
            type="button"
          >
            + Añadir otra tarjeta o deuda
          </button>
          <div className="flex items-center gap-2">
            {debts.length === 0 && (
              <button
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/5"
                onClick={onNoDebts}
                type="button"
              >
                No tengo deudas
              </button>
            )}
            <button
              className="rounded-lg bg-emerald-400 px-4 py-2 text-xs font-bold text-zinc-950 transition hover:bg-emerald-300 disabled:opacity-40"
              disabled={!hasAnyName}
              onClick={handleApply}
              type="button"
            >
              Guardar tarjetas
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}
