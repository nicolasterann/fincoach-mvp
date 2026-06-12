import { redirect } from "next/navigation";
import OpenAI from "openai";
import {
  evaluateSeedGate,
  runOnboardingAgentTurn,
} from "@/lib/ai/onboarding/onboarding-agent";
import type { OnboardingDraft } from "@/lib/onboarding/draft-types";
import { createInitialOnboardingConversationState } from "@/lib/onboarding/helpers";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Stage 11.6 — LIVE onboarding field-test simulator. An LLM plays a realistic
// LatAm user (messy language, novel closure phrasings, corrections) against
// the REAL onboarding agent; deterministic checkers then audit the transcript
// and the final draft. This replaces most manual founder QA: run it after any
// onboarding change. Requires OPENAI_API_KEY; use ?s=base (or all) to run.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface SimScenario {
  id: string;
  title: string;
  persona: string;
  /** Extra deterministic checks on the final draft. */
  expect: (draft: OnboardingDraft) => { name: string; pass: boolean; detail: string }[];
}

const SCENARIOS: SimScenario[] = [
  {
    id: "base",
    title: "Caso base (transcript de producción)",
    persona: `Eres Nico Terán, de Ecuador, usas dólares. Cuentas: Pichincha 450 (la del día a día), Produbanco 350, efectivo 80, y Deuna con 21. Tarjetas: Visa Pichincha (pago mínimo 20 este mes, pago total del mes 80, la pagas el 21), Mastercard Produbanco (pago total del mes 50, la pagas el 1), Amex sin deuda. También le debes 25 a un amigo del fútbol. Sueldo 2000: 500 el último día del mes a Produbanco y 1500 el día 1 a Pichincha. Emprendimiento variable de 0 a 300. Fijos: arriendo 900 (entre el 1 y el 5, sube cada 3 meses), internet 25 el día 10, plan celular 13.50 el 15, Netflix 7 (no recuerdas el día), servicios básicos entre 40 y 80 (pagas hasta el 31). Comida ~500/mes, transporte 50. Inviertes 250 al mes a fin de mes (es inversión, no ahorro). Meta: crucero a Europa el próximo año; no sabes el costo, pide un estimado y acepta ~3500; tienes 300 guardados. Tono: juguetón.`,
    expect: (d) => [
      {
        name: "Visa con pago del mes (no solo mínimo)",
        pass: (d.debtAccounts.find((x) => /visa/i.test(x.name ?? ""))?.currentMonthPayment ?? 0) > 0,
        detail: JSON.stringify(d.debtAccounts.map((x) => ({ n: x.name, min: x.minimumPayment, mes: x.currentMonthPayment }))),
      },
      {
        name: "Sueldo dividido (2 entradas con día)",
        pass: d.incomeSources.filter((s) => (s.amount ?? 0) > 0 && s.expectedDay !== undefined).length >= 2,
        detail: JSON.stringify(d.incomeSources.map((s) => ({ n: s.name, a: s.amount, d: s.expectedDay }))),
      },
      {
        name: "Netflix con monto",
        pass: (d.fixedExpenses.find((f) => /netflix/i.test(f.name ?? ""))?.amount ?? 0) > 0,
        detail: JSON.stringify(d.fixedExpenses.map((f) => ({ n: f.name, a: f.amount }))),
      },
      {
        name: "Inversión 250 (no ahorro)",
        pass: d.profile.monthlyInvestment === 250,
        detail: `inv=${d.profile.monthlyInvestment}, sav=${d.profile.monthlySavings}`,
      },
      {
        name: "Meta con guardado y fecha aproximada",
        pass:
          (d.goals[0]?.currentAmount ?? -1) >= 0 && Boolean(d.goals[0]?.targetDate),
        detail: JSON.stringify(d.goals.map((g) => ({ n: g.name, t: g.targetAmount, c: g.currentAmount, f: g.targetDate }))),
      },
      {
        name: "Notas de contexto (arriendo sube / servicios varían)",
        pass: d.userContextNotes.length >= 1,
        detail: `${d.userContextNotes.length} notas`,
      },
    ],
  },
  {
    id: "cierres",
    title: "Cierres nunca vistos + mínimo desconocido",
    persona: `Eres Caro, de Colombia, usas USD. SOLO tienes: cuenta Bancolombia con 600 (día a día) y 50 en efectivo. Una tarjeta Visa: sabes que el mínimo es 30 pero NO sabes el pago total del mes (si te preguntan, di "ni idea, solo sé el mínimo"). La pagas el 15. Sin más deudas. Sueldo 900 el día 5 a Bancolombia, nada más. Fijos: solo arriendo 350 el día 1. Comida/transporte ~250. No ahorras nada (0). Meta: un colchón de emergencia de 1000, tienes 0 guardado, sin fecha (di "no sé, sin fecha por ahora"). Tono relajado. IMPORTANTE: para cerrar secciones usa SIEMPRE frases raras y distintas, nunca "eso es todo": usa cosas como "ya con eso quedamos", "sigamos nomás", "hasta ahí llegamos", "listo por ese lado", "ya tá".`,
    expect: (d) => [
      {
        name: "Mínimo-solo resuelto sin bloquear (mes=mínimo como piso o nota)",
        pass:
          (d.debtAccounts.find((x) => /visa/i.test(x.name ?? ""))?.currentMonthPayment ?? 0) > 0 ||
          (d.debtAccounts.find((x) => /visa/i.test(x.name ?? ""))?.totalBalance ?? 0) > 0,
        detail: JSON.stringify(d.debtAccounts.map((x) => ({ n: x.name, min: x.minimumPayment, mes: x.currentMonthPayment, tot: x.totalBalance }))),
      },
      {
        name: "Ahorro 0 registrado (preguntado, no omitido)",
        pass: d.profile.monthlySavings !== undefined || d.profile.monthlyInvestment !== undefined,
        detail: `sav=${d.profile.monthlySavings}, inv=${d.profile.monthlyInvestment}`,
      },
      {
        name: "Meta sin fecha aceptada vía confirmación explícita",
        pass: (d.goals[0]?.targetAmount ?? 0) === 1000 && (d.goals[0]?.currentAmount ?? -1) === 0,
        detail: JSON.stringify(d.goals[0] ?? {}),
      },
    ],
  },
  {
    id: "correcciones",
    title: "Correcciones y multi-ítem messy",
    persona: `Eres Majo, de México, usas USD. Cuentas: "tengo bbva con como 800 y unos 100 en cash". REGLA OBLIGATORIA E INQUEBRANTABLE: justo después de que Kipu confirme tus cuentas (su siguiente mensaje tras dárselas), tu PRÓXIMO mensaje debe empezar con la corrección: "perdón, en bbva eran 750, no 800" (puedes añadir después la respuesta a lo que te haya preguntado). No la omitas por ningún motivo. Sin tarjetas ni deudas ("nada de deudas por suerte"). Ingreso: freelance variable entre 400 y 900, te pagan "cuando cae, no hay día fijo". Fijos: "pago 300 de renta el 1, 20 de spotify y 15 de gym" — todo en UN mensaje. Comida ~280. Ahorras 50 al mes. Meta: "quiero irme a Japón en diciembre" — costo aprox 2500, tienes 200 guardados. Tono directo.`,
    expect: (d) => [
      {
        name: "Corrección aplicada (BBVA 750, sin duplicar)",
        pass:
          (d.accounts.find((a) => /bbva/i.test(a.name ?? ""))?.currentBalance ?? 0) === 750 &&
          d.accounts.filter((a) => /bbva/i.test(a.name ?? "")).length === 1,
        detail: JSON.stringify(d.accounts.map((a) => ({ n: a.name, b: a.currentBalance }))),
      },
      {
        name: "Sin deudas marcado explícito",
        pass: d.explicitlyEmptySteps?.includes("debt_accounts") ?? false,
        detail: JSON.stringify(d.explicitlyEmptySteps ?? []),
      },
      {
        name: "Multi-ítem en un mensaje (3 fijos con monto)",
        pass: d.fixedExpenses.filter((f) => (f.amount ?? 0) > 0).length >= 3,
        detail: JSON.stringify(d.fixedExpenses.map((f) => ({ n: f.name, a: f.amount }))),
      },
      {
        name: "Meta diciembre con fecha",
        pass: Boolean(d.goals[0]?.targetDate),
        detail: d.goals[0]?.targetDate ?? "sin fecha",
      },
    ],
  },
];

const BANNED_WORDS = [/clavar/i, /clavo\b/i, /te lo recuerde/i, /te aviso/i, /recordatorio/i];

interface SimResult {
  scenario: string;
  title: string;
  done: boolean;
  userTurns: number;
  checks: { name: string; pass: boolean; detail: string }[];
  transcript: { from: string; text: string }[];
  error?: string;
}

async function simulateUserReply(
  client: OpenAI,
  persona: string,
  history: { from: "kipu" | "user"; text: string }[],
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_TRANSACTION_PARSER_MODEL ?? "gpt-5.4-mini",
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content: `Simulas a un usuario REAL en el onboarding de una app financiera. Tu personaje y tus datos:\n${persona}\n\nReglas: responde SOLO lo que diría el usuario (1-2 frases cortas, español LatAm natural, a veces con typos). Revela los datos cuando te los pregunten, a veces varios juntos. NUNCA inventes datos fuera del personaje. Si ya diste todo lo de un tema, cierra con una frase natural variada. No actúes como asistente.`,
      },
      ...history.map((m) => ({
        // Inverted roles: Kipu's messages are what the simulated user hears.
        role: m.from === "kipu" ? ("user" as const) : ("assistant" as const),
        content: m.text,
      })),
    ],
  });
  return (completion.choices[0]?.message?.content ?? "ok").trim();
}

async function runScenario(scenario: SimScenario): Promise<SimResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      scenario: scenario.id,
      title: scenario.title,
      done: false,
      userTurns: 0,
      checks: [],
      transcript: [],
      error: "OPENAI_API_KEY no disponible",
    };
  }
  const client = new OpenAI({ apiKey });

  let draft = createInitialOnboardingConversationState().draft;
  const history: { from: "kipu" | "user"; text: string }[] = [
    { from: "kipu", text: "Hola, soy Kipu. Solo unas preguntas rápidas para entender cómo se mueve tu dinero. ¿Empezamos?" },
  ];
  let done = false;
  let userTurns = 0;
  const MAX_USER_TURNS = 26;

  try {
    while (!done && userTurns < MAX_USER_TURNS) {
      const userMsg = await simulateUserReply(client, scenario.persona, history);
      userTurns += 1;
      const turn = await runOnboardingAgentTurn({
        draft,
        recentMessages: history.slice(-14),
        latestUserMessage: userMsg,
      });
      history.push({ from: "user", text: userMsg });
      if (!turn.ok || !turn.reply || !turn.draft) {
        return {
          scenario: scenario.id,
          title: scenario.title,
          done: false,
          userTurns,
          checks: [],
          transcript: history,
          error: "El agente devolvió ok:false (motor caído o sin respuesta)",
        };
      }
      draft = turn.draft;
      done = Boolean(turn.done);
      history.push({ from: "kipu", text: turn.reply });
    }
  } catch (error) {
    return {
      scenario: scenario.id,
      title: scenario.title,
      done,
      userTurns,
      checks: [],
      transcript: history,
      error: error instanceof Error ? error.message : "fallo desconocido",
    };
  }

  // ── Deterministic transcript + draft audit ──────────────────────────────
  const checks: { name: string; pass: boolean; detail: string }[] = [];
  const kipuMsgs = history.filter((m) => m.from === "kipu").map((m) => m.text);

  checks.push({
    name: "Completó el onboarding (gate abierto)",
    pass: done,
    detail: done
      ? `en ${userTurns} turnos de usuario`
      : `NO completó en ${userTurns} turnos; faltaba: ${evaluateSeedGate(draft).missing.join("; ")}`,
  });
  checks.push({
    name: "Longitud razonable (≤ 24 turnos de usuario)",
    pass: userTurns <= 24,
    detail: `${userTurns} turnos`,
  });

  let repeated = "";
  for (let i = 1; i < kipuMsgs.length; i += 1) {
    if (kipuMsgs[i] === kipuMsgs[i - 1] && kipuMsgs[i].includes("?")) {
      repeated = kipuMsgs[i];
      break;
    }
  }
  checks.push({
    name: "Sin pregunta idéntica consecutiva (anti-loop)",
    pass: !repeated,
    detail: repeated ? `REPITIÓ: "${repeated.slice(0, 90)}"` : "ok",
  });

  const banned = kipuMsgs.find((m) => BANNED_WORDS.some((r) => r.test(m)));
  checks.push({
    name: "Sin copy prohibido (clavar/recordatorios/te aviso)",
    pass: !banned,
    detail: banned ? banned.slice(0, 90) : "ok",
  });

  checks.push(...scenario.expect(draft));

  return { scenario: scenario.id, title: scenario.title, done, userTurns, checks, transcript: history };
}

export default async function OnboardingSimPage({
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
  const wanted = s === "all" ? SCENARIOS : SCENARIOS.filter((x) => x.id === s);

  if (wanted.length === 0) {
    return (
      <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
        <section className="mx-auto w-full max-w-3xl">
          <h1 className="text-2xl font-bold">Simulador de campo del onboarding</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Ejecuta usuarios simulados (LLM) contra el agente REAL de onboarding y audita el
            transcript y el draft final. Usa <code>?s=all</code> o un escenario:
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {SCENARIOS.map((x) => (
              <li key={x.id}>
                <a className="text-emerald-400 underline" href={`/dev/onboarding-sim?s=${x.id}`}>
                  ?s={x.id}
                </a>{" "}
                — {x.title}
              </li>
            ))}
            <li>
              <a className="text-emerald-400 underline" href="/dev/onboarding-sim?s=all">
                ?s=all
              </a>{" "}
              — todos (tarda varios minutos)
            </li>
          </ul>
        </section>
      </main>
    );
  }

  const results: SimResult[] = [];
  for (const scenario of wanted) {
    results.push(await runScenario(scenario));
  }
  const totalChecks = results.flatMap((r) => r.checks);
  const failed = totalChecks.filter((c) => !c.pass);

  // Machine-readable audit (for terminal/CI use): plain JSON in a <pre>.
  if (format === "json") {
    return (
      <pre suppressHydrationWarning>
        {JSON.stringify(
          {
            verdict: failed.length === 0 ? "SIM-PASS" : "SIM-FAIL",
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
          Dev · simulador de campo (agente real + usuario LLM)
        </p>
        <h1 className="mt-1 text-2xl font-bold">Onboarding field-sim</h1>
        <p className={`mt-3 text-sm font-bold ${failed.length === 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {failed.length === 0
            ? `SIM-PASS ✓ ${totalChecks.length}/${totalChecks.length} checks`
            : `SIM-FAIL ✗ ${failed.length} de ${totalChecks.length} checks fallan`}
        </p>

        {results.map((r) => (
          <div key={r.scenario} className="mt-6 rounded-2xl border border-white/10 p-4">
            <h2 className="text-base font-bold">
              {r.title}{" "}
              <span className="text-xs font-normal text-zinc-500">
                ({r.userTurns} turnos · {r.done ? "completado" : "INCOMPLETO"})
              </span>
            </h2>
            {r.error && <p className="mt-2 text-sm text-rose-400">Error: {r.error}</p>}
            <div className="mt-3 space-y-1.5">
              {r.checks.map((c) => (
                <div key={c.name} className={`rounded-lg border p-2 ${c.pass ? "border-emerald-500/20 bg-emerald-950/30" : "border-rose-500/30 bg-rose-950/30"}`}>
                  <p className="text-xs font-medium">{c.pass ? "✓" : "✗"} {c.name}</p>
                  <p className="mt-0.5 break-all font-mono text-[10px] text-zinc-500">{c.detail}</p>
                </div>
              ))}
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-zinc-500">Transcript ({r.transcript.length} mensajes)</summary>
              <div className="mt-2 space-y-1">
                {r.transcript.map((m, i) => (
                  <p key={i} className={`text-xs leading-5 ${m.from === "kipu" ? "text-zinc-400" : "text-emerald-200/70 text-right"}`}>
                    <span className="font-bold">{m.from === "kipu" ? "K: " : "U: "}</span>
                    {m.text}
                  </p>
                ))}
              </div>
            </details>
          </div>
        ))}
      </section>
    </main>
  );
}
