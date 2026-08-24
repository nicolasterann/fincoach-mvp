// M0 Etapa 2 — black-box conversational battery with three independent lanes.
//
// The runner never imports the loop or planner. Every product turn crosses the
// local-only HTTP bridge and every hard financial assertion reads PostgreSQL.
//
//   node --env-file=.env.local scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --dry-run
//   node --env-file=.env.local scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --ola0
//   node --env-file=.env.local scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --smoke

import fsHooks from "node:fs";
import pathHooks from "node:path";
import { registerHooks as registerSrcHooks } from "node:module";
import { pathToFileURL as srcPathToFileURL } from "node:url";
registerSrcHooks({
  resolve(specifier, context, nextResolve) {
    const base = specifier.startsWith("@/")
      ? pathHooks.resolve("src", specifier.slice(2))
      : specifier.startsWith(".") &&
          context.parentURL?.startsWith("file:") &&
          new URL(context.parentURL).pathname.includes("/src/")
        ? pathHooks.resolve(
            pathHooks.dirname(new URL(context.parentURL).pathname),
            specifier,
          )
        : null;
    if (!base) return nextResolve(specifier, context);
    const target = fsHooks.existsSync(`${base}.ts`)
      ? `${base}.ts`
      : fsHooks.existsSync(`${base}.tsx`)
        ? `${base}.tsx`
        : base;
    return nextResolve(srcPathToFileURL(target).href, context);
  },
});
const { statedAmounts } = await import("@/lib/capture/amount-evidence");
const { writeDeniedWithReceipt } = await import("@/lib/ai/agent/kipu-agent");
import { randomUUID } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import {
  currentPlanManifest,
  repeatedQuestionWithoutProgress,
} from "./m0-loop-conversation-behavior.mjs";

const args = new Set(process.argv.slice(2));
const option = (name) => {
  const exact = [...args].find((value) => value.startsWith(`${name}=`));
  return exact ? exact.slice(name.length + 1) : null;
};
const mode = option("--mode");
const dryRun = args.has("--dry-run");
const ola0 = args.has("--ola0");
const realSample = args.has("--real-sample");
const mockRun = (dryRun || ola0) && !realSample;
const smoke = args.has("--smoke");
const listOnly = args.has("--list");
const requestedScenarios = new Set(
  String(option("--scenario") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
if (mode !== "loop") {
  throw new Error("--mode=loop is required");
}
if (ola0 && (dryRun || smoke)) {
  throw new Error("--ola0 cannot be combined with --dry-run or --smoke");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const evaluationSecret = process.env.M0_EVAL_SECRET;
const appUrl = process.env.KIPU_MODEL_EVAL_URL ?? "http://127.0.0.1:3000";
const openAIKey = process.env.OPENAI_API_KEY;
const judgeModel = process.env.OPENAI_JUDGE_MODEL ?? "gpt-4.1-mini";
const usageStatusPath = process.env.M0_LOOP_USAGE_STATUS_PATH?.trim() || null;
if (!supabaseUrl || !serviceKey || !evaluationSecret) {
  throw new Error("faltan credenciales Supabase o M0_EVAL_SECRET");
}
if (!mockRun && !openAIKey) throw new Error("falta OPENAI_API_KEY para juez/paráfrasis");

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});
const openai = mockRun
  ? null
  : new OpenAI({ apiKey: openAIKey, timeout: 45_000, maxRetries: 1 });
const evaluationHeaders = {
  "content-type": "application/json",
  authorization: `Bearer ${evaluationSecret}`,
};
const runTag = `m0-loop-lanes-${Date.now()}-${randomUUID()}`;
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const ANTI_LEAK =
  /[{}]|"\w+"\s*:|```|<KIPU_[A-Z_]+>|sourceaccountid|destinationaccountid|debtaccountid|goalid|transactionid|operationid|tool_call|function_call|"type"\s*:|\b[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\b|\b(?:log_movement|register_card_payment|executeTool|needs_info|effect_type|dedupe_key)\b/i;

const ALWAYS_SENSITIVE = new Set([
  "cancel_scheduled_change",
  "cancel_scheduled_payment",
  "cancel_shared_expense",
  "change_account_currency",
  "change_base_currency",
  "close_account",
  "close_card",
  "close_installment_plan",
  "forget_life_context",
  "leave_household",
  "remove_asset",
  "remove_household_member",
  "remove_recurring_shared_expense",
  "reset_personality_test",
  "reset_personalization_preference",
  "settle_household",
  "set_household_visibility",
  "undo_recent_movements",
  "undo_agent_operation",
  "remove_duplicate",
  "transfer_household_ownership",
  "unshare_movement",
  "accept_household_invite",
  "add_household_participant",
  "household_invite_link",
  "invite_household_member",
  "respond_household_invite",
]);

const CONDITIONAL_SENSITIVITY_RULE_CODES = new Set([
  "cancel_goal",
  "delete_fixed_expense_plan",
  "end_income",
]);

const conditionalSensitive = (capability, value) => {
  const row = value && typeof value === "object" ? value : {};
  return (
    (capability === "update_goal" && row.status === "cancelled") ||
    (capability === "update_fixed_expense" &&
      row.action === "delete") ||
    (capability === "update_income" && row.action === "end")
  );
};

const LEGACY_SCENARIOS = [
  ["ME1", "Diners satisfecho por hecho durable"],
  ["ME2", "corte Diners recuperado cross-channel y fuera de ventana"],
  ["ME3", "tres pagos incompletos no escriben a medias"],
  ["ME4", "tres pagos probados aterrizan y la entrada ambigua espera"],
  ["ME5", "qué falta inspecciona sin consumir la operación"],
  ["ME6", "aclaración completa devolución de capital no-ingreso"],
  ["ME7", "seguimiento explica sin repetir dinero"],
  ["ME8", "redelivery exacta no duplica"],
  ["ME9", "undo revierte la operación completa"],
  ["ME10", "conversación normal no escribe"],
  ["ME10a", "batch ordinario conserva una identidad"],
  ["ME10a2", "corrección recupera target fuera de veinte recientes"],
  ["ME10aa", "corrección deshace dos y escribe dos reemplazos"],
  ["ME10b", "repago registrado acredita caja y baja receivable"],
  ["ME10c", "undo de repago restaura caja y receivable"],
  ["ME11", "devolución no registrada conserva capital"],
  ["ME12", "dinero prestado crea caja y obligación"],
  ["ME12b", "repago generado liga receivable exacto"],
  ["ME12c", "préstamo saliente crea receivable"],
  ["ME13", "préstamo ambiguo pregunta y no escribe"],
  ["ME14", "no-acción no inventa movimiento"],
  ["ME16", "cuatro pagos viven en una operación"],
  ["ME17", "una confirmación autoriza cuatro cierres"],
  ["ME15", "lifecycle sin applying eterno"],
].map(([id, title]) => ({ id, title, group: "legacy" }));

const TRANSCRIPT_SCENARIOS = [
  {
    id: "REAL_RENT",
    title: "transcript real del arriendo estable",
    group: "transcript",
  },
  {
    id: "REAL_FOUR_CREDITS",
    title: "transcript real de los cuatro créditos",
    group: "transcript",
  },
];

const ASPIRATIONAL_FAMILIES = [
  ["daily_capture", "registrar una compra cotidiana sin fricción"],
  ["purchase_decision", "decidir una compra contra Saldo y compromisos"],
  ["card_decision", "elegir pago de tarjeta con criterio"],
  ["unknown_expense", "entender un gasto desconocido sin inventar"],
  ["goal_adjustment", "adaptar una meta aspiracional"],
  ["debt_strategy", "priorizar deuda sin sermón"],
  ["financial_plan", "ordenar el mes con números reales"],
  ["human_coaching", "retomar y recibir una próxima acción humana"],
];
const ASPIRATIONAL_SCENARIOS = ASPIRATIONAL_FAMILIES.flatMap(
  ([family, title]) =>
    [1, 2, 3].map((variant) => ({
      id: `ASP_${family.toUpperCase()}_${variant}`,
      title: `${title} · paráfrasis ${variant}`,
      group: "aspirational",
      family,
      variant,
    })),
);
const SCENARIOS = [
  ...LEGACY_SCENARIOS,
  ...TRANSCRIPT_SCENARIOS,
  ...ASPIRATIONAL_SCENARIOS,
];
const DRY_SCENARIOS = [
  { id: "DRY_READ", title: "plomería read-only", group: "dry" },
  { id: "DRY_WRITE", title: "plomería write ordinario", group: "dry" },
  { id: "DRY_UNSTATED_ASK", title: "monto que nadie dijo: pregunta, jamás escribe ni propone", group: "dry" },
  { id: "DRY_QUOTED_SLANG", title: "jerga desconocida: la cita literal del episodio autoriza; una cita falsa no", group: "dry" },
  { id: "DRY_STACKED_CANCEL", title: "las preguntas no apilan operaciones y «cancela» fluye con voz humana", group: "dry" },
  { id: "DRY_SENSITIVE", title: "plomería propuesta y confirmación sensible", group: "dry" },
  { id: "DRY_ORIGIN", title: "ME3 acepta origen propio elegido por el modelo", group: "dry" },
  { id: "DRY_CAPITAL", title: "devolución de capital registra sin confirmación", group: "dry" },
  { id: "DRY_LOAN_OUT", title: "préstamo saliente conserva continuidad post-write", group: "dry" },
  { id: "DRY_CORRECTION", title: "corrección completa ejecuta undo y reemplazos", group: "dry" },
  { id: "DRY_CONSOLIDATION", title: "propuesta sucesora conserva pagos antes de cierres", group: "dry" },
  { id: "DRY_SUCCESSOR_PAY_CLOSE", title: "sucesor de cuatro pagos y cuatro cierres ejecuta y asienta", group: "dry" },
  { id: "DRY_SUCCESSOR_PAY_CLOSE_READ", title: "lectura post-ejecución no bloquea el settle del sucesor", group: "dry" },
  { id: "DRY_POST_WRITE_ABORT", title: "receipt conserva continuidad si falla la narración", group: "dry" },
  { id: "DRY_REPAYMENT", title: "repago registrado sigue inmediato", group: "dry" },
  { id: "DRY_RENT_AUTHORITY", title: "arriendo usa vínculo durable de fuente", group: "dry" },
  { id: "DRY_LIVE_REPLACEMENT", title: "argumentos nuevos reemplazan la acción viva de la misma entidad", group: "dry" },
  { id: "DRY_OPERATION_SOURCE", title: "la confirmación hereda la fuente user-authored de la operación", group: "dry" },
  { id: "DRY_BORROWED_LINK", title: "préstamo recibido resuelve vínculos y ejecuta caja + deuda tras confirmar", group: "dry" },
  { id: "DRY_SET_COHESION", title: "cohesión de conjunto difiere el write temprano y propone todo una sola vez", group: "dry" },
  { id: "DRY_CONFIRM_REEMIT_IDENTICAL", title: "re-emisión idéntica redirige y confirma sin sucesor", group: "dry" },
  { id: "DRY_CONFIRM_REEMIT_MODIFIED", title: "re-emisión modificada conserva la consolidación sucesora", group: "dry" },
  { id: "DRY_EXECUTING_REEMIT", title: "re-emisión durante executing no duplica ni colapsa", group: "dry" },
  { id: "DRY_CONTROL_CONFIRM_FIRST", title: "confirm primero redirige el subconjunto hermano sin duplicar", group: "dry" },
  { id: "DRY_CONTROL_CONFIRM_LAST", title: "confirm último redirige el subconjunto hermano sin consolidar", group: "dry" },
  { id: "DRY_CONTROL_DIRECTION_RESOLVED", title: "dirección resuelta y confirmada redirige toda re-emisión hermana", group: "dry" },
  { id: "DRY_QUARANTINE_RECOVERY", title: "recovery terminal entra en cuarentena y el turno fresco conserva read/reset", group: "dry" },
  { id: "DRY_CALENDAR_OVERCLAIM", title: "calendario confirma sin atribuir el pago a la cuenta esperada equivocada", group: "dry" },
  { id: "DRY_NO_PROGRESS_REFUSAL", title: "misma rehúsa estructural corta preguntas sin progreso", group: "dry" },
  { id: "DRY_CLOSE_PREFLIGHT", title: "deuda con saldo se rehúsa antes de ofrecer manifiesto", group: "dry" },
  { id: "DRY_INVESTMENT_PROPOSAL", title: "aporte ad-hoc mueve caja y activo sin confirmación", group: "dry" },
  { id: "DRY_UPDATE_ASSET_TRUTH", title: "revaluar patrimonio declara que no movió dinero de una cuenta", group: "dry" },
];

// Plan Fricción Cero · Ola 0. These are measurements, not green-by-design
// fixtures: the model is deterministic, while the live loop, dispatcher and
// PostgreSQL decide whether the historical experience contract still holds.
const OLA0_FRICTION_SCENARIOS = [
  {
    id: "O0_COTO_EXPLICIT",
    title: "Coto 15.070,22 ARS desde Supervielle",
    group: "ola0",
    input: "Coto 15.070,22 ARS desde Supervielle.",
    amount: 15_070.22,
    type: "expense",
    description: "Coto",
    category: "food",
    currency: "ARS",
    accountName: "Supervielle",
    currencyArgument: true,
    explicitInstrument: true,
  },
  {
    id: "O0_LA_IDEAL_UNIQUE",
    title: "La Ideal 50.000 ARS con fuente única",
    group: "ola0",
    input: "La Ideal 50.000 ARS.",
    amount: 50_000,
    type: "expense",
    description: "La Ideal",
    category: "food",
    currency: "ARS",
    accountName: "Supervielle",
    currencyArgument: true,
    explicitInstrument: false,
  },
  {
    id: "O0_ENTRADAS_UNIQUE",
    title: "entradas 74.550 ARS con destino único",
    group: "ola0",
    input: "Entraron 74.550 ARS de las entradas.",
    amount: 74_550,
    type: "income",
    description: "Entradas",
    category: "income",
    currency: "ARS",
    accountName: "Supervielle",
    currencyArgument: true,
    explicitInstrument: false,
  },
  {
    id: "O0_SERVIENTREGA_EXPLICIT",
    title: "Servientrega 8,51$ desde Pichincha",
    group: "ola0",
    input: "Servientrega 8,51$ desde Pichincha.",
    amount: 8.51,
    type: "expense",
    description: "Servientrega",
    category: "other",
    currency: "USD",
    accountName: "Pichincha",
    currencyArgument: true,
    explicitInstrument: true,
  },
  {
    id: "O0_MCDONALDS_AUDIO",
    title: "McDonald's 6$ con tarjeta Produbanco, texto transcrito",
    group: "ola0",
    input: "McDonald's 6$ con tarjeta Produbanco.",
    amount: 6,
    type: "expense",
    description: "McDonald's",
    category: "food",
    currency: "USD",
    accountName: "Pichincha",
    cardName: "Produbanco",
    currencyArgument: true,
    explicitInstrument: true,
  },
  {
    id: "O0_50MIL",
    title: "50mil sin forma decimal canónica",
    group: "ola0",
    input: "Coto 50mil desde Supervielle.",
    amount: 50_000,
    type: "expense",
    description: "Coto",
    category: "food",
    currency: "ARS",
    accountName: "Supervielle",
    currencyArgument: false,
    explicitInstrument: true,
  },
  {
    id: "O0_ASSUMED_CURRENCY",
    title: "moneda asumida por Supervielle aprendida",
    group: "ola0",
    input: "Coto 20.000 desde Supervielle.",
    amount: 20_000,
    type: "expense",
    description: "Coto",
    category: "food",
    currency: "ARS",
    accountName: "Supervielle",
    currencyArgument: false,
    explicitInstrument: true,
  },
  {
    id: "O0_VOICE_WORDS",
    title: "voz transcrita en palabras: seis mil pesos",
    group: "ola0",
    input: "Gasté seis mil pesos en McDonald's desde Supervielle.",
    amount: 6_000,
    type: "expense",
    description: "McDonald's",
    category: "food",
    currency: "ARS",
    accountName: "Supervielle",
    currencyArgument: false,
    explicitInstrument: true,
  },
];
const OLA0_SCENARIOS = [
  ...OLA0_FRICTION_SCENARIOS,
  {
    id: "O0_CLARIFIED_CAPTURE",
    title: "aclaración → respuesta → ejecución sin confirmación",
    group: "ola0",
    currency: "ARS",
    accountName: "Supervielle",
  },
  {
    id: "O0_LONG_CONVERSATION",
    title: "15 turnos con propuesta sensible pendiente y captura posterior",
    group: "ola0",
    currency: "USD",
    accountName: "Pichincha",
  },
  {
    id: "MA_L1_AMOUNT_FOLLOWUP",
    title: "L1 monto aclarado escribe sin confirmación ni plantilla",
    group: "ola0",
    currency: "ARS",
    accountName: "Supervielle",
  },
  {
    id: "MA_L2_ASR_CHAIN",
    title: "L2 cadena ASR aterriza sin operación atascada",
    group: "ola0",
    currency: "ARS",
    accountName: "Supervielle",
  },
  {
    id: "MA_L3_MODEL_ACCOUNT",
    title: "L3 cuenta propia elegida por el modelo escribe y cuenta el guard degradado",
    group: "ola0",
    currency: "ARS",
    accountName: "Supervielle",
  },
  {
    id: "MA_L4_ALIAS_MEMORY",
    title: "L4 alias ASR se recuerda y llega al episodio siguiente",
    group: "ola0",
    currency: "ARS",
    accountName: "Supervielle",
  },
  {
    id: "MA_L5_VOICE_AMOUNT",
    title: "L5 seis mil pesos conserva captura inmediata",
    group: "ola0",
    currency: "ARS",
    accountName: "Supervielle",
  },
  {
    id: "MA_L6_CANCEL_STUCK",
    title: "L6 cancelar termina una operación applying sin manifiesto",
    group: "ola0",
    currency: "ARS",
    accountName: "Supervielle",
  },
];
/** Muestra HUMANA con modelo real (contrato del founder, ADENDA 54): un caso
 * por clase de realismo — goteo de datos, garbles ASR literales, patrón sin
 * cuenta nombrada, typos, diminutivos+jerga, ambigüedad legítima, referencia
 * indirecta, voz en palabras. La vara: lo que Claude entendería, Kipu debe
 * entenderlo. Corre SOLO con --real-sample (modelo y juez reales). */
/** BATERÍA HUMANA (contrato del founder, ADENDA 59): lo que una persona
 * normal le pide a su agente — totales por país y por moneda, saldo tras un
 * gasto, marcar deudas viejas como pagadas, cuánto debo, qué gasté, qué me
 * toca pagar. Vara: PROHIBIDO en toda la conversación cualquier rechazo de
 * aritmética o aplazamiento; los totales se verifican por VALOR EXACTO. */
const HD_FORBIDDEN =
  /no (?:te )?puedo (?:dar|verificar)|prefiero no (?:darte|dar)|total dudoso|cuando pueda revisar|apenas pueda revisar|reintenta este mismo mensaje|reformul|env[ií]amelo otra vez|inconsistencia interna|fallo interno/iu;
const HD_SCENARIOS = [
  {
    id: "HD_COUNTRY_TOTAL",
    title: "total por país después de mover plata",
    group: "hd",
    currency: "ARS",
    accountName: "Supervielle",
    seedHumanDay: true,
    turnsScript: [
      "Compré un asado por 30 mil desde supervielle",
      "¿Cuánto tengo en total en mis cuentas de argentina?",
    ],
    expect: {
      writes: [{ amount: 30_000, accountName: "Banco Supervielle", type: "expense" }],
      maxQuestions: 0,
      finalReplyTotals: [270_400],
    },
  },
  {
    id: "HD_BREAKDOWN",
    title: "total general y desglose por país con números",
    group: "hd",
    currency: "ARS",
    accountName: "Supervielle",
    seedHumanDay: true,
    turnsScript: [
      "¿Cuánto tengo en todas mis cuentas?",
      "sepáramelo por país porfa, con subtotales",
    ],
    expect: {
      maxQuestions: 0,
      finalReplyTotals: [62.73, 300_400, 3_914.2],
    },
  },
  {
    id: "HD_BALANCE_AFTER",
    title: "saldo de un banco después de registrar un gasto",
    group: "hd",
    currency: "ARS",
    accountName: "Supervielle",
    seedHumanDay: true,
    turnsScript: [
      "Gasté 50 dólares en ropa desde produbanco",
      "¿Con cuánto quedé en produbanco?",
    ],
    expect: {
      writes: [{ amount: 50, accountName: "Produbanco", type: "expense" }],
      maxQuestions: 0,
      finalReplyTotals: [122.73],
    },
  },
  {
    id: "HD_MARK_CARDS_PAID",
    title: "marcar deudas viejas de tarjetas como pagadas",
    group: "hd",
    currency: "ARS",
    accountName: "Supervielle",
    seedHumanDay: true,
    turnsScript: [
      "Marca mis deudas de tarjetas como pagadas, ya las pagué por fuera hace tiempo",
    ],
    expect: {
      requireNoWrite: true,
      maxQuestions: 1,
      cardsZeroed: true,
      loanUntouched: 1_000,
    },
  },
  {
    id: "HD_TOTAL_DEBT",
    title: "cuánto debo en total",
    group: "hd",
    currency: "ARS",
    accountName: "Supervielle",
    seedHumanDay: true,
    turnsScript: ["¿Cuánto debo en total?"],
    expect: { maxQuestions: 0, finalReplyTotals: [1_207.03] },
  },
  {
    id: "HD_TWO_ACCOUNTS",
    title: "suma de dos cuentas nombradas",
    group: "hd",
    currency: "ARS",
    accountName: "Supervielle",
    seedHumanDay: true,
    turnsScript: ["¿Cuánto tengo entre pichincha y produbanco?"],
    expect: { maxQuestions: 0, finalReplyTotals: [62.73] },
  },
  {
    id: "HD_WRITE_AND_BALANCE",
    title: "registrar y responder el saldo en el mismo turno",
    group: "hd",
    currency: "ARS",
    accountName: "Supervielle",
    seedHumanDay: true,
    turnsScript: [
      "Registra un café de 5 dólares desde produbanco y dime cuánto me queda ahí",
    ],
    expect: {
      writes: [{ amount: 5, accountName: "Produbanco", type: "expense" }],
      maxQuestions: 0,
      finalReplyTotals: [167.73],
    },
  },
  {
    id: "HD_TRANSFER_BALANCES",
    title: "transferir y preguntar cómo quedaron ambas",
    group: "hd",
    currency: "ARS",
    accountName: "Supervielle",
    seedHumanDay: true,
    turnsScript: [
      "Pasa 100 dólares de wells fargo a produbanco",
      "¿Cómo quedaron las dos cuentas?",
    ],
    expect: {
      writes: [{ amount: 100, type: "transfer" }],
      maxQuestions: 0,
      finalReplyTotals: [3_814.2, 272.73],
    },
  },
  {
    id: "HD_INCOME_TOTAL",
    title: "ingreso y total de la moneda al instante",
    group: "hd",
    currency: "ARS",
    accountName: "Supervielle",
    seedHumanDay: true,
    turnsScript: [
      "Me pagaron 500 dólares de un freelance, entraron a wells fargo",
      "¿Cuánto tengo ahora en total en dólares?",
    ],
    expect: {
      writes: [{ amount: 500, accountName: "Wells Fargo", type: "income" }],
      maxQuestions: 0,
      finalReplyTotals: [4_576.93],
    },
  },
  {
    id: "HD_DEBT_SPECIFIC",
    title: "cuánto debo de una deuda específica",
    group: "hd",
    currency: "ARS",
    accountName: "Supervielle",
    seedHumanDay: true,
    turnsScript: ["¿Cuánto debo de la visa?"],
    expect: { maxQuestions: 0, finalReplyTotals: [201.25] },
  },
  {
    id: "HD_RICHEST_ACCOUNT",
    title: "cuál es mi cuenta con más plata",
    group: "hd",
    currency: "ARS",
    accountName: "Supervielle",
    seedHumanDay: true,
    turnsScript: ["¿Cuál es mi cuenta con más plata?"],
    expect: { maxQuestions: 0, replyMustMatch: "Wells Fargo" },
  },
  {
    id: "HD_LOAN_PARTIAL",
    title: "abono parcial a un préstamo no-tarjeta",
    group: "hd",
    currency: "ARS",
    accountName: "Supervielle",
    seedHumanDay: true,
    turnsScript: ["Pagué 100 dólares de mi crédito alpaca desde produbanco"],
    expect: {
      writes: [{ amount: 100, type: "debt_payment" }],
      maxQuestions: 0,
    },
  },
];

/** GA — asesoría de metas y decisiones grandes con el modelo real. Persona con
 * ingreso (1500/mes) y fijo (400/mes) para que la capacidad del motor sea real.
 * Aserciones por FILAS de metas en PostgreSQL + presupuesto de preguntas +
 * prohibición de rehusas; jamás por frase exacta del asesor. */
const GA_SCENARIOS = [
  {
    id: "GA_FROM_ZERO",
    title: "meta desde cero: el usuario no sabe plazo ni aporte",
    group: "ga",
    currency: "USD",
    accountName: "Produbanco",
    seedGoalAdvisory: true,
    turnsScript: [
      "Quiero ahorrar para una moto que cuesta $2400, ¿cómo lo armamos?",
      "Dale, armalo así como dices",
    ],
    expect: {
      maxQuestions: 2,
      requireToolCalled: "plan_goal_funding",
      goalRows: [
        { targetAmount: 2_400, requireContribution: true, requireDate: true },
      ],
      maxGoals: 1,
    },
  },
  {
    id: "GA_AMBITIOUS",
    title: "fecha demasiado ambiciosa: el asesor lo dice y renegocia",
    group: "ga",
    currency: "USD",
    accountName: "Produbanco",
    seedGoalAdvisory: true,
    turnsScript: [
      "Quiero juntar $3000 para el 30 de septiembre, arma la meta",
      "Uf, tienes razón. Hazla para fin de diciembre entonces",
    ],
    expect: {
      maxQuestions: 2,
      goalRows: [
        {
          targetAmount: 3_000,
          dateAfter: "2026-12-01",
          dateBefore: "2027-01-15",
        },
      ],
      maxGoals: 1,
    },
  },
  {
    id: "GA_WELL",
    title: "propuesta bien calibrada: se confirma y se crea en un turno",
    group: "ga",
    currency: "USD",
    accountName: "Produbanco",
    seedGoalAdvisory: true,
    turnsScript: [
      "Crea una meta de $500 para el 20 de diciembre aportando 125 al mes, ¿te parece viable?",
      "Sí, dale, con ese plan",
    ],
    expect: {
      maxQuestions: 1,
      goalRows: [
        {
          targetAmount: 500,
          cadence: "monthly",
          contributionAmount: 125,
        },
      ],
      maxGoals: 1,
    },
  },
  {
    id: "GA_AFFORD_NOW",
    title: "le alcanza cómodo: honestidad sin inventar una meta",
    group: "ga",
    currency: "USD",
    accountName: "Produbanco",
    seedGoalAdvisory: true,
    turnsScript: [
      "Quiero comprarme unos audífonos de $40, ¿me alcanza o lo armo como meta?",
    ],
    expect: {
      maxQuestions: 1,
      requireNoWrite: true,
      maxGoals: 0,
    },
  },
  {
    id: "GA_STAGED_TRIP",
    title: "meta por etapas: pasajes antes, viaje después",
    group: "ga",
    currency: "USD",
    accountName: "Produbanco",
    seedGoalAdvisory: true,
    turnsScript: [
      "Quiero hacer un viaje en marzo que me costará unos $2000 en total; los pasajes son $800 y hay que comprarlos máximo en noviembre. Ayúdame a armarlo por partes",
      "Perfecto, dale, créalo así con los aportes mensuales que hagan falta",
    ],
    expect: {
      maxQuestions: 2,
      goalTotalTarget: 2_000,
      minGoals: 2,
      maxGoals: 2,
      allGoalsCommitted: true,
      stagedDates: { earlyBefore: "2026-12-05", lateAfter: "2027-02-01" },
    },
  },
  {
    id: "GA_FEEDBACK",
    title: "feedback vivo: baja el aporte y la fecha se corre",
    group: "ga",
    currency: "USD",
    accountName: "Produbanco",
    seedGoalAdvisory: true,
    turnsScript: [
      "Arma una meta de $600 para mediados de diciembre",
      "Me queda muy alto ese aporte, puedo más o menos la mitad. Ajústala",
    ],
    expect: {
      maxQuestions: 2,
      requireToolCalled: "plan_goal_funding",
      goalRows: [
        { targetAmount: 600, requireContribution: true },
      ],
      maxGoals: 1,
      replyStatesGoalContribution: true,
    },
  },
  {
    id: "GA_QUESTION_NO_DUP",
    title: "iPhone 18 con $900: sin interrogatorio absurdo y sin meta duplicada",
    group: "ga",
    currency: "USD",
    accountName: "Produbanco",
    seedGoalAdvisory: true,
    turnsScript: [
      "Crea una meta para el iphone 18 nuevo que me va a costar $900, para el 31 de octubre",
      "¿Y qué día se harían los aportes?",
      "Semanal, con el aporte que haga falta para llegar",
    ],
    expect: {
      maxQuestions: 1,
      goalRows: [
        {
          targetAmount: 900,
          cadence: "weekly",
          requireContribution: true,
          dateAfter: "2026-10-30",
          dateBefore: "2026-11-01",
        },
      ],
      maxGoals: 1,
      replyStatesGoalContribution: true,
      maxFinalReplyChars: 700,
    },
  },
  {
    id: "GA_CARD_CUOTAS",
    title: "cuotas sin intereses como financiamiento de la meta",
    group: "ga",
    currency: "USD",
    accountName: "Produbanco",
    seedGoalAdvisory: true,
    seedAdvisoryCard: true,
    turnsScript: [
      "Quiero una bici de $600. La tienda da 3 cuotas sin intereses con mi Visa GA, ¿me conviene o mejor ahorro?",
    ],
    expect: {
      maxQuestions: 1,
      requireNoWrite: true,
      maxGoals: 0,
      finalReplyTotals: [200],
    },
  },
  {
    id: "GA_MINI_COUNTER",
    title: "contraoferta sobre la sugerencia: aporte propio y fecha exacta",
    group: "ga",
    currency: "USD",
    accountName: "Produbanco",
    seedGoalAdvisory: true,
    turnsScript: [
      "Quiero unos parlantes de $350 pero no quiero descuadrarme; ¿cómo lo armo como ahorro?",
      "Mejor prefiero guardar 15 a la semana, ¿cuándo los tendría?",
      "Dale, créala así",
    ],
    expect: {
      maxQuestions: 1,
      requireToolCalled: "plan_goal_funding",
      goalRows: [
        { targetAmount: 350, cadence: "weekly", contributionAmount: 15 },
      ],
      maxGoals: 1,
      anyReplyMatches: "2027",
      maxFinalReplyChars: 700,
    },
  },
  {
    id: "GA_PLAN_TRIP",
    title: "planificación acompañada: supuestos primero, registro solo al decidir",
    group: "ga",
    currency: "USD",
    accountName: "Produbanco",
    seedGoalAdvisory: true,
    turnsScript: [
      "El otro año quiero hacer un viaje largo con mi novia, ayúdame a planearlo",
      "No tengo idea de cuánto costaría, ¿tú qué estimarías para unas dos semanas?",
      "Pongámosle 3000 en total; los pasajes serían como 1000 y habría que comprarlos en octubre",
      "¿Y si para el resto solo puedo apartar unos 200 al mes, me da?",
      "Listo, me convence: arma las dos etapas así como quedaron",
    ],
    expect: {
      maxQuestions: 3,
      requireToolCalled: "plan_goal_funding",
      noGoalsBeforeTurn: 5,
      minGoals: 2,
      maxGoals: 2,
      goalTotalTarget: 3_000,
      stagedDates: { earlyBefore: "2026-11-05", lateAfter: "2026-11-05" },
      stagesSequential: true,
      maxAnyReplyChars: 900,
    },
  },
  {
    id: "GA_BIG_DECISION",
    title: "decisión grande fuera de metas: préstamo para un carro",
    group: "ga",
    currency: "USD",
    accountName: "Produbanco",
    seedGoalAdvisory: true,
    turnsScript: [
      "Estoy pensando sacar un préstamo de $5000 para un carro, ¿cómo me afectaría mes a mes?",
    ],
    expect: {
      maxQuestions: 1,
      requireNoWrite: true,
      maxGoals: 0,
    },
  },
  {
    // 124 — fondeo declarado: geometría adversarial con DOS cuentas USD donde
    // la currency-default es Produbanco. Si el hecho de fondeo no manda, la
    // meta queda sin cuenta o el aporte sale de Produbanco — y los checks de
    // funding_account_id y source_account_id lo delatan por física, no por forma.
    id: "GA_FUNDING",
    title: "fondeo declarado: la meta guarda su cuenta y el aporte sale de ahí",
    group: "ga",
    currency: "USD",
    accountName: "Produbanco",
    seedGoalAdvisory: true,
    seedSecondAccount: { name: "Wells GA", currency: "USD", balance: 800 },
    turnsScript: [
      "Quiero una meta de 900$ para una bici, para el 30 de diciembre. Los aportes van a salir de mi cuenta Wells GA.",
      "Aporté 60 a la meta de la bici",
    ],
    expect: {
      maxQuestions: 2,
      goalRows: [{ targetAmount: 900, fundingAccountName: "Wells GA" }],
      maxGoals: 1,
      writes: [{ type: "goal_contribution", amount: 60, accountName: "Wells GA" }],
    },
  },
];

const HR_SCENARIOS = [
  {
    id: "HR_FOLLOWUP",
    title: "transcript literal: café → pregunta de monto → 30mil",
    group: "hr",
    currency: "ARS",
    accountName: "Supervielle",
    turnsScript: ["Compre un cafe en mc con Supervielle", "30mil"],
    expect: { writes: [{ amount: 30_000, accountName: "Banco Supervielle", type: "expense" }], maxQuestions: 1 },
  },
  {
    id: "HR_GARBLE_CHAIN",
    title: "transcript literal: tarjeta de super bill + respuesta compuesta",
    group: "hr",
    currency: "ARS",
    accountName: "Supervielle",
    turnsScript: [
      "Compré una hamburguesa con mi tarjeta de super bill",
      "25 mil, del banco supervielle",
    ],
    expect: { writes: [{ amount: 25_000, accountName: "Banco Supervielle", type: "expense" }], maxQuestions: 1 },
  },
  {
    id: "HR_PATTERN",
    title: "sin cuenta nombrada: a lo sumo UNA pregunta en frío, jamás dos",
    group: "hr",
    currency: "ARS",
    accountName: "Supervielle",
    seedPattern: true,
    turnsScript: [
      "Compré un tallarín chino por $25.000",
      { text: "De Supervielle", onlyIfPrevAsked: true },
      "Otro tallarín igual, 25 lucas",
    ],
    expect: {
      writes: [
        { amount: 25_000, accountName: "Banco Supervielle", type: "expense" },
        { amount: 25_000, accountName: "Banco Supervielle", type: "expense" },
      ],
      maxQuestions: 1,
    },
  },
  {
    id: "HR_DRIP",
    title: "goteo: un dato por turno, jamás re-preguntar lo ya dicho",
    group: "hr",
    currency: "ARS",
    accountName: "Supervielle",
    turnsScript: ["Anotame una compra en el chino de la esquina", "fueron 35 lucas", "del efectivo"],
    expect: { writes: [{ amount: 35_000, accountName: "Efectivo", type: "expense" }], maxQuestions: 2, distinctQuestions: true },
  },
  {
    id: "HR_TYPOS",
    title: "ortografía rota de punta a punta",
    group: "hr",
    currency: "ARS",
    accountName: "Supervielle",
    turnsScript: ["conpre una gaseosa x 3500 dsde el banco superviele"],
    expect: { writes: [{ amount: 3_500, accountName: "Banco Supervielle", type: "expense" }], maxQuestions: 0 },
  },
  {
    id: "HR_DIMINUTIVE",
    title: "diminutivos y jerga: cafecito de 2 luquitas con la mastercard",
    group: "hr",
    currency: "ARS",
    accountName: "Supervielle",
    cardName: "Mastercard Pichincha",
    turnsScript: ["un cafecito de 2 luquitas con la mastercard"],
    expect: { writes: [{ amount: 2_000, cardName: "Mastercard Pichincha", type: "expense" }], maxQuestions: 0 },
  },
  {
    id: "HR_AMBIGUOUS",
    title: "ambigüedad legítima: «pagué lo de siempre» pregunta UNA vez",
    group: "hr",
    currency: "ARS",
    accountName: "Supervielle",
    turnsScript: ["pagué lo de siempre"],
    expect: { requireNoWrite: true, minQuestions: 1, maxQuestions: 1 },
  },
  {
    id: "HR_INDIRECT",
    title: "referencia indirecta: «mi banco argentino» = Supervielle",
    group: "hr",
    currency: "ARS",
    accountName: "Supervielle",
    turnsScript: ["Compré zapatillas por 80 mil con mi banco argentino"],
    expect: { writes: [{ amount: 80_000, accountName: "Banco Supervielle", type: "expense" }], maxQuestions: 0 },
  },
  {
    id: "HR_SLANG",
    title: "jerga incompleta: «metele 20 lucas de nafta, débito»",
    group: "hr",
    currency: "ARS",
    accountName: "Supervielle",
    turnsScript: ["metele 20 lucas de nafta, débito"],
    expect: { writes: [{ amount: 20_000, accountName: "Banco Supervielle", type: "expense" }], maxQuestions: 0 },
  },
  {
    id: "HR_INVENTED",
    title: "monto que NADIE dijo: pregunta una vez, jamás lo inventa",
    group: "hr",
    currency: "USD",
    accountName: "Pichincha",
    seedEtoroTemptation: true,
    turnsScript: [
      "Puedes marcar un aporte a etoro desde mi Pichincha",
      { text: "Fueron 100", onlyIfPrevAsked: true },
    ],
    expect: {
      writes: [{ amount: 100, accountName: "Banco Pichincha", type: "adjustment" }],
      maxQuestions: 1,
      minQuestions: 1,
    },
  },
  {
    id: "HR_VOICE_WORDS",
    title: "voz en palabras: seis mil pesos",
    group: "hr",
    currency: "ARS",
    accountName: "Supervielle",
    turnsScript: ["Gasté seis mil pesos en McDonald's desde el banco supervielle"],
    expect: { writes: [{ amount: 6_000, accountName: "Banco Supervielle", type: "expense" }], maxQuestions: 0 },
  },
];
const REAL_SMOKE_SCENARIOS = new Set([
  "ME2",
  "ASP_PURCHASE_DECISION_1",
  "ASP_HUMAN_COACHING_1",
]);

if (listOnly) {
  for (const scenario of [...SCENARIOS, ...DRY_SCENARIOS, ...OLA0_SCENARIOS]) {
    console.log(`${scenario.id}\t${scenario.title}`);
  }
  process.exit(0);
}
for (const id of requestedScenarios) {
  const selectable = realSample
    ? [...HR_SCENARIOS, ...HD_SCENARIOS, ...GA_SCENARIOS]
    : ola0
      ? OLA0_SCENARIOS
      : dryRun
        ? [...SCENARIOS, ...DRY_SCENARIOS]
        : SCENARIOS;
  if (!selectable.some((scenario) => scenario.id === id)) {
    throw new Error(`escenario desconocido: ${id}`);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}
const canonicalText = (value) => JSON.stringify(canonical(value));
const sameValue = (left, right) => isDeepStrictEqual(canonical(left), canonical(right));
const rounded = (value) => Math.round(Number(value) * 100) / 100;

function boundedError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack?.split("\n", 1)[0] ?? error.name,
    };
  }
  const row = error && typeof error === "object" ? error : {};
  return {
    code: typeof row.code === "string" ? row.code : null,
    message: typeof row.message === "string" ? row.message : "non-Error failure",
    details: typeof row.details === "string" ? row.details : null,
    hint: typeof row.hint === "string" ? row.hint : null,
  };
}
const boundedErrorText = (error) => canonicalText(boundedError(error));

function must(result, label) {
  if (result?.error) throw new Error(`${label}: ${boundedErrorText(result.error)}`);
  return result.data;
}

async function createDisposableUser(payload, label) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await admin.auth.admin.createUser(payload);
    if (!result.error) return result.data;
    const retryable = result.error?.name === "AuthRetryableFetchError";
    if (!retryable || attempt === 3) {
      throw new Error(`${label}: ${boundedErrorText(result.error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  throw new Error(`${label}: retry loop exhausted`);
}

function mockCall(id, name, value) {
  return { id, name, arguments: JSON.stringify(value) };
}

const TOUCHED_SURFACES = [
  ["agent_operation_transition_events", "id", "user_id"],
  ["agent_operation_manifests", "id", "user_id"],
  ["agent_operation_reversals", "id", "user_id"],
  ["debt_proceeds_applications", "id", "user_id"],
  ["receivable_repayment_applications", "id", "user_id"],
  ["agent_operation_steps", "id", "user_id"],
  ["agent_operation_deliveries", "id", "user_id"],
  ["agent_intake_failures", "id", "user_id"],
  ["agent_operations", "id", "user_id"],
  ["recurring_occurrence_satisfactions", "id", "user_id"],
  ["financial_facts", "id", "user_id"],
  ["fx_rates", "id", "user_id"],
  ["user_context_notes", "id", "user_id"],
  ["card_payment_applications", "id", "user_id"],
  ["debt_statement_cycles", "id", "user_id"],
  ["recurring_occurrences", "id", "user_id"],
  ["chat_messages", "id", "user_id"],
  ["income_sources", "id", "user_id"],
  ["receivables", "id", "user_id"],
  ["transactions", "id", "user_id"],
  ["fixed_expenses", "id", "user_id"],
  ["investment_accounts", "id", "user_id"],
  ["goals", "id", "user_id"],
  ["debt_accounts", "id", "user_id"],
  ["accounts", "id", "user_id"],
  ["user_engagement", "user_id", "user_id"],
  ["profiles", "id", "id"],
];

async function countByIdentity(table, keyColumn, identityColumn, userId) {
  const result = await admin
    .from(table)
    .select(keyColumn, { count: "exact", head: true })
    .eq(identityColumn, userId);
  if (result.error || result.count == null) {
    throw new Error(`${table} count: ${boundedErrorText(result.error ?? { message: "count null" })}`);
  }
  return Number(result.count);
}

async function cleanupPersona(persona, diagnostics) {
  if (process.env.KEEP_PERSONA === "1") {
    console.log(`KEEP_PERSONA=1 → persona conservada: ${persona.userId}`);
    return;
  }
  if (!persona?.userId) return;
  const deleted = await admin.auth.admin.deleteUser(persona.userId);
  if (deleted.error) diagnostics.push(`cleanup auth: ${boundedErrorText(deleted.error)}`);
  for (const [table, keyColumn, identityColumn] of TOUCHED_SURFACES) {
    try {
      const residue = await countByIdentity(
        table,
        keyColumn,
        identityColumn,
        persona.userId,
      );
      if (residue !== 0) diagnostics.push(`RESIDUO · ${table}: ${residue}`);
    } catch (error) {
      diagnostics.push(`LIMPIEZA ILEGIBLE · ${table}: ${boundedErrorText(error)}`);
    }
  }
}

async function assertNoMarkedPersonas() {
  let page = 1;
  const leftovers = [];
  while (true) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) throw listed.error;
    for (const user of listed.data.users) {
      if (user.user_metadata?.m0_loop_conversation_run === runTag) {
        leftovers.push(user.id);
      }
    }
    if (listed.data.users.length < 200) break;
    page += 1;
  }
  if (leftovers.length > 0) {
    throw new Error(`personas desechables huérfanas: ${canonicalText(leftovers)}`);
  }
}

async function seedPersona(scenario) {
  const rent = scenario.id === "REAL_RENT";
  const ola0Scenario = scenario.group === "ola0" || scenario.group === "hr" || scenario.group === "hd" || scenario.group === "ga";
  const ola2AssetScenario = [
    "DRY_INVESTMENT_PROPOSAL",
    "DRY_UPDATE_ASSET_TRUTH",
  ].includes(scenario.id) || scenario.seedEtoroTemptation === true || scenario.id === "DRY_STACKED_CANCEL";
  const currency = ola0Scenario ? scenario.currency : rent ? "ARS" : "USD";
  const initialBalance = ola0Scenario
    ? currency === "ARS"
      ? 500_000
      : 1_000
    : rent
      ? 2_000_000
      : 1_000;
  const emailTag = `${scenario.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-${randomUUID()}`;
  const created = await createDisposableUser(
    {
      email: `kipu-${emailTag}@example.invalid`,
      email_confirm: true,
      user_metadata: {
        m0_loop_conversation_run: runTag,
        m0_loop_scenario: scenario.id,
      },
    },
    "create persona",
  );
  const userId = created.user.id;
  must(
    await admin.from("profiles").upsert({
      id: userId,
      base_currency: currency,
      onboarding_completed: true,
    }),
    "profile",
  );
  must(
    await admin.from("user_engagement").upsert({
      user_id: userId,
      timezone: "America/Argentina/Buenos_Aires",
    }),
    "engagement",
  );
  if (ola0Scenario) {
    must(
      await admin.from("fx_rates").upsert(
        {
          user_id: userId,
          base_currency: "ARS",
          quote_currency: "USD",
          rate: 0.001,
          source: "manual",
          as_of: today,
        },
        { onConflict: "user_id,base_currency,quote_currency" },
      ),
      "model-authority geometry FX",
    );
  }
  const account = must(
    await admin
      .from("accounts")
      .insert({
        user_id: userId,
        name: ola0Scenario
          ? scenario.accountName === "Pichincha"
            ? "Banco Pichincha"
            : scenario.accountName === "Supervielle"
              ? "Banco Supervielle"
              : scenario.accountName
          : rent
            ? "Supervielle"
            : "Produbanco",
        type: "bank",
        currency,
        current_balance_original: initialBalance,
        current_balance_base: initialBalance,
        is_currency_default: !ola0Scenario,
      })
      .select("id,name,currency,current_balance_original")
      .single(),
    "account",
  );
  const geometryAccounts = ola0Scenario
    ? must(
        await admin
          .from("accounts")
          .insert(
            [
              ["Banco Supervielle", "ARS"],
              ["Efectivo", "ARS"],
              ["Efectivo USD", "USD"],
              ["PayPal", "USD"],
              ["Wells Fargo", "USD"],
              ["Banco Pichincha", "USD"],
              ["Produbanco", "USD"],
            ]
              .filter(([name]) => name !== account.name)
              .map(([name, accountCurrency]) => ({
                user_id: userId,
                name,
                type: name.startsWith("Efectivo") ? "cash" : "bank",
                currency: accountCurrency,
                current_balance_original: accountCurrency === "ARS" ? 300_000 : 750,
                current_balance_base: accountCurrency === "ARS" ? 300_000 : 750,
                is_currency_default: false,
              })),
          )
          .select("id,name,currency,current_balance_original"),
        "model-authority account geometry",
      )
    : [];
  const accounts = [account, ...geometryAccounts];
  const cards = rent
    ? []
    : ola0Scenario
      ? scenario.cardName
        ? must(
            await admin
              .from("debt_accounts")
              .insert({
                user_id: userId,
                name: scenario.cardName,
                type: "credit_card",
                currency,
                current_balance_original: 100,
                current_balance_base: 100,
                full_payment_due: 100,
                statement_total_due: 100,
                statement_covered: false,
                default_payment_account_id: account.id,
              })
              .select("id,name,current_balance_original,status"),
            "ola0 card",
          )
        : []
    : must(
        await admin
          .from("debt_accounts")
          .insert([
            {
              user_id: userId,
              name: "Diners NT",
              type: "credit_card",
              currency: "USD",
              current_balance_original: 50.6,
              current_balance_base: 50.6,
              full_payment_due: 50.6,
              statement_total_due: 50.6,
              statement_covered: false,
              statement_date: "2026-07-16",
              due_day: 3,
              cutoff_day: 15,
              default_payment_account_id: account.id,
            },
            {
              user_id: userId,
              name: "Produbanco MV",
              type: "credit_card",
              currency: "USD",
              current_balance_original: 22.14,
              current_balance_base: 22.14,
              full_payment_due: 22.14,
              statement_total_due: 22.14,
              statement_covered: false,
              default_payment_account_id: account.id,
            },
            {
              user_id: userId,
              name: "Titanium MV",
              type: "credit_card",
              currency: "USD",
              current_balance_original: 201.25,
              current_balance_base: 201.25,
              full_payment_due: 201.25,
              statement_total_due: 201.25,
              statement_covered: false,
              default_payment_account_id: account.id,
            },
          ])
          .select("id,name,current_balance_original,status"),
        "cards",
      );
  const loan = rent || ola0Scenario
    ? null
    : must(
        await admin
          .from("debt_accounts")
          .insert({
            user_id: userId,
            name: "Alpaca",
            type: "loan",
            currency: "USD",
            current_balance_original: 0,
            current_balance_base: 0,
          })
          .select("id,name,current_balance_original")
          .single(),
        "loan",
      );
  const fixedExpense = must(
    await admin
      .from("fixed_expenses")
      .insert({
        user_id: userId,
        name: rent ? "Arriendo" : "Internet",
        amount: rent ? 1_010_786.7 : currency === "ARS" ? 10_000 : 45,
        currency,
        category: rent ? "housing" : "utilities",
        frequency: "monthly",
        expected_day: 10,
        payment_source_type: "account",
        payment_source_id: account.id,
        is_variable: false,
        is_active: true,
      })
      .select("id,name,amount,currency")
      .single(),
    "fixed expense",
  );
  const goal = must(
    await admin
      .from("goals")
      .insert({
        user_id: userId,
        name: rent ? "Viaje" : ola0Scenario ? "Objetivo Ola 0" : "Viaje a Cartagena",
        target_amount: rent ? 3_000_000 : currency === "ARS" ? 200_000 : 2_000,
        currency,
        current_amount: rent ? 300_000 : currency === "ARS" ? 20_000 : 200,
        target_date: "2027-03-01",
        goal_account_id: account.id,
        status: "active",
      })
      .select("id,name,target_amount,current_amount")
      .single(),
    "goal",
  );
  const asset = ola2AssetScenario
    ? must(
        await admin
          .from("investment_accounts")
          .insert({
            user_id: userId,
            name: "eToro MOCK",
            asset_class: "investment",
            value_base: 500,
            value_original: 500,
            currency: "USD",
            liquid: false,
            include_in_net_worth: true,
          })
          .select("id,name,value_base,value_original,currency")
          .single(),
        "ola2 asset",
      )
    : null;
  const receivable = rent || ola0Scenario
    ? null
    : must(
        await admin
          .from("receivables")
          .insert({
            user_id: userId,
            counterparty: "Juan",
            direction: "owed_to_user",
            original_amount: 60,
            outstanding_amount: 60,
            currency: "USD",
            status: "open",
            reason: "Préstamo registrado M0",
          })
          .select("id,outstanding_amount,status")
          .single(),
        "receivable",
      );
  if (!rent && !ola0Scenario) {
    const diners = cards.find((card) => card.name === "Diners NT");
    must(
      await admin.from("debt_statement_cycles").insert({
        user_id: userId,
        debt_account_id: diners.id,
        statement_date: "2026-07-16",
        full_payment_due: 50.6,
        due_day: 3,
        applied: true,
        is_current: true,
        reason: "m0-loop-lanes",
      }),
      "statement cycle",
    );
  }
  return {
    userId,
    account,
    accounts,
    cards,
    sourceCard: ola0Scenario && scenario.cardName ? cards[0] : null,
    loan,
    fixedExpense,
    goal,
    asset,
    receivable,
    currency,
    initialBalance,
    chatId: `m0-loop-lanes-${scenario.id.toLowerCase()}-${randomUUID()}`,
  };
}

async function seedLongConversation(persona) {
  must(
    await admin.from("chat_messages").insert([
      {
        user_id: persona.userId,
        channel: "web",
        chat_id: "m0-loop-old-web",
        role: "user",
        content: "Ya me llegó el corte de Diners NT: son 50.60 y vence el 3 de agosto.",
        message_type: "chat",
        metadata: { source: "m0-loop-conversation-e2e" },
      },
      {
        user_id: persona.userId,
        channel: "web",
        chat_id: "m0-loop-old-web",
        role: "assistant",
        content: "Entendido: el corte quedó asociado a Diners NT.",
        message_type: "chat",
        metadata: { source: "m0-loop-conversation-e2e" },
      },
      ...Array.from({ length: 24 }, (_, index) => ({
        user_id: persona.userId,
        channel: index % 2 === 0 ? "web" : "telegram",
        chat_id: `m0-loop-filler-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Contexto neutral ${index + 1}, sin instrucciones financieras.`,
        message_type: "chat",
        metadata: { source: "m0-loop-conversation-e2e" },
      })),
    ]),
    "long conversation",
  );
}

async function financialSnapshot(userId) {
  const reads = await Promise.all([
    admin
      .from("accounts")
      .select("id,name,currency,current_balance_original,current_balance_base,status")
      .eq("user_id", userId)
      .order("id"),
    admin
      .from("debt_accounts")
      .select("id,name,type,currency,current_balance_original,current_balance_base,full_payment_due,status")
      .eq("user_id", userId)
      .order("id"),
    admin
      .from("transactions")
      .select("id,type,original_amount,original_currency,source_account_id,destination_account_id,debt_account_id,goal_id,related_transaction_id,external_ref")
      .eq("user_id", userId)
      .order("id"),
    admin
      .from("receivables")
      .select("id,counterparty,direction,original_amount,outstanding_amount,currency,status")
      .eq("user_id", userId)
      .order("id"),
    admin
      .from("goals")
      .select("id,name,target_amount,current_amount,currency,target_date,status")
      .eq("user_id", userId)
      .order("id"),
    admin
      .from("investment_accounts")
      .select("id,name,value_base,value_original,currency,updated_at")
      .eq("user_id", userId)
      .order("id"),
  ]);
  const labels = [
    "accounts",
    "debts",
    "transactions",
    "receivables",
    "goals",
    "assets",
  ];
  return Object.fromEntries(
    reads.map((read, index) => [labels[index], must(read, `snapshot ${labels[index]}`)]),
  );
}

async function progressSnapshot(userId) {
  const [operations, steps, manifests, transactions] = await Promise.all([
    admin
      .from("agent_operations")
      .select("id,status,state_version,plan_version,pending_question")
      .eq("user_id", userId)
      .order("id"),
    admin
      .from("agent_operation_steps")
      .select("operation_id,plan_version,step_key,status")
      .eq("user_id", userId)
      .order("operation_id")
      .order("plan_version")
      .order("step_key"),
    admin
      .from("agent_operation_manifests")
      .select("operation_id,plan_version,status,manifest_hash")
      .eq("user_id", userId)
      .order("operation_id")
      .order("plan_version"),
    admin
      .from("transactions")
      .select("id,type,related_transaction_id")
      .eq("user_id", userId)
      .order("id"),
  ]);
  return canonicalText({
    operations: must(operations, "progress operations"),
    steps: must(steps, "progress steps"),
    manifests: must(manifests, "progress manifests"),
    transactions: must(transactions, "progress transactions"),
  });
}

async function parseHttpJson(response) {
  const text = await response.text();
  try {
    return { body: JSON.parse(text), raw: null };
  } catch {
    return { body: null, raw: text.slice(0, 500) };
  }
}

class EvalServerUnreachableError extends Error {
  constructor() {
    super(
      `EVAL_SERVER_UNREACHABLE · no se pudo conectar con ${appUrl}. ` +
        `Inícialo con: KIPU_AGENT_MODE=${mode} npm run dev`,
    );
    this.name = "EvalServerUnreachableError";
    this.code = "EVAL_SERVER_UNREACHABLE";
  }
}

async function evaluationFetch(init) {
  try {
    return await fetch(`${appUrl}/dev/m0-agent-eval`, init);
  } catch {
    throw new EvalServerUnreachableError();
  }
}

async function turn(persona, message, options = {}) {
  const requestId = options.requestId ?? randomUUID();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const response = await evaluationFetch({
    method: "POST",
    headers: evaluationHeaders,
    body: JSON.stringify({
      userId: persona.userId,
      message,
      requestId,
      chatId: options.chatId ?? persona.chatId,
      channel: options.channel ?? "telegram",
      mode,
      ...(mockRun ? { mockCompletions: options.mockCompletions ?? [] } : {}),
    }),
  });
  const parsed = await parseHttpJson(response);
  const body = parsed.body;
  const reply = String(body?.result?.chatResponse?.message ?? "");
  const finishedAt = new Date().toISOString();
  return {
    requestId,
    startedAt,
    finishedAt,
    elapsedMs: Date.now() - startedMs,
    user: message,
    reply,
    httpOk:
      response.ok &&
      body?.ok === true &&
      body?.contract === "m0-agent-eval-2026-08-24-native-loop-closure" &&
      body?.mode === mode,
    httpStatus: response.status,
    error: response.ok
      ? null
      : {
          body: body ?? parsed.raw,
        },
    result: body?.result ?? null,
    progress: await progressSnapshot(persona.userId),
  };
}

function turnDetail(row) {
  return {
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    elapsedMs: row.elapsedMs ?? null,
    httpStatus: row.httpStatus,
    reply: row.reply,
    outcome: row.result?.assistantMetadata?.agentOutcome ?? null,
    toolTrace: row.result?.assistantMetadata?.toolTrace ?? null,
    durableOperation: row.result?.assistantMetadata?.durableOperation ?? null,
    loopDiagnostic: row.result?.assistantMetadata?.loopDiagnostic ?? null,
  };
}

function behaviorAssertions(turns) {
  const failures = [];
  for (const [index, row] of turns.entries()) {
    if (!row.httpOk) failures.push(`turn ${index + 1}: HTTP ${row.httpStatus ?? "network"}`);
    if (!row.reply.trim()) failures.push(`turn ${index + 1}: empty reply`);
    if (ANTI_LEAK.test(row.reply)) failures.push(`turn ${index + 1}: anti-leak regex`);
    if (index > 0 && repeatedQuestionWithoutProgress(turns[index - 1], row)) {
      failures.push(`turn ${index + 1}: normalized question repeated without progress`);
    }
  }
  return failures;
}

async function manifestAssertions(userId) {
  const [stepRead, manifestRead] = await Promise.all([
    admin
      .from("agent_operation_steps")
      .select("operation_id,plan_version,step_key,capability,arguments,effects,status,resolved_type,result,applied_at")
      .eq("user_id", userId),
    admin
      .from("agent_operation_manifests")
      .select("operation_id,plan_version,status,manifest,authorized_at,verification")
      .eq("user_id", userId),
  ]);
  const steps = must(stepRead, "manifest steps");
  const manifests = must(manifestRead, "manifests");
  const failures = [];
  for (const step of steps) {
    const capability = String(step.capability ?? "");
    const isSensitive = ALWAYS_SENSITIVE.has(capability) ||
      conditionalSensitive(capability, step.arguments);
    const wrote = step.resolved_type === "write";
    if (!isSensitive || step.status !== "verified" || !wrote) continue;
    const manifest = manifests.find(
      (candidate) =>
        candidate.operation_id === step.operation_id &&
        candidate.plan_version === step.plan_version &&
        ["authorized", "executing", "verified"].includes(candidate.status),
    );
    const action = manifest?.manifest?.actions?.find(
      (candidate) => candidate?.action_id === step.step_key,
    );
    if (
      !manifest ||
      !manifest.authorized_at ||
      !step.applied_at ||
      new Date(manifest.authorized_at).getTime() > new Date(step.applied_at).getTime() ||
      !action ||
      action.capability !== capability ||
      !sameValue(action.arguments, step.arguments)
    ) {
      failures.push(`sensitive write without prior exact authorization: ${capability}`);
    }
  }
  for (const manifest of manifests.filter((row) => row.status === "verified")) {
    const actions = Array.isArray(manifest.manifest?.actions)
      ? manifest.manifest.actions
      : [];
    const matching = steps.filter(
      (step) =>
        step.operation_id === manifest.operation_id &&
        actions.some((action) => action?.action_id === step.step_key),
    );
    if (actions.length === 0 || matching.length !== actions.length) {
      failures.push(`verified manifest parity count mismatch: ${manifest.operation_id}`);
      continue;
    }
    for (const action of actions) {
      const step = matching.find((candidate) => candidate.step_key === action.action_id);
      if (
        !step ||
        step.status !== "verified" ||
        step.capability !== action.capability ||
        !sameValue(step.arguments, action.arguments) ||
        !manifestEffectsMatch(step.effects, action.effects)
      ) {
        failures.push(`verified manifest value mismatch: ${manifest.operation_id}`);
      }
    }
  }
  return failures;
}

async function currentOperationPlanVersion(userId, operationId) {
  const operation = must(
    await admin
      .from("agent_operations")
      .select("plan_version")
      .eq("user_id", userId)
      .eq("id", operationId)
      .single(),
    "current operation plan version",
  );
  const planVersion = Number(operation?.plan_version);
  if (!Number.isInteger(planVersion) || planVersion < 1) {
    throw new Error("CURRENT_OPERATION_PLAN_VERSION_INVALID");
  }
  return planVersion;
}

const usage = {
  agent: { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
  judge: { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
  paraphrase: { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
};

const COST_RATES = {
  coach: {
    input: Number(process.env.M0_COACH_INPUT_USD_PER_M ?? 2.5),
    cached: Number(process.env.M0_COACH_CACHED_INPUT_USD_PER_M ?? 0.25),
    output: Number(process.env.M0_COACH_OUTPUT_USD_PER_M ?? 15),
  },
  mini: {
    input: Number(process.env.M0_MINI_INPUT_USD_PER_M ?? 0.4),
    cached: Number(process.env.M0_MINI_CACHED_INPUT_USD_PER_M ?? 0.1),
    output: Number(process.env.M0_MINI_OUTPUT_USD_PER_M ?? 1.6),
  },
};

const dollars = (tokens, price) => (tokens / 1_000_000) * price;
const costFor = (tokens, rate) =>
  dollars(Math.max(0, tokens.inputTokens - tokens.cachedInputTokens), rate.input) +
  dollars(tokens.cachedInputTokens, rate.cached) +
  dollars(tokens.outputTokens, rate.output);

function actualUsageCostUsd() {
  return (
    costFor(usage.agent, COST_RATES.coach) +
    costFor(usage.judge, COST_RATES.mini) +
    costFor(usage.paraphrase, COST_RATES.mini)
  );
}

function persistUsageSnapshot() {
  if (!usageStatusPath) return;
  const temporary = `${usageStatusPath}.tmp`;
  writeFileSync(
    temporary,
    `${canonicalText({
      mode,
      updatedAt: new Date().toISOString(),
      usage,
      ratesUsdPerMillion: COST_RATES,
      actualUsd: Math.round(actualUsageCostUsd() * 1_000_000) / 1_000_000,
    })}\n`,
  );
  renameSync(temporary, usageStatusPath);
}

function addUsage(target, row) {
  target.calls += Number(row?.calls ?? (row ? 1 : 0));
  target.inputTokens += Number(
    row?.inputTokens ?? row?.promptTokens ?? row?.prompt_tokens ?? 0,
  );
  target.cachedInputTokens += Number(
    row?.cachedInputTokens ??
      row?.cachedPromptTokens ??
      row?.prompt_tokens_details?.cached_tokens ??
      0,
  );
  target.outputTokens += Number(
    row?.outputTokens ?? row?.completionTokens ?? row?.completion_tokens ?? 0,
  );
  persistUsageSnapshot();
}

function observeAgentUsage(turns) {
  for (const row of turns) {
    const metadata = row.result?.assistantMetadata ?? {};
    if (mode === "loop") addUsage(usage.agent, metadata.loopUsage);
    else addUsage(usage.agent, metadata.agentPlannerUsage);
  }
}

const cannedParaphrases = {
  legacy: {
    capital_return:
      "Me acreditaron 83.86 en Produbanco: era capital de un préstamo mío que nunca anoté.",
    borrowed:
      "Alpaca me prestó 83.86 hoy y entraron a Produbanco; ahora se los debo.",
    registered_repayment:
      "Juan abonó 40 del préstamo registrado y el dinero llegó a Produbanco.",
    loan_out:
      "Le presté 25 a María desde Produbanco; quedó debiéndomelos.",
    ambiguous:
      "Recibí 83.86 vinculados con un préstamo que no estaba anotado.",
    no_action: "Gracias por aclararlo; no registres ni cambies nada.",
  },
  aspirational: {
    daily_capture: [
      "Anota 7.25 de un café de hoy desde Produbanco.",
      "Hoy pagué 7.25 por café con Produbanco; regístralo.",
      "Carga un gasto de café por 7.25 que salió hoy de Produbanco.",
    ],
    purchase_decision: [
      "¿Me conviene comprar entradas por 120 sin desordenar lo que viene?",
      "Estoy pensando gastar 120 en un concierto; ¿cómo lo ves con mis compromisos?",
      "¿Tengo aire real para unas entradas de 120 o mejor espero?",
    ],
    card_decision: [
      "¿Qué sería más sensato con Diners: pagar el total o guardar caja?",
      "Ayúdame a decidir cuánto pagar de Diners sin inventar intereses.",
      "Con mi situación actual, ¿cómo encaro el pago de la Diners?",
    ],
    unknown_expense: [
      "Veo un gasto que no reconozco; ¿cómo lo revisamos sin borrarlo todavía?",
      "Hay un movimiento raro y prefiero entenderlo antes de cambiar nada.",
      "¿Me ayudas a investigar un cargo desconocido sin asumir qué fue?",
    ],
    goal_adjustment: [
      "¿Cómo ajusto mi viaje a Cartagena sin abandonar la meta?",
      "Mi meta de viaje se siente exigente; ayúdame a hacerla realista.",
      "Quiero conservar el viaje, pero necesito un plan más llevadero.",
    ],
    debt_strategy: [
      "¿Cuál deuda debería atacar primero y por qué?",
      "Ayúdame a ordenar mis deudas sin dejarme sin caja.",
      "¿Cómo priorizo las tarjetas con los datos que sí tienes?",
    ],
    financial_plan: [
      "Ordéname el mes: qué cuidar primero y cuánto margen real tengo.",
      "¿Cómo reparto lo que tengo entre pagos, meta y gustos este mes?",
      "Dame un plan corto para llegar bien a fin de mes con mis números.",
    ],
    human_coaching: [
      "Me desconecté unos días; ayúdame a retomar sin regaños.",
      "Volví después de no registrar; ¿cuál es el siguiente paso más útil?",
      "Quiero ponerme al día de forma simple, ¿por dónde empezamos?",
    ],
  },
};

async function generateParaphrases() {
  if (mockRun || smoke) return cannedParaphrases;
  const completion = await openai.chat.completions.create({
    model: judgeModel,
    temperature: 0.8,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Genera paráfrasis naturales en español latinoamericano neutral. Conserva semántica y todos los números. Devuelve JSON: legacy con seis strings (capital_return, borrowed, registered_repayment, loan_out, ambiguous, no_action) y aspirational con ocho arrays de tres strings usando las keys recibidas. No agregues hechos ni ids.",
      },
      {
        role: "user",
        content: canonicalText(cannedParaphrases),
      },
    ],
  });
  addUsage(usage.paraphrase, completion.usage);
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  for (const key of Object.keys(cannedParaphrases.legacy)) {
    if (typeof parsed?.legacy?.[key] !== "string" || !parsed.legacy[key].trim()) {
      throw new Error(`paráfrasis legacy inválida: ${key}`);
    }
  }
  for (const [family] of ASPIRATIONAL_FAMILIES) {
    if (
      !Array.isArray(parsed?.aspirational?.[family]) ||
      parsed.aspirational[family].length !== 3 ||
      parsed.aspirational[family].some((value) => typeof value !== "string" || !value.trim())
    ) {
      throw new Error(`paráfrasis aspiracional inválida: ${family}`);
    }
  }
  return parsed;
}

async function judgeScenario(scenario, turns, moneyEvidence) {
  if (mockRun) {
    addUsage(usage.judge, {
      inputTokens: 180,
      cachedInputTokens: 0,
      outputTokens: 45,
    });
    return {
      resolved_request: 5,
      only_necessary_questions: 5,
      correct_numbers: 5,
      human_coach_voice: 5,
      average: 5,
      rationale: "Juez MOCK: transcript enlatado y shape completo validados.",
      model: "MOCK",
    };
  }
  const completion = await openai.chat.completions.create({
    model: judgeModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Eres un juez estricto de un coach financiero personal latinoamericano. Evalúa el transcript completo en cuatro dimensiones enteras 1..5: resolved_request (¿resolvió lo pedido?), only_necessary_questions (¿preguntó solo lo necesario?), correct_numbers (¿explicó con los números correctos y sin inventar?) y human_coach_voice (¿suena a coach humano, claro y sin sermón?). Devuelve SOLO JSON con esas cuatro claves y rationale breve. No premies frases exactas ni artefactos internos.",
      },
      {
        role: "user",
        content: canonicalText({
          scenario: { id: scenario.id, title: scenario.title },
          transcript: turns.map((row) => ({ user: row.user, assistant: row.reply })),
          deterministic_money_evidence: moneyEvidence,
        }),
      },
    ],
  });
  addUsage(usage.judge, completion.usage);
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  const keys = [
    "resolved_request",
    "only_necessary_questions",
    "correct_numbers",
    "human_coach_voice",
  ];
  for (const key of keys) {
    if (!Number.isInteger(parsed[key]) || parsed[key] < 1 || parsed[key] > 5) {
      throw new Error(`judge returned invalid ${key}: ${canonicalText(parsed)}`);
    }
  }
  return {
    ...Object.fromEntries(keys.map((key) => [key, parsed[key]])),
    average: keys.reduce((sum, key) => sum + parsed[key], 0) / keys.length,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    model: judgeModel,
  };
}

function newTransactions(before, after) {
  const prior = new Set(before.transactions.map((row) => row.id));
  return after.transactions.filter((row) => !prior.has(row.id));
}

function accountBalance(snapshot, id) {
  return rounded(snapshot.accounts.find((row) => row.id === id)?.current_balance_original);
}

function debtBalance(snapshot, id) {
  return rounded(snapshot.debts.find((row) => row.id === id)?.current_balance_original);
}

function moneyResult(checks, evidence) {
  const failures = checks.filter((row) => !row.ok).map((row) => row.name);
  return { pass: failures.length === 0, failures, evidence };
}

function manifestEffectsMatch(stepEffects, actionEffects) {
  if (sameValue(stepEffects, actionEffects)) return true;
  if (!Array.isArray(stepEffects) || !Array.isArray(actionEffects)) return false;
  if (stepEffects.length !== actionEffects.length + 1) return false;
  const receiptMarkers = stepEffects.filter(
    (effect) => effect?.kind === "economic_event" && effect?.source === "receipt",
  );
  if (receiptMarkers.length !== 1) return false;
  const withoutReceipt = stepEffects.filter(
    (effect) => !(effect?.kind === "economic_event" && effect?.source === "receipt"),
  );
  return sameValue(withoutReceipt, actionEffects);
}

async function runDinersScenario(scenario, persona) {
  await seedLongConversation(persona);
  const before = await financialSnapshot(persona.userId);
  const turnResult = await turn(
    persona,
    "¿Cuánto tengo que pagar de la Diners NT y cuándo vence?",
    dryRun
      ? {
          mockCompletions: [
            {
              content: "Tu corte de Diners NT es de 50,60$ y vence el 3 de agosto.",
              toolCalls: [],
            },
          ],
        }
      : {},
  );
  const after = await financialSnapshot(persona.userId);
  const unchanged = sameValue(before, after);
  return {
    turns: [turnResult],
    money: moneyResult(
      [{ name: "Diners read-only preserves all financial state", ok: unchanged }],
      {
        expected: { amount: 50.6, dueDay: 3, writes: 0 },
        financialStateUnchanged: unchanged,
      },
    ),
  };
}

async function runRentScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const first = await turn(
    persona,
    "Hola, acabo de pagar el arriendo.",
    dryRun
      ? {
          mockCompletions: [
            {
              content: "¿Desde qué cuenta salió el pago del arriendo?",
              toolCalls: [],
            },
          ],
        }
      : {},
  );
  const second = await turn(
    persona,
    "Desde mi cuenta Supervielle.",
    dryRun
      ? {
          mockCompletions: [
            {
              content: null,
              toolCalls: [
                mockCall("rent-write", "log_movement", {
                  type: "expense",
                  amount: 1_010_786.7,
                  description: "Arriendo",
                  category: "housing",
                  sourceAccountId: persona.account.id,
                  fixedExpenseId: persona.fixedExpense.id,
                  occurredAtISO: today,
                }),
              ],
            },
            {
              content:
                "Listo, registré el arriendo por 1.010.786,70 ARS desde Supervielle.",
              toolCalls: [],
            },
          ],
        }
      : {},
  );
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const expense = added.find((row) => row.type === "expense");
  const checks = [
    {
      name: "rent writes exactly one expense",
      ok: added.length === 1 && Boolean(expense),
    },
    {
      name: "rent amount and source are exact",
      ok:
        rounded(expense?.original_amount) === 1_010_786.7 &&
        expense?.source_account_id === persona.account.id,
    },
    {
      name: "rent balance delta is exact",
      ok:
        accountBalance(after, persona.account.id) ===
        rounded(accountBalance(before, persona.account.id) - 1_010_786.7),
    },
  ];
  return {
    turns: [first, second],
    money: moneyResult(checks, { added, accountBefore: accountBalance(before, persona.account.id), accountAfter: accountBalance(after, persona.account.id) }),
  };
}

async function seedAuthorityCards(persona) {
  return must(
    await admin
      .from("debt_accounts")
      .insert(
        [11.11, 12.22, 13.33, 14.44].map((amount, index) => ({
          user_id: persona.userId,
          name: `Crédito piloto ${index + 1}`,
          type: "credit_card",
          currency: "USD",
          current_balance_original: amount,
          current_balance_base: amount,
          full_payment_due: amount,
          statement_total_due: amount,
          statement_covered: false,
          default_payment_account_id: persona.account.id,
        })),
      )
      .select("id,name,current_balance_original,status"),
    "authority cards",
  );
}

async function runFourCreditsScenario(scenario, persona, closeCards) {
  const cards = await seedAuthorityCards(persona);
  const before = await financialSnapshot(persona.userId);
  const status = await turn(
    persona,
    "Recuérdame cuáles son los cuatro créditos piloto que siguen pendientes.",
    dryRun
      ? {
          mockCompletions: [
            {
              content: cards.map((card) => card.name).join(", "),
              toolCalls: [],
            },
          ],
        }
      : {},
  );
  const payment = await turn(
    persona,
    "Perfecto, deja esos cuatro cubiertos desde mi Produbanco.",
    dryRun
      ? {
          mockCompletions: [
            {
              content: null,
              toolCalls: cards.map((card, index) =>
                mockCall(`pay-${index + 1}`, "register_card_payment", {
                  cardName: card.name,
                  paidInFull: true,
                  fromAccount: persona.account.id,
                  date: today,
                }),
              ),
            },
            {
              content:
                "Listo, quedaron cubiertos los cuatro créditos desde Produbanco por 51,10$ en total.",
              toolCalls: [],
            },
          ],
        }
      : {},
  );
  const turns = [status, payment];
  let afterPayment = await financialSnapshot(persona.userId);
  let proposedRows = [];
  let finalRows = [];
  if (!closeCards) {
    proposedRows = must(
      await admin
        .from("agent_operation_manifests")
        .select("id,operation_id,plan_version,status,manifest_hash,manifest")
        .eq("user_id", persona.userId)
        .eq("status", "proposed"),
      "proposed payment manifest",
    );
    const operationId = proposedRows[0]?.operation_id;
    const confirmed = await turn(
      persona,
      "Sí, confirma exactamente esos cuatro pagos desde Produbanco.",
      dryRun
        ? {
            mockCompletions: [
              {
                content: null,
                toolCalls: [
                  mockCall("confirm-payments", "confirm_operation", {
                    operationId,
                    rationale: "La entrega confirma los cuatro pagos propuestos.",
                  }),
                ],
              },
              {
                content: "Listo, quedaron cubiertos los cuatro créditos desde Produbanco por 51,10$ en total.",
                toolCalls: [],
              },
            ],
          }
        : {},
    );
    turns.push(confirmed);
    afterPayment = await financialSnapshot(persona.userId);
    finalRows = must(
      await admin
        .from("agent_operation_manifests")
        .select("id,operation_id,plan_version,status,manifest_hash,manifest,verification")
        .eq("user_id", persona.userId)
        .eq("operation_id", operationId)
        .order("plan_version"),
      "verified payment manifest",
    );
  } else {
    const proposal = await turn(
      persona,
      "Ahora cierra esas mismas cuatro tarjetas; no quiero que queden activas.",
      dryRun
        ? {
            mockCompletions: [
              {
                content: null,
                toolCalls: cards.map((card, index) =>
                  mockCall(`close-${index + 1}`, "close_card", {
                    debtAccountId: card.id,
                    confirm: true,
                  }),
                ),
              },
              {
                content:
                  "Preparé el cierre de las cuatro tarjetas. Confírmame si quieres ejecutar exactamente esos cierres.",
                toolCalls: [],
              },
            ],
          }
        : {},
    );
    proposedRows = must(
      await admin
        .from("agent_operation_manifests")
        .select("id,operation_id,plan_version,status,manifest_hash,manifest")
        .eq("user_id", persona.userId)
        .eq("status", "proposed"),
      "proposed close manifest",
    );
    const operationId = proposedRows[0]?.operation_id;
    const confirmed = await turn(
      persona,
      "Adelante con el conjunto tal como lo acabas de plantear.",
      dryRun
        ? {
            mockCompletions: [
              {
                content: null,
                toolCalls: [
                  mockCall("confirm-close", "confirm_operation", {
                    operationId,
                    rationale: "La entrega confirma el conjunto propuesto.",
                  }),
                ],
              },
              {
                content: "Listo, cerré las cuatro tarjetas del conjunto confirmado.",
                toolCalls: [],
              },
            ],
          }
        : {},
    );
    turns.push(proposal, confirmed);
    finalRows = must(
      await admin
        .from("agent_operation_manifests")
        .select("id,operation_id,plan_version,status,manifest_hash,manifest,verification")
        .eq("user_id", persona.userId)
        .eq("operation_id", operationId)
        .order("plan_version"),
      "verified close manifest",
    );
    afterPayment = await financialSnapshot(persona.userId);
  }
  const after = await financialSnapshot(persona.userId);
  const cardIds = new Set(cards.map((card) => card.id));
  const paidCards = afterPayment.debts.filter((card) => cardIds.has(card.id));
  const closedCards = after.debts.filter((card) => cardIds.has(card.id));
  const newPayments = newTransactions(before, afterPayment).filter(
    (row) => row.type === "debt_payment" && cardIds.has(row.debt_account_id),
  );
  const operationId = proposedRows[0]?.operation_id;
  const currentPlanVersion = operationId
    ? await currentOperationPlanVersion(persona.userId, operationId)
    : null;
  const finalManifest = currentPlanManifest(finalRows, currentPlanVersion);
  const checks = [
    {
      name: "four exact card payments",
      ok:
        newPayments.length === 4 &&
        sameValue(
          newPayments.map((row) => rounded(row.original_amount)).sort((a, b) => a - b),
          [11.11, 12.22, 13.33, 14.44],
        ),
    },
    {
      name: "four debts and cash settle exactly",
      ok:
        paidCards.every((card) => rounded(card.current_balance_original) === 0) &&
        accountBalance(afterPayment, persona.account.id) ===
          rounded(accountBalance(before, persona.account.id) - 51.1),
    },
  ];
  if (!closeCards) {
    checks.push({
      name: "one four-payment proposal becomes verified after natural confirmation",
      ok:
        proposedRows.length === 1 &&
        proposedRows[0]?.manifest?.actions?.length === 4 &&
        finalManifest?.status === "verified" &&
        finalManifest?.manifest_hash === proposedRows[0]?.manifest_hash,
    });
  }
  if (closeCards) {
    checks.push(
      {
        name: "one eight-action successor becomes verified",
        ok:
          proposedRows.length === 1 &&
          proposedRows[0]?.manifest?.actions?.length === 8 &&
          finalManifest?.status === "verified" &&
          finalManifest?.manifest_hash === proposedRows[0]?.manifest_hash,
      },
      {
        name: "all four cards are closed",
        ok: closedCards.length === 4 && closedCards.every((card) => card.status === "closed"),
      },
    );
  }
  return {
    turns,
    money: moneyResult(checks, {
      paymentAmounts: newPayments.map((row) => rounded(row.original_amount)),
      accountBefore: accountBalance(before, persona.account.id),
      accountAfterPayment: accountBalance(afterPayment, persona.account.id),
      proposedManifest: proposedRows[0] ?? null,
      currentPlanVersion,
      finalManifest,
      finalManifests: finalRows,
    }),
  };
}

async function runAspirationalScenario(scenario, persona, paraphrases) {
  const prompt = paraphrases.aspirational[scenario.family][scenario.variant - 1];
  const before = await financialSnapshot(persona.userId);
  const result = await turn(persona, prompt);
  const after = await financialSnapshot(persona.userId);
  if (scenario.family === "daily_capture") {
    const added = newTransactions(before, after);
    const expense = added.find((row) => row.type === "expense");
    return {
      turns: [result],
      money: moneyResult(
        [
          { name: "aspirational capture writes one row", ok: added.length === 1 },
          {
            name: "aspirational capture amount/source exact",
            ok:
              rounded(expense?.original_amount) === 7.25 &&
              expense?.source_account_id === persona.account.id &&
              accountBalance(after, persona.account.id) ===
                rounded(accountBalance(before, persona.account.id) - 7.25),
          },
        ],
        { added },
      ),
    };
  }
  return {
    turns: [result],
    money: moneyResult(
      [{ name: "aspirational advisory is read-only", ok: sameValue(before, after) }],
      { financialStateUnchanged: sameValue(before, after) },
    ),
  };
}

async function ola0ManifestRows(userId) {
  return must(
    await admin
      .from("agent_operation_manifests")
      .select("id,operation_id,plan_version,status,manifest_hash,manifest,verification")
      .eq("user_id", userId)
      .order("operation_id")
      .order("plan_version"),
    "ola0 manifests",
  );
}

async function ola0OperationRows(userId) {
  return must(
    await admin
      .from("agent_operations")
      .select("id,status,plan_version,pending_question,last_error")
      .eq("user_id", userId)
      .order("id"),
    "ola0 operations",
  );
}

function ola0FrictionFailures(result, manifests, operations) {
  const trace = Array.isArray(result.result?.assistantMetadata?.toolTrace)
    ? result.result.assistantMetadata.toolTrace
    : [];
  const outcome = result.result?.assistantMetadata?.agentOutcome ?? {};
  const failures = [];
  if (manifests.length > 0) failures.push("FRICTION_MANIFEST_CREATED");
  if (
    outcome.needsInfo === true ||
    operations.some(
      (row) => row.status === "awaiting_input" || Boolean(row.pending_question),
    )
  ) {
    failures.push("FRICTION_NEEDS_INFO");
  }
  if (
    trace.some((row) =>
      ["confirm_operation", "reject_operation"].includes(String(row?.name ?? "")),
    )
  ) {
    failures.push("FRICTION_CONTROL_TOOL_USED");
  }
  if (outcome.hadError === true) failures.push("FRICTION_TURN_ERROR");
  return failures;
}

/** Runner genérico de la muestra humana: turnos reales, aserciones duras sobre
 * el estado PostgreSQL final + presupuesto de preguntas + prohibición de
 * plantilla + cero manifiesto/atasco. El transcript completo queda en la
 * evidencia para lectura humana de la voz. */
function amountWasStatedInReply(reply, expected) {
  const normalized = reply.replace(/\*\*/gu, " ");
  if (
    statedAmounts(normalized).some(
      (value) => Math.abs(value - expected) <= 0.01,
    )
  ) {
    return true;
  }
  // statedAmounts es gramática de MENSAJES DE USUARIO: excluye «200 al mes»
  // sin signo (la regla anti-«3 cuotas»). Un reply del coach puede decir el
  // total esperado sin marca de moneda; para un valor ESPERADO puntual, el
  // número exacto (con separadores opcionales) alcanza como verificación.
  const abs = Math.abs(expected);
  const intPart = Math.trunc(abs);
  const cents = Math.round((abs - intPart) * 100);
  const intPattern = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/gu, "[.,]?");
  const centsPattern = cents > 0 ? `[.,]${String(cents).padStart(2, "0")}` : "(?:[.,]00)?";
  return new RegExp(`(?<![\\d.,])${intPattern}${centsPattern}(?!\\d|[.,]\\d)`, "u").test(normalized);
}

async function runHumanRealismScenario(scenario, persona) {
  if (scenario.seedHumanDay) {
    // Balances EXACTOS para totales verificables:
    // EC(USD): Pichincha -110 · Produbanco 172.73 · Efectivo USD 0  → 62.73
    // US(USD): Wells 3914.20 · PayPal 0 · Wise 100                  → 4014.20
    // AR(ARS): Supervielle 250.000 · Efectivo 400 · Galicia 50.000  → 300.400
    // Geometría real: base ARS a la tasa sembrada 1000 ARS/USD — jamás
    // base=original para una cuenta USD (haría a Wells «más pobre» que
    // Supervielle y rompería cualquier comparación patrimonial).
    const HD_ARS_PER_USD = 1_000;
    const fix = async (name, balance) => {
      const row = persona.accounts.find((r) => r.name === name);
      if (!row) throw new Error(`HD fixture: falta cuenta ${name}`);
      const base = row.currency === "USD" ? balance * HD_ARS_PER_USD : balance;
      const upd = await admin
        .from("accounts")
        .update({ current_balance_original: balance, current_balance_base: base })
        .eq("id", row.id);
      if (upd.error) throw new Error(`HD fixture ${name}: ${upd.error.message}`);
    };
    await fix("Banco Pichincha", -110);
    await fix("Produbanco", 172.73);
    await fix("Efectivo USD", 0);
    await fix("Wells Fargo", 3_914.2);
    await fix("PayPal", 0);
    const wise = await admin
      .from("accounts")
      .insert({
        user_id: persona.userId,
        name: "Wise",
        type: "bank",
        currency: "USD",
        current_balance_original: 100,
        current_balance_base: 100 * HD_ARS_PER_USD,
      })
      .select("id,name,currency")
      .single();
    if (wise.error) throw new Error(`HD Wise: ${wise.error.message}`);
    persona.accounts.push(wise.data);
    await fix("Banco Supervielle", 250_000);
    await fix("Efectivo", 400);
    const galicia = await admin
      .from("accounts")
      .insert({
        user_id: persona.userId,
        name: "Galicia",
        type: "bank",
        currency: "ARS",
        current_balance_original: 50_000,
        current_balance_base: 50_000,
      })
      .select("id,name,currency")
      .single();
    if (galicia.error) throw new Error(`HD Galicia: ${galicia.error.message}`);
    persona.accounts.push(galicia.data);
    // Deudas: 2 tarjetas VIEJAS con ciclo cubierto (saldo histórico, due 0) +
    // 1 crédito vivo. Total deuda = 5.78 + 201.25 + 1000 = 1207.03
    const debts = await admin
      .from("debt_accounts")
      .insert([
        {
          user_id: persona.userId,
          name: "Diners HD",
          type: "credit_card",
          currency: "USD",
          current_balance_original: 5.78,
          current_balance_base: 5_780,
          full_payment_due: 0,
          statement_total_due: 0,
          statement_covered: true,
        },
        {
          user_id: persona.userId,
          name: "Visa HD",
          type: "credit_card",
          currency: "USD",
          current_balance_original: 201.25,
          current_balance_base: 201_250,
          full_payment_due: 0,
          statement_total_due: 0,
          statement_covered: true,
        },
        {
          user_id: persona.userId,
          name: "Crédito Alpaca HD",
          type: "loan",
          currency: "USD",
          current_balance_original: 1_000,
          current_balance_base: 1_000_000,
          full_payment_due: 200,
          statement_covered: false,
        },
      ])
      .select("id,name");
    if (debts.error) throw new Error(`HD debts: ${debts.error.message}`);
    persona.cards = [...(persona.cards ?? []), ...debts.data.filter((d) => d.name !== "Crédito Alpaca HD")];
    persona.hdCardIds = debts.data
      .filter((d) => d.name !== "Crédito Alpaca HD")
      .map((d) => d.id);
    persona.hdLoanId = debts.data.find((d) => d.name === "Crédito Alpaca HD")?.id ?? null;
  }
  if (scenario.seedGoalAdvisory) {
    must(
      await admin.from("income_sources").insert({
        user_id: persona.userId,
        name: "Sueldo GA",
        amount: 1_500,
        currency: "USD",
        frequency: "monthly",
        expected_day: 28,
        is_variable: false,
        destination_account_id: persona.account.id,
      }),
      "GA income",
    );
    must(
      await admin.from("fixed_expenses").insert({
        user_id: persona.userId,
        name: "Arriendo GA",
        amount: 400,
        currency: "USD",
        category: "housing",
        frequency: "monthly",
        expected_day: 10,
        payment_source_type: "account",
        payment_source_id: persona.account.id,
        is_variable: false,
        is_active: true,
      }),
      "GA fixed",
    );
    if (scenario.seedAdvisoryCard) {
      const gaCard = await admin
        .from("debt_accounts")
        .insert({
          user_id: persona.userId,
          name: "Visa GA",
          type: "credit_card",
          currency: "USD",
          current_balance_original: 0,
          current_balance_base: 0,
          full_payment_due: 0,
          statement_covered: true,
        })
        .select("id,name")
        .single();
      if (gaCard.error) throw new Error(`GA card: ${gaCard.error.message}`);
      persona.cards = [...(persona.cards ?? []), gaCard.data];
    }
    // 124 — segunda cuenta en la MISMA moneda: geometría adversarial para el
    // fondeo declarado (la currency-default sigue siendo la principal, así que
    // si el hecho de fondeo no manda, el aporte aterriza en la cuenta equivocada
    // y el check de source_account_id lo delata).
    if (scenario.seedSecondAccount) {
      const secondAccount = await admin
        .from("accounts")
        .insert({
          user_id: persona.userId,
          name: scenario.seedSecondAccount.name,
          type: "bank",
          currency: scenario.seedSecondAccount.currency ?? "USD",
          current_balance_original: scenario.seedSecondAccount.balance ?? 800,
          current_balance_base: scenario.seedSecondAccount.balance ?? 800,
          is_currency_default: false,
        })
        .select("id,name,currency")
        .single();
      if (secondAccount.error) throw new Error(`GA second account: ${secondAccount.error.message}`);
      persona.accounts = [...(persona.accounts ?? []), secondAccount.data];
    }
  }
  if (scenario.seedEtoroTemptation) {
    const temptBase = Date.now() - 3 * 86_400_000;
    const temptAt = (offsetSeconds) =>
      new Date(temptBase + offsetSeconds * 1000).toISOString();
    const tempt = await admin.from("chat_messages").insert([
      {
        user_id: persona.userId,
        role: "user",
        content: "El mes pasado aporté 10$ a Etoro.",
        channel: "telegram",
        chat_id: persona.chatId,
        created_at: temptAt(0),
      },
      {
        user_id: persona.userId,
        role: "assistant",
        content: "Listo, anotado el aporte de 10$ a Etoro.",
        channel: "telegram",
        chat_id: persona.chatId,
        created_at: temptAt(60),
      },
      // Fidelidad al caso real: el antecedente del monto NO es el mensaje
      // inmediatamente anterior (la ventana de una-entrega-atrás legitima al
      // adyacente por diseño — es la que hace funcionar las respuestas).
      {
        user_id: persona.userId,
        role: "user",
        content: "Gracias, todo claro.",
        channel: "telegram",
        chat_id: persona.chatId,
        created_at: temptAt(120),
      },
      {
        user_id: persona.userId,
        role: "assistant",
        content: "¡De nada! Aquí sigo cuando quieras.",
        channel: "telegram",
        chat_id: persona.chatId,
        created_at: temptAt(180),
      },
    ]);
    if (tempt.error) throw new Error(`HR temptation seed: ${tempt.error.message}`);
  }
  if (scenario.seedPattern) {
    const seeds = [12_000, 8_000, 15_000].map((amount, index) => ({
      user_id: persona.userId,
      type: "expense",
      description: `Compra previa ${index + 1}`,
      category: "other",
      original_amount: amount,
      original_currency: "ARS",
      base_amount: amount,
      base_currency: "ARS",
      exchange_rate_to_base: 1,
      source_account_id: persona.account.id,
      occurred_at: new Date(Date.now() - (index + 2) * 86_400_000).toISOString(),
    }));
    const seeded = await admin.from("transactions").insert(seeds).select("id");
    if (seeded.error) throw new Error(`HR seed: ${seeded.error.message}`);
  }
  const before = await financialSnapshot(persona.userId);
  const turns = [];
  const sentMessages = [];
  for (const entry of scenario.turnsScript) {
    const script = typeof entry === "string" ? { text: entry } : entry;
    if (script.onlyIfPrevAsked) {
      const prev = turns.at(-1)?.reply ?? "";
      // Un usuario real sólo contesta si le preguntaron: si el modelo ya
      // registró directo (la conducta ideal), este turno no existe.
      if (!/[?¿]/u.test(prev)) continue;
    }
    sentMessages.push(script.text);
    const result = await turn(persona, script.text);
    turns.push(result);
    console.log(`  [${scenario.id}] U: ${script.text}`);
    console.log(`  [${scenario.id}] K: ${String(result.reply ?? "").slice(0, 220)}`);
  }
  const after = await financialSnapshot(persona.userId);
  const manifests = await ola0ManifestRows(persona.userId);
  const operations = await ola0OperationRows(persona.userId);
  const addedRaw = newTransactions(before, after).filter(
    (row) => !String(row.description ?? "").startsWith("Compra previa"),
  );
  // Aritmética NETA: una corrección legítima produce original + reversa +
  // reemplazo. El estado que importa es el neto — contar filas crudas
  // castigaría al modelo por corregir en vez de duplicar.
  const reversedIds = new Set(
    addedRaw
      .filter((row) => row.type === "reversal" && row.related_transaction_id)
      .map((row) => row.related_transaction_id),
  );
  const added = addedRaw.filter(
    (row) => row.type !== "reversal" && !reversedIds.has(row.id),
  );
  const expect = scenario.expect ?? {};
  const questionReplies = turns
    .map((row) => String(row.reply ?? ""))
    .filter((reply) => /[?¿]/u.test(reply));
  const normalizedQuestions = questionReplies.map((reply) =>
    reply.toLowerCase().replace(/\s+/gu, " ").trim(),
  );
  const checks = [];
  const accountByName = (name) =>
    persona.accounts?.find((row) => row.name === name)?.id ??
    (persona.account?.name === name ? persona.account.id : null);
  for (const expected of expect.writes ?? []) {
    const accountId = expected.accountName ? accountByName(expected.accountName) : null;
    const cardId = expected.cardName
      ? persona.cards?.find((row) => row.name === expected.cardName)?.id ?? null
      : null;
    checks.push({
      name: `HR write ${expected.amount} → ${expected.accountName ?? expected.cardName}`,
      ok: added.some(
        (row) =>
          row.type === expected.type &&
          rounded(row.original_amount) === rounded(expected.amount) &&
          (expected.accountName
            ? row.source_account_id === accountId ||
              row.destination_account_id === accountId
            : true) &&
          (expected.cardName ? row.debt_account_id === cardId : true),
      ),
    });
    checks.push({
      name: "HR writes exactly the expected movements",
      ok: added.length === (expect.writes?.length ?? 0),
    });
  }
  if (expect.requireNoWrite) {
    checks.push({ name: "HR ambiguity writes nothing", ok: added.length === 0 });
  }
  checks.push({
    name: `HR question budget ≤${expect.maxQuestions ?? 0}`,
    ok:
      questionReplies.length <= (expect.maxQuestions ?? 0) &&
      questionReplies.length >= (expect.minQuestions ?? 0),
  });
  if (expect.distinctQuestions) {
    checks.push({
      name: "HR never repeats the same question",
      ok: new Set(normalizedQuestions).size === normalizedQuestions.length,
    });
  }
  checks.push({
    name: "HR a turn never denies its own landed write",
    ok: turns.every(
      (row) =>
        !(
          row.result?.assistantMetadata?.agentOutcome?.wrote === true &&
          writeDeniedWithReceipt(String(row.reply ?? ""), true)
        ),
    ),
  });
  checks.push({
    name: "HR no template prefix, no manifest, no stuck op, no error",
    ok:
      turns.every((row) => !/te falta un dato exacto/iu.test(String(row.reply ?? ""))) &&
      manifests.length === 0 &&
      operations.every((row) => row.status !== "applying") &&
      turns.every(
        (row) => row.result?.assistantMetadata?.agentOutcome?.hadError !== true,
      ),
  });
  if (scenario.group === "hd" || scenario.group === "ga") {
    checks.push({
      name: "HD forbidden refusal/deferral language never appears",
      ok: turns.every((row) => !HD_FORBIDDEN.test(String(row.reply ?? ""))),
    });
  }
  const finalReply = String(turns.at(-1)?.reply ?? "");
  for (const total of expect.finalReplyTotals ?? []) {
    checks.push({
      name: `HD final reply states the exact total ${total}`,
      ok: amountWasStatedInReply(finalReply, total),
    });
  }
  if (expect.replyMustMatch) {
    checks.push({
      name: `HD reply mentions ${expect.replyMustMatch}`,
      ok: new RegExp(expect.replyMustMatch, "iu").test(finalReply),
    });
  }
  if (expect.anyReplyMatches) {
    checks.push({
      name: `GA some reply mentions ${expect.anyReplyMatches}`,
      ok: turns.some((row) =>
        new RegExp(expect.anyReplyMatches, "iu").test(String(row.reply ?? "")),
      ),
    });
  }
  if (expect.maxAnyReplyChars != null) {
    checks.push({
      name: `GA every reply is chat-sized (≤${expect.maxAnyReplyChars} chars)`,
      ok: turns.every((row) => String(row.reply ?? "").length <= expect.maxAnyReplyChars),
    });
  }
  if (expect.maxFinalReplyChars != null) {
    checks.push({
      name: `GA chat-sized reply (≤${expect.maxFinalReplyChars} chars)`,
      ok: finalReply.length <= expect.maxFinalReplyChars,
    });
  }
  if (expect.cardsZeroed) {
    const zeroed = await admin
      .from("debt_accounts")
      .select("id,name,current_balance_original,current_balance_base")
      .in("id", persona.hdCardIds ?? []);
    checks.push({
      name: "HD old card balances were zeroed via snapshot (no payment rows)",
      ok:
        !zeroed.error &&
        (zeroed.data ?? []).length === 2 &&
        (zeroed.data ?? []).every(
          (row) =>
            Math.abs(Number(row.current_balance_original)) <= 0.005 &&
            Math.abs(Number(row.current_balance_base)) <= 0.005,
        ),
    });
  }
  if (expect.loanUntouched != null) {
    const loan = await admin
      .from("debt_accounts")
      .select("current_balance_original")
      .eq("id", persona.hdLoanId ?? "")
      .maybeSingle();
    checks.push({
      name: "HD a card-scoped request never sweeps the loan",
      ok:
        !loan.error &&
        Math.abs(Number(loan.data?.current_balance_original) - expect.loanUntouched) <= 0.005,
    });
  }
  // GA — aserciones por FILAS de metas (la persona nace sin metas: toda fila es
  // del escenario) + tool del motor + presupuesto de duplicados.
  const gaChecked =
    expect.goalRows != null ||
    expect.maxGoals != null ||
    expect.minGoals != null ||
    expect.goalTotalTarget != null ||
    expect.requireToolCalled != null ||
    expect.replyStatesGoalContribution === true ||
    expect.firstTurnNoGoal === true ||
    expect.stagedDates != null;
  if (gaChecked) {
    const goalsRead = await admin
      .from("goals")
      .select("id,name,target_amount,currency,cadence,contribution_amount,target_date,funding_account_id,status,created_at")
      .eq("user_id", persona.userId)
      .neq("status", "cancelled")
      .neq("id", persona.goal?.id ?? "00000000-0000-0000-0000-000000000000")
      .order("created_at");
    const goalRowsDb = goalsRead.error ? null : goalsRead.data ?? [];
    if (goalRowsDb == null) {
      checks.push({ name: "GA goals readable", ok: false });
    } else {
      if (expect.maxGoals != null) {
        checks.push({
          name: `GA at most ${expect.maxGoals} goal(s) exist (no duplicates, no reflex goals)`,
          ok: goalRowsDb.length <= expect.maxGoals,
        });
      }
      if (expect.minGoals != null) {
        checks.push({
          name: `GA at least ${expect.minGoals} goal(s) exist`,
          ok: goalRowsDb.length >= expect.minGoals,
        });
      }
      if (expect.allGoalsCommitted === true) {
        checks.push({
          name: "GA every stage carries its committed contribution",
          ok:
            goalRowsDb.length > 0 &&
            goalRowsDb.every(
              (row) => Number(row.contribution_amount) > 0 && row.cadence != null,
            ),
        });
      }
      for (const wanted of expect.goalRows ?? []) {
        const match = goalRowsDb.find(
          (row) => Math.abs(Number(row.target_amount) - wanted.targetAmount) <= 0.005,
        );
        const dateOk =
          match?.target_date == null
            ? !wanted.requireDate && !wanted.dateAfter && !wanted.dateBefore
            : (wanted.dateAfter == null || match.target_date > wanted.dateAfter) &&
              (wanted.dateBefore == null || match.target_date < wanted.dateBefore);
        checks.push({
          name: `GA goal ${wanted.targetAmount} lands with the agreed plan`,
          ok:
            match != null &&
            (wanted.cadence == null || match.cadence === wanted.cadence) &&
            (wanted.contributionAmount == null ||
              Math.abs(Number(match.contribution_amount) - wanted.contributionAmount) <= 0.005) &&
            (wanted.requireContribution !== true ||
              (Number(match.contribution_amount) > 0 && match.cadence != null)) &&
            (wanted.fundingAccountName == null ||
              match.funding_account_id === accountByName(wanted.fundingAccountName)) &&
            dateOk,
        });
        if (expect.replyStatesGoalContribution === true && match) {
          checks.push({
            name: "GA final reply states the exact committed contribution",
            ok: amountWasStatedInReply(
              String(turns.at(-1)?.reply ?? ""),
              Number(match.contribution_amount),
            ),
          });
        }
      }
      if (expect.goalTotalTarget != null) {
        const total = goalRowsDb.reduce((sum, row) => sum + Number(row.target_amount), 0);
        checks.push({
          name: `GA staged goals total exactly ${expect.goalTotalTarget}`,
          ok: Math.abs(total - expect.goalTotalTarget) <= 0.01,
        });
      }
      if (expect.stagedDates != null) {
        const dates = goalRowsDb.map((row) => row.target_date).filter(Boolean).sort();
        checks.push({
          name: "GA stages carry their own dates (early milestone + final)",
          ok:
            dates.length >= 2 &&
            dates[0] < expect.stagedDates.earlyBefore &&
            dates[dates.length - 1] > expect.stagedDates.lateAfter,
        });
      }
      if (expect.noGoalsBeforeTurn != null) {
        const cutoff = Date.parse(
          String(turns[expect.noGoalsBeforeTurn - 2]?.finishedAt ?? 0),
        );
        checks.push({
          name: `GA planning writes no goal before turn ${expect.noGoalsBeforeTurn}`,
          ok:
            Number.isFinite(cutoff) &&
            goalRowsDb.every((row) => Date.parse(row.created_at) > cutoff),
        });
      }
      if (expect.stagesSequential === true) {
        checks.push({
          name: "GA sequential stages: every stage dated, dates distinct (order enforced by stagedDates)",
          ok:
            goalRowsDb.length >= 2 &&
            goalRowsDb.every((row) => row.target_date) &&
            new Set(goalRowsDb.map((row) => row.target_date)).size ===
              goalRowsDb.length,
        });
      }
      if (expect.firstTurnNoGoal === true) {
        const firstEnd = Date.parse(String(turns[0]?.finishedAt ?? 0));
        checks.push({
          name: "GA an ambitious ask writes no goal before the renegotiation",
          ok:
            Number.isFinite(firstEnd) &&
            goalRowsDb.every((row) => Date.parse(row.created_at) > firstEnd),
        });
      }
    }
    if (expect.requireToolCalled != null) {
      checks.push({
        name: `GA the engine tool ${expect.requireToolCalled} was consulted`,
        ok: turns.some((row) =>
          (row.result?.assistantMetadata?.toolTrace ?? []).some(
            (t) => t?.name === expect.requireToolCalled,
          ),
        ),
      });
    }
  }
  return {
    turns,
    money: moneyResult(checks, {
      transcript: turns.map((row, index) => ({
        user: sentMessages[index],
        assistant: row.reply,
      })),
      added,
      manifests,
      operations: operations.map((row) => ({ id: row.id, status: row.status })),
    }),
  };
}

async function runOla0FrictionScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const goalAmount = rounded(persona.goal.current_amount);
  const movement = {
    type: scenario.type,
    amount: scenario.amount,
    description: scenario.description,
    category: scenario.category,
    occurredAtISO: today,
  };
  if (scenario.currencyArgument) movement.currency = scenario.currency;
  if (persona.sourceCard) movement.debtAccountId = persona.sourceCard.id;
  else if (scenario.type === "income") movement.destinationAccountId = persona.account.id;
  else movement.sourceAccountId = persona.account.id;
  const coachLine = `Tu objetivo ${persona.goal.name} sigue en ${goalAmount} ${persona.currency}.`;
  const result = await turn(persona, scenario.input, {
    mockCompletions: [
      {
        content: null,
        toolCalls: [mockCall(`ola0-${scenario.id.toLowerCase()}`, "log_movement", movement)],
      },
      {
        content: `Listo, registré ${scenario.description} por ${scenario.amount} ${scenario.currency}. ${coachLine}`,
        toolCalls: [],
      },
      {
        content: `Listo, registré ${scenario.description} por ${scenario.amount} ${scenario.currency}. ${coachLine}`,
        toolCalls: [],
      },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const manifests = await ola0ManifestRows(persona.userId);
  const operations = await ola0OperationRows(persona.userId);
  const added = newTransactions(before, after);
  const transaction = added[0] ?? null;
  const expectedType = scenario.type === "income" ? "income" : "expense";
  const balanceBefore = accountBalance(before, persona.account.id);
  const balanceAfter = accountBalance(after, persona.account.id);
  const debtBefore = persona.sourceCard
    ? debtBalance(before, persona.sourceCard.id)
    : null;
  const debtAfter = persona.sourceCard
    ? debtBalance(after, persona.sourceCard.id)
    : null;
  const exactState =
    added.length === 1 &&
    transaction?.type === expectedType &&
    rounded(transaction?.original_amount) === rounded(scenario.amount) &&
    transaction?.original_currency === scenario.currency &&
    (persona.sourceCard
      ? transaction?.debt_account_id === persona.sourceCard.id &&
        balanceAfter === balanceBefore &&
        debtAfter === rounded(debtBefore + scenario.amount)
      : scenario.type === "income"
        ? transaction?.destination_account_id === persona.account.id &&
          balanceAfter === rounded(balanceBefore + scenario.amount)
        : transaction?.source_account_id === persona.account.id &&
          balanceAfter === rounded(balanceBefore - scenario.amount));
  const frictionFailures = ola0FrictionFailures(result, manifests, operations);
  const coachFactPresent =
    result.reply.includes(persona.goal.name) &&
    result.reply.includes(String(goalAmount));
  return {
    turns: [result],
    money: moneyResult(
      [
        { name: "Ola0 ordinary capture writes exact PostgreSQL state", ok: exactState },
        { name: "Ola0 ordinary capture completes in one user turn", ok: frictionFailures.length === 0 },
        { name: "Ola0 coach line carries a real engine fact", ok: coachFactPresent },
      ],
      {
        typedFindings: frictionFailures,
        added,
        accountBefore: balanceBefore,
        accountAfter: balanceAfter,
        debtBefore,
        debtAfter,
        manifests,
        operations,
        coachFact: {
          entity: persona.goal.name,
          amount: goalAmount,
          currency: persona.currency,
          present: coachFactPresent,
        },
      },
    ),
  };
}

/** El hueco que el día real del founder encontró: las patas doradas miden
 * capturas de UN turno, pero el flujo real es aclaración → respuesta →
 * ejecución. El monto vive en el turno anterior de la MISMA operación durable;
 * la respuesta debe ESCRIBIR, sin manifiesto y sin confirmación. */
async function runOla0ClarifiedCaptureScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  // Fiel al flujo real: el turno 1 SÍ llama a la tool sin la moneda, así que la
  // pregunta la produce la maquinaria (needs_info) y la operación queda abierta.
  // Un turno de texto puro cerraría la operación y el turno 2 nacería sin
  // heredar nada — que es justo lo que NO pasa en producción.
  // Transcript REAL del founder (2026-08-21): el turno 1 nombra comercio Y
  // cuenta y sólo falta el monto; el turno 2 lo aporta. El modelo real SÍ manda
  // la cuenta en el turno 2, así que la pata debe mandarla también — omitirla
  // hacía pasar la prueba por el motivo equivocado.
  const ask = await turn(
    persona,
    "Compré una hamburguesa en McDonald's desde Supervielle.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("ola0-clarified-ask", "log_movement", {
              type: "expense",
              description: "Hamburguesa en McDonald's",
              category: "food",
              sourceAccountId: persona.account.id,
              occurredAtISO: today,
            }),
          ],
        },
        {
          content: "¿Cuánto fue la hamburguesa y en qué moneda?",
          toolCalls: [],
        },
        {
          content: "¿Cuánto fue la hamburguesa y en qué moneda?",
          toolCalls: [],
        },
      ],
    },
  );
  const afterAsk = await financialSnapshot(persona.userId);
  const answer = await turn(persona, "Cierto fueron 25 mil.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("ola0-clarified-capture", "log_movement", {
            type: "expense",
            amount: 25_000,
            description: "Hamburguesa en McDonald's",
            category: "food",
            currency: "ARS",
            sourceAccountId: persona.account.id,
            occurredAtISO: today,
          }),
        ],
      },
      {
        content: "Listo, registré Hamburguesa en McDonald's por 25000 ARS desde Supervielle.",
        toolCalls: [],
      },
      {
        content: "Listo, registré Hamburguesa en McDonald's por 25000 ARS desde Supervielle.",
        toolCalls: [],
      },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const manifests = await ola0ManifestRows(persona.userId);
  const operations = await ola0OperationRows(persona.userId);
  const added = newTransactions(before, after);
  const transaction = added[0] ?? null;
  const balanceBefore = accountBalance(before, persona.account.id);
  const balanceAfter = accountBalance(after, persona.account.id);
  // El contrato es sobre el turno que RESPONDE: la operación de la pregunta
  // legítimamente queda abierta (el despacho ordinario no la continúa). Medir
  // su pending como fricción del turno 2 sería un falso rojo.
  const askOperationId =
    ask.result?.assistantMetadata?.durableOperation?.id ?? null;
  const frictionFailures = ola0FrictionFailures(
    answer,
    manifests,
    operations.filter((row) => row.id !== askOperationId),
  );
  return {
    turns: [ask, answer],
    money: moneyResult(
      [
        {
          name: "Ola0 clarification question writes nothing",
          ok: sameValue(before, afterAsk),
        },
        {
          name: "Ola0 answered clarification writes the exact movement",
          ok:
            added.length === 1 &&
            transaction?.type === "expense" &&
            rounded(transaction?.original_amount) === 25_000 &&
            transaction?.original_currency === "ARS" &&
            transaction?.source_account_id === persona.account.id &&
            balanceAfter === rounded(balanceBefore - 25_000),
        },
        {
          name: "Ola0 answered clarification needs no confirmation",
          ok: frictionFailures.length === 0,
        },
      ],
      {
        typedFindings: frictionFailures,
        added,
        accountBefore: balanceBefore,
        accountAfter: balanceAfter,
        manifests,
        operations,
      },
    ),
  };
}

function modelAuthorityCounters(result) {
  const rows = result.result?.assistantMetadata?.loopAdvisories;
  return Array.isArray(rows)
    ? rows.filter((row) => row?.code === "model_authority_counter")
    : [];
}

async function runModelAuthorityL1(persona) {
  const before = await financialSnapshot(persona.userId);
  const ask = await turn(persona, "Compre un cafe en mc con Supervielle", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("ma-l1-ask", "log_movement", {
            type: "expense",
            description: "Café en McDonald's",
            category: "food",
            sourceAccountId: persona.account.id,
            occurredAtISO: today,
          }),
        ],
      },
      { content: "¿Cuánto fue el café?", toolCalls: [] },
      { content: "¿Cuánto fue el café?", toolCalls: [] },
    ],
  });
  const answer = await turn(persona, "30mil", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("ma-l1-write", "log_movement", {
            type: "expense",
            amount: 30_000,
            description: "Café en McDonald's",
            category: "food",
            sourceAccountId: persona.account.id,
            occurredAtISO: today,
          }),
        ],
      },
      {
        content: "Listo, registré 30.000 ARS desde Banco Supervielle.",
        toolCalls: [],
      },
      {
        content: "Listo, registré 30.000 ARS desde Banco Supervielle.",
        toolCalls: [],
      },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const manifests = await ola0ManifestRows(persona.userId);
  const answerOperationId = answer.result?.assistantMetadata?.durableOperation?.id;
  const answerOps = (await ola0OperationRows(persona.userId)).filter(
    (row) => row.id === answerOperationId,
  );
  const friction = ola0FrictionFailures(answer, manifests, answerOps);
  return {
    turns: [ask, answer],
    money: moneyResult(
      [
        {
          name: "L1 asks only the legitimately missing amount",
          ok:
            (ask.reply.match(/\?/g) ?? []).length === 1 &&
            !ask.reply.includes("Te falta un dato exacto:") &&
            newTransactions(before, await financialSnapshot(persona.userId)).length === 1,
        },
        {
          name: "L1 writes the clarified compact amount immediately",
          ok:
            added.length === 1 &&
            added[0]?.type === "expense" &&
            rounded(added[0]?.original_amount) === 30_000 &&
            added[0]?.source_account_id === persona.account.id &&
            accountBalance(after, persona.account.id) ===
              rounded(accountBalance(before, persona.account.id) - 30_000),
        },
        {
          name: "L1 creates no manifest or second confirmation",
          ok: friction.length === 0,
        },
      ],
      { added, manifests, friction },
    ),
  };
}

async function runModelAuthorityL2(persona) {
  const before = await financialSnapshot(persona.userId);
  const turns = [];
  turns.push(
    await turn(persona, "super bill", {
      mockCompletions: [
        {
          content: "¿Te referís a Banco Supervielle, y cuánto fue la compra?",
          toolCalls: [],
        },
      ],
    }),
  );
  turns.push(
    await turn(persona, "Tarjeta supervielle", {
      mockCompletions: [
        {
          content: "Entendí Banco Supervielle como la cuenta o débito, no como una tarjeta de crédito.",
          toolCalls: [],
        },
      ],
    }),
  );
  turns.push(
    await turn(persona, "25mil", {
      mockCompletions: [
        { content: "Tomo 25.000 ARS para esta compra.", toolCalls: [] },
      ],
    }),
  );
  turns.push(
    await turn(persona, "Fue banco supervielle", {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("ma-l2-write", "log_movement", {
              type: "expense",
              amount: 25_000,
              description: "Compra aclarada",
              category: "other",
              sourceAccountId: persona.account.id,
              occurredAtISO: today,
            }),
          ],
        },
        {
          content: "Listo, registré 25.000 ARS desde Banco Supervielle.",
          toolCalls: [],
        },
        {
          content: "Listo, registré 25.000 ARS desde Banco Supervielle.",
          toolCalls: [],
        },
      ],
    }),
  );
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const manifests = await ola0ManifestRows(persona.userId);
  const operations = await ola0OperationRows(persona.userId);
  const questions = turns.reduce(
    (count, row) => count + (row.reply.split("?").length > 1 ? 1 : 0),
    0,
  );
  return {
    turns,
    money: moneyResult(
      [
        { name: "L2 asks at most one natural question", ok: questions <= 1 },
        {
          name: "L2 lands one exact debit-account movement",
          ok:
            added.length === 1 &&
            rounded(added[0]?.original_amount) === 25_000 &&
            added[0]?.source_account_id === persona.account.id,
        },
        {
          name: "L2 creates no manifest, conflict or stuck operation",
          ok:
            manifests.length === 0 &&
            operations.every((row) => row.status !== "applying") &&
            turns.every(
              (row) =>
                row.result?.assistantMetadata?.loopDiagnostic?.code !== "conflict" &&
                row.result?.assistantMetadata?.agentOutcome?.hadError !== true,
            ),
        },
      ],
      { added, manifests, operations, questionEpisodes: questions },
    ),
  };
}

async function runModelAuthorityL3(persona) {
  const before = await financialSnapshot(persona.userId);
  const result = await turn(
    persona,
    "Compré un tallarín chino por $25.000",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("ma-l3-write", "log_movement", {
              type: "expense",
              amount: 25_000,
              description: "Tallarín chino",
              category: "food",
              sourceAccountId: persona.account.id,
              occurredAtISO: today,
            }),
          ],
        },
        {
          content:
            "Registré 25.000 ARS desde Banco Supervielle, que tomé como tu patrón — avísame si era otra.",
          toolCalls: [],
        },
        {
          content:
            "Registré 25.000 ARS desde Banco Supervielle, que tomé como tu patrón — avísame si era otra.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const counters = modelAuthorityCounters(result);
  return {
    turns: [result],
    money: moneyResult(
      [
        {
          name: "L3 accepts the model-selected owned same-currency account",
          ok:
            added.length === 1 &&
            rounded(added[0]?.original_amount) === 25_000 &&
            added[0]?.source_account_id === persona.account.id,
        },
        {
          name: "L3 reports the degraded authority guard as a bounded counter",
          ok:
            counters.length > 0 &&
            counters.every(
              (row) =>
                row.capability === "log_movement" &&
                ["would_have_asked", "would_have_blocked"].includes(row.verdict) &&
                typeof row.reason === "string" &&
                !JSON.stringify(row).includes("tallarín"),
            ),
        },
      ],
      { added, counters },
    ),
  };
}

async function runModelAuthorityL4(persona) {
  const remember = await turn(
    persona,
    "Para mí, 'su perrito' quiere decir Banco Supervielle.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("ma-l4-remember", "remember_fact", {
              noteType: "preference",
              content: "Alias de Banco Supervielle",
            }),
          ],
        },
        { content: "Entendido: voy a recordar ese alias.", toolCalls: [] },
      ],
    },
  );
  const before = await financialSnapshot(persona.userId);
  const useAlias = await turn(
    persona,
    "Compré un café de seis mil pesos con su perrito.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("ma-l4-write", "log_movement", {
              type: "expense",
              amount: 6_000,
              description: "Café",
              category: "food",
              sourceAccountId: persona.account.id,
              occurredAtISO: today,
            }),
          ],
        },
        {
          content:
            "Registré 6.000 ARS desde Banco Supervielle — interpreté 'su perrito' como ese banco; avísame si era otra.",
          toolCalls: [],
        },
        {
          content:
            "Registré 6.000 ARS desde Banco Supervielle — interpreté 'su perrito' como ese banco; avísame si era otra.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const notes = must(
    await admin
      .from("user_context_notes")
      .select("note_type,content,is_active")
      .eq("user_id", persona.userId)
      .eq("is_active", true),
    "L4 remembered alias",
  );
  const added = newTransactions(before, after);
  return {
    turns: [remember, useAlias],
    money: moneyResult(
      [
        {
          name: "L4 stores the user-authored alias, never the model paraphrase",
          ok:
            notes.some(
              (row) =>
                row.content ===
                  "Para mí, 'su perrito' quiere decir Banco Supervielle.",
            ) &&
            remember.result?.assistantMetadata?.toolTrace?.some(
              (row) => row.name === "remember_fact" && row.status === "done",
            ),
        },
        {
          name: "L4 next episode consumes the learned alias and declares it inline",
          ok:
            added.length === 1 &&
            added[0]?.source_account_id === persona.account.id &&
            useAlias.reply.includes("Banco Supervielle") &&
            useAlias.reply.includes("su perrito"),
        },
      ],
      { notes, added },
    ),
  };
}

async function runModelAuthorityL6(persona) {
  const before = await financialSnapshot(persona.userId);
  const fixtureText = "fixture applying sin manifiesto";
  const root = must(
    await admin
      .from("chat_messages")
      .insert({
        user_id: persona.userId,
        role: "user",
        content: fixtureText,
        channel: "telegram",
        chat_id: persona.chatId,
        metadata: { source: "m0-model-authority-l6" },
      })
      .select("id")
      .single(),
    "L6 root message",
  );
  const deliveryKey = `m0-model-authority:l6:${randomUUID()}`;
  const claimed = must(
    await admin.rpc("kipu_claim_agent_operation", {
      p: {
        user_id: persona.userId,
        operation_key: deliveryKey,
        channel: "telegram",
        chat_id: persona.chatId,
        root_message_id: root.id,
        request_text: fixtureText,
        continuation_operation_id: null,
        supersede_operation_ids: [],
        abandon_operation_ids: [],
        expected_operation_versions: {},
      },
    }),
    "L6 claim",
  );
  const operation = Array.isArray(claimed) ? claimed[0] : claimed;
  const argumentsRow = {
    type: "expense",
    amount: 9_999,
    currency: "ARS",
    description: "L6 no ejecutado",
    sourceAccountId: persona.account.id,
  };
  const stagedRaw = must(
    await admin.rpc("kipu_stage_agent_loop_step", {
      p: {
        user_id: persona.userId,
        operation_id: operation.id,
        expected_version: operation.state_version,
        delivery_key: deliveryKey,
        lease_token: operation.lease_token,
        seq: 0,
        capability: "log_movement",
        arguments: argumentsRow,
        effect_mode: "economic_event",
      },
    }),
    "L6 stage",
  );
  const staged = Array.isArray(stagedRaw) ? stagedRaw[0] : stagedRaw;
  must(
    await admin.rpc("kipu_record_agent_operation_step_outcome", {
      p: {
        user_id: persona.userId,
        operation_id: operation.id,
        step_key: staged.step_key,
        capability: "log_movement",
        arguments: argumentsRow,
        tool_status: "refused",
        execution_effect: "needs_info",
        result: { summary: "fixture terminal L6" },
        affected_refs: [],
        lease_token: operation.lease_token,
      },
    }),
    "L6 terminal receipt",
  );
  const cancelled = await turn(persona, "Cancela la operación", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("ma-l6-cancel", "reject_operation", {
            operationId: operation.id,
            reason: "El usuario abandona la operación pendiente.",
          }),
        ],
      },
      {
        content: "La operación pendiente quedó cancelada de verdad.",
        toolCalls: [],
      },
    ],
  });
  const finalOperation = must(
    await admin
      .from("agent_operations")
      .select("status,last_error,lease_token,pending_question")
      .eq("user_id", persona.userId)
      .eq("id", operation.id)
      .single(),
    "L6 final operation",
  );
  const after = await financialSnapshot(persona.userId);
  return {
    turns: [cancelled],
    money: moneyResult(
      [
        {
          name: "L6 cancellation terminates the real manifest-less applying operation",
          ok:
            finalOperation.status === "abandoned" &&
            finalOperation.last_error?.code === "failed_quarantined" &&
            finalOperation.last_error?.reason_code === "user_abandoned" &&
            finalOperation.lease_token == null &&
            finalOperation.pending_question == null,
        },
        {
          name: "L6 cancellation preserves money and reaches the model",
          ok:
            sameValue(before, after) &&
            cancelled.reply ===
              "La operación pendiente quedó cancelada de verdad." &&
            cancelled.result?.assistantMetadata?.agentOutcome?.hadError === false,
        },
      ],
      { operationId: operation.id, finalOperation },
    ),
  };
}

function ola0ReadCompletions(label) {
  return [
    {
      content: null,
      toolCalls: [mockCall(`ola0-read-${label}`, "get_financial_context", {})],
    },
    {
      content: "Tu panorama sigue disponible con los saldos actuales.",
      toolCalls: [],
    },
  ];
}

async function runOla0LongConversationScenario(scenario, persona) {
  const turns = [];
  const run = async (message, mockCompletions) => {
    const result = await turn(persona, message, { mockCompletions });
    turns.push(result);
    return result;
  };
  const before = await financialSnapshot(persona.userId);
  await run("¿Cómo están mis cuentas?", ola0ReadCompletions("01"));
  await run("Gracias, solo quería ver el panorama.", [
    { content: "Claro, seguimos desde aquí cuando quieras.", toolCalls: [] },
  ]);
  await run("Anota un café de 3$ desde Pichincha.", [
    {
      content: null,
      toolCalls: [
        mockCall("ola0-long-write-before", "log_movement", {
          type: "expense",
          amount: 3,
          description: "Café",
          category: "food",
          sourceAccountId: persona.account.id,
          occurredAtISO: today,
        }),
      ],
    },
    { content: "Listo, registré el café por 3$ desde Pichincha.", toolCalls: [] },
    { content: "Listo, registré el café por 3$ desde Pichincha.", toolCalls: [] },
  ]);
  await run("¿Cuánto tengo ahora en Pichincha?", ola0ReadCompletions("04"));
  await run("¿Y mi objetivo sigue activo?", ola0ReadCompletions("05"));
  await run("Perfecto, no cambies nada más todavía.", [
    { content: "Entendido, no cambio nada.", toolCalls: [] },
  ]);
  await run("Recuérdame el panorama una vez más.", ola0ReadCompletions("07"));
  await run("Cancela mi objetivo Objetivo Ola 0.", [
    {
      content: null,
      toolCalls: [
        mockCall("ola0-long-sensitive", "update_goal", {
          goalId: persona.goal.id,
          status: "cancelled",
          confirm: true,
        }),
      ],
    },
    {
      content: "Preparé cancelar el objetivo Objetivo Ola 0. ¿Confirmas?",
      toolCalls: [],
    },
  ]);
  const pendingAtMidpoint = await ola0ManifestRows(persona.userId);
  await run("Déjala pendiente; muéstrame solamente mis saldos.", ola0ReadCompletions("09"));
  await run("No confirmo esa cancelación todavía. ¿Cómo va mi objetivo?", ola0ReadCompletions("10"));
  const beforePostCapture = await financialSnapshot(persona.userId);
  const postCapture = await run("Anota un taxi de 4$ desde Pichincha.", [
    {
      content: null,
      toolCalls: [
        mockCall("ola0-long-write-after", "log_movement", {
          type: "expense",
          amount: 4,
          description: "Taxi",
          category: "transport",
          sourceAccountId: persona.account.id,
          occurredAtISO: today,
        }),
      ],
    },
    { content: "Listo, registré el taxi por 4$ desde Pichincha.", toolCalls: [] },
    { content: "Listo, registré el taxi por 4$ desde Pichincha.", toolCalls: [] },
  ]);
  await run("¿Cuáles fueron mis dos gastos de hoy?", ola0ReadCompletions("12"));
  await run("Gracias, conserva pendiente la cancelación del objetivo.", [
    { content: "De acuerdo: la propuesta sigue pendiente y no hice cambios nuevos.", toolCalls: [] },
  ]);
  await run("Dame una última lectura de mis cuentas.", ola0ReadCompletions("14"));
  await run("Eso es todo por ahora.", [
    { content: "Listo, dejamos la conversación aquí.", toolCalls: [] },
  ]);
  const after = await financialSnapshot(persona.userId);
  const finalManifests = await ola0ManifestRows(persona.userId);
  const operations = await ola0OperationRows(persona.userId);
  const preAndPost = newTransactions(before, after).filter(
    (row) => row.type === "expense",
  );
  const postOnly = newTransactions(beforePostCapture, after).filter(
    (row) => row.type === "expense",
  );
  const pending = pendingAtMidpoint.find((row) => row.status === "proposed") ?? null;
  const samePending = pending
    ? finalManifests.some(
        (row) =>
          row.id === pending.id &&
          row.status === "proposed" &&
          row.manifest_hash === pending.manifest_hash &&
          sameValue(row.manifest, pending.manifest),
      )
    : false;
  const postFrictionFailures = ola0FrictionFailures(
    postCapture,
    finalManifests.filter((row) => row.id !== pending?.id),
    operations.filter(
      (row) => row.id === postCapture.result?.assistantMetadata?.durableOperation?.id,
    ),
  );
  const durableHealthy =
    samePending &&
    operations.every((row) => !["applying", "failed_quarantined"].includes(row.status));
  return {
    turns,
    money: moneyResult(
      [
        { name: "Ola0 long conversation executes at least fifteen chained turns", ok: turns.length >= 15 },
        {
          name: "Ola0 long conversation keeps exact ordinary captures",
          ok:
            preAndPost.length === 2 &&
            preAndPost.some((row) => rounded(row.original_amount) === 3) &&
            postOnly.length === 1 &&
            rounded(postOnly[0]?.original_amount) === 4 &&
            postOnly[0]?.source_account_id === persona.account.id,
        },
        {
          name: "Ola0 pending proposal does not contaminate later ordinary capture",
          ok: postFrictionFailures.length === 0,
        },
        {
          name: "Ola0 pending durable state remains coherent",
          ok: durableHealthy,
        },
      ],
      {
        typedFindings: postFrictionFailures,
        turnCount: turns.length,
        transactions: preAndPost,
        postCaptureTransactions: postOnly,
        pendingAtMidpoint,
        finalManifests,
        operations,
        durableHealthy,
      },
    ),
  };
}

async function runDryStackedCancelScenario(scenario, persona) {
  // Reproduce el caso real 00:43: dos needs_info de EXECUTOR consecutivos
  // (aporte USD desde cuenta ARS — rechazo FX legítimo) dejan dos operaciones
  // awaiting_input apiladas; el «cancela» de un usuario real debe cerrarlas
  // con voz humana, jamás morir en Error/SEQUENCE_INVALID.
  const arsSeed = await admin
    .from("accounts")
    .insert({
      user_id: persona.userId,
      name: "Galicia MOCK",
      type: "bank",
      currency: "ARS",
      current_balance_original: 250_000,
      current_balance_base: 250,
    })
    .select("id,name,currency")
    .single();
  if (arsSeed.error) throw new Error(`ARS seed: ${arsSeed.error.message}`);
  const arsAccount = arsSeed.data;
  const askTurn = (key) => ({
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall(key, "record_investment_contribution", {
            sourceAccountId: arsAccount?.id ?? persona.account.id,
            assetId: persona.asset?.id,
            amount: 20,
            currency: "USD",
            occurredAtISO: today,
            description: "Aporte a eToro MOCK",
            statedAmountQuote: "20 dólares",
          }),
        ],
      },
      { content: "¿Cuántos ARS salieron para esos 20 USD?", toolCalls: [] },
      { content: "¿Cuántos ARS salieron para esos 20 USD?", toolCalls: [] },
    ],
  });
  const turn1 = await turn(persona, "Aporté 20 dólares a eToro desde mi cuenta en pesos.", askTurn("stk-1"));
  const turn2 = await turn(persona, "Usa el tipo de cambio que tengas para ese cálculo.", askTurn("stk-2"));
  const opsBefore = await ola0OperationRows(persona.userId);
  const cancel = await turn(persona, "Mmm mejor cancela la operación.", {
    mockCompletions: [
      { content: "Listo, lo dejé cancelado. Cuando tengas el monto en pesos lo registramos.", toolCalls: [] },
      { content: "Listo, lo dejé cancelado. Cuando tengas el monto en pesos lo registramos.", toolCalls: [] },
    ],
  });
  const opsAfter = await ola0OperationRows(persona.userId);
  const manifests = await ola0ManifestRows(persona.userId);
  return {
    turns: [turn1, turn2, cancel],
    money: moneyResult(
      [
        {
          name: "Questions never stack: zero awaiting operations before the cancel",
          ok: opsBefore.every((row) => row.status !== "awaiting_input"),
        },
        {
          name: "Cancel never dies: no turn error, no sequence failure, human reply",
          ok:
            cancel.result?.assistantMetadata?.agentOutcome?.hadError !== true &&
            cancel.reply.length > 0 &&
            !/reintenta este mismo mensaje/iu.test(cancel.reply),
        },
        {
          name: "No operation remains applying and no manifest was staged",
          ok:
            manifests.length === 0 &&
            opsAfter.every((row) => row.status !== "applying"),
        },
      ],
      {
        opsBefore: opsBefore.map((row) => ({ id: row.id.slice(0, 8), st: row.status })),
        opsAfter: opsAfter.map((row) => ({ id: row.id.slice(0, 8), st: row.status })),
        cancelReply: cancel.reply,
        cancelDiag: cancel.result?.assistantMetadata?.loopDiagnostic ?? null,
      },
    ),
  };
}

async function runDryQuotedSlangScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  // «gambas» NO está en ninguna gramática del servidor: sólo la inteligencia
  // del modelo la interpreta, y el servidor exige la cita literal como testigo.
  const goodQuote = await turn(persona, "Anota 9 gambas de taxi desde Produbanco.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-quote-1", "log_movement", {
            type: "expense",
            amount: 900,
            description: "Taxi",
            category: "transport",
            sourceAccountId: persona.account.id,
            occurredAtISO: today,
            statedAmountQuote: "9 gambas",
          }),
        ],
      },
      { content: "Listo, registré 900 de taxi desde Produbanco.", toolCalls: [] },
      { content: "Listo, registré 900 de taxi desde Produbanco.", toolCalls: [] },
    ],
  });
  const afterGood = await financialSnapshot(persona.userId);
  const goodAdded = newTransactions(before, afterGood);
  const badQuote = await turn(persona, "Anota el gasto del cine.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-quote-2", "log_movement", {
            type: "expense",
            amount: 4_500,
            description: "Cine",
            category: "entertainment",
            sourceAccountId: persona.account.id,
            occurredAtISO: today,
            statedAmountQuote: "cuatro lucas y media",
          }),
        ],
      },
      { content: "¿Cuánto fue el cine?", toolCalls: [] },
      { content: "¿Cuánto fue el cine?", toolCalls: [] },
    ],
  });
  const afterBad = await financialSnapshot(persona.userId);
  const badAdded = newTransactions(afterGood, afterBad);
  const manifests = await ola0ManifestRows(persona.userId);
  return {
    turns: [goodQuote, badQuote],
    money: moneyResult(
      [
        {
          name: "Unknown slang writes when its literal quote lives in the episode",
          ok:
            goodAdded.length === 1 &&
            rounded(goodAdded[0]?.original_amount) === 900 &&
            goodQuote.result?.assistantMetadata?.agentOutcome?.hadError !== true,
        },
        {
          name: "A fabricated quote never authorizes: no write, one question",
          ok:
            badAdded.length === 0 &&
            /[?¿]/u.test(badQuote.reply) &&
            badQuote.result?.assistantMetadata?.agentOutcome?.hadError !== true,
        },
        {
          name: "Neither path stages a manifest",
          ok: manifests.length === 0,
        },
      ],
      { goodAdded, badAdded, manifests },
    ),
  };
}

async function runDryUnstatedAskScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const result = await turn(persona, "Anota el gasto del súper de siempre.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-unstated", "log_movement", {
            type: "expense",
            amount: 12_345,
            description: "Súper",
            category: "food",
            sourceAccountId: persona.account.id,
            occurredAtISO: today,
          }),
        ],
      },
      { content: "¿De cuánto fue el súper esta vez?", toolCalls: [] },
      { content: "¿De cuánto fue el súper esta vez?", toolCalls: [] },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const manifests = await ola0ManifestRows(persona.userId);
  const advisories = Array.isArray(
    result.result?.assistantMetadata?.loopAdvisories,
  )
    ? result.result.assistantMetadata.loopAdvisories
    : [];
  return {
    turns: [result],
    money: moneyResult(
      [
        {
          name: "Unstated amount never writes and never stages a manifest",
          ok: added.length === 0 && manifests.length === 0,
        },
        {
          name: "Unstated amount becomes ONE natural model question",
          ok:
            /[?¿]/u.test(result.reply) &&
            result.result?.assistantMetadata?.agentOutcome?.hadError !== true,
        },
        {
          name: "The question is conversational: no operation left awaiting",
          ok: (await ola0OperationRows(persona.userId)).every(
            (row) => row.status !== "awaiting_input",
          ),
        },
        {
          name: "The degraded-authority counter still records the verdict",
          ok: advisories.some(
            (row) =>
              row?.code === "model_authority_counter" &&
              row?.counter === "server_monetary_evidence" &&
              row?.reason === "unstated_amount",
          ),
        },
      ],
      { added, manifests, advisories, reply: result.reply },
    ),
  };
}

async function runDryWriteScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const result = await turn(persona, "Registré un café de 5 dólares hoy desde Produbanco.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-write", "log_movement", {
            type: "expense",
            amount: 5,
            description: "Café",
            category: "food",
            sourceAccountId: persona.account.id,
            occurredAtISO: today,
          }),
        ],
      },
      {
        content: "Listo, registré el café por 5$ desde Produbanco.",
        toolCalls: [],
      },
      {
        content: "Listo, registré el café por 5$ desde Produbanco.",
        toolCalls: [],
      },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  return {
    turns: [result],
    money: moneyResult(
      [
        { name: "ordinary dry write creates one expense", ok: added.length === 1 && added[0]?.type === "expense" },
        { name: "ordinary dry write has exact amount/source", ok: rounded(added[0]?.original_amount) === 5 && added[0]?.source_account_id === persona.account.id && accountBalance(after, persona.account.id) === accountBalance(before, persona.account.id) - 5 },
      ],
      { added },
    ),
  };
}

async function runDryInvestmentProposalScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const result = await turn(
    persona,
    "Aporté 75 USD desde Produbanco a eToro MOCK.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall(
              "dry-investment-proposal",
              "record_investment_contribution",
              {
                sourceAccountId: persona.account.id,
                assetId: persona.asset.id,
                amount: 75,
                currency: "USD",
                occurredAtISO: today,
                description: "Aporte a eToro MOCK",
              },
            ),
          ],
        },
        {
          content:
            "Listo, aporté 75 USD desde Produbanco a eToro MOCK; bajó la cuenta y subió el activo.",
          toolCalls: [],
        },
        {
          content:
            "Listo, aporté 75 USD desde Produbanco a eToro MOCK; bajó la cuenta y subió el activo.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const manifests = must(
    await admin
      .from("agent_operation_manifests")
      .select("status,manifest")
      .eq("user_id", persona.userId),
    "dry investment proposal manifests",
  );
  const added = newTransactions(before, after);
  const beforeAsset = before.assets.find((row) => row.id === persona.asset.id);
  const afterAsset = after.assets.find((row) => row.id === persona.asset.id);
  return {
    turns: [result],
    money: moneyResult(
      [
        {
          name: "investment contribution writes exactly one atomic ledger event",
          ok:
            added.length === 1 &&
            rounded(added[0]?.original_amount) === 75 &&
            added[0]?.source_account_id === persona.account.id,
        },
        {
          name: "investment contribution moves cash and asset atomically",
          ok:
            accountBalance(after, persona.account.id) ===
              rounded(accountBalance(before, persona.account.id) - 75) &&
            rounded(afterAsset?.value_original) ===
              rounded(Number(beforeAsset?.value_original ?? 0) + 75),
        },
        {
          name: "investment contribution needs no manifest or vague deferral",
          ok:
            manifests.length === 0 &&
            result.reply.includes("75") &&
            result.reply.includes("Produbanco") &&
            result.reply.includes("eToro MOCK") &&
            !result.reply.includes("Dame un segundo"),
        },
      ],
      { before, after, manifests, added, reply: result.reply },
    ),
  };
}

async function runDryUpdateAssetTruthScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const result = await turn(persona, "eToro MOCK ahora vale 550 USD.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-update-asset-truth", "update_asset", {
            assetId: persona.asset.id,
            newValue: 550,
          }),
        ],
      },
      {
        content:
          "Actualicé eToro MOCK a 550 USD. Esto no movió dinero de ninguna cuenta; sólo cambió el patrimonio.",
        toolCalls: [],
      },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const steps = must(
    await admin
      .from("agent_operation_steps")
      .select("capability,status,result")
      .eq("user_id", persona.userId)
      .eq("capability", "update_asset"),
    "dry update asset steps",
  );
  const receipt = steps.at(-1)?.result ?? null;
  return {
    turns: [result],
    money: moneyResult(
      [
        {
          name: "asset revaluation changes only the asset",
          ok:
            accountBalance(before, persona.account.id) ===
              accountBalance(after, persona.account.id) &&
            before.transactions.length === after.transactions.length &&
            rounded(after.assets.find((row) => row.id === persona.asset.id)?.value_base) ===
              550,
        },
        {
          name: "asset revaluation durable receipt declares movedMoney false",
          ok:
            receipt?.data?.movedMoney === false &&
            receipt?.data?.assetId === persona.asset.id,
        },
        {
          name: "asset revaluation reply proactively denies cash movement",
          ok: result.reply.includes("no movió dinero de ninguna cuenta"),
        },
      ],
      { before, after, steps, reply: result.reply },
    ),
  };
}

async function runDrySensitiveScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const proposal = await turn(persona, "Cancela mi objetivo Viaje a Cartagena.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-sensitive", "update_goal", {
            goalId: persona.goal.id,
            status: "cancelled",
            confirm: true,
          }),
        ],
      },
      {
        content: "Preparé cancelar Viaje a Cartagena. ¿Confirmas?",
        toolCalls: [],
      },
    ],
  });
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed"),
    "dry sensitive proposal",
  );
  const operationId = proposed[0]?.operation_id;
  const repeated = await turn(persona, "Sí, es Viaje a Cartagena; conserva esos mismos datos.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-sensitive-repeat", "update_goal", {
            goalId: persona.goal.id,
            status: "cancelled",
            confirm: true,
          }),
        ],
      },
      {
        content:
          "Esos datos ya estaban en la propuesta y no la dupliqué. ¿Confirmas cancelar exactamente ese objetivo?",
        toolCalls: [],
      },
    ],
  });
  const repeatedProposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed"),
    "dry sensitive unchanged proposal",
  );
  const confirmed = await turn(persona, "Sí, cancela exactamente ese objetivo.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-confirm", "confirm_operation", {
            operationId,
            rationale: "El usuario confirmó la propuesta exacta en otra entrega.",
          }),
        ],
      },
      {
        content: "Listo, cancelé el objetivo Viaje a Cartagena.",
        toolCalls: [],
      },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const finalGoal = must(
    await admin
      .from("goals")
      .select("id,status")
      .eq("user_id", persona.userId)
      .eq("id", persona.goal.id)
      .single(),
    "dry sensitive goal",
  );
  const verified = must(
    await admin
      .from("agent_operation_manifests")
      .select("status,manifest_hash,manifest,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", operationId),
    "dry sensitive verified",
  );
  return {
    turns: [proposal, repeated, confirmed],
    money: moneyResult(
      [
        { name: "sensitive proposal writes nothing before confirmation", ok: proposed.length === 1 && proposed[0]?.manifest?.actions?.length === 1 },
        { name: "identical re-proposal remains one unchanged manifest", ok: repeatedProposed.length === 1 && repeatedProposed[0]?.manifest_hash === proposed[0]?.manifest_hash },
        { name: "sensitive confirmation cancels the exact goal", ok: finalGoal.status === "cancelled" },
        { name: "sensitive manifest is verified with stable hash", ok: verified.length === 1 && verified[0]?.status === "verified" && verified[0]?.manifest_hash === proposed[0]?.manifest_hash },
        { name: "sensitive goal cancellation moves no ledger money", ok: after.transactions.length === before.transactions.length },
      ],
      { finalGoal, proposed: proposed[0] ?? null, repeatedProposed: repeatedProposed[0] ?? null, verified: verified[0] ?? null },
    ),
  };
}

async function runDryOriginScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const result = await turn(
    persona,
    "Hola. Ya pagué mi Diners en full, 22.14 de la Produbanco MV y 201.25 de la Titanium MV.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: persona.cards.map((card, index) =>
            mockCall(`dry-origin-${index + 1}`, "register_card_payment", {
              cardName: card.name,
              paidInFull: card.name === "Diners NT",
              ...(card.name === "Diners NT"
                ? {}
                : { amount: rounded(card.current_balance_original) }),
              fromAccount: persona.account.id,
              date: today,
            }),
          ),
        },
        {
          content:
            "Listo, registré los tres pagos desde Produbanco por 50,60, 22,14 y 201,25 USD.",
          toolCalls: [],
        },
        {
          content:
            "Listo, registré los tres pagos desde Produbanco por 50,60, 22,14 y 201,25 USD.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed"),
    "dry origin proposal",
  );
  return {
    turns: [result],
    money: moneyResult(
      [
        {
          name: "model-selected owned source executes three payments immediately",
          ok:
            newTransactions(before, after).filter((row) => row.type === "debt_payment").length === 3,
        },
        {
          name: "model-selected source creates no manifest and uses the owned account",
          ok:
            proposed.length === 0 &&
            newTransactions(before, after)
              .filter((row) => row.type === "debt_payment")
              .every((row) => row.source_account_id === persona.account.id),
        },
      ],
      { proposed, added: newTransactions(before, after) },
    ),
  };
}

async function runDryCapitalScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const result = await turn(
    persona,
    "María me devolvió 83.86 en Produbanco. Era capital de un préstamo que yo le había hecho y nunca registré.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-capital-propose", "record_person_payment", {
              direction: "in",
              amount: 83.86,
              person: "María",
              reason: "Devolución de capital no registrada",
              accountId: persona.account.id,
              inflowKind: "capital_return_unrecorded",
              occurredAtISO: today,
            }),
          ],
        },
        {
          content:
            "Listo, registré 83.86 USD en Produbanco como devolución de capital; no lo conté como ingreso.",
          toolCalls: [],
        },
        {
          content:
            "Listo, registré 83.86 USD en Produbanco como devolución de capital; no lo conté como ingreso.",
          toolCalls: [],
        },
      ],
    },
  );
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed"),
    "dry capital proposal",
  );
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  return {
    turns: [result],
    money: moneyResult(
      [
        {
          name: "capital return is ordinary registration with no manifest",
          ok: proposed.length === 0,
        },
        {
          name: "capital return lands once as adjustment",
          ok:
            added.length === 1 &&
            added[0]?.type === "adjustment" &&
            rounded(added[0]?.original_amount) === 83.86 &&
            added[0]?.destination_account_id === persona.account.id,
        },
        {
          name: "capital return balance settles exactly",
          ok:
            accountBalance(after, persona.account.id) ===
              rounded(accountBalance(before, persona.account.id) + 83.86),
        },
      ],
      { added, proposed },
    ),
  };
}

async function runDryLoanOutScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const result = await turn(
    persona,
    "Le presté 25 a María desde Produbanco; quedó debiéndomelos.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [mockCall("dry-loan-read", "list_open_receivables", {})],
        },
        {
          content: null,
          toolCalls: [
            mockCall("dry-loan-out", "record_person_payment", {
              direction: "out",
              amount: 25,
              person: "María",
              accountId: persona.account.id,
              isLoan: true,
              occurredAtISO: today,
            }),
          ],
        },
        {
          content: "Listo, prestaste 25 USD a María desde Produbanco y quedó como dinero por cobrar.",
          toolCalls: [],
        },
        {
          content: "Listo, prestaste 25 USD a María desde Produbanco y quedó como dinero por cobrar.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const created = after.receivables.filter(
    (row) => !before.receivables.some((prior) => prior.id === row.id),
  );
  return {
    turns: [result],
    money: moneyResult(
      [
        {
          name: "loan out writes exact expense and receivable",
          ok:
            added.length === 1 &&
            added[0]?.type === "expense" &&
            rounded(added[0]?.original_amount) === 25 &&
            created.length === 1 &&
            rounded(created[0]?.outstanding_amount) === 25,
        },
        {
          name: "loan out preserves a truthful post-write reply",
          ok:
            result.result?.assistantMetadata?.agentOutcome?.wrote === true &&
            result.result?.assistantMetadata?.agentOutcome?.hadError === false,
        },
      ],
      { added, created, loopDiagnostic: result.result?.assistantMetadata?.loopDiagnostic ?? null },
    ),
  };
}

async function runDryCorrectionScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const original = await turn(
    persona,
    "Registra como una sola operación dos gastos de hoy desde Produbanco: 10 dólares en compra A y 20 dólares en compra B.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-correction-original", "log_movements_batch", {
              movements: [
                {
                  type: "expense",
                  amount: 10,
                  description: "Compra A",
                  category: "other",
                  sourceAccountId: persona.account.id,
                  occurredAtISO: today,
                },
                {
                  type: "expense",
                  amount: 20,
                  description: "Compra B",
                  category: "other",
                  sourceAccountId: persona.account.id,
                  occurredAtISO: today,
                },
              ],
            }),
          ],
        },
        {
          content: "Listo, registré 10 USD en Compra A y 20 USD en Compra B desde Produbanco.",
          toolCalls: [],
        },
        {
          content: "Listo, registré 10 USD en Compra A y 20 USD en Compra B desde Produbanco.",
          toolCalls: [],
        },
      ],
    },
  );
  const afterOriginal = await financialSnapshot(persona.userId);
  const originalOperationId = original.result?.assistantMetadata?.durableOperation?.id;
  if (!originalOperationId) {
    throw new Error("DRY_CORRECTION_ORIGINAL_OPERATION_MISSING");
  }
  const proposal = await turn(
    persona,
    "Me equivoqué en esa operación: la compra A fueron 12 dólares y la compra B 19. Corrige la operación completa; reemplaza los datos anteriores, no agregues gastos encima.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-correction-undo", "undo_agent_operation", {
              targetOperationId: originalOperationId,
            }),
            mockCall("dry-correction-replacements", "log_movements_batch", {
              movements: [
                {
                  type: "expense",
                  amount: 12,
                  description: "Compra A corregida",
                  category: "other",
                  sourceAccountId: persona.account.id,
                  occurredAtISO: today,
                },
                {
                  type: "expense",
                  amount: 19,
                  description: "Compra B corregida",
                  category: "other",
                  sourceAccountId: persona.account.id,
                  occurredAtISO: today,
                },
              ],
            }),
          ],
        },
        {
          content:
            "Preparé deshacer los dos gastos anteriores y reemplazarlos por 12 USD y 19 USD. ¿Confirmas la corrección completa?",
          toolCalls: [],
        },
      ],
    },
  );
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed"),
    "dry correction proposal",
  );
  const correctionOperationId = proposed[0]?.operation_id;
  if (!correctionOperationId) {
    const manifestRows = must(
      await admin
        .from("agent_operation_manifests")
        .select("operation_id,status,plan_version,manifest_hash,manifest,verification")
        .eq("user_id", persona.userId)
        .order("created_at"),
      "dry correction diagnostic manifests",
    );
    throw new Error(
      `DRY_CORRECTION_PROPOSAL_MISSING ${canonicalText({
        turn: turnDetail(proposal),
        manifests: manifestRows,
      })}`,
    );
  }
  const confirmed = await turn(
    persona,
    "Sí, confirma exactamente esa corrección completa.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-correction-confirm", "confirm_operation", {
              operationId: correctionOperationId,
              rationale: "El usuario confirmó el undo y ambos reemplazos.",
            }),
          ],
        },
        {
          content:
            "Listo, revertí los dos gastos anteriores y registré Compra A por 12 USD y Compra B por 19 USD.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const originals = newTransactions(before, afterOriginal).filter(
    (row) => row.type === "expense",
  );
  const originalIds = new Set(originals.map((row) => row.id));
  const reversals = added.filter((row) => row.type === "reversal");
  const expenses = added.filter((row) => row.type === "expense");
  const verified = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status,manifest_hash,manifest,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", correctionOperationId),
    "dry correction verified",
  );
  return {
    turns: [original, proposal, confirmed],
    money: moneyResult(
      [
        {
          name: "correction proposal contains undo before replacements",
          ok:
            proposed.length === 1 &&
            proposed[0]?.manifest?.actions?.length === 2 &&
            proposed[0]?.manifest?.actions?.[0]?.capability === "undo_agent_operation" &&
            proposed[0]?.manifest?.actions?.[1]?.capability === "log_movements_batch",
        },
        {
          name: "correction reverses both originals",
          ok:
            reversals.length === 2 &&
            reversals.every((row) => originalIds.has(row.related_transaction_id)),
        },
        {
          name: "correction writes exact replacements and balance",
          ok:
            expenses.length === 4 &&
            sameValue(
              expenses.map((row) => rounded(row.original_amount)).sort((a, b) => a - b),
              [10, 12, 19, 20],
            ) &&
            accountBalance(after, persona.account.id) ===
              rounded(accountBalance(before, persona.account.id) - 31),
        },
        {
          name: "correction manifest settles verified",
          ok:
            verified.length === 1 &&
            verified[0]?.status === "verified" &&
            verified[0]?.manifest_hash === proposed[0]?.manifest_hash,
        },
      ],
      { added, proposed: proposed[0] ?? null, verified: verified[0] ?? null },
    ),
  };
}

function dryGraveGoalCancellationCall(persona, id) {
  return mockCall(id, "update_goal", {
    goalId: persona.goal.id,
    status: "cancelled",
    confirm: true,
  });
}

async function runDryConsolidationScenario(scenario, persona) {
  const cards = await seedAuthorityCards(persona);
  const before = await financialSnapshot(persona.userId);
  const first = await turn(
    persona,
    "Deja cubiertos los cuatro créditos piloto y prepara cancelar Viaje a Cartagena.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            ...cards.map((card, index) =>
              mockCall(`dry-consolidate-pay-${index + 1}`, "register_card_payment", {
                cardName: card.name,
                paidInFull: true,
                fromAccount: persona.account.id,
                date: today,
              }),
            ),
            dryGraveGoalCancellationCall(persona, "dry-consolidate-goal"),
          ],
        },
        {
          content:
            "Preparé cubrir los cuatro créditos desde Produbanco y cancelar Viaje a Cartagena. ¿Confirmas esa propuesta?",
          toolCalls: [],
        },
      ],
    },
  );
  const firstProposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,plan_version,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed"),
    "dry consolidation first proposal",
  );
  const extended = await turn(
    persona,
    "Sí salen de Produbanco; agrega también cerrar esas mismas cuatro tarjetas.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: cards.map((card, index) =>
            mockCall(`dry-consolidate-close-${index + 1}`, "close_card", {
              debtAccountId: card.id,
            }),
          ),
        },
        {
          content:
            "Consolidé una sola propuesta: pagar los cuatro créditos, cancelar Viaje a Cartagena y después cerrar las cuatro tarjetas. ¿Confirmas el conjunto?",
          toolCalls: [],
        },
      ],
    },
  );
  const preConfirm = await financialSnapshot(persona.userId);
  const manifests = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,plan_version,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .order("plan_version"),
    "dry consolidation successor proposal",
  );
  const successor = manifests.find((row) => row.status === "proposed");
  const operationId = successor?.operation_id;
  if (!operationId) throw new Error("DRY_CONSOLIDATION_SUCCESSOR_MISSING");
  const confirmed = await turn(
    persona,
    "Confirmo el conjunto completo en ese orden.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-consolidate-confirm", "confirm_operation", {
              operationId,
              rationale: "El usuario confirmó pagos, cancelación del objetivo y luego cierres.",
            }),
          ],
        },
        {
          content:
            "Listo: pagué 11,11, 12,22, 13,33 y 14,44 USD desde Produbanco, cancelé Viaje a Cartagena y después cerré las cuatro tarjetas.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const cardIds = new Set(cards.map((card) => card.id));
  const payments = newTransactions(before, after).filter(
    (row) => row.type === "debt_payment" && cardIds.has(row.debt_account_id),
  );
  const finalCards = after.debts.filter((row) => cardIds.has(row.id));
  const finalManifest = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,plan_version,status,manifest_hash,manifest,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", operationId)
      .eq("status", "verified"),
    "dry consolidation verified successor",
  );
  const actions = successor?.manifest?.actions ?? [];
  return {
    turns: [first, extended, confirmed],
    money: moneyResult(
      [
        {
          name: "consolidation writes zero rows before confirmation",
          ok: sameValue(before, preConfirm),
        },
        {
          name: "one successor carries ordinary registrations plus grave lifecycle actions",
          ok:
            firstProposed.length === 1 &&
            manifests.filter((row) => row.status === "rejected").length === 1 &&
            manifests.filter((row) => row.status === "proposed").length === 1 &&
            actions.length === 9 &&
            actions.slice(0, 4).every(
              (action) => action.capability === "register_card_payment",
            ) &&
            actions[4]?.capability === "update_goal" &&
            actions.slice(5).every((action) => action.capability === "close_card"),
        },
        {
          name: "confirmed successor pays and closes exactly",
          ok:
            payments.length === 4 &&
            sameValue(
              payments.map((row) => rounded(row.original_amount)).sort((a, b) => a - b),
              [11.11, 12.22, 13.33, 14.44],
            ) &&
            finalCards.length === 4 &&
            finalCards.every((card) => card.status === "closed") &&
            finalManifest.length === 1 &&
            finalManifest[0]?.manifest_hash === successor?.manifest_hash,
        },
      ],
      { manifests, payments, finalCards, finalManifest: finalManifest[0] ?? null },
    ),
  };
}

async function runDrySuccessorPayCloseScenario(scenario, persona) {
  const readAfterConfirm = scenario.id === "DRY_SUCCESSOR_PAY_CLOSE_READ";
  const cards = await seedAuthorityCards(persona);
  const before = await financialSnapshot(persona.userId);
  const status = await turn(
    persona,
    "Recuérdame cuáles son los cuatro créditos piloto que siguen pendientes.",
    {
      mockCompletions: [
        {
          content:
            "Siguen pendientes Crédito piloto 1 por 11,11 USD, Crédito piloto 2 por 12,22 USD, Crédito piloto 3 por 13,33 USD y Crédito piloto 4 por 14,44 USD.",
          toolCalls: [],
        },
      ],
    },
  );
  const proposedPayments = await turn(
    persona,
    "Perfecto, deja esos cuatro cubiertos desde mi Produbanco y prepara cancelar Viaje a Cartagena.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            ...cards.map((card, index) =>
              mockCall(`dry-successor-pay-${index + 1}`, "register_card_payment", {
                cardName: card.name,
                amount: [11.11, 12.22, 13.33, 14.44][index],
                fromAccount: "Produbanco",
              }),
            ),
            dryGraveGoalCancellationCall(persona, "dry-successor-goal"),
          ],
        },
        {
          content:
            "Preparé los cuatro pagos exactos desde Produbanco y cancelar Viaje a Cartagena. ¿Confirmas el conjunto?",
          toolCalls: [],
        },
      ],
    },
  );
  const firstRows = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,operation_id,plan_version,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .order("plan_version"),
    "dry successor first proposal",
  );
  const first = firstRows.find((row) => row.status === "proposed");
  if (!first) throw new Error("DRY_SUCCESSOR_PAY_CLOSE_FIRST_PROPOSAL_MISSING");
  const extended = await turn(
    persona,
    "Ahora cierra esas mismas cuatro tarjetas; no quiero que queden activas.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: cards.map((card, index) =>
            mockCall(`dry-successor-close-${index + 1}`, "close_card", {
              debtAccountId: card.id,
            }),
          ),
        },
        {
          content:
            "Preparé una sola propuesta: pagar los cuatro créditos, cancelar Viaje a Cartagena y después cerrar las cuatro tarjetas. ¿Confirmas el conjunto?",
          toolCalls: [],
        },
      ],
    },
  );
  const preConfirm = await financialSnapshot(persona.userId);
  const successorRows = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,operation_id,plan_version,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("operation_id", first.operation_id)
      .order("plan_version"),
    "dry successor eight-action proposal",
  );
  const successor = successorRows.find((row) => row.status === "proposed");
  if (!successor) throw new Error("DRY_SUCCESSOR_PAY_CLOSE_SUCCESSOR_MISSING");
  const confirmed = await turn(
    persona,
    "Adelante con el conjunto tal como lo acabas de plantear.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-successor-confirm", "confirm_operation", {
              operationId: successor.operation_id,
              rationale: "La delivery confirma cuatro pagos, cancelar el objetivo y cuatro cierres.",
            }),
          ],
        },
        ...(readAfterConfirm
          ? [
              {
                content: null,
                toolCalls: [
                  mockCall(
                    "dry-successor-post-execution-read",
                    "list_open_receivables",
                    {},
                  ),
                ],
              },
            ]
          : []),
        {
          content:
            "Listo: pagué 11,11, 12,22, 13,33 y 14,44 USD desde Produbanco, cancelé Viaje a Cartagena y cerré las cuatro tarjetas.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const cardIds = new Set(cards.map((card) => card.id));
  const payments = newTransactions(before, after).filter(
    (row) => row.type === "debt_payment" && cardIds.has(row.debt_account_id),
  );
  const finalCards = after.debts.filter((row) => cardIds.has(row.id));
  const finalRows = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,operation_id,plan_version,status,manifest_hash,manifest,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", successor.operation_id)
      .order("plan_version"),
    "dry successor final manifests",
  );
  const currentPlanVersion = await currentOperationPlanVersion(
    persona.userId,
    successor.operation_id,
  );
  const final = currentPlanManifest(finalRows, currentPlanVersion);
  const actions = successor.manifest?.actions ?? [];
  return {
    turns: [status, proposedPayments, extended, confirmed],
    money: moneyResult(
      [
        {
          name: "successor pay-close writes zero rows before confirmation",
          ok: sameValue(before, preConfirm),
        },
        {
          name: "successor contains four payments, one grave goal change and four closes",
          ok:
            successorRows.length === 2 &&
            successorRows[0]?.status === "rejected" &&
            actions.length === 9 &&
            actions.slice(0, 4).every(
              (action) => action.capability === "register_card_payment",
            ) &&
            actions[4]?.capability === "update_goal" &&
            actions.slice(5).every((action) => action.capability === "close_card"),
        },
        {
          name: "successor pay-close executes exact state and verifies the manifest",
          ok:
            payments.length === 4 &&
            sameValue(
              payments.map((row) => rounded(row.original_amount)).sort((a, b) => a - b),
              [11.11, 12.22, 13.33, 14.44],
            ) &&
            accountBalance(after, persona.account.id) ===
              rounded(accountBalance(before, persona.account.id) - 51.1) &&
            finalCards.length === 4 &&
            finalCards.every((card) => card.status === "closed") &&
            final?.status === "verified" &&
            final?.manifest_hash === successor.manifest_hash &&
            Number(final?.verification?.authorized_count) === 9 &&
            Number(final?.verification?.verified_count) === 9,
        },
        {
          name: readAfterConfirm
            ? "post-execution read cannot strand the executing manifest"
            : "successor pay-close settles without a typed failure",
          ok:
            confirmed.result?.assistantMetadata?.agentOutcome?.hadError === false &&
            confirmed.result?.assistantMetadata?.loopDiagnostic == null,
        },
      ],
      {
        first,
        successor,
        currentPlanVersion,
        final,
        finalManifests: finalRows,
        payments,
        finalCards,
        settleDiagnostic:
          confirmed.result?.assistantMetadata?.loopDiagnostic ?? null,
      },
    ),
  };
}

async function runDryLiveReplacementScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const first = await turn(
    persona,
    "Pagué Diners NT en full; prepara el registro y cancelar Viaje a Cartagena; después te preciso la cuenta.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-live-replace-old", "register_card_payment", {
              cardName: "Diners NT",
              paidInFull: true,
              date: today,
            }),
            dryGraveGoalCancellationCall(persona, "dry-live-replace-goal"),
          ],
        },
        {
          content: "Preparé el pago total de Diners NT y cancelar Viaje a Cartagena. ¿Desde qué cuenta salió el pago?",
          toolCalls: [],
        },
      ],
    },
  );
  const firstRows = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,plan_version,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed"),
    "dry live replacement first proposal",
  );
  const extended = await turn(
    persona,
    "Salió de Produbanco; reemplaza esa misma acción con este origen.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-live-replace-new", "register_card_payment", {
              cardName: "Diners NT",
              paidInFull: true,
              fromAccount: persona.account.id,
              date: today,
            }),
          ],
        },
        {
          content:
            "Actualicé la acción de Diners NT para que salga de Produbanco y conservé cancelar Viaje a Cartagena. ¿Confirmas esa versión vigente?",
          toolCalls: [],
        },
      ],
    },
  );
  const preConfirm = await financialSnapshot(persona.userId);
  const manifests = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,plan_version,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .order("plan_version"),
    "dry live replacement successor",
  );
  const successor = manifests.find((row) => row.status === "proposed");
  const operationId = successor?.operation_id;
  if (!operationId) throw new Error("DRY_LIVE_REPLACEMENT_SUCCESSOR_MISSING");
  const confirmed = await turn(
    persona,
    "Sí, confirma esa versión actualizada.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-live-replace-confirm", "confirm_operation", {
              operationId,
              rationale: "El usuario confirmó la versión que ya contiene el origen nuevo.",
            }),
          ],
        },
        {
          content: "Listo, registré el pago de Diners NT por 50,60 USD desde Produbanco y cancelé Viaje a Cartagena.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const payments = newTransactions(before, after).filter(
    (row) => row.type === "debt_payment",
  );
  const action = successor?.manifest?.actions?.find(
    (row) => row.capability === "register_card_payment",
  );
  const verified = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status,manifest_hash,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", operationId)
      .eq("status", "verified"),
    "dry live replacement verified",
  );
  return {
    turns: [first, extended, confirmed],
    money: moneyResult(
      [
        {
          name: "live replacement writes zero rows before confirmation",
          ok: sameValue(before, preConfirm),
        },
        {
          name: "same capability and entity converge to one newest action",
          ok:
            firstRows.length === 1 &&
            manifests.filter((row) => row.status === "rejected").length === 1 &&
            manifests.filter((row) => row.status === "proposed").length === 1 &&
            successor?.manifest?.actions?.length === 2 &&
            action?.capability === "register_card_payment" &&
            action?.arguments?.fromAccount === persona.account.id &&
            successor.manifest.actions.some(
              (row) => row.capability === "update_goal",
            ),
        },
        {
          name: "only newest payment executes and verifies",
          ok:
            payments.length === 1 &&
            rounded(payments[0]?.original_amount) === 50.6 &&
            payments[0]?.source_account_id === persona.account.id &&
            verified.length === 1 &&
            verified[0]?.manifest_hash === successor?.manifest_hash,
        },
      ],
      { manifests, payments, verified: verified[0] ?? null },
    ),
  };
}

async function runDryOperationSourceScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const proposal = await turn(
    persona,
    "Pagué Diners NT en full desde Produbanco; prepara ese registro y cancelar Viaje a Cartagena.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-operation-source-propose", "register_card_payment", {
              cardName: "Diners NT",
              paidInFull: true,
              date: today,
            }),
            dryGraveGoalCancellationCall(persona, "dry-operation-source-goal"),
          ],
        },
        {
          content:
            "Preparé el pago total de Diners NT con el origen que nombraste y cancelar Viaje a Cartagena. ¿Confirmas ejecutarlo?",
          toolCalls: [],
        },
      ],
    },
  );
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed"),
    "dry operation source proposal",
  );
  const operationId = proposed[0]?.operation_id;
  if (!operationId) throw new Error("DRY_OPERATION_SOURCE_PROPOSAL_MISSING");
  const preConfirm = await financialSnapshot(persona.userId);
  const confirmed = await turn(
    persona,
    "Sí, confirma ese pago.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-operation-source-confirm", "confirm_operation", {
              operationId,
              rationale: "La operación user-authored ya nombra Produbanco.",
            }),
          ],
        },
        {
          content: "Listo, pagué Diners NT por 50,60 USD desde Produbanco y cancelé Viaje a Cartagena.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const payments = newTransactions(before, after).filter(
    (row) => row.type === "debt_payment",
  );
  const final = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status,manifest_hash,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", operationId),
    "dry operation source final manifest",
  );
  return {
    turns: [proposal, confirmed],
    money: moneyResult(
      [
        {
          name: "operation source remains unpersisted and writes zero before confirmation",
          ok:
            sameValue(before, preConfirm) &&
            proposed[0]?.manifest?.actions?.length === 2 &&
            proposed[0]?.manifest?.actions?.find(
              (row) => row.capability === "register_card_payment",
            )?.arguments?.fromAccount == null,
        },
        {
          name: "confirmed execution resolves source from operation-authored messages",
          ok:
            payments.length === 1 &&
            payments[0]?.source_account_id === persona.account.id &&
            rounded(payments[0]?.original_amount) === 50.6 &&
            final.length === 1 &&
            final[0]?.status === "verified",
        },
      ],
      { proposed: proposed[0] ?? null, payments, final: final[0] ?? null },
    ),
  };
}

async function runDryBorrowedLinkScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const proposal = await turn(
    persona,
    "Alpaca me prestó 83,86 USD y entraron a Produbanco; prepara el préstamo recibido y cancelar Viaje a Cartagena.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-borrowed-link-propose", "record_person_payment", {
              direction: "in",
              amount: 83.86,
              person: "Alpaca",
              inflowKind: "borrowed",
              occurredAtISO: today,
            }),
            dryGraveGoalCancellationCall(persona, "dry-borrowed-link-goal"),
          ],
        },
        {
          content:
            "Preparé acreditar 83,86 USD en Produbanco, aumentar la deuda Alpaca y cancelar Viaje a Cartagena. ¿Confirmas esa interpretación?",
          toolCalls: [],
        },
      ],
    },
  );
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed"),
    "dry borrowed link proposal",
  );
  const operationId = proposed[0]?.operation_id;
  if (!operationId) throw new Error("DRY_BORROWED_LINK_PROPOSAL_MISSING");
  const preConfirm = await financialSnapshot(persona.userId);
  const action = proposed[0]?.manifest?.actions?.find(
    (row) => row.capability === "record_person_payment",
  );
  const confirmed = await turn(
    persona,
    "Sí, confirma que esos fondos fueron prestados a mí y aumenta la deuda Alpaca.",
    {
      operationId,
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-borrowed-link-confirm", "confirm_operation", {
              operationId,
              rationale:
                "La segunda delivery confirma la propuesta exacta de fondos prestados.",
            }),
          ],
        },
        {
          content:
            "Listo: acredité 83,86 USD en Produbanco, aumenté por el mismo monto la deuda Alpaca y cancelé Viaje a Cartagena.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const debtStep = must(
    await admin
      .from("agent_operation_steps")
      .select("status,affected_refs")
      .eq("user_id", persona.userId)
      .eq("operation_id", operationId)
      .eq("capability", "record_person_payment")
      .single(),
    "dry borrowed verified step",
  );
  const finalManifest = must(
    await admin
      .from("agent_operation_manifests")
      .select("status,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", operationId)
      .single(),
    "dry borrowed verified manifest",
  );
  return {
    turns: [proposal, confirmed],
    money: moneyResult(
      [
        {
          name: "borrowed links are concrete at staging and write zero rows before confirmation",
          ok:
            sameValue(before, preConfirm) &&
            action?.arguments?.accountId === persona.account.id &&
            action?.arguments?.debtAccountId === persona.loan.id,
        },
        {
          name: "confirmed borrowed proceeds write one adjustment with an owned receipt",
          ok:
            added.length === 1 &&
            added[0]?.type === "adjustment" &&
            rounded(added[0]?.original_amount) === 83.86 &&
            debtStep.status === "verified" &&
            debtStep.affected_refs?.some(
              (ref) => ref?.type === "transaction" && ref?.id === added[0]?.id,
            ),
        },
        {
          name: "confirmed borrowed proceeds raise exact cash and liability under verified parity",
          ok:
            accountBalance(after, persona.account.id) ===
              accountBalance(before, persona.account.id) + 83.86 &&
            debtBalance(after, persona.loan.id) ===
              debtBalance(before, persona.loan.id) + 83.86 &&
            finalManifest.status === "verified" &&
            Number(finalManifest.verification?.authorized_count) === 2 &&
            Number(finalManifest.verification?.verified_count) === 2,
        },
      ],
      {
        proposed: proposed[0] ?? null,
        added,
        debtStep,
        finalManifest,
      },
    ),
  };
}

async function runDrySetCohesionScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const question = await turn(
    persona,
    "Registra estos cuatro hechos de hoy y prepara cancelar Viaje a Cartagena: pagué completo Produbanco MV, María me devolvió 83,86 USD de capital de un préstamo mío nunca registrado, y pagué completos Diners NT y Titanium MV. Los tres pagos salieron de la misma cuenta, pero todavía no te dije cuál.",
    {
      mockCompletions: [
        {
          content: "¿Desde qué cuenta salieron los tres pagos de tarjeta?",
          toolCalls: [],
        },
      ],
    },
  );
  const afterQuestion = await financialSnapshot(persona.userId);
  const proposal = await turn(persona, "Todos salieron de Produbanco.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-set-early-immediate", "register_card_payment", {
            cardName: "Produbanco MV",
            paidInFull: true,
            fromAccount: persona.account.id,
            date: today,
          }),
        ],
      },
      {
        content: null,
        toolCalls: [
          mockCall("dry-set-manifest-capital", "record_person_payment", {
            direction: "in",
            amount: 83.86,
            person: "María",
            reason: "Devolución de capital no registrada",
            accountId: persona.account.id,
            inflowKind: "capital_return_unrecorded",
            occurredAtISO: today,
          }),
          mockCall("dry-set-diners", "register_card_payment", {
            cardName: "Diners NT",
            paidInFull: true,
            fromAccount: persona.account.id,
            date: today,
          }),
          mockCall("dry-set-titanium", "register_card_payment", {
            cardName: "Titanium MV",
            paidInFull: true,
            fromAccount: persona.account.id,
            date: today,
          }),
          dryGraveGoalCancellationCall(persona, "dry-set-goal"),
        ],
      },
      {
        content:
          "Preparé un solo conjunto: acreditar 83,86 USD de capital, pagar Produbanco MV, Diners NT y Titanium MV desde Produbanco, y cancelar Viaje a Cartagena. ¿Confirmas las cinco acciones?",
        toolCalls: [],
      },
    ],
  });
  const preConfirm = await financialSnapshot(persona.userId);
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed"),
    "dry set cohesion proposal",
  );
  const operationId = proposed[0]?.operation_id;
  if (!operationId) {
    const durableRows = must(
      await admin
        .from("agent_operations")
        .select("id,status,plan_version,pending_question,result")
        .eq("user_id", persona.userId),
      "dry set cohesion proposal diagnostics",
    );
    const manifestRows = must(
      await admin
        .from("agent_operation_manifests")
        .select("operation_id,plan_version,status,manifest")
        .eq("user_id", persona.userId),
      "dry set cohesion manifest diagnostics",
    );
    throw new Error(
      `DRY_SET_COHESION_PROPOSAL_MISSING · ${canonicalText({
        question: question.result ?? null,
        proposal: proposal.result ?? null,
        durableRows,
        manifestRows,
      })}`,
    );
  }
  const confirmed = await turn(
    persona,
    "Sí, confirma y ejecuta exactamente ese único conjunto.",
    {
      operationId,
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-set-confirm", "confirm_operation", {
              operationId,
              rationale:
                "La delivery posterior confirma las cinco acciones del manifiesto cohesivo.",
            }),
          ],
        },
        {
          content:
            "Listo: acredité 83,86 USD de capital, pagué Produbanco MV por 22,14 USD, Diners NT por 50,60 USD y Titanium MV por 201,25 USD desde Produbanco, y cancelé Viaje a Cartagena.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const actionCapabilities =
    proposed[0]?.manifest?.actions?.map((action) => action.capability) ?? [];
  const finalManifest = must(
    await admin
      .from("agent_operation_manifests")
      .select("status,manifest_hash,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", operationId)
      .single(),
    "dry set cohesion verified manifest",
  );
  return {
    turns: [question, proposal, confirmed],
    money: moneyResult(
      [
        {
          name: "set cohesion writes zero rows before its single natural confirmation",
          ok: sameValue(before, afterQuestion) && sameValue(before, preConfirm),
        },
        {
          name: "early immediate and later manifest-bound calls converge to one complete manifest",
          ok:
            proposed.length === 1 &&
            sameValue(actionCapabilities, [
              "register_card_payment",
              "record_person_payment",
              "register_card_payment",
              "register_card_payment",
              "update_goal",
            ]),
        },
        {
          name: "single confirmation executes and verifies the complete economic set",
          ok:
            added.length === 4 &&
            sameValue(
              added.map((row) => rounded(row.original_amount)).sort((a, b) => a - b),
              [22.14, 50.6, 83.86, 201.25],
            ) &&
            finalManifest.status === "verified" &&
            finalManifest.manifest_hash === proposed[0]?.manifest_hash &&
            Number(finalManifest.verification?.authorized_count) === 5 &&
            Number(finalManifest.verification?.verified_count) === 5,
        },
      ],
      { proposed: proposed[0] ?? null, added, finalManifest },
    ),
  };
}

function dryCompletionControlProposalCalls(persona, prefix) {
  return [
    mockCall(`${prefix}-produbanco`, "register_card_payment", {
      cardName: "Produbanco MV",
      paidInFull: true,
      fromAccount: persona.account.id,
      date: today,
    }),
    mockCall(`${prefix}-capital`, "record_person_payment", {
      direction: "in",
      amount: 83.86,
      person: "María",
      reason: "Devolución de capital no registrada",
      accountId: persona.account.id,
      inflowKind: "capital_return_unrecorded",
      occurredAtISO: today,
    }),
    mockCall(`${prefix}-diners`, "register_card_payment", {
      cardName: "Diners NT",
      paidInFull: true,
      fromAccount: persona.account.id,
      date: today,
    }),
    mockCall(`${prefix}-titanium`, "register_card_payment", {
      cardName: "Titanium MV",
      paidInFull: true,
      fromAccount: persona.account.id,
      date: today,
    }),
    dryGraveGoalCancellationCall(persona, `${prefix}-goal`),
  ];
}

function dryCompletionControlSubsetCalls(persona, prefix) {
  return [
    mockCall(`${prefix}-produbanco`, "register_card_payment", {
      cardName: "Produbanco MV",
      amount: 22.14,
      paidInFull: false,
      fromAccount: persona.account.id,
      date: today,
    }),
    mockCall(`${prefix}-titanium`, "register_card_payment", {
      cardName: "Titanium MV",
      amount: 201.25,
      paidInFull: false,
      fromAccount: persona.account.id,
      date: today,
    }),
  ];
}

async function runDryCompletionControlScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const prefix = scenario.id.toLowerCase();
  const proposal = await turn(
    persona,
    "Prepara un solo conjunto: la devolución de 83,86 USD de capital no registrado, los pagos completos de Produbanco MV, Diners NT y Titanium MV desde Produbanco, y cancelar Viaje a Cartagena.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: dryCompletionControlProposalCalls(persona, `${prefix}-proposal`),
        },
        {
          content:
            "Preparé cinco acciones: acreditar 83,86 USD de capital, pagar Produbanco MV, Diners NT y Titanium MV desde Produbanco, y cancelar Viaje a Cartagena. ¿Confirmas el conjunto?",
          toolCalls: [],
        },
      ],
    },
  );
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,operation_id,plan_version,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed")
      .single(),
    "dry completion control proposal",
  );
  const preConfirm = await financialSnapshot(persona.userId);
  const control = mockCall(`${prefix}-confirm`, "confirm_operation", {
    operationId: proposed.operation_id,
    rationale:
      "La delivery confirma el manifiesto pendiente y no autoriza ninguna re-emisión hermana.",
  });
  const subset = dryCompletionControlSubsetCalls(persona, `${prefix}-subset`);
  const controlFirst = scenario.id !== "DRY_CONTROL_CONFIRM_LAST";
  const confirmationMessage =
    scenario.id === "DRY_CONTROL_DIRECTION_RESOLVED"
      ? "Era una devolución: yo había prestado ese dinero. Confirma exactamente el conjunto pendiente."
      : "Sí, confirma y ejecuta exactamente las cinco acciones pendientes.";
  const confirmed = await turn(persona, confirmationMessage, {
    operationId: proposed.operation_id,
    mockCompletions: [
      {
        content: null,
        toolCalls: controlFirst ? [control, ...subset] : [...subset, control],
      },
      {
        content:
          "Listo: acredité 83,86 USD de capital, pagué Produbanco MV por 22,14 USD, Diners NT por 50,60 USD y Titanium MV por 201,25 USD desde Produbanco, y cancelé Viaje a Cartagena.",
        toolCalls: [],
      },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const finalRows = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,operation_id,plan_version,status,manifest_hash,manifest,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", proposed.operation_id)
      .order("plan_version"),
    "dry completion control final manifests",
  );
  const currentPlanVersion = await currentOperationPlanVersion(
    persona.userId,
    proposed.operation_id,
  );
  const finalManifest = currentPlanManifest(finalRows, currentPlanVersion);
  const hadError =
    confirmed.result?.assistantMetadata?.agentOutcome?.hadError === true;
  return {
    turns: [proposal, confirmed],
    money: moneyResult(
      [
        {
          name: "completion control writes zero rows before confirmation",
          ok: sameValue(before, preConfirm),
        },
        {
          name: "control sibling subset never creates a successor",
          ok:
            finalRows.length === 1 &&
            finalManifest?.id === proposed.id &&
            finalManifest?.manifest_hash === proposed.manifest_hash,
        },
        {
          name: "control sibling subset executes only the five authorized actions",
          ok:
            added.length === 4 &&
            sameValue(
              added.map((row) => rounded(row.original_amount)).sort((a, b) => a - b),
              [22.14, 50.6, 83.86, 201.25],
            ) &&
            finalManifest?.status === "verified" &&
            Number(finalManifest?.verification?.authorized_count) === 5 &&
            Number(finalManifest?.verification?.verified_count) === 5,
        },
      ],
      { proposed, finalRows, finalManifest, added },
    ),
    extraBehaviorFailures: [
      ...(hadError ? ["completion control produced hadError"] : []),
      ...(hadError && confirmed.result?.assistantMetadata?.loopDiagnostic == null
        ? ["hadError lacks loopDiagnostic"]
        : []),
    ],
  };
}

function dryReemissionPaymentCalls(
  cards,
  accountId,
  prefix,
  firstAmount = null,
  goalId = null,
) {
  const calls = cards.slice(0, 2).map((card, index) =>
    mockCall(`${prefix}-${index + 1}`, "register_card_payment", {
      cardName: card.name,
      ...(index === 0 && firstAmount !== null
        ? { amount: firstAmount, paidInFull: false }
        : { paidInFull: true }),
      fromAccount: accountId,
      date: today,
    }),
  );
  if (goalId) {
    calls.push(
      mockCall(`${prefix}-goal`, "update_goal", {
        goalId,
        status: "cancelled",
        confirm: true,
      }),
    );
  }
  return calls;
}

async function runDryConfirmReemitIdenticalScenario(scenario, persona) {
  const cards = await seedAuthorityCards(persona);
  const before = await financialSnapshot(persona.userId);
  const proposalCalls = dryReemissionPaymentCalls(
    cards,
    persona.account.id,
    "dry-identical-proposal",
    null,
    persona.goal.id,
  );
  const proposal = await turn(persona, "Prepara cubrir los dos primeros créditos piloto y cancelar Viaje a Cartagena.", {
    mockCompletions: [
      { content: null, toolCalls: proposalCalls },
      {
        content: "Preparé los dos pagos desde Produbanco y cancelar Viaje a Cartagena. ¿Confirmas el conjunto?",
        toolCalls: [],
      },
    ],
  });
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,operation_id,plan_version,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed")
      .single(),
    "dry identical proposal",
  );
  const preConfirm = await financialSnapshot(persona.userId);
  const operationId = proposed.operation_id;
  const confirmed = await turn(
    persona,
    "Sí, confirma exactamente esos dos pagos.",
    {
      operationId,
      mockCompletions: [
        {
          content: null,
          toolCalls: dryReemissionPaymentCalls(
            [...cards.slice(0, 2)].reverse().map((card) => card),
            persona.account.id,
            "dry-identical-reemit",
            null,
            persona.goal.id,
          ),
        },
        {
          content: null,
          toolCalls: [
            mockCall("dry-identical-confirm", "confirm_operation", {
              operationId,
              rationale: "La delivery confirma el manifiesto idéntico ya pendiente.",
            }),
          ],
        },
        {
          content: "Listo, cubrí los créditos por 11,11 USD y 12,22 USD desde Produbanco y cancelé Viaje a Cartagena.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const payments = newTransactions(before, after).filter(
    (row) => row.type === "debt_payment",
  );
  const finalRows = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,operation_id,plan_version,status,manifest_hash,manifest,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", operationId),
    "dry identical final manifest",
  );
  const currentPlanVersion = await currentOperationPlanVersion(
    persona.userId,
    operationId,
  );
  const finalManifest = currentPlanManifest(finalRows, currentPlanVersion);
  return {
    turns: [proposal, confirmed],
    money: moneyResult(
      [
        {
          name: "identical re-emission writes zero before confirmation",
          ok: sameValue(before, preConfirm),
        },
        {
          name: "identical re-emission keeps one manifest identity and hash",
          ok:
            finalManifest?.id === proposed.id &&
            finalManifest?.manifest_hash === proposed.manifest_hash &&
            finalManifest?.status === "verified",
        },
        {
          name: "redirect then confirm executes the exact set once",
          ok:
            payments.length === 2 &&
            sameValue(
              payments.map((row) => rounded(row.original_amount)).sort((a, b) => a - b),
              [11.11, 12.22],
            ) &&
            confirmed.result?.assistantMetadata?.agentOutcome?.hadError === false &&
            confirmed.result?.assistantMetadata?.loopDiagnostic?.code !== "unavailable",
        },
      ],
      {
        proposed,
        currentPlanVersion,
        final: finalManifest,
        finalManifests: finalRows,
        payments,
      },
    ),
  };
}

async function runDryConfirmReemitModifiedScenario(scenario, persona) {
  const cards = await seedAuthorityCards(persona);
  const before = await financialSnapshot(persona.userId);
  const proposal = await turn(persona, "Prepara cubrir los dos primeros créditos piloto y cancelar Viaje a Cartagena.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: dryReemissionPaymentCalls(
          cards,
          persona.account.id,
          "dry-modified-proposal",
          null,
          persona.goal.id,
        ),
      },
      {
        content: "Preparé los dos pagos desde Produbanco y cancelar Viaje a Cartagena. ¿Confirmas el conjunto?",
        toolCalls: [],
      },
    ],
  });
  const first = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,operation_id,plan_version,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed")
      .single(),
    "dry modified first proposal",
  );
  const modified = await turn(
    persona,
    "Cambia el primero a 10,11 USD y conserva el segundo.",
    {
      operationId: first.operation_id,
      mockCompletions: [
        {
          content: null,
          toolCalls: dryReemissionPaymentCalls(
            cards,
            persona.account.id,
            "dry-modified-reemit",
            10.11,
            persona.goal.id,
          ),
        },
        {
          content: "Actualicé la propuesta: 10,11 USD para el primero, pago completo del segundo y cancelar Viaje a Cartagena. ¿Confirmas el sucesor?",
          toolCalls: [],
        },
      ],
    },
  );
  const preConfirm = await financialSnapshot(persona.userId);
  const manifestsBeforeConfirm = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,operation_id,plan_version,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("operation_id", first.operation_id)
      .order("plan_version"),
    "dry modified successor",
  );
  const successor = manifestsBeforeConfirm.find((row) => row.status === "proposed");
  if (!successor) throw new Error("DRY_CONFIRM_REEMIT_MODIFIED_SUCCESSOR_MISSING");
  const confirmed = await turn(
    persona,
    "Sí, confirma esa propuesta modificada.",
    {
      operationId: first.operation_id,
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-modified-confirm", "confirm_operation", {
              operationId: first.operation_id,
              rationale: "La delivery confirma el manifiesto sucesor modificado.",
            }),
          ],
        },
        {
          content: "Listo, pagué 10,11 USD del primero, 12,22 USD del segundo y cancelé Viaje a Cartagena.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const payments = newTransactions(before, after).filter(
    (row) => row.type === "debt_payment",
  );
  const finalRows = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,plan_version,status,manifest_hash,manifest,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", first.operation_id)
      .order("plan_version"),
    "dry modified final manifests",
  );
  return {
    turns: [proposal, modified, confirmed],
    money: moneyResult(
      [
        {
          name: "modified re-emission consolidates without pre-confirmation writes",
          ok:
            sameValue(before, preConfirm) &&
            manifestsBeforeConfirm.length === 2 &&
            manifestsBeforeConfirm[0]?.status === "rejected" &&
            successor.manifest_hash !== first.manifest_hash,
        },
        {
          name: "modified successor keeps one newest action per target",
          ok:
            successor.manifest?.actions?.length === 3 &&
            successor.manifest.actions.some(
              (row) =>
                row.capability === "register_card_payment" &&
                row.arguments?.amount === 10.11,
            ) &&
            successor.manifest.actions.some(
              (row) =>
                row.capability === "register_card_payment" &&
                row.arguments?.paidInFull === true,
            ) &&
            successor.manifest.actions.some(
              (row) => row.capability === "update_goal",
            ),
        },
        {
          name: "modified successor executes only newest values and verifies",
          ok:
            payments.length === 2 &&
            sameValue(
              payments.map((row) => rounded(row.original_amount)).sort((a, b) => a - b),
              [10.11, 12.22],
            ) &&
            finalRows.some(
              (row) =>
                row.id === successor.id &&
                row.status === "verified" &&
                row.manifest_hash === successor.manifest_hash,
            ),
        },
      ],
      { first, successor, finalRows, payments },
    ),
  };
}

async function runDryExecutingReemitScenario(scenario, persona) {
  const cards = await seedAuthorityCards(persona);
  const before = await financialSnapshot(persona.userId);
  const proposal = await turn(persona, "Prepara cubrir los dos primeros créditos piloto y cancelar Viaje a Cartagena.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: dryReemissionPaymentCalls(
          cards,
          persona.account.id,
          "dry-executing-proposal",
          null,
          persona.goal.id,
        ),
      },
      {
        content: "Preparé los dos pagos desde Produbanco y cancelar Viaje a Cartagena. ¿Confirmas el conjunto?",
        toolCalls: [],
      },
    ],
  });
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,operation_id,status,manifest_hash,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed")
      .single(),
    "dry executing proposal",
  );
  const confirmed = await turn(
    persona,
    "Sí, confirma exactamente esos dos pagos.",
    {
      operationId: proposed.operation_id,
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-executing-confirm", "confirm_operation", {
              operationId: proposed.operation_id,
              rationale: "La delivery confirma el manifiesto pendiente.",
            }),
          ],
        },
        {
          content: null,
          toolCalls: dryReemissionPaymentCalls(
            cards,
            persona.account.id,
            "dry-executing-reemit",
            null,
            persona.goal.id,
          ),
        },
        {
          content: "Listo, cubrí los créditos por 11,11 USD y 12,22 USD desde Produbanco y cancelé Viaje a Cartagena.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const payments = newTransactions(before, after).filter(
    (row) => row.type === "debt_payment",
  );
  const final = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,status,manifest_hash,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", proposed.operation_id)
      .single(),
    "dry executing final manifest",
  );
  return {
    turns: [proposal, confirmed],
    money: moneyResult(
      [
        {
          name: "executing re-emission writes each action exactly once",
          ok:
            payments.length === 2 &&
            sameValue(
              payments.map((row) => rounded(row.original_amount)).sort((a, b) => a - b),
              [11.11, 12.22],
            ),
        },
        {
          name: "executing re-emission preserves verified parity without unavailable",
          ok:
            final.status === "verified" &&
            final.manifest_hash === proposed.manifest_hash &&
            Number(final.verification?.authorized_count) === 3 &&
            Number(final.verification?.verified_count) === 3 &&
            confirmed.result?.assistantMetadata?.agentOutcome?.hadError === false &&
            confirmed.result?.assistantMetadata?.loopDiagnostic?.code !== "unavailable",
        },
      ],
      { proposed, final, payments },
    ),
  };
}

async function runDryQuarantineRecoveryScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const occurrence = must(
    await admin
      .from("recurring_occurrences")
      .insert({
        user_id: persona.userId,
        debt_account_id: persona.cards[0].id,
        occurrence_date: today,
        kind: "debt_payment",
        mode: "ask",
        status: "pending",
        expected_amount: 50.6,
        currency: "USD",
      })
      .select("id")
      .single(),
    "dry quarantine occurrence",
  );
  const proposal = await turn(
    persona,
    "Registra el café de 5 USD desde Produbanco, confirma el aviso de Diners y cancela Viaje a Cartagena; todavía no indiqué la fuente del pago de la tarjeta.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-quarantine-write", "log_movements_batch", {
              movements: [
                {
                  type: "expense",
                  amount: 5,
                  description: "Café de prueba de cuarentena",
                  category: "food",
                  sourceAccountId: persona.account.id,
                  occurredAtISO: today,
                },
              ],
            }),
            mockCall(
              "dry-quarantine-terminal",
              "resolve_recurring_occurrence",
              {
                occurrenceId: occurrence.id,
                action: "confirm",
                scope: "from_now",
              },
            ),
            dryGraveGoalCancellationCall(persona, "dry-quarantine-goal"),
          ],
        },
        {
          content:
            "Preparé el café, la resolución del aviso y cancelar Viaje a Cartagena como un solo conjunto. ¿Confirmas la operación?",
          toolCalls: [],
        },
      ],
    },
  );
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,plan_version,status,manifest")
      .eq("user_id", persona.userId)
      .eq("status", "proposed")
      .single(),
    "dry quarantine proposal",
  );
  const confirmed = await turn(
    persona,
    "Sí, confirma ese conjunto exacto.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-quarantine-confirm", "confirm_operation", {
              operationId: proposed.operation_id,
              rationale: "La segunda delivery confirma el conjunto exacto.",
            }),
          ],
        },
        {
          content:
            "Registré el café y cancelé Viaje a Cartagena; el aviso de Diners quedó sin ejecutar porque todavía falta probar la fuente del pago.",
          toolCalls: [],
        },
      ],
    },
  );
  const read = await turn(persona, "¿Cuál es ahora mi saldo en Produbanco?", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-quarantine-read", "get_financial_context", {}),
        ],
      },
      {
        content: "Tu saldo actual en Produbanco es 995 USD.",
        toolCalls: [],
      },
    ],
  });
  const reset = await turn(persona, "Cancela lo anterior y empecemos de cero.", {
    mockCompletions: [
      {
        content:
          "Entendido. La operación anterior quedó cerrada; empezamos de cero desde el estado actual.",
        toolCalls: [],
      },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const operation = must(
    await admin
      .from("agent_operations")
      .select("id,status,last_error,result,state_version")
      .eq("user_id", persona.userId)
      .eq("id", proposed.operation_id)
      .single(),
    "dry quarantined operation",
  );
  const manifest = must(
    await admin
      .from("agent_operation_manifests")
      .select("status,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", proposed.operation_id)
      .eq("plan_version", proposed.plan_version)
      .single(),
    "dry quarantined manifest",
  );
  const steps = must(
    await admin
      .from("agent_operation_steps")
      .select("capability,status,result,affected_refs")
      .eq("user_id", persona.userId)
      .eq("operation_id", proposed.operation_id)
      .eq("plan_version", proposed.plan_version)
      .order("step_order"),
    "dry quarantined steps",
  );
  const added = newTransactions(before, after);
  const repeatedFallback =
    confirmed.reply === read.reply || read.reply === reset.reply;
  return {
    turns: [proposal, confirmed, read, reset],
    money: moneyResult(
      [
        {
          name: "executing terminal set becomes one receipt-preserving quarantine",
          ok:
            operation.status === "abandoned" &&
            operation.last_error?.code === "failed_quarantined" &&
            manifest.status === "failed_integrity" &&
            manifest.verification?.kind === "loop_quarantined" &&
            Number(manifest.verification?.verified_count) === 2 &&
            Number(manifest.verification?.terminal_count) === 1 &&
            steps.some(
              (step) =>
                step.status === "verified" &&
                step.affected_refs?.some((ref) => ref?.type === "transaction"),
            ) &&
            steps.some((step) => step.status === "needs_input"),
        },
        {
          name: "quarantine preserves exactly the applied money and never replays it",
          ok:
            added.length === 1 &&
            added[0]?.type === "expense" &&
            rounded(added[0]?.original_amount) === 5 &&
            accountBalance(after, persona.account.id) === 995,
        },
        {
          name: "stuck operation cannot repeat identical continuity errors",
          ok:
            !repeatedFallback &&
            [confirmed, read, reset].every(
              (row) => row.result?.assistantMetadata?.agentOutcome?.hadError !== true,
            ),
        },
        {
          name: "read and reset reach the model after quarantine",
          ok:
            read.result?.assistantMetadata?.toolTrace?.some(
              (trace) => trace.name === "get_financial_context",
            ) &&
            read.reply.includes("995") &&
            reset.reply.startsWith("Entendido"),
        },
      ],
      { operation, manifest, steps, added },
    ),
  };
}

async function runDryCalendarOverclaimScenario(scenario, persona) {
  const actualSource = must(
    await admin
      .from("accounts")
      .insert({
        user_id: persona.userId,
        name: "Cuenta Calendario Real",
        type: "bank",
        currency: "USD",
        current_balance_original: 500,
        current_balance_base: 500,
        is_currency_default: false,
      })
      .select("id,name,currency,current_balance_original")
      .single(),
    "dry calendar actual source",
  );
  const transactionId = String(
    must(
      await admin.rpc("kipu_apply_ledger_entry", {
        p_entry: {
          user_id: persona.userId,
          type: "expense",
          effect_type: "expense",
          sign: 1,
          description: "Internet auto-booked previo",
          category: "utilities",
          original_amount: 45,
          original_currency: "USD",
          exchange_rate_to_base: 1,
          base_amount: 45,
          base_currency: "USD",
          source_account_id: actualSource.id,
          recurring_expense_id: persona.fixedExpense.id,
          raw_input: "fixture DRY_CALENDAR_OVERCLAIM",
          input_channel: "chat",
          occurred_at: `${today}T12:00:00.000Z`,
          dedupe_key: `dry-calendar-overclaim:${persona.userId}`,
        },
      }),
      "dry calendar preexisting ledger row",
    ),
  );
  const occurrence = must(
    await admin
      .from("recurring_occurrences")
      .insert({
        user_id: persona.userId,
        fixed_expense_id: persona.fixedExpense.id,
        occurrence_date: today,
        kind: "expense",
        mode: "auto",
        status: "booked",
        expected_amount: 45,
        currency: "USD",
        created_transaction_id: transactionId,
      })
      .select("id,status,created_transaction_id")
      .single(),
    "dry calendar booked occurrence",
  );
  const before = await financialSnapshot(persona.userId);
  const resolved = await turn(
    persona,
    "El Internet ya está pagado desde Produbanco; márcalo pagado.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall(
              "dry-calendar-overclaim-resolve",
              "resolve_recurring_occurrence",
              {
                occurrenceId: occurrence.id,
                action: "confirm",
                paymentSourceAccountId: persona.account.id,
              },
            ),
          ],
        },
        {
          content:
            `El pago de Internet ya estaba registrado hoy desde ${actualSource.name}, no desde ${persona.account.name}. Al cerrar el aviso no moví dinero.`,
          toolCalls: [],
        },
        {
          content:
            `El pago de Internet ya estaba registrado hoy desde ${actualSource.name}, no desde ${persona.account.name}. Al cerrar el aviso no moví dinero.`,
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const resolvedOccurrence = must(
    await admin
      .from("recurring_occurrences")
      .select("status,created_transaction_id")
      .eq("user_id", persona.userId)
      .eq("id", occurrence.id)
      .single(),
    "dry calendar resolved occurrence",
  );
  const step = must(
    await admin
      .from("agent_operation_steps")
      .select("status,result,affected_refs,arguments")
      .eq("user_id", persona.userId)
      .eq("capability", "resolve_recurring_occurrence")
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    "dry calendar durable receipt",
  );
  const receipt = step.result?.data ?? null;
  const linked = Array.isArray(receipt?.linkedTransactions)
    ? receipt.linkedTransactions
    : [];
  const linkedFact = linked[0] ?? null;
  const mismatch = receipt?.sourceMismatch ?? null;
  const noNewMoney =
    sameValue(before.transactions, after.transactions) &&
    accountBalance(before, actualSource.id) ===
      accountBalance(after, actualSource.id) &&
    accountBalance(before, persona.account.id) ===
      accountBalance(after, persona.account.id);
  return {
    turns: [resolved],
    money: moneyResult(
      [
        {
          name: "calendar confirmation moves zero rows and preserves the linked payment",
          ok:
            noNewMoney &&
            resolvedOccurrence.status === "confirmed" &&
            resolvedOccurrence.created_transaction_id === transactionId &&
            receipt?.movedMoney === false,
        },
        {
          name: "durable receipt carries the real source and date from PostgreSQL",
          ok:
            linked.length === 1 &&
            linkedFact?.transaction?.kind === "transaction" &&
            linkedFact?.transaction?.value === transactionId &&
            linkedFact?.occurredAtISO?.startsWith(today) &&
            linkedFact?.actualSource?.kind === "account" &&
            linkedFact?.actualSource?.value === actualSource.id &&
            linkedFact?.actualSource?.name === actualSource.name &&
            !step.affected_refs?.some((ref) => ref?.type === "transaction"),
        },
        {
          name: "expected-versus-real source mismatch is mechanical and consumed in the reply",
          ok:
            mismatch?.kind === "source_account_mismatch" &&
            mismatch?.expected?.value === persona.account.id &&
            mismatch?.actual?.length === 1 &&
            mismatch.actual[0]?.value === actualSource.id &&
            resolved.reply.includes(actualSource.name) &&
            resolved.reply.includes(persona.account.name) &&
            resolved.reply.includes("no moví dinero"),
        },
      ],
      {
        occurrence: resolvedOccurrence,
        transactionId,
        actualSource,
        expectedSource: persona.account,
        step,
        transactionDelta: newTransactions(before, after),
      },
    ),
  };
}

async function runDryNoProgressRefusalScenario(scenario, persona) {
  const debt = persona.loan;
  must(
    await admin.from("income_sources").insert({
      user_id: persona.userId,
      name: "Sueldo DRY",
      amount: 500,
      currency: "USD",
      frequency: "monthly",
      expected_day: 28,
      is_variable: false,
      destination_account_id: persona.account.id,
    }),
    "dry no-progress seed real income",
  );
  const before = await financialSnapshot(persona.userId);
  const first = await turn(
    persona,
    `Pausa por ahora los pagos mensuales de ${debt.name}.`,
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-no-progress-first", "update_income", {
              incomeName: debt.name,
              action: "pause",
            }),
          ],
        },
        {
          content: `¿Confirmas que quieres pausar el ingreso llamado ${debt.name}?`,
          toolCalls: [],
        },
      ],
    },
  );
  // Diseño anti-apilamiento: la pregunta COMPLETA su operación; la memoria
  // del cortacircuitos viene del archivo (lectura 111), no de un awaiting.
  const operation = must(
    await admin
      .from("agent_operations")
      .select("id,status,pending_question")
      .eq("user_id", persona.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    "dry no-progress first operation",
  );
  const second = await turn(persona, "Sí.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-no-progress-second", "update_income", {
            incomeName: debt.name,
            action: "pause",
          }),
        ],
      },
      {
        content: `¿Confirmas otra vez que quieres pausar ${debt.name}?`,
        toolCalls: [],
      },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const secondOperationId =
    second.result?.assistantMetadata?.durableOperation?.id ?? null;
  const finalOperation = must(
    await admin
      .from("agent_operations")
      .select("id,status,pending_question,result")
      .eq("user_id", persona.userId)
      .eq("id", secondOperationId)
      .single(),
    "dry no-progress final operation",
  );
  const steps = must(
    await admin
      .from("agent_operation_steps")
      .select("capability,status,arguments,result,affected_refs")
      .eq("user_id", persona.userId)
      .in("operation_id", [operation.id, secondOperationId])
      .order("step_order"),
    "dry no-progress steps",
  );
  const manifests = must(
    await admin
      .from("agent_operation_manifests")
      .select("id")
      .eq("user_id", persona.userId)
      .in("operation_id", [operation.id, secondOperationId]),
    "dry no-progress manifests",
  );
  return {
    turns: [first, second],
    money: moneyResult(
      [
        {
          name: "repeated refusal writes no money and creates no manifest",
          ok:
            sameValue(before, after) &&
            manifests.length === 0 &&
            steps.length === 2 &&
            steps.every(
              (step) =>
                step.capability === "update_income" &&
                ["needs_input", "refused"].includes(step.status) &&
                step.result?.data?.loopRefusalClass ===
                  "entity_kind_mismatch_debt" &&
                step.affected_refs?.length === 0,
            ),
        },
        {
          name: "same capability intent and refusal exits without a third question",
          ok:
            finalOperation.status === "completed" &&
            finalOperation.pending_question == null &&
            !/[?¿]/u.test(second.reply) &&
            second.result?.assistantMetadata?.agentOutcome?.hadError === false,
        },
      ],
      { operation, finalOperation, steps, manifests },
    ),
  };
}

async function runDryClosePreflightScenario(scenario, persona) {
  const debt = persona.cards[0];
  const before = await financialSnapshot(persona.userId);
  const result = await turn(persona, `Cierra ${debt.name}.`, {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-close-preflight", "close_card", {
            debtAccountId: debt.id,
          }),
        ],
      },
      {
        content:
          `${debt.name} todavía tiene saldo. No la cerré porque ocultaría deuda; ` +
          "primero registra el pago real o corrige el saldo y luego vuelve a cerrarla.",
        toolCalls: [],
      },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const operation = must(
    await admin
      .from("agent_operations")
      .select("id,status,pending_question")
      .eq("user_id", persona.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    "dry close preflight operation",
  );
  const steps = must(
    await admin
      .from("agent_operation_steps")
      .select("capability,status,result,affected_refs")
      .eq("user_id", persona.userId)
      .eq("operation_id", operation.id),
    "dry close preflight step",
  );
  const manifests = must(
    await admin
      .from("agent_operation_manifests")
      .select("id")
      .eq("user_id", persona.userId)
      .eq("operation_id", operation.id),
    "dry close preflight manifests",
  );
  return {
    turns: [result],
    money: moneyResult(
      [
        {
          name: "live debt balance refuses before manifest proposal",
          ok:
            sameValue(before, after) &&
            manifests.length === 0 &&
            operation.status === "completed" &&
            operation.pending_question == null &&
            steps.length === 1 &&
            steps[0]?.capability === "close_card" &&
            steps[0]?.status === "refused" &&
            steps[0]?.result?.data?.loopRefusalClass === "live_debt_balance",
        },
        {
          name: "preflight returns truth and alternatives without claiming closure",
          ok:
            result.reply.includes("todavía tiene saldo") &&
            result.reply.includes("No la cerré") &&
            !newTransactions(before, after).length,
        },
      ],
      { operation, steps, manifests },
    ),
  };
}

async function runDryPostWriteAbortScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const result = await turn(
    persona,
    "Le presté 25 a María desde Produbanco y quedó debiéndomelos.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-post-write-abort", "record_person_payment", {
              direction: "out",
              amount: 25,
              person: "María",
              accountId: persona.account.id,
              isLoan: true,
              occurredAtISO: today,
            }),
          ],
        },
        {
          content:
            "Listo, prestaste 25 USD a María desde Produbanco y quedó como dinero por cobrar.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const created = after.receivables.filter(
    (row) => !before.receivables.some((prior) => prior.id === row.id),
  );
  const durableOperationId =
    result.result?.assistantMetadata?.durableOperation?.id ?? null;
  const durableSteps = durableOperationId
    ? must(
        await admin
          .from("agent_operation_steps")
          .select("step_key,status")
          .eq("user_id", persona.userId)
          .eq("operation_id", durableOperationId),
        "dry post-write abort durable steps",
      )
    : [];
  return {
    turns: [result],
    money: moneyResult(
      [
        {
          name: "post-write abort preserves exact money state",
          ok:
            added.length === 1 &&
            added[0]?.type === "expense" &&
            rounded(added[0]?.original_amount) === 25 &&
            created.length === 1 &&
            rounded(created[0]?.outstanding_amount) === 25,
        },
        {
          name: "post-write abort settles before receipt continuity and names forced completion",
          ok:
            result.httpOk === true &&
            result.result?.assistantMetadata?.agentOutcome?.wrote === true &&
            result.result?.assistantMetadata?.agentOutcome?.hadError === false &&
            result.result?.assistantMetadata?.loopDiagnostic?.code === "unavailable" &&
            result.result?.assistantMetadata?.loopDiagnostic?.turnFailure?.site ===
              "forced_completion" &&
            result.result?.assistantMetadata?.loopDiagnostic?.turnFailure?.token ===
              "Error" &&
            result.result?.assistantMetadata?.loopDiagnostic?.settleFailure == null &&
            result.result?.assistantMetadata?.durableOperation?.status === "completed" &&
            durableSteps.length === 1 &&
            durableSteps[0]?.status === "verified" &&
            /25/.test(result.reply),
        },
      ],
      {
        added,
        created,
        durableOperation: result.result?.assistantMetadata?.durableOperation ?? null,
        durableSteps,
        loopDiagnostic: result.result?.assistantMetadata?.loopDiagnostic ?? null,
      },
    ),
  };
}

async function runDryRepaymentScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const result = await turn(
    persona,
    "Juan me devolvió hoy 40 dólares del préstamo de 60 que ya tengo registrado. Entraron a Produbanco.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [mockCall("dry-repayment-read", "list_open_receivables", {})],
        },
        {
          content: null,
          toolCalls: [
            mockCall("dry-repayment-write", "record_person_payment", {
              direction: "in",
              amount: 40,
              person: "Juan",
              accountId: persona.account.id,
              inflowKind: "loan_repayment",
              receivableIds: [persona.receivable.id],
              occurredAtISO: today,
            }),
          ],
        },
        {
          content:
            "Listo, entraron 40 USD a Produbanco y el préstamo registrado de Juan quedó con 20 USD pendientes.",
          toolCalls: [],
        },
        {
          content:
            "Listo, entraron 40 USD a Produbanco y el préstamo registrado de Juan quedó con 20 USD pendientes.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const receivable = after.receivables.find(
    (row) => row.id === persona.receivable.id,
  );
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status")
      .eq("user_id", persona.userId)
      .eq("status", "proposed"),
    "dry repayment proposed manifests",
  );
  return {
    turns: [result],
    money: moneyResult(
      [
        {
          name: "registered repayment stays immediate",
          ok:
            proposed.length === 0 &&
            added.length === 1 &&
            added[0]?.type === "income" &&
            rounded(added[0]?.original_amount) === 40,
        },
        {
          name: "registered repayment links exact receivable",
          ok:
            accountBalance(after, persona.account.id) ===
              rounded(accountBalance(before, persona.account.id) + 40) &&
            rounded(receivable?.outstanding_amount) === 20 &&
            receivable?.status === "partial",
        },
      ],
      { added, receivable, proposed },
    ),
  };
}

async function runDryRentAuthorityScenario(scenario, persona) {
  const rentFixed = must(
    await admin
      .from("fixed_expenses")
      .insert({
        user_id: persona.userId,
        name: "Arriendo",
        amount: 1_010_786.7,
        currency: "USD",
        category: "housing",
        frequency: "monthly",
        expected_day: 10,
        payment_source_type: "account",
        payment_source_id: persona.account.id,
        is_variable: false,
        is_active: true,
      })
      .select("id,name,amount,currency,payment_source_type,payment_source_id")
      .single(),
    "dry rent authority fixture",
  );
  const before = await financialSnapshot(persona.userId);
  const result = await turn(
    persona,
    "Hola, acabo de pagar el arriendo.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: [
            mockCall("dry-rent-authority", "log_movement", {
              type: "expense",
              amount: 1_010_786.7,
              description: "Arriendo",
              category: "housing",
              sourceAccountId: persona.account.id,
              fixedExpenseId: rentFixed.id,
              occurredAtISO: today,
            }),
          ],
        },
        {
          content:
            "Listo, registré el arriendo por 1.010.786,70 USD desde Produbanco.",
          toolCalls: [],
        },
        {
          content:
            "Listo, registré el arriendo por 1.010.786,70 USD desde Produbanco.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const proposed = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status")
      .eq("user_id", persona.userId)
      .eq("status", "proposed"),
    "dry rent proposed manifests",
  );
  return {
    turns: [result],
    money: moneyResult(
      [
        {
          name: "stored rent source writes immediately",
          ok:
            proposed.length === 0 &&
            added.length === 1 &&
            added[0]?.type === "expense",
        },
        {
          name: "stored rent amount and linked source are exact",
          ok:
            rounded(added[0]?.original_amount) === 1_010_786.7 &&
            added[0]?.source_account_id === persona.account.id &&
            accountBalance(after, persona.account.id) ===
              rounded(accountBalance(before, persona.account.id) - 1_010_786.7),
        },
      ],
      { added, proposed, fixedExpense: rentFixed },
    ),
  };
}

async function runFounderScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const turns = [];
  let me4PreConfirmation = null;
  let me5PendingBeforeInspection = [];
  let me5PendingAfterInspection = [];
  turns.push(
    await turn(
      persona,
      "Hola. Ya pagué mi Diners en full, 22.14 de la Produbanco MV y 201.25 de la Titanium MV.",
    ),
  );
  const rank = {
    ME3: 1,
    ME4: 2,
    ME5: 3,
    ME6: 4,
    ME7: 5,
    ME8: 6,
    ME9: 8,
  }[scenario.id];
  if (rank >= 2) {
    turns.push(
      await turn(
        persona,
        "Todo desde mi Produbanco. Y para pagar me transfirieron 83.86 de un préstamo que no había registrado.",
      ),
    );
    if (scenario.id === "ME4") {
      me4PreConfirmation = await financialSnapshot(persona.userId);
      turns.push(
        await turn(
          persona,
          "Sí, confirma el conjunto completo: los tres pagos desde Produbanco y la devolución de capital no registrada.",
        ),
      );
    }
    if (scenario.id === "ME5") {
      me5PendingBeforeInspection = must(
        await admin
          .from("agent_operation_manifests")
          .select("id,operation_id,status,manifest_hash,manifest")
          .eq("user_id", persona.userId)
          .eq("status", "proposed"),
        "ME5 proposal before inspection",
      );
    }
  }
  if (rank >= 3) {
    turns.push(await turn(persona, "¿Qué dato te falta?", { channel: "web" }));
    if (scenario.id === "ME5") {
      me5PendingAfterInspection = must(
        await admin
          .from("agent_operation_manifests")
          .select("id,operation_id,status,manifest_hash,manifest")
          .eq("user_id", persona.userId)
          .eq("status", "proposed"),
        "ME5 proposal after inspection",
      );
    }
  }
  if (rank >= 4) {
    turns.push(
      await turn(
        persona,
        "Era una devolución: yo había prestado ese dinero y hoy me devolvieron 83.86. Ese préstamo original nunca lo registré.",
      ),
    );
  }
  let explainRequestId = null;
  if (rank >= 5) {
    const explained = await turn(
      persona,
      "¿Qué acabas de registrar y de dónde salió cada monto?",
    );
    explainRequestId = explained.requestId;
    turns.push(explained);
  }
  if (rank >= 6) {
    turns.push(
      await turn(
        persona,
        "¿Qué acabas de registrar y de dónde salió cada monto?",
        { requestId: explainRequestId },
      ),
    );
  }
  if (rank >= 8) {
    turns.push(
      await turn(
        persona,
        "Me equivoqué con todo lo anterior. Deshaz completa la operación de los tres pagos y la devolución.",
      ),
    );
    turns.push(await turn(persona, "Sí, hazlo."));
  }
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const cardIds = new Set(persona.cards.map((card) => card.id));
  const payments = added.filter(
    (row) => row.type === "debt_payment" && cardIds.has(row.debt_account_id),
  );
  const capital = added.filter(
    (row) => row.type === "adjustment" && rounded(row.original_amount) === 83.86,
  );
  const reversals = added.filter((row) => row.type === "reversal");
  const checks = [];
  if (scenario.id === "ME3") {
    checks.push({ name: "incomplete payment instruction writes zero rows", ok: added.length === 0 });
  } else if (scenario.id === "ME4") {
    checks.push(
      {
        name: "ME4 writes zero rows before its natural confirmation",
        ok: me4PreConfirmation !== null && sameValue(before, me4PreConfirmation),
      },
      {
        name: "ME4 confirmed payments land exactly",
        ok:
          payments.length === 3 &&
          sameValue(
            payments.map((row) => rounded(row.original_amount)).sort((a, b) => a - b),
            [22.14, 50.6, 201.25],
          ),
      },
      {
        name: "ME4 confirmed capital return lands as adjustment",
        ok:
          capital.length === 1 &&
          added.length === 4 &&
          added.every((row) => row.type !== "income"),
      },
      {
        name: "ME4 confirmed balance and cards are exact",
        ok:
          persona.cards.every((card) => debtBalance(after, card.id) === 0) &&
          accountBalance(after, persona.account.id) ===
            rounded(accountBalance(before, persona.account.id) - 273.99 + 83.86),
      },
    );
  } else if (scenario.id === "ME5") {
    checks.push(
      {
        name: "inspection executes zero rows from the cohesive pending set",
        ok: added.length === 0 && payments.length === 0 && capital.length === 0,
      },
      {
        name: "inspection preserves the exact durable proposal identity",
        ok:
          me5PendingBeforeInspection.length === 1 &&
          me5PendingAfterInspection.length === 1 &&
          me5PendingAfterInspection[0]?.id === me5PendingBeforeInspection[0]?.id &&
          me5PendingAfterInspection[0]?.operation_id ===
            me5PendingBeforeInspection[0]?.operation_id &&
          me5PendingAfterInspection[0]?.manifest_hash ===
            me5PendingBeforeInspection[0]?.manifest_hash &&
          me5PendingAfterInspection[0]?.manifest?.actions?.length === 4,
      },
      {
        name: "inspection leaves cards and source account unchanged",
        ok: sameValue(before, after),
      },
    );
  } else if (["ME6", "ME7", "ME8"].includes(scenario.id)) {
    checks.push(
      { name: "founder flow has three payments", ok: payments.length === 3 },
      { name: "capital return is one adjustment, never income", ok: capital.length === 1 && added.every((row) => row.type !== "income") },
      {
        name: "founder flow balance is exact",
        ok:
          accountBalance(after, persona.account.id) ===
            rounded(accountBalance(before, persona.account.id) - 273.99 + 83.86),
      },
    );
  } else {
    const forward = added.filter((row) => row.type !== "reversal");
    const forwardIds = new Set(forward.map((row) => row.id));
    checks.push(
      { name: "undo targets all four forward rows", ok: forward.length === 4 && reversals.length === 4 && reversals.every((row) => forwardIds.has(row.related_transaction_id)) },
      { name: "undo restores account", ok: accountBalance(after, persona.account.id) === accountBalance(before, persona.account.id) },
      { name: "undo restores every card", ok: persona.cards.every((card) => debtBalance(after, card.id) === rounded(card.current_balance_original)) },
    );
  }
  const extraBehaviorFailures = [];
  if (scenario.id === "ME5") {
    const open = must(
      await admin
        .from("agent_operations")
        .select("status,pending_question")
        .eq("user_id", persona.userId),
      "ME5 operations",
    );
    if (!open.some((row) => row.status === "awaiting_input" && row.pending_question?.trim())) {
      extraBehaviorFailures.push("ME5 lost its durable pending question");
    }
  }
  if (scenario.id === "ME8" && turns.at(-1)?.reply !== turns.at(-2)?.reply) {
    extraBehaviorFailures.push("exact redelivery did not replay the same published reply");
  }
  return {
    turns,
    money: moneyResult(checks, {
      added,
      accountBefore: accountBalance(before, persona.account.id),
      accountAfter: accountBalance(after, persona.account.id),
      ...(scenario.id === "ME5"
        ? {
            pendingBeforeInspection: me5PendingBeforeInspection[0] ?? null,
            pendingAfterInspection: me5PendingAfterInspection[0] ?? null,
          }
        : {}),
    }),
    extraBehaviorFailures,
  };
}

async function runBatchScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const turns = [
    await turn(
      persona,
      "Registra como una sola operación dos gastos de hoy desde Produbanco: 10 dólares en compra A y 20 dólares en compra B.",
    ),
  ];
  const afterOriginal = await financialSnapshot(persona.userId);
  const originalRows = newTransactions(before, afterOriginal).filter((row) => row.type === "expense");
  let targetOutsideTwenty = true;
  if (scenario.id === "ME10a2") {
    const originalOperation = must(
      await admin
        .from("agent_operations")
        .select("id")
        .eq("user_id", persona.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
      "original batch operation",
    );
    for (let index = 0; index < 21; index += 1) {
      turns.push(await turn(persona, `Sin hacer cambios, dime en una frase que viste este mensaje ${index + 1}.`));
    }
    const latest = must(
      await admin
        .from("agent_operations")
        .select("id")
        .eq("user_id", persona.userId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(20),
      "latest twenty operations",
    );
    targetOutsideTwenty = !latest.some((row) => row.id === originalOperation.id);
  }
  if (scenario.id !== "ME10a") {
    turns.push(
      await turn(
        persona,
        "Me equivoqué en esa operación: la compra A fueron 12 dólares y la compra B 19. Corrige la operación completa; reemplaza los datos anteriores, no agregues gastos encima.",
      ),
    );
    turns.push(await turn(persona, "Sí, aplica completa esa corrección tal como la planteaste."));
  }
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const checks = [];
  if (scenario.id === "ME10a") {
    checks.push(
      {
        name: "batch writes two exact expenses",
        ok:
          added.length === 2 &&
          added.every((row) => row.type === "expense") &&
          sameValue(added.map((row) => rounded(row.original_amount)).sort((a, b) => a - b), [10, 20]),
      },
      {
        name: "batch source delta exact",
        ok: accountBalance(after, persona.account.id) === accountBalance(before, persona.account.id) - 30,
      },
    );
  } else {
    const originalIds = new Set(originalRows.map((row) => row.id));
    const reversals = added.filter((row) => row.type === "reversal");
    const expenses = added.filter((row) => row.type === "expense");
    checks.push(
      { name: "correction reverses both exact originals", ok: reversals.length === 2 && reversals.every((row) => originalIds.has(row.related_transaction_id)) },
      { name: "correction writes only 12 and 19 replacements", ok: expenses.length === 4 && sameValue(expenses.map((row) => rounded(row.original_amount)).sort((a, b) => a - b), [10, 12, 19, 20]) },
      { name: "correction net delta exact", ok: accountBalance(after, persona.account.id) === accountBalance(before, persona.account.id) - 31 },
    );
    if (scenario.id === "ME10a2") checks.push({ name: "target is outside latest twenty", ok: targetOutsideTwenty });
  }
  return { turns, money: moneyResult(checks, { added, targetOutsideTwenty }) };
}

async function runRepaymentScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const turns = [
    await turn(
      persona,
      "Juan me devolvió hoy 40 dólares del préstamo de 60 que ya tengo registrado. Entraron a Produbanco.",
    ),
  ];
  const afterRepayment = await financialSnapshot(persona.userId);
  if (scenario.id === "ME10c") {
    turns.push(
      await turn(
        persona,
        "Deshaz completa la operación en la que Juan me devolvió 40 del préstamo registrado.",
      ),
    );
    turns.push(await turn(persona, "Sí, hazlo."));
  }
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const receivableAfterRepayment = afterRepayment.receivables.find((row) => row.id === persona.receivable.id);
  const receivableAfter = after.receivables.find((row) => row.id === persona.receivable.id);
  const checks = [
    {
      name: "repayment cash and receivable move together",
      ok:
        accountBalance(afterRepayment, persona.account.id) === accountBalance(before, persona.account.id) + 40 &&
        rounded(receivableAfterRepayment?.outstanding_amount) === 20 &&
        receivableAfterRepayment?.status === "partial",
    },
  ];
  if (scenario.id === "ME10b") {
    checks.push({ name: "repayment is one linked income row", ok: added.length === 1 && added[0]?.type === "income" && String(added[0]?.external_ref ?? "").startsWith("receivable_repayment:") });
  } else {
    const income = added.find((row) => row.type === "income");
    const reversal = added.find((row) => row.type === "reversal");
    checks.push(
      { name: "repayment undo is append-only linked", ok: added.length === 2 && reversal?.related_transaction_id === income?.id },
      { name: "repayment undo restores cash and receivable", ok: accountBalance(after, persona.account.id) === accountBalance(before, persona.account.id) && rounded(receivableAfter?.outstanding_amount) === 60 && receivableAfter?.status === "open" },
    );
  }
  return { turns, money: moneyResult(checks, { added, receivableAfterRepayment, receivableAfter }) };
}

async function runGeneratedLegacyScenario(scenario, persona, paraphrases) {
  const key = {
    ME11: "capital_return",
    ME12: "borrowed",
    ME12b: "registered_repayment",
    ME12c: "loan_out",
    ME13: "ambiguous",
    ME14: "no_action",
  }[scenario.id];
  const before = await financialSnapshot(persona.userId);
  const result = await turn(persona, paraphrases.legacy[key]);
  const turns = [result];
  let preConfirmation = null;
  if (scenario.id === "ME11" || scenario.id === "ME12") {
    preConfirmation = await financialSnapshot(persona.userId);
    turns.push(
      await turn(
        persona,
        scenario.id === "ME11"
          ? "Sí, confirma esa devolución como capital de un préstamo mío que nunca estuvo registrado."
          : "Sí, confirma que ese dinero fue prestado a mí y aumenta la deuda registrada.",
      ),
    );
  }
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const checks = [];
  if (scenario.id === "ME11") {
    checks.push(
      { name: "capital return writes zero rows before confirmation", ok: preConfirmation !== null && sameValue(before, preConfirmation) },
      { name: "capital return writes one adjustment", ok: added.length === 1 && added[0]?.type === "adjustment" && rounded(added[0]?.original_amount) === 83.86 },
      { name: "capital return raises cash only", ok: accountBalance(after, persona.account.id) === accountBalance(before, persona.account.id) + 83.86 && after.receivables.length === before.receivables.length },
    );
  } else if (scenario.id === "ME12") {
    checks.push(
      { name: "borrowed proceeds write zero rows before confirmation", ok: preConfirmation !== null && sameValue(before, preConfirmation) },
      { name: "borrowed proceeds are adjustment, not income", ok: added.length === 1 && added[0]?.type === "adjustment" && rounded(added[0]?.original_amount) === 83.86 },
      { name: "borrowed proceeds raise cash and exact liability", ok: accountBalance(after, persona.account.id) === accountBalance(before, persona.account.id) + 83.86 && debtBalance(after, persona.loan.id) === debtBalance(before, persona.loan.id) + 83.86 },
    );
  } else if (scenario.id === "ME12b") {
    const receivable = after.receivables.find((row) => row.id === persona.receivable.id);
    checks.push(
      { name: "generated registered repayment exact", ok: added.length === 1 && added[0]?.type === "income" && rounded(added[0]?.original_amount) === 40 },
      { name: "generated repayment lowers exact receivable", ok: accountBalance(after, persona.account.id) === accountBalance(before, persona.account.id) + 40 && rounded(receivable?.outstanding_amount) === 20 },
    );
  } else if (scenario.id === "ME12c") {
    const created = after.receivables.filter(
      (row) => !before.receivables.some((prior) => prior.id === row.id),
    );
    checks.push(
      { name: "outgoing loan writes one expense", ok: added.length === 1 && added[0]?.type === "expense" && rounded(added[0]?.original_amount) === 25 },
      { name: "outgoing loan lowers cash and creates receivable", ok: accountBalance(after, persona.account.id) === accountBalance(before, persona.account.id) - 25 && created.length === 1 && rounded(created[0]?.outstanding_amount) === 25 },
    );
  } else {
    checks.push({ name: "ambiguous/no-action prompt is read-only", ok: sameValue(before, after) });
  }
  return { turns, money: moneyResult(checks, { added, preConfirmation }) };
}

async function runNoActionScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const result = await turn(persona, "Gracias, eso era todo por ahora.");
  const after = await financialSnapshot(persona.userId);
  return {
    turns: [result],
    money: moneyResult(
      [{ name: "ordinary conversation makes no financial change", ok: sameValue(before, after) }],
      { financialStateUnchanged: sameValue(before, after) },
    ),
  };
}

async function runLifecycleScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const result = await turn(persona, "Pagué algo hoy, pero todavía no recuerdo cuánto ni desde dónde.");
  const after = await financialSnapshot(persona.userId);
  const operations = must(
    await admin
      .from("agent_operations")
      .select("status,pending_question")
      .eq("user_id", persona.userId),
    "lifecycle operations",
  );
  const lifecycleOk =
    operations.every((row) => row.status !== "applying") &&
    operations
      .filter((row) => row.status === "awaiting_input")
      .every((row) => typeof row.pending_question === "string" && row.pending_question.trim());
  return {
    turns: [result],
    money: moneyResult(
      [{ name: "incomplete lifecycle writes no money", ok: sameValue(before, after) }],
      { financialStateUnchanged: sameValue(before, after) },
    ),
    extraBehaviorFailures: lifecycleOk ? [] : ["operation remained applying or lost durable question"],
  };
}

async function executeScenario(scenario, persona, paraphrases) {
  if (scenario.id === "MA_L1_AMOUNT_FOLLOWUP") {
    return runModelAuthorityL1(persona);
  }
  if (scenario.id === "MA_L2_ASR_CHAIN") {
    return runModelAuthorityL2(persona);
  }
  if (scenario.id === "MA_L3_MODEL_ACCOUNT") {
    return runModelAuthorityL3(persona);
  }
  if (scenario.id === "MA_L4_ALIAS_MEMORY") {
    return runModelAuthorityL4(persona);
  }
  if (scenario.id === "MA_L5_VOICE_AMOUNT") {
    return runOla0FrictionScenario(
      {
        ...scenario,
        input: "Gasté seis mil pesos en McDonald's desde Supervielle.",
        amount: 6_000,
        type: "expense",
        description: "McDonald's",
        category: "food",
        currencyArgument: false,
        explicitInstrument: true,
      },
      persona,
    );
  }
  if (scenario.id === "MA_L6_CANCEL_STUCK") {
    return runModelAuthorityL6(persona);
  }
  if (scenario.id === "O0_LONG_CONVERSATION") {
    return runOla0LongConversationScenario(scenario, persona);
  }
  if (scenario.id === "O0_CLARIFIED_CAPTURE") {
    return runOla0ClarifiedCaptureScenario(scenario, persona);
  }
  if (scenario.group === "hr" || scenario.group === "hd" || scenario.group === "ga") {
    return runHumanRealismScenario(scenario, persona);
  }
  if (scenario.group === "ola0") {
    return runOla0FrictionScenario(scenario, persona);
  }
  if (scenario.id === "DRY_READ") return runDinersScenario(scenario, persona);
  if (scenario.id === "DRY_WRITE") return runDryWriteScenario(scenario, persona);
  if (scenario.id === "DRY_UNSTATED_ASK") return runDryUnstatedAskScenario(scenario, persona);
  if (scenario.id === "DRY_QUOTED_SLANG") return runDryQuotedSlangScenario(scenario, persona);
  if (scenario.id === "DRY_STACKED_CANCEL") return runDryStackedCancelScenario(scenario, persona);
  if (scenario.id === "DRY_SENSITIVE") return runDrySensitiveScenario(scenario, persona);
  if (scenario.id === "DRY_ORIGIN") return runDryOriginScenario(scenario, persona);
  if (scenario.id === "DRY_CAPITAL") return runDryCapitalScenario(scenario, persona);
  if (scenario.id === "DRY_LOAN_OUT") return runDryLoanOutScenario(scenario, persona);
  if (scenario.id === "DRY_CORRECTION") return runDryCorrectionScenario(scenario, persona);
  if (scenario.id === "DRY_CONSOLIDATION") return runDryConsolidationScenario(scenario, persona);
  if (scenario.id === "DRY_SUCCESSOR_PAY_CLOSE") {
    return runDrySuccessorPayCloseScenario(scenario, persona);
  }
  if (scenario.id === "DRY_SUCCESSOR_PAY_CLOSE_READ") {
    return runDrySuccessorPayCloseScenario(scenario, persona);
  }
  if (scenario.id === "DRY_POST_WRITE_ABORT") return runDryPostWriteAbortScenario(scenario, persona);
  if (scenario.id === "DRY_REPAYMENT") return runDryRepaymentScenario(scenario, persona);
  if (scenario.id === "DRY_RENT_AUTHORITY") return runDryRentAuthorityScenario(scenario, persona);
  if (scenario.id === "DRY_LIVE_REPLACEMENT") return runDryLiveReplacementScenario(scenario, persona);
  if (scenario.id === "DRY_OPERATION_SOURCE") return runDryOperationSourceScenario(scenario, persona);
  if (scenario.id === "DRY_BORROWED_LINK") return runDryBorrowedLinkScenario(scenario, persona);
  if (scenario.id === "DRY_SET_COHESION") return runDrySetCohesionScenario(scenario, persona);
  if (scenario.id === "DRY_CONFIRM_REEMIT_IDENTICAL") {
    return runDryConfirmReemitIdenticalScenario(scenario, persona);
  }
  if (scenario.id === "DRY_CONFIRM_REEMIT_MODIFIED") {
    return runDryConfirmReemitModifiedScenario(scenario, persona);
  }
  if (scenario.id === "DRY_EXECUTING_REEMIT") {
    return runDryExecutingReemitScenario(scenario, persona);
  }
  if (
    scenario.id === "DRY_CONTROL_CONFIRM_FIRST" ||
    scenario.id === "DRY_CONTROL_CONFIRM_LAST" ||
    scenario.id === "DRY_CONTROL_DIRECTION_RESOLVED"
  ) {
    return runDryCompletionControlScenario(scenario, persona);
  }
  if (scenario.id === "DRY_QUARANTINE_RECOVERY") {
    return runDryQuarantineRecoveryScenario(scenario, persona);
  }
  if (scenario.id === "DRY_CALENDAR_OVERCLAIM") {
    return runDryCalendarOverclaimScenario(scenario, persona);
  }
  if (scenario.id === "DRY_NO_PROGRESS_REFUSAL") {
    return runDryNoProgressRefusalScenario(scenario, persona);
  }
  if (scenario.id === "DRY_CLOSE_PREFLIGHT") {
    return runDryClosePreflightScenario(scenario, persona);
  }
  if (scenario.id === "DRY_INVESTMENT_PROPOSAL") {
    return runDryInvestmentProposalScenario(scenario, persona);
  }
  if (scenario.id === "DRY_UPDATE_ASSET_TRUTH") {
    return runDryUpdateAssetTruthScenario(scenario, persona);
  }
  if (scenario.id === "ME1" || scenario.id === "ME2") {
    return runDinersScenario(scenario, persona);
  }
  if (["ME3", "ME4", "ME5", "ME6", "ME7", "ME8", "ME9"].includes(scenario.id)) {
    return runFounderScenario(scenario, persona);
  }
  if (scenario.id === "ME10") return runNoActionScenario(scenario, persona);
  if (["ME10a", "ME10a2", "ME10aa"].includes(scenario.id)) {
    return runBatchScenario(scenario, persona);
  }
  if (["ME10b", "ME10c"].includes(scenario.id)) {
    return runRepaymentScenario(scenario, persona);
  }
  if (["ME11", "ME12", "ME12b", "ME12c", "ME13", "ME14"].includes(scenario.id)) {
    return runGeneratedLegacyScenario(scenario, persona, paraphrases);
  }
  if (scenario.id === "ME16") return runFourCreditsScenario(scenario, persona, false);
  if (scenario.id === "ME17" || scenario.id === "REAL_FOUR_CREDITS") {
    return runFourCreditsScenario(scenario, persona, true);
  }
  if (scenario.id === "ME15") return runLifecycleScenario(scenario, persona);
  if (scenario.id === "REAL_RENT") return runRentScenario(scenario, persona);
  if (scenario.group === "aspirational") {
    return runAspirationalScenario(scenario, persona, paraphrases);
  }
  throw new Error(`scenario has no executor: ${scenario.id}`);
}

const TURN_BUDGET = {
  ME1: 1,
  ME2: 1,
  ME3: 1,
  ME4: 2,
  ME5: 3,
  ME6: 4,
  ME7: 5,
  ME8: 6,
  ME9: 8,
  ME10: 1,
  ME10a: 1,
  ME10a2: 24,
  ME10aa: 3,
  ME10b: 1,
  ME10c: 3,
  ME11: 1,
  ME12: 1,
  ME12b: 1,
  ME12c: 1,
  ME13: 1,
  ME14: 1,
  ME16: 3,
  ME17: 4,
  ME15: 1,
  REAL_RENT: 2,
  REAL_FOUR_CREDITS: 4,
};
for (const scenario of ASPIRATIONAL_SCENARIOS) TURN_BUDGET[scenario.id] = 1;

function estimatedCost() {
  const fullTurns = Object.values(TURN_BUDGET).reduce((sum, value) => sum + value, 0);
  const observedTurns = Math.max(
    1,
    results.reduce((sum, result) => sum + result.turns.length, 0),
  );
  const observedJudgments = Math.max(1, results.length);
  const perAgentTurn = {
    inputTokens: usage.agent.inputTokens / observedTurns,
    cachedInputTokens: usage.agent.cachedInputTokens / observedTurns,
    outputTokens: usage.agent.outputTokens / observedTurns,
  };
  const perJudge = {
    inputTokens: usage.judge.inputTokens / observedJudgments,
    cachedInputTokens: usage.judge.cachedInputTokens / observedJudgments,
    outputTokens: usage.judge.outputTokens / observedJudgments,
  };
  const paraphrasePayload = canonicalText(cannedParaphrases);
  const fullParaphraseUsage = usage.paraphrase.calls > 0
    ? { ...usage.paraphrase }
    : {
        calls: 1,
        inputTokens: Math.ceil((paraphrasePayload.length + 500) / 4),
        cachedInputTokens: 0,
        outputTokens: Math.ceil(paraphrasePayload.length / 3),
      };
  const full = {
    agent: {
      calls: Math.round((usage.agent.calls / observedTurns) * fullTurns),
      inputTokens: Math.round(perAgentTurn.inputTokens * fullTurns),
      cachedInputTokens: Math.round(perAgentTurn.cachedInputTokens * fullTurns),
      outputTokens: Math.round(perAgentTurn.outputTokens * fullTurns),
    },
    judge: {
      calls: SCENARIOS.length,
      inputTokens: Math.round(perJudge.inputTokens * SCENARIOS.length),
      cachedInputTokens: Math.round(perJudge.cachedInputTokens * SCENARIOS.length),
      outputTokens: Math.round(perJudge.outputTokens * SCENARIOS.length),
    },
    paraphrase: fullParaphraseUsage,
  };
  const fullUsd =
    costFor(full.agent, COST_RATES.coach) +
    costFor(full.judge, COST_RATES.mini) +
    costFor(full.paraphrase, COST_RATES.mini);
  return {
    basis: mockRun
      ? "MOCK token telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog"
      : "observed smoke/full telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog",
    baseline: "native loop",
    scenarios: SCENARIOS.length,
    estimatedTurns: fullTurns,
    tokens: full,
    ratesUsdPerMillion: COST_RATES,
    estimatedUsd: Math.round(fullUsd * 100) / 100,
  };
}

async function handshake() {
  const unauthenticated = await evaluationFetch({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const wrongSecret = await evaluationFetch({
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer deliberately-wrong-m0-eval-secret",
    },
    body: "{}",
  });
  if (unauthenticated.status !== 404 || wrongSecret.status !== 404) {
    throw new Error(
      `local bridge accepted invalid authority: missing=${unauthenticated.status} wrong=${wrongSecret.status}`,
    );
  }
  const health = await evaluationFetch({
    method: "POST",
    headers: evaluationHeaders,
    body: JSON.stringify({ mode }),
  });
  const parsed = await parseHttpJson(health);
  if (
    health.status !== 400 ||
    parsed.body?.contract !== "m0-agent-eval-2026-08-24-native-loop-closure" ||
    parsed.body?.mode !== mode
  ) {
    throw new Error(
      `M0 handshake failed: ${canonicalText({ status: health.status, body: parsed.body ?? parsed.raw })}`,
    );
  }
  console.log(
    `Handshake: contract=${parsed.body.contract} mode=${parsed.body.mode} baseline=loop nativo`,
  );
}

const uniqueScenarioIds = new Set(SCENARIOS.map((scenario) => scenario.id));
if (
  uniqueScenarioIds.size !== SCENARIOS.length ||
  LEGACY_SCENARIOS.length !== 24 ||
  TRANSCRIPT_SCENARIOS.length !== 2 ||
  ASPIRATIONAL_FAMILIES.length !== 8 ||
  ASPIRATIONAL_SCENARIOS.length !== 24 ||
  DRY_SCENARIOS.length !== 32 ||
  ALWAYS_SENSITIVE.size !== 27 ||
  CONDITIONAL_SENSITIVITY_RULE_CODES.size !== 3
) {
  throw new Error("scenario catalog topology is incomplete or duplicated");
}
if (
  new Set(OLA0_SCENARIOS.map((scenario) => scenario.id)).size !==
    OLA0_SCENARIOS.length ||
  OLA0_FRICTION_SCENARIOS.length !== 8 ||
  OLA0_SCENARIOS.length !== 16 ||
  HR_SCENARIOS.length !== 11 ||
  new Set(HR_SCENARIOS.map((scenario) => scenario.id)).size !== 11 ||
  HD_SCENARIOS.length !== 12 ||
  new Set(HD_SCENARIOS.map((scenario) => scenario.id)).size !== 12 ||
  GA_SCENARIOS.length !== 12 ||
  new Set(GA_SCENARIOS.map((scenario) => scenario.id)).size !== 12
) {
  throw new Error("Ola0 catalog topology is incomplete or duplicated");
}

const selected = realSample
  ? [...HR_SCENARIOS, ...HD_SCENARIOS, ...GA_SCENARIOS].filter(
      (scenario) =>
        requestedScenarios.size === 0 || requestedScenarios.has(scenario.id),
    )
  : ola0
  ? OLA0_SCENARIOS.filter(
      (scenario) =>
        requestedScenarios.size === 0 || requestedScenarios.has(scenario.id),
    )
  : dryRun
    ? DRY_SCENARIOS.filter(
      (scenario) =>
        requestedScenarios.size === 0 || requestedScenarios.has(scenario.id),
    )
    : SCENARIOS.filter((scenario) =>
      requestedScenarios.size > 0
        ? requestedScenarios.has(scenario.id)
        : smoke
          ? REAL_SMOKE_SCENARIOS.has(scenario.id)
          : true,
    );
if (smoke && selected.length > 3) throw new Error("real smoke exceeds three scenarios");
if (!dryRun && smoke && (selected.length < 2 || selected.length > 3)) {
  throw new Error("real smoke must contain two or three scenarios");
}

const results = [];
const failures = [];
let paraphrases;
persistUsageSnapshot();
try {
  await handshake();
  paraphrases = await generateParaphrases();
  console.log(
    `Catálogo: legacy=${LEGACY_SCENARIOS.length}, transcripts=${TRANSCRIPT_SCENARIOS.length}, aspiracionales=${ASPIRATIONAL_FAMILIES.length}×3, total=${SCENARIOS.length}.`,
  );
  if (ola0) {
    console.log(
      `Ola 0 + autoridad MOCK: ${OLA0_FRICTION_SCENARIOS.length} dorados de fricción + conversación encadenada + L1–L6.`,
    );
  } else if (dryRun) {
    console.log(
      `Dry-run MOCK: ejecuta ${selected.length} recorridos representativos y valida estáticamente los ${SCENARIOS.length} contratos del catálogo.`,
    );
  }
  for (const scenario of selected) {
    let persona = null;
    const cleanupDiagnostics = [];
    try {
      persona = await seedPersona(scenario);
      const executed = await executeScenario(scenario, persona, paraphrases);
      observeAgentUsage(executed.turns);
      const conductFailures = [
        ...behaviorAssertions(executed.turns),
        ...(executed.extraBehaviorFailures ?? []),
        ...(await manifestAssertions(persona.userId)),
      ];
      const quality = await judgeScenario(
        scenario,
        executed.turns,
        executed.money.evidence,
      );
      const row = {
        scenario,
        turns: executed.turns,
        money: executed.money,
        conduct: {
          pass: conductFailures.length === 0,
          failures: conductFailures,
        },
        quality,
      };
      results.push(row);
      console.log(`\n[${scenario.id}] ${scenario.title}`);
      console.log(
        `  DINERO   ${row.money.pass ? "PASS" : "FAIL"}${row.money.failures.length ? ` · ${row.money.failures.join(" | ")}` : ""}`,
      );
      console.log(
        `  CONDUCTA ${row.conduct.pass ? "PASS" : "FAIL"}${row.conduct.failures.length ? ` · ${row.conduct.failures.join(" | ")}` : ""}`,
      );
      console.log(`  CALIDAD  ${canonicalText(row.quality)}`);
      console.log(
        `  TRANSCRIPT ${canonicalText(row.turns.map((turnRow) => ({
          assistant: turnRow.reply,
          user: turnRow.user,
        })))}`,
      );
      if (requestedScenarios.size > 0) {
        console.log(
          `  EVIDENCIA ${canonicalText({
            money: row.money.evidence,
            turns: row.turns.map(turnDetail),
          })}`,
        );
      }
      if (!row.money.pass || !row.conduct.pass) {
        console.error(
          `  DIAGNÓSTICO ${canonicalText({
            money: row.money.evidence,
            turns: row.turns.map(turnDetail),
          })}`,
        );
      }
      if (!row.money.pass || !row.conduct.pass) failures.push(scenario.id);
    } catch (error) {
      if (error instanceof EvalServerUnreachableError) throw error;
      const detail = boundedErrorText(error);
      failures.push(`${scenario.id}:ABORT`);
      console.error(`\n[${scenario.id}] ABORT · ${detail}`);
    } finally {
      await cleanupPersona(persona, cleanupDiagnostics);
      if (cleanupDiagnostics.length > 0) {
        failures.push(`${scenario.id}:CLEANUP`);
        console.error(
          `[${scenario.id}] CLEANUP FAIL · ${cleanupDiagnostics.join(" | ")}`,
        );
      } else if (persona) {
        console.log(`[${scenario.id}] cleanup por identidad: cero`);
      }
    }
  }
  await assertNoMarkedPersonas();
  console.log("Residuo de personas por catálogo auth: cero");
} catch (error) {
  failures.push("RUN_ABORT");
  console.error(`RUN_ABORT · ${boundedErrorText(error)}`);
}

const qualityAverage =
  results.length === 0
    ? null
    : results.reduce((sum, result) => sum + result.quality.average, 0) / results.length;
console.log(`\nloopUsage agregado: ${canonicalText(usage.agent)}`);
console.log(`Judge usage agregado: ${canonicalText(usage.judge)}`);
console.log(`Paraphrase usage agregado: ${canonicalText(usage.paraphrase)}`);
console.log(
  `${mockRun ? "Costo simulado por telemetría MOCK" : "Costo real acumulado"}: ${actualUsageCostUsd().toFixed(6)} USD`,
);
console.log(`Calidad promedio: ${qualityAverage == null ? "n/a" : qualityAverage.toFixed(2)}/5`);
console.log(`Costo estimado corrida completa: ${canonicalText(estimatedCost())}`);
console.log(
  `${ola0 ? "M0 Ola 0" : "M0 tres carriles"} (${mode}${mockRun ? ", MOCK" : smoke ? ", smoke real" : ""}): ${results.filter((row) => row.money.pass && row.conduct.pass).length}/${selected.length} duros verdes`,
);
if (failures.length > 0 || results.length !== selected.length) {
  console.error(`FAILURES: ${failures.join(" | ") || "coverage mismatch"}`);
  process.exitCode = 1;
}
