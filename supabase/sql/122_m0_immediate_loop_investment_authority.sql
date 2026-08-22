-- Migration 122 — M0-AM: autoridad inmediata del loop para el aporte
-- ad-hoc a inversión (cierra el P1 del reporte M0-AM del 2026-08-22).
--
-- PREPARADA, NO APLICADA. El founder la aplica personalmente tras la
-- auditoría de Claude (ADENDA 53). Cambia UNA condición del writer de la
-- 120: v_intent_authorized acepta también el caso inmediato-loop cuando no
-- existe NINGÚN manifiesto para (operation, plan_version). Todo lo demás —
-- lease, step, fingerprint, marcador, payload, atomicidad, marca, dedupe,
-- reversal v3 — queda byte a byte como en la 120.

begin;

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
    and (
      -- Camino GRAVE (120, intacto): espejo por valor de un manifiesto
      -- loop_staged EXECUTING autorizado por una delivery distinta.
      exists (
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
      -- M0-AM (122): autoridad INMEDIATA del loop. El acta ADENDA 52 saca el
      -- registro ordinario de la segunda delivery, así que un flujo no-grave
      -- jamás crea manifiesto. La física de arriba no cambia: lease vivo
      -- sobre la operación applying, step exacto bajo lock con fingerprint y
      -- marcador económico, payload campo a campo, dos patas atómicas, marca
      -- durable y dedupe. Lo ÚNICO que cede es el espejo — y sólo cuando NO
      -- existe NINGÚN manifiesto para (operación, plan_version): si hay uno
      -- en cualquier estado, el espejo autorizado sigue siendo obligatorio.
      or (
        v_op.plan is not distinct from '{"mode":"loop"}'::jsonb
        and not exists (
          select 1 from public.agent_operation_manifests m2
           where m2.operation_id = v_operation and m2.user_id = v_user
             and m2.plan_version = v_op.plan_version
        )
      )
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

do $migration$
declare
  v_def text;
begin
  select pg_get_functiondef('public.kipu_apply_investment_contribution(jsonb)'::regprocedure)
    into v_def;
  if position('m2.plan_version = v_op.plan_version' in v_def) = 0 then
    raise exception 'MIGRATION_122: immediate loop authority branch missing';
  end if;
  if position('authorized_delivery_key is distinct from m.proposed_delivery_key' in v_def) = 0 then
    raise exception 'MIGRATION_122: authorized manifest mirror was lost';
  end if;
end;
$migration$;

commit;
