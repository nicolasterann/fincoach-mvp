// M0-AM migration 123 disposable PostgreSQL probes.
// Run only after founder application:
//   node --env-file=.env.local ./scripts/qa/m0-loop-123-e2e.mjs

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
  transitionAgentOperation,
  verifyAgentLoopStep,
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

function boundedErrorText(error) {
  const message = error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
  return JSON.stringify({ message: message.slice(0, 260) });
}
function canonicalText(value) {
  return JSON.stringify(value)?.slice(0, 400) ?? "null";
}

async function stagedApplied(tag, resultShape) {
  const deliveryKey = `m123:${tag}:${randomUUID()}`;
  const root = await rootMessage(deliveryKey, `m123 ${tag}`);
  const operation = mustOk(
    await claimAgentOperation({
      userId,
      deliveryKey,
      channel: "telegram",
      chatId,
      rootMessageId: root.id,
      requestText: `m123 ${tag}`,
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
      capability: "register_card_payment",
      arguments: { cardName: `Tarjeta ${tag}`, paidInFull: true },
      effectMode: "economic_event",
    }),
    `stage ${tag}`,
  );
  mustOk(
    await recordAgentOperationStepOutcome({
      userId,
      operationId: operation.id,
      stepKey: staged.step.stepKey,
      capability: "register_card_payment",
      arguments: staged.step.arguments,
      toolStatus: "done",
      executionEffect: resultShape.execution_effect === "write" ? "write" : "noop",
      result: resultShape,
      affectedRefs: [],
      leaseToken: operation.leaseToken,
    }),
    `outcome ${tag}`,
  );
  const verifying = mustOk(
    await transitionAgentOperation({
      userId,
      operationId: operation.id,
      expectedVersion: staged.stateVersion,
      status: "verifying",
      leaseToken: operation.leaseToken,
    }),
    `verifying ${tag}`,
  );
  return { operation: { ...operation, stateVersion: verifying.stateVersion }, staged };
}

try {
  const created = must(
    await admin.auth.admin.createUser({
      email: `kipu-m123-${Date.now()}-${randomUUID()}@example.invalid`,
      email_confirm: true,
      user_metadata: { kipu_m123_probe: true },
    }),
    "create disposable user",
  );
  userId = created.user.id;
  must(await admin.from("profiles").upsert({ id: userId, base_currency: "USD", onboarding_completed: true }), "profile");
  must(await admin.from("user_engagement").upsert({ user_id: userId, timezone: "America/Guayaquil" }), "engagement");

  // M123.1 · noop coherente VERIFICA
  const noop = await stagedApplied("noop", {
    tool_status: "done",
    execution_effect: "noop",
    summary: "El estado vigente ya figura cubierto.",
    data: { noop: true, statementAlreadyCovered: true },
  });
  const verifiedNoop = await verifyAgentLoopStep({
    userId,
    operationId: noop.operation.id,
    planVersion: noop.staged.planVersion,
    stepKey: noop.staged.step.stepKey,
    capability: "register_card_payment",
    arguments: noop.staged.step.arguments,
    leaseToken: noop.operation.leaseToken,
    postWriteContextVerified: true,
  });
  check(
    "M123.1 · un paso económico con noop declarado y cero recibos VERIFICA (nada esperado, nada encontrado)",
    verifiedNoop.ok === true,
    canonicalText(verifiedNoop),
  );

  // M123.2 · económico SIN noop y sin recibos sigue rehusando
  const missing = await stagedApplied("missing", {
    tool_status: "done",
    execution_effect: "write",
    summary: "Pagué la tarjeta.",
    data: {},
  });
  const missingVerify = await verifyAgentLoopStep({
    userId,
    operationId: missing.operation.id,
    planVersion: missing.staged.planVersion,
    stepKey: missing.staged.step.stepKey,
    capability: "register_card_payment",
    arguments: missing.staged.step.arguments,
    leaseToken: missing.operation.leaseToken,
    postWriteContextVerified: true,
  });
  check(
    "M123.2 · un paso económico sin noop y sin recibos sigue muriendo en KIPU_EFFECT_MISSING",
    missingVerify.ok === false && /KIPU_EFFECT_MISSING/.test(String(missingVerify.reason ?? "")),
    canonicalText(missingVerify),
  );

  // M123.3 · un noop que RECLAMA write sigue rehusando
  const lyingNoop = await stagedApplied("lying", {
    tool_status: "done",
    execution_effect: "write",
    summary: "No hice nada pero digo write.",
    data: { noop: true },
  });
  const lyingVerify = await verifyAgentLoopStep({
    userId,
    operationId: lyingNoop.operation.id,
    planVersion: lyingNoop.staged.planVersion,
    stepKey: lyingNoop.staged.step.stepKey,
    capability: "register_card_payment",
    arguments: lyingNoop.staged.step.arguments,
    leaseToken: lyingNoop.operation.leaseToken,
    postWriteContextVerified: true,
  });
  check(
    "M123.3 · un noop que reclama efecto write sigue muriendo (el agujero no se abre)",
    lyingVerify.ok === false && /KIPU_EFFECT_MISSING/.test(String(lyingVerify.reason ?? "")),
    canonicalText(lyingVerify),
  );

  // M123.4 · replay del verificado conserva
  const replay = await verifyAgentLoopStep({
    userId,
    operationId: noop.operation.id,
    planVersion: noop.staged.planVersion,
    stepKey: noop.staged.step.stepKey,
    capability: "register_card_payment",
    arguments: noop.staged.step.arguments,
    leaseToken: noop.operation.leaseToken,
    postWriteContextVerified: true,
  });
  check(
    "M123.4 · re-verificar el noop verificado es replay idempotente",
    replay.ok === true,
    canonicalText(replay),
  );
} catch (error) {
  failures.push("ABORT");
  console.error(boundedErrorText(error));
} finally {
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) failures.push(`cleanup auth: ${boundedErrorText(deleted.error)}`);
    for (const [table, identityColumn] of touched) {
      const read = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(identityColumn, userId);
      if (read.error || read.count == null) {
        failures.push(`LIMPIEZA ILEGIBLE · ${table}: ${boundedErrorText(read.error ?? { message: "count null" })}`);
      } else if (read.count !== 0) {
        failures.push(`RESIDUO · ${table}: ${read.count}`);
      }
    }
  }
}

console.log(`M123 PostgreSQL probes: ${passed}/${executed}`);
if (failures.length > 0 || passed !== 4 || executed !== 4) {
  if (executed !== 4) failures.push(`COBERTURA INCOMPLETA ${executed}/4`);
  console.error(`FAILURES: ${failures.join(" | ") || "unknown"}`);
  process.exitCode = 1;
}
