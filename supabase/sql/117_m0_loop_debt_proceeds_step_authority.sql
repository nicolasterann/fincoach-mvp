-- Migration 117 — M0 native-loop debt-proceeds step authority.
--
-- PREPARED, NOT APPLIED. The founder applies this file only after the
-- pre-application audit. The legacy envelope branch remains byte-for-byte in
-- its authority predicate; the additive branch accepts only the exact staged
-- step mirrored by an authorized, executing loop manifest.

create or replace function public.kipu_apply_debt_proceeds(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_step_key text := nullif(btrim(p->>'step_key'),'');
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_debt uuid := nullif(p->>'debt_account_id','')::uuid;
  v_amount numeric := nullif(p->>'amount','')::numeric;
  v_currency text := upper(nullif(btrim(p->>'original_currency'),''));
  v_base text := upper(nullif(btrim(p->>'base_currency'),''));
  v_rate numeric := nullif(p->>'exchange_rate_to_base','')::numeric;
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_step public.agent_operation_steps%rowtype;
  v_op public.agent_operations%rowtype;
  v_application public.debt_proceeds_applications%rowtype;
  v_account_currency text;
  v_debt_currency text;
  v_profile_base text;
  v_transaction uuid;
  v_base_amount numeric;
  v_fingerprint text;
  v_rows integer;
  v_intent_authorized boolean := false;
begin
  if v_user is null or v_operation is null or v_step_key is null or v_lease is null
     or v_account is null or v_debt is null or v_amount is null or v_amount <= 0
     or v_currency is null or v_base is null or v_rate is null or v_rate <= 0
     or v_dedupe is null then
    raise exception 'KIPU_VALIDATION: complete debt-proceeds identity and money are required'
      using errcode = '22023';
  end if;

  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_op.status <> 'applying' or v_op.lease_token <> v_lease
     or v_op.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: operation is not under a live application lease'
      using errcode = '22023';
  end if;
  select * into v_step from public.agent_operation_steps
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_op.plan_version and step_key = v_step_key
   for update;
  if not found or v_step.capability <> 'record_person_payment' then
    raise exception 'KIPU_VALIDATION: debt proceeds step is absent from the plan'
      using errcode = '22023';
  end if;

  if v_op.plan is not distinct from '{"mode":"loop"}'::jsonb then
    -- KIPU_M0_117_LOOP_STEP_AUTHORITY: the step, not plan metadata, is the
    -- immutable unit. The manifest proves that this exact row was authorized
    -- in another delivery and has entered deterministic execution.
    select
      v_step.arguments_fingerprint = md5(v_step.arguments::text)
      and exists (
        select 1 from jsonb_array_elements(coalesce(v_step.effects,'[]'::jsonb)) effect
         where effect->>'kind' = 'economic_event'
           and effect->>'source' = 'capability_catalog'
      )
      and exists (
        select 1
          from public.agent_operation_manifests m,
            lateral jsonb_array_elements(coalesce(m.manifest->'actions','[]'::jsonb)) action
         where m.operation_id = v_operation and m.user_id = v_user
           and m.plan_version = v_op.plan_version
           and m.status = 'executing' and m.authorized_at is not null
           and m.authorized_delivery_key is not null
           and m.authorized_delivery_key is distinct from m.proposed_delivery_key
           and m.manifest->>'kind' = 'loop_staged'
           and action->>'action_id' = v_step.step_key
           and action->>'capability' = v_step.capability
           and action->'arguments' is not distinct from v_step.arguments
           and action->'effects' is not distinct from v_step.effects
      )
      into v_intent_authorized;
  else
    -- KIPU_M0_117_LEGACY_PLAN_AUTHORITY: unchanged envelope predicate.
    select exists (
      select 1 from jsonb_array_elements(coalesce(v_op.plan->'actions','[]'::jsonb)) a,
        lateral jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
       where a->>'id' = v_step_key and e->>'classification' = 'debt_proceeds'
    ) into v_intent_authorized;
  end if;

  -- Immutable intent is checked before the replay branch. A replay is allowed
  -- to skip mutable account/rate revalidation, but never to change what this
  -- durable step means.
  if v_step.arguments->>'direction' <> 'in'
     or v_step.arguments->>'inflowKind' <> 'borrowed'
     or nullif(v_step.arguments->>'accountId','')::uuid <> v_account
     or nullif(v_step.arguments->>'debtAccountId','')::uuid <> v_debt
     or abs(coalesce(nullif(v_step.arguments->>'amount','')::numeric,0) - v_amount) > 0.005
     or v_intent_authorized is not true then
    raise exception 'KIPU_VALIDATION: debt proceeds payload contradicts its persisted plan'
      using errcode = '22023';
  end if;
  v_base_amount := round(v_amount * v_rate, 2);
  if v_base_amount <= 0 then
    raise exception 'KIPU_FX_REQUIRED: debt proceeds base leg is not expressible'
      using errcode = '22023';
  end if;
  if v_step.status in ('applied','verified') then
    select * into v_application
      from public.debt_proceeds_applications
     where user_id = v_user and operation_id = v_operation
       and step_key = v_step_key
     for update;
    if not found
       or v_application.account_id <> v_account
       or v_application.debt_account_id <> v_debt
       or abs(v_application.amount - v_amount) > 0.005
       or abs(v_application.base_amount - v_base_amount) > 0.005
       or v_application.original_currency <> v_currency
       or v_application.base_currency <> v_base
       or abs(v_application.exchange_rate_to_base - v_rate) > 0.0000000001
       or v_application.dedupe_key <> v_dedupe then
      raise exception 'KIPU_DEDUPE_MISMATCH: debt proceeds replay changed its economics'
        using errcode = '22023';
    end if;
    return coalesce(v_step.result,'{}'::jsonb)
      || jsonb_build_object('outcome','replayed');
  end if;
  if v_step.status <> 'preflighted' then
    raise exception 'KIPU_VALIDATION: debt proceeds step was not preflighted'
      using errcode = '22023';
  end if;

  select upper(a.currency) into v_account_currency from public.accounts a
   where a.id = v_account and a.user_id = v_user and a.status = 'active'
   for no key update;
  select upper(d.currency) into v_debt_currency from public.debt_accounts d
   where d.id = v_debt and d.user_id = v_user and d.type <> 'credit_card'
   for no key update;
  select upper(base_currency) into v_profile_base from public.profiles
   where id = v_user for no key update;
  if v_account_currency is null or v_debt_currency is null or v_profile_base is null then
    raise exception 'KIPU_OWNERSHIP: account, liability or profile not owned'
      using errcode = '42501';
  end if;
  if v_account_currency <> v_currency or v_debt_currency <> v_currency
     or v_profile_base <> v_base then
    raise exception 'KIPU_VALIDATION: debt proceeds currencies contradict account, liability or profile'
      using errcode = '22023';
  end if;
  update public.agent_operation_steps set status = 'applying'
   where id = v_step.id;
  v_fingerprint := md5(jsonb_build_object(
    'user_id',v_user,'operation_id',v_operation,'step_key',v_step_key,
    'account_id',v_account,'debt_account_id',v_debt,'amount',v_amount,
    'original_currency',v_currency,'base_amount',v_base_amount,
    'base_currency',v_base,'exchange_rate_to_base',v_rate,
    'dedupe_key',v_dedupe
  )::text);
  v_transaction := public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id',v_user,'type','adjustment','effect_type','adjustment','sign',1,
    'description',coalesce(nullif(p->>'description',''),'Fondos prestados recibidos'),
    'category','other','original_amount',v_amount,'original_currency',v_currency,
    'exchange_rate_to_base',v_rate,'base_amount',v_base_amount,
    'base_currency',v_base,'destination_account_id',v_account,
    'raw_input',coalesce(p->>'raw_input',''),'input_channel',coalesce(p->>'input_channel','chat'),
    'occurred_at',nullif(p->>'occurred_at','')::timestamptz,
    'external_ref','debt_proceeds:' || v_operation::text || ':' || v_step_key,
    'dedupe_key',v_dedupe
  ));
  update public.debt_accounts
     set current_balance_original = current_balance_original + v_amount,
         current_balance_base = current_balance_base + v_base_amount
   where id = v_debt and user_id = v_user;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'KIPU_EFFECT_MISSING: debt proceeds liability leg'
      using errcode = '22023';
  end if;
  insert into public.debt_proceeds_applications(
    user_id,operation_id,step_key,transaction_id,account_id,debt_account_id,
    amount,base_amount,original_currency,base_currency,
    exchange_rate_to_base,dedupe_key,payload_fingerprint
  ) values (
    v_user,v_operation,v_step_key,v_transaction,v_account,v_debt,
    v_amount,v_base_amount,v_currency,v_base,v_rate,v_dedupe,v_fingerprint
  );
  update public.agent_operation_steps
     set status = 'applied', applied_at = now(),
         affected_refs = jsonb_build_array(
           jsonb_build_object('type','transaction','id',v_transaction),
           jsonb_build_object('type','account','id',v_account),
           jsonb_build_object('type','debt_account','id',v_debt)
         ),
         result = jsonb_build_object(
           'outcome','applied','transaction_id',v_transaction,
           'account_id',v_account,'debt_account_id',v_debt,
           'amount',v_amount,'currency',v_currency,
           'tool_status','done','execution_effect','write'
         )
   where id = v_step.id;
  return jsonb_build_object(
    'outcome','applied','transaction_id',v_transaction,
    'account_id',v_account,'debt_account_id',v_debt,
    'amount',v_amount,'currency',v_currency
  );
end;
$$;

alter function public.kipu_apply_debt_proceeds(jsonb) owner to postgres;
revoke all on function public.kipu_apply_debt_proceeds(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_apply_debt_proceeds(jsonb)
  to service_role;

do $migration$
declare
  v_definition text;
  v_security_definer boolean;
  v_search_path text[];
begin
  select pg_get_functiondef(p.oid), p.prosecdef, p.proconfig
    into v_definition, v_security_definer, v_search_path
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'kipu_apply_debt_proceeds'
     and pg_get_function_identity_arguments(p.oid) = 'p jsonb';
  if v_definition is null
     or position('KIPU_M0_117_LOOP_STEP_AUTHORITY' in v_definition) = 0
     or position('KIPU_M0_117_LEGACY_PLAN_AUTHORITY' in v_definition) = 0
     or position('m.status = ''executing''' in v_definition) = 0
     or position('v_step.arguments_fingerprint = md5(v_step.arguments::text)' in v_definition) = 0
     or position('effect->>''source'' = ''capability_catalog''' in v_definition) = 0 then
    raise exception 'KIPU_MIGRATION: 117 debt-proceeds authority topology missing';
  end if;
  if not coalesce(v_security_definer,false)
     or not ('search_path=public, pg_temp' = any(coalesce(v_search_path,'{}'::text[]))) then
    raise exception 'KIPU_MIGRATION: 117 debt-proceeds security topology missing';
  end if;
end;
$migration$;
