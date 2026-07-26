import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const base = path.resolve("src", specifier.slice(2));
    const target = fs.existsSync(`${base}.ts`)
      ? `${base}.ts`
      : fs.existsSync(`${base}.tsx`)
        ? `${base}.tsx`
        : base;
    return nextResolve(pathToFileURL(target).href, context);
  },
});

const {
  claimAmbientNudgeWith,
  publishCalendarDigestWith,
} = await import("../../src/lib/ambient/ambient-store.ts");
const {
  askFacts,
  cardDueDaysFromRows,
  deliverCalendarDigestWith,
} = await import("../../src/lib/scheduled/recurring-notifier.ts");
const {
  validCalendarDateISO,
} = await import("../../src/lib/financial/card-cycle.ts");
const {
  executeUpdateCardObligationsWith,
} = await import("../../src/lib/ai/agent/kipu-agent-tools.ts");

let passed = 0;
function assert(name, condition, detail = "") {
  if (!condition) {
    throw new Error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
  passed += 1;
  process.stdout.write(`✓ ${name}\n`);
}

const claimInput = {
  userId: "u1",
  topic: "calendar_digest",
  dayBucket: "2026-07-26",
  reason: "qa",
  priority: 1,
  channel: "web",
  budgetLane: "calendar",
  laneCap: 1,
  totalCap: 2,
  payload: {
    version: 1,
    today: "2026-07-26",
    confirms: [],
    asks: [{ id: "00000000-0000-0000-0000-000000000001", expectedAskCount: 0 }],
  },
};

const failedClaim = await claimAmbientNudgeWith(claimInput, {
  call: async () => ({ data: null, error: { message: "db down" } }),
});
assert("claim caído no se vuelve cupo libre", failedClaim.ok === false);

const cappedClaim = await claimAmbientNudgeWith(claimInput, {
  call: async () => ({ data: { outcome: "cap_reached" }, error: null }),
});
assert(
  "cap_reached es un resultado tipado",
  cappedClaim.ok === true && cappedClaim.outcome === "cap_reached",
  JSON.stringify(cappedClaim),
);

const attemptedClaim = await claimAmbientNudgeWith(
  { ...claimInput, budgetLane: "coach", channel: "telegram" },
  {
    call: async () => ({
      data: { outcome: "already_attempted", id: "coach-claim" },
      error: null,
    }),
  },
);
assert(
  "un Telegram ambiguo queda at-most-once",
  attemptedClaim.ok &&
    attemptedClaim.outcome === "already_attempted" &&
    attemptedClaim.id === "coach-claim",
  JSON.stringify(attemptedClaim),
);

let generated = 0;
const cappedDelivery = await deliverCalendarDigestWith({
  claim: async () => cappedClaim,
  generate: async () => {
    generated += 1;
    return "no";
  },
  failBeforeDelivery: async () => true,
  publish: async () => ({ ok: false }),
});
assert(
  "un cupo lleno no consume IA ni publica",
  cappedDelivery.ok === true &&
    cappedDelivery.outcome === "skipped" &&
    generated === 0,
  JSON.stringify(cappedDelivery),
);

let released = 0;
let published = 0;
const noAi = await deliverCalendarDigestWith({
  claim: async () => ({
    ok: true,
    outcome: "claimed",
    id: "claim-1",
    token: "token-1",
    recovered: false,
  }),
  generate: async () => null,
  failBeforeDelivery: async () => {
    released += 1;
    return true;
  },
  publish: async () => {
    published += 1;
    return { ok: false };
  },
});
assert(
  "IA caída libera el claim sin publicar ni consumir asks",
  noAi.ok === false &&
    noAi.reason === "generation_failed" &&
    released === 1 &&
    published === 0,
  JSON.stringify(noAi),
);

const responseLost = await deliverCalendarDigestWith({
  claim: async () => ({
    ok: true,
    outcome: "claimed",
    id: "claim-2",
    token: "token-2",
    recovered: false,
  }),
  generate: async () => "Un resumen",
  failBeforeDelivery: async () => false,
  publish: async () => {
    published += 1;
    return published === 1
      ? { ok: false }
      : {
          ok: true,
          webMessageId: "message-1",
          autoNotified: 1,
          asked: 2,
          replayed: true,
        };
  },
});
assert(
  "respuesta perdida reintenta la publicación idempotente",
  responseLost.ok === true &&
    responseLost.outcome === "published" &&
    responseLost.replayed &&
    responseLost.autoNotified === 1 &&
    responseLost.asked === 2 &&
    published === 2,
  JSON.stringify(responseLost),
);

const malformedPublish = await publishCalendarDigestWith(
  {
    userId: "u1",
    claimId: "claim",
    claimToken: "token",
    content: "Resumen",
  },
  { call: async () => ({ data: { outcome: "published" }, error: null }) },
);
assert("una respuesta RPC incompleta no se confirma", malformedPublish.ok === false);

const goodPublish = await publishCalendarDigestWith(
  {
    userId: "u1",
    claimId: "claim",
    claimToken: "token",
    content: "Resumen",
  },
  {
    call: async () => ({
      data: {
        outcome: "published",
        web_message_id: "message",
        auto_notified: 2,
        asked: 3,
      },
      error: null,
    }),
  },
);
assert(
  "la respuesta completa conserva los contadores aterrizados",
  goodPublish.ok &&
    goodPublish.webMessageId === "message" &&
    goodPublish.autoNotified === 2 &&
    goodPublish.asked === 3,
  JSON.stringify(goodPublish),
);

const dueFailure = cardDueDaysFromRows(
  ["card-a"],
  { data: [], error: { message: "down" } },
);
const dueMissing = cardDueDaysFromRows(
  ["card-a", "card-b"],
  { data: [{ id: "card-a", due_day: 3 }], error: null },
);
const dueGood = cardDueDaysFromRows(
  ["card-a", "card-b"],
  {
    data: [
      { id: "card-a", due_day: 3 },
      { id: "card-b", due_day: null },
    ],
    error: null,
  },
);
assert("error de vencimientos falla cerrado", dueFailure.ok === false);
assert("fila faltante no fabrica completitud", dueMissing.ok === false);
assert(
  "NULL probado es ausencia legítima",
  dueGood.ok &&
    dueGood.dueDays.get("card-a") === 3 &&
    dueGood.dueDays.get("card-b") === null,
);

assert(
  "fecha futura válida y calendario imposible rechazado",
  validCalendarDateISO("2026-08-03") === "2026-08-03" &&
    validCalendarDateISO("2026-02-31") === null,
);

const card = {
  id: "diners",
  name: "Diners NT",
  type: "credit_card",
  currency: "USD",
  currentBalanceOriginal: 100,
  currentBalanceBase: 100,
  fullPaymentDue: 55.6,
  fullPaymentDueOriginal: 55.6,
  statementDate: null,
  dueDay: 3,
};
let futurePatch = null;
let invalidWrites = 0;
const obligationDeps = {
  setStatement: async () => {
    invalidWrites += 1;
    return { ok: false };
  },
  overrideDue: async () => ({
    ok: true,
    remainingDue: 50.6,
    statementCovered: false,
    occurrenceResolution: "none",
    occurrenceId: null,
  }),
  applyPatch: async ({ patch }) => {
    futurePatch = patch;
    return { ok: true, rows: 1 };
  },
  writeAudit: async () => {},
};
const futureDue = await executeUpdateCardObligationsWith(
  {
    debtAccountId: "diners",
    totalDueThisMonth: 50.6,
    statementDueDate: "2026-08-03",
  },
  { userId: "u1", baseCurrency: "USD", debtAccounts: [card] },
  obligationDeps,
);
const impossibleDue = await executeUpdateCardObligationsWith(
  {
    debtAccountId: "diners",
    totalDueThisMonth: 50.6,
    statementDueDate: "2026-02-31",
  },
  { userId: "u1", baseCurrency: "USD", debtAccounts: [card] },
  {
    ...obligationDeps,
    overrideDue: async () => {
      invalidWrites += 1;
      return { ok: false };
    },
    applyPatch: async () => {
      invalidWrites += 1;
      return { ok: false, rows: 0 };
    },
  },
);
assert(
  "executor conserva el vencimiento futuro y rehúsa el imposible antes de escribir",
  futureDue.status === "done" &&
    futurePatch?.statement_due_date === "2026-08-03" &&
    impossibleDue.status === "needs_info" &&
    invalidWrites === 0,
  JSON.stringify({ futureDue, futurePatch, impossibleDue, invalidWrites }),
);

const oldFixed = askFacts(
  {
    id: "fixed-1",
    userId: "u1",
    kind: "expense",
    mode: "ask",
    status: "pending",
    occurrenceDate: "2026-07-15",
    expectedAmount: 12.99,
    currency: "USD",
    askCount: 1,
    notified: true,
    incomeSourceId: null,
    fixedExpenseId: "apple-tv",
    debtAccountId: null,
    savingsPlanId: null,
    scheduledPaymentId: null,
    commitmentKind: null,
    createdTransactionId: null,
    snoozeUntil: null,
    lastAskedOn: "2026-07-15",
    resolvedAt: null,
  },
  "Apple TV",
  "2026-07-18",
);
assert(
  "re-ask de fijo dice vencía y no hoy vence",
  oldFixed.includes("vencía el gasto") && !oldFixed.includes("Hoy vence"),
  oldFixed,
);

const migration = fs.readFileSync(
  "supabase/sql/077_bloqueJ_atomic_proactive_digest.sql",
  "utf8",
);
assert(
  "claim y conteo comparten un lock",
  /pg_advisory_xact_lock[\s\S]*select count\(\*\)[\s\S]*insert into public\.ambient_nudges/.test(migration),
);
assert(
  "publicación contiene CAS, chat y finalización",
  /set ask_count = v_expected \+ 1[\s\S]*insert into public\.chat_messages[\s\S]*set delivered = true/.test(migration),
);
assert(
  "payload faltante falla de forma explícita",
  migration.includes("jsonb_typeof(v_payload->'asks') is distinct from 'array'"),
);
assert(
  "coach no reenvía tras una respuesta externa ambigua",
  migration.includes("if v_existing.budget_lane = 'coach' then") &&
    migration.includes("'outcome', 'already_attempted'"),
);

process.stdout.write(`\n${passed}/${passed} checks J-4 verdes\n`);
