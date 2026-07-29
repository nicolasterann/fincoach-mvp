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
  OPEN_OCCURRENCES_UNREADABLE,
  matchOpenOccurrenceWith,
  occurrenceNamesCover,
  readOpenOccurrenceFactsForAgentWith,
  resolveCardStatementOcc,
} = await import("../../src/lib/financial/recurring-resolve.ts");
const {
  executeTool,
  guardUnavailableCalendarReplyWrite,
} = await import("../../src/lib/ai/agent/kipu-agent-tools.ts");
const {
  isReplyToRecurringNotification,
} = await import("../../src/lib/ai/agent/kipu-agent.ts");
const {
  overrideDebtDueWith,
  setCardStatementDueWith,
} = await import("../../src/lib/financial/commitments-store.ts");

let passed = 0;
function assert(name, condition, detail = "") {
  if (!condition) {
    throw new Error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
  passed += 1;
  process.stdout.write(`✓ ${name}\n`);
}

const occurrence = (id, debtAccountId, over = {}) => ({
  id,
  userId: "u1",
  kind: "card_statement",
  mode: "ask",
  status: "pending",
  occurrenceDate: "2026-07-15",
  expectedAmount: 55.6,
  currency: "USD",
  askCount: 1,
  notified: true,
  incomeSourceId: null,
  fixedExpenseId: null,
  debtAccountId,
  savingsPlanId: null,
  scheduledPaymentId: null,
  commitmentKind: null,
  createdTransactionId: null,
  snoozeUntil: null,
  lastAskedOn: null,
  resolvedAt: null,
  ...over,
});
const one = [occurrence("occ-diners", "diners")];
const twoVisas = [
  occurrence("occ-pich", "visa-pich"),
  occurrence("occ-prod", "visa-prod"),
];
const read = (value) => async () => value;
const dinersNames = async () => ({
  ok: true,
  names: new Map([["diners", "Diners"]]),
});
const visaNames = async () => ({
  ok: true,
  names: new Map([
    ["visa-pich", "Visa Pichincha"],
    ["visa-prod", "Visa Produbanco"],
  ]),
});

const failed = await matchOpenOccurrenceWith({}, {
  readOpen: read({ ok: false, complete: false }),
  readNames: dinersNames,
});
assert("lectura caída no se vuelve ausencia", failed.ok === false, JSON.stringify(failed));

const partial = await matchOpenOccurrenceWith({ flowName: "Diners" }, {
  readOpen: read({ ok: true, complete: false, partial: one }),
  readNames: dinersNames,
});
assert("lista parcial no autoriza ni por nombre", partial.ok === false, JSON.stringify(partial));

const ambiguousVisa = await matchOpenOccurrenceWith({ flowName: "Visa" }, {
  readOpen: read({ ok: true, complete: true, occurrences: twoVisas }),
  readNames: visaNames,
});
assert(
  "Visa no elige la primera de dos tarjetas",
  ambiguousVisa.ok === true && ambiguousVisa.id === null,
  JSON.stringify(ambiguousVisa),
);

const exactVisa = await matchOpenOccurrenceWith({ flowName: "Visa Pichincha" }, {
  readOpen: read({ ok: true, complete: true, occurrences: twoVisas }),
  readNames: visaNames,
});
assert(
  "nombre único y completo sí resuelve",
  exactVisa.ok === true && exactVisa.id === "occ-pich",
  JSON.stringify(exactVisa),
);

const namesDown = await matchOpenOccurrenceWith({ flowName: "Diners" }, {
  readOpen: read({ ok: true, complete: true, occurrences: one }),
  readNames: async () => ({ ok: false }),
});
assert("lectura de nombres caída no es mismatch", namesDown.ok === false, JSON.stringify(namesDown));

const partialFacts = await readOpenOccurrenceFactsForAgentWith({
  readOpen: read({ ok: true, complete: false, partial: one }),
  readNames: dinersNames,
});
assert(
  "prompt parcial se declara indisponible",
  partialFacts.ok === false && partialFacts.text === OPEN_OCCURRENCES_UNREADABLE,
  JSON.stringify(partialFacts),
);

const completeFacts = await readOpenOccurrenceFactsForAgentWith({
  readOpen: read({ ok: true, complete: true, occurrences: one }),
  readNames: dinersNames,
});
assert(
  "prompt completo conserva occurrenceId",
  completeFacts.ok === true && completeFacts.text.includes("occurrenceId=occ-diners"),
);

const anonymousFacts = await readOpenOccurrenceFactsForAgentWith({
  readOpen: read({ ok: true, complete: true, occurrences: twoVisas }),
  readNames: async () => ({ ok: false }),
});
assert(
  "nombres ilegibles no publican ids anónimos para que el modelo adivine",
  anonymousFacts.ok === false && anonymousFacts.text === OPEN_OCCURRENCES_UNREADABLE,
  JSON.stringify(anonymousFacts),
);
assert(
  "una fuente ausente no degrada una de dos tarjetas a etiqueta genérica",
  occurrenceNamesCover(twoVisas, new Map([["visa-pich", "Visa Pichincha"]])) === false,
);

assert(
  "solo el último mensaje recurrente activa procedencia",
  isReplyToRecurringNotification([
    { role: "assistant", content: "¿Corte?", metadata: { source: "recurring" } },
  ]) &&
    !isReplyToRecurringNotification([
      { role: "assistant", content: "¿Corte?", metadata: { source: "recurring" } },
      { role: "user", content: "otra conversación" },
    ]),
);

const blocked = guardUnavailableCalendarReplyWrite({
  calendarReplyExpected: true,
  calendarOccurrencesAvailable: false,
});
const unrelated = guardUnavailableCalendarReplyWrite({
  calendarReplyExpected: false,
  calendarOccurrencesAvailable: false,
});
const confirmedOther = guardUnavailableCalendarReplyWrite(
  { calendarReplyExpected: true, calendarOccurrencesAvailable: false },
  { confirmedUnrelated: true },
);
assert(
  "writer falla cerrado sin crear un cerrojo general",
  blocked?.status === "needs_info" && unrelated === null && confirmedOther === null,
);

const blockedTool = await executeTool(
  "log_movement",
  { type: "expense", amount: 50.6, description: "Diners" },
  {
    userId: "u1",
    accounts: [],
    debtAccounts: [],
    goals: [],
    snapshot: {},
    briefing: {},
    rawMessage: "ya me llegó, fueron 50.60",
    baseCurrency: "USD",
    timezone: "America/Argentina/Buenos_Aires",
    calendarReplyExpected: true,
    calendarOccurrencesAvailable: false,
  },
);
assert(
  "dispatcher real bloquea log_movement antes de construir o escribir",
  blockedTool.status === "needs_info" && blockedTool.summary.includes("NO registré"),
  JSON.stringify(blockedTool),
);

let setPayload = {};
const setResult = await setCardStatementDueWith(async (payload) => {
  setPayload = payload;
  return {
    data: {
      outcome: "updated",
      remaining_due: 50.6,
      statement_covered: false,
      occurrence_resolution: "resolved",
      occurrence_id: "occ-diners",
    },
    error: null,
  };
}, {
  userId: "u1",
  debtAccountId: "diners",
  amount: 50.6,
  statementDateISO: "2026-07-15",
  occurrenceId: "occ-diners",
});
assert(
  "corte fechado lleva y confirma la ocurrencia",
  setPayload.occurrence_id === "occ-diners" &&
    setResult.ok &&
    setResult.occurrenceResolution === "resolved" &&
    setResult.occurrenceId === "occ-diners",
  JSON.stringify({ setPayload, setResult }),
);

let legacyMarkCalls = 0;
const atomicResolve = await resolveCardStatementOcc({
    setDue: async () => setResult,
    mark: async () => { legacyMarkCalls += 1; return false; },
}, "confirm", 50.6);
assert(
  "un cierre atómico probado no depende de un segundo mark",
  atomicResolve.ok === true && legacyMarkCalls === 0,
  JSON.stringify({ atomicResolve, legacyMarkCalls }),
);

let concurrentMarkCalls = 0;
const concurrentResolve = await resolveCardStatementOcc({
  setDue: async () => ({
    ...setResult,
    occurrenceResolution: "already_resolved",
  }),
  mark: async () => { concurrentMarkCalls += 1; return true; },
}, "confirm", 50.6);
assert(
  "una ocurrencia resuelta concurrentemente no se vuelve a abrir ni reetiquetar",
  concurrentResolve.ok === true && concurrentMarkCalls === 0,
  JSON.stringify({ concurrentResolve, concurrentMarkCalls }),
);

let overridePayload = {};
const overrideResult = await overrideDebtDueWith(async (payload) => {
  overridePayload = payload;
  return {
    data: {
      outcome: "updated",
      remaining_due: 50.6,
      statement_covered: false,
      occurrence_resolution: "resolved",
      occurrence_id: "occ-diners",
    },
    error: null,
  };
}, {
  userId: "u1",
  debtAccountId: "diners",
  expectedDue: 55.6,
  newDue: 50.6,
  occurrenceId: "occ-diners",
});
assert(
  "override sin fecha lleva y confirma la ocurrencia",
  overridePayload.occurrence_id === "occ-diners" &&
    overrideResult.ok &&
    overrideResult.occurrenceResolution === "resolved",
  JSON.stringify({ overridePayload, overrideResult }),
);

const migration = fs.readFileSync(
  path.resolve("supabase/sql/075_bloqueJ_card_statement_occurrence_effect.sql"),
  "utf8",
);
assert(
  "las dos RPC públicas comparten el helper atómico",
  (migration.match(/v_occ := public\.kipu__resolve_card_statement_occurrence\(/g) ?? []).length === 2 &&
    migration.includes("set status = 'corrected'") &&
    // La ambigüedad determinista dejó de abortar (revertía el corte del usuario):
    // ver IR58. Lo que se fija ahora es que ese camino NO tira la operación.
    !/multiple open statement asks/.test(migration) &&
    migration.includes("'occurrence_resolution', 'ambiguous'"),
);
assert(
  "una ambigüedad no revierte el corte: devuelve 'ambiguous' y conserva el 40001 solo para el conflicto real",
  migration.includes("'occurrence_resolution', 'ambiguous'") &&
    migration.includes("statement occurrence % changed while resolving") &&
    migration.includes("errcode = '40001'"),
);
assert(
  "un statement viejo no cierra por fallback el aviso nuevo",
  migration.includes("coalesce(v_result->>'outcome', '') <> 'safe_newer_exists'") &&
    migration.includes("if v_id is null and not p_allow_single_fallback then"),
);

const tools = fs.readFileSync(
  path.resolve("src/lib/ai/agent/kipu-agent-tools.ts"),
  "utf8",
);
const resolver = fs.readFileSync(
  path.resolve("src/lib/financial/recurring-resolve.ts"),
  "utf8",
);
assert(
  "callers reales pasan occurrenceId, writers genéricos usan el guard y los nombres se acotan al set",
  tools.includes("occurrenceId: calendarOccurrenceId") &&
    // Dos cortes + la nueva RPC atómica de inversión: las tres operaciones que
    // cierran estado junto a dinero llevan la identidad de la ocurrencia.
    (resolver.match(/occurrenceId: occ\.id/g) ?? []).length === 3 &&
    (tools.match(/guardUnavailableCalendarReplyWrite\(ctx/g) ?? []).length >= 3 &&
    (resolver.match(/\.in\("id",/g) ?? []).length === 5 &&
    resolver.includes("if (!occurrenceNamesCover(occ, names))"),
);

const chatStore = fs.readFileSync(
  path.resolve("src/lib/chat-memory/chat-messages.ts"),
  "utf8",
);
const notifier = fs.readFileSync(
  path.resolve("src/lib/scheduled/recurring-notifier.ts"),
  "utf8",
);
const digestMigration = fs.readFileSync(
  path.resolve("supabase/sql/077_bloqueJ_atomic_proactive_digest.sql"),
  "utf8",
);
assert(
  "notifier persiste provenance por canal y no deja un Telegram fantasma",
  chatStore.includes("): Promise<string | null> {") &&
    chatStore.includes("export async function removeChatMessage") &&
    digestMigration.includes("insert into public.chat_messages (") &&
    digestMigration.includes("'calendarDigestClaimId', p_claim_id") &&
    notifier.includes("const telegramMessageId = await appendChatMessage({") &&
    notifier.includes("const removed = await removeChatMessage(input.userId, telegramMessageId);"),
);

process.stdout.write(`${passed}/${passed} checks\n`);
