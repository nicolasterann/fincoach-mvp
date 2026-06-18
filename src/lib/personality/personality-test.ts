// Stage 20 (micro-stage C) — KIPU PERSONALITY / LIFE-PHILOSOPHY TEST. PURE.
// A lightweight, situational, lifestyle-framed test (NOT a boring financial
// questionnaire) so Kipu can adapt better. It is honest (presented as "para
// adaptarme a ti", never manipulative), never diagnoses personality, never infers
// sensitive attributes, never exposes creepy internal labels. The RESULT feeds
// Stage 18 personalization (philosophy / risk / ambition / detail / nudges) — real
// product behavior, not a decorative badge. Versioned, retake-able, forgettable.

export const PERSONALITY_TEST_VERSION = 2;

// Bipolar dimensions, each scored in [-100, +100]: negative = first pole, positive
// = second pole. Magnitude = strength; near 0 = balanced / undeclared.
export type Dimension =
  | "experienceWealth"   // − vivir experiencias        | + construir patrimonio
  | "safetyGrowth"       // − seguridad/colchón          | + crecimiento/riesgo
  | "structureFlex"      // − plan flexible              | + plan estructurado
  | "simpleDetail"       // − simple                     | + detalle/control
  | "presentFuture"      // − disfrutar hoy              | + construir a futuro
  | "soloShared"         // − maneja solo                | + planea en pareja/grupo
  | "consistencyBatch"   // − registra al día            | + registra por tandas
  | "motivation";        // − acompañamiento suave        | + empuje directo

const DIMENSIONS: Dimension[] = ["experienceWealth", "safetyGrowth", "structureFlex", "simpleDetail", "presentFuture", "soloShared", "consistencyBatch", "motivation"];

export interface TestOption { id: string; label: string; deltas: Partial<Record<Dimension, number>> }
export interface TestQuestion { id: string; prompt: string; options: TestOption[] }
export interface TestAnswer { questionId: string; optionId: string }

// The bank: situational/lifestyle prompts. Each option nudges 1+ dimensions by
// small deltas (−2..+2); scoring normalizes per dimension by its max possible.
export const PERSONALITY_QUESTIONS: TestQuestion[] = [
  {
    id: "weekend",
    prompt: "Te cae un bono inesperado un viernes. ¿Qué te nace hacer?",
    options: [
      { id: "trip", label: "Armar un plan o viaje y disfrutarlo ya", deltas: { experienceWealth: -2, presentFuture: -2 } },
      { id: "save", label: "Guardarlo o invertirlo casi todo", deltas: { experienceWealth: 2, presentFuture: 2, safetyGrowth: 1 } },
      { id: "mix", label: "Una parte para mí, otra la guardo", deltas: { experienceWealth: 0, presentFuture: 0 } },
    ],
  },
  {
    id: "philosophy",
    prompt: "¿Con cuál te identificas más?",
    options: [
      { id: "exp", label: "El dinero es para vivir y disfrutar la vida", deltas: { experienceWealth: -2, presentFuture: -1 } },
      { id: "wealth", label: "El dinero es para construir libertad y patrimonio", deltas: { experienceWealth: 2, presentFuture: 1 } },
      { id: "goals", label: "El dinero es para cumplir metas concretas", deltas: { experienceWealth: 1, structureFlex: 1 } },
      { id: "balance", label: "Un equilibrio entre disfrutar y construir", deltas: {} },
    ],
  },
  {
    id: "risk",
    prompt: "Un amigo te ofrece entrar a algo con buen potencial pero incierto. Tu reacción honesta:",
    options: [
      { id: "in", label: "Me prende, voy con ganas", deltas: { safetyGrowth: 2 } },
      { id: "cautious", label: "Primero me aseguro de no quedar expuesto", deltas: { safetyGrowth: -2 } },
      { id: "depends", label: "Depende, pero con un colchón aparte", deltas: { safetyGrowth: -1 } },
    ],
  },
  {
    id: "planning",
    prompt: "Cuando te organizas para algo importante, prefieres…",
    options: [
      { id: "structure", label: "Un plan claro y seguirlo paso a paso", deltas: { structureFlex: 2, simpleDetail: 1 } },
      { id: "flow", label: "Ir fluyendo y ajustar sobre la marcha", deltas: { structureFlex: -2 } },
    ],
  },
  {
    id: "detail",
    prompt: "Cuando Kipu te responde, ¿qué prefieres?",
    options: [
      { id: "short", label: "Cortito y al grano", deltas: { simpleDetail: -2 } },
      { id: "detailed", label: "Con detalle cuando quiero entender el porqué", deltas: { simpleDetail: 2 } },
      { id: "depends", label: "Simple por defecto, detalle si lo pido", deltas: { simpleDetail: 0 } },
    ],
  },
  {
    id: "restriction",
    prompt: "Si una app te dijera todo el tiempo 'no gastes en eso', tú…",
    options: [
      { id: "quit", label: "Me cansaría y la dejaría de usar", deltas: { structureFlex: -2, motivation: -1, experienceWealth: -1 } },
      { id: "ok", label: "Lo agradecería, me ayuda a enfocarme", deltas: { structureFlex: 2, motivation: 1 } },
    ],
  },
  {
    id: "motivation",
    prompt: "¿Cómo te gusta que te acompañen hacia una meta?",
    options: [
      { id: "push", label: "Que me empujen directo y me exijan", deltas: { motivation: 2 } },
      { id: "gentle", label: "Con calma y sin presión", deltas: { motivation: -2 } },
      { id: "celebrate", label: "Que celebren mis avances", deltas: { motivation: -1 } },
    ],
  },
  {
    id: "horizon",
    prompt: "Piensas más en…",
    options: [
      { id: "today", label: "Disfrutar el presente, el futuro ya veremos", deltas: { presentFuture: -2, experienceWealth: -1 } },
      { id: "future", label: "Asegurar mi futuro, aunque sacrifique algo hoy", deltas: { presentFuture: 2, experienceWealth: 1 } },
    ],
  },
  {
    id: "shared",
    prompt: "Tu dinero del día a día…",
    options: [
      { id: "solo", label: "Lo manejo yo, a mi manera", deltas: { soloShared: -2 } },
      { id: "shared", label: "Lo coordino con mi pareja/familia/roomies", deltas: { soloShared: 2 } },
    ],
  },
  {
    id: "rhythm",
    prompt: "Registrar tus gastos se te da mejor…",
    options: [
      { id: "daily", label: "Al toque, apenas pasan", deltas: { consistencyBatch: -2 } },
      { id: "batch", label: "Cada tanto, de varios a la vez", deltas: { consistencyBatch: 2 } },
    ],
  },
];

export type Archetype = "explorador" | "constructor" | "guardian" | "ambicioso" | "realizador" | "equilibrista";

export interface PersonalityResult {
  version: number;
  dimensions: Record<Dimension, number>; // each in [-100, 100]
  archetype: Archetype;
  archetypeLabel: string;     // human, warm, NON-clinical (shown to the user)
  confidence: "low" | "medium" | "high";
  answered: number;
  total: number;
}

// Max possible absolute contribution per dimension across the bank (for normalization).
function maxAbsPerDimension(): Record<Dimension, number> {
  const max = {} as Record<Dimension, number>;
  // Per dimension: sum over questions of the largest |delta| any option gives it.
  for (const d of DIMENSIONS) {
    let sum = 0;
    for (const q of PERSONALITY_QUESTIONS) sum += Math.max(0, ...q.options.map((o) => Math.abs(o.deltas[d] ?? 0)));
    max[d] = sum || 1;
  }
  return max;
}

const ARCHETYPE_LABEL: Record<Archetype, string> = {
  explorador: "Explorador/a — vives por experiencias y disfrutar tu dinero",
  constructor: "Constructor/a — te mueve construir patrimonio y libertad",
  guardian: "Guardián/a — priorizas la seguridad y la tranquilidad",
  ambicioso: "Ambicioso/a — vas por el crecimiento, toleras más riesgo",
  realizador: "Realizador/a — te enfocas en cumplir metas concretas",
  equilibrista: "Equilibrista — buscas balance entre disfrutar y construir",
};

export function scorePersonalityTest(answers: TestAnswer[]): PersonalityResult {
  const raw = {} as Record<Dimension, number>;
  for (const d of DIMENSIONS) raw[d] = 0;
  const qById = new Map(PERSONALITY_QUESTIONS.map((q) => [q.id, q]));
  let answered = 0;
  for (const a of answers) {
    const q = qById.get(a.questionId);
    if (!q) continue;
    const opt = q.options.find((o) => o.id === a.optionId);
    if (!opt) continue;
    answered += 1;
    for (const d of DIMENSIONS) raw[d] += opt.deltas[d] ?? 0;
  }
  const maxAbs = maxAbsPerDimension();
  const dimensions = {} as Record<Dimension, number>;
  for (const d of DIMENSIONS) dimensions[d] = Math.round(Math.max(-100, Math.min(100, (raw[d] / maxAbs[d]) * 100)));

  const total = PERSONALITY_QUESTIONS.length;
  const confidence: PersonalityResult["confidence"] = answered >= total - 1 ? "high" : answered >= Math.ceil(total * 0.6) ? "medium" : "low";

  const archetype = pickArchetype(dimensions);
  return { version: PERSONALITY_TEST_VERSION, dimensions, archetype, archetypeLabel: ARCHETYPE_LABEL[archetype], confidence, answered, total };
}

function pickArchetype(d: Record<Dimension, number>): Archetype {
  const ew = d.experienceWealth, sg = d.safetyGrowth, sf = d.structureFlex;
  // A clear experiences lean wins its own label (even if also cautious).
  if (ew <= -35) return "explorador";
  if (ew >= 45 && sg >= 15) return "ambicioso";
  if (ew >= 30) return "constructor";
  if (sf >= 30 && ew >= 5) return "realizador";
  if (sg <= -45) return "guardian";
  return "equilibrista";
}

export function getPersonalityQuestions(): TestQuestion[] {
  return PERSONALITY_QUESTIONS;
}
