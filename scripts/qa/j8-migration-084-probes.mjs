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

let pass = 0;
const fails = [];
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log(`  ok   · ${name}`); }
  else { fails.push(name); console.log(`  FALL · ${name}\n         ${detail ?? ""}`); }
};

let userId = null;
const TOUCHED = [
  "card_payment_group_legs", "card_payment_groups", "card_payment_capture_drafts",
  "installment_plan_purchase_applications", "account_close_applications",
  "fixed_expense_payment_applications", "card_payment_applications",
  "installment_plans", "transactions", "debt_accounts", "accounts", "profiles",
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
  check("P3b · y nada se movió", (await bal(cuenta)) === c2 && (await deuda(tarjeta)) === d2);

  // ── P4 · las patas que no suman el total ⇒ cero writes ───────────────────
  const c4 = await bal(cuenta), d4 = await deuda(tarjeta);
  const r4 = await M.applyMultiSourceCardPayment({
    ...base, dedupeKey: `probe-bad-${randomUUID()}`, expectedDue: await deuda(tarjeta),
    sources: [{ kind: "account", instrumentId: cuenta, amount: 100 },
              { kind: "loan", instrumentId: prestamo, clearingAccountId: cuenta, amount: 100 }],
  });
  check("P4 · patas que no suman el total: RECHAZADO", r4.ok === false, JSON.stringify(r4));
  check("P4b · y cero writes", (await bal(cuenta)) === c4 && (await deuda(tarjeta)) === d4);

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
    console.log(residuo === 0 && del ? "limpieza: residuo cero verificado" : `LIMPIEZA INCOMPLETA (${residuo} filas, deleteUser=${del})`);
  }
}
process.exit(fails.length ? 1 : 0);
