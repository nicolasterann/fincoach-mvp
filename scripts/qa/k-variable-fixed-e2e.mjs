// Bloque K — E2E de fijos variables contra PostgreSQL REAL.
//
// Este harness es deliberadamente falsable:
//   - sin la 093 instalada, falla por nombre (no llama "verde" al guard TS);
//   - usa los writers reales, dispara los triggers reales y mira dinero,
//     ocurrencia, observación y forecast;
//   - una persona desechable se elimina en finally y cualquier residuo hace
//     exit 1.
//
//   node --env-file=.env.local ./scripts/qa/k-variable-fixed-e2e.mjs

import fs from "node:fs";
import path from "node:path";
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
        ? path.resolve(
            path.dirname(new URL(context.parentURL).pathname),
            specifier,
          )
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

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SRK) {
  throw new Error(
    "faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
const admin = createClient(URL_, SRK, {
  auth: { persistSession: false },
});
const {
  applyFixedExpenseWithPayment,
  applyLedgerEntry,
  applyLedgerReversal,
} = await import("@/lib/ai/apply-chat-transaction-intent");
const {
  planRecurringLedgerEntry,
} = await import("@/lib/financial/recurring-ledger");
const {
  createOccurrenceIfAbsent,
  readFixedExpenseCycleOccurrences,
} = await import("@/lib/financial/recurring-occurrences-store");
const {
  readKnownVariableFixedBills,
  recordVariableFixedObservation,
} = await import("@/lib/financial/variable-fixed-store");
const { resolveOccurrence } = await import(
  "@/lib/financial/recurring-resolve"
);

let passed = 0;
let executedChecks = 0;
const EXPECTED_CHECKS = 79;
const failed = [];
function check(name, ok, detail = "") {
  executedChecks += 1;
  if (ok) {
    passed += 1;
    console.log(`  ok   · ${name}`);
  } else {
    failed.push(name);
    console.log(`  FALL · ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}
function cents(value) {
  return Math.round(Number(value) * 100) / 100;
}
async function one(table, select, column, value) {
  const { data, error } = await admin
    .from(table)
    .select(select)
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}
async function currentObservation(select, occurrenceId) {
  const { data, error } = await admin
    .from("fixed_expense_observations")
    .select(select)
    .eq("occurrence_id", occurrenceId)
    .eq("is_current", true)
    .limit(2);
  if (error) {
    return {
      ok: false,
      row: null,
      detail: `fixed_expense_observations current: ${error.message}`,
    };
  }
  if (!data || data.length !== 1) {
    return {
      ok: false,
      row: null,
      detail: `fixed_expense_observations current: expected 1 row for ${occurrenceId}, got ${data?.length ?? "unreadable"}`,
    };
  }
  return { ok: true, row: data[0], detail: "" };
}
async function count(table, column, value) {
  const { count: valueCount, error } = await admin
    .from(table)
    .select("*", { head: true, count: "exact" })
    .eq(column, value);
  if (error || valueCount == null) {
    throw new Error(`${table} count: ${error?.message ?? "null count"}`);
  }
  return valueCount;
}

let userId = null;
let migrationMissing = false;
const disposableUserIds = [];
const ids = {};
try {
  const { error: migrationProbe } = await admin.rpc(
    "kipu_record_variable_fixed_observation",
    { p: {} },
  );
  if (
    migrationProbe &&
    /schema cache|could not find the function|PGRST202/i.test(
      `${migrationProbe.code ?? ""} ${migrationProbe.message}`,
    )
  ) {
    migrationMissing = true;
    throw new Error(`MIGRACIÓN 093 NO APLICADA: ${migrationProbe.message}`);
  }
  const email = `kipu-k-e2e-${Date.now()}@example.invalid`;
  const password = `Kipu-K-${Date.now()}-Aa1!`;
  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { kipu_smoke: true },
    });
  if (authError) throw new Error(`createUser: ${authError.message}`);
  userId = authData.user.id;
  disposableUserIds.push(userId);
  console.log(`persona desechable: ${userId}`);

  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    base_currency: "USD",
    onboarding_completed: true,
  });
  if (profileError) throw new Error(`profile: ${profileError.message}`);
  const { data: account, error: accountError } = await admin
    .from("accounts")
    .insert({
      user_id: userId,
      name: "Cuenta K USD",
      type: "bank",
      currency: "USD",
      current_balance_original: 1000,
      current_balance_base: 1000,
    })
    .select("id")
    .single();
  if (accountError) throw new Error(`account: ${accountError.message}`);
  ids.account = account.id;
  const { data: alternateAccount, error: alternateAccountError } = await admin
    .from("accounts")
    .insert({
      user_id: userId,
      name: "Cuenta K alterna USD",
      type: "bank",
      currency: "USD",
      current_balance_original: 500,
      current_balance_base: 500,
    })
    .select("id")
    .single();
  if (alternateAccountError) {
    throw new Error(`alternate account: ${alternateAccountError.message}`);
  }
  ids.alternateAccount = alternateAccount.id;

  const { data: fixed, error: fixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Luz K",
      amount: 100,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 15,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_variable: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (fixedError) {
    if (/fixed_expense_forecasts|does not exist/i.test(fixedError.message)) {
      migrationMissing = true;
      throw new Error(
        `MIGRACIÓN 093 NO APLICADA: ${fixedError.message}`,
      );
    }
    throw new Error(`fixed: ${fixedError.message}`);
  }
  ids.fixed = fixed.id;

  const forecast0 = await one(
    "fixed_expense_forecasts",
    "regime, declared_amount, planning_amount, currency, cadence, sample_count, confidence",
    "fixed_expense_id",
    ids.fixed,
  );
  check(
    "K1 · crear un variable crea forecast baseline, no una observación inventada",
    forecast0?.regime === 1 &&
      cents(forecast0?.planning_amount) === 100 &&
      cents(forecast0?.declared_amount) === 100 &&
      forecast0?.currency === "USD" &&
      forecast0?.cadence === "monthly" &&
      forecast0?.sample_count === 0 &&
      (await count("fixed_expense_observations", "fixed_expense_id", ids.fixed)) === 0,
    JSON.stringify(forecast0),
  );

  const lowercasePlanName = "Fijo K moneda minúscula";
  const { error: lowercasePlanError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: lowercasePlanName,
      amount: 10,
      currency: "usd",
      category: "utilities",
      frequency: "monthly",
      expected_day: 20,
      is_variable: true,
      is_active: true,
    });
  const { count: lowercasePlanCount, error: lowercasePlanCountError } =
    await admin
      .from("fixed_expenses")
      .select("*", { head: true, count: "exact" })
      .eq("user_id", userId)
      .eq("name", lowercasePlanName);
  check(
    "K74 · la moneda nativa del plan queda canónica en PostgreSQL; un writer crudo no planta un régimen ilegible",
    !!lowercasePlanError &&
      /fixed_expenses_currency_iso_ck/i.test(lowercasePlanError.message) &&
      !lowercasePlanCountError &&
      lowercasePlanCount === 0,
    JSON.stringify({
      error: lowercasePlanError?.message,
      countError: lowercasePlanCountError?.message,
      count: lowercasePlanCount,
    }),
  );

  const { error: incompleteObservedError } = await admin
    .from("recurring_occurrences")
    .insert({
      user_id: userId,
      fixed_expense_id: ids.fixed,
      occurrence_date: "2030-01-15",
      kind: "expense",
      mode: "ask",
      expected_amount: 100,
      currency: "USD",
      status: "observed",
    });
  check(
    "K57 · una ocurrencia variable solo nace pending; el trigger rehúsa un observed crudo y no aterriza fila",
    !!incompleteObservedError &&
      /variable bill occurrence must start pending/i.test(
        incompleteObservedError.message,
      ) &&
      (await count(
        "recurring_occurrences",
        "fixed_expense_id",
        ids.fixed,
      )) === 0,
    incompleteObservedError?.message ?? "el estado imposible fue aceptado",
  );
  const incompleteConstraintDate = "2030-01-16";
  const { error: incompleteConstraintError } = await admin
    .from("recurring_occurrences")
    .insert({
      user_id: userId,
      fixed_expense_id: null,
      occurrence_date: incompleteConstraintDate,
      kind: "expense",
      mode: "ask",
      expected_amount: 100,
      currency: "USD",
      status: "observed",
    });
  const { count: incompleteConstraintCount, error: incompleteConstraintCountError } =
    await admin
      .from("recurring_occurrences")
      .select("*", { head: true, count: "exact" })
      .eq("user_id", userId)
      .eq("occurrence_date", incompleteConstraintDate);
  check(
    "K57b · el CHECK observed_fact sigue cerrando writers no variables aunque no intervenga el trigger K",
    !!incompleteConstraintError &&
      /recurring_occurrences_observed_fact_chk/i.test(
        incompleteConstraintError.message,
      ) &&
      !incompleteConstraintCountError &&
      incompleteConstraintCount === 0,
    JSON.stringify({
      error: incompleteConstraintError?.message,
      countError: incompleteConstraintCountError?.message,
      count: incompleteConstraintCount,
    }),
  );

  async function occurrence(date, fixedId = ids.fixed, amount = 100, currency = "USD") {
    const made = await createOccurrenceIfAbsent({
      userId,
      fixedExpenseId: fixedId,
      occurrenceDate: date,
      kind: "expense",
      mode: "ask",
      expectedAmount: amount,
      currency,
    });
    if (!made) throw new Error(`occurrence ${date}: no se creó`);
    return made.occurrence;
  }
  const jan = await occurrence("2026-01-15");
  const observeJan = {
    userId,
    occurrenceId: jan.id,
    amount: 80,
    currency: "USD",
    action: "observe",
    scope: "once",
    dedupeKey: "k:jan:observe",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
  };
  const bal0 = Number(
    (await one(
      "accounts",
      "current_balance_original",
      "id",
      ids.account,
    ))?.current_balance_original,
  );
  const observed = await recordVariableFixedObservation(observeJan);
  const janObserved = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    jan.id,
  );
  check(
    "K2 · observar guarda monto nativo, deja el pago abierto y mueve cero dinero",
    observed.ok &&
      observed.occurrenceStatus === "observed" &&
      janObserved?.status === "observed" &&
      cents(janObserved?.resolved_amount) === 80 &&
      janObserved?.created_transaction_id == null &&
      Number(
        (await one(
          "accounts",
          "current_balance_original",
          "id",
          ids.account,
        ))?.current_balance_original,
      ) === bal0,
    JSON.stringify({ observed, janObserved }),
  );
  const observedReplay = await recordVariableFixedObservation(observeJan);
  check(
    "K3 · replay exacto de observación devuelve la misma identidad sin duplicar",
    observedReplay.ok &&
      observedReplay.replayed &&
      observed.ok &&
      observedReplay.observationId === observed.observationId &&
      (await count("fixed_expense_observations", "fixed_expense_id", ids.fixed)) === 1,
    JSON.stringify(observedReplay),
  );
  const observedMismatch = await recordVariableFixedObservation({
    ...observeJan,
    amount: 81,
  });
  check(
    "K4 · mismo dedupe con otro monto se rehúsa",
    !observedMismatch.ok && observedMismatch.reason === "unsafe",
    JSON.stringify(observedMismatch),
  );

  const janPayPlan = planRecurringLedgerEntry({
    userId,
    kind: "expense",
    nativeAmount: 80,
    nativeCurrency: "USD",
    base: "USD",
    rates: [],
    accountId: ids.account,
    accountCurrency: "USD",
    isCard: false,
    recurringExpenseId: ids.fixed,
    dedupeKey: "k:jan:ledger",
    occurredAtISO: "2026-01-15T12:00:00.000Z",
    occurrenceDateISO: "2026-01-15",
    description: "Luz K",
    sourceLinkId: ids.fixed,
  });
  if (!janPayPlan.ok) throw new Error(`jan plan: ${janPayPlan.reason}`);
  const paidJan = await recordVariableFixedObservation({
    ...observeJan,
    action: "pay",
    dedupeKey: "k:jan:pay",
    expectedOccurrenceStatus: "observed",
    expectedResolvedAmount: 80,
    entry: janPayPlan.entry,
  });
  const afterPay = Number(
    (await one(
      "accounts",
      "current_balance_original",
      "id",
      ids.account,
    ))?.current_balance_original,
  );
  check(
    "K5 · pagar una observación confirma factura+ledger juntos",
    paidJan.ok &&
      paidJan.occurrenceStatus === "confirmed" &&
      afterPay === bal0 - 80,
    JSON.stringify({ paidJan, afterPay }),
  );
  const paidReplay = await recordVariableFixedObservation({
    ...observeJan,
    action: "pay",
    dedupeKey: "k:jan:pay",
    // A retry after a lost response reloads the NEW occurrence snapshot and
    // can resolve FX again. Those optimistic/derived fields must not turn the
    // same native operation into a dedupe mismatch.
    expectedOccurrenceStatus: "confirmed",
    expectedResolvedAmount: 80,
    expectedTransactionId: paidJan.ok ? paidJan.transactionId : null,
    entry: janPayPlan.entry,
  });
  check(
    "K6 · replay del pago no vuelve a debitar",
    paidReplay.ok &&
      paidReplay.replayed &&
      Number(
        (await one(
          "accounts",
          "current_balance_original",
          "id",
          ids.account,
        ))?.current_balance_original,
      ) === afterPay,
    JSON.stringify(paidReplay),
  );

  const janPaidRow = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    jan.id,
  );
  const corrected = await resolveOccurrence({
    userId,
    occurrenceId: jan.id,
    action: "correct",
    amount: 90,
    scope: "once",
  });
  const janCorrectedRow = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    jan.id,
  );
  check(
    "K7 · el caller real corrige una factura ya terminal: revierte y reemplaza, no suma 80+90",
    corrected.ok &&
      janCorrectedRow?.status === "corrected" &&
      Number(
        (await one(
          "accounts",
          "current_balance_original",
          "id",
          ids.account,
        ))?.current_balance_original,
      ) === bal0 - 90 &&
      (await count("fixed_expense_observations", "fixed_expense_id", ids.fixed)) === 3 &&
      (await count("transactions", "related_transaction_id", janPaidRow.created_transaction_id)) === 1,
    JSON.stringify({ corrected, janCorrectedRow }),
  );

  let k13Ok = false;
  let k13State = {};
  try {
    if (!corrected.ok || !janCorrectedRow?.created_transaction_id) {
      throw new Error(
        `prerrequisito K7 falló: ${JSON.stringify({
          corrected,
          janCorrectedRow,
        })}`,
      );
    }
    // K13 measures only the undo/redelivery/redo sequence. Keep it adjacent to
    // K7 so later bills on the same plan cannot contaminate its cash baseline.
    const balanceBeforeCanonicalUndo = Number(
      (await one(
        "accounts",
        "current_balance_original",
        "id",
        ids.account,
      ))?.current_balance_original,
    );
    await applyLedgerReversal(admin, {
      userId,
      originalTransactionId: janCorrectedRow.created_transaction_id,
      occurredAtISO: "2026-01-16T12:00:00.000Z",
    });
    const janAfterUndo = await one(
      "recurring_occurrences",
      "status, resolved_amount, created_transaction_id",
      "id",
      jan.id,
    );
    const replayAfterUndo = await resolveOccurrence({
      userId,
      occurrenceId: jan.id,
      action: "correct",
      amount: 90,
      scope: "once",
      paymentSource: {
        id: ids.account,
        currency: "USD",
        isCard: false,
      },
      paymentDateISO: "2026-01-15",
    });
    const balanceAfterRejectedRedelivery = Number(
      (await one(
        "accounts",
        "current_balance_original",
        "id",
        ids.account,
      ))?.current_balance_original,
    );
    const explicitRedoAfterUndo = await resolveOccurrence({
      userId,
      occurrenceId: jan.id,
      action: "correct",
      amount: 90,
      scope: "once",
      paymentSource: {
        id: ids.account,
        currency: "USD",
        isCard: false,
      },
      paymentDateISO: "2026-01-15",
      operationId: "k:jan:explicit-redo",
    });
    const janAfterExplicitRedo = await one(
      "recurring_occurrences",
      "status, resolved_amount, created_transaction_id",
      "id",
      jan.id,
    );
    k13State = {
      janAfterUndo,
      replayAfterUndo,
      balanceAfterRejectedRedelivery,
      explicitRedoAfterUndo,
      janAfterExplicitRedo,
      balanceBeforeCanonicalUndo,
    };
    k13Ok =
      janAfterUndo?.status === "observed" &&
      cents(janAfterUndo?.resolved_amount) === 90 &&
      janAfterUndo?.created_transaction_id == null &&
      balanceAfterRejectedRedelivery === balanceBeforeCanonicalUndo + 90 &&
      !replayAfterUndo.ok &&
      /cambió|otro pago/i.test(replayAfterUndo.detail) &&
      explicitRedoAfterUndo.ok &&
      ["confirmed", "corrected"].includes(
        String(janAfterExplicitRedo?.status),
      ) &&
      cents(janAfterExplicitRedo?.resolved_amount) === 90 &&
      janAfterExplicitRedo?.created_transaction_id != null &&
      janAfterExplicitRedo.created_transaction_id !==
        janCorrectedRow.created_transaction_id &&
      Number(
        (await one(
          "accounts",
          "current_balance_original",
          "id",
          ids.account,
        ))?.current_balance_original,
      ) === balanceBeforeCanonicalUndo;
  } catch (error) {
    k13State = {
      error: error instanceof Error ? error.message : String(error),
      ...k13State,
    };
  }
  check(
    "K13 · deshacer conserva la factura: el redelivery viejo no re-paga y una nueva orden explícita sí puede hacerlo una vez",
    k13Ok,
    JSON.stringify(k13State),
  );

  const feb = await occurrence("2026-02-15");
  const fromNow = await recordVariableFixedObservation({
    userId,
    occurrenceId: feb.id,
    amount: 120,
    currency: "USD",
    action: "observe",
    scope: "from_now",
    dedupeKey: "k:feb:from-now",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
  });
  const fixedAfter = await one(
    "fixed_expenses",
    "amount",
    "id",
    ids.fixed,
  );
  const forecastAfter = await one(
    "fixed_expense_forecasts",
    "regime, declared_amount, planning_amount, currency, cadence, sample_count",
    "fixed_expense_id",
    ids.fixed,
  );
  check(
    "K8 · from_now inicia régimen nuevo sin mezclar historia anterior",
    fromNow.ok &&
      cents(fixedAfter?.amount) === 120 &&
      forecastAfter?.regime === 2 &&
      cents(forecastAfter?.planning_amount) === 120 &&
      forecastAfter?.sample_count === 1,
    JSON.stringify({ fromNow, fixedAfter, forecastAfter }),
  );
  check(
    "K44 · el forecast queda ligado durablemente al monto, moneda y cadencia exactos del plan que proyecta",
    cents(forecastAfter?.declared_amount) === 120 &&
      forecastAfter?.currency === "USD" &&
      forecastAfter?.cadence === "monthly",
    JSON.stringify(forecastAfter),
  );

  const { data: reclassFixed, error: reclassFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Gas K cambio tardío",
      amount: 50,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 20,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_variable: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (reclassFixedError) {
    throw new Error(`reclass fixed: ${reclassFixedError.message}`);
  }
  const reclassOccurrence = await occurrence(
    "2026-01-20",
    reclassFixed.id,
    50,
  );
  const reclassOnce = await recordVariableFixedObservation({
    userId,
    occurrenceId: reclassOccurrence.id,
    amount: 60,
    currency: "USD",
    action: "observe",
    scope: "once",
    dedupeKey: "k:reclass:once",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
  });
  const reclassPermanent = await recordVariableFixedObservation({
    userId,
    occurrenceId: reclassOccurrence.id,
    amount: 60,
    currency: "USD",
    action: "observe",
    scope: "from_now",
    dedupeKey: "k:reclass:from-now",
    expectedOccurrenceStatus: "observed",
    expectedResolvedAmount: 60,
    expectedTransactionId: null,
  });
  const reclassForecast = await one(
    "fixed_expense_forecasts",
    "regime, planning_amount, sample_count, confidence",
    "fixed_expense_id",
    reclassFixed.id,
  );
  const reclassObservationRead = await currentObservation(
    "regime, amount, is_current",
    reclassOccurrence.id,
  );
  const reclassObservation = reclassObservationRead.row;
  check(
    "K35 · declarar permanente un hecho ya observado lo conserva como primera muestra del régimen nuevo",
    reclassOnce.ok &&
      reclassPermanent.ok &&
      reclassObservationRead.ok &&
      reclassForecast?.regime === 2 &&
      cents(reclassForecast?.planning_amount) === 60 &&
      reclassForecast?.sample_count === 1 &&
      reclassForecast?.confidence === "low" &&
      reclassObservation?.regime === 2 &&
      reclassObservation?.is_current === true &&
      cents(reclassObservation?.amount) === 60,
    JSON.stringify({
      reclassOnce,
      reclassPermanent,
      reclassForecast,
      reclassObservation,
      observationRead: reclassObservationRead.detail,
    }),
  );
  // Leave February's observation in the estimator, but close its reminder.
  // Otherwise the generic March payment is correctly ambiguous between two
  // open monthly cycles and the fallback must refuse to guess.
  const febDismissed = await resolveOccurrence({
    userId,
    occurrenceId: feb.id,
    action: "dismiss",
  });
  if (!febDismissed.ok) {
    throw new Error(
      `no se pudo cerrar el recordatorio de febrero: ${febDismissed.detail}`,
    );
  }

  const march = await occurrence("2026-03-15", ids.fixed, 120);
  const txMarch = await applyLedgerEntry(admin, {
    userId,
    type: "expense",
    effectType: "expense",
    category: "utilities",
    description: "Luz K marzo",
    originalAmount: 135,
    originalCurrency: "USD",
    baseAmount: 135,
    baseCurrency: "USD",
    exchangeRateToBase: 1,
    sourceAccountId: ids.account,
    recurringExpenseId: ids.fixed,
    occurredAtISO: "2026-03-15T12:00:00.000Z",
    inputChannel: "web",
    dedupeKey: "k:march:generic",
  });
  const marchRow = await one(
    "recurring_occurrences",
    "status, created_transaction_id",
    "id",
    march.id,
  );
  check(
    "K9 · cualquier ledger seguro enlazado converge en la misma observación",
    marchRow?.status === "confirmed" &&
      marchRow?.created_transaction_id === txMarch &&
      (await count("fixed_expense_observations", "transaction_id", txMarch)) === 1,
    JSON.stringify(marchRow),
  );
  const april = await occurrence("2026-04-15", ids.fixed, 120);
  const aprilObserved = await recordVariableFixedObservation({
    userId,
    occurrenceId: april.id,
    amount: 150,
    currency: "USD",
    action: "observe",
    scope: "once",
    dedupeKey: "k:april:observe",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
  });
  const forecastThree = await one(
    "fixed_expense_forecasts",
    "planning_amount, sample_count, confidence, method",
    "fixed_expense_id",
    ids.fixed,
  );
  check(
    "K10 · PostgreSQL aprende el p75 prudente del régimen vigente",
    aprilObserved.ok &&
      forecastThree?.sample_count === 3 &&
      cents(forecastThree?.planning_amount) === 142.5 &&
      forecastThree?.method === "conservative_p75",
    // Enero pertenece al régimen anterior: sólo 120/135/150 participan.
    JSON.stringify({ aprilObserved, forecastThree }),
  );

  const beforeDuplicate = Number(
    (await one(
      "accounts",
      "current_balance_original",
      "id",
      ids.account,
    ))?.current_balance_original,
  );
  let duplicateRefused = false;
  const transactionsBeforeDuplicate = await count(
    "transactions",
    "user_id",
    userId,
  );
  try {
    await applyLedgerEntry(admin, {
      userId,
      type: "expense",
      effectType: "expense",
      category: "utilities",
      description: "Luz K marzo duplicada",
      originalAmount: 140,
      originalCurrency: "USD",
      baseAmount: 140,
      baseCurrency: "USD",
      exchangeRateToBase: 1,
      sourceAccountId: ids.account,
      recurringExpenseId: ids.fixed,
      occurredAtISO: "2026-03-16T12:00:00.000Z",
      inputChannel: "web",
      dedupeKey: "k:march:duplicate",
    });
  } catch (error) {
    duplicateRefused = error != null;
  }
  check(
    "K11 · un segundo pago del mismo ciclo se rehúsa y no mueve caja",
    duplicateRefused &&
      (await count("transactions", "user_id", userId)) ===
        transactionsBeforeDuplicate &&
      Number(
        (await one(
          "accounts",
          "current_balance_original",
          "id",
          ids.account,
        ))?.current_balance_original,
      ) === beforeDuplicate,
  );

  await applyLedgerReversal(admin, {
    userId,
    originalTransactionId: txMarch,
    occurredAtISO: "2026-03-17T12:00:00.000Z",
  });
  const marchReversed = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    march.id,
  );
  const marchCurrentObservation = await currentObservation(
    "amount, currency, transaction_id, supersedes_id, is_current",
    march.id,
  );
  const marchForecastAfterUndo = await one(
    "fixed_expense_forecasts",
    "sample_count, planning_amount",
    "fixed_expense_id",
    ids.fixed,
  );
  check(
    "K12 · una reversa genérica deshace caja pero conserva la factura observada, su evidencia y el aviso de pago",
    marchReversed?.status === "observed" &&
      marchCurrentObservation.ok &&
      cents(marchReversed?.resolved_amount) === 135 &&
      marchReversed?.created_transaction_id == null &&
      (await count("fixed_expense_observations", "transaction_id", txMarch)) === 1 &&
      cents(marchCurrentObservation.row?.amount) === 135 &&
      marchCurrentObservation.row?.currency === "USD" &&
      marchCurrentObservation.row?.transaction_id == null &&
      marchCurrentObservation.row?.supersedes_id != null &&
      marchCurrentObservation.row?.is_current === true &&
      Number(marchForecastAfterUndo?.sample_count) === 3 &&
      cents(marchForecastAfterUndo?.planning_amount) === 142.5 &&
      Number(
        (await one(
          "accounts",
          "current_balance_original",
          "id",
          ids.account,
        ))?.current_balance_original,
      ) === beforeDuplicate + 135,
    JSON.stringify({
      occurrence: marchReversed,
      observation: marchCurrentObservation,
      forecast: marchForecastAfterUndo,
    }),
  );
  const { data: arsAccount, error: arsAccountError } = await admin
    .from("accounts")
    .insert({
      user_id: userId,
      name: "Cuenta K ARS",
      type: "bank",
      currency: "ARS",
      current_balance_original: 100000,
      current_balance_base: 0,
    })
    .select("id")
    .single();
  if (arsAccountError) throw new Error(`ars account: ${arsAccountError.message}`);
  const { data: arsFixed, error: arsFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Gas K ARS",
      amount: 5000,
      currency: "ARS",
      category: "utilities",
      frequency: "monthly",
      expected_day: 20,
      payment_source_type: "account",
      payment_source_id: arsAccount.id,
      is_variable: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (arsFixedError) throw new Error(`ars fixed: ${arsFixedError.message}`);
  const arsOcc = await occurrence("2026-04-20", arsFixed.id, 5000, "ARS");
  const arsObserved = await recordVariableFixedObservation({
    userId,
    occurrenceId: arsOcc.id,
    amount: 6200,
    currency: "ARS",
    action: "observe",
    scope: "once",
    dedupeKey: "k:ars:observe",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
  });
  const arsNoFx = planRecurringLedgerEntry({
    userId,
    kind: "expense",
    nativeAmount: 6200,
    nativeCurrency: "ARS",
    base: "USD",
    rates: [],
    accountId: arsAccount.id,
    accountCurrency: "ARS",
    isCard: false,
    recurringExpenseId: arsFixed.id,
    dedupeKey: "k:ars:pay",
    occurredAtISO: "2026-04-20T12:00:00.000Z",
    occurrenceDateISO: "2026-04-20",
    description: "Gas K ARS",
    sourceLinkId: arsFixed.id,
  });
  check(
    "K14 · moneda nativa sin FX: observar funciona y pagar no fabrica 1:1",
    arsObserved.ok &&
      !arsNoFx.ok &&
      arsNoFx.reason === "fx_unavailable" &&
      Number(
        (await one(
          "accounts",
          "current_balance_original",
          "id",
          arsAccount.id,
        ))?.current_balance_original,
      ) === 100000,
    JSON.stringify({ arsObserved, arsNoFx }),
  );

  const createPay = await applyFixedExpenseWithPayment({
    userId,
    mode: "create",
    dedupeKey: "k:create-pay",
    fixed: {
      name: "Agua K",
      amount: 40,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      start_date: "2026-05-01",
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_essential: true,
      is_variable: true,
    },
    entry: {
      userId,
      type: "expense",
      effectType: "expense",
      category: "utilities",
      description: "Agua K",
      originalAmount: 40,
      originalCurrency: "USD",
      baseAmount: 40,
      baseCurrency: "USD",
      exchangeRateToBase: 1,
      sourceAccountId: ids.account,
      occurredAtISO: "2026-05-10T12:00:00.000Z",
      inputChannel: "web",
      dedupeKey: "k:create-pay-ledger",
    },
  });
  check(
    "K15 · crear variable+pagar: definición, ledger, ocurrencia y observación aterrizan juntos",
    createPay.ok &&
      (await count(
        "fixed_expense_observations",
        "fixed_expense_id",
        createPay.fixedExpenseId,
      )) === 1 &&
      (await count(
        "recurring_occurrences",
        "fixed_expense_id",
        createPay.fixedExpenseId,
      )) === 1,
    JSON.stringify(createPay),
  );

  const june = await occurrence("2026-06-15", ids.fixed, 120);
  const mainBeforeJune = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const alternateBeforeJune = Number(
    (
      await one(
        "accounts",
        "current_balance_original",
        "id",
        ids.alternateAccount,
      )
    )?.current_balance_original,
  );
  const paidJune = await resolveOccurrence({
    userId,
    occurrenceId: june.id,
    action: "confirm",
    amount: 60,
    scope: "once",
    paymentDateISO: "2026-06-14",
    paymentSource: {
      id: ids.alternateAccount,
      currency: "USD",
      isCard: false,
    },
  });
  const junePaid = await one(
    "recurring_occurrences",
    "status, created_transaction_id",
    "id",
    june.id,
  );
  const correctedJune = await resolveOccurrence({
    userId,
    occurrenceId: june.id,
    action: "correct",
    amount: 60,
    scope: "once",
    paymentDateISO: "2026-06-15",
    paymentSource: {
      id: ids.account,
      currency: "USD",
      isCard: false,
    },
  });
  const juneCorrected = await one(
    "recurring_occurrences",
    "status, created_transaction_id",
    "id",
    june.id,
  );
  const correctedJuneTx = juneCorrected?.created_transaction_id
    ? await one(
        "transactions",
        "category, source_account_id, occurred_at",
        "id",
        juneCorrected.created_transaction_id,
      )
    : null;
  check(
    "K18 · misma factura/monto con fuente o fecha corregida no es no-op: revierte la pata anterior, usa la real y conserva categoría",
    paidJune.ok &&
      correctedJune.ok &&
      junePaid?.created_transaction_id &&
      juneCorrected?.status === "corrected" &&
      juneCorrected?.created_transaction_id !==
        junePaid.created_transaction_id &&
      Number(
        (
          await one(
            "accounts",
            "current_balance_original",
            "id",
            ids.alternateAccount,
          )
        )?.current_balance_original,
      ) === alternateBeforeJune &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === mainBeforeJune - 60 &&
      correctedJuneTx?.source_account_id === ids.account &&
      correctedJuneTx?.category === "utilities" &&
      String(correctedJuneTx?.occurred_at).startsWith("2026-06-15") &&
      (await count(
        "transactions",
        "related_transaction_id",
        junePaid.created_transaction_id,
      )) === 1,
    JSON.stringify({
      paidJune,
      correctedJune,
      junePaid,
      juneCorrected,
      correctedJuneTx,
    }),
  );
  const { error: movePlanSourceError } = await admin
    .from("fixed_expenses")
    .update({ payment_source_id: ids.alternateAccount })
    .eq("id", ids.fixed)
    .eq("user_id", userId);
  if (movePlanSourceError) {
    throw new Error(`move plan source: ${movePlanSourceError.message}`);
  }
  const mainBeforeHistoricalCorrection = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const alternateBeforeHistoricalCorrection = Number(
    (
      await one(
        "accounts",
        "current_balance_original",
        "id",
        ids.alternateAccount,
      )
    )?.current_balance_original,
  );
  const historicalCorrection = await resolveOccurrence({
    userId,
    occurrenceId: june.id,
    action: "correct",
    amount: 61,
    scope: "once",
  });
  const juneHistoricalRow = await one(
    "recurring_occurrences",
    "status, created_transaction_id",
    "id",
    june.id,
  );
  const juneHistoricalTx = juneHistoricalRow?.created_transaction_id
    ? await one(
        "transactions",
        "source_account_id, occurred_at",
        "id",
        juneHistoricalRow.created_transaction_id,
      )
    : null;
  check(
    "K26 · corregir un ciclo pagado conserva su cuenta y fecha históricas aunque el plan hoy apunte a otra fuente",
    historicalCorrection.ok &&
      juneHistoricalRow?.status === "corrected" &&
      juneHistoricalTx?.source_account_id === ids.account &&
      String(juneHistoricalTx?.occurred_at).startsWith("2026-06-15") &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) ===
        mainBeforeHistoricalCorrection - 1 &&
      Number(
        (
          await one(
            "accounts",
            "current_balance_original",
            "id",
            ids.alternateAccount,
          )
        )?.current_balance_original,
      ) === alternateBeforeHistoricalCorrection,
    JSON.stringify({
      historicalCorrection,
      juneHistoricalRow,
      juneHistoricalTx,
    }),
  );

  const july = await occurrence("2026-07-15", ids.fixed, 120);
  const julyObserved = await recordVariableFixedObservation({
    userId,
    occurrenceId: july.id,
    amount: 70,
    currency: "USD",
    action: "observe",
    scope: "once",
    dedupeKey: "k:july:observe",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
  });
  const julyRetracted = await resolveOccurrence({
    userId,
    occurrenceId: july.id,
    action: "retract",
  });
  const julyRow = await one(
    "recurring_occurrences",
    "status, resolved_amount, resolved_currency, created_transaction_id",
    "id",
    july.id,
  );
  const { count: julyCurrentCount, error: julyCurrentError } = await admin
    .from("fixed_expense_observations")
    .select("*", { head: true, count: "exact" })
    .eq("occurrence_id", july.id)
    .eq("is_current", true);
  if (julyCurrentError || julyCurrentCount == null) {
    throw new Error(
      `july observation count: ${julyCurrentError?.message ?? "null count"}`,
    );
  }
  check(
    "K19 · retirar una factura observada no la disfraza de dismiss: invalida el hecho actual, limpia el ciclo y recalcula sin mover dinero",
    julyObserved.ok &&
      julyRetracted.ok &&
      julyRow?.status === "skipped" &&
      julyRow?.resolved_amount == null &&
      julyRow?.resolved_currency == null &&
      julyRow?.created_transaction_id == null &&
      julyCurrentCount === 0,
    JSON.stringify({ julyObserved, julyRetracted, julyRow, julyCurrentCount }),
  );
  const julyRetractReplay = await resolveOccurrence({
    userId,
    occurrenceId: july.id,
    action: "retract",
  });
  check(
    "K29 · una respuesta perdida al retirar la factura reintenta como no-op exitoso",
    julyRetractReplay.ok &&
      /ya estaba retirada/i.test(julyRetractReplay.detail) &&
      (await count(
        "fixed_expense_observations",
        "occurrence_id",
        july.id,
      )) === 1,
    JSON.stringify(julyRetractReplay),
  );

  const julyBalanceBeforeReopen = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const julyReopened = await resolveOccurrence({
    userId,
    occurrenceId: july.id,
    action: "correct",
    amount: 72,
    scope: "once",
    paymentSource: {
      id: ids.account,
      currency: "USD",
      isCard: false,
    },
    paymentDateISO: "2026-07-16",
  });
  const staleJulyRetract = await recordVariableFixedObservation({
    userId,
    occurrenceId: july.id,
    amount: 70,
    currency: "USD",
    action: "retract",
    scope: "once",
    dedupeKey: `variable-fixed:semantic:${july.id}:retract:7000`,
    expectedOccurrenceStatus: "skipped",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
    entry: null,
  });
  const julyReopenedRow = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    july.id,
  );
  check(
    "K43 · pagar después de retract invalida la identidad vieja: su redelivery no vuelve a narrar la factura como retirada",
    julyReopened.ok &&
      !staleJulyRetract.ok &&
      staleJulyRetract.reason === "unsafe" &&
      julyReopenedRow?.status === "corrected" &&
      cents(julyReopenedRow?.resolved_amount) === 72 &&
      julyReopenedRow?.created_transaction_id != null &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === julyBalanceBeforeReopen - 72 &&
      (await count(
        "fixed_expense_observations",
        "occurrence_id",
        july.id,
      )) === 2,
    JSON.stringify({
      julyReopened,
      staleJulyRetract,
      julyReopenedRow,
    }),
  );

  const dismissedCycle = await occurrence("2027-03-15", ids.fixed, 120);
  const dismissedObserved = await recordVariableFixedObservation({
    userId,
    occurrenceId: dismissedCycle.id,
    amount: 92,
    currency: "USD",
    action: "observe",
    scope: "once",
    dedupeKey: "k:dismissed:observe",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
  });
  const dismissedReminder = await resolveOccurrence({
    userId,
    occurrenceId: dismissedCycle.id,
    action: "dismiss",
  });
  const balanceBeforeDismissedPayment = Number(
    (
      await one(
        "accounts",
        "current_balance_original",
        "id",
        ids.account,
      )
    )?.current_balance_original,
  );
  const paidAfterDismiss = await resolveOccurrence({
    userId,
    occurrenceId: dismissedCycle.id,
    action: "confirm",
    defaultPaymentDateISO: "2027-03-20",
    paymentSource: {
      id: ids.account,
      currency: "USD",
      isCard: false,
    },
  });
  const dismissedPaidRow = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    dismissedCycle.id,
  );
  const dismissedPaymentTx = dismissedPaidRow?.created_transaction_id
    ? await one(
        "transactions",
        "occurred_at",
        "id",
        dismissedPaidRow.created_transaction_id,
      )
    : null;
  check(
    "K33 · dismiss solo detiene el aviso: si después confirma el pago, el mismo ciclo y observación se completan sin lock-out",
    dismissedObserved.ok &&
      dismissedReminder.ok &&
      paidAfterDismiss.ok &&
      dismissedPaidRow?.status === "confirmed" &&
      cents(dismissedPaidRow?.resolved_amount) === 92 &&
      dismissedPaidRow?.created_transaction_id != null &&
      Number(
        (
          await one(
            "accounts",
            "current_balance_original",
            "id",
            ids.account,
          )
        )?.current_balance_original,
      ) ===
        balanceBeforeDismissedPayment - 92 &&
      (await count(
        "fixed_expense_observations",
        "occurrence_id",
        dismissedCycle.id,
      )) === 2,
    JSON.stringify({
      dismissedObserved,
      dismissedReminder,
      paidAfterDismiss,
      dismissedPaidRow,
    }),
  );
  check(
    "K48 · un pago nuevo sin fecha explícita usa el día local de captura, no la fecha antigua del aviso",
    String(dismissedPaymentTx?.occurred_at ?? "").slice(0, 10) ===
      "2027-03-20",
    JSON.stringify(dismissedPaymentTx),
  );

  const skippedCycle = await occurrence("2027-04-15", ids.fixed, 120);
  const skippedFirst = await resolveOccurrence({
    userId,
    occurrenceId: skippedCycle.id,
    action: "skip",
  });
  const balanceBeforeSkippedCorrection = Number(
    (
      await one(
        "accounts",
        "current_balance_original",
        "id",
        ids.account,
      )
    )?.current_balance_original,
  );
  const correctedAfterSkip = await resolveOccurrence({
    userId,
    occurrenceId: skippedCycle.id,
    action: "correct",
    amount: 93,
    scope: "once",
    paymentSource: {
      id: ids.account,
      currency: "USD",
      isCard: false,
    },
  });
  const skippedCorrectedRow = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    skippedCycle.id,
  );
  check(
    "K34 · una corrección explícita puede deshacer el hecho 'no ocurrió': paga una vez y deja el ciclo como corrected",
    skippedFirst.ok &&
      correctedAfterSkip.ok &&
      skippedCorrectedRow?.status === "corrected" &&
      cents(skippedCorrectedRow?.resolved_amount) === 93 &&
      skippedCorrectedRow?.created_transaction_id != null &&
      Number(
        (
          await one(
            "accounts",
            "current_balance_original",
            "id",
            ids.account,
          )
        )?.current_balance_original,
      ) ===
        balanceBeforeSkippedCorrection - 93 &&
      (await count(
        "fixed_expense_observations",
        "occurrence_id",
        skippedCycle.id,
      )) === 1,
    JSON.stringify({
      skippedFirst,
      correctedAfterSkip,
      skippedCorrectedRow,
    }),
  );

  const balanceBeforeUnbound = Number(
    (
      await one(
        "accounts",
        "current_balance_original",
        "id",
        ids.account,
      )
    )?.current_balance_original,
  );
  const transactionsBeforeUnbound = await count(
    "transactions",
    "user_id",
    userId,
  );
  let unboundCycleRefused = false;
  try {
    await applyLedgerEntry(admin, {
      userId,
      type: "expense",
      effectType: "expense",
      category: "utilities",
      description: "Luz sin ciclo probado",
      originalAmount: 77,
      originalCurrency: "USD",
      baseAmount: 77,
      baseCurrency: "USD",
      exchangeRateToBase: 1,
      sourceAccountId: ids.account,
      recurringExpenseId: ids.fixed,
      occurredAtISO: "2028-03-15T12:00:00.000Z",
      inputChannel: "web",
      dedupeKey: "k:unbound-cycle",
    });
  } catch (error) {
    unboundCycleRefused = error != null;
  }
  check(
    "K30 · un movimiento genérico sin ocurrencia abierta no inventa un ciclo a partir de la fecha de pago",
    unboundCycleRefused &&
      Number(
        (
          await one(
            "accounts",
            "current_balance_original",
            "id",
            ids.account,
          )
        )?.current_balance_original,
      ) === balanceBeforeUnbound &&
      (await count("transactions", "user_id", userId)) ===
        transactionsBeforeUnbound,
    JSON.stringify({
      unboundCycleRefused,
      balanceBeforeUnbound,
      transactionsBeforeUnbound,
    }),
  );

  const { data: forgedFixed, error: forgedFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Agua K sin ciclo",
      amount: 30,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 18,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_variable: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (forgedFixedError) {
    throw new Error(`forged fixed: ${forgedFixedError.message}`);
  }
  const forgedBalanceBefore = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const forgedTxBefore = await count("transactions", "user_id", userId);
  let forgedMarkerRefused = false;
  try {
    await applyLedgerEntry(admin, {
      userId,
      type: "expense",
      effectType: "expense",
      category: "utilities",
      description: "Agua K con marca falsificada",
      originalAmount: 30,
      originalCurrency: "USD",
      baseAmount: 30,
      baseCurrency: "USD",
      exchangeRateToBase: 1,
      sourceAccountId: ids.account,
      recurringExpenseId: forgedFixed.id,
      occurredAtISO: "2028-04-18T12:00:00.000Z",
      inputChannel: "web",
      dedupeKey: "k:forged-create-payment",
      externalRef: "variable-fixed-create-payment:forged-create-payment",
    });
  } catch (error) {
    forgedMarkerRefused = error != null;
  }
  check(
    "K37 · copiar la marca durable de crear+pagar no falsifica el permiso privado ni fabrica un ciclo",
    forgedMarkerRefused &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === forgedBalanceBefore &&
      (await count("transactions", "user_id", userId)) === forgedTxBefore &&
      (await count(
        "fixed_expense_observations",
        "fixed_expense_id",
        forgedFixed.id,
      )) === 0,
    JSON.stringify({ forgedMarkerRefused, forgedBalanceBefore, forgedTxBefore }),
  );

  const { data: explicitSourceFixed, error: explicitSourceFixedError } =
    await admin
      .from("fixed_expenses")
      .insert({
        user_id: userId,
        name: "Cable K fuente explícita",
        amount: 40,
        currency: "USD",
        category: "utilities",
        frequency: "monthly",
        expected_day: 19,
        payment_source_type: "account",
        payment_source_id: ids.account,
        is_variable: true,
        is_active: true,
      })
      .select("id")
      .single();
  if (explicitSourceFixedError) {
    throw new Error(
      `explicit source fixed: ${explicitSourceFixedError.message}`,
    );
  }
  const explicitSourceOccurrence = await occurrence(
    "2027-05-19",
    explicitSourceFixed.id,
    40,
  );
  const explicitSourceBalanceBefore = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const explicitSourceTxBefore = await count(
    "transactions",
    "user_id",
    userId,
  );
  const missingExplicitSource = await resolveOccurrence({
    userId,
    occurrenceId: explicitSourceOccurrence.id,
    action: "confirm",
    amount: 40,
    paymentDateISO: "2027-05-19",
  });
  const explicitSourceOccurrenceAfter = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    explicitSourceOccurrence.id,
  );
  check(
    "K38 · el primer pago no usa la cuenta habitual como prueba de lo ocurrido: pregunta la fuente y mueve cero",
    !missingExplicitSource.ok &&
      /desde qué cuenta o tarjeta/i.test(missingExplicitSource.detail) &&
      explicitSourceOccurrenceAfter?.status === "pending" &&
      explicitSourceOccurrenceAfter?.resolved_amount == null &&
      explicitSourceOccurrenceAfter?.created_transaction_id == null &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === explicitSourceBalanceBefore &&
      (await count("transactions", "user_id", userId)) ===
        explicitSourceTxBefore,
    JSON.stringify({
      missingExplicitSource,
      explicitSourceOccurrenceAfter,
      explicitSourceBalanceBefore,
      explicitSourceTxBefore,
    }),
  );

  const { data: resetAskFixed, error: resetAskFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Agua K respuesta tardía",
      amount: 35,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 20,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_variable: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (resetAskFixedError) {
    throw new Error(`reset ask fixed: ${resetAskFixedError.message}`);
  }
  const exhaustedOccurrence = await occurrence(
    "2027-06-20",
    resetAskFixed.id,
    35,
  );
  const { error: exhaustAskError } = await admin
    .from("recurring_occurrences")
    .update({
      ask_count: 3,
      last_asked_on: "2027-06-19",
      snooze_until: "2027-06-30T12:00:00.000Z",
      notified: true,
    })
    .eq("id", exhaustedOccurrence.id)
    .eq("user_id", userId);
  if (exhaustAskError) {
    throw new Error(`exhaust ask: ${exhaustAskError.message}`);
  }
  const lateObserved = await recordVariableFixedObservation({
    userId,
    occurrenceId: exhaustedOccurrence.id,
    amount: 37,
    currency: "USD",
    action: "observe",
    scope: "once",
    dedupeKey: "k:late-answer:observe",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
  });
  const exhaustedOccurrenceAfter = await one(
    "recurring_occurrences",
    "status, ask_count, last_asked_on, snooze_until, notified, resolved_amount",
    "id",
    exhaustedOccurrence.id,
  );
  check(
    "K41 · responder el monto después del tercer ask reinicia la nueva pregunta de pago",
    lateObserved.ok &&
      exhaustedOccurrenceAfter?.status === "observed" &&
      exhaustedOccurrenceAfter?.ask_count === 0 &&
      exhaustedOccurrenceAfter?.last_asked_on == null &&
      exhaustedOccurrenceAfter?.snooze_until == null &&
      exhaustedOccurrenceAfter?.notified === false &&
      cents(exhaustedOccurrenceAfter?.resolved_amount) === 37,
    JSON.stringify({ lateObserved, exhaustedOccurrenceAfter }),
  );
  const explicitlyUnpaid = await resolveOccurrence({
    userId,
    occurrenceId: exhaustedOccurrence.id,
    action: "unpaid",
    snoozeUntilISO: "2027-06-25T12:00:00.000Z",
  });
  const unsafeSkipObserved = await resolveOccurrence({
    userId,
    occurrenceId: exhaustedOccurrence.id,
    action: "skip",
  });
  const unpaidOccurrenceAfter = await one(
    "recurring_occurrences",
    "status, resolved_amount, resolved_currency, snooze_until, created_transaction_id",
    "id",
    exhaustedOccurrence.id,
  );
  check(
    "K42 · 'todavía no la pagué' conserva la factura; skip no puede borrar un hecho observado",
    explicitlyUnpaid.ok &&
      !unsafeSkipObserved.ok &&
      /no borré el hecho/i.test(unsafeSkipObserved.detail) &&
      unpaidOccurrenceAfter?.status === "observed" &&
      cents(unpaidOccurrenceAfter?.resolved_amount) === 37 &&
      unpaidOccurrenceAfter?.resolved_currency === "USD" &&
      String(unpaidOccurrenceAfter?.snooze_until).startsWith("2027-06-25") &&
      unpaidOccurrenceAfter?.created_transaction_id == null &&
      (await count(
        "fixed_expense_observations",
        "occurrence_id",
        exhaustedOccurrence.id,
      )) === 1,
    JSON.stringify({
      explicitlyUnpaid,
      unsafeSkipObserved,
      unpaidOccurrenceAfter,
    }),
  );

  const { data: highBillFixed, error: highBillFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Gas K recibo alto real",
      amount: 100,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 21,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_variable: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (highBillFixedError) {
    throw new Error(`high bill fixed: ${highBillFixedError.message}`);
  }
  const highAmounts = [100, 110, 120, 1000];
  for (const [index, amount] of highAmounts.entries()) {
    const month = String(index + 1).padStart(2, "0");
    const cycle = await occurrence(
      `2027-${month}-21`,
      highBillFixed.id,
      100,
    );
    const result = await recordVariableFixedObservation({
      userId,
      occurrenceId: cycle.id,
      amount,
      currency: "USD",
      action: "observe",
      scope: "once",
      dedupeKey: `k:high:${month}:observe`,
      expectedOccurrenceStatus: "pending",
      expectedResolvedAmount: null,
      expectedTransactionId: null,
    });
    if (!result.ok) {
      throw new Error(`high observation ${month}: ${result.reason}`);
    }
  }
  const highBillForecast = await one(
    "fixed_expense_forecasts",
    "planning_amount, sample_count, method, currency",
    "fixed_expense_id",
    highBillFixed.id,
  );
  check(
    "K39 · PostgreSQL conserva un recibo alto sin dejarlo dominar: 100/110/120/1000 eleva la reserva a 140,31 mediante winsorización robusta",
    cents(highBillForecast?.planning_amount) === 140.31 &&
      highBillForecast?.sample_count === 4 &&
      highBillForecast?.method === "conservative_p75" &&
      highBillForecast?.currency === "USD" &&
      (await count(
        "fixed_expense_observations",
        "fixed_expense_id",
        highBillFixed.id,
      )) === 4,
    JSON.stringify(highBillForecast),
  );

  const cheapLatestCycle = await occurrence(
    "2027-05-21",
    highBillFixed.id,
    100,
  );
  const cheapLatestObserved = await recordVariableFixedObservation({
    userId,
    occurrenceId: cheapLatestCycle.id,
    amount: 0,
    currency: "USD",
    action: "observe",
    scope: "once",
    dedupeKey: "k:high:05:observe",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
  });
  const cheapLatestForecast = await one(
    "fixed_expense_forecasts",
    "planning_amount, sample_count, method, last_cycle_date",
    "fixed_expense_id",
    highBillFixed.id,
  );
  check(
    "K71 · una factura barata excluida del p75 sigue siendo el último ciclo observado: la proyección filtra montos, no reescribe la cronología",
    cheapLatestObserved.ok &&
      cents(cheapLatestForecast?.planning_amount) === 138.13 &&
      cheapLatestForecast?.sample_count === 4 &&
      cheapLatestForecast?.method === "conservative_p75" &&
      String(cheapLatestForecast?.last_cycle_date).slice(0, 10) ===
        "2027-05-01",
    JSON.stringify({
      observed: cheapLatestObserved,
      forecast: cheapLatestForecast,
    }),
  );

  const { data: zeroHeavyFixed, error: zeroHeavyFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Gas K historial con ceros",
      amount: 100,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 22,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_variable: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (zeroHeavyFixedError) {
    throw new Error(`zero-heavy fixed: ${zeroHeavyFixedError.message}`);
  }
  for (const [index, amount] of [0, 0, 1000].entries()) {
    const month = String(index + 1).padStart(2, "0");
    const cycle = await occurrence(
      `2028-${month}-22`,
      zeroHeavyFixed.id,
      100,
    );
    const result = await recordVariableFixedObservation({
      userId,
      occurrenceId: cycle.id,
      amount,
      currency: "USD",
      action: "observe",
      scope: "once",
      dedupeKey: `k:zero-heavy:${month}:observe`,
      expectedOccurrenceStatus: "pending",
      expectedResolvedAmount: null,
      expectedTransactionId: null,
    });
    if (!result.ok) {
      throw new Error(`zero-heavy observation ${month}: ${result.reason}`);
    }
  }
  const zeroHeavyForecast = await one(
    "fixed_expense_forecasts",
    "planning_amount, sample_count, method, currency",
    "fixed_expense_id",
    zeroHeavyFixed.id,
  );
  check(
    "K64 · PostgreSQL no pulveriza la única factura alta cuando mediana/MAD son cero: 0/0/1000 reserva 200, acotado por la escala declarada",
    cents(zeroHeavyForecast?.planning_amount) === 200 &&
      zeroHeavyForecast?.sample_count === 3 &&
      zeroHeavyForecast?.method === "conservative_p75" &&
      zeroHeavyForecast?.currency === "USD",
    JSON.stringify(zeroHeavyForecast),
  );

  const august = await occurrence("2026-08-15", ids.fixed, 120);
  const augustObserved = await recordVariableFixedObservation({
    userId,
    occurrenceId: august.id,
    amount: 65,
    currency: "USD",
    action: "observe",
    scope: "once",
    dedupeKey: "k:august:observe",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
  });
  const augustTx = await applyLedgerEntry(admin, {
    userId,
    type: "expense",
    effectType: "expense",
    category: "utilities",
    description: "Luz K agosto",
    originalAmount: 65,
    originalCurrency: "USD",
    baseAmount: 65,
    baseCurrency: "USD",
    exchangeRateToBase: 1,
    sourceAccountId: ids.account,
    recurringExpenseId: ids.fixed,
    occurredAtISO: "2026-08-15T12:00:00.000Z",
    inputChannel: "web",
    dedupeKey: "k:august:generic",
  });
  const augustRow = await one(
    "recurring_occurrences",
    "status, created_transaction_id",
    "id",
    august.id,
  );
  check(
    "K20 · pagar por ledger una factura ya observada con el mismo monto la confirma; no la etiqueta como corrección",
    augustObserved.ok &&
      augustRow?.status === "confirmed" &&
      augustRow?.created_transaction_id === augustTx,
    JSON.stringify({ augustObserved, augustRow }),
  );

  const september = await occurrence("2026-09-15", ids.fixed, 120);
  const septemberLateTx = await applyLedgerEntry(admin, {
    userId,
    type: "expense",
    effectType: "expense",
    category: "utilities",
    description: "Luz K septiembre pagada tarde",
    originalAmount: 130,
    originalCurrency: "USD",
    baseAmount: 130,
    baseCurrency: "USD",
    exchangeRateToBase: 1,
    sourceAccountId: ids.account,
    recurringExpenseId: ids.fixed,
    occurredAtISO: "2026-10-02T12:00:00.000Z",
    inputChannel: "web",
    dedupeKey: "k:september:late-generic",
  });
  const septemberRow = await one(
    "recurring_occurrences",
    "status, created_transaction_id",
    "id",
    september.id,
  );
  const { count: octoberOccurrenceCount, error: octoberOccurrenceError } =
    await admin
      .from("recurring_occurrences")
      .select("*", { head: true, count: "exact" })
      .eq("user_id", userId)
      .eq("fixed_expense_id", ids.fixed)
      .gte("occurrence_date", "2026-10-01")
      .lte("occurrence_date", "2026-10-31");
  if (octoberOccurrenceError || octoberOccurrenceCount == null) {
    throw new Error(
      `october occurrence count: ${octoberOccurrenceError?.message ?? "null count"}`,
    );
  }
  check(
    "K21 · un pago tardío enlazado cierra el único ciclo abierto anterior; no fabrica el mes de la fecha de pago",
    septemberRow?.status === "confirmed" &&
      septemberRow?.created_transaction_id === septemberLateTx &&
      octoberOccurrenceCount === 0,
    JSON.stringify({ septemberRow, octoberOccurrenceCount }),
  );

  // Reproduce a genuine pre-K dirty row. While the plan is ordinary its booked
  // occurrence may carry a legacy transaction; only afterwards do we turn the
  // plan variable. Constructing the bad link directly on an already-variable
  // plan is no longer possible (and is itself an invariant, not a fixture).
  const k22Name =
    "K22 · una ocurrencia pre-K con transaction_id ajeno se rehúsa; no cobra una segunda vez para tapar la corrupción";
  let k22Checked = false;
  try {
  const { data: legacyCorruptFixed, error: legacyCorruptFixedError } =
    await admin
      .from("fixed_expenses")
      .insert({
        user_id: userId,
        name: "Fijo legado con pago ajeno K",
        amount: 120,
        currency: "USD",
        category: "utilities",
        frequency: "monthly",
        expected_day: 15,
        payment_source_type: "account",
        payment_source_id: ids.account,
        is_variable: false,
        is_active: true,
      })
      .select("id")
      .single();
  if (legacyCorruptFixedError) {
    throw new Error(
      `legacy corrupt fixed: ${legacyCorruptFixedError.message}`,
    );
  }
  const november = await occurrence(
    "2026-11-15",
    legacyCorruptFixed.id,
    120,
  );
  const unrelatedTx = await applyLedgerEntry(admin, {
    userId,
    type: "expense",
    effectType: "expense",
    category: "other",
    description: "Movimiento ajeno al fijo",
    originalAmount: 10,
    originalCurrency: "USD",
    baseAmount: 10,
    baseCurrency: "USD",
    exchangeRateToBase: 1,
    sourceAccountId: ids.account,
    occurredAtISO: "2026-11-14T12:00:00.000Z",
    inputChannel: "web",
    dedupeKey: "k:november:unrelated",
  });
  const { error: corruptOccurrenceError } = await admin
    .from("recurring_occurrences")
    .update({ status: "booked", created_transaction_id: unrelatedTx })
    .eq("id", november.id)
    .eq("user_id", userId);
  if (corruptOccurrenceError) {
    throw new Error(
      `corrupt occurrence fixture: ${corruptOccurrenceError.message}`,
    );
  }
  const { error: activateLegacyCorruptError } = await admin
    .from("fixed_expenses")
    .update({ is_variable: true })
    .eq("id", legacyCorruptFixed.id)
    .eq("user_id", userId);
  if (activateLegacyCorruptError) {
    throw new Error(
      `activate legacy corrupt fixed: ${activateLegacyCorruptError.message}`,
    );
  }
  const novemberBalance = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const novemberPlan = planRecurringLedgerEntry({
    userId,
    kind: "expense",
    nativeAmount: 75,
    nativeCurrency: "USD",
    base: "USD",
    rates: [],
    accountId: ids.account,
    accountCurrency: "USD",
    isCard: false,
    recurringExpenseId: legacyCorruptFixed.id,
    dedupeKey: "k:november:new-payment",
    occurredAtISO: "2026-11-15T12:00:00.000Z",
    occurrenceDateISO: "2026-11-15",
    description: "Luz K noviembre",
    sourceLinkId: legacyCorruptFixed.id,
    category: "utilities",
  });
  if (!novemberPlan.ok) {
    throw new Error(`november plan: ${novemberPlan.reason}`);
  }
  const corruptAdoption = await recordVariableFixedObservation({
    userId,
    occurrenceId: november.id,
    amount: 75,
    currency: "USD",
    action: "pay",
    scope: "once",
    dedupeKey: "k:november:reject-corrupt-adoption",
    expectedOccurrenceStatus: "booked",
    expectedResolvedAmount: null,
    expectedTransactionId: unrelatedTx,
    entry: novemberPlan.entry,
  });
  check(
    k22Name,
    !corruptAdoption.ok &&
      corruptAdoption.reason === "unsafe" &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === novemberBalance &&
      (await count(
        "fixed_expense_observations",
        "occurrence_id",
        november.id,
      )) === 0,
    JSON.stringify(corruptAdoption),
  );
  k22Checked = true;
  } catch (error) {
    if (!k22Checked) {
      check(
        k22Name,
        false,
        `fixture pre-K: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const { data: legacyBookedFixed, error: legacyBookedFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Fijo legado que luego varía K",
      amount: 44,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 18,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_essential: true,
      is_active: true,
      is_variable: false,
    })
    .select("id")
    .single();
  if (legacyBookedFixedError || !legacyBookedFixed) {
    throw new Error(
      `legacy booked fixed: ${legacyBookedFixedError?.message ?? "sin fila"}`,
    );
  }
  const legacyBookedOccurrence = await occurrence(
    "2026-12-18",
    legacyBookedFixed.id,
    44,
  );
  const legacyBookedTx = await applyLedgerEntry(admin, {
    userId,
    type: "expense",
    effectType: "expense",
    category: "utilities",
    description: "Fijo legado antes de volverse variable K",
    originalAmount: 44,
    originalCurrency: "USD",
    baseAmount: 44,
    baseCurrency: "USD",
    exchangeRateToBase: 1,
    sourceAccountId: ids.account,
    recurringExpenseId: legacyBookedFixed.id,
    occurredAtISO: "2026-12-18T12:00:00.000Z",
    inputChannel: "web",
    dedupeKey: "k:legacy-booked:original",
  });
  const { error: markLegacyBookedError } = await admin
    .from("recurring_occurrences")
    .update({
      status: "booked",
      created_transaction_id: legacyBookedTx,
    })
    .eq("id", legacyBookedOccurrence.id)
    .eq("user_id", userId);
  if (markLegacyBookedError) {
    throw new Error(`mark legacy booked: ${markLegacyBookedError.message}`);
  }
  const { error: toggleLegacyVariableError } = await admin
    .from("fixed_expenses")
    .update({ is_variable: true })
    .eq("id", legacyBookedFixed.id)
    .eq("user_id", userId);
  if (toggleLegacyVariableError) {
    throw new Error(
      `toggle legacy booked variable: ${toggleLegacyVariableError.message}`,
    );
  }
  const balanceBeforeLegacyDuplicate = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  let legacySecondPaymentRefused = false;
  try {
    await applyLedgerEntry(admin, {
      userId,
      type: "expense",
      effectType: "expense",
      category: "utilities",
      description: "Segundo cobro que no debe entrar K",
      originalAmount: 44,
      originalCurrency: "USD",
      baseAmount: 44,
      baseCurrency: "USD",
      exchangeRateToBase: 1,
      sourceAccountId: ids.account,
      recurringExpenseId: legacyBookedFixed.id,
      occurredAtISO: "2026-12-18T13:00:00.000Z",
      inputChannel: "web",
      dedupeKey: "k:legacy-booked:duplicate",
    });
  } catch (error) {
    legacySecondPaymentRefused = error != null;
  }
  check(
    "K50 · un segundo ledger genérico no reemplaza el pago ya ligado ni debita otra vez",
    legacySecondPaymentRefused &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === balanceBeforeLegacyDuplicate &&
      (await count(
        "fixed_expense_observations",
        "occurrence_id",
        legacyBookedOccurrence.id,
      )) === 0,
  );
  const adoptedLegacyBooked = await resolveOccurrence({
    userId,
    occurrenceId: legacyBookedOccurrence.id,
    action: "confirm",
    operationId: "k:legacy-booked:confirm",
  });
  const adoptedLegacyOccurrence = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    legacyBookedOccurrence.id,
  );
  const adoptedLegacyObservation = await currentObservation(
    "amount, currency, transaction_id, is_current",
    legacyBookedOccurrence.id,
  );
  check(
    "K49 · un booked previo se adopta como observación sin volver a cobrar",
    adoptedLegacyBooked.ok &&
      adoptedLegacyObservation.ok &&
      adoptedLegacyOccurrence?.status === "confirmed" &&
      cents(adoptedLegacyOccurrence?.resolved_amount) === 44 &&
      adoptedLegacyOccurrence?.created_transaction_id === legacyBookedTx &&
      cents(adoptedLegacyObservation.row?.amount) === 44 &&
      adoptedLegacyObservation.row?.currency === "USD" &&
      adoptedLegacyObservation.row?.transaction_id === legacyBookedTx &&
      adoptedLegacyObservation.row?.is_current === true &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === balanceBeforeLegacyDuplicate,
    JSON.stringify({
      adoptedLegacyBooked,
      adoptedLegacyOccurrence,
      observation: adoptedLegacyObservation,
    }),
  );

  const { data: transitionFixed, error: transitionFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Plan transición K",
      amount: 25,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 12,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_variable: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (transitionFixedError) {
    throw new Error(`transition fixed: ${transitionFixedError.message}`);
  }
  const transitionObservedOccurrence = await occurrence(
    "2026-12-12",
    transitionFixed.id,
    25,
  );
  const transitionObserved = await recordVariableFixedObservation({
    userId,
    occurrenceId: transitionObservedOccurrence.id,
    amount: 27,
    currency: "USD",
    action: "observe",
    scope: "once",
    dedupeKey: "k:transition:observe",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
  });
  const { error: toFixedError } = await admin
    .from("fixed_expenses")
    .update({ is_variable: false })
    .eq("id", transitionFixed.id)
    .eq("user_id", userId);
  if (toFixedError) throw new Error(`transition to fixed: ${toFixedError.message}`);
  const closedObserved = await one(
    "recurring_occurrences",
    "status, resolved_amount",
    "id",
    transitionObservedOccurrence.id,
  );
  const transitionAutoOccurrence = await createOccurrenceIfAbsent({
    userId,
    fixedExpenseId: transitionFixed.id,
    occurrenceDate: "2027-01-12",
    kind: "expense",
    mode: "auto",
    expectedAmount: 25,
    currency: "USD",
  });
  if (!transitionAutoOccurrence) {
    throw new Error("transition auto occurrence: no se creó");
  }
  const { error: toVariableError } = await admin
    .from("fixed_expenses")
    .update({ is_variable: true })
    .eq("id", transitionFixed.id)
    .eq("user_id", userId);
  if (toVariableError) {
    throw new Error(`transition to variable: ${toVariableError.message}`);
  }
  const askAfterToggle = await one(
    "recurring_occurrences",
    "status, mode",
    "id",
    transitionAutoOccurrence.occurrence.id,
  );
  check(
    "K23 · cambiar variable→fijo conserva la factura observada; volver fijo→variable convierte un retry AUTO pendiente en ASK",
    transitionObserved.ok &&
      closedObserved?.status === "observed" &&
      cents(closedObserved?.resolved_amount) === 27 &&
      askAfterToggle?.status === "pending" &&
      askAfterToggle?.mode === "ask",
    JSON.stringify({ transitionObserved, closedObserved, askAfterToggle }),
  );
  const { error: editPendingPlanError } = await admin
    .from("fixed_expenses")
    .update({ amount: 31, frequency: "biweekly" })
    .eq("id", transitionFixed.id)
    .eq("user_id", userId);
  if (editPendingPlanError) {
    throw new Error(`edit pending plan: ${editPendingPlanError.message}`);
  }
  const pendingAfterPlanEdit = await one(
    "recurring_occurrences",
    "status, mode, expected_amount, currency, fixed_expense_cadence, fixed_expense_regime",
    "id",
    transitionAutoOccurrence.occurrence.id,
  );
  const forecastAfterPlanEdit = await one(
    "fixed_expense_forecasts",
    "regime, declared_amount, planning_amount, currency, cadence, sample_count",
    "fixed_expense_id",
    transitionFixed.id,
  );
  check(
    "K47 · un cambio permanente migra monto/cadencia/régimen del ciclo todavía desconocido antes de que AUTO/ASK pueda mover dinero viejo",
    pendingAfterPlanEdit?.status === "pending" &&
      pendingAfterPlanEdit?.mode === "ask" &&
      cents(pendingAfterPlanEdit?.expected_amount) === 31 &&
      pendingAfterPlanEdit?.currency === "USD" &&
      pendingAfterPlanEdit?.fixed_expense_cadence === "biweekly" &&
      pendingAfterPlanEdit?.fixed_expense_regime ===
        forecastAfterPlanEdit?.regime &&
      cents(forecastAfterPlanEdit?.declared_amount) === 31 &&
      cents(forecastAfterPlanEdit?.planning_amount) === 31 &&
      forecastAfterPlanEdit?.cadence === "biweekly" &&
      forecastAfterPlanEdit?.sample_count === 0,
    JSON.stringify({ pendingAfterPlanEdit, forecastAfterPlanEdit }),
  );
  const paidBeforeFixedOccurrence = await occurrence(
    "2027-02-12",
    transitionFixed.id,
    25,
  );
  const paidBeforeFixedTx = await applyLedgerEntry(admin, {
    userId,
    type: "expense",
    effectType: "expense",
    category: "utilities",
    description: "Plan transición K pagado",
    originalAmount: 30,
    originalCurrency: "USD",
    baseAmount: 30,
    baseCurrency: "USD",
    exchangeRateToBase: 1,
    sourceAccountId: ids.account,
    recurringExpenseId: transitionFixed.id,
    occurredAtISO: "2027-02-12T12:00:00.000Z",
    inputChannel: "web",
    dedupeKey: "k:transition:paid-before-fixed",
  });
  const balanceBeforeFixedUndo = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const { error: fixedBeforeUndoError } = await admin
    .from("fixed_expenses")
    .update({ is_variable: false })
    .eq("id", transitionFixed.id)
    .eq("user_id", userId);
  if (fixedBeforeUndoError) {
    throw new Error(`transition fixed before undo: ${fixedBeforeUndoError.message}`);
  }
  await applyLedgerReversal(admin, {
    userId,
    originalTransactionId: paidBeforeFixedTx,
    occurredAtISO: "2027-02-13T12:00:00.000Z",
  });
  const paidAfterFixedUndo = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    paidBeforeFixedOccurrence.id,
  );
  check(
    "K27 · deshacer un pago después de volver fijo el plan conserva la factura histórica como observada y solo revierte caja",
    paidAfterFixedUndo?.status === "observed" &&
      cents(paidAfterFixedUndo?.resolved_amount) === 30 &&
      paidAfterFixedUndo?.created_transaction_id == null &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) ===
        balanceBeforeFixedUndo + 30 &&
      (await count(
        "fixed_expense_observations",
        "transaction_id",
        paidBeforeFixedTx,
      )) === 1,
    JSON.stringify(paidAfterFixedUndo),
  );

  const contractOccurrence = await occurrence("2027-02-15", ids.fixed, 120);
  const contractObserved = await recordVariableFixedObservation({
    userId,
    occurrenceId: contractOccurrence.id,
    amount: 88,
    currency: "USD",
    action: "observe",
    scope: "once",
    dedupeKey: "k:contract:observe",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
  });
  const planBeforeInvalidRetract = await one(
    "fixed_expenses",
    "amount",
    "id",
    ids.fixed,
  );
  const permanentRetract = await recordVariableFixedObservation({
    userId,
    occurrenceId: contractOccurrence.id,
    amount: 88,
    currency: "USD",
    action: "retract",
    scope: "from_now",
    dedupeKey: "k:contract:invalid-permanent-retract",
    expectedOccurrenceStatus: "observed",
    expectedResolvedAmount: 88,
    expectedTransactionId: null,
  });
  const planAfterInvalidRetract = await one(
    "fixed_expenses",
    "amount",
    "id",
    ids.fixed,
  );
  check(
    "K24 · retract no puede cambiar el plan permanente ni retirar media operación",
    contractObserved.ok &&
      !permanentRetract.ok &&
      permanentRetract.reason === "unsafe" &&
      cents(planAfterInvalidRetract?.amount) ===
        cents(planBeforeInvalidRetract?.amount),
    JSON.stringify({
      contractObserved,
      permanentRetract,
      planBeforeInvalidRetract,
      planAfterInvalidRetract,
    }),
  );
  const mismatchedRetract = await recordVariableFixedObservation({
    userId,
    occurrenceId: contractOccurrence.id,
    amount: 89,
    currency: "USD",
    action: "retract",
    scope: "once",
    dedupeKey: "k:contract:mismatched-retract",
    expectedOccurrenceStatus: "observed",
    expectedResolvedAmount: 88,
    expectedTransactionId: null,
  });
  const contractRow = await one(
    "recurring_occurrences",
    "status, resolved_amount",
    "id",
    contractOccurrence.id,
  );
  check(
    "K25 · retract exige la observación exacta; un monto distinto no borra el hecho vigente",
    !mismatchedRetract.ok &&
      mismatchedRetract.reason === "unsafe" &&
      contractRow?.status === "observed" &&
      cents(contractRow?.resolved_amount) === 88 &&
      (await count(
        "fixed_expense_observations",
        "occurrence_id",
        contractOccurrence.id,
      )) === 1,
    JSON.stringify({ mismatchedRetract, contractRow }),
  );

  // Historical corrections belong to the cycle that was actually captured,
  // even if the user later changes the plan's currency and cadence. Without
  // durable occurrence snapshots, this either becomes an unrecoverable
  // currency mismatch or pollutes the new regime with an old USD bill.
  const { data: historicalFixed, error: historicalFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Agua K histórica",
      amount: 40,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 12,
      payment_source_type: null,
      payment_source_id: null,
      is_variable: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (historicalFixedError) {
    throw new Error(`historical fixed: ${historicalFixedError.message}`);
  }
  const historicalOccurrence = await occurrence(
    "2026-01-12",
    historicalFixed.id,
    40,
    "USD",
  );
  const historicalPaid = await resolveOccurrence({
    userId,
    occurrenceId: historicalOccurrence.id,
    action: "confirm",
    amount: 40,
    paymentSource: {
      id: ids.account,
      currency: "USD",
      isCard: false,
    },
    paymentDateISO: "2026-01-14",
  });
  const { error: historicalPlanChangeError } = await admin
    .from("fixed_expenses")
    .update({
      amount: 55,
      currency: "EUR",
      frequency: "weekly",
    })
    .eq("id", historicalFixed.id)
    .eq("user_id", userId);
  if (historicalPlanChangeError) {
    throw new Error(
      `historical plan change: ${historicalPlanChangeError.message}`,
    );
  }
  const historicalKnownRead = await readKnownVariableFixedBills(userId);
  const historicalKnownBill =
    historicalKnownRead.ok && historicalKnownRead.complete
      ? historicalKnownRead.bills.find(
          (bill) => bill.occurrenceId === historicalOccurrence.id,
        )
      : null;
  check(
    "K68 · el feed de facturas conserva la cadencia del ciclo aunque el plan ya tenga otra",
    historicalKnownRead.ok &&
      historicalKnownRead.complete &&
      historicalKnownBill?.cadence === "monthly",
    JSON.stringify({
      historicalKnownRead,
      historicalKnownBill,
    }),
  );
  const historicalBalanceBeforeCorrection = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const historicalCorrected = await resolveOccurrence({
    userId,
    occurrenceId: historicalOccurrence.id,
    action: "correct",
    amount: 45,
    scope: "once",
  });
  const historicalOccurrenceAfter = await one(
    "recurring_occurrences",
    "status, resolved_amount, resolved_currency, fixed_expense_regime, fixed_expense_cadence, created_transaction_id",
    "id",
    historicalOccurrence.id,
  );
  const historicalObservationAfterRead = await currentObservation(
    "amount, currency, regime, cadence, is_current",
    historicalOccurrence.id,
  );
  const historicalObservationAfter = historicalObservationAfterRead.row;
  const historicalForecastAfter = await one(
    "fixed_expense_forecasts",
    "regime, planning_amount, currency, sample_count",
    "fixed_expense_id",
    historicalFixed.id,
  );
  const historicalTxAfter = historicalOccurrenceAfter?.created_transaction_id
    ? await one(
        "transactions",
        "original_amount, original_currency, source_account_id, occurred_at",
        "id",
        historicalOccurrenceAfter.created_transaction_id,
      )
    : null;
  check(
    "K36 · cambiar moneda/cadencia del plan no reetiqueta ni bloquea la corrección de un ciclo histórico",
    historicalPaid.ok &&
      historicalCorrected.ok &&
      historicalObservationAfterRead.ok &&
      historicalOccurrenceAfter?.status === "corrected" &&
      cents(historicalOccurrenceAfter?.resolved_amount) === 45 &&
      historicalOccurrenceAfter?.resolved_currency === "USD" &&
      historicalOccurrenceAfter?.fixed_expense_regime === 1 &&
      historicalOccurrenceAfter?.fixed_expense_cadence === "monthly" &&
      cents(historicalObservationAfter?.amount) === 45 &&
      historicalObservationAfter?.currency === "USD" &&
      historicalObservationAfter?.regime === 1 &&
      historicalObservationAfter?.cadence === "monthly" &&
      historicalObservationAfter?.is_current === true &&
      historicalForecastAfter?.regime === 2 &&
      cents(historicalForecastAfter?.planning_amount) === 55 &&
      historicalForecastAfter?.currency === "EUR" &&
      historicalForecastAfter?.sample_count === 0 &&
      cents(historicalTxAfter?.original_amount) === 45 &&
      historicalTxAfter?.original_currency === "USD" &&
      historicalTxAfter?.source_account_id === ids.account &&
      String(historicalTxAfter?.occurred_at).startsWith("2026-01-14") &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === historicalBalanceBeforeCorrection - 5,
    JSON.stringify({
      historicalPaid,
      historicalCorrected,
      historicalOccurrenceAfter,
      historicalObservationAfter,
      observationRead: historicalObservationAfterRead.detail,
      historicalForecastAfter,
      historicalTxAfter,
    }),
  );
  const historicalTxCountBeforePermanent = await count(
    "transactions",
    "user_id",
    userId,
  );
  const historicalBalanceBeforePermanent = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const historicalPermanentMismatch = await resolveOccurrence({
    userId,
    occurrenceId: historicalOccurrence.id,
    action: "correct",
    amount: 46,
    scope: "from_now",
  });
  const historicalPlanAfterPermanentAttempt = await one(
    "fixed_expenses",
    "amount, currency, frequency",
    "id",
    historicalFixed.id,
  );
  const historicalObservationAfterPermanentAttemptRead =
    await currentObservation(
    "amount, currency, regime, is_current",
    historicalOccurrence.id,
  );
  const historicalObservationAfterPermanentAttempt =
    historicalObservationAfterPermanentAttemptRead.row;
  check(
    "K40 · una corrección histórica USD no reinterpreta el plan actual EUR con el mismo número",
    !historicalPermanentMismatch.ok &&
      historicalObservationAfterPermanentAttemptRead.ok &&
      /ciclo está en USD.*plan actual está en EUR/i.test(
        historicalPermanentMismatch.detail,
      ) &&
      cents(historicalPlanAfterPermanentAttempt?.amount) === 55 &&
      historicalPlanAfterPermanentAttempt?.currency === "EUR" &&
      historicalPlanAfterPermanentAttempt?.frequency === "weekly" &&
      cents(historicalObservationAfterPermanentAttempt?.amount) === 45 &&
      historicalObservationAfterPermanentAttempt?.currency === "USD" &&
      historicalObservationAfterPermanentAttempt?.regime === 1 &&
      historicalObservationAfterPermanentAttempt?.is_current === true &&
      (await count("transactions", "user_id", userId)) ===
        historicalTxCountBeforePermanent &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === historicalBalanceBeforePermanent,
    JSON.stringify({
      historicalPermanentMismatch,
      historicalPlanAfterPermanentAttempt,
      observationRead: historicalObservationAfterPermanentAttemptRead.detail,
      historicalObservationAfterPermanentAttempt,
    }),
  );

  const { data: zeroFixed, error: zeroFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Factura cero K",
      amount: 25,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 12,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_variable: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (zeroFixedError) {
    throw new Error(`zero fixed: ${zeroFixedError.message}`);
  }
  const zeroOccurrence = await occurrence(
    "2028-01-12",
    zeroFixed.id,
    25,
  );
  const zeroBalanceBefore = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const zeroObserved = await resolveOccurrence({
    userId,
    occurrenceId: zeroOccurrence.id,
    action: "observe",
    amount: 0,
    scope: "once",
  });
  const zeroOccurrenceAfter = await one(
    "recurring_occurrences",
    "status, resolved_amount, resolved_currency, created_transaction_id",
    "id",
    zeroOccurrence.id,
  );
  const zeroReplay = await resolveOccurrence({
    userId,
    occurrenceId: zeroOccurrence.id,
    action: "confirm",
    amount: 0,
    scope: "once",
  });
  check(
    "K45 · una factura variable de cero queda aprendida y terminal sin inventar un pago ni entrar en un ask imposible",
    zeroObserved.ok &&
      /cerrada sin registrar/i.test(zeroObserved.detail) &&
      zeroOccurrenceAfter?.status === "confirmed" &&
      cents(zeroOccurrenceAfter?.resolved_amount) === 0 &&
      zeroOccurrenceAfter?.resolved_currency === "USD" &&
      zeroOccurrenceAfter?.created_transaction_id == null &&
      zeroReplay.ok &&
      /no había pago pendiente/i.test(zeroReplay.detail) &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === zeroBalanceBefore &&
      (await count(
        "transactions",
        "recurring_expense_id",
        zeroFixed.id,
      )) === 0 &&
      (await count(
        "fixed_expense_observations",
        "occurrence_id",
        zeroOccurrence.id,
      )) === 1,
    JSON.stringify({
      zeroObserved,
      zeroOccurrenceAfter,
      zeroReplay,
    }),
  );

  const zeroCorrectionOccurrence = await occurrence(
    "2028-02-12",
    zeroFixed.id,
    25,
  );
  const observedBeforeZeroCorrection = await resolveOccurrence({
    userId,
    occurrenceId: zeroCorrectionOccurrence.id,
    action: "observe",
    amount: 18,
    scope: "once",
    operationId: "k:zero-unpaid:observe",
  });
  const zeroCorrectionBalanceBefore = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const correctedUnpaidToZero = await resolveOccurrence({
    userId,
    occurrenceId: zeroCorrectionOccurrence.id,
    action: "correct",
    amount: 0,
    scope: "once",
    operationId: "k:zero-unpaid:correct",
  });
  const zeroCorrectionAfter = await one(
    "recurring_occurrences",
    "status, resolved_amount, resolved_currency, created_transaction_id",
    "id",
    zeroCorrectionOccurrence.id,
  );
  const zeroCorrectionCurrentObservation = await currentObservation(
    "amount, currency, transaction_id, supersedes_id, is_current",
    zeroCorrectionOccurrence.id,
  );
  check(
    "K55 · corregir a cero una factura observada usa el mismo writer sin exigir un pago imposible",
    observedBeforeZeroCorrection.ok &&
      correctedUnpaidToZero.ok &&
      zeroCorrectionCurrentObservation.ok &&
      /factura vino en cero|cerrada sin registrar/i.test(
        correctedUnpaidToZero.detail,
      ) &&
      zeroCorrectionAfter?.status === "confirmed" &&
      cents(zeroCorrectionAfter?.resolved_amount) === 0 &&
      zeroCorrectionAfter?.resolved_currency === "USD" &&
      zeroCorrectionAfter?.created_transaction_id == null &&
      cents(zeroCorrectionCurrentObservation.row?.amount) === 0 &&
      zeroCorrectionCurrentObservation.row?.currency === "USD" &&
      zeroCorrectionCurrentObservation.row?.transaction_id == null &&
      zeroCorrectionCurrentObservation.row?.supersedes_id != null &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === zeroCorrectionBalanceBefore &&
      (await count(
        "transactions",
        "recurring_expense_id",
        zeroFixed.id,
      )) === 0,
    JSON.stringify({
      observedBeforeZeroCorrection,
      correctedUnpaidToZero,
      occurrence: zeroCorrectionAfter,
      observation: zeroCorrectionCurrentObservation,
    }),
  );

  const k56Name =
    "K56 · una reversa repara un ciclo pre-K divergente: devuelve caja y conserva la factura como observada e impaga";
  const k58Name =
    "K58 · la RPC rehúsa observe sobre una factura ya pagada aunque el monto sea idéntico";
  let k56Checked = false;
  let k58Checked = false;
  try {
    // A genuine pre-K row has no K observation. Building this fixture through
    // resolveOccurrence would create one, and the observation itself keeps the
    // guard active even after is_variable is turned off. Start stable, use the
    // generic ledger writer that existed before K, lose the link while the plan
    // is still stable, and only then turn variability on.
    const { data: divergentFixed, error: divergentFixedError } = await admin
      .from("fixed_expenses")
      .insert({
        user_id: userId,
        name: "Servicio K reversa divergente",
        amount: 33,
        currency: "USD",
        category: "utilities",
        frequency: "monthly",
        expected_day: 13,
        payment_source_type: "account",
        payment_source_id: ids.account,
        is_variable: false,
        is_active: true,
      })
      .select("id")
      .single();
    if (divergentFixedError || !divergentFixed) {
      throw new Error(
        `divergent fixed: ${divergentFixedError?.message ?? "sin fila"}`,
      );
    }
    const divergentOccurrence = await occurrence(
      "2028-03-13",
      divergentFixed.id,
      33,
    );
    const divergentTransactionId = await applyLedgerEntry(admin, {
      userId,
      type: "expense",
      effectType: "expense",
      category: "utilities",
      description: "Servicio K pre-K pagado antes del guard",
      originalAmount: 33,
      originalCurrency: "USD",
      baseAmount: 33,
      baseCurrency: "USD",
      exchangeRateToBase: 1,
      sourceAccountId: ids.account,
      recurringExpenseId: divergentFixed.id,
      occurredAtISO: "2028-03-13T12:00:00.000Z",
      inputChannel: "web",
      dedupeKey: "k:reversal-divergence:legacy-ledger",
    });
    const { error: markDivergentBookedError } = await admin
      .from("recurring_occurrences")
      .update({
        status: "booked",
        created_transaction_id: divergentTransactionId,
      })
      .eq("user_id", userId)
      .eq("id", divergentOccurrence.id);
    if (markDivergentBookedError) {
      throw new Error(
        `mark divergent legacy payment: ${markDivergentBookedError.message}`,
      );
    }
    const divergentObservationCountBefore = await count(
      "fixed_expense_observations",
      "occurrence_id",
      divergentOccurrence.id,
    );
    const { error: driftOccurrenceError } = await admin
      .from("recurring_occurrences")
      .update({ created_transaction_id: null })
      .eq("user_id", userId)
      .eq("id", divergentOccurrence.id);
    if (driftOccurrenceError) {
      throw new Error(
        `drift divergent occurrence: ${driftOccurrenceError.message}`,
      );
    }
    const { error: divergentBackToVariableError } = await admin
      .from("fixed_expenses")
      .update({ is_variable: true })
      .eq("user_id", userId)
      .eq("id", divergentFixed.id);
    if (divergentBackToVariableError) {
      throw new Error(
        `restore divergent variable plan: ${divergentBackToVariableError.message}`,
      );
    }
    const divergentBalanceBefore = Number(
      (await one("accounts", "current_balance_original", "id", ids.account))
        ?.current_balance_original,
    );
    let divergentReversalError = "";
    try {
      await applyLedgerReversal(admin, {
        userId,
        originalTransactionId: divergentTransactionId,
        occurredAtISO: "2028-03-14T12:00:00.000Z",
      });
    } catch (error) {
      divergentReversalError =
        error instanceof Error ? error.message : String(error);
    }
    const divergentObservationAfter = await currentObservation(
      "amount, currency, transaction_id, is_current",
      divergentOccurrence.id,
    );
    const divergentOccurrenceAfter = await one(
      "recurring_occurrences",
      "status, resolved_amount, resolved_currency, created_transaction_id",
      "id",
      divergentOccurrence.id,
    );
    check(
      k56Name,
      divergentObservationCountBefore === 0 &&
        divergentReversalError === "" &&
        Number(
          (await one("accounts", "current_balance_original", "id", ids.account))
            ?.current_balance_original,
        ) ===
          divergentBalanceBefore + 33 &&
        divergentObservationAfter.ok &&
        cents(divergentObservationAfter.row?.amount) === 33 &&
        divergentObservationAfter.row?.currency === "USD" &&
        divergentObservationAfter.row?.transaction_id == null &&
        divergentObservationAfter.row?.is_current === true &&
        divergentOccurrenceAfter?.status === "observed" &&
        cents(divergentOccurrenceAfter?.resolved_amount) === 33 &&
        divergentOccurrenceAfter?.resolved_currency === "USD" &&
        divergentOccurrenceAfter?.created_transaction_id == null &&
        (await count(
          "transactions",
          "related_transaction_id",
          divergentTransactionId,
        )) === 1,
      JSON.stringify({
        error: divergentReversalError,
        observationsBefore: divergentObservationCountBefore,
        observationAfter: divergentObservationAfter,
        occurrenceAfter: divergentOccurrenceAfter,
      }),
    );
    k56Checked = true;

    // Pay the repaired invoice through the production resolver. K58 needs a
    // genuinely paid K cycle; it must not depend on a hand-planted link or
    // observation.
    const repaidDivergent = await resolveOccurrence({
      userId,
      occurrenceId: divergentOccurrence.id,
      action: "confirm",
      amount: 33,
      scope: "once",
      paymentSource: {
        id: ids.account,
        currency: "USD",
        isCard: false,
      },
      paymentDateISO: "2028-03-14",
      operationId: "k:reversal-divergence:repay",
    });
    const divergentRepaidOccurrence = await one(
      "recurring_occurrences",
      "status, resolved_amount, created_transaction_id",
      "id",
      divergentOccurrence.id,
    );
    const divergentRepaidTransactionId = String(
      divergentRepaidOccurrence?.created_transaction_id ?? "",
    );
    const { error: paidAsObservedError } = await admin.rpc(
      "kipu_record_variable_fixed_observation",
      {
        p: {
          user_id: userId,
          occurrence_id: divergentOccurrence.id,
          amount: 33,
          currency: "USD",
          action: "observe",
          scope: "once",
          dedupe_key: "k:paid-as-observed",
          expected_occurrence_status: "confirmed",
          expected_resolved_amount: 33,
          expected_transaction_id: divergentRepaidTransactionId,
          entry: null,
        },
      },
    );
    const paidAsObservedCurrent = await currentObservation(
      "transaction_id, amount, is_current",
      divergentOccurrence.id,
    );
    check(
      k58Name,
      repaidDivergent.ok &&
        divergentRepaidTransactionId !== "" &&
        divergentRepaidTransactionId !== divergentTransactionId &&
        !!paidAsObservedError &&
        paidAsObservedCurrent.ok &&
        /paid bill cannot be re-declared as unpaid/i.test(
          paidAsObservedError.message,
        ) &&
        Number(
          (await one("accounts", "current_balance_original", "id", ids.account))
            ?.current_balance_original,
        ) === divergentBalanceBefore &&
        paidAsObservedCurrent.row?.transaction_id ===
          divergentRepaidTransactionId &&
        cents(paidAsObservedCurrent.row?.amount) === 33 &&
        paidAsObservedCurrent.row?.is_current === true &&
        (await count(
          "fixed_expense_observation_operations",
          "dedupe_key",
          "k:paid-as-observed",
      )) === 0,
      JSON.stringify({
        repaid: repaidDivergent,
        occurrence: divergentRepaidOccurrence,
        error: paidAsObservedError?.message,
        observation: paidAsObservedCurrent,
      }),
    );
    k58Checked = true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!k56Checked) {
      check(k56Name, false, `fixture: ${detail}`);
    }
    if (!k58Checked) {
      check(k58Name, false, `fixture: ${detail}`);
    }
  }

  const { data: retiredFixed, error: retiredFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Servicio K retirado con factura viva",
      amount: 60,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 14,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_variable: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (retiredFixedError) {
    throw new Error(`retired fixed: ${retiredFixedError.message}`);
  }
  const retiredPending = await occurrence(
    "2028-02-14",
    retiredFixed.id,
    60,
  );
  const retiredObservedOccurrence = await occurrence(
    "2028-03-14",
    retiredFixed.id,
    60,
  );
  const retiredObserved = await resolveOccurrence({
    userId,
    occurrenceId: retiredObservedOccurrence.id,
    action: "observe",
    amount: 64,
    scope: "once",
  });
  const { error: retirePlanError } = await admin
    .from("fixed_expenses")
    .update({ is_variable: false })
    .eq("id", retiredFixed.id)
    .eq("user_id", userId);
  if (retirePlanError) {
    throw new Error(`retire plan: ${retirePlanError.message}`);
  }
  const retiredPendingConverted = await one(
    "recurring_occurrences",
    "status, mode, expected_amount, resolved_amount",
    "id",
    retiredPending.id,
  );
  const retiredObservedAfter = await one(
    "recurring_occurrences",
    "status, resolved_amount",
    "id",
    retiredObservedOccurrence.id,
  );
  const beforeHistoricalBypass = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  let historicalBypassError = "";
  try {
    await applyLedgerEntry(admin, {
      userId,
      type: "expense",
      effectType: "expense",
      description: "Intento genérico sobre factura histórica",
      category: "utilities",
      originalAmount: 64,
      originalCurrency: "USD",
      exchangeRateToBase: 1,
      baseAmount: 64,
      baseCurrency: "USD",
      sourceAccountId: ids.account,
      recurringExpenseId: retiredFixed.id,
      occurredAtISO: "2028-03-14T12:00:00.000Z",
      inputChannel: "system",
      dedupeKey: "k:retired:generic-bypass",
    });
  } catch (error) {
    historicalBypassError =
      error instanceof Error ? error.message : String(error);
  }
  const { error: pauseRetiredPlanError } = await admin
    .from("fixed_expenses")
    .update({ is_active: false })
    .eq("id", retiredFixed.id)
    .eq("user_id", userId);
  if (pauseRetiredPlanError) {
    throw new Error(`pause retired plan: ${pauseRetiredPlanError.message}`);
  }
  const retiredPendingAfter = await one(
    "recurring_occurrences",
    "status, mode, expected_amount, resolved_amount",
    "id",
    retiredPending.id,
  );
  const retiredBalanceBeforePay = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const paidAfterRetire = await resolveOccurrence({
    userId,
    occurrenceId: retiredObservedOccurrence.id,
    action: "confirm",
    amount: 64,
    scope: "once",
    paymentDateISO: "2028-03-14",
    paymentSource: {
      id: ids.account,
      currency: "USD",
      isCard: false,
    },
  });
  const retiredObservedPaid = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    retiredObservedOccurrence.id,
  );
  check(
    "K46 · variable→fijo migra el ciclo desconocido a AUTO; una pausa sí lo retira, pero la factura observada sobrevive y todavía puede pagarse solo como historia",
    retiredObserved.ok &&
      retiredPendingConverted?.status === "pending" &&
      retiredPendingConverted?.mode === "auto" &&
      cents(retiredPendingConverted?.expected_amount) === 60 &&
      retiredPendingAfter?.status === "dismissed" &&
      retiredPendingAfter?.resolved_amount == null &&
      retiredObservedAfter?.status === "observed" &&
      cents(retiredObservedAfter?.resolved_amount) === 64 &&
      historicalBypassError !== "" &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === beforeHistoricalBypass - 64 &&
      paidAfterRetire.ok &&
      retiredObservedPaid?.status === "confirmed" &&
      cents(retiredObservedPaid?.resolved_amount) === 64 &&
      retiredObservedPaid?.created_transaction_id != null &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === retiredBalanceBeforePay - 64,
    JSON.stringify({
      retiredObserved,
      retiredPendingConverted,
      retiredPendingAfter,
      retiredObservedAfter,
      historicalBypassError,
      paidAfterRetire,
      retiredObservedPaid,
    }),
  );

  const { data: dismissedThenFixed, error: dismissedThenFixedError } =
    await admin
      .from("fixed_expenses")
      .insert({
        user_id: userId,
        name: "Servicio K descartado antes de quedar fijo",
        amount: 70,
        currency: "USD",
        category: "utilities",
        frequency: "monthly",
        expected_day: 16,
        payment_source_type: "account",
        payment_source_id: ids.account,
        is_variable: true,
        is_active: true,
      })
      .select("id")
      .single();
  if (dismissedThenFixedError) {
    throw new Error(
      `dismissed then fixed: ${dismissedThenFixedError.message}`,
    );
  }
  const dismissedThenFixedOccurrence = await occurrence(
    "2028-04-16",
    dismissedThenFixed.id,
    70,
  );
  const dismissedThenFixedObserved = await resolveOccurrence({
    userId,
    occurrenceId: dismissedThenFixedOccurrence.id,
    action: "observe",
    amount: 73,
    scope: "once",
  });
  const dismissedThenFixedDismissed = await resolveOccurrence({
    userId,
    occurrenceId: dismissedThenFixedOccurrence.id,
    action: "dismiss",
    scope: "once",
  });
  const { error: makeDismissedPlanFixedError } = await admin
    .from("fixed_expenses")
    .update({ is_variable: false })
    .eq("id", dismissedThenFixed.id)
    .eq("user_id", userId);
  if (makeDismissedPlanFixedError) {
    throw new Error(
      `make dismissed plan fixed: ${makeDismissedPlanFixedError.message}`,
    );
  }
  const dismissedThenFixedBalanceBefore = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  let dismissedThenFixedPayment = null;
  let dismissedThenFixedPaymentError = "";
  try {
    dismissedThenFixedPayment = await applyLedgerEntry(admin, {
      userId,
      type: "expense",
      effectType: "expense",
      description: "Ciclo fijo posterior a recordatorio descartado",
      category: "utilities",
      originalAmount: 70,
      originalCurrency: "USD",
      exchangeRateToBase: 1,
      baseAmount: 70,
      baseCurrency: "USD",
      sourceAccountId: ids.account,
      recurringExpenseId: dismissedThenFixed.id,
      occurredAtISO: "2028-05-16T12:00:00.000Z",
      inputChannel: "system",
      dedupeKey: "k:dismissed-then-fixed:payment",
    });
  } catch (error) {
    dismissedThenFixedPaymentError =
      error instanceof Error ? error.message : String(error);
  }
  const dismissedThenFixedOccurrenceAfter = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    dismissedThenFixedOccurrence.id,
  );
  check(
    "K51 · descartar una factura variable conserva el hecho, pero no vuelve imposible registrar ciclos futuros si el plan pasa a fijo",
      dismissedThenFixedObserved.ok &&
      dismissedThenFixedDismissed.ok &&
      dismissedThenFixedPaymentError === "" &&
      typeof dismissedThenFixedPayment === "string" &&
      dismissedThenFixedPayment.length > 0 &&
      dismissedThenFixedOccurrenceAfter?.status === "dismissed" &&
      cents(dismissedThenFixedOccurrenceAfter?.resolved_amount) === 73 &&
      dismissedThenFixedOccurrenceAfter?.created_transaction_id == null &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) ===
        dismissedThenFixedBalanceBefore - 70,
    JSON.stringify({
      observed: dismissedThenFixedObserved,
      dismissed: dismissedThenFixedDismissed,
      paymentError: dismissedThenFixedPaymentError,
      payment: dismissedThenFixedPayment,
      occurrenceAfter: dismissedThenFixedOccurrenceAfter,
      balanceBefore: dismissedThenFixedBalanceBefore,
    }),
  );

  const { data: staleRegimeFixed, error: staleRegimeFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Servicio K cambia durante edición",
      amount: 80,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 17,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_variable: false,
      is_active: true,
    })
    .select("id")
    .single();
  if (staleRegimeFixedError) {
    throw new Error(`stale regime fixed: ${staleRegimeFixedError.message}`);
  }
  const { error: concurrentVariabilityError } = await admin
    .from("fixed_expenses")
    .update({ is_variable: true })
    .eq("id", staleRegimeFixed.id)
    .eq("user_id", userId);
  if (concurrentVariabilityError) {
    throw new Error(
      `concurrent variability: ${concurrentVariabilityError.message}`,
    );
  }
  const staleRegimeOccurrence = await occurrence(
    "2028-06-17",
    staleRegimeFixed.id,
    80,
  );
  const staleRegimeBalanceBefore = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const staleRegimeAtomic = await applyFixedExpenseWithPayment({
    userId,
    mode: "update",
    dedupeKey: "k:stale-regime:atomic",
    fixedExpenseId: staleRegimeFixed.id,
    patch: {
      amount: 82,
      _expected_is_variable: false,
    },
    entry: {
      userId,
      type: "expense",
      effectType: "expense",
      description: "Servicio K cambia durante edición",
      category: "utilities",
      originalAmount: 82,
      originalCurrency: "USD",
      exchangeRateToBase: 1,
      baseAmount: 82,
      baseCurrency: "USD",
      sourceAccountId: ids.account,
      rawInput: "edición nacida como fija",
      inputChannel: "system",
      dedupeKey: "k:stale-regime:atomic",
      occurredAtISO: "2028-06-17T12:00:00.000Z",
    },
  });
  const staleRegimePlanAfter = await one(
    "fixed_expenses",
    "amount, is_variable",
    "id",
    staleRegimeFixed.id,
  );
  const staleRegimeOccurrenceAfter = await one(
    "recurring_occurrences",
    "status, resolved_amount, created_transaction_id",
    "id",
    staleRegimeOccurrence.id,
  );
  check(
    "K52 · una edición atómica nacida sobre régimen fijo se rehúsa si el plan pasó a variable antes del lock",
    !staleRegimeAtomic.ok &&
      staleRegimeAtomic.reason === "unsafe" &&
      cents(staleRegimePlanAfter?.amount) === 80 &&
      staleRegimePlanAfter?.is_variable === true &&
      staleRegimeOccurrenceAfter?.status === "pending" &&
      staleRegimeOccurrenceAfter?.resolved_amount == null &&
      staleRegimeOccurrenceAfter?.created_transaction_id == null &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === staleRegimeBalanceBefore &&
      (await count(
        "fixed_expense_payment_applications",
        "dedupe_key",
        "k:stale-regime:atomic",
      )) === 0,
    JSON.stringify({
      result: staleRegimeAtomic,
      plan: staleRegimePlanAfter,
      occurrence: staleRegimeOccurrenceAfter,
      balanceBefore: staleRegimeBalanceBefore,
    }),
  );

  const { error: zeroPlanError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Variable K sin baseline",
      amount: 0,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 18,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_active: true,
      is_variable: true,
    });
  check(
    "K53 · una factura mensual puede venir en cero, pero un plan variable activo no puede proteger cero mientras espera historia",
    !!zeroPlanError &&
      /active variable fixed plan needs a positive declared amount/i.test(
        zeroPlanError.message,
      ),
    zeroPlanError?.message ?? "el plan variable activo en cero fue aceptado",
  );

  const { data: stableSignPlan, error: stableSignCreateError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Fijo estable signo K",
      amount: 10,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      is_variable: false,
      is_active: true,
    })
    .select("id, amount")
    .single();
  if (stableSignCreateError || !stableSignPlan) {
    throw new Error(
      `stable sign plan: ${stableSignCreateError?.message ?? "missing"}`,
    );
  }
  const { error: negativeStableError } = await admin
    .from("fixed_expenses")
    .update({ amount: -10 })
    .eq("id", stableSignPlan.id)
    .eq("user_id", userId);
  const stableSignAfter = await one(
    "fixed_expenses",
    "amount",
    "id",
    stableSignPlan.id,
  );
  check(
    "K65 · ningún writer puede convertir un fijo estable negativo en plata libre positiva",
    !!negativeStableError &&
      /fixed_expenses_amount_nonnegative_ck/i.test(
        negativeStableError.message,
      ) &&
      cents(stableSignAfter?.amount) === 10,
    JSON.stringify({
      error: negativeStableError?.message,
      row: stableSignAfter,
    }),
  );

  const { data: paidToZeroFixed, error: paidToZeroFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: userId,
      name: "Agua K corregible a cero",
      amount: 25,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 19,
      payment_source_type: "account",
      payment_source_id: ids.account,
      is_active: true,
      is_variable: true,
    })
    .select("id")
    .single();
  if (paidToZeroFixedError) {
    throw new Error(`paid-to-zero fixed: ${paidToZeroFixedError.message}`);
  }
  const paidToZeroOccurrence = await occurrence(
    "2028-07-19",
    paidToZeroFixed.id,
    25,
  );
  const paidToZeroBalanceBefore = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const paidToZeroPlan = planRecurringLedgerEntry({
    userId,
    kind: "expense",
    nativeAmount: 25,
    nativeCurrency: "USD",
    base: "USD",
    rates: [],
    accountId: ids.account,
    accountCurrency: "USD",
    isCard: false,
    recurringExpenseId: paidToZeroFixed.id,
    dedupeKey: "k:paid-to-zero:ledger",
    occurredAtISO: "2028-07-19T12:00:00.000Z",
    occurrenceDateISO: "2028-07-19",
    description: "Agua K corregible a cero",
    sourceLinkId: paidToZeroFixed.id,
  });
  if (!paidToZeroPlan.ok) {
    throw new Error(`paid-to-zero plan: ${paidToZeroPlan.reason}`);
  }
  const paidBeforeZero = await recordVariableFixedObservation({
    userId,
    occurrenceId: paidToZeroOccurrence.id,
    amount: 25,
    currency: "USD",
    action: "pay",
    scope: "once",
    dedupeKey: "k:paid-to-zero:pay",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
    entry: paidToZeroPlan.entry,
  });
  if (!paidBeforeZero.ok || !paidBeforeZero.transactionId) {
    throw new Error(`paid-to-zero initial pay: ${JSON.stringify(paidBeforeZero)}`);
  }
  const correctedToZero = await resolveOccurrence({
    userId,
    occurrenceId: paidToZeroOccurrence.id,
    action: "correct",
    amount: 0,
    scope: "once",
    operationId: "k:paid-to-zero:correct",
  });
  const paidToZeroOccurrenceAfter = await one(
    "recurring_occurrences",
    "status, resolved_amount, resolved_currency, created_transaction_id",
    "id",
    paidToZeroOccurrence.id,
  );
  const paidToZeroObservationAfter = await currentObservation(
    "amount, currency, transaction_id, is_current",
    paidToZeroOccurrence.id,
  );
  check(
    "K54 · corregir una factura ya pagada a cero revierte caja y conserva la factura cero en una sola operación",
    correctedToZero.ok &&
      paidToZeroObservationAfter.ok &&
      paidToZeroOccurrenceAfter?.status === "corrected" &&
      cents(paidToZeroOccurrenceAfter?.resolved_amount) === 0 &&
      paidToZeroOccurrenceAfter?.resolved_currency === "USD" &&
      paidToZeroOccurrenceAfter?.created_transaction_id == null &&
      cents(paidToZeroObservationAfter.row?.amount) === 0 &&
      paidToZeroObservationAfter.row?.currency === "USD" &&
      paidToZeroObservationAfter.row?.transaction_id == null &&
      paidToZeroObservationAfter.row?.is_current === true &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === paidToZeroBalanceBefore &&
      (await count(
        "transactions",
        "related_transaction_id",
        paidBeforeZero.transactionId,
      )) === 1,
    JSON.stringify({
      result: correctedToZero,
      occurrence: paidToZeroOccurrenceAfter,
      observation: paidToZeroObservationAfter,
      balanceBefore: paidToZeroBalanceBefore,
    }),
  );

  const paidRetractOccurrence = await occurrence("2032-01-15");
  const paidRetractBalanceBefore = Number(
    (await one("accounts", "current_balance_original", "id", ids.account))
      ?.current_balance_original,
  );
  const paidRetractPlan = planRecurringLedgerEntry({
    userId,
    kind: "expense",
    nativeAmount: 33,
    nativeCurrency: "USD",
    base: "USD",
    rates: [],
    accountId: ids.account,
    accountCurrency: "USD",
    isCard: false,
    recurringExpenseId: ids.fixed,
    dedupeKey: "k:paid-retract:ledger",
    occurredAtISO: "2032-01-15T12:00:00.000Z",
    occurrenceDateISO: "2032-01-15",
    description: "Luz K",
    sourceLinkId: ids.fixed,
    category: "utilities",
  });
  if (!paidRetractPlan.ok) {
    throw new Error(`paid retract plan: ${paidRetractPlan.reason}`);
  }
  const paidRetractPayment = await recordVariableFixedObservation({
    userId,
    occurrenceId: paidRetractOccurrence.id,
    amount: 33,
    currency: "USD",
    action: "pay",
    scope: "once",
    dedupeKey: "k:paid-retract:pay",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
    entry: paidRetractPlan.entry,
  });
  if (!paidRetractPayment.ok || !paidRetractPayment.transactionId) {
    throw new Error(
      `paid retract initial pay: ${JSON.stringify(paidRetractPayment)}`,
    );
  }
  const paidRetracted = await resolveOccurrence({
    userId,
    occurrenceId: paidRetractOccurrence.id,
    action: "retract",
    operationId: "k:paid-retract:void",
  });
  const paidRetractAfter = await one(
    "recurring_occurrences",
    "status, resolved_amount, resolved_currency, created_transaction_id",
    "id",
    paidRetractOccurrence.id,
  );
  check(
    "K59 · retirar una factura que ya tenía pago revierte caja + hecho + ocurrencia atómicamente, sin la saga skip/reversal",
    paidRetracted.ok &&
      paidRetractAfter?.status === "skipped" &&
      paidRetractAfter?.resolved_amount == null &&
      paidRetractAfter?.resolved_currency == null &&
      paidRetractAfter?.created_transaction_id == null &&
      Number(
        (await one("accounts", "current_balance_original", "id", ids.account))
          ?.current_balance_original,
      ) === paidRetractBalanceBefore &&
      (await count(
        "transactions",
        "related_transaction_id",
        paidRetractPayment.transactionId,
      )) === 1 &&
      (
        await admin
          .from("fixed_expense_observations")
          .select("*", { head: true, count: "exact" })
          .eq("occurrence_id", paidRetractOccurrence.id)
          .eq("is_current", true)
      ).count === 0,
    JSON.stringify({
      result: paidRetracted,
      occurrence: paidRetractAfter,
      balanceBefore: paidRetractBalanceBefore,
    }),
  );

  const guardedOccurrence = await occurrence("2032-02-15");
  const guardedObserved = await recordVariableFixedObservation({
    userId,
    occurrenceId: guardedOccurrence.id,
    amount: 18,
    currency: "USD",
    action: "observe",
    scope: "once",
    dedupeKey: "k:state-guard:observe",
    expectedOccurrenceStatus: "pending",
    expectedResolvedAmount: null,
    expectedTransactionId: null,
    entry: null,
  });
  if (!guardedObserved.ok) {
    throw new Error(`state guard observe: ${JSON.stringify(guardedObserved)}`);
  }
  const { error: forgedTerminalError } = await admin
    .from("recurring_occurrences")
    .update({ status: "confirmed" })
    .eq("id", guardedOccurrence.id)
    .eq("user_id", userId);
  const guardedAfter = await one(
    "recurring_occurrences",
    "status, resolved_amount, resolved_currency, created_transaction_id",
    "id",
    guardedOccurrence.id,
  );
  check(
    "K60 · ni service_role puede afirmar que una factura positiva fue pagada sin identidad de transacción",
    !!forgedTerminalError &&
      guardedAfter?.status === "observed" &&
      cents(guardedAfter?.resolved_amount) === 18 &&
      guardedAfter?.resolved_currency === "USD" &&
      guardedAfter?.created_transaction_id == null,
    JSON.stringify({
      error: forgedTerminalError?.message,
      occurrence: guardedAfter,
    }),
  );
  const { error: erasedToPendingError } = await admin
    .from("recurring_occurrences")
    .update({
      status: "pending",
      resolved_amount: null,
      resolved_currency: null,
      created_transaction_id: null,
    })
    .eq("id", guardedOccurrence.id)
    .eq("user_id", userId);
  const { error: erasedToSkippedError } = await admin
    .from("recurring_occurrences")
    .update({
      status: "skipped",
      resolved_amount: null,
      resolved_currency: null,
      created_transaction_id: null,
    })
    .eq("id", guardedOccurrence.id)
    .eq("user_id", userId);
  const guardedAfterEraseAttempts = await one(
    "recurring_occurrences",
    "status, resolved_amount, resolved_currency, created_transaction_id",
    "id",
    guardedOccurrence.id,
  );
  check(
    "K72 · occurrence y observación son un solo hecho: ni service_role puede borrar una factura observada con observed→pending/skipped",
    !!erasedToPendingError &&
      !!erasedToSkippedError &&
      guardedAfterEraseAttempts?.status === "observed" &&
      cents(guardedAfterEraseAttempts?.resolved_amount) === 18 &&
      guardedAfterEraseAttempts?.resolved_currency === "USD" &&
      guardedAfterEraseAttempts?.created_transaction_id == null &&
      (
        await admin
          .from("fixed_expense_observations")
          .select("*", { head: true, count: "exact" })
          .eq("occurrence_id", guardedOccurrence.id)
          .eq("is_current", true)
      ).count === 1,
    JSON.stringify({
      pending: erasedToPendingError?.message,
      skipped: erasedToSkippedError?.message,
      occurrence: guardedAfterEraseAttempts,
    }),
  );
  const forgedInsertDate = "2032-03-15";
  const { error: forgedInsertError } = await admin
    .from("recurring_occurrences")
    .insert({
      user_id: userId,
      fixed_expense_id: ids.fixed,
      occurrence_date: forgedInsertDate,
      kind: "expense",
      mode: "ask",
      expected_amount: 19,
      currency: "USD",
      status: "confirmed",
      resolved_amount: 19,
      resolved_currency: "USD",
      created_transaction_id: null,
    });
  const { count: forgedInsertCount, error: forgedInsertCountError } =
    await admin
      .from("recurring_occurrences")
      .select("*", { head: true, count: "exact" })
      .eq("user_id", userId)
      .eq("fixed_expense_id", ids.fixed)
      .eq("occurrence_date", forgedInsertDate);
  check(
    "K60b · ni service_role puede crear una ocurrencia variable ya terminal saltándose el writer atómico",
    !!forgedInsertError &&
      !forgedInsertCountError &&
      forgedInsertCount === 0,
    JSON.stringify({
      error: forgedInsertError?.message,
      countError: forgedInsertCountError?.message,
      rows: forgedInsertCount,
    }),
  );
  const inconsistentPendingDate = "2032-04-15";
  const { error: inconsistentPendingError } = await admin
    .from("recurring_occurrences")
    .insert({
      user_id: userId,
      fixed_expense_id: ids.fixed,
      occurrence_date: inconsistentPendingDate,
      kind: "expense",
      mode: "ask",
      expected_amount: 19,
      currency: "USD",
      status: "pending",
      resolved_amount: 19,
      resolved_currency: "USD",
    });
  const janAfterExplicitRedoForGuard = await one(
    "recurring_occurrences",
    "created_transaction_id",
    "id",
    jan.id,
  );
  if (!janAfterExplicitRedoForGuard?.created_transaction_id) {
    throw new Error(
      "K60c prerequisite: the explicit K13 redo transaction is unreadable",
    );
  }
  const { error: wrongPaymentIdentityError } = await admin
    .from("recurring_occurrences")
    .update({
      status: "confirmed",
      created_transaction_id:
        janAfterExplicitRedoForGuard.created_transaction_id,
    })
    .eq("id", guardedOccurrence.id)
    .eq("user_id", userId);
  const { error: reversedPaymentIdentityError } = await admin
    .from("recurring_occurrences")
    .update({
      status: "confirmed",
      created_transaction_id: paidRetractPayment.transactionId,
    })
    .eq("id", guardedOccurrence.id)
    .eq("user_id", userId);
  const guardedAfterWrongPayment = await one(
    "recurring_occurrences",
    "status, resolved_amount, resolved_currency, created_transaction_id",
    "id",
    guardedOccurrence.id,
  );
  const { error: lowercaseFactError } = await admin
    .from("recurring_occurrences")
    .update({ resolved_currency: "usd" })
    .eq("id", guardedOccurrence.id)
    .eq("user_id", userId);
  check(
    "K60c · pending no puede esconder un hecho, un UUID cualquiera no prueba el pago y la moneda nativa queda canónica",
    !!inconsistentPendingError &&
      /pending variable bill cannot claim/i.test(
        inconsistentPendingError.message,
      ) &&
      !!wrongPaymentIdentityError &&
      !!reversedPaymentIdentityError &&
      !!lowercaseFactError &&
      /resolved_currency/i.test(lowercaseFactError.message) &&
      guardedAfterWrongPayment?.status === "observed" &&
      cents(guardedAfterWrongPayment?.resolved_amount) === 18 &&
      guardedAfterWrongPayment?.created_transaction_id == null,
    JSON.stringify({
      inconsistentPendingError: inconsistentPendingError?.message,
      wrongPaymentIdentityError: wrongPaymentIdentityError?.message,
      reversedPaymentIdentityError: reversedPaymentIdentityError?.message,
      lowercaseFactError: lowercaseFactError?.message,
      occurrence: guardedAfterWrongPayment,
    }),
  );

  const sameCycleOccurrence = await occurrence("2033-07-10");
  const sameCycleRead = await readFixedExpenseCycleOccurrences({
    userId,
    fixedExpenseId: ids.fixed,
    frequency: "monthly",
    occurrenceDate: "2033-07-20",
  });
  check(
    "K61 · el alta temprana busca todo el mes y reutiliza una fila creada bajo otro día de vencimiento",
    sameCycleRead.ok &&
      sameCycleRead.complete &&
      sameCycleRead.occurrences.length === 1 &&
      sameCycleRead.occurrences[0]?.id === sameCycleOccurrence.id,
    JSON.stringify(sameCycleRead),
  );
  const { error: duplicateMonthlyCycleError } = await admin
    .from("recurring_occurrences")
    .insert({
      user_id: userId,
      fixed_expense_id: ids.fixed,
      occurrence_date: "2033-07-20",
      kind: "expense",
      mode: "ask",
      expected_amount: 999,
      currency: "EUR",
      status: "pending",
    });
  const { count: julyCycleCount, error: julyCycleCountError } = await admin
    .from("recurring_occurrences")
    .select("*", { head: true, count: "exact" })
    .eq("user_id", userId)
    .eq("fixed_expense_id", ids.fixed)
    .gte("occurrence_date", "2033-07-01")
    .lt("occurrence_date", "2033-08-01");
  check(
    "K70 · PostgreSQL impide dos fechas del mismo ciclo mensual aunque una carrera salte el pre-read",
    !!duplicateMonthlyCycleError &&
      /recurring_occurrences_fixed_monthly_cycle_uq/i.test(
        duplicateMonthlyCycleError.message,
      ) &&
      !julyCycleCountError &&
      julyCycleCount === 1,
    JSON.stringify({
      error: duplicateMonthlyCycleError?.message,
      countError: julyCycleCountError?.message,
      count: julyCycleCount,
    }),
  );

  const regimeIdentity = await one(
    "fixed_expense_forecasts",
    "regime, regime_started_at, updated_at",
    "fixed_expense_id",
    ids.fixed,
  );
  check(
    "K62 · cada forecast expone una identidad temporal de régimen coherente para no atribuirle ciclos históricos",
    Number(regimeIdentity?.regime) > 0 &&
      Number.isFinite(Date.parse(String(regimeIdentity?.regime_started_at))) &&
      Date.parse(String(regimeIdentity?.updated_at)) >=
        Date.parse(String(regimeIdentity?.regime_started_at)),
    JSON.stringify(regimeIdentity),
  );

  const liveForecastForOccurrence = await one(
    "fixed_expense_forecasts",
    "regime, planning_amount, currency, cadence",
    "fixed_expense_id",
    ids.fixed,
  );
  const { data: normalizedOccurrence, error: normalizedOccurrenceError } =
    await admin
      .from("recurring_occurrences")
      .insert({
        user_id: userId,
        fixed_expense_id: ids.fixed,
        occurrence_date: "2033-08-15",
        kind: "expense",
        mode: "auto",
        expected_amount: 999999,
        currency: "EUR",
        status: "pending",
        fixed_expense_regime: 1,
        fixed_expense_cadence: "yearly",
      })
      .select(
        "mode, expected_amount, currency, fixed_expense_regime, fixed_expense_cadence",
      )
      .single();
  check(
    "K63 · el trigger de alta toma la foto vigente bajo lock: ningún caller puede forjar monto/moneda/régimen/cadencia de un ciclo nuevo",
    !normalizedOccurrenceError &&
      normalizedOccurrence?.mode === "ask" &&
      cents(normalizedOccurrence?.expected_amount) ===
        cents(liveForecastForOccurrence?.planning_amount) &&
      normalizedOccurrence?.currency === liveForecastForOccurrence?.currency &&
      normalizedOccurrence?.fixed_expense_regime ===
        liveForecastForOccurrence?.regime &&
      normalizedOccurrence?.fixed_expense_cadence ===
        liveForecastForOccurrence?.cadence,
    JSON.stringify({
      error: normalizedOccurrenceError?.message,
      occurrence: normalizedOccurrence,
      forecast: liveForecastForOccurrence,
    }),
  );

  const pauseRetiredOccurrence = await occurrence("2034-01-15");
  const explicitlyDismissedOccurrence = await occurrence("2034-02-15");
  const { error: explicitDismissError } = await admin
    .from("recurring_occurrences")
    .update({ status: "dismissed" })
    .eq("id", explicitlyDismissedOccurrence.id)
    .eq("user_id", userId);
  const { error: pausePlanError } = await admin
    .from("fixed_expenses")
    .update({ is_active: false })
    .eq("id", ids.fixed)
    .eq("user_id", userId);
  const pauseRetired = await one(
    "recurring_occurrences",
    "status, fixed_expense_retired_by_plan",
    "id",
    pauseRetiredOccurrence.id,
  );
  const explicitAfterPause = await one(
    "recurring_occurrences",
    "status, fixed_expense_retired_by_plan",
    "id",
    explicitlyDismissedOccurrence.id,
  );
  const { error: resumePlanError } = await admin
    .from("fixed_expenses")
    .update({ is_active: true })
    .eq("id", ids.fixed)
    .eq("user_id", userId);
  const pauseReopened = await one(
    "recurring_occurrences",
    "status, fixed_expense_retired_by_plan",
    "id",
    pauseRetiredOccurrence.id,
  );
  const explicitAfterResume = await one(
    "recurring_occurrences",
    "status, fixed_expense_retired_by_plan",
    "id",
    explicitlyDismissedOccurrence.id,
  );
  check(
    "K64 · pausar y reactivar antes del vencimiento revive solo el aviso retirado por el plan; un dismiss explícito sigue cerrado",
    !explicitDismissError &&
      !pausePlanError &&
      pauseRetired?.status === "dismissed" &&
      pauseRetired?.fixed_expense_retired_by_plan === true &&
      explicitAfterPause?.status === "dismissed" &&
      explicitAfterPause?.fixed_expense_retired_by_plan === false &&
      !resumePlanError &&
      pauseReopened?.status === "pending" &&
      pauseReopened?.fixed_expense_retired_by_plan === false &&
      explicitAfterResume?.status === "dismissed" &&
      explicitAfterResume?.fixed_expense_retired_by_plan === false,
    JSON.stringify({
      explicitDismissError: explicitDismissError?.message,
      pausePlanError: pausePlanError?.message,
      resumePlanError: resumePlanError?.message,
      pauseRetired,
      explicitAfterPause,
      pauseReopened,
      explicitAfterResume,
    }),
  );

  // ACL is checked by catalog via the anon client rather than relying on a
  // browser session. A public/anon RPC must be denied.
  const anon = createClient(
    URL_,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const { error: anonRpcError } = await anon.rpc(
    "kipu_record_variable_fixed_observation",
    { p: {} },
  );
  check(
    "K16 · la RPC no es ejecutable por anon",
    !!anonRpcError && /permission denied/i.test(anonRpcError.message),
    anonRpcError?.message ?? "la llamada anon no fue rechazada",
  );
  const authenticated = createClient(
    URL_,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const { error: authSignInError } =
    await authenticated.auth.signInWithPassword({ email, password });
  if (authSignInError) throw new Error(`signIn E2E: ${authSignInError.message}`);
  const { data: ownObservations, error: ownReadError } = await authenticated
    .from("fixed_expense_observations")
    .select("id")
    .eq("user_id", userId);
  const { error: forbiddenWrite } = await authenticated
    .from("fixed_expense_forecasts")
    .update({ planning_amount: 999999 })
    .eq("fixed_expense_id", ids.fixed);
  const { error: authenticatedHardDelete } = await authenticated
    .from("fixed_expenses")
    .delete()
    .eq("id", ids.fixed);
  const { error: authenticatedRpcError } = await authenticated.rpc(
    "kipu_record_variable_fixed_observation",
    { p: {} },
  );
  const { error: completedRetryResetError } = await authenticated.rpc(
    "kipu_reset_incomplete_onboarding_fixed_expenses",
    { p_user: userId },
  );
  const { error: reopenCompletedError } = await authenticated
    .from("profiles")
    .update({ onboarding_completed: false })
    .eq("id", userId);
  const completedProfile = await one(
    "profiles",
    "onboarding_completed",
    "id",
    userId,
  );
  check(
    "K17 · authenticated ve SU historia pero no puede escribirla ni ejecutar la RPC",
    !ownReadError &&
      (ownObservations?.length ?? 0) > 0 &&
      !!forbiddenWrite &&
      !!authenticatedHardDelete &&
      !!authenticatedRpcError &&
      /permission denied/i.test(authenticatedRpcError.message),
    JSON.stringify({
      ownReadError: ownReadError?.message,
      rows: ownObservations?.length,
      forbiddenWrite: forbiddenWrite?.message,
      hardDelete: authenticatedHardDelete?.message,
      rpc: authenticatedRpcError?.message,
    }),
  );
  check(
    "K66 · el reset privilegiado no convierte un onboarding terminado en permiso para borrar sus fijos",
    !!completedRetryResetError &&
      /completed onboarding fixed expenses cannot be reset/i.test(
        completedRetryResetError.message,
      ) &&
      (await count("fixed_expenses", "id", ids.fixed)) === 1,
    completedRetryResetError?.message ??
      "el reset de un onboarding terminado no fue rechazado",
  );
  check(
    "K68 · ni el usuario ni service_role pueden reabrir un onboarding terminado para fabricar permiso de borrado",
    !!reopenCompletedError &&
      /completed onboarding cannot be reopened/i.test(
        reopenCompletedError.message,
      ) &&
      completedProfile?.onboarding_completed === true,
    JSON.stringify({
      reopen: reopenCompletedError?.message,
      completed: completedProfile?.onboarding_completed,
    }),
  );
  check(
    "K31 · authenticated no puede borrar físicamente el plan y llevarse en cascada su historia",
    !!authenticatedHardDelete &&
      /permission denied/i.test(authenticatedHardDelete.message) &&
      (await count(
        "fixed_expense_observations",
        "fixed_expense_id",
        ids.fixed,
      )) > 0,
    authenticatedHardDelete?.message ?? "el DELETE no fue rechazado",
  );
  await authenticated.auth.signOut();

  const planningBeforeRawWrite = cents(
    (
      await one(
        "fixed_expense_forecasts",
        "planning_amount",
        "fixed_expense_id",
        ids.fixed,
      )
    )?.planning_amount,
  );
  const { error: serviceRawWrite } = await admin
    .from("fixed_expense_forecasts")
    .update({ planning_amount: 999999 })
    .eq("fixed_expense_id", ids.fixed);
  const { error: serviceHardDelete } = await admin
    .from("fixed_expenses")
    .delete()
    .eq("id", ids.fixed);
  check(
    "K28 · ni service_role puede saltarse el writer canónico con un UPDATE crudo de lo aprendido",
    !!serviceRawWrite &&
      /permission denied/i.test(serviceRawWrite.message) &&
      cents(
        (
          await one(
            "fixed_expense_forecasts",
            "planning_amount",
            "fixed_expense_id",
            ids.fixed,
          )
        )?.planning_amount,
      ) === planningBeforeRawWrite,
    JSON.stringify({
      error: serviceRawWrite?.message,
      planningBeforeRawWrite,
    }),
  );
  check(
    "K32 · service_role tampoco puede saltarse el retiro lógico y borrar el plan/historia con DELETE crudo",
    !!serviceHardDelete &&
      /permission denied/i.test(serviceHardDelete.message) &&
      (await count("fixed_expenses", "id", ids.fixed)) === 1 &&
      (await count(
        "fixed_expense_observations",
        "fixed_expense_id",
        ids.fixed,
      )) > 0,
    serviceHardDelete?.message ?? "el DELETE no fue rechazado",
  );

  const resetEmail = `kipu-k-reset-${Date.now()}@example.invalid`;
  const resetPassword = `Kipu-K-reset-${Date.now()}-Aa1!`;
  const { data: resetAuth, error: resetAuthError } =
    await admin.auth.admin.createUser({
      email: resetEmail,
      password: resetPassword,
      email_confirm: true,
      user_metadata: { kipu_smoke: true },
    });
  if (resetAuthError) {
    throw new Error(`reset createUser: ${resetAuthError.message}`);
  }
  const resetUserId = resetAuth.user.id;
  disposableUserIds.push(resetUserId);
  const { error: resetProfileError } = await admin.from("profiles").upsert({
    id: resetUserId,
    base_currency: "USD",
    onboarding_completed: false,
  });
  if (resetProfileError) {
    throw new Error(`reset profile: ${resetProfileError.message}`);
  }
  const { data: resetFixed, error: resetFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: resetUserId,
      name: "Borrador K incompleto",
      amount: 25,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 12,
      is_variable: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (resetFixedError) {
    throw new Error(`reset fixed: ${resetFixedError.message}`);
  }
  const { data: resetOccurrence, error: resetOccurrenceError } = await admin
    .from("recurring_occurrences")
    .insert({
      user_id: resetUserId,
      fixed_expense_id: resetFixed.id,
      occurrence_date: "2030-01-12",
      kind: "expense",
      mode: "ask",
      expected_amount: 25,
      currency: "USD",
      status: "pending",
    })
    .select("id")
    .single();
  if (resetOccurrenceError) {
    throw new Error(`reset occurrence: ${resetOccurrenceError.message}`);
  }
  const resetClient = createClient(
    URL_,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const { error: resetSignInError } =
    await resetClient.auth.signInWithPassword({
      email: resetEmail,
      password: resetPassword,
    });
  if (resetSignInError) {
    throw new Error(`reset signIn: ${resetSignInError.message}`);
  }
  const { data: resetDeleted, error: resetIncompleteError } =
    await resetClient.rpc(
      "kipu_reset_incomplete_onboarding_fixed_expenses",
      { p_user: resetUserId },
    );
  await resetClient.auth.signOut();
  check(
    "K67 · un retry realmente incompleto limpia solo su borrador y su pending vacío por el writer estrecho",
    !resetIncompleteError &&
      Number(resetDeleted) === 1 &&
      (await count("fixed_expenses", "user_id", resetUserId)) === 0 &&
      (await count("recurring_occurrences", "id", resetOccurrence.id)) === 0 &&
      (await count(
        "fixed_expense_observations",
        "user_id",
        resetUserId,
      )) === 0 &&
      (await count(
        "fixed_expense_forecasts",
        "user_id",
        resetUserId,
      )) === 0,
    JSON.stringify({
      reset: resetIncompleteError?.message,
      deleted: resetDeleted,
    }),
  );

  const historyEmail = `kipu-k-history-${Date.now()}@example.invalid`;
  const historyPassword = `Kipu-K-history-${Date.now()}-Aa1!`;
  const { data: historyAuth, error: historyAuthError } =
    await admin.auth.admin.createUser({
      email: historyEmail,
      password: historyPassword,
      email_confirm: true,
      user_metadata: { kipu_smoke: true },
    });
  if (historyAuthError) {
    throw new Error(`history createUser: ${historyAuthError.message}`);
  }
  const historyUserId = historyAuth.user.id;
  disposableUserIds.push(historyUserId);
  const { error: historyProfileError } = await admin.from("profiles").upsert({
    id: historyUserId,
    base_currency: "USD",
    onboarding_completed: false,
  });
  if (historyProfileError) {
    throw new Error(`history profile: ${historyProfileError.message}`);
  }
  const { data: historyAccount, error: historyAccountError } = await admin
    .from("accounts")
    .insert({
      user_id: historyUserId,
      name: "Cuenta K con historia",
      type: "bank",
      currency: "USD",
      current_balance_original: 100,
      current_balance_base: 100,
    })
    .select("id")
    .single();
  if (historyAccountError) {
    throw new Error(`history account: ${historyAccountError.message}`);
  }
  const { data: historyFixed, error: historyFixedError } = await admin
    .from("fixed_expenses")
    .insert({
      user_id: historyUserId,
      name: "Fijo K con historia",
      amount: 10,
      currency: "USD",
      category: "utilities",
      frequency: "monthly",
      expected_day: 10,
      payment_source_type: "account",
      payment_source_id: historyAccount.id,
      is_variable: false,
      is_active: true,
    })
    .select("id")
    .single();
  if (historyFixedError) {
    throw new Error(`history fixed: ${historyFixedError.message}`);
  }
  const crossOwnerOccurrenceDate = "2035-01-10";
  const { error: crossOwnerOccurrenceError } = await admin
    .from("recurring_occurrences")
    .insert({
      user_id: userId,
      fixed_expense_id: historyFixed.id,
      occurrence_date: crossOwnerOccurrenceDate,
      kind: "expense",
      mode: "ask",
      expected_amount: 10,
      currency: "USD",
      status: "pending",
    });
  const { count: crossOwnerOccurrenceCount, error: crossOwnerCountError } =
    await admin
      .from("recurring_occurrences")
      .select("*", { head: true, count: "exact" })
      .eq("user_id", userId)
      .eq("fixed_expense_id", historyFixed.id)
      .eq("occurrence_date", crossOwnerOccurrenceDate);
  check(
    "K73 · una ocurrencia no puede enlazar el fijo de otro usuario",
    !!crossOwnerOccurrenceError &&
      !crossOwnerCountError &&
      crossOwnerOccurrenceCount === 0,
    JSON.stringify({
      error: crossOwnerOccurrenceError?.message,
      countError: crossOwnerCountError?.message,
      count: crossOwnerOccurrenceCount,
    }),
  );
  const historyTx = await applyLedgerEntry(admin, {
    userId: historyUserId,
    type: "expense",
    effectType: "expense",
    category: "utilities",
    description: "Fijo K ya pagado",
    originalAmount: 10,
    originalCurrency: "USD",
    baseAmount: 10,
    baseCurrency: "USD",
    exchangeRateToBase: 1,
    sourceAccountId: historyAccount.id,
    recurringExpenseId: historyFixed.id,
    occurredAtISO: "2026-07-10T12:00:00.000Z",
    inputChannel: "web",
    dedupeKey: `k:history:${historyUserId}`,
  });
  const { data: historyResetDeleted, error: historyResetError } =
    await admin.rpc("kipu_reset_incomplete_onboarding_fixed_expenses", {
      p_user: historyUserId,
    });
  check(
    "K69 · onboarding incompleto tampoco autoriza borrar un fijo que ya produjo dinero o historia",
    !!historyResetError &&
      /with financial history cannot be reset/i.test(historyResetError.message) &&
      historyResetDeleted == null &&
      (await count("fixed_expenses", "id", historyFixed.id)) === 1 &&
      (await count("transactions", "id", historyTx)) === 1 &&
      cents(
        (
          await one(
            "accounts",
            "current_balance_original",
            "id",
            historyAccount.id,
          )
        )?.current_balance_original,
      ) === 90,
    JSON.stringify({
      reset: historyResetError?.message,
      deleted: historyResetDeleted,
      historyTx,
    }),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  failed.push(migrationMissing ? "MIGRACIÓN 093 NO APLICADA" : "HARNESS ABORTÓ");
  console.error(`ABORT · ${message}`);
} finally {
  for (const disposableUserId of [...disposableUserIds].reverse()) {
    const { error } = await admin.auth.admin.deleteUser(disposableUserId);
    if (error) {
      failed.push("limpieza auth");
      console.error(`cleanup auth ${disposableUserId}: ${error.message}`);
    }
    const residueTables = [
      ["profiles", "id"],
      ["accounts", "user_id"],
      ["fixed_expenses", "user_id"],
      ["fixed_expense_payment_applications", "user_id"],
      ["recurring_occurrences", "user_id"],
      ["transactions", "user_id"],
      ...(!migrationMissing
        ? [
            ["fixed_expense_forecasts", "user_id"],
            ["fixed_expense_observations", "user_id"],
            ["fixed_expense_observation_operations", "user_id"],
          ]
        : []),
    ];
    for (const [table, ownerColumn] of residueTables) {
      try {
        const left = await count(table, ownerColumn, disposableUserId);
        if (left !== 0) {
          failed.push(`residuo ${table}`);
          console.error(`RESIDUO · ${table}: ${left}`);
        }
      } catch (error) {
        failed.push(`limpieza ilegible ${table}`);
        console.error(
          `LIMPIEZA ILEGIBLE · ${table}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

if (executedChecks !== EXPECTED_CHECKS) {
  failed.push(`cobertura incompleta ${executedChecks}/${EXPECTED_CHECKS}`);
  console.error(
    `COBERTURA INCOMPLETA · se ejecutaron ${executedChecks}/${EXPECTED_CHECKS} checks`,
  );
}
console.log(`\nBloque K E2E: ${passed}/${EXPECTED_CHECKS}`);
if (failed.length > 0) {
  console.error(`fallan: ${[...new Set(failed)].join(" · ")}`);
  process.exitCode = 1;
}
