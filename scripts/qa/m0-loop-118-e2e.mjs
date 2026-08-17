// M0 native loop — migration 118 disposable PostgreSQL probes.
//
// Run only after migration 118 has been approved and applied:
//   node --env-file=.env.local ./scripts/qa/m0-loop-118-e2e.mjs

// Protected operation state is built exclusively through the public RPC
// lifecycle. The disposable auth identity owns every fixture and its deletion
// must leave every listed surface empty by its real primary identity column.

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

const {
  authorizeAgentOperationManifest,
  beginAgentOperationApplication,
  beginAgentOperationManifest,
  claimAgentOperation,
  quarantineAgentLoopOperation,
  recordAgentOperationStepOutcome,
  registerAgentLoopManifest,
  stageAgentLoopStep,
} = await import("@/lib/ai/agent/agent-operation-store");

let userId = null;
let passed = 0;
let executed = 0;
const failures = [];
const rootMessages = new Map();
const chatId = "m118-probe";
const touched = [
  ["agent_operation_transition_events", "user_id"],
  ["agent_operation_manifests", "user_id"],
  ["agent_operation_steps", "user_id"],
  ["agent_operation_deliveries", "user_id"],
  ["agent_operations", "user_id"],
  ["chat_messages", "user_id"],
  ["user_engagement", "user_id"],
  ["profiles", "id"],
];

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

async function rootMessage(key, text) {
  let row = rootMessages.get(key);
  if (!row) {
    row = must(
      await admin
        .from("chat_messages")
        .insert({
          user_id: userId,
          role: "user",
          content: text,
          channel: "telegram",
          chat_id: chatId,
          metadata: { source: "m118-e2e" },
        })
        .select("id")
        .single(),
      `root message ${key}`,
    );
    rootMessages.set(key, row);
  }
  return row;
}

async function claim(key, text, continuation = null, expectedVersion = null) {
  const root = await rootMessage(key, text);
  return mustOk(
    await claimAgentOperation({
      userId,
      deliveryKey: key,
      channel: "telegram",
      chatId,
      rootMessageId: root.id,
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

async function createExecutingOperation(tag, stepInputs) {
  const proposalDelivery = `m118:${tag}:proposal:${randomUUID()}`;
  const operation = await claim(proposalDelivery, `prepare ${tag}`);
  const staged = [];
  let stateVersion = operation.stateVersion;
  for (let index = 0; index < stepInputs.length; index += 1) {
    const input = stepInputs[index];
    const row = mustOk(
      await stageAgentLoopStep({
        userId,
        operationId: operation.id,
        expectedVersion: stateVersion,
        deliveryKey: proposalDelivery,
        leaseToken: operation.leaseToken,
        seq: index,
        capability: input.capability,
        arguments: input.arguments,
        effectMode: input.effectMode,
      }),
      `stage ${tag} ${index}`,
    );
    staged.push(row.step);
    stateVersion = row.stateVersion;
  }
  const proposed = mustOk(
    await registerAgentLoopManifest({
      userId,
      operationId: operation.id,
      expectedVersion: stateVersion,
      deliveryKey: proposalDelivery,
      leaseToken: operation.leaseToken,
      stepKeys: staged.map((step) => step.stepKey),
      confirmationPrompt: `Confirm ${tag}?`,
    }),
    `register ${tag}`,
  );
  const confirmationDelivery = `m118:${tag}:confirm:${randomUUID()}`;
  const confirmation = await claim(
    confirmationDelivery,
    `confirm ${tag}`,
    operation.id,
    proposed.stateVersion,
  );
  const authorized = mustOk(
    await authorizeAgentOperationManifest({
      userId,
      operationId: operation.id,
      expectedVersion: confirmation.stateVersion,
      deliveryKey: confirmationDelivery,
      leaseToken: confirmation.leaseToken,
      transition: {
        kind: "confirmed",
        target_operation_id: operation.id,
        consumed_pending_keys: ["operation_manifest"],
        remaining_pending_keys: [],
        rationale: `M118 confirms ${tag}.`,
      },
    }),
    `authorize ${tag}`,
  );
  const application = mustOk(
    await beginAgentOperationApplication({
      userId,
      operationId: operation.id,
      expectedVersion: authorized.stateVersion,
    }),
    `begin application ${tag}`,
  );
  mustOk(
    await beginAgentOperationManifest({
      userId,
      operationId: operation.id,
      planVersion: proposed.planVersion,
      leaseToken: application.leaseToken,
    }),
    `begin manifest ${tag}`,
  );
  return {
    operation,
    proposed,
    application,
    staged,
  };
}

async function record(operationId, leaseToken, step, input) {
  return mustOk(
    await recordAgentOperationStepOutcome({
      userId,
      operationId,
      stepKey: step.stepKey,
      capability: step.capability,
      arguments: step.arguments,
      toolStatus: input.toolStatus,
      executionEffect: input.executionEffect,
      result: input.result,
      affectedRefs: input.affectedRefs ?? [],
      leaseToken,
    }),
    `record ${step.stepKey}`,
  );
}

async function operationSteps(operationId) {
  return must(
    await admin
      .from("agent_operation_steps")
      .select("*")
      .eq("operation_id", operationId)
      .order("plan_version")
      .order("step_order")
      .order("id"),
    `steps ${operationId}`,
  );
}

async function quarantine(input) {
  const root = await rootMessage(input.deliveryKey, input.text);
  return quarantineAgentLoopOperation({
    userId,
    operationId: input.operationId,
    expectedVersion: input.expectedVersion,
    planVersion: input.planVersion,
    deliveryKey: input.deliveryKey,
    rootMessageId: root.id,
    channel: "telegram",
    chatId,
    leaseToken: input.leaseToken,
    reasonCode: input.reasonCode,
  });
}

try {
  const created = must(
    await admin.auth.admin.createUser({
      email: `kipu-m118-${Date.now()}-${randomUUID()}@example.invalid`,
      email_confirm: true,
      user_metadata: { kipu_m118_probe: true },
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
  must(
    await admin.from("user_engagement").upsert({
      user_id: userId,
      timezone: "America/Argentina/Buenos_Aires",
    }),
    "engagement",
  );

  // M118.1 — build the same shape as the founder incident through legal RPCs:
  // one verified read receipt beside one terminal needs_input receipt.
  const first = await createExecutingOperation("terminal", [
    {
      capability: "get_financial_context",
      arguments: {},
      effectMode: "read",
    },
    {
      capability: "resolve_recurring_occurrence",
      arguments: { occurrenceId: randomUUID(), action: "confirm" },
      effectMode: "contextual_event",
    },
  ]);
  await record(
    first.operation.id,
    first.application.leaseToken,
    first.staged[0],
    {
      toolStatus: "done",
      executionEffect: "read",
      result: { summary: "M118 verified read receipt" },
    },
  );
  await record(
    first.operation.id,
    first.application.leaseToken,
    first.staged[1],
    {
      toolStatus: "needs_info",
      executionEffect: "needs_info",
      result: { summary: "M118 terminal receipt" },
    },
  );
  const firstStepsBefore = await operationSteps(first.operation.id);
  const quarantineDelivery = `m118:terminal:quarantine:${randomUUID()}`;
  const firstQuarantine = mustOk(
    await quarantine({
      deliveryKey: quarantineDelivery,
      text: "recover the terminal operation",
      operationId: first.operation.id,
      expectedVersion: first.application.stateVersion,
      planVersion: first.proposed.planVersion,
      leaseToken: first.application.leaseToken,
      reasonCode: "terminal_step",
    }),
    "quarantine terminal operation",
  );
  const [firstOperation, firstManifest, firstStepsAfter] = await Promise.all([
    admin
      .from("agent_operations")
      .select(
        "status,state_version,plan_version,last_error,last_operation_transition,lease_token,lease_expires_at,pending_question,missing_fields,semantic_stall_count,completed_at",
      )
      .eq("id", first.operation.id)
      .single(),
    admin
      .from("agent_operation_manifests")
      .select("id,status,verification")
      .eq("operation_id", first.operation.id)
      .eq("plan_version", first.proposed.planVersion)
      .single(),
    operationSteps(first.operation.id),
  ]);
  const firstOperationRow = must(firstOperation, "quarantined operation");
  const firstManifestRow = must(firstManifest, "quarantined manifest");
  check(
    "M118.1 · cuarentena real cierra estado exacto y conserva steps/receipts byte-intactos",
    firstQuarantine.replayed === false &&
      firstQuarantine.status === "abandoned" &&
      firstOperationRow.status === "abandoned" &&
      firstOperationRow.plan_version === first.proposed.planVersion &&
      firstOperationRow.last_error?.code === "failed_quarantined" &&
      firstOperationRow.last_error?.reason_code === "terminal_step" &&
      firstOperationRow.last_error?.manifest_id === firstManifestRow.id &&
      firstOperationRow.last_operation_transition?.kind === "abandoned" &&
      firstOperationRow.last_operation_transition?.reason_code === "terminal_step" &&
      firstOperationRow.lease_token == null &&
      firstOperationRow.lease_expires_at == null &&
      firstOperationRow.pending_question == null &&
      isDeepStrictEqual(firstOperationRow.missing_fields, []) &&
      Number(firstOperationRow.semantic_stall_count) === 0 &&
      firstOperationRow.completed_at == null &&
      firstManifestRow.status === "failed_integrity" &&
      firstManifestRow.verification?.kind === "loop_quarantined" &&
      firstManifestRow.verification?.reason_code === "terminal_step" &&
      Number(firstManifestRow.verification?.authorized_count) === 2 &&
      Number(firstManifestRow.verification?.verified_count) === 1 &&
      Number(firstManifestRow.verification?.applied_count) === 0 &&
      Number(firstManifestRow.verification?.terminal_count) === 1 &&
      Number(firstManifestRow.verification?.inflight_count) === 0 &&
      isDeepStrictEqual(firstStepsAfter, firstStepsBefore),
    JSON.stringify({
      firstQuarantine,
      operation: firstOperationRow,
      manifest: firstManifestRow,
      firstStepsBefore,
      firstStepsAfter,
    }),
  );

  // M118.2 — replay is checked before CAS, but a second meaning under the
  // exact synthetic event identity remains a typed dedupe failure.
  const replay = mustOk(
    await quarantine({
      deliveryKey: quarantineDelivery,
      text: "recover the terminal operation",
      operationId: first.operation.id,
      expectedVersion: first.application.stateVersion,
      planVersion: first.proposed.planVersion,
      leaseToken: first.application.leaseToken,
      reasonCode: "terminal_step",
    }),
    "quarantine exact replay",
  );
  const divergent = await quarantine({
    deliveryKey: quarantineDelivery,
    text: "recover the terminal operation",
    operationId: first.operation.id,
    expectedVersion: first.application.stateVersion,
    planVersion: first.proposed.planVersion,
    leaseToken: first.application.leaseToken,
    reasonCode: "resume_failure",
  });
  const eventDelivery = `${quarantineDelivery}:quarantine:v${first.proposed.planVersion}`;
  const eventCountRead = await admin
    .from("agent_operation_transition_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("delivery_key", eventDelivery);
  if (eventCountRead.error || eventCountRead.count == null) {
    throw new Error(
      `quarantine event count: ${boundedHarnessErrorText(
        eventCountRead.error ?? { message: "count null" },
      )}`,
    );
  }
  check(
    "M118.2 · replay exacto es idempotente y significado divergente rehúsa KIPU_DEDUPE_MISMATCH",
    replay.replayed === true &&
      replay.id === firstQuarantine.id &&
      replay.stateVersion === firstQuarantine.stateVersion &&
      replay.manifestId === firstQuarantine.manifestId &&
      replay.manifestHash === firstQuarantine.manifestHash &&
      isDeepStrictEqual(replay.verification, firstQuarantine.verification) &&
      divergent.ok === false &&
      divergent.detail === "KIPU_DEDUPE_MISMATCH" &&
      divergent.reason.includes("quarantine replay changed meaning") &&
      eventCountRead.count === 1,
    JSON.stringify({ replay, divergent, eventCount: eventCountRead.count }),
  );

  // M118.3 — an unrelated delivery without the exact live worker lease cannot
  // quarantine healthy work for any subjective recovery reason. Once the RPC
  // itself records a terminal step, the objective blocker authorizes closure
  // even though that unrelated delivery still has no worker lease.
  const protectedOperation = await createExecutingOperation("protected", [
    {
      capability: "resolve_recurring_occurrence",
      arguments: { occurrenceId: randomUUID(), action: "confirm" },
      effectMode: "contextual_event",
    },
  ]);
  const protectedFailures = [];
  for (const reasonCode of [
    "resume_failure",
    "claim_failure",
    "repeated_turn_failure",
  ]) {
    protectedFailures.push(
      await quarantine({
        deliveryKey: `m118:protected:${reasonCode}:${randomUUID()}`,
        text: `foreign ${reasonCode}`,
        operationId: protectedOperation.operation.id,
        expectedVersion: protectedOperation.application.stateVersion,
        planVersion: protectedOperation.proposed.planVersion,
        leaseToken: null,
        reasonCode,
      }),
    );
  }
  const protectedBeforeTerminal = must(
    await admin
      .from("agent_operations")
      .select("status,lease_token,lease_expires_at")
      .eq("id", protectedOperation.operation.id)
      .single(),
    "protected operation before terminal",
  );
  await record(
    protectedOperation.operation.id,
    protectedOperation.application.leaseToken,
    protectedOperation.staged[0],
    {
      toolStatus: "needs_info",
      executionEffect: "needs_info",
      result: { summary: "M118 objective terminal blocker" },
    },
  );
  const terminalStepsBefore = await operationSteps(protectedOperation.operation.id);
  const terminalOverride = mustOk(
    await quarantine({
      deliveryKey: `m118:protected:terminal:${randomUUID()}`,
      text: "foreign recovery after terminal blocker",
      operationId: protectedOperation.operation.id,
      expectedVersion: protectedOperation.application.stateVersion,
      planVersion: protectedOperation.proposed.planVersion,
      leaseToken: null,
      reasonCode: "resume_failure",
    }),
    "terminal blocker overrides foreign live lease",
  );
  const [protectedAfter, protectedManifest, terminalStepsAfter] = await Promise.all([
    admin
      .from("agent_operations")
      .select("status,last_error,lease_token")
      .eq("id", protectedOperation.operation.id)
      .single(),
    admin
      .from("agent_operation_manifests")
      .select("status,verification")
      .eq("operation_id", protectedOperation.operation.id)
      .eq("plan_version", protectedOperation.proposed.planVersion)
      .single(),
    operationSteps(protectedOperation.operation.id),
  ]);
  const protectedAfterRow = must(protectedAfter, "protected operation after terminal");
  const protectedManifestRow = must(protectedManifest, "protected manifest after terminal");
  check(
    "M118.3 · lease vivo ajeno protege executor sano y un terminal step autoriza cuarentena objetiva",
    protectedBeforeTerminal.status === "applying" &&
      protectedBeforeTerminal.lease_token === protectedOperation.application.leaseToken &&
      new Date(protectedBeforeTerminal.lease_expires_at).getTime() > Date.now() &&
      protectedFailures.every(
        (result) =>
          result.ok === false &&
          result.detail === "KIPU_VALIDATION" &&
          result.reason.includes("loop quarantine has no terminal blocker"),
      ) &&
      terminalOverride.replayed === false &&
      terminalOverride.status === "abandoned" &&
      protectedAfterRow.status === "abandoned" &&
      protectedAfterRow.last_error?.code === "failed_quarantined" &&
      protectedAfterRow.last_error?.reason_code === "resume_failure" &&
      protectedAfterRow.lease_token == null &&
      protectedManifestRow.status === "failed_integrity" &&
      protectedManifestRow.verification?.kind === "loop_quarantined" &&
      Number(protectedManifestRow.verification?.terminal_count) === 1 &&
      isDeepStrictEqual(terminalStepsAfter, terminalStepsBefore),
    JSON.stringify({
      protectedFailures,
      protectedBeforeTerminal,
      terminalOverride,
      protectedAfter: protectedAfterRow,
      protectedManifest: protectedManifestRow,
      terminalStepsBefore,
      terminalStepsAfter,
    }),
  );
} catch (error) {
  failures.push("ABORT");
  console.error(boundedHarnessErrorText(error));
} finally {
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) {
      failures.push(`cleanup auth: ${boundedHarnessErrorText(deleted.error)}`);
    }
    for (const [table, column] of touched) {
      const { count, error } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, userId);
      if (error || count == null) {
        failures.push(
          `LIMPIEZA ILEGIBLE · ${table}: ${boundedHarnessErrorText(
            error ?? { message: "count null" },
          )}`,
        );
      } else if (count !== 0) {
        failures.push(`RESIDUO · ${table}.${column}: ${count}`);
      }
    }
  }
}

console.log(`M118 PostgreSQL probes: ${passed}/${executed}`);
if (failures.length > 0 || passed !== 3 || executed !== 3) {
  if (executed !== 3) failures.push(`COBERTURA INCOMPLETA ${executed}/3`);
  console.error(`FAILURES: ${failures.join(" | ") || "unknown"}`);
  process.exitCode = 1;
}
