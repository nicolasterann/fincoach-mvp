-- ⚠ SUPERSEDIDA EN PARTE POR LA 081: los `raise ... using errcode = '40001'` de
-- esta migración incluyen rechazos DETERMINISTAS, y PostgREST reintenta ese
-- SQLSTATE hasta devolver HTTP 504. La 081 los baja a '22023' conservando 40001
-- sólo en los CAS transitorios. Si se reaplica esta migración, hay que reaplicar
-- la 081 después.
-- Kipu — Bloque J-7, auditoría externa:
--   1) el cierre mensual se publica como UN hecho atómico;
--   2) el coach ambient deja procedencia durable ANTES de salir a Telegram;
--   3) `adjustment` deja de ser la última puerta cross-currency del ledger.
--
-- APLICAR antes del código que llama `kipu_publish_objective_month_close`.
-- Aditiva: no modifica la 078 aplicada; reemplaza el cuerpo vivo del guard por
-- una versión más estricta y crea una RPC nueva.

begin;

-- El cierre deja de ser una convención del cron. El usuario puede leer su
-- historial, pero ninguna sesión authenticated puede insertar/editar la fila
-- permanente por fuera de la publicación atómica o de los tools service-role
-- que resuelven el destino.
revoke insert, update, delete, truncate, references, trigger
  on table public.objective_month_closes from authenticated;
grant select on table public.objective_month_closes to authenticated;

-- La 078 cerró transfer/refund pero conservó `adjustment` exento "por
-- construcción". Eso vuelve a proteger una invariante con una convención:
-- cualquier caller nuevo podía mandar 100 ARS contra una cuenta USD y el efecto
-- adjustment restaba 100 del balance ORIGINAL USD. Reconcile e inversión ya
-- construyen adjustments en la moneda de la cuenta, así que validar esa pata no
-- rompe los writers legítimos.
create or replace function public.kipu__validate_cash_movement_currency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ocur  text;
  v_base  text;
  v_cur   text;
  v_id    uuid;
begin
  if new.type::text not in (
    'expense','income','goal_contribution','transfer','refund','adjustment'
  ) then
    return new;
  end if;
  v_ocur := upper(coalesce(new.original_currency::text,''));

  for v_id in
    select x
      from unnest(array[new.source_account_id, new.destination_account_id]) as t(x)
     where x is not null
     order by 1
  loop
    select upper(coalesce(currency,'')) into v_cur
      from public.accounts
     where id = v_id and user_id = new.user_id
     for no key update;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: % in % cannot hit account % in % (ledger moves the ORIGINAL amount on that account balance)',
        new.type, v_ocur, v_id, coalesce(v_cur,'?');
    end if;
  end loop;

  if new.type::text = 'expense' and new.debt_account_id is not null then
    select upper(coalesce(currency,'')) into v_cur
      from public.debt_accounts
     where id = new.debt_account_id and user_id = new.user_id
     for no key update;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: card expense in % cannot hit a card in % (ledger raises the card debt by the ORIGINAL amount)',
        v_ocur, coalesce(v_cur,'?');
    end if;
  end if;

  if new.type::text = 'goal_contribution' and new.goal_id is not null then
    select upper(coalesce(currency,'')) into v_cur
      from public.goals
     where id = new.goal_id and user_id = new.user_id
     for no key update;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: goal contribution in % cannot hit a goal in % (ledger adds the ORIGINAL amount to goals.current_amount)',
        v_ocur, coalesce(v_cur,'?');
    end if;
  end if;

  select upper(coalesce(base_currency,'')) into v_base
    from public.profiles
   where id = new.user_id
   for no key update;
  if v_base is null or v_base = ''
     or upper(coalesce(new.base_currency::text,'')) <> v_base
  then
    raise exception 'KIPU_FX_REQUIRED: movement base % does not match profile base %',
      upper(coalesce(new.base_currency::text,'')), coalesce(v_base,'?');
  end if;

  return new;
end;
$$;

revoke all on function public.kipu__validate_cash_movement_currency()
  from public, anon, authenticated;

-- El cierre anterior hacía tres hechos independientes:
-- chat_messages INSERT → Telegram → objective_month_closes INSERT.
-- `appendChatMessage` devuelve NULL (no lanza) ante fallo, por lo que el try/catch
-- confirmaba el cierre incluso sin mensaje. Esta RPC hace atómicos los hechos
-- DURABLES: mensaje web + filas de cierre + finalización del claim. Telegram se
-- mantiene best-effort después del commit: una caída externa nunca deshace el
-- hecho que el usuario ya puede ver en el chat.
create or replace function public.kipu_publish_objective_month_close(
  p_user_id uuid,
  p_claim_id uuid,
  p_claim_token uuid,
  p_month text,
  p_content text,
  p_closes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim public.ambient_nudges%rowtype;
  v_item jsonb;
  v_category text;
  v_objective numeric;
  v_spent numeric;
  v_extra numeric;
  v_surplus numeric;
  v_excess numeric;
  v_total integer;
  v_distinct integer;
  v_web_message_id uuid;
  v_fingerprint text;
begin
  if p_user_id is null
     or p_claim_id is null
     or p_claim_token is null
     or p_month is null
     or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     or nullif(btrim(p_content), '') is null
     or length(btrim(p_content)) > 2000
     or jsonb_typeof(p_closes) is distinct from 'array'
     or jsonb_array_length(p_closes) = 0
  then
    raise exception 'KIPU_VALIDATION: invalid objective close publication'
      using errcode = '22023';
  end if;
  v_fingerprint := md5(
    p_month || E'\n' || btrim(p_content) || E'\n' || p_closes::text
  );

  select *
    into v_claim
  from public.ambient_nudges
  where id = p_claim_id
    and user_id = p_user_id
    and topic = 'objective_month_close'
    and budget_lane = 'coach'
    and status = 'sent'
  for update;

  if not found then
    raise exception 'KIPU_OWNERSHIP: objective close claim not found'
      using errcode = '42501';
  end if;

  if v_claim.delivered then
    if v_claim.web_message_id is null
       or coalesce(v_claim.claim_payload->>'objectiveCloseFingerprint', '') <> v_fingerprint
       or not exists (
         select 1
           from public.objective_month_closes
          where user_id = p_user_id
            and month = p_month
          having count(*) = jsonb_array_length(p_closes)
       )
    then
      raise exception 'KIPU_CONFLICT: delivered objective close is incomplete'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'outcome', 'replayed',
      'web_message_id', v_claim.web_message_id
    );
  end if;

  if v_claim.claim_token is distinct from p_claim_token
     or v_claim.lease_until is null
     or v_claim.lease_until <= clock_timestamp()
  then
    raise exception 'KIPU_CONFLICT: objective close lease is not owned'
      using errcode = '40001';
  end if;

  select count(*), count(distinct value->>'category')
    into v_total, v_distinct
  from jsonb_array_elements(p_closes);
  if v_total <> v_distinct or v_total > 2 then
    raise exception 'KIPU_VALIDATION: duplicate or oversized objective close'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.objective_month_closes
    where user_id = p_user_id and month = p_month
  ) then
    raise exception 'KIPU_CONFLICT: objective month already closed'
      using errcode = '40001';
  end if;

  insert into public.chat_messages (
    user_id, channel, chat_id, role, content, message_type, metadata
  )
  values (
    p_user_id,
    'web',
    null,
    'assistant',
    btrim(p_content),
    'advisory',
    jsonb_build_object(
      'source', 'objective_close',
      'month', p_month,
      'objectiveCloseClaimId', p_claim_id
    )
  )
  returning id into v_web_message_id;

  for v_item in select value from jsonb_array_elements(p_closes)
  loop
    begin
      v_category := nullif(btrim(v_item->>'category'), '');
      v_objective := round((v_item->>'objectiveBase')::numeric, 2);
      v_spent := round((v_item->>'spentBase')::numeric, 2);
      v_extra := round(coalesce((v_item->>'extraordinaryBase')::numeric, 0), 2);
      v_surplus := round(coalesce((v_item->>'surplusBase')::numeric, 0), 2);
      v_excess := round(coalesce((v_item->>'excessBase')::numeric, 0), 2);
    exception when others then
      raise exception 'KIPU_VALIDATION: invalid objective close row'
        using errcode = '22023';
    end;
    if v_category is null
       or v_category not in ('food','transport')
       or v_objective < 0
       or v_spent < 0
       or v_extra < 0
       or v_surplus < 0
       or v_excess < 0
       or v_surplus <> round(greatest(v_objective - v_spent, 0), 2)
       or v_excess <> round(greatest(v_spent - v_objective, 0), 2)
    then
      raise exception 'KIPU_VALIDATION: invalid objective close values'
        using errcode = '22023';
    end if;

    insert into public.objective_month_closes (
      user_id, month, category, objective_base, spent_base,
      extraordinary_base, surplus_base, excess_base, destination
    )
    values (
      p_user_id, p_month, v_category, v_objective, v_spent,
      v_extra, v_surplus, v_excess, 'reservas'
    );
  end loop;

  update public.ambient_nudges
  set delivered = true,
      message_preview = left(btrim(p_content), 160),
      web_message_id = v_web_message_id,
      claim_payload = coalesce(claim_payload, '{}'::jsonb) || jsonb_build_object(
        'objectiveCloseFingerprint', v_fingerprint,
        'objectiveCloseMonth', p_month
      ),
      finalized_at = clock_timestamp(),
      lease_until = null,
      telegram_error = null
  where id = p_claim_id
    and user_id = p_user_id
    and claim_token = p_claim_token;

  if not found then
    raise exception 'KIPU_CONFLICT: objective close claim changed during publication'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'outcome', 'published',
    'web_message_id', v_web_message_id
  );
end;
$$;

alter function public.kipu_publish_objective_month_close(
  uuid, uuid, uuid, text, text, jsonb
) owner to postgres;

revoke all on function public.kipu_publish_objective_month_close(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.kipu_publish_objective_month_close(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

-- El fix inicial de J-7 sólo agregó metadata al append best-effort DESPUÉS de
-- Telegram. `appendChatMessage` devuelve NULL sin lanzar: el mensaje podía
-- llegar afuera y no existir en el chat que /dev/chat-review pretende auditar.
-- Esta RPC publica primero la copia durable y finaliza el claim en la misma
-- transacción. Telegram ocurre después, at-most-once; un timeout externo nunca
-- autoriza un segundo envío.
create or replace function public.kipu_publish_ambient_coach_message(
  p_user_id uuid,
  p_claim_id uuid,
  p_claim_token uuid,
  p_chat_id text,
  p_topic text,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim public.ambient_nudges%rowtype;
  v_web_message_id uuid;
  v_fingerprint text;
begin
  if p_user_id is null
     or p_claim_id is null
     or p_claim_token is null
     or nullif(btrim(p_chat_id), '') is null
     or nullif(btrim(p_topic), '') is null
     or nullif(btrim(p_content), '') is null
     or length(btrim(p_content)) > 2000
  then
    raise exception 'KIPU_VALIDATION: invalid ambient coach publication'
      using errcode = '22023';
  end if;

  v_fingerprint := md5(
    btrim(p_chat_id) || E'\n' || btrim(p_topic) || E'\n' || btrim(p_content)
  );

  select *
    into v_claim
  from public.ambient_nudges
  where id = p_claim_id
    and user_id = p_user_id
    and topic = p_topic
    and budget_lane = 'coach'
    and channel = 'telegram'
    and status = 'sent'
  for update;

  if not found then
    raise exception 'KIPU_OWNERSHIP: ambient coach claim not found'
      using errcode = '42501';
  end if;

  if v_claim.delivered then
    if v_claim.web_message_id is null
       or coalesce(v_claim.claim_payload->>'ambientCoachFingerprint', '') <> v_fingerprint
       or not exists (
         select 1
           from public.chat_messages
          where id = v_claim.web_message_id
            and user_id = p_user_id
            and channel = 'telegram'
       )
    then
      raise exception 'KIPU_CONFLICT: delivered ambient coach message is incomplete'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'outcome', 'replayed',
      'web_message_id', v_claim.web_message_id
    );
  end if;

  if v_claim.claim_token is distinct from p_claim_token
     or v_claim.lease_until is null
     or v_claim.lease_until <= clock_timestamp()
  then
    raise exception 'KIPU_CONFLICT: ambient coach lease is not owned'
      using errcode = '40001';
  end if;

  insert into public.chat_messages (
    user_id, channel, chat_id, role, content, message_type, metadata
  )
  values (
    p_user_id,
    'telegram',
    btrim(p_chat_id),
    'assistant',
    btrim(p_content),
    'advisory',
    jsonb_build_object(
      'source', 'ambient',
      'topic', p_topic,
      'ambientClaimId', p_claim_id
    )
  )
  returning id into v_web_message_id;

  update public.ambient_nudges
  set delivered = true,
      message_preview = left(btrim(p_content), 160),
      web_message_id = v_web_message_id,
      claim_payload = coalesce(claim_payload, '{}'::jsonb) || jsonb_build_object(
        'ambientCoachFingerprint', v_fingerprint
      ),
      finalized_at = clock_timestamp(),
      lease_until = null,
      telegram_error = null
  where id = p_claim_id
    and user_id = p_user_id
    and claim_token = p_claim_token;

  if not found then
    raise exception 'KIPU_CONFLICT: ambient coach claim changed during publication'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'outcome', 'published',
    'web_message_id', v_web_message_id
  );
end;
$$;

alter function public.kipu_publish_ambient_coach_message(
  uuid, uuid, uuid, text, text, text
) owner to postgres;

revoke all on function public.kipu_publish_ambient_coach_message(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;

grant execute on function public.kipu_publish_ambient_coach_message(
  uuid, uuid, uuid, text, text, text
) to service_role;

commit;
