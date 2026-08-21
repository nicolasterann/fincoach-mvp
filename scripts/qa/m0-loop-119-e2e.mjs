// M0 1AH — migration 119 disposable PostgreSQL probes.
// Run only after 119 is approved and applied:
//   node --env-file=.env.local ./scripts/qa/m0-loop-119-e2e.mjs

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
const { debtPaymentPlanRpcReason, setDebtPaymentPlanState } = await import(
  "@/lib/financial/debt-payment-plan-store"
);

let userId = null;
let passed = 0;
let executed = 0;
const failures = [];
const touched = [
  ["transactions", "user_id"],
  ["recurring_occurrences", "user_id"],
  ["debt_accounts", "user_id"],
  ["accounts", "user_id"],
  ["profiles", "id"],
];

function boundedError(error) {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack?.split("\n", 1)[0] ?? error.name };
  }
  const row = error && typeof error === "object" ? error : {};
  return {
    code: typeof row.code === "string" ? row.code : null,
    message: typeof row.message === "string" ? row.message : String(error),
    details: typeof row.details === "string" ? row.details : null,
    hint: typeof row.hint === "string" ? row.hint : null,
  };
}

function errorText(error) {
  return JSON.stringify(boundedError(error));
}

function must(result, label) {
  if (result?.error) throw new Error(`${label}: ${errorText(result.error)}`);
  return result.data;
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

async function stateRpc(debtAccountId, action) {
  return admin.rpc("kipu_set_debt_payment_plan_state", {
    p: { user_id: userId, debt_account_id: debtAccountId, action },
  });
}

try {
  const created = await admin.auth.admin.createUser({
    email: `m119-${Date.now()}@example.invalid`,
    password: `M119-${Date.now()}-Aa1!`,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`create disposable user: ${errorText(created.error)}`);
  }
  userId = created.data.user.id;
  must(
    await admin.from("profiles").upsert({ id: userId, base_currency: "USD" }),
    "seed profile",
  );
  const loan = must(
    await admin
      .from("debt_accounts")
      .insert({
        user_id: userId,
        name: "Alpaca M119",
        type: "loan",
        currency: "USD",
        current_balance_original: 3004.98,
        current_balance_base: 3004.98,
        minimum_payment: 125,
        full_payment_due: 125,
        due_day: 15,
        status: "active",
      })
      .select("id,current_balance_original,current_balance_base,minimum_payment,full_payment_due,debt_payment_plan_paused")
      .single(),
    "seed loan",
  );
  const card = must(
    await admin
      .from("debt_accounts")
      .insert({
        user_id: userId,
        name: "Card M119",
        type: "credit_card",
        currency: "USD",
        current_balance_original: 50,
        current_balance_base: 50,
        due_day: 20,
        status: "active",
      })
      .select("id")
      .single(),
    "seed card",
  );
  const inactiveLoan = must(
    await admin
      .from("debt_accounts")
      .insert({
        user_id: userId,
        name: "Closed Alpaca M119",
        type: "loan",
        currency: "USD",
        current_balance_original: 0,
        current_balance_base: 0,
        minimum_payment: 0,
        full_payment_due: 0,
        due_day: 15,
        status: "closed",
      })
      .select("id,status")
      .single(),
    "seed inactive loan",
  );
  const account = must(
    await admin
      .from("accounts")
      .insert({
        user_id: userId,
        name: "Cuenta M119",
        type: "bank",
        currency: "USD",
        current_balance_original: 500,
        current_balance_base: 500,
        is_currency_default: false,
      })
      .select("id")
      .single(),
    "seed account",
  );
  const bookedTransactionId = String(
    must(
      await admin.rpc("kipu_apply_ledger_entry", {
        p_entry: {
          user_id: userId,
          type: "debt_payment",
          effect_type: "debt_payment",
          sign: 1,
          description: "Pago previo M119",
          category: "debt",
          original_amount: 125,
          original_currency: "USD",
          exchange_rate_to_base: 1,
          base_amount: 125,
          base_currency: "USD",
          source_account_id: account.id,
          debt_account_id: loan.id,
          raw_input: "fixture M119",
          input_channel: "chat",
          occurred_at: "2026-08-15T12:00:00.000Z",
          dedupe_key: `m119-booked:${userId}`,
        },
      }),
      "seed booked ledger transaction",
    ),
  );
  const occurrences = must(
    await admin
      .from("recurring_occurrences")
      .insert([
        {
          user_id: userId,
          debt_account_id: loan.id,
          occurrence_date: "2026-09-15",
          kind: "debt_payment",
          mode: "ask",
          status: "pending",
          expected_amount: 125,
          currency: "USD",
        },
        {
          user_id: userId,
          debt_account_id: loan.id,
          occurrence_date: "2026-08-15",
          kind: "debt_payment",
          mode: "auto",
          status: "booked",
          expected_amount: 125,
          currency: "USD",
          created_transaction_id: bookedTransactionId,
        },
      ])
      .select("id,status,created_transaction_id,occurrence_date"),
    "seed occurrences",
  ).sort((left, right) =>
    String(left.occurrence_date).localeCompare(String(right.occurrence_date)),
  );
  const loanBeforePause = must(
    await admin
      .from("debt_accounts")
      .select("current_balance_original,current_balance_base,minimum_payment,full_payment_due")
      .eq("id", loan.id)
      .single(),
    "loan before pause",
  );

  const paused = must(await stateRpc(loan.id, "pause"), "pause loan plan");
  const [loanAfterPauseResult, occurrencesAfterPauseResult, txCountResult] = await Promise.all([
    admin
      .from("debt_accounts")
      .select("current_balance_original,current_balance_base,minimum_payment,full_payment_due,debt_payment_plan_paused,debt_payment_plan_paused_at")
      .eq("id", loan.id)
      .single(),
    admin
      .from("recurring_occurrences")
      .select("id,status,created_transaction_id")
      .eq("user_id", userId)
      .eq("debt_account_id", loan.id)
      .order("occurrence_date"),
    admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);
  const loanAfterPause = must(loanAfterPauseResult, "loan after pause");
  const occurrencesAfterPause = must(occurrencesAfterPauseResult, "occurrences after pause");
  if (txCountResult.error || txCountResult.count == null) {
    throw new Error(`transaction count: ${errorText(txCountResult.error ?? { message: "count null" })}`);
  }
  check(
    "M119.1 · pausa conserva deuda/ledger y descarta sólo ocurrencia futura no bookeada",
    paused.outcome === "updated" &&
      paused.debt_payment_plan_paused === true &&
      paused.moved_money === false &&
      paused.dismissed_occurrence_count === 1 &&
      loanAfterPause.debt_payment_plan_paused === true &&
      loanAfterPause.debt_payment_plan_paused_at != null &&
      Number(loanAfterPause.current_balance_original) === Number(loanBeforePause.current_balance_original) &&
      Number(loanAfterPause.current_balance_base) === Number(loanBeforePause.current_balance_base) &&
      Number(loanAfterPause.minimum_payment) === Number(loanBeforePause.minimum_payment) &&
      Number(loanAfterPause.full_payment_due) === Number(loanBeforePause.full_payment_due) &&
      occurrencesAfterPause[0]?.status === "booked" &&
      occurrencesAfterPause[0]?.created_transaction_id === occurrences[0]?.created_transaction_id &&
      occurrencesAfterPause[1]?.status === "dismissed" &&
      txCountResult.count === 1,
    JSON.stringify({ paused, loanAfterPause, occurrencesAfterPause, transactionCount: txCountResult.count }),
  );

  const replay = must(await stateRpc(loan.id, "pause"), "pause replay");
  const resumed = must(await stateRpc(loan.id, "resume"), "resume loan plan");
  const loanAfterResume = must(
    await admin
      .from("debt_accounts")
      .select("debt_payment_plan_paused,debt_payment_plan_paused_at,current_balance_original")
      .eq("id", loan.id)
      .single(),
    "loan after resume",
  );
  check(
    "M119.2 · replay exacto es noop y resume no reabre ocurrencias históricas ni mueve dinero",
    replay.outcome === "replayed" &&
      replay.debt_payment_plan_paused === true &&
      replay.dismissed_occurrence_count === 0 &&
      resumed.outcome === "updated" &&
      resumed.debt_payment_plan_paused === false &&
      resumed.moved_money === false &&
      loanAfterResume.debt_payment_plan_paused === false &&
      loanAfterResume.debt_payment_plan_paused_at == null &&
      Number(loanAfterResume.current_balance_original) === Number(loanBeforePause.current_balance_original) &&
      occurrencesAfterPause[1]?.status === "dismissed",
    JSON.stringify({ replay, resumed, loanAfterResume }),
  );

  const cardPause = await stateRpc(card.id, "pause");
  const foreignPause = await admin.rpc("kipu_set_debt_payment_plan_state", {
    p: {
      user_id: "11111111-1111-4111-8111-111111111111",
      debt_account_id: loan.id,
      action: "pause",
    },
  });
  check(
    "M119.3 · tarjeta y ownership ajeno rehúsan fail-closed",
    Boolean(cardPause.error?.message?.includes("KIPU_VALIDATION")) &&
      Boolean(foreignPause.error?.message?.includes("KIPU_OWNERSHIP")),
    JSON.stringify({ cardPause: boundedError(cardPause.error), foreignPause: boundedError(foreignPause.error) }),
  );

  const inactiveRaw = await stateRpc(inactiveLoan.id, "pause");
  const inactiveWrapped = await setDebtPaymentPlanState({
    userId,
    debtAccountId: inactiveLoan.id,
    action: "pause",
  });
  check(
    "M119.4 · deuda inactiva rehúsa sin SQLSTATE reintentable y el wrapper conserva conflict tipado",
    inactiveRaw.data == null &&
      inactiveRaw.error?.code === "22023" &&
      inactiveRaw.error?.code !== "40001" &&
      debtPaymentPlanRpcReason(inactiveRaw.error) === "conflict" &&
      inactiveWrapped.ok === false &&
      inactiveWrapped.reason === "conflict",
    JSON.stringify({
      raw: boundedError(inactiveRaw.error),
      classified: debtPaymentPlanRpcReason(inactiveRaw.error ?? {}),
      wrapped: inactiveWrapped,
    }),
  );
} catch (error) {
  failures.push("ABORT");
  console.error(errorText(error));
} finally {
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) failures.push(`cleanup auth: ${errorText(deleted.error)}`);
    for (const [table, column] of touched) {
      const { count, error } = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, userId);
      if (error || count == null) {
        failures.push(`LIMPIEZA ILEGIBLE · ${table}: ${errorText(error ?? { message: "count null" })}`);
      } else if (count !== 0) {
        failures.push(`RESIDUO · ${table}.${column}: ${count}`);
      }
    }
  }
}

console.log(`M119 PostgreSQL probes: ${passed}/${executed}`);
if (failures.length > 0 || passed !== 4 || executed !== 4) {
  if (executed !== 4) failures.push(`COBERTURA INCOMPLETA ${executed}/4`);
  console.error(`FAILURES: ${failures.join(" | ") || "unknown"}`);
  process.exitCode = 1;
}
