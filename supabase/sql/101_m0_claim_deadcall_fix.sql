-- Migration 101 — M0: la 100 dejó una llamada MUERTA en el claim.
--
-- `jsonb_object_length(jsonb)` NO EXISTE en PostgreSQL. La 100 la usa en
-- `kipu_claim_agent_operation` para comparar el número de versiones observadas
-- contra el número de operaciones bloqueadas, y esa comparación está en el
-- camino de TODO claim nuevo — no sólo el de continuación. Efecto real:
-- reclamar una operación fallaba SIEMPRE con
--   `function jsonb_object_length(jsonb) does not exist`
-- y el agente moría en su primer paso. Lo encontró el E2E contra PostgreSQL
-- real (M100.0ab2), no la lectura del SQL: es exactamente la clase de la 089
-- (text→enum sin cast) y la de K (payload al ledger).
--
-- El reemplazo cuenta claves con `jsonb_object_keys`, que sí existe. Es seguro
-- porque el bloque anterior ya probó `jsonb_typeof(v_expected_versions)='object'`.
--
-- Además normaliza a ASCII el comentario de la línea 127: el paste por el
-- editor SQL convirtió `A→B` en mojibake (`A‚ÜíB`), lo que dejaba la única
-- divergencia byte-a-byte entre el archivo y el catálogo. Es inerte —vive
-- dentro de un comentario— pero un mismatch sin explicar cuesta una auditoría.
--
-- La 100 NO se reescribe: queda como registro de lo que se aplicó. Si alguna
-- vez se vuelve a ejecutar la 100 completa, hay que volver a aplicar esta 101
-- encima.

create or replace function public.kipu_claim_agent_operation(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_key text := nullif(btrim(p->>'operation_key'),'');
  v_channel text := nullif(btrim(p->>'channel'),'');
  v_chat text := nullif(p->>'chat_id','');
  v_message uuid := nullif(p->>'root_message_id','')::uuid;
  v_text text := nullif(btrim(p->>'request_text'),'');
  v_continuation uuid := nullif(p->>'continuation_operation_id','')::uuid;
  v_fingerprint text;
  v_existing public.agent_operations%rowtype;
  v_delivery public.agent_operation_deliveries%rowtype;
  v_id uuid;
  v_lock_id uuid;
  v_lock_ids uuid[] := '{}';
  v_supersede uuid[] := '{}';
  v_abandon uuid[] := '{}';
  v_expected_versions jsonb := coalesce(p->'expected_operation_versions','{}'::jsonb);
  v_close_count integer;
  v_token uuid;
begin
  if v_user is null or v_key is null or v_channel not in ('telegram','web') or v_text is null then
    raise exception 'KIPU_VALIDATION: user, operation key, channel and request text are required'
      using errcode = '22023';
  end if;
  if length(v_key) > 240 or length(v_text) > 12000 then
    raise exception 'KIPU_VALIDATION: operation identity or request is too long'
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p->'supersede_operation_ids','[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p->'abandon_operation_ids','[]'::jsonb)) <> 'array'
     or jsonb_typeof(v_expected_versions) <> 'object' then
    raise exception 'KIPU_VALIDATION: operation closure ids must be arrays and expected versions an object'
      using errcode = '22023';
  end if;
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_supersede
    from jsonb_array_elements_text(coalesce(p->'supersede_operation_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_abandon
    from jsonb_array_elements_text(coalesce(p->'abandon_operation_ids','[]'::jsonb));
  if cardinality(v_supersede) + cardinality(v_abandon) <>
     (select count(distinct id) from unnest(v_supersede || v_abandon) id)
     or v_continuation = any(v_supersede || v_abandon) then
    raise exception 'KIPU_VALIDATION: operation closures overlap or target the continuation'
      using errcode = '22023';
  end if;
  if cardinality(v_supersede) + cardinality(v_abandon) > 20 then
    raise exception 'KIPU_VALIDATION: at most 20 open operations may be closed at once'
      using errcode = '22023';
  end if;
  if v_message is not null and not exists (
    select 1 from public.chat_messages m
     where m.id = v_message and m.user_id = v_user and m.role = 'user'
  ) then
    raise exception 'KIPU_OWNERSHIP: root message does not belong to user'
      using errcode = '42501';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'channel', v_channel,
    'chat_id', v_chat,
    'root_message_id', v_message,
    'request_text', v_text
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || v_key, 0));
  select o.* into v_existing
    from public.agent_operation_deliveries d
    join public.agent_operations o on o.id = d.operation_id
   where d.user_id = v_user and d.delivery_key = v_key
   for update of o;
  if found then
    select * into v_delivery from public.agent_operation_deliveries
     where user_id = v_user and delivery_key = v_key;
    if v_delivery.request_fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: operation key reused for a different request'
        using errcode = '22023';
    end if;
    -- Exact delivery replay is also the worker-recovery boundary. A live
    -- planning/application lease means another worker still owns the turn, so
    -- the caller must not publish a substitute answer. Once the lease expires,
    -- the same immutable delivery may reclaim the SAME operation and replan
    -- from its durable steps; idempotent writers and prior receipts prevent a
    -- second economic event.
    if v_existing.status in ('planning','applying','verifying')
       and v_existing.lease_token is not null
       and v_existing.lease_expires_at > now() then
      return jsonb_build_object(
        'outcome','inflight','id',v_existing.id,'status',v_existing.status,
        'state_version',v_existing.state_version,
        'lease_expires_at',v_existing.lease_expires_at
      );
    end if;
    if v_existing.status in ('planning','ready','applying','verifying','failed_retriable')
       and v_existing.expires_at > now() then
      v_token := gen_random_uuid();
      update public.agent_operations
         set status = 'planning', state_version = state_version + 1,
             lease_token = v_token,
             lease_expires_at = now() + interval '5 minutes',
             last_error = jsonb_build_object(
               'code','worker_recovered',
               'message','The previous worker stopped before publishing a durable result.'
             )
       where id = v_existing.id
       returning * into v_existing;
      return jsonb_build_object(
        'outcome',case when v_existing.plan is null then 'recovered' else 'recovered_plan' end,
        'id',v_existing.id,'status',v_existing.status,
        'state_version',v_existing.state_version,
        'plan_version',v_existing.plan_version,
        'plan',v_existing.plan,'context_coverage',v_existing.context_coverage,
        'result',v_existing.result,
        'pending_question',v_existing.pending_question,
        'missing_fields',v_existing.missing_fields,
        'lease_token',v_token,'lease_expires_at',v_existing.lease_expires_at
      );
    end if;
    return jsonb_build_object(
      'outcome','replayed','id',v_existing.id,'status',v_existing.status,
      'state_version',v_existing.state_version,'expires_at',v_existing.expires_at,
      'plan',v_existing.plan,'result',v_existing.result,
      'pending_question',v_existing.pending_question,
      'missing_fields',v_existing.missing_fields
    );
  end if;

  -- A continuation may supersede/abandon other open operations in the same
  -- claim. Locking the continuation first and the closures later permits the
  -- inverse two-channel race A->B / B->A to deadlock. Acquire every operation
  -- identity in one deterministic order before reading or changing any row.
  v_lock_ids := array_remove(
    array[v_continuation]::uuid[] || v_supersede || v_abandon,
    null
  );
  if (select count(*) from jsonb_object_keys(v_expected_versions)) <> cardinality(v_lock_ids)
     or exists (
       select 1 from unnest(v_lock_ids) item
        where not (v_expected_versions ? item::text)
           or jsonb_typeof(v_expected_versions->item::text) <> 'number'
     ) then
    raise exception 'KIPU_VALIDATION: every targeted operation needs its observed state version'
      using errcode = '22023';
  end if;
  for v_lock_id in
    select distinct item from unnest(v_lock_ids) item order by item
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      v_user::text || ':operation:' || v_lock_id::text, 0
    ));
  end loop;
  perform 1 from public.agent_operations o
   where o.user_id = v_user and o.id = any(v_lock_ids)
   order by o.id for update;
  if exists (
    select 1 from unnest(v_lock_ids) item
    left join public.agent_operations o
      on o.id = item and o.user_id = v_user
    where o.id is null
       or o.state_version <> (v_expected_versions->>item::text)::integer
  ) then
    raise exception 'KIPU_CONFLICT: an operation changed after the planning snapshot'
      using errcode = '22023';
  end if;

  if v_continuation is not null then
    select * into v_existing from public.agent_operations
     where id = v_continuation and user_id = v_user;
    if not found or v_existing.status not in ('awaiting_input','failed_retriable')
       or v_existing.expires_at <= now() then
      raise exception 'KIPU_VALIDATION: continuation is missing, stale or no longer awaiting input'
        using errcode = '22023';
    end if;
    v_id := v_existing.id;
    v_token := gen_random_uuid();
    update public.agent_operations
       set latest_request_text = v_text,
           status = 'planning',
           state_version = state_version + 1,
           lease_token = v_token,
           lease_expires_at = now() + interval '5 minutes',
           completed_at = null,
           expires_at = now() + interval '7 days'
     where id = v_id
     returning * into v_existing;
  else
    v_token := gen_random_uuid();
    insert into public.agent_operations(
      user_id, operation_key, channel, chat_id, root_message_id,
      request_text, latest_request_text, request_fingerprint,
      lease_token, lease_expires_at
    ) values (
      v_user, v_key, v_channel, v_chat, v_message,
      v_text, v_text, v_fingerprint,
      v_token, now() + interval '5 minutes'
    ) returning * into v_existing;
    v_id := v_existing.id;
  end if;

  if cardinality(v_supersede) + cardinality(v_abandon) > 0 then
    perform 1 from public.agent_operations o
     where o.user_id = v_user and o.id = any(v_supersede || v_abandon)
     order by o.id for update;
    select count(*) into v_close_count from public.agent_operations o
     where o.user_id = v_user and o.id = any(v_supersede || v_abandon)
       and o.status in ('planning','awaiting_input','ready','failed_retriable')
       and o.expires_at > now();
    if v_close_count <> cardinality(v_supersede) + cardinality(v_abandon) then
      raise exception 'KIPU_VALIDATION: an operation closure is stale, owned elsewhere or currently applying'
        using errcode = '22023';
    end if;
    update public.agent_operations
       set status = case when id = any(v_supersede) then 'superseded' else 'abandoned' end,
           superseded_by = case when id = any(v_supersede) then v_id else null end,
           state_version = state_version + 1,
           pending_question = null,
           missing_fields = '[]'::jsonb,
           lease_token = null,
           lease_expires_at = null
     where user_id = v_user and id = any(v_supersede || v_abandon);
  end if;

  insert into public.agent_operation_deliveries(
    operation_id,user_id,delivery_key,message_id,channel,chat_id,
    request_text,request_fingerprint
  ) values (
    v_id,v_user,v_key,v_message,v_channel,v_chat,v_text,v_fingerprint
  );

  return jsonb_build_object(
    'outcome',case when v_continuation is null then 'claimed' else 'resumed' end,
    'id',v_id,'status','planning','state_version',v_existing.state_version,
    'lease_token',v_token,'lease_expires_at',v_existing.lease_expires_at
  );
end;
$$;
