-- Migration 107 — M0: an omitted derived amount never disables the money guard.
--
-- APPLIED 2026-08-03. Migration 100 and its append-only fixes through 106
-- are already applied and are intentionally not rewritten.
--
-- `paidInFull=true` deliberately omits the model-authored `amount`: the typed
-- adapter derives the current statement remainder. Migration 100 compared the
-- resolved ledger amount with the persisted plan only when `arguments.amount`
-- existed, however, so omitting the untrusted number also disabled the database
-- comparison. A forged service-role payload could therefore change the amount
-- before the atomic coordinator reached the card writer.
--
-- The private predicate below owns the complete boundary. It locks the user's
-- current card row, derives a full payment from the live statement, uses the
-- persisted amount only for an explicit partial payment, and proves the card
-- statement payload as well as the ledger amount. The downstream card writer
-- still performs its own CAS; the two checks protect different moments.

create or replace function public.kipu__agent_card_payment_payload_matches(
  p_user uuid,
  p_arguments jsonb,
  p_payload jsonb,
  p_resolved_type text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_card_text text := nullif(p_payload->'entry'->>'debt_account_id','');
  v_card uuid;
  v_paid_in_full boolean := false;
  v_planned_amount numeric;
  v_entry_amount numeric;
  v_live_due numeric;
  v_expected_amount numeric;
  v_statement_expected numeric;
  v_statement_paid numeric;
begin
  if p_user is null
     or jsonb_typeof(p_arguments) is distinct from 'object'
     or jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_payload->'entry') is distinct from 'object'
     or p_resolved_type is null
     or p_resolved_type not in ('ledger_entry','card_payment')
     or v_card_text is null then
    return false;
  end if;

  begin
    v_card := v_card_text::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if p_arguments ? 'paidInFull' then
    if jsonb_typeof(p_arguments->'paidInFull') is distinct from 'boolean' then
      return false;
    end if;
    v_paid_in_full := (p_arguments->>'paidInFull')::boolean;
  end if;

  if p_arguments ? 'amount' then
    if jsonb_typeof(p_arguments->'amount') is distinct from 'number' then
      return false;
    end if;
    v_planned_amount := (p_arguments->>'amount')::numeric;
  end if;

  if jsonb_typeof(p_payload->'entry'->'original_amount') is distinct from 'number' then
    return false;
  end if;
  v_entry_amount := (p_payload->'entry'->>'original_amount')::numeric;

  -- KIPU_M0_107_DERIVE_LIVE_CARD_AMOUNT: the verifier derives when the planner
  -- omits a model-authored amount; omission is never permission to skip a guard.
  select case
           when d.statement_covered is true then 0::numeric
           else coalesce(d.full_payment_due, d.statement_total_due)
         end
    into v_live_due
    from public.debt_accounts d
   where d.id = v_card
     and d.user_id = p_user
     and d.type = 'credit_card'
   for update;
  if not found then
    return false;
  end if;

  if v_paid_in_full then
    if v_live_due is null or v_live_due <= 0 then
      return false;
    end if;
    v_expected_amount := v_live_due;
  else
    if v_planned_amount is null or v_planned_amount <= 0 then
      return false;
    end if;
    v_expected_amount := v_planned_amount;
  end if;

  if v_entry_amount <= 0
     or abs(v_entry_amount - v_expected_amount) > 0.005 then
    return false;
  end if;

  -- A live statement must use the atomic card route. A plain ledger entry is
  -- valid only when no positive statement remainder exists. This prevents a
  -- caller from preserving the right amount while silently skipping the CAS.
  if coalesce(v_live_due,0) > 0 and p_resolved_type <> 'card_payment' then
    return false;
  end if;
  if coalesce(v_live_due,0) <= 0 and p_resolved_type <> 'ledger_entry' then
    return false;
  end if;

  if p_resolved_type = 'card_payment' then
    if jsonb_typeof(p_payload->'statement') is distinct from 'object'
       or p_payload->'statement'->>'debt_account_id' is distinct from v_card::text
       or jsonb_typeof(p_payload->'statement'->'expected_due') is distinct from 'number'
       or jsonb_typeof(p_payload->'statement'->'paid_in_card_currency') is distinct from 'number' then
      return false;
    end if;
    v_statement_expected := (p_payload->'statement'->>'expected_due')::numeric;
    v_statement_paid := (p_payload->'statement'->>'paid_in_card_currency')::numeric;
    if abs(v_statement_expected - v_live_due) > 0.005
       or abs(v_statement_paid - v_entry_amount) > 0.005 then
      return false;
    end if;
  end if;

  return true;
exception when numeric_value_out_of_range then
  return false;
end;
$fn$;

alter function public.kipu__agent_card_payment_payload_matches(uuid,jsonb,jsonb,text)
  owner to postgres;
revoke all on function public.kipu__agent_card_payment_payload_matches(uuid,jsonb,jsonb,text)
  from public, anon, authenticated, service_role;

do $$
declare
  v_definition text;
  v_next text;
  v_anchor text := $anchor$
       or (
         nullif(v_step.arguments->>'amount','') is not null
         and abs(
           nullif(v_step.arguments->>'amount','')::numeric
           - coalesce(nullif(v_payload->'entry'->>'original_amount','')::numeric,0)
         ) > 0.005
       )$anchor$;
  v_replacement text := $replacement$
       or not public.kipu__agent_card_payment_payload_matches(
         v_user,
         v_step.arguments,
         v_payload,
         v_type
       )$replacement$;
  v_anchor_hits integer;
  v_marker_hits integer;
begin
  select pg_get_functiondef(
    'public.kipu_preflight_agent_operation_step(jsonb)'::regprocedure
  ) into v_definition;

  v_marker_hits := (
    length(v_definition) - length(replace(
      v_definition,
      'public.kipu__agent_card_payment_payload_matches(',
      ''
    ))
  ) / length('public.kipu__agent_card_payment_payload_matches(');
  v_anchor_hits := (
    length(v_definition) - length(replace(v_definition, v_anchor, ''))
  ) / length(v_anchor);

  if v_marker_hits = 1 and v_anchor_hits = 0 then
    return;
  end if;
  if v_marker_hits <> 0 then
    raise exception
      'KIPU_MIGRATION: partial 107 card-preflight state, helper calls=% old anchors=%',
      v_marker_hits, v_anchor_hits;
  end if;
  if v_anchor_hits <> 1 then
    raise exception
      'KIPU_MIGRATION: expected one optional card amount guard, found %',
      v_anchor_hits;
  end if;

  v_next := replace(v_definition, v_anchor, v_replacement);
  if v_next = v_definition
     or (
       length(v_next) - length(replace(
         v_next,
         'public.kipu__agent_card_payment_payload_matches(',
         ''
       ))
     ) / length('public.kipu__agent_card_payment_payload_matches(') <> 1
     or position(v_anchor in v_next) > 0 then
    raise exception 'KIPU_MIGRATION: 107 card-preflight replacement did not land exactly once';
  end if;
  execute v_next;
end;
$$;

alter function public.kipu_preflight_agent_operation_step(jsonb)
  owner to postgres;
revoke all on function public.kipu_preflight_agent_operation_step(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_preflight_agent_operation_step(jsonb)
  to service_role;
