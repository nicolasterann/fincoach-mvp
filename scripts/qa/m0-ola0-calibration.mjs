// Plan Fricción Cero · Ola 0 — deterministic calibration legs that do not
// need a model or a disposable PostgreSQL persona.
//
//   KIPU_AGENT_MODE=loop node ./scripts/qa/m0-ola0-calibration.mjs

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

const { askFacts, deliverCalendarDigestWith } = await import(
  "../../src/lib/scheduled/recurring-notifier.ts"
);
const { planDigest } = await import("../../src/lib/scheduled/digest-plan.ts");
const {
  claimAmbientNudge,
  failAmbientClaimBeforeDelivery,
  publishCalendarDigest,
} = await import("../../src/lib/ambient/ambient-store.ts");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("OLA0_REMINDER_REQUIRES_SUPABASE_ENV");
}
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

const authorityPath = path.resolve(
  "src/lib/ai/agent/agent-operation-authority.ts",
);
const toolsPath = path.resolve("src/lib/ai/agent/kipu-agent-tools.ts");
const loopPath = path.resolve("src/lib/ai/agent/kipu-agent-loop.ts");
const runnerPath = path.resolve("scripts/qa/m0-loop-conversation-e2e.mjs");
const authoritySource = fs.readFileSync(authorityPath, "utf8");
const toolsSource = fs.readFileSync(toolsPath, "utf8");
const loopSource = fs.readFileSync(loopPath, "utf8");
const runnerSource = fs.readFileSync(runnerPath, "utf8");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function extractStringSet(source, anchor) {
  const start = source.indexOf(anchor);
  if (start < 0) throw new Error(`SOURCE_ANCHOR_MISSING:${anchor}`);
  const end = source.indexOf("]);", start);
  if (end < 0) throw new Error(`SOURCE_SET_UNTERMINATED:${anchor}`);
  return new Set(
    [...source.slice(start, end).matchAll(/"([a-z0-9_]+)"/g)].map(
      (match) => match[1],
    ),
  );
}

function sameSet(left, right) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function must(result, label) {
  if (result?.error) {
    throw new Error(
      `${label}:${JSON.stringify({
        code: result.error.code ?? null,
        message: result.error.message ?? "unknown",
        details: result.error.details ?? null,
        hint: result.error.hint ?? null,
      })}`,
    );
  }
  return result.data;
}

async function countIdentity(table, keyColumn, identityColumn, userId) {
  const read = await admin
    .from(table)
    .select(keyColumn, { count: "exact", head: true })
    .eq(identityColumn, userId);
  if (read.error || read.count == null) {
    throw new Error(`OLA0_RESIDUE_READ_FAILED:${table}`);
  }
  return Number(read.count);
}

const results = [];
function leg(id, checks, evidence) {
  const failures = checks.filter((row) => !row.ok).map((row) => row.name);
  const result = {
    id,
    status: failures.length === 0 ? "GREEN" : "RED",
    failures,
    evidence,
  };
  results.push(result);
  console.log(`[${id}] ${result.status}`);
  for (const check of checks) {
    console.log(`  ${check.ok ? "ok" : "RED"} · ${check.name}`);
  }
  console.log(`  EVIDENCE ${JSON.stringify(canonical(evidence))}`);
}

if (process.env.KIPU_AGENT_MODE !== "loop") {
  throw new Error("OLA0_REQUIRES_KIPU_AGENT_MODE_LOOP");
}

const reminderText =
  "Hoy vence Coto por 15.070,22 ARS. ¿Cuánto salió y desde dónde lo pagaste?";
let reminderUserId = null;
let reminderPlan = null;
let reminderFacts = "";
let reminderDelivery = null;
let published = null;
let persisted = null;
let reminderError = null;
const reminderResidue = {};
try {
  const created = must(
    await admin.auth.admin.createUser({
      email: `kipu-ola0-reminder-${Date.now()}-${randomUUID()}@example.invalid`,
      email_confirm: true,
      user_metadata: { m0_ola0_reminder: true },
    }),
    "reminder auth",
  );
  reminderUserId = created.user.id;
  must(
    await admin.from("profiles").upsert({
      id: reminderUserId,
      base_currency: "ARS",
      onboarding_completed: true,
    }),
    "reminder profile",
  );
  must(
    await admin.from("user_engagement").upsert({
      user_id: reminderUserId,
      timezone: "America/Argentina/Buenos_Aires",
    }),
    "reminder engagement",
  );
  const account = must(
    await admin
      .from("accounts")
      .insert({
        user_id: reminderUserId,
        name: "Supervielle",
        type: "bank",
        currency: "ARS",
        current_balance_original: 500_000,
        current_balance_base: 500_000,
        is_currency_default: true,
      })
      .select("id")
      .single(),
    "reminder account",
  );
  const fixedExpense = must(
    await admin
      .from("fixed_expenses")
      .insert({
        user_id: reminderUserId,
        name: "Coto",
        amount: 15_070.22,
        currency: "ARS",
        category: "food",
        frequency: "monthly",
        expected_day: 21,
        payment_source_type: "account",
        payment_source_id: account.id,
        is_variable: true,
        is_active: true,
      })
      .select("id")
      .single(),
    "reminder fixed expense",
  );
  const occurrenceRow = must(
    await admin
      .from("recurring_occurrences")
      .insert({
        user_id: reminderUserId,
        fixed_expense_id: fixedExpense.id,
        occurrence_date: "2026-08-21",
        kind: "expense",
        mode: "ask",
        expected_amount: 15_070.22,
        currency: "ARS",
        status: "pending",
      })
      .select("id,created_at")
      .single(),
    "reminder occurrence",
  );
  const occurrence = {
    id: occurrenceRow.id,
    userId: reminderUserId,
    incomeSourceId: null,
    fixedExpenseId: fixedExpense.id,
    debtAccountId: null,
    savingsPlanId: null,
    scheduledPaymentId: null,
    commitmentKind: null,
    occurrenceDate: "2026-08-21",
    kind: "expense",
    mode: "ask",
    expectedAmount: 15_070.22,
    currency: "ARS",
    status: "pending",
    createdTransactionId: null,
    resolvedAmount: null,
    resolvedCurrency: null,
    askCount: 0,
    snoozeUntil: null,
    lastAskedOn: null,
    resolvedAt: null,
    notified: false,
    satisfiedFactId: null,
    satisfiedAt: null,
    createdAt: occurrenceRow.created_at,
  };
  reminderPlan = planDigest({
    occurrences: [occurrence],
    today: "2026-08-21",
    nowMs: Date.parse("2026-08-21T03:00:00.000Z"),
    labelFor: () => "Coto",
  });
  reminderFacts = askFacts(occurrence, "Coto", "2026-08-21");
  reminderDelivery = await deliverCalendarDigestWith({
    claim: async () =>
      claimAmbientNudge({
        userId: reminderUserId,
        topic: "calendar_digest",
        dayBucket: "2026-08-21",
        reason: "ola0 reminder calibration",
        priority: 2,
        channel: "web",
        budgetLane: "calendar",
        laneCap: 1,
        payload: {
          version: 1,
          today: "2026-08-21",
          confirms: [],
          asks: [{ id: occurrence.id, expectedAskCount: 0 }],
        },
      }),
    generate: async () => reminderText,
    failBeforeDelivery: async (claimId, claimToken, reason) =>
      failAmbientClaimBeforeDelivery({
        id: claimId,
        userId: reminderUserId,
        token: claimToken,
        reason,
      }),
    publish: async (claimId, claimToken, content) => {
      published = { claimId, claimToken, content };
      return publishCalendarDigest({
        userId: reminderUserId,
        claimId,
        claimToken,
        content,
      });
    },
  });
  const [occurrenceAfter, messageAfter, nudgeAfter] = await Promise.all([
    admin
      .from("recurring_occurrences")
      .select("id,ask_count,last_asked_on,status")
      .eq("id", occurrence.id)
      .single(),
    admin
      .from("chat_messages")
      .select("id,content,channel,role")
      .eq("user_id", reminderUserId)
      .eq("content", reminderText)
      .single(),
    admin
      .from("ambient_nudges")
      .select("id,status,delivered,budget_lane")
      .eq("user_id", reminderUserId)
      .eq("topic", "calendar_digest")
      .single(),
  ]);
  persisted = {
    occurrence: must(occurrenceAfter, "reminder occurrence after"),
    message: must(messageAfter, "reminder message after"),
    nudge: must(nudgeAfter, "reminder nudge after"),
  };
} catch (error) {
  reminderError = error instanceof Error ? error.message : "NON_ERROR_FAILURE";
} finally {
  if (reminderUserId) {
    const deleted = await admin.auth.admin.deleteUser(reminderUserId);
    if (deleted.error) reminderError ??= `OLA0_REMINDER_CLEANUP:${deleted.error.message}`;
    for (const [table, keyColumn, identityColumn] of [
      ["ambient_nudges", "id", "user_id"],
      ["recurring_occurrences", "id", "user_id"],
      ["chat_messages", "id", "user_id"],
      ["fixed_expenses", "id", "user_id"],
      ["accounts", "id", "user_id"],
      ["user_engagement", "user_id", "user_id"],
      ["profiles", "id", "id"],
    ]) {
      try {
        reminderResidue[table] = await countIdentity(
          table,
          keyColumn,
          identityColumn,
          reminderUserId,
        );
      } catch (error) {
        reminderResidue[table] = "unreadable";
        reminderError ??=
          error instanceof Error ? error.message : "OLA0_RESIDUE_NON_ERROR";
      }
    }
  }
}
leg(
  "O0_REMINDER",
  [
    {
      name: "reminder fixture and RPC path complete without typed error",
      ok: reminderError == null,
    },
    {
      name: "night calendar selects the exact due occurrence",
      ok:
        reminderPlan?.send === true &&
        reminderPlan?.asks.length === 1 &&
        reminderPlan.asks[0]?.label === "Coto" &&
        reminderPlan.asks[0]?.occurrenceDate === "2026-08-21" &&
        reminderPlan.asks[0]?.amount === 15_070.22,
    },
    {
      name: "typed reminder facts retain entity, date and amount",
      ok:
        reminderFacts.includes('"Coto"') &&
        reminderFacts.includes("15.070,22 ARS") &&
        reminderFacts.includes("Hoy"),
    },
    {
      name: "mock copy crosses real claim and publish RPCs exactly once",
      ok:
        reminderDelivery?.ok === true &&
        reminderDelivery?.outcome === "published" &&
        reminderDelivery?.asked === 1 &&
        published?.content === reminderText &&
        persisted?.occurrence?.ask_count === 1 &&
        persisted?.occurrence?.last_asked_on === "2026-08-21" &&
        persisted?.message?.content === reminderText &&
        persisted?.message?.channel === "web" &&
        persisted?.message?.role === "assistant" &&
        persisted?.nudge?.status === "sent" &&
        persisted?.nudge?.budget_lane === "calendar",
    },
    {
      name: "reminder disposable identity leaves zero residue",
      ok:
        Object.keys(reminderResidue).length === 7 &&
        Object.values(reminderResidue).every((value) => value === 0),
    },
  ],
  {
    mode: process.env.KIPU_AGENT_MODE,
    reminderPlan,
    reminderFacts,
    published,
    persisted,
    reminderError,
    reminderResidue,
  },
);

const authoritySensitive = extractStringSet(
  authoritySource,
  "const SECOND_DELIVERY_CAPABILITIES = new Set([",
);
const runnerSensitive = extractStringSet(
  runnerSource,
  "const ALWAYS_SENSITIVE = new Set([",
);
const guardNames = [
  ...toolsSource.matchAll(/(?:export\s+)?function (\w+StateGuard)\(/g),
].map((match) => match[1]);
const guardRows = guardNames.map((guardName) => {
  const definitionAt = toolsSource.indexOf(`export function ${guardName}(`);
  const nextFunctionAt = toolsSource.indexOf("\nasync function ", definitionAt);
  const executorCallAt = toolsSource.indexOf(`${guardName}(args, ctx)`, nextFunctionAt);
  const executorHeaders =
    executorCallAt < 0
      ? []
      : [
          ...toolsSource
            .slice(0, executorCallAt)
            .matchAll(/async function execute([A-Z][A-Za-z0-9]*)\(/g),
        ];
  const executorHeader = executorHeaders.at(-1)?.[1] ?? "";
  const capability = executorHeader
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  const loopGuardCalls = loopSource.split(`${guardName}(`).length - 1;
  return {
    guardName,
    capability,
    sensitive: authoritySensitive.has(capability),
    executorUsesSameGuard: executorCallAt >= 0,
    loopUsesSameGuard: loopGuardCalls >= 2,
    dispatcherSelectsCapability: loopSource.includes(
      `call.name === "${capability}"`,
    ),
  };
});
leg(
  "O0_PREFLIGHT_PARITY",
  [
    {
      name: "runner sensitivity mirror equals the product set",
      ok: sameSet(authoritySensitive, runnerSensitive),
    },
    {
      name: "every exported pure state veto belongs to a sensitive capability",
      ok: guardRows.length > 0 && guardRows.every((row) => row.sensitive),
    },
    {
      name: "every exported pure state veto runs in executor and loop preflight",
      ok:
        guardRows.length > 0 &&
        guardRows.every(
          (row) =>
            row.executorUsesSameGuard &&
            row.loopUsesSameGuard &&
            row.dispatcherSelectsCapability,
        ),
    },
  ],
  {
    sensitiveCapabilities: [...authoritySensitive].sort(),
    sensitiveCount: authoritySensitive.size,
    pureStateGuards: guardRows,
  },
);

const red = results.filter((row) => row.status === "RED");
console.log(
  `Ola0 calibración determinista: ${results.length - red.length}/${results.length} verdes`,
);
if (red.length > 0) {
  console.error(
    `OLA0_STATIC_RED:${red.map((row) => `${row.id}:${row.failures.join(",")}`).join("|")}`,
  );
  process.exitCode = 1;
}
