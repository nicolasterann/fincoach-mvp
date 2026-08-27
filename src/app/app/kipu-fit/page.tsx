import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { readPersonalityResult } from "@/lib/personality/personality-store";
import { getPersonalityQuestions, type PersonalityResult } from "@/lib/personality/personality-test";
import { mapTestToPersonalization } from "@/lib/personality/personality-mapping";
import { LivingThread } from "@/app/app/components/living/LivingThread";
import { DetailSurface, TuKipuHeader } from "../components/living/shell";

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

// The two poles of each test dimension, in the user's own words (from the test
// options). Unknown keys degrade to a humanized key, never crash.
const DIMENSION_POLES: Record<string, { left: string; right: string }> = {
  experienceWealth: { left: "Disfrutar hoy", right: "Construir patrimonio" },
  safetyGrowth: { left: "Ir sobre seguro", right: "Tomar más riesgo" },
  structureFlex: { left: "Fluir y ajustar", right: "Plan claro" },
  simpleDetail: { left: "Al grano", right: "Con detalle" },
  presentFuture: { left: "Presente", right: "Futuro" },
  soloShared: { left: "A tu manera", right: "En equipo" },
  consistencyBatch: { left: "Al toque", right: "Por tandas" },
  motivation: { left: "Con calma", right: "Con empuje" },
};

const CONFIDENCE_LABEL: Record<string, string> = { low: "baja", medium: "media", high: "alta" };

function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").toLowerCase().trim();
}

function timeAgoEs(ms: number): string | null {
  if (!ms) return null;
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 14) return `hace ${days} días`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? "hace 1 semana" : `hace ${weeks} semanas`;
  }
  const months = Math.round(days / 30);
  return months <= 1 ? "hace 1 mes" : `hace ${months} meses`;
}

// One centered-zero bar per dimension: the knot sits where the user landed
// between the two poles. Real test data, calm rendering.
function DimensionBar({ left, right, value }: { left: string; right: string; value: number }) {
  const v = Math.max(-100, Math.min(100, Number.isFinite(value) ? value : 0));
  const knotLeft = 50 + v / 2; // -100..100 → 0..100%
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[11px] font-medium">
        <span className={v <= -15 ? "text-violet-300" : "text-zinc-500"}>{left}</span>
        <span className={v >= 15 ? "text-violet-300" : "text-zinc-500"}>{right}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-line/8">
        {/* center (neutral) marker */}
        <span aria-hidden className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-line/20" />
        {/* fill from center toward the user's lean */}
        <div
          className="absolute top-0 h-full rounded-full bg-violet-400/60"
          style={
            v >= 0
              ? { left: "50%", width: `${v / 2}%` }
              : { right: "50%", width: `${-v / 2}%` }
          }
        />
        {/* the knot */}
        <span
          aria-hidden
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-400 ring-2 ring-zinc-950"
          style={{ left: `${Math.max(2, Math.min(98, knotLeft))}%`, boxShadow: "0 0 8px rgba(167,139,250,0.35)" }}
        />
      </div>
    </div>
  );
}

export default async function KipuFitPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const storedRead = await readPersonalityResult(session.user.id);
  const stored = storedRead.ok && storedRead.found ? storedRead.result : null;
  const totalQuestions = getPersonalityQuestions().length;

  return (
    <DetailSurface layer="patrimonio">
      <TuKipuHeader active="fit" title="Qué tanto te conozco" />

      {!storedRead.ok ? (
        <section className="mt-5 rounded-3xl border border-amber-400/10 bg-amber-950/10 p-6">
          <h2 className="text-base font-semibold text-zinc-100">
            No pude cargar tu Kipu Fit
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            No voy a mostrarte un perfil por defecto como si fuera el tuyo.
            Reintenta en un momento.
          </p>
        </section>
      ) : stored ? (
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
          const [archName, archDesc] = stored.archetypeLabel.split(" — ");
          const takenAgo = timeAgoEs(stored.takenAtMs);
          const dims = Object.entries(stored.dimensions).filter(([, v]) => Number.isFinite(v));

          // 2-3 concrete "this is how it changes me" examples, from the SAME
          // mapping the agent uses — never invented.
          const examples: string[] = [];
          if (map.tone === "direct") examples.push("Por eso te hablo directo y sin rodeos cuando hay que empujar.");
          else if (map.tone === "gentle") examples.push("Por eso te acompaño con calma, sin presión ni sermones.");
          if (map.detailLevel === "short") examples.push("Te respondo cortito y al grano; el detalle solo si lo pides.");
          else if (map.detailLevel === "detailed") examples.push("Te explico el porqué de cada consejo, con el detalle que te gusta.");
          else if (map.detailLevel === "balanced") examples.push("Te doy lo justo: simple por defecto, detalle cuando lo pides.");
          if (map.financialPhilosophy === "experiences") examples.push("Protejo tu espacio para disfrutar mientras avanzas — un plan sin vida no sirve.");
          else if (map.financialPhilosophy === "wealth") examples.push("Priorizo construir tu patrimonio sin descuidar tu día a día.");
          else if (map.financialPhilosophy === "builder") examples.push("Armo el plan alrededor de tus metas concretas, paso a paso.");
          else if (map.financialPhilosophy === "balanced") examples.push("Cuido el balance: ni puro ahorro ni puro gusto — las dos cosas caben.");
          if (examples.length < 3 && map.riskTolerance === "conservative") examples.push("Te propongo caminos seguros antes que apuestas.");
          const shownExamples = examples.slice(0, 3);

          return (
            <>
              <section className="mt-6 rounded-3xl border border-violet-400/20 bg-gradient-to-b from-violet-950/40 to-zinc-900 p-6">
                <div className="flex flex-col items-center text-center">
                  <LivingThread tone="violet" size={168}>
                    <div className="px-6">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-300/70">
                        Kipu está adaptado a ti
                      </p>
                      <p className="mt-1 text-lg font-black leading-6 tracking-tight text-violet-100">
                        {archName}
                      </p>
                    </div>
                  </LivingThread>
                  {archDesc && (
                    <p className="mt-3 max-w-md text-sm leading-6 text-zinc-300">{archDesc}</p>
                  )}
                  <p className="mt-2 text-xs text-zinc-500">
                    {takenAgo ? `Hiciste el test ${takenAgo}` : "Test completado"}
                    {" · "}confianza {CONFIDENCE_LABEL[stored.confidence] ?? stored.confidence}
                  </p>
                  <p className="mt-3 max-w-md text-xs leading-5 text-zinc-500">
                    Esto cambia cómo te hablo y te aconsejo — nunca tus números, tus pagos ni tu
                    Saldo. Puedes cambiarlo cuando quieras.
                  </p>
                </div>
              </section>

              {dims.length > 0 && (
                <section className="mt-4 rounded-3xl border border-line/5 bg-zinc-900 p-6">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
                    Tu mapa, según tus propias respuestas
                  </p>
                  <div className="mt-4 space-y-4">
                    {dims.map(([key, value]) => {
                      const poles = DIMENSION_POLES[key] ?? { left: humanizeKey(key), right: "" };
                      return <DimensionBar key={key} left={poles.left} right={poles.right} value={value} />;
                    })}
                  </div>
                </section>
              )}

              {shownExamples.length > 0 && (
                <section className="mt-4 rounded-3xl border border-line/5 bg-zinc-900 p-6">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
                    Cómo me adapta
                  </p>
                  <div className="mt-3 space-y-2.5">
                    {shownExamples.map((e) => (
                      <p key={e} className="flex gap-2.5 text-sm leading-6 text-zinc-300">
                        <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400/70" />
                        {e}
                      </p>
                    ))}
                  </div>
                </section>
              )}

              <section className="mt-4 rounded-3xl border border-line/5 bg-zinc-900 p-6">
                <Row label="Tu filosofía" value={PHILOSOPHY_LABEL[map.financialPhilosophy ?? "unknown"] ?? "—"} />
                {map.riskTolerance && <Row label="Frente al riesgo" value={RISK_LABEL[map.riskTolerance] ?? "—"} />}
                {map.detailLevel && <Row label="Cómo te respondo" value={DETAIL_LABEL[map.detailLevel] ?? "—"} />}
                {map.tone && <Row label="Tono" value={TONE_LABEL[map.tone] ?? "—"} />}
              </section>

              <Link
                href={`/app/chat?share=${encodeURIComponent("quiero rehacer el test de personalidad")}`}
                className="kipu-press mt-5 block rounded-2xl border border-line/10 bg-zinc-900 px-5 py-4 text-center text-sm font-semibold text-zinc-200 transition hover:border-line/20"
              >
                Rehacer el test con Kipu
              </Link>
            </>
          );
        })()
      ) : (
        <>
          <section className="mt-6 rounded-3xl border border-line/5 bg-zinc-900 p-6">
            <p className="text-base leading-7 text-zinc-300">
              Un test corto y sin rollo —{totalQuestions} situaciones de la vida real— para que me adapte mejor a ti: a tu forma de
              ver el dinero, cuánto detalle quieres y cómo te gusta que te acompañe. No es un diagnóstico ni un juicio, y cambia
              cómo te hablo, nunca tus números.
            </p>
          </section>
          <Link
            href={`/app/chat?share=${encodeURIComponent("hagamos el test de personalidad")}`}
            className="kipu-press mt-5 block rounded-2xl bg-emerald-400 px-5 py-4 text-center text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          >
            Hacer el test con Kipu (2 min) →
          </Link>
        </>
      )}
    </DetailSurface>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line/5 py-3 last:border-0">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-sm font-semibold text-zinc-200">{value}</span>
    </div>
  );
}
