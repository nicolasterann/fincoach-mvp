// Bloque J — sondas de la migración 088 (cierre first-principles del agente).
//
// Ejecutar SOLO después de aplicar 088 y antes del deploy:
//   node --env-file=.env.local ./scripts/qa/j-agent-088-probes.mjs
//
// Usa una persona desechable, una sesión authenticated real y los RPC instalados.
// Todo residuo se comprueba después de borrar al usuario; un fallo de lectura o
// limpieza produce exit 1.

import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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
let pass = 0;
const fails = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  ok   · ${name}`);
  } else {
    fails.push(name);
    console.log(`  FALL · ${name}\n         ${detail}`);
  }
};
const must = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};
const rejects = async (fn, marker) => {
  try {
    const result = await fn();
    const message = result?.error?.message ?? "";
    return { ok: message.includes(marker), message: message || "no rechazó" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: message.includes(marker), message };
  }
};
const hash = (text) => createHash("sha256").update(text).digest("hex");
const rounded = (n) => Math.round(Number(n) * 100) / 100;

let userId = null;
let invitedUserId = null;
let probeHouseholdId = null;
const touched = [
  ["agent_action_challenges", "user_id"],
  ["agent_instrument_applications", "user_id"],
  ["merchant_correction_applications", "user_id"],
  ["debt_statement_cycle_applications", "user_id"],
  ["debt_statement_cycles", "user_id"],
  ["household_action_applications", "user_id"],
  ["fx_transfer_operations", "user_id"],
  ["transactions", "user_id"],
  ["fx_rates", "user_id"],
  ["goals", "user_id"],
  ["accounts", "user_id"],
  ["debt_accounts", "user_id"],
  ["investment_accounts", "user_id"],
  ["fixed_expenses", "user_id"],
  ["scheduled_payments", "user_id"],
  ["income_sources", "user_id"],
  ["scheduled_changes", "user_id"],
  ["user_context_notes", "user_id"],
  ["user_feedback", "user_id"],
  ["user_personalization", "user_id"],
  ["user_life_context", "user_id"],
  ["user_merchant_memory", "user_id"],
  ["chat_messages", "user_id"],
  ["households", "owner_id"],
  ["profiles", "id"],
];

try {
  const email = `kipu-j088-${Date.now()}@example.invalid`;
  const created = must(
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { kipu_smoke: true },
    }),
    "createUser",
  );
  userId = created.user.id;
  console.log(`persona desechable: ${userId}`);
  must(
    await admin
      .from("profiles")
      .upsert({
        id: userId,
        base_currency: "USD",
        onboarding_completed: true,
      }),
    "profile",
  );

  const link = must(
    await admin.auth.admin.generateLink({ type: "magiclink", email }),
    "generateLink",
  );
  must(
    await authenticated.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "email",
    }),
    "verifyOtp",
  );

  // ── A · challenge durable: una sola propuesta viva por conversación ─────
  const common = {
    user_id: userId,
    channel: "web",
    chat_id: "probe-chat",
    reason: "destructive",
    prompt: "Propuesta exacta de prueba",
  };
  const appendProbeUserTurn = async (suffix, content = suffix) => {
    must(
      await admin.from("chat_messages").insert({
        user_id: userId,
        channel: "web",
        chat_id: "probe-chat",
        role: "user",
        content,
        operation_key: `chat:${suffix}:user`,
      }),
      `chat turn ${suffix}`,
    );
    return `web:t:${suffix}`;
  };
  const payloadA = { accountId: "a", confirm: true };
  const payloadB = { accountId: "b", confirm: true };
  const turnA = await appendProbeUserTurn("turn-a");
  const issueA = must(
    await admin.rpc("kipu_issue_agent_action_challenge", {
      p: {
        ...common,
        tool_name: "close_account",
        payload_hash: hash(JSON.stringify(payloadA)),
        operation_id: turnA,
        payload: payloadA,
      },
    }),
    "issue A (¿088 aplicada?)",
  );
  check("A1 · primera propuesta se emite", issueA.outcome === "issued", JSON.stringify(issueA));

  const issueSame = must(
    await admin.rpc("kipu_issue_agent_action_challenge", {
      p: {
        ...common,
        tool_name: "close_account",
        payload_hash: hash(JSON.stringify(payloadA)),
        operation_id: turnA,
        payload: payloadA,
      },
    }),
    "issue replay",
  );
  check("A2 · reemisión idéntica reutiliza el challenge", issueSame.outcome === "existing", JSON.stringify(issueSame));

  const turnB = await appendProbeUserTurn("turn-b");
  const issueB = must(
    await admin.rpc("kipu_issue_agent_action_challenge", {
      p: {
        ...common,
        tool_name: "reopen_account",
        payload_hash: hash(JSON.stringify(payloadB)),
        operation_id: turnB,
        payload: payloadB,
      },
    }),
    "issue replacement",
  );
  const live = must(
    await admin
      .from("agent_action_challenges")
      .select("id,tool_name,status")
      .eq("user_id", userId),
    "read challenges",
  );
  check(
    "A3 · una propuesta nueva cancela la anterior, incluso si cambia el tool",
    issueB.outcome === "issued" &&
      live.filter((row) => row.status === "pending").length === 1 &&
      live.find((row) => row.tool_name === "close_account")?.status === "cancelled",
    JSON.stringify({ issueB, live }),
  );

  const oldClaim = must(
    await admin.rpc("kipu_claim_agent_action_challenge", {
      p: {
        user_id: userId,
        channel: "web",
        chat_id: "probe-chat",
        tool_name: "close_account",
        payload_hash: hash("anything"),
        operation_id: "web:t:turn-c",
      },
    }),
    "claim cancelled",
  );
  check("A4 · la propuesta reemplazada no se puede consumir", oldClaim.outcome === "missing", JSON.stringify(oldClaim));

  const sameTurnPeek = must(
    await admin.rpc("kipu_peek_pending_agent_action_challenge", {
      p: {
        user_id: userId,
        channel: "web",
        chat_id: "probe-chat",
        operation_id: turnB,
      },
    }),
    "peek same turn",
  );
  const turnConfirm = await appendProbeUserTurn("turn-confirm", "sí, hazlo");
  const laterPeek = must(
    await admin.rpc("kipu_peek_pending_agent_action_challenge", {
      p: {
        user_id: userId,
        channel: "web",
        chat_id: "probe-chat",
        operation_id: turnConfirm,
      },
    }),
    "peek later turn",
  );
  check(
    "A5 · el orquestador encuentra la propuesta sin pedirle al modelo que elija tool, pero nunca en el turno que la emitió",
    sameTurnPeek.found === false &&
      laterPeek.found === true &&
      laterPeek.tool_name === "reopen_account" &&
      laterPeek.payload.accountId === "b",
    JSON.stringify({ sameTurnPeek, laterPeek }),
  );

  const sameTurn = must(
    await admin.rpc("kipu_claim_agent_action_challenge", {
      p: {
        user_id: userId,
        channel: "web",
        chat_id: "probe-chat",
        tool_name: "reopen_account",
        payload_hash: hash("model-payload-does-not-authorize"),
        operation_id: turnB,
      },
    }),
    "same-turn claim",
  );
  check("A6 · una tool call no se autoconfirma en el turno que la propone", sameTurn.outcome === "same_turn" && sameTurn.claimed === false, JSON.stringify(sameTurn));

  const claimed = must(
    await admin.rpc("kipu_claim_agent_action_challenge", {
      p: {
        user_id: userId,
        channel: "web",
        chat_id: "probe-chat",
        tool_name: "reopen_account",
        payload_hash: hash("the-model-may-send-different-args"),
        operation_id: turnConfirm,
      },
    }),
    "claim",
  );
  check(
    "A7 · el turno posterior reclama el payload guardado, no los args del modelo",
    claimed.outcome === "claimed" &&
      claimed.claimed === true &&
      claimed.payload.accountId === "b",
    JSON.stringify(claimed),
  );
  const replayClaim = must(
    await admin.rpc("kipu_claim_agent_action_challenge", {
      p: {
        user_id: userId,
        channel: "web",
        chat_id: "probe-chat",
        tool_name: "reopen_account",
        payload_hash: hash("retry"),
        operation_id: turnConfirm,
      },
    }),
    "claim replay",
  );
  check("A8 · redelivery del turno confirmado es idempotente", replayClaim.outcome === "replay" && replayClaim.claimed === true, JSON.stringify(replayClaim));

  const staleOrigin = await appendProbeUserTurn("turn-stale-origin");
  const stalePayload = { accountId: "stale", confirm: true };
  must(
    await admin.rpc("kipu_issue_agent_action_challenge", {
      p: {
        ...common,
        tool_name: "close_account",
        payload_hash: hash(JSON.stringify(stalePayload)),
        operation_id: staleOrigin,
        payload: stalePayload,
      },
    }),
    "issue stale challenge",
  );
  await appendProbeUserTurn("turn-stale-middle", "¿cuánto debo?");
  const staleConfirm = await appendProbeUserTurn(
    "turn-stale-confirm",
    "correcto",
  );
  const stalePeek = must(
    await admin.rpc("kipu_peek_pending_agent_action_challenge", {
      p: {
        user_id: userId,
        channel: "web",
        chat_id: "probe-chat",
        operation_id: staleConfirm,
      },
    }),
    "peek stale challenge",
  );
  const staleClaim = must(
    await admin.rpc("kipu_claim_agent_action_challenge", {
      p: {
        user_id: userId,
        channel: "web",
        chat_id: "probe-chat",
        tool_name: "close_account",
        payload_hash: hash("stale model args"),
        operation_id: staleConfirm,
      },
    }),
    "claim stale challenge",
  );
  check(
    "A9 · un turno de usuario intermedio invalida la propuesta: un «correcto» posterior no puede ejecutar la acción vieja",
    stalePeek.found === false &&
      staleClaim.outcome === "stale_conversation" &&
      staleClaim.claimed === false,
    JSON.stringify({ stalePeek, staleClaim }),
  );

  // ── I · instrumentos y auditoría de estados con identidad durable ───────
  must(
    await admin.from("fx_rates").insert({
      user_id: userId,
      base_currency: "ARS",
      quote_currency: "USD",
      rate: 0.001,
      source: "manual",
    }),
    "instrument fx rate",
  );
  const accountPayload = {
    user_id: userId,
    dedupe_key: "instrument-account",
    name: "Pesos RPC",
    type: "bank",
    currency: "ARS",
    base_currency: "USD",
    current_balance_original: 1000,
    current_balance_base: 1,
  };
  const rpcAccount = must(
    await admin.rpc("kipu_create_account_idempotent", {
      p: accountPayload,
    }),
    "create account RPC",
  );
  must(
    await admin
      .from("fx_rates")
      .delete()
      .eq("user_id", userId)
      .eq("base_currency", "ARS")
      .eq("quote_currency", "USD"),
    "remove instrument rate",
  );
  const rpcAccountReplay = must(
    await admin.rpc("kipu_create_account_idempotent", {
      p: accountPayload,
    }),
    "replay account without rate",
  );
  check(
    "I1 · replay de cuenta devuelve el id original aun si la tasa ya no existe",
    rpcAccount.outcome === "created" &&
      rpcAccountReplay.outcome === "replayed" &&
      rpcAccountReplay.account_id === rpcAccount.account_id,
    JSON.stringify({ rpcAccount, rpcAccountReplay }),
  );
  const accountMismatch = await rejects(
    () =>
      admin.rpc("kipu_create_account_idempotent", {
        p: { ...accountPayload, name: "Otro nombre" },
      }),
    "KIPU_DEDUPE_MISMATCH",
  );
  check(
    "I2 · misma identidad con otro instrumento se rechaza",
    accountMismatch.ok,
    accountMismatch.message,
  );
  const unvaluedAccount = await rejects(
    () =>
      admin.rpc("kipu_create_account_idempotent", {
        p: {
          ...accountPayload,
          dedupe_key: "instrument-unvalued",
          name: "ARS sin tasa",
        },
      }),
    "opening balance valuation unavailable or stale",
  );
  check(
    "I3 · una apertura extranjera nueva sin valuación probada no aterriza",
    unvaluedAccount.ok,
    unvaluedAccount.message,
  );

  const debtPayload = {
    user_id: userId,
    dedupe_key: "instrument-debt",
    name: "Tarjeta RPC",
    type: "credit_card",
    currency: "USD",
    base_currency: "USD",
    current_balance_original: 200,
    current_balance_base: 200,
    minimum_payment: 20,
    full_payment_due: 200,
    due_day: 21,
    cutoff_day: 15,
  };
  const rpcDebt = must(
    await admin.rpc("kipu_create_debt_account_idempotent", {
      p: debtPayload,
    }),
    "create debt RPC",
  );
  const rpcDebtReplay = must(
    await admin.rpc("kipu_create_debt_account_idempotent", {
      p: debtPayload,
    }),
    "replay debt RPC",
  );
  check(
    "I4 · tarjeta+marcador aterrizan juntos y el replay conserva el id",
    rpcDebt.outcome === "created" &&
      rpcDebtReplay.outcome === "replayed" &&
      rpcDebtReplay.debt_account_id === rpcDebt.debt_account_id,
    JSON.stringify({ rpcDebt, rpcDebtReplay }),
  );

  const statementPayload = {
    user_id: userId,
    debt_account_id: rpcDebt.debt_account_id,
    operation_key: "statement-audit",
    evidence_id: null,
    statement_date: "2026-07-15",
    period_end: "2026-07-14",
    full_payment_due: 200,
    minimum_payment: 20,
    statement_balance: 200,
    due_day: 21,
    cutoff_day: 15,
    interest_rate: 12.5,
    interest_rate_kind: "annual_effective",
    applied: true,
    is_current: true,
    reason: "newer",
  };
  const statementAudit = must(
    await admin.rpc("kipu_record_debt_statement_cycle_idempotent", {
      p: statementPayload,
    }),
    "statement audit",
  );
  const statementReplay = must(
    await admin.rpc("kipu_record_debt_statement_cycle_idempotent", {
      p: statementPayload,
    }),
    "statement audit replay",
  );
  const statementMismatch = await rejects(
    () =>
      admin.rpc("kipu_record_debt_statement_cycle_idempotent", {
        p: { ...statementPayload, statement_balance: 201 },
      }),
    "KIPU_DEDUPE_MISMATCH",
  );
  check(
    "I5 · historial del corte es idempotente y un replay alterado no lo reescribe",
    statementAudit.outcome === "created" &&
      statementReplay.outcome === "replayed" &&
      statementReplay.cycle_id === statementAudit.cycle_id &&
      statementMismatch.ok,
    JSON.stringify({ statementAudit, statementReplay, statementMismatch }),
  );
  const authInstrument = await authenticated.rpc(
    "kipu_create_account_idempotent",
    { p: accountPayload },
  );
  const authStatement = await authenticated.rpc(
    "kipu_record_debt_statement_cycle_idempotent",
    { p: statementPayload },
  );
  check(
    "I6 · authenticated no ejecuta writers de instrumentos ni historial",
    Boolean(authInstrument.error) && Boolean(authStatement.error),
    JSON.stringify({
      instrument: authInstrument.error?.message,
      statement: authStatement.error?.message,
    }),
  );
  must(
    await admin.from("scheduled_payments").insert({
      user_id: userId,
      name: "Pago idempotente probe",
      amount: 10,
      currency: "USD",
      category: "other",
      due_date: "2026-08-01",
      recurring: false,
      status: "scheduled",
      agent_operation_key: "generic-create-probe",
      agent_payload_fingerprint: hash("generic-create-probe"),
    }),
    "generic create marker",
  );
  const duplicateGeneric = await admin.from("scheduled_payments").insert({
    user_id: userId,
    name: "Pago idempotente probe",
    amount: 10,
    currency: "USD",
    category: "other",
    due_date: "2026-08-01",
    recurring: false,
    status: "scheduled",
    agent_operation_key: "generic-create-probe",
    agent_payload_fingerprint: hash("generic-create-probe"),
  });
  check(
    "I7 · el índice de alta genérica serializa dos entregas de la misma operación",
    duplicateGeneric.error?.code === "23505",
    duplicateGeneric.error?.message ?? "no rechazó",
  );
  const malformedGeneric = await admin.from("scheduled_payments").insert({
    user_id: userId,
    name: "Marcador inválido probe",
    amount: 10,
    currency: "USD",
    category: "other",
    due_date: "2026-08-01",
    recurring: false,
    status: "scheduled",
    agent_operation_key: "half-marker-probe",
  });
  check(
    "I8 · un marcador parcial o malformado no puede envenenar el replay",
    malformedGeneric.error?.message?.includes(
      "KIPU_VALIDATION: invalid agent create identity",
    ) === true,
    malformedGeneric.error?.message ?? "no rechazó",
  );
  const forgedGeneric = await authenticated
    .from("scheduled_payments")
    .insert({
      user_id: userId,
      name: "Marcador forjado probe",
      amount: 10,
      currency: "USD",
      category: "other",
      due_date: "2026-08-01",
      recurring: false,
      status: "scheduled",
      agent_operation_key: "auth-forge-probe",
      agent_payload_fingerprint: hash("auth-forge-probe"),
    });
  check(
    // Un `Boolean(error)` aquí es una aserción débil: pasaría igual si el
    // rechazo viniera de RLS, de una columna inexistente o de un typo. Exige el
    // veredicto DEL GUARD, para que quitarlo mate esta sonda por nombre.
    "I9 · authenticated no puede forjar una identidad de replay completa",
    forgedGeneric.error?.message?.includes(
      "KIPU_FORBIDDEN: agent create identity is server-owned",
    ) === true,
    forgedGeneric.error?.message ?? "no rechazó",
  );

  const merchantCorrection = {
    user_id: userId,
    operation_id: "probe:merchant:one",
    match_pattern: "mcdonalds",
    merchant_family: "McDonald's",
    category: "food",
    source: "user_correction",
  };
  const merchantCreated = must(
    await admin.rpc("kipu_save_merchant_correction", {
      p: merchantCorrection,
    }),
    "merchant correction create",
  );
  const merchantReplay = must(
    await admin.rpc("kipu_save_merchant_correction", {
      p: merchantCorrection,
    }),
    "merchant correction replay",
  );
  check(
    "I10 · replay de aprendizaje conserva una sola corrección y no infla confianza",
    merchantCreated.outcome === "created" &&
      merchantCreated.correction_count === 1 &&
      merchantReplay.outcome === "replayed" &&
      merchantReplay.memory_id === merchantCreated.memory_id &&
      merchantReplay.correction_count === 1,
    JSON.stringify({ merchantCreated, merchantReplay }),
  );
  const merchantReinforced = must(
    await admin.rpc("kipu_save_merchant_correction", {
      p: {
        ...merchantCorrection,
        operation_id: "probe:merchant:two",
        note: "confirmado otra vez",
      },
    }),
    "merchant correction reinforce",
  );
  check(
    "I11 · una entrega distinta refuerza exactamente una vez dentro de PostgreSQL",
    merchantReinforced.outcome === "updated" &&
      merchantReinforced.memory_id === merchantCreated.memory_id &&
      merchantReinforced.correction_count === 2,
    JSON.stringify(merchantReinforced),
  );
  const merchantMismatch = await rejects(
    () =>
      admin.rpc("kipu_save_merchant_correction", {
        p: { ...merchantCorrection, category: "transport" },
      }),
    "KIPU_DEDUPE_MISMATCH",
  );
  check(
    "I12 · la misma identidad no acepta otra categoría",
    merchantMismatch.ok,
    merchantMismatch.message,
  );
  const authMerchant = await authenticated.rpc(
    "kipu_save_merchant_correction",
    { p: merchantCorrection },
  );
  check(
    "I13 · authenticated no puede llamar al writer de aprendizaje",
    Boolean(authMerchant.error),
    authMerchant.error?.message ?? "no rechazó",
  );

  // ── B · transferencia FX de dos patas nativas ────────────────────────────
  const mkAccount = async (name, currency, original, base) =>
    must(
      await admin
        .from("accounts")
        .insert({
          user_id: userId,
          name,
          type: "bank",
          currency,
          current_balance_original: original,
          current_balance_base: base,
        })
        .select("id")
        .single(),
      `account ${name}`,
    ).id;
  const ars = await mkAccount("Pesos probe", "ARS", 1_000_000, 1_000);
  const usd = await mkAccount("Dólares probe", "USD", 100, 100);
  must(
    await admin.from("fx_rates").insert({
      user_id: userId,
      base_currency: "ARS",
      quote_currency: "USD",
      rate: 0.001,
      source: "manual",
    }),
    "fx rate",
  );
  const balances = async () => {
    const rows = must(
      await admin
        .from("accounts")
        .select("id,current_balance_original,current_balance_base")
        .in("id", [ars, usd]),
      "balances",
    );
    return Object.fromEntries(rows.map((row) => [row.id, row]));
  };
  const fxPayload = {
    user_id: userId,
    operation_id: `fx-${randomUUID()}`,
    source_account_id: ars,
    destination_account_id: usd,
    source_amount: 100_000,
    destination_amount: 100,
    source_currency: "ARS",
    destination_currency: "USD",
    source_rate_to_base: 0.001,
    destination_rate_to_base: 1,
    base_currency: "USD",
    description: "Cambio probe",
    input_channel: "web",
    raw_input: "cambié 100000 ARS por 100 USD",
  };
  const beforeFx = await balances();
  const appliedFx = must(
    await admin.rpc("kipu_apply_fx_transfer", { p: fxPayload }),
    "apply fx",
  );
  const afterFx = await balances();
  check(
    "B1 · ambas patas FX aterrizan juntas en su moneda nativa",
    appliedFx.replayed === false &&
      rounded(afterFx[ars].current_balance_original) === 900_000 &&
      rounded(afterFx[usd].current_balance_original) === 200,
    JSON.stringify({ appliedFx, beforeFx, afterFx }),
  );
  const replayFx = must(
    await admin.rpc("kipu_apply_fx_transfer", { p: fxPayload }),
    "replay fx",
  );
  check(
    "B2 · replay no mueve ninguna pata",
    replayFx.replayed === true &&
      JSON.stringify(await balances()) === JSON.stringify(afterFx),
    JSON.stringify(replayFx),
  );
  const mismatch = await rejects(
    () =>
      admin.rpc("kipu_apply_fx_transfer", {
        p: { ...fxPayload, destination_amount: 101 },
      }),
    "KIPU_DEDUPE_MISMATCH",
  );
  check("B3 · mismo operation_id con otro reparto se rechaza", mismatch.ok, mismatch.message);
  const staleRate = await rejects(
    () =>
      admin.rpc("kipu_apply_fx_transfer", {
        p: {
          ...fxPayload,
          operation_id: `fx-rate-${randomUUID()}`,
          source_rate_to_base: 0.002,
        },
      }),
    "fx valuation missing, stale or untrusted",
  );
  check("B4 · una tasa fabricada o stale se rechaza", staleRate.ok, staleRate.message);
  const reversedFx = must(
    await admin.rpc("kipu_reverse_fx_transfer", {
      p: {
        user_id: userId,
        transaction_id: appliedFx.transaction_ids[0],
        input_channel: "web",
        raw_input: "deshacer probe",
      },
    }),
    "reverse fx",
  );
  const afterReverse = await balances();
  check(
    "B5 · revertir una pata revierte el grupo completo",
    reversedFx.matched === true &&
      reversedFx.already_reversed === false &&
      rounded(afterReverse[ars].current_balance_original) ===
        rounded(beforeFx[ars].current_balance_original) &&
      rounded(afterReverse[usd].current_balance_original) ===
        rounded(beforeFx[usd].current_balance_original),
    JSON.stringify({ reversedFx, afterReverse }),
  );
  const reverseReplay = must(
    await admin.rpc("kipu_reverse_fx_transfer", {
      p: {
        user_id: userId,
        transaction_id: appliedFx.transaction_ids[1],
        input_channel: "web",
      },
    }),
    "reverse replay",
  );
  check("B6 · replay de reversa no revierte dos veces", reverseReplay.already_reversed === true, JSON.stringify(reverseReplay));

  // ── C · reset atómico y definición de meta ───────────────────────────────
  must(
    await admin.from("user_personalization").insert({
      user_id: userId,
      financial_philosophy: "balanced",
    }),
    "personalization",
  );
  must(
    await admin.from("user_life_context").insert({
      user_id: userId,
      kind: "probe",
      label: "contexto probe",
    }),
    "life context",
  );
  const reset = must(
    await admin.rpc("kipu_reset_personalization", { p_user_id: userId }),
    "reset personalization",
  );
  const [personalizationCount, lifeCount] = await Promise.all([
    admin.from("user_personalization").select("*", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("user_life_context").select("*", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  check(
    "C1 · el reset borra las dos mitades en una operación",
    reset.outcome === "reset" &&
      !personalizationCount.error &&
      !lifeCount.error &&
      personalizationCount.count === 0 &&
      lifeCount.count === 0,
    JSON.stringify({ reset, personalizationCount, lifeCount }),
  );

  const goal = must(
    await admin
      .from("goals")
      .insert({
        user_id: userId,
        name: "Meta probe",
        target_amount: 100,
        current_amount: 0,
        currency: "USD",
      })
      .select("id")
      .single(),
    "goal",
  ).id;
  const goalUpdated = must(
    await admin.rpc("kipu_update_goal_definition", {
      p: {
        user_id: userId,
        goal_id: goal,
        target_amount: 300,
        currency: "EUR",
      },
    }),
    "goal definition",
  );
  check(
    "C2 · una meta sin dinero cambia unidad y target juntos por la ruta sancionada",
    goalUpdated.currency === "EUR" && Number(goalUpdated.target_amount) === 300,
    JSON.stringify(goalUpdated),
  );
  must(
    await admin.from("goals").update({ current_amount: 10 }).eq("id", goal),
    "seed goal money",
  );
  const moneyGoal = await rejects(
    () =>
      admin.rpc("kipu_update_goal_definition", {
        p: {
          user_id: userId,
          goal_id: goal,
          target_amount: 400,
          currency: "USD",
        },
      }),
    "immutable after money exists",
  );
  check("C3 · una meta con dinero no puede reetiquetar su moneda", moneyGoal.ok, moneyGoal.message);

  const linkedGoal = must(
    await admin
      .from("goals")
      .insert({
        user_id: userId,
        name: "Meta vinculada",
        target_amount: 200,
        current_amount: 0,
        currency: "USD",
        goal_account_id: usd,
      })
      .select("id")
      .single(),
    "linked goal",
  ).id;
  const linkedMismatch = await rejects(
    () =>
      admin.rpc("kipu_update_goal_definition", {
        p: {
          user_id: userId,
          goal_id: linkedGoal,
          target_amount: 200,
          currency: "EUR",
        },
      }),
    // El marcador anterior era "currency", palabra que el trigger de la 073 NO
    // usa: la sonda habría pasado con CUALQUIER rechazo (permiso, tool
    // inexistente, typo). Exige el veredicto del guard cuenta↔meta, que es lo
    // que esta sonda dice probar.
    "cannot be linked to an account in",
  );
  check("C4 · la ruta sancionada no salta la coherencia cuenta↔meta", linkedMismatch.ok, linkedMismatch.message);

  // ── D · identidad de chat y privilegios ──────────────────────────────────
  must(
    await admin.from("chat_messages").insert({
      user_id: userId,
      channel: "web",
      role: "user",
      content: "probe",
      operation_key: "probe-op",
    }),
    "chat op",
  );
  const duplicateChat = await rejects(
    () =>
      admin.from("chat_messages").insert({
        user_id: userId,
        channel: "web",
        role: "user",
        content: "probe redelivery",
        operation_key: "probe-op",
      }),
    "duplicate",
  );
  check("D1 · la redelivery de chat no crea un segundo turno", duplicateChat.ok, duplicateChat.message);

  const authChallengeWrite = await authenticated
    .from("agent_action_challenges")
    .insert({
      user_id: userId,
      channel: "web",
      tool_name: "close_account",
      payload_hash: "a".repeat(64),
      originating_operation_id: "auth-bypass",
      reason: "destructive",
      prompt: "bypass",
      payload: {},
    });
  const authRpc = await authenticated.rpc("kipu_reset_personalization", {
    p_user_id: userId,
  });
  check(
    "D2 · authenticated no escribe challenges ni ejecuta writers privados",
    Boolean(authChallengeWrite.error) && Boolean(authRpc.error),
    JSON.stringify({
      challenge: authChallengeWrite.error?.message,
      rpc: authRpc.error?.message,
    }),
  );

  // ── E · lifecycle household atómico ─────────────────────────────────────
  const invitedEmail = `kipu-j088-invitee-${Date.now()}@example.invalid`;
  const invitedUser = must(
    await admin.auth.admin.createUser({
      email: invitedEmail,
      email_confirm: true,
      user_metadata: { kipu_smoke: true },
    }),
    "create invitee",
  );
  invitedUserId = invitedUser.user.id;
  must(
    await admin.from("profiles").upsert({
      id: invitedUserId,
      base_currency: "USD",
      onboarding_completed: true,
    }),
    "invitee profile",
  );

  const createdHousehold = must(
    await admin.rpc("kipu_create_household_atomic", {
      p: {
        user_id: userId,
        name: "Hogar probe 088",
        type: "family",
        base_currency: "USD",
        mode: "shared_expenses",
        self_display_name: "Owner probe",
        dedupe_key: "probe:create-household",
      },
    }),
    "create household atomic",
  );
  probeHouseholdId = createdHousehold.household_id;
  const ownerMembers = must(
    await admin
      .from("household_members")
      .select("id,user_id,role,status")
      .eq("household_id", probeHouseholdId),
    "owner members",
  );
  check(
    "E1 · hogar y owner-member nacen juntos",
    createdHousehold.outcome === "created" &&
      ownerMembers.length === 1 &&
      ownerMembers[0].user_id === userId &&
      ownerMembers[0].role === "owner" &&
      ownerMembers[0].status === "active",
    JSON.stringify({ createdHousehold, ownerMembers }),
  );
  const householdReplay = must(
    await admin.rpc("kipu_create_household_atomic", {
      p: {
        user_id: userId,
        name: "Hogar probe 088",
        type: "family",
        base_currency: "USD",
        mode: "shared_expenses",
        self_display_name: "Owner probe",
        dedupe_key: "probe:create-household",
      },
    }),
    "replay household",
  );
  check(
    "E2 · replay del alta no crea un segundo hogar ni otro owner",
    householdReplay.outcome === "replayed" &&
      householdReplay.household_id === probeHouseholdId &&
      ownerMembers.length === 1,
    JSON.stringify(householdReplay),
  );

  const invite = must(
    await admin
      .from("household_invites")
      .insert({
        household_id: probeHouseholdId,
        invited_user_id: invitedUserId,
        invited_label: "Invitado probe",
        role: "member",
        status: "pending",
        created_by: userId,
      })
      .select("id")
      .single(),
    "invite",
  );
  const accepted = must(
    await admin.rpc("kipu_respond_household_invite_atomic", {
      p: {
        user_id: invitedUserId,
        invite_id: invite.id,
        accept: true,
        display_name: "Invitado probe",
      },
    }),
    "accept invite",
  );
  const [acceptedInvite, invitedMembers] = await Promise.all([
    admin
      .from("household_invites")
      .select("status")
      .eq("id", invite.id)
      .single(),
    admin
      .from("household_members")
      .select("id,status,role")
      .eq("household_id", probeHouseholdId)
      .eq("user_id", invitedUserId),
  ]);
  must(acceptedInvite, "accepted invite row");
  must(invitedMembers, "accepted member row");
  check(
    "E3 · aceptar cierra el invite y crea exactamente una membresía",
    accepted.outcome === "accepted" &&
      acceptedInvite.data.status === "accepted" &&
      invitedMembers.data.length === 1 &&
      invitedMembers.data[0].status === "active",
    JSON.stringify({ accepted, acceptedInvite, invitedMembers }),
  );
  const inviteReplay = must(
    await admin.rpc("kipu_respond_household_invite_atomic", {
      p: {
        user_id: invitedUserId,
        invite_id: invite.id,
        accept: true,
      },
    }),
    "invite replay",
  );
  check(
    "E4 · replay no duplica la membresía",
    inviteReplay.outcome === "replayed" &&
      invitedMembers.data.length === 1,
    JSON.stringify(inviteReplay),
  );

  // A historical left/removed row remains under the unique membership index.
  // The atomic writer must revive it, not attempt an impossible second INSERT.
  must(
    await admin
      .from("household_members")
      .update({ status: "left" })
      .eq("household_id", probeHouseholdId)
      .eq("user_id", invitedUserId),
    "seed left member",
  );
  const rejoinInvite = must(
    await admin
      .from("household_invites")
      .insert({
        household_id: probeHouseholdId,
        invited_user_id: invitedUserId,
        invited_label: "Invitado probe",
        role: "contributor",
        status: "pending",
        created_by: userId,
      })
      .select("id")
      .single(),
    "rejoin invite",
  );
  const rejoined = must(
    await admin.rpc("kipu_respond_household_invite_atomic", {
      p: {
        user_id: invitedUserId,
        invite_id: rejoinInvite.id,
        accept: true,
      },
    }),
    "rejoin",
  );
  const rejoinedMembers = must(
    await admin
      .from("household_members")
      .select("id,status,role")
      .eq("household_id", probeHouseholdId)
      .eq("user_id", invitedUserId),
    "rejoined members",
  );
  check(
    "E5 · reingreso revive la fila histórica sin chocar con el índice único",
    rejoined.outcome === "accepted" &&
      rejoinedMembers.length === 1 &&
      rejoinedMembers[0].status === "active" &&
      rejoinedMembers[0].role === "contributor",
    JSON.stringify({ rejoined, rejoinedMembers }),
  );

  const badRoleInvite = must(
    await admin
      .from("household_invites")
      .insert({
        household_id: probeHouseholdId,
        invited_user_id: invitedUserId,
        role: "owner",
        status: "pending",
        created_by: userId,
      })
      .select("id")
      .single(),
    "bad role invite",
  );
  const badRole = await rejects(
    () =>
      admin.rpc("kipu_respond_household_invite_atomic", {
        p: {
          user_id: invitedUserId,
          invite_id: badRoleInvite.id,
          accept: true,
        },
      }),
    "invite role is not assignable",
  );
  check("E6 · una invitación no puede fabricar otro owner/admin", badRole.ok, badRole.message);

  const genericInvite = must(
    await admin
      .from("household_invites")
      .insert({
        household_id: probeHouseholdId,
        role: "member",
        status: "pending",
        created_by: userId,
      })
      .select("id,token")
      .single(),
    "generic invite",
  );
  const ownerOpen = must(
    await admin.rpc("kipu_respond_household_invite_atomic", {
      p: {
        user_id: userId,
        token: genericInvite.token,
        accept: true,
      },
    }),
    "owner opens generic link",
  );
  const genericStatus = must(
    await admin
      .from("household_invites")
      .select("status")
      .eq("id", genericInvite.id)
      .single(),
    "generic status",
  );
  check(
    "E7 · el owner no consume por accidente un enlace genérico",
    ownerOpen.outcome === "already_member" &&
      genericStatus.status === "pending",
    JSON.stringify({ ownerOpen, genericStatus }),
  );

  const authHouseholdRpc = await authenticated.rpc(
    "kipu_create_household_atomic",
    {
      p: {
        user_id: userId,
        name: "bypass",
        type: "family",
        base_currency: "USD",
      },
    },
  );
  check(
    "E8 · authenticated no ejecuta los writers household privados",
    Boolean(authHouseholdRpc.error),
    authHouseholdRpc.error?.message ?? "no rechazó",
  );

  const ownerMemberId = ownerMembers[0].id;
  const invitedMemberId = rejoinedMembers[0].id;

  const participantPayload = {
    user_id: userId,
    household_id: probeHouseholdId,
    display_name: "Persona externa",
    dedupe_key: "probe:participant",
  };
  const participant = must(
    await admin.rpc("kipu_add_household_participant_atomic", {
      p: participantPayload,
    }),
    "participant",
  );
  const participantReplay = must(
    await admin.rpc("kipu_add_household_participant_atomic", {
      p: participantPayload,
    }),
    "participant replay",
  );
  const participantCount = await admin
    .from("household_members")
    .select("*", { count: "exact", head: true })
    .eq("id", participant.member_id);
  check(
    "E9 · redelivery de participante devuelve el mismo miembro y no duplica filas",
    !participantCount.error &&
      participantCount.count === 1 &&
      participantReplay.outcome === "replayed" &&
      participantReplay.member_id === participant.member_id,
    JSON.stringify({ participant, participantReplay, participantCount }),
  );

  const atomicInvitePayload = {
    user_id: userId,
    household_id: probeHouseholdId,
    label: "Enlace durable",
    role: "member",
    dedupe_key: "probe:invite-atomic",
  };
  const atomicInvite = must(
    await admin.rpc("kipu_create_household_invite_atomic", {
      p: atomicInvitePayload,
    }),
    "atomic invite",
  );
  const atomicInviteReplay = must(
    await admin.rpc("kipu_create_household_invite_atomic", {
      p: atomicInvitePayload,
    }),
    "atomic invite replay",
  );
  check(
    "E10 · replay de invitación conserva exactamente id y token",
    atomicInviteReplay.outcome === "replayed" &&
      atomicInviteReplay.invite_id === atomicInvite.invite_id &&
      atomicInviteReplay.token === atomicInvite.token,
    JSON.stringify({ atomicInvite, atomicInviteReplay }),
  );

  const foreignSharedGoal = await rejects(
    () =>
      admin.rpc("kipu_create_shared_goal_atomic", {
        p: {
          user_id: userId,
          household_id: probeHouseholdId,
          name: "Meta ARS inválida",
          target_amount: 150000,
          currency: "ARS",
          my_weekly_base: 10,
          dedupe_key: "probe:goal-foreign",
        },
      }),
    "household base currency",
  );
  const goalPayload = {
    user_id: userId,
    household_id: probeHouseholdId,
    name: "Meta base",
    target_amount: 150,
    currency: "USD",
    my_weekly_base: 15,
    dedupe_key: "probe:goal-base",
  };
  const sharedGoal = must(
    await admin.rpc("kipu_create_shared_goal_atomic", { p: goalPayload }),
    "shared goal",
  );
  const sharedGoalReplay = must(
    await admin.rpc("kipu_create_shared_goal_atomic", { p: goalPayload }),
    "shared goal replay",
  );
  const directForeignGoal = await rejects(
    () =>
      admin.from("goals").insert({
        user_id: userId,
        household_id: probeHouseholdId,
        is_shared: true,
        name: "Bypass ARS",
        target_amount: 1000,
        current_amount: 0,
        currency: "ARS",
      }),
    "shared goal currency must equal household base",
  );
  check(
    "E11 · objetivo y aporte compartidos usan una sola unidad base; RPC y trigger rechazan moneda extranjera y replay no duplica",
    foreignSharedGoal.ok &&
      directForeignGoal.ok &&
      sharedGoalReplay.outcome === "replayed" &&
      sharedGoalReplay.goal_id === sharedGoal.goal_id,
    JSON.stringify({
      foreignSharedGoal,
      directForeignGoal,
      sharedGoal,
      sharedGoalReplay,
    }),
  );

  const recurringPayload = {
    user_id: userId,
    household_id: probeHouseholdId,
    payer_member_id: ownerMemberId,
    description: "Internet durable",
    amount_base: 40,
    base_currency: "USD",
    split_method: "equal",
    cadence: "monthly",
    anchor_day: 10,
    dedupe_key: "probe:recurring",
  };
  const recurring = must(
    await admin.rpc("kipu_create_recurring_shared_expense_atomic", {
      p: recurringPayload,
    }),
    "recurring",
  );
  const recurringReplay = must(
    await admin.rpc("kipu_create_recurring_shared_expense_atomic", {
      p: recurringPayload,
    }),
    "recurring replay",
  );
  check(
    "E12 · replay de plantilla recurrente devuelve la misma fila",
    recurringReplay.outcome === "replayed" &&
      recurringReplay.recurring_id === recurring.recurring_id,
    JSON.stringify({ recurring, recurringReplay }),
  );

  const expenseCore = {
    household_id: probeHouseholdId,
    payer_member_id: ownerMemberId,
    created_by: userId,
    description: "Cena durable",
    total_original: 100,
    original_currency: "USD",
    total_base: 100,
    base_currency: "USD",
    occurred_at: new Date().toISOString(),
    split_method: "equal",
    status: "open",
    splits: [
      {
        member_id: ownerMemberId,
        share_base: 50,
        settled_base: 50,
      },
      {
        member_id: invitedMemberId,
        share_base: 50,
        settled_base: 0,
      },
    ],
  };
  const expenseEnvelope = {
    user_id: userId,
    household_id: probeHouseholdId,
    dedupe_key: "probe:shared-expense",
    expense: expenseCore,
  };
  const sharedExpense = must(
    await admin.rpc("kipu_add_shared_expense_idempotent", {
      p: expenseEnvelope,
    }),
    "shared expense",
  );
  const sharedExpenseReplay = must(
    await admin.rpc("kipu_add_shared_expense_idempotent", {
      p: expenseEnvelope,
    }),
    "shared expense replay",
  );
  const expenseAuditCount = await admin
    .from("household_audit_log")
    .select("*", { count: "exact", head: true })
    .eq("household_id", probeHouseholdId)
    .eq("action", "add_expense")
    .eq("entity", "expense");
  check(
    "E13 · gasto+splits+auditoría aterrizan juntos y el replay no duplica nada",
    sharedExpenseReplay.outcome === "replayed" &&
      sharedExpenseReplay.expense_id === sharedExpense.expense_id &&
      !expenseAuditCount.error &&
      expenseAuditCount.count === 1,
    JSON.stringify({ sharedExpense, sharedExpenseReplay, expenseAuditCount }),
  );

  const reimbursementPayload = {
    user_id: userId,
    dedupe_key: "probe:reimbursement",
    household_id: probeHouseholdId,
    from_member_id: invitedMemberId,
    to_member_id: ownerMemberId,
    amount_base: 10,
    base_currency: "USD",
    status: "paid",
    created_by: userId,
  };
  const reimbursement = must(
    await admin.rpc("kipu_mark_reimbursement_idempotent", {
      p: reimbursementPayload,
    }),
    "reimbursement",
  );
  const reimbursementReplay = must(
    await admin.rpc("kipu_mark_reimbursement_idempotent", {
      p: reimbursementPayload,
    }),
    "reimbursement replay",
  );
  const reimbursementAuditCount = await admin
    .from("household_audit_log")
    .select("*", { count: "exact", head: true })
    .eq("household_id", probeHouseholdId)
    .eq("action", "mark_paid")
    .eq("entity", "settlement");
  check(
    "E14 · reembolso+auditoría aterrizan juntos y el replay conserva una sola liquidación",
    reimbursementReplay.outcome === "replayed" &&
      reimbursementReplay.settlement_id === reimbursement.settlement_id &&
      !reimbursementAuditCount.error &&
      reimbursementAuditCount.count === 1,
    JSON.stringify({
      reimbursement,
      reimbursementReplay,
      reimbursementAuditCount,
    }),
  );

  const mutation = (action, dedupeKey, payload = {}, actingUser = userId) => ({
    p: {
      user_id: actingUser,
      household_id: probeHouseholdId,
      action,
      dedupe_key: dedupeKey,
      payload,
    },
  });
  const edited = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("update_shared_expense", "probe:edit-expense", {
        expense_id: sharedExpense.expense_id,
        description: "Cena durable corregida",
      }),
    ),
    "edit shared expense",
  );
  const editReplay = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("update_shared_expense", "probe:edit-expense", {
        expense_id: sharedExpense.expense_id,
        description: "Cena durable corregida",
      }),
    ),
    "edit shared expense replay",
  );
  const editAudit = await admin
    .from("household_audit_log")
    .select("*", { count: "exact", head: true })
    .eq("household_id", probeHouseholdId)
    .eq("action", "edit_expense")
    .eq("entity", "expense");
  check(
    "E15 · editar un gasto guarda efecto+auditoría+marcador una vez",
    edited.outcome === "created" &&
      editReplay.outcome === "replayed" &&
      !editAudit.error &&
      editAudit.count === 1,
    JSON.stringify({ edited, editReplay, editAudit }),
  );

  const settled = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("settle_household", "probe:settle", {
        archive: false,
        base_currency: "USD",
        expected_settlement_count: 1,
        expected_open_expense_count: 1,
        expected_expense_total_base: 100,
        expected_settlement_total_base: 10,
        transfers: [
          {
            from_member_id: invitedMemberId,
            to_member_id: ownerMemberId,
            amount_base: 40,
          },
        ],
      }),
    ),
    "settle household",
  );
  const settleReplay = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("settle_household", "probe:settle", {
        archive: false,
        base_currency: "USD",
        expected_settlement_count: 1,
        expected_open_expense_count: 1,
        expected_expense_total_base: 100,
        expected_settlement_total_base: 10,
        transfers: [
          {
            from_member_id: invitedMemberId,
            to_member_id: ownerMemberId,
            amount_base: 40,
          },
        ],
      }),
    ),
    "settle household replay",
  );
  const settleAudit = await admin
    .from("household_audit_log")
    .select("*", { count: "exact", head: true })
    .eq("household_id", probeHouseholdId)
    .eq("action", "settle_household");
  check(
    "E16 · cerrar cuentas es atómico e idempotente también en la frontera del agente",
    settled.outcome === "created" &&
      settled.settled === 1 &&
      settleReplay.outcome === "replayed" &&
      settleReplay.settled === 1 &&
      !settleAudit.error &&
      settleAudit.count === 1,
    JSON.stringify({ settled, settleReplay, settleAudit }),
  );

  const cancellableEnvelope = {
    user_id: userId,
    household_id: probeHouseholdId,
    dedupe_key: "probe:cancellable-expense",
    expense: {
      ...expenseCore,
      description: "Gasto cancelable",
      total_original: 20,
      total_base: 20,
      splits: [
        {
          member_id: ownerMemberId,
          share_base: 10,
          settled_base: 10,
        },
        {
          member_id: invitedMemberId,
          share_base: 10,
          settled_base: 0,
        },
      ],
    },
  };
  const cancellable = must(
    await admin.rpc("kipu_add_shared_expense_idempotent", {
      p: cancellableEnvelope,
    }),
    "cancellable expense",
  );
  const cancelled = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("cancel_shared_expense", "probe:cancel-expense", {
        expense_id: cancellable.expense_id,
      }),
    ),
    "cancel expense",
  );
  const cancelReplay = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("cancel_shared_expense", "probe:cancel-expense", {
        expense_id: cancellable.expense_id,
      }),
    ),
    "cancel expense replay",
  );
  check(
    "E17 · cancelar por redelivery no convierte «ya cancelado» en error ni repite auditoría",
    cancelled.outcome === "created" &&
      cancelReplay.outcome === "replayed" &&
      cancelReplay.expense_id === cancelled.expense_id,
    JSON.stringify({ cancelled, cancelReplay }),
  );

  const visibility = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("set_visibility", "probe:visibility", {
        privacy_mode: "standard",
      }),
    ),
    "visibility",
  );
  const visibilityReplay = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("set_visibility", "probe:visibility", {
        privacy_mode: "standard",
      }),
    ),
    "visibility replay",
  );
  const removedRecurring = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("remove_recurring", "probe:remove-recurring", {
        recurring_id: recurring.recurring_id,
      }),
    ),
    "remove recurring",
  );
  const removedRecurringReplay = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("remove_recurring", "probe:remove-recurring", {
        recurring_id: recurring.recurring_id,
      }),
    ),
    "remove recurring replay",
  );
  check(
    "E18 · privacidad y recurrentes comparten el mismo contrato de replay durable",
    visibility.outcome === "created" &&
      visibilityReplay.outcome === "replayed" &&
      removedRecurring.outcome === "created" &&
      removedRecurringReplay.outcome === "replayed",
    JSON.stringify({
      visibility,
      visibilityReplay,
      removedRecurring,
      removedRecurringReplay,
    }),
  );

  const ownerLeave = await rejects(
    () =>
      admin.rpc(
        "kipu_apply_household_mutation_idempotent",
        mutation("leave_household", "probe:owner-leave"),
      ),
    "owner must transfer ownership",
  );
  const externalOwner = await rejects(
    () =>
      admin.rpc(
        "kipu_apply_household_mutation_idempotent",
        mutation("transfer_ownership", "probe:external-owner", {
          member_id: participant.member_id,
        }),
      ),
    "active Kipu user",
  );
  const transferred = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("transfer_ownership", "probe:transfer-owner", {
        member_id: invitedMemberId,
      }),
    ),
    "transfer ownership",
  );
  const transferReplay = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("transfer_ownership", "probe:transfer-owner", {
        member_id: invitedMemberId,
      }),
    ),
    "transfer ownership replay",
  );
  const transferredBack = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation(
        "transfer_ownership",
        "probe:transfer-owner-back",
        { member_id: ownerMemberId },
        invitedUserId,
      ),
    ),
    "transfer ownership back",
  );
  const ownerState = must(
    await admin
      .from("households")
      .select("owner_id")
      .eq("id", probeHouseholdId)
      .single(),
    "owner state",
  );
  check(
    "E19 · el owner no puede huir y dejar un grupo huérfano: transfiere a un usuario real, de forma atómica y reversible",
    ownerLeave.ok &&
      externalOwner.ok &&
      transferred.outcome === "created" &&
      transferReplay.outcome === "replayed" &&
      transferredBack.outcome === "created" &&
      ownerState.owner_id === userId,
    JSON.stringify({
      ownerLeave,
      externalOwner,
      transferred,
      transferReplay,
      transferredBack,
      ownerState,
    }),
  );

  const removedMember = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("remove_member", "probe:remove-external", {
        member_id: participant.member_id,
      }),
    ),
    "remove external member",
  );
  const removedMemberReplay = must(
    await admin.rpc(
      "kipu_apply_household_mutation_idempotent",
      mutation("remove_member", "probe:remove-external", {
        member_id: participant.member_id,
      }),
    ),
    "remove external member replay",
  );
  check(
    "E20 · remover un miembro conserva historia y un replay no vuelve a mutarlo",
    removedMember.outcome === "created" &&
      removedMemberReplay.outcome === "replayed",
    JSON.stringify({ removedMember, removedMemberReplay }),
  );

  const authNewRpc = await authenticated.rpc(
    "kipu_apply_household_mutation_idempotent",
    mutation("set_visibility", "probe:auth-bypass", {
      privacy_mode: "full",
    }),
  );
  check(
    "E21 · authenticated no ejecuta la frontera idempotente household",
    Boolean(authNewRpc.error),
    authNewRpc.error?.message ?? "no rechazó",
  );

  // E22 (migración 090). El guard de meta compartida de la 088 abortaba cuando
  // `household_id` pasaba a NULL, y esa columna es ON DELETE SET NULL: borrar el
  // hogar EJECUTA ese UPDATE. Cualquier hogar con una meta compartida quedaba
  // imposible de borrar, y con él su usuario. Un rechazo sin remedio en pantalla
  // es un cerrojo, no un guard. Se prueba con un hogar desechable propio para no
  // tocar el del resto de la batería.
  const doomedHousehold = must(
    await admin.rpc("kipu_create_household_atomic", {
      p: {
        user_id: userId,
        name: "Hogar desechable 090",
        type: "custom",
        base_currency: "USD",
        mode: "shared_expenses",
        self_display_name: "Yo",
        dedupe_key: "probe:household-lockout",
      },
    }),
    "household lockout probe",
  ).household_id;
  const doomedGoal = must(
    await admin.rpc("kipu_create_shared_goal_atomic", {
      p: {
        user_id: userId,
        household_id: doomedHousehold,
        name: "Meta del hogar desechable",
        target_amount: 100,
        currency: "USD",
        dedupe_key: "probe:household-lockout-goal",
      },
    }),
    "shared goal lockout probe",
  ).goal_id;
  const purge = await admin
    .from("households")
    .delete()
    .eq("id", doomedHousehold);
  const survivor = must(
    await admin
      .from("goals")
      .select("id,is_shared,household_id")
      .eq("id", doomedGoal)
      .maybeSingle(),
    "goal after household purge",
  );
  check(
    "E22 · borrar un hogar con meta compartida no es un cerrojo: la meta se degrada a no-compartida en la misma operación",
    !purge.error &&
      survivor?.is_shared === false &&
      survivor?.household_id === null,
    JSON.stringify({ purgeError: purge.error?.message ?? null, survivor }),
  );
  must(await admin.from("goals").delete().eq("id", doomedGoal), "purge probe goal");

  // ── F · el ciclo REAL de eliminación de usuario ──────────────────────────
  // `shared_expenses.created_by` y `household_settlements.created_by` eran NOT
  // NULL con ON DELETE SET NULL: dos reglas que se contradicen. Quien hubiera
  // creado un gasto o una liquidación no podía borrar su cuenta nunca. Esta
  // sonda NO esquiva el defecto borrando el hogar antes (eso probaba la 090,
  // no el ciclo): borra al PARTICIPANTE con el hogar en pie y exige que la
  // historia del grupo sobreviva sin autor.
  const authoredExpense = must(
    await admin.rpc("kipu_add_shared_expense_idempotent", {
      p: {
        user_id: invitedUserId,
        household_id: probeHouseholdId,
        dedupe_key: "probe:authored-by-participant",
        expense: {
          household_id: probeHouseholdId,
          payer_member_id: invitedMemberId,
          created_by: invitedUserId,
          description: "Gasto del participante",
          total_original: 40,
          original_currency: "USD",
          total_base: 40,
          base_currency: "USD",
          occurred_at: new Date().toISOString(),
          split_method: "equal",
          status: "open",
          splits: [
            { member_id: ownerMemberId, share_base: 20, settled_base: 0 },
            { member_id: invitedMemberId, share_base: 20, settled_base: 20 },
          ],
        },
      },
    }),
    "expense authored by participant",
  ).expense_id;
  const authoredSettlement = must(
    await admin.rpc("kipu_mark_reimbursement_idempotent", {
      p: {
        user_id: invitedUserId,
        dedupe_key: "probe:settlement-by-participant",
        household_id: probeHouseholdId,
        from_member_id: ownerMemberId,
        to_member_id: invitedMemberId,
        amount_base: 20,
        base_currency: "USD",
        status: "paid",
        created_by: invitedUserId,
      },
    }),
    "settlement authored by participant",
  ).settlement_id;

  const orphanAuthor = await rejects(
    () =>
      admin.from("shared_expenses").insert({
        household_id: probeHouseholdId,
        payer_member_id: ownerMemberId,
        description: "Gasto sin autor",
        total_original: 5,
        original_currency: "USD",
        total_base: 5,
        base_currency: "USD",
        occurred_at: new Date().toISOString(),
      }),
    "created_by is required when the row is written",
  );
  // La 091 instala DOS guards y F2 sólo ejercitaba el de shared_expenses: quitar
  // `household_settlements_require_author` dejaba F1 y F2 en verde, porque F1
  // inserta la liquidación CON autor y el SET NULL no necesita ese trigger.
  const orphanSettlementAuthor = await rejects(
    () =>
      admin.from("household_settlements").insert({
        household_id: probeHouseholdId,
        from_member_id: ownerMemberId,
        to_member_id: invitedMemberId,
        amount_base: 5,
        base_currency: "USD",
        status: "paid",
      }),
    "created_by is required when the row is written",
  );
  // Contrato de la 092: `created_by` es INMUTABLE mientras su autor exista. Un
  // UPDATE administrativo a NULL con el autor VIVO falsificaría la firma del
  // cascade; reescribir la autoría hacia otra persona reescribiría la historia.
  const manualNullAuthor = await rejects(
    () =>
      admin
        .from("shared_expenses")
        .update({ created_by: null })
        .eq("id", authoredExpense),
    "created_by is immutable while its author exists",
  );
  const manualReassignAuthor = await rejects(
    () =>
      admin
        .from("household_settlements")
        .update({ created_by: userId })
        .eq("id", authoredSettlement),
    "created_by is immutable while its author exists",
  );

  const participantGone = await admin.auth.admin.deleteUser(invitedUserId);
  const survivingExpense = must(
    await admin
      .from("shared_expenses")
      .select("id,created_by,total_base")
      .eq("id", authoredExpense)
      .maybeSingle(),
    "expense after participant deletion",
  );
  const survivingSettlement = must(
    await admin
      .from("household_settlements")
      .select("id,created_by,amount_base")
      .eq("id", authoredSettlement)
      .maybeSingle(),
    "settlement after participant deletion",
  );
  const householdStanding = must(
    await admin
      .from("households")
      .select("id")
      .eq("id", probeHouseholdId)
      .maybeSingle(),
    "household after participant deletion",
  );
  const goneProfile = await admin
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("id", invitedUserId);
  const goneAuth = await admin.auth.admin.getUserById(invitedUserId);
  check(
    "F1 · un participante que creó gasto y liquidación PUEDE borrar su cuenta: el usuario desaparece, el hogar sigue en pie y su historia queda sin autor",
    !participantGone.error &&
      Boolean(goneAuth.error) &&
      !goneProfile.error &&
      goneProfile.count === 0 &&
      householdStanding?.id === probeHouseholdId &&
      survivingExpense?.created_by === null &&
      Number(survivingExpense?.total_base) === 40 &&
      survivingSettlement?.created_by === null &&
      Number(survivingSettlement?.amount_base) === 20,
    JSON.stringify({
      deleteError: participantGone.error?.message ?? null,
      goneProfileCount: goneProfile.count,
      survivingExpense,
      survivingSettlement,
      household: householdStanding,
    }),
  );
  check(
    "F2 · aflojar NOT NULL no aflojó el write: LAS DOS tablas rechazan un INSERT sin autor",
    orphanAuthor.ok && orphanSettlementAuthor.ok,
    JSON.stringify({
      expense: orphanAuthor.message,
      settlement: orphanSettlementAuthor.message,
    }),
  );
  check(
    "F3 · `created_by` es inmutable mientras su autor exista: ni un NULL manual (que falsificaría la firma del cascade) ni una reasignación de autoría",
    manualNullAuthor.ok && manualReassignAuthor.ok,
    JSON.stringify({
      manualNull: manualNullAuthor.message,
      reassign: manualReassignAuthor.message,
    }),
  );
  // Ya borrado aquí: que la limpieza no lo intente otra vez y reporte un falso residuo.
  invitedUserId = null;

  // F4 · El barrido de CLASE, contra el CATÁLOGO. La versión textual del gate
  // (IR170) no ve un `foreign key (...) references ... on delete set null`
  // repartido en varias líneas ni un FK añadido después con ALTER TABLE; es una
  // alarma temprana, no una prueba. La autoridad es pg_constraint + pg_attribute.
  const contractReport = must(
    await admin.rpc("kipu__schema_contract_report"),
    "schema contract report",
  );
  check(
    "F4 · el catálogo prueba el contrato: cero columnas NOT NULL dentro de un FK ON DELETE SET NULL, y los cuatro guards de autoría instalados y ACTIVOS",
    Array.isArray(contractReport?.contradictory_set_null) &&
      contractReport.contradictory_set_null.length === 0 &&
      Array.isArray(contractReport?.enabled_author_guards) &&
      contractReport.enabled_author_guards.length === 4,
    JSON.stringify(contractReport),
  );
  const contractLeak = await authenticated.rpc("kipu__schema_contract_report");
  check(
    "F5 · el reporte de esquema no es ejecutable por authenticated",
    Boolean(contractLeak.error),
    contractLeak.error?.message ?? "no rechazó",
  );
} catch (error) {
  fails.push("EXCEPCIÓN");
  console.error(error);
} finally {
  if (userId) {
    // Se borra el hogar primero por ORDEN, no por defecto: cascadea gastos,
    // splits, liquidaciones, invites y auditoría, de modo que la verificación de
    // residuo mida el residuo y no el orden en que se limpió. (El defecto
    // `NOT NULL` + `ON DELETE SET NULL` que antes lo hacía OBLIGATORIO ya no
    // existe: lo cerró la 091, y F1 prueba el ciclo de borrado de usuario CON el
    // hogar en pie.)
    if (probeHouseholdId) {
      const purged = await admin
        .from("households")
        .delete()
        .eq("id", probeHouseholdId);
      if (purged.error) {
        fails.push("LIMPIEZA household previa");
        console.error(`LIMPIEZA household previa: ${purged.error.message}`);
      }
    }
    if (invitedUserId) {
      const deletedInvitee = await admin.auth.admin.deleteUser(invitedUserId);
      if (deletedInvitee.error) {
        fails.push("LIMPIEZA auth invitee");
        console.error(`LIMPIEZA auth invitee: ${deletedInvitee.error.message}`);
      }
    }
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) {
      fails.push("LIMPIEZA auth");
      console.error(`LIMPIEZA auth: ${deleted.error.message}`);
    }
    for (const [table, column] of touched) {
      const result = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, userId);
      if (result.error || result.count == null || result.count !== 0) {
        fails.push(`LIMPIEZA ${table}`);
        console.error(
          `LIMPIEZA ${table}: ${result.error?.message ?? `count=${result.count}`}`,
        );
      }
    }
    if (invitedUserId) {
      const inviteeProfile = await admin
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("id", invitedUserId);
      if (
        inviteeProfile.error ||
        inviteeProfile.count == null ||
        inviteeProfile.count !== 0
      ) {
        fails.push("LIMPIEZA invitee profile");
        console.error(
          `LIMPIEZA invitee profile: ${inviteeProfile.error?.message ?? `count=${inviteeProfile.count}`}`,
        );
      }
    }
    if (probeHouseholdId) {
      for (const table of [
        "households",
        "household_members",
        "household_invites",
        "household_audit_log",
        "household_action_applications",
        "household_recurring_expenses",
        "shared_expenses",
        "household_settlements",
        "goals",
      ]) {
        const column = table === "households" ? "id" : "household_id";
        const result = await admin
          .from(table)
          .select("*", { count: "exact", head: true })
          .eq(column, probeHouseholdId);
        if (result.error || result.count == null || result.count !== 0) {
          fails.push(`LIMPIEZA ${table}`);
          console.error(
            `LIMPIEZA ${table}: ${result.error?.message ?? `count=${result.count}`}`,
          );
        }
      }
    }
  }
}

console.log(`\n088 probes: ${pass}/${pass + fails.length}`);
if (fails.length > 0) {
  console.error(`fallos: ${[...new Set(fails)].join(", ")}`);
  process.exitCode = 1;
}
