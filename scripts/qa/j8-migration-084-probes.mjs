// Bloque J-8 — sondas de las fronteras que introduce la migración 084.
//
// El E2E de J-7 pasa 38/38 pero NO ejercita nada de la 084: sus brazos son de
// J-1..J-7. Estas sondas cubren lo que la 084 agrega, y lo hacen por los writers
// TIPADOS del producto (no por SQL crudo), que es el camino que corre en prod.
//
// Persona desechable, limpieza en `finally`, residuo verificado sobre TODAS las
// tablas tocadas.
//
//   node --env-file=.env.local ./scripts/qa/j8-migration-084-probes.mjs

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

registerHooks({
  resolve(s, c, n) {
    const b = s.startsWith("@/")
      ? path.resolve("src", s.slice(2))
      : s.startsWith(".") && c.parentURL?.startsWith("file:") && new URL(c.parentURL).pathname.includes("/src/")
        ? path.resolve(path.dirname(new URL(c.parentURL).pathname), s)
        : null;
    if (!b) return n(s, c);
    const t = fs.existsSync(`${b}.ts`) ? `${b}.ts` : fs.existsSync(`${b}.tsx`) ? `${b}.tsx` : b;
    return n(pathToFileURL(t).href, c);
  },
});

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const M = await import("@/lib/ai/apply-chat-transaction-intent");
const D = await import("@/lib/capture/card-payment-draft");

let pass = 0;
const fails = [];
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log(`  ok   · ${name}`); }
  else { fails.push(name); console.log(`  FALL · ${name}\n         ${detail ?? ""}`); }
};

let userId = null;
const TOUCHED = [
  "card_payment_group_legs", "card_payment_groups", "card_payment_capture_drafts",
  "pending_chat_clarifications",
  "installment_plan_purchase_applications", "account_close_applications",
  "fixed_expense_payment_applications", "card_payment_applications",
  "installment_plans", "fixed_expenses", "transactions", "debt_accounts", "accounts", "profiles",
];

try {
  const { data: u, error: eU } = await admin.auth.admin.createUser({
    email: `kipu-j8probe-${Date.now()}@example.invalid`, email_confirm: true,
    user_metadata: { kipu_smoke: true },
  });
  if (eU) throw new Error("createUser: " + eU.message);
  userId = u.user.id;
  console.log(`persona desechable: ${userId}`);
  await admin.from("profiles").upsert({ id: userId, base_currency: "USD", onboarding_completed: true });

  const mkAcc = async (name, bal) => (await admin.from("accounts").insert({
    user_id: userId, name, type: "bank", currency: "USD",
    current_balance_original: bal, current_balance_base: bal,
  }).select("id").single()).data.id;
  const mkDebt = async (name, type, bal, due) => (await admin.from("debt_accounts").insert({
    user_id: userId, name, type, currency: "USD",
    current_balance_original: bal, current_balance_base: bal,
    full_payment_due: due, statement_total_due: due,
  }).select("id").single()).data.id;

  const cuenta = await mkAcc("Produbanco P", 600);
  const tarjeta = await mkDebt("Visa P", "credit_card", 743.93, 743.93);
  const prestamo = await mkDebt("Alpaca P", "loan", 1000, null);

  const bal = async (id) => Number((await admin.from("accounts").select("current_balance_original").eq("id", id).single()).data.current_balance_original);
  const deuda = async (id) => Number((await admin.from("debt_accounts").select("current_balance_original").eq("id", id).single()).data.current_balance_original);

  const legs = [
    { kind: "account", instrumentId: cuenta, amount: 471.95 },
    { kind: "loan", instrumentId: prestamo, clearingAccountId: cuenta, amount: 271.98 },
  ];
  const base = {
    userId, debtAccountId: tarjeta, expectedDue: 743.93, totalAmount: 743.93,
    originalCurrency: "USD", exchangeRateToBase: 1, baseCurrency: "USD",
    occurredAtISO: new Date().toISOString(), rawInput: "probe", inputChannel: "web",
  };

  // ── P1 · el caso del founder, atómico ────────────────────────────────────
  const c0 = await bal(cuenta), d0 = await deuda(tarjeta), l0 = await deuda(prestamo);
  const DK = `probe-ms-${randomUUID()}`;
  const r1 = await M.applyMultiSourceCardPayment({ ...base, dedupeKey: DK, sources: legs });
  check("P1 · pago 743.93 = 471.95 cuenta + 271.98 préstamo, en UNA operación",
    r1.ok === true && r1.replayed === false, JSON.stringify(r1));
  check("P1b · la cuenta bajó 471.95 (no 743.93)", (await bal(cuenta)) === Math.round((c0 - 471.95) * 100) / 100,
    `${c0} → ${await bal(cuenta)}`);
  check("P1c · la tarjeta bajó los 743.93 completos", (await deuda(tarjeta)) === Math.round((d0 - 743.93) * 100) / 100,
    `${d0} → ${await deuda(tarjeta)}`);
  check("P1d · el préstamo SUBIÓ 271.98 (el dinero prestado es deuda nueva)",
    (await deuda(prestamo)) === Math.round((l0 + 271.98) * 100) / 100, `${l0} → ${await deuda(prestamo)}`);

  // ── P2 · replay exacto: no mueve nada de nuevo ───────────────────────────
  const c2 = await bal(cuenta), d2 = await deuda(tarjeta), l2 = await deuda(prestamo);
  const r2 = await M.applyMultiSourceCardPayment({ ...base, dedupeKey: DK, sources: legs });
  check("P2 · replay exacto devuelve replayed sin volver a mover",
    r2.ok === true && r2.replayed === true, JSON.stringify(r2));
  check("P2b · y ninguna pata se movió",
    (await bal(cuenta)) === c2 && (await deuda(tarjeta)) === d2 && (await deuda(prestamo)) === l2);

  // ── P3 · misma identidad, payload distinto ⇒ rechazado ───────────────────
  const r3 = await M.applyMultiSourceCardPayment({
    ...base, dedupeKey: DK,
    sources: [{ kind: "account", instrumentId: cuenta, amount: 500 },
              { kind: "loan", instrumentId: prestamo, clearingAccountId: cuenta, amount: 243.93 }],
  });
  check("P3 · mismo dedupe con reparto distinto: RECHAZADO (no re-aplica)", r3.ok === false, JSON.stringify(r3));
  check("P3b · y nada se movió: cuenta, tarjeta Y préstamo",
    (await bal(cuenta)) === c2 && (await deuda(tarjeta)) === d2 && (await deuda(prestamo)) === l2);

  // ── P4 · las patas que no suman el total ⇒ cero writes ───────────────────
  const c4 = await bal(cuenta), d4 = await deuda(tarjeta);
  const r4 = await M.applyMultiSourceCardPayment({
    ...base, dedupeKey: `probe-bad-${randomUUID()}`, expectedDue: await deuda(tarjeta),
    sources: [{ kind: "account", instrumentId: cuenta, amount: 100 },
              { kind: "loan", instrumentId: prestamo, clearingAccountId: cuenta, amount: 100 }],
  });
  check("P4 · patas que no suman el total: RECHAZADO", r4.ok === false, JSON.stringify(r4));
  const l4 = l2;
  check("P4b · cero writes: cuenta, tarjeta Y préstamo",
    (await bal(cuenta)) === c4 && (await deuda(tarjeta)) === d4 && (await deuda(prestamo)) === l4);

  // ── P5 · cierre de tarjeta con obligaciones residuales ───────────────────
  const conDeuda = await mkDebt("Con deuda P", "credit_card", 50, 50);
  const r5 = await M.closeDebtAccountAtomically({ userId, debtAccountId: conDeuda });
  check("P5 · cerrar una tarjeta CON deuda: RECHAZADO (no se esconde la obligación)",
    r5.ok === false, JSON.stringify(r5));
  const st5 = (await admin.from("debt_accounts").select("status").eq("id", conDeuda).single()).data.status;
  check("P5b · y sigue abierta", st5 !== "closed", `status=${st5}`);

  // Un saldo NEGATIVO (crédito a favor) también debe bloquear el cierre.
  await admin.from("debt_accounts").update({
    current_balance_original: -25, current_balance_base: -25, full_payment_due: 0, statement_total_due: 0,
  }).eq("id", conDeuda);
  const r5c = await M.closeDebtAccountAtomically({ userId, debtAccountId: conDeuda });
  check("P5c · cerrar con saldo NEGATIVO (crédito a favor) también se rechaza", r5c.ok === false, JSON.stringify(r5c));

  await admin.from("debt_accounts").update({
    current_balance_original: 0, current_balance_base: 0, full_payment_due: 0,
    minimum_payment: 0, statement_total_due: 0,
  }).eq("id", conDeuda);
  const r5d = await M.closeDebtAccountAtomically({ userId, debtAccountId: conDeuda });
  const st5d = (await admin.from("debt_accounts").select("status").eq("id", conDeuda).single()).data.status;
  check("P5d · en CERO sí se cierra", r5d.ok === true && st5d === "closed", `${JSON.stringify(r5d)} status=${st5d}`);

  // ── P6 · préstamo personal + receivable juntos ───────────────────────────
  const c6 = await bal(cuenta);
  const r6 = await M.applyPersonLoanOut(
    {
      userId, type: "expense", effectType: "expense", description: "Préstamo a Juan P",
      category: "other", originalAmount: 80, originalCurrency: "USD",
      exchangeRateToBase: 1, baseAmount: 80, baseCurrency: "USD",
      sourceAccountId: cuenta, occurredAtISO: new Date().toISOString(),
      rawInput: "probe", inputChannel: "web", dedupeKey: `probe-loan-${randomUUID()}`,
    },
    { counterparty: "Juan P", amount: 80, currency: "USD", reason: "probe" },
  ).catch((e) => ({ ok: false, thrown: String(e).slice(0, 140) }));
  const { count: recv } = await admin.from("receivables").select("*", { count: "exact", head: true }).eq("user_id", userId);
  check("P6 · préstamo a persona: salida de caja y receivable en la misma operación",
    r6.ok === true && (await bal(cuenta)) === Math.round((c6 - 80) * 100) / 100 && (recv ?? 0) === 1,
    `${JSON.stringify(r6)} receivables=${recv} cuenta ${c6}→${await bal(cuenta)}`);

  // ── P7 · idempotencia de la propia migración ya está probada por P2/P3 ───
  const { count: grupos } = await admin.from("card_payment_groups").select("*", { count: "exact", head: true }).eq("user_id", userId);
  const { count: patas } = await admin.from("card_payment_group_legs").select("*", { count: "exact", head: true }).eq("user_id", userId);
  check("P7 · un solo grupo durable con sus dos patas (el replay no duplicó marcadores)",
    (grupos ?? 0) === 1 && (patas ?? 0) === 2, `grupos=${grupos} patas=${patas}`);

  // ── P7b · una pata no se corrige fuera del grupo ─────────────────────────
  const beforePartialCorrection = {
    account: await bal(cuenta),
    card: await deuda(tarjeta),
    loan: await deuda(prestamo),
  };
  const { data: partialCorrection, error: partialCorrectionError } = await admin.rpc(
    "kipu_correct_financial_operation",
    {
      p_user_id: userId,
      p_original_transaction_id: r1.ok ? r1.transactionIds[0] : randomUUID(),
      p_entry: {
        user_id: userId,
        type: "debt_payment",
        effect_type: "debt_payment",
        description: "corrección parcial inválida",
        category: "debt",
        original_amount: 470,
        original_currency: "USD",
        exchange_rate_to_base: 1,
        base_amount: 470,
        base_currency: "USD",
        source_account_id: cuenta,
        debt_account_id: tarjeta,
        dedupe_key: `probe-partial-correction-${randomUUID()}`,
      },
      p_statement: {
        debt_account_id: tarjeta,
        expected_due: 743.93,
        paid_in_card_currency: 470,
      },
      p_raw_input: "probe",
      p_input_channel: "web",
    },
  );
  check(
    "P7b · corregir una sola pata del grupo se rehúsa, no desarma las demás",
    !partialCorrectionError &&
      partialCorrection?.outcome === "multi_source_correction_requires_replacement" &&
      (await bal(cuenta)) === beforePartialCorrection.account &&
      (await deuda(tarjeta)) === beforePartialCorrection.card &&
      (await deuda(prestamo)) === beforePartialCorrection.loan,
    `${JSON.stringify(partialCorrectionError)} ${JSON.stringify(partialCorrection)}`,
  );

  // ── P7c–g · undo del grupo completo + replay ─────────────────────────────
  // El baseline de la CUENTA se toma justo antes del undo, no al inicio del
  // archivo: entre P1 y acá, P6 (préstamo a persona) y P8 la debitaron
  // legítimamente. Comparar contra `c0` medía sondas ajenas, no esta reversa —
  // y daba rojo sobre un producto correcto. Tarjeta y préstamo sí vuelven a su
  // valor original porque ninguna otra sonda los tocó.
  const cPreUndo = await bal(cuenta);
  const undoGroup = await M.reverseStoredTransactionsAtomically({
    userId,
    transactionIds: [r1.ok ? r1.transactionIds[0] : randomUUID()],
    message: "probe undo group",
    channel: "web",
  }).catch((e) => ({ thrown: String(e).slice(0, 180) }));
  const groupAfterUndo = r1.ok
    ? (await admin.from("card_payment_groups")
        .select("reversed_at")
        .eq("id", r1.groupId)
        .single()).data
    : null;
  const legsAfterUndo = r1.ok
    ? (await admin.from("card_payment_group_legs")
        .select("kind,payment_reversal_transaction_id,funding_reversal_transaction_id")
        .eq("group_id", r1.groupId)).data ?? []
    : [];
  check(
    "P7c · deshacer una pata deshace el grupo ENTERO: cuenta, tarjeta y préstamo",
    Array.isArray(undoGroup) &&
      // la pata de cuenta se DEVUELVE exactamente (471.95), medido como delta
      (await bal(cuenta)) === Math.round((cPreUndo + 471.95) * 100) / 100 &&
      (await deuda(tarjeta)) === d0 &&
      (await deuda(prestamo)) === l0,
    `${JSON.stringify(undoGroup)} account=${await bal(cuenta)} card=${await deuda(tarjeta)} loan=${await deuda(prestamo)}`,
  );
  check(
    "P7d · el grupo y sus dos patas conservan marcadores completos de la reversa",
    typeof groupAfterUndo?.reversed_at === "string" &&
      legsAfterUndo.length === 2 &&
      legsAfterUndo.every((leg) => typeof leg.payment_reversal_transaction_id === "string") &&
      legsAfterUndo.find((leg) => leg.kind === "loan")?.funding_reversal_transaction_id != null,
    `${JSON.stringify(groupAfterUndo)} ${JSON.stringify(legsAfterUndo)}`,
  );
  const undoBalances = {
    account: await bal(cuenta),
    card: await deuda(tarjeta),
    loan: await deuda(prestamo),
  };
  const undoGroupReplay = await M.reverseStoredTransactionsAtomically({
    userId,
    transactionIds: [r1.ok ? r1.transactionIds[0] : randomUUID()],
    message: "probe undo group replay",
    channel: "web",
  }).catch((e) => ({ thrown: String(e).slice(0, 180) }));
  check(
    "P7e · replay del undo devuelve already y no vuelve a mover ninguna pata",
    Array.isArray(undoGroupReplay) &&
      undoGroupReplay[0]?.alreadyReversed === true &&
      (await bal(cuenta)) === undoBalances.account &&
      (await deuda(tarjeta)) === undoBalances.card &&
      (await deuda(prestamo)) === undoBalances.loan,
    JSON.stringify(undoGroupReplay),
  );

  // ── P8 · fijo + "págalo hoy": una sola operación ─────────────────────────
  const c8 = await bal(cuenta);
  const r8 = await M.applyFixedExpenseWithPayment({
    userId, mode: "create", dedupeKey: `probe-fix-${randomUUID()}`,
    fixed: { name: "Internet P", amount: 40, currency: "USD", category: "utilities",
             frequency: "monthly", payment_source_type: "account", payment_source_id: cuenta },
    entry: {
      userId, type: "expense", effectType: "expense", description: "Internet P",
      category: "utilities", originalAmount: 40, originalCurrency: "USD",
      exchangeRateToBase: 1, baseAmount: 40, baseCurrency: "USD",
      sourceAccountId: cuenta, occurredAtISO: new Date().toISOString(),
      rawInput: "probe", inputChannel: "web", dedupeKey: `probe-fixe-${randomUUID()}`,
    },
  }).catch((e) => ({ ok: false, thrown: String(e).slice(0, 140) }));
  const { count: fijos } = await admin.from("fixed_expenses").select("*", { count: "exact", head: true }).eq("user_id", userId);
  check("P8 · gasto fijo + pago de hoy aterrizan JUNTOS (definición y caja)",
    r8.ok === true && (fijos ?? 0) === 1 && (await bal(cuenta)) === Math.round((c8 - 40) * 100) / 100,
    `${JSON.stringify(r8)} fijos=${fijos} cuenta ${c8}→${await bal(cuenta)}`);

  // ── P9 · cierre y reapertura de cuenta ───────────────────────────────────
  const cerrar = await mkAcc("Para cerrar P", 12.5);
  const r9 = await M.closeAccountAtomically({
    userId, accountId: cerrar, operationId: `probe-close-${randomUUID()}`,
    message: "probe", channel: "web",
  }).catch((e) => ({ ok: false, thrown: String(e).slice(0, 140) }));
  const a9 = (await admin.from("accounts").select("status,current_balance_original").eq("id", cerrar).single()).data;
  check("P9 · cerrar una cuenta: ajuste a cero y status cerrado, juntos",
    r9.ok === true && a9.status === "closed" && Number(a9.current_balance_original) === 0,
    `${JSON.stringify(r9)} status=${a9.status} saldo=${a9.current_balance_original}`);
  const { count: marcas9 } = await admin.from("account_close_applications").select("*", { count: "exact", head: true }).eq("user_id", userId);
  check("P9b · con marcador durable del cierre", (marcas9 ?? 0) === 1, `marcas=${marcas9}`);
  const r9r = await M.reopenAccountAtomically({ userId, accountId: cerrar, message: "probe", channel: "web" })
    .catch((e) => ({ ok: false, thrown: String(e).slice(0, 140) }));
  const a9r = (await admin.from("accounts").select("status").eq("id", cerrar).single()).data;
  check("P9c · y se puede reabrir", r9r.ok === true && a9r.status !== "closed", `${JSON.stringify(r9r)} status=${a9r.status}`);

  // ── P10 · cuotas: alta atómica, replay, cancelación ──────────────────────
  const tarj10 = await mkDebt("Visa cuotas P", "credit_card", 0, 0);
  const d10 = await deuda(tarj10);
  const DK10 = `probe-inst-${randomUUID()}`;
  const planInput = {
    userId, dedupeKey: DK10,
    plan: {
      debtAccountId: tarj10, description: "Notebook P", totalOriginal: 1200,
      originalCurrency: "USD", totalBase: 1200, baseCurrency: "USD", monthsTotal: 12,
      firstStatementDue: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      surchargeBase: 0, anniversaryDay: 5, category: "shopping",
    },
    entry: {
      userId, type: "expense", effectType: "expense", description: "Notebook P",
      category: "shopping", originalAmount: 1200, originalCurrency: "USD",
      exchangeRateToBase: 1, baseAmount: 1200, baseCurrency: "USD",
      debtAccountId: tarj10, occurredAtISO: new Date().toISOString(),
      rawInput: "probe", inputChannel: "web", dedupeKey: DK10,
    },
  };
  const r10 = await M.applyInstallmentPlanPurchase(planInput).catch((e) => ({ ok: false, thrown: String(e).slice(0, 140) }));
  const { count: planes } = await admin.from("installment_plans").select("*", { count: "exact", head: true }).eq("user_id", userId);
  check("P10 · cuotas: plan y compra (deuda completa hoy) nacen JUNTOS",
    r10.ok === true && (planes ?? 0) === 1 && (await deuda(tarj10)) === Math.round((d10 + 1200) * 100) / 100,
    `${JSON.stringify(r10)} planes=${planes} deuda ${d10}→${await deuda(tarj10)}`);

  const r10b = await M.applyInstallmentPlanPurchase(planInput).catch((e) => ({ ok: false, thrown: String(e).slice(0, 140) }));
  const { count: planes2 } = await admin.from("installment_plans").select("*", { count: "exact", head: true }).eq("user_id", userId);
  check("P10b · replay NO duplica plan ni deuda",
    (planes2 ?? 0) === 1 && (await deuda(tarj10)) === Math.round((d10 + 1200) * 100) / 100,
    `${JSON.stringify(r10b)} planes=${planes2} deuda=${await deuda(tarj10)}`);

  const planId = (await admin.from("installment_plans").select("id").eq("user_id", userId).limit(1).single()).data.id;
  const r10c = await M.closeInstallmentPlanAtomically({
    userId, planId, mode: "cancelled", message: "probe", channel: "web",
  }).catch((e) => ({ ok: false, thrown: String(e).slice(0, 140) }));
  const st10 = (await admin.from("installment_plans").select("status").eq("id", planId).single()).data.status;
  check("P10c · cancelar revierte la compra y detiene el plan en la MISMA transacción",
    r10c.ok === true && st10 === "cancelled" && (await deuda(tarj10)) === d10,
    `${JSON.stringify(r10c)} status=${st10} deuda=${await deuda(tarj10)} (esperado ${d10})`);

  // ── P11 · batch undo: si una fila no es segura, se revierten CERO ─────────
  const c11 = await bal(cuenta);
  // Auditoría de Codex (P2): un INSERT crudo no debita la cuenta, pero la reversa
  // sí pasa por el ledger y acredita — el harness FABRICABA 5 dentro de la persona
  // desechable y P11b sólo miraba que existiera una reversa. Se crea por el
  // writer real y se verifica el débito antes de revertir.
  const t11 = await M.applyLedgerEntry(admin, {
    userId, type: "expense", effectType: "expense", description: "para revertir P",
    category: "other", originalAmount: 5, originalCurrency: "USD",
    exchangeRateToBase: 1, baseAmount: 5, baseCurrency: "USD",
    sourceAccountId: cuenta, occurredAtISO: new Date().toISOString(),
    rawInput: "probe", inputChannel: "web", dedupeKey: `probe-t11-${randomUUID()}`,
  });
  check("P11-pre · el gasto a revertir se creó por el LEDGER y debitó 5",
    (await bal(cuenta)) === Math.round((c11 - 5) * 100) / 100, `${c11} → ${await bal(cuenta)}`);
  const cTrasDebito = await bal(cuenta);
  const r11 = await M.reverseStoredTransactionsAtomically({
    userId, transactionIds: [t11, randomUUID()], message: "probe", channel: "web",
  }).catch((e) => ({ thrown: String(e).slice(0, 140) }));
  const { count: rev11 } = await admin.from("transactions").select("*", { count: "exact", head: true })
    .eq("user_id", userId).eq("type", "reversal").eq("related_transaction_id", t11);
  check("P11 · batch undo con una fila inexistente: revierte CERO, no «2 de 3»",
    (rev11 ?? 0) === 0 && (await bal(cuenta)) === cTrasDebito,
    `${JSON.stringify(r11)} reversas=${rev11} cuenta ${cTrasDebito}→${await bal(cuenta)}`);

  const r11b = await M.reverseStoredTransactionsAtomically({
    userId, transactionIds: [t11], message: "probe", channel: "web",
  }).catch((e) => ({ thrown: String(e).slice(0, 140) }));
  const { count: rev11b } = await admin.from("transactions").select("*", { count: "exact", head: true })
    .eq("user_id", userId).eq("type", "reversal").eq("related_transaction_id", t11);
  check("P11b · y el lote válido revierte y RESTAURA el saldo exacto",
    (rev11b ?? 0) === 1 && Array.isArray(r11b) && (await bal(cuenta)) === c11,
    `${JSON.stringify(r11b)} reversas=${rev11b} cuenta=${await bal(cuenta)} esperado=${c11}`);

  // ── P12 · movimiento + pending: una sola operación y replay exacto ───────
  const pendingId = (await admin.from("pending_chat_clarifications").insert({
    user_id: userId,
    channel: "web",
    chat_id: "probe-pending",
    kind: "vague_payment",
    payload: {},
    prompt: "¿desde qué cuenta?",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  }).select("id").single()).data.id;
  const pendingEntry = M.buildLedgerEntryPayload({
    userId,
    type: "expense",
    effectType: "expense",
    description: "Movimiento pending P",
    category: "other",
    originalAmount: 7,
    originalCurrency: "USD",
    exchangeRateToBase: 1,
    baseAmount: 7,
    baseCurrency: "USD",
    sourceAccountId: cuenta,
    occurredAtISO: new Date().toISOString(),
    rawInput: "probe pending",
    inputChannel: "web",
  });
  const pendingBefore = await bal(cuenta);
  const { data: pendingFirst, error: pendingFirstError } = await admin.rpc(
    "kipu_apply_ledger_entry_and_resolve_pending",
    { p_entry: pendingEntry, p_pending_id: pendingId },
  );
  const pendingRow = (await admin.from("pending_chat_clarifications")
    .select("status")
    .eq("id", pendingId)
    .single()).data;
  check(
    "P12 · responder un pending escribe el movimiento y cierra la pregunta juntos",
    !pendingFirstError &&
      pendingFirst?.outcome === "applied" &&
      pendingRow.status === "resolved" &&
      (await bal(cuenta)) === Math.round((pendingBefore - 7) * 100) / 100,
    `${JSON.stringify(pendingFirstError)} ${JSON.stringify(pendingFirst)} status=${pendingRow.status}`,
  );
  const pendingAfter = await bal(cuenta);
  const { data: pendingReplay, error: pendingReplayError } = await admin.rpc(
    "kipu_apply_ledger_entry_and_resolve_pending",
    { p_entry: pendingEntry, p_pending_id: pendingId },
  );
  check(
    "P12b · replay exacto del pending devuelve la misma transacción y no duplica",
    !pendingReplayError &&
      pendingReplay?.outcome === "replayed" &&
      pendingReplay?.transaction_id === pendingFirst?.transaction_id &&
      (await bal(cuenta)) === pendingAfter,
    `${JSON.stringify(pendingReplayError)} ${JSON.stringify(pendingReplay)}`,
  );
  const { error: pendingMismatchError } = await admin.rpc(
    "kipu_apply_ledger_entry_and_resolve_pending",
    {
      p_entry: { ...pendingEntry, original_amount: 8, base_amount: 8 },
      p_pending_id: pendingId,
    },
  );
  check(
    "P12c · el mismo pending con otro monto se rechaza y no mueve caja",
    /KIPU_DEDUPE_MISMATCH/.test(pendingMismatchError?.message ?? "") &&
      (await bal(cuenta)) === pendingAfter,
    JSON.stringify(pendingMismatchError),
  );

  // ── P13 · metadata de cuotas alineada; corrección monetaria genérica no ──
  const purchaseApplication = (await admin.from("installment_plan_purchase_applications")
    .select("transaction_id,installment_plan_id")
    .eq("user_id", userId)
    .limit(1)
    .single()).data;
  await M.correctTransactionMetadata({
    userId,
    transactionId: purchaseApplication.transaction_id,
    description: "Notebook corregida P",
    category: "utilities",
  });
  const installmentTx = (await admin.from("transactions")
    .select("description,category")
    .eq("id", purchaseApplication.transaction_id)
    .single()).data;
  const installmentPlan = (await admin.from("installment_plans")
    .select("description,category")
    .eq("id", purchaseApplication.installment_plan_id)
    .single()).data;
  check(
    "P13 · metadata de una compra en cuotas actualiza ledger y plan juntos",
    installmentTx.description === "Notebook corregida P" &&
      installmentPlan.description === "Notebook corregida P" &&
      installmentTx.category === "utilities" &&
      installmentPlan.category === "utilities",
    `${JSON.stringify(installmentTx)} ${JSON.stringify(installmentPlan)}`,
  );
  const { data: genericInstallmentCorrection, error: genericInstallmentCorrectionError } =
    await admin.rpc("kipu_correct_financial_operation", {
      p_user_id: userId,
      p_original_transaction_id: purchaseApplication.transaction_id,
      p_entry: {
        user_id: userId,
        type: "expense",
        effect_type: "expense",
        description: "Notebook monto alterado P",
        category: "utilities",
        original_amount: 1300,
        original_currency: "USD",
        exchange_rate_to_base: 1,
        base_amount: 1300,
        base_currency: "USD",
        debt_account_id: tarj10,
        dedupe_key: `probe-installment-correction-${randomUUID()}`,
      },
      p_statement: {},
      p_raw_input: "probe",
      p_input_channel: "web",
    });
  check(
    "P13b · cambiar monto de una compra en cuotas por el corrector genérico se rehúsa",
    !genericInstallmentCorrectionError &&
      genericInstallmentCorrection?.outcome === "installment_correction_requires_cancel",
    `${JSON.stringify(genericInstallmentCorrectionError)} ${JSON.stringify(genericInstallmentCorrection)}`,
  );

  // ── P14 · draft multifuente: identidad durable y segundo consumo negado ─
  const draftAccount = await mkAcc("Draft cuenta P", 500);
  const draftLoan = await mkDebt("Draft préstamo P", "loan", 200, null);
  const draftCard = await mkDebt("Draft tarjeta P", "credit_card", 100, 100);
  const draftOpened = await D.openCardPaymentCaptureDraft({
    userId,
    channel: "web",
    chatId: "probe-draft-multi",
    debtAccountId: draftCard,
    originalCurrency: "USD",
    expectedDue: 100,
    initialRawMessage: "pagué con cuenta y préstamo",
    multiSourceRequired: true,
  });
  if (!draftOpened.ok) throw new Error("P14: no se pudo abrir el draft multifuente");
  const draftBase = {
    userId,
    debtAccountId: draftCard,
    expectedDue: 100,
    totalAmount: 60,
    originalCurrency: "USD",
    exchangeRateToBase: 1,
    baseCurrency: "USD",
    occurredAtISO: new Date().toISOString(),
    rawInput: "probe draft multi",
    inputChannel: "web",
    captureDraftId: draftOpened.draftId,
    sources: [
      { kind: "account", instrumentId: draftAccount, amount: 30 },
      { kind: "loan", instrumentId: draftLoan, clearingAccountId: draftAccount, amount: 30 },
    ],
  };
  const draftDedupe = `probe-draft-multi-${randomUUID()}`;
  const draftFirst = await M.applyMultiSourceCardPayment({
    ...draftBase,
    dedupeKey: draftDedupe,
  });
  const draftResolved = (await admin.from("card_payment_capture_drafts")
    .select("status,resolution_kind,resolved_dedupe_key,resolved_operation_id")
    .eq("id", draftOpened.draftId)
    .single()).data;
  check(
    "P14 · el pago multifuente resuelve el draft con kind+dedupe+group durables",
    draftFirst.ok === true &&
      draftResolved.status === "resolved" &&
      draftResolved.resolution_kind === "multi_source" &&
      draftResolved.resolved_dedupe_key === draftDedupe &&
      draftResolved.resolved_operation_id === (draftFirst.ok ? draftFirst.groupId : null),
    `${JSON.stringify(draftFirst)} ${JSON.stringify(draftResolved)}`,
  );
  const draftBalances = {
    account: await bal(draftAccount),
    card: await deuda(draftCard),
    loan: await deuda(draftLoan),
  };
  const draftReplay = await M.applyMultiSourceCardPayment({
    ...draftBase,
    dedupeKey: draftDedupe,
  });
  check(
    "P14b · el replay exacto del mismo draft/grupo sí pasa y no mueve otra vez",
    draftReplay.ok === true &&
      draftReplay.replayed === true &&
      (await bal(draftAccount)) === draftBalances.account &&
      (await deuda(draftCard)) === draftBalances.card &&
      (await deuda(draftLoan)) === draftBalances.loan,
    JSON.stringify(draftReplay),
  );
  const draftSecondDedupe = await M.applyMultiSourceCardPayment({
    ...draftBase,
    expectedDue: 40,
    totalAmount: 40,
    sources: [
      { kind: "account", instrumentId: draftAccount, amount: 20 },
      { kind: "loan", instrumentId: draftLoan, clearingAccountId: draftAccount, amount: 20 },
    ],
    dedupeKey: `probe-draft-second-${randomUUID()}`,
  });
  check(
    "P14c · el mismo draft con identidad NUEVA se rechaza antes de un segundo pago",
    draftSecondDedupe.ok === false &&
      (await bal(draftAccount)) === draftBalances.account &&
      (await deuda(draftCard)) === draftBalances.card &&
      (await deuda(draftLoan)) === draftBalances.loan,
    JSON.stringify(draftSecondDedupe),
  );
  const draftCrossKind = await M.applyCardPaymentEntry(
    {
      userId,
      type: "debt_payment",
      effectType: "debt_payment",
      description: "retract inválido",
      category: "debt",
      originalAmount: 40,
      originalCurrency: "USD",
      exchangeRateToBase: 1,
      baseAmount: 40,
      baseCurrency: "USD",
      sourceAccountId: draftAccount,
      debtAccountId: draftCard,
      dedupeKey: `probe-draft-cross-kind-${randomUUID()}`,
    },
    { debtAccountId: draftCard, expectedDue: 40, paidInCardCurrency: 40 },
    draftOpened.draftId,
  );
  check(
    "P14d · un draft resuelto como multifuente tampoco se consume por la ruta single",
    draftCrossKind.ok === false &&
      (await bal(draftAccount)) === draftBalances.account &&
      (await deuda(draftCard)) === draftBalances.card,
    JSON.stringify(draftCrossKind),
  );

  // ── P15 · retractación single: replay exacto, identidad nueva no ─────────
  const singleAccount = await mkAcc("Draft single cuenta P", 500);
  const singleCard = await mkDebt("Draft single tarjeta P", "credit_card", 100, 100);
  const singleOpened = await D.openCardPaymentCaptureDraft({
    userId,
    channel: "web",
    chatId: "probe-draft-single",
    debtAccountId: singleCard,
    originalCurrency: "USD",
    expectedDue: 100,
    initialRawMessage: "en realidad salió solo de la cuenta",
    multiSourceRequired: true,
  });
  if (!singleOpened.ok) throw new Error("P15: no se pudo abrir el draft single");
  const singleDedupe = `probe-draft-single-${randomUUID()}`;
  const singleEntry = {
    userId,
    type: "debt_payment",
    effectType: "debt_payment",
    description: "Pago single P",
    category: "debt",
    originalAmount: 100,
    originalCurrency: "USD",
    exchangeRateToBase: 1,
    baseAmount: 100,
    baseCurrency: "USD",
    sourceAccountId: singleAccount,
    debtAccountId: singleCard,
    dedupeKey: singleDedupe,
  };
  const singleFirst = await M.applyCardPaymentEntry(
    singleEntry,
    { debtAccountId: singleCard, expectedDue: 100, paidInCardCurrency: 100 },
    singleOpened.draftId,
  );
  const singleResolved = (await admin.from("card_payment_capture_drafts")
    .select("status,resolution_kind,resolved_dedupe_key,resolved_operation_id")
    .eq("id", singleOpened.draftId)
    .single()).data;
  check(
    "P15 · retractar el split liga el draft a la transacción single exacta",
    singleFirst.ok === true &&
      singleResolved.status === "resolved" &&
      singleResolved.resolution_kind === "single_source" &&
      singleResolved.resolved_dedupe_key === singleDedupe &&
      singleResolved.resolved_operation_id === (singleFirst.ok ? singleFirst.transactionId : null),
    `${JSON.stringify(singleFirst)} ${JSON.stringify(singleResolved)}`,
  );
  const singleBalances = {
    account: await bal(singleAccount),
    card: await deuda(singleCard),
  };
  const singleReplay = await M.applyCardPaymentEntry(
    singleEntry,
    { debtAccountId: singleCard, expectedDue: 100, paidInCardCurrency: 100 },
    singleOpened.draftId,
  );
  check(
    "P15b · replay exacto single devuelve la misma transacción sin re-reducir",
    singleReplay.ok === true &&
      singleReplay.replayed === true &&
      singleFirst.ok === true &&
      singleReplay.transactionId === singleFirst.transactionId &&
      (await bal(singleAccount)) === singleBalances.account &&
      (await deuda(singleCard)) === singleBalances.card,
    JSON.stringify(singleReplay),
  );
  const singleSecond = await M.applyCardPaymentEntry(
    { ...singleEntry, dedupeKey: `probe-draft-single-second-${randomUUID()}` },
    { debtAccountId: singleCard, expectedDue: 0, paidInCardCurrency: 1 },
    singleOpened.draftId,
  );
  check(
    "P15c · el draft single resuelto rehúsa una identidad nueva sin tocar nada",
    singleSecond.ok === false &&
      (await bal(singleAccount)) === singleBalances.account &&
      (await deuda(singleCard)) === singleBalances.card,
    JSON.stringify(singleSecond),
  );

  // ── P16 · dos sesiones consumiendo el mismo draft: exactamente una gana ─
  const raceAccount = await mkAcc("Draft race cuenta P", 500);
  const raceLoan = await mkDebt("Draft race préstamo P", "loan", 200, null);
  const raceCard = await mkDebt("Draft race tarjeta P", "credit_card", 100, 100);
  const raceOpened = await D.openCardPaymentCaptureDraft({
    userId,
    channel: "web",
    chatId: "probe-draft-race",
    debtAccountId: raceCard,
    originalCurrency: "USD",
    expectedDue: 100,
    initialRawMessage: "dos requests simultáneos",
    multiSourceRequired: true,
  });
  if (!raceOpened.ok) throw new Error("P16: no se pudo abrir el draft de carrera");
  const raceBefore = {
    account: await bal(raceAccount),
    card: await deuda(raceCard),
    loan: await deuda(raceLoan),
  };
  const racePayload = {
    userId,
    debtAccountId: raceCard,
    expectedDue: 100,
    totalAmount: 60,
    originalCurrency: "USD",
    exchangeRateToBase: 1,
    baseCurrency: "USD",
    occurredAtISO: new Date().toISOString(),
    rawInput: "probe race",
    inputChannel: "web",
    captureDraftId: raceOpened.draftId,
    sources: [
      { kind: "account", instrumentId: raceAccount, amount: 30 },
      { kind: "loan", instrumentId: raceLoan, clearingAccountId: raceAccount, amount: 30 },
    ],
  };
  const raceResults = await Promise.all([
    M.applyMultiSourceCardPayment({
      ...racePayload,
      dedupeKey: `probe-race-a-${randomUUID()}`,
    }),
    M.applyMultiSourceCardPayment({
      ...racePayload,
      dedupeKey: `probe-race-b-${randomUUID()}`,
    }),
  ]);
  const raceWinner = raceResults.filter((result) => result.ok);
  const raceResolved = (await admin.from("card_payment_capture_drafts")
    .select("status,resolved_dedupe_key,resolved_operation_id")
    .eq("id", raceOpened.draftId)
    .single()).data;
  check(
    "P16 · dos conexiones con dedupes distintos: una aplica y la otra rehúsa",
    raceWinner.length === 1 &&
      raceResolved.status === "resolved" &&
      raceResolved.resolved_operation_id === raceWinner[0].groupId &&
      (await bal(raceAccount)) === Math.round((raceBefore.account - 30) * 100) / 100 &&
      (await deuda(raceCard)) === Math.round((raceBefore.card - 60) * 100) / 100 &&
      (await deuda(raceLoan)) === Math.round((raceBefore.loan + 30) * 100) / 100,
    `${JSON.stringify(raceResults)} ${JSON.stringify(raceResolved)}`,
  );

  // ── P17 · el draft pertenece también a la foto de moneda/remanente ──────
  const snapshotCard = await mkDebt("Draft snapshot tarjeta P", "credit_card", 100, 100);
  const wrongSnapshot = await D.openCardPaymentCaptureDraft({
    userId,
    channel: "web",
    chatId: "probe-draft-wrong-snapshot",
    debtAccountId: snapshotCard,
    originalCurrency: "USD",
    expectedDue: 99,
    initialRawMessage: "foto equivocada",
    multiSourceRequired: true,
  });
  const { count: wrongSnapshotRows } = await admin.from("card_payment_capture_drafts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("chat_id", "probe-draft-wrong-snapshot");
  check(
    "P17 · abrir un draft con remanente distinto al de la tarjeta se rehúsa sin fila",
    wrongSnapshot.ok === false && (wrongSnapshotRows ?? 0) === 0,
    `${JSON.stringify(wrongSnapshot)} rows=${wrongSnapshotRows}`,
  );
  const snapshotOpened = await D.openCardPaymentCaptureDraft({
    userId,
    channel: "web",
    chatId: "probe-draft-stale-snapshot",
    debtAccountId: snapshotCard,
    originalCurrency: "USD",
    expectedDue: 100,
    initialRawMessage: "foto que luego cambia",
    multiSourceRequired: true,
  });
  if (!snapshotOpened.ok) throw new Error("P17: no se pudo abrir el draft de snapshot");
  await admin.from("debt_accounts").update({
    full_payment_due: 80,
    statement_total_due: 100,
    statement_covered: false,
  }).eq("id", snapshotCard);
  // Auditoría de Codex (P2): un `ok:false` NO prueba por sí mismo que nada
  // aterrizó. Se fotografía TODO lo que la operación tocaría y se compara después.
  const snapPre = {
    due: Number((await admin.from("debt_accounts").select("full_payment_due").eq("id", snapshotCard).single()).data.full_payment_due),
    card: await deuda(snapshotCard),
    acc: await bal(raceAccount),
    loan: await deuda(raceLoan),
    draft: (await admin.from("card_payment_capture_drafts").select("status").eq("id", snapshotOpened.draftId).single()).data.status,
    groups: (await admin.from("card_payment_groups").select("*", { count: "exact", head: true }).eq("user_id", userId)).count ?? 0,
    txns: (await admin.from("transactions").select("*", { count: "exact", head: true }).eq("user_id", userId)).count ?? 0,
  };
  const staleSnapshot = await M.applyMultiSourceCardPayment({
    userId,
    dedupeKey: `probe-stale-snapshot-${randomUUID()}`,
    debtAccountId: snapshotCard,
    expectedDue: 80,
    totalAmount: 40,
    originalCurrency: "USD",
    exchangeRateToBase: 1,
    baseCurrency: "USD",
    rawInput: "probe stale",
    inputChannel: "web",
    captureDraftId: snapshotOpened.draftId,
    sources: [
      { kind: "account", instrumentId: raceAccount, amount: 20 },
      { kind: "loan", instrumentId: raceLoan, clearingAccountId: raceAccount, amount: 20 },
    ],
  });
  const snapPost = {
    due: Number((await admin.from("debt_accounts").select("full_payment_due").eq("id", snapshotCard).single()).data.full_payment_due),
    card: await deuda(snapshotCard),
    acc: await bal(raceAccount),
    loan: await deuda(raceLoan),
    draft: (await admin.from("card_payment_capture_drafts").select("status").eq("id", snapshotOpened.draftId).single()).data.status,
    groups: (await admin.from("card_payment_groups").select("*", { count: "exact", head: true }).eq("user_id", userId)).count ?? 0,
    txns: (await admin.from("transactions").select("*", { count: "exact", head: true }).eq("user_id", userId)).count ?? 0,
  };
  check(
    "P17b · si el remanente cambia después de abrir, el draft viejo no cruza de ciclo",
    staleSnapshot.ok === false &&
      // CERO writes probado campo por campo: el `full_payment_due` que cambió de
      // 100 a 80 sigue en 80, las tres patas intactas, el draft sigue `open` y
      // no nació ni un grupo ni una transacción.
      snapPost.due === snapPre.due &&
      snapPost.card === snapPre.card &&
      snapPost.acc === snapPre.acc &&
      snapPost.loan === snapPre.loan &&
      snapPost.draft === "open" &&
      snapPost.groups === snapPre.groups &&
      snapPost.txns === snapPre.txns,
    `${JSON.stringify(staleSnapshot)} pre=${JSON.stringify(snapPre)} post=${JSON.stringify(snapPost)}`,
  );

  console.log(`\n${pass} verdes, ${fails.length} rojos`);
  if (fails.length) console.log("  rojos: " + fails.join(" | "));
} finally {
  if (userId) {
    for (const t of TOUCHED) {
      const col = t === "profiles" ? "id" : "user_id";
      await admin.from(t).delete().eq(col, userId).then(() => {}, () => {});
    }
    await admin.from("receivables").delete().eq("user_id", userId).then(() => {}, () => {});
    const del = await admin.auth.admin.deleteUser(userId).then(() => true, () => false);
    let residuo = 0;
    for (const t of [...TOUCHED, "receivables"]) {
      const col = t === "profiles" ? "id" : "user_id";
      const { count, error } = await admin.from(t).select("*", { count: "exact", head: true }).eq(col, userId);
      if (error) { residuo += 1; continue; }
      residuo += count ?? 0;
    }
    if (residuo === 0 && del) {
      console.log("limpieza: residuo cero verificado");
    } else {
      // Auditoría de Codex (P2): imprimir «LIMPIEZA INCOMPLETA` y salir 0 hace que
      // CI lea verde sobre una base sucia. El residuo es un FALLO del harness.
      console.log(`LIMPIEZA INCOMPLETA (${residuo} filas, deleteUser=${del})`);
      fails.push("limpieza incompleta: el harness dejó residuo en la base");
    }
  }
}
process.exit(fails.length ? 1 : 0);
