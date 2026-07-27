-- Kipu — Bloque J-7, auditoría de Claude sobre la re-auditoría de Codex.
--
-- EL DEFECTO: `40001` es `serialization_failure`, y PostgREST REINTENTA ese
-- SQLSTATE automáticamente. Las RPC de la 079/080 lo usaban también para
-- rechazos DETERMINISTAS (fingerprint que no coincide, mes ya cerrado, estado
-- divergente, ocurrencia que no está pending). Como esos rechazos no pueden
-- cambiar por reintentar, PostgREST reintentaba hasta agotarse y el cliente
-- recibía **HTTP 504 «upstream request timeout»** en vez del conflicto.
--
-- Consecuencias medidas contra prod (E13c/E14c del E2E):
--   · el caller NUNCA veía `KIPU_CONFLICT` ni el código 40001;
--   · lo clasificaba como `write_failed`, es decir «fallo de infraestructura»;
--   · y `publishObjectiveMonthCloseReliably` REINTENTA lo que no es conflicto,
--     así que cada rechazo determinista costaba DOS timeouts completos.
-- Es la conflación que el Bloque I prohíbe —«el write falló» ≠ «no aterrizó»— y
-- la misma lección de J-3: no se finge un conflicto transitorio ante una
-- decisión determinista.
--
-- La prueba interna de que la causa es el SQLSTATE y no otra cosa: en la MISMA
-- corrida, el fingerprint de inversión (KIPU_DEDUPE_MISMATCH, errcode 22023)
-- llegaba perfecto y su test pasaba en verde.
--
-- El arreglo es quirúrgico: los rechazos DETERMINISTAS pasan a `22023`
-- (invalid_parameter_value, no reintentable). Los CAS genuinamente TRANSITORIOS
-- —«claim changed during publication», «occurrence changed during write»—
-- CONSERVAN 40001, porque ahí el reintento sí es la respuesta correcta.
-- El texto `KIPU_CONFLICT:` no cambia, y los stores ya clasifican por mensaje
-- además de por código, así que la semántica del caller queda intacta.
--
-- Aditiva: sólo reemplaza cuerpos de funciones ya aplicadas.

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
        using errcode = '22023';
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
      using errcode = '22023';
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
      using errcode = '22023';
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
        using errcode = '22023';
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
      using errcode = '22023';
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

create or replace function public.kipu_apply_investment_occurrence(
  p_user_id uuid,
  p_occurrence_id uuid,
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_occ public.recurring_occurrences%rowtype;
  v_plan public.savings_plans%rowtype;
  v_account public.accounts%rowtype;
  v_asset public.investment_accounts%rowtype;
  v_marker public.investment_occurrence_applications%rowtype;
  v_entry jsonb;
  v_amount numeric;
  v_currency text;
  v_base_amount numeric;
  v_base_currency text;
  v_asset_amount numeric;
  v_asset_currency text;
  v_rate numeric;
  v_dedupe text;
  v_tx uuid;
  v_existing_tx uuid;
  v_fingerprint text;
  v_status text;
  v_rows integer;
begin
  if p_user_id is null
     or p_occurrence_id is null
     or p_action is null
     or p_action not in ('confirm','correct')
     or jsonb_typeof(p_payload) is distinct from 'object'
  then
    raise exception 'KIPU_VALIDATION: invalid investment occurrence request'
      using errcode = '22023';
  end if;
  if v_caller is not null and v_caller <> p_user_id then
    raise exception 'KIPU_OWNERSHIP: user mismatch'
      using errcode = '42501';
  end if;

  begin
    v_amount := round((p_payload->>'amount')::numeric, 2);
    v_currency := upper(p_payload->>'currency');
    v_base_amount := round((p_payload->>'baseAmount')::numeric, 2);
    v_base_currency := upper(p_payload->>'baseCurrency');
    v_asset_amount := round((p_payload->>'assetAmount')::numeric, 2);
    v_asset_currency := upper(p_payload->>'assetCurrency');
    v_entry := p_payload->'ledgerEntry';
    v_rate := (v_entry->>'exchange_rate_to_base')::numeric;
    v_dedupe := nullif(v_entry->>'dedupe_key','');
  exception when others then
    raise exception 'KIPU_VALIDATION: invalid investment occurrence amounts'
      using errcode = '22023';
  end;
  if v_amount is null
     or v_base_amount is null
     or v_asset_amount is null
     or v_currency is null
     or v_base_currency is null
     or v_asset_currency is null
     or v_amount <= 0
     or v_base_amount <= 0
     or v_asset_amount <= 0
     or v_rate is null
     or v_rate <= 0
     or v_currency !~ '^[A-Z]{3}$'
     or v_base_currency !~ '^[A-Z]{3}$'
     or v_asset_currency !~ '^[A-Z]{3}$'
     or jsonb_typeof(v_entry) is distinct from 'object'
     or v_dedupe is null
  then
    raise exception 'KIPU_VALIDATION: invalid investment occurrence payload'
      using errcode = '22023';
  end if;
  v_fingerprint := md5(p_payload::text);

  select * into v_occ
    from public.recurring_occurrences
   where id = p_occurrence_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: occurrence not found'
      using errcode = '42501';
  end if;

  select * into v_marker
    from public.investment_occurrence_applications
   where user_id = p_user_id and occurrence_id = p_occurrence_id;
  if found then
    if v_marker.action <> p_action
       or v_marker.amount <> v_amount
       or upper(v_marker.currency) <> v_currency
       or v_marker.base_amount <> v_base_amount
       or upper(v_marker.base_currency) <> v_base_currency
       or v_marker.asset_amount <> v_asset_amount
       or upper(v_marker.asset_currency) <> v_asset_currency
       or v_marker.payload_fingerprint <> v_fingerprint
    then
      raise exception 'KIPU_DEDUPE_MISMATCH: investment occurrence replay changed'
        using errcode = '22023';
    end if;
    if v_occ.created_transaction_id is distinct from v_marker.transaction_id
       or v_occ.status not in ('confirmed','corrected')
    then
      raise exception 'KIPU_CONFLICT: investment application and occurrence diverged'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome', 'replayed',
      'transaction_id', v_marker.transaction_id
    );
  end if;

  if v_occ.status <> 'pending' then
    raise exception 'KIPU_CONFLICT: investment occurrence is not pending'
      using errcode = '22023';
  end if;
  if v_occ.kind <> 'investment' or v_occ.savings_plan_id is null then
    raise exception 'KIPU_VALIDATION: occurrence is not a linked investment plan'
      using errcode = '22023';
  end if;
  if p_action = 'confirm'
     and (
       v_occ.expected_amount is null
       or round(v_occ.expected_amount, 2) <> v_amount
     )
  then
    raise exception 'KIPU_DEDUPE_MISMATCH: confirmed investment amount changed'
      using errcode = '22023';
  end if;
  if v_occ.currency is not null
     and upper(v_occ.currency) <> v_currency
  then
    raise exception 'KIPU_FX_REQUIRED: occurrence currency changed before write'
      using errcode = '22023';
  end if;

  select * into v_plan
    from public.savings_plans
   where id = v_occ.savings_plan_id
     and user_id = p_user_id
     and kind = 'investment'
   for update;
  if not found
     or v_plan.source_account_id is null
     or v_plan.destination_asset_id is null
  then
    raise exception 'KIPU_VALIDATION: investment plan is not fully linked'
      using errcode = '22023';
  end if;

  select * into v_account
    from public.accounts
   where id = v_plan.source_account_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: investment source account not found'
      using errcode = '42501';
  end if;

  select * into v_asset
    from public.investment_accounts
   where id = v_plan.destination_asset_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: investment asset not found'
      using errcode = '42501';
  end if;

  if upper(coalesce(v_account.currency,'')) <> v_currency
     or upper(coalesce(v_plan.original_currency, v_plan.base_currency, '')) <> v_currency
     or upper(coalesce(v_asset.currency, v_base_currency)) <> v_asset_currency
  then
    raise exception 'KIPU_FX_REQUIRED: investment currencies changed before write'
      using errcode = '22023';
  end if;

  if nullif(v_entry->>'user_id','')::uuid is distinct from p_user_id
     or coalesce(v_entry->>'type','') <> 'adjustment'
     or coalesce(v_entry->>'effect_type','') <> 'adjustment'
     or coalesce(nullif(v_entry->>'sign','')::numeric, 1) <> 1
     or coalesce(v_entry->>'category','') <> 'savings'
     or nullif(v_entry->>'source_account_id','')::uuid is distinct from v_account.id
     or nullif(v_entry->>'destination_account_id','') is not null
     or nullif(v_entry->>'debt_account_id','') is not null
     or nullif(v_entry->>'goal_id','') is not null
     or nullif(v_entry->>'related_transaction_id','') is not null
     or round(nullif(v_entry->>'original_amount','')::numeric, 2) is distinct from v_amount
     or upper(coalesce(v_entry->>'original_currency','')) <> v_currency
     or round(nullif(v_entry->>'base_amount','')::numeric, 2) is distinct from v_base_amount
     or upper(coalesce(v_entry->>'base_currency','')) <> v_base_currency
     or round(v_amount * v_rate, 2) <> v_base_amount
     or left(coalesce(v_entry->>'occurred_at',''), 10) <> v_occ.occurrence_date::text
  then
    raise exception 'KIPU_VALIDATION: investment ledger entry does not match request'
      using errcode = '22023';
  end if;

  -- When the asset is denominated in either side already proved by the ledger,
  -- its increment is derivable and must match exactly. A third currency remains
  -- allowed only because the typed caller requires an explicit trusted FX rate;
  -- the full payload fingerprint prevents that fact changing on replay.
  if (v_asset_currency = v_currency and v_asset_amount <> v_amount)
     or (v_asset_currency = v_base_currency and v_asset_amount <> v_base_amount)
  then
    raise exception 'KIPU_VALIDATION: investment asset amount does not match its currency'
      using errcode = '22023';
  end if;

  select id into v_existing_tx
    from public.transactions
   where user_id = p_user_id and dedupe_key = v_dedupe;
  if v_existing_tx is not null then
    -- Una fila sin marker nació del writer viejo. Puede estar debitada, revertida
    -- o con el activo ya movido: no hay información suficiente para re-aplicarla.
    raise exception 'KIPU_CONFLICT: legacy investment transaction requires reconciliation'
      using errcode = '22023';
  end if;

  v_tx := public.kipu_apply_ledger_entry(v_entry);
  if v_tx is null then
    raise exception 'KIPU_CONFLICT: investment ledger write returned no transaction'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.transactions
     where user_id = p_user_id
       and type = 'reversal'
       and related_transaction_id = v_tx
  ) then
    raise exception 'KIPU_CONFLICT: investment transaction is reversed'
      using errcode = '22023';
  end if;

  update public.investment_accounts
  set value_base = round(coalesce(value_base, 0) + v_base_amount, 2),
      value_original = case
        when value_original is null then null
        else round(value_original + v_asset_amount, 2)
      end,
      updated_at = clock_timestamp()
  where id = v_asset.id and user_id = p_user_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'KIPU_EFFECT_MISSING: investment asset';
  end if;

  v_status := case when p_action = 'confirm' then 'confirmed' else 'corrected' end;
  update public.recurring_occurrences
  set status = v_status,
      created_transaction_id = v_tx,
      resolved_amount = v_amount,
      resolved_currency = v_currency,
      resolved_at = clock_timestamp()
  where id = p_occurrence_id
    and user_id = p_user_id
    and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'KIPU_CONFLICT: investment occurrence changed during write'
      using errcode = '40001';
  end if;

  insert into public.investment_occurrence_applications (
    user_id, occurrence_id, transaction_id, asset_id, action,
    amount, currency, base_amount, base_currency, asset_amount, asset_currency,
    payload_fingerprint
  )
  values (
    p_user_id, p_occurrence_id, v_tx, v_asset.id, p_action,
    v_amount, v_currency, v_base_amount, v_base_currency,
    v_asset_amount, v_asset_currency, v_fingerprint
  );

  return jsonb_build_object(
    'outcome', 'applied',
    'transaction_id', v_tx
  );
end;
$$;

alter function public.kipu_apply_investment_occurrence(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function public.kipu_apply_investment_occurrence(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_apply_investment_occurrence(uuid, uuid, text, jsonb)
  to service_role;
