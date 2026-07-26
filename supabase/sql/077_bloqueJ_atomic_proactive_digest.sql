-- Migration 077 — Bloque J-4 re-audit: the proactive cap and calendar digest
-- are durable facts, not a count followed by unrelated writes.
--
-- Additive only. The human applies this migration before deploying the code
-- that calls the three new RPCs.

begin;

alter table public.ambient_nudges
  add column if not exists budget_lane text not null default 'coach',
  add column if not exists claim_token uuid,
  add column if not exists lease_until timestamptz,
  add column if not exists claim_payload jsonb not null default '{}'::jsonb,
  add column if not exists web_message_id uuid references public.chat_messages(id) on delete set null,
  add column if not exists finalized_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ambient_nudges_budget_lane_chk'
      and conrelid = 'public.ambient_nudges'::regclass
  ) then
    alter table public.ambient_nudges
      add constraint ambient_nudges_budget_lane_chk
      check (budget_lane in ('coach', 'calendar'));
  end if;
end;
$$;

create index if not exists ambient_nudges_user_day_lane_idx
  on public.ambient_nudges (user_id, day_bucket, budget_lane)
  where status = 'sent';

create or replace function public.kipu_claim_proactive_nudge(
  p_user_id uuid,
  p_topic text,
  p_day_bucket date,
  p_reason text,
  p_priority integer,
  p_channel text,
  p_total_cap integer,
  p_budget_lane text,
  p_lane_cap integer,
  p_claim_token uuid,
  p_claim_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.ambient_nudges%rowtype;
  v_total_cap integer := least(greatest(coalesce(p_total_cap, 0), 0), 2);
  v_lane_cap integer;
  v_total integer;
  v_lane integer;
  v_id uuid;
begin
  if p_user_id is null
     or nullif(btrim(p_topic), '') is null
     or p_day_bucket is null
     or p_claim_token is null
     or p_budget_lane not in ('coach', 'calendar')
     or p_channel not in ('telegram', 'web')
     or jsonb_typeof(coalesce(p_claim_payload, '{}'::jsonb)) <> 'object'
  then
    raise exception 'KIPU_VALIDATION: invalid proactive claim'
      using errcode = '22023';
  end if;

  v_lane_cap := least(greatest(coalesce(p_lane_cap, 0), 0), v_total_cap);

  -- One serialization point for every proactive producer for this user/day.
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_day_bucket::text, 0)
  );

  select *
    into v_existing
  from public.ambient_nudges
  where user_id = p_user_id
    and topic = p_topic
    and day_bucket = p_day_bucket
    and status = 'sent'
  for update;

  if found then
    if v_existing.delivered then
      return jsonb_build_object(
        'outcome', 'already_delivered',
        'id', v_existing.id
      );
    end if;
    -- Telegram is an external side effect: a timeout cannot prove whether the
    -- message landed. Coach claims therefore remain at-most-once after the
    -- claim is acquired. Only a KNOWN pre-delivery failure explicitly changes
    -- the row to `failed` and frees the slot. Calendar claims are recoverable
    -- because their web message + state transitions live in our own atomic RPC.
    if v_existing.budget_lane = 'coach' then
      return jsonb_build_object(
        'outcome', 'already_attempted',
        'id', v_existing.id
      );
    end if;
    if v_existing.lease_until is not null
       and v_existing.lease_until > clock_timestamp()
    then
      return jsonb_build_object(
        'outcome', 'in_progress',
        'id', v_existing.id
      );
    end if;

    update public.ambient_nudges
    set claim_token = p_claim_token,
        lease_until = clock_timestamp() + interval '5 minutes',
        claim_payload = coalesce(p_claim_payload, '{}'::jsonb),
        reason = left(coalesce(p_reason, ''), 200),
        priority = p_priority,
        channel = p_channel,
        budget_lane = p_budget_lane,
        telegram_error = null
    where id = v_existing.id;

    return jsonb_build_object(
      'outcome', 'claimed',
      'id', v_existing.id,
      'recovered', true
    );
  end if;

  select count(*)
    into v_total
  from public.ambient_nudges
  where user_id = p_user_id
    and day_bucket = p_day_bucket
    and status = 'sent';

  select count(*)
    into v_lane
  from public.ambient_nudges
  where user_id = p_user_id
    and day_bucket = p_day_bucket
    and status = 'sent'
    and budget_lane = p_budget_lane;

  if v_total >= v_total_cap or v_lane >= v_lane_cap then
    return jsonb_build_object('outcome', 'cap_reached');
  end if;

  insert into public.ambient_nudges (
    user_id,
    topic,
    day_bucket,
    channel,
    status,
    reason,
    priority,
    budget_lane,
    claim_token,
    lease_until,
    claim_payload
  )
  values (
    p_user_id,
    p_topic,
    p_day_bucket,
    p_channel,
    'sent',
    left(coalesce(p_reason, ''), 200),
    p_priority,
    p_budget_lane,
    p_claim_token,
    clock_timestamp() + interval '5 minutes',
    coalesce(p_claim_payload, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object(
    'outcome', 'claimed',
    'id', v_id,
    'recovered', false
  );
end;
$$;

create or replace function public.kipu_fail_proactive_claim(
  p_user_id uuid,
  p_claim_id uuid,
  p_claim_token uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  update public.ambient_nudges
  set status = 'failed',
      delivered = false,
      telegram_error = left(coalesce(p_reason, 'pre_delivery_failed'), 300),
      lease_until = null,
      finalized_at = clock_timestamp()
  where id = p_claim_id
    and user_id = p_user_id
    and claim_token = p_claim_token
    and delivered = false
    and finalized_at is null;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.kipu_publish_calendar_digest(
  p_user_id uuid,
  p_claim_id uuid,
  p_claim_token uuid,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim public.ambient_nudges%rowtype;
  v_payload jsonb;
  v_confirms jsonb;
  v_asks jsonb;
  v_item jsonb;
  v_occ public.recurring_occurrences%rowtype;
  v_id uuid;
  v_expected integer;
  v_today date;
  v_web_message_id uuid;
  v_total_items integer;
  v_distinct_items integer;
begin
  if p_user_id is null
     or p_claim_id is null
     or p_claim_token is null
     or nullif(btrim(p_content), '') is null
  then
    raise exception 'KIPU_VALIDATION: invalid calendar digest publication'
      using errcode = '22023';
  end if;

  select *
    into v_claim
  from public.ambient_nudges
  where id = p_claim_id
    and user_id = p_user_id
    and topic = 'calendar_digest'
    and budget_lane = 'calendar'
    and status = 'sent'
  for update;

  if not found then
    raise exception 'KIPU_OWNERSHIP: calendar digest claim not found'
      using errcode = '42501';
  end if;

  if v_claim.delivered then
    if v_claim.web_message_id is null then
      raise exception 'KIPU_CONFLICT: delivered calendar digest has no web message'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'outcome', 'replayed',
      'web_message_id', v_claim.web_message_id,
      'auto_notified', jsonb_array_length(coalesce(v_claim.claim_payload->'confirms', '[]'::jsonb)),
      'asked', jsonb_array_length(coalesce(v_claim.claim_payload->'asks', '[]'::jsonb))
    );
  end if;

  if v_claim.claim_token is distinct from p_claim_token
     or v_claim.lease_until is null
     or v_claim.lease_until <= clock_timestamp()
  then
    raise exception 'KIPU_CONFLICT: calendar digest lease is not owned'
      using errcode = '40001';
  end if;

  v_payload := coalesce(v_claim.claim_payload, '{}'::jsonb);
  if (v_payload->>'version') is distinct from '1'
     or jsonb_typeof(v_payload->'confirms') is distinct from 'array'
     or jsonb_typeof(v_payload->'asks') is distinct from 'array'
     or coalesce((v_payload->>'today') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false) = false
  then
    raise exception 'KIPU_VALIDATION: invalid calendar digest payload'
      using errcode = '22023';
  end if;

  begin
    v_today := (v_payload->>'today')::date;
  exception when others then
    raise exception 'KIPU_VALIDATION: invalid calendar digest day'
      using errcode = '22023';
  end;
  if v_today is distinct from v_claim.day_bucket then
    raise exception 'KIPU_VALIDATION: calendar digest day does not match its claim'
      using errcode = '22023';
  end if;

  v_confirms := v_payload->'confirms';
  v_asks := v_payload->'asks';

  select count(*), count(distinct item->>'id')
    into v_total_items, v_distinct_items
  from (
    select value as item from jsonb_array_elements(v_confirms)
    union all
    select value as item from jsonb_array_elements(v_asks)
  ) q;
  if v_total_items = 0 or v_total_items <> v_distinct_items then
    raise exception 'KIPU_VALIDATION: duplicate occurrence in calendar digest'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(v_confirms)
  loop
    begin
      v_id := (v_item->>'id')::uuid;
    exception when others then
      raise exception 'KIPU_VALIDATION: invalid confirm occurrence id'
        using errcode = '22023';
    end;
    select *
      into v_occ
    from public.recurring_occurrences
    where id = v_id
      and user_id = p_user_id
    for update;
    if not found or v_occ.status <> 'booked' or v_occ.notified then
      raise exception 'KIPU_CONFLICT: confirm occurrence changed before publication'
        using errcode = '40001';
    end if;
    update public.recurring_occurrences
    set notified = true
    where id = v_id
      and user_id = p_user_id;
  end loop;

  for v_item in select value from jsonb_array_elements(v_asks)
  loop
    begin
      v_id := (v_item->>'id')::uuid;
      v_expected := (v_item->>'expectedAskCount')::integer;
    exception when others then
      raise exception 'KIPU_VALIDATION: invalid ask occurrence payload'
        using errcode = '22023';
    end;
    if v_expected < 0 or v_expected >= 3 then
      raise exception 'KIPU_VALIDATION: invalid expected ask count'
        using errcode = '22023';
    end if;
    select *
      into v_occ
    from public.recurring_occurrences
    where id = v_id
      and user_id = p_user_id
    for update;
    if not found
       or v_occ.status <> 'pending'
       or v_occ.ask_count <> v_expected
    then
      raise exception 'KIPU_CONFLICT: ask occurrence changed before publication'
        using errcode = '40001';
    end if;
    update public.recurring_occurrences
    set ask_count = v_expected + 1,
        last_asked_on = v_today,
        notified = true
    where id = v_id
      and user_id = p_user_id;
  end loop;

  insert into public.chat_messages (
    user_id,
    channel,
    chat_id,
    role,
    content,
    message_type,
    metadata
  )
  values (
    p_user_id,
    'web',
    null,
    'assistant',
    left(btrim(p_content), 2000),
    'advisory',
    jsonb_build_object(
      'source', 'recurring',
      'calendarDigestClaimId', p_claim_id
    )
  )
  returning id into v_web_message_id;

  update public.ambient_nudges
  set delivered = true,
      message_preview = left(btrim(p_content), 160),
      web_message_id = v_web_message_id,
      finalized_at = clock_timestamp(),
      lease_until = null,
      telegram_error = null
  where id = p_claim_id
    and user_id = p_user_id
    and claim_token = p_claim_token;

  return jsonb_build_object(
    'outcome', 'published',
    'web_message_id', v_web_message_id,
    'auto_notified', jsonb_array_length(v_confirms),
    'asked', jsonb_array_length(v_asks)
  );
end;
$$;

alter function public.kipu_claim_proactive_nudge(
  uuid, text, date, text, integer, text, integer, text, integer, uuid, jsonb
) owner to postgres;
alter function public.kipu_fail_proactive_claim(uuid, uuid, uuid, text) owner to postgres;
alter function public.kipu_publish_calendar_digest(uuid, uuid, uuid, text) owner to postgres;

revoke all on function public.kipu_claim_proactive_nudge(
  uuid, text, date, text, integer, text, integer, text, integer, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.kipu_fail_proactive_claim(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.kipu_publish_calendar_digest(uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.kipu_claim_proactive_nudge(
  uuid, text, date, text, integer, text, integer, text, integer, uuid, jsonb
) to service_role;
grant execute on function public.kipu_fail_proactive_claim(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.kipu_publish_calendar_digest(uuid, uuid, uuid, text)
  to service_role;

commit;
