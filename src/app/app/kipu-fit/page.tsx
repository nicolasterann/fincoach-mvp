import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { loadPersonalityResult } from "@/lib/personality/personality-store";
import { getPersonalityQuestions, type PersonalityResult } from "@/lib/personality/personality-test";
import { mapTestToPersonalization } from "@/lib/personality/personality-mapping";

// Stage 20 PASS 2 (Micro-stage B/H) — Kipu Fit surface. Honest, never clinical:
// shows whether Kipu is adapted to the user and how (in plain words), or invites the
// test gently. The test itself is conversational (the agent owns the 4 tools), so
// the CTA starts that conversation; this page never re-implements scoring.

const PHILOSOPHY_LABEL: Record<string, string> = {
  experiences: "Vivir y disfrutar experiencias",
  wealth: "Construir patrimonio y libertad",
  builder: "Construir hacia metas concretas",
  balanced: "Equilibrio entre disfrutar y construir",
  unknown: "Aún conociéndote",
};
const RISK_LABEL: Record<string, string> = {
  conservative: "Prefieres ir sobre seguro",
  moderate: "Equilibrado con el riesgo",
  aggressive: "Abierto a tomar más riesgo",
};
const TONE_LABEL: Record<string, string> = { direct: "Te gusta el empuje directo", gentle: "Te acompaño con calma" };
const DETAIL_LABEL: Record<string, string> = {
  short: "Cortito y al grano",
  balanced: "Balanceado",
  detailed: "Con detalle cuando lo pides",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-3 last:border-0">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-sm font-semibold text-zinc-200">{value}</span>
    </div>
  );
}

export default async function KipuFitPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const stored = await loadPersonalityResult(session.user.id);
  const totalQuestions = getPersonalityQuestions().length;

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Kipu Fit</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-50">Qué tanto te conozco</h1>
        </div>
        <Link href="/app" className="text-xs font-semibold text-zinc-500 hover:text-zinc-300">
          ← Resumen
        </Link>
      </header>

      {stored ? (
        (() => {
          const result: PersonalityResult = {
            version: stored.version,
            dimensions: stored.dimensions,
            archetype: stored.archetype,
            archetypeLabel: stored.archetypeLabel,
            confidence: stored.confidence,
            answered: totalQuestions,
            total: totalQuestions,
          };
          const map = mapTestToPersonalization(result);
          return (
            <>
              <section className="mt-6 rounded-3xl border border-emerald-400/20 bg-emerald-950/40 p-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400/80">Kipu está adaptado a ti</p>
                <p className="mt-2 text-lg font-bold leading-7 text-emerald-50">{stored.archetypeLabel}</p>
                <p className="mt-2 text-sm leading-6 text-emerald-100/70">
                  Esto cambia cómo te hablo y te aconsejo — nunca tus números, tus pagos ni tu Margen. Puedes cambiarlo cuando quieras.
                </p>
              </section>

              <section className="mt-4 rounded-3xl border border-white/5 bg-zinc-900 p-6">
                <Row label="Tu filosofía" value={PHILOSOPHY_LABEL[map.financialPhilosophy ?? "unknown"] ?? "—"} />
                {map.riskTolerance && <Row label="Frente al riesgo" value={RISK_LABEL[map.riskTolerance] ?? "—"} />}
                {map.detailLevel && <Row label="Cómo te respondo" value={DETAIL_LABEL[map.detailLevel] ?? "—"} />}
                {map.tone && <Row label="Tono" value={TONE_LABEL[map.tone] ?? "—"} />}
              </section>

              <Link
                href={`/app/chat?share=${encodeURIComponent("quiero rehacer el test de personalidad")}`}
                className="mt-5 block rounded-2xl border border-white/10 bg-zinc-900 px-5 py-4 text-center text-sm font-semibold text-zinc-200 transition hover:border-white/20"
              >
                Rehacer el test con Kipu
              </Link>
            </>
          );
        })()
      ) : (
        <>
          <section className="mt-6 rounded-3xl border border-white/5 bg-zinc-900 p-6">
            <p className="text-base leading-7 text-zinc-300">
              Un test corto y sin rollo —{totalQuestions} situaciones de la vida real— para que me adapte mejor a ti: a tu forma de
              ver el dinero, cuánto detalle quieres y cómo te gusta que te acompañe. No es un diagnóstico ni un juicio, y cambia
              cómo te hablo, nunca tus números.
            </p>
          </section>
          <Link
            href={`/app/chat?share=${encodeURIComponent("hagamos el test de personalidad")}`}
            className="mt-5 block rounded-2xl bg-emerald-400 px-5 py-4 text-center text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          >
            Hacer el test con Kipu (2 min) →
          </Link>
        </>
      )}
    </div>
  );
}
