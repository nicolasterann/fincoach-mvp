-- Migracion 112 - M0.11A: una sola autoridad semantica y una sola unidad de
-- autorizacion por operacion.
--
-- PREPARADA, NO APLICADA. Este archivo es append-only. Produccion sigue con
-- 001-111 hasta que la auditoria externa apruebe esta migracion y el caller.
--
-- El esquema anterior guardaba confirmaciones por tool y permitia exactamente
-- una pending por conversacion. Cuatro acciones sensibles se canibalizaban:
-- confirmar una equivalia a perder las otras tres. Esta migracion NO amplifica
-- la autoridad del modelo: reemplaza N propuestas fragmentadas por un
-- manifiesto exacto de la operacion completa y verifica bajo CAS que
-- autorizado = preparado = ejecutado = verificado.

alter table public.agent_operations
  add column if not exists semantic_stall_count integer not null default 0
    check (semantic_stall_count >= 0),
  add column if not exists last_operation_transition jsonb
    check (
      last_operation_transition is null
      or jsonb_typeof(last_operation_transition) = 'object'
    );

create table if not exists public.agent_operation_manifests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null references public.agent_operations(id) on delete cascade,
  plan_version integer not null check (plan_version > 0),
  channel text not null check (channel in ('telegram','web')),
  chat_id text,
  status text not null check (status in (
    'proposed','authorized','executing','verified','rejected','superseded',
    'failed_integrity'
  )),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  proposed_delivery_key text not null,
  authorized_delivery_key text,
  verification jsonb check (verification is null or jsonb_typeof(verification) = 'object'),
  created_at timestamptz not null default now(),
  authorized_at timestamptz,
  executing_at timestamptz,
  verified_at timestamptz,
  unique (operation_id, plan_version),
  constraint agent_operation_manifests_authorized_pair_ck check (
    (status = 'proposed' and authorized_delivery_key is null and authorized_at is null)
    or
    (status <> 'proposed' and status in ('rejected','superseded')
      and (authorized_delivery_key is null) = (authorized_at is null))
    or
    (status in ('authorized','executing','verified','failed_integrity')
      and authorized_delivery_key is not null and authorized_at is not null)
  )
);

-- One proposal for the whole conversation, not one proposal per tool. This
-- preserves the serialization job the old challenge index also performed.
create unique index if not exists agent_operation_manifests_live_uq
  on public.agent_operation_manifests(user_id, channel, coalesce(chat_id,''))
  where status = 'proposed';
create index if not exists agent_operation_manifests_operation_idx
  on public.agent_operation_manifests(operation_id, plan_version desc, created_at desc);

create table if not exists public.agent_operation_transition_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null references public.agent_operations(id) on delete cascade,
  delivery_key text not null,
  transition_kind text not null check (transition_kind in (
    'new','observed','resolved','partially_resolved','insufficient','modified',
    'confirmed','rejected','abandoned','unrelated'
  )),
  target_operation_id uuid references public.agent_operations(id) on delete set null,
  transition jsonb not null check (jsonb_typeof(transition) = 'object'),
  before_state jsonb not null default '{}'::jsonb check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null default '{}'::jsonb check (jsonb_typeof(after_state) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, delivery_key)
);
create index if not exists agent_operation_transition_events_operation_idx
  on public.agent_operation_transition_events(operation_id, created_at, id);

alter table public.agent_operation_manifests enable row level security;
alter table public.agent_operation_transition_events enable row level security;

drop policy if exists agent_operation_manifests_select_own
  on public.agent_operation_manifests;
create policy agent_operation_manifests_select_own
  on public.agent_operation_manifests for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists agent_operation_transition_events_select_own
  on public.agent_operation_transition_events;
create policy agent_operation_transition_events_select_own
  on public.agent_operation_transition_events for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.agent_operation_manifests from public, anon, authenticated;
revoke all on public.agent_operation_transition_events from public, anon, authenticated;
grant select on public.agent_operation_manifests to authenticated, service_role;
grant select on public.agent_operation_transition_events to authenticated, service_role;

create or replace function public.kipu_record_agent_operation_transition(p jsonb)
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
  v_transition jsonb := p->'transition';
  v_kind text := nullif(btrim(v_transition->>'kind'),'');
  v_target uuid := nullif(v_transition->>'target_operation_id','')::uuid;
  v_existing public.agent_operation_transition_events%rowtype;
  v_operation_row public.agent_operations%rowtype;
  v_same_pending boolean := false;
begin
  if v_user is null or v_operation is null or v_expected is null or v_delivery is null
     or jsonb_typeof(v_transition) is distinct from 'object'
     or v_kind not in (
       'new','observed','resolved','partially_resolved','insufficient','modified',
       'confirmed','rejected','abandoned','unrelated'
     )
     or jsonb_typeof(coalesce(v_transition->'consumed_pending_keys','null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(v_transition->'remaining_pending_keys','null'::jsonb)) <> 'array'
     or nullif(btrim(v_transition->>'rationale'),'') is null then
    raise exception 'KIPU_VALIDATION: complete typed operation transition required'
      using errcode = '22023';
  end if;
  select * into v_operation_row
    from public.agent_operations
   where id = v_operation and user_id = v_user
   for update;
  if not found or not exists (
    select 1 from public.agent_operation_deliveries d
     where d.operation_id = v_operation and d.user_id = v_user
       and d.delivery_key = v_delivery
  ) then
    raise exception 'KIPU_OWNERSHIP: transition delivery does not own operation'
      using errcode = '42501';
  end if;
  if v_target is not null and not exists (
    select 1 from public.agent_operations
     where id = v_target and user_id = v_user
  ) then
    raise exception 'KIPU_OWNERSHIP: transition target not owned'
      using errcode = '42501';
  end if;
  select * into v_existing from public.agent_operation_transition_events
   where user_id = v_user and delivery_key = v_delivery;
  if found then
    if v_existing.operation_id <> v_operation
       or v_existing.transition <> v_transition then
      raise exception 'KIPU_DEDUPE_MISMATCH: transition replay changed meaning'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','recorded','id',v_existing.id,'replayed',true,
      'state_version',v_operation_row.state_version
    );
  end if;
  if v_operation_row.state_version <> v_expected then
    raise exception 'KIPU_CONFLICT: transition state version changed'
      using errcode = '22023';
  end if;

  v_same_pending :=
    coalesce(v_operation_row.last_operation_transition->>'kind','') = 'insufficient'
    and coalesce(
      v_operation_row.last_operation_transition->'remaining_pending_keys',
      '[]'::jsonb
    ) = coalesce(v_transition->'remaining_pending_keys','[]'::jsonb);
  if v_kind = 'insufficient' and v_same_pending
     and v_operation_row.semantic_stall_count >= 1 then
    raise exception 'KIPU_LOOP: no structural progress after one clarified retry'
      using errcode = '22023';
  end if;

  insert into public.agent_operation_transition_events(
    user_id,operation_id,delivery_key,transition_kind,target_operation_id,
    transition,before_state,after_state
  ) values (
    v_user,v_operation,v_delivery,v_kind,v_target,v_transition,
    coalesce(p->'before_state','{}'::jsonb),
    coalesce(p->'after_state','{}'::jsonb)
  ) returning * into v_existing;
  update public.agent_operations
     set last_operation_transition = v_transition,
         semantic_stall_count = case
           when v_kind = 'insufficient' and v_same_pending
             then semantic_stall_count + 1
           when v_kind = 'insufficient' then 1
           else 0
         end,
         state_version = state_version + 1
   where id = v_operation
   returning * into v_operation_row;
  return jsonb_build_object(
    'outcome','recorded','id',v_existing.id,'replayed',false,
    'state_version',v_operation_row.state_version
  );
end;
$$;

create or replace function public.kipu_register_agent_operation_manifest(p jsonb)
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
  v_manifest jsonb := p->'manifest';
  v_hash text := nullif(btrim(p->>'manifest_hash'),'');
  v_requires boolean := coalesce((p->>'requires_confirmation')::boolean,false);
  v_transition text := nullif(btrim(p->>'transition_kind'),'');
  v_question text := nullif(btrim(p->>'confirmation_prompt'),'');
  v_op public.agent_operations%rowtype;
  v_row public.agent_operation_manifests%rowtype;
  v_plan_actions jsonb;
  v_action jsonb;
  v_provenance jsonb;
  v_source_delivery text;
  v_source_text text;
  v_fixed public.fixed_expenses%rowtype;
begin
  if v_user is null or v_operation is null or v_expected is null
     or v_plan_version is null or v_delivery is null
     or jsonb_typeof(v_manifest) is distinct from 'object'
     or v_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(coalesce(v_manifest->'actions','null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(v_manifest->'projected_state','null'::jsonb)) <> 'array'
     or coalesce((v_manifest->>'version')::integer,0) <> 1 then
    raise exception 'KIPU_VALIDATION: complete operation manifest required'
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
  if v_op.status <> 'ready' or v_op.plan_version <> v_plan_version then
    raise exception 'KIPU_VALIDATION: only the exact ready plan accepts a manifest'
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
  v_plan_actions := coalesce(v_op.plan->'actions','[]'::jsonb);
  if jsonb_array_length(v_manifest->'actions') <> jsonb_array_length(v_plan_actions)
     or exists (
       select 1
         from jsonb_array_elements(v_manifest->'actions') with ordinality m(value,n)
         full join jsonb_array_elements(v_plan_actions) with ordinality a(value,n)
           using (n)
        where m.value is null or a.value is null
           or m.value->>'action_id' is distinct from a.value->>'id'
           or m.value->>'capability' is distinct from a.value->>'capability'
           or m.value->'arguments' is distinct from a.value->'arguments'
           or m.value->'provenance' is distinct from coalesce(a.value->'provenance','[]'::jsonb)
           or m.value->'atomic_group' is distinct from a.value->'atomic_group'
           or m.value->'depends_on' is distinct from a.value->'depends_on'
           or m.value->'state_witness' is distinct from a.value->'state_witness'
           or m.value->'effects' is distinct from a.value->'effects'
           or m.value->'postconditions' is distinct from a.value->'postconditions'
     ) then
    raise exception 'KIPU_VALIDATION: manifest differs from persisted plan'
      using errcode = '22023';
  end if;

  -- Provenance is verified structurally against durable state. PostgreSQL does
  -- not reinterpret what the user meant: it only proves the exact delivery or
  -- stored row that the planner declared. A new stored/derived source must add
  -- its own locked verifier before it can authorize money.
  for v_action in select value from jsonb_array_elements(v_manifest->'actions')
  loop
    for v_provenance in
      select value from jsonb_array_elements(coalesce(v_action->'provenance','[]'::jsonb))
    loop
      if v_provenance->>'kind' = 'user_stated' then
        if v_provenance->>'source_ref' = 'current_delivery' then
          v_source_delivery := v_delivery;
        elsif v_provenance->>'source_ref' like 'operation_delivery:%' then
          v_source_delivery := substring(v_provenance->>'source_ref' from 20);
        else
          raise exception 'KIPU_VALIDATION: user-stated provenance has no exact delivery'
            using errcode = '22023';
        end if;
        select d.request_text into v_source_text
          from public.agent_operation_deliveries d
         where d.operation_id = v_operation and d.user_id = v_user
           and d.delivery_key = v_source_delivery;
        if not found or nullif(v_provenance->>'quote','') is null
           or position((v_provenance->>'quote') in v_source_text) = 0 then
          raise exception 'KIPU_VALIDATION: user-stated provenance quote is not in its durable delivery'
            using errcode = '22023';
        end if;
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
        raise exception 'KIPU_VALIDATION: derived provenance has no locked verifier'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(
    v_user::text || ':manifest:' || v_op.channel || ':' || coalesce(v_op.chat_id,''),0
  ));
  if v_transition = 'confirmed' then
    raise exception 'KIPU_VALIDATION: confirmation must authorize the persisted manifest, not re-author it'
      using errcode = '22023';
  end if;

  update public.agent_operation_manifests
     set status = 'superseded'
   where user_id = v_user and channel = v_op.channel
     and coalesce(chat_id,'') = coalesce(v_op.chat_id,'') and status = 'proposed';

  insert into public.agent_operation_manifests(
    user_id,operation_id,plan_version,channel,chat_id,status,manifest_hash,
    manifest,proposed_delivery_key,authorized_delivery_key,authorized_at
  ) values (
    v_user,v_operation,v_plan_version,v_op.channel,v_op.chat_id,
    case when not v_requires then 'authorized' else 'proposed' end,
    v_hash,v_manifest,v_delivery,
    case when not v_requires then v_delivery else null end,
    case when not v_requires then now() else null end
  ) returning * into v_row;

  if v_requires then
    if v_question is null then
      raise exception 'KIPU_VALIDATION: sensitive manifest requires a natural confirmation prompt'
        using errcode = '22023';
    end if;
    update public.agent_operations
       set status = 'awaiting_input', state_version = state_version + 1,
           missing_fields = '[]'::jsonb, pending_question = v_question,
           lease_token = null, lease_expires_at = null
     where id = v_operation returning * into v_op;
    return jsonb_build_object(
      'outcome','proposed','manifest_id',v_row.id,'manifest_hash',v_hash,
      'status',v_op.status,'state_version',v_op.state_version,
      'plan_version',v_plan_version,'pending_question',v_question
    );
  end if;
  return jsonb_build_object(
    'outcome','authorized','manifest_id',v_row.id,'manifest_hash',v_hash,
    'status',v_op.status,'state_version',v_op.state_version,
    'plan_version',v_plan_version
  );
end;
$$;

create or replace function public.kipu_authorize_agent_operation_manifest(p jsonb)
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
begin
  if v_user is null or v_operation is null or v_expected is null
     or v_delivery is null or v_lease is null
     or jsonb_typeof(v_transition) is distinct from 'object'
     or v_transition->>'kind' is distinct from 'confirmed'
     or nullif(v_transition->>'target_operation_id','')::uuid is distinct from v_operation
     or jsonb_typeof(coalesce(v_transition->'consumed_pending_keys','null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(v_transition->'remaining_pending_keys','null'::jsonb)) <> 'array'
     or jsonb_array_length(v_transition->'remaining_pending_keys') <> 0
     or nullif(btrim(v_transition->>'rationale'),'') is null then
    raise exception 'KIPU_VALIDATION: an exact confirmed transition is required'
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
  if v_op.status <> 'planning' or v_op.plan is null or v_op.plan_version is null
     or v_op.lease_token <> v_lease or v_op.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: confirmation has no live exact operation lease'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.agent_operation_deliveries d
     where d.operation_id = v_operation and d.user_id = v_user
       and d.delivery_key = v_delivery
  ) then
    raise exception 'KIPU_OWNERSHIP: confirmation delivery does not own operation'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_user::text || ':manifest:' || v_op.channel || ':' || coalesce(v_op.chat_id,''),0
  ));
  select * into v_manifest from public.agent_operation_manifests
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_op.plan_version and status = 'proposed'
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: exact proposed operation manifest is missing'
      using errcode = '22023';
  end if;
  if v_manifest.proposed_delivery_key = v_delivery then
    raise exception 'KIPU_VALIDATION: a manifest cannot authorize itself in its proposal delivery'
      using errcode = '22023';
  end if;

  insert into public.agent_operation_transition_events(
    user_id,operation_id,delivery_key,transition_kind,target_operation_id,
    transition,before_state,after_state
  ) values (
    v_user,v_operation,v_delivery,'confirmed',v_operation,v_transition,
    jsonb_build_object(
      'operation_id',v_operation,'status','awaiting_input',
      'state_version',v_expected - 1,'manifest_hash',v_manifest.manifest_hash
    ),
    jsonb_build_object(
      'operation_id',v_operation,'status','ready',
      'plan_version',v_op.plan_version,'manifest_hash',v_manifest.manifest_hash
    )
  ) on conflict (user_id,delivery_key) do nothing;
  select * into v_event from public.agent_operation_transition_events
   where user_id = v_user and delivery_key = v_delivery;
  if not found or v_event.operation_id <> v_operation
     or v_event.transition <> v_transition then
    raise exception 'KIPU_DEDUPE_MISMATCH: confirmation replay changed meaning'
      using errcode = '22023';
  end if;

  update public.agent_operation_manifests
     set status = 'authorized', authorized_delivery_key = v_delivery,
         authorized_at = now()
   where id = v_manifest.id returning * into v_manifest;
  update public.agent_operations
     set status = 'ready', state_version = state_version + 1,
         missing_fields = '[]'::jsonb, pending_question = null,
         last_operation_transition = v_transition,
         semantic_stall_count = 0,
         lease_token = null, lease_expires_at = null
   where id = v_operation returning * into v_op;

  return jsonb_build_object(
    'outcome','authorized','id',v_op.id,'status',v_op.status,
    'state_version',v_op.state_version,'plan_version',v_op.plan_version,
    'manifest_id',v_manifest.id,'manifest_hash',v_manifest.manifest_hash
  );
end;
$$;

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
  if not found or v_row.status not in ('authorized','executing') then
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
  v_total integer;
  v_actual integer;
  v_settled integer;
  v_verified integer;
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
  select count(*) into v_actual
    from public.agent_operation_steps s
   where s.operation_id = v_operation and s.user_id = v_user
     and s.plan_version = v_plan_version;
  select count(*),
         count(*) filter (where s.status in ('verified','needs_input','refused','failed')),
         count(*) filter (where s.status = 'verified')
    into v_total,v_settled,v_verified
    from public.agent_operation_steps s
   where s.operation_id = v_operation and s.user_id = v_user
     and s.plan_version = v_plan_version
     and exists (
       select 1 from jsonb_array_elements(v_manifest.manifest->'actions') with ordinality a(value,n)
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
  if v_actual <> jsonb_array_length(v_manifest.manifest->'actions')
     or v_total <> v_actual
     or (not v_allow_incomplete and v_verified <> v_total)
     or (v_allow_incomplete and v_settled <> v_total) then
    update public.agent_operation_manifests
       set status = 'failed_integrity',
           verification = jsonb_build_object(
             'authorized_count',jsonb_array_length(v_manifest.manifest->'actions'),
             'actual_count',v_actual,'matching_count',v_total,'settled_count',v_settled,
             'verified_count',v_verified,'allow_incomplete',v_allow_incomplete
           )
     where id = v_manifest.id returning * into v_manifest;
    return jsonb_build_object(
      'outcome','integrity_failed','manifest_id',v_manifest.id,
      'manifest_hash',v_manifest.manifest_hash,
      'verification',v_manifest.verification,
      'reason','KIPU_EFFECT_MISSING: authorized, prepared and executed sets differ'
    );
  end if;
  select jsonb_build_object(
    'authorized_manifest_hash',v_manifest.manifest_hash,
    'authorized_count',jsonb_array_length(v_manifest.manifest->'actions'),
    'actual_count',v_actual,'matching_count',v_total,
    'settled_count',v_settled,'verified_count',v_verified,
    'allow_incomplete',v_allow_incomplete,
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
    'manifest_id',v_manifest.id,'manifest_hash',v_manifest.manifest_hash,
    'verification',v_verification
  );
end;
$$;

alter table public.agent_operation_manifests owner to postgres;
alter table public.agent_operation_transition_events owner to postgres;
alter function public.kipu_record_agent_operation_transition(jsonb) owner to postgres;
alter function public.kipu_register_agent_operation_manifest(jsonb) owner to postgres;
alter function public.kipu_authorize_agent_operation_manifest(jsonb) owner to postgres;
alter function public.kipu_begin_agent_operation_manifest(jsonb) owner to postgres;
alter function public.kipu_verify_agent_operation_manifest(jsonb) owner to postgres;

revoke all on function public.kipu_record_agent_operation_transition(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_register_agent_operation_manifest(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_authorize_agent_operation_manifest(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_begin_agent_operation_manifest(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_verify_agent_operation_manifest(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_record_agent_operation_transition(jsonb)
  to service_role;
grant execute on function public.kipu_register_agent_operation_manifest(jsonb)
  to service_role;
grant execute on function public.kipu_authorize_agent_operation_manifest(jsonb)
  to service_role;
grant execute on function public.kipu_begin_agent_operation_manifest(jsonb)
  to service_role;
grant execute on function public.kipu_verify_agent_operation_manifest(jsonb)
  to service_role;

-- Keep the legacy one-pending index for safe rollback and for any v44 path that
-- has not yet entered a manifest. M0.11A never creates N per-action challenges:
-- it authorizes one operation manifest, so preserving this index also preserves
-- its old concurrency job without reintroducing per-action cannibalization.
