"use client";

import { useActionState } from "react";
import { testCoachResponseAction, type CoachResponseTestState } from "./actions";

const initialState: CoachResponseTestState = {
  mode: "fallback",
  tone: "playful",
  scenario: "expense_created",
};

export default function CoachResponseTestPage() {
  const [state, formAction, pending] = useActionState(
    testCoachResponseAction,
    initialState,
  );

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-5">
          <p className="text-sm font-medium text-emerald-300">FinCoach dev</p>
          <h1 className="mt-2 text-3xl font-bold">Coach Response Test</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Esta página prueba respuestas del coach sin aplicar transacciones,
            sin tocar saldos y sin reemplazar Telegram producción.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-5 text-zinc-950">
          <form action={formAction} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-zinc-700">Modo</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={state.mode}
                name="mode"
              >
                <option value="fallback">fallback</option>
                <option value="ai">ai</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-zinc-700">Tono</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={state.tone}
                name="tone"
              >
                <option value="clear">clear</option>
                <option value="coach_like">coach_like</option>
                <option value="playful">playful</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-zinc-700">Escenario</span>
              <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={state.scenario}
                name="scenario"
              >
                <option value="expense_created">expense_created</option>
                <option value="income_created">income_created</option>
                <option value="goal_contribution_created">
                  goal_contribution_created
                </option>
                <option value="debt_payment_created">debt_payment_created</option>
              </select>
            </label>

            <button
              className="rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-black text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              type="submit"
            >
              {pending ? "Generando..." : "Probar respuesta"}
            </button>
          </form>
        </section>

        {state.error ? (
          <section className="rounded-3xl border border-red-400/30 bg-red-400/10 p-5">
            <p className="text-sm font-bold text-red-200">Error</p>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm text-red-50">
              {state.error}
            </pre>
          </section>
        ) : null}

        {state.result ? (
          <section className="rounded-3xl bg-white p-5 text-zinc-950">
            <div className="grid gap-3 sm:grid-cols-3">
              <ResultPill label="Source" value={state.result.source} />
              <ResultPill
                label="Confidence"
                value={state.result.confidenceScore.toFixed(2)}
              />
              <ResultPill label="Mode" value={state.mode} />
            </div>

            <div className="mt-4 rounded-2xl bg-emerald-50 p-4">
              <p className="text-sm font-bold text-emerald-950">Respuesta final</p>
              <p className="mt-2 text-lg font-semibold leading-7 text-emerald-950">
                {state.result.message}
              </p>
            </div>

            {state.fallbackResult ? (
              <div className="mt-4 rounded-2xl bg-zinc-100 p-4">
                <p className="text-sm font-bold">Fallback reference</p>
                <p className="mt-2 text-sm leading-6 text-zinc-700">
                  {state.fallbackResult.message}
                </p>
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl bg-zinc-100 p-4">
              <p className="text-sm font-bold">Result JSON</p>
              <pre className="mt-2 overflow-x-auto text-xs leading-5">
                {JSON.stringify(state.result, null, 2)}
              </pre>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function ResultPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-zinc-100 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-1 break-words text-lg font-black text-zinc-950">{value}</p>
    </div>
  );
}
