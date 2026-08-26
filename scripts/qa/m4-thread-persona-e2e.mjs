// Bloque M4 — hilo unificado + recibos contra Postgres real.
//
// Persona desechable, writer financiero canónico, lectura productiva del hilo
// y limpieza por eliminación de la persona (cascade). El caso de recibo
// incompleto usa una identidad inexistente: nunca borra una fila financiera.
//
//   node --env-file=.env.local ./scripts/qa/m4-thread-persona-e2e.mjs

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    if (specifier === "next/headers") {
      return nextResolve("next/headers.js", context);
    }
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
if (!url || !serviceKey) {
  throw new Error(
    "faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (usá --env-file=.env.local)",
  );
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const { applyChatTransactionIntent } = await import(
  "@/lib/ai/apply-chat-transaction-intent"
);
const { readThreadView } = await import("@/lib/chat-memory/thread-view");
const {
  beginAgentOperationApplication,
  claimAgentOperation,
  recordAgentOperationStepOutcome,
  saveAgentOperationPlan,
  transitionAgentOperation,
  verifyAgentOperation,
} = await import("@/lib/ai/agent/agent-operation-store");
const { describeMovement } = await import(
  "@/app/app/components/app-dashboard-helpers"
);

let passed = 0;
const failed = [];
function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   · ${name}`);
  } else {
    failed.push(name);
    console.log(`  FALL · ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}

let userId = null;
const touched = [
  "agent_operation_steps",
  "agent_operations",
  "user_financial_preferences",
  "chat_messages",
  "transactions",
  "accounts",
  "profiles",
];

try {
  const email = `kipu-m4e2e-${Date.now()}@example.invalid`;
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { kipu_smoke: true, stage: "M4" },
    });
  if (createError || !created.user) {
    throw new Error(`createUser: ${createError?.message ?? "sin usuario"}`);
  }
  userId = created.user.id;
  console.log(`persona desechable: ${userId}`);

  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    base_currency: "USD",
    display_currency: "USD",
    onboarding_completed: true,
  });
  if (profileError) throw new Error(`profile: ${profileError.message}`);

  const { data: account, error: accountError } = await admin
    .from("accounts")
    .insert({
      user_id: userId,
      name: "Cuenta M4 E2E",
      type: "bank",
      currency: "USD",
      current_balance_original: 100,
      current_balance_base: 100,
    })
    .select("id")
    .single();
  if (accountError || !account) {
    throw new Error(`account: ${accountError?.message ?? "sin id"}`);
  }

  const domainAccount = {
    id: account.id,
    userId,
    name: "Cuenta M4 E2E",
    type: "bank",
    currency: "USD",
    currentBalanceOriginal: 100,
    currentBalanceBase: 100,
    isGoalAccount: false,
    createdAt: new Date().toISOString(),
  };
  const write = await applyChatTransactionIntent({
    userId,
    message: "Gasté 7 en café",
    intent: {
      type: "expense",
      description: "Café M4 E2E",
      category: "other",
      originalAmount: 7,
      originalCurrency: "USD",
      exchangeRateToBase: 1,
      baseCurrency: "USD",
      sourceAccountId: account.id,
      confidenceScore: 0.99,
      status: "ready",
    },
    accounts: [domainAccount],
    debtAccounts: [],
    goals: [],
    parserSource: "ai",
    parserConfidenceScore: 0.99,
    channel: "web",
    dedupeKey: `m4-e2e:${userId}:expense`,
    responseMode: "receipt_only",
  });
  const transactionId = write.financialWriteReceipt?.transactionIds[0];
  if (!transactionId) throw new Error("writer real no devolvió transactionId");

  async function createOperation(refId, suffix) {
    const deliveryKey = `m4-e2e:${suffix}:${randomUUID()}`;
    const requestText = `M4 E2E ${suffix}`;
    const { data: root, error: rootError } = await admin
      .from("chat_messages")
      .insert({
        user_id: userId,
        role: "user",
        channel: "web",
        chat_id: userId,
        content: requestText,
        message_type: "transaction",
        metadata: {},
        operation_key: `${deliveryKey}:user`,
      })
      .select("id")
      .single();
    if (rootError || !root) {
      throw new Error(`operation root ${suffix}: ${rootError?.message ?? "sin id"}`);
    }
    const claim = await claimAgentOperation({
      userId,
      deliveryKey,
      channel: "web",
      chatId: userId,
      rootMessageId: root.id,
      requestText,
    });
    if (!claim.ok || !claim.leaseToken) {
      throw new Error(`operation claim ${suffix}: ${claim.reason ?? "sin lease"}`);
    }
    const stepKey = `${suffix}-1`;
    const capability = "record_expense";
    const args = { e2e: suffix };
    const plan = await saveAgentOperationPlan({
      userId,
      operationId: claim.id,
      expectedVersion: claim.stateVersion,
      leaseToken: claim.leaseToken,
      plan: {
        goal: requestText,
        interpretation: requestText,
        assertions: [],
        ambiguities: [],
        required_reads: [],
        actions: [
          {
            id: stepKey,
            capability,
            arguments: args,
            atomic_group: null,
            depends_on: [],
            state_witness: {},
            effects: [{ type: "financial_write" }],
            postconditions: [],
          },
        ],
        postconditions: [],
        response_intent: "act",
        requires_replan_after_reads: false,
      },
      coverage: {
        ok: true,
        complete: true,
        asOf: new Date().toISOString(),
        consulted: ["m4-e2e"],
        failed: [],
        truncated: [],
      },
      missingFields: [],
      pendingQuestion: null,
    });
    if (!plan.ok) throw new Error(`operation plan ${suffix}: ${plan.reason}`);
    const lease = await beginAgentOperationApplication({
      userId,
      operationId: claim.id,
      expectedVersion: plan.stateVersion,
    });
    if (!lease.ok) throw new Error(`operation lease ${suffix}: ${lease.reason}`);
    const outcome = await recordAgentOperationStepOutcome({
      userId,
      operationId: claim.id,
      stepKey,
      capability,
      arguments: args,
      toolStatus: "done",
      executionEffect: "write",
      result: { transaction_id: refId },
      affectedRefs: [{ type: "transaction", id: refId }],
      leaseToken: lease.leaseToken,
    });
    if (!outcome.ok) throw new Error(`operation outcome ${suffix}: ${outcome.reason}`);
    const verifying = await transitionAgentOperation({
      userId,
      operationId: claim.id,
      expectedVersion: lease.stateVersion,
      status: "verifying",
      leaseToken: lease.leaseToken,
    });
    if (!verifying.ok) {
      throw new Error(`operation verifying ${suffix}: ${verifying.reason}`);
    }
    const verified = await verifyAgentOperation({
      userId,
      operationId: claim.id,
      leaseToken: lease.leaseToken,
      postWriteContextVerified: true,
    });
    if (!verified.ok) throw new Error(`operation verify ${suffix}: ${verified.reason}`);
    const completed = await transitionAgentOperation({
      userId,
      operationId: claim.id,
      expectedVersion: verifying.stateVersion,
      status: "completed",
      leaseToken: lease.leaseToken,
      result: { e2e: suffix },
    });
    if (!completed.ok) {
      throw new Error(`operation complete ${suffix}: ${completed.reason}`);
    }
    return claim.id;
  }

  const realOperationId = await createOperation(transactionId, "receipt");
  const missingOperationId = await createOperation(randomUUID(), "incomplete");
  const baseTime = Date.now() - 30_000;
  const at = (offset) => new Date(baseTime + offset).toISOString();

  async function addMessage({
    role = "assistant",
    channel = "web",
    chatId = null,
    content,
    metadata = {},
    operationKey = null,
    createdAt,
  }) {
    const { data, error } = await admin
      .from("chat_messages")
      .insert({
        user_id: userId,
        role,
        channel,
        chat_id: chatId,
        content,
        message_type: "transaction",
        metadata,
        operation_key: operationKey,
        created_at: createdAt,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`chat ${content}: ${error?.message ?? "sin id"}`);
    }
    return data.id;
  }

  const digestId = await addMessage({
    content: "Digest calendario M4 E2E",
    metadata: { source: "recurring", calendarDigestClaimId: randomUUID() },
    createdAt: at(1_000),
  });
  const closeId = await addMessage({
    content: "Cierre mensual M4 E2E",
    metadata: { source: "objective_close", objectiveCloseClaimId: randomUUID() },
    createdAt: at(2_000),
  });

  await addMessage({
    content: "Orden web antes",
    operationKey: `m4-order-web-before-${randomUUID()}`,
    createdAt: at(3_000),
  });
  await addMessage({
    channel: "telegram",
    chatId: "m4-e2e-telegram",
    content: "Orden Telegram medio",
    operationKey: `m4-order-telegram-${randomUUID()}`,
    createdAt: at(4_000),
  });
  await addMessage({
    content: "Orden web después",
    operationKey: `m4-order-web-after-${randomUUID()}`,
    createdAt: at(5_000),
  });

  const sharedIdentity = `m4-shared-${randomUUID()}`;
  await addMessage({
    content: "Dedupe identidad web",
    operationKey: sharedIdentity,
    createdAt: at(6_000),
  });
  await addMessage({
    channel: "telegram",
    chatId: "m4-e2e-telegram",
    content: "Dedupe identidad telegram",
    operationKey: sharedIdentity,
    createdAt: at(7_000),
  });
  await addMessage({
    content: "Texto idéntico sin identidad",
    createdAt: at(8_000),
  });
  await addMessage({
    channel: "telegram",
    chatId: "m4-e2e-telegram",
    content: "Texto idéntico sin identidad",
    createdAt: at(9_000),
  });

  const receiptTurnId = await addMessage({
    content: "Quedó registrado el café.",
    metadata: {
      agent: true,
      chatResponseStatus: "success",
      durableOperation: { id: realOperationId, status: "completed", stateVersion: 1 },
    },
    operationKey: `m4-receipt-turn-${randomUUID()}`,
    createdAt: at(10_000),
  });
  const incompleteTurnId = await addMessage({
    content: "Registré lo que pude verificar.",
    metadata: {
      agent: true,
      chatResponseStatus: "success",
      durableOperation: { id: missingOperationId, status: "completed", stateVersion: 1 },
    },
    operationKey: `m4-incomplete-turn-${randomUUID()}`,
    createdAt: at(11_000),
  });

  const thread = await readThreadView({ client: admin, userId });
  check(
    "M4-E0 · lectura productiva del hilo es completa",
    !thread.readFailed && thread.complete,
    JSON.stringify({ complete: thread.complete, readFailed: thread.readFailed }),
  );

  const receiptTurn = thread.turns.find((turn) => turn.id === receiptTurnId);
  const { data: ledgerRow, error: ledgerError } = await admin
    .from("transactions")
    .select(
      "id, type, description, category, base_amount, base_currency, debt_account_id, goal_id",
    )
    .eq("id", transactionId)
    .eq("user_id", userId)
    .single();
  if (ledgerError || !ledgerRow) {
    throw new Error(`ledger read: ${ledgerError?.message ?? "sin fila"}`);
  }
  const movement = describeMovement(ledgerRow, { rates: [] });
  check(
    "M4-E1 · write real aparece con recibo reconstruido desde el ledger",
    Number(ledgerRow.base_amount) === 7 &&
      receiptTurn?.receipt?.lines.length === 1 &&
      receiptTurn.receipt.lines[0]?.label ===
        (movement.sublabel
          ? `${movement.title} · ${movement.sublabel}`
          : movement.title) &&
      receiptTurn.receipt.lines[0]?.amountLabel === `−${movement.amount}`,
    JSON.stringify({ ledgerRow, receipt: receiptTurn?.receipt }),
  );

  const digestTurn = thread.turns.find((turn) => turn.id === digestId);
  const closeTurn = thread.turns.find((turn) => turn.id === closeId);
  check(
    "M4-E2 · digest y cierre web con chat_id NULL aparecen y conservan autor",
    digestTurn?.author === "calendario" && closeTurn?.author === "cierre_de_mes",
    JSON.stringify({ digestTurn, closeTurn }),
  );

  const order = thread.turns
    .filter((turn) => turn.text.startsWith("Orden "))
    .map((turn) => `${turn.channel}:${turn.text}`);
  check(
    "M4-E3 · Telegram queda intercalado en orden cronológico real",
    JSON.stringify(order) ===
      JSON.stringify([
        "web:Orden web antes",
        "telegram:Orden Telegram medio",
        "web:Orden web después",
      ]),
    JSON.stringify(order),
  );

  const deduped = thread.turns.filter((turn) =>
    turn.text.startsWith("Dedupe identidad"),
  );
  const sameText = thread.turns.filter(
    (turn) => turn.text === "Texto idéntico sin identidad",
  );
  check(
    "M4-E4 · identidad durable compartida dedupea a web; texto solo no dedupea",
    deduped.length === 1 &&
      deduped[0]?.channel === "web" &&
      sameText.length === 2 &&
      new Set(sameText.map((turn) => turn.channel)).size === 2,
    JSON.stringify({ deduped, sameText }),
  );

  const incompleteTurn = thread.turns.find((turn) => turn.id === incompleteTurnId);
  check(
    "M4-E5 · referencia inexistente produce recibo incompleto sin relleno",
    incompleteTurn?.receipt?.incomplete === true &&
      incompleteTurn.receipt.lines.length === 0,
    JSON.stringify(incompleteTurn?.receipt),
  );

  const { count: beforeClear } = await admin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  const clearAt = new Date().toISOString();
  const { error: clearError } = await admin.from("user_financial_preferences").upsert(
    { user_id: userId, chat_cleared_at: clearAt },
    { onConflict: "user_id" },
  );
  if (clearError) throw new Error(`chat_cleared_at: ${clearError.message}`);
  const { count: afterClear } = await admin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  const clearedView = await readThreadView({ client: admin, userId, since: clearAt });
  check(
    "M4-E6 · chat_cleared_at oculta el hilo sin borrar una sola fila",
    beforeClear === afterClear &&
      Number(beforeClear) > 0 &&
      clearedView.turns.length === 0 &&
      !clearedView.readFailed,
    JSON.stringify({ beforeClear, afterClear, clearedView }),
  );

  console.log(`\n${passed} verdes, ${failed.length} rojos antes de limpieza`);
} finally {
  if (userId) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      failed.push("limpieza auth");
      console.log(`LIMPIEZA AUTH FALLÓ: ${deleteError.message}`);
    }

    let residue = 0;
    const residueByTable = {};
    for (const table of touched) {
      const column = table === "profiles" ? "id" : "user_id";
      const { count, error } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, userId);
      if (error) {
        failed.push(`limpieza lectura ${table}`);
        residueByTable[table] = `ERROR: ${error.message}`;
      } else {
        residueByTable[table] = count ?? 0;
        residue += count ?? 0;
      }
    }
    const { data: authRead } = await admin.auth.admin.getUserById(userId);
    const authResidue = authRead?.user ? 1 : 0;
    residue += authResidue;
    if (residue !== 0) failed.push("limpieza DB/auth");
    console.log(
      residue === 0
        ? "limpieza: residuo cero verificado en DB y auth"
        : `LIMPIEZA INCOMPLETA: ${JSON.stringify({ residueByTable, authResidue })}`,
    );
  }
}

console.log(`${passed} verdes, ${failed.length} rojos finales`);
if (failed.length) console.log(`rojos: ${failed.join(" | ")}`);
process.exit(failed.length ? 1 : 0);
