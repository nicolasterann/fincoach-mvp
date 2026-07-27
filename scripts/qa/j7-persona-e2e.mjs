// Bloque J (J-7) — E2E con PERSONA DESECHABLE contra la base REAL.
//
// Por qué existe, y qué prueba que ningún gate estático puede probar:
//
//   El capture gate corre funciones puras y marcas de código. Los harnesses J-2 /
//   J-3 / J-4 leen fuentes. Ninguno de los tres toca la base, así que ninguno
//   puede responder la única pregunta que importa al final: ¿el dinero se movió
//   —o NO se movió— como decimos? Este script escribe de verdad, contra el
//   Postgres real, con los triggers reales, usando el WRITER REAL del producto
//   (`applyChatTransactionIntent`), y después mira los balances.
//
//   Y prueba las DOS capas por separado, que es el punto:
//     · capa TS   — el applier rehúsa antes de escribir.
//     · capa DB   — un INSERT CRUDO con service_role, saltándose todo TypeScript,
//                   tiene que ser rechazado igual por el trigger.
//   Un guard que solo vive en TypeScript es un guard que el próximo caller se
//   salta. Los brazos crudos son los que verifican la migración 078; mientras no
//   esté aplicada, este script lo DICE en vez de dar verde.
//
// Persona desechable, limpieza en `finally`, y verificación explícita de residuo
// cero: un harness de QA que ensucia la base al fallar a medias es peor que no
// tenerlo, porque el residuo reaparece después sin dueño.
//
//   node --env-file=.env.local ./scripts/qa/j7-persona-e2e.mjs

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
    const target = fs.existsSync(`${base}.ts`) ? `${base}.ts` : fs.existsSync(`${base}.tsx`) ? `${base}.tsx` : base;
    return nextResolve(pathToFileURL(target).href, context);
  },
});

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SRK) throw new Error("faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (usá --env-file=.env.local)");

const admin = createClient(URL_, SRK, { auth: { persistSession: false } });
const { applyChatTransactionIntent } = await import("@/lib/ai/apply-chat-transaction-intent");
const { applyInvestmentOccurrenceWith } = await import("@/lib/financial/recurring-ledger");
const { setSavingsPlanStatus, updateSavingsPlanAmountWith } = await import("@/lib/financial/savings-plans-store");
const { publishObjectiveMonthCloseWith } = await import("@/lib/financial/objective-closes-store");
const { publishAmbientCoachMessageWith } = await import("@/lib/ambient/ambient-store");

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`  ok   · ${name}`); }
  else { fails.push(name); console.log(`  FALL · ${name}\n         ${detail ?? ""}`); }
}

// Un rechazo NO puede confundirse con "falló cualquier otra cosa": se exige que
// el error sea el del guard, no un 500 genérico ni un NOT NULL.
async function refuses(fn, marker) {
  try { await fn(); return { refused: false, why: "no lanzó: el write pasó" }; }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { refused: msg.includes(marker), why: msg.slice(0, 160) };
  }
}

let userId = null;
const ids = {};
try {
  // ── persona ────────────────────────────────────────────────────────────────
  const email = `kipu-j7e2e-${Date.now()}@example.invalid`;
  const { data: u, error: eU } = await admin.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { kipu_smoke: true },
  });
  if (eU) throw new Error("createUser: " + eU.message);
  userId = u.user.id;
  console.log(`persona desechable: ${userId}`);

  // Base USD con cuentas ARS — el combo EXACTO que corrompió prod en julio.
  await admin.from("profiles").upsert({ id: userId, base_currency: "USD", onboarding_completed: true });
  const domainAccounts = [];
  const mkAcc = async (key, name, currency, bal) => {
    const { data, error } = await admin.from("accounts")
      .insert({ user_id: userId, name, type: "bank", currency,
                current_balance_original: bal, current_balance_base: currency === "USD" ? bal : bal / 1000 })
      .select("id").single();
    if (error) throw new Error(`account ${key}: ${error.message}`);
    ids[key] = data.id;
    domainAccounts.push({
      id: data.id, userId, name, type: "bank", currency,
      currentBalanceOriginal: bal, currentBalanceBase: currency === "USD" ? bal : bal / 1000,
      isGoalAccount: false,
    });
  };
  await mkAcc("ars", "Supervielle E2E", "ARS", 200000);
  await mkAcc("ars2", "Efectivo E2E", "ARS", 50000);
  await mkAcc("usd", "Pichincha E2E", "USD", 500);

  const bal = async (key) => {
    const { data } = await admin.from("accounts").select("current_balance_original").eq("id", ids[key]).single();
    return Number(data?.current_balance_original ?? NaN);
  };
  const apply = (intent) => applyChatTransactionIntent({
    userId, message: "e2e", intent, accounts: domainAccounts, debtAccounts: [], goals: [],
    parserSource: "ai", parserConfidenceScore: 0.9, channel: "web",
  });
  const common = { baseCurrency: "USD", exchangeRateToBase: 0.001, confidenceScore: 0.9, status: "ready", category: "other" };
  // El INSERT CRUDO se salta TypeScript entero: es la única forma de interrogar
  // al trigger. Si pasa, el guard de DB no está.
  const raw = (row) => admin.from("transactions")
    .insert({ user_id: userId, base_currency: "USD", exchange_rate_to_base: 0.001, description: "e2e-raw", ...row })
    .select("id").single();

  // ── E1 · J-1: un gasto ARS no puede aterrizar en la cuenta USD ─────────────
  const usd0 = await bal("usd");
  const r1 = await refuses(() => apply({ ...common, type: "expense", description: "e2e",
    originalAmount: 33000, originalCurrency: "ARS", sourceAccountId: ids.usd }), "KIPU_NEEDS_INFO");
  check("E1 · J-1 · 33000 ARS contra cuenta USD: rehusado por el applier", r1.refused, r1.why);
  check("E1b · y el balance USD quedó INTACTO", (await bal("usd")) === usd0, `antes ${usd0}, ahora ${await bal("usd")}`);

  // ── E2 · el caso legítimo sigue vivo (que no sea un cerrojo) ───────────────
  const ars0 = await bal("ars");
  let e2err = null;
  try { await apply({ ...common, type: "expense", description: "e2e gasto ok",
    originalAmount: 33000, originalCurrency: "ARS", sourceAccountId: ids.ars }); }
  catch (e) { e2err = e instanceof Error ? e.message : String(e); }
  check("E2 · gasto ARS desde cuenta ARS: se registra", e2err === null, e2err ?? "");
  check("E2b · y el balance ARS bajó exactamente 33000", (await bal("ars")) === ars0 - 33000, `${ars0} → ${await bal("ars")}`);

  // ── E3 · J-7 · transferencia ENTRE MONEDAS: la puerta que J-1 dejó abierta ──
  const a3 = await bal("ars"), u3 = await bal("usd");
  const r3 = await refuses(() => apply({ ...common, type: "transfer", description: "e2e",
    originalAmount: 50000, originalCurrency: "ARS", sourceAccountId: ids.ars, destinationAccountId: ids.usd }), "KIPU_NEEDS_INFO");
  check("E3 · J-7 · transfer ARS→USD: rehusado por el applier", r3.refused, r3.why);
  check("E3b · el mensaje NO pide un tipo de cambio (sería un cerrojo)",
    r3.refused && !r3.why.toLowerCase().includes("tipo de cambio"), r3.why);
  check("E3c · ningún balance se movió", (await bal("ars")) === a3 && (await bal("usd")) === u3);

  // ── E4 · la MISMA transferencia, cruda: interroga al TRIGGER (migración 078) ─
  const { data: d4, error: e4 } = await raw({ type: "transfer", original_amount: 50000, original_currency: "ARS",
    base_amount: 50, source_account_id: ids.ars, destination_account_id: ids.usd });
  const trigger078 = !!e4 && String(e4.message).includes("KIPU_FX_REQUIRED");
  check("E4 · capa DB · insert CRUDO de transfer cruzado: rechazado por el trigger (078)",
    trigger078, e4 ? String(e4.message).slice(0, 150) : "PASÓ: la 078 NO está aplicada — el guard vive solo en TypeScript");
  if (d4?.id) await admin.from("transactions").delete().eq("id", d4.id);

  // ── E5 · refund crudo hacia una cuenta en otra moneda ───────────────────────
  const { data: d5, error: e5 } = await raw({ type: "refund", original_amount: 100, original_currency: "USD",
    base_amount: 100, destination_account_id: ids.ars });
  const refund078 = !!e5 && String(e5.message).includes("KIPU_FX_REQUIRED");
  check("E5 · capa DB · insert CRUDO de refund en moneda ajena: rechazado por el trigger (078)",
    refund078, e5 ? String(e5.message).slice(0, 150) : "PASÓ: la 078 NO está aplicada");
  if (d5?.id) await admin.from("transactions").delete().eq("id", d5.id);

  // ── E6 · transferencia legítima ARS→ARS: NO puede quedar bloqueada ──────────
  const a6 = await bal("ars"), b6 = await bal("ars2");
  let e6err = null;
  try { await apply({ ...common, type: "transfer", description: "e2e movida",
    originalAmount: 10000, originalCurrency: "ARS", sourceAccountId: ids.ars, destinationAccountId: ids.ars2 }); }
  catch (e) { e6err = e instanceof Error ? e.message : String(e); }
  check("E6 · transfer ARS→ARS legítima: se registra (el guard no es un cerrojo)", e6err === null, e6err ?? "");
  check("E6b · y movió las dos patas por igual",
    (await bal("ars")) === a6 - 10000 && (await bal("ars2")) === b6 + 10000,
    `origen ${a6}→${await bal("ars")}, destino ${b6}→${await bal("ars2")}`);

  // ── E7 · J-5/J-7 · responder cierra la pregunta, y el resultado se VERIFICA ──
  const { resolveOccurrence } = await import("@/lib/financial/recurring-resolve");
  const { data: fx, error: eFx } = await admin.from("fixed_expenses").insert({
    user_id: userId, name: "Internet E2E", amount: 1000, currency: "ARS",
  }).select("id").single();
  if (eFx) throw new Error("fixed_expense: " + eFx.message);
  const { data: occ, error: eOcc } = await admin.from("recurring_occurrences").insert({
    user_id: userId, kind: "expense", occurrence_date: new Date().toISOString().slice(0, 10),
    mode: "ask", status: "pending", expected_amount: 1000, currency: "ARS", fixed_expense_id: fx.id,
  }).select("id").single();
  if (eOcc) throw new Error("occurrence: " + eOcc.message);
  const res = await resolveOccurrence({ userId, occurrenceId: occ.id, action: "dismiss" });
  const { data: after } = await admin.from("recurring_occurrences").select("status").eq("id", occ.id).single();
  check("E7 · J-5 · un dismiss que dice ok DEJÓ la ocurrencia cerrada de verdad",
    res.ok === true && after?.status === "dismissed", `res=${JSON.stringify(res)} status=${after?.status}`);
  // Repetirlo NO puede volver a decir ok: ya está resuelta.
  const res2 = await resolveOccurrence({ userId, occurrenceId: occ.id, action: "dismiss" });
  check("E7b · y repetirlo no finge un cierre nuevo", res2.ok === false, JSON.stringify(res2));

  // ── E8/E9 · reversal sigue exenta; adjustment ya NO depende de convención ──
  // `reversal` debe poder espejar una fila histórica mala para corregirla.
  // `adjustment`, en cambio, mueve el ORIGINAL de una sola cuenta: dejarlo
  // exento permitía 100 ARS contra una cuenta USD desde cualquier caller nuevo.
  // La 079 lo valida; los writers legítimos ya usan la moneda de su cuenta.
  const { data: d8, error: e8 } = await raw({ type: "reversal", original_amount: 33000, original_currency: "ARS",
    base_amount: 33, destination_account_id: ids.usd });
  check("E8 · regresión · `reversal` en moneda ajena SIGUE exento (poder corregir el pasado)",
    !e8, e8 ? String(e8.message).slice(0, 150) : "");
  if (d8?.id) await admin.from("transactions").delete().eq("id", d8.id);

  const { data: d9, error: e9 } = await raw({ type: "adjustment", original_amount: 100, original_currency: "ARS",
    base_amount: 0.1, source_account_id: ids.usd });
  const adjustment079 = !!e9 && String(e9.message).includes("KIPU_FX_REQUIRED");
  check("E9 · `adjustment` en moneda ajena queda rechazado por la 079",
    adjustment079, e9 ? String(e9.message).slice(0, 150) : "PASÓ: la 079 NO está aplicada");
  if (d9?.id) await admin.from("transactions").delete().eq("id", d9.id);
  const { data: d9b, error: e9b } = await raw({ type: "adjustment", original_amount: 100, original_currency: "ARS",
    base_amount: 0.1, source_account_id: ids.ars });
  check("E9b · `adjustment` coherente sigue permitido (el guard no es un cerrojo)",
    !e9b, e9b ? String(e9b.message).slice(0, 150) : "");
  if (d9b?.id) await admin.from("transactions").delete().eq("id", d9b.id);

  // ── E10 · el OTRO fallo: patas coherentes entre sí, movimiento en una tercera ─
  const { data: d10, error: e10 } = await raw({ type: "transfer", original_amount: 100, original_currency: "USD",
    base_amount: 100, source_account_id: ids.ars, destination_account_id: ids.ars2 });
  check("E10 · transfer ARS→ARS declarado en USD: rechazado (no es sólo el cruce de patas)",
    !!e10 && String(e10.message).includes("KIPU_FX_REQUIRED"), e10 ? "" : "PASÓ: el guard sólo mira patas contra patas");
  if (d10?.id) await admin.from("transactions").delete().eq("id", d10.id);

  // ── E11 · el guard sigue mirando la BASE contra el perfil (invariante 070) ────
  const { data: d11, error: e11 } = await raw({ type: "transfer", original_amount: 100, original_currency: "ARS",
    base_amount: 100, base_currency: "EUR", source_account_id: ids.ars, destination_account_id: ids.ars2 });
  check("E11 · transfer con base EUR contra perfil USD: rechazado (la base sigue validándose)",
    !!e11 && String(e11.message).includes("KIPU_FX_REQUIRED"), e11 ? "" : "PASÓ: la base no se valida en transfer");
  if (d11?.id) await admin.from("transactions").delete().eq("id", d11.id);

  // ── E12 · inversión: caja + activo + ocurrencia, una sola transacción ─────
  const { data: asset12, error: eAsset12 } = await admin.from("investment_accounts").insert({
    user_id: userId, name: "Etoro E2E", asset_class: "investment",
    value_base: 0, value_original: 0, currency: "USD",
  }).select("id").single();
  if (eAsset12) throw new Error("asset E12: " + eAsset12.message);
  const { data: plan12, error: ePlan12 } = await admin.from("savings_plans").insert({
    user_id: userId, kind: "investment", name: "Inversión E2E",
    amount_base: 10, original_amount: 10, original_currency: "USD", base_currency: "USD",
    frequency: "monthly", expected_day: 1, source_account_id: ids.usd,
    destination_asset_id: asset12.id,
  }).select("id").single();
  if (ePlan12) throw new Error("plan E12: " + ePlan12.message);
  const { data: occ12, error: eOcc12 } = await admin.from("recurring_occurrences").insert({
    user_id: userId, savings_plan_id: plan12.id, occurrence_date: "2099-01-01",
    kind: "investment", mode: "ask", expected_amount: 10, currency: "USD", status: "pending",
  }).select("id").single();
  if (eOcc12) throw new Error("occ E12: " + eOcc12.message);
  const usd12 = await bal("usd");
  const investmentInput12 = {
    userId,
    occurrenceId: occ12.id,
    action: "confirm",
    sourceAccountId: ids.usd,
    sourceAccountCurrency: "USD",
    assetId: asset12.id,
    assetCurrency: "USD",
    nativeAmount: 10,
    nativeCurrency: "USD",
    base: "USD",
    rates: [],
    dedupeKey: `e2e-investment:${occ12.id}`,
    occurredAtISO: "2099-01-01T12:00:00.000Z",
    description: "Inversión E2E",
  };
  const inv12a = await applyInvestmentOccurrenceWith(admin, investmentInput12);
  const inv12b = await applyInvestmentOccurrenceWith(admin, investmentInput12);
  const inv12c = await applyInvestmentOccurrenceWith(admin, {
    ...investmentInput12,
    description: "Inversión E2E ALTERADA",
  });
  const [{ data: asset12After }, { data: occ12After }, { count: marker12 }] = await Promise.all([
    admin.from("investment_accounts").select("value_base, value_original").eq("id", asset12.id).single(),
    admin.from("recurring_occurrences").select("status, resolved_amount, resolved_currency, created_transaction_id").eq("id", occ12.id).single(),
    admin.from("investment_occurrence_applications").select("id", { count: "exact", head: true }).eq("occurrence_id", occ12.id),
  ]);
  check("E12 · inversión atómica: caja baja y activo sube juntos",
    inv12a?.replayed === false && (await bal("usd")) === usd12 - 10 &&
      Number(asset12After?.value_base) === 10 && Number(asset12After?.value_original) === 10,
    JSON.stringify({ first: inv12a, cash: `${usd12}→${await bal("usd")}`, asset: asset12After }));
  check("E12b · ocurrencia guarda monto/moneda real y la misma transacción",
    occ12After?.status === "confirmed" && Number(occ12After?.resolved_amount) === 10 &&
      occ12After?.resolved_currency === "USD" &&
      occ12After?.created_transaction_id === inv12a?.txId,
    JSON.stringify(occ12After));
  check("E12c · replay no vuelve a mover dinero ni activo",
    inv12b?.replayed === true && inv12b.txId === inv12a?.txId && marker12 === 1 &&
      (await bal("usd")) === usd12 - 10 && Number(asset12After?.value_base) === 10,
    JSON.stringify({ replay: inv12b, marker12 }));
  check("E12d · replay con payload distinto se rechaza por fingerprint",
    inv12c === null && (await bal("usd")) === usd12 - 10 &&
      Number(asset12After?.value_base) === 10 && marker12 === 1,
    JSON.stringify({ altered: inv12c, cash: await bal("usd"), asset: asset12After, marker12 }));

  // 15 USD son un compromiso agregado legacy sin plan; deben sobrevivir a una
  // corrección del plan. El componente respaldado por planes se recalcula.
  const { error: ePrefs12 } = await admin.from("user_financial_preferences").upsert({
    user_id: userId,
    monthly_savings_commitment: 0,
    monthly_investment_commitment: 25, // residual 15 + plan activo 10
  }, { onConflict: "user_id" });
  if (ePrefs12) throw new Error("prefs E12: " + ePrefs12.message);

  const plan12Update = await updateSavingsPlanAmountWith(
    { call: (args) => admin.rpc("kipu_update_savings_plan_amount", args) },
    {
      userId, planId: plan12.id, amount: 20, currency: "USD",
      amountBase: 20, baseCurrency: "USD",
    },
  );
  const plan12Replay = await updateSavingsPlanAmountWith(
    { call: (args) => admin.rpc("kipu_update_savings_plan_amount", args) },
    {
      userId, planId: plan12.id, amount: 20, currency: "USD",
      amountBase: 20, baseCurrency: "USD",
    },
  );
  const [{ data: plan12After }, { data: prefs12After }] = await Promise.all([
    admin.from("savings_plans").select("original_amount, amount_base").eq("id", plan12.id).single(),
    admin.from("user_financial_preferences")
      .select("monthly_savings_commitment, monthly_investment_commitment")
      .eq("user_id", userId).single(),
  ]);
  check("E12e · corrección permanente actualiza plan y capacidad juntos",
    plan12Update.ok && plan12Update.outcome === "updated" &&
      Number(plan12After?.original_amount) === 20 &&
      Number(plan12After?.amount_base) === 20 &&
      Number(prefs12After?.monthly_investment_commitment) === 35,
    JSON.stringify({ plan12Update, plan12After, prefs12After }));
  check("E12f · replay es idempotente y preserva el residual agregado sin plan",
    plan12Replay.ok && plan12Replay.outcome === "already_updated" &&
      Number(prefs12After?.monthly_investment_commitment) === 35,
    JSON.stringify({ plan12Replay, prefs12After }));
  const paused12 = await setSavingsPlanStatus({
    userId, id: plan12.id, status: "paused",
  });
  const { data: prefs12Paused } = await admin.from("user_financial_preferences")
    .select("monthly_investment_commitment").eq("user_id", userId).single();
  const resumed12 = await setSavingsPlanStatus({
    userId, id: plan12.id, status: "active",
  });
  const { data: prefs12Resumed } = await admin.from("user_financial_preferences")
    .select("monthly_investment_commitment").eq("user_id", userId).single();
  check("E12g · pausar y reanudar también actualiza la capacidad atómicamente",
    paused12 && resumed12 &&
      Number(prefs12Paused?.monthly_investment_commitment) === 15 &&
      Number(prefs12Resumed?.monthly_investment_commitment) === 35,
    JSON.stringify({ paused12, prefs12Paused, resumed12, prefs12Resumed }));

  // ── E13 · cierre mensual: mensaje + filas + claim exactamente juntos ──────
  const closeToken13 = randomUUID();
  const { data: claim13, error: eClaim13 } = await admin.rpc("kipu_claim_proactive_nudge", {
    p_user_id: userId,
    p_topic: "objective_month_close",
    p_day_bucket: "2099-02-01",
    p_reason: "e2e cierre",
    p_priority: 2,
    p_channel: "web",
    p_total_cap: 2,
    p_budget_lane: "coach",
    p_lane_cap: 2,
    p_claim_token: closeToken13,
    p_claim_payload: { objectiveCloseMonth: "2099-01" },
  });
  if (eClaim13 || !claim13?.id) throw new Error("claim E13: " + (eClaim13?.message ?? "sin id"));
  const closeInput13 = {
    userId,
    claimId: String(claim13.id),
    claimToken: closeToken13,
    month: "2099-01",
    content: "Cierre E2E",
    closes: [{
      category: "food", labelEs: "comida", objectiveBase: 500, spentBase: 450,
      extraordinaryBase: 20, surplusBase: 50, excessBase: 0, excessDrainedBase: 0,
    }],
  };
  const close13WrongMonth = await publishObjectiveMonthCloseWith(admin, {
    ...closeInput13,
    month: "2099-02",
  });
  const [{ count: wrongMonthRows13 }, { count: wrongMonthMessages13 }] = await Promise.all([
    admin.from("objective_month_closes").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("month", "2099-02"),
    admin.from("chat_messages").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("content", "Cierre E2E"),
  ]);
  check("E13-pre · un claim no puede cerrar otro mes",
    !close13WrongMonth.ok && close13WrongMonth.reason === "conflict" &&
      wrongMonthRows13 === 0 && wrongMonthMessages13 === 0,
    JSON.stringify({ close13WrongMonth, wrongMonthRows13, wrongMonthMessages13 }));
  const close13a = await publishObjectiveMonthCloseWith(admin, closeInput13);
  const close13b = await publishObjectiveMonthCloseWith(admin, closeInput13);
  const close13c = await publishObjectiveMonthCloseWith(admin, {
    ...closeInput13,
    content: "Cierre E2E ALTERADO",
  });
  const [{ count: messages13 }, { count: rows13 }, { data: claim13After }] = await Promise.all([
    admin.from("chat_messages").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("content", "Cierre E2E"),
    admin.from("objective_month_closes").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("month", "2099-01"),
    admin.from("ambient_nudges").select("delivered, web_message_id, finalized_at")
      .eq("id", String(claim13.id)).single(),
  ]);
  check("E13 · cierre atómico publica mensaje, fila y claim como un solo hecho",
    close13a.ok && close13a.outcome === "published" && messages13 === 1 && rows13 === 1 &&
      claim13After?.delivered === true && claim13After?.web_message_id === close13a.webMessageId &&
      !!claim13After?.finalized_at,
    JSON.stringify({ close13a, messages13, rows13, claim13After }));
  check("E13b · replay devuelve la misma publicación sin duplicar",
    close13b.ok && close13b.outcome === "replayed" &&
      close13b.webMessageId === (close13a.ok ? close13a.webMessageId : "") &&
      messages13 === 1 && rows13 === 1,
    JSON.stringify(close13b));
  check("E13c · replay con payload distinto se rechaza por fingerprint",
    !close13c.ok && close13c.reason === "conflict" && messages13 === 1 && rows13 === 1,
    JSON.stringify(close13c));

  // ── E14 · coach ambient: procedencia durable ANTES del efecto externo ──────
  const coachToken14 = randomUUID();
  const { data: claim14, error: eClaim14 } = await admin.rpc("kipu_claim_proactive_nudge", {
    p_user_id: userId,
    p_topic: "cashflow_caution",
    p_day_bucket: "2099-02-01",
    p_reason: "e2e coach",
    p_priority: 2,
    p_channel: "telegram",
    p_total_cap: 2,
    p_budget_lane: "coach",
    p_lane_cap: 2,
    p_claim_token: coachToken14,
    p_claim_payload: {},
  });
  if (eClaim14 || !claim14?.id) throw new Error("claim E14: " + (eClaim14?.message ?? "sin id"));
  const coachInput14 = {
    userId,
    claimId: String(claim14.id),
    claimToken: coachToken14,
    chatId: "telegram-e2e",
    topic: "cashflow_caution",
    content: "Coach E2E",
  };
  const coachRpc14 = {
    call: (args) => admin.rpc("kipu_publish_ambient_coach_message_v2", args),
  };
  const coach14a = await publishAmbientCoachMessageWith(coachInput14, coachRpc14);
  const coach14b = await publishAmbientCoachMessageWith(coachInput14, coachRpc14);
  const coach14c = await publishAmbientCoachMessageWith({
    ...coachInput14,
    content: "Coach E2E ALTERADO",
  }, coachRpc14);
  const [{ data: messages14 }, { data: claim14After }, { data: nudge14 }] = await Promise.all([
    admin.from("chat_messages").select("id, channel, chat_id, metadata")
      .eq("user_id", userId).eq("content", "Coach E2E"),
    admin.from("ambient_nudges").select("delivered, web_message_id, finalized_at")
      .eq("id", String(claim14.id)).single(),
    admin.from("coach_nudge_log").select("signal_kind, last_surfaced_at")
      .eq("user_id", userId).eq("signal_kind", "cashflow_caution").single(),
  ]);
  check("E14 · coach ambient publica el turno atribuido y finaliza el claim juntos",
    coach14a.ok && coach14a.outcome === "published" && messages14?.length === 1 &&
      messages14[0]?.channel === "telegram" && messages14[0]?.chat_id === "telegram-e2e" &&
      messages14[0]?.metadata?.source === "ambient" &&
      messages14[0]?.metadata?.topic === "cashflow_caution" &&
      claim14After?.delivered === true &&
      claim14After?.web_message_id === coach14a.webMessageId &&
      !!claim14After?.finalized_at &&
      nudge14?.signal_kind === "cashflow_caution" &&
      !!nudge14?.last_surfaced_at,
    JSON.stringify({ coach14a, messages14, claim14After, nudge14 }));
  check("E14b · replay devuelve el mismo turno sin duplicarlo",
    coach14b.ok && coach14b.outcome === "replayed" &&
      coach14b.webMessageId === (coach14a.ok ? coach14a.webMessageId : "") &&
      messages14?.length === 1,
    JSON.stringify(coach14b));
  check("E14c · replay alterado se rehúsa por fingerprint",
    !coach14c.ok && coach14c.reason === "conflict" && messages14?.length === 1,
    JSON.stringify(coach14c));

  // ── E15 · recordatorio: chat + cooldown + consumo, una transacción ───────
  const { data: note15, error: eNote15 } = await admin.from("user_context_notes").insert({
    user_id: userId,
    source: "system",
    content: "RECORDATORIO (2099-02-02): E2E",
    is_active: true,
  }).select("id").single();
  if (eNote15) throw new Error("note E15: " + eNote15.message);
  const reminderToken15 = randomUUID();
  const { data: claim15, error: eClaim15 } = await admin.rpc("kipu_claim_proactive_nudge", {
    p_user_id: userId,
    p_topic: "scheduled_reminder_due",
    p_day_bucket: "2099-02-02",
    p_reason: "e2e reminder",
    p_priority: 2,
    p_channel: "telegram",
    p_total_cap: 2,
    p_budget_lane: "coach",
    p_lane_cap: 2,
    p_claim_token: reminderToken15,
    p_claim_payload: { reminderIds: [note15.id] },
  });
  if (eClaim15 || !claim15?.id) throw new Error("claim E15: " + (eClaim15?.message ?? "sin id"));
  const reminder15 = await publishAmbientCoachMessageWith({
    userId,
    claimId: String(claim15.id),
    claimToken: reminderToken15,
    chatId: "telegram-e2e",
    topic: "scheduled_reminder_due",
    content: "Recordatorio E2E",
  }, coachRpc14);
  const [{ data: note15After }, { data: nudge15 }, { count: message15 }] = await Promise.all([
    admin.from("user_context_notes").select("is_active").eq("id", note15.id).single(),
    admin.from("coach_nudge_log").select("signal_kind").eq("user_id", userId)
      .eq("signal_kind", "scheduled_reminder_due").single(),
    admin.from("chat_messages").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("content", "Recordatorio E2E"),
  ]);
  check("E15 · publicar un recordatorio deja mensaje, cooldown y nota consumida juntos",
    reminder15.ok && note15After?.is_active === false &&
      nudge15?.signal_kind === "scheduled_reminder_due" && message15 === 1,
    JSON.stringify({ reminder15, note15After, nudge15, message15 }));

  // ── E16 · los conflictos deterministas del digest ya no son 40001 ─────────
  const { data: occ16, error: eOcc16 } = await admin.from("recurring_occurrences").insert({
    user_id: userId, kind: "expense", occurrence_date: "2099-02-03",
    mode: "ask", status: "pending", expected_amount: 1000, currency: "ARS",
    fixed_expense_id: fx.id,
  }).select("id").single();
  if (eOcc16) throw new Error("occ E16: " + eOcc16.message);
  const digestToken16 = randomUUID();
  const { data: claim16, error: eClaim16 } = await admin.rpc("kipu_claim_proactive_nudge", {
    p_user_id: userId,
    p_topic: "calendar_digest",
    p_day_bucket: "2099-02-03",
    p_reason: "e2e calendar",
    p_priority: 2,
    p_channel: "web",
    p_total_cap: 2,
    p_budget_lane: "calendar",
    p_lane_cap: 2,
    p_claim_token: digestToken16,
    p_claim_payload: {
      version: 1,
      today: "2099-02-03",
      confirms: [],
      asks: [{ id: occ16.id, expectedAskCount: 0 }],
    },
  });
  if (eClaim16 || !claim16?.id) throw new Error("claim E16: " + (eClaim16?.message ?? "sin id"));
  const { error: conflict16 } = await admin.rpc("kipu_publish_calendar_digest_v2", {
    p_user_id: userId,
    p_claim_id: String(claim16.id),
    p_claim_token: randomUUID(),
    p_content: "Digest E2E",
  });
  const { data: occ16After } = await admin.from("recurring_occurrences")
    .select("ask_count, last_asked_on").eq("id", occ16.id).single();
  check("E16 · un lease inválido del digest llega como 22023 determinista y no toca la ocurrencia",
    conflict16?.code === "22023" &&
      String(conflict16.message).includes("KIPU_CONFLICT") &&
      Number(occ16After?.ask_count) === 0 &&
      occ16After?.last_asked_on == null,
    JSON.stringify({ conflict16, occ16After }));

  // ── E17 · tras el rollout, service_role no puede saltarse las v2 ──────────
  const legacyArgs17 = {
    calendar: ["kipu_publish_calendar_digest", {
      p_user_id: userId, p_claim_id: String(claim16.id),
      p_claim_token: digestToken16, p_content: "legacy",
    }],
    close: ["kipu_publish_objective_month_close", {
      p_user_id: userId, p_claim_id: String(claim13.id), p_claim_token: closeToken13,
      p_month: "2099-01", p_content: "legacy", p_closes: closeInput13.closes,
    }],
    ambient: ["kipu_publish_ambient_coach_message", {
      p_user_id: userId, p_claim_id: String(claim14.id), p_claim_token: coachToken14,
      p_chat_id: "telegram-e2e", p_topic: "cashflow_caution", p_content: "legacy",
    }],
    householdAdd: ["kipu_add_shared_expense", { p: {} }],
    householdUpdate: ["kipu_update_shared_expense", { p: {} }],
    statement: ["kipu_set_card_statement", { p: {} }],
    dueOverride: ["kipu_override_debt_due", { p: {} }],
    cardPayment: ["kipu_apply_card_payment", { p_entry: {}, p_statement: {} }],
    cardReconcile: ["kipu_reconcile_existing_card_payment", { p: {} }],
    investment: ["kipu_apply_investment_occurrence", {
      p_user_id: userId,
      p_occurrence_id: randomUUID(),
      p_action: "confirm",
      p_payload: {},
    }],
    repayment: ["kipu_apply_repayment", { p_entry: {}, p_allocations: [] }],
    householdSettle: ["kipu_settle_household", { p: {} }],
    debtSnapshot: ["kipu_update_debt_snapshot", { p: {} }],
    accountCurrency: ["kipu_change_account_currency", { p: {} }],
    baseCurrency: ["kipu_change_base_currency", { p: {} }],
  };
  const legacyErrors17 = {};
  for (const [key, [name, args]] of Object.entries(legacyArgs17)) {
    const { error } = await admin.rpc(name, args);
    legacyErrors17[key] = error;
  }
  check("E17 · service_role sólo puede escribir por las v2; los quince cores legacy quedaron cerrados",
    Object.values(legacyErrors17).every((error) =>
      error && /permission denied/i.test(String(error.message))),
    JSON.stringify(legacyErrors17));
  const { data: planBefore17 } = await admin.from("savings_plans")
    .select("amount_base").eq("id", plan12.id).single();
  const { error: directPlanError17 } = await admin.from("savings_plans")
    .update({ amount_base: Number(planBefore17?.amount_base ?? 0) + 1 })
    .eq("id", plan12.id);
  const { data: planAfter17 } = await admin.from("savings_plans")
    .select("amount_base").eq("id", plan12.id).single();
  check("E17b · ni service_role puede separar monto/cadencia/status del scalar con un UPDATE directo",
    directPlanError17?.code === "22023" &&
      Number(planAfter17?.amount_base) === Number(planBefore17?.amount_base),
    JSON.stringify({ directPlanError17, planBefore17, planAfter17 }));
  const { error: zeroPlanInsertError17 } = await admin.from("savings_plans").insert({
    user_id: userId,
    kind: "savings",
    name: "E2E ZERO PLAN",
    amount_base: 0,
    original_amount: 0,
    original_currency: "USD",
    base_currency: "USD",
    frequency: "monthly",
    status: "active",
  });
  const { count: zeroPlanCount17 } = await admin.from("savings_plans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("name", "E2E ZERO PLAN");
  check("E17c · ni service_role puede crear un plan activo con monto cero",
    zeroPlanInsertError17?.code === "22023" && zeroPlanCount17 === 0,
    JSON.stringify({ zeroPlanInsertError17, zeroPlanCount17 }));
  const pausedZeroId17 = randomUUID();
  const { error: pausedZeroInsertError17 } = await admin.from("savings_plans").insert({
    id: pausedZeroId17,
    user_id: userId,
    kind: "savings",
    name: "E2E PAUSED ZERO PLAN",
    amount_base: 0,
    original_amount: 0,
    original_currency: "USD",
    base_currency: "USD",
    frequency: "monthly",
    status: "paused",
  });
  const { error: zeroResumeError17 } = await admin.rpc("kipu_set_savings_plan_status", {
    p_user_id: userId,
    p_plan_id: pausedZeroId17,
    p_status: "active",
  });
  const { data: pausedZeroAfter17 } = await admin.from("savings_plans")
    .select("status").eq("id", pausedZeroId17).single();
  check("E17d · un plan legacy pausado en cero no puede reactivarse",
    !pausedZeroInsertError17 &&
      zeroResumeError17?.code === "22023" &&
      pausedZeroAfter17?.status === "paused",
    JSON.stringify({ pausedZeroInsertError17, zeroResumeError17, pausedZeroAfter17 }));

  console.log(`\n${pass} verdes, ${fails.length} rojos`);
  if (!trigger078 || !refund078) {
    console.log("\n  ⚠ migración 078 NO aplicada: los guards de transfer/refund viven solo en TypeScript.");
  }
  if (!adjustment079) {
    console.log("\n  ⚠ migración 079 NO aplicada: el guard de adjustment todavía depende del caller.");
  }
  if (fails.length) console.log("  rojos: " + fails.join(" | "));
} finally {
  if (userId) {
    // Orden inverso a la creación. El residuo se VERIFICA, no se asume.
    const touched = [
      "investment_occurrence_applications",
      "objective_month_closes",
      "coach_nudge_log",
      "user_context_notes",
      "user_financial_preferences",
      "chat_messages",
      "ambient_nudges",
      "transactions",
      "recurring_occurrences",
      "fixed_expenses",
      "savings_plans",
      "investment_accounts",
      "accounts",
      "profiles",
    ];
    for (const t of touched) {
      const col = t === "profiles" ? "id" : "user_id";
      await admin.from(t).delete().eq(col, userId).then(() => {}, () => {});
    }
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      fails.push("limpieza auth");
      console.log(`LIMPIEZA AUTH FALLÓ: ${deleteUserError.message}`);
    }
    let residue = 0;
    for (const t of touched) {
      const col = t === "profiles" ? "id" : "user_id";
      const { count } = await admin.from(t).select("*", { count: "exact", head: true }).eq(col, userId);
      residue += count ?? 0;
    }
    if (residue !== 0) fails.push("limpieza DB");
    console.log(residue === 0 ? "limpieza: residuo cero verificado en todas las tablas tocadas" : `LIMPIEZA INCOMPLETA: ${residue} filas`);
  }
}
process.exit(fails.length ? 1 : 0);
