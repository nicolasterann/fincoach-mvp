// M0 Etapa 2 — black-box conversational battery with three independent lanes.
//
// The runner never imports the loop or planner. Every product turn crosses the
// local-only HTTP bridge and every hard financial assertion reads PostgreSQL.
//
//   node --env-file=.env.local scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --dry-run
//   node --env-file=.env.local scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --smoke
//   node --env-file=.env.local scripts/qa/m0-loop-conversation-e2e.mjs --mode=on

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
const smoke = args.has("--smoke");
const listOnly = args.has("--list");
const requestedScenarios = new Set(
  String(option("--scenario") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
if (mode !== "loop" && mode !== "on") {
  throw new Error("--mode=loop|on is required");
}
if (dryRun && mode !== "loop") {
  throw new Error("--dry-run is available only with --mode=loop");
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
if (!dryRun && !openAIKey) throw new Error("falta OPENAI_API_KEY para juez/paráfrasis");

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});
const openai = dryRun
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
  "correct_movement",
  "forget_life_context",
  "leave_household",
  "remove_asset",
  "remove_household_member",
  "remove_recurring_shared_expense",
  "reopen_account",
  "reset_personality_test",
  "reset_personalization_preference",
  "settle_household",
  "set_household_visibility",
  "undo_movement",
  "undo_recent_movements",
  "undo_agent_operation",
  "remove_duplicate",
  "transfer_household_ownership",
  "unshare_movement",
  "create_account",
  "create_card",
  "accept_household_invite",
  "add_household_participant",
  "household_invite_link",
  "invite_household_member",
  "respond_household_invite",
]);

const CONDITIONAL_SENSITIVITY_RULE_CODES = new Set([
  "confirmed_new",
  "confirmed_default_source",
  "cancel_goal",
  "material_fixed_expense_change",
  "future_recurring_resolution",
  "end_income",
  "large_scheduled_adjustment",
  "automatic_fx_refresh",
  "unrecorded_capital_return",
  "unrecorded_borrowed_funds",
]);

const conditionalSensitive = (capability, value) => {
  const row = value && typeof value === "object" ? value : {};
  return (
    row.confirmedNew === true ||
    row.confirmDefaultSource === true ||
    (capability === "update_goal" && row.status === "cancelled") ||
    (capability === "update_fixed_expense" &&
      (row.action === "delete" ||
        row.amountScope === "from_now" ||
        typeof row.isVariable === "boolean")) ||
    (capability === "resolve_recurring_occurrence" && row.scope === "from_now") ||
    (capability === "update_income" && row.action === "end") ||
    (capability === "schedule_change" &&
      row.kind === "adjust_percent" &&
      Math.abs(Number(row.value)) > 50) ||
    (capability === "set_exchange_rate" && row.autoRefresh === true)
    ||
    (capability === "record_person_payment" &&
      row.direction === "in" &&
      ["capital_return_unrecorded", "borrowed"].includes(row.inflowKind))
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
  { id: "DRY_SENSITIVE", title: "plomería propuesta y confirmación sensible", group: "dry" },
  { id: "DRY_ORIGIN", title: "ME3 sin origen propone tres pagos juntos", group: "dry" },
  { id: "DRY_CAPITAL", title: "devolución de capital propone y confirma", group: "dry" },
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
];
const REAL_SMOKE_SCENARIOS = new Set([
  "ME2",
  "ASP_PURCHASE_DECISION_1",
  "ASP_HUMAN_COACHING_1",
]);

if (listOnly) {
  for (const scenario of SCENARIOS) console.log(`${scenario.id}\t${scenario.title}`);
  process.exit(0);
}
for (const id of requestedScenarios) {
  const selectable = dryRun ? [...SCENARIOS, ...DRY_SCENARIOS] : SCENARIOS;
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
  ["card_payment_applications", "id", "user_id"],
  ["debt_statement_cycles", "id", "user_id"],
  ["recurring_occurrences", "id", "user_id"],
  ["chat_messages", "id", "user_id"],
  ["income_sources", "id", "user_id"],
  ["receivables", "id", "user_id"],
  ["transactions", "id", "user_id"],
  ["fixed_expenses", "id", "user_id"],
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
  const currency = rent ? "ARS" : "USD";
  const initialBalance = rent ? 2_000_000 : 1_000;
  const emailTag = `${scenario.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-${randomUUID()}`;
  const created = must(
    await admin.auth.admin.createUser({
      email: `kipu-${emailTag}@example.invalid`,
      email_confirm: true,
      user_metadata: {
        m0_loop_conversation_run: runTag,
        m0_loop_scenario: scenario.id,
      },
    }),
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
  const account = must(
    await admin
      .from("accounts")
      .insert({
        user_id: userId,
        name: rent ? "Supervielle" : "Produbanco",
        type: "bank",
        currency,
        current_balance_original: initialBalance,
        current_balance_base: initialBalance,
        is_currency_default: true,
      })
      .select("id,name,currency,current_balance_original")
      .single(),
    "account",
  );
  const cards = rent
    ? []
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
  const loan = rent
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
        amount: rent ? 1_010_786.7 : 45,
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
        name: rent ? "Viaje" : "Viaje a Cartagena",
        target_amount: rent ? 3_000_000 : 2_000,
        currency,
        current_amount: rent ? 300_000 : 200,
        target_date: "2027-03-01",
        goal_account_id: account.id,
        status: "active",
      })
      .select("id,name,target_amount,current_amount")
      .single(),
    "goal",
  );
  const receivable = rent
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
  if (!rent) {
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
    cards,
    loan,
    fixedExpense,
    goal,
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
  ]);
  const labels = ["accounts", "debts", "transactions", "receivables", "goals"];
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
      ...(dryRun ? { mockCompletions: options.mockCompletions ?? [] } : {}),
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
      body?.contract === "m0-agent-eval-2026-08-14-subtractive-semantic-plan-m0-11a" &&
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
  if (dryRun || smoke) return cannedParaphrases;
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
  if (dryRun) {
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

async function runDrySensitiveScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const proposal = await turn(persona, "Agrega una cuenta nueva llamada Ahorro MOCK en USD.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-sensitive", "create_account", {
            name: "Ahorro MOCK",
            kind: "bank",
            currency: "USD",
          }),
        ],
      },
      {
        content: "Preparé la creación de Ahorro MOCK. ¿Confirmas que la cree?",
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
  const repeated = await turn(persona, "Ahorro MOCK en USD, esos mismos datos.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-sensitive-repeat", "create_account", {
            name: "Ahorro MOCK",
            kind: "bank",
            currency: "USD",
          }),
        ],
      },
      {
        content:
          "Esos datos ya estaban en la propuesta y no la dupliqué. ¿Confirmas que cree exactamente esa cuenta?",
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
  const confirmed = await turn(persona, "Sí, crea exactamente esa cuenta.", {
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
        content: "Listo, creé la cuenta Ahorro MOCK en USD.",
        toolCalls: [],
      },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const created = after.accounts.filter(
    (account) => !before.accounts.some((prior) => prior.id === account.id),
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
        { name: "sensitive confirmation creates exact account", ok: created.length === 1 && created[0]?.name === "Ahorro MOCK" && created[0]?.currency === "USD" },
        { name: "sensitive manifest is verified with stable hash", ok: verified.length === 1 && verified[0]?.status === "verified" && verified[0]?.manifest_hash === proposed[0]?.manifest_hash },
        { name: "sensitive account creation moves no ledger money", ok: after.transactions.length === before.transactions.length },
      ],
      { created, proposed: proposed[0] ?? null, repeatedProposed: repeatedProposed[0] ?? null, verified: verified[0] ?? null },
    ),
  };
}

async function runDryOriginScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const proposal = await turn(
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
            "Preparé los tres pagos desde Produbanco, sin ejecutarlos. ¿Confirmas esa propuesta completa?",
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
    turns: [proposal],
    money: moneyResult(
      [
        {
          name: "ME3 source-less instruction writes zero rows",
          ok: sameValue(before, after),
        },
        {
          name: "ME3 produces one exact three-action proposal",
          ok:
            proposed.length === 1 &&
            proposed[0]?.manifest?.actions?.length === 3 &&
            proposed[0].manifest.actions.every(
              (action) => action.capability === "register_card_payment",
            ),
        },
      ],
      { proposed: proposed[0] ?? null, financialStateUnchanged: sameValue(before, after) },
    ),
  };
}

async function runDryCapitalScenario(scenario, persona) {
  const before = await financialSnapshot(persona.userId);
  const proposal = await turn(
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
            "Preparé acreditar 83.86 USD en Produbanco como devolución de capital, no como ingreso. ¿Confirmas esa interpretación?",
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
  const operationId = proposed[0]?.operation_id;
  if (!operationId) {
    const durableRows = must(
      await admin
        .from("agent_operations")
        .select("id,status,pending_question,result")
        .eq("user_id", persona.userId),
      "dry capital proposal diagnostics",
    );
    throw new Error(
      `DRY_CAPITAL_PROPOSAL_MISSING · ${canonicalText({
        proposalMetadata: proposal.result?.assistantMetadata ?? null,
        durableRows,
      })}`,
    );
  }
  const confirmed = await turn(persona, "Sí, confirma exactamente esa interpretación.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: [
          mockCall("dry-capital-confirm", "confirm_operation", {
            operationId,
            rationale: "El usuario confirmó la dirección económica propuesta.",
          }),
        ],
      },
      {
        content:
          "Listo, registré 83.86 USD en Produbanco como devolución de capital; no lo conté como ingreso.",
        toolCalls: [],
      },
    ],
  });
  const after = await financialSnapshot(persona.userId);
  const added = newTransactions(before, after);
  const verified = must(
    await admin
      .from("agent_operation_manifests")
      .select("operation_id,status,manifest_hash,verification")
      .eq("user_id", persona.userId)
      .eq("operation_id", operationId),
    "dry capital verified",
  );
  return {
    turns: [proposal, confirmed],
    money: moneyResult(
      [
        {
          name: "capital return waits for its exact manifest",
          ok:
            proposed.length === 1 &&
            proposed[0]?.manifest?.actions?.length === 1,
        },
        {
          name: "confirmed capital return lands once as adjustment",
          ok:
            added.length === 1 &&
            added[0]?.type === "adjustment" &&
            rounded(added[0]?.original_amount) === 83.86 &&
            added[0]?.destination_account_id === persona.account.id,
        },
        {
          name: "capital return balance and manifest settle exactly",
          ok:
            accountBalance(after, persona.account.id) ===
              rounded(accountBalance(before, persona.account.id) + 83.86) &&
            verified.length === 1 &&
            verified[0]?.status === "verified" &&
            verified[0]?.manifest_hash === proposed[0]?.manifest_hash,
        },
      ],
      { added, proposed: proposed[0] ?? null, verified: verified[0] ?? null },
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
    throw new Error("DRY_CORRECTION_PROPOSAL_MISSING");
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

async function runDryConsolidationScenario(scenario, persona) {
  const cards = await seedAuthorityCards(persona);
  const before = await financialSnapshot(persona.userId);
  const first = await turn(
    persona,
    "Deja cubiertos los cuatro créditos piloto.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: cards.map((card, index) =>
            mockCall(`dry-consolidate-pay-${index + 1}`, "register_card_payment", {
              cardName: card.name,
              paidInFull: true,
              fromAccount: persona.account.id,
              date: today,
            }),
          ),
        },
        {
          content:
            "Preparé cubrir los cuatro créditos desde Produbanco. ¿Confirmas esa propuesta?",
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
            "Consolidé una sola propuesta: primero pagar los cuatro créditos desde Produbanco y después cerrar las cuatro tarjetas. ¿Confirmas el conjunto?",
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
              rationale: "El usuario confirmó pagos y luego cierres.",
            }),
          ],
        },
        {
          content:
            "Listo: pagué 11,11, 12,22, 13,33 y 14,44 USD desde Produbanco, y después cerré las cuatro tarjetas.",
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
          name: "one successor carries pays before closes",
          ok:
            firstProposed.length === 1 &&
            manifests.filter((row) => row.status === "rejected").length === 1 &&
            manifests.filter((row) => row.status === "proposed").length === 1 &&
            actions.length === 8 &&
            actions.slice(0, 4).every(
              (action) => action.capability === "register_card_payment",
            ) &&
            actions.slice(4).every((action) => action.capability === "close_card"),
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
    "Perfecto, deja esos cuatro cubiertos desde mi Produbanco.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: cards.map((card, index) =>
            mockCall(`dry-successor-pay-${index + 1}`, "register_card_payment", {
              cardName: card.name,
              amount: [11.11, 12.22, 13.33, 14.44][index],
              fromAccount: "Produbanco",
            }),
          ),
        },
        {
          content:
            "Preparé los cuatro pagos exactos desde Produbanco. ¿Confirmas el conjunto?",
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
            "Preparé una sola propuesta: primero pagar los cuatro créditos desde Produbanco y después cerrar las cuatro tarjetas. ¿Confirmas el conjunto?",
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
              rationale: "La delivery confirma los cuatro pagos y cuatro cierres.",
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
            "Listo: pagué 11,11, 12,22, 13,33 y 14,44 USD desde Produbanco y cerré las cuatro tarjetas.",
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
          name: "successor pay-close contains exactly four payments then four closes",
          ok:
            successorRows.length === 2 &&
            successorRows[0]?.status === "rejected" &&
            actions.length === 8 &&
            actions.slice(0, 4).every(
              (action) => action.capability === "register_card_payment",
            ) &&
            actions.slice(4).every((action) => action.capability === "close_card"),
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
            Number(final?.verification?.authorized_count) === 8 &&
            Number(final?.verification?.verified_count) === 8,
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
    "Pagué Diners NT en full; prepara el registro y después te preciso la cuenta.",
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
          ],
        },
        {
          content: "Preparé el pago total de Diners NT. ¿Desde qué cuenta salió?",
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
            "Actualicé la única acción de Diners NT para que salga de Produbanco. ¿Confirmas esa versión vigente?",
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
          content: "Listo, registré el pago de Diners NT por 50,60 USD desde Produbanco.",
          toolCalls: [],
        },
      ],
    },
  );
  const after = await financialSnapshot(persona.userId);
  const payments = newTransactions(before, after).filter(
    (row) => row.type === "debt_payment",
  );
  const action = successor?.manifest?.actions?.[0];
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
            successor?.manifest?.actions?.length === 1 &&
            action?.capability === "register_card_payment" &&
            action?.arguments?.fromAccount === persona.account.id,
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
    "Pagué Diners NT en full desde Produbanco; prepara exactamente ese registro.",
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
          ],
        },
        {
          content:
            "Preparé el pago total de Diners NT con el origen que nombraste. ¿Confirmas ejecutarlo?",
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
          content: "Listo, pagué Diners NT por 50,60 USD desde Produbanco.",
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
            proposed[0]?.manifest?.actions?.length === 1 &&
            proposed[0]?.manifest?.actions?.[0]?.arguments?.fromAccount == null,
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
    "Alpaca me prestó 83,86 USD y entraron a Produbanco; prepara el préstamo recibido.",
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
          ],
        },
        {
          content:
            "Preparé acreditar 83,86 USD en Produbanco y aumentar la deuda Alpaca. ¿Confirmas esa interpretación?",
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
  const action = proposed[0]?.manifest?.actions?.[0];
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
            "Listo: acredité 83,86 USD en Produbanco y aumenté por el mismo monto la deuda Alpaca.",
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
            Number(finalManifest.verification?.authorized_count) === 1 &&
            Number(finalManifest.verification?.verified_count) === 1,
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
    "Registra estos cuatro hechos de hoy: pagué completo Produbanco MV, María me devolvió 83,86 USD de capital de un préstamo mío nunca registrado, y pagué completos Diners NT y Titanium MV. Los tres pagos salieron de la misma cuenta, pero todavía no te dije cuál.",
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
        ],
      },
      {
        content:
          "Preparé un solo conjunto: acreditar 83,86 USD de capital y pagar Produbanco MV, Diners NT y Titanium MV desde Produbanco. ¿Confirmas las cuatro acciones?",
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
                "La delivery posterior confirma las cuatro acciones del manifiesto cohesivo.",
            }),
          ],
        },
        {
          content:
            "Listo: acredité 83,86 USD de capital y pagué Produbanco MV por 22,14 USD, Diners NT por 50,60 USD y Titanium MV por 201,25 USD desde Produbanco.",
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
            Number(finalManifest.verification?.authorized_count) === 4 &&
            Number(finalManifest.verification?.verified_count) === 4,
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
    "Prepara un solo conjunto: la devolución de 83,86 USD de capital no registrado y los pagos completos de Produbanco MV, Diners NT y Titanium MV desde Produbanco.",
    {
      mockCompletions: [
        {
          content: null,
          toolCalls: dryCompletionControlProposalCalls(persona, `${prefix}-proposal`),
        },
        {
          content:
            "Preparé cuatro acciones: acreditar 83,86 USD de capital y pagar Produbanco MV, Diners NT y Titanium MV desde Produbanco. ¿Confirmas el conjunto?",
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
      : "Sí, confirma y ejecuta exactamente las cuatro acciones pendientes.";
  const confirmed = await turn(persona, confirmationMessage, {
    operationId: proposed.operation_id,
    mockCompletions: [
      {
        content: null,
        toolCalls: controlFirst ? [control, ...subset] : [...subset, control],
      },
      {
        content:
          "Listo: acredité 83,86 USD de capital y pagué Produbanco MV por 22,14 USD, Diners NT por 50,60 USD y Titanium MV por 201,25 USD desde Produbanco.",
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
          name: "control sibling subset executes only the four authorized actions",
          ok:
            added.length === 4 &&
            sameValue(
              added.map((row) => rounded(row.original_amount)).sort((a, b) => a - b),
              [22.14, 50.6, 83.86, 201.25],
            ) &&
            finalManifest?.status === "verified" &&
            Number(finalManifest?.verification?.authorized_count) === 4 &&
            Number(finalManifest?.verification?.verified_count) === 4,
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

function dryReemissionPaymentCalls(cards, accountId, prefix, firstAmount = null) {
  return cards.slice(0, 2).map((card, index) =>
    mockCall(`${prefix}-${index + 1}`, "register_card_payment", {
      cardName: card.name,
      ...(index === 0 && firstAmount !== null
        ? { amount: firstAmount, paidInFull: false }
        : { paidInFull: true }),
      fromAccount: accountId,
      date: today,
    }),
  );
}

async function runDryConfirmReemitIdenticalScenario(scenario, persona) {
  const cards = await seedAuthorityCards(persona);
  const before = await financialSnapshot(persona.userId);
  const proposalCalls = dryReemissionPaymentCalls(
    cards,
    persona.account.id,
    "dry-identical-proposal",
  );
  const proposal = await turn(persona, "Prepara cubrir los dos primeros créditos piloto.", {
    mockCompletions: [
      { content: null, toolCalls: proposalCalls },
      {
        content: "Preparé los dos pagos desde Produbanco. ¿Confirmas el conjunto?",
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
          content: "Listo, cubrí los créditos por 11,11 USD y 12,22 USD desde Produbanco.",
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
  const proposal = await turn(persona, "Prepara cubrir los dos primeros créditos piloto.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: dryReemissionPaymentCalls(
          cards,
          persona.account.id,
          "dry-modified-proposal",
        ),
      },
      {
        content: "Preparé los dos pagos desde Produbanco. ¿Confirmas el conjunto?",
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
          ),
        },
        {
          content: "Actualicé la propuesta: 10,11 USD para el primero y pago completo del segundo. ¿Confirmas el sucesor?",
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
          content: "Listo, pagué 10,11 USD del primero y 12,22 USD del segundo.",
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
            successor.manifest?.actions?.length === 2 &&
            successor.manifest.actions[0]?.arguments?.amount === 10.11 &&
            successor.manifest.actions[1]?.arguments?.paidInFull === true,
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
  const proposal = await turn(persona, "Prepara cubrir los dos primeros créditos piloto.", {
    mockCompletions: [
      {
        content: null,
        toolCalls: dryReemissionPaymentCalls(
          cards,
          persona.account.id,
          "dry-executing-proposal",
        ),
      },
      {
        content: "Preparé los dos pagos desde Produbanco. ¿Confirmas el conjunto?",
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
          ),
        },
        {
          content: "Listo, cubrí los créditos por 11,11 USD y 12,22 USD desde Produbanco.",
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
            Number(final.verification?.authorized_count) === 2 &&
            Number(final.verification?.verified_count) === 2 &&
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
    "Registra el café de 5 USD desde Produbanco y confirma el aviso de Diners; todavía no indiqué la fuente del pago de la tarjeta.",
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
          ],
        },
        {
          content:
            "Preparé el café y la resolución del aviso como un solo conjunto. ¿Confirmas la operación?",
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
            "Registré el café; el aviso de Diners quedó sin ejecutar porque todavía falta probar la fuente del pago.",
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
            Number(manifest.verification?.verified_count) === 1 &&
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
  if (scenario.id === "DRY_READ") return runDinersScenario(scenario, persona);
  if (scenario.id === "DRY_WRITE") return runDryWriteScenario(scenario, persona);
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
    basis: dryRun
      ? "MOCK token telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog"
      : "observed smoke/full telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog",
    baseline: mode === "on" ? "hybrid v44+M0.11A" : "native loop",
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
  if (unauthenticated.status !== 404) {
    throw new Error(`local bridge accepted missing authority: HTTP ${unauthenticated.status}`);
  }
  const health = await evaluationFetch({
    method: "POST",
    headers: evaluationHeaders,
    body: JSON.stringify({ mode }),
  });
  const parsed = await parseHttpJson(health);
  if (
    health.status !== 400 ||
    parsed.body?.contract !== "m0-agent-eval-2026-08-14-subtractive-semantic-plan-m0-11a" ||
    parsed.body?.mode !== mode
  ) {
    throw new Error(
      `M0 handshake failed: ${canonicalText({ status: health.status, body: parsed.body ?? parsed.raw })}`,
    );
  }
  console.log(
    `Handshake: contract=${parsed.body.contract} mode=${parsed.body.mode} baseline=${mode === "on" ? "HÍBRIDO v44+M0.11A" : "loop nativo"}`,
  );
}

const uniqueScenarioIds = new Set(SCENARIOS.map((scenario) => scenario.id));
if (
  uniqueScenarioIds.size !== SCENARIOS.length ||
  LEGACY_SCENARIOS.length !== 24 ||
  TRANSCRIPT_SCENARIOS.length !== 2 ||
  ASPIRATIONAL_FAMILIES.length !== 8 ||
  ASPIRATIONAL_SCENARIOS.length !== 24 ||
  ALWAYS_SENSITIVE.size !== 32 ||
  CONDITIONAL_SENSITIVITY_RULE_CODES.size !== 10
) {
  throw new Error("scenario catalog topology is incomplete or duplicated");
}

const selected = dryRun
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
  if (dryRun) {
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
console.log(`Costo real acumulado: ${actualUsageCostUsd().toFixed(6)} USD`);
console.log(`Calidad promedio: ${qualityAverage == null ? "n/a" : qualityAverage.toFixed(2)}/5`);
console.log(`Costo estimado corrida completa: ${canonicalText(estimatedCost())}`);
console.log(
  `M0 tres carriles (${mode}${dryRun ? ", MOCK" : smoke ? ", smoke real" : ""}): ${results.filter((row) => row.money.pass && row.conduct.pass).length}/${selected.length} duros verdes`,
);
if (failures.length > 0 || results.length !== selected.length) {
  console.error(`FAILURES: ${failures.join(" | ") || "coverage mismatch"}`);
  process.exitCode = 1;
}
