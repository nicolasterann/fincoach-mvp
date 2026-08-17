-- Migracion 113 - M0.11A: diagnostico exacto de igualdad post-ejecucion.
--
-- PREPARADA, NO APLICADA. La 112 ya esta aplicada y no se reescribe.
--
-- La primera ejecucion real de M112.5 comprobo que la barrera fallaba cerrada,
-- pero tambien que `actual_count` nombraba filas preparadas y el mensaje unico
-- culpaba a tres conjuntos que si coincidian. Eso vuelve inobservable la causa
-- real. Esta version conserva la igualdad estricta y separa:
--
--   authorized_count  acciones del manifiesto autorizado
--   prepared_count    filas de step persistidas para el plan
--   matching_count    filas preparadas identicas al manifiesto
--   executed_count    filas que alcanzaron un resultado de ejecucion
--   settled_count     coincidencias con resultado terminal admisible
--   verified_count    coincidencias verificadas
--
-- `actual_count` queda como alias compatible de `executed_count`; ya no
-- significa "filas que existen". Cada rechazo persiste un reason_code preciso.

create or replace function public.kipu_verify_agent_operation_manifest(p jsonb)
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
  v_allow_incomplete boolean := coalesce((p->>'allow_incomplete')::boolean,false);
  v_op public.agent_operations%rowtype;
  v_manifest public.agent_operation_manifests%rowtype;
  v_authorized integer;
  v_prepared integer;
  v_matching integer;
  v_executed integer;
  v_settled integer;
  v_verified integer;
  v_reason_code text;
  v_reason text;
  v_verification jsonb;
begin
  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_op.status <> 'verifying' or v_op.plan_version <> v_plan_version
     or (v_op.lease_token is not null and (
       v_lease is null or v_op.lease_token <> v_lease or v_op.lease_expires_at <= now()
     )) then
    raise exception 'KIPU_CONFLICT: manifest verification has no live operation lease'
      using errcode = '22023';
  end if;
  select * into v_manifest from public.agent_operation_manifests
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_plan_version for update;
  if not found or v_manifest.status not in ('authorized','executing') then
    raise exception 'KIPU_VALIDATION: exact authorized manifest missing'
      using errcode = '22023';
  end if;

  v_authorized := jsonb_array_length(v_manifest.manifest->'actions');

  select count(*),
         count(*) filter (where s.status in (
           'applied','verified','needs_input','refused','failed'
         ))
    into v_prepared,v_executed
    from public.agent_operation_steps s
   where s.operation_id = v_operation and s.user_id = v_user
     and s.plan_version = v_plan_version;

  select count(*),
         count(*) filter (where s.status in ('verified','needs_input','refused','failed')),
         count(*) filter (where s.status = 'verified')
    into v_matching,v_settled,v_verified
    from public.agent_operation_steps s
   where s.operation_id = v_operation and s.user_id = v_user
     and s.plan_version = v_plan_version
     and exists (
       select 1
         from jsonb_array_elements(v_manifest.manifest->'actions')
              with ordinality a(value,n)
        where (a.n - 1) = (a.value->>'ordinal')::integer
          and a.value->>'action_id' = s.step_key
          and a.value->>'capability' = s.capability
          and a.value->'arguments' = s.arguments
          and a.value->'state_witness' = s.state_witness
          and a.value->'effects' = s.effects
          and a.value->'postconditions' = s.postconditions
          and coalesce(a.value->'atomic_group','null'::jsonb) =
              coalesce(to_jsonb(s.atomic_group),'null'::jsonb)
          and (a.n - 1) = s.step_order - 1
     );

  v_verification := jsonb_build_object(
    'authorized_manifest_hash',v_manifest.manifest_hash,
    'authorized_count',v_authorized,
    'prepared_count',v_prepared,
    'matching_count',v_matching,
    'executed_count',v_executed,
    'actual_count',v_executed,
    'settled_count',v_settled,
    'verified_count',v_verified,
    'allow_incomplete',v_allow_incomplete
  );

  if v_prepared <> v_authorized then
    v_reason_code := 'prepared_set_mismatch';
    v_reason := format(
      'KIPU_EFFECT_MISSING: authorized_count=%s but prepared_count=%s',
      v_authorized,v_prepared
    );
  elsif v_matching <> v_prepared then
    v_reason_code := 'prepared_payload_mismatch';
    v_reason := format(
      'KIPU_EFFECT_MISMATCH: prepared_count=%s but matching_count=%s',
      v_prepared,v_matching
    );
  elsif v_executed <> v_prepared then
    v_reason_code := 'execution_incomplete';
    v_reason := format(
      'KIPU_EFFECT_MISSING: prepared_count=%s but executed_count=%s',
      v_prepared,v_executed
    );
  elsif not v_allow_incomplete and v_verified <> v_matching then
    v_reason_code := 'verification_incomplete';
    v_reason := format(
      'KIPU_EFFECT_MISSING: matching_count=%s but verified_count=%s',
      v_matching,v_verified
    );
  elsif v_allow_incomplete and v_settled <> v_matching then
    v_reason_code := 'settlement_incomplete';
    v_reason := format(
      'KIPU_EFFECT_MISSING: matching_count=%s but settled_count=%s',
      v_matching,v_settled
    );
  end if;

  if v_reason_code is not null then
    v_verification := v_verification || jsonb_build_object(
      'reason_code',v_reason_code
    );
    update public.agent_operation_manifests
       set status = 'failed_integrity',
           verification = v_verification
     where id = v_manifest.id returning * into v_manifest;
    return jsonb_build_object(
      'outcome','integrity_failed',
      'manifest_id',v_manifest.id,
      'manifest_hash',v_manifest.manifest_hash,
      'reason_code',v_reason_code,
      'verification',v_manifest.verification,
      'reason',v_reason
    );
  end if;

  select v_verification || jsonb_build_object(
    'steps',coalesce(jsonb_agg(jsonb_build_object(
      'step_key',s.step_key,'capability',s.capability,'arguments',s.arguments,
      'effects',s.effects,'status',s.status,'result',s.result,
      'affected_refs',s.affected_refs
    ) order by s.step_order),'[]'::jsonb)
  ) into v_verification
  from public.agent_operation_steps s
  where s.operation_id = v_operation and s.user_id = v_user
    and s.plan_version = v_plan_version;

  update public.agent_operation_manifests
     set status = 'verified',
         verification = v_verification,
         verified_at = now()
   where id = v_manifest.id returning * into v_manifest;
  return jsonb_build_object(
    'outcome',case when v_allow_incomplete then 'partially_verified' else 'verified' end,
    'manifest_id',v_manifest.id,
    'manifest_hash',v_manifest.manifest_hash,
    'verification',v_verification
  );
end;
$$;

alter function public.kipu_verify_agent_operation_manifest(jsonb) owner to postgres;
revoke all on function public.kipu_verify_agent_operation_manifest(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_verify_agent_operation_manifest(jsonb)
  to service_role;

