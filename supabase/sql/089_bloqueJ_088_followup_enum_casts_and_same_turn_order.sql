-- Kipu — Bloque J. Corrección de la 088, que ya está APLICADA y por lo tanto
-- no se reescribe: se corrige con esta.
--
-- Dos defectos que sólo aparecieron EJECUTANDO, no leyendo:
--
-- 1. `kipu_create_account_idempotent` y `kipu_create_debt_account_idempotent`
--    estaban MUERTAS. Ambas declaran `v_type text` y lo insertan en
--    `accounts.type` / `debt_accounts.type`, que son enums (`account_type`,
--    `debt_account_type`). PL/pgSQL no castea implícitamente text→enum en un
--    INSERT, así que TODA llamada abortaba con 42804 y
--    `createAgentInstrumentWith` la convertía en `{ok:false}`: crear cuenta y
--    crear tarjeta desde el agente no funcionaban en absoluto. Es el mismo
--    defecto de clase que el pago multifuente de J-8 («adjustment must not set
--    debt/goal»): una migración puede leerse perfecta y estar muerta.
--
-- 2. En `kipu_claim_agent_action_challenge`, la comprobación de adyacencia
--    conversacional —que CANCELA la propuesta— corría ANTES de la comprobación
--    de auto-confirmación. Que una entrega intente confirmarse a sí misma es un
--    error del MODELO, no una señal de que la conversación siguió: una
--    redelivery tardía del turno que propuso (webhook de Telegram reintentado,
--    submit web reenviado) llegaba después del «sí» del usuario, veía ese «sí»
--    como turno intermedio y cancelaba la propuesta viva. El «sí» legítimo
--    recibía entonces `missing`. `same_turn` es una propiedad determinista de
--    la fila (originating_operation_id = la entrega actual) y no reclama nada,
--    así que evaluarla primero no debilita ninguna barrera y quita ese modo de
--    fallo. El resto de la función es idéntico a la 088.

begin;

create or replace function public.kipu_create_account_idempotent(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_name text := left(nullif(btrim(p->>'name'),''),120);
  v_type text := nullif(p->>'type','');
  v_currency text := upper(nullif(btrim(p->>'currency'),''));
  v_base_currency text := upper(nullif(btrim(p->>'base_currency'),''));
  v_original numeric := nullif(p->>'current_balance_original','')::numeric;
  v_base numeric := nullif(p->>'current_balance_base','')::numeric;
  v_fingerprint text;
  v_existing public.agent_instrument_applications%rowtype;
  v_id uuid;
begin
  if v_user is null or v_dedupe is null or v_name is null
     or v_type not in ('bank','cash','wallet')
     or v_currency !~ '^[A-Z]{3}$'
     or v_base_currency !~ '^[A-Z]{3}$'
     or v_original is null or v_base is null then
    raise exception 'KIPU_VALIDATION: invalid account creation'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;
  v_fingerprint := md5(concat_ws(
    '|',lower(v_name),v_type,v_currency,v_base_currency,
    round(v_original,2)::text,round(v_base,2)::text
  ));
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_dedupe,0)
  );
  select * into v_existing
    from public.agent_instrument_applications
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  if found then
    if v_existing.action <> 'create_account'
       or v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: account creation payload changed'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed','account_id',v_existing.entity_id
    );
  end if;
  perform public.kipu__verify_agent_opening_balance(
    v_user,v_currency,v_base_currency,v_original,v_base
  );
  insert into public.accounts (
    user_id,name,type,currency,current_balance_original,current_balance_base,
    is_goal_account,liquidity
  ) values (
    v_user,v_name,v_type::public.account_type,v_currency,
    round(v_original,2),round(v_base,2),
    false,'liquid'
  ) returning id into v_id;
  insert into public.agent_instrument_applications (
    user_id,action,dedupe_key,fingerprint,entity_id
  ) values (
    v_user,'create_account',v_dedupe,v_fingerprint,v_id
  );
  return jsonb_build_object('outcome','created','account_id',v_id);
end;
$$;

create or replace function public.kipu_create_debt_account_idempotent(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_name text := left(nullif(btrim(p->>'name'),''),120);
  v_type text := nullif(p->>'type','');
  v_currency text := upper(nullif(btrim(p->>'currency'),''));
  v_base_currency text := upper(nullif(btrim(p->>'base_currency'),''));
  v_original numeric := nullif(p->>'current_balance_original','')::numeric;
  v_base numeric := nullif(p->>'current_balance_base','')::numeric;
  v_minimum numeric := nullif(p->>'minimum_payment','')::numeric;
  v_full numeric := nullif(p->>'full_payment_due','')::numeric;
  v_due integer := nullif(p->>'due_day','')::integer;
  v_cutoff integer := nullif(p->>'cutoff_day','')::integer;
  v_fingerprint text;
  v_existing public.agent_instrument_applications%rowtype;
  v_id uuid;
begin
  if v_user is null or v_dedupe is null or v_name is null
     or v_type not in ('credit_card','loan','family_debt','other_debt')
     or v_currency !~ '^[A-Z]{3}$'
     or v_base_currency !~ '^[A-Z]{3}$'
     or v_original is null or v_base is null
     or (v_minimum is not null and v_minimum < 0)
     or (v_full is not null and v_full < 0)
     or (v_due is not null and (v_due < 1 or v_due > 31))
     or (v_cutoff is not null and (v_cutoff < 1 or v_cutoff > 31)) then
    raise exception 'KIPU_VALIDATION: invalid debt creation'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;
  v_fingerprint := md5(concat_ws(
    '|',lower(v_name),v_type,v_currency,v_base_currency,
    round(v_original,2)::text,round(v_base,2)::text,
    coalesce(round(v_minimum,2)::text,''),
    coalesce(round(v_full,2)::text,''),
    coalesce(v_due::text,''),coalesce(v_cutoff::text,'')
  ));
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_dedupe,0)
  );
  select * into v_existing
    from public.agent_instrument_applications
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  if found then
    if v_existing.action <> 'create_debt'
       or v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: debt creation payload changed'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed','debt_account_id',v_existing.entity_id
    );
  end if;
  perform public.kipu__verify_agent_opening_balance(
    v_user,v_currency,v_base_currency,v_original,v_base
  );
  insert into public.debt_accounts (
    user_id,name,type,currency,current_balance_original,current_balance_base,
    minimum_payment,full_payment_due,due_day,cutoff_day
  ) values (
    v_user,v_name,v_type::public.debt_account_type,v_currency,
    round(v_original,2),round(v_base,2),
    case when v_minimum is null then null else round(v_minimum,2) end,
    case when v_full is null then null else round(v_full,2) end,
    v_due,v_cutoff
  ) returning id into v_id;
  insert into public.agent_instrument_applications (
    user_id,action,dedupe_key,fingerprint,entity_id
  ) values (
    v_user,'create_debt',v_dedupe,v_fingerprint,v_id
  );
  return jsonb_build_object('outcome','created','debt_account_id',v_id);
end;
$$;

create or replace function public.kipu_claim_agent_action_challenge(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_channel text := nullif(p->>'channel','');
  v_chat text := nullif(p->>'chat_id','');
  v_tool text := nullif(btrim(p->>'tool_name'),'');
  v_hash text := lower(coalesce(p->>'payload_hash',''));
  v_operation text := nullif(btrim(p->>'operation_id'),'');
  v_message_operation text;
  v_row public.agent_action_challenges%rowtype;
begin
  if v_user is null
     or v_channel not in ('web','telegram')
     or v_tool is null
     or v_hash !~ '^[a-f0-9]{64}$'
     or v_operation is null
  then
    raise exception 'KIPU_VALIDATION: invalid agent action confirmation'
      using errcode = '22023';
  end if;
  v_message_operation :=
    public.kipu__agent_user_message_operation_key(v_operation);
  if v_message_operation is null then
    raise exception 'KIPU_VALIDATION: unrecognized confirmation delivery'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_user::text || '|' || v_channel || '|' || coalesce(v_chat,''),
    0
  ));

  select *
    into v_row
    from public.agent_action_challenges
   where user_id = v_user
     and channel = v_channel
     and chat_id is not distinct from v_chat
     and tool_name = v_tool
     and (
       (status = 'pending' and expires_at > now())
       or
       (status = 'confirmed' and confirmed_operation_id = v_operation)
     )
   order by (status = 'pending') desc, created_at desc
   limit 1
   for update;

  if not found then
    return jsonb_build_object('outcome','missing','claimed',false);
  end if;

  -- 089: PRIMERO. Un modelo que propone y confirma en la MISMA entrega es un
  -- error del modelo, no una conversación que siguió. Evaluarlo después de la
  -- adyacencia hacía que una redelivery tardía de ese mismo turno CANCELARA la
  -- propuesta viva que el usuario estaba a punto de confirmar. No reclama nada,
  -- así que adelantarlo no debilita ninguna barrera.
  if v_row.originating_operation_id = v_operation then
    return jsonb_build_object(
      'outcome','same_turn',
      'claimed',false,
      'challenge_id',v_row.id,
      'payload',v_row.payload
    );
  end if;

  -- A confirmation is valid only as the next USER delivery after the proposal.
  -- The current confirmation row is already durable when the agent runs, so
  -- exclude its exact operation key and reject any other user turn committed
  -- after the challenge. This closes both the bare-confirmation fast path and
  -- a model-selected confirm=true call.
  if exists (
    select 1
      from public.chat_messages m
     where m.user_id = v_user
       and m.channel = v_channel
       and m.chat_id is not distinct from v_chat
       and m.role = 'user'
       and m.created_at > v_row.created_at
       and m.operation_key is distinct from v_message_operation
  ) then
    update public.agent_action_challenges
       set status = 'cancelled', updated_at = now()
     where id = v_row.id and status = 'pending';
    return jsonb_build_object(
      'outcome','stale_conversation',
      'claimed',false,
      'challenge_id',v_row.id
    );
  end if;

  if v_row.status = 'confirmed' then
    return jsonb_build_object(
      'outcome',
      case
        when v_row.confirmed_operation_id = v_operation then 'replay'
        else 'already_consumed'
      end,
      'claimed',v_row.confirmed_operation_id = v_operation,
      'challenge_id',v_row.id,
      'payload',v_row.payload
    );
  end if;

  update public.agent_action_challenges
     set status = 'confirmed',
         confirmed_operation_id = v_operation,
         confirmed_at = now(),
         updated_at = now()
   where id = v_row.id;

  return jsonb_build_object(
    'outcome','claimed',
    'claimed',true,
    'challenge_id',v_row.id,
    'payload',v_row.payload
  );
end;
$$;

alter function public.kipu_create_account_idempotent(jsonb) owner to postgres;
alter function public.kipu_create_debt_account_idempotent(jsonb) owner to postgres;
alter function public.kipu_claim_agent_action_challenge(jsonb) owner to postgres;
revoke all on function public.kipu_create_account_idempotent(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_create_debt_account_idempotent(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_claim_agent_action_challenge(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_create_account_idempotent(jsonb)
  to service_role;
grant execute on function public.kipu_create_debt_account_idempotent(jsonb)
  to service_role;
grant execute on function public.kipu_claim_agent_action_challenge(jsonb)
  to service_role;

commit;
