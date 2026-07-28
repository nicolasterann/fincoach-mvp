-- Kipu — Bloque J-8. Un draft resuelto pertenece a UNA operación durable.
--
-- PREPARADA, NO APLICADA. Aplicar después de la 086.
--
-- La 084 permitía status in ('open','resolved') en los dos consumidores del
-- draft. Como la fila sólo guardaba status/resolved_at, una identidad NUEVA
-- podía volver a consumir el mismo draft:
--
--   open --dedupe A--> resolved --dedupe B--> otro pago
--
-- El FOR UPDATE sólo serializaba la carrera; no distinguía el replay exacto de
-- un segundo consumo secuencial. Esta migración liga el draft a la operación
-- que lo resolvió y exige esa identidad en todo replay.

begin;

alter table public.card_payment_capture_drafts
  add column if not exists resolution_kind text,
  add column if not exists resolved_dedupe_key text,
  add column if not exists resolved_operation_id uuid;

-- No existe una atribución segura para un `resolved` anterior: la 084 no
-- persistía grupo/transacción/dedupe en el draft. Inferirla por cercanía de
-- timestamp podría vincular el pago equivocado. Además, el código de la 084 no
-- estuvo desplegado antes de esta migración, por lo que en producción se espera
-- cero filas. Si apareciera alguna, se vuelve no-accionable sin borrar historia.
update public.card_payment_capture_drafts
   set status = 'expired'
 where status = 'resolved'
   and (
     resolution_kind is null
     or resolved_dedupe_key is null
     or resolved_operation_id is null
   );

alter table public.card_payment_capture_drafts
  drop constraint if exists card_payment_capture_drafts_resolution_identity_ck;
alter table public.card_payment_capture_drafts
  add constraint card_payment_capture_drafts_resolution_identity_ck
  check (
    (
      status = 'resolved'
      and resolution_kind in ('multi_source','single_source')
      and nullif(btrim(resolved_dedupe_key),'') is not null
      and resolved_operation_id is not null
    )
    or
    (
      status <> 'resolved'
      and resolution_kind is null
      and resolved_dedupe_key is null
      and resolved_operation_id is null
    )
  );

create unique index if not exists card_payment_capture_drafts_resolution_dedupe_uq
  on public.card_payment_capture_drafts (user_id, resolved_dedupe_key)
  where status = 'resolved';

create unique index if not exists card_payment_capture_drafts_resolution_operation_uq
  on public.card_payment_capture_drafts (resolution_kind, resolved_operation_id)
  where status = 'resolved';

-- Open against an authoritative card snapshot. A caller cannot persist a draft
-- for another currency/remainder and later use the row id as evidence.
create or replace function public.kipu_open_card_payment_capture_draft(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_channel text := nullif(p->>'channel','');
  v_chat text := nullif(p->>'chat_id','');
  v_card uuid := nullif(p->>'debt_account_id','')::uuid;
  v_currency text := upper(coalesce(nullif(p->>'original_currency',''),''));
  v_expected numeric := nullif(p->>'expected_due','')::numeric;
  v_raw text := nullif(p->>'initial_raw_message','');
  v_multi boolean := coalesce((p->>'multi_source_required')::boolean, false);
  v_card_currency text;
  v_card_due numeric;
  v_id uuid;
begin
  if v_user is null or v_channel not in ('telegram','web') or v_card is null
     or v_currency !~ '^[A-Z]{3}$' or v_raw is null
  then
    raise exception 'KIPU_VALIDATION: invalid card-payment capture draft'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_user::text || '|' || v_channel || '|' || coalesce(v_chat,'') || '|' || v_card::text,
    0
  ));
  select upper(coalesce(currency,'')), full_payment_due
    into v_card_currency, v_card_due
    from public.debt_accounts
   where id = v_card and user_id = v_user and type = 'credit_card'
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: card draft target not found/not owned'
      using errcode = '42501';
  end if;
  if v_card_currency is distinct from v_currency
     or round(v_card_due, 2) is distinct from round(v_expected, 2)
  then
    raise exception 'KIPU_CONFLICT: card currency/remainder changed before opening capture draft'
      using errcode = '22023';
  end if;
  update public.card_payment_capture_drafts
     set status = 'cancelled',
         resolved_at = now()
   where user_id = v_user
     and channel = v_channel
     and chat_id is not distinct from v_chat
     and debt_account_id = v_card
     and status = 'open';
  insert into public.card_payment_capture_drafts (
    user_id, channel, chat_id, debt_account_id, original_currency,
    expected_due, initial_raw_message, multi_source_required, expires_at
  ) values (
    v_user, v_channel, v_chat, v_card, v_currency,
    v_expected, v_raw, v_multi, now() + interval '30 minutes'
  )
  returning id into v_id;
  return jsonb_build_object('outcome','opened','draft_id',v_id);
end;
$$;

alter function public.kipu_open_card_payment_capture_draft(jsonb) owner to postgres;
revoke all on function public.kipu_open_card_payment_capture_draft(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_open_card_payment_capture_draft(jsonb)
  to service_role;

-- The multi-source function is intentionally derived from the LIVE body
-- (084→085) rather than transcribed. Every replacement must match exactly once;
-- otherwise the migration aborts before changing the function.
do $migration$
declare
  v_def text;
  v_new text;
  v_old text;
  v_replacement text;
  v_matches integer;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'kipu_apply_card_payment_multi_source'
     and pg_get_function_identity_arguments(p.oid) = 'p jsonb';
  if v_def is null then
    raise exception 'KIPU_MIGRATION: kipu_apply_card_payment_multi_source(jsonb) no existe';
  end if;

  -- A manual retry after a successful application must be harmless. Accept the
  -- already-hardened body only when ALL three live markers are present; a
  -- partial match means an unknown function body and aborts the transaction.
  v_matches :=
    (position('v_draft.resolution_kind is distinct from ''multi_source''' in v_def) > 0)::integer
    + (position('capture draft does not belong to this payment group' in v_def) > 0)::integer
    + (position('resolved_operation_id = v_group' in v_def) > 0)::integer;
  if v_matches = 3 then
    v_new := v_def;
  elsif v_matches <> 0 then
    raise exception 'KIPU_MIGRATION: cuerpo multifuente parcialmente endurecido (%/3 marcas)',
      v_matches;
  else
  v_old := $old$
    if not found
       or v_draft.debt_account_id <> v_card
       or v_draft.status not in ('open','resolved')
       or (v_draft.status = 'open' and v_draft.expires_at <= now())
       or not v_draft.multi_source_required
    then
      raise exception 'KIPU_VALIDATION: capture draft missing, expired or incompatible'
        using errcode = '22023';
    end if;
$old$;
  v_replacement := $new$
    if not found
       or v_draft.debt_account_id <> v_card
       or v_draft.status not in ('open','resolved')
       or (v_draft.status = 'open' and v_draft.expires_at <= now())
       or not v_draft.multi_source_required
       or upper(v_draft.original_currency) is distinct from v_currency
       or round(v_draft.expected_due, 2) is distinct from v_expected
    then
      raise exception 'KIPU_VALIDATION: capture draft missing, expired or incompatible'
        using errcode = '22023';
    end if;
    if v_draft.status = 'resolved'
       and (
         v_draft.resolution_kind is distinct from 'multi_source'
         or v_draft.resolved_dedupe_key is distinct from v_dedupe
       )
    then
      raise exception 'KIPU_DEDUPE_MISMATCH: capture draft already belongs to another operation'
        using errcode = '22023';
    end if;
$new$;
  v_matches := (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0);
  if v_matches is distinct from 1 then
    raise exception 'KIPU_MIGRATION: se esperó 1 guard de draft multifuente, se encontraron %',
      v_matches;
  end if;
  v_new := replace(v_def, v_old, v_replacement);

  v_old := $old$
    if v_existing.fingerprint is distinct from v_fingerprint
       or v_existing.debt_account_id is distinct from v_card
       or v_existing.reversed_at is not null
    then
      raise exception 'KIPU_DEDUPE_MISMATCH: multi-source payment identity reused for different/reversed operation'
        using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(payment_transaction_id order by ordinal), '[]'::jsonb)
$old$;
  v_replacement := $new$
    if v_existing.fingerprint is distinct from v_fingerprint
       or v_existing.debt_account_id is distinct from v_card
       or v_existing.reversed_at is not null
    then
      raise exception 'KIPU_DEDUPE_MISMATCH: multi-source payment identity reused for different/reversed operation'
        using errcode = '22023';
    end if;
    if v_capture_draft is not null then
      if v_draft.status = 'open'
         or v_draft.resolved_operation_id is distinct from v_existing.id
      then
        raise exception 'KIPU_DEDUPE_MISMATCH: capture draft does not belong to this payment group'
          using errcode = '22023';
      end if;
    end if;
    select coalesce(jsonb_agg(payment_transaction_id order by ordinal), '[]'::jsonb)
$new$;
  v_matches := (
    length(v_new) - length(replace(v_new, v_old, ''))
  ) / nullif(length(v_old), 0);
  if v_matches is distinct from 1 then
    raise exception 'KIPU_MIGRATION: se esperó 1 validación de replay multifuente, se encontraron %',
      v_matches;
  end if;
  v_replacement := replace(v_new, v_old, v_replacement);
  v_new := v_replacement;

  v_old := $old$
    update public.card_payment_capture_drafts
       set status = 'resolved',
           resolved_at = now()
     where id = v_capture_draft and user_id = v_user and status = 'open';
$old$;
  v_replacement := $new$
    update public.card_payment_capture_drafts
       set status = 'resolved',
           resolved_at = now(),
           resolution_kind = 'multi_source',
           resolved_dedupe_key = v_dedupe,
           resolved_operation_id = v_group
     where id = v_capture_draft and user_id = v_user and status = 'open';
$new$;
  v_matches := (
    length(v_new) - length(replace(v_new, v_old, ''))
  ) / nullif(length(v_old), 0);
  if v_matches is distinct from 1 then
    raise exception 'KIPU_MIGRATION: se esperó 1 resolución multifuente, se encontraron %',
      v_matches;
  end if;
  v_replacement := replace(v_new, v_old, v_replacement);
  v_new := v_replacement;
  end if;

  execute v_new;
end
$migration$;

alter function public.kipu_apply_card_payment_multi_source(jsonb) owner to postgres;
revoke all on function public.kipu_apply_card_payment_multi_source(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_apply_card_payment_multi_source(jsonb)
  to service_role;

-- Retraction to one source. The durable identity is the card-payment dedupe and
-- the transaction id returned by its application marker. A resolved draft may
-- replay exactly that pair; a different dedupe or a multi-source resolution is
-- rejected before a second write.
create or replace function public.kipu_apply_card_payment_and_resolve_capture(
  p_entry jsonb,
  p_statement jsonb,
  p_capture_draft_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p_entry->>'user_id','')::uuid;
  v_card uuid := nullif(p_statement->>'debt_account_id','')::uuid;
  v_dedupe text := nullif(p_entry->>'dedupe_key','');
  v_currency text := upper(coalesce(nullif(p_entry->>'original_currency',''),''));
  v_expected numeric := nullif(p_statement->>'expected_due','')::numeric;
  v_draft public.card_payment_capture_drafts%rowtype;
  v_result jsonb;
  v_transaction uuid;
begin
  if v_user is null or v_card is null or p_capture_draft_id is null
     or v_dedupe is null or v_currency !~ '^[A-Z]{3}$'
  then
    raise exception 'KIPU_VALIDATION: payment, card, dedupe and capture draft required'
      using errcode = '22023';
  end if;
  select * into v_draft
    from public.card_payment_capture_drafts
   where id = p_capture_draft_id and user_id = v_user
   for update;
  if not found
     or v_draft.debt_account_id <> v_card
     or v_draft.status not in ('open','resolved')
     or (v_draft.status = 'open' and v_draft.expires_at <= now())
     or not v_draft.multi_source_required
     or upper(v_draft.original_currency) is distinct from v_currency
     or round(v_draft.expected_due, 2) is distinct from round(v_expected, 2)
  then
    raise exception 'KIPU_VALIDATION: capture draft missing, expired or incompatible'
      using errcode = '22023';
  end if;
  if v_draft.status = 'resolved'
     and (
       v_draft.resolution_kind is distinct from 'single_source'
       or v_draft.resolved_dedupe_key is distinct from v_dedupe
     )
  then
    raise exception 'KIPU_DEDUPE_MISMATCH: capture draft already belongs to another operation'
      using errcode = '22023';
  end if;

  v_result := public.kipu_apply_card_payment_v2(p_entry, p_statement);
  v_transaction := nullif(v_result->>'transaction_id','')::uuid;
  if v_transaction is null then
    raise exception 'KIPU_CONFLICT: card payment did not return a transaction'
      using errcode = '22023';
  end if;

  if v_draft.status = 'open' then
    update public.card_payment_capture_drafts
       set status = 'resolved',
           resolved_at = now(),
           resolution_kind = 'single_source',
           resolved_dedupe_key = v_dedupe,
           resolved_operation_id = v_transaction
     where id = p_capture_draft_id and user_id = v_user and status = 'open';
    if not found then
      raise exception 'KIPU_CONFLICT: capture draft changed during payment'
        using errcode = '22023';
    end if;
  elsif v_draft.resolved_operation_id is distinct from v_transaction then
    raise exception 'KIPU_DEDUPE_MISMATCH: capture draft does not belong to this card payment'
      using errcode = '22023';
  end if;

  return v_result || jsonb_build_object(
    'capture_resolution',
    case when v_draft.status = 'resolved' then 'replayed' else 'resolved' end
  );
end;
$$;

alter function public.kipu_apply_card_payment_and_resolve_capture(jsonb, jsonb, uuid)
  owner to postgres;
revoke all on function public.kipu_apply_card_payment_and_resolve_capture(jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.kipu_apply_card_payment_and_resolve_capture(jsonb, jsonb, uuid)
  to service_role;

commit;
