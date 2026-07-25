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
  correctivePhrasing,
} = await import("../../src/lib/capture/capture-matching.ts");
const {
  executeCorrectMovementWith,
  guardMovementWritesWith,
  readDuplicateContextWith,
} = await import("../../src/lib/ai/agent/kipu-agent-tools.ts");
const {
  readCompleteRecentTransactionsWith,
} = await import("../../src/lib/financial/transaction-recovery.ts");

const checks = [];
function assert(name, pass, detail = "") {
  checks.push({ name, pass, detail });
}

function brief(value) {
  if (value?.ok === true && value?.complete === false) {
    return JSON.stringify({ ok: true, complete: false, rows: value.partial?.transactions?.length ?? 0 });
  }
  return JSON.stringify(value);
}

function tx(partial) {
  return {
    id: partial.id,
    type: "expense",
    description: "gasto",
    category: "other",
    originalAmount: 0,
    originalCurrency: "USD",
    baseAmount: 0,
    baseCurrency: "USD",
    exchangeRateToBase: 1,
    sourceAccountId: null,
    destinationAccountId: null,
    debtAccountId: null,
    goalId: null,
    relatedTransactionId: null,
    recurringExpenseId: null,
    externalRef: null,
    budgetTreatment: null,
    occurredAt: "2026-07-25T14:00:00.000Z",
    createdAt: "2026-07-25T14:00:00.000Z",
    ...partial,
  };
}

function readerFor(rows, options = {}) {
  const ordered = rows.slice().sort((a, b) =>
    a.createdAt !== b.createdAt
      ? a.createdAt < b.createdAt ? 1 : -1
      : a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
  );
  let calls = 0;
  return {
    page: async (_sinceISO, cursor, limit) => {
      calls += 1;
      if (options.failPage === calls) return { rows: null, failed: true };
      const from = cursor
        ? ordered.findIndex((row) => row.id === cursor.id && row.createdAt === cursor.createdAt) + 1
        : 0;
      return { rows: ordered.slice(from, from + limit), failed: false };
    },
    count: async () => ({
      count: options.count === undefined ? rows.length : options.count,
      failed: options.countFailed === true,
    }),
  };
}

const rows = Array.from({ length: 450 }, (_, i) =>
  tx({
    id: `tx-${String(i).padStart(4, "0")}`,
    description: i === 0 ? "McDonald's" : `gasto ${i}`,
    category: i === 0 ? "food" : "other",
    originalAmount: i === 0 ? 200 : 1_000 + i,
    sourceAccountId: "pichincha",
  }),
);
const full = await readCompleteRecentTransactionsWith(
  readerFor(rows),
  { sinceISO: "2026-07-22T00:00:00.000Z", pageSize: 200, maxPages: 5 },
);
assert(
  "cursor total: 450 filas empatadas, target de tercera página",
  full.ok && full.complete && full.recent.transactions.length === 450,
  JSON.stringify(full.ok && full.complete ? full.recent.transactions.length : full),
);

const context = await readDuplicateContextWith(async () => full, async () => []);
const entry = {
  userId: "u1",
  type: "expense",
  effectType: "expense",
  description: "McDonald's",
  category: "food",
  originalAmount: 200,
  originalCurrency: "USD",
  baseAmount: 200,
  baseCurrency: "USD",
  exchangeRateToBase: 1,
  sourceAccountId: "supervielle",
};
const evidenceGuard = await guardMovementWritesWith(
  {
    rawMessage: "Fue desde mi cuenta Supervielle no desde el Pichincha",
    entries: [entry],
    evidenceId: "pending-unrelated-evidence",
    confirmedNew: true,
  },
  async () => context,
);
assert(
  "evidencia y confirmedNew no abren una corrección",
  evidenceGuard?.status === "redirect" && evidenceGuard.data?.transactionId === "tx-0000",
  JSON.stringify(evidenceGuard),
);

const pageError = await readCompleteRecentTransactionsWith(
  readerFor(rows, { failPage: 2 }),
  { sinceISO: "2026-07-22T00:00:00.000Z", pageSize: 200, maxPages: 5 },
);
const capped = await readCompleteRecentTransactionsWith(
  readerFor(rows),
  { sinceISO: "2026-07-22T00:00:00.000Z", pageSize: 200, maxPages: 2 },
);
const moved = await readCompleteRecentTransactionsWith(
  readerFor(rows, { count: 451 }),
  { sinceISO: "2026-07-22T00:00:00.000Z", pageSize: 200, maxPages: 5 },
);
assert("error de página no es ausencia", !pageError.ok, brief(pageError));
assert("tope sin final no es completo", capped.ok && !capped.complete, brief(capped));
assert("conteo concurrente distinto no es completo", moved.ok && !moved.complete, brief(moved));

const failedContext = await readDuplicateContextWith(async () => pageError, async () => []);
const incompleteContext = await readDuplicateContextWith(async () => capped, async () => []);
const failedCorrection = await guardMovementWritesWith(
  { rawMessage: "no era con Pichincha, era Supervielle", entries: [entry] },
  async () => failedContext,
);
const incompleteCorrection = await guardMovementWritesWith(
  { rawMessage: "no era con Pichincha, era Supervielle", entries: [entry] },
  async () => incompleteContext,
);
const normalCapture = await guardMovementWritesWith(
  { rawMessage: "gasté 200 en McDonald's con Supervielle", entries: [entry] },
  async () => failedContext,
);
assert("corrección + error falla cerrado", failedCorrection?.status === "needs_info", JSON.stringify(failedCorrection));
assert("corrección + incompleto falla cerrado", incompleteCorrection?.status === "needs_info", JSON.stringify(incompleteCorrection));
assert("captura normal + error conserva fail-open", normalCapture === null, JSON.stringify(normalCapture));

const noTargetCorrection = await guardMovementWritesWith(
  {
    rawMessage: "me equivoqué: era un ingreso",
    entries: [{ ...entry, type: "income", effectType: "income", description: "Venta", destinationAccountId: "supervielle", sourceAccountId: null }],
  },
  async () => context,
);
assert(
  "corrección sin target nunca se convierte en movimiento nuevo",
  noTargetCorrection?.status === "needs_info",
  JSON.stringify(noTargetCorrection),
);

const historicalOriginal = tx({
  id: "tx-historical",
  type: "income",
  description: "Sueldo",
  category: "income",
  originalAmount: 1_000,
  sourceAccountId: null,
  destinationAccountId: "pichincha",
  occurredAt: "2026-06-01T12:00:00.000Z",
  createdAt: "2026-07-25T13:59:00.000Z",
});
const historicalRead = await readCompleteRecentTransactionsWith(
  readerFor([historicalOriginal]),
  { sinceISO: "2026-07-22T00:00:00.000Z", pageSize: 200, maxPages: 5 },
);
const historicalContext = await readDuplicateContextWith(async () => historicalRead, async () => []);
const historicalAmountCorrection = await guardMovementWritesWith(
  {
    rawMessage: "me equivoqué, el sueldo no eran 1000, eran 1200",
    entries: [{
      ...entry,
      type: "income",
      effectType: "income",
      description: "Sueldo",
      category: "income",
      originalAmount: 1_200,
      destinationAccountId: "pichincha",
      sourceAccountId: null,
    }],
  },
  async () => historicalContext,
);
assert(
  "ingreso recién capturado con fecha contable antigua se encuentra al corregir el monto",
  historicalAmountCorrection?.status === "redirect" &&
    historicalAmountCorrection.data?.transactionId === "tx-historical",
  JSON.stringify(historicalAmountCorrection),
);

const falsePositives = [
  "no fue caro, gasté 200 en McDonald's",
  "no es mucho: gasté 200 en McDonald's",
  "no era tan caro, gasté 200 en McDonald's",
  "no fue caro, era bastante barato",
].filter(correctivePhrasing);
assert("opiniones no son correcciones", falsePositives.length === 0, JSON.stringify(falsePositives));
assert(
  "la frase real del founder sí es corrección",
  correctivePhrasing("Fue desde mi cuenta Supervielle no desde el Pichincha"),
);

const original = tx({
  id: "tx-mac",
  description: "McDonald's",
  category: "food",
  originalAmount: 33_000,
  originalCurrency: "ARS",
  baseAmount: 22.31,
  baseCurrency: "USD",
  exchangeRateToBase: 0.000676,
  sourceAccountId: "pichincha",
});
const ctx = {
  userId: "u1",
  rawMessage: "Fue desde mi cuenta Supervielle no desde el Pichincha",
  channel: "web",
  baseCurrency: "USD",
  accounts: [
    { id: "pichincha", name: "Pichincha", currency: "USD" },
    { id: "supervielle", name: "Supervielle", currency: "ARS" },
  ],
  debtAccounts: [],
  goals: [],
  briefing: { objectives: { states: [] } },
};
let replacement = null;
const deps = {
  readTarget: async (_userId, transactionId) =>
    transactionId === "tx-mac"
      ? { ok: true, found: true, transaction: original, reversed: false }
      : { ok: true, found: false },
  correctMetadata: async () => {
    throw new Error("metadata writer must not run");
  },
  correctReplacement: async (input) => {
    replacement = input;
    return {};
  },
};
const corrected = await executeCorrectMovementWith(
  { transactionId: "tx-mac", newSourceAccountId: "supervielle" },
  ctx,
  deps,
);
assert(
  "executor exacto reemplaza Pichincha por Supervielle",
  corrected.status === "done" &&
    replacement?.correctedIntent?.sourceAccountId === "supervielle" &&
    replacement?.correctedIntent?.debtAccountId === undefined,
  JSON.stringify({ corrected, replacement }),
);

let writesOnReadFailure = 0;
const readFailure = await executeCorrectMovementWith(
  { transactionId: "tx-mac", newSourceAccountId: "supervielle" },
  ctx,
  {
    readTarget: async () => ({ ok: false }),
    correctMetadata: async () => {
      writesOnReadFailure += 1;
    },
    correctReplacement: async () => {
      writesOnReadFailure += 1;
      return {};
    },
  },
);
assert(
  "lectura exacta fallida: cero writes",
  readFailure.status === "needs_info" && writesOnReadFailure === 0,
  JSON.stringify({ readFailure, writesOnReadFailure }),
);

let dateReplacement = null;
const correctedDate = await executeCorrectMovementWith(
  { transactionId: "tx-mac", newOccurredAtISO: "2026-07-24" },
  ctx,
  {
    ...deps,
    correctReplacement: async (input) => {
      dateReplacement = input;
      return {};
    },
  },
);
assert(
  "corrección de fecha prometida por el prompt llega al writer",
  correctedDate.status === "done" &&
    dateReplacement?.correctedOccurredAtISO === "2026-07-24T12:00:00.000Z",
  JSON.stringify({ correctedDate, dateReplacement }),
);

const failed = checks.filter((check) => !check.pass);
for (const check of checks) {
  console.log(`${check.pass ? "✓" : "✗"} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
}
console.log(`${checks.length - failed.length}/${checks.length} checks`);
process.exitCode = failed.length ? 1 : 0;
