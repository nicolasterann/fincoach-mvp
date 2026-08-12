// Bloque M0 — disposable-persona E2E against real PostgreSQL.
// Run only AFTER migrations 100–107 are applied and before deploy:
//   node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs

import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
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
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRK) throw new Error("faltan credenciales Supabase");
const admin = createClient(URL_, SRK, { auth: { persistSession: false } });
const anonymous = createClient(URL_, ANON, { auth: { persistSession: false } });

const {
  applyAgentAtomicGroup,
  beginAgentOperationApplication,
  claimAgentOperation,
  expireAgentOperations,
  readOpenAgentOperations,
  readRecentCompletedAgentOperations,
  searchCompletedAgentOperations,
  recordAgentIntakeFailure,
  recordAgentOperationStepOutcome,
  resolveAgentIntakeFailure,
  resumeAgentOperationPlan,
  saveAgentOperationPlan,
  transitionAgentOperation,
  verifyAgentOperation,
  preflightAgentOperationStep,
} = await import("@/lib/ai/agent/agent-operation-store");
const { executeListRecentAgentOperations, prepareAtomicAgentAction } = await import(
  "@/lib/ai/agent/kipu-agent-tools"
);
const { agentAffectedRefsFromResult } = await import(
  "@/lib/ai/agent/kipu-agent"
);
const {
  applyDebtProceeds,
  reverseAgentOperation,
} = await import("@/lib/ai/apply-chat-transaction-intent");
const { readOpenOccurrences } = await import(
  "@/lib/financial/recurring-occurrences-store"
);

let executed = 0;
let passed = 0;
const failures = [];
// Bloque M0 (auditoría externa): una reversa en este producto es una FILA
// append-only `type='reversal'` cuyo `related_transaction_id` apunta al
// original — no una columna sobre el original. El harness leía
// `transactions.reversed_by_transaction_id`, que no existe en ningún esquema,
// así que estos asserts no podían pasar nunca.
async function reversalCountFor(transactionId) {
  const { count, error } = await admin
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("type", "reversal")
    .eq("related_transaction_id", transactionId);
  if (error) throw new Error(`reversal count: ${error.message}`);
  return Number(count ?? 0);
}

function check(name, ok, detail = "") {
  executed += 1;
  if (ok) {
    passed += 1;
    console.log(`  ok   · ${name}`);
  } else {
    failures.push(name);
    console.log(`  FALL · ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}
function must(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
function mustOk(result, label) {
  if (!result?.ok) throw new Error(`${label}: ${JSON.stringify(result)}`);
  return result;
}
const money = (value) => Math.round(Number(value) * 100) / 100;
async function withProcessClockOffset(offsetMs, run) {
  const NativeDate = globalThis.Date;
  class OffsetDate extends NativeDate {
    constructor(...args) {
      if (args.length === 0) super(NativeDate.now() + offsetMs);
      else super(...args);
    }
    static now() {
      return NativeDate.now() + offsetMs;
    }
  }
  globalThis.Date = OffsetDate;
  try {
    return await run();
  } finally {
    globalThis.Date = NativeDate;
  }
}
const coverage = {
  ok: true,
  complete: true,
  asOf: new Date().toISOString(),
  consulted: ["accounts", "debts", "calendar", "conversation", "operations"],
  failed: [],
  truncated: [],
};
const effect = (surface, direction, classification, entityRef) => ({
  owner: "user",
  surface,
  direction,
  amount_source: "user_stated",
  classification,
  entity_ref: entityRef,
});
function plan(actions, goal = "Execute the complete user instruction") {
  return {
    goal,
    interpretation: goal,
    assertions: [],
    ambiguities: [],
    required_reads: [],
    actions,
    postconditions: [],
    response_intent: actions.length ? "act" : "answer",
    requires_replan_after_reads: false,
  };
}
async function claimAndSave({ userId, key, text, actions, missing = [], question = null }) {
  const claimed = mustOk(
    await claimAgentOperation({
      userId,
      deliveryKey: key,
      channel: "telegram",
      chatId: "m0-probe",
      rootMessageId: "",
      requestText: text,
    }),
    `claim ${key}`,
  );
  const saved = mustOk(
    await saveAgentOperationPlan({
      userId,
      operationId: claimed.id,
      expectedVersion: claimed.stateVersion,
      plan: plan(actions),
      coverage,
      missingFields: missing,
      pendingQuestion: question,
      leaseToken: claimed.leaseToken,
    }),
    `save ${key}`,
  );
  return { claimed, saved, key };
}
async function completeOperation({ userId, operationId, lease, result = {} }) {
  const verifying = mustOk(
    await transitionAgentOperation({
      userId,
      operationId,
      expectedVersion: lease.stateVersion,
      status: "verifying",
      leaseToken: lease.leaseToken,
      result,
    }),
    "transition verifying",
  );
  const verified = mustOk(
    await verifyAgentOperation({
      userId,
      operationId,
      leaseToken: lease.leaseToken,
      postWriteContextVerified: true,
    }),
    "verify operation",
  );
  const completed = mustOk(
    await transitionAgentOperation({
      userId,
      operationId,
      expectedVersion: verifying.stateVersion,
      status: "completed",
      leaseToken: lease.leaseToken,
      result: { ...result, verification: verified },
    }),
    "complete operation",
  );
  return { verifying, verified, completed };
}

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
  ["debt_statement_cycles", "user_id"],
  ["recurring_occurrences", "user_id"],
  ["chat_messages", "user_id"],
  ["scheduled_payments", "user_id"],
  ["savings_plans", "user_id"],
  ["fixed_expenses", "user_id"],
  ["income_sources", "user_id"],
  ["receivables", "user_id"],
  ["transactions", "user_id"],
  ["debt_accounts", "user_id"],
  ["accounts", "user_id"],
  ["profiles", "id"],
];

try {
  const created = must(
    await admin.auth.admin.createUser({
      email: `kipu-m0-${Date.now()}@example.invalid`,
      email_confirm: true,
      user_metadata: { kipu_smoke: true },
    }),
    "create disposable user",
  );
  userId = created.user.id;
  must(
    await admin.from("profiles").upsert({
      id: userId,
      base_currency: "USD",
      onboarding_completed: true,
    }),
    "profile",
  );
  const account = must(
    await admin.from("accounts").insert({
      user_id: userId,
      name: "Produbanco M0",
      type: "bank",
      currency: "USD",
      current_balance_original: 1000,
      current_balance_base: 1000,
    }).select("id").single(),
    "account",
  );
  const cards = must(
    await admin.from("debt_accounts").insert([
      { user_id: userId, name: "Diners NT M0", type: "credit_card", currency: "USD", current_balance_original: 50.6, current_balance_base: 50.6, full_payment_due: 50.6, statement_total_due: 50.6, statement_covered: false, statement_date: "2026-07-16", due_day: 3, cutoff_day: 15 },
      { user_id: userId, name: "Produbanco MV M0", type: "credit_card", currency: "USD", current_balance_original: 22.14, current_balance_base: 22.14, full_payment_due: 22.14, statement_total_due: 22.14, statement_covered: false },
      { user_id: userId, name: "Titanium MV M0", type: "credit_card", currency: "USD", current_balance_original: 201.25, current_balance_base: 201.25, full_payment_due: 201.25, statement_total_due: 201.25, statement_covered: false },
    ]).select("id,name,current_balance_original,current_balance_base,full_payment_due,statement_total_due,statement_covered,currency,type"),
    "cards",
  );
  const loan = must(
    await admin.from("debt_accounts").insert({
      user_id: userId,
      name: "Alpaca M0",
      type: "loan",
      currency: "USD",
      current_balance_original: 10,
      current_balance_base: 10,
    }).select("id,name,currency,type,current_balance_original,current_balance_base").single(),
    "loan",
  );
  const receivable = must(
    await admin.from("receivables").insert({
      user_id: userId,
      counterparty: "Juan M0",
      direction: "owed_to_user",
      original_amount: 100,
      outstanding_amount: 100,
      currency: "USD",
      reason: "Préstamo M0",
      status: "open",
    }).select("id,outstanding_amount,status").single(),
    "receivable",
  );

  const intakeRoot = must(
    await admin
      .from("chat_messages")
      .insert({
        user_id: userId,
        role: "user",
        content: "Registra algo cuando vuelva el contexto",
        channel: "telegram",
        metadata: { source: "m0-e2e" },
      })
      .select("id")
      .single(),
    "intake root message",
  );
  const intakeKey = `telegram:m0:intake:${randomUUID()}`;
  const intakeRecorded = await recordAgentIntakeFailure({
    userId,
    deliveryKey: intakeKey,
    channel: "telegram",
    chatId: "m0-probe",
    rootMessageId: intakeRoot.id,
    requestText: "Registra algo cuando vuelva el contexto",
    stage: "financial_context",
    error: { code: "probe_read_failed" },
  });
  const intakeRecordedAgain = await recordAgentIntakeFailure({
    userId,
    deliveryKey: intakeKey,
    channel: "telegram",
    chatId: "m0-probe",
    rootMessageId: intakeRoot.id,
    requestText: "Registra algo cuando vuelva el contexto",
    stage: "context_catalog",
    error: { code: "probe_read_failed_again" },
  });
  const intakeOpen = must(
    await admin
      .from("agent_intake_failures")
      .select("status,attempts,stage")
      .eq("user_id", userId)
      .eq("delivery_key", intakeKey)
      .single(),
    "open intake failure",
  );
  check(
    "M100.0aa · un fallo pre-plan queda durable y un retry exacto incrementa el mismo intake",
    intakeRecorded &&
      intakeRecordedAgain &&
      intakeOpen.status === "open" &&
      intakeOpen.attempts === 2 &&
      intakeOpen.stage === "context_catalog",
    JSON.stringify(intakeOpen),
  );
  const divergentIntake = await admin.rpc("kipu_record_agent_intake_failure", {
    p: {
      user_id: userId,
      delivery_key: intakeKey,
      channel: "telegram",
      chat_id: "m0-probe",
      message_id: intakeRoot.id,
      request_text: "Otro significado",
      stage: "planner",
      error: { code: "forged" },
    },
  });
  check(
    "M100.0ab · la identidad del intake no puede reutilizarse para otro mensaje",
    Boolean(divergentIntake.error) &&
      String(divergentIntake.error?.message ?? "").includes(
        "KIPU_DEDUPE_MISMATCH",
      ),
    String(divergentIntake.error?.message ?? ""),
  );
  // Migración 110: la fila durable conserva fingerprint e identidad de mensaje,
  // pero el texto crudo del usuario no aterriza en agent_intake_failures.
  const intakeDurableRow = must(
    await admin
      .from("agent_intake_failures")
      .select("request_text,request_fingerprint,message_id")
      .eq("user_id", userId)
      .eq("delivery_key", intakeKey)
      .single(),
    "intake durable row",
  );
  check(
    "M110.1 · un fallo de intake persiste fingerprint e identidad sin el mensaje crudo",
    intakeDurableRow.request_text === null &&
      typeof intakeDurableRow.request_fingerprint === "string" &&
      intakeDurableRow.request_fingerprint.length === 32 &&
      intakeDurableRow.message_id === intakeRoot.id,
    JSON.stringify(intakeDurableRow),
  );
  const intakeThird = await recordAgentIntakeFailure({
    userId,
    deliveryKey: intakeKey,
    channel: "telegram",
    chatId: "m0-probe",
    rootMessageId: intakeRoot.id,
    requestText: "Registra algo cuando vuelva el contexto",
    stage: "planner",
    error: { code: "probe_read_failed_thrice" },
  });
  const intakeAfterThird = must(
    await admin
      .from("agent_intake_failures")
      .select("attempts,request_text,request_fingerprint")
      .eq("user_id", userId)
      .eq("delivery_key", intakeKey)
      .single(),
    "intake after third replay",
  );
  check(
    "M110.2 · el replay del mismo delivery conserva la identidad por fingerprint y nunca resucita el texto",
    intakeThird &&
      intakeAfterThird.attempts === 3 &&
      intakeAfterThird.request_text === null &&
      intakeAfterThird.request_fingerprint === intakeDurableRow.request_fingerprint,
    JSON.stringify(intakeAfterThird),
  );
  const stolenIntakeKey = `telegram:m0:intake-stolen:${randomUUID()}`;
  if (
    !(await recordAgentIntakeFailure({
      userId,
      deliveryKey: stolenIntakeKey,
      channel: "telegram",
      chatId: "m0-probe",
      rootMessageId: intakeRoot.id,
      requestText: "Mensaje original que falló antes del plan",
      stage: "financial_context",
      error: { code: "probe_read_failed" },
    }))
  ) {
    throw new Error("stolen intake fixture did not land");
  }
  const stolenClaim = mustOk(
    await claimAgentOperation({
      userId,
      deliveryKey: stolenIntakeKey,
      channel: "telegram",
      chatId: "m0-probe",
      rootMessageId: intakeRoot.id,
      requestText: "Otro mensaje que intenta apropiarse de la misma delivery",
    }),
    "claim forged intake meaning",
  );
  const stolenPlan = mustOk(
    await saveAgentOperationPlan({
      userId,
      operationId: stolenClaim.id,
      expectedVersion: stolenClaim.stateVersion,
      plan: plan([], "No debe apropiarse del intake"),
      coverage,
      missingFields: [],
      pendingQuestion: null,
      leaseToken: stolenClaim.leaseToken,
    }),
    "save forged intake plan",
  );
  const stolenResolved = await resolveAgentIntakeFailure({
    userId,
    deliveryKey: stolenIntakeKey,
    operationId: stolenPlan.id,
  });
  const stolenMarker = must(
    await admin
      .from("agent_intake_failures")
      .select("status,resolved_operation_id")
      .eq("user_id", userId)
      .eq("delivery_key", stolenIntakeKey)
      .single(),
    "stolen intake marker",
  );
  check(
    "M100.0ab2 · una operación con otro texto no puede apropiarse ni cerrar el intake fallido",
    !stolenResolved &&
      stolenMarker.status === "open" &&
      stolenMarker.resolved_operation_id == null,
    JSON.stringify({ stolenResolved, stolenMarker }),
  );
  const intakeClaim = mustOk(
    await claimAgentOperation({
      userId,
      deliveryKey: intakeKey,
      channel: "telegram",
      chatId: "m0-probe",
      rootMessageId: intakeRoot.id,
      requestText: "Registra algo cuando vuelva el contexto",
    }),
    "claim after intake recovery",
  );
  const intakePlan = mustOk(
    await saveAgentOperationPlan({
      userId,
      operationId: intakeClaim.id,
      expectedVersion: intakeClaim.stateVersion,
      plan: plan([], "Responder después de recuperar el contexto"),
      coverage,
      missingFields: [],
      pendingQuestion: null,
      leaseToken: intakeClaim.leaseToken,
    }),
    "persist plan after intake recovery",
  );
  const intakeResolved = await resolveAgentIntakeFailure({
    userId,
    deliveryKey: intakeKey,
    operationId: intakePlan.id,
  });
  const intakeClosed = must(
    await admin
      .from("agent_intake_failures")
      .select("status,resolved_operation_id,resolved_at")
      .eq("user_id", userId)
      .eq("delivery_key", intakeKey)
      .single(),
    "resolved intake failure",
  );
  check(
    "M100.0ac · sólo la operación que posee la delivery puede cerrar el intake antes de ejecutar",
    intakeResolved &&
      intakeClosed.status === "resolved" &&
      intakeClosed.resolved_operation_id === intakePlan.id &&
      Boolean(intakeClosed.resolved_at),
    JSON.stringify(intakeClosed),
  );

  // Founder multi-step instruction: one capital return plus three card
  // payments sharing one account. The whole group is preflighted before write.
  const planningLeaseKey = `telegram:m0:planning-lease:${randomUUID()}`;
  const planningLeaseClaim = mustOk(await claimAgentOperation({
    userId,
    deliveryKey: planningLeaseKey,
    channel: "telegram",
    chatId: "m0-probe",
    rootMessageId: "",
    requestText: "Prepara una operación y no dejes que otro worker la pise",
  }), "planning lease claim");
  check(
    "M100.0a · el primer planner recibe un lease durable antes de pensar",
    planningLeaseClaim.outcome === "claimed" &&
      typeof planningLeaseClaim.leaseToken === "string" &&
      planningLeaseClaim.leaseToken.length > 0,
    JSON.stringify(planningLeaseClaim),
  );
  const concurrentPlanningClaim = mustOk(await claimAgentOperation({
    userId,
    deliveryKey: planningLeaseKey,
    channel: "telegram",
    chatId: "m0-probe",
    rootMessageId: "",
    requestText: "Prepara una operación y no dejes que otro worker la pise",
  }), "concurrent planning claim");
  check(
    "M100.0b · una redelivery concurrente queda inflight y no adquiere autoridad paralela",
    concurrentPlanningClaim.outcome === "inflight" &&
      concurrentPlanningClaim.id === planningLeaseClaim.id,
    JSON.stringify(concurrentPlanningClaim),
  );
  const stalePlannerSave = await saveAgentOperationPlan({
    userId,
    operationId: planningLeaseClaim.id,
    expectedVersion: planningLeaseClaim.stateVersion,
    plan: plan([]),
    coverage,
    missingFields: [],
    pendingQuestion: null,
    leaseToken: randomUUID(),
  });
  check(
    "M100.0c · un planner sin el lease exacto no puede publicar su plan",
    !stalePlannerSave.ok,
    JSON.stringify(stalePlannerSave),
  );
  mustOk(await saveAgentOperationPlan({
    userId,
    operationId: planningLeaseClaim.id,
    expectedVersion: planningLeaseClaim.stateVersion,
    plan: plan([]),
    coverage,
    missingFields: [],
    pendingQuestion: null,
    leaseToken: planningLeaseClaim.leaseToken,
  }), "valid planning lease save");

  const founderText =
    "Todo desde Produbanco. Además me devolvieron 83.86 de un préstamo que yo había hecho; paga Diners full, 22.14 de Produbanco MV y 201.25 de Titanium.";
  const group = "founder-complete";
  const founderActions = [
    {
      id: "capital-return",
      capability: "record_person_payment",
      arguments: { direction: "in", inflowKind: "capital_return_unrecorded", person: "Alpaca", accountId: account.id, amount: 83.86, date: "2026-07-31" },
      atomic_group: group,
      depends_on: [],
      state_witness: {},
      effects: [
        effect("cash", "increase", "capital_return_unrecorded", account.id),
        effect("income_recognition", "unchanged", "capital_return_unrecorded", account.id),
        effect("receivable", "unchanged", "capital_return_unrecorded", account.id),
      ],
      postconditions: [],
    },
    ...cards.map((card, index) => ({
      id: `card-${index + 1}`,
      capability: "register_card_payment",
      arguments: {
        cardName: card.id,
        fromAccount: account.id,
        ...(index === 0
          ? { paidInFull: true }
          : { amount: Number(card.full_payment_due) }),
        date: "2026-07-31",
      },
      atomic_group: group,
      depends_on: [],
      state_witness: {},
      effects: [
        effect("cash", "decrease", "payment", account.id),
        effect("debt_liability", "decrease", "payment", card.id),
      ],
      postconditions: [],
    })),
  ];
  const founder = await claimAndSave({
    userId,
    key: `telegram:m0:founder:${randomUUID()}`,
    text: founderText,
    actions: founderActions,
  });
  const founderLease = mustOk(
    await beginAgentOperationApplication({
      userId,
      operationId: founder.claimed.id,
      expectedVersion: founder.saved.stateVersion,
    }),
    "founder lease",
  );
  const ctx = {
    userId,
    operationId: founder.claimed.id,
    durableOperationId: founder.claimed.id,
    durableOperationLeaseToken: founderLease.leaseToken,
    rawMessage: founderText,
    channel: "telegram",
    baseCurrency: "USD",
    timezone: "UTC",
    accounts: [{ id: account.id, name: "Produbanco M0", currency: "USD", currentBalanceOriginal: 1000, currentBalanceBase: 1000, isGoalAccount: false }],
    debtAccounts: [
      ...cards.map((card) => ({
        id: card.id,
        name: card.name,
        type: card.type,
        currency: card.currency,
        currentBalanceOriginal: Number(card.current_balance_original),
        currentBalanceBase: Number(card.current_balance_base),
        fullPaymentDueOriginal: Number(card.full_payment_due),
        fullPaymentDue: Number(card.full_payment_due),
        statementTotalDue: Number(card.statement_total_due),
        statementCovered: card.statement_covered === true,
      })),
      { id: loan.id, name: loan.name, type: loan.type, currency: loan.currency, currentBalanceOriginal: 10, currentBalanceBase: 10 },
    ],
    goals: [],
    fxRates: [],
  };
  const prepared = await Promise.all(
    founderActions.map(async (action) => ({
      action,
      result: await prepareAtomicAgentAction({ action, ctx }),
    })),
  );
  check(
    "M100.1 · el adapter real resuelve las cuatro patas del caso founder",
    prepared.every((row) => row.result.ok),
    JSON.stringify(prepared),
  );
  const capitalPrepared = prepared.find(
    (row) => row.action.id === "capital-return",
  )?.result;
  if (!capitalPrepared?.ok || capitalPrepared.resolvedType !== "ledger_entry") {
    throw new Error("capital-return adapter did not produce its ledger payload");
  }
  const forgedCapitalPayload = structuredClone(capitalPrepared.payload);
  forgedCapitalPayload.entry = {
    ...(forgedCapitalPayload.entry ?? {}),
    original_amount:
      Number(forgedCapitalPayload.entry?.original_amount ?? 0) + 1,
  };
  const forgedCapitalPreflight = await preflightAgentOperationStep({
    userId,
    operationId: founder.claimed.id,
    stepKey: "capital-return",
    resolvedType: "ledger_entry",
    resolvedPayload: forgedCapitalPayload,
    leaseToken: founderLease.leaseToken,
  });
  check(
    "M100.1a · PostgreSQL compara el payload del capital devuelto con el plan persistido antes de confiar en el adapter",
    !forgedCapitalPreflight.ok &&
      /capital-return ledger payload contradicts/.test(
        forgedCapitalPreflight.reason ?? "",
      ),
    JSON.stringify(forgedCapitalPreflight),
  );
  const cardPrepared = prepared.find((row) => row.action.id === "card-1")?.result;
  if (!cardPrepared?.ok) {
    throw new Error("card-payment adapter did not produce its ledger payload");
  }
  const forgedCardPayload = structuredClone(cardPrepared.payload);
  forgedCardPayload.entry = {
    ...(forgedCardPayload.entry ?? {}),
    original_amount: Number(forgedCardPayload.entry?.original_amount ?? 0) + 1,
  };
  const forgedCardPreflight = await preflightAgentOperationStep({
    userId,
    operationId: founder.claimed.id,
    stepKey: "card-1",
    resolvedType: cardPrepared.resolvedType,
    resolvedPayload: forgedCardPayload,
    leaseToken: founderLease.leaseToken,
  });
  check(
    "M100.1b · PostgreSQL compara cada pago de tarjeta resuelto con su plan antes de confiar en el adapter",
    !forgedCardPreflight.ok &&
      /card-payment payload contradicts/.test(forgedCardPreflight.reason ?? ""),
    JSON.stringify(forgedCardPreflight),
  );
  if (cardPrepared.resolvedType !== "card_payment") {
    throw new Error("paid-in-full card fixture did not retain the atomic statement route");
  }
  const forgedCardExpectedDue = structuredClone(cardPrepared.payload);
  forgedCardExpectedDue.statement = {
    ...(forgedCardExpectedDue.statement ?? {}),
    expected_due:
      Number(forgedCardExpectedDue.statement?.expected_due ?? 0) + 1,
  };
  const forgedCardExpectedDuePreflight = await preflightAgentOperationStep({
    userId,
    operationId: founder.claimed.id,
    stepKey: "card-1",
    resolvedType: cardPrepared.resolvedType,
    resolvedPayload: forgedCardExpectedDue,
    leaseToken: founderLease.leaseToken,
  });
  check(
    "M100.1ba · PostgreSQL deriva expected_due desde el corte vivo y no confía en el statement del adapter",
    !forgedCardExpectedDuePreflight.ok &&
      /card-payment payload contradicts/.test(
        forgedCardExpectedDuePreflight.reason ?? "",
      ),
    JSON.stringify(forgedCardExpectedDuePreflight),
  );
  const forgedCardPaidAmount = structuredClone(cardPrepared.payload);
  forgedCardPaidAmount.statement = {
    ...(forgedCardPaidAmount.statement ?? {}),
    paid_in_card_currency:
      Number(forgedCardPaidAmount.statement?.paid_in_card_currency ?? 0) + 1,
  };
  const forgedCardPaidAmountPreflight = await preflightAgentOperationStep({
    userId,
    operationId: founder.claimed.id,
    stepKey: "card-1",
    resolvedType: cardPrepared.resolvedType,
    resolvedPayload: forgedCardPaidAmount,
    leaseToken: founderLease.leaseToken,
  });
  check(
    "M100.1bb · PostgreSQL liga paid_in_card_currency a la pata de ledger probada",
    !forgedCardPaidAmountPreflight.ok &&
      /card-payment payload contradicts/.test(
        forgedCardPaidAmountPreflight.reason ?? "",
      ),
    JSON.stringify(forgedCardPaidAmountPreflight),
  );
  for (const row of prepared) {
    if (!row.result.ok) throw new Error(row.result.summary);
    mustOk(
      await preflightAgentOperationStep({
        userId,
        operationId: founder.claimed.id,
        stepKey: row.action.id,
        resolvedType: row.result.resolvedType,
        resolvedPayload: row.result.payload,
        leaseToken: founderLease.leaseToken,
      }),
      `preflight ${row.action.id}`,
    );
  }
  const founderBalanceBeforeApply = money(must(
    await admin.from("accounts").select("current_balance_original")
      .eq("id", account.id).single(),
    "founder balance before apply",
  ).current_balance_original);
  const groupApplied = mustOk(
    await applyAgentAtomicGroup({
      userId,
      operationId: founder.claimed.id,
      atomicGroup: group,
      leaseToken: founderLease.leaseToken,
    }),
    "founder group apply",
  );
  const founderState = await Promise.all([
    admin.from("accounts").select("current_balance_original").eq("id", account.id).single(),
    admin.from("debt_accounts").select("id,current_balance_original,full_payment_due").in("id", cards.map((card) => card.id)),
    admin.from("transactions").select("id,type,original_amount,destination_account_id,source_account_id,debt_account_id").eq("user_id", userId),
  ]);
  const accountAfter = must(founderState[0], "founder account");
  const cardsAfter = must(founderState[1], "founder cards");
  const founderTx = must(founderState[2], "founder tx");
  const founderCashDelta = money(
    money(accountAfter.current_balance_original) - founderBalanceBeforeApply,
  );
  check(
    "M100.2 · el grupo aterriza completo: capital no-ingreso + tres pagos",
    !groupApplied.replayed &&
      money(accountAfter.current_balance_original) === 809.87 &&
      cardsAfter.every((card) => money(card.current_balance_original) === 0 && money(card.full_payment_due) === 0) &&
      founderTx.length === 4 &&
      founderTx.filter((tx) => tx.type === "debt_payment").length === 3 &&
      founderTx.filter((tx) => tx.type === "adjustment").length === 1,
    JSON.stringify({ groupApplied, accountAfter, cardsAfter, founderTx }),
  );
  const groupReplay = mustOk(
    await applyAgentAtomicGroup({
      userId,
      operationId: founder.claimed.id,
      atomicGroup: group,
      leaseToken: founderLease.leaseToken,
    }),
    "founder group replay",
  );
  check(
    "M100.3 · replay del grupo no vuelve a mover ninguna pata",
    groupReplay.replayed && money((must(await admin.from("accounts").select("current_balance_original").eq("id", account.id).single(), "replay account")).current_balance_original) === 809.87,
  );
  await completeOperation({
    userId,
    operationId: founder.claimed.id,
    lease: founderLease,
    result: { reply: "operación founder completa" },
  });
  const founderRow = must(
    await admin.from("agent_operations").select("operation_key,result,status").eq("id", founder.claimed.id).single(),
    "founder operation row",
  );
  const exactReplay = mustOk(
    await claimAgentOperation({
      userId,
      deliveryKey: founder.key,
      channel: "telegram",
      chatId: "m0-probe",
      rootMessageId: "",
      requestText: founderText,
    }),
    "exact delivery replay",
  );
  check(
    "M100.4 · la entrega exacta recupera el resultado completado sin replanificar",
    exactReplay.outcome === "replayed" && exactReplay.status === "completed" && exactReplay.result?.reply === "operación founder completa",
    JSON.stringify({ exactReplay, founderRow }),
  );
  const divergentDelivery = await claimAgentOperation({
    userId,
    deliveryKey: founderRow.operation_key,
    channel: "telegram",
    chatId: "m0-probe",
    rootMessageId: "",
    requestText: `${founderText} ahora por otro monto`,
  });
  check(
    "M100.5 · una delivery key no puede cambiar de significado económico",
    !divergentDelivery.ok,
    JSON.stringify(divergentDelivery),
  );
  const recentOps = await readRecentCompletedAgentOperations(userId, 12);
  check(
    "M100.6 · la continuidad expone pasos, resultados y refs del plan completado",
    recentOps.ok && recentOps.operations[0]?.steps.length === 4 && recentOps.operations[0].steps.every((step) => step.status === "verified" && step.affectedRefs.some((ref) => ref.type === "transaction")),
    JSON.stringify(recentOps),
  );

  // A worker may die after persisting a plan (or even a step receipt) but
  // before publishing its answer. The immutable delivery must recover the
  // exact plan_version and step rows; asking the model for new arguments in
  // that interval can turn one landed write into two different dedupe keys.
  const recoveryAction = {
    id: "read-after-worker-crash",
    capability: "get_financial_context",
    arguments: {},
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [],
    postconditions: [],
  };
  const recoveryKey = `telegram:m0:recover-plan:${randomUUID()}`;
  const recovery = await claimAndSave({
    userId,
    key: recoveryKey,
    text: "Muéstrame el contexto y conserva el plan si el worker cae",
    actions: [recoveryAction],
  });
  const settledRecoveryReceiptInput = {
      userId,
      operationId: recovery.claimed.id,
      stepKey: recoveryAction.id,
      capability: recoveryAction.capability,
      arguments: recoveryAction.arguments,
      toolStatus: "done",
      executionEffect: "read",
      result: { summary: "contexto leído" },
      affectedRefs: [],
    };
  mustOk(
    await recordAgentOperationStepOutcome(settledRecoveryReceiptInput),
    "record settled recovery step",
  );
  const exactStepReceiptReplay = await recordAgentOperationStepOutcome(
    settledRecoveryReceiptInput,
  );
  check(
    "M100.6aa · un receipt asentado acepta únicamente su replay byte-equivalente",
    exactStepReceiptReplay.ok && exactStepReceiptReplay.status === "verified",
    JSON.stringify(exactStepReceiptReplay),
  );
  const divergentStepResult = await recordAgentOperationStepOutcome({
    ...settledRecoveryReceiptInput,
    result: { summary: "otro contexto bajo el mismo step" },
  });
  const divergentStepRefs = await recordAgentOperationStepOutcome({
    ...settledRecoveryReceiptInput,
    affectedRefs: [{ type: "account", id: account.id }],
  });
  check(
    "M100.6ab · mismo status no oculta un resultado o refs divergentes bajo replay",
    !divergentStepResult.ok && !divergentStepRefs.ok,
    JSON.stringify({ divergentStepResult, divergentStepRefs }),
  );
  const failedRecoveryWorker = mustOk(
    await transitionAgentOperation({
      userId,
      operationId: recovery.claimed.id,
      expectedVersion: recovery.saved.stateVersion,
      status: "failed_retriable",
      lastError: { code: "probe_worker_crash" },
    }),
    "mark worker crash",
  );
  const recoveredPlanClaim = mustOk(
    await claimAgentOperation({
      userId,
      deliveryKey: recoveryKey,
      channel: "telegram",
      chatId: "m0-probe",
      rootMessageId: "",
      requestText: "Muéstrame el contexto y conserva el plan si el worker cae",
    }),
    "recover persisted plan",
  );
  check(
    "M100.6a · una redelivery tras caída recupera el plan persistido, no vuelve a muestrear argumentos",
    failedRecoveryWorker.status === "failed_retriable" &&
      recoveredPlanClaim.outcome === "recovered_plan" &&
      recoveredPlanClaim.id === recovery.claimed.id &&
      recoveredPlanClaim.planVersion === recovery.saved.planVersion &&
      recoveredPlanClaim.plan?.actions?.[0]?.id === recoveryAction.id,
    JSON.stringify({ failedRecoveryWorker, recoveredPlanClaim }),
  );
  const resumedPersistedPlan = mustOk(
    await resumeAgentOperationPlan({
      userId,
      operationId: recovery.claimed.id,
      expectedVersion: recoveredPlanClaim.stateVersion,
      leaseToken: recoveredPlanClaim.leaseToken,
    }),
    "resume persisted plan",
  );
  const recoverySteps = must(
    await admin
      .from("agent_operation_steps")
      .select("plan_version,step_key,status")
      .eq("operation_id", recovery.claimed.id),
    "recovery steps",
  );
  check(
    "M100.6b · reanudar no crea otra versión ni pierde el receipt ya asentado",
    resumedPersistedPlan.planVersion === recovery.saved.planVersion &&
      recoverySteps.length === 1 &&
      recoverySteps[0].plan_version === recovery.saved.planVersion &&
      recoverySteps[0].step_key === recoveryAction.id &&
      recoverySteps[0].status === "verified",
    JSON.stringify({ resumedPersistedPlan, recoverySteps }),
  );

  // Operation-level correction is one transaction: reverse the complete prior
  // instruction and land the corrected movement. There is never an externally
  // visible state where the old fact disappeared but its replacement did not.
  const originalCorrectionAction = {
    id: "original-expense",
    capability: "log_movement",
    arguments: {
      type: "expense",
      amount: 10,
      description: "Compra a corregir",
      sourceAccountId: account.id,
    },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [
      effect("cash", "decrease", "expense", account.id),
      effect("expense_recognition", "increase", "expense", "original-expense"),
    ],
    postconditions: [],
  };
  const originalCorrection = await claimAndSave({
    userId,
    key: `telegram:m0:original-correction:${randomUUID()}`,
    text: "Gasté 10 y luego quizá lo corrija",
    actions: [originalCorrectionAction],
  });
  const originalCorrectionLease = mustOk(
    await beginAgentOperationApplication({
      userId,
      operationId: originalCorrection.claimed.id,
      expectedVersion: originalCorrection.saved.stateVersion,
    }),
    "original correction lease",
  );
  const originalCorrectionTx = must(
    await admin.rpc("kipu_apply_ledger_entry", {
      p_entry: {
        user_id: userId,
        type: "expense",
        effect_type: "expense",
        sign: 1,
        description: "Compra a corregir",
        category: "other",
        original_amount: 10,
        original_currency: "USD",
        exchange_rate_to_base: 1,
        base_amount: 10,
        base_currency: "USD",
        source_account_id: account.id,
        raw_input: "Gasté 10 y luego quizá lo corrija",
        input_channel: "chat",
        occurred_at: new Date().toISOString(),
        dedupe_key: `agent-operation:${originalCorrection.claimed.id}:${originalCorrectionAction.id}`,
      },
    }),
    "original correction ledger",
  );
  mustOk(
    await recordAgentOperationStepOutcome({
      userId,
      operationId: originalCorrection.claimed.id,
      stepKey: originalCorrectionAction.id,
      capability: originalCorrectionAction.capability,
      arguments: originalCorrectionAction.arguments,
      toolStatus: "done",
      executionEffect: "write",
      result: { summary: "gasto original", transactionId: originalCorrectionTx },
      affectedRefs: [{ type: "transaction", id: originalCorrectionTx }],
      leaseToken: originalCorrectionLease.leaseToken,
    }),
    "original correction receipt",
  );
  await completeOperation({
    userId,
    operationId: originalCorrection.claimed.id,
    lease: originalCorrectionLease,
    result: { reply: "gasto original" },
  });
  const correctionGroup = "replace-whole-operation";
  const correctionActions = [
    {
      id: "undo-original-operation",
      capability: "undo_agent_operation",
      arguments: { targetOperationId: originalCorrection.claimed.id },
      atomic_group: correctionGroup,
      depends_on: [],
      state_witness: {},
      effects: [
        effect("cash", "increase", "reversal", `operation:${originalCorrection.claimed.id}`),
      ],
      postconditions: [],
    },
    {
      id: "corrected-expense",
      capability: "log_movement",
      arguments: {
        type: "expense",
        amount: 12,
        description: "Compra corregida",
        sourceAccountId: account.id,
      },
      atomic_group: correctionGroup,
      depends_on: ["undo-original-operation"],
      state_witness: {},
      effects: [
        // The real model uses the ontology's typed entity reference. Migration
        // 106 must prove it resolves to this exact account rather than treating
        // the harmless prefix as an economic contradiction.
        effect("cash", "decrease", "expense", `account:${account.id}`),
        effect("expense_recognition", "increase", "expense", "corrected-expense"),
      ],
      postconditions: [],
    },
  ];
  const correction = await claimAndSave({
    userId,
    key: `telegram:m0:replace-operation:${randomUUID()}`,
    text: "Lo que te dije antes estaba mal: fueron 12, corrige toda esa operación",
    actions: correctionActions,
  });
  const correctionLease = mustOk(
    await beginAgentOperationApplication({
      userId,
      operationId: correction.claimed.id,
      expectedVersion: correction.saved.stateVersion,
    }),
    "correction replacement lease",
  );
  const correctionCtx = {
    ...ctx,
    operationId: correction.claimed.id,
    durableOperationId: correction.claimed.id,
    durableOperationLeaseToken: correctionLease.leaseToken,
    rawMessage:
      "Lo que te dije antes estaba mal: fueron 12, corrige toda esa operación",
    atomicCorrectionTargetOperationId: originalCorrection.claimed.id,
  };
  const correctionPrepared = [];
  for (const action of correctionActions) {
    const row = await prepareAtomicAgentAction({ action, ctx: correctionCtx });
    correctionPrepared.push({ action, result: row });
    if (!row.ok) throw new Error(row.summary);
    mustOk(
      await preflightAgentOperationStep({
        userId,
        operationId: correction.claimed.id,
        stepKey: action.id,
        resolvedType: row.resolvedType,
        resolvedPayload: row.payload,
        leaseToken: correctionLease.leaseToken,
      }),
      `correction preflight ${action.id}`,
    );
  }
  const preCorrectionBalance = money(
    must(
      await admin
        .from("accounts")
        .select("current_balance_original")
        .eq("id", account.id)
        .single(),
      "pre correction balance",
    ).current_balance_original,
  );
  const correctionApplied = mustOk(
    await applyAgentAtomicGroup({
      userId,
      operationId: correction.claimed.id,
      atomicGroup: correctionGroup,
      leaseToken: correctionLease.leaseToken,
    }),
    "apply operation replacement",
  );
  const postCorrectionBalance = money(
    must(
      await admin
        .from("accounts")
        .select("current_balance_original")
        .eq("id", account.id)
        .single(),
      "post correction balance",
    ).current_balance_original,
  );
  const originalCorrectionReversals = await reversalCountFor(originalCorrectionTx);
  check(
    "M100.6c · corregir una operación revierte el hecho anterior y aterriza el reemplazo en la misma transacción",
    !correctionApplied.replayed &&
      postCorrectionBalance === money(preCorrectionBalance - 2) &&
      originalCorrectionReversals === 1 &&
      correctionApplied.results.length === 2,
    JSON.stringify({
      correctionPrepared,
      correctionApplied,
      preCorrectionBalance,
      postCorrectionBalance,
      originalCorrectionReversals,
    }),
  );
  await completeOperation({
    userId,
    operationId: correction.claimed.id,
    lease: correctionLease,
    result: { reply: "operación corregida" },
  });

  // A correction is itself durable work. Correcting it again must reverse only
  // its replacement facts — never the reversal rows that retired the original.
  // Conversely, a bare "undo the correction" is ambiguous and must fail before
  // touching money unless the new truth is supplied in the same atomic group.
  const correctionStep = must(
    await admin
      .from("agent_operation_steps")
      .select("affected_refs")
      .eq("operation_id", correction.claimed.id)
      .eq("step_key", "corrected-expense")
      .single(),
    "first correction replacement receipt",
  );
  const firstReplacementTransactionId = correctionStep.affected_refs?.find(
    (ref) => ref?.type === "transaction",
  )?.id;
  if (!firstReplacementTransactionId) {
    throw new Error("first correction replacement transaction is missing");
  }
  const secondCorrectionGroup = "replace-prior-correction";
  const secondCorrectionActions = [
    {
      id: "undo-prior-correction",
      capability: "undo_agent_operation",
      arguments: { targetOperationId: correction.claimed.id },
      atomic_group: secondCorrectionGroup,
      depends_on: [],
      state_witness: {},
      effects: [effect("cash", "increase", "reversal", `operation:${correction.claimed.id}`)],
      postconditions: [],
    },
    {
      id: "second-corrected-expense",
      capability: "log_movement",
      arguments: {
        type: "expense",
        amount: 9,
        description: "Compra corregida otra vez",
        sourceAccountId: account.id,
      },
      atomic_group: secondCorrectionGroup,
      depends_on: ["undo-prior-correction"],
      state_witness: {},
      effects: [
        effect("cash", "decrease", "expense", `account:${account.id}`),
        effect("expense_recognition", "increase", "expense", "second-corrected-expense"),
      ],
      postconditions: [],
    },
  ];
  const secondCorrection = await claimAndSave({
    userId,
    key: `telegram:m0:replace-correction:${randomUUID()}`,
    text: "La corrección también estaba mal: en realidad fueron 9",
    actions: secondCorrectionActions,
  });
  const secondCorrectionLease = mustOk(
    await beginAgentOperationApplication({
      userId,
      operationId: secondCorrection.claimed.id,
      expectedVersion: secondCorrection.saved.stateVersion,
    }),
    "second correction lease",
  );
  const secondCorrectionCtx = {
    ...ctx,
    operationId: secondCorrection.claimed.id,
    durableOperationId: secondCorrection.claimed.id,
    durableOperationLeaseToken: secondCorrectionLease.leaseToken,
    rawMessage: "La corrección también estaba mal: en realidad fueron 9",
    atomicCorrectionTargetOperationId: correction.claimed.id,
  };
  for (const action of secondCorrectionActions) {
    const row = await prepareAtomicAgentAction({ action, ctx: secondCorrectionCtx });
    if (!row.ok) throw new Error(row.summary);
    mustOk(
      await preflightAgentOperationStep({
        userId,
        operationId: secondCorrection.claimed.id,
        stepKey: action.id,
        resolvedType: row.resolvedType,
        resolvedPayload: row.payload,
        leaseToken: secondCorrectionLease.leaseToken,
      }),
      `second correction preflight ${action.id}`,
    );
  }
  const preSecondCorrectionBalance = money(
    must(
      await admin.from("accounts").select("current_balance_original")
        .eq("id", account.id).single(),
      "pre second correction balance",
    ).current_balance_original,
  );
  const secondCorrectionApplied = mustOk(
    await applyAgentAtomicGroup({
      userId,
      operationId: secondCorrection.claimed.id,
      atomicGroup: secondCorrectionGroup,
      leaseToken: secondCorrectionLease.leaseToken,
    }),
    "apply second operation replacement",
  );
  const [postSecondCorrectionAccount, firstReplacementReversals, originalStillReversedOnce] =
    await Promise.all([
      admin.from("accounts").select("current_balance_original")
        .eq("id", account.id).single(),
      reversalCountFor(firstReplacementTransactionId),
      reversalCountFor(originalCorrectionTx),
    ]);
  check(
    "M100.6d · una corrección de otra corrección revierte sólo el reemplazo vigente y aterriza la nueva verdad",
    !secondCorrectionApplied.replayed &&
      money(must(postSecondCorrectionAccount, "post second correction").current_balance_original) ===
        money(preSecondCorrectionBalance + 3) &&
      firstReplacementReversals === 1 &&
      originalStillReversedOnce === 1 &&
      secondCorrectionApplied.results.length === 2,
    JSON.stringify({
      secondCorrectionApplied,
      preSecondCorrectionBalance,
      postSecondCorrectionAccount: postSecondCorrectionAccount.data,
      firstReplacementReversals,
      originalStillReversedOnce,
    }),
  );
  await completeOperation({
    userId,
    operationId: secondCorrection.claimed.id,
    lease: secondCorrectionLease,
    result: { reply: "operación corregida otra vez" },
  });
  const ambiguousUndoAction = {
    id: "undo-correction-without-truth",
    capability: "undo_agent_operation",
    arguments: { targetOperationId: secondCorrection.claimed.id },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [effect("cash", "increase", "reversal", secondCorrection.claimed.id)],
    postconditions: [],
  };
  const ambiguousUndo = await claimAndSave({
    userId,
    key: `telegram:m0:ambiguous-correction-undo:${randomUUID()}`,
    text: "Deshaz esa corrección",
    actions: [ambiguousUndoAction],
  });
  const ambiguousUndoLease = mustOk(
    await beginAgentOperationApplication({
      userId,
      operationId: ambiguousUndo.claimed.id,
      expectedVersion: ambiguousUndo.saved.stateVersion,
    }),
    "ambiguous correction undo lease",
  );
  const beforeAmbiguousUndo = money(
    must(await admin.from("accounts").select("current_balance_original")
      .eq("id", account.id).single(), "before ambiguous undo").current_balance_original,
  );
  const ambiguousUndoResult = await reverseAgentOperation({
    userId,
    reversalOperationId: ambiguousUndo.claimed.id,
    targetOperationId: secondCorrection.claimed.id,
    stepKey: ambiguousUndoAction.id,
    leaseToken: ambiguousUndoLease.leaseToken,
    message: "Deshaz esa corrección",
    channel: "telegram",
  });
  const afterAmbiguousUndo = money(
    must(await admin.from("accounts").select("current_balance_original")
      .eq("id", account.id).single(), "after ambiguous undo").current_balance_original,
  );
  check(
    "M100.6e · deshacer una corrección sin declarar la verdad nueva rehúsa antes de mover dinero",
    !ambiguousUndoResult.ok && ambiguousUndoResult.reason === "unsafe" &&
      afterAmbiguousUndo === beforeAmbiguousUndo,
    JSON.stringify({ ambiguousUndoResult, beforeAmbiguousUndo, afterAmbiguousUndo }),
  );

  // A real receivable repayment plus an independent capital return exercises
  // the coordinator's `repayment` branch. The persisted action names the exact
  // receivable read by the planner; PostgreSQL must reject either an amount or
  // identity that the adapter tries to substitute.
  const repaymentGroup = "repayment-complete";
  const repaymentActions = [
    {
      id: "repayment",
      capability: "record_person_payment",
      arguments: {
        direction: "in",
        inflowKind: "loan_repayment",
        person: "Juan M0",
        accountId: account.id,
        receivableIds: [receivable.id],
        amount: 40,
        date: "2026-07-31",
      },
      atomic_group: repaymentGroup,
      depends_on: [],
      state_witness: {},
      effects: [
        effect("cash", "increase", "receivable_repayment", account.id),
        effect("receivable", "decrease", "receivable_repayment", receivable.id),
      ],
      postconditions: [],
    },
    {
      id: "second-capital-return",
      capability: "record_person_payment",
      arguments: {
        direction: "in",
        inflowKind: "capital_return_unrecorded",
        person: "Ana M0",
        accountId: account.id,
        amount: 1,
        date: "2026-07-31",
      },
      atomic_group: repaymentGroup,
      depends_on: [],
      state_witness: {},
      effects: [
        effect("cash", "increase", "capital_return_unrecorded", account.id),
        effect("income_recognition", "unchanged", "capital_return_unrecorded", account.id),
        effect("receivable", "unchanged", "capital_return_unrecorded", account.id),
      ],
      postconditions: [],
    },
  ];
  const repaymentOperation = await claimAndSave({
    userId,
    key: `telegram:m0:repayment:${randomUUID()}`,
    text: "Juan me devolvió 40 del préstamo y Ana devolvió 1 de capital no registrado",
    actions: repaymentActions,
  });
  const repaymentLease = mustOk(await beginAgentOperationApplication({
    userId,
    operationId: repaymentOperation.claimed.id,
    expectedVersion: repaymentOperation.saved.stateVersion,
  }), "repayment lease");
  const repaymentCtx = {
    ...ctx,
    operationId: repaymentOperation.claimed.id,
    durableOperationId: repaymentOperation.claimed.id,
    durableOperationLeaseToken: repaymentLease.leaseToken,
    rawMessage: "Juan me devolvió 40 del préstamo y Ana devolvió 1 de capital no registrado",
  };
  const repaymentPrepared = await Promise.all(repaymentActions.map(async (action) => ({
    action,
    result: await prepareAtomicAgentAction({ action, ctx: repaymentCtx }),
  })));
  check(
    "M100.1c · el adapter real resuelve devolución de receivable y capital independiente sin degradarlos a ingreso",
    repaymentPrepared.every((row) => row.result.ok) &&
      repaymentPrepared.find((row) => row.action.id === "repayment")?.result.resolvedType === "repayment",
    JSON.stringify(repaymentPrepared),
  );
  const repaymentPayload = repaymentPrepared.find(
    (row) => row.action.id === "repayment",
  )?.result;
  if (!repaymentPayload?.ok || repaymentPayload.resolvedType !== "repayment") {
    throw new Error("repayment adapter did not produce its atomic payload");
  }
  const forgedRepaymentPayload = structuredClone(repaymentPayload.payload);
  forgedRepaymentPayload.allocations = [{
    ...forgedRepaymentPayload.allocations[0],
    receivable_id: randomUUID(),
  }];
  const forgedRepaymentPreflight = await preflightAgentOperationStep({
    userId,
    operationId: repaymentOperation.claimed.id,
    stepKey: "repayment",
    resolvedType: "repayment",
    resolvedPayload: forgedRepaymentPayload,
    leaseToken: repaymentLease.leaseToken,
  });
  check(
    "M100.1d · PostgreSQL compara la devolución y sus allocations con el plan persistido",
    !forgedRepaymentPreflight.ok &&
      /receivable-repayment payload contradicts/.test(
        forgedRepaymentPreflight.reason ?? "",
      ),
    JSON.stringify(forgedRepaymentPreflight),
  );
  for (const row of repaymentPrepared) {
    if (!row.result.ok) throw new Error(row.result.summary);
    mustOk(await preflightAgentOperationStep({
      userId,
      operationId: repaymentOperation.claimed.id,
      stepKey: row.action.id,
      resolvedType: row.result.resolvedType,
      resolvedPayload: row.result.payload,
      leaseToken: repaymentLease.leaseToken,
    }), `repayment preflight ${row.action.id}`);
  }
  const repaymentBefore = money((must(await admin.from("accounts")
    .select("current_balance_original").eq("id", account.id).single(),
  "repayment before")).current_balance_original);
  const repaymentApplied = mustOk(await applyAgentAtomicGroup({
    userId,
    operationId: repaymentOperation.claimed.id,
    atomicGroup: repaymentGroup,
    leaseToken: repaymentLease.leaseToken,
  }), "repayment group apply");
  const [repaymentAccount, receivableAfter, repaymentMarker] = await Promise.all([
    admin.from("accounts").select("current_balance_original").eq("id", account.id).single(),
    admin.from("receivables").select("outstanding_amount,status").eq("id", receivable.id).single(),
    admin.from("receivable_repayment_applications")
      .select("transaction_id,allocations,reversed_at")
      .eq("user_id", userId).single(),
  ]);
  check(
    "M100.1e · devolución agrupada acredita caja y reduce el receivable en la misma transacción",
    !repaymentApplied.replayed &&
      money(must(repaymentAccount, "repayment account").current_balance_original) === repaymentBefore + 41 &&
      money(must(receivableAfter, "receivable after").outstanding_amount) === 60 &&
      must(receivableAfter, "receivable after").status === "partial" &&
      must(repaymentMarker, "repayment marker").allocations[0]?.receivable_id === receivable.id,
    JSON.stringify({ repaymentApplied, repaymentAccount: repaymentAccount.data, receivableAfter: receivableAfter.data, repaymentMarker: repaymentMarker.data }),
  );
  const repaymentReplay = mustOk(await applyAgentAtomicGroup({
    userId,
    operationId: repaymentOperation.claimed.id,
    atomicGroup: repaymentGroup,
    leaseToken: repaymentLease.leaseToken,
  }), "repayment group replay");
  const repaymentReplayReceivable = must(await admin.from("receivables")
    .select("outstanding_amount").eq("id", receivable.id).single(),
  "repayment replay receivable");
  check(
    "M100.1f · replay de la devolución agrupada no acredita ni descuenta dos veces",
    repaymentReplay.replayed && money(repaymentReplayReceivable.outstanding_amount) === 60,
    JSON.stringify({ repaymentReplay, repaymentReplayReceivable }),
  );
  await completeOperation({
    userId,
    operationId: repaymentOperation.claimed.id,
    lease: repaymentLease,
    result: { reply: "devolución completa" },
  });
  const markerRow = must(repaymentMarker, "repayment marker");
  const halfUndo = await admin.rpc("kipu_reverse_financial_operation", {
    p: {
      user_id: userId,
      transaction_id: markerRow.transaction_id,
      raw_input: "reversa parcial prohibida",
      input_channel: "chat",
    },
  });
  const halfUndoState = await Promise.all([
    admin.from("accounts").select("current_balance_original").eq("id", account.id).single(),
    admin.from("receivables").select("outstanding_amount").eq("id", receivable.id).single(),
  ]);
  check(
    "M100.1g · la reversa genérica no puede devolver sólo caja y dejar reducido el receivable",
    !!halfUndo.error &&
      /two-leg reversal writer/.test(halfUndo.error.message ?? "") &&
      money(must(halfUndoState[0], "half undo account").current_balance_original) === repaymentBefore + 41 &&
      money(must(halfUndoState[1], "half undo receivable").outstanding_amount) === 60,
    JSON.stringify({ error: halfUndo.error, halfUndoState: halfUndoState.map((row) => row.data) }),
  );
  const repaymentUndoAction = {
    id: "undo-repayment-group",
    capability: "undo_agent_operation",
    arguments: { targetOperationId: repaymentOperation.claimed.id },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [effect("cash", "decrease", "reversal", account.id)],
    postconditions: [],
  };
  const repaymentUndo = await claimAndSave({
    userId,
    key: `telegram:m0:repayment-undo:${randomUUID()}`,
    text: "Deshaz la devolución de Juan y el capital de Ana",
    actions: [repaymentUndoAction],
  });
  const repaymentUndoLease = mustOk(await beginAgentOperationApplication({
    userId,
    operationId: repaymentUndo.claimed.id,
    expectedVersion: repaymentUndo.saved.stateVersion,
  }), "repayment undo lease");
  const repaymentUndoResult = mustOk(await reverseAgentOperation({
    userId,
    reversalOperationId: repaymentUndo.claimed.id,
    targetOperationId: repaymentOperation.claimed.id,
    stepKey: repaymentUndoAction.id,
    leaseToken: repaymentUndoLease.leaseToken,
    message: "deshaz la devolución y el capital",
    channel: "telegram",
  }), "repayment operation undo");
  const [repaymentUndoAccount, repaymentUndoReceivable, repaymentUndoMarker] = await Promise.all([
    admin.from("accounts").select("current_balance_original").eq("id", account.id).single(),
    admin.from("receivables").select("outstanding_amount,status").eq("id", receivable.id).single(),
    admin.from("receivable_repayment_applications")
      .select("reversal_transaction_id,reversed_at")
      .eq("transaction_id", markerRow.transaction_id).single(),
  ]);
  check(
    "M100.1h · undo de operación restaura caja y receivable completos o ninguno",
    // auditoría externa: el store devuelve {ok,replayed,targetOperationId,
    // affectedRefs}; no existe `outcome`. Las DOS patas (caja + receivable)
    // son la prueba real de que la reversa fue completa.
    !repaymentUndoResult.replayed &&
      repaymentUndoResult.affectedRefs.length === 2 &&
      money(must(repaymentUndoAccount, "repayment undo account").current_balance_original) === repaymentBefore &&
      money(must(repaymentUndoReceivable, "repayment undo receivable").outstanding_amount) === 100 &&
      must(repaymentUndoReceivable, "repayment undo receivable").status === "open" &&
      Boolean(must(repaymentUndoMarker, "repayment undo marker").reversal_transaction_id) &&
      Boolean(must(repaymentUndoMarker, "repayment undo marker").reversed_at),
    JSON.stringify({ repaymentUndoResult, repaymentUndoAccount: repaymentUndoAccount.data, repaymentUndoReceivable: repaymentUndoReceivable.data, repaymentUndoMarker: repaymentUndoMarker.data }),
  );
  await completeOperation({
    userId,
    operationId: repaymentUndo.claimed.id,
    lease: repaymentUndoLease,
    result: { reply: "devolución deshecha" },
  });
  const concurrentRepaymentKey = `m0-concurrent-repayment:${randomUUID()}`;
  const concurrentRepaymentEntry = {
    ...repaymentPayload.payload.entry,
    original_amount: 7,
    base_amount: 7,
    external_ref: `receivable_repayment:${concurrentRepaymentKey}`,
    dedupe_key: concurrentRepaymentKey,
  };
  const concurrentRepaymentAllocations = [{
    receivable_id: receivable.id,
    amount: 7,
    // el v2 endurecido exige el outstanding leído como CAS
    expected_outstanding: 100,
  }];
  const concurrentRepaymentBefore = money((must(
    await admin.from("accounts").select("current_balance_original")
      .eq("id", account.id).single(),
    "concurrent repayment before",
  )).current_balance_original);
  const concurrentRepayments = await Promise.all([
    admin.rpc("kipu_apply_repayment_v2", {
      p_entry: concurrentRepaymentEntry,
      p_allocations: concurrentRepaymentAllocations,
    }),
    admin.rpc("kipu_apply_repayment_v2", {
      p_entry: concurrentRepaymentEntry,
      p_allocations: concurrentRepaymentAllocations,
    }),
  ]);
  const [concurrentRepaymentAccount, concurrentRepaymentReceivable, concurrentMarkers] =
    await Promise.all([
      admin.from("accounts").select("current_balance_original")
        .eq("id", account.id).single(),
      admin.from("receivables").select("outstanding_amount")
        .eq("id", receivable.id).single(),
      admin.from("receivable_repayment_applications")
        .select("id")
        .eq("user_id", userId)
        .eq("dedupe_key", concurrentRepaymentKey),
    ]);
  check(
    "M100.1i · dos devoluciones concurrentes con la misma identidad convergen en una sola reducción",
    concurrentRepayments.every((result) => !result.error) &&
      money(must(concurrentRepaymentAccount, "concurrent repayment account").current_balance_original) === concurrentRepaymentBefore + 7 &&
      money(must(concurrentRepaymentReceivable, "concurrent repayment receivable").outstanding_amount) === 93 &&
      must(concurrentMarkers, "concurrent repayment markers").length === 1,
    JSON.stringify({
      concurrentRepayments: concurrentRepayments.map((row) => row.error ?? row.data),
      account: concurrentRepaymentAccount.data,
      receivable: concurrentRepaymentReceivable.data,
      markers: concurrentMarkers.data,
    }),
  );

  // Exact pending question + CAS continuation. Two channels cannot consume the
  // same waiting operation on the same state snapshot.
  const waitingKey = `telegram:m0:waiting:${randomUUID()}`;
  const exactQuestion = "¿Desde qué cuenta salió el pago de la Diners NT?";
  const waiting = await claimAndSave({
    userId,
    key: waitingKey,
    text: "Ya pagué la Diners",
    actions: [],
    missing: [{ key: "source_account", reason: "Falta la cuenta de salida", applies_to: ["$response"], answer_shape: "Nombre de la cuenta" }],
    question: exactQuestion,
  });
  const waitingReplay = mustOk(
    await claimAgentOperation({
      userId,
      deliveryKey: waitingKey,
      channel: "telegram",
      chatId: "m0-probe",
      rootMessageId: "",
      requestText: "Ya pagué la Diners",
    }),
    "waiting replay",
  );
  check(
    "M100.7 · ¿qué falta? vive durable y una redelivery devuelve la pregunta exacta",
    waitingReplay.outcome === "replayed" && waitingReplay.pendingQuestion === exactQuestion && waitingReplay.missingFields[0]?.key === "source_account",
    JSON.stringify(waitingReplay),
  );
  const staleContinuation = await claimAgentOperation({
    userId,
    deliveryKey: `telegram:m0:stale-answer:${randomUUID()}`,
    channel: "telegram",
    chatId: "m0-probe",
    rootMessageId: "",
    requestText: "Desde Produbanco",
    continuationOperationId: waiting.claimed.id,
    expectedOperationVersions: {
      [waiting.claimed.id]: waiting.saved.stateVersion - 1,
    },
  });
  check(
    "M100.7a · una respuesta planificada sobre una versión vieja no puede consumir trabajo más nuevo",
    !staleContinuation.ok && /changed after the planning snapshot/i.test(staleContinuation.reason),
    JSON.stringify(staleContinuation),
  );
  const concurrent = await Promise.all([
    claimAgentOperation({ userId, deliveryKey: `web:m0:answer:${randomUUID()}`, channel: "web", chatId: "m0-web", rootMessageId: "", requestText: "Desde Produbanco", continuationOperationId: waiting.claimed.id, expectedOperationVersions: { [waiting.claimed.id]: waiting.saved.stateVersion } }),
    claimAgentOperation({ userId, deliveryKey: `telegram:m0:answer:${randomUUID()}`, channel: "telegram", chatId: "m0-probe", rootMessageId: "", requestText: "Desde Produbanco", continuationOperationId: waiting.claimed.id, expectedOperationVersions: { [waiting.claimed.id]: waiting.saved.stateVersion } }),
  ]);
  check(
    "M100.8 · dos canales concurrentes reanudan exactamente una vez",
    concurrent.filter((row) => row.ok && row.outcome === "resumed").length === 1 && concurrent.filter((row) => !row.ok).length === 1,
    JSON.stringify(concurrent),
  );

  // A missing datum blocks only the action/group named by applies_to. The
  // independent write is verified before the operation returns to
  // awaiting_input, so a continuation sees a durable receipt and cannot
  // silently repeat it.
  const partialAccount = must(await admin.from("accounts").insert({
    user_id: userId,
    name: "Cuenta independiente M0",
    type: "bank",
    currency: "USD",
    current_balance_original: 50,
    current_balance_base: 50,
  }).select("id,current_balance_original").single(), "partial account");
  const primaryBeforePartial = money((must(await admin.from("accounts")
    .select("current_balance_original").eq("id", account.id).single(),
  "primary before partial")).current_balance_original);
  const partialActions = [
    {
      id: "independent-expense",
      capability: "log_movement",
      arguments: { type: "expense", amount: 3, currency: "USD", sourceAccountId: account.id, category: "other", description: "Paso independiente" },
      atomic_group: null,
      depends_on: [],
      state_witness: {},
      effects: [
        effect("cash", "decrease", "expense", account.id),
        effect("expense_recognition", "increase", "expense", account.id),
      ],
      postconditions: [],
    },
    {
      id: "blocked-expense",
      capability: "log_movement",
      arguments: { type: "expense", currency: "USD", sourceAccountId: partialAccount.id, category: "other", description: "Paso bloqueado" },
      atomic_group: null,
      depends_on: [],
      state_witness: {},
      effects: [
        effect("cash", "decrease", "expense", partialAccount.id),
        effect("expense_recognition", "increase", "expense", partialAccount.id),
      ],
      postconditions: [],
    },
  ];
  const partial = await claimAndSave({
    userId,
    key: `telegram:m0:partial:${randomUUID()}`,
    text: "Registra dos gastos independientes; del segundo todavía falta el monto",
    actions: partialActions,
    missing: [{
      key: "blocked_amount",
      reason: "Falta el monto del segundo gasto",
      applies_to: ["blocked-expense"],
      answer_shape: "Monto del segundo gasto",
    }],
    question: "¿Cuál fue el monto del segundo gasto?",
  });
  const partialReadyRow = must(
    await admin.from("agent_operations")
      .select("status,missing_fields,pending_question")
      .eq("id", partial.claimed.id)
      .single(),
    "partial ready row",
  );
  check(
    "M100.8 · un plan READY conserva la pregunta exacta para recuperar el worker después de ejecutar sus pasos independientes",
    partial.saved.status === "ready" &&
      partialReadyRow.status === "ready" &&
      Array.isArray(partialReadyRow.missing_fields) &&
      partialReadyRow.missing_fields.length === 1 &&
      partialReadyRow.pending_question === "¿Cuál fue el monto del segundo gasto?",
    JSON.stringify({ saved: partial.saved, row: partialReadyRow }),
  );
  const missingWithoutQuestionClaim = mustOk(
    await claimAgentOperation({
      userId,
      deliveryKey: `telegram:m0:missing-without-question:${randomUUID()}`,
      channel: "telegram",
      chatId: "m0-probe",
      rootMessageId: "",
      requestText: "Plan inválido de sonda: falta un dato pero no una pregunta",
    }),
    "missing-without-question claim",
  );
  const missingWithoutQuestion = await saveAgentOperationPlan({
    userId,
    operationId: missingWithoutQuestionClaim.id,
    expectedVersion: missingWithoutQuestionClaim.stateVersion,
    plan: plan(partialActions),
    coverage,
    missingFields: [{
      key: "blocked_amount",
      reason: "Falta el monto del segundo gasto",
      applies_to: ["blocked-expense"],
      answer_shape: "Monto del segundo gasto",
    }],
    pendingQuestion: null,
    leaseToken: missingWithoutQuestionClaim.leaseToken,
  });
  check(
    "M100.8b · PostgreSQL rehúsa cualquier missing_fields sin su pregunta exacta, incluso si el plan queda READY",
    !missingWithoutQuestion.ok &&
      missingWithoutQuestion.reason.includes(
        "an incomplete plan requires its exact question",
      ),
    JSON.stringify(missingWithoutQuestion),
  );
  const partialLease = mustOk(await beginAgentOperationApplication({
    userId,
    operationId: partial.claimed.id,
    expectedVersion: partial.saved.stateVersion,
  }), "partial lease");
  const partialTransaction = must(await admin.rpc("kipu_apply_ledger_entry", {
    p_entry: {
      user_id: userId,
      type: "expense",
      effect_type: "expense",
      sign: 1,
      description: "Paso independiente",
      category: "other",
      original_amount: 3,
      original_currency: "USD",
      exchange_rate_to_base: 1,
      base_amount: 3,
      base_currency: "USD",
      source_account_id: account.id,
      raw_input: "paso independiente M0",
      input_channel: "telegram",
      dedupe_key: `m0-partial:${partial.claimed.id}`,
    },
  }), "partial independent write");
  mustOk(await recordAgentOperationStepOutcome({
    userId,
    operationId: partial.claimed.id,
    stepKey: "independent-expense",
    capability: "log_movement",
    arguments: partialActions[0].arguments,
    toolStatus: "done",
    executionEffect: "write",
    result: { transactionId: String(partialTransaction) },
    affectedRefs: [{ type: "transaction", id: String(partialTransaction) }],
    leaseToken: partialLease.leaseToken,
  }), "partial write receipt");
  mustOk(await recordAgentOperationStepOutcome({
    userId,
    operationId: partial.claimed.id,
    stepKey: "blocked-expense",
    capability: "log_movement",
    arguments: partialActions[1].arguments,
    toolStatus: "needs_info",
    executionEffect: "needs_info",
    result: { summary: "Falta el monto" },
    affectedRefs: [],
    leaseToken: partialLease.leaseToken,
  }), "partial missing receipt");
  const partialVerifying = mustOk(await transitionAgentOperation({
    userId,
    operationId: partial.claimed.id,
    expectedVersion: partialLease.stateVersion,
    status: "verifying",
    leaseToken: partialLease.leaseToken,
    result: { partial: true },
  }), "partial verifying");
  const partialVerified = mustOk(await verifyAgentOperation({
    userId,
    operationId: partial.claimed.id,
    leaseToken: partialLease.leaseToken,
    postWriteContextVerified: true,
    allowIncomplete: true,
  }), "partial verification");
  const partialAwaiting = mustOk(await transitionAgentOperation({
    userId,
    operationId: partial.claimed.id,
    expectedVersion: partialVerifying.stateVersion,
    status: "awaiting_input",
    leaseToken: partialLease.leaseToken,
    result: { partial: true, verification: partialVerified },
    missingFields: [{ key: "blocked_amount", reason: "Falta el monto", applies_to: ["blocked-expense"], answer_shape: "Monto" }],
    pendingQuestion: "¿Cuál fue el monto del segundo gasto?",
  }), "partial awaiting");
  const [partialRows, primaryAfterPartial, secondaryAfterPartial, partialOperation] = await Promise.all([
    admin.from("agent_operation_steps").select("step_key,status").eq("operation_id", partial.claimed.id).order("step_order"),
    admin.from("accounts").select("current_balance_original").eq("id", account.id).single(),
    admin.from("accounts").select("current_balance_original").eq("id", partialAccount.id).single(),
    admin.from("agent_operations").select("status,pending_question").eq("id", partial.claimed.id).single(),
  ]);
  check(
    "M100.8a · un dato faltante bloquea sólo su paso y el write independiente queda verificado antes de preguntar",
    must(partialRows, "partial rows").map((row) => row.status).join(",") === "verified,needs_input" &&
      money(must(primaryAfterPartial, "primary after partial").current_balance_original) === primaryBeforePartial - 3 &&
      money(must(secondaryAfterPartial, "secondary after partial").current_balance_original) === 50 &&
      must(partialOperation, "partial operation").status === "awaiting_input",
    JSON.stringify({ partialRows: partialRows.data, primaryAfterPartial: primaryAfterPartial.data, secondaryAfterPartial: secondaryAfterPartial.data, partialOperation: partialOperation.data }),
  );

  // The answer creates plan version 2 with only the still-pending action. The
  // operation-level audit trail and undo must nevertheless include the write
  // that already landed under version 1. Reading or reversing only the current
  // plan would silently forget the first half of a multi-turn instruction.
  const partialContinuation = mustOk(await claimAgentOperation({
    userId,
    deliveryKey: `telegram:m0:partial-answer:${randomUUID()}`,
    channel: "telegram",
    chatId: "m0-probe",
    rootMessageId: "",
    requestText: "El segundo gasto fue de 4 dólares",
    continuationOperationId: partial.claimed.id,
    expectedOperationVersions: {
      [partial.claimed.id]: partialAwaiting.stateVersion,
    },
  }), "partial continuation claim");
  // Make the app clock one day older than PostgreSQL. Rows timestamped by the
  // DB must remain visible; otherwise a host-clock skew erases the user's
  // clarification from its still-open operation.
  const partialAuthorityRead = await withProcessClockOffset(
    -24 * 60 * 60 * 1000,
    () => readOpenAgentOperations(userId),
  );
  const partialAuthorityOperation = partialAuthorityRead.ok
    ? partialAuthorityRead.operations.find(
        (operation) => operation.id === partial.claimed.id,
      ) ?? null
    : null;
  check(
    "M100.8ab · cada aclaración de usuario queda ligada a la operación y vuelve como autoridad de entidad completa",
    partialAuthorityRead.ok &&
      partialAuthorityRead.complete &&
      partialAuthorityOperation?.authorityMessages.includes(
        "Registra dos gastos independientes; del segundo todavía falta el monto",
      ) === true &&
      partialAuthorityOperation.authorityMessages.includes(
        "El segundo gasto fue de 4 dólares",
      ),
    JSON.stringify({ partialAuthorityRead, partialAuthorityOperation }),
  );
  const continuedAction = {
    ...partialActions[1],
    arguments: { ...partialActions[1].arguments, amount: 4 },
  };
  // A planner may persist contextual memory beside the financial completion.
  // It is a real durable write, but it is not a ledger event and therefore has
  // no transaction receipt. Operation undo must derive its target set from the
  // persisted economic algebra, not from the generic word `write`.
  const continuedContextAction = {
    id: "remember-partial-context",
    capability: "remember_fact",
    arguments: { fact: "El segundo gasto fue aclarado por el usuario" },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [{
      owner: "user",
      surface: "memory",
      direction: "increase",
      amount_source: "not_monetary",
      classification: "memory",
      entity_ref: `user:${userId}`,
    }],
    postconditions: [],
  };
  const repeatedSettledPlan = await saveAgentOperationPlan({
    userId,
    operationId: partial.claimed.id,
    expectedVersion: partialContinuation.stateVersion,
    plan: plan([{
      ...partialActions[0],
      id: "renamed-settled-expense",
      arguments: Object.fromEntries(
        Object.entries(partialActions[0].arguments).reverse(),
      ),
    }], "Wrongly repeat the already-settled first expense"),
    coverage,
    missingFields: [],
    pendingQuestion: null,
    leaseToken: partialContinuation.leaseToken,
  });
  check(
    "M100.8aa · PostgreSQL rehúsa repetir un efecto ya aterrizado aunque cambien el id del paso y el orden JSON",
    !repeatedSettledPlan.ok &&
      repeatedSettledPlan.reason.includes("already-settled side effect"),
    JSON.stringify(repeatedSettledPlan),
  );
  const continuedPlan = mustOk(await saveAgentOperationPlan({
    userId,
    operationId: partial.claimed.id,
    expectedVersion: partialContinuation.stateVersion,
    plan: plan(
      [continuedAction, continuedContextAction],
      "Complete only the still-pending second expense and retain its context",
    ),
    coverage,
    missingFields: [],
    pendingQuestion: null,
    leaseToken: partialContinuation.leaseToken,
  }), "partial continuation plan");
  const continuedLease = mustOk(await beginAgentOperationApplication({
    userId,
    operationId: partial.claimed.id,
    expectedVersion: continuedPlan.stateVersion,
  }), "partial continuation lease");
  const continuedTransaction = must(await admin.rpc("kipu_apply_ledger_entry", {
    p_entry: {
      user_id: userId,
      type: "expense",
      effect_type: "expense",
      sign: 1,
      description: "Paso pendiente completado",
      category: "other",
      original_amount: 4,
      original_currency: "USD",
      exchange_rate_to_base: 1,
      base_amount: 4,
      base_currency: "USD",
      source_account_id: partialAccount.id,
      raw_input: "segundo gasto completado M0",
      input_channel: "telegram",
      dedupe_key: `m0-partial-continuation:${partial.claimed.id}`,
    },
  }), "partial continuation write");
  mustOk(await recordAgentOperationStepOutcome({
    userId,
    operationId: partial.claimed.id,
    stepKey: continuedAction.id,
    capability: continuedAction.capability,
    arguments: continuedAction.arguments,
    toolStatus: "done",
    executionEffect: "write",
    result: { transactionId: String(continuedTransaction) },
    affectedRefs: [{ type: "transaction", id: String(continuedTransaction) }],
    leaseToken: continuedLease.leaseToken,
  }), "partial continuation receipt");
  mustOk(await recordAgentOperationStepOutcome({
    userId,
    operationId: partial.claimed.id,
    stepKey: continuedContextAction.id,
    capability: continuedContextAction.capability,
    arguments: continuedContextAction.arguments,
    toolStatus: "done",
    executionEffect: "write",
    result: { memoryKey: "partial-context" },
    affectedRefs: [{ type: "entity", id: "partial-context" }],
    leaseToken: continuedLease.leaseToken,
  }), "partial non-financial context receipt");
  await completeOperation({
    userId,
    operationId: partial.claimed.id,
    lease: continuedLease,
    result: { reply: "Los dos gastos quedaron registrados" },
  });

  const completedPartialRead = await readRecentCompletedAgentOperations(userId, 20);
  const completedPartial = completedPartialRead.operations.find(
    (operation) => operation.id === partial.claimed.id,
  );
  const partialUndoAction = {
    id: "undo-partial-multiversion",
    capability: "undo_agent_operation",
    arguments: { targetOperationId: partial.claimed.id },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [effect("cash", "increase", "other", account.id)],
    postconditions: [],
  };
  const partialUndo = await claimAndSave({
    userId,
    key: `telegram:m0:partial-undo:${randomUUID()}`,
    text: "Deshaz los dos gastos de esa operación",
    actions: [partialUndoAction],
  });
  const partialUndoLease = mustOk(await beginAgentOperationApplication({
    userId,
    operationId: partialUndo.claimed.id,
    expectedVersion: partialUndo.saved.stateVersion,
  }), "partial multiversion undo lease");
  const partialUndoResult = mustOk(await reverseAgentOperation({
    userId,
    reversalOperationId: partialUndo.claimed.id,
    targetOperationId: partial.claimed.id,
    stepKey: partialUndoAction.id,
    leaseToken: partialUndoLease.leaseToken,
    message: "deshaz los dos gastos",
    channel: "telegram",
  }), "partial multiversion undo");
  await completeOperation({
    userId,
    operationId: partialUndo.claimed.id,
    lease: partialUndoLease,
    result: { reply: "Operación deshecha" },
  });
  const [primaryAfterPartialUndo, secondaryAfterPartialUndo, partialUndoMarker] = await Promise.all([
    admin.from("accounts").select("current_balance_original").eq("id", account.id).single(),
    admin.from("accounts").select("current_balance_original").eq("id", partialAccount.id).single(),
    admin.from("agent_operation_reversals").select("transaction_ids").eq("reversal_operation_id", partialUndo.claimed.id).single(),
  ]);
  check(
    "M100.8b · continuación multivuelta conserva versiones y el undo revierte todo el dinero sin exigir transacción a memoria",
    completedPartialRead.ok && completedPartialRead.complete &&
      completedPartial?.steps.length === 4 &&
      completedPartial.steps.map((step) => `${step.planVersion}:${step.stepKey}:${step.status}`).join(",") ===
        "1:independent-expense:verified,1:blocked-expense:needs_input,2:blocked-expense:verified,2:remember-partial-context:verified" &&
      !partialUndoResult.replayed &&
      must(partialUndoMarker, "partial undo marker").transaction_ids.length === 2 &&
      money(must(primaryAfterPartialUndo, "primary after partial undo").current_balance_original) === primaryBeforePartial &&
      money(must(secondaryAfterPartialUndo, "secondary after partial undo").current_balance_original) === 50,
    JSON.stringify({ completedPartialRead, completedPartial, partialUndoResult, partialUndoMarker: partialUndoMarker.data, primaryAfterPartialUndo: primaryAfterPartialUndo.data, secondaryAfterPartialUndo: secondaryAfterPartialUndo.data }),
  );

  // The inverse half of the same contract: changing the declared algebra to a
  // financial event must restore the receipt requirement. A corrupt/legacy
  // completed step cannot use the domain-write exception to authorize a
  // partial or fabricated undo.
  const unlinkedMoneyAction = {
    id: "unlinked-money",
    capability: "log_movement",
    arguments: {
      type: "expense",
      amount: 9,
      sourceAccountId: account.id,
      description: "Receipt faltante M0",
    },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [
      effect("cash", "decrease", "expense", account.id),
      effect("expense_recognition", "increase", "expense", account.id),
    ],
    postconditions: [],
  };
  const unlinkedMoney = await claimAndSave({
    userId,
    key: `telegram:m0:unlinked-money:${randomUUID()}`,
    text: "Fixture de write financiero sin recibo",
    actions: [unlinkedMoneyAction],
  });
  const unlinkedMoneyLease = mustOk(await beginAgentOperationApplication({
    userId,
    operationId: unlinkedMoney.claimed.id,
    expectedVersion: unlinkedMoney.saved.stateVersion,
  }), "unlinked money lease");
  mustOk(await recordAgentOperationStepOutcome({
    userId,
    operationId: unlinkedMoney.claimed.id,
    stepKey: unlinkedMoneyAction.id,
    capability: unlinkedMoneyAction.capability,
    arguments: unlinkedMoneyAction.arguments,
    toolStatus: "done",
    executionEffect: "write",
    result: { summary: "fixture sin transaction id" },
    affectedRefs: [{ type: "account", id: account.id }],
    leaseToken: unlinkedMoneyLease.leaseToken,
  }), "unlinked money corrupt receipt");
  await completeOperation({
    userId,
    operationId: unlinkedMoney.claimed.id,
    lease: unlinkedMoneyLease,
    result: { reply: "fixture completado" },
  });
  const rejectUnlinkedAction = {
    id: "reject-unlinked-money",
    capability: "undo_agent_operation",
    arguments: { targetOperationId: unlinkedMoney.claimed.id },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [effect("cash", "increase", "reversal", account.id)],
    postconditions: [],
  };
  const rejectUnlinked = await claimAndSave({
    userId,
    key: `telegram:m0:reject-unlinked:${randomUUID()}`,
    text: "Deshaz el write sin recibo",
    actions: [rejectUnlinkedAction],
  });
  const rejectUnlinkedLease = mustOk(await beginAgentOperationApplication({
    userId,
    operationId: rejectUnlinked.claimed.id,
    expectedVersion: rejectUnlinked.saved.stateVersion,
  }), "reject unlinked lease");
  const rejectedUnlinkedResult = await reverseAgentOperation({
    userId,
    reversalOperationId: rejectUnlinked.claimed.id,
    targetOperationId: unlinkedMoney.claimed.id,
    stepKey: rejectUnlinkedAction.id,
    leaseToken: rejectUnlinkedLease.leaseToken,
    message: "Deshaz el write sin recibo",
    channel: "telegram",
  });
  check(
    "M100.8c · un write económico sin transacción sigue siendo irreversible y rehúsa todo el undo",
    !rejectedUnlinkedResult.ok && rejectedUnlinkedResult.reason === "unsafe",
    JSON.stringify(rejectedUnlinkedResult),
  );
  const inverseA = await claimAndSave({
    userId,
    key: `telegram:m0:inverse-a:${randomUUID()}`,
    text: "Trabajo A pendiente",
    actions: [],
    missing: [{ key: "a", reason: "falta A", applies_to: ["$response"], answer_shape: "A" }],
    question: "¿Cuál es A?",
  });
  const inverseB = await claimAndSave({
    userId,
    key: `web:m0:inverse-b:${randomUUID()}`,
    text: "Trabajo B pendiente",
    actions: [],
    missing: [{ key: "b", reason: "falta B", applies_to: ["$response"], answer_shape: "B" }],
    question: "¿Cuál es B?",
  });
  const inverseClosures = await Promise.all([
    claimAgentOperation({
      userId,
      deliveryKey: `telegram:m0:inverse-answer-a:${randomUUID()}`,
      channel: "telegram",
      chatId: "m0-probe",
      rootMessageId: "",
      requestText: "Continúa A y reemplaza B",
      continuationOperationId: inverseA.claimed.id,
      supersedeOperationIds: [inverseB.claimed.id],
      expectedOperationVersions: {
        [inverseA.claimed.id]: inverseA.saved.stateVersion,
        [inverseB.claimed.id]: inverseB.saved.stateVersion,
      },
    }),
    claimAgentOperation({
      userId,
      deliveryKey: `web:m0:inverse-answer-b:${randomUUID()}`,
      channel: "web",
      chatId: "m0-web",
      rootMessageId: "",
      requestText: "Continúa B y reemplaza A",
      continuationOperationId: inverseB.claimed.id,
      supersedeOperationIds: [inverseA.claimed.id],
      expectedOperationVersions: {
        [inverseB.claimed.id]: inverseB.saved.stateVersion,
        [inverseA.claimed.id]: inverseA.saved.stateVersion,
      },
    }),
  ]);
  check(
    "M100.8b · continuaciones cruzadas toman el mismo orden de locks: una gana y no hay deadlock",
    inverseClosures.filter((row) => row.ok && row.outcome === "resumed").length === 1 &&
      inverseClosures.filter((row) => !row.ok).length === 1,
    JSON.stringify(inverseClosures),
  );

  const expiring = await claimAndSave({
    userId,
    key: `web:m0:expires:${randomUUID()}`,
    text: "Consulta pendiente que ya caducó",
    actions: [],
  });
  mustOk(await transitionAgentOperation({
    userId,
    operationId: expiring.claimed.id,
    expectedVersion: expiring.saved.stateVersion,
    status: "ready",
    expiresAt: "2026-01-01T00:00:00.000Z",
  }), "expire fixture");
  const expiredCount = await expireAgentOperations(userId);
  const expiredRow = must(await admin.from("agent_operations")
    .select("status").eq("id", expiring.claimed.id).single(), "expired row");
  check(
    "M100.8g · una operación sin respuesta caduca y deja de alimentar loops futuros",
    expiredCount >= 1 && expiredRow.status === "expired",
    JSON.stringify({ expiredCount, expiredRow }),
  );

  const abandoned = await claimAndSave({
    userId,
    key: `telegram:m0:abandon-target:${randomUUID()}`,
    text: "Trabajo que el usuario cancelará",
    actions: [],
    missing: [{ key: "cancel-me", reason: "espera", applies_to: ["$response"], answer_shape: "dato" }],
    question: "¿Quieres completar este trabajo?",
  });
  const abandonment = mustOk(await claimAgentOperation({
    userId,
    deliveryKey: `telegram:m0:abandon-command:${randomUUID()}`,
    channel: "telegram",
    chatId: "m0-probe",
    rootMessageId: "",
    requestText: "Olvida esa operación; ya no quiero hacerla",
    abandonOperationIds: [abandoned.claimed.id],
    expectedOperationVersions: {
      [abandoned.claimed.id]: abandoned.saved.stateVersion,
    },
  }), "abandon operation");
  const abandonedRow = must(await admin.from("agent_operations")
    .select("status,pending_question").eq("id", abandoned.claimed.id).single(), "abandoned row");
  check(
    "M100.8d · abandono explícito mata el trabajo viejo y su pregunta, sin reanudarlo",
    abandonment.outcome === "claimed" && abandonedRow.status === "abandoned" && abandonedRow.pending_question === null,
    JSON.stringify({ abandonment, abandonedRow }),
  );

  const oversizedClaim = mustOk(await claimAgentOperation({
    userId,
    deliveryKey: `web:m0:oversized:${randomUUID()}`,
    channel: "web",
    chatId: "m0-web",
    rootMessageId: "",
    requestText: "Plan imposible de 25 pasos",
  }), "oversized claim");
  const oversized = await saveAgentOperationPlan({
    userId,
    operationId: oversizedClaim.id,
    expectedVersion: oversizedClaim.stateVersion,
    plan: plan(Array.from({ length: 25 }, (_, index) => ({
      id: `too-many-${index}`,
      capability: "get_financial_context",
      arguments: {},
      atomic_group: null,
      depends_on: [],
      state_witness: {},
      effects: [],
      postconditions: [],
    }))),
    coverage,
    missingFields: [],
    pendingQuestion: null,
    leaseToken: oversizedClaim.leaseToken,
  });
  check(
    "M100.8e · PostgreSQL también rehúsa un plan que excede el límite del planner",
    !oversized.ok,
    JSON.stringify(oversized),
  );

  const roots = must(await admin.from("chat_messages").insert([
    { user_id: userId, channel: "web", chat_id: "m0-web", role: "user", content: "Mismo texto", message_type: "chat" },
    { user_id: userId, channel: "web", chat_id: "m0-web", role: "user", content: "Mismo texto", message_type: "chat" },
  ]).select("id"), "root messages");
  const rootedKey = `web:m0:rooted:${randomUUID()}`;
  mustOk(await claimAgentOperation({
    userId,
    deliveryKey: rootedKey,
    channel: "web",
    chatId: "m0-web",
    rootMessageId: roots[0].id,
    requestText: "Mismo texto",
  }), "rooted claim");
  const rootMismatch = await claimAgentOperation({
    userId,
    deliveryKey: rootedKey,
    channel: "web",
    chatId: "m0-web",
    rootMessageId: roots[1].id,
    requestText: "Mismo texto",
  });
  check(
    "M100.8f · una delivery key no puede reaparecer ligada a otro turno persistido aunque el texto coincida",
    !rootMismatch.ok && /DEDUPE_MISMATCH/i.test(rootMismatch.reason),
    JSON.stringify(rootMismatch),
  );

  // Debt proceeds: cash up + user's liability up. Exact replay is allowed;
  // divergent replay and generic half-undo are rejected.
  const debtAction = {
    id: "borrowed-in",
    capability: "record_person_payment",
    arguments: { direction: "in", inflowKind: "borrowed", person: "Alpaca", accountId: account.id, debtAccountId: loan.id, amount: 83.86 },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [effect("cash", "increase", "debt_proceeds", account.id), effect("debt_liability", "increase", "debt_proceeds", loan.id)],
    postconditions: [],
  };
  const debtOperation = await claimAndSave({
    userId,
    key: `telegram:m0:debt:${randomUUID()}`,
    text: "Alpaca me prestó 83.86 y entró a Produbanco",
    actions: [debtAction],
  });
  const debtLease = mustOk(await beginAgentOperationApplication({ userId, operationId: debtOperation.claimed.id, expectedVersion: debtOperation.saved.stateVersion }), "debt lease");
  const debtInput = {
    userId,
    operationId: debtOperation.claimed.id,
    leaseToken: debtLease.leaseToken,
    stepKey: debtAction.id,
    dedupeKey: `agent-operation:${debtOperation.claimed.id}:${debtAction.id}`,
    accountId: account.id,
    debtAccountId: loan.id,
    amount: 83.86,
    originalCurrency: "USD",
    exchangeRateToBase: 1,
    baseCurrency: "USD",
    occurredAtISO: "2026-07-31T12:00:00.000Z",
    rawInput: "Alpaca me prestó 83.86 y entró a Produbanco",
    inputChannel: "chat",
  };
  const debtApplied = mustOk(await applyDebtProceeds(debtInput), "debt proceeds");
  const debtReplay = mustOk(await applyDebtProceeds(debtInput), "debt proceeds replay");
  const debtDivergent = await applyDebtProceeds({ ...debtInput, amount: 84 });
  const marker = must(await admin.from("debt_proceeds_applications").select("*").eq("operation_id", debtOperation.claimed.id).single(), "debt marker");
  check(
    "M100.9 · fondos prestados aterrizan las dos patas y su identidad durable",
    !debtApplied.replayed && debtReplay.replayed && !debtDivergent.ok && debtDivergent.reason === "unsafe" && marker.dedupe_key === debtInput.dedupeKey,
    JSON.stringify({ debtApplied, debtReplay, debtDivergent, marker }),
  );
  const beforeDebtUndo = await Promise.all([
    admin.from("accounts").select("current_balance_original").eq("id", account.id).single(),
    admin.from("debt_accounts").select("current_balance_original").eq("id", loan.id).single(),
  ]);
  const genericHalfUndo = await admin.rpc("kipu_reverse_financial_operation", {
    p: { user_id: userId, transaction_id: debtApplied.transactionId, raw_input: "undo", input_channel: "chat", occurred_at: new Date().toISOString() },
  });
  check(
    "M100.10 · el undo genérico no puede revertir sólo la caja de fondos prestados",
    !!genericHalfUndo.error,
    genericHalfUndo.error?.message ?? "",
  );
  const debtUndo = must(await admin.rpc("kipu_reverse_financial_operation_v3", {
    p: { user_id: userId, transaction_id: debtApplied.transactionId, raw_input: "undo", input_channel: "chat", occurred_at: new Date().toISOString() },
  }), "debt two-leg undo");
  const afterDebtUndo = await Promise.all([
    admin.from("accounts").select("current_balance_original").eq("id", account.id).single(),
    admin.from("debt_accounts").select("current_balance_original").eq("id", loan.id).single(),
  ]);
  check(
    "M100.11 · el dispatcher v3 revierte caja y obligación juntas",
    debtUndo.outcome === "reversed_debt_proceeds" &&
      money(must(afterDebtUndo[0], "account after debt undo").current_balance_original) === money(must(beforeDebtUndo[0], "account before debt undo").current_balance_original) - 83.86 &&
      money(must(afterDebtUndo[1], "loan after debt undo").current_balance_original) === money(must(beforeDebtUndo[1], "loan before debt undo").current_balance_original) - 83.86,
    JSON.stringify(debtUndo),
  );

  // Whole-operation undo derives all four target transaction ids from verified
  // receipts and reverses them in one DB transaction.
  const undoAction = {
    id: "undo-founder",
    capability: "undo_agent_operation",
    arguments: { targetOperationId: founder.claimed.id },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [effect("cash", "increase", "other", account.id)],
    postconditions: [],
  };
  const undoOperation = await claimAndSave({
    userId,
    key: `telegram:m0:undo-op:${randomUUID()}`,
    text: "Lo que te dije antes estaba mal; deshaz toda esa operación",
    actions: [undoAction],
  });
  const undoLease = mustOk(await beginAgentOperationApplication({ userId, operationId: undoOperation.claimed.id, expectedVersion: undoOperation.saved.stateVersion }), "undo operation lease");
  const founderUndoBalanceBefore = money(must(
    await admin.from("accounts").select("current_balance_original")
      .eq("id", account.id).single(),
    "founder undo balance before",
  ).current_balance_original);
  const operationUndo = mustOk(await reverseAgentOperation({
    userId,
    reversalOperationId: undoOperation.claimed.id,
    targetOperationId: founder.claimed.id,
    stepKey: undoAction.id,
    leaseToken: undoLease.leaseToken,
    message: "deshaz la operación",
    channel: "telegram",
  }), "operation undo");
  const operationUndoReplay = mustOk(await reverseAgentOperation({
    userId,
    reversalOperationId: undoOperation.claimed.id,
    targetOperationId: founder.claimed.id,
    stepKey: undoAction.id,
    leaseToken: undoLease.leaseToken,
    message: "deshaz la operación",
    channel: "telegram",
  }), "operation undo replay");
  const undoState = await Promise.all([
    admin.from("accounts").select("current_balance_original").eq("id", account.id).single(),
    admin.from("debt_accounts").select("id,current_balance_original,full_payment_due").in("id", cards.map((card) => card.id)),
    admin.from("agent_operation_reversals").select("id,transaction_ids").eq("reversal_operation_id", undoOperation.claimed.id).single(),
  ]);
  check(
    "M100.12 · una corrección de operación deshace las cuatro patas, no una fila aislada",
    !operationUndo.replayed && operationUndoReplay.replayed &&
      money(must(undoState[0], "undo account").current_balance_original) ===
        money(founderUndoBalanceBefore - founderCashDelta) &&
      must(undoState[1], "undo cards").every((card) => {
        const original = cards.find((candidate) => candidate.id === card.id);
        return !!original && money(card.current_balance_original) === money(original.current_balance_original) && money(card.full_payment_due) === money(original.full_payment_due);
      }) &&
      must(undoState[2], "undo marker").transaction_ids.length === 4,
    JSON.stringify({
      operationUndo,
      operationUndoReplay,
      founderBalanceBeforeApply,
      founderCashDelta,
      founderUndoBalanceBefore,
      undoState,
    }),
  );
  const undoWrongTarget = await reverseAgentOperation({
    userId,
    reversalOperationId: undoOperation.claimed.id,
    targetOperationId: debtOperation.claimed.id,
    stepKey: undoAction.id,
    leaseToken: undoLease.leaseToken,
    message: "otro target",
    channel: "telegram",
  });
  check(
    "M100.13 · replay de undo con otro target se rehúsa",
    !undoWrongTarget.ok && undoWrongTarget.reason === "unsafe",
    JSON.stringify(undoWrongTarget),
  );
  await completeOperation({ userId, operationId: undoOperation.claimed.id, lease: undoLease, result: { reply: "undo completo" } });

  // `log_movements_batch` legitimately writes up to 15 rows.  The first M0
  // draft capped operation undo at 10, so a successful batch became impossible
  // to correct as the one operation the user had asked for. Exercise the real
  // PostgreSQL boundary with all 15 receipts, not a source-only constant.
  const wideMovements = Array.from({ length: 15 }, (_, index) => ({
    type: "expense",
    amount: 1,
    currency: "USD",
    sourceAccountId: account.id,
    description: `Compra M0 ${index + 1}`,
  }));
  const wideAction = {
    id: "wide-batch",
    capability: "log_movements_batch",
    arguments: { movements: wideMovements },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [
      effect("cash", "decrease", "expense", account.id),
      effect("expense_recognition", "increase", "expense", account.id),
    ],
    postconditions: [],
  };
  const wideOperation = await claimAndSave({
    userId,
    key: `telegram:m0:wide-batch:${randomUUID()}`,
    text: "Registra estas quince compras como un solo lote",
    actions: [wideAction],
  });
  const wideLease = mustOk(await beginAgentOperationApplication({
    userId,
    operationId: wideOperation.claimed.id,
    expectedVersion: wideOperation.saved.stateVersion,
  }), "wide batch lease");
  const wideBefore = money(must(await admin.from("accounts")
    .select("current_balance_original").eq("id", account.id).single(), "wide before")
    .current_balance_original);
  const wideTransactionIds = [];
  for (let index = 0; index < wideMovements.length; index += 1) {
    const transactionId = must(await admin.rpc("kipu_apply_ledger_entry", {
      p_entry: {
        user_id: userId,
        type: "expense",
        effect_type: "expense",
        sign: 1,
        description: wideMovements[index].description,
        category: "other",
        original_amount: 1,
        original_currency: "USD",
        exchange_rate_to_base: 1,
        base_amount: 1,
        base_currency: "USD",
        source_account_id: account.id,
        raw_input: "lote de quince compras M0",
        input_channel: "chat",
        dedupe_key: `m0-wide:${wideOperation.claimed.id}:${index}`,
      },
    }), `wide ledger row ${index + 1}`);
    wideTransactionIds.push(String(transactionId));
  }
  mustOk(await recordAgentOperationStepOutcome({
    userId,
    operationId: wideOperation.claimed.id,
    stepKey: wideAction.id,
    capability: wideAction.capability,
    arguments: wideAction.arguments,
    toolStatus: "done",
    executionEffect: "write",
    result: { transactionIds: wideTransactionIds },
    affectedRefs: wideTransactionIds.map((id) => ({ type: "transaction", id })),
    leaseToken: wideLease.leaseToken,
  }), "wide batch receipt");
  await completeOperation({
    userId,
    operationId: wideOperation.claimed.id,
    lease: wideLease,
    result: { reply: "lote completo" },
  });
  const wideUndoAction = {
    id: "undo-wide-batch",
    capability: "undo_agent_operation",
    arguments: { targetOperationId: wideOperation.claimed.id },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [effect("cash", "increase", "other", account.id)],
    postconditions: [],
  };
  const wideUndoOperation = await claimAndSave({
    userId,
    key: `telegram:m0:undo-wide-batch:${randomUUID()}`,
    text: "Deshaz todo ese lote",
    actions: [wideUndoAction],
  });
  const wideUndoLease = mustOk(await beginAgentOperationApplication({
    userId,
    operationId: wideUndoOperation.claimed.id,
    expectedVersion: wideUndoOperation.saved.stateVersion,
  }), "wide undo lease");
  const wideUndo = mustOk(await reverseAgentOperation({
    userId,
    reversalOperationId: wideUndoOperation.claimed.id,
    targetOperationId: wideOperation.claimed.id,
    stepKey: wideUndoAction.id,
    leaseToken: wideUndoLease.leaseToken,
    message: "deshaz el lote",
    channel: "telegram",
  }), "wide operation undo");
  const [wideAfterWrite, wideAfterUndo, wideUndoMarker] = await Promise.all([
    // The applied rows remain durable evidence even after their reversals.
    admin.from("transactions").select("id", { count: "exact" })
      .eq("user_id", userId).in("id", wideTransactionIds),
    admin.from("accounts").select("current_balance_original")
      .eq("id", account.id).single(),
    admin.from("agent_operation_reversals").select("transaction_ids")
      .eq("reversal_operation_id", wideUndoOperation.claimed.id).single(),
  ]);
  check(
    "M100.13a · un lote válido de quince filas sigue siendo reversible como una sola operación",
    !wideUndo.replayed && !wideAfterWrite.error && wideAfterWrite.count === 15 &&
      money(must(wideAfterUndo, "wide after undo").current_balance_original) === wideBefore &&
      must(wideUndoMarker, "wide undo marker").transaction_ids.length === 15,
    JSON.stringify({ wideUndo, wideAfterWrite, wideAfterUndo, wideUndoMarker }),
  );
  await completeOperation({
    userId,
    operationId: wideUndoOperation.claimed.id,
    lease: wideUndoLease,
    result: { reply: "lote deshecho" },
  });

  // A normal one-tool operation uses the TypeScript receipt adapter, not the
  // SQL atomic coordinator. It must still expose `type=transaction` or the
  // universal undo would work only for grouped fixtures.
  const singleAction = {
    id: "single-expense",
    capability: "log_movement",
    arguments: {
      type: "expense",
      amount: 7,
      currency: "USD",
      sourceAccountId: account.id,
      description: "Compra individual M0",
    },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [
      effect("cash", "decrease", "expense", account.id),
      effect("expense_recognition", "increase", "expense", account.id),
    ],
    postconditions: [],
  };
  const singleOperation = await claimAndSave({
    userId,
    key: `telegram:m0:single:${randomUUID()}`,
    text: "Gasté 7 desde Produbanco",
    actions: [singleAction],
  });
  const singleLease = mustOk(await beginAgentOperationApplication({
    userId,
    operationId: singleOperation.claimed.id,
    expectedVersion: singleOperation.saved.stateVersion,
  }), "single operation lease");
  const singleBalanceBefore = money(must(
    await admin.from("accounts").select("current_balance_original")
      .eq("id", account.id).single(),
    "single balance before",
  ).current_balance_original);
  const singleTransaction = must(await admin.rpc("kipu_apply_ledger_entry", {
    p_entry: {
      user_id: userId,
      type: "expense",
      effect_type: "expense",
      sign: 1,
      description: "Compra individual M0",
      category: "other",
      original_amount: 7,
      original_currency: "USD",
      exchange_rate_to_base: 1,
      base_amount: 7,
      base_currency: "USD",
      source_account_id: account.id,
      raw_input: "Gasté 7 desde Produbanco",
      input_channel: "chat",
      dedupe_key: `m0-single:${singleOperation.claimed.id}`,
    },
  }), "single ledger write");
  const singleRefs = agentAffectedRefsFromResult({
    transactionId: String(singleTransaction),
    accountId: account.id,
  });
  mustOk(await recordAgentOperationStepOutcome({
    userId,
    operationId: singleOperation.claimed.id,
    stepKey: singleAction.id,
    capability: singleAction.capability,
    arguments: singleAction.arguments,
    toolStatus: "done",
    executionEffect: "write",
    result: { transactionId: String(singleTransaction) },
    affectedRefs: singleRefs,
    leaseToken: singleLease.leaseToken,
  }), "single receipt");
  await completeOperation({
    userId,
    operationId: singleOperation.claimed.id,
    lease: singleLease,
    result: { reply: "compra individual registrada" },
  });
  const singleUndoAction = {
    id: "undo-single",
    capability: "undo_agent_operation",
    arguments: { targetOperationId: singleOperation.claimed.id },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [effect("cash", "increase", "other", account.id)],
    postconditions: [],
  };
  const singleUndo = await claimAndSave({
    userId,
    key: `telegram:m0:undo-single:${randomUUID()}`,
    text: "Deshaz esa compra",
    actions: [singleUndoAction],
  });
  const singleUndoLease = mustOk(await beginAgentOperationApplication({
    userId,
    operationId: singleUndo.claimed.id,
    expectedVersion: singleUndo.saved.stateVersion,
  }), "single undo lease");
  const singleUndoResult = mustOk(await reverseAgentOperation({
    userId,
    reversalOperationId: singleUndo.claimed.id,
    targetOperationId: singleOperation.claimed.id,
    stepKey: singleUndoAction.id,
    leaseToken: singleUndoLease.leaseToken,
    message: "Deshaz esa compra",
    channel: "telegram",
  }), "single operation undo");
  const singleBalance = must(await admin.from("accounts")
    .select("current_balance_original").eq("id", account.id).single(), "single undo balance");
  check(
    "M100.13b · un write individual guarda recibo tipado y también admite undo completo",
    !singleUndoResult.replayed &&
      singleRefs.some((ref) => ref.type === "transaction" && ref.id === String(singleTransaction)) &&
      money(singleBalance.current_balance_original) === singleBalanceBefore,
    JSON.stringify({ singleBalanceBefore, singleRefs, singleUndoResult, singleBalance }),
  );

  // Universal fact ↔ occurrence satisfaction. A statement fact answers the
  // monthly Diners occurrence even if legacy status remains pending.
  const statementCard = must(
    await admin.from("debt_accounts").insert({ user_id: userId, name: "Diners Fact M0", type: "credit_card", currency: "USD", current_balance_original: 50.6, current_balance_base: 50.6, full_payment_due: 50.6, statement_total_due: 50.6, statement_covered: false }).select("id").single(),
    "statement card",
  );
  const statementOccurrence = must(
    await admin.from("recurring_occurrences").insert({ user_id: userId, debt_account_id: statementCard.id, occurrence_date: "2026-07-15", kind: "card_statement", mode: "ask", status: "pending", ask_count: 2 }).select("id,satisfied_fact_id").single(),
    "statement occurrence",
  );
  const statementCycle = must(
    await admin.from("debt_statement_cycles").insert({ user_id: userId, debt_account_id: statementCard.id, statement_date: "2026-07-16", full_payment_due: 50.6, due_day: 3, applied: true, is_current: true, reason: "m0-probe" }).select("id").single(),
    "statement cycle",
  );
  const statementSatisfied = must(
    await admin.from("recurring_occurrences").select("status,satisfied_fact_id,satisfied_at").eq("id", statementOccurrence.id).single(),
    "statement satisfied",
  );
  const openAfterFact = await readOpenOccurrences(userId);
  check(
    "M100.14 · el corte durable satisface Diners por entidad+ciclo y no vuelve al open set",
    statementOccurrence.satisfied_fact_id == null && statementSatisfied.status === "pending" && !!statementSatisfied.satisfied_fact_id && openAfterFact.ok && !openAfterFact.occurrences.some((occurrence) => occurrence.id === statementOccurrence.id),
    JSON.stringify({ statementSatisfied, openAfterFact }),
  );
  must(await admin.from("debt_statement_cycles").update({ full_payment_due: 51 }).eq("id", statementCycle.id), "correct statement fact");
  const statementFacts = must(
    await admin.from("financial_facts").select("id,is_current,supersedes_fact_id,superseded_by_fact_id,payload").eq("user_id", userId).eq("fact_kind", "card_statement").eq("entity_id", statementCard.id).order("created_at"),
    "statement facts",
  );
  const linkedAfterCorrection = must(await admin.from("recurring_occurrences").select("satisfied_fact_id").eq("id", statementOccurrence.id).single(), "corrected fact link");
  check(
    "M100.15 · corregir un hecho supersede historia y religa la misma ocurrencia",
    statementFacts.length === 2 && statementFacts.filter((fact) => fact.is_current).length === 1 && statementFacts[0].superseded_by_fact_id === statementFacts[1].id && linkedAfterCorrection.satisfied_fact_id === statementFacts[1].id,
    JSON.stringify(statementFacts),
  );
  const liveStatementFactId = linkedAfterCorrection.satisfied_fact_id;
  must(
    await admin.from("recurring_occurrences")
      .update({
        status: "confirmed",
        resolved_amount: 51,
        resolved_currency: "USD",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", statementOccurrence.id),
    "resolve statement occurrence over durable bank fact",
  );
  const resolvedStatementOccurrence = must(
    await admin.from("recurring_occurrences")
      .select("satisfied_fact_id")
      .eq("id", statementOccurrence.id)
      .single(),
    "resolved statement occurrence fact",
  );
  must(
    await admin.from("recurring_occurrences")
      .update({
        status: "pending",
        resolved_amount: null,
        resolved_currency: null,
        resolved_at: null,
      })
      .eq("id", statementOccurrence.id),
    "reopen statement occurrence over durable bank fact",
  );
  const reopenedStatementOccurrence = must(
    await admin.from("recurring_occurrences")
      .select("status,satisfied_fact_id,satisfied_at")
      .eq("id", statementOccurrence.id)
      .single(),
    "reopened statement occurrence with restored bank fact",
  );
  const restoredStatementFact = must(
    await admin.from("financial_facts")
      .select("id,is_current,superseded_by_fact_id,source_type,payload")
      .eq("id", reopenedStatementOccurrence.satisfied_fact_id)
      .single(),
    "restored bank statement fact",
  );
  const retiredResolutionFact = must(
    await admin.from("financial_facts")
      .select("is_current,source_type")
      .eq("id", resolvedStatementOccurrence.satisfied_fact_id)
      .single(),
    "retired statement resolution fact",
  );
  const openAfterStatementReopen = await readOpenOccurrences(userId);
  check(
    "M100.15a · reabrir una resolución restaura el corte bancario todavía vigente y no repregunta",
    resolvedStatementOccurrence.satisfied_fact_id !== liveStatementFactId &&
      reopenedStatementOccurrence.status === "pending" &&
      reopenedStatementOccurrence.satisfied_fact_id === liveStatementFactId &&
      Boolean(reopenedStatementOccurrence.satisfied_at) &&
      restoredStatementFact.is_current === true &&
      restoredStatementFact.superseded_by_fact_id == null &&
      restoredStatementFact.source_type === "debt_statement_cycle" &&
      money(restoredStatementFact.payload?.amount) === 51 &&
      retiredResolutionFact.is_current === false &&
      retiredResolutionFact.source_type === "recurring_occurrence" &&
      openAfterStatementReopen.ok &&
      !openAfterStatementReopen.occurrences.some(
        (occurrence) => occurrence.id === statementOccurrence.id,
      ),
    JSON.stringify({
      liveStatementFactId,
      resolvedStatementOccurrence,
      reopenedStatementOccurrence,
      restoredStatementFact,
      retiredResolutionFact,
      openAfterStatementReopen,
    }),
  );
  // Resolving the same occurrence again with the same payload must reactivate
  // its retired, deduped resolution fact. A plain "replayed" return here used
  // to leave a terminal row with no current fact/link after undo -> redo.
  must(
    await admin.from("recurring_occurrences")
      .update({
        status: "confirmed",
        resolved_amount: 51,
        resolved_currency: "USD",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", statementOccurrence.id),
    "resolve statement occurrence again with identical evidence",
  );
  const reResolvedStatementOccurrence = must(
    await admin.from("recurring_occurrences")
      .select("status,satisfied_fact_id,satisfied_at")
      .eq("id", statementOccurrence.id)
      .single(),
    "re-resolved statement occurrence",
  );
  const reactivatedResolutionFact = must(
    await admin.from("financial_facts")
      .select("is_current,supersedes_fact_id,superseded_by_fact_id,source_type")
      .eq("id", resolvedStatementOccurrence.satisfied_fact_id)
      .single(),
    "reactivated statement resolution fact",
  );
  const supersededBankFact = must(
    await admin.from("financial_facts")
      .select("is_current,superseded_by_fact_id")
      .eq("id", liveStatementFactId)
      .single(),
    "bank fact superseded after re-resolution",
  );
  const reResolvedAudit = must(
    await admin.from("recurring_occurrence_satisfactions")
      .select("fact_id")
      .eq("occurrence_id", statementOccurrence.id)
      .single(),
    "re-resolved durable satisfaction",
  );
  check(
    "M100.15b · undo→rehacer con evidencia idéntica reactiva el hecho dedupado y religa la ocurrencia",
    reResolvedStatementOccurrence.status === "confirmed" &&
      reResolvedStatementOccurrence.satisfied_fact_id === resolvedStatementOccurrence.satisfied_fact_id &&
      Boolean(reResolvedStatementOccurrence.satisfied_at) &&
      reactivatedResolutionFact.is_current === true &&
      reactivatedResolutionFact.supersedes_fact_id === liveStatementFactId &&
      reactivatedResolutionFact.superseded_by_fact_id == null &&
      reactivatedResolutionFact.source_type === "recurring_occurrence" &&
      supersededBankFact.is_current === false &&
      supersededBankFact.superseded_by_fact_id === resolvedStatementOccurrence.satisfied_fact_id &&
      reResolvedAudit.fact_id === resolvedStatementOccurrence.satisfied_fact_id,
    JSON.stringify({
      reResolvedStatementOccurrence,
      reactivatedResolutionFact,
      supersededBankFact,
      reResolvedAudit,
    }),
  );

  // Fact-first order: an occurrence created after its statement fact attaches
  // immediately. This closes either transaction order without a healer cron.
  const factFirstCard = must(await admin.from("debt_accounts").insert({ user_id: userId, name: "Fact First M0", type: "credit_card", currency: "USD", current_balance_original: 20, current_balance_base: 20, full_payment_due: 20, statement_total_due: 20, statement_covered: false }).select("id").single(), "fact-first card");
  must(await admin.from("debt_statement_cycles").insert({ user_id: userId, debt_account_id: factFirstCard.id, statement_date: "2026-08-16", full_payment_due: 20, due_day: 3, applied: true, is_current: true, reason: "m0-probe" }), "fact-first cycle");
  const factFirstOccurrence = must(await admin.from("recurring_occurrences").insert({ user_id: userId, debt_account_id: factFirstCard.id, occurrence_date: "2026-08-15", kind: "card_statement", mode: "ask", status: "pending" }).select("id,satisfied_fact_id").single(), "fact-first occurrence");
  const factFirstLink = must(await admin.from("recurring_occurrence_satisfactions").select("fact_id").eq("occurrence_id", factFirstOccurrence.id).single(), "fact-first durable link");
  check(
    "M100.16 · el orden fact→occurrence también queda satisfecho con vínculo durable",
    !!factFirstOccurrence.satisfied_fact_id && factFirstLink.fact_id === factFirstOccurrence.satisfied_fact_id,
    JSON.stringify({ factFirstOccurrence, factFirstLink }),
  );
  const movedFactFirst = must(
    await admin.from("recurring_occurrences")
      .update({ occurrence_date: "2026-09-15" })
      .eq("id", factFirstOccurrence.id)
      .select("satisfied_fact_id")
      .single(),
    "move satisfied occurrence to unmatched cycle",
  );
  const movedLinkRead = await admin.from("recurring_occurrence_satisfactions")
    .select("id", { count: "exact", head: true })
    .eq("occurrence_id", factFirstOccurrence.id);
  if (movedLinkRead.error || movedLinkRead.count == null) {
    throw new Error(`moved occurrence link count: ${movedLinkRead.error?.message ?? "count unavailable"}`);
  }
  const restoredFactFirst = must(
    await admin.from("recurring_occurrences")
      .update({ occurrence_date: "2026-08-15" })
      .eq("id", factFirstOccurrence.id)
      .select("satisfied_fact_id")
      .single(),
    "restore satisfied occurrence cycle",
  );
  const restoredFactFirstLink = must(
    await admin.from("recurring_occurrence_satisfactions")
      .select("fact_id")
      .eq("occurrence_id", factFirstOccurrence.id)
      .single(),
    "restored occurrence durable link",
  );
  check(
    "M100.16a · cambiar la identidad retira el vínculo viejo y restaurarla vuelve a enlazar el hecho correcto",
    movedFactFirst.satisfied_fact_id == null &&
      movedLinkRead.count === 0 &&
      restoredFactFirst.satisfied_fact_id === factFirstOccurrence.satisfied_fact_id &&
      restoredFactFirstLink.fact_id === factFirstOccurrence.satisfied_fact_id,
    JSON.stringify({ movedFactFirst, movedLinkCount: movedLinkRead.count, restoredFactFirst, restoredFactFirstLink }),
  );

  // Race both orders over independent identities. The occurrence trigger and
  // fact writer share one advisory identity lock, so neither transaction can
  // commit after observing a stale absence. Promise.all uses separate HTTP
  // requests (and therefore separate PostgreSQL transactions).
  const raceCards = must(
    await admin.from("debt_accounts").insert(
      Array.from({ length: 8 }, (_, index) => ({
        user_id: userId,
        name: `Fact Race ${index + 1} M0`,
        type: "credit_card",
        currency: "USD",
        current_balance_original: 10 + index,
        current_balance_base: 10 + index,
        full_payment_due: 10 + index,
        statement_total_due: 10 + index,
        statement_covered: false,
      })),
    ).select("id"),
    "race cards",
  );
  const raceOccurrenceIds = [];
  for (const [index, card] of raceCards.entries()) {
    const amount = 10 + index;
    const [occurrenceResult, factResult] = await Promise.all([
      admin.from("recurring_occurrences").insert({
        user_id: userId,
        debt_account_id: card.id,
        occurrence_date: "2026-09-15",
        kind: "card_statement",
        mode: "ask",
        status: "pending",
      }).select("id").single(),
      admin.from("debt_statement_cycles").insert({
        user_id: userId,
        debt_account_id: card.id,
        statement_date: "2026-09-16",
        full_payment_due: amount,
        due_day: 3,
        applied: true,
        is_current: true,
        reason: "m0-race-probe",
      }).select("id").single(),
    ]);
    raceOccurrenceIds.push(must(occurrenceResult, "race occurrence").id);
    must(factResult, "race fact");
  }
  const raceSatisfied = must(
    await admin.from("recurring_occurrences")
      .select("id,satisfied_fact_id")
      .in("id", raceOccurrenceIds),
    "race satisfaction",
  );
  check(
    "M100.16b · hecho y ocurrencia concurrentes convergen sin healer",
    raceSatisfied.length === raceCards.length &&
      raceSatisfied.every((row) => Boolean(row.satisfied_fact_id)),
    JSON.stringify(raceSatisfied),
  );

  // All six source families publish through one trigger and one data identity.
  const income = must(await admin.from("income_sources").insert({ user_id: userId, name: "Sueldo M0", amount: 100, currency: "USD", frequency: "monthly", expected_day: 31, is_variable: true }).select("id").single(), "income source");
  const fixed = must(await admin.from("fixed_expenses").insert({ user_id: userId, name: "Luz M0", amount: 30, currency: "USD", category: "utilities", frequency: "monthly", expected_day: 31, is_variable: true }).select("id").single(), "fixed source");
  const saving = must(await admin.from("savings_plans").insert({ user_id: userId, kind: "savings", name: "Reserva M0", amount_base: 40, original_amount: 40, original_currency: "USD", base_currency: "USD", frequency: "monthly", expected_day: 31 }).select("id").single(), "saving source");
  const scheduled = must(await admin.from("scheduled_payments").insert({ user_id: userId, name: "Pago M0", category: "other", amount: 10, currency: "USD", due_date: "2026-08-31" }).select("id").single(), "scheduled source");
  const terminalRows = [
    { income_source_id: income.id, occurrence_date: "2026-08-31", kind: "income" },
    { fixed_expense_id: fixed.id, occurrence_date: "2026-08-31", kind: "expense" },
    { debt_account_id: loan.id, occurrence_date: "2026-08-31", kind: "debt_payment" },
    { savings_plan_id: saving.id, occurrence_date: "2026-08-31", kind: "savings" },
    { scheduled_payment_id: scheduled.id, occurrence_date: "2026-08-31", kind: "expense" },
    { commitment_kind: "investment", occurrence_date: "2026-08-31", kind: "investment" },
  ];
  const terminalOccurrences = must(await admin.from("recurring_occurrences").insert(terminalRows.map((row) => ({ user_id: userId, mode: "ask", status: "pending", ...row }))).select("id"), "terminal occurrences");
  must(await admin.from("recurring_occurrences").update({ status: "dismissed", resolved_at: new Date().toISOString() }).in("id", terminalOccurrences.map((row) => row.id)), "terminalize occurrences");
  const terminalFacts = must(await admin.from("financial_facts").select("fact_kind,entity_type,entity_id,cycle_key,is_current").eq("user_id", userId).in("source_id", terminalOccurrences.map((row) => row.id)), "terminal facts");
  const terminalLinks = must(await admin.from("recurring_occurrence_satisfactions").select("occurrence_id,fact_id").eq("user_id", userId).in("occurrence_id", terminalOccurrences.map((row) => row.id)), "terminal links");
  check(
    "M100.17 · las seis familias terminales publican y satisfacen con una sola primitiva",
    terminalFacts.length === 6 && terminalFacts.every((fact) => fact.is_current) && terminalLinks.length === 6,
    JSON.stringify({ terminalFacts, terminalLinks }),
  );
  const wrongFact = await admin.rpc("kipu_record_financial_fact", { p: { user_id: userId, dedupe_key: `m0-wrong:${randomUUID()}`, fact_kind: "income", entity_type: "income_source", entity_id: income.id, cycle_key: "2026-09-30", source_type: "recurring_occurrence", source_id: terminalOccurrences[0].id, provenance: "forged", payload: {} } });
  check("M100.18 · una fuente no puede probar otra entidad o ciclo", !!wrongFact.error, wrongFact.error?.message ?? "");
  const reopenedOccurrenceId = terminalOccurrences[0].id;
  const reopenedFactId = terminalLinks.find(
    (row) => row.occurrence_id === reopenedOccurrenceId,
  )?.fact_id;
  must(
    await admin.from("recurring_occurrences")
      .update({ status: "pending", resolved_at: null })
      .eq("id", reopenedOccurrenceId),
    "reopen terminal occurrence",
  );
  const reopenedOccurrence = must(
    await admin.from("recurring_occurrences")
      .select("status,satisfied_fact_id,satisfied_at")
      .eq("id", reopenedOccurrenceId)
      .single(),
    "reopened occurrence",
  );
  const retiredFact = reopenedFactId
    ? must(
        await admin.from("financial_facts")
          .select("is_current")
          .eq("id", reopenedFactId)
          .single(),
        "retired reopened fact",
      )
    : null;
  const reopenedAudit = await admin.from("recurring_occurrence_satisfactions")
    .select("id")
    .eq("occurrence_id", reopenedOccurrenceId)
    .maybeSingle();
  const reopenedOpenRead = await readOpenOccurrences(userId, 100);
  check(
    "M100.18b · deshacer una resolución retira su hecho y vuelve a abrir el aviso",
    Boolean(reopenedFactId) &&
      reopenedOccurrence.status === "pending" &&
      reopenedOccurrence.satisfied_fact_id == null &&
      reopenedOccurrence.satisfied_at == null &&
      retiredFact?.is_current === false &&
      !reopenedAudit.error &&
      reopenedAudit.data == null &&
      reopenedOpenRead.ok &&
      reopenedOpenRead.occurrences.some(
        (occurrence) => occurrence.id === reopenedOccurrenceId,
      ),
    JSON.stringify({
      reopenedOccurrence,
      retiredFact,
      reopenedAudit: reopenedAudit.error ?? reopenedAudit.data,
      reopenedOpenRead,
    }),
  );

  // ACLs and direct writes. Service role may execute writers but cannot mutate
  // durable tables around their invariants; anon/auth receive no RPC execute.
  const anonClaim = await anonymous.rpc("kipu_claim_agent_operation", { p: { user_id: userId, operation_key: "forged", channel: "web", request_text: "forged" } });
  const anonFact = await anonymous.rpc("kipu_record_financial_fact", { p: {} });
  const directStepWrite = await admin.from("agent_operation_steps").update({ status: "verified" }).eq("operation_id", founder.claimed.id);
  const directFactWrite = await admin.from("financial_facts").update({ provenance: "forged" }).eq("user_id", userId);
  const directRepaymentMarkerWrite = await admin.from("receivable_repayment_applications")
    .update({ payload_fingerprint: "forged" }).eq("user_id", userId);
  const coverageGaps = must(await admin.rpc("kipu__base_data_coverage_gaps"), "coverage gaps");
  check(
    "M100.19 · ACLs y witness cierran side doors de operación/hechos",
    !!anonClaim.error && !!anonFact.error && !!directStepWrite.error && !!directFactWrite.error &&
      !!directRepaymentMarkerWrite.error &&
      !coverageGaps.some((row) => [
        "account_close_applications",
        "account_balance_reconciliation_applications",
        "financial_facts",
        "debt_proceeds_applications",
        "receivable_repayment_applications",
        "agent_operation_reversals",
      ].includes(row.table_name)),
    JSON.stringify({ anonClaim: anonClaim.error, anonFact: anonFact.error, directStepWrite: directStepWrite.error, directFactWrite: directFactWrite.error, directRepaymentMarkerWrite: directRepaymentMarkerWrite.error, coverageGaps }),
  );

  // A correction may target work far outside the prompt and the latest-page
  // window. Build the archive through the same lifecycle RPCs (no raw table
  // writes), bury the target under twenty newer operations, then recover its
  // exact durable identity by semantic query.
  let archivedTargetId = "";
  for (let index = 0; index < 21; index += 1) {
    const archived = await claimAndSave({
      userId,
      key: `telegram:m0:archive:${index}:${randomUUID()}`,
      text:
        index === 0
          ? "Archivo remoto: corregir Diners de julio con Produbanco"
          : `Operación posterior de archivo ${index}`,
      actions: [],
    });
    if (index === 0) archivedTargetId = archived.claimed.id;
    const lease = mustOk(
      await beginAgentOperationApplication({
        userId,
        operationId: archived.claimed.id,
        expectedVersion: archived.saved.stateVersion,
      }),
      `archive lease ${index}`,
    );
    await completeOperation({
      userId,
      operationId: archived.claimed.id,
      lease,
      result: { reply: `archivo ${index}` },
    });
  }
  const [latestTwenty, searchedArchive] = await withProcessClockOffset(
    -24 * 60 * 60 * 1000,
    () => Promise.all([
      readRecentCompletedAgentOperations(userId, 20),
      searchCompletedAgentOperations({
        userId,
        query: "Díners julio Produbanco",
        limit: 5,
      }),
    ]),
  );
  check(
    "M100.20 · una operación enterrada fuera de las veinte recientes sigue recuperable por su identidad semántica",
    latestTwenty.ok &&
      !latestTwenty.operations.some((row) => row.id === archivedTargetId) &&
      searchedArchive.ok &&
      searchedArchive.complete &&
      searchedArchive.operations.length === 1 &&
      searchedArchive.operations[0]?.id === archivedTargetId,
    JSON.stringify({ archivedTargetId, latestTwenty, searchedArchive }),
  );

  // ——— v26: un miss del filtro semántico no es ausencia ———
  // Muestra v25 (ME9): el query «tres pagos devolución» no coincidía con el
  // texto durable de la operación del founder; el tool devolvía «No hay
  // operaciones completadas en este historial» y el modelo lo convirtió en un
  // reclamo falso de inexistencia que bloqueó el undo. El miss debe declararse
  // como miss del FILTRO y degradar a evidencia sin filtrar.
  const searchMiss = await executeListRecentAgentOperations(
    { query: "palabras imposibles zanahoria cuántica zzz" },
    { userId },
  );
  const searchMissRecent = Array.isArray(searchMiss.data?.recentUnfiltered)
    ? searchMiss.data.recentUnfiltered
    : [];
  check(
    "M111.1 · un query sin coincidencias declara el miss del filtro y degrada a las recientes sin filtrar, jamás a «no existe»",
    searchMiss.status === "done" &&
      searchMiss.data?.queryMatched === false &&
      searchMissRecent.length > 0 &&
      searchMissRecent.every(
        (operation) =>
          typeof operation.id === "string" && Array.isArray(operation.steps),
      ) &&
      !String(searchMiss.summary).includes(
        "No hay operaciones completadas en este historial",
      ) &&
      String(searchMiss.summary).includes("no la ausencia"),
    JSON.stringify({
      status: searchMiss.status,
      summary: searchMiss.summary,
      queryMatched: searchMiss.data?.queryMatched,
      recent: searchMissRecent.length,
    }),
  );

  // ——— Migración 109: la lectura de operaciones abiertas es UN snapshot ———
  // Sonda de dos conexiones. Un escritor recorre el ciclo real
  // ready → awaiting_input → claim(continuación) → planning → save(v+1)
  // — cada vuelta muta la fila de la operación tres veces, agrega una delivery
  // y tres steps — mientras un lector concurrente ejecuta la lectura completa
  // en bucle. Con los lectores viejos (keyset sobre updated_at mutable +
  // offset sin límite de snapshot) una vuelta concurrente podía esconder la
  // fila o mostrar steps de una versión posterior a la del padre con
  // complete=true. El contrato nuevo: cada lectura es internamente coherente
  // o falla cerrada.
  const snapshotReadActions = (round) => [1, 2, 3].map((leg) => ({
    id: `snapshot-v${round}-leg${leg}`,
    capability: "get_financial_context",
    arguments: { probeRound: round, probeLeg: leg },
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [],
    postconditions: [],
  }));
  const snapshotProbe = await claimAndSave({
    userId,
    key: `telegram:m0:snapshot:${randomUUID()}`,
    text: "Sonda de snapshot concurrente v1",
    actions: snapshotReadActions(1),
  });
  const snapshotMissing = [{
    key: "detalleSonda",
    reason: "La sonda pide una vuelta más",
    applies_to: ["$response"],
    answer_shape: "texto libre",
  }];
  let snapshotWriterVersion = snapshotProbe.saved.stateVersion;
  let snapshotWriterRounds = 0;
  let snapshotWriterFailure = null;
  const snapshotWriter = (async () => {
    for (let round = 2; round <= 13; round += 1) {
      const waiting = await transitionAgentOperation({
        userId,
        operationId: snapshotProbe.claimed.id,
        expectedVersion: snapshotWriterVersion,
        status: "awaiting_input",
        missingFields: snapshotMissing,
        pendingQuestion: "¿Sigo con la sonda concurrente?",
      });
      if (!waiting.ok) {
        snapshotWriterFailure = { round, stage: "awaiting_input", ...waiting };
        return;
      }
      const reclaimed = await claimAgentOperation({
        userId,
        deliveryKey: `telegram:m0:snapshot:v${round}:${randomUUID()}`,
        channel: "telegram",
        chatId: "m0-probe",
        rootMessageId: "",
        requestText: `Sonda de snapshot concurrente v${round}`,
        continuationOperationId: snapshotProbe.claimed.id,
        expectedOperationVersions: {
          [snapshotProbe.claimed.id]: waiting.stateVersion,
        },
      });
      if (!reclaimed.ok) {
        snapshotWriterFailure = { round, stage: "reclaim", ...reclaimed };
        return;
      }
      const saved = await saveAgentOperationPlan({
        userId,
        operationId: snapshotProbe.claimed.id,
        expectedVersion: reclaimed.stateVersion,
        plan: plan(snapshotReadActions(round), `Sonda concurrente v${round}`),
        coverage,
        missingFields: [],
        pendingQuestion: null,
        leaseToken: reclaimed.leaseToken,
      });
      if (!saved.ok) {
        snapshotWriterFailure = { round, stage: "save", ...saved };
        return;
      }
      snapshotWriterVersion = saved.stateVersion;
      snapshotWriterRounds += 1;
    }
  })();
  const snapshotReadSummaries = [];
  let tornSnapshot = null;
  for (let attempt = 0; attempt < 14 && !tornSnapshot; attempt += 1) {
    const read = await readOpenAgentOperations(userId);
    if (!read.ok || !read.complete) {
      tornSnapshot = { attempt, ok: read.ok, complete: read.complete };
      break;
    }
    const probeRow = read.operations.find(
      (operation) => operation.id === snapshotProbe.claimed.id,
    );
    if (!probeRow || probeRow.planVersion == null) {
      tornSnapshot = { attempt, missingProbe: true };
      break;
    }
    const currentSteps = probeRow.steps.filter(
      (step) => step.planVersion === probeRow.planVersion,
    );
    const futureSteps = probeRow.steps.filter(
      (step) => step.planVersion > probeRow.planVersion,
    );
    const latestAuthority = probeRow.authorityMessages.includes(
      probeRow.latestRequestText.trim(),
    );
    if (futureSteps.length > 0 || currentSteps.length !== 3 || !latestAuthority) {
      tornSnapshot = {
        attempt,
        planVersion: probeRow.planVersion,
        currentSteps: currentSteps.length,
        futureSteps: futureSteps.length,
        latestAuthority,
      };
      break;
    }
    snapshotReadSummaries.push({
      asOf: read.asOf,
      planVersion: probeRow.planVersion,
    });
  }
  await snapshotWriter;
  const finalSnapshotRead = await readOpenAgentOperations(userId);
  const finalProbeRow = finalSnapshotRead.ok
    ? finalSnapshotRead.operations.find(
        (operation) => operation.id === snapshotProbe.claimed.id,
      ) ?? null
    : null;
  const snapshotAsOfMonotone = snapshotReadSummaries.every(
    (summary, index) =>
      index === 0 ||
      String(snapshotReadSummaries[index - 1].asOf) <= String(summary.asOf),
  );
  check(
    "M109.1 · lecturas concurrentes con la operación mutando jamás devuelven un snapshot roto: ni steps futuros ni una versión vigente incompleta",
    !snapshotWriterFailure &&
      snapshotWriterRounds === 12 &&
      !tornSnapshot &&
      snapshotReadSummaries.length === 14 &&
      snapshotAsOfMonotone &&
      finalSnapshotRead.ok &&
      finalSnapshotRead.complete &&
      finalProbeRow?.planVersion === 13 &&
      finalProbeRow.steps.filter((step) => step.planVersion === 13).length === 3,
    JSON.stringify({
      snapshotWriterFailure,
      snapshotWriterRounds,
      tornSnapshot,
      reads: snapshotReadSummaries.length,
      finalVersion: finalProbeRow?.planVersion ?? null,
    }),
  );

  // CAP+1 contado dentro del mismo snapshot: doscientas una operaciones
  // abiertas jamás se presentan como el conjunto entero.
  const capKeys = Array.from(
    { length: 201 },
    (_, index) => `telegram:m0:cap:${index}:${randomUUID()}`,
  );
  for (let start = 0; start < capKeys.length; start += 25) {
    const slice = capKeys.slice(start, start + 25);
    const claims = await Promise.all(
      slice.map((key, offset) =>
        claimAgentOperation({
          userId,
          deliveryKey: key,
          channel: "telegram",
          chatId: "m0-probe-cap",
          rootMessageId: "",
          requestText: `Sonda de tope ${start + offset}`,
        }),
      ),
    );
    const failedClaim = claims.find((claim) => !claim.ok);
    if (failedClaim) {
      throw new Error(`cap claim failed: ${failedClaim.reason ?? "unknown"}`);
    }
  }
  const cappedRead = await readOpenAgentOperations(userId);
  check(
    "M109.2 · doscientas una operaciones abiertas producen complete=false y el tope jamás se presenta como el conjunto entero",
    cappedRead.ok &&
      cappedRead.complete === false &&
      cappedRead.operations.length === 200,
    JSON.stringify({
      ok: cappedRead.ok,
      complete: cappedRead.complete,
      returned: cappedRead.operations.length,
    }),
  );

  // ——— Migración 111: el archivo completado también es UN snapshot ———
  // Re-audit de Codex: con el scan por offset, una operación que commiteaba
  // entre páginas (transacción iniciada antes del reloj) entraba a la región
  // YA LEÍDA del orden descendente y desaparecía con archiveComplete=true.
  async function completeArchivedOperation(text) {
    const created = await claimAndSave({
      userId,
      key: `telegram:m0:archive111:${randomUUID()}`,
      text,
      actions: [],
    });
    const lease = mustOk(
      await beginAgentOperationApplication({
        userId,
        operationId: created.claimed.id,
        expectedVersion: created.saved.stateVersion,
      }),
      "archive111 lease",
    );
    await completeOperation({
      userId,
      operationId: created.claimed.id,
      lease,
      result: { reply: text },
    });
    return created.claimed.id;
  }
  const presenceTargetId = await completeArchivedOperation(
    "Corrección faro esmeralda del velero antiguo",
  );
  let archiveWriterRounds = 0;
  let archiveWriterFailure = null;
  const archiveWriter = (async () => {
    for (let round = 0; round < 8; round += 1) {
      try {
        await completeArchivedOperation(`Operación concurrente del faro ${round}`);
        archiveWriterRounds += 1;
      } catch (error) {
        archiveWriterFailure = String(error?.message ?? error);
        return;
      }
    }
  })();
  let archiveTorn = null;
  const archiveReads = [];
  for (let attempt = 0; attempt < 10 && !archiveTorn; attempt += 1) {
    const found = await searchCompletedAgentOperations({
      userId,
      query: "faro esmeralda velero",
      limit: 5,
    });
    if (!found.ok) {
      archiveTorn = { attempt, ok: false };
      break;
    }
    if (!found.operations.some((operation) => operation.id === presenceTargetId)) {
      archiveTorn = { attempt, missingTarget: true, complete: found.complete };
      break;
    }
    archiveReads.push({ asOf: found.asOf, complete: found.complete });
  }
  await archiveWriter;
  check(
    "M111.2 · diez búsquedas concurrentes con el archivo creciendo jamás pierden una operación completada presente",
    !archiveWriterFailure &&
      archiveWriterRounds === 8 &&
      !archiveTorn &&
      archiveReads.length === 10,
    JSON.stringify({ archiveWriterFailure, archiveWriterRounds, archiveTorn }),
  );

  // Superar el CAP+1 del scan (120) para probar los dos casos topados.
  const completedCountRead = await admin
    .from("agent_operations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "completed");
  if (completedCountRead.error || completedCountRead.count == null) {
    throw new Error(
      `completed count unreadable: ${completedCountRead.error?.message ?? "null count"}`,
    );
  }
  // Dos condiciones: el TOTAL debe exceder el CAP+1 del scan (121) y el
  // target de M100.20 debe quedar FUERA de la ventana de 120 — su rango es
  // (20 ops de archivo + 9 de la sonda M111.2 + rellenos), así que hacen
  // falta ≥92 rellenos incondicionales.
  const fillersNeeded = Math.max(92, 126 - completedCountRead.count);
  for (let start = 0; start < fillersNeeded; start += 13) {
    const batch = Array.from(
      { length: Math.min(13, fillersNeeded - start) },
      (_, offset) =>
        completeArchivedOperation(`Relleno de archivo ${start + offset}`),
    );
    await Promise.all(batch);
  }
  const cappedNoMatch = await searchCompletedAgentOperations({
    userId,
    query: "palabras imposibles cuark zzz",
    limit: 5,
  });
  const cappedNoMatchTool = await executeListRecentAgentOperations(
    { query: "palabras imposibles cuark zzz" },
    { userId },
  );
  check(
    "M111.3 · un scan topado sin coincidencias observadas jamás afirma queryMatched=false ni complete=true",
    cappedNoMatch.ok &&
      cappedNoMatch.complete === false &&
      cappedNoMatch.operations.length === 0 &&
      cappedNoMatchTool.status === "done" &&
      cappedNoMatchTool.data?.queryMatched === null &&
      cappedNoMatchTool.data?.recentUnfiltered === undefined &&
      String(cappedNoMatchTool.summary).includes("no prueba que no exista"),
    JSON.stringify({
      complete: cappedNoMatch.complete,
      queryMatched: cappedNoMatchTool.data?.queryMatched,
      summary: cappedNoMatchTool.summary,
    }),
  );
  const beyondWindow = await searchCompletedAgentOperations({
    userId,
    query: "Archivo remoto corregir",
    limit: 5,
  });
  const beyondWindowTool = await executeListRecentAgentOperations(
    { query: "Archivo remoto corregir" },
    { userId },
  );
  check(
    "M111.4 · una coincidencia real fuera de la ventana topada produce complete=false y queryMatched=null, jamás una negación",
    beyondWindow.ok &&
      beyondWindow.complete === false &&
      !beyondWindow.operations.some(
        (operation) => operation.id === archivedTargetId,
      ) &&
      beyondWindowTool.status === "done" &&
      beyondWindowTool.data?.queryMatched === null &&
      String(beyondWindowTool.summary).includes("no prueba que no exista"),
    JSON.stringify({
      complete: beyondWindow.complete,
      found: beyondWindow.operations.length,
      queryMatched: beyondWindowTool.data?.queryMatched,
    }),
  );
} catch (error) {
  failures.push("ABORT");
  console.error(error instanceof Error ? error.stack : String(error));
} finally {
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) failures.push(`cleanup auth: ${deleted.error.message}`);
    for (const [table, column] of touched) {
      const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq(column, userId);
      if (error || count == null) failures.push(`LIMPIEZA ILEGIBLE · ${table}: ${error?.message ?? "count null"}`);
      else if (count !== 0) failures.push(`RESIDUO · ${table}: ${count}`);
    }
  }
}

const EXPECTED = 73;
console.log(`Bloque M0 PostgreSQL E2E: ${passed}/${executed}`);
if (failures.length > 0 || passed !== executed || executed !== EXPECTED) {
  if (executed !== EXPECTED) failures.push(`COBERTURA INCOMPLETA ${executed}/${EXPECTED}`);
  console.error(`FAILURES: ${failures.join(" | ") || "unknown"}`);
  process.exitCode = 1;
}
