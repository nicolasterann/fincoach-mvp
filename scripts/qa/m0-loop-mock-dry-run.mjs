// Native-loop dry run with scripted completions and a disposable real DB user.
// Zero OpenAI calls. Requires migration 116 to have been approved and applied.
//
//   node --env-file=.env.local scripts/qa/m0-loop-mock-dry-run.mjs

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
const { runKipuAgentLoop } = await import("@/lib/ai/agent/kipu-agent-loop");

function scriptedModel(responses) {
  let index = 0;
  return {
    get calls() {
      return index;
    },
    async complete(request) {
      const response = responses[index++];
      if (!response) throw new Error(`mock exhausted at call ${index}`);
      if (response.expectToolChoice && response.expectToolChoice !== request.toolChoice) {
        throw new Error(
          `mock tool choice ${request.toolChoice}, expected ${response.expectToolChoice}`,
        );
      }
      return {
        content: response.content ?? null,
        toolCalls: response.toolCalls ?? [],
        usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 },
      };
    },
  };
}

const call = (id, name, args) => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

function assert(name, pass, detail = "") {
  if (!pass) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
  console.log(`  ok   · ${name}`);
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

function durableOperationId(result, label) {
  const id = result?.durableOperation?.id;
  if (typeof id === "string" && id.length > 0) return id;
  throw new Error(
    `${label}: ${JSON.stringify({
      ok: result?.ok ?? false,
      outcome: result?.outcome ?? null,
      loopDiagnostic: result?.loopDiagnostic ?? null,
      toolTrace: result?.toolTrace ?? null,
    })}`,
  );
}

function must(result, label) {
  if (result?.error) {
    throw new Error(`${label}: ${boundedHarnessErrorText(result.error)}`);
  }
  return result.data;
}

async function count(table, keyColumn, filters) {
  let query = admin.from(table).select(keyColumn, { count: "exact", head: true });
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  const result = await query;
  if (result.error) {
    throw new Error(`${table} count: ${boundedHarnessErrorText(result.error)}`);
  }
  return Number(result.count ?? 0);
}

let userId = null;
const failures = [];
try {
  const created = must(
    await admin.auth.admin.createUser({
      email: `kipu-loop-dry-${Date.now()}@example.invalid`,
      email_confirm: true,
      user_metadata: { kipu_loop_dry_run: true },
    }),
    "create dry-run persona",
  );
  userId = created.user.id;
  must(await admin.from("profiles").upsert({
    id: userId,
    base_currency: "USD",
    onboarding_completed: true,
  }), "profile");
  must(await admin.from("user_engagement").upsert({
    user_id: userId,
    timezone: "America/Argentina/Buenos_Aires",
  }), "engagement");
  const account = must(
    await admin.from("accounts").insert({
      user_id: userId,
      name: "Cuenta Loop Dry",
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
  const accountId = account.id;

  const run = async (
    message,
    deliveryKey,
    model,
    recentMessages = [],
    chatId = "m0-loop-dry",
  ) => {
    const rootMessage = await admin
      .from("chat_messages")
      .insert({
        user_id: userId,
        role: "user",
        content: message,
        channel: "telegram",
        metadata: { source: "m116-dry-run" },
      })
      .select("id")
      .single();
    if (rootMessage.error) throw rootMessage.error;
    return runKipuAgentLoop(
      {
        userId,
        message,
        recentMessages,
        channel: "telegram",
        chatId,
        operationId: deliveryKey,
        rootMessageId: rootMessage.data.id,
        deliveryKey,
      },
      { model },
    );
  };

  const queryKey = `loop-dry:query:${randomUUID()}`;
  const queryModel = scriptedModel([
    {
      toolCalls: [call("q1", "get_financial_context", {})],
    },
    {
      content: "Tu Cuenta Loop Dry tiene 1000 USD.",
    },
  ]);
  const queryResult = await run("¿Cuánto tengo en Cuenta Loop Dry?", queryKey, queryModel);
  assert(
    "dry query · lectura pura completa",
    queryResult.ok &&
      !queryResult.outcome.wrote &&
      queryResult.toolTrace.some((row) => row.name === "get_financial_context") &&
      queryResult.loopUsage?.calls === 2,
    JSON.stringify(queryResult),
  );

  const writeKey = `loop-dry:write:${randomUUID()}`;
  const writeModel = scriptedModel([
    {
      toolCalls: [
        call("w1", "log_movement", {
          type: "expense",
          amount: 5,
          description: "Café dry run",
          category: "food",
          sourceAccountId: accountId,
          currency: "USD",
        }),
      ],
    },
    { content: "Listo, registré el café por 5 USD desde Cuenta Loop Dry." },
  ]);
  const writeResult = await run(
    "Gasté 5 USD en café desde Cuenta Loop Dry.",
    writeKey,
    writeModel,
  );
  const writeOperationId = durableOperationId(writeResult, "dry write operation missing");
  const writeStepRead = await admin
    .from("agent_operation_steps")
    .select("status,result,affected_refs,effects")
    .eq("operation_id", writeOperationId)
    .single();
  if (writeStepRead.error) throw writeStepRead.error;
  const writeTransactionRef = writeStepRead.data.affected_refs.find(
    (ref) => ref.type === "transaction" && typeof ref.id === "string",
  );
  const writeTransactionOwned = writeTransactionRef
    ? (await count("transactions", "id", {
        id: writeTransactionRef.id,
        user_id: userId,
      })) === 1
    : false;
  assert(
    "dry write · acción ordinaria persiste el transaction ref poseído y verifica",
    writeResult.ok &&
      writeResult.outcome.wrote &&
      writeStepRead.data.status === "verified" &&
      writeStepRead.data.result?.execution_effect === "write" &&
      Boolean(writeTransactionRef) &&
      writeTransactionOwned &&
      (await count("transactions", "id", { user_id: userId, description: "Café dry run" })) ===
        1,
    JSON.stringify({
      writeResult,
      writeStep: writeStepRead.data,
      writeTransactionOwned,
    }),
  );

  const proposalKey = `loop-dry:proposal:${randomUUID()}`;
  const proposalModel = scriptedModel([
    {
      toolCalls: [
        call("p1", "create_account", {
          name: "Cuenta Nueva Dry",
          kind: "bank",
          currency: "USD",
        }),
      ],
    },
    {
      content:
        "Puedo crear Cuenta Nueva Dry en USD con saldo inicial cero. ¿Confirmas que es una cuenta nueva?",
    },
  ]);
  const proposalResult = await run(
    "Quiero agregar una cuenta nueva llamada Cuenta Nueva Dry en USD.",
    proposalKey,
    proposalModel,
  );
  const proposalOperationId = durableOperationId(
    proposalResult,
    "dry proposal operation missing",
  );
  const proposalManifestRead = await admin
    .from("agent_operation_manifests")
    .select("manifest")
    .eq("operation_id", proposalOperationId)
    .single();
  if (proposalManifestRead.error) throw proposalManifestRead.error;
  const proposalStepRead = await admin
    .from("agent_operation_steps")
    .select("step_key,step_order,capability,arguments,state_witness,effects,postconditions,atomic_group")
    .eq("operation_id", proposalOperationId)
    .single();
  if (proposalStepRead.error) throw proposalStepRead.error;
  const proposedAction = proposalManifestRead.data.manifest.actions[0];
  assert(
    "dry proposal · sensible queda proposed y no escribe",
    proposalResult.ok &&
      proposalResult.durableOperation?.status === "awaiting_input" &&
      Boolean(proposalOperationId) &&
      (await count("accounts", "id", { user_id: userId, name: "Cuenta Nueva Dry" })) === 0 &&
      (await count("agent_operation_manifests", "id", {
        user_id: userId,
        operation_id: proposalOperationId,
        status: "proposed",
      })) === 1 &&
      proposalManifestRead.data.manifest.actions.length === 1 &&
      proposedAction.action_id === proposalStepRead.data.step_key &&
      proposedAction.ordinal === proposalStepRead.data.step_order &&
      proposedAction.capability === "create_account" &&
      isDeepStrictEqual(proposedAction.arguments, {
        name: "Cuenta Nueva Dry",
        kind: "bank",
        currency: "USD",
      }) &&
      isDeepStrictEqual(
        proposedAction.arguments,
        proposalStepRead.data.arguments,
      ) &&
      isDeepStrictEqual(
        proposedAction.state_witness,
        proposalStepRead.data.state_witness,
      ) &&
      isDeepStrictEqual(proposedAction.effects, proposalStepRead.data.effects) &&
      isDeepStrictEqual(
        proposedAction.postconditions,
        proposalStepRead.data.postconditions,
      ) &&
      proposedAction.atomic_group === proposalStepRead.data.atomic_group,
    JSON.stringify({ proposalResult, proposedAction, step: proposalStepRead.data }),
  );

  const selfKey = `loop-dry:self:${randomUUID()}`;
  let selfRound = 0;
  const selfModel = {
    async complete(request) {
      selfRound += 1;
      if (selfRound === 1) {
        return {
          content: null,
          toolCalls: [
            call("s1", "create_account", {
              name: "Cuenta Self Dry",
              kind: "bank",
              currency: "USD",
            }),
          ],
        };
      }
      if (selfRound === 2) {
        const toolMessage = [...request.messages]
          .reverse()
          .find((message) => message.role === "tool");
        const operationId = String(toolMessage?.content ?? "").match(
          /[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/i,
        )?.[0];
        if (!operationId) throw new Error("self-confirm operation id missing");
        return {
          content: null,
          toolCalls: [
            call("s2", "confirm_operation", {
              operationId,
              rationale: "Attempt to self-confirm from the proposal delivery.",
            }),
          ],
        };
      }
      return {
        content: "La cuenta sigue preparada y no fue auto-confirmada. ¿Confirmas crearla?",
        toolCalls: [],
      };
    },
  };
  const selfResult = await run(
    "Crea una cuenta nueva llamada Cuenta Self Dry en USD.",
    selfKey,
    selfModel,
    [],
    "m0-loop-dry-antiself",
  );
  assert(
    "dry anti-self · la delivery que stagea no puede confirmar su propia propuesta",
    selfResult.ok &&
      selfResult.durableOperation?.status === "awaiting_input" &&
      selfRound === 3 &&
      (await count("accounts", "id", { user_id: userId, name: "Cuenta Self Dry" })) === 0,
    JSON.stringify(selfResult),
  );

  const confirmKey = `loop-dry:confirm:${randomUUID()}`;
  const confirmModel = scriptedModel([
    {
      toolCalls: [
        call("c1", "confirm_operation", {
          operationId: proposalOperationId,
          rationale: "The user explicitly confirms the exact pending account proposal.",
        }),
      ],
    },
    { content: "Listo, creé Cuenta Nueva Dry en USD con saldo inicial cero." },
  ]);
  const confirmResult = await run(
    "Sí, confirma esa cuenta nueva.",
    confirmKey,
    confirmModel,
    [
      { role: "assistant", content: proposalResult.message },
      { role: "user", content: "Sí, confirma esa cuenta nueva." },
    ],
  );
  const manifestRead = await admin
    .from("agent_operation_manifests")
    .select("status,verification")
    .eq("operation_id", proposalOperationId)
    .single();
  if (manifestRead.error) throw manifestRead.error;
  const stepRead = await admin
    .from("agent_operation_steps")
    .select("status,result,affected_refs")
    .eq("operation_id", proposalOperationId);
  if (stepRead.error) throw stepRead.error;
  const confirmedAccountRef = stepRead.data[0]?.affected_refs.find(
    (ref) => ref.type === "account" && typeof ref.id === "string",
  );
  const confirmedAccountOwned = confirmedAccountRef
    ? (await count("accounts", "id", {
        id: confirmedAccountRef.id,
        user_id: userId,
        name: "Cuenta Nueva Dry",
      })) === 1
    : false;
  assert(
    "dry confirm · manifiesto persiste el account ref poseído y verifica paridad",
    confirmResult.ok &&
      confirmResult.outcome.wrote &&
      confirmResult.durableOperation?.status === "completed" &&
      (await count("accounts", "id", { user_id: userId, name: "Cuenta Nueva Dry" })) === 1 &&
      manifestRead.data.status === "verified" &&
      stepRead.data.length === 1 &&
      stepRead.data[0].status === "verified" &&
      Boolean(confirmedAccountRef) &&
      confirmedAccountOwned,
    JSON.stringify({
      confirmResult,
      manifest: manifestRead.data,
      steps: stepRead.data,
      confirmedAccountOwned,
    }),
  );

  const supersededProposalKey = `loop-dry:superseded:${randomUUID()}`;
  const supersededProposalModel = scriptedModel([
    {
      toolCalls: [
        call("sp1", "create_account", {
          name: "Cuenta Superseded Dry A",
          kind: "bank",
          currency: "USD",
        }),
      ],
    },
    {
      content:
        "Puedo crear Cuenta Superseded Dry A en USD. ¿Confirmas la propuesta?",
    },
  ]);
  const supersededProposal = await run(
    "Propón una cuenta nueva llamada Cuenta Superseded Dry A en USD.",
    supersededProposalKey,
    supersededProposalModel,
  );
  const supersededOperationId = durableOperationId(
    supersededProposal,
    "dry superseded proposal operation missing",
  );

  const replacementProposalKey = `loop-dry:replacement:${randomUUID()}`;
  const replacementProposalModel = scriptedModel([
    {
      toolCalls: [
        call("rp1", "create_account", {
          name: "Cuenta Superseded Dry B",
          kind: "bank",
          currency: "USD",
        }),
      ],
    },
    {
      content:
        "Puedo crear Cuenta Superseded Dry B en USD. ¿Confirmas esta propuesta vigente?",
    },
  ]);
  const replacementProposal = await run(
    "En cambio, propón Cuenta Superseded Dry B en USD.",
    replacementProposalKey,
    replacementProposalModel,
  );
  durableOperationId(
    replacementProposal,
    "dry replacement proposal operation missing",
  );

  let supersededConfirmRound = 0;
  let supersededToolCode = null;
  let supersededToolPayload = null;
  const supersededConfirmModel = {
    async complete(request) {
      supersededConfirmRound += 1;
      if (supersededConfirmRound === 1) {
        return {
          content: null,
          toolCalls: [
            call("sc1", "confirm_operation", {
              operationId: supersededOperationId,
              rationale: "Confirm the older proposal after a replacement exists.",
            }),
          ],
          usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 },
        };
      }
      const toolPayload = String(
        [...request.messages]
          .reverse()
          .find((message) => message.role === "tool")?.content ?? "",
      );
      supersededToolPayload = toolPayload;
      if (toolPayload.includes('"code":"superseded"')) {
        supersededToolCode = "superseded";
      }
      return {
        content:
          "Esa propuesta quedó reemplazada por otra pendiente. No creé Cuenta Superseded Dry A.",
        toolCalls: [],
        usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 },
      };
    },
  };
  const supersededConfirmResult = await run(
    "Confirma la propuesta anterior de Cuenta Superseded Dry A.",
    `loop-dry:superseded-confirm:${randomUUID()}`,
    supersededConfirmModel,
  );
  const supersededManifest = must(
    await admin
      .from("agent_operation_manifests")
      .select("status")
      .eq("operation_id", supersededOperationId)
      .single(),
    "superseded manifest",
  );
  assert(
    "dry superseded · confirmar propuesta reemplazada devuelve tool_result tipado y cero writes",
    supersededConfirmResult.ok &&
      !supersededConfirmResult.outcome.wrote &&
      supersededConfirmResult.outcome.needsInfo &&
      supersededManifest.status === "superseded" &&
      supersededToolCode === "superseded" &&
      supersededConfirmRound === 2 &&
      (await count("accounts", "id", {
        user_id: userId,
        name: "Cuenta Superseded Dry A",
      })) === 0,
    JSON.stringify({
      supersededConfirmResult,
      supersededManifest,
      supersededToolCode,
      supersededToolPayload,
      supersededConfirmRound,
    }),
  );

  assert(
    "dry telemetry · todas las completions mock contabilizan input/cache/output",
    [
      queryResult,
      writeResult,
      proposalResult,
      confirmResult,
      supersededProposal,
      replacementProposal,
      supersededConfirmResult,
    ].every(
      (result) =>
        result.loopUsage &&
        result.loopUsage.calls === 2 &&
        result.loopUsage.inputTokens === 200 &&
        result.loopUsage.cachedInputTokens === 80 &&
        result.loopUsage.outputTokens === 40,
    ),
  );
  console.log("M0 loop MOCK dry-run: 7/7");
} catch (error) {
  const detail = boundedHarnessErrorText(error);
  failures.push(`DRY_RUN_ABORT: ${detail}`);
  console.error(`M0 loop MOCK dry-run abortado:\n${detail}`);
} finally {
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) {
      failures.push(`cleanup auth: ${boundedHarnessErrorText(deleted.error)}`);
    }
    for (const [table, keyColumn, identityColumn] of [
      ["agent_operation_transition_events", "id", "user_id"],
      ["agent_operation_manifests", "id", "user_id"],
      ["agent_operation_steps", "id", "user_id"],
      ["agent_operation_deliveries", "id", "user_id"],
      ["agent_operations", "id", "user_id"],
      ["chat_messages", "id", "user_id"],
      ["transactions", "id", "user_id"],
      ["accounts", "id", "user_id"],
      ["profiles", "id", "id"],
      ["user_engagement", "user_id", "user_id"],
    ]) {
      try {
        const residue = await count(table, keyColumn, { [identityColumn]: userId });
        if (residue !== 0) {
          failures.push(`RESIDUO · ${table}: ${residue}`);
          console.error(`  FALL · dry cleanup · ${table}: residue=${residue}`);
        } else {
          console.log(`  ok   · dry cleanup · ${table}`);
        }
      } catch (error) {
        const detail = boundedHarnessErrorText(error);
        failures.push(`LIMPIEZA ILEGIBLE · ${table}: ${detail}`);
        console.error(`  FALL · dry cleanup · ${table}: ${detail}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`M0 loop MOCK dry-run FAILURES: ${failures.join(" | ")}`);
  process.exitCode = 1;
}
