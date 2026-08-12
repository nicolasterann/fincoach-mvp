// Pre-M backend closure — adversarial wiring audit.
// Every mutation is restored byte-for-byte and must kill the named capture check.
//
//   node ./scripts/qa/pre-m-mutation-audit.mjs

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const cases = [
  {
    name: "PM1 an old pending AUTO occurrence silently books during catch-up",
    file: "src/lib/scheduled/recurring-materializer.ts",
    from: "  if (forceAsk) return \"ask\";",
    to: "  if (false && forceAsk) return \"ask\";",
    detector: "PRE-M.1",
  },
  {
    name: "PM2 a live materializer caller forgets to pass the late verdict",
    file: "src/lib/scheduled/recurring-materializer.ts",
    from: "shouldAttemptAutoBook(created, mode, late)",
    to: "shouldAttemptAutoBook(created, mode)",
    occurrence: 1,
    detector: "PRE-M.4",
  },
  {
    name: "PM3 objective close stops consuming the durable pending-month decision",
    file: "src/lib/scheduled/objective-month-close.ts",
    from: "const closedMonth = pendingObjectiveCloseMonth(",
    to: "const ignoredClosedMonth = pendingObjectiveCloseMonth(",
    detector: "PRE-M.4",
  },
  {
    name: "PM4 current money accepts a five-day-old manual FX rate",
    file: "src/lib/fx/fx-store.ts",
    from: "export const CURRENT_FX_MAX_AGE_DAYS = 4;",
    to: "export const CURRENT_FX_MAX_AGE_DAYS = 5;",
    detector: "PRE-M.3",
  },
  {
    name: "PM5 FX refresh drifts back to weekly while the TTL remains four days",
    file: "vercel.json",
    from: '"schedule": "0 13 * * *"',
    to: '"schedule": "0 13 * * 1"',
    detector: "PRE-M.3",
  },
  {
    name: "PM6 Mis Datos balance edits bypass the native writer",
    file: "src/app/app/mis-datos/actions.ts",
    from: "      if (balance !== null) {",
    to: "      if (false && balance !== null) {",
    detector: "PRE-M.4",
  },
  {
    name: "PM7 the account close wrapper falls back to the base-only v2 RPC",
    file: "src/lib/ai/apply-chat-transaction-intent.ts",
    from: 'supabase.rpc("kipu_close_account_v3"',
    to: 'supabase.rpc("kipu_close_account_v2"',
    detector: "PRE-M.4",
  },
  {
    name: "PM8 the authenticated account lateral-door trigger is not installed",
    file: "supabase/sql/096_preM_backend_integrity.sql",
    from:
      "create trigger accounts_direct_financial_update_guard\n" +
      "before update",
    to:
      "create trigger accounts_direct_financial_update_guard_disabled\n" +
      "before update",
    detector: "PRE-M.4",
  },
  {
    name: "PM9 H44 builder ignores the injected money reader",
    file: "src/lib/financial/coaching-signals.ts",
    from: "const txnFeed = await deps.loadMoneyFeed(",
    to: "const txnFeed = await liveBuildCoachingBriefingDeps.loadMoneyFeed(",
    detector: "H.44b",
  },
  {
    name: "PM10 H46 create executor stops consuming the injected atomic writer",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "const atomic = await deps.applyPurchase({",
    to:
      'const atomic = await (async () => ({ ok: true as const, replayed: false, planId: "mutant", transactionId: "mutant" }))({',
    detector: "H.46b",
  },
  {
    name: "PM11 H46 close executor stops consuming the injected atomic writer",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "const closed = await deps.closePlan({",
    to:
      "const closed = await (async () => ({ ok: true as const, alreadyClosed: false, reversedPurchase: true }))({",
    detector: "H.46b",
  },
  {
    name: "PM12 Mis Datos account creation stops consuming the idempotent writer",
    file: "src/app/app/mis-datos/actions.ts",
    from: "const created = await createAccountIdempotently({",
    to: "const created = await createAccountIdempotentlyDisabled({",
    detector: "PRE-M.4",
  },
  {
    name: "PM13 Mis Datos resurrects a PostgreSQL-invalid checking account type",
    file: "src/app/app/mis-datos/page.tsx",
    from: '{ value: "bank", label: "Cuenta bancaria" }',
    to: '{ value: "checking", label: "Cuenta corriente" }',
    detector: "PRE-M.4",
  },
  {
    name: "PM14 account forms lose the server-rendered delivery identity",
    file: "src/app/app/mis-datos/page.tsx",
    from: "addOperationId: randomUUID(),",
    to: "addOperationIdDisabled: randomUUID(),",
    detector: "PRE-M.4",
  },
  {
    name: "PM15 objective cursor accepts a NULL month as an accidental constraint error",
    file: "supabase/sql/096_preM_backend_integrity.sql",
    from: "if p_user_id is null or p_month is null",
    to: "if p_user_id is null or false and p_month is null",
    detector: "PRE-M.4",
  },
  {
    name: "PM16 account close accepts an identity its nested writer cannot represent",
    file: "supabase/sql/096_preM_backend_integrity.sql",
    from: "if char_length(v_operation) > 188 then",
    to: "if false and char_length(v_operation) > 188 then",
    detector: "PRE-M.4",
  },
  {
    name: "PM17 a web ledger action falls back to the authenticated session client",
    file: "src/app/app/transaction-actions.ts",
    from: 'const { error: writeError } = await writer.rpc("kipu_apply_ledger_entry"',
    to: 'const { error: writeError } = await supabase.rpc("kipu_apply_ledger_entry"',
    detector: "PRE-M.4",
  },
  {
    name: "PM18 close disables the bounded base-only rounding sweep",
    file: "supabase/sql/096_preM_backend_integrity.sql",
    from:
      "elsif abs(coalesce(v_row.current_balance_original,0)) < 0.005\n" +
      "        and abs(coalesce(v_row.current_balance_base,0)) <= 1.00\n" +
      "  then",
    to:
      "elsif false and abs(coalesce(v_row.current_balance_original,0)) < 0.005\n" +
      "        and abs(coalesce(v_row.current_balance_base,0)) <= 1.00\n" +
      "  then",
    detector: "PRE-M.4",
  },
  {
    name: "PM19 reopen forgets the v3 snapshot-aware inverse",
    file: "src/lib/ai/apply-chat-transaction-intent.ts",
    from: 'supabase.rpc("kipu_reopen_account_v3"',
    to: 'supabase.rpc("kipu_reopen_account_v2"',
    detector: "PRE-M.4",
  },
  {
    name: "PM20 the legacy authenticated reconciliation grant remains open",
    file: "supabase/sql/096_preM_backend_integrity.sql",
    from:
      "revoke execute on function public.kipu_reconcile_account_balance(jsonb)\n" +
      "  from public, anon, authenticated;",
    to:
      "revoke execute on function public.kipu_reconcile_account_balance(jsonb)\n" +
      "  from public, anon;",
    detector: "PRE-M.4",
  },
  {
    name: "PM21 Mis Datos stops deriving a current rate before closing an account",
    file: "src/app/app/mis-datos/actions.ts",
    from: "        closeRate = await currentRateToBase(",
    to: "        closeRate = null ?? await currentRateToBase(",
    detector: "PRE-M.4",
  },
  {
    name: "PM22 the close wrapper substitutes 1 for a missing rate in the RPC payload",
    file: "src/lib/ai/apply-chat-transaction-intent.ts",
    // Indentado a 6 espacios: único al payload del cierre. El literal sin
    // sangría también vive en buildLedgerEntryPayload, que es exactamente lo
    // que hacía sobrevivir esta mutación contra un includes() sin anclar.
    from: "      exchange_rate_to_base: rate,",
    to: "      exchange_rate_to_base: rate ?? 1,",
    detector: "PRE-M.4",
  },
  {
    name: "PM23 the agent hands the writer a fabricated rate of 1",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "    exchangeRateToBase: closeRate,",
    to: "    exchangeRateToBase: 1,",
    detector: "PRE-M.4",
  },
  {
    name: "PM26 Mis Datos reads the cent-rounded amount instead of the rate",
    file: "src/app/app/mis-datos/actions.ts",
    from: "  return rateToBase(from, base, rates);",
    to:
      "  const res = convert(1, from, base, rates);\n" +
      "  return res.ok && res.baseAmount > 0 ? res.baseAmount : null;",
    detector: "PRE-M.4",
  },
  {
    name: "PM27 the agent reads the cent-rounded amount instead of the rate",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "  const closeRate = rateToBase(account.currency, ctx.baseCurrency, ctx.fxRates ?? []);",
    to:
      "  const closeRateRes = convertFx(1, account.currency, ctx.baseCurrency, ctx.fxRates ?? []);\n" +
      "  const closeRate = closeRateRes.ok && closeRateRes.baseAmount > 0 ? closeRateRes.baseAmount : null;",
    detector: "PRE-M.4",
  },
  {
    name: "PM28 the pure rate helper returns the converted amount, losing sub-cent rates",
    file: "src/lib/fx/fx-rates.ts",
    from: "  return r && Number.isFinite(r.rate) && r.rate > 0 ? r.rate : null;",
    to: "  return r && Number.isFinite(r.rate) && r.rate > 0 ? roundMoney(r.rate) : null;",
    detector: "PRE-M.5",
  },
  {
    name: "PM24 the residue sweep stops comparing VALUE and trusts the unit count again",
    file: "supabase/sql/099_preM_residue_sweep_is_value_bounded.sql",
    from: "    if v_residue_base_value >= 0.005 then",
    to: "    if false and v_residue_base_value >= 0.005 then",
    detector: "PRE-M.4",
  },
  {
    name: "PM25 close fabricates rate 1 for a native residue instead of refusing",
    file: "supabase/sql/099_preM_residue_sweep_is_value_bounded.sql",
    from:
      "    if v_rate is null then\n" +
      "      raise exception 'KIPU_FX_REQUIRED: closing a native residue needs a current % -> % rate',",
    to:
      "    v_rate := coalesce(v_rate, 1);\n" +
      "    if v_rate is null then\n" +
      "      raise exception 'KIPU_FX_REQUIRED: closing a native residue needs a current % -> % rate',",
    detector: "PRE-M.4",
  },
];

function replaceNth(source, from, to, occurrence = 1) {
  let at = -1;
  let cursor = 0;
  for (let n = 0; n < occurrence; n += 1) {
    at = source.indexOf(from, cursor);
    if (at < 0) return null;
    cursor = at + from.length;
  }
  return source.slice(0, at) + to + source.slice(at + from.length);
}

let failures = 0;
for (const item of cases) {
  const before = fs.readFileSync(item.file, "utf8");
  const mutated = replaceNth(before, item.from, item.to, item.occurrence ?? 1);
  if (mutated == null) {
    console.error(`MISS · ${item.name}`);
    failures += 1;
    continue;
  }
  try {
    fs.writeFileSync(item.file, mutated);
    const run = spawnSync("node", ["scripts/qa/run-capture-gate.mjs"], {
      encoding: "utf8",
      env: process.env,
    });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    if (run.status !== 0 && output.includes(item.detector)) {
      console.log(`ok · ${item.name} → ${item.detector}`);
    } else {
      console.error(
        `SURVIVED · ${item.name} (exit=${run.status}, detector=${item.detector})`,
      );
      failures += 1;
    }
  } finally {
    fs.writeFileSync(item.file, before);
    if (fs.readFileSync(item.file, "utf8") !== before) {
      console.error(`RESIDUE · ${item.file}`);
      failures += 1;
    }
  }
}

const baseline = spawnSync("node", ["scripts/qa/run-capture-gate.mjs"], {
  encoding: "utf8",
  env: process.env,
});
const baselineCount = String(baseline.stdout ?? "").match(
  /\b(\d+)\/(\d+) capture checks\b/,
);
if (
  baseline.status !== 0 ||
  !baselineCount ||
  baselineCount[1] !== baselineCount[2]
) {
  console.error("BASELINE RED after restore");
  console.error(baseline.stdout);
  console.error(baseline.stderr);
  failures += 1;
}

if (failures > 0) {
  console.error(`Pre-M mutation audit: ${cases.length - failures}/${cases.length}`);
  process.exit(1);
}
console.log(`Pre-M mutation audit: ${cases.length}/${cases.length}, residue zero`);
