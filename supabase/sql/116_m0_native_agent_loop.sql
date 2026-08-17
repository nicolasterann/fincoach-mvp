-- Migration 116 — M0 native tool-calling loop durability.
--
-- PREPARED, NOT APPLIED. Apply only after the pre-application audit explicitly
-- authorizes it. The v44 envelope functions remain untouched. The loop's
-- durable pre-write authority is the staged agent_operation_steps row.

create or replace function public.kipu_stage_agent_loop_step(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_expected integer := nullif(p->>'expected_version','')::integer;
  v_delivery text := nullif(btrim(p->>'delivery_key'),'');
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_seq integer := nullif(p->>'seq','')::integer;
  v_capability text := nullif(btrim(p->>'capability'),'');
  v_args jsonb := p->'arguments';
  v_effect_mode text := nullif(btrim(p->>'effect_mode'),'');
  v_effects jsonb;
  v_plan_version integer;
  v_step_order integer;
  v_step_key text;
  v_op public.agent_operations%rowtype;
  v_step public.agent_operation_steps%rowtype;
  v_must_bump boolean := false;
begin
  if v_user is null or v_operation is null or v_expected is null
     or v_delivery is null or v_lease is null or v_seq is null or v_seq < 0
     or v_seq > 255 or v_capability is null
     or jsonb_typeof(coalesce(v_args,'null'::jsonb)) <> 'object'
     or v_effect_mode not in ('read','domain_state','economic_event','contextual_event') then
    raise exception 'KIPU_VALIDATION: complete typed loop step required'
      using errcode = '22023';
  end if;
  v_effects := case when v_effect_mode = 'economic_event' then
    '[{"kind":"economic_event","source":"capability_catalog"}]'::jsonb
  else '[]'::jsonb end;

  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.agent_operation_deliveries d
     where d.operation_id = v_operation and d.user_id = v_user
       and d.delivery_key = v_delivery
  ) then
    raise exception 'KIPU_OWNERSHIP: loop step delivery does not own operation'
      using errcode = '42501';
  end if;
  if v_op.status not in ('planning','applying')
     or v_op.lease_token <> v_lease or v_op.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: loop staging has no live operation lease'
      using errcode = '22023';
  end if;
  if v_op.plan is not null
     and v_op.plan is distinct from '{"mode":"loop"}'::jsonb then
    raise exception 'KIPU_VALIDATION: loop staging cannot consume an envelope plan'
      using errcode = '22023';
  end if;

  v_plan_version := coalesce(v_op.plan_version,1);
  if v_op.plan_version is not null then
    select exists (
      select 1 from public.agent_operation_manifests m
       where m.operation_id = v_operation and m.user_id = v_user
         and m.plan_version = v_op.plan_version
         and m.status in ('rejected','superseded')
    ) and not exists (
      select 1 from public.agent_operation_manifests m
       where m.operation_id = v_operation and m.user_id = v_user
         and m.plan_version = v_op.plan_version
         and m.status = 'proposed'
    ) into v_must_bump;
    if v_must_bump then
      v_plan_version := v_op.plan_version + 1;
    end if;
  end if;
  v_step_key := format(
    'loop:v%s:%s:%s',
    v_plan_version,
    substr(encode(extensions.digest(v_delivery,'sha256'),'hex'),1,20),
    v_seq
  );

  -- Exact replay is checked before CAS so a worker that lost the response to
  -- its own insert can recover the staged row without re-authoring the call.
  select * into v_step from public.agent_operation_steps
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_plan_version and step_key = v_step_key;
  if found then
    if v_step.capability is distinct from v_capability
       or v_step.arguments_fingerprint is distinct from md5(v_args::text)
       or v_step.arguments is distinct from v_args
       or v_step.effects is distinct from v_effects then
      raise exception 'KIPU_DEDUPE_MISMATCH: loop staging replay changed payload'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed','id',v_op.id,'status',v_op.status,
      'state_version',v_op.state_version,'plan_version',v_step.plan_version,
      'step_key',v_step.step_key,'step_order',v_step.step_order,
      'step_status',v_step.status,'capability',v_step.capability,
      'arguments',v_step.arguments,'effects',v_step.effects,
      'result',v_step.result,'affected_refs',v_step.affected_refs
    );
  end if;
  -- A crash may commit the staged row and lose the generated step_key before
  -- register. The durable identity is the exact call in this plan version,
  -- not the delivery-local sequence that happened to name it.
  select * into v_step from public.agent_operation_steps
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_plan_version and status = 'preflighted'
     and capability = v_capability
     and arguments_fingerprint = md5(v_args::text)
   order by step_order
   limit 1;
  if found then
    if v_step.arguments is distinct from v_args
       or v_step.effects is distinct from v_effects then
      raise exception 'KIPU_DEDUPE_MISMATCH: loop staging identity changed payload'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed','id',v_op.id,'status',v_op.status,
      'state_version',v_op.state_version,'plan_version',v_step.plan_version,
      'step_key',v_step.step_key,'step_order',v_step.step_order,
      'step_status',v_step.status,'capability',v_step.capability,
      'arguments',v_step.arguments,'effects',v_step.effects,
      'result',v_step.result,'affected_refs',v_step.affected_refs
    );
  end if;
  if v_op.state_version <> v_expected then
    return jsonb_build_object(
      'outcome','conflict','id',v_op.id,'status',v_op.status,
      'state_version',v_op.state_version
    );
  end if;
  if exists (
    select 1 from public.agent_operation_manifests m
     where m.operation_id = v_operation and m.user_id = v_user
       and m.plan_version = v_plan_version
       and m.status in ('proposed','authorized','executing','verified')
  ) then
    raise exception 'KIPU_VALIDATION: current loop manifest no longer accepts staging'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.agent_operation_steps prior
     where prior.operation_id = v_operation and prior.user_id = v_user
       and prior.status in ('applied','verified')
       and prior.result->>'execution_effect' in ('write','noop')
       and (
         prior.step_key = v_step_key
         or (
           prior.capability = v_capability
           and prior.arguments_fingerprint = md5(v_args::text)
         )
       )
  ) then
    raise exception 'KIPU_VALIDATION: loop continuation repeats an already-settled side effect'
      using errcode = '22023';
  end if;
  select coalesce(max(step_order),0) + 1 into v_step_order
    from public.agent_operation_steps where operation_id = v_operation;
  insert into public.agent_operation_steps(
    operation_id,user_id,plan_version,step_order,step_key,step_type,
    capability,atomic_group,depends_on,status,arguments,
    arguments_fingerprint,state_witness,effects,postconditions,preflighted_at
  ) values (
    v_operation,v_user,v_plan_version,v_step_order,v_step_key,'tool_call',
    v_capability,null,'{}'::text[],'preflighted',v_args,
    md5(v_args::text),'{}'::jsonb,v_effects,'[]'::jsonb,now()
  ) returning * into v_step;
  update public.agent_operations
     set status = 'applying', state_version = state_version + 1,
         plan_version = v_plan_version, plan = '{"mode":"loop"}'::jsonb,
         context_coverage = coalesce(context_coverage,'{}'::jsonb),
         missing_fields = '[]'::jsonb, pending_question = null,
         validated_at = coalesce(validated_at,now())
   where id = v_operation returning * into v_op;
  return jsonb_build_object(
    'outcome','staged','id',v_op.id,'status',v_op.status,
    'state_version',v_op.state_version,'plan_version',v_step.plan_version,
    'step_key',v_step.step_key,'step_order',v_step.step_order,
    'step_status',v_step.status,'capability',v_step.capability,
    'arguments',v_step.arguments,'effects',v_step.effects,
    'result',v_step.result,'affected_refs',v_step.affected_refs
  );
end;
$$;

create or replace function public.kipu_register_agent_loop_manifest(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_expected integer := nullif(p->>'expected_version','')::integer;
  v_delivery text := nullif(btrim(p->>'delivery_key'),'');
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_keys jsonb := p->'step_keys';
  v_question text := nullif(btrim(p->>'confirmation_prompt'),'');
  v_op public.agent_operations%rowtype;
  v_row public.agent_operation_manifests%rowtype;
  v_manifest jsonb;
  v_actions jsonb;
  v_hash text;
  v_requested_count integer;
  v_staged_count integer;
begin
  if v_user is null or v_operation is null or v_expected is null
     or v_delivery is null or v_lease is null or v_question is null
     or jsonb_typeof(coalesce(v_keys,'null'::jsonb)) <> 'array'
     or jsonb_array_length(v_keys) = 0
     or exists (
       select 1 from jsonb_array_elements(v_keys) item
        where jsonb_typeof(item) <> 'string' or nullif(btrim(item#>>'{}'),'') is null
     ) then
    raise exception 'KIPU_VALIDATION: exact staged step set and natural question required'
      using errcode = '22023';
  end if;
  select count(*), count(distinct item#>>'{}')
    into v_requested_count,v_staged_count from jsonb_array_elements(v_keys) item;
  if v_requested_count <> v_staged_count then
    raise exception 'KIPU_VALIDATION: loop manifest step keys must be unique'
      using errcode = '22023';
  end if;

  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_op.state_version <> v_expected then
    return jsonb_build_object(
      'outcome','conflict','id',v_op.id,'status',v_op.status,
      'state_version',v_op.state_version
    );
  end if;
  if v_op.status <> 'applying' or v_op.plan is distinct from '{"mode":"loop"}'::jsonb
     or v_op.plan_version is null or v_op.lease_token <> v_lease
     or v_op.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: loop manifest has no live staged operation lease'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.agent_operation_deliveries d
     where d.operation_id = v_operation and d.user_id = v_user
       and d.delivery_key = v_delivery
  ) then
    raise exception 'KIPU_OWNERSHIP: manifest delivery does not own operation'
      using errcode = '42501';
  end if;

  select count(*) into v_staged_count from public.agent_operation_steps s
   where s.operation_id = v_operation and s.user_id = v_user
     and s.plan_version = v_op.plan_version and s.status = 'preflighted';
  if v_staged_count <> v_requested_count or exists (
    select 1 from public.agent_operation_steps s
     where s.operation_id = v_operation and s.user_id = v_user
       and s.plan_version = v_op.plan_version and s.status = 'preflighted'
       and not exists (
         select 1 from jsonb_array_elements_text(v_keys) requested(step_key)
          where requested.step_key = s.step_key
       )
  ) or exists (
    select 1 from jsonb_array_elements_text(v_keys) requested(step_key)
     where not exists (
       select 1 from public.agent_operation_steps s
        where s.operation_id = v_operation and s.user_id = v_user
          and s.plan_version = v_op.plan_version and s.status = 'preflighted'
          and s.step_key = requested.step_key
     )
  ) then
    raise exception 'KIPU_VALIDATION: manifest must equal the complete staged step set'
      using errcode = '22023';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'ordinal',s.step_order,
      'action_id',s.step_key,
      'capability',s.capability,
      'arguments',s.arguments,
      'state_witness',s.state_witness,
      'effects',s.effects,
      'postconditions',s.postconditions,
      'atomic_group',to_jsonb(s.atomic_group)
    ) order by s.step_order
  ) into v_actions
    from public.agent_operation_steps s
   where s.operation_id = v_operation and s.user_id = v_user
     and s.plan_version = v_op.plan_version and s.status = 'preflighted';
  v_manifest := jsonb_build_object(
    'version',1,
    'kind','loop_staged',
    'execution_policy','independent',
    'actions',coalesce(v_actions,'[]'::jsonb)
  );
  v_hash := encode(extensions.digest(v_manifest::text,'sha256'),'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    v_user::text || ':manifest:' || v_op.channel || ':' || coalesce(v_op.chat_id,''),0
  ));
  update public.agent_operation_manifests
     set status = 'superseded'
   where user_id = v_user and channel = v_op.channel
     and coalesce(chat_id,'') = coalesce(v_op.chat_id,'') and status = 'proposed';
  insert into public.agent_operation_manifests(
    user_id,operation_id,plan_version,channel,chat_id,status,manifest_hash,
    manifest,proposed_delivery_key
  ) values (
    v_user,v_operation,v_op.plan_version,v_op.channel,v_op.chat_id,'proposed',
    v_hash,v_manifest,v_delivery
  ) returning * into v_row;
  update public.agent_operations
     set status = 'awaiting_input', state_version = state_version + 1,
         missing_fields = '[]'::jsonb, pending_question = v_question,
         lease_token = null, lease_expires_at = null
   where id = v_operation returning * into v_op;
  return jsonb_build_object(
    'outcome','proposed','manifest_id',v_row.id,'manifest_hash',v_hash,
    'status',v_op.status,'state_version',v_op.state_version,
    'plan_version',v_op.plan_version,'pending_question',v_question,
    'manifest',v_manifest
  );
end;
$$;

create or replace function public.kipu_reject_agent_operation_manifest(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_expected integer := nullif(p->>'expected_version','')::integer;
  v_delivery text := nullif(btrim(p->>'delivery_key'),'');
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_transition jsonb := p->'transition';
  v_op public.agent_operations%rowtype;
  v_manifest public.agent_operation_manifests%rowtype;
  v_event public.agent_operation_transition_events%rowtype;
  v_refused integer;
begin
  if v_user is null or v_operation is null or v_expected is null
     or v_delivery is null or v_lease is null
     or jsonb_typeof(coalesce(v_transition,'null'::jsonb)) <> 'object'
     or v_transition->>'kind' is distinct from 'rejected'
     or nullif(v_transition->>'target_operation_id','')::uuid is distinct from v_operation
     or jsonb_typeof(coalesce(v_transition->'consumed_pending_keys','null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(v_transition->'remaining_pending_keys','null'::jsonb)) <> 'array'
     or jsonb_array_length(v_transition->'remaining_pending_keys') <> 0
     or nullif(btrim(v_transition->>'rationale'),'') is null then
    raise exception 'KIPU_VALIDATION: an exact rejected transition is required'
      using errcode = '22023';
  end if;

  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  select * into v_event from public.agent_operation_transition_events
   where user_id = v_user and delivery_key = v_delivery;
  if found then
    if v_event.operation_id <> v_operation or v_event.transition <> v_transition then
      raise exception 'KIPU_DEDUPE_MISMATCH: rejection replay changed meaning'
        using errcode = '22023';
    end if;
    select * into v_manifest from public.agent_operation_manifests
     where operation_id = v_operation and user_id = v_user
       and manifest_hash = v_event.before_state->>'manifest_hash';
    if not found or v_manifest.status <> 'rejected' then
      raise exception 'KIPU_DEDUPE_MISMATCH: rejection event has no rejected manifest'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','rejected','replayed',true,'id',v_op.id,'status',v_op.status,
      'state_version',v_op.state_version,'plan_version',v_manifest.plan_version,
      'manifest_id',v_manifest.id,'manifest_hash',v_manifest.manifest_hash
    );
  end if;
  if v_op.state_version <> v_expected then
    return jsonb_build_object(
      'outcome','conflict','id',v_op.id,'status',v_op.status,
      'state_version',v_op.state_version
    );
  end if;
  if v_op.status <> 'planning' or v_op.plan is distinct from '{"mode":"loop"}'::jsonb
     or v_op.plan_version is null or v_op.lease_token <> v_lease
     or v_op.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: rejection has no live loop operation lease'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.agent_operation_deliveries d
     where d.operation_id = v_operation and d.user_id = v_user
       and d.delivery_key = v_delivery
  ) then
    raise exception 'KIPU_OWNERSHIP: rejection delivery does not own operation'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_user::text || ':manifest:' || v_op.channel || ':' || coalesce(v_op.chat_id,''),0
  ));
  select * into v_manifest from public.agent_operation_manifests
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_op.plan_version and status = 'proposed' for update;
  if not found then
    raise exception 'KIPU_VALIDATION: exact proposed loop manifest is missing'
      using errcode = '22023';
  end if;
  if v_manifest.manifest->>'kind' is distinct from 'loop_staged' then
    raise exception 'KIPU_VALIDATION: reject_operation only accepts loop_staged manifests'
      using errcode = '22023';
  end if;
  if v_manifest.proposed_delivery_key = v_delivery then
    raise exception 'KIPU_VALIDATION: a manifest cannot reject itself in its proposal delivery'
      using errcode = '22023';
  end if;

  insert into public.agent_operation_transition_events(
    user_id,operation_id,delivery_key,transition_kind,target_operation_id,
    transition,before_state,after_state
  ) values (
    v_user,v_operation,v_delivery,'rejected',v_operation,v_transition,
    jsonb_build_object(
      'operation_id',v_operation,'status','awaiting_input',
      'state_version',v_expected - 1,'manifest_hash',v_manifest.manifest_hash
    ),
    jsonb_build_object(
      'operation_id',v_operation,'status','planning',
      'plan_version',v_op.plan_version,'manifest_hash',v_manifest.manifest_hash
    )
  ) returning * into v_event;
  update public.agent_operation_manifests set status = 'rejected'
   where id = v_manifest.id returning * into v_manifest;
  update public.agent_operation_steps s set status = 'refused',
         error = jsonb_build_object('reason','manifest_rejected'),
         updated_at = now()
   where s.operation_id = v_operation and s.user_id = v_user
     and s.plan_version = v_op.plan_version and s.status = 'preflighted'
     and exists (
       select 1 from jsonb_array_elements(v_manifest.manifest->'actions') action
        where action->>'action_id' = s.step_key
     );
  get diagnostics v_refused = row_count;
  if v_refused <> jsonb_array_length(v_manifest.manifest->'actions') then
    raise exception 'KIPU_EFFECT_MISSING: rejection did not refuse every staged action'
      using errcode = '22023';
  end if;
  update public.agent_operations
     set status = 'planning', state_version = state_version + 1,
         missing_fields = '[]'::jsonb, pending_question = null,
         last_operation_transition = v_transition, semantic_stall_count = 0
   where id = v_operation returning * into v_op;
  return jsonb_build_object(
    'outcome','rejected','replayed',false,'id',v_op.id,'status',v_op.status,
    'state_version',v_op.state_version,'plan_version',v_op.plan_version,
    'manifest_id',v_manifest.id,'manifest_hash',v_manifest.manifest_hash
  );
end;
$$;

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
    raise exception 'KIPU_EFFECT_MISSING: economic loop step lacks owned transaction receipts'
      using errcode = '22023';
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

create or replace function public.kipu_verify_agent_loop_manifest(p jsonb)
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
  v_op public.agent_operations%rowtype;
  v_manifest public.agent_operation_manifests%rowtype;
  v_authorized integer;
  v_matching integer;
  v_verified integer;
  v_inflight integer;
  v_outside_economic integer;
  v_verification jsonb;
begin
  if v_user is null or v_operation is null or v_plan_version is null or v_lease is null then
    raise exception 'KIPU_VALIDATION: complete loop manifest verification required'
      using errcode = '22023';
  end if;
  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_op.status <> 'verifying' or v_op.plan is distinct from '{"mode":"loop"}'::jsonb
     or v_op.plan_version <> v_plan_version or v_op.lease_token <> v_lease
     or v_op.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: loop manifest verification has no live exact lease'
      using errcode = '22023';
  end if;
  select * into v_manifest from public.agent_operation_manifests
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_plan_version for update;
  if not found or v_manifest.manifest->>'kind' is distinct from 'loop_staged' then
    raise exception 'KIPU_VALIDATION: loop_staged manifest is missing'
      using errcode = '22023';
  end if;
  if v_manifest.status = 'verified' then
    return jsonb_build_object(
      'outcome','verified','replayed',true,'manifest_id',v_manifest.id,
      'manifest_hash',v_manifest.manifest_hash,'verification',v_manifest.verification
    );
  end if;
  if v_manifest.status <> 'executing' or v_manifest.authorized_at is null then
    raise exception 'KIPU_VALIDATION: loop manifest is not executing'
      using errcode = '22023';
  end if;
  v_authorized := jsonb_array_length(coalesce(v_manifest.manifest->'actions','[]'::jsonb));
  select count(*), count(*) filter (where s.status = 'verified')
    into v_matching,v_verified
    from jsonb_array_elements(v_manifest.manifest->'actions') action
    join public.agent_operation_steps s
      on s.operation_id = v_operation and s.user_id = v_user
     and s.plan_version = v_plan_version
     and s.step_key = action->>'action_id'
     and s.step_order = (action->>'ordinal')::integer
     and s.capability is not distinct from action->>'capability'
     and s.arguments is not distinct from action->'arguments'
     and s.state_witness is not distinct from action->'state_witness'
     and (
       s.effects is not distinct from action->'effects'
       or s.effects is not distinct from (
         action->'effects' || '[{"kind":"economic_event","source":"receipt"}]'::jsonb
       )
     )
     and s.postconditions is not distinct from action->'postconditions'
     and coalesce(to_jsonb(s.atomic_group),'null'::jsonb)
       is not distinct from action->'atomic_group';
  select count(*) into v_inflight from public.agent_operation_steps s
   where s.operation_id = v_operation and s.user_id = v_user
     and s.status in ('preflighted','applying');
  select count(*) into v_outside_economic from public.agent_operation_steps s
   where s.operation_id = v_operation and s.user_id = v_user
     and s.created_at > v_manifest.authorized_at
     and exists (
       select 1 from jsonb_array_elements(s.effects) effect
        where effect->>'kind' = 'economic_event'
     )
     and not exists (
       select 1 from jsonb_array_elements(v_manifest.manifest->'actions') action
        where action->>'action_id' = s.step_key
     );
  if v_authorized = 0 or v_matching <> v_authorized or v_verified <> v_authorized
     or v_inflight <> 0 or v_outside_economic <> 0 then
    raise exception 'KIPU_EFFECT_MISMATCH: scoped loop manifest parity failed'
      using errcode = '22023';
  end if;
  v_verification := jsonb_build_object(
    'kind','loop_staged','allow_incomplete',false,
    'authorized_count',v_authorized,'matching_count',v_matching,
    'verified_count',v_verified,'inflight_count',v_inflight,
    'outside_economic_count',v_outside_economic,'verified_at',now()
  );
  update public.agent_operation_manifests
     set status = 'verified', verification = v_verification,
         verified_at = coalesce(verified_at,now())
   where id = v_manifest.id returning * into v_manifest;
  return jsonb_build_object(
    'outcome','verified','replayed',false,'manifest_id',v_manifest.id,
    'manifest_hash',v_manifest.manifest_hash,'verification',v_verification
  );
end;
$$;

-- Additive replacement of migration 108's economic predicate. The exact
-- capability-catalog marker makes a crashed economic writer fail closed even
-- when its transaction receipt never reached the step row.
create or replace function public.kipu__agent_step_is_reversible_money_write(
  p_result jsonb,
  p_effects jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_temp
as $fn$
  select
    coalesce(p_result->>'execution_effect','') = 'write'
    and jsonb_typeof(coalesce(p_effects,'[]'::jsonb)) = 'array'
    and exists (
      select 1
        from jsonb_array_elements(coalesce(p_effects,'[]'::jsonb)) effect
       where (
         effect->>'classification' in (
           'expense','income','debt_proceeds','receivable_advance',
           'receivable_repayment','capital_return_unrecorded','refund',
           'transfer','payment','reversal','balance_adjustment'
         )
         and effect->>'surface' in (
           'cash','debt_liability','receivable','income_recognition',
           'expense_recognition','goal_balance','asset_value'
         )
       ) or (
         effect->>'kind' = 'economic_event'
         and effect->>'source' in ('capability_catalog','receipt')
       )
    );
$fn$;

-- Refuse a partial migration or a future consumer that bypasses the shared
-- predicate. Migration 108 established exactly three reverse-function calls
-- plus one diagnostic consumer; 116 keeps that topology and expands the one
-- predicate they all share.
do $$
declare
  v_reverse text;
  v_gaps text;
  v_helper text;
  v_helper_call text := 'public.kipu__agent_step_is_reversible_money_write(s.result,s.effects)';
  v_gap_call text := 'public.kipu__agent_operation_receipt_gaps(v_target,v_target_is_correction)';
begin
  select pg_get_functiondef('public.kipu_reverse_agent_operation(jsonb)'::regprocedure)
    into v_reverse;
  select pg_get_functiondef('public.kipu__agent_operation_receipt_gaps(uuid,boolean)'::regprocedure)
    into v_gaps;
  select pg_get_functiondef('public.kipu__agent_step_is_reversible_money_write(jsonb,jsonb)'::regprocedure)
    into v_helper;
  if (
       length(v_reverse) - length(replace(v_reverse,v_helper_call,''))
     ) / length(v_helper_call) <> 3
     or (
       length(v_reverse) - length(replace(v_reverse,v_gap_call,''))
     ) / length(v_gap_call) <> 1
     or (
       length(v_gaps) - length(replace(v_gaps,v_helper_call,''))
     ) / length(v_helper_call) <> 1
     or position('effect->>''kind'' = ''economic_event''' in v_helper) = 0
     or position('''capability_catalog''' in v_helper) = 0
     or position('''receipt''' in v_helper) = 0 then
    raise exception 'KIPU_MIGRATION: economic marker is not shared by every undo consumer';
  end if;
end;
$$;

alter function public.kipu_stage_agent_loop_step(jsonb) owner to postgres;
alter function public.kipu_register_agent_loop_manifest(jsonb) owner to postgres;
alter function public.kipu_reject_agent_operation_manifest(jsonb) owner to postgres;
alter function public.kipu_verify_agent_loop_step(jsonb) owner to postgres;
alter function public.kipu_verify_agent_loop_manifest(jsonb) owner to postgres;
alter function public.kipu__agent_step_is_reversible_money_write(jsonb,jsonb) owner to postgres;

revoke all on function public.kipu_stage_agent_loop_step(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_register_agent_loop_manifest(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_reject_agent_operation_manifest(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_verify_agent_loop_step(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_verify_agent_loop_manifest(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu__agent_step_is_reversible_money_write(jsonb,jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.kipu_stage_agent_loop_step(jsonb) to service_role;
grant execute on function public.kipu_register_agent_loop_manifest(jsonb) to service_role;
grant execute on function public.kipu_reject_agent_operation_manifest(jsonb) to service_role;
grant execute on function public.kipu_verify_agent_loop_step(jsonb) to service_role;
grant execute on function public.kipu_verify_agent_loop_manifest(jsonb) to service_role;
