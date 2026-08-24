// M0-AM migration 124 disposable PostgreSQL probes (goal funding account).
// Run after applying 124:
//   node --env-file=.env.local ./scripts/qa/m0-loop-124-e2e.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("HARNESS_ENV/MISSING_SUPABASE_CREDENTIALS");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let userId = null;
let passed = 0;
let executed = 0;
const failures = [];
const touched = [
  ["goals", "user_id"],
  ["accounts", "user_id"],
  ["profiles", "id"],
];

function bounded(error) {
  const row = error && typeof error === "object" ? error : {};
  return {
    code: typeof row.code === "string" ? row.code : null,
    message: typeof row.message === "string" ? String(row.message).slice(0, 260) : String(error).slice(0, 260),
  };
}

function must(result, label) {
  if (result?.error) throw new Error(`${label}: ${JSON.stringify(bounded(result.error))}`);
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

const EXPECTED = 7;

async function insertAccount(name, currency) {
  return must(
    await admin
      .from("accounts")
      .insert({
        user_id: userId,
        name,
        type: "bank",
        currency,
        current_balance_original: 0,
        current_balance_base: 0,
        is_goal_account: false,
      })
      .select("id")
      .single(),
    `account ${name}`,
  );
}

function goalRow(name, currency, extra = {}) {
  return {
    user_id: userId,
    name,
    target_amount: 1000,
    current_amount: 0,
    currency,
    target_date: null,
    status: "active",
    feasibility_status: "viable",
    weekly_required_amount: 0,
    monthly_required_amount: 0,
    ...extra,
  };
}

try {
  const created = must(
    await admin.auth.admin.createUser({
      email: `kipu-m124-${Date.now()}-${randomUUID()}@example.invalid`,
      email_confirm: true,
      user_metadata: { kipu_m124_probe: true },
    }),
    "create disposable user",
  );
  userId = created.user.id;
  must(await admin.from("profiles").upsert({ id: userId, base_currency: "USD", onboarding_completed: true }), "profile");

  const usd = await insertAccount("Wells M124", "USD");
  const eur = await insertAccount("Euro M124", "EUR");
  const spareUsd = await insertAccount("Spare M124", "USD");

  // M124.1 · el fondeo declarado ATERRIZA cuando la moneda coincide
  const funded = must(
    await admin
      .from("goals")
      .insert(goalRow("Meta fondeada M124", "USD", { funding_account_id: usd.id }))
      .select("id,funding_account_id")
      .single(),
    "insert funded goal",
  );
  check(
    "M124.1 · una meta USD con fondeo desde una cuenta USD aterriza con la columna escrita",
    funded.funding_account_id === usd.id,
    JSON.stringify(funded),
  );

  // M124.2 · el trigger REHÚSA fondear una meta desde otra moneda (INSERT)
  const mismatchInsert = await admin
    .from("goals")
    .insert(goalRow("Meta EUR M124", "EUR", { funding_account_id: usd.id }))
    .select("id")
    .single();
  check(
    "M124.2 · fondear una meta EUR desde una cuenta USD se rehúsa en el INSERT (KIPU_VALIDATION funded)",
    Boolean(mismatchInsert.error) && /cannot be funded from an account/.test(String(mismatchInsert.error?.message ?? "")),
    JSON.stringify(bounded(mismatchInsert.error ?? { message: "insert landed" })),
  );

  // M124.3 · el trigger REHÚSA el mismo cruce por UPDATE
  const mismatchUpdate = await admin
    .from("goals")
    .update({ funding_account_id: eur.id })
    .eq("id", funded.id)
    .eq("user_id", userId)
    .select("id");
  check(
    "M124.3 · mover el fondeo de una meta USD a una cuenta EUR se rehúsa en el UPDATE",
    Boolean(mismatchUpdate.error) && /cannot be funded from an account/.test(String(mismatchUpdate.error?.message ?? "")),
    JSON.stringify(bounded(mismatchUpdate.error ?? { message: "update landed" })),
  );

  // M124.4 · la rama ORIGINAL (goal_account_id) sigue viva en el mismo trigger
  const linkedUpdate = await admin
    .from("goals")
    .update({ goal_account_id: eur.id })
    .eq("id", funded.id)
    .eq("user_id", userId)
    .select("id");
  check(
    "M124.4 · vincular goal_account_id en otra moneda sigue rehusándose (rama original intacta)",
    Boolean(linkedUpdate.error) && /cannot be linked to an account/.test(String(linkedUpdate.error?.message ?? "")),
    JSON.stringify(bounded(linkedUpdate.error ?? { message: "update landed" })),
  );

  // M124.5 · la cuenta de fondeo entra al helper de dependencias: su moneda es
  // INMUTABLE también por UPDATE directo (guard de accounts, doctrina 073)
  const wiredCurrency = await admin
    .from("accounts")
    .update({ currency: "EUR" })
    .eq("id", usd.id)
    .eq("user_id", userId)
    .select("id");
  check(
    "M124.5 · cambiar la moneda de la cuenta que fondea una meta se rehúsa (wired to a goal)",
    Boolean(wiredCurrency.error) && /is wired to a goal/.test(String(wiredCurrency.error?.message ?? "")),
    JSON.stringify(bounded(wiredCurrency.error ?? { message: "update landed" })),
  );

  // M124.6 · contrafactual: la MISMA operación sobre una cuenta sin vínculo,
  // sin movimientos y en cero SÍ pasa — el bloqueo de M124.5 es la dependencia
  const freeCurrency = await admin
    .from("accounts")
    .update({ currency: "EUR" })
    .eq("id", spareUsd.id)
    .eq("user_id", userId)
    .select("id,currency")
    .single();
  check(
    "M124.6 · la cuenta gemela sin vínculo cambia de moneda: el guard es la dependencia, no un cerrojo",
    !freeCurrency.error && freeCurrency.data?.currency === "EUR",
    JSON.stringify(freeCurrency.error ? bounded(freeCurrency.error) : freeCurrency.data),
  );

  // M124.7 · ON DELETE SET NULL: borrar la cuenta de fondeo degrada, no bloquea
  must(await admin.from("accounts").delete().eq("id", usd.id).eq("user_id", userId), "delete funding account");
  const orphaned = must(
    await admin.from("goals").select("id,funding_account_id,status").eq("id", funded.id).single(),
    "reread funded goal",
  );
  check(
    "M124.7 · borrar la cuenta de fondeo deja la meta viva con funding_account_id NULL (cero clase 091)",
    orphaned.funding_account_id === null && orphaned.status === "active",
    JSON.stringify(orphaned),
  );
} catch (error) {
  failures.push("ABORT");
  console.error(JSON.stringify(bounded(error)));
} finally {
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) failures.push(`cleanup auth: ${JSON.stringify(bounded(deleted.error))}`);
    for (const [table, identityColumn] of touched) {
      const read = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(identityColumn, userId);
      if (read.error || read.count == null) {
        failures.push(`LIMPIEZA ILEGIBLE · ${table}: ${JSON.stringify(bounded(read.error ?? { message: "count null" }))}`);
      } else if (read.count !== 0) {
        failures.push(`RESIDUO · ${table}: ${read.count}`);
      }
    }
  }
}

console.log(`M124 PostgreSQL probes: ${passed}/${executed}`);
if (failures.length > 0 || passed !== EXPECTED || executed !== EXPECTED) {
  if (executed !== EXPECTED) failures.push(`COBERTURA INCOMPLETA ${executed}/${EXPECTED}`);
  console.error(`FAILURES: ${failures.join(" | ") || "unknown"}`);
  process.exitCode = 1;
}
