// Bloque K — mutation audit for the local, deterministic nets.
//
// This never leaves a mutation behind: each exact edit is restored in finally
// and the final byte comparison is mandatory. PostgreSQL-only invariants remain
// the responsibility of k-variable-fixed-e2e after migration 093 is applied.
//
//   node ./scripts/qa/k-mutation-audit.mjs

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const cases = [
  {
    name: "KM1 estimator stops using p75",
    file: "src/lib/financial/variable-fixed-estimator.ts",
    from: "const planningAmount = roundMoney(Math.max(0, p75, earlyFloor));",
    to: "const planningAmount = roundMoney(Math.max(0, robustMedian, earlyFloor));",
    detector: "IR172",
  },
  {
    name: "KM2 unread forecast publishes the declared fallback",
    file: "src/lib/financial/user-financial-context-builder.ts",
    from:
      "  let moneyFxIncomplete =\n" +
      "    variableFixedForecastUnavailable || knownVariableFixedBillsUnavailable;",
    to: "  let moneyFxIncomplete = false;",
    detector: "IR176",
  },
  {
    name: "KM3 materializer ignores the durable forecast",
    file: "src/lib/scheduled/recurring-materializer.ts",
    from: "amount: forecast.planningAmount,",
    to: "amount: fixedExpense.amount,",
    detector: "IR176",
  },
  {
    name: "KM4 one variable resolver branch bypasses the atomic writer",
    file: "src/lib/financial/recurring-resolve.ts",
    from: "return resolveVariableFixedOccurrence(input, occ, flow);",
    to: 'return { ok: false, detail: "mutated bypass" };',
    occurrence: 1,
    detector: "IR176",
  },
  {
    name: "KM5 observed-only users disappear from notifier discovery",
    file: "src/lib/scheduled/recurring-notifier.ts",
    from: '.in("status", ["pending", "observed", "booked"])',
    to: '.in("status", ["pending", "booked"])',
    detector: "IR176",
  },
  {
    name: "KM6 early observed bill asks for payment immediately",
    file: "src/lib/scheduled/digest-plan.ts",
    from: 'if (o.status === "observed" && input.today < o.occurrenceDate) {',
    to: 'if (false && o.status === "observed" && input.today < o.occurrenceDate) {',
    detector: "IR177b",
  },
  {
    name: "KM7 fixed/account lock order loses its before trigger",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "create trigger transactions_00_variable_fixed_plan_lock\nbefore insert on public.transactions",
    to: "create trigger transactions_99_variable_fixed_plan_lock\nafter insert on public.transactions",
    detector: "IR180",
  },
  {
    name: "KM8 response-lost replay fingerprints the optimistic snapshot",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "'entry_occurred_at', p->'entry'->>'occurred_at'",
    to: "'entry_changed_at', p->'entry'->>'occurred_at'",
    detector: "IR180",
  },
  {
    name: "KM9 observed cycle retains an old reversed transaction id",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "created_transaction_id = v_tx,",
    to: "created_transaction_id = coalesce(v_tx, created_transaction_id),",
    detector: "IR180",
  },
  {
    name: "KM10 recurring utility loses its real category",
    file: "src/lib/financial/recurring-ledger.ts",
    from: 'category: input.category ?? "other",',
    to: 'category: "other",',
    detector: "IR173",
  },
  {
    name: "KM11 failed forecast read is rendered as absence",
    file: "src/app/app/mis-datos/page.tsx",
    from: '" · no pude cargar la estimación"',
    to: '" · estimación aún no disponible"',
    detector: "IR181",
  },
  {
    name: "KM12 SQL estimator drifts from TS p75",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "percentile_cont(0.75) within group (order by amount)",
    to: "percentile_cont(0.50) within group (order by amount)",
    detector: "IR178",
  },
  {
    name: "KM13 late generic payment guesses across ambiguous cycles",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "if v_candidate_count > 1 then\n      raise exception",
    to: "if v_candidate_count > 999 then\n      raise exception",
    detector: "IR182",
  },
  {
    name: "KM14 paying an unchanged observed bill is mislabeled corrected",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "v_current.transaction_id is null\n" +
      "            and v_current.amount = new.original_amount\n" +
      "            and upper(v_current.currency) = upper(new.original_currency)",
    to:
      "v_current.transaction_id is not null\n" +
      "            and v_current.amount = new.original_amount\n" +
      "            and upper(v_current.currency) = upper(new.original_currency)",
    detector: "IR182",
  },
  {
    name: "KM15 pre-K foreign transaction is adopted as this bill",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "v_occ_tx.recurring_expense_id is distinct from v_fixed.id\n" +
      "       or upper(v_occ_tx.original_currency) is distinct from v_observation_currency",
    to:
      "false\n" +
      "       or upper(v_occ_tx.original_currency) is distinct from v_observation_currency",
    detector: "IR182",
  },
  {
    name: "KM16 occurrence creation stops sharing the plan lock",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "create trigger recurring_occurrences_00_variable_fixed_plan_lock\n" +
      "before insert\n" +
      "on public.recurring_occurrences",
    to:
      "create trigger recurring_occurrences_00_variable_fixed_plan_lock\n" +
      "after insert\n" +
      "on public.recurring_occurrences",
    detector: "IR182",
  },
  {
    name: "KM17 variability toggle leaves incompatible open occurrences",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "or old.is_variable is distinct from new.is_variable then",
    to: "or false then",
    detector: "IR183",
  },
  {
    name: "KM18 reversal ignores history after the plan becomes fixed",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "where id = v_original.recurring_expense_id\n" +
      "      and user_id = new.user_id\n" +
      "    for no key update;",
    to:
      "where id = v_original.recurring_expense_id\n" +
      "      and user_id = new.user_id\n" +
      "      and is_variable\n" +
      "    for no key update;",
    detector: "IR183",
  },
  {
    name: "KM19 retract is allowed to rewrite the permanent plan",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "if v_action = 'retract' and v_scope <> 'once' then",
    to: "if false and v_action = 'retract' and v_scope <> 'once' then",
    detector: "IR184",
  },
  {
    name: "KM20 retract accepts a different amount than the current fact",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "or v_current.amount is distinct from v_amount\n" +
      "       or upper(v_current.currency) is distinct from v_currency",
    to:
      "or false\n" +
      "       or upper(v_current.currency) is distinct from v_currency",
    detector: "IR184",
  },
  {
    name: "KM21 resolver from_now trusts a model-owned scope",
    file: "src/lib/ai/agent/agent-action-guard.ts",
    from:
      '  if (toolName === "resolve_recurring_occurrence") {\n' +
      "    // Bloque K",
    to:
      '  if (false && toolName === "resolve_recurring_occurrence") {\n' +
      "    // Bloque K",
    detector: "IR185",
  },
  {
    name: "KM22 fixed-expense identity is ignored while matching an occurrence",
    file: "src/lib/financial/recurring-resolve.ts",
    from: "? o.fixedExpenseId === ref.fixedExpenseId",
    to: "? true",
    detector: "IR186",
  },
  {
    name: "KM23 explicit plan currency may contradict its source account",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "  if (explicit && source && explicit !== source) {",
    to: "  if (false && explicit && source && explicit !== source) {",
    detector: "IR187",
  },
  {
    name: "KM24 omitted source silently re-labels an explicit native plan as base",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "  const currency = explicit ?? (/^[A-Z]{3}$/.test(source) ? source : null) ??\n" +
      "    (/^[A-Z]{3}$/.test(base) ? base : null);",
    to:
      "  const currency = (/^[A-Z]{3}$/.test(source) ? source : null) ??\n" +
      "    (/^[A-Z]{3}$/.test(base) ? base : null);",
    detector: "IR187",
  },
  {
    name: "KM25 emergency fallback permanently rewrites a variable bill",
    file: "src/lib/ai/commitment-handler.ts",
    from: "  if (similar[0].isVariable) {",
    to: "  if (false && similar[0].isVariable) {",
    detector: "IR188",
  },
  {
    name: "KM26 correction moves a historical payment to the current source",
    file: "src/lib/financial/recurring-resolve.ts",
    from: "    paymentSource: stated.paymentSource ?? prior.source,",
    to: "    paymentSource: stated.paymentSource ?? { id: \"mutated\", currency: \"USD\", isCard: false },",
    detector: "IR189",
  },
  {
    name: "KM27 reversal erases the observed bill instead of undoing only cash",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "set status = 'observed',\n" +
      "          created_transaction_id = null,\n" +
      "          resolved_amount = v_current.amount,\n" +
      "          resolved_currency = v_current.currency,",
    to:
      "set status = 'pending',\n" +
      "          created_transaction_id = null,\n" +
      "          resolved_amount = null,\n" +
      "          resolved_currency = null,",
    detector: "IR190",
  },
  {
    name: "KM28 broken forecast row is coerced into a planning number",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      "    planningAmount == null ||\n" +
      "    planningAmount < 0 ||",
    to:
      "    false ||\n" +
      "    planningAmount < 0 ||",
    occurrence: 1,
    detector: "IR191",
  },
  {
    name: "KM29 partial RPC response is narrated as a committed observation",
    file: "src/lib/financial/variable-fixed-store.ts",
    from: '    typeof row.replayed !== "boolean" ||',
    to: "    false ||",
    detector: "IR192",
  },
  {
    name: "KM30 unread fixed-expense list is rendered as legitimate absence",
    file: "src/app/app/mis-datos/page.tsx",
    from:
      "  const fixedExpensesAvailable =\n" +
      "    !fixedRes.error && fixedRows.length <= 500;",
    to:
      "  const fixedExpensesAvailable =\n" +
      "    true;",
    detector: "IR181",
  },
  {
    name: "KM31 a stated prior billing cycle is silently assigned to today",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "  const cycleDateWasStated = args.cycleDate != null;\n" +
      "  const today = todayISO(ctx);\n" +
      "  const cycleFactDate =\n" +
      "    args.cycleDate == null\n" +
      "      ? today\n" +
      "      : validCalendarDateISO(args.cycleDate);",
    to:
      "  const cycleDateWasStated = false;\n" +
      "  const today = todayISO(ctx);\n" +
      "  const cycleFactDate =\n" +
      "    todayISO(ctx);",
    detector: "IR179",
  },
  {
    name: "KM32 service_role bypasses the canonical writer with raw forecast writes",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "grant select on table public.fixed_expense_forecasts to service_role;",
    to:
      "grant select, insert, update, delete on table public.fixed_expense_forecasts to service_role;",
    detector: "IR193",
  },
  {
    name: "KM33 response-lost terminal replay is narrated as a failed action",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      '  if (action === "skip" && status === "skipped") {',
    to:
      '  if (false && action === "skip" && status === "skipped") {',
    detector: "IR194",
  },
  {
    name: "KM34 service_role can hard-delete a fixed plan and cascade its learned history",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "revoke delete on table public.fixed_expenses from authenticated, service_role;",
    to:
      "revoke delete on table public.fixed_expenses from authenticated;",
    detector: "IR195",
  },
  {
    name: "KM35 generic ledger capture manufactures a cycle with no open occurrence",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "if v_occ.id is null\n" +
      "     and (\n" +
      "       coalesce(new.external_ref, '') not like",
    to:
      "if false\n" +
      "     and (\n" +
      "       coalesce(new.external_ref, '') not like",
    detector: "IR196",
  },
  {
    name: "KM36 skipped/dismissed variable bill becomes an irreversible lock-out in PostgreSQL",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "v_occ.status not in ('pending','observed','booked','confirmed','corrected','skipped','dismissed')",
    to:
      "v_occ.status not in ('pending','observed','booked','confirmed','corrected')",
    detector: "IR197",
  },
  {
    name: "KM37 resolver refuses a later explicit correction after skip/dismiss",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      '        occ.status === "skipped" ||\n' +
      '        occ.status === "dismissed"',
    to:
      '        false ||\n' +
      "        false",
    detector: "IR197",
  },
  {
    name: "KM38 payment after a corrected skip is narrated as a first confirmation",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "          or v_occ.status = 'skipped'\n          then 'corrected'",
    to: "          or false\n          then 'corrected'",
    detector: "IR197",
  },
  {
    name: "KM39 a paid bill is narrated as newly observed and unpaid",
    file: "src/lib/financial/recurring-resolve.ts",
    from: '  if (input.action === "observe") {\n' +
      '    return "esa factura ya consta como pagada; no la volví a marcar como impaga. Si el monto estaba mal, corrígelo junto con el pago";',
    to: '  if (false && input.action === "observe") {\n' +
      '    return "esa factura ya consta como pagada; no la volví a marcar como impaga. Si el monto estaba mal, corrígelo junto con el pago";',
    detector: "IR198",
  },
  {
    name: "KM40 an identical paid correction moves through the writer again",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      '    input.action === "correct" &&\n' +
      "    input.amount != null &&\n" +
      "    input.resolvedAmount != null &&",
    to:
      "    false &&\n" +
      "    input.amount != null &&\n" +
      "    input.resolvedAmount != null &&",
    detector: "IR198",
  },
  {
    name: "KM41 an early missing cycle is guessed instead of clarified",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "!cycleDateWasStated &&\n" +
      "      occurrenceDate > today",
    to:
      "false &&\n" +
      "      occurrenceDate > today",
    detector: "IR179",
  },
  {
    name: "KM42 an impossible forecast date passes the decoder",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      "(lastCycleDate != null &&\n" +
      "      (!DATE_RE.test(lastCycleDate) || !validDateOnly(lastCycleDate)))",
    to:
      "(lastCycleDate != null &&\n" +
      "      !DATE_RE.test(lastCycleDate))",
    detector: "IR191",
  },
  {
    name: "KM43 from_now loses the current cycle as first evidence of the new regime",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "if v_scope = 'from_now'\n" +
      "       and v_current.regime is distinct from v_forecast.regime then",
    to:
      "if false\n" +
      "       and v_current.regime is distinct from v_forecast.regime then",
    detector: "IR199",
  },
  {
    name: "KM44 a malformed learned row is rendered as a real UI forecast",
    file: "src/app/app/mis-datos/page.tsx",
    from:
      "    fixedForecastRows.length <= 500 &&\n" +
      "    decodedFixedForecasts.every((forecast) => forecast != null);",
    to:
      "    fixedForecastRows.length <= 500;",
    detector: "IR181",
  },
  {
    name: "KM45 historical corrections inherit today's plan currency",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      "occ.resolvedCurrency ?? occ.currency ?? flow.currency ??",
    to:
      "flow.currency ?? occ.resolvedCurrency ?? occ.currency ??",
    detector: "IR200",
  },
  {
    name: "KM46 cycle uniqueness ignores the forecast regime",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "on public.fixed_expense_observations(fixed_expense_id, regime, cycle_date)",
    to:
      "on public.fixed_expense_observations(fixed_expense_id, cycle_date)",
    detector: "IR200",
  },
  {
    name: "KM47 a historical occurrence is not the identity of its current fact",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "on public.fixed_expense_observations(occurrence_id)\n" +
      "  where is_current and occurrence_id is not null;",
    to:
      "on public.fixed_expense_observations(fixed_expense_id)\n" +
      "  where is_current and occurrence_id is not null;",
    detector: "IR200",
  },
  {
    name: "KM48 occurrence snapshot trigger locks the nullable outer-join side",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "for no key update of f;",
    to: "for no key update;",
    detector: "IR200",
  },
  {
    name: "KM49 ledger trigger ignores the occurrence's historical regime",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "v_observation_regime := coalesce(\n" +
      "    v_occ.fixed_expense_regime,\n" +
      "    v_forecast.regime",
    to:
      "v_observation_regime := coalesce(\n" +
      "    v_forecast.regime,\n" +
      "    v_forecast.regime",
    detector: "IR200",
  },
  {
    name: "KM50 create-and-pay trusts a forgeable external_ref without a private transaction mark",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "perform set_config(\n" +
      "      ''kipu.variable_fixed_create_payment''",
    to:
      "perform set_config(\n" +
      "      ''kipu.variable_fixed_create_payment_mutated''",
    detector: "IR196",
  },
  {
    name: "KM51 the agent routes a variable monthly bill through log_movement again",
    file: "src/lib/ai/agent/kipu-agent.ts",
    from:
      "Un gasto fijo VARIABLE tiene una sola ruta: resolve_recurring_occurrence",
    to:
      "Un gasto fijo VARIABLE puede ir por log_movement",
    detector: "IR201",
  },
  {
    name: "KM52 a first variable-bill payment silently uses the plan's usual account",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      'action === "pay" &&\n' +
      "    !occ.createdTransactionId &&\n" +
      "    !paymentSource",
    to:
      "false &&\n" +
      "    !occ.createdTransactionId &&\n" +
      "    !paymentSource",
    detector: "IR202",
  },
  {
    name: "KM53 the pure estimator discards an expensive real bill as an outlier",
    file: "src/lib/financial/variable-fixed-estimator.ts",
    from:
      "(observation) => observation.amount >= center - fence,",
    to:
      "(observation) => Math.abs(observation.amount - center) <= fence,",
    detector: "IR172",
  },
  {
    name: "KM54 the SQL estimator discards expensive evidence and can inflate Saldo",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "amount >= coalesce(v_center, amount) - v_fence",
    to:
      "abs(amount - coalesce(v_center, amount)) <= v_fence",
    occurrence: 1,
    detector: "IR178",
  },
  {
    name: "KM55 the lower fence becomes so wide that a fake zero bill lowers protection",
    file: "src/lib/financial/variable-fixed-estimator.ts",
    from:
      "const fence = Math.max(0.01, center * 0.75, mad * 4);",
    to:
      "const fence = Math.max(0.01, center * 1.5, mad * 4);",
    detector: "IR172",
  },
  {
    name: "KM56 SQL lets an implausible cheap reading enter the learned reserve",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "coalesce(v_center,0) * 0.75",
    to:
      "coalesce(v_center,0) * 1.5",
    detector: "IR178",
  },
  {
    name: "KM57 a historical USD amount is allowed to rewrite today's EUR plan",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      "return /^[A-Z]{3}$/.test(cycle) && cycle === plan;",
    to:
      "return /^[A-Z]{3}$/.test(cycle);",
    detector: "IR203",
  },
  {
    name: "KM58 the database reinterprets a historical amount in the current plan currency",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "if v_scope = 'from_now'\n" +
      "     and upper(v_fixed.currency) is distinct from v_currency then",
    to:
      "if false\n" +
      "     and upper(v_fixed.currency) is distinct from v_currency then",
    detector: "IR203",
  },
  {
    name: "KM59 pre-K adoption compares a historical transaction with today's plan currency",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "upper(v_occ_tx.original_currency) is distinct from v_observation_currency",
    to:
      "upper(v_occ_tx.original_currency) is distinct from upper(v_fixed.currency)",
    detector: "IR203",
  },
  {
    name: "KM60 an amount learned after the third ask never gets a payment follow-up",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "ask_count = case when v_status = 'observed' then 0 else ask_count end",
    to:
      "ask_count = ask_count",
    detector: "IR204",
  },
  {
    name: "KM61 unpaid deletes or closes the learned bill instead of postponing payment",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      'case "unpaid": {',
    to:
      'case "unpaid_mutated": {',
    detector: "IR205",
  },
  {
    name: "KM62 skip may erase a real observed bill",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      'case "skip": {\n' +
      '      if (occ.status === "observed") {\n' +
      "        return {",
    to:
      'case "skip": {\n' +
      '      if (false) {\n' +
      "        return {",
    detector: "IR205",
  },
  {
    name: "KM63 the tool schema collapses unpaid and retract back into skip",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      'enum: ["observe", "confirm", "correct", "unpaid", "retract", "skip", "snooze", "dismiss"]',
    to:
      'enum: ["observe", "confirm", "correct", "skip", "snooze", "dismiss"]',
    detector: "IR205",
  },
  {
    name: "KM64 an old retract identity survives after the cycle is paid",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "and history.occurrence_id = v_occ.id",
    to:
      "and false",
    detector: "IR206",
  },
  {
    name: "KM65 a missing numeric forecast field is coerced into zero",
    file: "src/lib/financial/variable-fixed-store.ts",
    from: "value == null ||",
    to: "false ||",
    detector: "IR191",
  },
  {
    name: "KM66 forecast binding ignores the declared plan amount",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      "    Math.abs(forecast.declaredAmount - planAmount) < 0.005 &&",
    to:
      "    true &&",
    detector: "IR207",
  },
  {
    name: "KM67 money context publishes a forecast from a different plan snapshot",
    file: "src/lib/financial/user-financial-context-builder.ts",
    from: "variableFixedForecastMatchesPlan(forecast, expense);",
    to: "true;",
    detector: "IR207",
  },
  {
    name: "KM68 materializer books from a forecast with stale cadence or plan amount",
    file: "src/lib/scheduled/recurring-materializer.ts",
    from: "!variableFixedForecastMatchesPlan(forecast, fixedExpense)",
    to: "false",
    detector: "IR207",
  },
  {
    name: "KM69 agent opens a cycle using a forecast from another plan snapshot",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "!variableFixedForecastMatchesPlan(forecast, activeTarget)",
    to: "false",
    detector: "IR207",
  },
  {
    name: "KM70 Mis Datos renders a stale forecast as current",
    file: "src/app/app/mis-datos/page.tsx",
    from: "variableFixedForecastMatchesPlan(forecast, {",
    to: "(() => true)({",
    detector: "IR207",
  },
  {
    name: "KM71 settings renders a stale forecast as current",
    file: "src/app/app/settings/data-card.tsx",
    from: "variableFixedForecastMatchesPlan(forecast, {",
    to: "(() => true)({",
    detector: "IR207",
  },
  {
    name: "KM72 SQL refresh leaves the durable forecast bound to an old cadence",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "      currency = upper(v_fixed.currency),\n" +
      "      cadence = v_fixed.frequency,",
    to:
      "      currency = upper(v_fixed.currency),",
    detector: "IR207",
  },
  {
    name: "KM73 stale forecast for an inactive plan unnecessarily turns Saldo off",
    file: "src/lib/financial/user-financial-context-builder.ts",
    from: "if (expense.isActive && forecast && !forecastMatches)",
    to: "if (forecast && !forecastMatches)",
    detector: "IR207",
  },
  {
    name: "KM74 zero variable bill remains observed with an impossible payment pending",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "case when v_amount = 0 then 'confirmed' else 'observed' end",
    to: "'observed'",
    occurrence: 1,
    detector: "IR208",
  },
  {
    name: "KM75 zero-bill replay is narrated as a paid transaction",
    file: "src/lib/financial/recurring-resolve.ts",
    from: '    input.status !== "confirmed" ||',
    to: "    true ||",
    detector: "IR208",
  },
  {
    name: "KM76 zero-bill confirmation falsely says payment is still pending",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      'amount === 0\n' +
      '          ? "anoté que la factura vino en cero; quedó cerrada sin registrar ningún pago"',
    to:
      'amount === 0\n' +
      '          ? "anoté la factura; todavía NO registré un pago"',
    detector: "IR208",
  },
  {
    name: "KM77 individual log trusts a model-owned fixedExpenseId",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "const fixedLink = validateFixedExpenseMovementLink(",
    to: "const fixedLink = (() => ({ ok: true }))(",
    occurrence: 1,
    detector: "IR209",
  },
  {
    name: "KM78 batch log trusts a model-owned fixedExpenseId",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "const fixedLink = validateFixedExpenseMovementLink(",
    to: "const fixedLink = (() => ({ ok: true }))(",
    occurrence: 2,
    detector: "IR209",
  },
  {
    name: "KM79 a named bill can be linked to a different fixed plan id",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "matched.matchedExpense?.id !== target.id",
    to: "false",
    detector: "IR209",
  },
  {
    name: "KM80 a base-rendered plan stops matching its native bill amount",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "      expense.originalAmount ??\n" +
      "      expense.declaredAmount ??\n" +
      "      expense.amount,",
    to: "      expense.amount,",
    detector: "IR209",
  },
  {
    name: "KM81 the start-of-turn agent context omits fixed plans",
    file: "src/lib/ai/agent/kipu-agent.ts",
    from: "    fixedExpenses: financialContext.fixedExpenses,",
    to: "    fixedExpenses: [],",
    detector: "IR209",
  },
  {
    name: "KM82 a refresh leaves the fixed-plan evidence stale",
    file: "src/lib/ai/agent/kipu-agent.ts",
    from: "      agentCtx.fixedExpenses = fresh.fixedExpenses;",
    to: "      agentCtx.fixedExpenses = [];",
    detector: "IR209",
  },
  {
    name: "KM83 LatAm thousands separators are read as decimals",
    file: "src/lib/financial/fixed-expense-matcher.ts",
    from:
      "    fractionDigits >= 1 && fractionDigits <= 2\n" +
      "      ? compact[lastSeparator]",
    to:
      "    false\n" +
      "      ? compact[lastSeparator]",
    detector: "IR209",
  },
  {
    name: "KM84 an explicitly different currency is relabeled as the plan currency",
    file: "src/lib/financial/fixed-expense-matcher.ts",
    from:
      "const explicitCurrency = extractExplicitCurrency(normalizedMessage);",
    to: "const explicitCurrency = null;",
    detector: "IR209",
  },
  {
    name: "KM85 a server-confirmed fixed bill deadlocks on the bare confirmation",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "  if (serverAuthorized) return { ok: true };",
    to: "  if (false && serverAuthorized) return { ok: true };",
    detector: "IR209",
  },
  {
    name: "KM86 the durable proposal hides the fixed bill behind an internal id",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "    ...(ctx.fixedExpenses ?? []).map((row) => ({ id: row.id, name: row.name })),",
    to:
      "    ...(ctx.fixedExpenses ?? []).map(() => ({ id: '', name: '' })),",
    detector: "IR209",
  },
  {
    name: "KM87 the dispatcher forgets fixed-bill authority after claiming it",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "      return executeLogMovement(args, ctx, confirmation.serverAuthorized);",
    to: "      return executeLogMovement(args, ctx, false);",
    detector: "IR209",
  },
  {
    name: "KM88 the batch dispatcher forgets fixed-bill authority after claiming it",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      '    case "log_movements_batch":\n' +
      "      return executeLogMovementsBatch(\n" +
      "        args,\n" +
      "        ctx,\n" +
      "        confirmation.serverAuthorized,\n" +
      "      );",
    to:
      '    case "log_movements_batch":\n' +
      "      return executeLogMovementsBatch(\n" +
      "        args,\n" +
      "        ctx,\n" +
      "        false,\n" +
      "      );",
    detector: "IR209",
  },
  {
    name: "KM131 omitting fixedExpenseId bypasses the variable-bill lifecycle",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "    if (detectedVariable) {",
    to: "    if (false && detectedVariable) {",
    detector: "IR214",
  },
  {
    name: "KM132 explicit wrong currency erases the uniquely named variable plan",
    file: "src/lib/financial/fixed-expense-matcher.ts",
    from:
      "        matchedExpense: matches.length === 1 ? matches[0] : undefined,\n" +
      "        candidateExpenses: matches,",
    to:
      "        matchedExpense: undefined,\n" +
      "        candidateExpenses: [],",
    detector: "IR214",
  },
  {
    name: "KM133 variable amount mismatch is allowed into the legacy pending flow",
    file: "src/lib/financial/fixed-expense-matcher.ts",
    from: "  return (\n    result.matchedExpense?.isVariable === true ||",
    to: "  return false && (\n    result.matchedExpense?.isVariable === true ||",
    detector: "IR215",
  },
  {
    name: "KM134 legacy opens a pending clarification before blocking a variable bill",
    file: "src/lib/ai/chat-transaction-handler.ts",
    from:
      "  if (shouldBlockVariableFixedLegacyMatch(fixedExpenseMatch)) {",
    to:
      "  if (false && shouldBlockVariableFixedLegacyMatch(fixedExpenseMatch)) {",
    detector: "IR215",
  },
  {
    name: "KM135 an old pending clarification can pay a plan that is now variable",
    file: "src/lib/ai/chat-transaction-handler.ts",
    from: "    if (currentPlan.isVariable) {",
    to: "    if (false && currentPlan.isVariable) {",
    detector: "IR215",
  },
  {
    name: "KM136 a dismissed historical invoice escapes the canonical resolver and can be paid twice",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "and historical_occurrence.status in ('observed','dismissed')",
    to: "and historical_occurrence.status = 'observed'",
    detector: "IR216",
  },
  {
    name: "KM137 Mis Datos ignores the variable toggle and creates an auto-booked fixed plan",
    file: "src/app/app/mis-datos/actions.ts",
    from: '        isVariable: bool(formData, "isVariable"),',
    to: "        isVariable: false,",
    detector: "IR217",
  },
  {
    name: "KM138 an ambiguous name hides every variable candidate and reopens the generic ledger",
    file: "src/lib/financial/fixed-expense-matcher.ts",
    from:
      "        candidateExpenses: matches,\n" +
      "        clarificationQuestion: question,",
    to: "        clarificationQuestion: question,",
    detector: "IR214",
  },
  {
    name: "KM139 a stale legacy clarification rewrites a plan after it became variable",
    file: "src/lib/financial/commitments-store.ts",
    from: '    .eq("is_variable", false)\n',
    to: "",
    detector: "IR218",
  },
  {
    name: "KM140 the primary simple writer ignores a concurrent variability change",
    file: "src/lib/financial/commitments-store.ts",
    from:
      '    query = query.eq("is_variable", input.expectedIsVariable);',
    to: "    query = query;",
    detector: "IR219",
  },
  {
    name: "KM141 atomic edit+pay omits the expected variability snapshot",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "    patch._expected_is_variable = fixedTarget.isVariable === true;",
    to: "",
    detector: "IR219",
  },
  {
    name: "KM142 PostgreSQL does not compare the variability snapshot after locking the plan",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "    if v_patch ? ''_expected_is_variable''",
    to: "    if false and v_patch ? ''_expected_is_variable''",
    detector: "IR219",
  },
  {
    name: "KM143 a paid bill corrected to zero is treated as an unpaid observation and leaves the old cash movement alive",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      '    return input.createdTransactionId == null ? "observe" : "zero";',
    to:
      '    return "observe";',
    detector: "IR220",
  },
  {
    name: "KM144 the zero correction stops reversing the prior paid transaction",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "if v_action in ('pay','zero')\n       and v_current.id is not null",
    to: "if v_action = 'pay'\n       and v_current.id is not null",
    detector: "IR220",
  },
  {
    name: "KM145 an active variable plan can protect zero and inflate Saldo before it has history",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "if new.is_active and new.is_variable and new.amount <= 0 then",
    to:
      "if false and new.is_active and new.is_variable and new.amount <= 0 then",
    detector: "IR221",
  },
  {
    name: "KM146 a missing durable baseline is narrated as normal waiting instead of a broken invariant",
    file: "src/app/app/mis-datos/page.tsx",
    from: '" · falta la estimación durable de este plan"',
    to: '" · estimación aún no disponible"',
    detector: "IR181",
  },
  {
    name: "KM147 an ordinary fixed flow receives variable-bill replay copy without proving its regime",
    file: "src/lib/financial/recurring-resolve.ts",
    from: "  if (!input.isVariableFixed) return null;",
    to: "  if (false && !input.isVariableFixed) return null;",
    detector: "IR198",
  },
  {
    name: "KM148 an observed bill can claim a cash transaction in an internally impossible RPC result",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      '      : expectedAction === "observe"\n' +
      "        ? transactionId == null &&\n" +
      '          (status === "observed" || status === "confirmed")',
    to:
      '      : expectedAction === "observe"\n' +
      '        ? (status === "observed" || status === "confirmed")',
    detector: "IR192",
  },
  {
    name: "KM149 the RPC can claim high confidence with zero historical samples",
    file: "src/lib/financial/variable-fixed-store.ts",
    from: "    !confidenceMatchesSample",
    to: "    false",
    detector: "IR192",
  },
  {
    name: "KM150 an observed variable bill corrected to zero is rejected by the generic positive-amount gate",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      "      if (flow.isVariableFixed) {\n" +
      "        return resolveVariableFixedOccurrence(input, occ, flow);\n" +
      "      }\n" +
      "      if (!(input.amount > 0)) {",
    to:
      "      if (flow.isVariableFixed && input.amount > 0) {\n" +
      "        return resolveVariableFixedOccurrence(input, occ, flow);\n" +
      "      }\n" +
      "      if (!(input.amount > 0)) {",
    occurrence: 1,
    detector: "IR220",
  },
  {
    name: "KM151 reversal succeeds after the occurrence stopped pointing at that payment",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "      if not found then\n" +
      "        raise exception\n" +
      "          'KIPU_CONFLICT: variable bill occurrence no longer points to the reversed payment'\n" +
      "          using errcode = '22023';\n" +
      "      end if;",
    to: "",
    detector: "IR190",
  },
  {
    name: "KM152 an ambiguous open variable cycle is treated as absence and replaced by the current cycle",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "    match.id === null &&\n" +
      '    match.reason === "none" &&\n',
    to: "    match.id === null &&\n",
    detector: "IR186",
  },
  {
    name: "KM153 PostgreSQL accepts an observed occurrence with no complete native bill fact",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "      and resolved_amount is not null\n" +
      "      and resolved_currency is not null\n" +
      "      and created_transaction_id is null",
    to: "      and true\n" +
      "      and true\n" +
      "      and true",
    detector: "IR177",
  },
  {
    name: "KM154 raw RPC re-declares a paid bill as an unpaid observation through the same-amount no-op",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "  if v_action = 'observe'\n" +
      "     and v_current.id is not null\n" +
      "     and v_current.transaction_id is not null then",
    to:
      "  if false\n" +
      "     and v_current.id is not null\n" +
      "     and v_current.transaction_id is not null then",
    detector: "IR220",
  },
  {
    name: "KM155 dismissing the reminder makes an unpaid variable fact impossible to retract",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      "    input.isVariableFixed &&\n" +
      '    input.action === "retract" &&',
    to:
      "    input.isVariableFixed &&\n" +
      '    input.action === "confirm" &&',
    detector: "IR222",
  },
  {
    name: "KM156 the terminal retract decision is computed but never reaches the canonical writer",
    file: "src/lib/financial/recurring-resolve.ts",
    from: "        return retractVariableFixedOccurrence(input, occ);",
    to: '        return { ok: false, detail: "mutated terminal lockout" };',
    detector: "IR222",
  },
  {
    name: "KM157 a batch row with a generic description hides the variable bill named in the user's full message",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      '      `${ctx.rawMessage} ${String(r.description ?? "")} ${String(r.amount ?? "")}`,',
    to:
      '      `${String(r.description ?? "")} ${String(r.amount ?? "")}`,',
    detector: "IR223",
  },
  {
    name: "KM158 a malformed pay response claims success without a durable transaction id",
    file: "src/lib/financial/variable-fixed-store.ts",
    from: "    !actionMatchesResult ||",
    to: "    false ||",
    detector: "IR192",
  },
  {
    name: "KM89 a plan edit leaves its unknown cycle in the old lane and amount",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "    set mode = case when new.is_variable then 'ask' else 'auto' end,\n" +
      "        expected_amount = new.amount,",
    to:
      "    set mode = 'ask',\n" +
      "        expected_amount = old.amount,",
    detector: "IR210",
  },
  {
    name: "KM90 pausing a plan erases a known unpaid bill",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "      and status = 'pending';",
    to: "      and status in ('pending','observed');",
    occurrence: 2,
    detector: "IR210",
  },
  {
    name: "KM91 pausing a plan no longer retires an unknown future ask",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "  if old.is_active and not new.is_active then",
    to: "  if false and old.is_active and not new.is_active then",
    detector: "IR210",
  },
  {
    name: "KM92 deactivation no longer wakes the forecast lifecycle trigger",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "after insert or update of amount, currency, frequency, is_variable, is_active",
    to:
      "after insert or update of amount, currency, frequency, is_variable",
    detector: "IR210",
  },
  {
    name: "KM93 the database writer rejects an observed historical bill after the plan changes",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "        and prior.is_current",
    to: "        and false",
    detector: "IR210",
  },
  {
    name: "KM94 the resolver forgets the historical variable fact for account-backed bills",
    file: "src/lib/financial/recurring-resolve.ts",
    from: "isVariableFixed: data.is_variable === true || hasVariableFact,",
    to: "isVariableFixed: data.is_variable === true,",
    occurrence: 2,
    detector: "IR210",
  },
  {
    name: "KM95 a historical bill rewrites a plan that is no longer variable",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "  if not v_fixed.is_variable and v_scope <> 'once' then",
    to: "  if false and not v_fixed.is_variable and v_scope <> 'once' then",
    detector: "IR210",
  },
  {
    name: "KM96 toggling variable/fixed no longer opens a durable server proposal",
    file: "src/lib/ai/agent/agent-action-guard.ts",
    from: '      typeof args.isVariable === "boolean"',
    to: "      false",
    detector: "IR211",
  },
  {
    name: "KM97 changing variability is accepted without a claimed proposal",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "  const variabilityChanges =\n" +
      "    isVariable !== undefined &&\n" +
      "    isVariable !== (fixedTarget.isVariable === true);",
    to: "  const variabilityChanges = false;",
    detector: "IR211",
  },
  {
    name: "KM98 variable-to-fixed hides a permanent amount change",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "  const changesCurrentVariableAmount =\n" +
      "    fixedTarget.isVariable === true && newAmount !== undefined;",
    to: "  const changesCurrentVariableAmount = false;",
    detector: "IR211",
  },
  {
    name: "KM99 generic ledger capture bypasses an observed historical bill",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "  if not v_fixed.is_variable then",
    to: "  if false and not v_fixed.is_variable then",
    detector: "IR211",
  },
  {
    name: "KM100 one expensive invoice dominates the learned reserve again",
    file: "src/lib/financial/variable-fixed-estimator.ts",
    from: ".map((observation) => Math.min(observation.amount, upperFence))",
    to: ".map((observation) => observation.amount)",
    detector: "IR172",
  },
  {
    name: "KM101 SQL forgets the same upper fence used by the pure estimator",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "select least(amount, v_upper_fence) as amount, cycle_date, id",
    to: "select amount, cycle_date, id",
    occurrence: 2,
    detector: "IR178",
  },
  {
    name: "KM102 a forecast-table blip shuts Saldo for users without variable plans",
    file: "src/lib/financial/user-financial-context-builder.ts",
    from:
      "  const forecastUnavailable =\n" +
      "    input.activeVariablePlanExists && !input.forecastReadComplete;",
    to:
      "  const forecastUnavailable = !input.forecastReadComplete;",
    detector: "IR235",
  },
  {
    name: "KM103 a permanent plan edit leaves a pending cycle in the old currency",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "        currency = upper(new.currency),",
    to: "        currency = upper(old.currency),",
    occurrence: 1,
    detector: "IR210",
  },
  {
    name: "KM104 a permanent cadence edit leaves a pending cycle with the old contract",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "        fixed_expense_cadence = new.frequency,",
    to: "        fixed_expense_cadence = old.frequency,",
    occurrence: 1,
    detector: "IR210",
  },
  {
    name: "KM105 an amount-only reply relabels a legacy booked payment as an unpaid observation",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      '  return input.action === "observe" && input.createdTransactionId != null;',
    to: "  return false;",
    detector: "IR198",
  },
  {
    name: "KM106 log_movement treats a named variable invoice as proof that cash moved",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "  if (target.isVariable) {",
    to: "  if (false && target.isVariable) {",
    detector: "IR209",
  },
  {
    name: "KM107 the emergency legacy pipeline still books an exact variable invoice without proving payment",
    file: "src/lib/ai/chat-transaction-handler.ts",
    from:
      "  if (shouldBlockVariableFixedLegacyMatch(fixedExpenseMatch)) {",
    to:
      '  if (fixedExpenseMatch.status !== "confident_match" && shouldBlockVariableFixedLegacyMatch(fixedExpenseMatch)) {',
    detector: "IR215",
  },
  {
    name: "KM108 the production executor dates a new payment on the old occurrence day",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "    defaultPaymentDateISO: today,",
    to: "    defaultPaymentDateISO: undefined,",
    detector: "IR189",
  },
  {
    name: "KM109 a correction silently moves an existing payment to today's date",
    file: "src/lib/financial/recurring-resolve.ts",
    from: "  return input.hasExistingPayment ? undefined : input.defaultDateISO;",
    to: "  return input.defaultDateISO;",
    detector: "IR189",
  },
  {
    name: "KM110 an explicitly named billing cycle resolves another open month",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      "      (ref.occurrenceDate\n" +
      "        ? o.occurrenceDate === ref.occurrenceDate\n" +
      "        : true),",
    to:
      "      (ref.occurrenceDate\n" +
      "        ? true\n" +
      "        : true),",
    detector: "IR186",
  },
  {
    name: "KM111 PostgreSQL accepts a contradictory forecast state",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "constraint fixed_expense_forecasts_state_ck check (\n" +
      "    (\n" +
      "      sample_count = 0",
    to:
      "constraint fixed_expense_forecasts_state_ck check (\n" +
      "    true or (\n" +
      "      sample_count = 0",
    detector: "IR191",
  },
  {
    name: "KM112 the reader accepts lowercase noncanonical forecast currency",
    file: "src/lib/financial/variable-fixed-store.ts",
    from: "    rawCurrency !== currency ||",
    to: "    false ||",
    detector: "IR191",
    occurrence: 1,
  },
  {
    name: "KM113 the reader accepts confidence/sample/method contradictions",
    file: "src/lib/financial/variable-fixed-store.ts",
    from: "  if (!coherentState) return null;",
    to: "  if (false && !coherentState) return null;",
    detector: "IR191",
  },
  {
    name: "KM114 the pre-K pending cycle keeps a stale expected amount",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "set mode = 'ask',\n" +
      "    expected_amount = f.planning_amount,\n" +
      "    currency = f.currency,",
    to:
      "set mode = 'ask',\n" +
      "    expected_amount = o.expected_amount,\n" +
      "    currency = f.currency,",
    detector: "IR210",
  },
  {
    name: "KM115 a missing FX rate leaves the native bill in the base-money field",
    file: "src/lib/financial/user-financial-context-builder.ts",
    from:
      "          amount: 0,\n" +
      "          originalAmount: planningNative,\n" +
      "          originalCurrency: plannedExpense.currency,\n" +
      "          currency: baseUpper,\n" +
      "          planningProjectionAvailable,\n" +
      "          planningValuationAvailable: false,",
    to:
      "          amount: planningNative,\n" +
      "          originalAmount: planningNative,\n" +
      "          originalCurrency: plannedExpense.currency,\n" +
      "          currency: baseUpper,\n" +
      "          planningProjectionAvailable,\n" +
      "          planningValuationAvailable: false,",
    detector: "IR212",
  },
  {
    name: "KM116 agent publishes an unvalued native bill as a base amount",
    file: "src/lib/ai/agent/kipu-agent.ts",
    from:
      "expense.planningProjectionAvailable === false ||\n" +
      "        expense.planningValuationAvailable === false\n" +
      "          ? null\n" +
      "          : expense.amount",
    to:
      "expense.planningProjectionAvailable === false ||\n" +
      "        expense.planningValuationAvailable === false\n" +
      "          ? expense.amount\n" +
      "          : expense.amount",
    detector: "IR212",
  },
  {
    name: "KM117 a bill already in base currency is neutralized as if FX were missing",
    file: "src/lib/financial/user-financial-context-builder.ts",
    from:
      "if (\n" +
      "        plannedExpense.currency.trim().toUpperCase() === baseUpper\n" +
      "      ) {",
    to:
      "if (\n" +
      "        false && plannedExpense.currency.trim().toUpperCase() === baseUpper\n" +
      "      ) {",
    detector: "IR212",
  },
  {
    name: "KM118 the system prompt routes an observed unpaid bill back to skip",
    file: "src/lib/ai/agent/kipu-agent.ts",
    from: '"todavía no la pagué" = unpaid',
    to: '"todavía no la pagué" = skip',
    detector: "IR212",
  },
  {
    name: "KM129 the context builder labels a missing forecast as a proven projection",
    file: "src/lib/financial/user-financial-context-builder.ts",
    from:
      "const planningProjectionAvailable =\n" +
      "        !expense.isVariable || forecastMatches;",
    to:
      "const planningProjectionAvailable =\n" +
      "        !expense.isVariable || true;",
    detector: "IR212",
  },
  {
    name: "KM130 agent leaks the declared amount as a learned projection after a failed forecast read",
    file: "src/lib/ai/agent/kipu-agent.ts",
    from:
      "expense.planningProjectionAvailable === false\n" +
      "          ? null\n" +
      "          : expense.planningAmount ??",
    to:
      "expense.planningProjectionAvailable === false\n" +
      "          ? expense.planningAmount\n" +
      "          : expense.planningAmount ??",
    detector: "IR212",
  },
  {
    name: "KM119 reversal keeps the bill amount but labels it unknown",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "set status = 'observed',\n" +
      "          created_transaction_id = null,\n" +
      "          resolved_amount = v_current.amount,\n" +
      "          resolved_currency = v_current.currency,",
    to:
      "set status = 'pending',\n" +
      "          created_transaction_id = null,\n" +
      "          resolved_amount = v_current.amount,\n" +
      "          resolved_currency = v_current.currency,",
    detector: "IR190",
  },
  {
    name: "KM120 reversal keeps the old payment attached to the superseding bill",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "v_current.cadence, v_current.amount, v_current.currency, null,\n" +
      "      v_current.source, v_current.id, true",
    to:
      "v_current.cadence, v_current.amount, v_current.currency, v_original.id,\n" +
      "      v_current.source, v_current.id, true",
    detector: "IR190",
  },
  {
    name: "KM121 production executor drops the delivery identity on variable-bill writes",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "    operationId: ctx.operationId,",
    to: "    operationId: undefined,",
    detector: "IR190",
  },
  {
    name: "KM122 variable-bill dedupe ignores a fresh explicit user operation",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      "  const result = await recordVariableFixedObservation({\n" +
      "    userId: input.userId,\n" +
      "    occurrenceId: occ.id,\n" +
      "    amount,\n" +
      "    currency,\n" +
      "    action,\n" +
      "    scope,\n" +
      "    dedupeKey: [\n" +
      '      "variable-fixed",\n' +
      '      input.operationId?.trim() || "semantic",',
    to:
      "  const result = await recordVariableFixedObservation({\n" +
      "    userId: input.userId,\n" +
      "    occurrenceId: occ.id,\n" +
      "    amount,\n" +
      "    currency,\n" +
      "    action,\n" +
      "    scope,\n" +
      "    dedupeKey: [\n" +
      '      "variable-fixed",\n' +
      '      "semantic",',
    detector: "IR190",
  },
  {
    name: "KM123 reversal stops locking the occurrence before the observation",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "      where id = v_current.occurrence_id\n" +
      "        and user_id = new.user_id\n" +
      "      for update;",
    to:
      "      where id = v_current.occurrence_id\n" +
      "        and user_id = new.user_id;",
    detector: "IR190",
  },
  {
    name: "KM124 pure estimator converts a broken declared amount into zero",
    file: "src/lib/financial/variable-fixed-estimator.ts",
    from: "  if (!Number.isFinite(declaredRaw) || declaredRaw < 0) {",
    to: "  if (false && (!Number.isFinite(declaredRaw) || declaredRaw < 0)) {",
    detector: "IR172",
  },
  {
    name: "KM125 pure estimator accepts a noncanonical planning currency",
    file: "src/lib/financial/variable-fixed-estimator.ts",
    from: "  if (!/^[A-Z]{3}$/.test(currency)) {",
    to: "  if (false && !/^[A-Z]{3}$/.test(currency)) {",
    detector: "IR172",
  },
  {
    name: "KM126 booked variable confirmation marks state without adopting its ledger fact",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      "        if (flow.isVariableFixed) {\n" +
      "          if (!occ.createdTransactionId || !occ.fixedExpenseId) {",
    to:
      "        if (false && flow.isVariableFixed) {\n" +
      "          if (!occ.createdTransactionId || !occ.fixedExpenseId) {",
    detector: "IR213",
  },
  {
    name: "KM127 generic ledger overwrites a different booked payment",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "  if v_occ.created_transaction_id is not null\n" +
      "     and v_occ.created_transaction_id <> new.id then",
    to:
      "  if false and v_occ.created_transaction_id is not null\n" +
      "     and v_occ.created_transaction_id <> new.id then",
    detector: "IR213",
  },
  {
    name: "KM128 retract identity cannot distinguish a fresh command from old redelivery",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      '    action: "retract",\n' +
      '    scope: "once",\n' +
      "    dedupeKey: [\n" +
      '      "variable-fixed",\n' +
      '      input.operationId?.trim() || "semantic",\n' +
      "      occ.id,\n" +
      '      "retract",',
    to:
      '    action: "retract",\n' +
      '    scope: "once",\n' +
      "    dedupeKey: [\n" +
      '      "variable-fixed",\n' +
      '      "semantic",\n' +
      "      occ.id,\n" +
      '      "retract",',
    detector: "IR213",
  },
  {
    name: "KM159 known variable bills never enter the financial calendar",
    file: "src/lib/financial/financial-calendar.ts",
    from: "  for (const bill of input.knownVariableFixedBills ?? []) {",
    to: "  for (const bill of []) {",
    detector: "IR224",
  },
  {
    name: "KM160 a known real invoice loses to the learned forecast",
    file: "src/lib/financial/financial-calendar.ts",
    from:
      "        const amount =\n" +
      "          matchingKnown.length > 0\n" +
      "            ? matchingKnown.reduce((sum, bill) => sum + bill.amount, 0)\n" +
      "            : feAmount;",
    to:
      "        const amount =\n" +
      "          matchingKnown.length > 0\n" +
      "            ? feAmount\n" +
      "            : feAmount;",
    detector: "IR224",
  },
  {
    name: "KM161 an overdue known bill remains in the past and vanishes",
    file: "src/lib/financial/financial-calendar.ts",
    from:
      "      const reserveDate =\n" +
      "        billDate.getTime() < today.getTime() ? today : billDate;",
    to:
      "      const reserveDate =\n" +
      "        false && billDate.getTime() < today.getTime() ? today : billDate;",
    detector: "IR224",
  },
  {
    name: "KM162 dismissing a reminder erases the known unpaid bill from planning",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      '        .in("status", ["observed", "dismissed", "confirmed", "corrected"])',
    to:
      '        .in("status", ["observed", "confirmed", "corrected"])',
    detector: "IR225",
  },
  {
    name: "KM163 a truncated known-bill read is treated as a complete money input",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      '        .not("resolved_amount", "is", null)\n' +
      '        .order("id", { ascending: true })\n' +
      "        .limit(limit);",
    to:
      '        .not("resolved_amount", "is", null)\n' +
      '        .order("id", { ascending: true })\n' +
      "        .limit(Math.max(1, limit - 1));",
    detector: "IR225",
  },
  {
    name: "KM164 duplicate durable bills in the same cycle are summed into an inflated obligation",
    file: "src/lib/financial/user-financial-context-builder.ts",
    from:
      "  if (duplicateKnownBillCycleKeys.size > 0) moneyFxIncomplete = true;",
    to:
      "  if (false && duplicateKnownBillCycleKeys.size > 0) moneyFxIncomplete = true;",
    detector: "IR225",
  },
  {
    name: "KM165 a missing FX rate lets a native known bill proceed as if valuation were complete",
    file: "src/lib/financial/user-financial-context-builder.ts",
    from:
      "          if (amount == null) {\n" +
      "            // Preserve the native fact in storage/UI, but never place that\n" +
      "            // number into a base-money calendar at 1:1.\n" +
      "            moneyFxIncomplete = true;\n" +
      "            return [];",
    to:
      "          if (amount == null) {\n" +
      "            // Preserve the native fact in storage/UI, but never place that\n" +
      "            // number into a base-money calendar at 1:1.\n" +
      "            return [];",
    detector: "IR225",
  },
  {
    name: "KM166 a settled invoice no longer replaces the positive forecast",
    file: "src/lib/financial/financial-calendar.ts",
    from:
      "        if (matchingKnown.some((bill) => bill.settled)) continue;",
    to:
      "        if (false && matchingKnown.some((bill) => bill.settled)) continue;",
    detector: "IR224",
  },
  {
    name: "KM167 the all-status cycle reader loses its CAP+1 completeness proof",
    file: "src/lib/financial/recurring-occurrences-store.ts",
    from: "      .limit(FIXED_CYCLE_OCCURRENCES_CAP + 1);",
    to: "      .limit(FIXED_CYCLE_OCCURRENCES_CAP);",
    detector: "IR226",
  },
  {
    name: "KM168 an existing terminal cycle is ignored and a duplicate is created",
    file: "src/lib/financial/recurring-occurrence.ts",
    from: "  if (input.cycleRead.occurrenceIds.length === 1) {",
    to: "  if (false && input.cycleRead.occurrenceIds.length === 1) {",
    detector: "IR226",
  },
  {
    name: "KM169 an old invoice is attributed to the current learning regime",
    file: "src/lib/financial/recurring-occurrence.ts",
    from: "    input.occurrenceDate < regimeStartedOn",
    to: "    false && input.occurrenceDate < regimeStartedOn",
    detector: "IR226",
  },
  {
    name: "KM170 the production executor skips the all-status cycle read",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "    const cycleRead = await readFixedExpenseCycleOccurrences({\n" +
      "      userId: ctx.userId,\n" +
      "      fixedExpenseId: activeTarget.id,\n" +
      "      frequency: activeTarget.frequency as PaymentFrequency,\n" +
      "      occurrenceDate,\n" +
      "    });",
    to:
      "    const cycleRead = {\n" +
      "      ok: true as const,\n" +
      "      complete: true as const,\n" +
      "      occurrences: [],\n" +
      "    };",
    detector: "IR226",
  },
  {
    name: "KM171 a permanent plan edit does not advance the regime start",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "            regime_started_at = now(),",
    to: "            regime_started_at = public.fixed_expense_forecasts.regime_started_at,",
    detector: "IR226",
  },
  {
    name: "KM172 the forecast decoder accepts a missing regime identity",
    file: "src/lib/financial/variable-fixed-store.ts",
    from: "    !Number.isFinite(Date.parse(regimeStartedAt)) ||",
    to: "    false ||",
    detector: "IR191",
  },
  {
    name: "KM173 the complete fixed catalog omits the plan creation timestamp",
    file: "src/lib/financial/commitments-store.ts",
    from:
      '"id, name, amount, currency, frequency, is_variable, is_active, expected_day, expected_weekday, pay_anchor_date, start_date, created_at",',
    to:
      '"id, name, amount, currency, frequency, is_variable, is_active, expected_day, expected_weekday, pay_anchor_date, start_date",',
    detector: "IR226",
  },
  {
    name: "KM174 a malformed catalog creation date is treated as historical authority",
    file: "src/lib/financial/commitments-store.ts",
    from: "    !Number.isFinite(Date.parse(createdAt))",
    to: "    false",
    detector: "IR226",
  },
  {
    name: "KM175 retracting a paid invoice is rejected instead of atomically reversing it",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "       or v_current.occurrence_id is distinct from v_occ.id\n" +
      "       or v_current.amount is distinct from v_amount",
    to:
      "       or v_current.occurrence_id is distinct from v_occ.id\n" +
      "       or v_current.transaction_id is not null\n" +
      "       or v_current.amount is distinct from v_amount",
    detector: "IR227",
  },
  {
    name: "KM176 a positive variable bill can be marked paid without a transaction",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "      new.resolved_amount > 0 and new.created_transaction_id is null",
    to:
      "      false and new.resolved_amount > 0 and new.created_transaction_id is null",
    detector: "IR227",
  },
  {
    name: "KM177 the variable occurrence state guard is not installed",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "create trigger recurring_occurrences_variable_fixed_state_guard\n" +
      "before update",
    to:
      "-- create trigger recurring_occurrences_variable_fixed_state_guard\n" +
      "-- before update",
    detector: "IR227",
  },
  {
    name: "KM178 terminal paid facts become impossible to retract again",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      "    /^[A-Z]{3}$/.test(\n" +
      '      String(input.resolvedCurrency ?? "").trim().toUpperCase(),\n' +
      "    )\n" +
      "  );",
    to:
      "    /^[A-Z]{3}$/.test(\n" +
      '      String(input.resolvedCurrency ?? "").trim().toUpperCase(),\n' +
      "    ) && input.createdTransactionId == null\n" +
      "  );",
    detector: "IR222",
  },
  {
    name: "KM179 legacy booked variable skip returns to the non-atomic generic reversal",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      "        if (flow.isVariableFixed) {\n" +
      "          if (!occ.fixedExpenseId) {",
    to:
      "        if (false && flow.isVariableFixed) {\n" +
      "          if (!occ.fixedExpenseId) {",
    detector: "IR227",
  },
  {
    name: "KM180 Mis Datos stops selecting the regime identity its decoder requires",
    file: "src/app/app/mis-datos/page.tsx",
    from: "last_cycle_date, regime_started_at, updated_at",
    to: "last_cycle_date, updated_at",
    detector: "IR228",
  },
  {
    name: "KM181 settings stops selecting the regime identity its decoder requires",
    file: "src/app/app/settings/data-card.tsx",
    from: "last_cycle_date, regime_started_at, updated_at",
    to: "last_cycle_date, updated_at",
    detector: "IR228",
  },
  {
    name: "KM182 onboarding silently saves every utility as a stable fixed plan",
    file: "src/app/onboarding/save-actions.ts",
    from:
      "        is_variable: Boolean((expense as { isVariable?: boolean }).isVariable),",
    to: "        is_variable: false,",
    detector: "IR228",
  },
  {
    name: "KM183 a missing is_variable column is interpreted as stable",
    file: "src/lib/financial/onboarding-context-mappers.ts",
    from:
      "  if (typeof row.is_variable !== \"boolean\") {\n" +
      "    throw new Error(\n" +
      '      "KIPU_READ_CONTRACT: fixed_expenses.is_variable is unavailable",\n' +
      "    );\n" +
      "  }",
    to: "",
    detector: "IR228",
  },
  {
    name: "KM184 a caller can forge the learning regime of a newly created cycle",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "    new.fixed_expense_regime := v_regime;",
    to:
      "    new.fixed_expense_regime := coalesce(new.fixed_expense_regime, v_regime);",
    detector: "IR229",
  },
  {
    name: "KM185 a stale caller can create an AUTO occurrence for a variable bill",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "      new.mode := 'ask';",
    to: "      new.mode := new.mode;",
    detector: "IR229",
  },
  {
    name: "KM186 a new variable cycle keeps a stale caller-owned expected amount",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "      new.expected_amount := v_planning;",
    to: "      new.expected_amount := new.expected_amount;",
    detector: "IR229",
  },
  {
    name: "KM187 a new variable cycle keeps a stale caller-owned currency",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "      new.currency := v_currency;",
    to: "      new.currency := new.currency;",
    detector: "IR229",
  },
  {
    name: "KM188 the variable occurrence state guard loses its explicit postgres owner",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "alter function public.kipu__guard_variable_fixed_occurrence_state()\n" +
      "  owner to postgres;",
    to: "",
    detector: "IR227",
  },
  {
    name: "KM189 conversational onboarding drops the variable-bill execution flag",
    file: "src/lib/ai/onboarding/onboarding-agent.ts",
    from:
      "        isVariable:\n" +
      '          typeof r.isVariable === "boolean"\n' +
      "            ? r.isVariable\n" +
      "            : prior?.isVariable,",
    to: "        isVariable: false,",
    detector: "IR230",
  },
  {
    name: "KM190 the onboarding tool no longer exposes variable recurring bills",
    file: "src/lib/ai/onboarding/onboarding-agent.ts",
    from:
      "                isVariable: {\n" +
      '                  type: "boolean",\n' +
      "                  description:\n" +
      '                    "true cuando la obligación recurre pero la factura cambia cada ciclo (luz, gas, servicios); false para una cuota estable.",\n' +
      "                },",
    to: "",
    detector: "IR230",
  },
  {
    name: "KM191 zero-heavy history again crushes its only expensive evidence to one cent",
    file: "src/lib/financial/variable-fixed-estimator.ts",
    from:
      "  const upperFence =\n" +
      "    center <= 0.01\n" +
      "      ? Math.max(0.01, declared * 4)\n" +
      "      : center + fence;",
    to: "  const upperFence = center + fence;",
    detector: "IR231",
  },
  {
    name: "KM192 PostgreSQL loses the declared-scale fallback for a zero-centered history",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "  v_upper_fence := case\n" +
      "    when coalesce(v_center,0) <= 0.01\n" +
      "      then greatest(0.01, v_fixed.amount * 4)\n" +
      "    else coalesce(v_center,0) + v_fence\n" +
      "  end;",
    to: "  v_upper_fence := coalesce(v_center,0) + v_fence;",
    detector: "IR231",
  },
  {
    name: "KM193 a raw INSERT can manufacture an already-terminal variable bill",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "create trigger recurring_occurrences_variable_fixed_state_guard_insert\n" +
      "before insert",
    to:
      "-- create trigger recurring_occurrences_variable_fixed_state_guard_insert\n" +
      "-- before insert",
    detector: "IR227",
  },
  {
    name: "KM194 an identical paid-bill correction is rebooked and can inherit a later FX rate",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      '      scope === "once" &&\n' +
      "      sameVariableFixedPaymentFact(",
    to:
      "      false &&\n" +
      "      sameVariableFixedPaymentFact(",
    detector: "IR189",
  },
  {
    name: "KM195 SQL treats a changed FX valuation as a changed native payment",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "        and upper(v_old_tx.original_currency) = v_currency\n" +
      "        and coalesce(v_old_tx.source_account_id::text,'')",
    to:
      "        and upper(v_old_tx.original_currency) = v_currency\n" +
      "        and v_old_tx.base_amount = round((v_entry->>'base_amount')::numeric, 2)\n" +
      "        and coalesce(v_old_tx.source_account_id::text,'')",
    detector: "IR233",
  },
  {
    name: "KM196 uniqueness of historical bills is inferred from a capped read",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "      if (!knownRead.ok || !knownRead.complete) {",
    to: "      if (!knownRead.ok) {",
    detector: "IR232",
  },
  {
    name: "KM197 two unpaid historical cycles are silently collapsed to the first",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      '  if (matches.length > 1) return { ok: false, reason: "ambiguous" };',
    to:
      '  if (false && matches.length > 1) return { ok: false, reason: "ambiguous" };',
    detector: "IR232",
  },
  {
    name: "KM198 pausing a variable plan forgets which dismissal belongs to the plan lifecycle",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "set status = 'dismissed',\n" +
      "        fixed_expense_retired_by_plan = true,",
    to:
      "set status = 'dismissed',\n" +
      "        fixed_expense_retired_by_plan = false,",
    detector: "IR234",
  },
  {
    name: "KM199 reactivating a plan never revives its still-future occurrence",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "  if not old.is_active and new.is_active then",
    to: "  if false and not old.is_active and new.is_active then",
    detector: "IR234",
  },
  {
    name: "KM200 resume reopens every explicitly dismissed bill",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "and status = 'dismissed'\n" +
      "      and fixed_expense_retired_by_plan\n" +
      "      and occurrence_date >= v_user_today - 2;",
    to:
      "and status = 'dismissed'\n" +
      "      and occurrence_date >= v_user_today - 2;",
    detector: "IR234",
  },
  {
    name: "KM201 a raw service-role update can forge the plan-retirement marker",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "and coalesce(\n" +
      "       current_setting('kipu.variable_fixed_plan_retirement', true),",
    to:
      "and false and coalesce(\n" +
      "       current_setting('kipu.variable_fixed_plan_retirement', true),",
    detector: "IR234",
  },
  {
    name: "KM202 a known-bill table blip turns off Saldo for a user with no fixed plans",
    file: "src/lib/financial/user-financial-context-builder.ts",
    from:
      "    knownBillsUnavailable:\n" +
      "      mayHaveVariableHistory && !input.knownBillReadComplete,",
    to:
      "    knownBillsUnavailable: !input.knownBillReadComplete,",
    detector: "IR235",
  },
  {
    name: "KM203 a now-stable plan erases evidence that an unpaid historical variable bill may exist",
    file: "src/lib/financial/user-financial-context-builder.ts",
    from:
      "    (input.forecastReadComplete\n" +
      "      ? input.forecastRowCount > 0\n" +
      "      : input.fixedPlanCount > 0);",
    to:
      "    (input.forecastReadComplete\n" +
      "      ? false\n" +
      "      : input.fixedPlanCount > 0);",
    detector: "IR235",
  },
  {
    name: "KM204 a pending occurrence can hide a resolved bill outside the canonical writer",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "  if new.status = 'pending' then",
    to: "  if false and new.status = 'pending' then",
    detector: "IR236",
  },
  {
    name: "KM205 any linked transaction id is accepted as the payment for a different variable bill",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "       or v_tx.recurring_expense_id is distinct from new.fixed_expense_id",
    to: "       or false",
    detector: "IR236",
  },
  {
    name: "KM206 a transaction with another native amount can close the variable invoice",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "         v_tx.original_amount is distinct from new.resolved_amount\n" +
      "         or upper(v_tx.original_currency) is distinct from",
    to:
      "         false\n" +
      "         or upper(v_tx.original_currency) is distinct from",
    detector: "IR236",
  },
  {
    name: "KM207 a previously reversed transaction can be revived as the payment identity",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "           and reversal.related_transaction_id = v_tx.id",
    to: "           and false",
    detector: "IR236",
  },
  {
    name: "KM208 lowercase native currency poisons the complete K reader",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "    or resolved_currency ~ '^[A-Z]{3}$'",
    to: "    or resolved_currency ~ '^[A-Za-z]{3}$'",
    detector: "IR236",
  },
  {
    name: "KM209 Mis Datos omits the regime snapshot rendered with the row",
    file: "src/app/app/mis-datos/page.tsx",
    from:
      '          hiddenValues: {\n' +
      '            expectedIsVariable: f.is_variable ? "true" : "false",\n' +
      "          },",
    to: "",
    detector: "IR237",
  },
  {
    name: "KM210 the Mis Datos action consumes the editable toggle as authority instead of the rendered regime snapshot",
    file: "src/app/app/mis-datos/actions.ts",
    from: '      expectedIsVariable: expectedVariableRaw === "true",',
    to: "",
    detector: "IR237",
  },
  {
    name: "KM211 the SQL estimator restores an unbounded raw amount in its tiny-sample fallback",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "select least(amount, v_upper_fence) as amount, cycle_date, id\n" +
      "    from recent\n" +
      "    where v_filtered < least(2, v_total)",
    to:
      "select amount, cycle_date, id\n" +
      "    from recent\n" +
      "    where v_filtered < least(2, v_total)",
    occurrence: 1,
    detector: "IR238",
  },
  {
    name: "KM212 the primary fixed-expense store accepts a negative amount",
    file: "src/lib/financial/commitments-store.ts",
    from:
      "  if (\n" +
      "    input.amount !== undefined &&\n" +
      "    (!Number.isFinite(input.amount) || input.amount < 0)\n" +
      "  ) {\n" +
      "    return false;\n" +
      "  }\n",
    to: "",
    detector: "IR239",
  },
  {
    name: "KM213 PostgreSQL lets a negative stable fixed expense inflate free capacity",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "  add constraint fixed_expenses_amount_nonnegative_ck\n" +
      "  check (amount >= 0);",
    to:
      "  add constraint fixed_expenses_amount_nonnegative_ck\n" +
      "  check (amount is not null);",
    detector: "IR239",
  },
  {
    name: "KM214 Mis Datos reads isVariable on create but never renders the create control",
    file: "src/app/app/mis-datos/page.tsx",
    from:
      '        { name: "isEssential", label: "Es esencial", type: "toggle" },\n' +
      '        { name: "isVariable", label: "Varía mes a mes", type: "toggle" },',
    to:
      '        { name: "isEssential", label: "Es esencial", type: "toggle" },',
    detector: "IR217",
  },
  {
    name: "KM215 a dismissed known bill cannot be retracted by name after the reminder is closed",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: '["observe", "confirm", "correct", "retract"].includes(action)',
    to: '["observe", "confirm", "correct"].includes(action)',
    detector: "IR232",
  },
  {
    name: "KM216 a variable bill paid early is reserved again at its due date",
    file: "src/lib/financial/financial-calendar.ts",
    from:
      "        if (matchingKnown.some((bill) => bill.settled)) continue;\n",
    to: "",
    detector: "IR224",
  },
  {
    name: "KM217 the complete bill feed drops settled and zero cycles, so their forecast returns",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      '.in("status", ["observed", "dismissed", "confirmed", "corrected"])',
    to: '.in("status", ["observed", "dismissed"])',
    detector: "IR225",
  },
  {
    name: "KM218 a settled historical cycle is offered as the unpaid bill to resolve",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      "      (input.includeSettled || !bill.settled) &&\n" +
      "      bill.fixedExpenseId === input.fixedExpenseId &&",
    to: "      true &&\n      bill.fixedExpenseId === input.fixedExpenseId &&",
    detector: "IR232",
  },
  {
    name: "KM219 a paid foreign cycle needlessly requires today's FX even though it only suppresses a forecast",
    file: "src/lib/financial/user-financial-context-builder.ts",
    from: "          if (bill.settled) {",
    to: "          if (false && bill.settled) {",
    detector: "IR225",
  },
  {
    name: "KM220 installing the lifecycle trigger silently trusts incoherent pre-K variable occurrences",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "update public.recurring_occurrences occurrence_row\n" +
      "set status = occurrence_row.status\n" +
      "from public.fixed_expenses fixed_row\n" +
      "where fixed_row.id = occurrence_row.fixed_expense_id\n" +
      "  and fixed_row.user_id = occurrence_row.user_id\n" +
      "  and fixed_row.is_variable;\n",
    to: "",
    detector: "IR236",
  },
  {
    name: "KM221 Mis Datos re-labels weekly/yearly variable bills as a monthly amount",
    file: "src/app/app/mis-datos/page.tsx",
    from: '{ name: "amount", label: "Monto por ciclo", type: "money" },',
    to: '{ name: "amount", label: "Monto mensual", type: "money" },',
    occurrence: 1,
    detector: "IR217",
  },
  {
    name: "KM222 onboarding retry bypasses the narrow fixed-expense reset and hits the revoked raw DELETE",
    file: "src/app/onboarding/save-actions.ts",
    from:
      '    const { error: fixedWipeError } = await supabase.rpc(\n' +
      '      "kipu_reset_incomplete_onboarding_fixed_expenses",\n' +
      "      { p_user: userId },\n" +
      "    );",
    to:
      "    const { error: fixedWipeError } = await supabase\n" +
      '      .from("fixed_expenses")\n' +
      "      .delete()\n" +
      '      .eq("user_id", userId);',
    detector: "IR240",
  },
  {
    name: "KM223 partial onboarding continues after a failed structure wipe and can duplicate rows",
    file: "src/app/onboarding/save-actions.ts",
    from:
      "        redirectOnDbError(`el reintento de onboarding (${table})`, wipeError);",
    to:
      "        console.error(`el reintento de onboarding (${table})`, wipeError);",
    detector: "IR240",
  },
  {
    name: "KM224 completed users can invoke the sanctioned hard-delete writer",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "  if coalesce(v_completed, false) then",
    to: "  if false then",
    detector: "IR240",
  },
  {
    name: "KM225 the known-bill reader drops the historical cadence snapshot",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      "id, fixed_expense_id, occurrence_date, fixed_expense_cadence, resolved_amount, resolved_currency, status, created_transaction_id",
    to:
      "id, fixed_expense_id, occurrence_date, resolved_amount, resolved_currency, status, created_transaction_id",
    detector: "IR241",
  },
  {
    name: "KM226 duplicate identity collapses invoices from two different historical cadences",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      "  return `${bill.fixedExpenseId}:${bill.cadence}:${variableFixedCycleKey(\n" +
      "    bill.cadence,\n" +
      "    bill.occurrenceDate,\n" +
      "  )}`;",
    to:
      "  return `${bill.fixedExpenseId}:${variableFixedCycleKey(\n" +
      '    "yearly",\n' +
      "    bill.occurrenceDate,\n" +
      "  )}`;",
    detector: "IR241",
  },
  {
    name: "KM227 the calendar reinterprets an old monthly invoice using the plan's new yearly cadence",
    file: "src/lib/financial/financial-calendar.ts",
    from: "            bill.cadence === fe.frequency &&\n",
    to: "",
    detector: "IR241",
  },
  {
    name: "KM228 a known annual invoice is moved to the plan's generic day instead of its real date",
    file: "src/lib/financial/financial-calendar.ts",
    from:
      "        if (relevantYearlyKnown.length > 0) {\n" +
      "          for (const bill of relevantYearlyKnown) {\n" +
      "            if (bill.settled) consumedKnownBills.add(bill.occurrenceId);\n" +
      "          }\n" +
      "          continue;\n" +
      "        }\n",
    to: "",
    detector: "IR241",
  },
  {
    name: "KM229 a correction by name cannot recover a paid historical invoice",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      '        includeSettled: action === "correct" || action === "retract",\n',
    to: "",
    detector: "IR232",
  },
  {
    name: "KM230 the terminal resolver refuses to retract a bill whose payment must be reversed",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      '      input.action === "retract" &&\n' +
      "      occ.fixedExpenseId != null\n",
    to:
      '      input.action === "retract" &&\n' +
      "      occ.fixedExpenseId != null &&\n" +
      "      occ.createdTransactionId == null\n",
    detector: "IR222",
  },
  {
    name: "KM231 known-bill pagination rereads the first page forever",
    file: "src/lib/financial/variable-fixed-store.ts",
    from: '    if (afterId) query = query.gt("id", afterId);',
    to: "    if (false && afterId) query = query.gt(\"id\", afterId);",
    detector: "IR242",
  },
  {
    name: "KM232 a failure on page two is treated as the end of history",
    file: "src/lib/financial/variable-fixed-store.ts",
    from: "      if (result.error || !result.rows) {",
    to: "      if (!result.rows) {",
    occurrence: 2,
    detector: "IR242",
  },
  {
    name: "KM233 the history safety fuse publishes a partial list as complete",
    file: "src/lib/financial/variable-fixed-store.ts",
    from: "    return { ok: true, complete: false, partial: bills };",
    to: "    return { ok: true, complete: true, bills };",
    detector: "IR242",
  },
  {
    name: "KM234 forecast pagination rereads the first page forever",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      '          query = query.gt("fixed_expense_id", afterFixedExpenseId);',
    to:
      '          query = query.gt("fixed_expense_id", "00000000-0000-4000-8000-000000000000");',
    detector: "IR243",
  },
  {
    name: "KM235 a failure on forecast page two is treated as the end",
    file: "src/lib/financial/variable-fixed-store.ts",
    from:
      "      const result = await readPage(afterFixedExpenseId, pageSize + 1);\n" +
      "      if (result.error || !result.rows) {",
    to:
      "      const result = await readPage(afterFixedExpenseId, pageSize + 1);\n" +
      "      if (!result.rows) {",
    detector: "IR243",
  },
  {
    name: "KM236 the forecast safety fuse publishes a partial feed as complete",
    file: "src/lib/financial/variable-fixed-store.ts",
    from: "    return { ok: true, complete: false, partial: forecasts };",
    to: "    return { ok: true, complete: true, forecasts };",
    detector: "IR243",
  },
  {
    name: "KM237 a completed user can forge an incomplete onboarding again",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "  if coalesce(old.onboarding_completed, false)\n" +
      "     and not coalesce(new.onboarding_completed, false) then",
    to:
      "  if false and coalesce(old.onboarding_completed, false)\n" +
      "     and not coalesce(new.onboarding_completed, false) then",
    detector: "IR244",
  },
  {
    name: "KM238 the onboarding reset erases a plan that already produced money",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "  if exists (\n" +
      "    select 1\n" +
      "    from public.transactions transaction_row\n" +
      "    join public.fixed_expenses fixed_row",
    to:
      "  if false and exists (\n" +
      "    select 1\n" +
      "    from public.transactions transaction_row\n" +
      "    join public.fixed_expenses fixed_row",
    detector: "IR244",
  },
  {
    name: "KM239 an expense can land after its recurring plan disappeared",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "    if new.type = 'expense' and not coalesce(v_plan_found, false) then",
    to:
      "    if false and new.type = 'expense' and not coalesce(v_plan_found, false) then",
    detector: "IR244",
  },
  {
    name: "KM240 a fixed-plan insert can appear inside the onboarding reset window",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "create trigger fixed_expenses_00_owner_profile_lock\n" +
      "before insert on public.fixed_expenses",
    to:
      "create trigger fixed_expenses_00_owner_profile_lock\n" +
      "after insert on public.fixed_expenses",
    detector: "IR244",
  },
  {
    name: "KM241 two dates in one monthly billing cycle become two invoices",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "where fixed_expense_id is not null\n" +
      "  and fixed_expense_cadence = 'monthly';",
    to:
      "where fixed_expense_id is not null\n" +
      "  and false and fixed_expense_cadence = 'monthly';",
    detector: "IR245",
  },
  {
    name: "KM242 two dates in one annual billing cycle become two invoices",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "where fixed_expense_id is not null\n" +
      "  and fixed_expense_cadence = 'yearly';",
    to:
      "where fixed_expense_id is not null\n" +
      "  and false and fixed_expense_cadence = 'yearly';",
    detector: "IR245",
  },
  {
    name: "KM243 the fixed-expense catalog rereads the first page forever",
    file: "src/lib/financial/commitments-store.ts",
    from: '        if (afterId) query = query.gt("id", afterId);',
    to:
      '        if (afterId) query = query.gt("id", "00000000-0000-4000-8000-000000000000");',
    detector: "IR246",
  },
  {
    name: "KM244 a later fixed-catalog failure is treated as the end",
    file: "src/lib/financial/commitments-store.ts",
    from:
      "      const result = await readPage(afterId, pageSize + 1);\n" +
      "      if (result.error || !result.rows) {",
    to:
      "      const result = await readPage(afterId, pageSize + 1);\n" +
      "      if (!result.rows) {",
    detector: "IR246",
  },
  {
    name: "KM245 the fixed-catalog safety fuse authorizes a partial catalog",
    file: "src/lib/financial/commitments-store.ts",
    from:
      "    return {\n" +
      "      ok: true,\n" +
      "      complete: false,\n" +
      "      partial: catalogInCreationOrder(expenses),\n" +
      "    };",
    to:
      "    return {\n" +
      "      ok: true,\n" +
      "      complete: true,\n" +
      "      expenses: catalogInCreationOrder(expenses),\n" +
      "    };",
    detector: "IR246",
  },
  {
    name: "KM246 similar-name matching silently restores the old 100-row cap",
    file: "src/lib/financial/commitments-store.ts",
    from:
      "  const rows = (\n" +
      "    catalog.complete ? catalog.expenses : catalog.partial\n" +
      "  ).filter((row) => row.isActive !== false);",
    to:
      "  const rows = (\n" +
      "    catalog.complete ? catalog.expenses : catalog.partial\n" +
      "  ).filter((row) => row.isActive !== false).slice(0, 100);",
    detector: "IR246",
  },
  {
    name: "KM247 the latest observed cycle is taken only from estimator inliers",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "percentile_cont(0.5) within group (order by amount),\n" +
      "         max(cycle_date)\n" +
      "    into v_total, v_center, v_last",
    to:
      "percentile_cont(0.5) within group (order by amount),\n" +
      "         min(cycle_date)\n" +
      "    into v_total, v_center, v_last",
    detector: "IR178",
  },
  {
    name: "KM248 a known variable invoice can be erased to skipped",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "    if new.status in ('pending','booked','skipped')",
    to: "    if new.status in ('pending','booked')",
    detector: "IR247",
  },
  {
    name: "KM249 occurrence amount no longer has to match its observation",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "       or new.resolved_amount is distinct from v_current_observation.amount",
    to:
      "       or false and new.resolved_amount is distinct from v_current_observation.amount",
    detector: "IR247",
  },
  {
    name: "KM250 the fixed catalog accepts an impossible normalized calendar date",
    file: "src/lib/financial/commitments-store.ts",
    from:
      "  return (\n" +
      "    parsed.getUTCFullYear() === year &&\n" +
      "    parsed.getUTCMonth() === month &&\n" +
      "    parsed.getUTCDate() === day\n" +
      "  );",
    to: "  return Number.isFinite(parsed.getTime());",
    detector: "IR246",
  },
  {
    name: "KM251 the fixed writer validates a canonical currency but persists the raw spelling",
    file: "src/lib/financial/commitments-store.ts",
    from: "      currency: normalized.currency,",
    to: "      currency: input.currency,",
    detector: "IR248",
  },
  {
    name: "KM252 the forecast asks PostgreSQL for last cycle without projecting cycle_date",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "  for update;\n\n" +
      "  with recent as (\n" +
      "    select o.amount, o.cycle_date",
    to:
      "  for update;\n\n" +
      "  with recent as (\n" +
      "    select o.amount",
    detector: "IR178",
  },
  {
    name: "KM253 a fixed occurrence may point at another user's plan",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "    if not found then\n" +
      "      raise exception\n" +
      "        'KIPU_OWNERSHIP: recurring occurrence fixed expense missing or not owned'",
    to:
      "    if false and not found then\n" +
      "      raise exception\n" +
      "        'KIPU_OWNERSHIP: recurring occurrence fixed expense missing or not owned'",
    detector: "IR249",
  },
  {
    name: "KM254 migration trusts a pre-existing cross-user fixed occurrence",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "      and occurrence_row.user_id is distinct from fixed_row.user_id",
    to: "      and false and occurrence_row.user_id is distinct from fixed_row.user_id",
    detector: "IR249",
  },
  {
    name: "KM255 migration silently accepts an invalid fixed-plan denomination",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from: "       or btrim(currency) !~ '^[A-Za-z]{3}$'",
    to: "       or false and btrim(currency) !~ '^[A-Za-z]{3}$'",
    detector: "IR250",
  },
  {
    name: "KM256 a future raw writer can persist lowercase fixed-plan currency",
    file: "supabase/sql/093_bloqueK_variable_fixed_observations.sql",
    from:
      "add constraint fixed_expenses_currency_iso_ck\n" +
      "  check (currency ~ '^[A-Z]{3}$');",
    to:
      "add constraint fixed_expenses_currency_iso_ck\n" +
      "  check (currency ~ '^[A-Za-z]{3}$');",
    detector: "IR250",
  },
  {
    name: "KM257 migration patches fewer than both canonical reversal sites",
    file: "supabase/sql/094_bloqueK_paid_observation_corrections.sql",
    from: "if v_old_hits <> 2 then",
    to: "if v_old_hits < 1 then",
    detector: "IR251",
  },
  {
    name: "KM258 canonical correction does not retire the current fact before reversal",
    file: "supabase/sql/094_bloqueK_paid_observation_corrections.sql",
    from: "'        and is_current;\\n'",
    to: "'        and false;\\n'",
    detector: "IR251",
  },
  {
    name: "KM259 dead external-ref bypass is allowed to survive in the ledger trigger",
    file: "supabase/sql/094_bloqueK_paid_observation_corrections.sql",
    from: "if v_old_hits <> 1 then",
    to: "if v_old_hits < 1 then",
    detector: "IR251",
  },
  {
    name: "KM260 K harness can report a full pass without executing every named check",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from: "const EXPECTED_CHECKS = 79;",
    to: "const EXPECTED_CHECKS = 78;",
    detector: "IR251",
  },
  {
    name: "KM261 historical observation reads forget to select the current fact",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from:
      '.eq("occurrence_id", occurrenceId)\n' +
      '    .eq("is_current", true)\n' +
      "    .limit(2);",
    to:
      '.eq("occurrence_id", occurrenceId)\n' +
      '    .neq("is_current", true)\n' +
      "    .limit(2);",
    detector: "IR252",
  },
  {
    name: "KM262 corrupt pre-K fixture is manufactured after the variable guard is active",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from:
      '        name: "Fijo legado con pago ajeno K",\n' +
      "        amount: 120,\n" +
      '        currency: "USD",\n' +
      '        category: "utilities",\n' +
      '        frequency: "monthly",\n' +
      "        expected_day: 15,\n" +
      '        payment_source_type: "account",\n' +
      "        payment_source_id: ids.account,\n" +
      "        is_variable: false,",
    to:
      '        name: "Fijo legado con pago ajeno K",\n' +
      "        amount: 120,\n" +
      '        currency: "USD",\n' +
      '        category: "utilities",\n' +
      '        frequency: "monthly",\n' +
      "        expected_day: 15,\n" +
      '        payment_source_type: "account",\n' +
      "        payment_source_id: ids.account,\n" +
      "        is_variable: true,",
    detector: "IR252",
  },
  {
    name: "KM263 missing current observation is accepted as a valid singleton",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from: "if (!data || data.length !== 1) {",
    to: "if (!data || data.length > 1) {",
    detector: "IR252",
  },
  {
    name: "KM264 a failed legacy fixture disappears without a named K22 failure",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from: "if (!k22Checked) {",
    to: "if (false) {",
    detector: "IR252",
  },
  {
    name: "KM265 a fresh variable-bill operation reuses the old ledger identity after undo",
    file: "src/lib/financial/recurring-resolve.ts",
    from:
      '  const operationIdentity = input.operationId?.trim() || "semantic";',
    to: '  const operationIdentity = "semantic";',
    detector: "IR253",
  },
  {
    name: "KM266 the live variable-bill ledger key drops the delivery identity",
    file: "src/lib/financial/recurring-resolve.ts",
    from: "        operationId: input.operationId,",
    to: "        operationId: null,",
    detector: "IR253",
  },
  {
    name: "KM267 the divergent legacy fixture starts under the live K guard instead of representing a pre-K stable plan",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from:
      '        name: "Servicio K reversa divergente",\n' +
      "        amount: 33,\n" +
      '        currency: "USD",\n' +
      '        category: "utilities",\n' +
      '        frequency: "monthly",\n' +
      "        expected_day: 13,\n" +
      '        payment_source_type: "account",\n' +
      "        payment_source_id: ids.account,\n" +
      "        is_variable: false,",
    to:
      '        name: "Servicio K reversa divergente",\n' +
      "        amount: 33,\n" +
      '        currency: "USD",\n' +
      '        category: "utilities",\n' +
      '        frequency: "monthly",\n' +
      "        expected_day: 13,\n" +
      '        payment_source_type: "account",\n' +
      "        payment_source_id: ids.account,\n" +
      "        is_variable: true,",
    detector: "IR253",
  },
  {
    name: "KM268 K13 accepts the already-reversed transaction as the explicit redo",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from:
      "      janAfterExplicitRedo.created_transaction_id !==\n" +
      "        janCorrectedRow.created_transaction_id &&",
    to:
      "      janAfterExplicitRedo.created_transaction_id ===\n" +
      "        janCorrectedRow.created_transaction_id &&",
    detector: "IR253",
  },
  {
    name: "KM269 the divergent fixture no longer proves that the legacy row predates every K observation",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from: "      divergentObservationCountBefore === 0 &&",
    to: "      divergentObservationCountBefore >= 0 &&",
    detector: "IR253",
  },
  {
    name: "KM270 paid retract again sends an unsigned internal reversal",
    file: "supabase/sql/095_bloqueK_retract_and_legacy_cycle_repair.sql",
    from:
      "    '        -- K-095: every reversal uses the ledger''s mandatory negative sign.\\n'\n" +
      "    '        ''sign'', -1,\\n'",
    to:
      "    '        -- K-095: every reversal uses the ledger''s mandatory negative sign.\\n'\n" +
      "    '        ''sign'', 1,\\n'",
    detector: "IR254",
  },
  {
    name: "KM271 a dismissed historical invoice blocks every future stable billing cycle forever",
    file: "supabase/sql/095_bloqueK_retract_and_legacy_cycle_repair.sql",
    from:
      "    '        and historical.cycle_date = case\\n'",
    to:
      "    '        and true = case\\n'",
    detector: "IR254",
  },
  {
    name: "KM272 a unique divergent pre-K cycle is no longer repaired after its cash reversal",
    file: "supabase/sql/095_bloqueK_retract_and_legacy_cycle_repair.sql",
    from: "    '      if v_candidate_count = 1 then\\n'",
    to: "    '      if false then\\n'",
    detector: "IR254",
  },
  {
    name: "KM273 K59 accepts a paid retract that did not retire the occurrence",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from: '      paidRetractAfter?.status === "skipped" &&',
    to: '      paidRetractAfter?.status !== "skipped" &&',
    detector: "IR254",
  },
  {
    name: "KM274 K56 accepts a repaired legacy invoice that still claims the reversed payment",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from:
      "        divergentObservationAfter.row?.transaction_id == null &&",
    to:
      "        divergentObservationAfter.row?.transaction_id != null &&",
    detector: "IR254",
  },
  {
    name: "KM275 a later guard reuses the block-scoped K13 row and aborts the remaining E2E checks",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from:
      "        janAfterExplicitRedoForGuard.created_transaction_id,",
    to:
      "        janAfterExplicitRedo.created_transaction_id,",
    detector: "IR254",
  },
  {
    name: "KM276 K51 treats the scalar ledger transaction id as an object and reports a committed payment as failed",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from:
      '      typeof dismissedThenFixedPayment === "string" &&\n' +
      "      dismissedThenFixedPayment.length > 0 &&",
    to:
      "      dismissedThenFixedPayment?.id != null &&\n" +
      "      dismissedThenFixedPayment.length > 0 &&",
    detector: "IR255",
  },
  {
    name: "KM277 K60c again depends on which valid guard clause happens to reject first",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from:
      "      !!wrongPaymentIdentityError &&\n" +
      "      !!reversedPaymentIdentityError &&",
    to:
      "      !!wrongPaymentIdentityError &&\n" +
      "      /payment differs from its native fact/i.test(wrongPaymentIdentityError.message) &&\n" +
      "      !!reversedPaymentIdentityError &&",
    detector: "IR255",
  },
  {
    name: "KM278 cleanup queries profiles through a nonexistent user_id and silently stops proving residue",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from: '      ["profiles", "id"],',
    to: '      ["profiles", "user_id"],',
    detector: "IR255",
  },
  {
    name: "KM279 K11 pins a private rejection message even though unchanged cash and ledger already prove the contract",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from: "    duplicateRefused = error != null;",
    to:
      "    duplicateRefused = /already has a payment/i.test(String(error));",
    detector: "IR255",
  },
  {
    name: "KM280 cleanup ignores each table's declared owner column and hardcodes user_id again",
    file: "scripts/qa/k-variable-fixed-e2e.mjs",
    from:
      "        const left = await count(table, ownerColumn, disposableUserId);",
    to:
      '        const left = await count(table, "user_id", disposableUserId);',
    detector: "IR255",
  },
];

const originals = new Map(
  [...new Set(cases.map((item) => item.file))].map((file) => [
    file,
    fs.readFileSync(file, "utf8"),
  ]),
);

let failed = false;
for (const item of cases) {
  const original = originals.get(item.file);
  const hits = original.split(item.from).length - 1;
  const expectedHits = item.occurrence ? Math.max(item.occurrence, 1) : 1;
  if ((!item.occurrence && hits !== 1) || (item.occurrence && hits < expectedHits)) {
    console.error(
      `FAIL · ${item.name}: anchor hits=${hits}, expected ${
        item.occurrence ? `>=${expectedHits}` : "1"
      }`,
    );
    failed = true;
    continue;
  }
  try {
    let mutated = original;
    if (item.occurrence) {
      let seen = 0;
      mutated = original.replaceAll(item.from, (match) => {
        seen += 1;
        return seen === item.occurrence ? item.to : match;
      });
    } else {
      mutated = original.replace(item.from, item.to);
    }
    fs.writeFileSync(item.file, mutated);
    const run = spawnSync(
      process.execPath,
      ["scripts/qa/run-capture-gate.mjs"],
      { encoding: "utf8" },
    );
    const output = `${run.stdout}\n${run.stderr}`;
    const bit =
      run.status !== 0 &&
      output.includes(item.detector);
    console.log(`${bit ? "ok" : "FAIL"} · ${item.name} → ${item.detector}`);
    if (!bit) {
      failed = true;
      console.error(output.slice(-2000));
    }
  } finally {
    fs.writeFileSync(item.file, original);
  }
}

for (const [file, original] of originals) {
  if (fs.readFileSync(file, "utf8") !== original) {
    console.error(`FAIL · mutation residue: ${file}`);
    failed = true;
  }
}

console.log(`Bloque K mutations: ${failed ? "FAIL" : `${cases.length}/${cases.length}`}`);
if (failed) process.exitCode = 1;
