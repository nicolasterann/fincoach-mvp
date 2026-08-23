-- Migración 123 — cierre M0: un paso NOOP coherente verifica.
--
-- PREPARADA, NO APLICADA. El founder la aplica personalmente tras la
-- auditoría de Claude (ADENDA 59). Caso real 2026-08-23 03:31Z: «marca las
-- tarjetas como pagadas» produjo dos register_card_payment NOOP legítimos
-- (ciclo ya cubierto); el verify exigía recibo de transacción a todo step
-- económico aplicado, tiró KIPU_EFFECT_MISSING, dejó la operación atascada
-- en `verifying` y envenenó los turnos siguientes. Cambia UNA condición:
-- noop declarado + cero recibos + sin reclamo de write = verificado.

begin;

create or replace function public.kipu_verify_agent_loop_step(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_plan_version integer := nullif(p->>'plan_version','')::integer;
  v_step_key text := nullif(btrim(p->>'step_key'),'');
  v_capability text := nullif(btrim(p->>'capability'),'');
  v_args jsonb := p->'arguments';
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_post_write boolean := coalesce((p->>'post_write_context_verified')::boolean,false);
  v_op public.agent_operations%rowtype;
  v_step public.agent_operation_steps%rowtype;
  v_economic boolean;
  v_effect text;
  v_receipt_count integer;
  v_owned_count integer;
begin
  if v_user is null or v_operation is null or v_plan_version is null
     or v_step_key is null or v_capability is null or v_lease is null
     or jsonb_typeof(coalesce(v_args,'null'::jsonb)) <> 'object' then
    raise exception 'KIPU_VALIDATION: complete loop step verification required'
      using errcode = '22023';
  end if;
  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_op.status <> 'verifying' or v_op.plan is distinct from '{"mode":"loop"}'::jsonb
     or v_op.lease_token <> v_lease
     or v_op.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: loop verification has no live exact lease'
      using errcode = '22023';
  end if;
  select * into v_step from public.agent_operation_steps
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_plan_version and step_key = v_step_key for update;
  if not found or v_step.capability is distinct from v_capability
     or v_step.arguments_fingerprint is distinct from md5(v_args::text)
     or v_step.arguments is distinct from v_args then
    raise exception 'KIPU_VALIDATION: loop verification contradicts staged step'
      using errcode = '22023';
  end if;
  if v_step.status = 'verified' then
    return jsonb_build_object(
      'outcome','verified','replayed',true,'step_key',v_step.step_key,
      'status',v_step.status
    );
  end if;
  if v_step.status <> 'applied' or v_step.result is null then
    raise exception 'KIPU_EFFECT_MISSING: loop step has no applied durable receipt'
      using errcode = '22023';
  end if;
  v_effect := coalesce(v_step.result->>'execution_effect','');
  if v_effect = 'write' and not v_post_write then
    raise exception 'KIPU_READ_FAILED: post-write financial context was not verified'
      using errcode = '22023';
  end if;
  select exists (
    select 1 from jsonb_array_elements(v_step.effects) effect
     where effect->>'kind' = 'economic_event'
       and effect->>'source' = 'capability_catalog'
  ) into v_economic;
  select count(*) into v_receipt_count
    from jsonb_array_elements(v_step.affected_refs) ref
   where ref->>'type' = 'transaction'
     and nullif(ref->>'id','') is not null;
  if v_economic and v_receipt_count = 0 then
    -- Migración 123 (M0 cierre): un NOOP COHERENTE verifica. El executor
    -- declaró que no había nada que hacer (p.ej. «el ciclo ya figura
    -- cubierto»), no reclama efecto de escritura y no hay recibos: nada
    -- esperado y nada encontrado es física consistente, no un efecto
    -- perdido. Cualquier otra combinación sigue rehusando: un step
    -- económico sin noop declarado o que reclame write sin recibos es
    -- exactamente el agujero que esta verificación existe para cerrar.
    if coalesce(v_step.result->'data'->>'noop','') = 'true'
       and coalesce(v_step.result->>'execution_effect','') <> 'write' then
      null;
    else
      raise exception 'KIPU_EFFECT_MISSING: economic loop step lacks owned transaction receipts'
        using errcode = '22023';
    end if;
  end if;
  -- A contextual capability can still move money. A transaction receipt is
  -- server evidence of that economic effect, so validate the exact same
  -- ownership boundary and persist the marker before undo can observe it.
  if v_receipt_count > 0 then
    if exists (
      select 1 from jsonb_array_elements(v_step.affected_refs) ref
       where ref->>'type' = 'transaction'
         and not exists (
           select 1 from public.transactions t
            where t.id::text = ref->>'id' and t.user_id = v_user
         )
    ) then
      raise exception 'KIPU_EFFECT_MISSING: economic loop step lacks owned transaction receipts'
        using errcode = '22023';
    end if;
    select count(*) into v_owned_count from public.transactions t
     where t.user_id = v_user and exists (
       select 1 from jsonb_array_elements(v_step.affected_refs) ref
        where ref->>'type' = 'transaction' and ref->>'id' = t.id::text
     );
    if v_owned_count <> (
      select count(distinct ref->>'id')
        from jsonb_array_elements(v_step.affected_refs) ref
       where ref->>'type' = 'transaction'
    ) then
      raise exception 'KIPU_EFFECT_MISSING: transaction receipt ownership mismatch'
        using errcode = '22023';
    end if;
  end if;
  update public.agent_operation_steps
     set status = 'verified', verified_at = coalesce(verified_at,now()),
         effects = case
           when not v_economic and v_receipt_count > 0 then effects ||
             '[{"kind":"economic_event","source":"receipt"}]'::jsonb
           else effects
         end
   where id = v_step.id returning * into v_step;
  return jsonb_build_object(
    'outcome','verified','replayed',false,'step_key',v_step.step_key,
    'status',v_step.status
  );
end;
$$;

alter function public.kipu_verify_agent_loop_step(jsonb) owner to postgres;
revoke all on function public.kipu_verify_agent_loop_step(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_verify_agent_loop_step(jsonb)
  to service_role;

do $migration$
declare
  v_def text;
begin
  select pg_get_functiondef('public.kipu_verify_agent_loop_step(jsonb)'::regprocedure)
    into v_def;
  if position('coalesce(v_step.result->''data''->>''noop'','''') = ''true''' in v_def) = 0 then
    raise exception 'MIGRATION_123: coherent-noop branch missing';
  end if;
  if position('economic loop step lacks owned transaction receipts' in v_def) = 0 then
    raise exception 'MIGRATION_123: economic receipt demand was lost';
  end if;
end;
$migration$;

commit;
