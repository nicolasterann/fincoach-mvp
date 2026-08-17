-- Migracion 115 - M0.11A: continuidad conversacional sin reejecutar dinero.
--
-- PREPARADA, NO APLICADA. Aplicar solo despues de auditar este archivo.
--
-- Dos simetrias de una misma invariante:
--   1. El registro del manifiesto debe poder volver a probar en PostgreSQL los
--      mismos stored facts que el runtime publica al planner. La 112 conocia
--      solo fixed_expenses; paidInFull ya deriva el corte vivo bajo lock desde
--      la 107 y ahora el manifiesto verifica esa misma fuente.
--   2. Si ejecucion+verificacion ya terminaron pero la publicacion fallo, un
--      retry exacto no puede llamar otra vez a los writers ni declarar que el
--      manifiesto "no esta autorizado". Solo un manifiesto COMPLETO (no
--      allow_incomplete) y con todos sus pasos verificados puede reentrar como
--      already_verified.

do $migration$
declare
  v_definition text;
  v_old text := $old$
      elsif v_provenance->>'kind' = 'stored_fact' then
        if v_action->>'capability' <> 'log_movement'
           or v_provenance->>'path' <> 'amount'
           or nullif(v_action->'arguments'->>'fixedExpenseId','') is null
           or v_provenance->>'source_ref' <>
             'fixed_expenses:' || (v_action->'arguments'->>'fixedExpenseId') || ':declared_amount' then
          raise exception 'KIPU_VALIDATION: unsupported stored-fact provenance verifier'
            using errcode = '22023';
        end if;
        select * into v_fixed from public.fixed_expenses
         where id = (v_action->'arguments'->>'fixedExpenseId')::uuid
           and user_id = v_user for update;
        if not found or not v_fixed.is_active or coalesce(v_fixed.is_variable,false)
           or round(v_fixed.amount,2) <>
             round((v_action->'arguments'->>'amount')::numeric,2)
           or upper(v_fixed.currency) <>
             upper(v_action->'arguments'->>'currency') then
          raise exception 'KIPU_CONFLICT: stored fixed-expense provenance drifted'
            using errcode = '22023';
        end if;
      else
$old$;
  v_new text := $new$
      elsif v_provenance->>'kind' = 'stored_fact' then
        -- KIPU_M0_115_CARD_STORED_FACT: one locked verifier per durable source.
        -- PostgreSQL proves the source the model declared; it never infers the
        -- user's meaning or accepts an unregistered derivation.
        if v_action->>'capability' = 'log_movement' then
          if v_provenance->>'path' <> 'amount'
             or nullif(v_action->'arguments'->>'fixedExpenseId','') is null
             or v_provenance->>'source_ref' <>
               'fixed_expenses:' || (v_action->'arguments'->>'fixedExpenseId') || ':declared_amount' then
            raise exception 'KIPU_VALIDATION: unsupported stored-fact provenance verifier'
              using errcode = '22023';
          end if;
          select * into v_fixed from public.fixed_expenses
           where id = (v_action->'arguments'->>'fixedExpenseId')::uuid
             and user_id = v_user for update;
          if not found or not v_fixed.is_active or coalesce(v_fixed.is_variable,false)
             or round(v_fixed.amount,2) <>
               round((v_action->'arguments'->>'amount')::numeric,2)
             or upper(v_fixed.currency) <>
               upper(v_action->'arguments'->>'currency') then
            raise exception 'KIPU_CONFLICT: stored fixed-expense provenance drifted'
              using errcode = '22023';
          end if;
        elsif v_action->>'capability' = 'register_card_payment' then
          declare
            v_debt public.debt_accounts%rowtype;
            v_debt_id uuid;
            v_live_due numeric;
            v_witness jsonb := v_provenance->'state_witness';
            v_card_ref text := nullif(btrim(v_action->'arguments'->>'cardName'),'');
          begin
            if v_provenance->>'path' <> 'amount'
               or jsonb_typeof(v_action->'arguments'->'paidInFull') is distinct from 'boolean'
               or (v_action->'arguments'->>'paidInFull')::boolean is not true
               or v_action->'arguments' ? 'amount'
               or coalesce(v_provenance->>'source_ref','') !~
                 '^debt_accounts:[0-9a-fA-F-]{36}:full_payment_due$'
               or jsonb_typeof(coalesce(v_witness,'null'::jsonb)) <> 'object' then
              raise exception 'KIPU_VALIDATION: unsupported stored-fact provenance verifier'
                using errcode = '22023';
            end if;
            begin
              v_debt_id := split_part(v_provenance->>'source_ref',':',2)::uuid;
            exception when invalid_text_representation then
              raise exception 'KIPU_VALIDATION: invalid card stored-fact identity'
                using errcode = '22023';
            end;
            select * into v_debt from public.debt_accounts
             where id = v_debt_id and user_id = v_user and type = 'credit_card'
             for update;
            if not found then
              raise exception 'KIPU_OWNERSHIP: card stored fact is not owned'
                using errcode = '42501';
            end if;
            v_live_due := case
              when v_debt.statement_covered is true then 0::numeric
              else coalesce(v_debt.full_payment_due,v_debt.statement_total_due)
            end;
            if v_card_ref is null
               or not (
                 v_card_ref = v_debt.id::text
                 or regexp_replace(lower(v_card_ref),'[^[:alnum:]]','','g') =
                    regexp_replace(lower(v_debt.name),'[^[:alnum:]]','','g')
               )
               or v_debt.statement_covered is true
               or coalesce(v_live_due,0) <= 0
               or v_witness->>'debt_account_id' is distinct from v_debt.id::text
               or coalesce((v_witness->>'statement_covered')::boolean,true) is not false
               or jsonb_typeof(v_witness->'amount') is distinct from 'number'
               or abs((v_witness->>'amount')::numeric - v_live_due) > 0.005
               or upper(coalesce(v_witness->>'currency','')) <>
                  upper(coalesce(v_debt.currency,''))
               or (v_witness->>'statement_date') is distinct from v_debt.statement_date::text
               or (v_witness->>'statement_period_end') is distinct from v_debt.statement_period_end::text then
              raise exception 'KIPU_CONFLICT: stored card-statement provenance drifted'
                using errcode = '22023';
            end if;
          end;
        else
          raise exception 'KIPU_VALIDATION: unsupported stored-fact provenance verifier'
            using errcode = '22023';
        end if;
      else
$new$;
begin
  select pg_get_functiondef('public.kipu_register_agent_operation_manifest(jsonb)'::regprocedure)
    into v_definition;
  if position('KIPU_M0_115_CARD_STORED_FACT' in v_definition) > 0 then
    return;
  end if;
  if length(v_definition) - length(replace(v_definition,v_old,'')) <>
     length(v_old) then
    raise exception 'KIPU_MIGRATION: 115 expected exactly one stored-fact verifier anchor';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
  select pg_get_functiondef('public.kipu_register_agent_operation_manifest(jsonb)'::regprocedure)
    into v_definition;
  if position('KIPU_M0_115_CARD_STORED_FACT' in v_definition) = 0
     or position(v_old in v_definition) > 0 then
    raise exception 'KIPU_MIGRATION: 115 stored-fact verifier did not land';
  end if;
end;
$migration$;

create or replace function public.kipu_begin_agent_operation_manifest(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_plan_version integer := nullif(p->>'plan_version','')::integer;
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_row public.agent_operation_manifests%rowtype;
  v_authorized integer;
  v_verified integer;
begin
  perform 1 from public.agent_operations
   where id = v_operation and user_id = v_user and plan_version = v_plan_version
     and status = 'applying' and lease_token = v_lease
     and lease_expires_at > now() for update;
  if not found then
    raise exception 'KIPU_CONFLICT: operation manifest has no live applying lease'
      using errcode = '22023';
  end if;
  select * into v_row from public.agent_operation_manifests
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_plan_version for update;
  if not found then
    raise exception 'KIPU_VALIDATION: operation manifest is missing'
      using errcode = '22023';
  end if;

  -- KIPU_M0_115_VERIFIED_REENTRY: publication is not execution. An exact
  -- retry after a completed verification reuses receipts; it cannot write a
  -- second time. Partial verification deliberately does not qualify.
  if v_row.status = 'verified' then
    v_authorized := coalesce((v_row.verification->>'authorized_count')::integer,-1);
    v_verified := coalesce((v_row.verification->>'verified_count')::integer,-2);
    if coalesce((v_row.verification->>'allow_incomplete')::boolean,true)
       or v_authorized < 0 or v_verified <> v_authorized then
      raise exception 'KIPU_VALIDATION: partial manifest cannot reenter execution'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','already_verified','manifest_id',v_row.id,
      'manifest_hash',v_row.manifest_hash,'verification',v_row.verification
    );
  end if;
  if v_row.status not in ('authorized','executing') then
    raise exception 'KIPU_VALIDATION: operation manifest is not authorized'
      using errcode = '22023';
  end if;
  if v_row.status = 'authorized' then
    update public.agent_operation_manifests
       set status = 'executing', executing_at = now()
     where id = v_row.id returning * into v_row;
  end if;
  return jsonb_build_object(
    'outcome','executing','manifest_id',v_row.id,'manifest_hash',v_row.manifest_hash
  );
end;
$$;

alter function public.kipu_register_agent_operation_manifest(jsonb) owner to postgres;
alter function public.kipu_begin_agent_operation_manifest(jsonb) owner to postgres;
revoke all on function public.kipu_register_agent_operation_manifest(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_begin_agent_operation_manifest(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_register_agent_operation_manifest(jsonb)
  to service_role;
grant execute on function public.kipu_begin_agent_operation_manifest(jsonb)
  to service_role;
