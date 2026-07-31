// Pre-M backend closure — disposable-persona E2E against real PostgreSQL.
//
// Run only AFTER migrations 096, 097, 098 and 099 are applied:
//   node --env-file=.env.local ./scripts/qa/pre-m-backend-e2e.mjs
//
// Exercises the boundaries review cannot prove: authenticated lateral writes,
// native/base ledger effects, close/reopen replay, a five-day calendar gap,
// stale FX valuation and the real H.44/H.46 executors. Cleanup/read failure is
// fatal and the disposable auth user must leave zero residue.

import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
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
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRK) {
  throw new Error(
    "faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY",
  );
}

const admin = createClient(URL_, SRK, { auth: { persistSession: false } });
const authenticated = createClient(URL_, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const {
  closeAccountAtomically,
  closeDebtAccountAtomically,
  createAccountIdempotently,
  reopenAccountAtomically,
  reconcileNativeAccountBalance,
  updateAccountName,
  applyInstallmentPlanPurchase,
  closeInstallmentPlanAtomically,
} = await import("@/lib/ai/apply-chat-transaction-intent");
const {
  executeCreateInstallmentPlanWith,
  executeCloseInstallmentPlanWith,
} = await import("@/lib/ai/agent/kipu-agent-tools");
const {
  readActiveInstallmentPlans,
} = await import("@/lib/financial/installment-plans-store");
const {
  buildCoachingBriefingWith,
  KipuSaldoUnavailableError,
} = await import("@/lib/financial/coaching-signals");
const {
  buildUserFinancialContext,
} = await import("@/lib/financial/user-financial-context-builder");
const {
  runDueRecurringMaterializations,
} = await import("@/lib/scheduled/recurring-materializer");

let executed = 0;
let passed = 0;
const failures = [];
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
function must(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
function cents(value) {
  return Math.round(Number(value) * 100) / 100;
}
async function accountRow(id) {
  return must(
    await admin
      .from("accounts")
      .select("name, status, current_balance_original, current_balance_base")
      .eq("id", id)
      .single(),
    "account row",
  );
}
async function countRows(table, column, value) {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value);
  if (error || count == null) {
    throw new Error(`${table} residue unreadable: ${error?.message ?? "null count"}`);
  }
  return count;
}

let userId = null;
const EXPECTED = 40;
try {
  const email = `kipu-pre-m-${Date.now()}@example.invalid`;
  const created = must(
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { kipu_smoke: true },
    }),
    "create user",
  );
  userId = created.user.id;
  must(
    await admin.from("profiles").upsert({
      id: userId,
      base_currency: "USD",
      onboarding_completed: true,
    }),
    "profile",
  );
  must(
    await admin.from("user_engagement").upsert({
      user_id: userId,
      timezone: "America/Argentina/Buenos_Aires",
    }),
    "engagement",
  );
  const link = must(
    await admin.auth.admin.generateLink({ type: "magiclink", email }),
    "magic link",
  );
  must(
    await authenticated.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "email",
    }),
    "verify auth",
  );

  const createOperation = `pre-m-create-account:${randomUUID()}`;
  const createdAccount = await createAccountIdempotently({
    userId,
    dedupeKey: createOperation,
    name: "Cuenta Pre-M",
    type: "bank",
    currency: "USD",
    baseCurrency: "USD",
    currentBalanceOriginal: 100,
    currentBalanceBase: 100,
  });
  if (!createdAccount.ok) throw new Error(`account writer: ${createdAccount.reason}`);
  const replayedAccount = await createAccountIdempotently({
    userId,
    dedupeKey: createOperation,
    name: "Cuenta Pre-M",
    type: "bank",
    currency: "USD",
    baseCurrency: "USD",
    currentBalanceOriginal: 100,
    currentBalanceBase: 100,
  });
  const account = { id: createdAccount.accountId };
  check(
    "P0 · alta de cuenta usa identidad durable: redelivery devuelve la misma fila",
    replayedAccount.ok &&
      replayedAccount.replayed &&
      replayedAccount.accountId === account.id &&
      (await countRows("accounts", "user_id", userId)) === 1,
    JSON.stringify({ createdAccount, replayedAccount }),
  );
  const card = must(
    await admin
      .from("debt_accounts")
      .insert({
        user_id: userId,
        name: "Visa Pre-M",
        type: "credit_card",
        currency: "USD",
        current_balance_original: 0,
        current_balance_base: 0,
        full_payment_due: 0,
        statement_total_due: 0,
        cutoff_day: 20,
        due_day: 10,
      })
      .select("id")
      .single(),
    "card",
  );

  const directBalance = await authenticated
    .from("accounts")
    .update({ current_balance_original: 999, current_balance_base: 999 })
    .eq("id", account.id);
  check(
    "P1 · authenticated no puede reescribir un balance por la puerta lateral",
    !!directBalance.error &&
      /typed writer/i.test(directBalance.error.message) &&
      cents((await accountRow(account.id)).current_balance_original) === 100,
    directBalance.error?.message ?? "direct write passed",
  );
  const canonicalExpense = must(
    await admin.rpc("kipu_apply_ledger_entry", {
      p_entry: {
        user_id: userId,
        type: "expense",
        effect_type: "expense",
        sign: 1,
        description: "Control positivo ledger Pre-M",
        category: "food",
        original_amount: 10,
        original_currency: "USD",
        exchange_rate_to_base: 1,
        base_amount: 10,
        base_currency: "USD",
        source_account_id: account.id,
        input_channel: "web",
        raw_input: "control positivo",
        dedupe_key: `pre-m-ledger-positive:${randomUUID()}`,
      },
    }),
    "canonical ledger positive",
  );
  const afterCanonicalExpense = await accountRow(account.id);
  const canonicalReversal = must(
    await admin.rpc("kipu_apply_ledger_entry", {
      p_entry: {
        user_id: userId,
        type: "reversal",
        sign: -1,
        related_transaction_id: canonicalExpense,
        input_channel: "web",
        raw_input: "deshacer control positivo",
      },
    }),
    "canonical ledger reversal",
  );
  check(
    "P1b · el ledger invoker por service_role atraviesa el guard y su reversa restaura",
    typeof canonicalExpense === "string" &&
      typeof canonicalReversal === "string" &&
      cents(afterCanonicalExpense.current_balance_original) === 90 &&
      cents((await accountRow(account.id)).current_balance_original) === 100,
    JSON.stringify({
      canonicalExpense,
      canonicalReversal,
      afterCanonicalExpense,
      afterUndo: await accountRow(account.id),
    }),
  );

  const reconcileOperation = `pre-m-reconcile:${randomUUID()}`;
  const reconciled = await reconcileNativeAccountBalance({
    userId,
    accountId: account.id,
    targetBalanceOriginal: 150,
    exchangeRateToBase: 1,
    baseCurrency: "USD",
    operationId: reconcileOperation,
    message: "persona E2E cuadra la cuenta en 150",
    name: "Cuenta Pre-M renombrada",
    channel: "web",
  });
  const afterReconcile = await accountRow(account.id);
  check(
    "P2 · reconciliación nativa mueve original+base por el writer real",
    reconciled.ok &&
      !reconciled.alreadyMatched &&
      cents(reconciled.deltaOriginal) === 50 &&
      cents(reconciled.deltaBase) === 50 &&
      cents(afterReconcile.current_balance_original) === 150 &&
      cents(afterReconcile.current_balance_base) === 150 &&
      !!reconciled.transactionId,
    JSON.stringify({ reconciled, afterReconcile }),
  );
  const reconciliationMarker = must(
    await admin
      .from("account_balance_reconciliation_applications")
      .select("transaction_id, delta_original, delta_base")
      .eq("user_id", userId)
      .eq("operation_id", reconcileOperation)
      .single(),
    "reconcile marker",
  );
  check(
    "P3 · ledger y marca durable aterrizan juntos",
    reconciliationMarker.transaction_id === reconciled.transactionId &&
      cents(reconciliationMarker.delta_original) === 50 &&
      cents(reconciliationMarker.delta_base) === 50,
    JSON.stringify(reconciliationMarker),
  );
  const replay = await reconcileNativeAccountBalance({
    userId,
    accountId: account.id,
    targetBalanceOriginal: 150,
    exchangeRateToBase: 1,
    baseCurrency: "USD",
    operationId: reconcileOperation,
    message: "redelivery",
    name: "Cuenta Pre-M renombrada",
    channel: "web",
  });
  check(
    "P4 · replay exacto reutiliza la misma transacción sin volver a mover dinero",
    replay.transactionId === reconciled.transactionId &&
      cents((await accountRow(account.id)).current_balance_original) === 150,
    JSON.stringify(replay),
  );
  let mismatchRefused = false;
  try {
    await reconcileNativeAccountBalance({
      userId,
      accountId: account.id,
      targetBalanceOriginal: 151,
      exchangeRateToBase: 1,
      baseCurrency: "USD",
      operationId: reconcileOperation,
      message: "identity mismatch",
      channel: "web",
    });
  } catch (error) {
    mismatchRefused = /DEDUPE_MISMATCH/.test(String(error));
  }
  check(
    "P5 · misma identidad con otro target se rehúsa y conserva el saldo",
    mismatchRefused &&
      cents((await accountRow(account.id)).current_balance_original) === 150,
  );
  const overlongClose = await closeAccountAtomically({
    userId,
    accountId: account.id,
    operationId: "x".repeat(189),
    message: "identidad imposible",
    channel: "web",
  });
  check(
    "P5b · close rehúsa antes de escribir una identidad que su writer anidado no puede representar",
    !overlongClose.ok &&
      overlongClose.reason === "unsafe" &&
      cents((await accountRow(account.id)).current_balance_original) === 150,
    JSON.stringify(overlongClose),
  );

  const closeOperation = `pre-m-close:${randomUUID()}`;
  const closed = await closeAccountAtomically({
    userId,
    accountId: account.id,
    operationId: closeOperation,
    message: "cerrar cuenta pre-m",
    channel: "web",
  });
  const afterClose = await accountRow(account.id);
  check(
    "P6 · cerrar cuenta es ajuste a cero + status en una operación",
    closed.ok &&
      afterClose.status === "closed" &&
      cents(afterClose.current_balance_original) === 0 &&
      cents(afterClose.current_balance_base) === 0,
    JSON.stringify({ closed, afterClose }),
  );
  const reopened = await reopenAccountAtomically({
    userId,
    accountId: account.id,
    message: "reabrir cuenta pre-m",
    channel: "web",
  });
  const afterReopen = await accountRow(account.id);
  check(
    "P7 · reopen revierte el ajuste y recupera ambas patas exactas",
    reopened.ok &&
      afterReopen.status !== "closed" &&
      cents(afterReopen.current_balance_original) === 150 &&
      cents(afterReopen.current_balance_base) === 150,
    JSON.stringify({ reopened, afterReopen }),
  );
  const renamed = await updateAccountName({
    userId,
    accountId: account.id,
    name: "Cuenta Pre-M final",
  });
  check(
    "P7b · el renombre sin saldo usa el executor tipado de metadata",
    renamed && (await accountRow(account.id)).name === "Cuenta Pre-M final",
  );

  // The real founder shape that exposed the lock-out: native is already zero
  // but a harmless historical FX rounding residue remains in the base leg.
  const residueAccount = must(
    await admin
      .from("accounts")
      .insert({
        user_id: userId,
        name: "Efectivo Residuo Pre-M",
        type: "cash",
        currency: "ARS",
        current_balance_original: 0,
        current_balance_base: 0.18,
      })
      .select("id")
      .single(),
    "base-only residue account",
  );
  const residueCloseOperation = `pre-m-close-base-residue:${randomUUID()}`;
  const residueClosed = await closeAccountAtomically({
    userId,
    accountId: residueAccount.id,
    operationId: residueCloseOperation,
    message: "cerrar efectivo con residuo base de redondeo",
    channel: "web",
  });
  const residueAfterClose = await accountRow(residueAccount.id);
  const residueApplication = must(
    await admin
      .from("account_balance_reconciliation_applications")
      .select("delta_original, delta_base, transaction_id")
      .eq("user_id", userId)
      .eq("operation_id", `${residueCloseOperation}:base-zero`)
      .single(),
    "base-only residue marker",
  );
  check(
    "P7c · cierre absorbe 0,18 base-only con marca durable, sin inventar monto nativo",
    residueClosed.ok &&
      residueAfterClose.status === "closed" &&
      cents(residueAfterClose.current_balance_original) === 0 &&
      cents(residueAfterClose.current_balance_base) === 0 &&
      cents(residueApplication.delta_original) === 0 &&
      cents(residueApplication.delta_base) === -0.18 &&
      residueApplication.transaction_id == null,
    JSON.stringify({ residueClosed, residueAfterClose, residueApplication }),
  );
  const residueReopened = await reopenAccountAtomically({
    userId,
    accountId: residueAccount.id,
    message: "reabrir efectivo con residuo",
    channel: "web",
  });
  const residueAfterReopen = await accountRow(residueAccount.id);
  check(
    "P7d · reopen restaura exactamente el residuo previo y el estado",
    residueReopened.ok &&
      residueAfterReopen.status !== "closed" &&
      cents(residueAfterReopen.current_balance_original) === 0 &&
      cents(residueAfterReopen.current_balance_base) === 0.18,
    JSON.stringify({ residueReopened, residueAfterReopen }),
  );
  const materialMismatchAccount = must(
    await admin
      .from("accounts")
      .insert({
        user_id: userId,
        name: "Residuo material Pre-M",
        type: "cash",
        currency: "ARS",
        current_balance_original: 0,
        current_balance_base: 1.01,
      })
      .select("id")
      .single(),
    "material base mismatch account",
  );
  const materialMismatchClose = await closeAccountAtomically({
    userId,
    accountId: materialMismatchAccount.id,
    operationId: `pre-m-close-material-mismatch:${randomUUID()}`,
    message: "no ocultar residuo material",
    channel: "web",
  });
  const materialMismatchAfter = await accountRow(materialMismatchAccount.id);
  check(
    "P7e · el barrido acotado no oculta una discrepancia base material",
    !materialMismatchClose.ok &&
      materialMismatchClose.reason === "unsafe" &&
      materialMismatchAfter.status !== "closed" &&
      cents(materialMismatchAfter.current_balance_base) === 1.01,
    JSON.stringify({ materialMismatchClose, materialMismatchAfter }),
  );

  // 097/098 — the MIRROR of the base-only residue. A native residue whose
  // stored base leg is already zero has no ledger representation either (the
  // canonical writer demands a positive base amount), so before 097 such an
  // account could be neither zeroed nor closed. Verified locked against
  // production before the fix.
  const nativeResidueAccount = must(
    await admin
      .from("accounts")
      .insert({
        user_id: userId,
        name: "Residuo nativo Pre-M",
        type: "cash",
        currency: "ARS",
        current_balance_original: 5,
        current_balance_base: 0,
      })
      .select("id")
      .single(),
    "native-only residue account",
  );
  // La tasa se DERIVA como la derivan los callers reales (Mis Datos y el
  // agente), a partir de una lista de tasas con la forma de producción
  // (USD->ARS 1535, resuelta por inversa). Hardcodear 0,000651 aquí dejaba
  // pasar el defecto real: `convert(1, ARS, USD).baseAmount` redondea a 0,00 y
  // ambos callers concluían "no hay tasa" con una tasa vigente en la mano.
  const { rateToBase, convert: convertFxRate } = await import("@/lib/fx/fx-rates");
  const productionShapedRates = [
    { from: "USD", to: "ARS", rate: 1535, source: "provider", asOfMs: Date.now() },
  ];
  const nativeResidueRate = rateToBase("ARS", "USD", productionShapedRates);
  check(
    "P7o · la tasa vigente ARS→USD sobrevive al redondeo a centavos",
    typeof nativeResidueRate === "number" &&
      nativeResidueRate > 0 &&
      // el campo que ambos callers leían mal
      convertFxRate(1, "ARS", "USD", productionShapedRates).baseAmount === 0 &&
      5 * nativeResidueRate < 0.005 &&
      8 * nativeResidueRate >= 0.005,
    JSON.stringify({
      rate: nativeResidueRate,
      roundedBaseAmount: convertFxRate(1, "ARS", "USD", productionShapedRates).baseAmount,
    }),
  );
  const nativeResidueCloseOperation = `pre-m-close-native-residue:${randomUUID()}`;
  const nativeResidueClosed = await closeAccountAtomically({
    userId,
    accountId: nativeResidueAccount.id,
    operationId: nativeResidueCloseOperation,
    message: "cerrar cuenta con residuo nativo invisible en base",
    exchangeRateToBase: nativeResidueRate,
    channel: "web",
  });
  const nativeResidueAfterClose = await accountRow(nativeResidueAccount.id);
  const nativeResidueApplication = must(
    await admin
      .from("account_balance_reconciliation_applications")
      .select("delta_original, delta_base, transaction_id, exchange_rate_to_base")
      .eq("account_id", nativeResidueAccount.id)
      .single(),
    "native residue application",
  );
  check(
    "P7f · cierre absorbe un residuo nativo que vale menos de medio centavo base",
    nativeResidueClosed.ok &&
      nativeResidueAfterClose.status === "closed" &&
      cents(nativeResidueAfterClose.current_balance_original) === 0 &&
      cents(nativeResidueAfterClose.current_balance_base) === 0 &&
      cents(nativeResidueApplication.delta_original) === -5 &&
      cents(nativeResidueApplication.delta_base) === 0 &&
      nativeResidueApplication.transaction_id == null &&
      // la marca guarda la tasa REAL, nunca un 1 fabricado
      Math.abs(Number(nativeResidueApplication.exchange_rate_to_base) - nativeResidueRate) < 1e-9,
    JSON.stringify({ nativeResidueClosed, nativeResidueAfterClose, nativeResidueApplication }),
  );
  const nativeResidueReplay = await closeAccountAtomically({
    userId,
    accountId: nativeResidueAccount.id,
    operationId: nativeResidueCloseOperation,
    message: "cerrar cuenta con residuo nativo invisible en base",
    exchangeRateToBase: nativeResidueRate,
    channel: "web",
  });
  const nativeResidueMarkers = must(
    await admin
      .from("account_balance_reconciliation_applications")
      .select("id")
      .eq("account_id", nativeResidueAccount.id),
    "native residue markers after replay",
  );
  check(
    "P7f2 · el replay exacto del barrido no vuelve a mover dinero ni duplica la marca",
    nativeResidueReplay.ok &&
      nativeResidueReplay.alreadyClosed === true &&
      nativeResidueMarkers.length === 1 &&
      cents((await accountRow(nativeResidueAccount.id)).current_balance_original) === 0,
    JSON.stringify({ nativeResidueReplay, markers: nativeResidueMarkers.length }),
  );
  const nativeResidueReopened = await reopenAccountAtomically({
    userId,
    accountId: nativeResidueAccount.id,
    message: "reabrir cuenta con residuo nativo",
    channel: "web",
  });
  const nativeResidueAfterReopen = await accountRow(nativeResidueAccount.id);
  check(
    "P7g · reopen restaura exactamente el residuo nativo previo",
    nativeResidueReopened.ok &&
      nativeResidueAfterReopen.status !== "closed" &&
      cents(nativeResidueAfterReopen.current_balance_original) === 5 &&
      cents(nativeResidueAfterReopen.current_balance_base) === 0,
    JSON.stringify({ nativeResidueReopened, nativeResidueAfterReopen }),
  );
  // The editor never sends a private flag: "poner esta cuenta en cero" must
  // work from the screen, or the refusal is a lock-out one step removed.
  const uiDrain = await reconcileNativeAccountBalance({
    userId,
    accountId: nativeResidueAccount.id,
    targetBalanceOriginal: 0,
    exchangeRateToBase: 0.000651,
    baseCurrency: "USD",
    operationId: `pre-m-ui-drain:${randomUUID()}`,
    message: "el editor de saldo deja la cuenta en cero",
    channel: "web",
  });
  const uiDrainAfter = await accountRow(nativeResidueAccount.id);
  check(
    "P7h · el editor de saldo puede dejar en cero un residuo invisible en base",
    uiDrain.ok &&
      cents(uiDrainAfter.current_balance_original) === 0 &&
      cents(uiDrainAfter.current_balance_base) === 0 &&
      uiDrain.transactionId == null,
    JSON.stringify({ uiDrain, uiDrainAfter }),
  );
  // El barrido se acota por VALOR, no por cantidad de unidades nativas. Cada
  // uno de estos casos era BARRIDO por 097/098 contra producción real: el tope
  // `abs(nativo) <= 1000` nunca consultaba una tasa, y el cierre fabricaba
  // `rate = 1` para cualquier moneda.
  const valueBoundedRefusals = [
    { label: "P7i · 2000 ARS (1,30 USD) no se descarta por caber en 1000 unidades",
      currency: "ARS", native: 2000, rate: 0.000651 },
    { label: "P7k · 8 ARS ya valen 0,0052 USD y superan el medio centavo",
      currency: "ARS", native: 8, rate: 0.000651 },
    { label: "P7l · 5 EUR (5,50 USD) nunca son polvo de redondeo",
      currency: "EUR", native: 5, rate: 1.1 },
    { label: "P7m · una cuenta en moneda base con pata base cero es corrupción, no deriva FX",
      currency: "USD", native: 500, rate: 1 },
    { label: "P7n · sin tasa vigente el barrido se rehúsa en vez de asumir 1",
      currency: "ARS", native: 5, rate: null },
  ];
  for (const [index, spec] of valueBoundedRefusals.entries()) {
    const account = must(
      await admin
        .from("accounts")
        .insert({
          user_id: userId,
          name: `Residuo valorado Pre-M ${index}`,
          type: "cash",
          currency: spec.currency,
          current_balance_original: spec.native,
          current_balance_base: 0,
        })
        .select("id")
        .single(),
      `value-bounded refusal account ${index}`,
    );
    const closed = await closeAccountAtomically({
      userId,
      accountId: account.id,
      operationId: `pre-m-close-valued-${index}:${randomUUID()}`,
      message: "el barrido solo cubre un residuo sub-centavo",
      exchangeRateToBase: spec.rate,
      channel: "web",
    });
    const after = await accountRow(account.id);
    check(
      spec.label,
      !closed.ok &&
        closed.reason === "unsafe" &&
        after.status !== "closed" &&
        cents(after.current_balance_original) === spec.native,
      JSON.stringify({ closed, after }),
    );
    // Nada quedó escrito (el cierre se rehusó), así que la cuenta se retira aquí:
    // dejar un saldo EUR/USD vivo cambiaría la valoración que miden F1/F2.
    must(
      await admin.from("accounts").delete().eq("id", account.id),
      `cleanup value-bounded refusal account ${index}`,
    );
  }
  // Only a FULL drain is coherent without a base movement. A partial target
  // whose base delta still rounds under a cent must keep raising: 5 -> 2 ARS
  // moves 0.00 in base, so accepting it would change native money with no base
  // effect at all. (A partial target on a LARGER balance is expressible and is
  // correctly written by the ordinary ledger path — the guard is about the
  // inexpressible delta, not about partiality.)
  const partialResidueAccount = must(
    await admin
      .from("accounts")
      .insert({
        user_id: userId,
        name: "Residuo nativo parcial Pre-M",
        type: "cash",
        currency: "ARS",
        current_balance_original: 5,
        current_balance_base: 0,
      })
      .select("id")
      .single(),
    "partial native residue account",
  );
  let partialTargetRefused = false;
  try {
    await reconcileNativeAccountBalance({
      userId,
      accountId: partialResidueAccount.id,
      targetBalanceOriginal: 2,
      exchangeRateToBase: 0.000651,
      baseCurrency: "USD",
      operationId: `pre-m-partial-target:${randomUUID()}`,
      message: "un objetivo parcial no es un drenaje coherente",
      channel: "web",
    });
  } catch (error) {
    partialTargetRefused = /FX_REQUIRED/.test(String(error));
  }
  check(
    "P7j · un objetivo parcial sin pata base expresable sigue rehusándose",
    partialTargetRefused &&
      cents((await accountRow(partialResidueAccount.id)).current_balance_original) === 5,
  );

  must(
    await admin
      .from("debt_accounts")
      .update({
        current_balance_original: 50,
        current_balance_base: 50,
        full_payment_due: 50,
        statement_total_due: 50,
      })
      .eq("id", card.id),
    "seed debt",
  );
  const directDebtClose = await authenticated
    .from("debt_accounts")
    .update({ status: "closed" })
    .eq("id", card.id);
  check(
    "P8 · authenticated no puede ocultar deuda por UPDATE directo",
    !!directDebtClose.error && /typed writer/i.test(directDebtClose.error.message),
    directDebtClose.error?.message ?? "direct debt close passed",
  );
  const debtRefusal = await closeDebtAccountAtomically({
    userId,
    debtAccountId: card.id,
  });
  const debtAfterRefusal = must(
    await admin
      .from("debt_accounts")
      .select("status")
      .eq("id", card.id)
      .single(),
    "debt refusal state",
  );
  check(
    "P9 · writer tipado rehúsa cerrar una deuda con saldo",
    !debtRefusal.ok &&
      debtRefusal.reason === "outstanding" &&
      debtAfterRefusal.status === "active",
    JSON.stringify(debtRefusal),
  );
  must(
    await admin
      .from("debt_accounts")
      .update({
        current_balance_original: 0,
        current_balance_base: 0,
        full_payment_due: 0,
        statement_total_due: 0,
        minimum_payment: 0,
      })
      .eq("id", card.id),
    "clear debt",
  );
  const debtClosed = await closeDebtAccountAtomically({
    userId,
    debtAccountId: card.id,
  });
  check("P10 · deuda realmente vacía sí se puede cerrar", debtClosed.ok);
  must(
    await admin.from("debt_accounts").update({ status: "active" }).eq("id", card.id),
    "reopen debt for installment probe",
  );

  // H.44 real builder: injected failed MONEY read must be consumed before any
  // other DB read can manufacture an empty feed.
  let h44Reads = 0;
  let h44Refused = false;
  try {
    await buildCoachingBriefingWith(
      {
        userId,
        ctx: {},
        snapshot: {},
        now: new Date("2026-08-10T12:00:00Z"),
        surfaceNudges: false,
      },
      {
        loadMoneyFeed: async () => {
          h44Reads += 1;
          return { ok: false, complete: false };
        },
      },
    );
  } catch (error) {
    h44Refused = error instanceof KipuSaldoUnavailableError;
  }
  check(
    "H44 · buildCoachingBriefing consume el fallo real y no publica",
    h44Refused && h44Reads === 1,
    `refused=${h44Refused} reads=${h44Reads}`,
  );

  // H.46 real executors with real PostgreSQL writers: Saldo unavailable degrades
  // only the copy, never the financial operation.
  const installmentCtx = {
    userId,
    accounts: [],
    debtAccounts: [
      {
        id: card.id,
        name: "Visa Pre-M",
        type: "credit_card",
        currency: "USD",
        cutoffDay: 20,
        dueDay: 10,
      },
    ],
    goals: [],
    snapshot: {
      weeklyRemaining: 0,
      dailySuggested: 0,
      daysRemainingInWeek: 0,
      debtPressureLevel: "none",
      totalDebt: 0,
      availableCash: 150,
      suppressContributionPush: false,
      baseCurrency: "USD",
    },
    briefing: {},
    saldoAvailable: false,
    rawMessage: "Compré una heladera en 6 cuotas",
    baseCurrency: "USD",
    timezone: "America/Argentina/Buenos_Aires",
    fxRates: [],
    operationId: `pre-m-installment:${randomUUID()}`,
    dirty: false,
  };
  const installmentDeps = {
    readPlans: readActiveInstallmentPlans,
    applyPurchase: applyInstallmentPlanPurchase,
    closePlan: closeInstallmentPlanAtomically,
    now: () => new Date("2026-07-30T12:00:00Z"),
  };
  const installmentCreated = await executeCreateInstallmentPlanWith(
    {
      description: "Heladera Pre-M",
      totalAmount: 600,
      months: 6,
      cardName: "Visa Pre-M",
      firstPaymentDate: "2026-08-10",
      currency: "USD",
      category: "shopping",
    },
    installmentCtx,
    installmentDeps,
  );
  const planId = installmentCreated.data?.planId;
  check(
    "H46a · create executor escribe plan+deuda aunque Saldo no esté publicable",
    installmentCreated.status === "done" &&
      installmentCreated.effect === "wrote" &&
      typeof planId === "string" &&
      /NO cites ni estimes/.test(installmentCreated.summary),
    JSON.stringify(installmentCreated),
  );
  const installmentClosed = await executeCloseInstallmentPlanWith(
    { planName: "Heladera Pre-M", mode: "cancelled" },
    {
      ...installmentCtx,
      rawMessage: "Devolví la heladera",
      operationId: `pre-m-installment-close:${randomUUID()}`,
      dirty: false,
    },
    installmentDeps,
  );
  const storedPlan = must(
    await admin
      .from("installment_plans")
      .select("status")
      .eq("id", planId)
      .single(),
    "stored installment",
  );
  check(
    "H46b · close executor escribe reversa+plan aunque Saldo no esté publicable",
    installmentClosed.status === "done" &&
      installmentClosed.effect === "wrote" &&
      storedPlan.status === "cancelled" &&
      /NO cites ni estimes/.test(installmentClosed.summary),
    JSON.stringify({ installmentClosed, storedPlan }),
  );

  // Five-day cron gap. This stable fixed expense would normally auto-book; the
  // durable cursor sees the missed Aug-01 cycle, but catch-up must ASK.
  const fixed = must(
    await admin
      .from("fixed_expenses")
      .insert({
        user_id: userId,
        name: "Internet Pre-M",
        amount: 20,
        currency: "USD",
        category: "utilities",
        frequency: "monthly",
        expected_day: 1,
        payment_source_type: "account",
        payment_source_id: account.id,
        is_variable: false,
        is_active: true,
        start_date: "2026-07-01",
      })
      .select("id")
      .single(),
    "fixed catch-up",
  );
  must(
    await admin.rpc("kipu_advance_recurring_materialization_cursor", {
      p_user_id: userId,
      p_through: "2026-07-30",
      p_timezone: "America/Argentina/Buenos_Aires",
    }),
    "seed materialization cursor",
  );
  const beforeCatchup = await accountRow(account.id);
  const catchup = await runDueRecurringMaterializations(
    new Date("2026-08-10T15:00:00Z"),
    userId,
  );
  const caughtOccurrence = must(
    await admin
      .from("recurring_occurrences")
      .select("mode, status, created_transaction_id")
      .eq("user_id", userId)
      .eq("fixed_expense_id", fixed.id)
      .eq("occurrence_date", "2026-08-01")
      .single(),
    "caught occurrence",
  );
  check(
    "C1 · hueco de cron materializa la fecha perdida como ASK",
    catchup.errors === 0 &&
      caughtOccurrence.mode === "ask" &&
      caughtOccurrence.status === "pending" &&
      caughtOccurrence.created_transaction_id == null,
    JSON.stringify({ catchup, caughtOccurrence }),
  );
  check(
    "C2 · catch-up tardío no auto-cobra ni mueve la cuenta",
    cents((await accountRow(account.id)).current_balance_original) ===
      cents(beforeCatchup.current_balance_original),
  );
  const cursor = must(
    await admin
      .from("recurring_materialization_cursors")
      .select("last_materialized_local_date")
      .eq("user_id", userId)
      .single(),
    "materialization cursor",
  );
  check(
    "C3 · cursor avanza durablemente hasta el día procesado",
    cursor.last_materialized_local_date === "2026-08-10",
    JSON.stringify(cursor),
  );

  // Objective cursor is monotonic and accepts missed months outside day 1-3.
  must(
    await admin.rpc("kipu_advance_objective_close_cursor", {
      p_user_id: userId,
      p_month: "2026-05",
    }),
    "objective cursor May",
  );
  must(
    await admin.rpc("kipu_advance_objective_close_cursor", {
      p_user_id: userId,
      p_month: "2026-04",
    }),
    "objective cursor old replay",
  );
  const objectiveCursor = must(
    await admin
      .from("objective_close_cursors")
      .select("last_evaluated_month")
      .eq("user_id", userId)
      .single(),
    "objective cursor",
  );
  check(
    "O1 · cursor de cierre mensual nunca retrocede",
    objectiveCursor.last_evaluated_month === "2026-05-01",
    JSON.stringify(objectiveCursor),
  );
  const nullObjectiveMonth = await admin.rpc(
    "kipu_advance_objective_close_cursor",
    { p_user_id: userId, p_month: null },
  );
  check(
    "O2 · mes nulo falla por el contrato de validación, no por una constraint lateral",
    !!nullObjectiveMonth.error &&
      /KIPU_VALIDATION: user and YYYY-MM month required/.test(
        nullObjectiveMonth.error.message,
      ),
    nullObjectiveMonth.error?.message ?? "NULL month accepted",
  );

  // Stale manual FX is visible in settings but cannot publish current money.
  const ars = must(
    await admin
      .from("accounts")
      .insert({
        user_id: userId,
        name: "Pesos Pre-M",
        type: "bank",
        currency: "ARS",
        current_balance_original: 100000,
        current_balance_base: 100,
      })
      .select("id")
      .single(),
    "ARS account",
  );
  must(
    await admin.from("fx_rates").upsert(
      {
        user_id: userId,
        base_currency: "ARS",
        quote_currency: "USD",
        rate: 0.001,
        source: "manual",
        as_of: "2026-07-01",
        auto_refresh: false,
      },
      { onConflict: "user_id,base_currency,quote_currency" },
    ),
    "stale FX",
  );
  const staleCtx = await buildUserFinancialContext(userId);
  check(
    "F1 · tasa manual vieja no publica valoración actual",
    staleCtx.fxReliable === false,
    `fxReliable=${staleCtx.fxReliable}`,
  );
  must(
    await admin
      .from("fx_rates")
      .update({ as_of: new Date().toISOString().slice(0, 10) })
      .eq("user_id", userId)
      .eq("base_currency", "ARS")
      .eq("quote_currency", "USD"),
    "freshen FX",
  );
  const freshCtx = await buildUserFinancialContext(userId);
  check(
    "F2 · la misma tasa renovada recupera la valoración",
    freshCtx.fxReliable === true,
    `fxReliable=${freshCtx.fxReliable}, ars=${ars.id}`,
  );

  const directCursorRpc = await authenticated.rpc(
    "kipu_advance_recurring_materialization_cursor",
    {
      p_user_id: userId,
      p_through: "2026-08-11",
      p_timezone: "UTC",
    },
  );
  check(
    "ACL · los cursores sólo avanzan por service_role",
    !!directCursorRpc.error,
    directCursorRpc.error?.message ?? "authenticated executed cursor writer",
  );
  const legacyReconcile = await authenticated.rpc(
    "kipu_reconcile_account_balance",
    {
      p: {
        user_id: userId,
        account_id: account.id,
        target_base: 777,
        operation_id: `pre-m-legacy-auth:${randomUUID()}`,
        input_channel: "web",
      },
    },
  );
  check(
    "ACL2 · la reconciliación legacy ya no es una puerta authenticated",
    !!legacyReconcile.error &&
      cents((await accountRow(account.id)).current_balance_original) !== 777,
    legacyReconcile.error?.message ?? "authenticated executed legacy reconcile",
  );
} catch (error) {
  failures.push("ABORT");
  console.error(
    `ABORT · ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
  );
} finally {
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) {
      failures.push("CLEANUP");
      console.error(`CLEANUP · ${deleted.error.message}`);
    }
    const residueChecks = [
      ["profiles", "id"],
      ["accounts", "user_id"],
      ["debt_accounts", "user_id"],
      ["transactions", "user_id"],
      ["fixed_expenses", "user_id"],
      ["recurring_occurrences", "user_id"],
      ["recurring_materialization_cursors", "user_id"],
      ["objective_close_cursors", "user_id"],
      ["account_balance_reconciliation_applications", "user_id"],
      ["installment_plans", "user_id"],
    ];
    try {
      for (const [table, column] of residueChecks) {
        const count = await countRows(table, column, userId);
        if (count !== 0) {
          failures.push(`RESIDUE:${table}`);
          console.error(`RESIDUE · ${table}: ${count}`);
        }
      }
    } catch (error) {
      failures.push("CLEANUP_READ");
      console.error(
        `LIMPIEZA ILEGIBLE · ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

if (executed !== EXPECTED) {
  failures.push("COVERAGE");
  console.error(`COBERTURA INCOMPLETA · ${executed}/${EXPECTED}`);
}
console.log(`Pre-M backend E2E: ${passed}/${EXPECTED}`);
if (failures.length > 0 || passed !== EXPECTED) process.exit(1);
