// M0 Friccion Cero / Ola 2 — migration 120 disposable PostgreSQL probes.
//
// DO NOT RUN before migration 120 has been explicitly audited and applied:
//   node --env-file=.env.local ./scripts/qa/m0-loop-120-e2e.mjs

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
  stageAgentLoopStep,
  transitionAgentOperation,
  verifyAgentLoopManifest,
  verifyAgentLoopStep,
} = await import("@/lib/ai/agent/agent-operation-store");
const {
  applyAdHocInvestmentContribution,
  planInvestmentContribution,
} = await import("@/lib/financial/recurring-ledger");
const { buildLedgerEntryPayload } = await import(
  "@/lib/ai/apply-chat-transaction-intent"
);

let userId = null;
let passed = 0;
let executed = 0;
const failures = [];
const rootMessages = new Map();
const touched = [
  ["agent_operation_transition_events", "id", "user_id"],
  ["agent_operation_manifests", "id", "user_id"],
  ["investment_contribution_applications", "id", "user_id"],
  ["agent_operation_steps", "id", "user_id"],
  ["agent_operation_deliveries", "id", "user_id"],
  ["agent_operations", "id", "user_id"],
  ["chat_messages", "id", "user_id"],
  ["transactions", "id", "user_id"],
  ["investment_accounts", "id", "user_id"],
  ["accounts", "id", "user_id"],
  ["user_engagement", "user_id", "user_id"],
  ["profiles", "id", "id"],
];

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
    message:
      typeof row.message === "string" ? row.message : "non-Error failure",
    details: typeof row.details === "string" ? row.details : null,
    hint: typeof row.hint === "string" ? row.hint : null,
  };
}

const boundedErrorText = (error) => JSON.stringify(boundedError(error));

function must(result, label) {
  if (result?.error) {
    throw new Error(`${label}: ${boundedErrorText(result.error)}`);
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
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
};
const canonicalText = (value) => JSON.stringify(canonical(value));

async function claim(key, text, continuation = null, expectedVersion = null) {
  let root = rootMessages.get(key);
  if (!root) {
    root = must(
      await admin
        .from("chat_messages")
        .insert({
          user_id: userId,
          role: "user",
          content: text,
          channel: "telegram",
          chat_id: "m120-probe",
          metadata: { source: "m120-e2e" },
        })
        .select("id")
        .single(),
      `root message ${key}`,
    );
    rootMessages.set(key, root);
  }
  return mustOk(
    await claimAgentOperation({
      userId,
      deliveryKey: key,
      channel: "telegram",
      chatId: "m120-probe",
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

async function financialState(accountId, assetId) {
  const [account, asset, transactions, applications] = await Promise.all([
    admin
      .from("accounts")
      .select("current_balance_original,current_balance_base")
      .eq("id", accountId)
      .single(),
    admin
      .from("investment_accounts")
      .select("value_base,value_original,currency,updated_at")
      .eq("id", assetId)
      .single(),
    admin
      .from("transactions")
      .select(
        "id,type,original_amount,original_currency,source_account_id,related_transaction_id,dedupe_key",
      )
      .eq("user_id", userId)
      .order("created_at"),
    admin
      .from("investment_contribution_applications")
      .select(
        "operation_id,step_key,transaction_id,account_id,asset_id,amount,currency,base_amount,base_currency,asset_amount,asset_currency,dedupe_key,payload_fingerprint,reversal_transaction_id,reversed_at",
      )
      .eq("user_id", userId)
      .order("created_at"),
  ]);
  return {
    account: must(account, "state account"),
    asset: must(asset, "state asset"),
    transactions: must(transactions, "state transactions"),
    applications: must(applications, "state applications"),
  };
}

try {
  const created = must(
    await admin.auth.admin.createUser({
      email: `kipu-m120-${Date.now()}-${randomUUID()}@example.invalid`,
      email_confirm: true,
      user_metadata: { kipu_m120_probe: true },
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
        name: "Pichincha M120",
        type: "bank",
        currency: "USD",
        current_balance_original: 1_000,
        current_balance_base: 1_000,
        is_currency_default: true,
      })
      .select("id")
      .single(),
    "account",
  );
  const asset = must(
    await admin
      .from("investment_accounts")
      .insert({
        user_id: userId,
        name: "eToro M120",
        asset_class: "investment",
        value_base: 500,
        value_original: 500,
        currency: "USD",
        liquid: false,
        include_in_net_worth: true,
      })
      .select("id")
      .single(),
    "asset",
  );

  const initial = await financialState(account.id, asset.id);
  const proposalKey = `m120:proposal:${randomUUID()}`;
  const operation = await claim(
    proposalKey,
    "Aporté 75 USD desde Pichincha M120 a eToro M120.",
  );
  const argumentsRow = {
    sourceAccountId: account.id,
    assetId: asset.id,
    amount: 75,
    currency: "USD",
    occurredAtISO: "2026-08-21",
    description: "Aporte a eToro M120",
  };
  const staged = mustOk(
    await stageAgentLoopStep({
      userId,
      operationId: operation.id,
      expectedVersion: operation.stateVersion,
      deliveryKey: proposalKey,
      leaseToken: operation.leaseToken,
      seq: 0,
      capability: "record_investment_contribution",
      arguments: argumentsRow,
      effectMode: "economic_event",
    }),
    "stage contribution",
  );
  const proposed = mustOk(
    await registerAgentLoopManifest({
      userId,
      operationId: operation.id,
      expectedVersion: staged.stateVersion,
      deliveryKey: proposalKey,
      leaseToken: operation.leaseToken,
      stepKeys: [staged.step.stepKey],
      confirmationPrompt:
        "Preparé aportar 75 USD desde Pichincha M120 a eToro M120. ¿Confirmas?",
    }),
    "register contribution",
  );
  const beforeConfirmation = await financialState(account.id, asset.id);
  const confirmationKey = `m120:confirm:${randomUUID()}`;
  const confirmation = await claim(
    confirmationKey,
    "Sí, confirma exactamente ese aporte.",
    operation.id,
    proposed.stateVersion,
  );
  const authorized = mustOk(
    await authorizeAgentOperationManifest({
      userId,
      operationId: operation.id,
      expectedVersion: confirmation.stateVersion,
      deliveryKey: confirmationKey,
      leaseToken: confirmation.leaseToken,
      transition: {
        kind: "confirmed",
        target_operation_id: operation.id,
        consumed_pending_keys: ["operation_manifest"],
        remaining_pending_keys: [],
        rationale: "Second delivery confirms the exact investment contribution.",
      },
    }),
    "authorize contribution",
  );
  const application = mustOk(
    await beginAgentOperationApplication({
      userId,
      operationId: operation.id,
      expectedVersion: authorized.stateVersion,
    }),
    "begin contribution application",
  );
  mustOk(
    await beginAgentOperationManifest({
      userId,
      operationId: operation.id,
      planVersion: staged.planVersion,
      leaseToken: application.leaseToken,
    }),
    "begin contribution manifest",
  );

  const writeInput = {
    userId,
    operationId: operation.id,
    leaseToken: application.leaseToken,
    stepKey: staged.step.stepKey,
    sourceAccountId: account.id,
    sourceAccountCurrency: "USD",
    assetId: asset.id,
    assetCurrency: "USD",
    nativeAmount: 75,
    nativeCurrency: "USD",
    base: "USD",
    rates: [],
    dedupeKey: `agent:investment-contribution:${operation.id}:${staged.step.stepKey}`,
    occurredAtISO: "2026-08-21T12:00:00.000Z",
    description: "Aporte a eToro M120",
    inputChannel: "chat",
    rawInput: "Aporté 75 USD desde Pichincha M120 a eToro M120.",
  };
  const applied = mustOk(
    await applyAdHocInvestmentContribution(writeInput),
    "apply contribution",
  );
  const afterApply = await financialState(account.id, asset.id);
  const replay = mustOk(
    await applyAdHocInvestmentContribution(writeInput),
    "replay contribution",
  );
  const afterReplay = await financialState(account.id, asset.id);

  const divergentPlan = planInvestmentContribution({
    ...writeInput,
    nativeAmount: 76,
  });
  if (!divergentPlan) throw new Error("divergent fixture plan failed");
  const divergent = await admin.rpc("kipu_apply_investment_contribution", {
    p: {
      user_id: userId,
      operation_id: operation.id,
      lease_token: application.leaseToken,
      step_key: staged.step.stepKey,
      account_id: account.id,
      asset_id: asset.id,
      amount: divergentPlan.amount,
      currency: divergentPlan.currency,
      base_amount: divergentPlan.baseAmount,
      base_currency: divergentPlan.baseCurrency,
      asset_amount: divergentPlan.assetAmount,
      asset_currency: divergentPlan.assetCurrency,
      exchange_rate_to_base: divergentPlan.exchangeRateToBase,
      dedupe_key: writeInput.dedupeKey,
      ledger_entry: buildLedgerEntryPayload(divergentPlan.ledgerEntry),
    },
  });
  const afterDivergent = await financialState(account.id, asset.id);

  const verifying = mustOk(
    await transitionAgentOperation({
      userId,
      operationId: operation.id,
      expectedVersion: application.stateVersion,
      status: "verifying",
      leaseToken: application.leaseToken,
    }),
    "enter verifying",
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
    "verify contribution step",
  );
  const manifestVerified = mustOk(
    await verifyAgentLoopManifest({
      userId,
      operationId: operation.id,
      planVersion: staged.planVersion,
      leaseToken: application.leaseToken,
    }),
    "verify contribution manifest",
  );
  const completed = mustOk(
    await transitionAgentOperation({
      userId,
      operationId: operation.id,
      expectedVersion: verifying.stateVersion,
      status: "completed",
      leaseToken: application.leaseToken,
      result: { probe: "M120.1" },
    }),
    "complete contribution",
  );
  const durable = must(
    await admin
      .from("agent_operations")
      .select(
        "status,plan,agent_operation_steps(status,effects,result,affected_refs),agent_operation_manifests(status,verification)",
      )
      .eq("id", operation.id)
      .single(),
    "durable contribution",
  );
  const durableStep = durable.agent_operation_steps?.[0];
  const refTypes = new Set(
    (durableStep?.affected_refs ?? []).map((row) => row?.type),
  );
  check(
    "M120.1 · propuesta→confirmación mueve caja y activo juntos, persiste ambas identidades y verifica el manifiesto",
    money(beforeConfirmation.account.current_balance_original) === 1_000 &&
      money(beforeConfirmation.asset.value_base) === 500 &&
      applied.replayed === false &&
      money(afterApply.account.current_balance_original) === 925 &&
      money(afterApply.asset.value_base) === 575 &&
      money(afterApply.asset.value_original) === 575 &&
      afterApply.transactions.length === 1 &&
      afterApply.applications.length === 1 &&
      afterApply.applications[0]?.transaction_id === applied.transactionId &&
      afterApply.applications[0]?.account_id === account.id &&
      afterApply.applications[0]?.asset_id === asset.id &&
      durable.status === "completed" &&
      durable.plan?.mode === "loop" &&
      durableStep?.status === "verified" &&
      durableStep?.result?.moved_money === true &&
      refTypes.has("transaction") &&
      refTypes.has("account") &&
      refTypes.has("asset") &&
      stepVerified.replayed === false &&
      Number(manifestVerified.verification?.verified_count) === 1 &&
      durable.agent_operation_manifests?.[0]?.status === "verified" &&
      completed.status === "completed",
    canonicalText({ initial, beforeConfirmation, afterApply, durable }),
  );
  check(
    "M120.2 · replay exacto conserva receipt y payload divergente muerde KIPU_DEDUPE_MISMATCH sin duplicar patas",
    replay.replayed === true &&
      replay.transactionId === applied.transactionId &&
      canonicalText(afterReplay) === canonicalText(afterApply) &&
      divergent.error?.message?.includes("KIPU_DEDUPE_MISMATCH") === true &&
      canonicalText(afterDivergent) === canonicalText(afterApply),
    canonicalText({ replay, divergent: boundedError(divergent.error), afterDivergent }),
  );

  const genericHalfUndo = await admin.rpc("kipu_reverse_financial_operation", {
    p: {
      user_id: userId,
      transaction_id: applied.transactionId,
      input_channel: "chat",
      raw_input: "M120 generic half undo negative",
      occurred_at: "2026-08-21T13:00:00.000Z",
    },
  });
  const afterGenericHalfUndo = await financialState(account.id, asset.id);
  check(
    "M120.3 · el reversor genérico no puede devolver caja dejando el activo inflado",
    genericHalfUndo.error?.message?.includes(
      "investment contribution requires its two-leg reversal writer",
    ) === true &&
      canonicalText(afterGenericHalfUndo) === canonicalText(afterApply),
    canonicalText({
      error: boundedError(genericHalfUndo.error),
      afterGenericHalfUndo,
    }),
  );

  const reversed = must(
    await admin.rpc("kipu_reverse_financial_operations_v3", {
      p: {
        user_id: userId,
        transaction_ids: [applied.transactionId],
        input_channel: "chat",
        raw_input: "M120 complete investment undo",
        occurred_at: "2026-08-21T13:00:00.000Z",
      },
    }),
    "complete contribution undo",
  );
  const afterUndo = await financialState(account.id, asset.id);
  const undoReplay = must(
    await admin.rpc("kipu_reverse_financial_operations_v3", {
      p: {
        user_id: userId,
        transaction_ids: [applied.transactionId],
        input_channel: "chat",
        raw_input: "M120 complete investment undo",
        occurred_at: "2026-08-21T13:00:00.000Z",
      },
    }),
    "replay contribution undo",
  );
  const afterUndoReplay = await financialState(account.id, asset.id);
  const reverseOutcomes = [
    reversed?.results?.[0]?.outcome,
    undoReplay?.results?.[0]?.outcome,
  ];
  check(
    "M120.4 · el dispatcher v3 revierte caja+activo una sola vez y su replay conserva el marcador",
    reverseOutcomes[0] === "reversed_investment_contribution" &&
      reverseOutcomes[1] === "already_reversed_investment_contribution" &&
      money(afterUndo.account.current_balance_original) === 1_000 &&
      money(afterUndo.asset.value_base) === 500 &&
      money(afterUndo.asset.value_original) === 500 &&
      afterUndo.transactions.length === 2 &&
      afterUndo.transactions[1]?.type === "reversal" &&
      afterUndo.transactions[1]?.related_transaction_id === applied.transactionId &&
      afterUndo.applications[0]?.reversal_transaction_id ===
        afterUndo.transactions[1]?.id &&
      canonicalText(afterUndoReplay) === canonicalText(afterUndo),
    canonicalText({ reverseOutcomes, afterUndo, afterUndoReplay }),
  );
} catch (error) {
  failures.push("ABORT");
  console.error(boundedErrorText(error));
} finally {
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) failures.push(`cleanup auth: ${boundedErrorText(deleted.error)}`);
    for (const [table, keyColumn, identityColumn] of touched) {
      const read = await admin
        .from(table)
        .select(keyColumn, { count: "exact", head: true })
        .eq(identityColumn, userId);
      if (read.error || read.count == null) {
        failures.push(
          `LIMPIEZA ILEGIBLE · ${table}: ${boundedErrorText(read.error ?? { message: "count null" })}`,
        );
      } else if (read.count !== 0) {
        failures.push(`RESIDUO · ${table}: ${read.count}`);
      }
    }
  }
}

console.log(`M120 PostgreSQL probes: ${passed}/${executed}`);
if (failures.length > 0 || passed !== 4 || executed !== 4) {
  if (executed !== 4) failures.push(`COBERTURA INCOMPLETA ${executed}/4`);
  console.error(`FAILURES: ${failures.join(" | ") || "unknown"}`);
  process.exitCode = 1;
}
