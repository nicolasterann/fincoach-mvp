-- Migration 121 - M0-AM / Fase B: salida legal para operaciones loop
-- applying/verifying sin manifiesto durable.
--
-- PREPARADA, NO APLICADA. El founder la aplica personalmente despues de la
-- auditoria pre-aplicacion. No cambia writers, tablas, RLS ni algebra: amplia
-- la cuarentena 118 para cerrar el hueco lifecycle de un step stageado cuyo
-- worker murio antes de registrar un manifiesto o un receipt.

begin;

create or replace function public.kipu_quarantine_agent_loop_operation(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_expected integer := nullif(p->>'expected_version','')::integer;
  v_plan_version integer := nullif(p->>'plan_version','')::integer;
  v_delivery text := nullif(btrim(p->>'delivery_key'),'');
  v_event_delivery text;
  v_root_message uuid := nullif(p->>'root_message_id','')::uuid;
  v_channel text := nullif(btrim(p->>'channel'),'');
  v_chat text := nullif(p->>'chat_id','');
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_reason text := nullif(btrim(p->>'reason_code'),'');
  v_op public.agent_operations%rowtype;
  v_manifest public.agent_operation_manifests%rowtype;
  v_manifest_found boolean := false;
  v_event public.agent_operation_transition_events%rowtype;
  v_authorized integer := 0;
  v_verified integer;
  v_applied integer;
  v_terminal integer;
  v_inflight integer;
  v_receipts integer;
  v_verification jsonb;
  v_transition jsonb;
begin
  if v_user is null or v_operation is null or v_expected is null
     or v_plan_version is null or v_delivery is null or v_root_message is null
     or v_channel not in ('telegram','web')
     or v_reason not in (
       'terminal_step','resume_failure','claim_failure','repeated_turn_failure',
       'user_abandoned'
     ) then
    raise exception 'KIPU_VALIDATION: complete bounded loop quarantine identity required'
      using errcode = '22023';
  end if;
  v_event_delivery := left(
    left(v_delivery,200) || ':quarantine:v' || v_plan_version::text,
    240
  );

  if not exists (
    select 1 from public.chat_messages message
     where message.id = v_root_message and message.user_id = v_user
       and message.role = 'user' and message.channel = v_channel
       and coalesce(message.chat_id,'') = coalesce(v_chat,'')
  ) then
    raise exception 'KIPU_OWNERSHIP: quarantine root message is not owned'
      using errcode = '42501';
  end if;

  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_op.channel <> v_channel or coalesce(v_op.chat_id,'') <> coalesce(v_chat,'') then
    raise exception 'KIPU_OWNERSHIP: quarantine crossed conversation identity'
      using errcode = '42501';
  end if;

  v_transition := jsonb_build_object(
    'kind','abandoned',
    'target_operation_id',v_operation,
    'consumed_pending_keys','[]'::jsonb,
    'remaining_pending_keys','[]'::jsonb,
    'rationale','loop_quarantine',
    'reason_code',v_reason
  );
  select * into v_event from public.agent_operation_transition_events
   where user_id = v_user and delivery_key = v_event_delivery;
  if found then
    if v_event.operation_id <> v_operation
       or v_event.transition is distinct from v_transition then
      raise exception 'KIPU_DEDUPE_MISMATCH: quarantine replay changed meaning'
        using errcode = '22023';
    end if;
    select * into v_manifest from public.agent_operation_manifests
     where operation_id = v_operation and user_id = v_user
       and plan_version = v_plan_version;
    v_manifest_found := found;
    if v_op.status <> 'abandoned'
       or (
         v_manifest_found and (
           v_manifest.status <> 'failed_integrity'
           or v_manifest.verification->>'kind' is distinct from 'loop_quarantined'
         )
       )
       or (
         not v_manifest_found and (
           v_op.last_error->>'code' is distinct from 'failed_quarantined'
           or v_op.last_error->>'manifest_present' is distinct from 'false'
         )
       ) then
      raise exception 'KIPU_DEDUPE_MISMATCH: quarantine event lacks terminal state'
        using errcode = '22023';
    end if;
    v_verification := case
      when v_manifest_found then v_manifest.verification
      else coalesce(v_event.after_state->'verification',v_op.last_error->'verification')
    end;
    return jsonb_build_object(
      'outcome','quarantined','replayed',true,'id',v_op.id,
      'status',v_op.status,'state_version',v_op.state_version,
      'plan_version',v_plan_version,
      'manifest_id',case when v_manifest_found then v_manifest.id else null end,
      'manifest_hash',case when v_manifest_found then v_manifest.manifest_hash else null end,
      'verification',v_verification
    );
  end if;

  if v_op.state_version <> v_expected then
    return jsonb_build_object(
      'outcome','conflict','id',v_op.id,'status',v_op.status,
      'state_version',v_op.state_version
    );
  end if;
  if v_op.plan is distinct from '{"mode":"loop"}'::jsonb
     or v_op.plan_version <> v_plan_version
     or v_op.status not in (
       'planning','awaiting_input','ready','applying','verifying','failed_retriable'
     ) then
    raise exception 'KIPU_VALIDATION: quarantine requires one live loop operation'
      using errcode = '22023';
  end if;
  if v_lease is not null and v_op.lease_token is distinct from v_lease then
    raise exception 'KIPU_CONFLICT: quarantine lease is stale'
      using errcode = '22023';
  end if;

  select * into v_manifest from public.agent_operation_manifests
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_plan_version for update;
  v_manifest_found := found;
  if v_manifest_found then
    if v_manifest.status <> 'executing'
       or v_manifest.manifest->>'kind' is distinct from 'loop_staged'
       or v_manifest.authorized_at is null then
      raise exception 'KIPU_VALIDATION: exact executing loop manifest is missing'
        using errcode = '22023';
    end if;
    v_authorized := jsonb_array_length(
      coalesce(v_manifest.manifest->'actions','[]'::jsonb)
    );
  elsif v_op.status not in ('applying','verifying') then
    raise exception 'KIPU_VALIDATION: manifest-less quarantine requires applying or verifying'
      using errcode = '22023';
  end if;

  select
    count(*) filter (where s.status = 'verified'),
    count(*) filter (where s.status = 'applied'),
    count(*) filter (where s.status in ('needs_input','refused','failed')),
    count(*) filter (where s.status in ('preflighted','applying')),
    count(*) filter (
      where s.result is not null
        and jsonb_array_length(coalesce(s.affected_refs,'[]'::jsonb)) > 0
    )
    into v_verified,v_applied,v_terminal,v_inflight,v_receipts
    from public.agent_operation_steps s
   where s.operation_id = v_operation and s.user_id = v_user
     and s.plan_version = v_plan_version;

  if v_terminal = 0 and not (
    (
      v_reason in ('resume_failure','claim_failure','repeated_turn_failure')
      and (
        (v_lease is not null and v_op.lease_token = v_lease
          and v_op.lease_expires_at > now())
        or v_op.lease_token is null
        or v_op.lease_expires_at <= now()
      )
    )
    or (
      v_reason = 'user_abandoned'
      and (v_op.lease_token is null or v_op.lease_expires_at <= now())
    )
  ) then
    raise exception 'KIPU_VALIDATION: loop quarantine has no terminal blocker'
      using errcode = '22023';
  end if;

  v_verification := jsonb_build_object(
    'kind','loop_quarantined',
    'reason_code',v_reason,
    'manifest_present',v_manifest_found,
    'authorized_count',v_authorized,
    'verified_count',v_verified,
    'applied_count',v_applied,
    'terminal_count',v_terminal,
    'inflight_count',v_inflight,
    'receipt_preserved_count',v_receipts,
    'allow_incomplete',true,
    'quarantined_at',now()
  );

  insert into public.agent_operation_transition_events(
    user_id,operation_id,delivery_key,transition_kind,target_operation_id,
    transition,before_state,after_state
  ) values (
    v_user,v_operation,v_event_delivery,'abandoned',v_operation,v_transition,
    jsonb_build_object(
      'operation_id',v_operation,'status',v_op.status,
      'state_version',v_op.state_version,'plan_version',v_plan_version,
      'manifest_id',case when v_manifest_found then v_manifest.id else null end,
      'manifest_hash',case when v_manifest_found then v_manifest.manifest_hash else null end,
      'manifest_status',case when v_manifest_found then v_manifest.status else null end
    ),
    jsonb_build_object(
      'operation_id',v_operation,'status','abandoned',
      'state_version',v_op.state_version + 1,'plan_version',v_plan_version,
      'manifest_id',case when v_manifest_found then v_manifest.id else null end,
      'manifest_hash',case when v_manifest_found then v_manifest.manifest_hash else null end,
      'manifest_status',case when v_manifest_found then 'failed_integrity' else null end,
      'reason_code',v_reason,'verification',v_verification
    )
  ) returning * into v_event;

  if v_manifest_found then
    update public.agent_operation_manifests
       set status = 'failed_integrity', verification = v_verification
     where id = v_manifest.id returning * into v_manifest;
  end if;

  -- Steps, result, affected_refs and every writer receipt remain byte-intact.
  update public.agent_operations
     set status = 'abandoned', state_version = state_version + 1,
         missing_fields = '[]'::jsonb, pending_question = null,
         last_operation_transition = v_transition,
         semantic_stall_count = 0,
         last_error = jsonb_build_object(
           'code','failed_quarantined','reason_code',v_reason,
           'manifest_present',v_manifest_found,
           'manifest_id',case when v_manifest_found then v_manifest.id else null end,
           'plan_version',v_plan_version,
           'verified_count',v_verified,'applied_count',v_applied,
           'terminal_count',v_terminal,'verification',v_verification
         ),
         lease_token = null, lease_expires_at = null, completed_at = null
   where id = v_operation and user_id = v_user
   returning * into v_op;

  return jsonb_build_object(
    'outcome','quarantined','replayed',false,'id',v_op.id,
    'status',v_op.status,'state_version',v_op.state_version,
    'plan_version',v_plan_version,
    'manifest_id',case when v_manifest_found then v_manifest.id else null end,
    'manifest_hash',case when v_manifest_found then v_manifest.manifest_hash else null end,
    'verification',v_verification
  );
end;
$$;

alter function public.kipu_quarantine_agent_loop_operation(jsonb) owner to postgres;
revoke all on function public.kipu_quarantine_agent_loop_operation(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_quarantine_agent_loop_operation(jsonb)
  to service_role;

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.kipu_quarantine_agent_loop_operation(jsonb)'::regprocedure
  ) into v_definition;
  if position('manifest-less quarantine requires applying or verifying' in v_definition) = 0
     or position('''user_abandoned''' in v_definition) = 0
     or position('''manifest_present'',v_manifest_found' in v_definition) = 0
     or position('receipt_preserved_count' in v_definition) = 0 then
    raise exception 'KIPU_MIGRATION: 121 manifest-less quarantine topology missing';
  end if;
end;
$migration$;

commit;
