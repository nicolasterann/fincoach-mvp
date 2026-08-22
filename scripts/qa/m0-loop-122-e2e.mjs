// M0-AM — migration 122 disposable PostgreSQL probes: immediate loop
// authority for the ad-hoc investment contribution (no manifest).
//
// DO NOT RUN before migration 122 has been explicitly audited and applied:
//   node --env-file=.env.local ./scripts/qa/m0-loop-122-e2e.mjs

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
      email: `kipu-m122-${Date.now()}-${randomUUID()}@example.invalid`,
      email_confirm: true,
      user_metadata: { kipu_m122_probe: true },
    }),
    "create disposable user",
  );
  userId = created.user.id;
  must(
    await admin.from("profiles").upsert({
      id: userId, base_currency: "USD", onboarding_completed: true,
    }),
    "profile",
  );
  must(
    await admin.from("user_engagement").upsert({
      user_id: userId, timezone: "America/Argentina/Buenos_Aires",
    }),
    "engagement",
  );
  const account = must(
    await admin.from("accounts").insert({
      user_id: userId, name: "Pichincha M122", type: "bank", currency: "USD",
      current_balance_original: 1_000, current_balance_base: 1_000,
      is_currency_default: true,
    }).select("id").single(),
    "account",
  );
  const asset = must(
    await admin.from("investment_accounts").insert({
      user_id: userId, name: "eToro M122", asset_class: "investment",
      value_base: 500, value_original: 500, currency: "USD",
      liquid: false, include_in_net_worth: true,
    }).select("id").single(),
    "asset",
  );

  const initial = await financialState(account.id, asset.id);

  // ── M122.1 · escritura INMEDIATA: claim → stage (op queda applying) → writer,
  //    sin manifiesto, ambas patas atómicas ─────────────────────────────────
  const immediateKey = `m122:immediate:${randomUUID()}`;
  const operation = await claim(
    immediateKey,
    "Aporté 75 USD desde Pichincha M122 a eToro M122.",
  );
  const argumentsRow = {
    sourceAccountId: account.id,
    assetId: asset.id,
    amount: 75,
    currency: "USD",
    occurredAtISO: "2026-08-22",
    description: "Aporte a eToro M122",
  };
  const staged = mustOk(
    await stageAgentLoopStep({
      userId,
      operationId: operation.id,
      expectedVersion: operation.stateVersion,
      deliveryKey: immediateKey,
      leaseToken: operation.leaseToken,
      seq: 0,
      capability: "record_investment_contribution",
      arguments: argumentsRow,
      effectMode: "economic_event",
    }),
    "stage immediate contribution",
  );
  const opAfterStage = must(
    await admin
      .from("agent_operations")
      .select("status,state_version")
      .eq("id", operation.id)
      .single(),
    "operation after stage",
  );
  const manifestCountRes = await admin
    .from("agent_operation_manifests")
    .select("id", { count: "exact", head: true })
    .eq("operation_id", operation.id);
  if (manifestCountRes.error || manifestCountRes.count == null) {
    throw new Error(`manifest count: ${manifestCountRes.error?.message ?? "count null"}`);
  }
  const manifestCount = { count: manifestCountRes.count };

  const writeInput = {
    userId,
    operationId: operation.id,
    leaseToken: operation.leaseToken,
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
    occurredAtISO: "2026-08-22T12:00:00.000Z",
    description: "Aporte a eToro M122",
    inputChannel: "chat",
    rawInput: "Aporté 75 USD desde Pichincha M122 a eToro M122.",
  };
  const applied = mustOk(
    await applyAdHocInvestmentContribution(writeInput),
    "apply immediate contribution",
  );
  const afterApply = await financialState(account.id, asset.id);
  check(
    "M122.1 · sin manifiesto: claim→stage→writer mueve caja y activo juntos bajo el lease vivo",
    money(initial.account.current_balance_original) === 1_000 &&
      money(initial.asset.value_base) === 500 &&
      opAfterStage.status === "applying" &&
      manifestCount.count === 0 &&
      applied.replayed === false &&
      money(afterApply.account.current_balance_original) === 925 &&
      money(afterApply.asset.value_base) === 575 &&
      money(afterApply.asset.value_original) === 575 &&
      afterApply.transactions.length === 1 &&
      afterApply.applications.length === 1 &&
      afterApply.applications[0]?.transaction_id === applied.transactionId,
    canonicalText({ opAfterStage, manifests: manifestCount.count, applied, afterApply }),
  );

  // ── M122.2 · replay exacto conserva; divergencia muerde KIPU_DEDUPE_MISMATCH ─
  const replay = mustOk(
    await applyAdHocInvestmentContribution(writeInput),
    "replay immediate contribution",
  );
  const afterReplay = await financialState(account.id, asset.id);
  const divergentPlan = planInvestmentContribution({ ...writeInput, nativeAmount: 76 });
  if (!divergentPlan) throw new Error("divergent fixture plan failed");
  const divergent = await admin.rpc("kipu_apply_investment_contribution", {
    p: {
      user_id: userId,
      operation_id: operation.id,
      lease_token: operation.leaseToken,
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
  check(
    "M122.2 · replay exacto conserva receipt y payload divergente muerde KIPU_DEDUPE_MISMATCH sin duplicar patas",
    replay.replayed === true &&
      replay.transactionId === applied.transactionId &&
      canonicalText(afterReplay) === canonicalText(afterApply) &&
      Boolean(divergent.error) &&
      /KIPU_DEDUPE_MISMATCH/.test(divergent.error?.message ?? "") &&
      canonicalText(afterDivergent) === canonicalText(afterApply),
    canonicalText({ replay, divergent: divergent.error?.message ?? null }),
  );

  // ── M122.3 · un manifiesto PRESENTE pero no autorizado sigue mandando:
  //    el camino inmediato jamás puentea un proposed ────────────────────────
  const gravKey = `m122:grave:${randomUUID()}`;
  const graveOp = await claim(gravKey, "Aporte con manifiesto pendiente M122.");
  const graveStaged = mustOk(
    await stageAgentLoopStep({
      userId,
      operationId: graveOp.id,
      expectedVersion: graveOp.stateVersion,
      deliveryKey: gravKey,
      leaseToken: graveOp.leaseToken,
      seq: 0,
      capability: "record_investment_contribution",
      arguments: argumentsRow,
      effectMode: "economic_event",
    }),
    "stage grave contribution",
  );
  const graveProposed = mustOk(
    await registerAgentLoopManifest({
      userId,
      operationId: graveOp.id,
      expectedVersion: graveStaged.stateVersion,
      deliveryKey: gravKey,
      leaseToken: graveOp.leaseToken,
      stepKeys: [graveStaged.step.stepKey],
      confirmationPrompt: "Preparé el aporte M122. ¿Confirmas?",
    }),
    "register grave manifest",
  );
  // La corrida empírica probó algo MÁS FUERTE que la interrogación forjada:
  // el estado «applying + lease vivo + manifiesto proposed» es INCONSTRUIBLE.
  // Cuatro paredes independientes, cada una verificada aquí: (1) registrar el
  // manifiesto rota el lease y saca la op de applying ⇒ el writer rehúsa por
  // lease; (2) un resume legal no permite re-stagear bajo un proposed ⇒ el
  // stage rehúsa; (3) ni service_role puede forzar el estado por UPDATE
  // directo ⇒ permiso denegado; (4) el intento con el lease del resume
  // tampoco entra. La cláusula not-exists de la 122 queda como quinta capa
  // (defensa en profundidad), fijada por el DO-block de la migración en el
  // catálogo. El dinero no se mueve por ninguna vía.
  const graveDedupe = `agent:investment-contribution:${graveOp.id}:${graveStaged.step.stepKey}`;
  const gravePlan = planInvestmentContribution({
    ...writeInput,
    operationId: graveOp.id,
    stepKey: graveStaged.step.stepKey,
    dedupeKey: graveDedupe,
  });
  if (!gravePlan) throw new Error("grave fixture plan failed");
  const graveP = (lease) => ({
    p: {
      user_id: userId,
      operation_id: graveOp.id,
      lease_token: lease,
      step_key: graveStaged.step.stepKey,
      account_id: account.id,
      asset_id: asset.id,
      amount: gravePlan.amount,
      currency: gravePlan.currency,
      base_amount: gravePlan.baseAmount,
      base_currency: gravePlan.baseCurrency,
      asset_amount: gravePlan.assetAmount,
      asset_currency: gravePlan.assetCurrency,
      exchange_rate_to_base: gravePlan.exchangeRateToBase,
      dedupe_key: graveDedupe,
      ledger_entry: buildLedgerEntryPayload(gravePlan.ledgerEntry),
    },
  });
  const wallLease = await admin.rpc("kipu_apply_investment_contribution", graveP(graveOp.leaseToken));
  const resumeKey = `m122:resume:${randomUUID()}`;
  const resumed = await claim(
    resumeKey,
    "Sigo con el aporte pendiente M122.",
    graveOp.id,
    graveProposed.stateVersion,
  );
  const wallStage = await stageAgentLoopStep({
    userId,
    operationId: graveOp.id,
    expectedVersion: resumed.stateVersion,
    deliveryKey: resumeKey,
    leaseToken: resumed.leaseToken,
    seq: 1,
    capability: "log_movement",
    arguments: { type: "expense", amount: 1, currency: "USD", description: "M122 restage" },
    effectMode: "economic_event",
  });
  const wallForge = await admin
    .from("agent_operations")
    .update({ status: "applying" })
    .eq("id", graveOp.id)
    .select("status");
  const wallResumedLease = await admin.rpc("kipu_apply_investment_contribution", graveP(resumed.leaseToken));
  const afterGrave = await financialState(account.id, asset.id);
  check(
    "M122.3 · manifiesto proposed presente ⇒ el camino inmediato es INCONSTRUIBLE: lease, stage, forge y resume rehúsan y el dinero no se mueve",
    Boolean(wallLease.error) &&
      /KIPU_CONFLICT|KIPU_VALIDATION/.test(wallLease.error?.message ?? "") &&
      resumed.ok !== false &&
      wallStage.ok === false &&
      /no longer accepts staging/.test(String(wallStage.reason ?? "")) &&
      Boolean(wallForge.error) &&
      /permission denied/.test(wallForge.error?.message ?? "") &&
      Boolean(wallResumedLease.error) &&
      /KIPU_CONFLICT|KIPU_VALIDATION/.test(wallResumedLease.error?.message ?? "") &&
      canonicalText(afterGrave) === canonicalText(afterApply),
    canonicalText({
      wallLease: wallLease.error?.message ?? null,
      wallStage: wallStage.reason ?? null,
      wallForge: wallForge.error?.message ?? null,
      wallResumedLease: wallResumedLease.error?.message ?? null,
    }),
  );

  // ── M122.4 · el dispatcher v3 revierte caja+activo UNA vez y su replay
  //    conserva el marcador ─────────────────────────────────────────────────
  const reverse = await admin.rpc("kipu_reverse_financial_operations_v3", {
    p: {
      user_id: userId,
      transaction_ids: [applied.transactionId],
      raw_input: "deshacer aporte M122",
      input_channel: "chat",
    },
  });
  const afterUndo = await financialState(account.id, asset.id);
  const reverseReplay = await admin.rpc("kipu_reverse_financial_operations_v3", {
    p: {
      user_id: userId,
      transaction_ids: [applied.transactionId],
      raw_input: "deshacer aporte M122",
      input_channel: "chat",
    },
  });
  const afterUndoReplay = await financialState(account.id, asset.id);
  const outcomes = (reverse.data?.results ?? []).map((row) => row?.outcome);
  const replayOutcomes = (reverseReplay.data?.results ?? []).map((row) => row?.outcome);
  check(
    "M122.4 · reversal v3 devuelve caja y activo una sola vez; replay conserva",
    !reverse.error &&
      outcomes.includes("reversed_investment_contribution") &&
      money(afterUndo.account.current_balance_original) === 1_000 &&
      money(afterUndo.asset.value_base) === 500 &&
      money(afterUndo.asset.value_original) === 500 &&
      afterUndo.transactions.length === 2 &&
      afterUndo.transactions.some(
        (row) => row.type === "reversal" && row.related_transaction_id === applied.transactionId,
      ) &&
      !reverseReplay.error &&
      replayOutcomes.includes("already_reversed_investment_contribution") &&
      canonicalText(afterUndoReplay) === canonicalText(afterUndo),
    canonicalText({ outcomes, replayOutcomes, afterUndo }),
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

console.log(`M122 PostgreSQL probes: ${passed}/${executed}`);
if (failures.length > 0 || passed !== 4 || executed !== 4) {
  if (executed !== 4) failures.push(`COBERTURA INCOMPLETA ${executed}/4`);
  console.error(`FAILURES: ${failures.join(" | ") || "unknown"}`);
  process.exitCode = 1;
}
