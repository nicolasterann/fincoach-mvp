// Bloque M0 — live-model conversational E2E with a disposable persona.
// Requires migration 100, a local Next dev server with KIPU_AGENT_MODE=on and
// the real OpenAI/Supabase credentials:
//   node --env-file=.env.local ./scripts/qa/m0-model-conversation-e2e.mjs
//
// This is intentionally not a transcript-only test. It generates unseen
// paraphrases at run time, exercises the real chat handler through a local-only
// route, inspects durable operations and money, and deletes the persona even on
// failure. A model choosing a good sentence while the writer does the wrong
// thing is red; so is correct money behind a canned/vague answer.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const base = specifier.startsWith("@/")
      ? path.resolve("src", specifier.slice(2))
      : specifier.startsWith(".") &&
          context.parentURL?.startsWith("file:") &&
          new URL(context.parentURL).pathname.includes("/src/")
        ? path.resolve(path.dirname(new URL(context.parentURL).pathname), specifier)
        : null;
    if (!base) return nextResolve(specifier, context);
    const target = fs.existsSync(`${base}.ts`)
      ? `${base}.ts`
      : fs.existsSync(`${base}.tsx`)
        ? `${base}.tsx`
        : base;
    return nextResolve(pathToFileURL(target).href, context);
  },
});

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const EVAL_SECRET = process.env.M0_EVAL_SECRET;
const APP = process.env.KIPU_MODEL_EVAL_URL ?? "http://127.0.0.1:3000";
if (!URL_ || !SRK || !OPENAI_KEY || !EVAL_SECRET) {
  throw new Error("faltan credenciales Supabase/OpenAI o M0_EVAL_SECRET");
}
const admin = createClient(URL_, SRK, { auth: { persistSession: false } });
const openai = new OpenAI({ apiKey: OPENAI_KEY, timeout: 45_000, maxRetries: 1 });
const evaluationHeaders = {
  "content-type": "application/json",
  authorization: `Bearer ${EVAL_SECRET}`,
};
const { planKipuRequest } = await import("@/lib/ai/agent/agent-planner");
const { KIPU_TOOL_SCHEMAS, agentToolEffectMode, isReadOnlyAgentTool } = await import(
  "@/lib/ai/agent/kipu-agent-tools"
);
const { hasDisallowedKipuVoice } = await import("@/lib/ai/voice-policy");
const { replyAcknowledgesPendingClarifications } = await import(
  "@/lib/ai/agent/kipu-agent"
);
const { M0_AGENT_EVAL_CONTRACT, pendingClarificationTargetsScope } = await import(
  "@/lib/ai/agent/m0-eval-contract"
);
const { resolveOccurrence } = await import(
  "@/lib/financial/recurring-resolve"
);
const {
  beginAgentOperationApplication,
  claimAgentOperation,
  readRecentCompletedAgentOperations,
  saveAgentOperationPlan,
  transitionAgentOperation,
  verifyAgentOperation,
} = await import("@/lib/ai/agent/agent-operation-store");

let executed = 0;
let passed = 0;
const failures = [];
const blocked = [];
const focusThrough = process.env.M0_MODEL_FOCUS_THROUGH ?? "";
class FocusComplete extends Error {}
function check(name, ok, detail = "") {
  executed += 1;
  if (ok) {
    passed += 1;
    console.log(`  ok   · ${name}`);
  } else {
    failures.push(name);
    console.error(`  FALL · ${name}${detail ? `\n         ${detail}` : ""}`);
  }
  return Boolean(ok);
}
function checkDependent(name, dependencyOk, dependencyName, ok, detail = "") {
  if (dependencyOk) return check(name, ok, detail);
  executed += 1;
  blocked.push(`${name} ← ${dependencyName}`);
  console.error(
    `  BLOCKED · ${name}\n            dependencia fallida: ${dependencyName}` +
      (detail ? `\n            observado: ${detail}` : ""),
  );
  return false;
}
/** v32: `turn()` already captures the durable operations/intake rows of a
 * failed delivery, but a check whose detail was just `turn.reply` printed an
 * empty string and the persona was gone by cleanup — a red check with no
 * cause. Always render the typed diagnosis alongside the reply. Bounded to
 * status/error codes; never raw prompts or user text. */
function turnDetail(turn, extra = null) {
  const failures = (turn?.error?.operations ?? [])
    .filter((row) => row?.last_error)
    .map((row) => ({
      status: row.status,
      last_error: row.last_error,
      publicationFailure: row.result?.publicationFailure ?? null,
      omitted: row.result?.omittedResponseRequirementIds ?? null,
      moneyGroundingFailures:
        row.result?.moneyGroundingFailures ??
        row.last_error?.money_grounding_failures ??
        null,
      requirements: (row.plan?.response_requirements ?? []).map((req) => ({
        kind: req.kind,
        role: req.role,
        entity_ref: req.entity_ref,
        value: req.value,
      })),
    }));
  return JSON.stringify({
    reply: turn?.reply ?? "",
    deliveryAttempts: turn?.deliveryAttempts ?? null,
    httpStatus: turn?.error?.status ?? null,
    operationFailures: failures.length > 0 ? failures : null,
    // A planner/intake failure can recover to a truthful HTTP 200 no-write
    // reply. `turn()` already captured its bounded assistant metadata plus the
    // matching durable rows; report that path too instead of looking only at
    // the HTTP-error branch and deleting the only actionable diagnosis during
    // disposable cleanup.
    successfulIntakeFailure: turn?.intakeDiagnostic ?? null,
    intakeFailures: turn?.error?.intakeFailures ?? null,
    ...(extra ? { extra } : {}),
  });
}

function must(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
function mustOperation(result, label) {
  if (!result?.ok) throw new Error(`${label}: ${result?.error ?? "operation failed"}`);
  return result;
}
const money = (value) => Math.round(Number(value) * 100) / 100;
const chatId = `m0-model-${Date.now()}`;
let userId = null;

const touched = [
  ["agent_operation_reversals", "user_id"],
  ["debt_proceeds_applications", "user_id"],
  ["receivable_repayment_applications", "user_id"],
  ["agent_operation_steps", "user_id"],
  ["agent_operation_deliveries", "user_id"],
  ["agent_intake_failures", "user_id"],
  ["agent_operations", "user_id"],
  ["recurring_occurrence_satisfactions", "user_id"],
  ["financial_facts", "user_id"],
  ["card_payment_applications", "user_id"],
  ["debt_statement_cycles", "user_id"],
  ["recurring_occurrences", "user_id"],
  ["chat_messages", "user_id"],
  ["income_sources", "user_id"],
  ["receivables", "user_id"],
  ["transactions", "user_id"],
  ["debt_accounts", "user_id"],
  ["accounts", "user_id"],
  ["user_engagement", "user_id"],
  ["profiles", "id"],
];

async function turn(message, requestId = randomUUID(), channel = "telegram") {
  // A missing publishable model reply is deliberately a transport failure: the
  // product keeps the durable intake/operation and Telegram retries the SAME
  // delivery. Exercise that contract instead of aborting the entire semantic
  // suite on the first transient sample. Never mint a new requestId here — a
  // new identity could repeat money that already landed.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`${APP}/dev/m0-agent-eval`, {
      method: "POST",
      headers: evaluationHeaders,
      body: JSON.stringify({ userId, message, requestId, chatId, channel }),
    });
    const body = await response.json();
    if (body?.contract !== M0_AGENT_EVAL_CONTRACT) {
      throw new Error(
        `M0 eval server/source mismatch: expected ${M0_AGENT_EVAL_CONTRACT}, got ${String(body?.contract ?? "missing")}. Restart the local Next server before interpreting model results.`,
      );
    }
    if (response.ok && body?.ok && body.result) {
      const agentIntakeFailure =
        body.result.assistantMetadata?.agentIntakeFailure ?? null;
      const durableIntakeRead = agentIntakeFailure && userId
        ? await admin.from("agent_intake_failures")
            .select("delivery_key,stage,attempts,status,last_error")
            .eq("user_id", userId)
            .order("updated_at", { ascending: false })
            .limit(3)
        : { data: null, error: null };
      return {
        requestId,
        reply: String(body.result.chatResponse?.message ?? ""),
        result: body.result,
        deliveryAttempts: attempt,
        intakeDiagnostic: agentIntakeFailure
          ? {
              metadata: agentIntakeFailure,
              durableRows: durableIntakeRead.data,
              durableReadError: durableIntakeRead.error?.message ?? null,
            }
          : null,
      };
    }
    const retryable =
      response.status === 500 &&
      /no publishable reply; retry the exact delivery/i.test(String(body?.error ?? ""));
    if (retryable && attempt < 3) continue;
    const [operationDiagnostic, intakeDiagnostic] = userId
      ? await Promise.all([
          admin.from("agent_operations")
            .select("id,status,state_version,plan,context_coverage,missing_fields,pending_question,result,last_error")
            .eq("user_id", userId)
            .order("updated_at", { ascending: false })
            .limit(3),
          admin.from("agent_intake_failures")
            .select("delivery_key,stage,attempts,status,last_error")
            .eq("user_id", userId)
            .order("updated_at", { ascending: false })
            .limit(3),
        ])
      : [
          { data: null, error: null },
          { data: null, error: null },
        ];
    // A single conversational sample must not hide the remaining semantic
    // surface. Return a typed failed turn so its named check goes red and the
    // suite continues. Contract/source mismatch above still throws because it
    // invalidates the entire measurement rather than one product behavior.
    return {
      requestId,
      reply: "",
      result: {},
      deliveryAttempts: attempt,
      error: {
        status: response.status,
        body,
        operations: operationDiagnostic.data,
        intakeFailures: intakeDiagnostic.data,
        diagnosticError:
          operationDiagnostic.error?.message ??
          intakeDiagnostic.error?.message ??
          null,
      },
    };
  }
  throw new Error("chat retry loop exhausted without a result");
}

function neutral(reply) {
  return (
    reply.trim().length > 0 &&
    !hasDisallowedKipuVoice(reply) &&
    !/(?:^|[.!?;:]\s*)de una(?:\s*[.!?,;:]|$)|\b(?:tranqui|che|ninja|amable|suave)\b/i.test(reply)
  );
}

function turnHasDurablePendingScope(turnResult, target) {
  const metadata = turnResult?.result?.assistantMetadata;
  const pending = metadata?.agentPendingClarifications ?? [];
  const planActions = metadata?.durableOperation?.plan?.actions ?? [];
  return (
    metadata?.agentOutcome?.wrote === false &&
    metadata?.durableOperation?.status === "awaiting_input" &&
    pending.some((row) =>
      pendingClarificationTargetsScope(row, planActions, target),
    )
  );
}

async function balances(accountId, cardIds) {
  const [accountRead, cardsRead, txRead] = await Promise.all([
    admin.from("accounts").select("current_balance_original").eq("id", accountId).single(),
    admin.from("debt_accounts").select("id,current_balance_original,full_payment_due").in("id", cardIds),
    admin.from("transactions").select("id,type,original_amount,external_ref").eq("user_id", userId),
  ]);
  return {
    account: money(must(accountRead, "account balance").current_balance_original),
    cards: must(cardsRead, "card balances"),
    transactions: must(txRead, "transactions"),
  };
}

async function completeArchiveFiller(index) {
  const claimed = mustOperation(
    await claimAgentOperation({
      userId,
      deliveryKey: `telegram:m0-model:archive:${index}:${randomUUID()}`,
      channel: "telegram",
      chatId,
      rootMessageId: "",
      requestText: `Operación de archivo posterior ${index}`,
    }),
    `archive claim ${index}`,
  );
  const saved = mustOperation(
    await saveAgentOperationPlan({
      userId,
      operationId: claimed.id,
      expectedVersion: claimed.stateVersion,
      plan: {
        goal: `Archivar respuesta de lectura ${index}`,
        interpretation: "No requiere una mutación financiera.",
        assertions: [],
        ambiguities: [],
        required_reads: [],
        actions: [],
        postconditions: [],
        response_intent: "answer",
        requires_replan_after_reads: false,
      },
      coverage: {
        ok: true,
        complete: true,
        asOf: new Date().toISOString(),
        consulted: ["m0_model_fixture"],
        failed: [],
        truncated: [],
      },
      missingFields: [],
      pendingQuestion: null,
      leaseToken: claimed.leaseToken,
    }),
    `archive save ${index}`,
  );
  const lease = mustOperation(
    await beginAgentOperationApplication({
      userId,
      operationId: claimed.id,
      expectedVersion: saved.stateVersion,
    }),
    `archive lease ${index}`,
  );
  const verifying = mustOperation(
    await transitionAgentOperation({
      userId,
      operationId: claimed.id,
      expectedVersion: lease.stateVersion,
      status: "verifying",
      leaseToken: lease.leaseToken,
      result: { reply: `archivo ${index}` },
    }),
    `archive verifying ${index}`,
  );
  const verified = mustOperation(
    await verifyAgentOperation({
      userId,
      operationId: claimed.id,
      leaseToken: lease.leaseToken,
      postWriteContextVerified: true,
    }),
    `archive verify ${index}`,
  );
  mustOperation(
    await transitionAgentOperation({
      userId,
      operationId: claimed.id,
      expectedVersion: verifying.stateVersion,
      status: "completed",
      leaseToken: lease.leaseToken,
      result: { reply: `archivo ${index}`, verification: verified },
    }),
    `archive complete ${index}`,
  );
}

try {
  // Host is not authority: a tunnel client can send `Host: localhost`. Prove
  // the bridge refuses both absent and divergent credentials before allowing
  // the disposable persona to invoke the money-writing orchestrator.
  const unauthenticated = await fetch(`${APP}/dev/m0-agent-eval`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const wrongSecret = await fetch(`${APP}/dev/m0-agent-eval`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${EVAL_SECRET}-wrong`,
      host: "localhost",
    },
    body: "{}",
  });
  if (unauthenticated.status !== 404 || wrongSecret.status !== 404) {
    throw new Error(
      `local M0 route accepted missing/spoofed authority: ${unauthenticated.status}/${wrongSecret.status}`,
    );
  }

  // Fail early if the authenticated local bridge is not available; a static
  // planner test is not accepted as a substitute for the public chat
  // orchestrator.
  const health = await fetch(`${APP}/dev/m0-agent-eval`, {
    method: "POST",
    headers: evaluationHeaders,
    body: "{}",
  });
  const healthBody = await health.json().catch(() => null);
  if (
    health.status !== 400 ||
    healthBody?.contract !== M0_AGENT_EVAL_CONTRACT
  ) {
    throw new Error(`local M0 route unavailable or unsafe: HTTP ${health.status}`);
  }

  const created = must(await admin.auth.admin.createUser({
    email: `kipu-m0-model-${Date.now()}@example.invalid`,
    email_confirm: true,
    user_metadata: { kipu_smoke: true },
  }), "create persona");
  userId = created.user.id;
  must(await admin.from("profiles").upsert({
    id: userId,
    base_currency: "USD",
    onboarding_completed: true,
  }), "profile");
  must(await admin.from("user_engagement").upsert({
    user_id: userId,
    timezone: "America/Guayaquil",
  }), "engagement");
  const account = must(await admin.from("accounts").insert({
    user_id: userId,
    name: "Produbanco",
    type: "bank",
    currency: "USD",
    current_balance_original: 1000,
    current_balance_base: 1000,
    is_currency_default: true,
  }).select("id").single(), "account");
  const userToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const salarySource = must(await admin.from("income_sources").insert({
    user_id: userId,
    name: "Sueldo Ecuador",
    amount: 575.89,
    currency: "USD",
    frequency: "monthly",
    expected_day: Number(userToday.slice(-2)),
    is_variable: false,
    destination_account_id: account.id,
  }).select("id").single(), "salary source");
  const salaryOccurrence = must(await admin.from("recurring_occurrences").insert({
    user_id: userId,
    income_source_id: salarySource.id,
    occurrence_date: userToday,
    kind: "income",
    mode: "ask",
    status: "pending",
    expected_amount: 575.89,
    currency: "USD",
  }).select("id").single(), "salary occurrence");
  const salaryResolution = await resolveOccurrence({
    userId,
    occurrenceId: salaryOccurrence.id,
    action: "confirm",
    defaultPaymentDateISO: userToday,
    operationId: `m0-salary-fixture:${randomUUID()}`,
  });
  if (!salaryResolution.ok) {
    throw new Error(`salary fixture did not land: ${salaryResolution.detail}`);
  }
  const cards = must(await admin.from("debt_accounts").insert([
    { user_id: userId, name: "Diners NT", type: "credit_card", currency: "USD", current_balance_original: 50.6, current_balance_base: 50.6, full_payment_due: 50.6, statement_total_due: 50.6, statement_covered: false, statement_date: "2026-07-16", due_day: 3, cutoff_day: 15, default_payment_account_id: account.id },
    { user_id: userId, name: "Produbanco MV", type: "credit_card", currency: "USD", current_balance_original: 22.14, current_balance_base: 22.14, full_payment_due: 22.14, statement_total_due: 22.14, statement_covered: false, default_payment_account_id: account.id },
    { user_id: userId, name: "Titanium MV", type: "credit_card", currency: "USD", current_balance_original: 201.25, current_balance_base: 201.25, full_payment_due: 201.25, statement_total_due: 201.25, statement_covered: false, default_payment_account_id: account.id },
  ]).select("id,name"), "cards");
  const diners = cards.find((card) => card.name === "Diners NT");
  if (!diners) throw new Error("Diners fixture missing");
  const occurrence = must(await admin.from("recurring_occurrences").insert({
    user_id: userId,
    debt_account_id: diners.id,
    occurrence_date: "2026-07-15",
    kind: "card_statement",
    mode: "ask",
    status: "pending",
    ask_count: 2,
  }).select("id").single(), "statement occurrence");
  must(await admin.from("debt_statement_cycles").insert({
    user_id: userId,
    debt_account_id: diners.id,
    statement_date: "2026-07-16",
    full_payment_due: 50.6,
    due_day: 3,
    applied: true,
    is_current: true,
    reason: "m0-model-eval",
  }), "statement fact");
  const satisfied = must(await admin.from("recurring_occurrences")
    .select("satisfied_fact_id").eq("id", occurrence.id).single(), "satisfaction");
  check("ME1 · el hecho de Diners ya está ligado antes de conversar", !!satisfied.satisfied_fact_id);

  // Push the relevant fact beyond the former eight-message window and across
  // channels. It remains positive evidence through the durable archive.
  must(await admin.from("chat_messages").insert([
    { user_id: userId, channel: "web", chat_id: "old-web", role: "user", content: "Ya me llegó el corte de Diners NT: son 50.60 y vence el 3 de agosto.", message_type: "chat" },
    { user_id: userId, channel: "web", chat_id: "old-web", role: "assistant", content: "Entendido. Guardé el corte de Diners NT por 50.60 USD y vencimiento el 3 de agosto.", message_type: "chat" },
    ...Array.from({ length: 24 }, (_, index) => ({
      user_id: userId,
      channel: index % 2 === 0 ? "web" : "telegram",
      chat_id: `filler-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Contexto neutral de prueba ${index + 1}, sin instrucciones financieras.`,
      message_type: "chat",
    })),
  ]), "conversation archive");
  const memoryReply = await turn("¿Cuánto tengo que pagar de la Diners NT y cuándo vence?", randomUUID(), "telegram");
  const beforeFlow = await balances(account.id, cards.map((card) => card.id));
  check(
    "ME2 · contexto cross-channel más allá de ocho turnos responde el corte guardado sin escribir",
    /50[.,]60/.test(memoryReply.reply) && /3|agosto/i.test(memoryReply.reply) &&
      beforeFlow.transactions.length === 1 &&
      beforeFlow.transactions.filter((row) => row.type === "income").length === 1 &&
      neutral(memoryReply.reply) &&
      memoryReply.result.assistantMetadata?.agent === true,
    JSON.stringify(memoryReply),
  );

  const first = await turn(
    "Hola. Ya pagué mi Diners en full, 22.14 de la Produbanco MV y 201.25 de la Titanium MV.",
  );
  const afterFirst = await balances(account.id, cards.map((card) => card.id));
  const me3Ok = check(
    "ME3 · una instrucción incompleta pregunta la fuente exacta y no paga a medias",
    afterFirst.transactions.length === 1 &&
      /cuenta|desde d[oó]nde|origen/i.test(first.reply) &&
      neutral(first.reply),
    JSON.stringify(first),
  );
  if (focusThrough === "ME3") throw new FocusComplete("ME3 diagnostic complete");

  const ambiguous = await turn(
    "Todo desde mi Produbanco con el sueldo que me ingresó hoy. Y para pagar me transfirieron 83.86 de un préstamo que no había registrado.",
  );
  const afterAmbiguous = await balances(account.id, cards.map((card) => card.id));
  const me4Ok = checkDependent(
    "ME4 · la ambigüedad bloquea sólo la entrada incierta; los tres pagos probados sí aterrizan",
    me3Ok,
    "ME3",
    afterAmbiguous.transactions.length === 4 &&
      afterAmbiguous.transactions.filter((row) => row.type === "income").length === 1 &&
      afterAmbiguous.transactions.filter((row) => row.type === "debt_payment").length === 3 &&
      afterAmbiguous.cards.every((card) => money(card.current_balance_original) === 0) &&
      replyAcknowledgesPendingClarifications(
        ambiguous.reply,
        ambiguous.result.assistantMetadata?.agentPendingClarifications ?? [],
      ) &&
      neutral(ambiguous.reply),
    turnDetail(ambiguous),
  );

  const whatMissing = await turn("¿Qué dato te falta?", randomUUID(), "web");
  const afterQuestion = await balances(account.id, cards.map((card) => card.id));
  // A failed previous turn has no durable id: reading with "undefined" threw
  // and ABORTED every remaining check (v31). Report the dependency instead.
  const ambiguousOperationId =
    ambiguous.result.assistantMetadata?.durableOperation?.id ?? null;
  const originalAfterStatusAnswer = ambiguousOperationId
    ? must(
        await admin
          .from("agent_operations")
          .select("id,status,missing_fields,pending_question")
          .eq("id", ambiguousOperationId)
          .single(),
        "original operation after status answer",
      )
    : { id: null, status: null, missing_fields: null, pending_question: null };
  const statusAnswerOperationId =
    whatMissing.result.assistantMetadata?.durableOperation?.id;
  checkDependent(
    "ME5 · preguntar qué falta recibe la respuesta concreta y no consume la operación",
    me4Ok,
    "ME4",
    afterQuestion.transactions.length === 4 &&
      whatMissing.result.assistantMetadata?.agentOutcome?.wrote === false &&
      whatMissing.result.assistantMetadata?.durableOperation?.status === "completed" &&
      statusAnswerOperationId !==
        ambiguous.result.assistantMetadata?.durableOperation?.id &&
      whatMissing.result.assistantMetadata?.durableOperation?.plan?.observed_operation_ids?.includes(
        ambiguous.result.assistantMetadata?.durableOperation?.id,
      ) === true &&
      (whatMissing.result.assistantMetadata?.agentPendingClarifications ?? []).length === 0 &&
      originalAfterStatusAnswer.status === "awaiting_input" &&
      Array.isArray(originalAfterStatusAnswer.missing_fields) &&
      originalAfterStatusAnswer.missing_fields.length > 0 &&
      typeof originalAfterStatusAnswer.pending_question === "string" &&
      originalAfterStatusAnswer.pending_question.trim().length > 0 &&
      neutral(whatMissing.reply),
    JSON.stringify({
      turn: turnDetail(whatMissing),
      assistantMetadata: whatMissing.result.assistantMetadata ?? null,
      originalAfterStatusAnswer,
    }),
  );
  if (focusThrough === "ME5") throw new FocusComplete("ME5 diagnostic complete");

  const completed = await turn(
    "Era una devolución: yo había prestado ese dinero y hoy me devolvieron 83.86. Ese préstamo original nunca lo registré.",
  );
  const afterComplete = await balances(account.id, cards.map((card) => card.id));
  const me6Ok = checkDependent(
    "ME6 · la aclaración completa la pata pendiente dentro de la misma operación durable y no reconoce capital como ingreso",
    me4Ok,
    "ME4",
    afterComplete.transactions.length === 5 &&
      afterComplete.transactions.filter((row) => row.type === "income").length === 1 &&
      afterComplete.transactions.filter((row) => row.type === "debt_payment").length === 3 &&
      afterComplete.transactions.filter((row) => row.type === "adjustment").length === 1 &&
      afterComplete.account === 1385.76 &&
      afterComplete.cards.every((card) => money(card.current_balance_original) === 0) &&
      neutral(completed.reply),
    JSON.stringify({ completed, afterComplete }),
  );

  const explain = await turn("¿Qué acabas de registrar y de dónde salió cada monto?");
  const afterExplain = await balances(account.id, cards.map((card) => card.id));
  const me7Ok = checkDependent(
    "ME7 · una pregunta de seguimiento explica la operación sin repetirla",
    me6Ok,
    "ME6",
    afterExplain.transactions.length === 5 &&
      /83[.,]86/.test(explain.reply) && /Diners|Titanium|Produbanco/i.test(explain.reply) &&
      neutral(explain.reply),
    turnDetail(explain),
  );

  const replay = await turn(
    "¿Qué acabas de registrar y de dónde salió cada monto?",
    explain.requestId,
  );
  const afterReplay = await balances(account.id, cards.map((card) => card.id));
  checkDependent(
    "ME8 · redelivery exacta devuelve la misma respuesta sin replan ni write",
    me7Ok,
    "ME7",
    replay.reply === explain.reply && afterReplay.transactions.length === 5,
    JSON.stringify({ first: explain.reply, replay: replay.reply }),
  );

  // Whole-operation undo is deliberately destructive: the first explicit
  // instruction must persist the exact proposal and a distinct delivery must
  // claim it. The old assertion expected the first delivery to bypass the
  // server-owned challenge, contradicting J's authority contract.
  const undoProposal = await turn(
    "Me equivoqué con todo lo anterior. Deshaz completa la operación de los tres pagos y la devolución.",
  );
  const afterUndoProposal = await balances(account.id, cards.map((card) => card.id));
  const undo = await turn("Sí, hazlo.");
  const afterUndo = await balances(account.id, cards.map((card) => card.id));
  // v28: si el undo rehúsa, el porqué debe sobrevivir al cleanup. Se capturan
  // los steps durables de la operación de corrección (con su
  // undoRefusal/undoDetail persistido) y del target que el plan nombró —
  // identificadores y códigos internos, jamás texto de usuario.
  const undoDurableId =
    undo?.result?.assistantMetadata?.durableOperation?.id ?? null;
  const undoPlanActions =
    undo?.result?.assistantMetadata?.durableOperation?.plan?.actions ?? [];
  const undoTargetId =
    undoPlanActions.find(
      (action) => action.capability === "undo_agent_operation",
    )?.arguments?.targetOperationId ?? null;
  const undoDiagnostics = { currentSteps: null, targetSteps: null };
  for (const [key, opId] of [
    ["currentSteps", undoDurableId],
    ["targetSteps", undoTargetId],
  ]) {
    if (typeof opId !== "string" || !opId) continue;
    const stepsRead = await admin
      .from("agent_operation_steps")
      .select(
        "step_key,capability,status,plan_version,effects,affected_refs,result,error",
      )
      .eq("operation_id", opId)
      .order("plan_version", { ascending: true })
      .order("step_order", { ascending: true });
    undoDiagnostics[key] = stepsRead.error
      ? `unreadable: ${stepsRead.error.message}`
      : stepsRead.data;
  }
  const me9Ok = checkDependent(
    "ME9 · una corrección a nivel operación revierte las cuatro filas o ninguna",
    me6Ok,
    "ME6",
    afterUndoProposal.transactions.length === 5 &&
      turnHasDurablePendingScope(undoProposal, "undo_agent_operation") &&
      afterUndo.account === 1575.89 &&
      afterUndo.cards.every((card) => money(card.current_balance_original) > 0) &&
      afterUndo.transactions.length === 9 &&
      afterUndo.transactions.filter((row) => row.type === "income").length === 1 &&
      neutral(undo.reply),
    JSON.stringify({ undoProposal, afterUndoProposal, undo, afterUndo, undoDiagnostics }),
  );

  const noOp = await turn("Gracias, eso era todo por ahora.");
  const afterNoOp = await balances(account.id, cards.map((card) => card.id));
  checkDependent(
    "ME10 · conversación normal no se convierte en una acción financiera",
    me9Ok,
    "ME9",
    afterNoOp.transactions.length === 9 && neutral(noOp.reply),
    turnDetail(noOp),
  );

  // The model must understand a correction as replacement of a durable job,
  // not as two new expenses. This goes through the public handler; the DB E2E
  // separately proves the generic coordinator's all-or-nothing transaction.
  const beforeReplacement = await balances(
    account.id,
    cards.map((card) => card.id),
  );
  const originalPairProposal = await turn(
    "Registra como una sola operación dos gastos de hoy desde Produbanco: 10 dólares en compra A y 20 dólares en compra B.",
  );
  const afterOriginalPairProposal = await balances(
    account.id,
    cards.map((card) => card.id),
  );
  // This is an explicit, ordinary capture: both amounts, descriptions, date
  // reference and source are user-authored in one delivery. A second "sí"
  // would turn normal conversation into a command bot. Destructive actions and
  // unproved amount↔entity associations still use the server-owned challenge.
  const originalPair = originalPairProposal;
  const afterOriginalPair = afterOriginalPairProposal;
  const originalPairTransactions = afterOriginalPair.transactions.filter(
    (row) => !beforeReplacement.transactions.some((prior) => prior.id === row.id),
  );
  const originalPairOperation = must(
    await admin
      .from("agent_operations")
      .select("id,status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    "original pair operation",
  );
  check(
    "ME10a · una instrucción con dos movimientos queda bajo una sola identidad durable",
    afterOriginalPair.account === beforeReplacement.account - 30 &&
      originalPairTransactions.length === 2 &&
      originalPairTransactions.every((row) => row.type === "expense") &&
      originalPairOperation.status === "completed" &&
      originalPair.result.assistantMetadata?.agentOutcome?.wrote === true &&
      (originalPair.result.assistantMetadata?.agentPendingClarifications ?? []).length === 0 &&
      neutral(originalPair.reply),
    JSON.stringify({
      originalPairProposal,
      afterOriginalPairProposal,
      originalPair,
      originalPairTransactions,
      originalPairOperation,
    }),
  );
  // The correction target must not depend on being one of the newest twenty
  // operations. These filler jobs use the same durable lifecycle but no model
  // or money; the next natural turn has to search the operation archive using
  // the original instruction that remains in conversational context.
  for (let index = 0; index < 21; index += 1) {
    await completeArchiveFiller(index);
  }
  const latestOperationsBeforeCorrection = await readRecentCompletedAgentOperations(
    userId,
    20,
  );
  check(
    "ME10a2 · la operación a corregir está realmente fuera de las veinte más recientes",
    latestOperationsBeforeCorrection.ok &&
      !latestOperationsBeforeCorrection.operations.some(
        (operation) => operation.id === originalPairOperation.id,
      ),
    JSON.stringify({ originalPairOperation, latestOperationsBeforeCorrection }),
  );
  const replacedPair = await turn(
    "Me equivoqué en esa operación: la compra A fueron 12 dólares y la compra B 19. Corrige la operación completa; reemplaza los datos anteriores, no agregues gastos encima.",
  );
  const afterReplacedPair = await balances(
    account.id,
    cards.map((card) => card.id),
  );
  const originalPairIds = originalPairTransactions.map((row) => row.id).sort();
  const [originalPairReversals, replacementMarker] = await Promise.all([
    admin
      .from("transactions")
      .select("id,related_transaction_id,original_amount")
      .eq("user_id", userId)
      .eq("type", "reversal")
      .in("related_transaction_id", originalPairIds),
    admin
      .from("agent_operation_reversals")
      .select("target_operation_id,transaction_ids")
      .eq("user_id", userId)
      .eq("target_operation_id", originalPairOperation.id)
      .maybeSingle(),
  ]);
  const correctionTransactions = afterReplacedPair.transactions.filter(
    (row) => !afterOriginalPair.transactions.some((prior) => prior.id === row.id),
  );
  const correctionReversals = correctionTransactions.filter(
    (row) => row.type === "reversal",
  );
  const correctionExpenses = correctionTransactions.filter(
    (row) => row.type === "expense",
  );
  const reversedTargets = (originalPairReversals.data ?? [])
    .map((row) => row.related_transaction_id)
    .sort();
  const markedTargets = (replacementMarker.data?.transaction_ids ?? []).sort();
  const replacementAmounts = correctionExpenses
    .map((row) => money(row.original_amount))
    .sort((a, b) => a - b);
  check(
    "ME10aa · el modelo corrige la operación completa: deshace ambas filas y escribe sólo sus reemplazos",
    afterReplacedPair.account === afterOriginalPair.account - 1 &&
      originalPairReversals.error == null &&
      originalPairReversals.data?.length === 2 &&
      JSON.stringify(reversedTargets) === JSON.stringify(originalPairIds) &&
      replacementMarker.error == null &&
      replacementMarker.data?.target_operation_id === originalPairOperation.id &&
      JSON.stringify(markedTargets) === JSON.stringify(originalPairIds) &&
      correctionTransactions.length === 4 &&
      correctionReversals.length === 2 &&
      correctionExpenses.length === 2 &&
      JSON.stringify(replacementAmounts) === JSON.stringify([12, 19]) &&
      afterReplacedPair.transactions.length ===
        afterOriginalPair.transactions.length + 4 &&
      neutral(replacedPair.reply),
    JSON.stringify({
      replacedPair,
      beforeReplacement,
      afterReplacedPair,
      originalPairIds,
      originalPairReversals: originalPairReversals.data,
      correctionTransactions,
      replacementMarker: replacementMarker.data,
    }),
  );

  // A repayment of a loan already registered in Kipu is not income and is not
  // the same as the founder's unrecorded-capital case. Exercise the public chat
  // planner, read capability, atomic cash+receivable writer and operation undo.
  const receivable = must(await admin.from("receivables").insert({
    user_id: userId,
    counterparty: "Juan",
    direction: "owed_to_user",
    original_amount: 60,
    outstanding_amount: 60,
    currency: "USD",
    status: "open",
    reason: "Préstamo registrado M0",
  }).select("id").single(), "registered receivable");
  const beforeRegisteredRepayment = await balances(
    account.id,
    cards.map((card) => card.id),
  );
  const registeredRepaymentProposal = await turn(
    "Juan me devolvió hoy 40 dólares del préstamo de 60 que ya tengo registrado. Entraron a Produbanco.",
  );
  const afterRegisteredRepaymentProposal = await balances(
    account.id,
    cards.map((card) => card.id),
  );
  const receivableAfterRepaymentProposal = must(
    await admin.from("receivables")
      .select("outstanding_amount,status")
      .eq("id", receivable.id)
      .single(),
    "receivable after repayment proposal",
  );
  const registeredRepayment = await turn("Sí, hazlo.");
  const afterRegisteredRepayment = await balances(
    account.id,
    cards.map((card) => card.id),
  );
  const afterRegisteredReceivable = must(
    await admin.from("receivables")
      .select("outstanding_amount,status")
      .eq("id", receivable.id)
      .single(),
    "receivable after repayment",
  );
  const registeredMarkers = must(
    await admin.from("receivable_repayment_applications")
      .select("transaction_id,allocations,reversed_at")
      .eq("user_id", userId),
    "registered repayment markers",
  );
  const registeredMarker = registeredMarkers.find((row) =>
    Array.isArray(row.allocations) &&
    row.allocations.some((allocation) => allocation?.receivable_id === receivable.id),
  );
  const registeredRepaymentLedgerRows = afterRegisteredRepayment.transactions.filter(
    (row) =>
      row.type === "income" &&
      String(row.external_ref ?? "").startsWith("receivable_repayment:"),
  );
  check(
    "ME10b · devolución registrada acredita caja y reduce el receivable sin reconocer ingreso",
    afterRegisteredRepaymentProposal.account === beforeRegisteredRepayment.account &&
      money(receivableAfterRepaymentProposal.outstanding_amount) === 60 &&
      receivableAfterRepaymentProposal.status === "open" &&
      turnHasDurablePendingScope(
        registeredRepaymentProposal,
        "record_person_payment",
      ) &&
      afterRegisteredRepayment.account === beforeRegisteredRepayment.account + 40 &&
      money(afterRegisteredReceivable.outstanding_amount) === 20 &&
      afterRegisteredReceivable.status === "partial" &&
      Boolean(registeredMarker?.transaction_id) &&
      registeredMarker?.reversed_at == null &&
      afterRegisteredRepayment.transactions.filter((row) => row.type === "income").length ===
        beforeRegisteredRepayment.transactions.filter((row) => row.type === "income").length + 1 &&
      registeredRepaymentLedgerRows.length === 1 &&
      registeredRepaymentLedgerRows[0]?.id === registeredMarker?.transaction_id &&
      neutral(registeredRepayment.reply),
    JSON.stringify({
      registeredRepaymentProposal,
      afterRegisteredRepaymentProposal,
      receivableAfterRepaymentProposal,
      registeredRepayment,
      afterRegisteredReceivable,
      registeredMarker,
      registeredRepaymentLedgerRows,
    }),
  );
  const undoRegisteredRepaymentProposal = await turn(
    "Deshaz completa la operación en la que Juan me devolvió 40 del préstamo registrado.",
  );
  const afterUndoRegisteredRepaymentProposal = await balances(
    account.id,
    cards.map((card) => card.id),
  );
  const receivableAfterUndoProposal = must(
    await admin.from("receivables")
      .select("outstanding_amount,status")
      .eq("id", receivable.id)
      .single(),
    "receivable after undo proposal",
  );
  const undoRegisteredRepayment = await turn("Sí, hazlo.");
  const afterRegisteredUndo = await balances(
    account.id,
    cards.map((card) => card.id),
  );
  const restoredReceivable = must(
    await admin.from("receivables")
      .select("outstanding_amount,status")
      .eq("id", receivable.id)
      .single(),
    "receivable after operation undo",
  );
  const reversedMarkers = must(
    await admin.from("receivable_repayment_applications")
      .select("transaction_id,allocations,reversed_at,reversal_transaction_id")
      .eq("user_id", userId),
    "reversed repayment markers",
  );
  const reversedMarker = reversedMarkers.find((row) =>
    Array.isArray(row.allocations) &&
    row.allocations.some((allocation) => allocation?.receivable_id === receivable.id),
  );
  check(
    "ME10c · undo de la devolución registrada restaura caja y receivable completos",
    afterUndoRegisteredRepaymentProposal.account === afterRegisteredRepayment.account &&
      money(receivableAfterUndoProposal.outstanding_amount) === 20 &&
      receivableAfterUndoProposal.status === "partial" &&
      turnHasDurablePendingScope(
        undoRegisteredRepaymentProposal,
        "undo_agent_operation",
      ) &&
      afterRegisteredUndo.account === beforeRegisteredRepayment.account &&
      money(restoredReceivable.outstanding_amount) === 60 &&
      restoredReceivable.status === "open" &&
      Boolean(reversedMarker?.reversed_at) &&
      Boolean(reversedMarker?.reversal_transaction_id) &&
      neutral(undoRegisteredRepayment.reply),
    JSON.stringify({
      undoRegisteredRepaymentProposal,
      afterUndoRegisteredRepaymentProposal,
      receivableAfterUndoProposal,
      undoRegisteredRepayment,
      restoredReceivable,
      reversedMarker,
    }),
  );

  // Generated paraphrases make the semantic suite refutational: the exact
  // wording below did not exist when this file was authored.
  const generated = await openai.chat.completions.create({
    model: process.env.OPENAI_COACH_MODEL ?? "gpt-5.4",
    temperature: 0.8,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Genera paráfrasis naturales en español latinoamericano neutral. Conserva exactamente la semántica y los números, cambia de verdad la superficie. Devuelve solo JSON con seis strings: capital_return, borrowed, registered_repayment, loan_out, ambiguous, no_action. No uses ninguna frase textual del ejemplo.",
      },
      {
        role: "user",
        content: JSON.stringify({
          capital_return:
            "Entraron 83.86 a Produbanco porque una persona me devolvió capital de un préstamo que yo le había hecho y nunca registré.",
          borrowed:
            "Entraron 83.86 a Produbanco porque Alpaca me prestó ese dinero hoy; ahora yo se lo debo.",
          registered_repayment:
            `Juan devolvió 40 USD del préstamo registrado id=${receivable.id}; entraron a la cuenta id=${account.id}.`,
          loan_out:
            `Le presté 25 USD a María desde la cuenta id=${account.id}; ahora ella me los debe.`,
          ambiguous:
            "Me transfirieron 83.86 a Produbanco por un préstamo que no estaba anotado.",
          no_action:
            "Gracias por la explicación; no quiero registrar ni cambiar nada más.",
        }),
      },
    ],
  });
  const paraphrases = JSON.parse(generated.choices[0]?.message?.content ?? "{}");
  const capabilities = KIPU_TOOL_SCHEMAS.flatMap((tool) =>
    tool.type === "function" && ["record_person_payment", "list_open_receivables"].includes(tool.function.name)
      ? [{
          name: tool.function.name,
          description: tool.function.description ?? "",
          readOnly: isReadOnlyAgentTool(tool.function.name),
          effectMode: agentToolEffectMode(tool.function.name),
          parameters: tool.function.parameters,
        }]
      : [],
  );
  const semanticPlan = (message) => planKipuRequest({
    apiKey: OPENAI_KEY,
    model: process.env.OPENAI_COACH_MODEL ?? "gpt-5.4",
    message,
    channel: "telegram",
    currentLocalDate: userToday,
    recentMessages: [],
    conversationArchive: [],
    conversationArchiveComplete: true,
    conversationArchiveAsOf: new Date().toISOString(),
    contextData:
      `Cuenta única: Produbanco id=${account.id}, USD. Deuda Alpaca id=no-debt-fixture. ` +
      `Receivable abierto de Juan id=${receivable.id}, USD 60 pendientes. ` +
      "El mensaje actual es la única autoridad sobre quién debía a quién.",
    calendarData: "No hay ocurrencias abiertas.",
    calendarContextComplete: true,
    openOperations: [],
    operationReadComplete: true,
    operationReadAsOf: new Date().toISOString(),
    capabilities,
  });
  const [capitalPlan, borrowedPlan, registeredRepaymentPlan, loanOutPlan, ambiguousPlan, noActionPlan] = await Promise.all([
    semanticPlan(String(paraphrases.capital_return ?? "")),
    semanticPlan(String(paraphrases.borrowed ?? "")),
    semanticPlan(String(paraphrases.registered_repayment ?? "")),
    semanticPlan(String(paraphrases.loan_out ?? "")),
    semanticPlan(String(paraphrases.ambiguous ?? "")),
    semanticPlan(String(paraphrases.no_action ?? "")),
  ]);
  const firstAction = (result) => result.ok ? result.request.plan.actions[0] : null;
  const actionFor = (result, capability) => result.ok
    ? result.request.plan.actions.find((action) => action.capability === capability)
    : null;
  check(
    "ME11 · paráfrasis nueva: devolución no registrada conserva capital_return_unrecorded",
    capitalPlan.ok &&
      firstAction(capitalPlan)?.arguments?.inflowKind === "capital_return_unrecorded" &&
      firstAction(capitalPlan)?.effects?.some((row) =>
        row.surface === "income_recognition" && row.direction === "unchanged") &&
      firstAction(capitalPlan)?.effects?.some((row) =>
        row.surface === "receivable" && row.direction === "unchanged"),
    JSON.stringify({ text: paraphrases.capital_return, capitalPlan }),
  );
  check(
    "ME12 · paráfrasis nueva: dinero prestado crea caja y obligación, no ingreso",
    borrowedPlan.ok &&
      firstAction(borrowedPlan)?.arguments?.inflowKind === "borrowed" &&
      firstAction(borrowedPlan)?.effects?.some((row) =>
        row.surface === "debt_liability" && row.direction === "increase"),
    JSON.stringify({ text: paraphrases.borrowed, borrowedPlan }),
  );
  check(
    "ME12b · paráfrasis nueva: devolución registrada declara caja y receivable con identidad exacta",
    registeredRepaymentPlan.ok &&
      actionFor(registeredRepaymentPlan, "record_person_payment")?.arguments?.inflowKind === "loan_repayment" &&
      Array.isArray(actionFor(registeredRepaymentPlan, "record_person_payment")?.arguments?.receivableIds) &&
      actionFor(registeredRepaymentPlan, "record_person_payment").arguments.receivableIds.includes(receivable.id) &&
      actionFor(registeredRepaymentPlan, "record_person_payment")?.effects?.some((row) =>
        row.surface === "receivable" && row.direction === "decrease"),
    JSON.stringify({ text: paraphrases.registered_repayment, registeredRepaymentPlan }),
  );
  check(
    "ME12c · paráfrasis nueva: préstamo saliente declara caja abajo y receivable arriba",
    loanOutPlan.ok &&
      actionFor(loanOutPlan, "record_person_payment")?.arguments?.direction === "out" &&
      actionFor(loanOutPlan, "record_person_payment")?.arguments?.isLoan === true &&
      actionFor(loanOutPlan, "record_person_payment")?.effects?.some((row) =>
        row.surface === "receivable" && row.direction === "increase"),
    JSON.stringify({ text: paraphrases.loan_out, loanOutPlan }),
  );
  check(
    "ME13 · paráfrasis nueva ambigua pregunta quién debía a quién y no autoriza ejecución",
    ambiguousPlan.ok &&
      ambiguousPlan.request.missing_fields.length > 0 &&
      !!ambiguousPlan.request.pending_question,
    JSON.stringify({ text: paraphrases.ambiguous, ambiguousPlan }),
  );
  check(
    "ME14 · paráfrasis nueva de no-acción no inventa una capacidad financiera",
    noActionPlan.ok &&
      noActionPlan.request.plan.actions.every((action) =>
        capabilities.find((capability) => capability.name === action.capability)?.readOnly === true,
      ) &&
      ["answer", "no_op"].includes(noActionPlan.request.plan.response_intent),
    JSON.stringify({ text: paraphrases.no_action, noActionPlan }),
  );

  const operationRows = must(await admin.from("agent_operations")
    .select("status,pending_question,result").eq("user_id", userId), "operations");
  check(
    "ME15 · ninguna operación queda eternamente applying y las preguntas conservan su texto concreto",
    operationRows.every((row) => row.status !== "applying") &&
      operationRows.filter((row) => row.status === "awaiting_input")
        .every((row) => typeof row.pending_question === "string" && row.pending_question.trim().length > 0),
    JSON.stringify(operationRows),
  );
} catch (error) {
  if (!(error instanceof FocusComplete)) {
    failures.push("ABORT");
    console.error(error instanceof Error ? error.stack : String(error));
  }
} finally {
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) failures.push(`cleanup auth: ${deleted.error.message}`);
    for (const [table, column] of touched) {
      const { count, error } = await admin.from(table)
        .select("*", { count: "exact", head: true }).eq(column, userId);
      if (error || count == null) {
        failures.push(`LIMPIEZA ILEGIBLE · ${table}: ${error?.message ?? "count null"}`);
      } else if (count !== 0) {
        failures.push(`RESIDUO · ${table}: ${count}`);
      }
    }
  }
}

const EXPECTED = focusThrough === "ME3" ? 3 : focusThrough === "ME5" ? 5 : 22;
console.log(`Bloque M0 modelo conversacional: ${passed}/${executed}`);
if (blocked.length > 0) {
  console.error(`BLOCKED CHECKS: ${blocked.join(" | ")}`);
}
if (
  failures.length > 0 ||
  blocked.length > 0 ||
  passed !== executed ||
  executed !== EXPECTED
) {
  if (executed !== EXPECTED) failures.push(`COBERTURA INCOMPLETA ${executed}/${EXPECTED}`);
  console.error(`FAILURES: ${failures.join(" | ") || "unknown"}`);
  process.exitCode = 1;
}
