"use client";

import { useActionState } from "react";
import { testAiParserAction, type AiParserTestState } from "./actions";

const initialState: AiParserTestState = {
  message: "",
  mode: "basic",
};

const sampleMessages = [
  "café 1",
  "me pagaron 50 a pichincha",
  "aporté 20 a brasil desde pichincha",
  "pagué 10 de visa desde pichincha",
  "transferí 5 de pichincha a efectivo",
  "hola cómo voy esta semana",
];

export default function AiParserTestPage() {
  const [state, formAction, pending] = useActionState(testAiParserAction, initialState);

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-5">
          <p className="text-sm font-medium text-emerald-300">FinCoach dev</p>
          <h1 className="mt-2 text-3xl font-bold">AI Parser Test</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Esta página prueba el parser sin aplicar transacciones ni modificar saldos.
            Úsala para comparar basic, ai y ai_with_basic_fallback.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-5 text-zinc-950">
          <form action={formAction} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-zinc-700">Mensaje</span>
              <textarea
                className="min-h-28 rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={state.message}
                name="message"
                placeholder="Ej: café 1"
                required
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-zinc-700">Modo</span>
           <select
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue={state.mode}
                name="mode"
              >
                <option value="basic">basic</option>
                <option value="ai">ai</option>
                <option value="ai_with_basic_fallback">ai_with_basic_fallback</option>
              </select>
            </label>

            <button
              className="rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-black text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              type="submit"
            >
              {pending ? "Probando..." : "Probar parser"}
            </button>
          </form>

          <div className="mt-5 rounded-2xl bg-zinc-100 p-4">
            <p className="text-sm font-bold text-zinc-950">Mensajes de prueba</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600">
              {sampleMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
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
              <ResultPill label="Status" value={state.result.status} />
              <ResultPill label="Source" value={state.result.source} />
              <ResultPill
                label="Confidence"
                value={state.result.confidenceScore.toFixed(2)}
              />
            </div>

            {state.result.clarificationQuestion ? (
              <div className="mt-4 rounded-2xl bg-amber-100 p-4 text-sm text-amber-900">
                <p className="font-bold">Clarification question</p>
                <p className="mt-1">{state.result.clarificationQuestion}</p>
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl bg-zinc-100 p-4">
              <p className="text-sm font-bold">Parser result JSON</p>
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
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 break-words text-lg font-black text-zinc-950">{value}</p>
    </div>
  );
}
