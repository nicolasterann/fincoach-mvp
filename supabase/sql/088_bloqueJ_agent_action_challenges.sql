-- Kipu — Bloque J, cierre first-principles del agente.
-- Confirmaciones sensibles derivadas por el SERVIDOR, no por `confirm:true`
-- elegido por el modelo.
--
-- PREPARADA, NO APLICADA. Aplicar antes de desplegar el código que la consume.

begin;

-- Conversation memory participates in the financial safety boundary. A
-- redelivered webhook/submission must not fabricate a second copy of the same
-- turn, and a browser must not bypass the server-owned identity.
alter table public.chat_messages
  add column if not exists operation_key text;

create unique index if not exists chat_messages_operation_key_uq
  on public.chat_messages (user_id, channel, role, operation_key)
  where operation_key is not null;

create index if not exists chat_messages_agent_adjacency_idx
  on public.chat_messages (user_id, channel, chat_id, created_at)
  where role = 'user';

revoke insert, delete on table public.chat_messages from authenticated;

-- A transfer between different currencies has TWO native amounts. The legacy
-- ledger `transfer` applies one original_amount to both accounts, so it cannot
-- represent an exchange without inventing money. Keep the two single-sided
-- ledger adjustments and their lifecycle under one durable operation.
create table if not exists public.fx_transfer_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation_id text not null check (btrim(operation_id) <> ''),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{32}$'),
  source_account_id uuid not null references public.accounts(id),
  destination_account_id uuid not null references public.accounts(id),
  source_transaction_id uuid not null unique references public.transactions(id),
  destination_transaction_id uuid not null unique references public.transactions(id),
  source_amount numeric not null check (source_amount > 0),
  source_currency text not null check (source_currency ~ '^[A-Z]{3}$'),
  destination_amount numeric not null check (destination_amount > 0),
  destination_currency text not null check (destination_currency ~ '^[A-Z]{3}$'),
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  status text not null default 'applied'
    check (status in ('applied','reversed')),
  source_reversal_id uuid unique references public.transactions(id),
  destination_reversal_id uuid unique references public.transactions(id),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  unique (user_id, operation_id),
  check (source_account_id <> destination_account_id),
  check (source_currency <> destination_currency),
  check (
    (status = 'applied' and source_reversal_id is null and destination_reversal_id is null and reversed_at is null)
    or
    (status = 'reversed' and source_reversal_id is not null and destination_reversal_id is not null and reversed_at is not null)
  )
);

alter table public.fx_transfer_operations enable row level security;
drop policy if exists fx_transfer_operations_select_own
  on public.fx_transfer_operations;
create policy fx_transfer_operations_select_own
  on public.fx_transfer_operations for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.fx_transfer_operations
  from public, anon, authenticated;
grant select on table public.fx_transfer_operations to authenticated;
grant select, insert, update, delete on table public.fx_transfer_operations
  to service_role;

create or replace function public.kipu_apply_fx_transfer(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation text := nullif(btrim(p->>'operation_id'),'');
  v_source uuid := nullif(p->>'source_account_id','')::uuid;
  v_destination uuid := nullif(p->>'destination_account_id','')::uuid;
  v_source_amount numeric := round(nullif(p->>'source_amount','')::numeric, 2);
  v_destination_amount numeric := round(nullif(p->>'destination_amount','')::numeric, 2);
  v_source_currency text := upper(nullif(btrim(p->>'source_currency'),''));
  v_destination_currency text := upper(nullif(btrim(p->>'destination_currency'),''));
  v_source_rate numeric := nullif(p->>'source_rate_to_base','')::numeric;
  v_destination_rate numeric := nullif(p->>'destination_rate_to_base','')::numeric;
  v_base text := upper(nullif(btrim(p->>'base_currency'),''));
  v_description text := left(coalesce(nullif(btrim(p->>'description'),''),'Cambio entre cuentas'), 240);
  v_occurred timestamptz := coalesce(nullif(p->>'occurred_at','')::timestamptz, now());
  v_channel text := coalesce(nullif(p->>'input_channel',''),'web');
  v_raw text := p->>'raw_input';
  v_profile_base text;
  v_live_source text;
  v_live_destination text;
  v_expected_source_rate numeric;
  v_expected_destination_rate numeric;
  v_source_tx uuid;
  v_destination_tx uuid;
  v_fingerprint text;
  v_existing public.fx_transfer_operations%rowtype;
begin
  if v_user is null or v_operation is null or v_source is null or v_destination is null
     or v_source = v_destination
     or v_source_amount is null or v_source_amount <= 0
     or v_destination_amount is null or v_destination_amount <= 0
     or v_source_currency !~ '^[A-Z]{3}$'
     or v_destination_currency !~ '^[A-Z]{3}$'
     or v_source_currency = v_destination_currency
     or v_base !~ '^[A-Z]{3}$'
     or v_source_rate is null or v_source_rate <= 0
     or v_destination_rate is null or v_destination_rate <= 0
     -- `channelToInputChannel` intentionally persists the coarse historical
     -- contract used by every ledger writer: web stays `web`; Telegram and
     -- every non-web conversational capture stay `chat`. Rejecting `chat`
     -- here would make the deployed Telegram path impossible even though the
     -- TypeScript preflight and every older ledger RPC accept it.
     or v_channel not in ('web','chat')
  then
    raise exception 'KIPU_VALIDATION: invalid fx transfer'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;

  v_fingerprint := md5(concat_ws('|',
    v_source::text, v_destination::text,
    v_source_amount::text, v_source_currency,
    v_destination_amount::text, v_destination_currency
  ));

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || '|fx|' || v_operation, 0));
  select * into v_existing
    from public.fx_transfer_operations
   where user_id = v_user and operation_id = v_operation
   for update;
  if found then
    if v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: fx transfer payload changed'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'operation_id',v_existing.id,
      'transaction_ids',jsonb_build_array(v_existing.source_transaction_id,v_existing.destination_transaction_id),
      'replayed',true,
      'status',v_existing.status
    );
  end if;

  perform 1 from public.accounts
   where id = any(array[v_source,v_destination]) and user_id = v_user
   order by id for update;
  select upper(currency) into v_live_source
    from public.accounts
   where id = v_source and user_id = v_user and coalesce(status,'active') = 'active';
  select upper(currency) into v_live_destination
    from public.accounts
   where id = v_destination and user_id = v_user and coalesce(status,'active') = 'active';
  if v_live_source is null or v_live_destination is null then
    raise exception 'KIPU_OWNERSHIP: account missing or inactive'
      using errcode = '42501';
  end if;
  if v_live_source <> v_source_currency or v_live_destination <> v_destination_currency then
    raise exception 'KIPU_VALIDATION: account currency changed'
      using errcode = '22023';
  end if;

  select upper(base_currency) into v_profile_base
    from public.profiles where id = v_user for no key update;
  if v_profile_base is null or v_profile_base <> v_base then
    raise exception 'KIPU_VALIDATION: profile base currency mismatch'
      using errcode = '22023';
  end if;

  -- Rates are derived executor data, not LLM authority. Re-read the same
  -- user-owned pair the TypeScript resolver uses and refuse a stale/fabricated
  -- valuation. Direct outranks inverse, exactly like `findRate`.
  if v_source_currency = v_base then
    v_expected_source_rate := 1;
  else
    select rate into v_expected_source_rate
      from public.fx_rates
     where user_id = v_user
       and upper(base_currency) = v_source_currency
       and upper(quote_currency) = v_base
       and rate > 0
     limit 1;
    if v_expected_source_rate is null then
      select 1 / rate into v_expected_source_rate
        from public.fx_rates
       where user_id = v_user
         and upper(base_currency) = v_base
         and upper(quote_currency) = v_source_currency
         and rate > 0
       limit 1;
    end if;
  end if;
  if v_destination_currency = v_base then
    v_expected_destination_rate := 1;
  else
    select rate into v_expected_destination_rate
      from public.fx_rates
     where user_id = v_user
       and upper(base_currency) = v_destination_currency
       and upper(quote_currency) = v_base
       and rate > 0
     limit 1;
    if v_expected_destination_rate is null then
      select 1 / rate into v_expected_destination_rate
        from public.fx_rates
       where user_id = v_user
         and upper(base_currency) = v_base
         and upper(quote_currency) = v_destination_currency
         and rate > 0
       limit 1;
    end if;
  end if;
  if v_expected_source_rate is null
     or v_expected_destination_rate is null
     or abs(v_source_rate - v_expected_source_rate)
        > greatest(0.000000001, abs(v_expected_source_rate) * 0.000001)
     or abs(v_destination_rate - v_expected_destination_rate)
        > greatest(0.000000001, abs(v_expected_destination_rate) * 0.000001)
  then
    raise exception 'KIPU_VALIDATION: fx valuation missing, stale or untrusted'
      using errcode = '22023';
  end if;

  v_source_tx := public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id',v_user,'type','adjustment','effect_type','adjustment','sign',1,
    'description',v_description || ' (sale)','category','other',
    'original_amount',v_source_amount,'original_currency',v_source_currency,
    'exchange_rate_to_base',v_source_rate,
    'base_amount',round(v_source_amount * v_source_rate,2),'base_currency',v_base,
    'source_account_id',v_source,'input_channel',v_channel,'raw_input',v_raw,
    'occurred_at',v_occurred,'dedupe_key',left('fx:' || v_operation || ':source',200),
    'external_ref','fx-transfer:' || v_operation
  ));
  v_destination_tx := public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id',v_user,'type','adjustment','effect_type','adjustment','sign',1,
    'description',v_description || ' (entra)','category','other',
    'original_amount',v_destination_amount,'original_currency',v_destination_currency,
    'exchange_rate_to_base',v_destination_rate,
    'base_amount',round(v_destination_amount * v_destination_rate,2),'base_currency',v_base,
    'destination_account_id',v_destination,'input_channel',v_channel,'raw_input',v_raw,
    'occurred_at',v_occurred,'dedupe_key',left('fx:' || v_operation || ':destination',200),
    'external_ref','fx-transfer:' || v_operation
  ));

  insert into public.fx_transfer_operations (
    user_id, operation_id, fingerprint, source_account_id, destination_account_id,
    source_transaction_id, destination_transaction_id,
    source_amount, source_currency, destination_amount, destination_currency,
    base_currency
  ) values (
    v_user, v_operation, v_fingerprint, v_source, v_destination,
    v_source_tx, v_destination_tx,
    v_source_amount, v_source_currency, v_destination_amount, v_destination_currency,
    v_base
  ) returning * into v_existing;

  return jsonb_build_object(
    'operation_id',v_existing.id,
    'transaction_ids',jsonb_build_array(v_source_tx,v_destination_tx),
    'replayed',false,
    'status','applied'
  );
end;
$$;

create or replace function public.kipu_reverse_fx_transfer(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_transaction uuid := nullif(p->>'transaction_id','')::uuid;
  v_raw text := p->>'raw_input';
  v_channel text := coalesce(nullif(p->>'input_channel',''),'web');
  v_row public.fx_transfer_operations%rowtype;
  v_source_reversal uuid;
  v_destination_reversal uuid;
begin
  if v_user is null or v_transaction is null then
    raise exception 'KIPU_VALIDATION: fx transfer reversal identity required'
      using errcode = '22023';
  end if;
  if v_channel not in ('web','chat') then
    raise exception 'KIPU_VALIDATION: invalid fx reversal channel'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;
  select * into v_row
    from public.fx_transfer_operations
   where user_id = v_user
     and (source_transaction_id = v_transaction or destination_transaction_id = v_transaction)
   for update;
  if not found then return jsonb_build_object('matched',false); end if;
  if v_row.status = 'reversed' then
    return jsonb_build_object(
      'matched',true,'already_reversed',true,'operation_id',v_row.id
    );
  end if;

  v_source_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id',v_user,'type','reversal','sign',-1,
    'related_transaction_id',v_row.source_transaction_id,
    'input_channel',v_channel,'raw_input',v_raw,'occurred_at',now()
  ));
  v_destination_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id',v_user,'type','reversal','sign',-1,
    'related_transaction_id',v_row.destination_transaction_id,
    'input_channel',v_channel,'raw_input',v_raw,'occurred_at',now()
  ));
  update public.fx_transfer_operations
     set status = 'reversed',
         source_reversal_id = v_source_reversal,
         destination_reversal_id = v_destination_reversal,
         reversed_at = now()
   where id = v_row.id;
  return jsonb_build_object(
    'matched',true,'already_reversed',false,'operation_id',v_row.id
  );
end;
$$;

alter function public.kipu_apply_fx_transfer(jsonb) owner to postgres;
alter function public.kipu_reverse_fx_transfer(jsonb) owner to postgres;
revoke all on function public.kipu_apply_fx_transfer(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_reverse_fx_transfer(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_apply_fx_transfer(jsonb) to service_role;
grant execute on function public.kipu_reverse_fx_transfer(jsonb) to service_role;

create table if not exists public.agent_action_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('web','telegram')),
  chat_id text,
  tool_name text not null check (btrim(tool_name) <> ''),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  originating_operation_id text not null check (btrim(originating_operation_id) <> ''),
  confirmed_operation_id text,
  reason text not null check (reason in ('destructive','sensitive_create','unstated_amount')),
  prompt text not null check (btrim(prompt) <> ''),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending','confirmed','expired','cancelled')),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (status = 'confirmed' and confirmed_operation_id is not null and confirmed_at is not null)
    or
    (status <> 'confirmed' and confirmed_operation_id is null and confirmed_at is null)
  )
);

alter table public.agent_action_challenges enable row level security;

drop policy if exists agent_action_challenges_select_own
  on public.agent_action_challenges;
create policy agent_action_challenges_select_own
  on public.agent_action_challenges
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.agent_action_challenges
  from public, anon, authenticated;
grant select on table public.agent_action_challenges to authenticated;
grant select, insert, update, delete on table public.agent_action_challenges
  to service_role;

drop index if exists public.agent_action_challenges_live_uq;
create unique index agent_action_challenges_live_uq
  on public.agent_action_challenges (
    user_id,
    channel,
    coalesce(chat_id, '')
  )
  where status = 'pending';

create index if not exists agent_action_challenges_expiry_idx
  on public.agent_action_challenges (expires_at)
  where status = 'pending';

-- The challenge operation id is server-derived, while chat_messages stores the
-- delivery key used by the channel handler. Normalize the former into the
-- latter so the database can prove conversational adjacency. Without this
-- proof, a pending "close the card?" survived an unrelated read-only exchange
-- and a later bare "correcto" could consume the stale destructive action.
create or replace function public.kipu__agent_user_message_operation_key(
  p_operation text
)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select case
    when p_operation like 'ev:%'
      then 'evidence:' || substr(p_operation, 4) || ':user'
    when p_operation ~ '^(web|tg|ch):t:.+'
      then 'chat:' || regexp_replace(p_operation, '^[^:]+:t:', '') || ':user'
    else null
  end
$$;

alter function public.kipu__agent_user_message_operation_key(text)
  owner to postgres;
revoke all on function public.kipu__agent_user_message_operation_key(text)
  from public, anon, authenticated, service_role;

create or replace function public.kipu_issue_agent_action_challenge(p jsonb)
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
  v_reason text := nullif(p->>'reason','');
  v_prompt text := nullif(btrim(p->>'prompt'),'');
  v_payload jsonb := p->'payload';
  v_existing public.agent_action_challenges%rowtype;
  v_id uuid;
begin
  if v_user is null
     or v_channel not in ('web','telegram')
     or v_tool is null
     or v_hash !~ '^[a-f0-9]{64}$'
     or v_operation is null
     or public.kipu__agent_user_message_operation_key(v_operation) is null
     or v_reason not in ('destructive','sensitive_create','unstated_amount')
     or v_prompt is null
     or jsonb_typeof(v_payload) is distinct from 'object'
  then
    raise exception 'KIPU_VALIDATION: invalid agent action challenge'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_user::text || '|' || v_channel || '|' || coalesce(v_chat,''),
    0
  ));

  update public.agent_action_challenges
     set status = 'expired',
         updated_at = now()
   where user_id = v_user
     and channel = v_channel
     and chat_id is not distinct from v_chat
     and status = 'pending'
     and expires_at <= now();

  select *
    into v_existing
    from public.agent_action_challenges
   where user_id = v_user
     and channel = v_channel
     and chat_id is not distinct from v_chat
     and status = 'pending'
     and expires_at > now()
   order by created_at desc
   limit 1
  for update;

  if found then
    if v_existing.tool_name = v_tool
       and v_existing.payload_hash = v_hash then
      return jsonb_build_object('outcome','existing','challenge_id',v_existing.id);
    end if;
    -- Only one unresolved action per conversation (regardless of tool). A new
    -- proposal replaces the earlier one; a later "sí" can never ambiguously
    -- authorize two different actions.
    update public.agent_action_challenges
       set status = 'cancelled', updated_at = now()
     where id = v_existing.id;
  end if;

  insert into public.agent_action_challenges (
    user_id, channel, chat_id, tool_name, payload_hash,
    originating_operation_id, reason, prompt, payload
  ) values (
    v_user, v_channel, v_chat, v_tool, v_hash,
    v_operation, v_reason, left(v_prompt, 600), v_payload
  )
  returning id into v_id;

  return jsonb_build_object('outcome','issued','challenge_id',v_id);
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

  -- A model cannot issue and self-confirm in one delivery.
  if v_row.originating_operation_id = v_operation then
    return jsonb_build_object(
      'outcome','same_turn',
      'claimed',false,
      'challenge_id',v_row.id,
      'payload',v_row.payload
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

-- A bare confirmation must not depend on the model selecting the same tool
-- again. This read-only lookup returns the one live proposal for the
-- conversation; the actual claim remains inside
-- kipu_claim_agent_action_challenge immediately before the write.
create or replace function public.kipu_peek_pending_agent_action_challenge(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_channel text := nullif(p->>'channel','');
  v_chat text := nullif(p->>'chat_id','');
  v_operation text := nullif(btrim(p->>'operation_id'),'');
  v_message_operation text;
  v_row public.agent_action_challenges%rowtype;
begin
  if v_user is null
     or v_channel not in ('web','telegram')
     or v_operation is null
  then
    raise exception 'KIPU_VALIDATION: invalid action challenge lookup'
      using errcode = '22023';
  end if;
  v_message_operation :=
    public.kipu__agent_user_message_operation_key(v_operation);
  if v_message_operation is null then
    return jsonb_build_object('found',false);
  end if;

  select *
    into v_row
    from public.agent_action_challenges
   where user_id = v_user
     and channel = v_channel
     and chat_id is not distinct from v_chat
     and status = 'pending'
     and expires_at > now()
     and originating_operation_id <> v_operation
   order by created_at desc
   limit 1;

  if not found then
    return jsonb_build_object('found',false);
  end if;
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
    return jsonb_build_object('found',false);
  end if;
  return jsonb_build_object(
    'found',true,
    'challenge_id',v_row.id,
    'tool_name',v_row.tool_name,
    'payload',v_row.payload
  );
end;
$$;

alter function public.kipu_issue_agent_action_challenge(jsonb) owner to postgres;
alter function public.kipu_claim_agent_action_challenge(jsonb) owner to postgres;
alter function public.kipu_peek_pending_agent_action_challenge(jsonb) owner to postgres;

revoke all on function public.kipu_issue_agent_action_challenge(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_claim_agent_action_challenge(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_peek_pending_agent_action_challenge(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_issue_agent_action_challenge(jsonb)
  to service_role;
grant execute on function public.kipu_claim_agent_action_challenge(jsonb)
  to service_role;
grant execute on function public.kipu_peek_pending_agent_action_challenge(jsonb)
  to service_role;

-- Reset spans two user-owned personalization tables. Two independent deletes
-- could leave "neutral" half-applied while the tool narrated a full reset.
create or replace function public.kipu_reset_personalization(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then
    raise exception 'KIPU_VALIDATION: user required' using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;
  delete from public.user_personalization where user_id = p_user_id;
  delete from public.user_life_context where user_id = p_user_id;
  return jsonb_build_object('outcome','reset');
end;
$$;

alter function public.kipu_reset_personalization(uuid) owner to postgres;
revoke all on function public.kipu_reset_personalization(uuid)
  from public, anon, authenticated;
grant execute on function public.kipu_reset_personalization(uuid)
  to service_role;

-- Goal definition changes are a financial-unit change, not a generic UPDATE.
-- Currency can only change while the goal has no accumulated/history, and the
-- new target must be supplied in that same operation so no old-currency number
-- is silently relabelled.
create or replace function public.kipu_update_goal_definition(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_goal uuid := nullif(p->>'goal_id','')::uuid;
  v_target numeric := nullif(p->>'target_amount','')::numeric;
  v_currency text := upper(nullif(btrim(p->>'currency'),''));
  v_row public.goals%rowtype;
begin
  if v_user is null or v_goal is null then
    raise exception 'KIPU_VALIDATION: goal identity required'
      using errcode = '22023';
  end if;
  if v_target is not null and v_target <= 0 then
    raise exception 'KIPU_VALIDATION: goal target must be positive'
      using errcode = '22023';
  end if;
  if v_currency is not null and v_currency !~ '^[A-Z]{3}$' then
    raise exception 'KIPU_VALIDATION: invalid goal currency'
      using errcode = '22023';
  end if;
  if v_target is null and v_currency is null then
    raise exception 'KIPU_VALIDATION: no goal definition change'
      using errcode = '22023';
  end if;

  select *
    into v_row
    from public.goals
   where id = v_goal and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: goal not found'
      using errcode = '22023';
  end if;

  if v_currency is not null and v_currency is distinct from upper(v_row.currency) then
    if v_target is null then
      raise exception 'KIPU_VALIDATION: changing goal currency requires a new target'
        using errcode = '22023';
    end if;
    if abs(coalesce(v_row.current_amount, 0)) > 0.005
       or exists (
         select 1 from public.transactions
          where user_id = v_user and goal_id = v_goal
       )
       or exists (
         select 1 from public.household_goal_contributions
          where goal_id = v_goal
       )
    then
      raise exception 'KIPU_VALIDATION: goal currency is immutable after money exists'
        using errcode = '22023';
    end if;
    -- Migration 071 deliberately makes a goal's unit immutable to every raw
    -- UPDATE. This RPC is the only sanctioned correction path, and reaches
    -- this marker only after locking the goal, requiring a newly stated target
    -- and proving there is no accumulated or historical money. Migration 073's
    -- independent account-link trigger still runs and rejects a linked account
    -- in the old currency.
    perform set_config('kipu.sanctioned_currency_change', 'on', true);
  end if;

  update public.goals
     set target_amount = coalesce(v_target, target_amount),
         currency = coalesce(v_currency, currency),
         updated_at = now()
   where id = v_goal and user_id = v_user;

  return jsonb_build_object(
    'outcome','updated',
    'target_amount',coalesce(v_target,v_row.target_amount),
    'currency',coalesce(v_currency,v_row.currency)
  );
end;
$$;

alter function public.kipu_update_goal_definition(jsonb) owner to postgres;
revoke all on function public.kipu_update_goal_definition(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_update_goal_definition(jsonb)
  to service_role;

-- Every other agent CREATE needs the same delivery identity. The row itself is
-- the marker: old/browser/onboarding writers keep both columns NULL, while an
-- agent insert carries both and is unique per user+operation in that domain.
-- This closes lost-response duplicates for goals, assets/investments, fixed
-- expenses, scheduled payments/changes, incomes, memories and bug reports.
alter table public.goals
  add column if not exists agent_operation_key text,
  add column if not exists agent_payload_fingerprint text;
alter table public.investment_accounts
  add column if not exists agent_operation_key text,
  add column if not exists agent_payload_fingerprint text;
alter table public.fixed_expenses
  add column if not exists agent_operation_key text,
  add column if not exists agent_payload_fingerprint text;
alter table public.scheduled_payments
  add column if not exists agent_operation_key text,
  add column if not exists agent_payload_fingerprint text;
alter table public.income_sources
  add column if not exists agent_operation_key text,
  add column if not exists agent_payload_fingerprint text;
alter table public.scheduled_changes
  add column if not exists agent_operation_key text,
  add column if not exists agent_payload_fingerprint text;
alter table public.user_context_notes
  add column if not exists agent_operation_key text,
  add column if not exists agent_payload_fingerprint text;
alter table public.user_feedback
  add column if not exists agent_operation_key text,
  add column if not exists agent_payload_fingerprint text;

-- The marker is security/integrity state, not user-authored payload. Keep old
-- browser/onboarding inserts valid (both NULL), but reject half-markers,
-- malformed fingerprints and attempts by authenticated callers to forge the
-- server's replay identity. `request.jwt.claim.role` is empty for migrations
-- and direct postgres maintenance, and `service_role` for the agent server.
create or replace function public.kipu__agent_create_identity_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_operation text := nullif(btrim(new.agent_operation_key), '');
  v_fingerprint text := nullif(btrim(new.agent_payload_fingerprint), '');
  -- PostgREST versions differ: some expose the legacy scalar setting and
  -- others only the JSON claims blob. Treating "setting absent" as trusted
  -- would let an authenticated INSERT forge the server-owned replay marker.
  v_request_role text;
  v_claims text;
begin
  -- Unmarked rows (browser, onboarding, cron) leave before any of this.
  if new.agent_operation_key is null
     and new.agent_payload_fingerprint is null then
    return new;
  end if;

  v_request_role := nullif(current_setting('request.jwt.claim.role', true), '');
  if v_request_role is null then
    v_claims := nullif(current_setting('request.jwt.claims', true), '');
    if v_claims is not null then
      -- A malformed blob is not authority either: it must not abort every
      -- insert on these tables, and it must not read as "no claim".
      begin
        v_request_role := coalesce(v_claims::jsonb->>'role', 'unknown');
      exception when others then
        v_request_role := 'unknown';
      end;
    end if;
  end if;

  if v_operation is null
     or v_fingerprint is null
     or v_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'KIPU_VALIDATION: invalid agent create identity';
  end if;

  -- The absence of a role claim is NOT proof of a trusted caller: a PostgREST
  -- deployment that stops exposing both settings would silently reopen the very
  -- forgery this guard exists to stop. Authority is therefore taken from the
  -- EFFECTIVE DATABASE ROLE, which a client cannot choose: PostgREST switches to
  -- `authenticated`/`anon` for a browser request, to `service_role` for the
  -- agent server, and a SECURITY DEFINER server RPC or direct maintenance runs
  -- as the table owner. A claim, when present, must agree with it.
  if current_user not in ('service_role', 'postgres', 'supabase_admin')
     or (v_request_role is not null and v_request_role <> 'service_role')
  then
    raise exception using
      errcode = '42501',
      message = 'KIPU_FORBIDDEN: agent create identity is server-owned';
  end if;

  new.agent_operation_key := v_operation;
  new.agent_payload_fingerprint := v_fingerprint;
  return new;
end;
$$;

alter function public.kipu__agent_create_identity_guard() owner to postgres;
revoke all on function public.kipu__agent_create_identity_guard()
  from public, anon, authenticated;

drop trigger if exists goals_agent_create_identity_guard on public.goals;
create trigger goals_agent_create_identity_guard
before insert or update of agent_operation_key, agent_payload_fingerprint
on public.goals for each row
execute function public.kipu__agent_create_identity_guard();
drop trigger if exists investment_accounts_agent_create_identity_guard
  on public.investment_accounts;
create trigger investment_accounts_agent_create_identity_guard
before insert or update of agent_operation_key, agent_payload_fingerprint
on public.investment_accounts for each row
execute function public.kipu__agent_create_identity_guard();
drop trigger if exists fixed_expenses_agent_create_identity_guard
  on public.fixed_expenses;
create trigger fixed_expenses_agent_create_identity_guard
before insert or update of agent_operation_key, agent_payload_fingerprint
on public.fixed_expenses for each row
execute function public.kipu__agent_create_identity_guard();
drop trigger if exists scheduled_payments_agent_create_identity_guard
  on public.scheduled_payments;
create trigger scheduled_payments_agent_create_identity_guard
before insert or update of agent_operation_key, agent_payload_fingerprint
on public.scheduled_payments for each row
execute function public.kipu__agent_create_identity_guard();
drop trigger if exists income_sources_agent_create_identity_guard
  on public.income_sources;
create trigger income_sources_agent_create_identity_guard
before insert or update of agent_operation_key, agent_payload_fingerprint
on public.income_sources for each row
execute function public.kipu__agent_create_identity_guard();
drop trigger if exists scheduled_changes_agent_create_identity_guard
  on public.scheduled_changes;
create trigger scheduled_changes_agent_create_identity_guard
before insert or update of agent_operation_key, agent_payload_fingerprint
on public.scheduled_changes for each row
execute function public.kipu__agent_create_identity_guard();
drop trigger if exists user_context_notes_agent_create_identity_guard
  on public.user_context_notes;
create trigger user_context_notes_agent_create_identity_guard
before insert or update of agent_operation_key, agent_payload_fingerprint
on public.user_context_notes for each row
execute function public.kipu__agent_create_identity_guard();
drop trigger if exists user_feedback_agent_create_identity_guard
  on public.user_feedback;
create trigger user_feedback_agent_create_identity_guard
before insert or update of agent_operation_key, agent_payload_fingerprint
on public.user_feedback for each row
execute function public.kipu__agent_create_identity_guard();

create unique index if not exists goals_agent_operation_uq
  on public.goals(user_id,agent_operation_key)
  where agent_operation_key is not null;
create unique index if not exists investment_accounts_agent_operation_uq
  on public.investment_accounts(user_id,agent_operation_key)
  where agent_operation_key is not null;
create unique index if not exists fixed_expenses_agent_operation_uq
  on public.fixed_expenses(user_id,agent_operation_key)
  where agent_operation_key is not null;
create unique index if not exists scheduled_payments_agent_operation_uq
  on public.scheduled_payments(user_id,agent_operation_key)
  where agent_operation_key is not null;
create unique index if not exists income_sources_agent_operation_uq
  on public.income_sources(user_id,agent_operation_key)
  where agent_operation_key is not null;
create unique index if not exists scheduled_changes_agent_operation_uq
  on public.scheduled_changes(user_id,agent_operation_key)
  where agent_operation_key is not null;
create unique index if not exists user_context_notes_agent_operation_uq
  on public.user_context_notes(user_id,agent_operation_key)
  where agent_operation_key is not null;
create unique index if not exists user_feedback_agent_operation_uq
  on public.user_feedback(user_id,agent_operation_key)
  where agent_operation_key is not null;

-- Creating an instrument is a sensitive action, but a durable confirmation is
-- not itself write idempotency: the insert may commit and its HTTP response may
-- disappear. Keep the instrument and the application marker in one transaction
-- so replay returns the original id instead of creating a second account/card.
create table if not exists public.agent_instrument_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('create_account','create_debt')),
  dedupe_key text not null check (btrim(dedupe_key) <> ''),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{32}$'),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id,dedupe_key)
);

alter table public.agent_instrument_applications enable row level security;
drop policy if exists agent_instrument_applications_select_own
  on public.agent_instrument_applications;
create policy agent_instrument_applications_select_own
  on public.agent_instrument_applications
  for select to authenticated
  using (user_id = auth.uid());
revoke all on table public.agent_instrument_applications
  from public, anon, authenticated;
grant select on table public.agent_instrument_applications to authenticated;
grant select, insert, update, delete
  on table public.agent_instrument_applications to service_role;

create or replace function public.kipu__verify_agent_opening_balance(
  p_user uuid,
  p_currency text,
  p_base_currency text,
  p_original numeric,
  p_base numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_base text;
  v_rate numeric;
begin
  select upper(base_currency) into v_profile_base
    from public.profiles
   where id = p_user
   for no key update;
  if not found or v_profile_base <> upper(p_base_currency) then
    raise exception 'KIPU_VALIDATION: profile base currency mismatch'
      using errcode = '22023';
  end if;
  if upper(p_currency) = v_profile_base then
    if abs(round(p_original,2) - round(p_base,2)) > 0.005 then
      raise exception 'KIPU_VALIDATION: native opening balance mismatch'
        using errcode = '22023';
    end if;
    return;
  end if;
  if abs(p_original) <= 0.0000001 then
    if abs(p_base) > 0.005 then
      raise exception 'KIPU_VALIDATION: zero opening balance has nonzero base'
        using errcode = '22023';
    end if;
    return;
  end if;
  select rate into v_rate
    from public.fx_rates
   where user_id = p_user
     and upper(base_currency) = upper(p_currency)
     and upper(quote_currency) = v_profile_base
     and rate > 0
   limit 1;
  if v_rate is null then
    select 1 / rate into v_rate
      from public.fx_rates
     where user_id = p_user
       and upper(base_currency) = v_profile_base
       and upper(quote_currency) = upper(p_currency)
       and rate > 0
     limit 1;
  end if;
  if v_rate is null
     or abs(round(p_original * v_rate,2) - round(p_base,2)) > 0.005 then
    raise exception 'KIPU_VALIDATION: opening balance valuation unavailable or stale'
      using errcode = '22023';
  end if;
end;
$$;

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
    v_user,v_name,v_type,v_currency,round(v_original,2),round(v_base,2),
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
    v_user,v_name,v_type,v_currency,round(v_original,2),round(v_base,2),
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

-- A statement's authoritative card write is already idempotent, but its
-- historical row used to be a best-effort INSERT performed afterwards. Replays
-- then hit the `(debt_account_id, statement_date)` unique index and reported an
-- error even though the live card was correct. Give that second boundary its
-- own durable identity and make cycle-row + replay marker one transaction.
create table if not exists public.debt_statement_cycle_applications (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  operation_key       text not null,
  payload_fingerprint text not null,
  cycle_id             uuid not null
    references public.debt_statement_cycles(id) on delete cascade,
  created_at          timestamptz not null default now(),
  unique (user_id, operation_key)
);

alter table public.debt_statement_cycle_applications enable row level security;
drop policy if exists debt_statement_cycle_applications_select_own
  on public.debt_statement_cycle_applications;
create policy debt_statement_cycle_applications_select_own
  on public.debt_statement_cycle_applications
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.debt_statement_cycle_applications
  from public, anon, authenticated;
grant select on table public.debt_statement_cycle_applications to authenticated;
grant select, insert, update, delete
  on table public.debt_statement_cycle_applications to service_role;

create or replace function public.kipu_record_debt_statement_cycle_idempotent(
  p jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_debt uuid := nullif(p->>'debt_account_id','')::uuid;
  v_operation text := nullif(btrim(p->>'operation_key'),'');
  v_statement_date date := nullif(p->>'statement_date','')::date;
  v_core jsonb := p - 'operation_key';
  v_fingerprint text := md5(v_core::text);
  v_existing public.debt_statement_cycle_applications%rowtype;
  v_cycle uuid;
  v_due_day integer := nullif(p->>'due_day','')::integer;
  v_cutoff_day integer := nullif(p->>'cutoff_day','')::integer;
  v_applied boolean := coalesce((p->>'applied')::boolean,false);
  v_current boolean := coalesce((p->>'is_current')::boolean,false);
begin
  if v_user is null or v_debt is null or v_operation is null
     or v_statement_date is null then
    raise exception
      'KIPU_VALIDATION: statement audit requires user, card, operation and date'
      using errcode = '22023';
  end if;
  if v_due_day is not null and (v_due_day < 1 or v_due_day > 31) then
    raise exception 'KIPU_VALIDATION: invalid statement due day'
      using errcode = '22023';
  end if;
  if v_cutoff_day is not null and (v_cutoff_day < 1 or v_cutoff_day > 31) then
    raise exception 'KIPU_VALIDATION: invalid statement cutoff day'
      using errcode = '22023';
  end if;
  if coalesce(nullif(p->>'statement_balance','')::numeric,0) < 0
     or coalesce(nullif(p->>'full_payment_due','')::numeric,0) < 0
     or coalesce(nullif(p->>'minimum_payment','')::numeric,0) < 0
     or coalesce(nullif(p->>'interest_rate','')::numeric,0) < 0
     or coalesce(nullif(p->>'interest_rate','')::numeric,0) > 400
     or (nullif(p->>'interest_rate_kind','') is not null
         and nullif(p->>'interest_rate_kind','') not in (
           'annual_nominal','annual_effective','monthly'
         ))
     or (v_current and not v_applied) then
    raise exception 'KIPU_VALIDATION: invalid statement audit values'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_operation,0)
  );
  select * into v_existing
    from public.debt_statement_cycle_applications
   where user_id = v_user and operation_key = v_operation
   for update;
  if found then
    if v_existing.payload_fingerprint <> v_fingerprint then
      raise exception
        'KIPU_DEDUPE_MISMATCH: statement audit payload changed'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed','cycle_id',v_existing.cycle_id
    );
  end if;

  perform 1
    from public.debt_accounts
   where id = v_debt and user_id = v_user
   for no key update;
  if not found then
    raise exception 'KIPU_VALIDATION: card not found for statement audit'
      using errcode = '22023';
  end if;

  insert into public.debt_statement_cycles (
    user_id,debt_account_id,evidence_id,statement_date,period_end,
    statement_balance,full_payment_due,minimum_payment,due_day,cutoff_day,
    interest_rate,interest_rate_kind,applied,is_current,reason
  ) values (
    v_user,v_debt,nullif(p->>'evidence_id','')::uuid,v_statement_date,
    nullif(p->>'period_end','')::date,
    nullif(p->>'statement_balance','')::numeric,
    nullif(p->>'full_payment_due','')::numeric,
    nullif(p->>'minimum_payment','')::numeric,
    v_due_day,v_cutoff_day,nullif(p->>'interest_rate','')::numeric,
    nullif(p->>'interest_rate_kind',''),v_applied,v_current,
    nullif(p->>'reason','')
  )
  on conflict (debt_account_id,statement_date)
    where statement_date is not null
  do update set
    evidence_id = excluded.evidence_id,
    period_end = excluded.period_end,
    statement_balance = excluded.statement_balance,
    full_payment_due = excluded.full_payment_due,
    minimum_payment = excluded.minimum_payment,
    due_day = excluded.due_day,
    cutoff_day = excluded.cutoff_day,
    interest_rate = excluded.interest_rate,
    interest_rate_kind = excluded.interest_rate_kind,
    applied = excluded.applied,
    is_current = excluded.is_current,
    reason = excluded.reason
  returning id into v_cycle;

  if v_current then
    update public.debt_statement_cycles
       set is_current = false
     where user_id = v_user
       and debt_account_id = v_debt
       and id <> v_cycle
       and is_current is true;
  end if;

  insert into public.debt_statement_cycle_applications (
    user_id,operation_key,payload_fingerprint,cycle_id
  ) values (
    v_user,v_operation,v_fingerprint,v_cycle
  );

  return jsonb_build_object('outcome','created','cycle_id',v_cycle);
end;
$$;

alter function public.kipu__verify_agent_opening_balance(uuid,text,text,numeric,numeric)
  owner to postgres;
alter function public.kipu_create_account_idempotent(jsonb) owner to postgres;
alter function public.kipu_create_debt_account_idempotent(jsonb) owner to postgres;
revoke all on function public.kipu__verify_agent_opening_balance(uuid,text,text,numeric,numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.kipu_create_account_idempotent(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_create_debt_account_idempotent(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_create_account_idempotent(jsonb)
  to service_role;
grant execute on function public.kipu_create_debt_account_idempotent(jsonb)
  to service_role;

-- Household lifecycle is also part of the agent safety boundary. Creating a
-- household without its owner-member produces an unreachable group; accepting
-- an invite without closing it produces a member plus a forever-pending invite.
-- Both used to be two independent writes with best-effort compensation.
create table if not exists public.household_action_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  action text not null check (action in (
    'create_household',
    'create_shared_goal',
    'add_participant',
    'create_invite',
    'create_recurring',
    'add_shared_expense',
    'mark_reimbursement'
  )),
  dedupe_key text not null,
  fingerprint text not null,
  entity_id uuid not null,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (user_id,dedupe_key)
);

alter table public.household_action_applications enable row level security;
alter table public.household_action_applications
  add column if not exists result jsonb;
drop policy if exists household_action_applications_select_own
  on public.household_action_applications;
create policy household_action_applications_select_own
  on public.household_action_applications
  for select to authenticated
  using (user_id = auth.uid());
revoke all on table public.household_action_applications
  from public, anon, authenticated;
grant select on table public.household_action_applications to authenticated;
grant select, insert, update, delete
  on table public.household_action_applications to service_role;

-- Keep a partially prepared/re-applied 088 honest too: the action vocabulary is
-- part of the durable identity contract, not an implicit convention in TS.
alter table public.household_action_applications
  drop constraint if exists household_action_applications_action_check;
alter table public.household_action_applications
  add constraint household_action_applications_action_check
  check (action in (
    'create_household',
    'create_shared_goal',
    'add_participant',
    'create_invite',
    'create_recurring',
    'add_shared_expense',
    'mark_reimbursement',
    'cancel_shared_expense',
    'update_shared_expense',
    'settle_household',
    'leave_household',
    'transfer_ownership',
    'remove_member',
    'set_visibility',
    'remove_recurring'
  ));

create or replace function public.kipu_create_household_atomic(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_name text := left(nullif(btrim(p->>'name'),''),80);
  v_type text := coalesce(nullif(p->>'type',''),'custom');
  v_base text := upper(coalesce(nullif(btrim(p->>'base_currency'),''),'USD'));
  v_mode text := coalesce(nullif(p->>'mode',''),'shared_expenses');
  v_display text := left(coalesce(nullif(btrim(p->>'self_display_name'),''),'Yo'),60);
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_fingerprint text;
  v_existing public.household_action_applications%rowtype;
  v_household uuid;
begin
  if v_user is null or v_name is null or v_dedupe is null
     or v_type not in ('couple','family','roommates','trip','custom')
     or v_base !~ '^[A-Z]{3}$'
     or v_mode not in ('shared_expenses','shared_goals','full','trip_split','family_support','custom')
  then
    raise exception 'KIPU_VALIDATION: invalid household'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;
  v_fingerprint := md5(concat_ws(
    '|',v_name,v_type,v_base,v_mode,v_display
  ));
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_dedupe,0)
  );
  select * into v_existing
    from public.household_action_applications
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  if found then
    if v_existing.action <> 'create_household'
       or v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: household create payload changed'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed','household_id',v_existing.entity_id
    );
  end if;

  insert into public.households (owner_id,name,type,base_currency,mode)
  values (v_user,v_name,v_type,v_base,v_mode)
  returning id into v_household;

  insert into public.household_members (
    household_id,user_id,display_name,role,status,joined_at
  ) values (
    v_household,v_user,v_display,'owner','active',now()
  );

  insert into public.household_audit_log (
    household_id,actor_user_id,action,entity,detail
  ) values (
    v_household,v_user,'create_household','household',v_name
  );
  insert into public.household_action_applications (
    user_id,household_id,action,dedupe_key,fingerprint,entity_id
  ) values (
    v_user,v_household,'create_household',v_dedupe,v_fingerprint,v_household
  );

  return jsonb_build_object('outcome','created','household_id',v_household);
end;
$$;

create or replace function public.kipu_respond_household_invite_atomic(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_invite uuid := nullif(p->>'invite_id','')::uuid;
  v_token text := nullif(btrim(p->>'token'),'');
  v_accept boolean := case
    when p ? 'accept' then (p->>'accept')::boolean
    else null
  end;
  v_display text := left(nullif(btrim(p->>'display_name'),''),60);
  v_row public.household_invites%rowtype;
  v_member uuid;
  v_external uuid;
  v_external_count integer := 0;
begin
  if v_user is null
     or (v_invite is null) = (v_token is null)
     or v_accept is null
  then
    raise exception 'KIPU_VALIDATION: invite identity and decision required'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;

  select * into v_row
    from public.household_invites
   where (v_invite is not null and id = v_invite)
      or (v_token is not null and token = v_token)
   for update;
  if not found then
    return jsonb_build_object('outcome','invalid');
  end if;
  if v_row.invited_user_id is not null
     and v_row.invited_user_id <> v_user then
    return jsonb_build_object('outcome','not_yours');
  end if;
  if v_row.status = 'pending'
     and v_row.created_at < now() - interval '14 days' then
    update public.household_invites
       set status = 'expired', updated_at = now()
     where id = v_row.id;
    return jsonb_build_object('outcome','expired');
  end if;

  select id into v_member
    from public.household_members
   where household_id = v_row.household_id
     and user_id = v_user
     and status = 'active'
   for update;

  if v_row.status = 'accepted' and v_member is not null then
    return jsonb_build_object(
      'outcome','replayed','household_id',v_row.household_id
    );
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('outcome','invalid');
  end if;
  if coalesce(v_row.role,'') not in ('member','viewer','contributor') then
    raise exception 'KIPU_VALIDATION: invite role is not assignable'
      using errcode = '22023';
  end if;

  if not v_accept then
    update public.household_invites
       set status = 'declined', updated_at = now()
     where id = v_row.id;
    insert into public.household_audit_log (
      household_id,actor_user_id,action,entity,detail
    ) values (
      v_row.household_id,v_user,'decline','member','por invitación'
    );
    return jsonb_build_object(
      'outcome','declined','household_id',v_row.household_id
    );
  end if;

  -- Serialize every acceptance in the same household. Two different invite
  -- rows may target the same user; locking only the invite lets both snapshots
  -- observe no membership and race on the unique member index.
  perform 1
    from public.households
   where id = v_row.household_id
   for update;
  if not found then
    return jsonb_build_object('outcome','invalid');
  end if;

  -- An owner/admin opening a generic share link to test it must not consume the
  -- invite intended for someone else. A targeted invite may be finalized if a
  -- concurrent tab already created the membership.
  select id into v_member
    from public.household_members
   where household_id = v_row.household_id
     and user_id = v_user
   for update;
  if v_member is not null
     and exists (
       select 1
         from public.household_members
        where id = v_member and status = 'active'
     )
     and v_row.invited_user_id is null then
    return jsonb_build_object(
      'outcome','already_member','household_id',v_row.household_id
    );
  end if;

  if v_member is not null then
    -- Rejoining revives the existing historical member row. Inserting a new
    -- one would violate the unique (household_id,user_id) index forever after
    -- the first leave/remove.
    update public.household_members
       set display_name = coalesce(v_display,v_row.invited_label,display_name),
           role = coalesce(v_row.role,'member'),
           status = 'active',
           invited_by = v_row.created_by,
           joined_at = now(),
           updated_at = now()
     where id = v_member;
  else
    if v_row.invited_label is not null then
      select (array_agg(id order by id))[1], count(*)
        into v_external, v_external_count
        from public.household_members
       where household_id = v_row.household_id
         and user_id is null
         and status = 'active'
         and lower(display_name) = lower(v_row.invited_label);
    end if;
    if v_external_count = 1 then
      update public.household_members
         set user_id = v_user,
             display_name = coalesce(v_display,v_row.invited_label,'Yo'),
             role = coalesce(v_row.role,'member'),
             joined_at = now(),
             updated_at = now()
       where id = v_external and user_id is null
       returning id into v_member;
    end if;
    if v_member is null then
      insert into public.household_members (
        household_id,user_id,display_name,role,status,invited_by,joined_at
      ) values (
        v_row.household_id,v_user,
        coalesce(v_display,v_row.invited_label,'Yo'),
        coalesce(v_row.role,'member'),'active',v_row.created_by,now()
      ) returning id into v_member;
    end if;
  end if;

  update public.household_invites
     set status = 'accepted', updated_at = now()
   where id = v_row.id and status = 'pending';

  insert into public.household_audit_log (
    household_id,actor_user_id,action,entity,detail
  ) values (
    v_row.household_id,v_user,'accept','member','por invitación'
  );
  return jsonb_build_object(
    'outcome','accepted','household_id',v_row.household_id,'member_id',v_member
  );
end;
$$;

create or replace function public.kipu_create_shared_goal_atomic(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_name text := left(nullif(btrim(p->>'name'),''),80);
  v_target numeric := nullif(p->>'target_amount','')::numeric;
  v_currency text := upper(nullif(btrim(p->>'currency'),''));
  v_weekly numeric := nullif(p->>'my_weekly_base','')::numeric;
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_fingerprint text;
  v_existing public.household_action_applications%rowtype;
  v_member public.household_members%rowtype;
  v_household_base text;
  v_goal uuid;
begin
  if v_user is null or v_household is null or v_name is null
     or v_target is null or v_target <= 0
     or v_currency is null or v_currency !~ '^[A-Z]{3}$'
     or (v_weekly is not null and v_weekly <= 0)
     or v_dedupe is null then
    raise exception 'KIPU_VALIDATION: invalid shared goal'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_dedupe,0)
  );
  select * into v_existing
    from public.household_action_applications
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  v_fingerprint := md5(concat_ws(
    '|',v_household::text,v_name,round(v_target,2)::text,v_currency,
    coalesce(round(v_weekly,2)::text,'')
  ));
  if found then
    if v_existing.action <> 'create_shared_goal'
       or v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: shared goal payload changed'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed','goal_id',v_existing.entity_id
    );
  end if;

  select upper(base_currency) into v_household_base
    from public.households
   where id = v_household
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: household not found'
      using errcode = '22023';
  end if;
  if v_household_base <> v_currency then
    raise exception 'KIPU_VALIDATION: shared goal must use household base currency'
      using errcode = '22023';
  end if;
  select * into v_member
    from public.household_members
   where household_id = v_household
     and user_id = v_user
     and status = 'active'
   for update;
  if not found
     or v_member.role not in ('owner','admin','member','contributor') then
    raise exception 'KIPU_OWNERSHIP: active writer membership required'
      using errcode = '42501';
  end if;

  insert into public.goals (
    user_id,name,target_amount,currency,current_amount,
    household_id,is_shared,status
  ) values (
    v_user,v_name,v_target,v_currency,0,
    v_household,true,'active'
  ) returning id into v_goal;

  if v_weekly is not null then
    insert into public.household_goal_contributions (
      household_id,goal_id,member_id,weekly_base
    ) values (
      v_household,v_goal,v_member.id,v_weekly
    );
  end if;
  insert into public.household_audit_log (
    household_id,actor_user_id,action,entity,detail
  ) values (
    v_household,v_user,'create_goal','goal',v_name
  );
  insert into public.household_action_applications (
    user_id,household_id,action,dedupe_key,fingerprint,entity_id
  ) values (
    v_user,v_household,'create_shared_goal',v_dedupe,v_fingerprint,v_goal
  );
  return jsonb_build_object('outcome','created','goal_id',v_goal);
end;
$$;

create or replace function public.kipu__shared_goal_currency_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
begin
  if coalesce(new.is_shared,false) is not true then
    return new;
  end if;
  if new.household_id is null then
    raise exception 'KIPU_VALIDATION: shared goal requires household'
      using errcode = '22023';
  end if;
  select upper(base_currency) into v_base
    from public.households
   where id = new.household_id
   for no key update;
  if not found or upper(coalesce(new.currency,'')) <> v_base then
    raise exception 'KIPU_VALIDATION: shared goal currency must equal household base'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Installing the guard over already-inconsistent rows would make future writes
-- safe while leaving today's household totals dimensionally false. Abort the
-- migration instead: the operator must repair or explicitly account for every
-- mismatch before 088 can claim this invariant.
do $$
begin
  if exists (
    select 1
      from public.goals g
      left join public.households h on h.id = g.household_id
     where coalesce(g.is_shared,false) is true
       and (
         g.household_id is null
         or h.id is null
         or upper(coalesce(g.currency,'')) <>
            upper(coalesce(h.base_currency,''))
       )
  ) then
    raise exception
      'KIPU_MIGRATION: shared goal currency differs from household base'
      using errcode = '22023';
  end if;
end;
$$;

drop trigger if exists shared_goals_household_currency_guard
  on public.goals;
create trigger shared_goals_household_currency_guard
before insert or update of currency, household_id, is_shared
on public.goals
for each row execute function public.kipu__shared_goal_currency_guard();

alter function public.kipu__shared_goal_currency_guard() owner to postgres;
revoke all on function public.kipu__shared_goal_currency_guard()
  from public, anon, authenticated, service_role;

create or replace function public.kipu_add_household_participant_atomic(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_name text := left(nullif(btrim(p->>'display_name'),''),60);
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_fingerprint text;
  v_existing public.household_action_applications%rowtype;
  v_member public.household_members%rowtype;
  v_id uuid;
begin
  if v_user is null or v_household is null or v_name is null or v_dedupe is null then
    raise exception 'KIPU_VALIDATION: invalid participant'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;
  v_fingerprint := md5(concat_ws('|',v_household::text,lower(v_name)));
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_dedupe,0)
  );
  select * into v_existing
    from public.household_action_applications
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  if found then
    if v_existing.action <> 'add_participant'
       or v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: participant payload changed'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed','member_id',v_existing.entity_id
    );
  end if;

  perform 1 from public.households where id = v_household for update;
  if not found then
    raise exception 'KIPU_VALIDATION: household not found'
      using errcode = '22023';
  end if;
  select * into v_member
    from public.household_members
   where household_id = v_household and user_id = v_user and status = 'active'
   for update;
  if not found or v_member.role not in ('owner','admin','member','contributor') then
    raise exception 'KIPU_OWNERSHIP: active writer membership required'
      using errcode = '42501';
  end if;

  insert into public.household_members (
    household_id,user_id,display_name,role,status,invited_by,joined_at
  ) values (
    v_household,null,v_name,'external','active',v_user,now()
  ) returning id into v_id;
  insert into public.household_audit_log (
    household_id,actor_user_id,action,entity,detail
  ) values (
    v_household,v_user,'add_member','member','no-usuario: ' || v_name
  );
  insert into public.household_action_applications (
    user_id,household_id,action,dedupe_key,fingerprint,entity_id
  ) values (
    v_user,v_household,'add_participant',v_dedupe,v_fingerprint,v_id
  );
  return jsonb_build_object('outcome','created','member_id',v_id);
end;
$$;

create or replace function public.kipu_create_household_invite_atomic(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_invited_text text := nullif(btrim(p->>'invited_user_id'),'');
  v_invited uuid;
  v_label text := left(nullif(btrim(p->>'label'),''),60);
  v_role text := coalesce(nullif(p->>'role',''),'member');
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_fingerprint text;
  v_existing public.household_action_applications%rowtype;
  v_member public.household_members%rowtype;
  v_id uuid;
  v_token text;
begin
  if v_invited_text is not null then
    begin
      v_invited := v_invited_text::uuid;
    exception when invalid_text_representation then
      raise exception 'KIPU_VALIDATION: invalid invited user'
        using errcode = '22023';
    end;
  end if;
  if v_user is null or v_household is null or v_dedupe is null
     or (v_invited is null and v_label is null)
     or v_role not in ('member','viewer','contributor') then
    raise exception 'KIPU_VALIDATION: invalid household invite'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;
  v_fingerprint := md5(concat_ws(
    '|',v_household::text,coalesce(v_invited::text,''),coalesce(v_label,''),v_role
  ));
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_dedupe,0)
  );
  select * into v_existing
    from public.household_action_applications
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  if found then
    if v_existing.action <> 'create_invite'
       or v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: invite payload changed'
        using errcode = '22023';
    end if;
    select token into v_token from public.household_invites
     where id = v_existing.entity_id;
    if v_token is null then
      raise exception 'KIPU_INVARIANT: invite marker without invite'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed','invite_id',v_existing.entity_id,'token',v_token
    );
  end if;

  perform 1 from public.households where id = v_household for update;
  if not found then
    raise exception 'KIPU_VALIDATION: household not found'
      using errcode = '22023';
  end if;
  select * into v_member
    from public.household_members
   where household_id = v_household and user_id = v_user and status = 'active'
   for update;
  if not found or v_member.role not in ('owner','admin') then
    raise exception 'KIPU_OWNERSHIP: owner/admin required'
      using errcode = '42501';
  end if;

  insert into public.household_invites (
    household_id,invited_user_id,invited_label,role,status,created_by
  ) values (
    v_household,v_invited,v_label,v_role,'pending',v_user
  ) returning id,token into v_id,v_token;
  insert into public.household_audit_log (
    household_id,actor_user_id,action,entity,detail
  ) values (
    v_household,v_user,'invite','member',
    coalesce(v_label,v_invited::text,'')
  );
  insert into public.household_action_applications (
    user_id,household_id,action,dedupe_key,fingerprint,entity_id
  ) values (
    v_user,v_household,'create_invite',v_dedupe,v_fingerprint,v_id
  );
  return jsonb_build_object(
    'outcome','created','invite_id',v_id,'token',v_token
  );
end;
$$;

create or replace function public.kipu_create_recurring_shared_expense_atomic(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_payer uuid := nullif(p->>'payer_member_id','')::uuid;
  v_description text := left(nullif(btrim(p->>'description'),''),120);
  v_category text := nullif(p->>'category','');
  v_amount numeric := nullif(p->>'amount_base','')::numeric;
  v_currency text := upper(nullif(btrim(p->>'base_currency'),''));
  v_method text := nullif(p->>'split_method','');
  v_cadence text := nullif(p->>'cadence','');
  v_anchor integer := nullif(p->>'anchor_day','')::integer;
  v_note text := left(nullif(p->>'note',''),200);
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_fingerprint text;
  v_existing public.household_action_applications%rowtype;
  v_member public.household_members%rowtype;
  v_base text;
  v_id uuid;
begin
  if v_user is null or v_household is null or v_payer is null
     or v_description is null or v_amount is null or v_amount <= 0
     or v_currency !~ '^[A-Z]{3}$'
     or v_method not in ('equal','percentage','fixed','income_weighted','custom','payer_absorbs')
     or v_cadence not in ('weekly','biweekly','monthly','annual')
     or (v_anchor is not null and (
       (v_cadence in ('weekly','biweekly') and (v_anchor < 0 or v_anchor > 6))
       or
       (v_cadence in ('monthly','annual') and (v_anchor < 1 or v_anchor > 28))
     ))
     or v_dedupe is null then
    raise exception 'KIPU_VALIDATION: invalid recurring shared expense'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;
  v_fingerprint := md5(concat_ws(
    '|',v_household::text,v_payer::text,v_description,coalesce(v_category,''),
    round(v_amount,2)::text,v_currency,v_method,v_cadence,
    coalesce(v_anchor::text,''),coalesce(v_note,'')
  ));
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_dedupe,0)
  );
  select * into v_existing
    from public.household_action_applications
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  if found then
    if v_existing.action <> 'create_recurring'
       or v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: recurring payload changed'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed','recurring_id',v_existing.entity_id
    );
  end if;

  select base_currency into v_base
    from public.households where id = v_household for update;
  if not found or upper(v_base) <> v_currency then
    raise exception 'KIPU_VALIDATION: household base currency mismatch'
      using errcode = '22023';
  end if;
  select * into v_member
    from public.household_members
   where household_id = v_household and user_id = v_user and status = 'active'
   for update;
  if not found or v_member.role not in ('owner','admin','member','contributor') then
    raise exception 'KIPU_OWNERSHIP: active writer membership required'
      using errcode = '42501';
  end if;
  perform 1 from public.household_members
   where id = v_payer and household_id = v_household and status = 'active'
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: payer is not an active household member'
      using errcode = '22023';
  end if;

  insert into public.household_recurring_expenses (
    household_id,payer_member_id,description,category,amount_base,
    base_currency,split_method,cadence,anchor_day,active,note,created_by
  ) values (
    v_household,v_payer,v_description,v_category,v_amount,
    v_currency,v_method,v_cadence,v_anchor,true,v_note,v_user
  ) returning id into v_id;
  insert into public.household_audit_log (
    household_id,actor_user_id,action,entity,detail
  ) values (
    v_household,v_user,'add_recurring','recurring',
    v_description || ' ' || round(v_amount,2)::text
  );
  insert into public.household_action_applications (
    user_id,household_id,action,dedupe_key,fingerprint,entity_id
  ) values (
    v_user,v_household,'create_recurring',v_dedupe,v_fingerprint,v_id
  );
  return jsonb_build_object('outcome','created','recurring_id',v_id);
end;
$$;

create or replace function public.kipu_add_shared_expense_idempotent(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_expense jsonb := p->'expense';
  v_fingerprint text;
  v_existing public.household_action_applications%rowtype;
  v_result jsonb;
  v_id uuid;
begin
  if v_user is null or v_household is null or v_dedupe is null
     or jsonb_typeof(v_expense) is distinct from 'object'
     or nullif(v_expense->>'created_by','')::uuid is distinct from v_user
     or nullif(v_expense->>'household_id','')::uuid is distinct from v_household then
    raise exception 'KIPU_VALIDATION: invalid shared expense application'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;
  v_fingerprint := md5(v_expense::text);
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_dedupe,0)
  );
  select * into v_existing
    from public.household_action_applications
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  if found then
    if v_existing.action <> 'add_shared_expense'
       or v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: shared expense payload changed'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed','expense_id',v_existing.entity_id
    );
  end if;

  v_result := public.kipu_add_shared_expense_v2(v_expense);
  v_id := nullif(v_result->>'expense_id','')::uuid;
  if v_id is null then
    raise exception 'KIPU_INVARIANT: shared expense writer returned no id'
      using errcode = '22023';
  end if;
  insert into public.household_action_applications (
    user_id,household_id,action,dedupe_key,fingerprint,entity_id,result
  ) values (
    v_user,v_household,'add_shared_expense',v_dedupe,v_fingerprint,v_id,
    v_result || jsonb_build_object('outcome','created')
  );
  insert into public.household_audit_log (
    household_id,actor_user_id,action,entity,detail
  ) values (
    v_household,v_user,'add_expense','expense',
    left(
      coalesce(v_expense->>'description','Gasto compartido') || ' ' ||
      coalesce(v_expense->>'total_base',''),
      200
    )
  );
  return v_result || jsonb_build_object('outcome','created');
end;
$$;

create or replace function public.kipu_mark_reimbursement_idempotent(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_core jsonb := p - 'user_id' - 'dedupe_key';
  v_fingerprint text;
  v_existing public.household_action_applications%rowtype;
  v_result jsonb;
  v_id uuid;
begin
  if v_user is null or v_household is null or v_dedupe is null
     or nullif(v_core->>'created_by','')::uuid is distinct from v_user then
    raise exception 'KIPU_VALIDATION: invalid reimbursement application'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;
  v_fingerprint := md5(v_core::text);
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_dedupe,0)
  );
  select * into v_existing
    from public.household_action_applications
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  if found then
    if v_existing.action <> 'mark_reimbursement'
       or v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: reimbursement payload changed'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed','settlement_id',v_existing.entity_id
    );
  end if;

  v_result := public.kipu_mark_reimbursement_paid(v_core);
  v_id := nullif(v_result->>'settlement_id','')::uuid;
  if v_id is null then
    raise exception 'KIPU_INVARIANT: reimbursement writer returned no id'
      using errcode = '22023';
  end if;
  insert into public.household_action_applications (
    user_id,household_id,action,dedupe_key,fingerprint,entity_id,result
  ) values (
    v_user,v_household,'mark_reimbursement',v_dedupe,v_fingerprint,v_id,
    v_result || jsonb_build_object('outcome','created')
  );
  insert into public.household_audit_log (
    household_id,actor_user_id,action,entity,detail
  ) values (
    v_household,v_user,'mark_paid','settlement',
    left(coalesce(v_core->>'amount_base',''),200)
  );
  return v_result || jsonb_build_object('outcome','created');
end;
$$;

-- Existing household UPDATE/CANCEL paths were financially guarded by locks/CAS,
-- but their audit row was a second best-effort HTTP write. A response loss also
-- made a safe replay look like a fresh failure ("already cancelled" / stale
-- snapshot). Keep mutation + audit + delivery marker in one transaction for
-- every lifecycle write the agent exposes.
create or replace function public.kipu_apply_household_mutation_idempotent(
  p jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_action text := nullif(p->>'action','');
  v_payload jsonb := coalesce(p->'payload','{}'::jsonb);
  v_fingerprint text;
  v_existing public.household_action_applications%rowtype;
  v_result jsonb;
  v_entity uuid;
  v_member uuid;
  v_target uuid;
  v_actor_role text;
  v_target_role text;
  v_target_name text;
  v_target_user uuid;
  v_privacy text;
begin
  if v_user is null or v_household is null or v_dedupe is null
     or jsonb_typeof(v_payload) is distinct from 'object'
     or v_action not in (
       'cancel_shared_expense',
       'update_shared_expense',
       'settle_household',
       'leave_household',
       'transfer_ownership',
       'remove_member',
       'set_visibility',
       'remove_recurring'
     )
  then
    raise exception 'KIPU_VALIDATION: invalid household mutation application'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;

  v_fingerprint := md5(
    jsonb_build_object('action',v_action,'payload',v_payload)::text
  );
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_dedupe,0)
  );
  select * into v_existing
    from public.household_action_applications
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  if found then
    if v_existing.action <> v_action
       or v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: household mutation payload changed'
        using errcode = '22023';
    end if;
    return coalesce(
      v_existing.result,
      jsonb_build_object('entity_id',v_existing.entity_id)
    ) || jsonb_build_object('outcome','replayed');
  end if;

  -- One lock is shared by every branch and by the legacy household cores.
  perform 1 from public.households where id = v_household for update;
  if not found then
    raise exception 'KIPU_VALIDATION: household not found'
      using errcode = '22023';
  end if;

  if v_action = 'cancel_shared_expense' then
    v_entity := nullif(v_payload->>'expense_id','')::uuid;
    if v_entity is null then
      raise exception 'KIPU_VALIDATION: expense_id required'
        using errcode = '22023';
    end if;
    v_result := public.kipu_cancel_shared_expense(
      v_payload || jsonb_build_object(
        'household_id',v_household,
        'created_by',v_user
      )
    );
    insert into public.household_audit_log (
      household_id,actor_user_id,action,entity,detail
    ) values (
      v_household,v_user,'cancel_expense','expense',v_entity::text
    );

  elsif v_action = 'update_shared_expense' then
    v_entity := nullif(v_payload->>'expense_id','')::uuid;
    if v_entity is null then
      raise exception 'KIPU_VALIDATION: expense_id required'
        using errcode = '22023';
    end if;
    v_result := public.kipu_update_shared_expense_v2(
      v_payload || jsonb_build_object(
        'household_id',v_household,
        'created_by',v_user
      )
    );
    insert into public.household_audit_log (
      household_id,actor_user_id,action,entity,detail
    ) values (
      v_household,v_user,'edit_expense','expense',v_entity::text
    );

  elsif v_action = 'settle_household' then
    v_entity := v_household;
    v_result := public.kipu_settle_household_v2(
      v_payload || jsonb_build_object(
        'household_id',v_household,
        'created_by',v_user
      )
    );
    insert into public.household_audit_log (
      household_id,actor_user_id,action,entity,detail
    ) values (
      v_household,v_user,'settle_household','settlement',
      left(coalesce(v_result->>'settled','0') || ' transferencias',200)
    );

  elsif v_action = 'leave_household' then
    select id,role into v_member,v_actor_role
      from public.household_members
     where household_id = v_household
       and user_id = v_user
       and status = 'active'
     for update;
    if v_member is null then
      raise exception 'KIPU_VALIDATION: actor is not an active member'
        using errcode = '22023';
    end if;
    -- Leaving the owner_id behind with no active owner creates an orphaned
    -- group nobody can administer. The agent exposes transfer_ownership as
    -- the explicit, atomic remedy.
    if v_actor_role = 'owner' then
      raise exception 'KIPU_VALIDATION: owner must transfer ownership before leaving'
        using errcode = '22023';
    end if;
    update public.household_members
       set status = 'left', updated_at = now()
     where id = v_member and status = 'active';
    if not found then
      raise exception 'KIPU_INVARIANT: membership changed under lock'
        using errcode = '22023';
    end if;
    v_entity := v_member;
    v_result := jsonb_build_object('member_id',v_member);
    insert into public.household_audit_log (
      household_id,actor_user_id,action,entity,detail
    ) values (v_household,v_user,'leave','member','');

  elsif v_action = 'transfer_ownership' then
    v_target := nullif(v_payload->>'member_id','')::uuid;
    if v_target is null then
      raise exception 'KIPU_VALIDATION: member_id required'
        using errcode = '22023';
    end if;
    select id,role into v_member,v_actor_role
      from public.household_members
     where household_id = v_household
       and user_id = v_user
       and status = 'active'
     for update;
    if v_member is null or v_actor_role <> 'owner' then
      raise exception 'KIPU_OWNERSHIP: only current owner can transfer ownership'
        using errcode = '42501';
    end if;
    perform 1 from public.households
     where id = v_household and owner_id = v_user
     for update;
    if not found then
      raise exception 'KIPU_INVARIANT: household owner and owner membership disagree'
        using errcode = '22023';
    end if;
    select user_id,display_name into v_target_user,v_target_name
      from public.household_members
     where id = v_target
       and household_id = v_household
       and status = 'active'
     for update;
    if v_target_user is null then
      raise exception 'KIPU_VALIDATION: successor must be an active Kipu user'
        using errcode = '22023';
    end if;
    if v_target = v_member or v_target_user = v_user then
      raise exception 'KIPU_VALIDATION: successor must be another member'
        using errcode = '22023';
    end if;
    update public.household_members
       set role = case when id = v_member then 'admin' else 'owner' end,
           updated_at = now()
     where id in (v_member,v_target);
    if (select count(*) from public.household_members
         where household_id = v_household
           and role = 'owner'
           and status = 'active') <> 1 then
      raise exception 'KIPU_INVARIANT: ownership transfer did not leave one owner'
        using errcode = '22023';
    end if;
    update public.households
       set owner_id = v_target_user, updated_at = now()
     where id = v_household and owner_id = v_user;
    if not found then
      raise exception 'KIPU_INVARIANT: household owner changed under lock'
        using errcode = '22023';
    end if;
    v_entity := v_target;
    v_result := jsonb_build_object(
      'member_id',v_target,'new_owner_user_id',v_target_user
    );
    insert into public.household_audit_log (
      household_id,actor_user_id,action,entity,detail
    ) values (
      v_household,v_user,'transfer_ownership','member',
      left(coalesce(v_target_name,''),200)
    );

  elsif v_action = 'remove_member' then
    perform public.kipu__household_actor(v_household,v_user,true);
    v_target := nullif(v_payload->>'member_id','')::uuid;
    if v_target is null then
      raise exception 'KIPU_VALIDATION: member_id required'
        using errcode = '22023';
    end if;
    select id,role into v_member,v_actor_role
      from public.household_members
     where household_id = v_household
       and user_id = v_user
       and status = 'active';
    select role,display_name into v_target_role,v_target_name
      from public.household_members
     where id = v_target
       and household_id = v_household
       and status = 'active'
     for update;
    if v_target_role is null then
      raise exception 'KIPU_VALIDATION: target member not found'
        using errcode = '22023';
    end if;
    if v_target = v_member then
      raise exception 'KIPU_VALIDATION: use leave_household for yourself'
        using errcode = '22023';
    end if;
    if v_target_role = 'owner' then
      raise exception 'KIPU_OWNERSHIP: household owner cannot be removed'
        using errcode = '42501';
    end if;
    if v_target_role = 'admin' and v_actor_role <> 'owner' then
      raise exception 'KIPU_OWNERSHIP: only owner can remove an admin'
        using errcode = '42501';
    end if;
    update public.household_members
       set status = 'removed', updated_at = now()
     where id = v_target and status = 'active';
    if not found then
      raise exception 'KIPU_INVARIANT: target changed under lock'
        using errcode = '22023';
    end if;
    v_entity := v_target;
    v_result := jsonb_build_object('member_id',v_target);
    insert into public.household_audit_log (
      household_id,actor_user_id,action,entity,detail
    ) values (
      v_household,v_user,'remove','member',left(coalesce(v_target_name,''),200)
    );

  elsif v_action = 'set_visibility' then
    perform public.kipu__household_actor(v_household,v_user,true);
    v_privacy := nullif(v_payload->>'privacy_mode','');
    if v_privacy not in ('minimal','standard','full') then
      raise exception 'KIPU_VALIDATION: invalid privacy mode'
        using errcode = '22023';
    end if;
    update public.households
       set privacy_mode = v_privacy, updated_at = now()
     where id = v_household;
    v_entity := v_household;
    v_result := jsonb_build_object('household_id',v_household,'privacy_mode',v_privacy);
    insert into public.household_audit_log (
      household_id,actor_user_id,action,entity,detail
    ) values (
      v_household,v_user,'set_visibility','household',v_privacy
    );

  elsif v_action = 'remove_recurring' then
    perform public.kipu__household_actor(v_household,v_user,false);
    v_target := nullif(v_payload->>'recurring_id','')::uuid;
    if v_target is null then
      raise exception 'KIPU_VALIDATION: recurring_id required'
        using errcode = '22023';
    end if;
    update public.household_recurring_expenses
       set active = false, updated_at = now()
     where id = v_target
       and household_id = v_household
       and active = true;
    if not found then
      raise exception 'KIPU_VALIDATION: recurring expense not found or inactive'
        using errcode = '22023';
    end if;
    v_entity := v_target;
    v_result := jsonb_build_object('recurring_id',v_target);
    insert into public.household_audit_log (
      household_id,actor_user_id,action,entity,detail
    ) values (
      v_household,v_user,'remove_recurring','recurring',v_target::text
    );
  end if;

  insert into public.household_action_applications (
    user_id,household_id,action,dedupe_key,fingerprint,entity_id,result
  ) values (
    v_user,v_household,v_action,v_dedupe,v_fingerprint,v_entity,
    v_result || jsonb_build_object('outcome','created')
  );
  return v_result || jsonb_build_object('outcome','created');
end;
$$;

-- Learning is still a write. The old merchant correction path performed a
-- best-effort read followed by UPDATE/INSERT, returned success on a zero-row
-- UPDATE, lost concurrent counter increments and replayed a webhook as another
-- "correction". Keep the fact and its operation marker in one transaction.
create table if not exists public.merchant_correction_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation_id text not null check (btrim(operation_id) <> ''),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{32}$'),
  merchant_memory_id uuid not null
    references public.user_merchant_memory(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, operation_id)
);

alter table public.merchant_correction_applications enable row level security;
revoke all on table public.merchant_correction_applications
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.merchant_correction_applications to service_role;

create or replace function public.kipu_save_merchant_correction(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation text := nullif(btrim(p->>'operation_id'),'');
  v_pattern text := lower(nullif(btrim(p->>'match_pattern'),''));
  v_source text := coalesce(nullif(p->>'source',''),'user_correction');
  v_fingerprint text;
  v_application public.merchant_correction_applications%rowtype;
  v_memory_id uuid;
  v_count integer;
  v_outcome text;
begin
  if v_user is null or v_operation is null or v_pattern is null
     or length(v_pattern) < 2 then
    raise exception 'KIPU_VALIDATION: merchant correction identity required'
      using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> v_user then
    raise exception 'KIPU_OWNERSHIP: user mismatch' using errcode = '42501';
  end if;
  if p ? 'category' and p->>'category' is not null
     and p->>'category' not in (
       'housing','utilities','food','transport','health','education',
       'subscriptions','debt','shopping','entertainment','family',
       'savings','income','travel','other'
     ) then
    raise exception 'KIPU_VALIDATION: invalid merchant category'
      using errcode = '22023';
  end if;
  if v_source not in ('user_correction','inferred','system') then
    raise exception 'KIPU_VALIDATION: invalid merchant correction source'
      using errcode = '22023';
  end if;
  if p ? 'is_recurring' and p->'is_recurring' <> 'null'::jsonb
     and jsonb_typeof(p->'is_recurring') <> 'boolean' then
    raise exception 'KIPU_VALIDATION: is_recurring must be boolean or null'
      using errcode = '22023';
  end if;

  v_fingerprint := md5((p - 'operation_id')::text);
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':merchant-operation:' || v_operation, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':merchant-pattern:' || v_pattern, 0)
  );

  select * into v_application
    from public.merchant_correction_applications
   where user_id = v_user and operation_id = v_operation
   for update;
  if found then
    if v_application.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: merchant correction payload changed'
        using errcode = '22023';
    end if;
    select correction_count into v_count
      from public.user_merchant_memory
     where id = v_application.merchant_memory_id and user_id = v_user;
    if not found then
      raise exception 'KIPU_INVARIANT: merchant correction target disappeared'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed',
      'memory_id',v_application.merchant_memory_id,
      'correction_count',v_count
    );
  end if;

  select id into v_memory_id
    from public.user_merchant_memory
   where user_id = v_user and match_pattern = v_pattern
   for update;
  if found then
    update public.user_merchant_memory
       set merchant_family = case when p ? 'merchant_family'
             then nullif(p->>'merchant_family','') else merchant_family end,
           category = case when p ? 'category'
             then nullif(p->>'category','') else category end,
           spending_type = case when p ? 'spending_type'
             then nullif(p->>'spending_type','') else spending_type end,
           is_recurring = case when p ? 'is_recurring'
             then (p->>'is_recurring')::boolean else is_recurring end,
           note = case when p ? 'note'
             then nullif(p->>'note','') else note end,
           correction_count = correction_count + 1,
           updated_at = now()
     where id = v_memory_id and user_id = v_user
     returning correction_count into v_count;
    v_outcome := 'updated';
  else
    insert into public.user_merchant_memory (
      user_id,match_pattern,merchant_family,category,spending_type,
      is_recurring,note,source,correction_count,updated_at
    ) values (
      v_user,v_pattern,nullif(p->>'merchant_family',''),
      nullif(p->>'category',''),nullif(p->>'spending_type',''),
      case when p ? 'is_recurring' then (p->>'is_recurring')::boolean end,
      nullif(p->>'note',''),v_source,1,now()
    )
    returning id,correction_count into v_memory_id,v_count;
    v_outcome := 'created';
  end if;

  insert into public.merchant_correction_applications (
    user_id,operation_id,fingerprint,merchant_memory_id
  ) values (v_user,v_operation,v_fingerprint,v_memory_id);

  return jsonb_build_object(
    'outcome',v_outcome,'memory_id',v_memory_id,'correction_count',v_count
  );
end;
$$;

alter function public.kipu_create_household_atomic(jsonb) owner to postgres;
alter function public.kipu_respond_household_invite_atomic(jsonb) owner to postgres;
alter function public.kipu_create_shared_goal_atomic(jsonb) owner to postgres;
alter function public.kipu_add_household_participant_atomic(jsonb) owner to postgres;
alter function public.kipu_create_household_invite_atomic(jsonb) owner to postgres;
alter function public.kipu_create_recurring_shared_expense_atomic(jsonb) owner to postgres;
alter function public.kipu_add_shared_expense_idempotent(jsonb) owner to postgres;
alter function public.kipu_mark_reimbursement_idempotent(jsonb) owner to postgres;
alter function public.kipu_apply_household_mutation_idempotent(jsonb)
  owner to postgres;
alter function public.kipu_record_debt_statement_cycle_idempotent(jsonb)
  owner to postgres;
alter function public.kipu_save_merchant_correction(jsonb) owner to postgres;
revoke all on function public.kipu_create_household_atomic(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_respond_household_invite_atomic(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_create_shared_goal_atomic(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_add_household_participant_atomic(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_create_household_invite_atomic(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_create_recurring_shared_expense_atomic(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_add_shared_expense_idempotent(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_mark_reimbursement_idempotent(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_apply_household_mutation_idempotent(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_record_debt_statement_cycle_idempotent(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_save_merchant_correction(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_create_household_atomic(jsonb)
  to service_role;
grant execute on function public.kipu_respond_household_invite_atomic(jsonb)
  to service_role;
grant execute on function public.kipu_create_shared_goal_atomic(jsonb)
  to service_role;
grant execute on function public.kipu_add_household_participant_atomic(jsonb)
  to service_role;
grant execute on function public.kipu_create_household_invite_atomic(jsonb)
  to service_role;
grant execute on function public.kipu_create_recurring_shared_expense_atomic(jsonb)
  to service_role;
grant execute on function public.kipu_add_shared_expense_idempotent(jsonb)
  to service_role;
grant execute on function public.kipu_mark_reimbursement_idempotent(jsonb)
  to service_role;
grant execute on function public.kipu_apply_household_mutation_idempotent(jsonb)
  to service_role;
grant execute on function public.kipu_record_debt_statement_cycle_idempotent(jsonb)
  to service_role;
grant execute on function public.kipu_save_merchant_correction(jsonb)
  to service_role;

commit;
