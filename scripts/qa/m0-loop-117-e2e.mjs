// M0 native loop — migration 117 disposable PostgreSQL probes.
//
// DO NOT RUN before migration 117 has been explicitly approved and applied:
//   node --env-file=.env.local ./scripts/qa/m0-loop-117-e2e.mjs

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
if (!url || !serviceKey) throw new Error("faltan credenciales Supabase");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const {
  authorizeAgentOperationManifest,
  beginAgentOperationApplication,
  beginAgentOperationManifest,
  claimAgentOperation,
  registerAgentLoopManifest,
  saveAgentOperationPlan,
  stageAgentLoopStep,
  transitionAgentOperation,
  verifyAgentLoopManifest,
  verifyAgentLoopStep,
} = await import("@/lib/ai/agent/agent-operation-store");
const { applyDebtProceeds } = await import(
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
  ["debt_proceeds_applications", "user_id"],
  ["agent_operation_steps", "user_id"],
  ["agent_operation_deliveries", "user_id"],
  ["agent_operations", "user_id"],
  ["chat_messages", "user_id"],
  ["transactions", "user_id"],
  ["debt_accounts", "user_id"],
  ["accounts", "user_id"],
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

const money = (value) => Math.round(Number(value) * 100) / 100;
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
const envelopePlan = (actions) => ({
  goal: "Execute the exact debt-proceeds instruction",
  interpretation: "Execute the exact debt-proceeds instruction",
  assertions: [],
  ambiguities: [],
  required_reads: [],
  actions,
  postconditions: [],
  response_intent: "act",
  requires_replan_after_reads: false,
});

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
          chat_id: "m117-probe",
          metadata: { source: "m117-e2e" },
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
      chatId: "m117-probe",
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

async function balances(accountId, debtAccountId) {
  const [account, debt] = await Promise.all([
    admin
      .from("accounts")
      .select("current_balance_original,current_balance_base")
      .eq("id", accountId)
      .single(),
    admin
      .from("debt_accounts")
      .select("current_balance_original,current_balance_base")
      .eq("id", debtAccountId)
      .single(),
  ]);
  return {
    account: must(account, "account balance"),
    debt: must(debt, "debt balance"),
  };
}

try {
  const created = must(
    await admin.auth.admin.createUser({
      email: `kipu-m117-${Date.now()}-${randomUUID()}@example.invalid`,
      email_confirm: true,
      user_metadata: { kipu_m117_probe: true },
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
  const account = must(
    await admin
      .from("accounts")
      .insert({
        user_id: userId,
        name: "Produbanco M117",
        type: "bank",
        currency: "USD",
        current_balance_original: 1000,
        current_balance_base: 1000,
        is_currency_default: true,
      })
      .select("id")
      .single(),
    "account",
  );
  const debt = must(
    await admin
      .from("debt_accounts")
      .insert({
        user_id: userId,
        name: "Alpaca M117",
        type: "loan",
        currency: "USD",
        current_balance_original: 0,
        current_balance_base: 0,
      })
      .select("id")
      .single(),
    "debt",
  );

  const initial = await balances(account.id, debt.id);
  const proposalDelivery = `m117:proposal:${randomUUID()}`;
  const operation = await claim(
    proposalDelivery,
    "Alpaca me prestó 83.86 USD y entraron a Produbanco.",
  );
  const argumentsRow = {
    direction: "in",
    amount: 83.86,
    person: "Alpaca M117",
    inflowKind: "borrowed",
    accountId: account.id,
    debtAccountId: debt.id,
    occurredAtISO: "2026-08-15",
  };
  const staged = mustOk(
    await stageAgentLoopStep({
      userId,
      operationId: operation.id,
      expectedVersion: operation.stateVersion,
      deliveryKey: proposalDelivery,
      leaseToken: operation.leaseToken,
      seq: 0,
      capability: "record_person_payment",
      arguments: argumentsRow,
      effectMode: "economic_event",
    }),
    "stage loop debt proceeds",
  );
  const proposed = mustOk(
    await registerAgentLoopManifest({
      userId,
      operationId: operation.id,
      expectedVersion: staged.stateVersion,
      deliveryKey: proposalDelivery,
      leaseToken: operation.leaseToken,
      stepKeys: [staged.step.stepKey],
      confirmationPrompt:
        "Preparé acreditar 83,86 USD en Produbanco y aumentar la deuda Alpaca. ¿Confirmas?",
    }),
    "register loop debt proceeds",
  );
  const preConfirmation = await balances(account.id, debt.id);
  const confirmationDelivery = `m117:confirm:${randomUUID()}`;
  const confirmation = await claim(
    confirmationDelivery,
    "Sí, confirma esos fondos prestados y su deuda.",
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
        rationale: "The second delivery confirms the exact borrowed-funds proposal.",
      },
    }),
    "authorize loop debt proceeds",
  );
  const application = mustOk(
    await beginAgentOperationApplication({
      userId,
      operationId: operation.id,
      expectedVersion: authorized.stateVersion,
    }),
    "begin loop debt application",
  );
  mustOk(
    await beginAgentOperationManifest({
      userId,
      operationId: operation.id,
      planVersion: staged.planVersion,
      leaseToken: application.leaseToken,
    }),
    "begin loop debt manifest",
  );
  const debtInput = {
    userId,
    operationId: operation.id,
    leaseToken: application.leaseToken,
    stepKey: staged.step.stepKey,
    dedupeKey: `agent-operation:${operation.id}:${staged.step.stepKey}`,
    accountId: account.id,
    debtAccountId: debt.id,
    amount: 83.86,
    originalCurrency: "USD",
    exchangeRateToBase: 1,
    baseCurrency: "USD",
    occurredAtISO: "2026-08-15T12:00:00.000Z",
    rawInput: "Alpaca me prestó 83.86 USD y entraron a Produbanco.",
    inputChannel: "chat",
  };
  const applied = mustOk(await applyDebtProceeds(debtInput), "apply loop debt proceeds");
  const afterApply = await balances(account.id, debt.id);
  const transactionCountBeforeReplayRead = await admin
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (
    transactionCountBeforeReplayRead.error ||
    transactionCountBeforeReplayRead.count == null
  ) {
    throw new Error(
      `transaction count before replay: ${boundedHarnessErrorText(
        transactionCountBeforeReplayRead.error ?? { message: "count null" },
      )}`,
    );
  }
  const transactionCountBeforeReplay = transactionCountBeforeReplayRead.count;
  const replay = mustOk(await applyDebtProceeds(debtInput), "replay loop debt proceeds");
  const afterReplay = await balances(account.id, debt.id);
  const transactionCountAfterReplayRead = await admin
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (
    transactionCountAfterReplayRead.error ||
    transactionCountAfterReplayRead.count == null
  ) {
    throw new Error(
      `transaction count after replay: ${boundedHarnessErrorText(
        transactionCountAfterReplayRead.error ?? { message: "count null" },
      )}`,
    );
  }
  const transactionCountAfterReplay = transactionCountAfterReplayRead.count;

  const verifying = mustOk(
    await transitionAgentOperation({
      userId,
      operationId: operation.id,
      expectedVersion: application.stateVersion,
      status: "verifying",
      leaseToken: application.leaseToken,
    }),
    "enter loop debt verifying",
  );
  const stepVerified = mustOk(
    await verifyAgentLoopStep({
      userId,
      operationId: operation.id,
      planVersion: staged.planVersion,
      stepKey: staged.step.stepKey,
      capability: staged.step.capability,
      arguments: staged.step.arguments,
      leaseToken: application.leaseToken,
      postWriteContextVerified: true,
    }),
    "verify loop debt step",
  );
  const manifestVerified = mustOk(
    await verifyAgentLoopManifest({
      userId,
      operationId: operation.id,
      planVersion: staged.planVersion,
      leaseToken: application.leaseToken,
    }),
    "verify loop debt manifest",
  );
  const completed = mustOk(
    await transitionAgentOperation({
      userId,
      operationId: operation.id,
      expectedVersion: verifying.stateVersion,
      status: "completed",
      leaseToken: application.leaseToken,
      result: { probe: "M117.1" },
    }),
    "complete loop debt operation",
  );
  const durable = must(
    await admin
      .from("agent_operations")
      .select(
        "status,plan,agent_operation_steps(status,effects,arguments_fingerprint,affected_refs),agent_operation_manifests(status,verification)",
      )
      .eq("id", operation.id)
      .single(),
    "durable loop debt state",
  );
  const durableStep = durable.agent_operation_steps?.[0];
  const durableRefTypes = new Set(
    (durableStep?.affected_refs ?? []).map((ref) => ref?.type),
  );
  check(
    "M117.1 · manifiesto loop autorizado escribe caja + deuda exactas y verifica paridad",
    money(preConfirmation.account.current_balance_original) ===
      money(initial.account.current_balance_original) &&
      money(preConfirmation.debt.current_balance_original) ===
        money(initial.debt.current_balance_original) &&
      applied.replayed === false &&
      money(afterApply.account.current_balance_original) ===
        money(initial.account.current_balance_original) + 83.86 &&
      money(afterApply.debt.current_balance_original) ===
        money(initial.debt.current_balance_original) + 83.86 &&
      stepVerified.replayed === false &&
      Number(manifestVerified.verification?.verified_count) === 1 &&
      completed.status === "completed" &&
      durable.status === "completed" &&
      durable.plan?.mode === "loop" &&
      durableStep?.status === "verified" &&
      typeof durableStep?.arguments_fingerprint === "string" &&
      durableStep.arguments_fingerprint.length === 32 &&
      durableStep.effects?.some(
        (row) =>
          row?.kind === "economic_event" &&
          row?.source === "capability_catalog",
      ) === true &&
      durableRefTypes.has("transaction") &&
      durableRefTypes.has("account") &&
      durableRefTypes.has("debt_account") &&
      durable.agent_operation_manifests?.[0]?.status === "verified" &&
      Number(
        durable.agent_operation_manifests?.[0]?.verification
          ?.outside_economic_count,
      ) === 0,
    JSON.stringify({ initial, preConfirmation, afterApply, durable }),
  );
  check(
    "M117.2 · replay exacto conserva transaction id y no duplica ninguna pata",
    replay.replayed === true &&
      replay.transactionId === applied.transactionId &&
      money(afterReplay.account.current_balance_original) ===
        money(afterApply.account.current_balance_original) &&
      money(afterReplay.debt.current_balance_original) ===
        money(afterApply.debt.current_balance_original) &&
      transactionCountBeforeReplay === transactionCountAfterReplay,
    JSON.stringify({ applied, replay, afterApply, afterReplay }),
  );

  const legacyDelivery = `m117:legacy-negative:${randomUUID()}`;
  const legacy = await claim(
    legacyDelivery,
    "Fixture envelope sin efecto debt_proceeds.",
  );
  const legacyAction = {
    id: "legacy-debt-without-effect",
    capability: "record_person_payment",
    arguments: argumentsRow,
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [effect("cash", "increase", "income", account.id)],
    postconditions: [],
  };
  const legacySaved = mustOk(
    await saveAgentOperationPlan({
      userId,
      operationId: legacy.id,
      expectedVersion: legacy.stateVersion,
      plan: envelopePlan([legacyAction]),
      coverage,
      missingFields: [],
      pendingQuestion: null,
      leaseToken: legacy.leaseToken,
    }),
    "save legacy negative plan",
  );
  const legacyApplication = mustOk(
    await beginAgentOperationApplication({
      userId,
      operationId: legacy.id,
      expectedVersion: legacySaved.stateVersion,
    }),
    "begin legacy negative application",
  );
  const beforeLegacyAttempt = await balances(account.id, debt.id);
  const legacyRejected = await applyDebtProceeds({
    ...debtInput,
    operationId: legacy.id,
    leaseToken: legacyApplication.leaseToken,
    stepKey: legacyAction.id,
    dedupeKey: `agent-operation:${legacy.id}:${legacyAction.id}`,
  });
  const afterLegacyAttempt = await balances(account.id, debt.id);
  check(
    "M117.3 · un plan envelope sin classification debt_proceeds conserva el rechazo legacy",
    legacyRejected.ok === false &&
      legacyRejected.reason === "unsafe" &&
      money(afterLegacyAttempt.account.current_balance_original) ===
        money(beforeLegacyAttempt.account.current_balance_original) &&
      money(afterLegacyAttempt.debt.current_balance_original) ===
        money(beforeLegacyAttempt.debt.current_balance_original),
    JSON.stringify({ legacyRejected, beforeLegacyAttempt, afterLegacyAttempt }),
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
        failures.push(
          `LIMPIEZA ILEGIBLE · ${table}: ${error?.message ?? "count null"}`,
        );
      } else if (count !== 0) {
        failures.push(`RESIDUO · ${table}: ${count}`);
      }
    }
  }
}

console.log(`M117 PostgreSQL probes: ${passed}/${executed}`);
if (failures.length > 0 || passed !== 3 || executed !== 3) {
  if (executed !== 3) failures.push(`COBERTURA INCOMPLETA ${executed}/3`);
  console.error(`FAILURES: ${failures.join(" | ") || "unknown"}`);
  process.exitCode = 1;
}
