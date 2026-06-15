import { redirect } from "next/navigation";
import {
  SIM_SCENARIOS,
  type SimResult,
} from "@/lib/capture/capture-field-sim";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Stage 12 — LIVE capture field-test simulator (see capture-field-sim.ts for
// the scenarios; scripts/capture-sim.ts runs the same checks from terminal).
// NO movement is ever written. Requires OPENAI_API_KEY; ?s=all (or one
// scenario id) to run, ?format=json for machine-readable output.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function CaptureSimPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; format?: string }>;
}) {
  // Cost-safety gate: this page invokes LIVE models. Never reachable without
  // an authenticated session (same pattern as the other /dev tools).
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect("/login");
  }

  const { s, format } = await searchParams;
  const wanted = s === "all" ? SIM_SCENARIOS : SIM_SCENARIOS.filter((x) => x.id === s);

  if (wanted.length === 0) {
    return (
      <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
        <section className="mx-auto w-full max-w-3xl">
          <h1 className="text-2xl font-bold">Simulador de campo de captura</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Ejercita los caminos REALES de captura (extracción, voz, idempotencia,
            matcher) con evidencia sintética, sin escribir movimientos. Usa{" "}
            <code>?s=all</code> o un escenario:
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {SIM_SCENARIOS.map((x) => (
              <li key={x.id}>
                <a className="text-emerald-400 underline" href={`/dev/capture-sim?s=${x.id}`}>
                  ?s={x.id}
                </a>{" "}
                — {x.cost}
              </li>
            ))}
            <li>
              <a className="text-emerald-400 underline" href="/dev/capture-sim?s=all">
                ?s=all
              </a>{" "}
              — todos
            </li>
          </ul>
        </section>
      </main>
    );
  }

  const results: SimResult[] = [];
  for (const scenario of wanted) {
    try {
      results.push(await scenario.run(session.user.id));
    } catch (error) {
      results.push({
        scenario: scenario.id,
        title: scenario.id,
        checks: [],
        error: error instanceof Error ? error.message : "fallo inesperado",
      });
    }
  }
  const totalChecks = results.flatMap((r) => r.checks);
  const failed = totalChecks.filter((c) => !c.pass);
  const errored = results.filter((r) => r.error);

  if (format === "json") {
    return (
      <pre suppressHydrationWarning>
        {JSON.stringify(
          {
            verdict: failed.length === 0 && errored.length === 0 ? "SIM-PASS" : "SIM-FAIL",
            failed: failed.length,
            total: totalChecks.length,
            results,
          },
          null,
          2,
        )}
      </pre>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
      <section className="mx-auto w-full max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
          Dev · simulador de campo (captura universal)
        </p>
        <h1 className="mt-1 text-2xl font-bold">Capture field-sim</h1>
        <p
          className={`mt-3 text-sm font-bold ${failed.length === 0 && errored.length === 0 ? "text-emerald-400" : "text-rose-400"}`}
        >
          {failed.length === 0 && errored.length === 0
            ? `SIM-PASS ✓ ${totalChecks.length}/${totalChecks.length} checks`
            : `SIM-FAIL ✗ ${failed.length} checks fallan, ${errored.length} escenarios con error`}
        </p>

        {results.map((r) => (
          <div key={r.scenario} className="mt-6 rounded-2xl border border-white/10 p-4">
            <h2 className="text-base font-bold">{r.title}</h2>
            {r.error && <p className="mt-2 text-sm text-rose-400">Error: {r.error}</p>}
            <div className="mt-3 space-y-1.5">
              {r.checks.map((c) => (
                <div
                  key={c.name}
                  className={`rounded-lg border p-2 ${c.pass ? "border-emerald-500/20 bg-emerald-950/30" : "border-rose-500/30 bg-rose-950/30"}`}
                >
                  <p className="text-xs font-medium">
                    {c.pass ? "✓" : "✗"} {c.name}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-[10px] text-zinc-500">{c.detail}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
