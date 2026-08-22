// M0-AM B5 — inspect/release the single founder operation authorized in A52.
//
// Default is read-only:
//   node --env-file=.env.local scripts/qa/m0-model-authority-release-stuck-operation.mjs
// After migration 121 is applied:
//   node --env-file=.env.local scripts/qa/m0-model-authority-release-stuck-operation.mjs --release

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TARGET = {
  userId: "e8b79a2f-7795-417d-bac2-3c79a95f1ee3",
  operationId: "cecdeada-d555-4d73-98d4-247f2ec4a943",
  planVersion: 1,
  channel: "telegram",
  chatId: "8709737923",
  cancellationRootMessageId: "d0aae361-64b6-4762-8cfc-19c13a717847",
  deliveryKey: "m121:founder-release:cecdeada:v1",
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("HARNESS_ENV/MISSING_SUPABASE_CREDENTIALS");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const release = process.argv.includes("--release");

function boundedError(error) {
  const row = error && typeof error === "object" ? error : {};
  return {
    code: typeof row.code === "string" ? row.code : null,
    message: typeof row.message === "string" ? row.message : String(error),
    details: typeof row.details === "string" ? row.details : null,
    hint: typeof row.hint === "string" ? row.hint : null,
  };
}

function must(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${JSON.stringify(boundedError(result.error))}`);
  }
  return result.data;
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

async function snapshot() {
  const operation = must(
    await admin
      .from("agent_operations")
      .select(
        "id,user_id,status,state_version,plan_version,channel,chat_id,lease_token,lease_expires_at,pending_question,last_error,plan",
      )
      .eq("id", TARGET.operationId)
      .eq("user_id", TARGET.userId)
      .single(),
    "READ_OPERATION",
  );
  const steps = must(
    await admin
      .from("agent_operation_steps")
      .select(
        "id,plan_version,step_order,step_key,status,capability,arguments,arguments_fingerprint,state_witness,effects,postconditions,resolved_type,resolved_payload,resolved_fingerprint,result,affected_refs,error,preflighted_at,applied_at,verified_at,created_at,updated_at",
      )
      .eq("operation_id", TARGET.operationId)
      .order("plan_version")
      .order("step_order"),
    "READ_STEPS",
  );
  const manifests = must(
    await admin
      .from("agent_operation_manifests")
      .select("id,plan_version,status,verification")
      .eq("operation_id", TARGET.operationId),
    "READ_MANIFESTS",
  );
  return {
    operation,
    steps,
    manifests,
    stepBytesDigest: digest(steps),
  };
}

try {
  const before = await snapshot();
  console.log(`B5_MODE=${release ? "release" : "inspect"}`);
  console.log(`B5_BEFORE=${JSON.stringify(before)}`);
  if (!release) {
    console.log("B5_READ_ONLY_OK=1");
    process.exit(0);
  }
  if (
    before.operation.status !== "applying" ||
    before.operation.state_version !== 2 ||
    before.operation.plan_version !== TARGET.planVersion ||
    JSON.stringify(before.operation.plan) !== JSON.stringify({ mode: "loop" }) ||
    before.manifests.length !== 0 ||
    before.steps.length !== 1 ||
    before.steps[0].status !== "preflighted" ||
    before.steps[0].capability !== "log_movement" ||
    before.steps[0].result !== null ||
    before.steps[0].affected_refs.length !== 0
  ) {
    throw new Error("B5_CONTRACT/REAL_OPERATION_SHAPE_CHANGED");
  }
  const root = must(
    await admin
      .from("chat_messages")
      .select("id,user_id,role,channel,chat_id")
      .eq("id", TARGET.cancellationRootMessageId)
      .single(),
    "READ_CANCELLATION_ROOT",
  );
  if (
    root.user_id !== TARGET.userId ||
    root.role !== "user" ||
    root.channel !== TARGET.channel ||
    root.chat_id !== TARGET.chatId
  ) {
    throw new Error("B5_OWNERSHIP/CANCELLATION_ROOT_MISMATCH");
  }
  const quarantined = must(
    await admin.rpc("kipu_quarantine_agent_loop_operation", {
      p: {
        user_id: TARGET.userId,
        operation_id: TARGET.operationId,
        expected_version: before.operation.state_version,
        plan_version: TARGET.planVersion,
        delivery_key: TARGET.deliveryKey,
        root_message_id: TARGET.cancellationRootMessageId,
        channel: TARGET.channel,
        chat_id: TARGET.chatId,
        lease_token: null,
        reason_code: "user_abandoned",
      },
    }),
    "QUARANTINE_REAL_OPERATION",
  );
  const after = await snapshot();
  if (
    quarantined?.outcome !== "quarantined" ||
    quarantined?.status !== "abandoned" ||
    quarantined?.verification?.kind !== "loop_quarantined" ||
    quarantined?.verification?.manifest_present !== false ||
    after.operation.status !== "abandoned" ||
    after.operation.last_error?.code !== "failed_quarantined" ||
    after.operation.last_error?.reason_code !== "user_abandoned" ||
    after.operation.lease_token !== null ||
    after.operation.lease_expires_at !== null ||
    after.stepBytesDigest !== before.stepBytesDigest
  ) {
    throw new Error("B5_POSTCONDITION/QUARANTINE_MISMATCH");
  }
  console.log(`B5_RPC=${JSON.stringify(quarantined)}`);
  console.log(`B5_AFTER=${JSON.stringify(after)}`);
  console.log("B5_RELEASE_OK=1");
} catch (error) {
  console.error(
    `B5_FAILURE=${JSON.stringify(
      error instanceof Error
        ? { message: error.message, stack: error.stack?.split("\n", 1)[0] }
        : boundedError(error),
    )}`,
  );
  process.exit(1);
}
