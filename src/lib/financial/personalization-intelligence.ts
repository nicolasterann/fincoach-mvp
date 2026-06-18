import type { AmbitionMode } from "@/types/financial";
import { derivePersonalizationSignals, type CaptureEvent, type PersonalizationSignals } from "@/lib/financial/personalization-signals";
import { buildPersonalizationProfile, type ExplicitPreferences, type LifeContextItem, type PersonalizationProfile } from "@/lib/financial/personalization-profile";
import { derivePersonalizationDecisions, type PersonalizationDecisions } from "@/lib/financial/personalization-decisions";

// Stage 18 — PERSONALIZATION INTELLIGENCE orchestrator. One call assembles the
// inferred signals + the unified profile + the safe decisions + a compact Spanish
// DIGEST the agent reads every turn to adapt TONE / DETAIL / FRAMING / surfaces —
// "genius inside, simple outside". PURE. The digest's first rule is always DEFAULT
// BREVITY: routine confirmations stay short no matter the user's mode. The
// effectiveAmbition it exposes lets the goal allocation honor the user's life
// philosophy (joy floor) WITHOUT changing any money math or safety guardrail.

export interface PersonalizationIntelligence {
  profile: PersonalizationProfile;
  decisions: PersonalizationDecisions;
  signals: PersonalizationSignals;
  effectiveAmbition: AmbitionMode; // philosophy-derived unless user set ambition explicitly
  confidence: PersonalizationProfile["confidence"];
  digest: string;
}

export function emptyPersonalizationIntelligence(): PersonalizationIntelligence {
  const signals = derivePersonalizationSignals({ captureEvents: [], nowMs: 0 });
  const profile = buildPersonalizationProfile({ explicit: {}, signals, lifeContext: [] });
  const decisions = derivePersonalizationDecisions(profile);
  return {
    profile,
    decisions,
    signals,
    effectiveAmbition: "steady",
    confidence: "low",
    digest: "PERSONALIZACIÓN: aún sin datos para personalizar; trata al usuario con tono calmo y respuestas simples por defecto, sin asumir su filosofía ni su estilo.",
  };
}

export function buildPersonalizationIntelligence(input: {
  explicit: ExplicitPreferences;
  lifeContext: LifeContextItem[];
  captureEvents: CaptureEvent[];
  nudgeEngagement?: { sent: number; replied: number };
  correctionCount?: number;
  hasHighDebtPressure?: boolean;
  hasActiveGoals?: boolean;
  hasInvestments?: boolean;
  nowMs: number;
}): PersonalizationIntelligence {
  const signals = derivePersonalizationSignals({ captureEvents: input.captureEvents, nudgeEngagement: input.nudgeEngagement, correctionCount: input.correctionCount, nowMs: input.nowMs });
  const profile = buildPersonalizationProfile({
    explicit: input.explicit,
    signals,
    lifeContext: input.lifeContext,
    hasHighDebtPressure: input.hasHighDebtPressure,
    hasActiveGoals: input.hasActiveGoals,
    hasInvestments: input.hasInvestments,
  });
  const decisions = derivePersonalizationDecisions(profile, input.explicit.ambitionMode ?? null);
  const digest = buildPersonalizationDigest(profile, decisions);
  return { profile, decisions, signals, effectiveAmbition: decisions.effectiveAmbition, confidence: profile.confidence, digest };
}

function buildPersonalizationDigest(p: PersonalizationProfile, d: PersonalizationDecisions): string {
  const lines: string[] = [];

  // The invariant, stated first and unconditionally.
  lines.push(
    "REGLA DE ORO (no negociable): por DEFECTO sé SIMPLE y BREVE, sobre todo tras acciones rutinarias (registrar gasto, confirmar pago, subir recibo). La personalización cambia el TONO, el ENCUADRE y qué se ofrece/promueve — NUNCA alarga las respuestas por defecto ni convierte una confirmación en un reporte. El detalle se da cuando el usuario lo pide o en el dashboard, no a la fuerza.",
  );

  // The core lever: life philosophy → framing.
  if (p.financialPhilosophy === "experiences") {
    lines.push("FILOSOFÍA DEL USUARIO: vive por experiencias y disfrutar su dinero. NO lo presiones a ahorrar, recortar o sacrificar gustos; celebra que disfrute, ayúdalo a hacerlo SIN endeudarse ni romper sus pagos. Las metas/ahorro son opcionales y livianas, no un deber.");
  } else if (p.financialPhilosophy === "wealth") {
    lines.push("FILOSOFÍA DEL USUARIO: construir patrimonio. Empuja sus metas y su ahorro/inversión, sé MENOS permisivo con lo discrecional y resáltale el costo de oportunidad cuando aplique. Pero NUNCA cambies la verdad financiera ni la seguridad, ni lo hagas sentir mal.");
  } else if (p.financialPhilosophy === "builder") {
    lines.push("FILOSOFÍA DEL USUARIO: alcanzar objetivos concretos. Prioriza el avance de sus metas con equilibrio; empuja con tacto, sin quitarle del todo los gustos.");
  } else if (p.financialPhilosophy === "balanced") {
    lines.push("FILOSOFÍA DEL USUARIO: equilibrio entre disfrutar hoy y construir a futuro. Mantén balance entre gustos y metas, sin empujar de más a ningún lado.");
  } else {
    lines.push("FILOSOFÍA DEL USUARIO: aún no declarada. No la asumas; si surge naturalmente, puedes preguntar UNA vez si prefiere disfrutar más su dinero o construir patrimonio, sin etiquetarlo.");
  }

  // Tone + detail (available, not forced).
  lines.push(`ESTILO: tono ${d.responseStyle.tone}, nivel de detalle preferido "${d.responseStyle.detail}" (aplica al profundizar/insistir, no a la longitud por defecto). Modo de usuario: ${p.userMode}.`);

  // Risk framing.
  if (p.riskPosture === "cautious") lines.push("POSTURA DE RIESGO: cauteloso — encuadra con más colchón y prudencia, refuerza el fondo de emergencia.");
  else if (p.riskPosture === "growth") lines.push("POSTURA DE RIESGO: orientado a crecimiento — puede tolerar planes más ambiciosos; sigue etiquetando estimaciones y sin consejo de activos específicos.");

  // Life context (only if explicitly provided).
  if (p.lifeContext.length) lines.push(`CONTEXTO DE VIDA (declarado por el usuario, úsalo solo si es relevante, sin sobre-interpretar): ${p.lifeContext.map((c) => c.label).join(", ")}.`);

  // Surfaces / capture (for proactive moments, not verbosity).
  if (d.captureSuggestion) lines.push(`CAPTURA: si está vacío o pregunta cómo registrar, sugiere lo más fácil para él: ${d.captureSuggestion}.`);

  // Transparency + privacy.
  lines.push(`TRANSPARENCIA: si pregunta por qué respondes así, por qué cambió el tono o el dashboard, explícalo simple desde sus preferencias (confianza ${p.confidence}); puede cambiarlas o reiniciarlas cuando quiera.`);
  lines.push("PRIVACIDAD: NO infieras rasgos sensibles, emociones ni personalidad con certeza; no expongas etiquetas internas; no manipules ni hagas sentir culpa. La personalización es opcional y respetuosa, y NUNCA cambia los mínimos de deuda/tarjeta, el cashflow ni el Margen Kipu.");

  return ["PERSONALIZACIÓN (genio adentro, simple afuera):", ...lines].join("\n");
}
