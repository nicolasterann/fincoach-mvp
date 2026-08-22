// M0-AM migration 121 disposable PostgreSQL probes.
// Run only after founder application:
//   node --env-file=.env.local ./scripts/qa/m0-loop-121-e2e.mjs

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
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
if (!url || !serviceKey) throw new Error("HARNESS_ENV/MISSING_SUPABASE_CREDENTIALS");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const {
  claimAgentOperation,
  quarantineAgentLoopOperation,
  recordAgentOperationStepOutcome,
  stageAgentLoopStep,
} = await import("@/lib/ai/agent/agent-operation-store");

let userId = null;
let passed = 0;
let executed = 0;
const failures = [];
const chatId = `m121-${randomUUID()}`;
const rootMessages = new Map();
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

function bounded(error) {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack?.split("\n", 1)[0] };
  }
  const row = error && typeof error === "object" ? error : {};
  return {
    code: typeof row.code === "string" ? row.code : null,
    message: typeof row.message === "string" ? row.message : String(error),
    details: typeof row.details === "string" ? row.details : null,
    hint: typeof row.hint === "string" ? row.hint : null,
  };
}

function must(result, label) {
  if (result?.error) throw new Error(`${label}: ${JSON.stringify(bounded(result.error))}`);
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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

async function rootMessage(key, text, targetChatId = chatId) {
  const cacheKey = `${targetChatId}:${key}`;
  let row = rootMessages.get(cacheKey);
  if (!row) {
    row = must(
      await admin
        .from("chat_messages")
        .insert({
          user_id: userId,
          role: "user",
          content: text,
          channel: "telegram",
          chat_id: targetChatId,
          metadata: { source: "m121-e2e" },
        })
        .select("id")
        .single(),
      `root ${key}`,
    );
    rootMessages.set(cacheKey, row);
  }
  return row;
}

async function createManifestless(tag) {
  const deliveryKey = `m121:${tag}:claim:${randomUUID()}`;
  const root = await rootMessage(deliveryKey, `prepare ${tag}`);
  const operation = mustOk(
    await claimAgentOperation({
      userId,
      deliveryKey,
      channel: "telegram",
      chatId,
      rootMessageId: root.id,
      requestText: `prepare ${tag}`,
    }),
    `claim ${tag}`,
  );
  const staged = mustOk(
    await stageAgentLoopStep({
      userId,
      operationId: operation.id,
      expectedVersion: operation.stateVersion,
      deliveryKey,
      leaseToken: operation.leaseToken,
      seq: 0,
      capability: "log_movement",
      arguments: {
        type: "expense",
        amount: 12.34,
        currency: "USD",
        description: `M121 ${tag}`,
        sourceAccountId: randomUUID(),
      },
      effectMode: "economic_event",
    }),
    `stage ${tag}`,
  );
  return { deliveryKey, root, operation, staged };
}

async function stepRows(operationId) {
  return must(
    await admin
      .from("agent_operation_steps")
      .select(
        "id,plan_version,step_order,step_key,status,capability,arguments,arguments_fingerprint,state_witness,effects,postconditions,resolved_type,resolved_payload,resolved_fingerprint,result,affected_refs,error,preflighted_at,applied_at,verified_at,created_at,updated_at",
      )
      .eq("operation_id", operationId)
      .order("plan_version")
      .order("step_order"),
    "read steps",
  );
}

async function operationRow(operationId) {
  return must(
    await admin
      .from("agent_operations")
      .select("status,state_version,lease_token,lease_expires_at,last_error")
      .eq("id", operationId)
      .single(),
    "read operation",
  );
}

async function run() {
  const email = `m121-${randomUUID()}@example.invalid`;
  const created = must(
    await admin.auth.admin.createUser({
      email,
      password: `M121-${randomUUID()}-Aa1!`,
      email_confirm: true,
      user_metadata: { source: "m121-e2e" },
    }),
    "create user",
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

  console.log("M121.1 · manifest-less worker quarantine");
  const first = await createManifestless("worker");
  const beforeFirst = await stepRows(first.operation.id);
  const firstQuarantine = mustOk(
    await quarantineAgentLoopOperation({
      userId,
      operationId: first.operation.id,
      expectedVersion: first.staged.stateVersion,
      planVersion: first.staged.planVersion,
      deliveryKey: first.deliveryKey,
      rootMessageId: first.root.id,
      channel: "telegram",
      chatId,
      leaseToken: first.operation.leaseToken,
      reasonCode: "claim_failure",
    }),
    "worker quarantine",
  );
  const afterFirst = await stepRows(first.operation.id);
  const firstOp = await operationRow(first.operation.id);
  check(
    "M121.1",
    firstQuarantine.manifestId === null &&
      firstQuarantine.verification.manifest_present === false &&
      firstQuarantine.verification.inflight_count === 1 &&
      firstOp.status === "abandoned" &&
      firstOp.last_error?.code === "failed_quarantined" &&
      digest(beforeFirst) === digest(afterFirst),
    JSON.stringify({ firstQuarantine, firstOp }),
  );

  console.log("M121.2 · exact replay and divergent meaning");
  const replay = mustOk(
    await quarantineAgentLoopOperation({
      userId,
      operationId: first.operation.id,
      expectedVersion: first.staged.stateVersion,
      planVersion: first.staged.planVersion,
      deliveryKey: first.deliveryKey,
      rootMessageId: first.root.id,
      channel: "telegram",
      chatId,
      leaseToken: first.operation.leaseToken,
      reasonCode: "claim_failure",
    }),
    "quarantine replay",
  );
  const divergent = await admin.rpc("kipu_quarantine_agent_loop_operation", {
    p: {
      user_id: userId,
      operation_id: first.operation.id,
      expected_version: first.staged.stateVersion,
      plan_version: first.staged.planVersion,
      delivery_key: first.deliveryKey,
      root_message_id: first.root.id,
      channel: "telegram",
      chat_id: chatId,
      lease_token: first.operation.leaseToken,
      reason_code: "user_abandoned",
    },
  });
  check(
    "M121.2",
    replay.replayed === true &&
      divergent.error?.message?.includes("KIPU_DEDUPE_MISMATCH") === true,
    JSON.stringify({ replay, divergent: bounded(divergent.error) }),
  );

  console.log("M121.3 · healthy lease protected; terminal step authorizes");
  const protectedFixture = await createManifestless("protected");
  const refusedHealthy = await quarantineAgentLoopOperation({
    userId,
    operationId: protectedFixture.operation.id,
    expectedVersion: protectedFixture.staged.stateVersion,
    planVersion: protectedFixture.staged.planVersion,
    deliveryKey: `${protectedFixture.deliveryKey}:cancel`,
    rootMessageId: protectedFixture.root.id,
    channel: "telegram",
    chatId,
    reasonCode: "user_abandoned",
  });
  mustOk(
    await recordAgentOperationStepOutcome({
      userId,
      operationId: protectedFixture.operation.id,
      stepKey: protectedFixture.staged.step.stepKey,
      capability: "log_movement",
      arguments: protectedFixture.staged.step.arguments,
      toolStatus: "refused",
      executionEffect: "needs_info",
      result: { summary: "M121 terminal fixture" },
      leaseToken: protectedFixture.operation.leaseToken,
    }),
    "terminal fixture",
  );
  const terminalBefore = await stepRows(protectedFixture.operation.id);
  const terminalQuarantine = mustOk(
    await quarantineAgentLoopOperation({
      userId,
      operationId: protectedFixture.operation.id,
      expectedVersion: protectedFixture.staged.stateVersion,
      planVersion: protectedFixture.staged.planVersion,
      deliveryKey: `${protectedFixture.deliveryKey}:terminal-cancel`,
      rootMessageId: protectedFixture.root.id,
      channel: "telegram",
      chatId,
      reasonCode: "user_abandoned",
    }),
    "terminal quarantine",
  );
  const terminalAfter = await stepRows(protectedFixture.operation.id);
  check(
    "M121.3",
    !refusedHealthy.ok &&
      refusedHealthy.reason.includes("no terminal blocker") &&
      terminalQuarantine.verification.terminal_count === 1 &&
      digest(terminalBefore) === digest(terminalAfter),
    JSON.stringify({ refusedHealthy, terminalQuarantine }),
  );

  console.log("M121.4 · conversation ownership");
  const ownershipFixture = await createManifestless("ownership");
  const otherRoot = await rootMessage("other-chat", "other chat", `${chatId}:other`);
  const ownership = await quarantineAgentLoopOperation({
    userId,
    operationId: ownershipFixture.operation.id,
    expectedVersion: ownershipFixture.staged.stateVersion,
    planVersion: ownershipFixture.staged.planVersion,
    deliveryKey: `${ownershipFixture.deliveryKey}:wrong-chat`,
    rootMessageId: otherRoot.id,
    channel: "telegram",
    chatId: `${chatId}:other`,
    leaseToken: ownershipFixture.operation.leaseToken,
    reasonCode: "claim_failure",
  });
  check(
    "M121.4",
    !ownership.ok && ownership.detail === "KIPU_OWNERSHIP",
    JSON.stringify(ownership),
  );
}

async function cleanup() {
  if (!userId) return;
  await admin.auth.admin.deleteUser(userId);
}

async function residue() {
  if (!userId) return [];
  const rows = [];
  for (const [table, key] of touched) {
    const result = await admin
      .from(table)
      .select(key, { count: "exact", head: true })
      .eq(key, userId);
    rows.push({ table, count: result.count ?? -1, error: result.error?.message ?? null });
  }
  return rows;
}

try {
  await run();
} catch (error) {
  failures.push("HARNESS_ABORT");
  console.error(`HARNESS_ABORT=${JSON.stringify(bounded(error))}`);
} finally {
  await cleanup();
  const remaining = await residue();
  const dirty = remaining.filter((row) => row.error || row.count !== 0);
  console.log(`M121_RESIDUE=${JSON.stringify(remaining)}`);
  if (dirty.length > 0) failures.push("RESIDUE");
}

console.log(`M121_RESULT=${passed}/${executed}`);
if (failures.length > 0 || passed !== 4 || executed !== 4) {
  console.error(`M121_FAILURES=${JSON.stringify(failures)}`);
  process.exit(1);
}
console.log("M121_OK=4/4");
