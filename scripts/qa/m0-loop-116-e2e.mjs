// M0 native loop — migration 116 disposable PostgreSQL probes.
//
// DO NOT RUN before migration 116 has been explicitly approved and applied:
//   node --env-file=.env.local scripts/qa/m0-loop-116-e2e.mjs

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("faltan credenciales Supabase");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const migration116Source = fs.readFileSync(
  path.resolve("supabase/sql/116_m0_native_agent_loop.sql"),
  "utf8",
);

const {
  authorizeAgentOperationManifest,
  beginAgentOperationApplication,
  beginAgentOperationManifest,
  claimAgentOperation,
  recordAgentOperationStepOutcome,
  registerAgentLoopManifest,
  rejectAgentOperationManifest,
  stageAgentLoopStep,
  transitionAgentOperation,
  verifyAgentLoopManifest,
  verifyAgentLoopStep,
} = await import("@/lib/ai/agent/agent-operation-store");
const { reverseAgentOperation } = await import(
  "@/lib/ai/apply-chat-transaction-intent"
);

let userId = null;
let passed = 0;
let executed = 0;
const failures = [];
const rootMessages = new Map();
const touched = [
  ["agent_operation_transition_events", "user_id"],
  ["agent_operation_manifests", "user_id"],
  ["agent_operation_steps", "user_id"],
  ["agent_operation_deliveries", "user_id"],
  ["agent_operations", "user_id"],
  ["chat_messages", "user_id"],
  ["transactions", "user_id"],
  ["accounts", "user_id"],
  ["profiles", "id"],
];

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

function boundedHarnessError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack?.split("\n", 1)[0] ?? error.name,
    };
  }
  const row = error && typeof error === "object" ? error : {};
  return {
    code: typeof row.code === "string" ? row.code : null,
    message: typeof row.message === "string" ? row.message : String(error),
    details: typeof row.details === "string" ? row.details : null,
    hint: typeof row.hint === "string" ? row.hint : null,
  };
}

function boundedHarnessErrorText(error) {
  return JSON.stringify(boundedHarnessError(error));
}

function must(result, label) {
  if (result?.error) {
    throw new Error(`${label}: ${boundedHarnessErrorText(result.error)}`);
  }
  return result.data;
}

function mustOk(result, label) {
  if (!result?.ok) throw new Error(`${label}: ${JSON.stringify(result)}`);
  return result;
}

async function claim(key, text, continuation = null, expectedVersion = null) {
  let rootMessage = rootMessages.get(key);
  if (!rootMessage) {
    rootMessage = must(
      await admin
        .from("chat_messages")
        .insert({
          user_id: userId,
          role: "user",
          content: text,
          channel: "telegram",
          metadata: { source: "m116-e2e" },
        })
        .select("id")
        .single(),
      `root message ${key}`,
    );
    rootMessages.set(key, rootMessage);
  }
  return mustOk(
    await claimAgentOperation({
      userId,
      deliveryKey: key,
      channel: "telegram",
      chatId: "m116-probe",
      rootMessageId: rootMessage.id,
      requestText: text,
      continuationOperationId: continuation,
      expectedOperationVersions:
        continuation && expectedVersion != null
          ? { [continuation]: expectedVersion }
          : {},
    }),
    `claim ${key}`,
  );
}

async function stage(operation, input) {
  return stageAgentLoopStep({
    userId,
    operationId: operation.id,
    expectedVersion: input.expectedVersion,
    deliveryKey: input.deliveryKey,
    leaseToken: input.leaseToken,
    seq: input.seq,
    capability: input.capability,
    arguments: input.arguments,
    effectMode: input.effectMode,
  });
}

async function ledgerExpense({ accountId, operationId, stepKey, amount, tag }) {
  return String(
    must(
      await admin.rpc("kipu_apply_ledger_entry", {
        p_entry: {
          user_id: userId,
          type: "expense",
          effect_type: "expense",
          sign: 1,
          description: tag,
          category: "other",
          original_amount: amount,
          original_currency: "USD",
          exchange_rate_to_base: 1,
          base_amount: amount,
          base_currency: "USD",
          source_account_id: accountId,
          raw_input: tag,
          input_channel: "chat",
          occurred_at: new Date().toISOString(),
          dedupe_key: `agent-operation:${operationId}:${stepKey}`,
        },
      }),
      `ledger ${tag}`,
    ),
  );
}

async function record(step, operation, leaseToken, input) {
  return recordAgentOperationStepOutcome({
    userId,
    operationId: operation.id,
    stepKey: step.stepKey,
    capability: step.capability,
    arguments: step.arguments,
    toolStatus: input.toolStatus ?? "done",
    executionEffect: input.executionEffect,
    result: input.result,
    affectedRefs: input.affectedRefs ?? [],
    leaseToken,
  });
}

async function enterVerifying(operationId, stateVersion, leaseToken) {
  return mustOk(
    await transitionAgentOperation({
      userId,
      operationId,
      expectedVersion: stateVersion,
      status: "verifying",
      leaseToken,
    }),
    "enter verifying",
  );
}

async function complete(operationId, stateVersion, leaseToken, result = {}) {
  return mustOk(
    await transitionAgentOperation({
      userId,
      operationId,
      expectedVersion: stateVersion,
      status: "completed",
      leaseToken,
      result,
    }),
    "complete loop operation",
  );
}

try {
  const created = must(
    await admin.auth.admin.createUser({
      email: `kipu-m116-${Date.now()}@example.invalid`,
      email_confirm: true,
      user_metadata: { kipu_m116_probe: true },
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
    await admin
      .from("accounts")
      .insert({
        user_id: userId,
        name: "M116 cash",
        type: "bank",
        currency: "USD",
        current_balance_original: 1000,
        current_balance_base: 1000,
      })
      .select("id")
      .single(),
    "account",
  );

  // M116.1 — exact replay and all three identity dimensions.
  const d1 = `m116:stage:${randomUUID()}`;
  const op1 = await claim(d1, "read context");
  const s1Input = {
    expectedVersion: op1.stateVersion,
    deliveryKey: d1,
    leaseToken: op1.leaseToken,
    seq: 0,
    capability: "get_financial_context",
    arguments: {},
    effectMode: "read",
  };
  const s1 = mustOk(await stage(op1, s1Input), "stage exact");
  const s1Replay = mustOk(await stage(op1, s1Input), "stage replay");
  const s1Mismatch = await stage(op1, {
    ...s1Input,
    arguments: { forged: true },
  });
  const s1Stale = await stage(op1, {
    ...s1Input,
    seq: 1,
    expectedVersion: op1.stateVersion,
  });
  const s1StaleNew = await stage(op1, {
    ...s1Input,
    seq: 2,
    arguments: { scope: "new work" },
    expectedVersion: op1.stateVersion,
  });
  const s1WrongLease = await stage(op1, {
    ...s1Input,
    seq: 3,
    expectedVersion: s1.stateVersion,
    leaseToken: randomUUID(),
  });
  const s1DifferentKeyReplay = mustOk(
    await stage(op1, {
      ...s1Input,
      seq: 9,
      expectedVersion: s1.stateVersion,
    }),
    "stage capability+fingerprint replay",
  );
  const foreignDelivery = `m116:foreign-delivery:${randomUUID()}`;
  await claim(foreignDelivery, "foreign delivery owner");
  const s1WrongDelivery = await stage(op1, {
    ...s1Input,
    deliveryKey: foreignDelivery,
    seq: 10,
    expectedVersion: s1.stateVersion,
  });
  check(
    "M116.1 · staging replay exacto + delivery/lease/CAS",
    s1Replay.outcome === "replayed" &&
      s1Replay.step.stepKey === s1.step.stepKey &&
      !s1Mismatch.ok &&
      s1Stale.outcome === "replayed" &&
      s1Stale.step.stepKey === s1.step.stepKey &&
      !s1StaleNew.ok &&
      s1StaleNew.conflict === true &&
      !s1WrongLease.ok &&
      s1DifferentKeyReplay.outcome === "replayed" &&
      s1DifferentKeyReplay.step.stepKey === s1.step.stepKey &&
      !s1WrongDelivery.ok &&
      s1WrongDelivery.reason.includes("delivery does not own operation"),
    JSON.stringify({
      s1,
      s1Replay,
      s1Mismatch,
      s1Stale,
      s1StaleNew,
      s1WrongLease,
      s1DifferentKeyReplay,
      s1WrongDelivery,
    }),
  );

  // M116.2 + M116.3 share a real proposal so reject can prove the complete
  // non-terminal lifecycle and same-delivery replacement.
  const proposalDelivery = `m116:proposal:${randomUUID()}`;
  const op2 = await claim(proposalDelivery, "prepare two changes");
  const s2a = mustOk(
    await stage(op2, {
      expectedVersion: op2.stateVersion,
      deliveryKey: proposalDelivery,
      leaseToken: op2.leaseToken,
      seq: 0,
      capability: "create_account",
      arguments: { name: "M116 A", type: "bank", currency: "USD" },
      effectMode: "domain_state",
    }),
    "stage proposal A",
  );
  const s2b = mustOk(
    await stage(op2, {
      expectedVersion: s2a.stateVersion,
      deliveryKey: proposalDelivery,
      leaseToken: op2.leaseToken,
      seq: 1,
      capability: "create_account",
      arguments: { name: "M116 B", type: "bank", currency: "USD" },
      effectMode: "domain_state",
    }),
    "stage proposal B",
  );
  const cherryPick = await registerAgentLoopManifest({
    userId,
    operationId: op2.id,
    expectedVersion: s2b.stateVersion,
    deliveryKey: proposalDelivery,
    leaseToken: op2.leaseToken,
    stepKeys: [s2a.step.stepKey],
    confirmationPrompt: "¿Confirmas las dos cuentas?",
  });
  const proposed = mustOk(
    await registerAgentLoopManifest({
      userId,
      operationId: op2.id,
      expectedVersion: s2b.stateVersion,
      deliveryKey: proposalDelivery,
      leaseToken: op2.leaseToken,
      stepKeys: [s2a.step.stepKey, s2b.step.stepKey],
      confirmationPrompt: "¿Confirmas las dos cuentas?",
    }),
    "register full proposal",
  );
  const proposalRows = must(
    await admin
      .from("agent_operation_manifests")
      .select("manifest,status")
      .eq("operation_id", op2.id)
      .single(),
    "proposal row",
  );
  const proposalOperation = must(
    await admin
      .from("agent_operations")
      .select("status,pending_question")
      .eq("id", op2.id)
      .single(),
    "proposal operation",
  );
  const actions = proposalRows.manifest.actions;
  const proposedAccountRead = await admin
    .from("accounts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("name", ["M116 A", "M116 B"]);
  if (proposedAccountRead.error) {
    throw new Error(`proposal account writes: ${proposedAccountRead.error.message}`);
  }
  check(
    "M116.2 · register deriva shape espejo, exige igualdad y persiste la pregunta",
    !cherryPick.ok &&
      proposed.status === "awaiting_input" &&
      proposalOperation.status === "awaiting_input" &&
      proposalOperation.pending_question === "¿Confirmas las dos cuentas?" &&
      Number(proposedAccountRead.count ?? 0) === 0 &&
      Array.isArray(actions) &&
      actions.length === 2 &&
      actions.every(
        (action, index) => {
          const step = [s2a.step, s2b.step][index];
          return (
          Number.isInteger(action.ordinal) &&
          action.ordinal === step.stepOrder &&
          action.action_id === step.stepKey &&
          action.capability === step.capability &&
          isDeepStrictEqual(action.arguments, step.arguments) &&
          isDeepStrictEqual(action.state_witness, step.stateWitness) &&
          isDeepStrictEqual(action.effects, step.effects) &&
          isDeepStrictEqual(action.postconditions, step.postconditions) &&
          action.atomic_group === step.atomicGroup
          );
        },
      ),
    JSON.stringify({ cherryPick, proposed, proposalOperation, actions }),
  );

  const rejectDelivery = `m116:reject:${randomUUID()}`;
  const rejectClaim = await claim(
    rejectDelivery,
    "no, replace it",
    op2.id,
    proposed.stateVersion,
  );
  const rejectTransition = {
    kind: "rejected",
    target_operation_id: op2.id,
    consumed_pending_keys: ["operation_manifest"],
    remaining_pending_keys: [],
    rationale: "User rejected the two-account proposal and requested one.",
  };
  const rejected = mustOk(
    await rejectAgentOperationManifest({
      userId,
      operationId: op2.id,
      expectedVersion: rejectClaim.stateVersion,
      deliveryKey: rejectDelivery,
      leaseToken: rejectClaim.leaseToken,
      transition: rejectTransition,
    }),
    "reject proposal",
  );
  const replacement = mustOk(
    await stage(op2, {
      expectedVersion: rejected.stateVersion,
      deliveryKey: rejectDelivery,
      leaseToken: rejectClaim.leaseToken,
      seq: 0,
      capability: "create_account",
      arguments: { name: "M116 replacement", type: "bank", currency: "USD" },
      effectMode: "domain_state",
    }),
    "same-delivery replacement",
  );
  const rejectedReplay = mustOk(
    await rejectAgentOperationManifest({
      userId,
      operationId: op2.id,
      expectedVersion: rejectClaim.stateVersion,
      deliveryKey: rejectDelivery,
      leaseToken: rejectClaim.leaseToken,
      transition: rejectTransition,
    }),
    "reject replay after restaging",
  );
  const rejectedSteps = must(
    await admin
      .from("agent_operation_steps")
      .select("status")
      .eq("operation_id", op2.id)
      .eq("plan_version", rejected.planVersion),
    "rejected steps",
  );

  // Exercise the explicit SQL anti-self branch with a separate disposable
  // proposal. A legitimate continuation delivery obtains the live lease,
  // while the rejecting identity remains the original proposing delivery.
  const selfDelivery = `m116:self-reject:${randomUUID()}`;
  const selfOp = await claim(selfDelivery, "prepare then self reject");
  const selfStep = mustOk(
    await stage(selfOp, {
      expectedVersion: selfOp.stateVersion,
      deliveryKey: selfDelivery,
      leaseToken: selfOp.leaseToken,
      seq: 0,
      capability: "create_account",
      arguments: { name: "M116 self", type: "bank", currency: "USD" },
      effectMode: "domain_state",
    }),
    "self-reject stage",
  );
  const selfRegistered = mustOk(
    await registerAgentLoopManifest({
      userId,
      operationId: selfOp.id,
      expectedVersion: selfStep.stateVersion,
      deliveryKey: selfDelivery,
      leaseToken: selfOp.leaseToken,
      stepKeys: [selfStep.step.stepKey],
      confirmationPrompt: "¿Confirmas self?",
    }),
    "self-reject register",
  );
  const selfLeaseDelivery = `m116:self-lease:${randomUUID()}`;
  const selfClaim = await claim(
    selfLeaseDelivery,
    "claim continuation lease for anti-self fixture",
    selfOp.id,
    selfRegistered.stateVersion,
  );
  const selfReject = await admin.rpc("kipu_reject_agent_operation_manifest", {
    p: {
      user_id: userId,
      operation_id: selfOp.id,
      expected_version: selfClaim.stateVersion,
      delivery_key: selfDelivery,
      lease_token: selfClaim.leaseToken,
      transition: {
        ...rejectTransition,
        target_operation_id: selfOp.id,
        rationale: "Attempted self rejection fixture.",
      },
    },
  });
  const selfAuthorize = await admin.rpc("kipu_authorize_agent_operation_manifest", {
    p: {
      user_id: userId,
      operation_id: selfOp.id,
      expected_version: selfClaim.stateVersion,
      delivery_key: selfDelivery,
      lease_token: selfClaim.leaseToken,
      transition: {
        kind: "confirmed",
        target_operation_id: selfOp.id,
        consumed_pending_keys: ["operation_manifest"],
        remaining_pending_keys: [],
        rationale: "Attempted self authorization fixture.",
      },
    },
  });
  check(
    "M116.3 · reject atómico, replay, anti-self reject+confirm y re-staging con bump en la misma delivery",
    rejected.status === "planning" &&
      rejectedReplay.replayed === true &&
      rejectedSteps.every((row) => row.status === "refused") &&
      replacement.planVersion === rejected.planVersion + 1 &&
      selfReject.error?.message?.includes("cannot reject itself") === true &&
      selfAuthorize.error?.message?.includes("cannot authorize itself") === true,
    JSON.stringify({
      rejected,
      rejectedReplay,
      rejectedSteps,
      replacement,
      selfReject,
      selfAuthorize,
    }),
  );

  // M116.4 — real ledger ownership, missing economic receipt, and a
  // non-economic durable receipt.
  const d4a = `m116:verify-economic:${randomUUID()}`;
  const op4a = await claim(d4a, "record economic");
  const econ = mustOk(
    await stage(op4a, {
      expectedVersion: op4a.stateVersion,
      deliveryKey: d4a,
      leaseToken: op4a.leaseToken,
      seq: 0,
      capability: "log_movement",
      arguments: {
        type: "expense",
        amount: 7,
        description: "M116 verified",
        category: "other",
        sourceAccountId: account.id,
      },
      effectMode: "economic_event",
    }),
    "stage economic verify",
  );
  const econTx = await ledgerExpense({
    accountId: account.id,
    operationId: op4a.id,
    stepKey: econ.step.stepKey,
    amount: 7,
    tag: "M116 verified",
  });
  mustOk(
    await record(econ.step, op4a, op4a.leaseToken, {
      executionEffect: "write",
      result: { transactionId: econTx },
      affectedRefs: [{ type: "transaction", id: econTx }],
    }),
    "record economic verify",
  );
  const verifying4a = await enterVerifying(
    op4a.id,
    econ.stateVersion,
    op4a.leaseToken,
  );
  const verifiedEconomic = await verifyAgentLoopStep({
    userId,
    operationId: op4a.id,
    planVersion: econ.planVersion,
    stepKey: econ.step.stepKey,
    capability: econ.step.capability,
    arguments: econ.step.arguments,
    leaseToken: op4a.leaseToken,
    postWriteContextVerified: true,
  });

  const d4b = `m116:verify-missing:${randomUUID()}`;
  const op4b = await claim(d4b, "record missing receipt");
  const missing = mustOk(
    await stage(op4b, {
      expectedVersion: op4b.stateVersion,
      deliveryKey: d4b,
      leaseToken: op4b.leaseToken,
      seq: 0,
      capability: "log_movement",
      arguments: { type: "expense", amount: 8, description: "missing", category: "other" },
      effectMode: "economic_event",
    }),
    "stage missing receipt",
  );
  mustOk(
    await record(missing.step, op4b, op4b.leaseToken, {
      executionEffect: "write",
      result: { deliberatelyMissing: true },
    }),
    "record missing receipt",
  );
  await enterVerifying(op4b.id, missing.stateVersion, op4b.leaseToken);
  const refusedMissing = await verifyAgentLoopStep({
    userId,
    operationId: op4b.id,
    planVersion: missing.planVersion,
    stepKey: missing.step.stepKey,
    capability: missing.step.capability,
    arguments: missing.step.arguments,
    leaseToken: op4b.leaseToken,
    postWriteContextVerified: true,
  });

  const d4c = `m116:verify-domain:${randomUUID()}`;
  const op4c = await claim(d4c, "remember a fact");
  const domain = mustOk(
    await stage(op4c, {
      expectedVersion: op4c.stateVersion,
      deliveryKey: d4c,
      leaseToken: op4c.leaseToken,
      seq: 0,
      capability: "remember_fact",
      arguments: { fact: "M116 domain receipt" },
      effectMode: "domain_state",
    }),
    "stage domain receipt",
  );
  mustOk(
    await record(domain.step, op4c, op4c.leaseToken, {
      executionEffect: "write",
      result: { stored: true },
    }),
    "record domain receipt",
  );
  await enterVerifying(op4c.id, domain.stateVersion, op4c.leaseToken);
  const verifiedDomain = await verifyAgentLoopStep({
    userId,
    operationId: op4c.id,
    planVersion: domain.planVersion,
    stepKey: domain.step.stepKey,
    capability: domain.step.capability,
    arguments: domain.step.arguments,
    leaseToken: op4c.leaseToken,
    postWriteContextVerified: true,
  });
  const d4d = `m116:verify-contextual-money:${randomUUID()}`;
  const op4d = await claim(d4d, "contextual writer moves money");
  const contextual = mustOk(
    await stage(op4d, {
      expectedVersion: op4d.stateVersion,
      deliveryKey: d4d,
      leaseToken: op4d.leaseToken,
      seq: 0,
      capability: "resolve_recurring_occurrence",
      arguments: { occurrenceId: "m116-contextual", action: "confirm" },
      effectMode: "contextual_event",
    }),
    "stage contextual money writer",
  );
  const contextualTx = await ledgerExpense({
    accountId: account.id,
    operationId: op4d.id,
    stepKey: contextual.step.stepKey,
    amount: 6,
    tag: "M116 contextual money",
  });
  mustOk(
    await record(contextual.step, op4d, op4d.leaseToken, {
      executionEffect: "write",
      result: { transactionId: contextualTx },
      affectedRefs: [{ type: "transaction", id: contextualTx }],
    }),
    "record contextual money receipt",
  );
  const contextualVerifying = await enterVerifying(
    op4d.id,
    contextual.stateVersion,
    op4d.leaseToken,
  );
  const verifiedContextual = await verifyAgentLoopStep({
    userId,
    operationId: op4d.id,
    planVersion: contextual.planVersion,
    stepKey: contextual.step.stepKey,
    capability: contextual.step.capability,
    arguments: contextual.step.arguments,
    leaseToken: op4d.leaseToken,
    postWriteContextVerified: true,
  });
  const contextualRow = must(
    await admin
      .from("agent_operation_steps")
      .select("effects")
      .eq("operation_id", op4d.id)
      .eq("step_key", contextual.step.stepKey)
      .single(),
    "contextual marker row",
  );
  const contextualCompleted = await complete(
    op4d.id,
    contextualVerifying.stateVersion,
    op4d.leaseToken,
    { probe: "M116.4-contextual" },
  );
  check(
    "M116.4 · verify-loop-step prueba ledger, rehúsa económico sin receipt y deriva marcador contextual por receipt",
    verifiedEconomic.ok &&
      !refusedMissing.ok &&
      verifiedDomain.ok &&
      verifiedContextual.ok &&
      contextualCompleted.status === "completed" &&
      contextualRow.effects.some(
        (effect) =>
          effect.kind === "economic_event" && effect.source === "receipt",
      ),
    JSON.stringify({
      verifiedEconomic,
      refusedMissing,
      verifiedDomain,
      verifiedContextual,
      contextualRow,
      contextualCompleted,
      verifying4a,
    }),
  );

  // M116.5 — mixed turn: one ordinary verified step is deliberately outside
  // the manifest; the sensitive step is authorized through unchanged 112/115.
  const mixedProposal = `m116:mixed:${randomUUID()}`;
  const op5 = await claim(mixedProposal, "ordinary then sensitive");
  const ordinary = mustOk(
    await stage(op5, {
      expectedVersion: op5.stateVersion,
      deliveryKey: mixedProposal,
      leaseToken: op5.leaseToken,
      seq: 0,
      capability: "remember_fact",
      arguments: { fact: "ordinary immediate" },
      effectMode: "domain_state",
    }),
    "mixed ordinary stage",
  );
  mustOk(
    await record(ordinary.step, op5, op5.leaseToken, {
      executionEffect: "write",
      result: { stored: true },
    }),
    "mixed ordinary receipt",
  );
  const sensitive = mustOk(
    await stage(op5, {
      expectedVersion: ordinary.stateVersion,
      deliveryKey: mixedProposal,
      leaseToken: op5.leaseToken,
      seq: 1,
      capability: "log_movement",
      arguments: {
        type: "expense",
        amount: 9,
        description: "M116 mixed",
        category: "other",
        sourceAccountId: account.id,
      },
      effectMode: "economic_event",
    }),
    "mixed sensitive stage",
  );
  const mixedRegistered = mustOk(
    await registerAgentLoopManifest({
      userId,
      operationId: op5.id,
      expectedVersion: sensitive.stateVersion,
      deliveryKey: mixedProposal,
      leaseToken: op5.leaseToken,
      stepKeys: [sensitive.step.stepKey],
      confirmationPrompt: "¿Confirmas el movimiento sensible?",
    }),
    "mixed register",
  );
  const mixedConfirmDelivery = `m116:mixed-confirm:${randomUUID()}`;
  const mixedClaim = await claim(
    mixedConfirmDelivery,
    "yes, confirm",
    op5.id,
    mixedRegistered.stateVersion,
  );
  const mixedAuthorized = mustOk(
    await authorizeAgentOperationManifest({
      userId,
      operationId: op5.id,
      expectedVersion: mixedClaim.stateVersion,
      deliveryKey: mixedConfirmDelivery,
      leaseToken: mixedClaim.leaseToken,
      transition: {
        kind: "confirmed",
        target_operation_id: op5.id,
        consumed_pending_keys: ["operation_manifest"],
        remaining_pending_keys: [],
        rationale: "User confirmed the exact mixed proposal.",
      },
    }),
    "mixed authorize 112",
  );
  const mixedLease = mustOk(
    await beginAgentOperationApplication({
      userId,
      operationId: op5.id,
      expectedVersion: mixedAuthorized.stateVersion,
    }),
    "mixed application lease",
  );
  mustOk(
    await beginAgentOperationManifest({
      userId,
      operationId: op5.id,
      planVersion: mixedAuthorized.planVersion,
      leaseToken: mixedLease.leaseToken,
    }),
    "mixed begin 115",
  );
  const mixedTx = await ledgerExpense({
    accountId: account.id,
    operationId: op5.id,
    stepKey: sensitive.step.stepKey,
    amount: 9,
    tag: "M116 mixed",
  });
  mustOk(
    await record(sensitive.step, op5, mixedLease.leaseToken, {
      executionEffect: "write",
      result: { transactionId: mixedTx },
      affectedRefs: [{ type: "transaction", id: mixedTx }],
    }),
    "mixed sensitive receipt",
  );
  const mixedVerifying = await enterVerifying(
    op5.id,
    mixedLease.stateVersion,
    mixedLease.leaseToken,
  );
  const mixedOrdinaryVerified = await verifyAgentLoopStep({
    userId,
    operationId: op5.id,
    planVersion: ordinary.planVersion,
    stepKey: ordinary.step.stepKey,
    capability: ordinary.step.capability,
    arguments: ordinary.step.arguments,
    leaseToken: mixedLease.leaseToken,
    postWriteContextVerified: true,
  });
  const mixedSensitiveVerified = await verifyAgentLoopStep({
    userId,
    operationId: op5.id,
    planVersion: sensitive.planVersion,
    stepKey: sensitive.step.stepKey,
    capability: sensitive.step.capability,
    arguments: sensitive.step.arguments,
    leaseToken: mixedLease.leaseToken,
    postWriteContextVerified: true,
  });
  const mixedManifestVerified = await verifyAgentLoopManifest({
    userId,
    operationId: op5.id,
    planVersion: sensitive.planVersion,
    leaseToken: mixedLease.leaseToken,
  });
  const mixedCompleted = await complete(
    op5.id,
    mixedVerifying.stateVersion,
    mixedLease.leaseToken,
    { probe: "M116.5" },
  );

  // The outside-economic state guarded by verify-manifest is unreachable via
  // RPC: stage refuses new work behind a current proposed/executing manifest.
  // Exercise both reachable sides and retain the SQL predicate as a named
  // defense-in-depth smoke instead of forging a protected step row.
  const containProposal = `m116:contain:${randomUUID()}`;
  const op5b = await claim(containProposal, "containment");
  const contained = mustOk(
    await stage(op5b, {
      expectedVersion: op5b.stateVersion,
      deliveryKey: containProposal,
      leaseToken: op5b.leaseToken,
      seq: 0,
      capability: "log_movement",
      arguments: { type: "expense", amount: 1, description: "contained", category: "other" },
      effectMode: "economic_event",
    }),
    "containment stage",
  );
  const containRegistered = mustOk(
    await registerAgentLoopManifest({
      userId,
      operationId: op5b.id,
      expectedVersion: contained.stateVersion,
      deliveryKey: containProposal,
      leaseToken: op5b.leaseToken,
      stepKeys: [contained.step.stepKey],
      confirmationPrompt: "¿Confirmas containment?",
    }),
    "containment register",
  );
  const containConfirmKey = `m116:contain-confirm:${randomUUID()}`;
  const containClaim = await claim(
    containConfirmKey,
    "confirm containment",
    op5b.id,
    containRegistered.stateVersion,
  );
  const proposedStageRefused = await stage(op5b, {
    expectedVersion: containClaim.stateVersion,
    deliveryKey: containConfirmKey,
    leaseToken: containClaim.leaseToken,
    seq: 1,
    capability: "create_account",
    arguments: { name: "M116 blocked proposed", type: "bank", currency: "USD" },
    effectMode: "domain_state",
  });
  const containAuthorized = mustOk(
    await authorizeAgentOperationManifest({
      userId,
      operationId: op5b.id,
      expectedVersion: containClaim.stateVersion,
      deliveryKey: containConfirmKey,
      leaseToken: containClaim.leaseToken,
      transition: {
        kind: "confirmed",
        target_operation_id: op5b.id,
        consumed_pending_keys: ["operation_manifest"],
        remaining_pending_keys: [],
        rationale: "Confirm containment fixture.",
      },
    }),
    "containment authorize",
  );
  const containLease = mustOk(
    await beginAgentOperationApplication({
      userId,
      operationId: op5b.id,
      expectedVersion: containAuthorized.stateVersion,
    }),
    "containment lease",
  );
  mustOk(
    await beginAgentOperationManifest({
      userId,
      operationId: op5b.id,
      planVersion: contained.planVersion,
      leaseToken: containLease.leaseToken,
    }),
    "containment begin",
  );
  const executingStageRefused = await stage(op5b, {
    expectedVersion: containLease.stateVersion,
    deliveryKey: containConfirmKey,
    leaseToken: containLease.leaseToken,
    seq: 2,
    capability: "create_account",
    arguments: { name: "M116 blocked executing", type: "bank", currency: "USD" },
    effectMode: "domain_state",
  });
  const containmentPredicateSmoke =
    migration116Source.includes(
      "and s.created_at > v_manifest.authorized_at",
    ) &&
    migration116Source.includes("effect->>'kind' = 'economic_event'") &&
    migration116Source.includes("v_outside_economic <> 0") &&
    migration116Source.includes(
      "'outside_economic_count',v_outside_economic",
    );
  const mixedVerification = mixedManifestVerified.ok
    ? mixedManifestVerified.verification
    : {};
  check(
    "M116.5 · paridad scoped MIXTA + barrera proposed/executing + smoke de contención en profundidad",
    mixedOrdinaryVerified.ok &&
      mixedSensitiveVerified.ok &&
      mixedManifestVerified.ok &&
      mixedCompleted.status === "completed" &&
      Number(mixedVerification.authorized_count) === 1 &&
      Number(mixedVerification.matching_count) === 1 &&
      Number(mixedVerification.verified_count) === 1 &&
      Number(mixedVerification.inflight_count) === 0 &&
      Number(mixedVerification.outside_economic_count) === 0 &&
      !proposedStageRefused.ok &&
      proposedStageRefused.reason.includes(
        "current loop manifest no longer accepts staging",
      ) &&
      !executingStageRefused.ok &&
      executingStageRefused.reason.includes(
        "current loop manifest no longer accepts staging",
      ) &&
      containmentPredicateSmoke,
    JSON.stringify({
      mixedOrdinaryVerified,
      mixedSensitiveVerified,
      mixedManifestVerified,
      mixedCompleted,
      proposedStageRefused,
      executingStageRefused,
      containmentPredicateSmoke,
    }),
  );

  // M116.7 — a rejected v1 manifest may leave an ordinary v1 write applied.
  // Re-staging the sensitive action bumps the operation to v2; settlement must
  // still verify the exact v1 step by its own identity and leave no applied row.
  const mixedRestageProposal = `m116:mixed-restage:${randomUUID()}`;
  const op7 = await claim(mixedRestageProposal, "ordinary then reject sensitive");
  const ordinaryV1 = mustOk(
    await stage(op7, {
      expectedVersion: op7.stateVersion,
      deliveryKey: mixedRestageProposal,
      leaseToken: op7.leaseToken,
      seq: 0,
      capability: "remember_fact",
      arguments: { fact: "ordinary v1 survives manifest rejection" },
      effectMode: "domain_state",
    }),
    "mixed restage ordinary v1",
  );
  mustOk(
    await record(ordinaryV1.step, op7, op7.leaseToken, {
      executionEffect: "write",
      result: { stored: true, version: 1 },
    }),
    "mixed restage ordinary v1 receipt",
  );
  const sensitiveV1Arguments = {
    type: "expense",
    amount: 7,
    description: "M116 mixed restage",
    category: "other",
    sourceAccountId: account.id,
  };
  const sensitiveV1 = mustOk(
    await stage(op7, {
      expectedVersion: ordinaryV1.stateVersion,
      deliveryKey: mixedRestageProposal,
      leaseToken: op7.leaseToken,
      seq: 1,
      capability: "log_movement",
      arguments: sensitiveV1Arguments,
      effectMode: "economic_event",
    }),
    "mixed restage sensitive v1",
  );
  const registeredV1 = mustOk(
    await registerAgentLoopManifest({
      userId,
      operationId: op7.id,
      expectedVersion: sensitiveV1.stateVersion,
      deliveryKey: mixedRestageProposal,
      leaseToken: op7.leaseToken,
      stepKeys: [sensitiveV1.step.stepKey],
      confirmationPrompt: "¿Confirmas el movimiento v1?",
    }),
    "mixed restage register v1",
  );
  const rejectV1Delivery = `m116:mixed-restage-reject:${randomUUID()}`;
  const rejectV1Claim = await claim(
    rejectV1Delivery,
    "no, modify it",
    op7.id,
    registeredV1.stateVersion,
  );
  const rejectedV1 = mustOk(
    await rejectAgentOperationManifest({
      userId,
      operationId: op7.id,
      expectedVersion: rejectV1Claim.stateVersion,
      deliveryKey: rejectV1Delivery,
      leaseToken: rejectV1Claim.leaseToken,
      transition: {
        kind: "rejected",
        target_operation_id: op7.id,
        consumed_pending_keys: ["operation_manifest"],
        remaining_pending_keys: [],
        rationale: "Reject v1 and replace the sensitive action in one delivery.",
      },
    }),
    "mixed restage reject v1",
  );
  const sensitiveV2 = mustOk(
    await stage(op7, {
      expectedVersion: rejectedV1.stateVersion,
      deliveryKey: rejectV1Delivery,
      leaseToken: rejectV1Claim.leaseToken,
      seq: 0,
      capability: "log_movement",
      arguments: sensitiveV1Arguments,
      effectMode: "economic_event",
    }),
    "mixed restage sensitive v2",
  );
  const registeredV2 = mustOk(
    await registerAgentLoopManifest({
      userId,
      operationId: op7.id,
      expectedVersion: sensitiveV2.stateVersion,
      deliveryKey: rejectV1Delivery,
      leaseToken: rejectV1Claim.leaseToken,
      stepKeys: [sensitiveV2.step.stepKey],
      confirmationPrompt: "¿Confirmas el movimiento modificado?",
    }),
    "mixed restage register v2",
  );
  const confirmV2Delivery = `m116:mixed-restage-confirm:${randomUUID()}`;
  const confirmV2Claim = await claim(
    confirmV2Delivery,
    "yes, confirm the modified movement",
    op7.id,
    registeredV2.stateVersion,
  );
  const authorizedV2 = mustOk(
    await authorizeAgentOperationManifest({
      userId,
      operationId: op7.id,
      expectedVersion: confirmV2Claim.stateVersion,
      deliveryKey: confirmV2Delivery,
      leaseToken: confirmV2Claim.leaseToken,
      transition: {
        kind: "confirmed",
        target_operation_id: op7.id,
        consumed_pending_keys: ["operation_manifest"],
        remaining_pending_keys: [],
        rationale: "Confirm the exact replacement manifest.",
      },
    }),
    "mixed restage authorize v2",
  );
  const mixedRestageLease = mustOk(
    await beginAgentOperationApplication({
      userId,
      operationId: op7.id,
      expectedVersion: authorizedV2.stateVersion,
    }),
    "mixed restage application lease",
  );
  mustOk(
    await beginAgentOperationManifest({
      userId,
      operationId: op7.id,
      planVersion: sensitiveV2.planVersion,
      leaseToken: mixedRestageLease.leaseToken,
    }),
    "mixed restage begin v2",
  );
  const mixedRestageTx = await ledgerExpense({
    accountId: account.id,
    operationId: op7.id,
    stepKey: sensitiveV2.step.stepKey,
    amount: 7,
    tag: "M116 mixed restage",
  });
  mustOk(
    await record(sensitiveV2.step, op7, mixedRestageLease.leaseToken, {
      executionEffect: "write",
      result: { transactionId: mixedRestageTx },
      affectedRefs: [{ type: "transaction", id: mixedRestageTx }],
    }),
    "mixed restage sensitive v2 receipt",
  );
  const mixedRestageVerifying = await enterVerifying(
    op7.id,
    mixedRestageLease.stateVersion,
    mixedRestageLease.leaseToken,
  );
  const ordinaryV1VerifiedAfterV2 = await verifyAgentLoopStep({
    userId,
    operationId: op7.id,
    planVersion: ordinaryV1.planVersion,
    stepKey: ordinaryV1.step.stepKey,
    capability: ordinaryV1.step.capability,
    arguments: ordinaryV1.step.arguments,
    leaseToken: mixedRestageLease.leaseToken,
    postWriteContextVerified: true,
  });
  const sensitiveV2Verified = await verifyAgentLoopStep({
    userId,
    operationId: op7.id,
    planVersion: sensitiveV2.planVersion,
    stepKey: sensitiveV2.step.stepKey,
    capability: sensitiveV2.step.capability,
    arguments: sensitiveV2.step.arguments,
    leaseToken: mixedRestageLease.leaseToken,
    postWriteContextVerified: true,
  });
  const mixedRestageManifestVerified = await verifyAgentLoopManifest({
    userId,
    operationId: op7.id,
    planVersion: sensitiveV2.planVersion,
    leaseToken: mixedRestageLease.leaseToken,
  });
  const mixedRestageCompleted = await complete(
    op7.id,
    mixedRestageVerifying.stateVersion,
    mixedRestageLease.leaseToken,
    { probe: "M116.7" },
  );
  const mixedRestageFinal = must(
    await admin
      .from("agent_operations")
      .select("status,plan_version,agent_operation_steps(plan_version,step_key,status)")
      .eq("id", op7.id)
      .single(),
    "mixed restage final state",
  );
  check(
    "M116.7 · MIXTO v1→reject→restage v2 verifica el ordinary v1 y no deja applied",
    ordinaryV1.planVersion === 1 &&
      sensitiveV1.planVersion === 1 &&
      rejectedV1.planVersion === 1 &&
      sensitiveV2.planVersion === 2 &&
      ordinaryV1VerifiedAfterV2.ok &&
      sensitiveV2Verified.ok &&
      mixedRestageManifestVerified.ok &&
      mixedRestageCompleted.status === "completed" &&
      mixedRestageFinal.status === "completed" &&
      mixedRestageFinal.plan_version === 2 &&
      mixedRestageFinal.agent_operation_steps.every(
        (step) => step.status !== "applied",
      ),
    JSON.stringify({
      ordinaryV1VerifiedAfterV2,
      sensitiveV2Verified,
      mixedRestageManifestVerified,
      mixedRestageCompleted,
      mixedRestageFinal,
    }),
  );

  // M116.6 — universal undo sees the server marker across loop plan versions.
  const undoDelivery = `m116:undo:${randomUUID()}`;
  const undoOp = await claim(undoDelivery, "undo mixed operation");
  const undoStep = mustOk(
    await stage(undoOp, {
      expectedVersion: undoOp.stateVersion,
      deliveryKey: undoDelivery,
      leaseToken: undoOp.leaseToken,
      seq: 0,
      capability: "undo_agent_operation",
      arguments: { targetOperationId: op5.id },
      effectMode: "economic_event",
    }),
    "undo stage",
  );
  const undone = await reverseAgentOperation({
    userId,
    reversalOperationId: undoOp.id,
    targetOperationId: op5.id,
    stepKey: undoStep.step.stepKey,
    leaseToken: undoOp.leaseToken,
    message: "undo mixed operation",
    channel: "telegram",
  });

  const contextualUndoDelivery = `m116:contextual-undo:${randomUUID()}`;
  const contextualUndoOp = await claim(
    contextualUndoDelivery,
    "undo contextual money operation",
  );
  const contextualUndoStep = mustOk(
    await stage(contextualUndoOp, {
      expectedVersion: contextualUndoOp.stateVersion,
      deliveryKey: contextualUndoDelivery,
      leaseToken: contextualUndoOp.leaseToken,
      seq: 0,
      capability: "undo_agent_operation",
      arguments: { targetOperationId: op4d.id },
      effectMode: "economic_event",
    }),
    "contextual undo stage",
  );
  const contextualUndone = await reverseAgentOperation({
    userId,
    reversalOperationId: contextualUndoOp.id,
    targetOperationId: op4d.id,
    stepKey: contextualUndoStep.step.stepKey,
    leaseToken: contextualUndoOp.leaseToken,
    message: "undo contextual money operation",
    channel: "telegram",
  });

  // Partial corruption: one real economic receipt plus one missing economic
  // receipt. Undo must reject the whole target before reversing the good leg.
  const partialDelivery = `m116:partial-target:${randomUUID()}`;
  const partialOp = await claim(partialDelivery, "partial economic target");
  const partialGood = mustOk(
    await stage(partialOp, {
      expectedVersion: partialOp.stateVersion,
      deliveryKey: partialDelivery,
      leaseToken: partialOp.leaseToken,
      seq: 0,
      capability: "log_movement",
      arguments: { type: "expense", amount: 11, description: "partial good" },
      effectMode: "economic_event",
    }),
    "partial good stage",
  );
  const partialMissing = mustOk(
    await stage(partialOp, {
      expectedVersion: partialGood.stateVersion,
      deliveryKey: partialDelivery,
      leaseToken: partialOp.leaseToken,
      seq: 1,
      capability: "log_movement",
      arguments: { type: "expense", amount: 12, description: "partial missing" },
      effectMode: "economic_event",
    }),
    "partial missing stage",
  );
  const partialTx = await ledgerExpense({
    accountId: account.id,
    operationId: partialOp.id,
    stepKey: partialGood.step.stepKey,
    amount: 11,
    tag: "M116 partial good",
  });
  mustOk(
    await record(partialGood.step, partialOp, partialOp.leaseToken, {
      executionEffect: "write",
      result: { transactionId: partialTx },
      affectedRefs: [{ type: "transaction", id: partialTx }],
    }),
    "partial good receipt",
  );
  mustOk(
    await record(partialMissing.step, partialOp, partialOp.leaseToken, {
      executionEffect: "write",
      result: { deliberatelyMissing: true },
    }),
    "partial missing receipt",
  );
  await enterVerifying(
    partialOp.id,
    partialMissing.stateVersion,
    partialOp.leaseToken,
  );
  mustOk(
    await verifyAgentLoopStep({
      userId,
      operationId: partialOp.id,
      planVersion: partialGood.planVersion,
      stepKey: partialGood.step.stepKey,
      capability: partialGood.step.capability,
      arguments: partialGood.step.arguments,
      leaseToken: partialOp.leaseToken,
      postWriteContextVerified: true,
    }),
    "partial good verify",
  );
  const partialMissingRefused = await verifyAgentLoopStep({
    userId,
    operationId: partialOp.id,
    planVersion: partialMissing.planVersion,
    stepKey: partialMissing.step.stepKey,
    capability: partialMissing.step.capability,
    arguments: partialMissing.step.arguments,
    leaseToken: partialOp.leaseToken,
    postWriteContextVerified: true,
  });
  const partialUndoConsumerSmoke =
    migration116Source.includes(
      "effect->>'source' in ('capability_catalog','receipt')",
    ) &&
    migration116Source.includes(
      "v_helper_call text := 'public.kipu__agent_step_is_reversible_money_write(s.result,s.effects)'",
    ) &&
    migration116Source.includes(
      "v_gap_call text := 'public.kipu__agent_operation_receipt_gaps(v_target,v_target_is_correction)'",
    ) &&
    migration116Source.includes(
      "economic marker is not shared by every undo consumer",
    );
  const reversalRead = await admin
    .from("transactions")
    .select("id,original_amount,base_amount")
    .eq("type", "reversal")
    .eq("related_transaction_id", mixedTx);
  if (reversalRead.error) {
    throw new Error(`mixed reversal count: ${reversalRead.error.message}`);
  }
  const contextualReversalRead = await admin
    .from("transactions")
    .select("id,original_amount,base_amount")
    .eq("type", "reversal")
    .eq("related_transaction_id", contextualTx);
  if (contextualReversalRead.error) {
    throw new Error(`contextual reversal read: ${contextualReversalRead.error.message}`);
  }
  check(
    "M116.6 · undo valora receipts de catálogo/contextuales + barrera receipt-less + smoke del target parcial inalcanzable",
    undone.ok &&
      reversalRead.data.length === 1 &&
      Number(reversalRead.data[0].original_amount) === 9 &&
      Number(reversalRead.data[0].base_amount) === 9 &&
      contextualUndone.ok &&
      contextualReversalRead.data.length === 1 &&
      Number(contextualReversalRead.data[0].original_amount) === 6 &&
      Number(contextualReversalRead.data[0].base_amount) === 6 &&
      !partialMissingRefused.ok &&
      partialMissingRefused.reason.includes(
        "economic loop step lacks owned transaction receipts",
      ) &&
      partialUndoConsumerSmoke,
    JSON.stringify({
      undone,
      reversalRead: reversalRead.data,
      contextualUndone,
      contextualReversalRead: contextualReversalRead.data,
      partialMissingRefused,
      partialUndoConsumerSmoke,
    }),
  );
} catch (error) {
  failures.push("ABORT");
  console.error(boundedHarnessErrorText(error));
} finally {
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) failures.push(`cleanup auth: ${deleted.error.message}`);
    for (const [table, column] of touched) {
      const { count, error } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, userId);
      if (error || count == null) {
        failures.push(`LIMPIEZA ILEGIBLE · ${table}: ${error?.message ?? "count null"}`);
      } else if (count !== 0) {
        failures.push(`RESIDUO · ${table}: ${count}`);
      }
    }
  }
}

console.log(`M116 PostgreSQL probes: ${passed}/${executed}`);
if (failures.length > 0 || passed !== 7 || executed !== 7) {
  if (executed !== 7) failures.push(`COBERTURA INCOMPLETA ${executed}/7`);
  console.error(`FAILURES: ${failures.join(" | ") || "unknown"}`);
  process.exitCode = 1;
}
