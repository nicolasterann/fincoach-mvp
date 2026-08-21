-- Migration 120 - M0 Friccion Cero / Ola 2: aporte ad-hoc atomico a una
-- inversion. Caja, activo, marker durable y receipt del step aterrizan en una
-- sola transaccion; un replay exacto devuelve el mismo receipt.
--
-- PREPARADA, NO APLICADA. El founder la aplica unicamente despues de la
-- auditoria pre-aplicacion de Claude.
--
-- La RPC de la 080 no admite este caso sin falsear su identidad: exige una
-- recurring_occurrence pending, deriva cuenta/activo desde savings_plans y su
-- marker es unico+FK por occurrence. Esta hermana conserva su maquinaria
-- probada (ledger adjustment + asset delta + marker/fingerprint) y usa la
-- autoridad durable del step/manifiesto loop establecida por 116/117.

begin;

create table if not exists public.investment_contribution_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null references public.agent_operations(id) on delete cascade,
  step_key text not null,
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  asset_id uuid not null references public.investment_accounts(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  base_amount numeric(14,2) not null check (base_amount > 0),
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  asset_amount numeric(14,2) not null check (asset_amount > 0),
  asset_currency text not null check (asset_currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_base numeric not null check (exchange_rate_to_base > 0),
  dedupe_key text not null,
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{32}$'),
  asset_value_original_was_null boolean not null,
  asset_updated_at_at_apply timestamptz not null,
  reversal_transaction_id uuid unique references public.transactions(id) on delete restrict,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (operation_id, step_key),
  unique (user_id, dedupe_key),
  constraint investment_contribution_reversal_pair_ck check (
    (reversal_transaction_id is null) = (reversed_at is null)
  )
);

alter table public.investment_contribution_applications enable row level security;
alter table public.investment_contribution_applications owner to postgres;

drop policy if exists "Users can view own investment contributions"
  on public.investment_contribution_applications;
create policy "Users can view own investment contributions"
  on public.investment_contribution_applications for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.investment_contribution_applications
  from public, anon, authenticated, service_role;
grant select on table public.investment_contribution_applications
  to authenticated, service_role;

create or replace function public.kipu_apply_investment_contribution(p jsonb)
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
  v_asset uuid := nullif(p->>'asset_id','')::uuid;
  v_amount numeric := round(nullif(p->>'amount','')::numeric,2);
  v_currency text := upper(nullif(btrim(p->>'currency'),''));
  v_base_amount numeric := round(nullif(p->>'base_amount','')::numeric,2);
  v_base_currency text := upper(nullif(btrim(p->>'base_currency'),''));
  v_asset_amount numeric := round(nullif(p->>'asset_amount','')::numeric,2);
  v_asset_currency text := upper(nullif(btrim(p->>'asset_currency'),''));
  v_rate numeric := nullif(p->>'exchange_rate_to_base','')::numeric;
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_entry jsonb := p->'ledger_entry';
  v_step public.agent_operation_steps%rowtype;
  v_op public.agent_operations%rowtype;
  v_application public.investment_contribution_applications%rowtype;
  v_account_row public.accounts%rowtype;
  v_asset_row public.investment_accounts%rowtype;
  v_profile_base text;
  v_transaction uuid;
  v_fingerprint text;
  v_rows integer;
  v_asset_updated_at timestamptz;
  v_intent_authorized boolean := false;
  v_result jsonb;
begin
  if v_user is null or v_operation is null or v_step_key is null or v_lease is null
     or v_account is null or v_asset is null or v_amount is null or v_amount <= 0
     or v_currency is null or v_base_amount is null or v_base_amount <= 0
     or v_base_currency is null or v_asset_amount is null or v_asset_amount <= 0
     or v_asset_currency is null or v_rate is null or v_rate <= 0
     or v_dedupe is null or jsonb_typeof(v_entry) is distinct from 'object'
     or v_currency !~ '^[A-Z]{3}$' or v_base_currency !~ '^[A-Z]{3}$'
     or v_asset_currency !~ '^[A-Z]{3}$' then
    raise exception 'KIPU_VALIDATION: complete investment contribution identity and money are required'
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
  if v_op.plan is distinct from '{"mode":"loop"}'::jsonb then
    raise exception 'KIPU_VALIDATION: investment contribution requires a loop operation'
      using errcode = '22023';
  end if;

  select * into v_step from public.agent_operation_steps
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_op.plan_version and step_key = v_step_key
   for update;
  if not found or v_step.capability <> 'record_investment_contribution' then
    raise exception 'KIPU_VALIDATION: investment contribution step is absent from the plan'
      using errcode = '22023';
  end if;

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
    ) into v_intent_authorized;

  v_fingerprint := md5(jsonb_build_object(
    'user_id',v_user,'operation_id',v_operation,'step_key',v_step_key,
    'account_id',v_account,'asset_id',v_asset,'amount',v_amount,
    'currency',v_currency,'base_amount',v_base_amount,
    'base_currency',v_base_currency,'asset_amount',v_asset_amount,
    'asset_currency',v_asset_currency,'exchange_rate_to_base',v_rate,
    'dedupe_key',v_dedupe,'ledger_entry',v_entry
  )::text);

  if v_step.status in ('applied','verified') then
    select * into v_application
      from public.investment_contribution_applications
     where user_id = v_user and operation_id = v_operation
       and step_key = v_step_key
     for update;
    if not found
       or v_application.account_id <> v_account
       or v_application.asset_id <> v_asset
       or abs(v_application.amount - v_amount) > 0.005
       or abs(v_application.base_amount - v_base_amount) > 0.005
       or abs(v_application.asset_amount - v_asset_amount) > 0.005
       or v_application.currency <> v_currency
       or v_application.base_currency <> v_base_currency
       or v_application.asset_currency <> v_asset_currency
       or abs(v_application.exchange_rate_to_base - v_rate) > 0.0000000001
       or v_application.dedupe_key <> v_dedupe
       or v_application.payload_fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: investment contribution replay changed its economics'
        using errcode = '22023';
    end if;
    return coalesce(v_step.result,'{}'::jsonb)
      || jsonb_build_object('outcome','replayed');
  end if;
  if nullif(v_step.arguments->>'sourceAccountId','')::uuid <> v_account
     or nullif(v_step.arguments->>'assetId','')::uuid <> v_asset
     or abs(coalesce(nullif(v_step.arguments->>'amount','')::numeric,0) - v_amount) > 0.005
     or (
       nullif(btrim(v_step.arguments->>'currency'),'') is not null
       and upper(v_step.arguments->>'currency') <> v_currency
     )
     or v_intent_authorized is not true then
    raise exception 'KIPU_VALIDATION: investment contribution payload contradicts its authorized step'
      using errcode = '22023';
  end if;
  if v_step.status <> 'preflighted' then
    raise exception 'KIPU_VALIDATION: investment contribution step was not preflighted'
      using errcode = '22023';
  end if;

  select * into v_account_row from public.accounts
   where id = v_account and user_id = v_user and status = 'active'
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: investment source account not found'
      using errcode = '42501';
  end if;
  select * into v_asset_row from public.investment_accounts
   where id = v_asset and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: investment asset not found'
      using errcode = '42501';
  end if;
  select upper(base_currency) into v_profile_base from public.profiles
   where id = v_user for no key update;
  if v_profile_base is null then
    raise exception 'KIPU_OWNERSHIP: investment profile not found'
      using errcode = '42501';
  end if;
  if upper(coalesce(v_account_row.currency,'')) <> v_currency
     or v_profile_base <> v_base_currency
     or upper(coalesce(v_asset_row.currency,v_base_currency)) <> v_asset_currency
     or round(v_amount * v_rate,2) <> v_base_amount
     or (v_asset_currency = v_currency and v_asset_amount <> v_amount)
     or (v_asset_currency = v_base_currency and v_asset_amount <> v_base_amount) then
    raise exception 'KIPU_FX_REQUIRED: investment contribution currencies or amounts changed before write'
      using errcode = '22023';
  end if;

  if nullif(v_entry->>'user_id','')::uuid is distinct from v_user
     or coalesce(v_entry->>'type','') <> 'adjustment'
     or coalesce(v_entry->>'effect_type','') <> 'adjustment'
     or coalesce(nullif(v_entry->>'sign','')::numeric,1) <> 1
     or coalesce(v_entry->>'category','') <> 'savings'
     or nullif(v_entry->>'source_account_id','')::uuid is distinct from v_account
     or nullif(v_entry->>'destination_account_id','') is not null
     or nullif(v_entry->>'debt_account_id','') is not null
     or nullif(v_entry->>'goal_id','') is not null
     or nullif(v_entry->>'related_transaction_id','') is not null
     or round(nullif(v_entry->>'original_amount','')::numeric,2) is distinct from v_amount
     or upper(coalesce(v_entry->>'original_currency','')) <> v_currency
     or round(nullif(v_entry->>'base_amount','')::numeric,2) is distinct from v_base_amount
     or upper(coalesce(v_entry->>'base_currency','')) <> v_base_currency
     or (v_entry->>'exchange_rate_to_base')::numeric is distinct from v_rate
     or nullif(v_entry->>'dedupe_key','') is distinct from v_dedupe then
    raise exception 'KIPU_VALIDATION: investment contribution ledger entry does not match request'
      using errcode = '22023';
  end if;

  update public.agent_operation_steps set status = 'applying'
   where id = v_step.id;
  v_transaction := public.kipu_apply_ledger_entry(v_entry);
  if v_transaction is null then
    raise exception 'KIPU_EFFECT_MISSING: investment contribution transaction'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.transactions
     where user_id = v_user and type = 'reversal'
       and related_transaction_id = v_transaction
  ) then
    raise exception 'KIPU_CONFLICT: investment contribution transaction is reversed'
      using errcode = '22023';
  end if;

  update public.investment_accounts
     set value_base = round(coalesce(value_base,0) + v_base_amount,2),
         value_original = case
           when value_original is null then null
           else round(value_original + v_asset_amount,2)
         end,
         updated_at = clock_timestamp()
   where id = v_asset and user_id = v_user
   returning updated_at into v_asset_updated_at;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 or v_asset_updated_at is null then
    raise exception 'KIPU_EFFECT_MISSING: investment contribution asset leg'
      using errcode = '22023';
  end if;

  insert into public.investment_contribution_applications(
    user_id,operation_id,step_key,transaction_id,account_id,asset_id,
    amount,currency,base_amount,base_currency,asset_amount,asset_currency,
    exchange_rate_to_base,dedupe_key,payload_fingerprint,
    asset_value_original_was_null,asset_updated_at_at_apply
  ) values (
    v_user,v_operation,v_step_key,v_transaction,v_account,v_asset,
    v_amount,v_currency,v_base_amount,v_base_currency,v_asset_amount,v_asset_currency,
    v_rate,v_dedupe,v_fingerprint,v_asset_row.value_original is null,v_asset_updated_at
  );

  v_result := jsonb_build_object(
    'outcome','applied','transaction_id',v_transaction,
    'account_id',v_account,'asset_id',v_asset,
    'amount',v_amount,'currency',v_currency,
    'base_amount',v_base_amount,'base_currency',v_base_currency,
    'asset_amount',v_asset_amount,'asset_currency',v_asset_currency,
    'moved_money',true,'tool_status','done','execution_effect','write'
  );
  update public.agent_operation_steps
     set status = 'applied', applied_at = now(), result = v_result,
         affected_refs = jsonb_build_array(
           jsonb_build_object('type','transaction','id',v_transaction),
           jsonb_build_object('type','account','id',v_account),
           jsonb_build_object('type','asset','id',v_asset)
         )
   where id = v_step.id;
  return v_result;
end;
$$;

alter function public.kipu_apply_investment_contribution(jsonb) owner to postgres;
revoke all on function public.kipu_apply_investment_contribution(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_apply_investment_contribution(jsonb)
  to service_role;

-- A contribution has two financial legs. A generic ledger reversal would put
-- cash back while leaving the asset inflated, so only the complete domain
-- reversal below may reverse its transaction.
create or replace function public.kipu__guard_investment_contribution_reversal()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.type = 'reversal'
     and new.related_transaction_id is not null
     and exists (
       select 1 from public.investment_contribution_applications a
        where a.transaction_id = new.related_transaction_id
     )
     and current_setting('kipu.sanctioned_investment_contribution_reversal',true)
         is distinct from '1' then
    raise exception 'KIPU_VALIDATION: investment contribution requires its two-leg reversal writer'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

alter function public.kipu__guard_investment_contribution_reversal() owner to postgres;
revoke all on function public.kipu__guard_investment_contribution_reversal()
  from public, anon, authenticated, service_role;

drop trigger if exists transactions_investment_contribution_reversal_guard
  on public.transactions;
create trigger transactions_investment_contribution_reversal_guard
before insert on public.transactions
for each row execute function public.kipu__guard_investment_contribution_reversal();

create or replace function public.kipu_reverse_investment_contribution(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_original uuid := nullif(p->>'transaction_id','')::uuid;
  v_application public.investment_contribution_applications%rowtype;
  v_account_status text;
  v_asset public.investment_accounts%rowtype;
  v_reversal uuid;
  v_rows integer;
begin
  if v_user is null or v_original is null then
    raise exception 'KIPU_VALIDATION: user_id and transaction_id required'
      using errcode = '22023';
  end if;
  select * into v_application
    from public.investment_contribution_applications
   where user_id = v_user and transaction_id = v_original
   for update;
  if not found then
    return jsonb_build_object('outcome','not_investment_contribution');
  end if;
  if v_application.reversed_at is not null then
    return jsonb_build_object(
      'outcome','already_reversed_investment_contribution',
      'reversal_transaction_ids',jsonb_build_array(v_application.reversal_transaction_id),
      'asset_id',v_application.asset_id
    );
  end if;
  select status into v_account_status from public.accounts
   where id = v_application.account_id and user_id = v_user for update;
  select * into v_asset from public.investment_accounts
   where id = v_application.asset_id and user_id = v_user for update;
  if v_account_status is null or v_asset.id is null then
    raise exception 'KIPU_OWNERSHIP: investment contribution account or asset vanished'
      using errcode = '42501';
  end if;
  if v_account_status <> 'active' then
    raise exception 'KIPU_NEEDS_INFO: reopen the source account before undo'
      using errcode = '22023';
  end if;
  if v_asset.updated_at is distinct from v_application.asset_updated_at_at_apply then
    raise exception 'KIPU_NEEDS_INFO: later asset changes require review before undo'
      using errcode = '22023';
  end if;
  if v_asset.value_base + 0.005 < v_application.base_amount
     or (
       not v_application.asset_value_original_was_null
       and (
         v_asset.value_original is null
         or v_asset.value_original + 0.005 < v_application.asset_amount
       )
     ) then
    raise exception 'KIPU_NEEDS_INFO: asset value no longer contains the contribution'
      using errcode = '22023';
  end if;

  perform set_config('kipu.sanctioned_investment_contribution_reversal','1',true);
  v_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id',v_user,'type','reversal','sign',-1,
    'related_transaction_id',v_original,
    'raw_input',p->>'raw_input',
    'input_channel',coalesce(nullif(p->>'input_channel',''),'chat'),
    'occurred_at',coalesce(nullif(p->>'occurred_at','')::timestamptz,now())
  ));
  if v_reversal is null then
    raise exception 'KIPU_CONFLICT: investment contribution reversal returned no transaction'
      using errcode = '22023';
  end if;
  update public.investment_accounts
     set value_base = round(value_base - v_application.base_amount,2),
         value_original = case
           when v_application.asset_value_original_was_null then null
           else round(value_original - v_application.asset_amount,2)
         end,
         updated_at = clock_timestamp()
   where id = v_application.asset_id and user_id = v_user;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'KIPU_EFFECT_MISSING: investment contribution asset reversal'
      using errcode = '22023';
  end if;
  update public.investment_contribution_applications
     set reversal_transaction_id = v_reversal, reversed_at = now()
   where id = v_application.id;
  return jsonb_build_object(
    'outcome','reversed_investment_contribution',
    'reversal_transaction_ids',jsonb_build_array(v_reversal),
    'asset_id',v_application.asset_id
  );
end;
$$;

alter function public.kipu_reverse_investment_contribution(jsonb) owner to postgres;
revoke all on function public.kipu_reverse_investment_contribution(jsonb)
  from public, anon, authenticated, service_role;

-- Extend the proven v3 dispatcher instead of forking universal undo.
create or replace function public.kipu_reverse_financial_operation_v3(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  v_result := public.kipu_reverse_investment_contribution(p);
  if v_result->>'outcome' <> 'not_investment_contribution' then
    return v_result;
  end if;
  v_result := public.kipu_reverse_receivable_repayment(p);
  if v_result->>'outcome' <> 'not_receivable_repayment' then
    return v_result;
  end if;
  v_result := public.kipu_reverse_debt_proceeds(p);
  if v_result->>'outcome' <> 'not_debt_proceeds' then
    return v_result;
  end if;
  return public.kipu_reverse_financial_operation(p);
end;
$$;

create or replace function public.kipu_reverse_financial_operations_v3(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_ids uuid[];
  v_id uuid;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if v_user is null
     or jsonb_typeof(p->'transaction_ids') <> 'array'
     or jsonb_array_length(p->'transaction_ids') < 1
     or jsonb_array_length(p->'transaction_ids') > 360 then
    raise exception 'KIPU_VALIDATION: user_id and 1..360 transaction_ids required'
      using errcode = '22023';
  end if;
  select array_agg(value::uuid order by ordinal) into v_ids
    from jsonb_array_elements_text(p->'transaction_ids')
         with ordinality as x(value,ordinal);
  if cardinality(v_ids) <> (select count(distinct item) from unnest(v_ids) item) then
    raise exception 'KIPU_VALIDATION: duplicate transaction_ids'
      using errcode = '22023';
  end if;
  foreach v_id in array v_ids loop
    v_result := public.kipu_reverse_financial_operation_v3(jsonb_build_object(
      'user_id',v_user,'transaction_id',v_id,
      'raw_input',p->>'raw_input',
      'input_channel',coalesce(nullif(p->>'input_channel',''),'chat'),
      'occurred_at',coalesce(nullif(p->>'occurred_at','')::timestamptz,now())
    ));
    if v_result->>'outcome' in (
      'closed_account_operation_requires_reopen',
      'account_close_correction_requires_undo',
      'installment_purchase_paid_requires_review'
    ) then
      raise exception 'KIPU_NEEDS_INFO: one operation needs domain review before undo'
        using errcode = '22023';
    end if;
    if v_result->>'outcome' not in (
      'reversed','already_reversed',
      'reversed_account_close','already_reversed_account_close',
      'reversed_installment_purchase','already_reversed_installment_purchase',
      'reversed_receivable_repayment','already_reversed_receivable_repayment',
      'reversed_debt_proceeds','already_reversed_debt_proceeds',
      'reversed_investment_contribution','already_reversed_investment_contribution'
    ) then
      raise exception 'KIPU_CONFLICT: unclassified reversal outcome %', v_result->>'outcome'
        using errcode = '22023';
    end if;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;
  return jsonb_build_object('outcome','applied','results',v_results);
end;
$$;

alter function public.kipu_reverse_financial_operation_v3(jsonb) owner to postgres;
alter function public.kipu_reverse_financial_operations_v3(jsonb) owner to postgres;
revoke all on function public.kipu_reverse_financial_operation_v3(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_reverse_financial_operations_v3(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_reverse_financial_operations_v3(jsonb)
  to service_role;

do $migration$
declare
  v_apply text;
  v_reverse_one text;
  v_reverse_many text;
begin
  select pg_get_functiondef('public.kipu_apply_investment_contribution(jsonb)'::regprocedure)
    into v_apply;
  select pg_get_functiondef('public.kipu_reverse_financial_operation_v3(jsonb)'::regprocedure)
    into v_reverse_one;
  select pg_get_functiondef('public.kipu_reverse_financial_operations_v3(jsonb)'::regprocedure)
    into v_reverse_many;
  if to_regclass('public.investment_contribution_applications') is null
     or position('m.status = ''executing''' in v_apply) = 0
     or position('effect->>''source'' = ''capability_catalog''' in v_apply) = 0
     or position('public.kipu_apply_ledger_entry(v_entry)' in v_apply) = 0
     or position('public.kipu_reverse_investment_contribution(p)' in v_reverse_one) = 0
     or position('reversed_investment_contribution' in v_reverse_many) = 0 then
    raise exception 'KIPU_MIGRATION: 120 investment contribution topology missing';
  end if;
end;
$migration$;

commit;
