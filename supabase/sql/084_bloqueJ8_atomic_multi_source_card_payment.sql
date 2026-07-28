-- Kipu — Bloque J-8: un pago de tarjeta repartido es UNA operación.
--
-- El caso real que exige esta migración:
--   pago total 743.93 = 471.95 desde una cuenta + 271.98 prestados.
-- El writer anterior aceptaba una sola fuente. Escribía la parte que podía y
-- preguntaba después, o quedaba atrapado preguntando el reparto para siempre.
--
-- Invariantes:
--   * todas las partes suman exactamente el total;
--   * tarjeta, cuentas, préstamos y entry comparten moneda NATIVA;
--   * una parte prestada entra y sale por una cuenta puente mediante un
--     adjustment (no se disfraza de ingreso), y aumenta la deuda del préstamo;
--   * cuenta(s), préstamo(s), tarjeta, remanente del statement y marcas
--     durables commitean juntos o nada;
--   * replay de la identidad completa no vuelve a mover ninguna pata;
--   * authenticated puede auditar sus marcas, pero solo service_role ejecuta.

begin;

create table if not exists public.card_payment_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  debt_account_id uuid not null references public.debt_accounts(id) on delete restrict,
  expected_due numeric not null,
  total_paid numeric not null,
  original_currency text not null,
  base_currency text not null,
  exchange_rate_to_base numeric not null,
  statement_date date,
  payment_date date not null,
  fingerprint text not null,
  remaining_due numeric not null,
  statement_covered boolean not null,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key),
  check (expected_due > 0),
  check (total_paid > 0),
  check (exchange_rate_to_base > 0),
  check (remaining_due >= 0),
  check (original_currency ~ '^[A-Za-z]{3}$'),
  check (base_currency ~ '^[A-Za-z]{3}$')
);

create table if not exists public.card_payment_group_legs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.card_payment_groups(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  ordinal integer not null,
  kind text not null check (kind in ('account','loan')),
  instrument_id uuid not null,
  clearing_account_id uuid,
  amount numeric not null check (amount > 0),
  base_amount numeric not null check (base_amount > 0),
  payment_transaction_id uuid not null references public.transactions(id) on delete restrict,
  funding_transaction_id uuid references public.transactions(id) on delete restrict,
  payment_reversal_transaction_id uuid references public.transactions(id) on delete restrict,
  funding_reversal_transaction_id uuid references public.transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (group_id, ordinal),
  unique (user_id, payment_transaction_id),
  check (
    (kind = 'account' and clearing_account_id is null and funding_transaction_id is null)
    or
    (kind = 'loan' and clearing_account_id is not null and funding_transaction_id is not null)
  )
);

-- A blocked capture can span several chat turns. The first message may prove
-- that a payment had multiple sources while still proposing the WRONG total;
-- the next reply may contain only the corrected total. Without durable state,
-- the second turn forgets the split and can write the whole payment against one
-- account. This table stores only server-derived capture facts, never LLM
-- allocations. It is operational state, not financial truth.
create table if not exists public.card_payment_capture_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('telegram','web')),
  chat_id text,
  debt_account_id uuid not null references public.debt_accounts(id) on delete cascade,
  original_currency text not null check (original_currency ~ '^[A-Za-z]{3}$'),
  expected_due numeric,
  initial_raw_message text not null,
  multi_source_required boolean not null default false,
  status text not null default 'open' check (status in ('open','resolved','cancelled','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz
);

create index if not exists card_payment_capture_drafts_open_idx
  on public.card_payment_capture_drafts
    (user_id, channel, chat_id, debt_account_id, created_at desc)
  where status = 'open';

alter table public.card_payment_applications
  add column if not exists reversal_transaction_id uuid references public.transactions(id) on delete restrict,
  add column if not exists reversed_at timestamptz;

-- Generic reversals were the only repair available before this migration.
-- Teach the new durable marker about those historical repairs before the new
-- card-aware writer is callable. Otherwise retrying "undo" after 084 would see
-- the old application as active and restore the statement a second time.
with historic_card_reversals as (
  select distinct on (a.id)
    a.id as application_id,
    r.id as reversal_transaction_id,
    r.created_at as reversed_at
  from public.card_payment_applications a
  join public.transactions r
    on r.user_id = a.user_id
   and r.type = 'reversal'
   and r.related_transaction_id = a.transaction_id
  order by a.id, r.created_at asc, r.id
)
update public.card_payment_applications a
   set reversal_transaction_id = h.reversal_transaction_id,
       reversed_at = h.reversed_at
  from historic_card_reversals h
 where a.id = h.application_id
   and a.reversed_at is null;

alter table public.card_payment_group_legs
  add column if not exists payment_reversal_transaction_id uuid references public.transactions(id) on delete restrict,
  add column if not exists funding_reversal_transaction_id uuid references public.transactions(id) on delete restrict;

create index if not exists card_payment_groups_user_card_idx
  on public.card_payment_groups (user_id, debt_account_id, created_at desc);
create index if not exists card_payment_group_legs_group_idx
  on public.card_payment_group_legs (group_id, ordinal);

alter table public.card_payment_groups enable row level security;
alter table public.card_payment_group_legs enable row level security;
alter table public.card_payment_capture_drafts enable row level security;

drop policy if exists "card_payment_groups_select_own" on public.card_payment_groups;
create policy "card_payment_groups_select_own"
  on public.card_payment_groups for select
  using (auth.uid() = user_id);

drop policy if exists "card_payment_group_legs_select_own" on public.card_payment_group_legs;
create policy "card_payment_group_legs_select_own"
  on public.card_payment_group_legs for select
  using (auth.uid() = user_id);

drop policy if exists "card_payment_capture_drafts_select_own" on public.card_payment_capture_drafts;
create policy "card_payment_capture_drafts_select_own"
  on public.card_payment_capture_drafts for select
  using (auth.uid() = user_id);

revoke all on table public.card_payment_groups from public, anon, authenticated;
revoke all on table public.card_payment_group_legs from public, anon, authenticated;
revoke all on table public.card_payment_capture_drafts from public, anon, authenticated;
grant select on table public.card_payment_groups to authenticated;
grant select on table public.card_payment_group_legs to authenticated;
grant select on table public.card_payment_capture_drafts to authenticated;
grant all on table public.card_payment_groups to service_role;
grant all on table public.card_payment_group_legs to service_role;
grant all on table public.card_payment_capture_drafts to service_role;

-- Open/replace one capture draft atomically. A persistence failure is surfaced
-- to the executor; it may ask again, but it must not continue to a money write
-- after losing the fact that the payment was multi-source.
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
  perform 1
    from public.debt_accounts
   where id = v_card and user_id = v_user and type = 'credit_card'
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: card draft target not found/not owned'
      using errcode = '42501';
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

create or replace function public.kipu_apply_card_payment_multi_source(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_dedupe text := nullif(p->>'dedupe_key','');
  v_card uuid := nullif(p->>'debt_account_id','')::uuid;
  v_expected numeric := nullif(p->>'expected_due','')::numeric;
  v_total numeric := nullif(p->>'total_amount','')::numeric;
  v_currency text := upper(coalesce(nullif(p->>'original_currency',''),''));
  v_base text := upper(coalesce(nullif(p->>'base_currency',''),''));
  v_rate numeric := nullif(p->>'exchange_rate_to_base','')::numeric;
  v_occurred timestamptz := coalesce(nullif(p->>'occurred_at','')::timestamptz, now());
  v_raw text := nullif(p->>'raw_input','');
  v_channel text := coalesce(nullif(p->>'input_channel',''), 'chat');
  v_sources jsonb := p->'sources';
  v_capture_draft uuid := nullif(p->>'capture_draft_id','')::uuid;
  v_count integer;
  v_sum numeric;
  v_profile_base text;
  v_timezone text;
  v_card_type text;
  v_card_currency text;
  v_locked_due numeric;
  v_statement_date date;
  v_payment_date date;
  v_group uuid := gen_random_uuid();
  v_existing public.card_payment_groups%rowtype;
  v_fingerprint text;
  v_item jsonb;
  v_ord integer;
  v_kind text;
  v_instrument uuid;
  v_clearing uuid;
  v_amount numeric;
  v_amount_base numeric;
  v_instrument_currency text;
  v_instrument_type text;
  v_clearing_currency text;
  v_running_due numeric;
  v_entry jsonb;
  v_result jsonb;
  v_payment_tx uuid;
  v_funding_tx uuid;
  v_transactions jsonb := '[]'::jsonb;
  v_draft public.card_payment_capture_drafts%rowtype;
begin
  if v_user is null or v_dedupe is null or v_card is null
     or v_expected is null or v_expected <= 0
     or v_total is null or v_total <= 0
     or v_currency !~ '^[A-Z]{3}$'
     or v_base !~ '^[A-Z]{3}$'
     or v_rate is null or v_rate <= 0
     or jsonb_typeof(v_sources) is distinct from 'array'
  then
    raise exception 'KIPU_VALIDATION: invalid multi-source card payment identity/amount/currency'
      using errcode = '22023';
  end if;
  v_total := round(v_total, 2);
  v_expected := round(v_expected, 2);
  v_count := jsonb_array_length(v_sources);
  if v_count < 2 or v_count > 10 then
    raise exception 'KIPU_VALIDATION: a multi-source payment requires 2..10 sources'
      using errcode = '22023';
  end if;
  if v_total > v_expected + 0.005 then
    -- The existing single-payment core supports an overpayment, but applying a
    -- split sequentially would let an early leg close the statement before the
    -- remaining legs. Refuse rather than make ordering affect truth.
    raise exception 'KIPU_VALIDATION: split card payment cannot exceed the current statement remainder'
      using errcode = '22023';
  end if;

  if v_capture_draft is not null then
    select * into v_draft
      from public.card_payment_capture_drafts
     where id = v_capture_draft and user_id = v_user
     for update;
    if not found
       or v_draft.debt_account_id <> v_card
       or v_draft.status not in ('open','resolved')
       or (v_draft.status = 'open' and v_draft.expires_at <= now())
       or not v_draft.multi_source_required
    then
      raise exception 'KIPU_VALIDATION: capture draft missing, expired or incompatible'
        using errcode = '22023';
    end if;
  end if;

  select round(coalesce(sum(nullif(x->>'amount','')::numeric), 0), 2)
    into v_sum
    from jsonb_array_elements(v_sources) x;
  if v_sum is distinct from v_total then
    raise exception 'KIPU_VALIDATION: source parts % do not equal total %', v_sum, v_total
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_sources) x
     where x->>'kind' not in ('account','loan')
        or nullif(x->>'instrument_id','') is null
        or nullif(x->>'amount','')::numeric <= 0
        or (x->>'kind' = 'loan' and nullif(x->>'clearing_account_id','') is null)
        or (x->>'kind' = 'account' and nullif(x->>'clearing_account_id','') is not null)
  ) then
    raise exception 'KIPU_VALIDATION: malformed multi-source payment leg'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from (
        select nullif(x->>'instrument_id','')::uuid instrument_id, count(*) n
          from jsonb_array_elements(v_sources) x
         group by 1
      ) d
     where d.n > 1
  ) then
    raise exception 'KIPU_VALIDATION: duplicate source instrument in payment split'
      using errcode = '22023';
  end if;

  -- Replay identity is financial-day based, never wall-clock based. A channel
  -- redelivery may reconstruct a different timestamp for the same user-day;
  -- fingerprinting the raw timestamptz made that safe retry look like a payload
  -- mutation. Resolve the user's day before reading the durable marker.
  select timezone into v_timezone
    from public.user_engagement
   where user_id = v_user;
  v_timezone := coalesce(nullif(v_timezone,''), 'America/Guayaquil');
  if not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception 'KIPU_VALIDATION: invalid user timezone %', v_timezone
      using errcode = '22023';
  end if;
  v_payment_date := (v_occurred at time zone v_timezone)::date;

  -- Stable identity lock: concurrent redeliveries serialize before reading the
  -- marker. No clock/window assumption is involved.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || '|' || v_dedupe, 0));

  v_fingerprint := md5(jsonb_build_object(
    'user_id', v_user,
    'debt_account_id', v_card,
    'expected_due', v_expected,
    'total_amount', v_total,
    'original_currency', v_currency,
    'base_currency', v_base,
    'exchange_rate_to_base', v_rate,
    'payment_date', v_payment_date,
    'sources', v_sources
  )::text);

  select * into v_existing
    from public.card_payment_groups
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  if found then
    if v_existing.fingerprint is distinct from v_fingerprint
       or v_existing.debt_account_id is distinct from v_card
       or v_existing.reversed_at is not null
    then
      raise exception 'KIPU_DEDUPE_MISMATCH: multi-source payment identity reused for different/reversed operation'
        using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(payment_transaction_id order by ordinal), '[]'::jsonb)
      into v_transactions
      from public.card_payment_group_legs
     where group_id = v_existing.id;
    return jsonb_build_object(
      'outcome', 'replayed',
      'group_id', v_existing.id,
      'transaction_ids', v_transactions,
      'remaining_due', v_existing.remaining_due,
      'statement_covered', v_existing.statement_covered
    );
  end if;

  -- Same deterministic lock order as the ledger: all accounts first, then all
  -- debts, then profile. The nested core calls re-lock rows already owned by
  -- this transaction and cannot observe a different currency/balance snapshot.
  perform 1
    from public.accounts a
   where a.user_id = v_user
     and a.id in (
       select case when x->>'kind' = 'account'
                   then nullif(x->>'instrument_id','')::uuid
                   else nullif(x->>'clearing_account_id','')::uuid end
         from jsonb_array_elements(v_sources) x
     )
   order by a.id
   for update;

  perform 1
    from public.debt_accounts d
   where d.user_id = v_user
     and (
       d.id = v_card
       or d.id in (
         select nullif(x->>'instrument_id','')::uuid
           from jsonb_array_elements(v_sources) x
          where x->>'kind' = 'loan'
       )
     )
   order by d.id
   for update;

  select upper(coalesce(base_currency,'')) into v_profile_base
    from public.profiles
   where id = v_user
   for update;
  if not found or v_profile_base = '' or v_profile_base <> v_base then
    raise exception 'KIPU_FX_REQUIRED: payment base % does not match profile base %',
      v_base, coalesce(v_profile_base,'?') using errcode = '22023';
  end if;

  select type::text, upper(coalesce(currency,'')), full_payment_due, statement_date
    into v_card_type, v_card_currency, v_locked_due, v_statement_date
    from public.debt_accounts
   where id = v_card and user_id = v_user;
  if not found or v_card_type <> 'credit_card' then
    raise exception 'KIPU_VALIDATION: target card not found/not credit_card'
      using errcode = '22023';
  end if;
  if v_card_currency <> v_currency then
    raise exception 'KIPU_FX_REQUIRED: card % is %, payment is %',
      v_card, v_card_currency, v_currency using errcode = '22023';
  end if;
  if v_locked_due is distinct from v_expected then
    raise exception 'KIPU_CONFLICT: card statement changed since read (now %, expected %)',
      v_locked_due, v_expected using errcode = '22023';
  end if;

  -- Validate every live instrument under the locks before the first effect.
  for v_item, v_ord in
    select value, ordinality::integer
      from jsonb_array_elements(v_sources) with ordinality
  loop
    v_kind := v_item->>'kind';
    v_instrument := nullif(v_item->>'instrument_id','')::uuid;
    v_amount := round((v_item->>'amount')::numeric, 2);
    if v_kind = 'account' then
      select upper(coalesce(currency,'')) into v_instrument_currency
        from public.accounts
       where id = v_instrument and user_id = v_user;
      if not found or v_instrument_currency <> v_currency then
        raise exception 'KIPU_FX_REQUIRED: account source % is %, payment is %',
          v_instrument, coalesce(v_instrument_currency,'?'), v_currency
          using errcode = '22023';
      end if;
    else
      v_clearing := nullif(v_item->>'clearing_account_id','')::uuid;
      select type::text, upper(coalesce(currency,''))
        into v_instrument_type, v_instrument_currency
        from public.debt_accounts
       where id = v_instrument and user_id = v_user;
      if not found or v_instrument_type = 'credit_card' or v_instrument_currency <> v_currency then
        raise exception 'KIPU_FX_REQUIRED: loan source % is not a same-currency non-card debt',
          v_instrument using errcode = '22023';
      end if;
      select upper(coalesce(currency,'')) into v_clearing_currency
        from public.accounts
       where id = v_clearing and user_id = v_user;
      if not found or v_clearing_currency <> v_currency then
        raise exception 'KIPU_FX_REQUIRED: clearing account % is not in %',
          v_clearing, v_currency using errcode = '22023';
      end if;
    end if;
  end loop;

  insert into public.card_payment_groups (
    id, user_id, dedupe_key, debt_account_id, expected_due, total_paid,
    original_currency, base_currency, exchange_rate_to_base,
    statement_date, payment_date, fingerprint, remaining_due, statement_covered
  ) values (
    v_group, v_user, v_dedupe, v_card, v_expected, v_total,
    v_currency, v_base, v_rate,
    v_statement_date, v_payment_date, v_fingerprint, v_expected, false
  );

  v_running_due := v_expected;
  for v_item, v_ord in
    select value, ordinality::integer
      from jsonb_array_elements(v_sources) with ordinality
     order by ordinality
  loop
    v_kind := v_item->>'kind';
    v_instrument := nullif(v_item->>'instrument_id','')::uuid;
    v_clearing := nullif(v_item->>'clearing_account_id','')::uuid;
    v_amount := round((v_item->>'amount')::numeric, 2);
    v_amount_base := round(v_amount * v_rate, 2);
    v_funding_tx := null;

    if v_kind = 'loan' then
      -- ⚠ DEFECTO CORREGIDO POR LA 085, NO EDITAR ACÁ. Esta línea es lo que se
      -- aplicó en producción el 2026-07-27 y abortaba el pago multifuente
      -- entero: el validador del ledger (051) prohíbe debt/goal en un
      -- `adjustment`. La 085 lo quita. Se conserva tal cual porque una
      -- migración aplicada no se reescribe: la cadena tiene que ser 084 → 085.
      -- Borrowed funds are a balance adjustment, NOT income. `debt_account_id`
      -- identifies the liability in the audit row; the adjustment effect only
      -- credits the clearing account. The loan increase is part of this txn.
      v_entry := jsonb_build_object(
        'user_id', v_user,
        'type', 'adjustment',
        'effect_type', 'adjustment',
        'description', 'Fondos prestados para pago de tarjeta',
        'category', 'debt',
        'original_amount', v_amount,
        'original_currency', v_currency,
        'exchange_rate_to_base', v_rate,
        'base_amount', v_amount_base,
        'base_currency', v_base,
        'destination_account_id', v_clearing,
        'debt_account_id', v_instrument,
        'raw_input', v_raw,
        'input_channel', v_channel,
        'occurred_at', v_occurred,
        'external_ref', 'card-payment-group:' || v_group::text || ':loan:' || v_ord::text,
        'dedupe_key', v_dedupe || ':fund:' || v_ord::text
      );
      v_funding_tx := public.kipu_apply_ledger_entry(v_entry);
      update public.debt_accounts
         set current_balance_original = current_balance_original + v_amount,
             current_balance_base = current_balance_base + v_amount_base
       where id = v_instrument and user_id = v_user and type <> 'credit_card';
      if not found then
        raise exception 'KIPU_CONFLICT: loan source vanished while applying'
          using errcode = '22023';
      end if;
    else
      v_clearing := v_instrument;
    end if;

    v_entry := jsonb_build_object(
      'user_id', v_user,
      'type', 'debt_payment',
      'effect_type', 'debt_payment',
      'description', 'Pago de tarjeta (parte ' || v_ord::text || '/' || v_count::text || ')',
      'category', 'debt',
      'original_amount', v_amount,
      'original_currency', v_currency,
      'exchange_rate_to_base', v_rate,
      'base_amount', v_amount_base,
      'base_currency', v_base,
      'source_account_id', v_clearing,
      'debt_account_id', v_card,
      'raw_input', v_raw,
      'input_channel', v_channel,
      'occurred_at', v_occurred,
      'external_ref', 'card-payment-group:' || v_group::text || ':pay:' || v_ord::text,
      'dedupe_key', v_dedupe || ':pay:' || v_ord::text
    );
    v_result := public.kipu_apply_card_payment(
      v_entry,
      jsonb_build_object(
        'debt_account_id', v_card,
        'expected_due', v_running_due,
        'paid_in_card_currency', v_amount
      )
    );
    v_payment_tx := nullif(v_result->>'transaction_id','')::uuid;
    v_running_due := (v_result->>'remaining_due')::numeric;
    if v_payment_tx is null then
      raise exception 'KIPU_CONFLICT: card payment leg did not return a transaction'
        using errcode = '22023';
    end if;
    v_transactions := v_transactions || jsonb_build_array(v_payment_tx);

    insert into public.card_payment_group_legs (
      group_id, user_id, ordinal, kind, instrument_id, clearing_account_id,
      amount, base_amount, payment_transaction_id, funding_transaction_id
    ) values (
      v_group, v_user, v_ord, v_kind, v_instrument,
      case when v_kind = 'loan' then v_clearing else null end,
      v_amount, v_amount_base, v_payment_tx, v_funding_tx
    );
  end loop;

  update public.card_payment_groups
     set remaining_due = v_running_due,
         statement_covered = v_running_due <= 0.005
   where id = v_group;

  if v_capture_draft is not null and v_draft.status = 'open' then
    update public.card_payment_capture_drafts
       set status = 'resolved',
           resolved_at = now()
     where id = v_capture_draft and user_id = v_user and status = 'open';
    if not found then
      raise exception 'KIPU_CONFLICT: capture draft changed during payment'
        using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'outcome', 'applied',
    'group_id', v_group,
    'transaction_ids', v_transactions,
    'remaining_due', v_running_due,
    'statement_covered', v_running_due <= 0.005
  );
end;
$$;

alter function public.kipu_apply_card_payment_multi_source(jsonb) owner to postgres;
revoke all on function public.kipu_apply_card_payment_multi_source(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_apply_card_payment_multi_source(jsonb)
  to service_role;

-- Legacy/pending-reply path: the movement and the fact that its clarification
-- was answered are one operation. Previously the ledger committed first and a
-- best-effort UPDATE closed the pending row afterwards; a blip made Kipu ask
-- again about money already written. The pending id also becomes the durable
-- replay identity so retrying after a lost response cannot duplicate the row.
create or replace function public.kipu_apply_ledger_entry_and_resolve_pending(
  p_entry jsonb,
  p_pending_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p_entry->>'user_id','')::uuid;
  v_status text;
  v_tx uuid;
begin
  if v_user is null or p_pending_id is null then
    raise exception 'KIPU_VALIDATION: user and pending clarification required'
      using errcode = '22023';
  end if;
  select status into v_status
    from public.pending_chat_clarifications
   where id = p_pending_id and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: pending clarification not found/not owned'
      using errcode = '42501';
  end if;
  if v_status not in ('open','resolved') then
    raise exception 'KIPU_VALIDATION: pending clarification is no longer actionable (%)',
      v_status using errcode = '22023';
  end if;
  v_tx := public.kipu_apply_ledger_entry(
    p_entry || jsonb_build_object('dedupe_key', 'pending:' || p_pending_id::text)
  );
  if v_status = 'open' then
    update public.pending_chat_clarifications
       set status = 'resolved',
           resolved_at = now()
     where id = p_pending_id and user_id = v_user and status = 'open';
    if not found then
      raise exception 'KIPU_CONFLICT: pending clarification changed during write'
        using errcode = '22023';
    end if;
  end if;
  return jsonb_build_object(
    'outcome', case when v_status = 'resolved' then 'replayed' else 'applied' end,
    'transaction_id', v_tx
  );
end;
$$;

alter function public.kipu_apply_ledger_entry_and_resolve_pending(jsonb, uuid)
  owner to postgres;
revoke all on function public.kipu_apply_ledger_entry_and_resolve_pending(jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.kipu_apply_ledger_entry_and_resolve_pending(jsonb, uuid)
  to service_role;

-- Explicitly retracting a previously-declared split is allowed, but cancelling
-- the draft first and writing the single-source payment second would be another
-- saga. This wrapper consumes the draft and applies the ordinary card payment
-- under one transaction/lock. A replay sees both already durable.
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
  v_draft public.card_payment_capture_drafts%rowtype;
  v_result jsonb;
begin
  if v_user is null or v_card is null or p_capture_draft_id is null then
    raise exception 'KIPU_VALIDATION: payment, card and capture draft required'
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
  then
    raise exception 'KIPU_VALIDATION: capture draft missing, expired or incompatible'
      using errcode = '22023';
  end if;
  v_result := public.kipu_apply_card_payment_v2(p_entry, p_statement);
  if v_draft.status = 'open' then
    update public.card_payment_capture_drafts
       set status = 'resolved',
           resolved_at = now()
     where id = p_capture_draft_id and user_id = v_user and status = 'open';
    if not found then
      raise exception 'KIPU_CONFLICT: capture draft changed during payment'
        using errcode = '22023';
    end if;
  end if;
  return v_result || jsonb_build_object('capture_resolution','resolved');
end;
$$;

alter function public.kipu_apply_card_payment_and_resolve_capture(jsonb, jsonb, uuid)
  owner to postgres;
revoke all on function public.kipu_apply_card_payment_and_resolve_capture(jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.kipu_apply_card_payment_and_resolve_capture(jsonb, jsonb, uuid)
  to service_role;

-- Reversal-aware boundary. Generic ledger reversal restores account/card
-- balances, but it knows nothing about full_payment_due nor the durable payment
-- marker. This function restores every half together. For a multi-source group,
-- it also removes the borrowed-funds bridge and the exact loan increment.
create or replace function public.kipu_reverse_card_payment_operation(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_original uuid := nullif(p->>'transaction_id','')::uuid;
  v_raw text := nullif(p->>'raw_input','');
  v_channel text := coalesce(nullif(p->>'input_channel',''), 'chat');
  v_occurred timestamptz := coalesce(nullif(p->>'occurred_at','')::timestamptz, now());
  v_group public.card_payment_groups%rowtype;
  v_app public.card_payment_applications%rowtype;
  v_leg public.card_payment_group_legs%rowtype;
  v_card_due numeric;
  v_card_total numeric;
  v_card_statement date;
  v_restored_due numeric;
  v_payment_reversal uuid;
  v_funding_reversal uuid;
  v_reversals jsonb := '[]'::jsonb;
begin
  if v_user is null or v_original is null then
    raise exception 'KIPU_VALIDATION: user_id and transaction_id required'
      using errcode = '22023';
  end if;

  select g.* into v_group
    from public.card_payment_groups g
    join public.card_payment_group_legs l on l.group_id = g.id
   where g.user_id = v_user and l.payment_transaction_id = v_original
   for update of g;

  if found then
    select full_payment_due, statement_total_due, statement_date
      into v_card_due, v_card_total, v_card_statement
      from public.debt_accounts
     where id = v_group.debt_account_id and user_id = v_user
     for update;
    if not found then
      raise exception 'KIPU_CONFLICT: card vanished while reversing payment group'
        using errcode = '22023';
    end if;
    if v_group.reversed_at is not null then
      select coalesce(jsonb_agg(payment_reversal_transaction_id order by ordinal), '[]'::jsonb)
        into v_reversals
        from public.card_payment_group_legs
       where group_id = v_group.id;
      return jsonb_build_object(
        'outcome', 'already_reversed',
        'group_id', v_group.id,
        'debt_account_id', v_group.debt_account_id,
        'reversal_transaction_ids', v_reversals,
        'restored_due', coalesce(v_card_due, 0),
        'statement_touched', v_card_statement is not distinct from v_group.statement_date
      );
    end if;

    -- Reverse payment legs first (account/card), then the borrowed bridge
    -- (clearing account) and finally the loan increment. Reverse ordinal order
    -- mirrors the forward sequence and keeps the ledger trail easy to read.
    for v_leg in
      select * from public.card_payment_group_legs
       where group_id = v_group.id
       order by ordinal desc
       for update
    loop
      v_payment_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
        'user_id', v_user,
        'type', 'reversal',
        'sign', -1,
        'related_transaction_id', v_leg.payment_transaction_id,
        'raw_input', v_raw,
        'input_channel', v_channel,
        'occurred_at', v_occurred
      ));
      v_funding_reversal := null;
      if v_leg.kind = 'loan' then
        v_funding_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
          'user_id', v_user,
          'type', 'reversal',
          'sign', -1,
          'related_transaction_id', v_leg.funding_transaction_id,
          'raw_input', v_raw,
          'input_channel', v_channel,
          'occurred_at', v_occurred
        ));
        update public.debt_accounts
           set current_balance_original = current_balance_original - v_leg.amount,
               current_balance_base = current_balance_base - v_leg.base_amount
         where id = v_leg.instrument_id and user_id = v_user and type <> 'credit_card';
        if not found then
          raise exception 'KIPU_CONFLICT: loan source vanished while reversing'
            using errcode = '22023';
        end if;
      end if;
      update public.card_payment_group_legs
         set payment_reversal_transaction_id = v_payment_reversal,
             funding_reversal_transaction_id = v_funding_reversal
       where id = v_leg.id;
      update public.card_payment_applications
         set reversal_transaction_id = v_payment_reversal,
             reversed_at = now()
       where user_id = v_user and transaction_id = v_leg.payment_transaction_id;
      v_reversals := v_reversals || jsonb_build_array(v_payment_reversal);
    end loop;

    if v_card_statement is not distinct from v_group.statement_date then
      v_restored_due := least(
        coalesce(v_card_total, coalesce(v_card_due, 0) + v_group.total_paid),
        round(coalesce(v_card_due, 0) + v_group.total_paid, 2)
      );
      update public.debt_accounts
         set full_payment_due = v_restored_due,
             statement_covered = v_restored_due <= 0.005
       where id = v_group.debt_account_id and user_id = v_user;
    else
      -- A newer statement exists. The historical payment balance effect still
      -- reverses, but it must never rewrite the current cycle.
      v_restored_due := coalesce(v_card_due, 0);
    end if;
    update public.card_payment_groups
       set reversed_at = now()
     where id = v_group.id;
    return jsonb_build_object(
      'outcome', 'reversed',
      'group_id', v_group.id,
      'debt_account_id', v_group.debt_account_id,
      'reversal_transaction_ids', v_reversals,
      'restored_due', v_restored_due,
      'statement_touched', v_card_statement is not distinct from v_group.statement_date
    );
  end if;

  select * into v_app
    from public.card_payment_applications
   where user_id = v_user and transaction_id = v_original
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_card_payment');
  end if;

  select full_payment_due, statement_total_due, statement_date
    into v_card_due, v_card_total, v_card_statement
    from public.debt_accounts
   where id = v_app.debt_account_id and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_CONFLICT: card vanished while reversing payment'
      using errcode = '22023';
  end if;
  if v_app.reversed_at is not null then
    return jsonb_build_object(
      'outcome', 'already_reversed',
      'debt_account_id', v_app.debt_account_id,
      'reversal_transaction_ids', jsonb_build_array(v_app.reversal_transaction_id),
      'restored_due', coalesce(v_card_due, 0),
      'statement_touched', v_card_statement is not distinct from v_app.statement_date
    );
  end if;

  v_payment_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id', v_user,
    'type', 'reversal',
    'sign', -1,
    'related_transaction_id', v_original,
    'raw_input', v_raw,
    'input_channel', v_channel,
    'occurred_at', v_occurred
  ));
  if v_card_statement is not distinct from v_app.statement_date then
    v_restored_due := least(
      coalesce(v_card_total, coalesce(v_card_due, 0) + v_app.paid_in_card_currency),
      round(coalesce(v_card_due, 0) + v_app.paid_in_card_currency, 2)
    );
    update public.debt_accounts
       set full_payment_due = v_restored_due,
           statement_covered = v_restored_due <= 0.005
     where id = v_app.debt_account_id and user_id = v_user;
  else
    v_restored_due := coalesce(v_card_due, 0);
  end if;
  update public.card_payment_applications
     set reversal_transaction_id = v_payment_reversal,
         reversed_at = now()
   where user_id = v_user and transaction_id = v_original;
  return jsonb_build_object(
    'outcome', 'reversed',
    'debt_account_id', v_app.debt_account_id,
    'reversal_transaction_ids', jsonb_build_array(v_payment_reversal),
    'restored_due', v_restored_due,
    'statement_touched', v_card_statement is not distinct from v_app.statement_date
  );
end;
$$;

-- Card-aware correction = reversal (including statement/group/loan) + new
-- payment in the SAME transaction. Non-card debt payments return not_card_payment
-- so the existing generic correction remains available for loans.
create or replace function public.kipu_correct_card_payment(
  p_user_id uuid,
  p_original_transaction_id uuid,
  p_entry jsonb,
  p_statement jsonb,
  p_raw_input text default null,
  p_input_channel text default 'chat'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reverse jsonb;
  v_group uuid;
  v_original_card uuid;
  v_target_card uuid := nullif(p_statement->>'debt_account_id','')::uuid;
  v_expected numeric := nullif(p_statement->>'expected_due','')::numeric;
  v_target_type text;
  v_statement_touched boolean;
  v_apply jsonb;
begin
  -- A multi-source payment is one operation represented by several ledger
  -- rows. A generic `correct_movement` payload describes only ONE replacement
  -- row, so using it here would reverse the whole group and recreate just the
  -- selected leg. Refuse before any write until a full replacement contract
  -- (all sources + amounts) is supplied.
  select group_id into v_group
    from public.card_payment_group_legs
   where user_id = p_user_id
     and payment_transaction_id = p_original_transaction_id;
  if v_group is not null then
    return jsonb_build_object(
      'outcome', 'multi_source_correction_requires_replacement',
      'group_id', v_group
    );
  end if;
  v_reverse := public.kipu_reverse_card_payment_operation(jsonb_build_object(
    'user_id', p_user_id,
    'transaction_id', p_original_transaction_id,
    'raw_input', p_raw_input,
    'input_channel', p_input_channel,
    'occurred_at', now()
  ));
  if v_reverse->>'outcome' = 'not_card_payment' then
    return v_reverse;
  end if;
  v_original_card := nullif(v_reverse->>'debt_account_id','')::uuid;
  v_statement_touched := coalesce((v_reverse->>'statement_touched')::boolean, false);
  if v_target_card is null then
    raise exception 'KIPU_VALIDATION: corrected card required'
      using errcode = '22023';
  end if;
  select type::text into v_target_type
    from public.debt_accounts
   where id = v_target_card and user_id = p_user_id
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: corrected debt target not found'
      using errcode = '22023';
  end if;
  if v_target_card = v_original_card and v_statement_touched then
    v_expected := nullif(v_reverse->>'restored_due','')::numeric;
  end if;
  if v_target_type = 'credit_card'
     and (v_target_card <> v_original_card or v_statement_touched)
     and v_expected is not null and v_expected > 0
  then
    v_apply := public.kipu_apply_card_payment(
      p_entry,
      p_statement || jsonb_build_object('expected_due', v_expected)
    );
  else
    -- Loan payment or a credit card without an active statement: balances are
    -- still corrected atomically, but there is no statement half to reduce.
    v_apply := jsonb_build_object(
      'transaction_id', public.kipu_apply_ledger_entry(p_entry),
      'replayed', false,
      'statement_reduced', false,
      'remaining_due', greatest(coalesce(v_expected, 0), 0),
      'statement_covered', coalesce(v_expected, 0) <= 0.005
    );
  end if;
  return jsonb_build_object(
    'outcome', 'corrected',
    'reversal', v_reverse,
    'payment', v_apply
  );
end;
$$;

-- A loan-out is not "an expense, and later maybe a receivable". Both facts are
-- one financial operation. The origin transaction is the durable replay key.
-- First reconcile historical generic corrections/reversals. Without this
-- bridge, a corrected loan would still point at its inactive transaction and a
-- later undo could close or recreate the wrong receivable.
with corrected_receivables as (
  select
    r.id as receivable_id,
    c.id as corrected_transaction_id,
    c.original_amount as corrected_amount,
    upper(c.original_currency) as corrected_currency,
    greatest(round(r.original_amount - r.outstanding_amount, 2), 0) as already_paid
  from public.receivables r
  join public.transactions c
    on c.user_id = r.user_id
   and c.dedupe_key = 'correction:' || r.origin_transaction_id::text
  where r.origin_transaction_id is not null
)
update public.receivables r
   set origin_transaction_id = c.corrected_transaction_id,
       original_amount = c.corrected_amount,
       outstanding_amount = greatest(round(c.corrected_amount - c.already_paid, 2), 0),
       currency = c.corrected_currency,
       status = case
         when greatest(round(c.corrected_amount - c.already_paid, 2), 0) <= 0.005
           then 'settled'
         when c.already_paid > 0.005 then 'partial'
         else 'open'
       end
  from corrected_receivables c
 where r.id = c.receivable_id;

update public.receivables r
   set outstanding_amount = 0,
       status = 'written_off'
 where r.origin_transaction_id is not null
   and r.status <> 'written_off'
   and exists (
     select 1
       from public.transactions rev
      where rev.user_id = r.user_id
        and rev.type = 'reversal'
        and rev.related_transaction_id = r.origin_transaction_id
   );

create unique index if not exists receivables_origin_transaction_uq
  on public.receivables (user_id, origin_transaction_id)
  where origin_transaction_id is not null;

create table if not exists public.fixed_expense_payment_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  fixed_expense_id uuid not null references public.fixed_expenses(id) on delete restrict,
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  operation_kind text not null check (operation_kind in ('create','update')),
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key),
  unique (user_id, transaction_id)
);
alter table public.fixed_expense_payment_applications enable row level security;
drop policy if exists "fixed_expense_payment_applications_select_own"
  on public.fixed_expense_payment_applications;
create policy "fixed_expense_payment_applications_select_own"
  on public.fixed_expense_payment_applications for select
  using (auth.uid() = user_id);
revoke all on table public.fixed_expense_payment_applications
  from public, anon, authenticated;
grant select on table public.fixed_expense_payment_applications to authenticated;
grant all on table public.fixed_expense_payment_applications to service_role;

-- Closing an account is also a compound operation: reconcile-to-zero + closed
-- status. Without a marker, undoing the reconciliation would put money back
-- into an account that stayed hidden as closed. The marker lets the universal
-- undo restore both halves atomically.
create table if not exists public.account_close_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  account_id uuid not null references public.accounts(id) on delete restrict,
  previous_status text not null,
  transaction_id uuid references public.transactions(id) on delete restrict,
  reversal_transaction_id uuid references public.transactions(id) on delete restrict,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, operation_id),
  unique (user_id, transaction_id)
);
alter table public.account_close_applications enable row level security;
drop policy if exists "account_close_applications_select_own"
  on public.account_close_applications;
create policy "account_close_applications_select_own"
  on public.account_close_applications for select
  using (auth.uid() = user_id);
revoke all on table public.account_close_applications
  from public, anon, authenticated;
grant select on table public.account_close_applications to authenticated;
grant all on table public.account_close_applications to service_role;

create table if not exists public.installment_plan_purchase_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  installment_plan_id uuid not null references public.installment_plans(id) on delete restrict,
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  fingerprint text not null,
  reversal_transaction_id uuid null references public.transactions(id) on delete restrict,
  reversed_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key),
  unique (user_id, installment_plan_id),
  unique (user_id, transaction_id)
);
alter table public.installment_plan_purchase_applications
  add column if not exists reversal_transaction_id uuid null
    references public.transactions(id) on delete restrict;
alter table public.installment_plan_purchase_applications
  add column if not exists reversed_at timestamptz null;
alter table public.installment_plan_purchase_applications
  drop constraint if exists installment_plan_purchase_reversal_pair_ck;
alter table public.installment_plan_purchase_applications
  add constraint installment_plan_purchase_reversal_pair_ck check (
    (reversed_at is null and reversal_transaction_id is null)
    or (reversed_at is not null and reversal_transaction_id is not null)
  );
alter table public.installment_plan_purchase_applications enable row level security;
drop policy if exists "installment_plan_purchase_applications_select_own"
  on public.installment_plan_purchase_applications;
create policy "installment_plan_purchase_applications_select_own"
  on public.installment_plan_purchase_applications for select
  using (auth.uid() = user_id);
revoke all on table public.installment_plan_purchase_applications
  from public, anon, authenticated;
grant select on table public.installment_plan_purchase_applications to authenticated;
grant all on table public.installment_plan_purchase_applications to service_role;

-- Plans created before this migration already carry the canonical
-- `installment:<plan_id>` provenance on their purchase. Backfill a durable
-- application marker so undo/cancel cannot reverse the card debt while leaving
-- the future monthly commitment active (or close the plan while leaving debt).
insert into public.installment_plan_purchase_applications (
  user_id, dedupe_key, installment_plan_id, transaction_id, fingerprint
)
select distinct on (p.user_id, p.id)
  p.user_id,
  'historic:installment:' || p.id::text,
  p.id,
  t.id,
  md5(jsonb_build_object(
    'historic', true,
    'plan_id', p.id,
    'transaction_id', t.id
  )::text)
from public.installment_plans p
join public.transactions t
  on t.user_id = p.user_id
 and t.external_ref = 'installment:' || p.id::text
 and t.type = 'expense'
left join public.installment_plan_purchase_applications a
  on a.user_id = p.user_id
 and a.installment_plan_id = p.id
where a.id is null
order by
  p.user_id,
  p.id,
  exists (
    select 1
      from public.transactions r
     where r.user_id = t.user_id
       and r.type = 'reversal'
       and r.related_transaction_id = t.id
  ),
  t.created_at desc,
  t.id desc
on conflict do nothing;

-- If the only historical purchase is already reversed (a true cancellation,
-- not a correction with a newer live replacement), carry that durable fact
-- into the marker and stop the future plan. The ordering above deliberately
-- prefers an unreversed replacement first.
with historic_reversals as (
  select distinct on (a.id)
    a.id as application_id,
    a.installment_plan_id,
    r.id as reversal_transaction_id,
    r.created_at as reversed_at
  from public.installment_plan_purchase_applications a
  join public.transactions r
    on r.user_id = a.user_id
   and r.type = 'reversal'
   and r.related_transaction_id = a.transaction_id
  where a.reversed_at is null
  order by a.id, r.created_at, r.id
),
marked as (
  update public.installment_plan_purchase_applications a
     set reversal_transaction_id = h.reversal_transaction_id,
         reversed_at = h.reversed_at
    from historic_reversals h
   where a.id = h.application_id
  returning a.installment_plan_id
)
-- Auditoría de Claude sobre este backfill: `paid_off_at = null` incondicional
-- BORRA el hecho de que un plan se liquidó. El informe de esta misma migración
-- dice que «un plan liquidado no se revierte automáticamente porque podría crear
-- un crédito falso» — la regla no se estaba aplicando al backfill a sí mismo.
-- Un plan LIQUIDADO se deja intacto: su compra revertida es una contradicción de
-- datos que debe mirarse a mano, no resolverse borrando la liquidación.
-- (Radio hoy: cero — 0 planes de cuotas en producción. Es preventivo.)
update public.installment_plans p
   set status = 'cancelled'
 where p.id in (select installment_plan_id from marked)
   and p.paid_off_at is null;

-- A financed purchase is plan + full card debt, not two best-effort writes.
-- The former caller inserted the plan, tried the ledger, and compensated by
-- cancelling the plan. A lost response could duplicate the plan or leave an
-- active plan without its purchase. The durable marker makes replay exact.
create or replace function public.kipu_create_installment_plan_with_purchase(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_dedupe text := nullif(p->>'dedupe_key','');
  v_plan jsonb := p->'plan';
  v_entry jsonb := p->'entry';
  v_card uuid := nullif(v_plan->>'debt_account_id','')::uuid;
  v_description text := nullif(btrim(v_plan->>'description'),'');
  v_total_original numeric := round(nullif(v_plan->>'total_original','')::numeric, 2);
  v_original_currency text := upper(coalesce(nullif(v_plan->>'original_currency',''),''));
  v_total_base numeric := round(nullif(v_plan->>'total_base','')::numeric, 2);
  v_base_currency text := upper(coalesce(nullif(v_plan->>'base_currency',''),''));
  v_months integer := nullif(v_plan->>'months_total','')::integer;
  v_first_due date := nullif(v_plan->>'first_statement_due','')::date;
  v_surcharge numeric := round(coalesce(nullif(v_plan->>'surcharge_base','')::numeric, 0), 2);
  v_anniversary integer := nullif(v_plan->>'anniversary_day','')::integer;
  v_category public.financial_category :=
    coalesce(nullif(v_plan->>'category',''),'shopping')::public.financial_category;
  v_card_type text;
  v_card_currency text;
  v_plan_id uuid := gen_random_uuid();
  v_tx uuid;
  v_fingerprint text;
  v_existing public.installment_plan_purchase_applications%rowtype;
begin
  if v_user is null or v_dedupe is null or jsonb_typeof(v_entry) <> 'object'
     or v_card is null or v_description is null
     or v_total_original is null or v_total_original <= 0
     or v_total_base is null or v_total_base <= 0
     or v_original_currency !~ '^[A-Z]{3}$'
     or v_base_currency !~ '^[A-Z]{3}$'
     or v_months is null or v_months not between 1 and 60
     or v_first_due is null
     or v_surcharge < 0 or v_surcharge >= v_total_base
     or (v_anniversary is not null and v_anniversary not between 1 and 31)
  then
    raise exception 'KIPU_VALIDATION: malformed installment plan purchase'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || '|' || v_dedupe, 0));
  v_fingerprint := md5(jsonb_build_object(
    'plan',v_plan,
    'entry',v_entry - array['raw_input','occurred_at']::text[]
  )::text);
  select * into v_existing
    from public.installment_plan_purchase_applications
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  if found then
    if v_existing.fingerprint is distinct from v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: installment purchase identity reused'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed',
      'installment_plan_id',v_existing.installment_plan_id,
      'transaction_id',v_existing.transaction_id
    );
  end if;
  select type::text, upper(coalesce(currency,''))
    into v_card_type, v_card_currency
    from public.debt_accounts
   where id = v_card and user_id = v_user
   for update;
  if not found or v_card_type <> 'credit_card' then
    raise exception 'KIPU_OWNERSHIP: installment card not found/not owned'
      using errcode = '42501';
  end if;
  if v_card_currency <> v_original_currency
     or nullif(v_entry->>'debt_account_id','')::uuid is distinct from v_card
     or v_entry->>'type' <> 'expense'
     or round(nullif(v_entry->>'original_amount','')::numeric, 2)
          is distinct from v_total_original
     or upper(coalesce(v_entry->>'original_currency',''))
          is distinct from v_original_currency
     or round(nullif(v_entry->>'base_amount','')::numeric, 2)
          is distinct from v_total_base
     or upper(coalesce(v_entry->>'base_currency',''))
          is distinct from v_base_currency
  then
    raise exception 'KIPU_VALIDATION: installment plan and ledger purchase disagree'
      using errcode = '22023';
  end if;
  insert into public.installment_plans (
    id, user_id, debt_account_id, description,
    total_original, original_currency, total_base, base_currency,
    installment_base, months_total, first_statement_due, surcharge_base,
    anniversary_day, category, status
  ) values (
    v_plan_id, v_user, v_card, left(v_description,200),
    v_total_original, v_original_currency, v_total_base, v_base_currency,
    round(v_total_base / v_months, 2), v_months, v_first_due, v_surcharge,
    v_anniversary, v_category, 'active'
  );
  v_tx := public.kipu_apply_ledger_entry(
    v_entry || jsonb_build_object('external_ref','installment:' || v_plan_id::text)
  );
  insert into public.installment_plan_purchase_applications (
    user_id, dedupe_key, installment_plan_id, transaction_id, fingerprint
  ) values (
    v_user, v_dedupe, v_plan_id, v_tx, v_fingerprint
  );
  return jsonb_build_object(
    'outcome','applied',
    'installment_plan_id',v_plan_id,
    'transaction_id',v_tx
  );
end;
$$;

-- Creating/updating a recurring definition with "pay now" is also one user
-- request. Previously the definition committed first and the payment could fail,
-- leaving a partial success. This RPC owns both shapes and their replay marker.
create or replace function public.kipu_apply_fixed_expense_with_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_mode text := p->>'mode';
  v_dedupe text := nullif(p->>'dedupe_key','');
  v_fixed jsonb := p->'fixed';
  v_patch jsonb := coalesce(p->'patch', '{}'::jsonb);
  v_entry jsonb := p->'entry';
  v_fixed_id uuid := nullif(p->>'fixed_expense_id','')::uuid;
  v_name text := nullif(btrim(v_fixed->>'name'),'');
  v_amount numeric := round(nullif(v_fixed->>'amount','')::numeric, 2);
  v_currency text := upper(coalesce(nullif(v_fixed->>'currency',''),''));
  v_category public.financial_category;
  v_frequency text;
  v_source_type text;
  v_source uuid;
  v_source_currency text;
  v_tx uuid;
  v_fingerprint text;
  v_existing public.fixed_expense_payment_applications%rowtype;
begin
  if v_user is null or v_dedupe is null or v_mode not in ('create','update')
     or jsonb_typeof(v_entry) is distinct from 'object'
  then
    raise exception 'KIPU_VALIDATION: invalid fixed-expense payment identity'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || '|' || v_dedupe, 0));
  v_fingerprint := md5(jsonb_build_object(
    'mode', v_mode, 'fixed_expense_id', v_fixed_id, 'fixed', v_fixed,
    'patch', v_patch,
    'entry', v_entry - array['raw_input','occurred_at']::text[]
  )::text);
  select * into v_existing
    from public.fixed_expense_payment_applications
   where user_id = v_user and dedupe_key = v_dedupe
   for update;
  if found then
    if v_existing.fingerprint is distinct from v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: fixed payment identity reused'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome', 'replayed',
      'fixed_expense_id', v_existing.fixed_expense_id,
      'transaction_id', v_existing.transaction_id
    );
  end if;

  if v_mode = 'create' then
    v_category := coalesce(nullif(v_fixed->>'category',''), 'other')::public.financial_category;
    v_frequency := coalesce(nullif(v_fixed->>'frequency',''), 'monthly');
    v_source_type := nullif(v_fixed->>'payment_source_type','');
    v_source := nullif(v_fixed->>'payment_source_id','')::uuid;
    if v_name is null or v_amount is null or v_amount <= 0
       or v_currency !~ '^[A-Z]{3}$'
       or v_frequency not in ('weekly','biweekly','monthly','yearly','custom')
       or v_source_type is distinct from 'account' or v_source is null
    then
      raise exception 'KIPU_VALIDATION: malformed fixed expense'
        using errcode = '22023';
    end if;
    insert into public.fixed_expenses (
      user_id, name, amount, currency, category, frequency, start_date,
      payment_source_type, payment_source_id, is_essential, is_active
    ) values (
      v_user, v_name, v_amount, v_currency, v_category, v_frequency,
      nullif(v_fixed->>'start_date','')::date,
      v_source_type, v_source,
      coalesce((v_fixed->>'is_essential')::boolean, false), true
    )
    returning id into v_fixed_id;
  else
    if v_fixed_id is null then
      raise exception 'KIPU_VALIDATION: fixed_expense_id required for update'
        using errcode = '22023';
    end if;
    select name, amount, upper(currency), category, frequency,
           payment_source_type, payment_source_id
      into v_name, v_amount, v_currency, v_category, v_frequency,
           v_source_type, v_source
      from public.fixed_expenses
     where id = v_fixed_id and user_id = v_user
     for update;
    if not found then
      raise exception 'KIPU_OWNERSHIP: fixed expense not found/not owned'
        using errcode = '42501';
    end if;
    update public.fixed_expenses
       set amount = case when v_patch ? 'amount' then (v_patch->>'amount')::numeric else amount end,
           start_date = case when v_patch ? 'start_date' then nullif(v_patch->>'start_date','')::date else start_date end,
           is_active = case when v_patch ? 'is_active' then (v_patch->>'is_active')::boolean else is_active end,
           expected_day = case when v_patch ? 'expected_day' then nullif(v_patch->>'expected_day','')::integer else expected_day end,
           name = case when v_patch ? 'name' then nullif(btrim(v_patch->>'name'),'') else name end,
           currency = case when v_patch ? 'currency' then upper(v_patch->>'currency') else currency end,
           is_variable = case when v_patch ? 'is_variable' then (v_patch->>'is_variable')::boolean else is_variable end,
           notes = case when v_patch ? 'notes' then v_patch->>'notes' else notes end,
           last_confirmed_month = case when v_patch ? 'last_confirmed_month' then nullif(v_patch->>'last_confirmed_month','')::date else last_confirmed_month end
     where id = v_fixed_id and user_id = v_user;
    select name, amount, upper(currency), payment_source_type, payment_source_id
      into v_name, v_amount, v_currency, v_source_type, v_source
      from public.fixed_expenses
     where id = v_fixed_id and user_id = v_user;
    -- A one-off payment may come from a different account than the recurring
    -- default. The entry's source is authoritative for today's movement; it is
    -- locked/validated below and does not silently rewrite the plan default.
    v_source := nullif(v_entry->>'source_account_id','')::uuid;
  end if;

  if round(nullif(v_entry->>'original_amount','')::numeric, 2) is distinct from round(v_amount, 2)
     or upper(coalesce(v_entry->>'original_currency','')) is distinct from v_currency
     or nullif(v_entry->>'source_account_id','')::uuid is distinct from v_source
     or v_entry->>'type' <> 'expense'
  then
    raise exception 'KIPU_VALIDATION: payment does not match fixed definition/source'
      using errcode = '22023';
  end if;
  select upper(currency) into v_source_currency
    from public.accounts
   where id = v_source and user_id = v_user
   for update;
  if not found or v_source_currency <> v_currency then
    raise exception 'KIPU_FX_REQUIRED: fixed payment source currency mismatch'
      using errcode = '22023';
  end if;
  v_tx := public.kipu_apply_ledger_entry(
    v_entry || jsonb_build_object('recurring_expense_id', v_fixed_id)
  );
  insert into public.fixed_expense_payment_applications (
    user_id, dedupe_key, fixed_expense_id, transaction_id,
    operation_kind, fingerprint
  ) values (
    v_user, v_dedupe, v_fixed_id, v_tx, v_mode, v_fingerprint
  );
  return jsonb_build_object(
    'outcome', 'applied',
    'fixed_expense_id', v_fixed_id,
    'transaction_id', v_tx
  );
end;
$$;

create or replace function public.kipu_record_person_loan_out(
  p_entry jsonb,
  p_receivable jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p_entry->>'user_id','')::uuid;
  v_counterparty text := nullif(btrim(p_receivable->>'counterparty'),'');
  v_amount numeric := round(nullif(p_receivable->>'amount','')::numeric, 2);
  v_currency text := upper(coalesce(nullif(p_receivable->>'currency',''),''));
  v_reason text := nullif(p_receivable->>'reason','');
  v_tx uuid;
  v_receivable public.receivables%rowtype;
  v_actual public.transactions%rowtype;
begin
  if v_user is null or v_counterparty is null or v_amount is null or v_amount <= 0
     or v_currency !~ '^[A-Z]{3}$'
     or p_entry->>'type' <> 'expense'
  then
    raise exception 'KIPU_VALIDATION: invalid person-loan operation'
      using errcode = '22023';
  end if;
  v_tx := public.kipu_apply_ledger_entry(p_entry);
  select * into v_actual
    from public.transactions
   where id = v_tx and user_id = v_user
   for update;
  if not found
     or v_actual.type <> 'expense'
     or round(v_actual.original_amount, 2) is distinct from v_amount
     or upper(v_actual.original_currency) is distinct from v_currency
  then
    raise exception 'KIPU_DEDUPE_MISMATCH: loan ledger entry does not match receivable'
      using errcode = '22023';
  end if;

  select * into v_receivable
    from public.receivables
   where user_id = v_user and origin_transaction_id = v_tx
   for update;
  if found then
    if v_receivable.direction <> 'owed_to_user'
       or round(v_receivable.original_amount, 2) is distinct from v_amount
       or upper(v_receivable.currency) is distinct from v_currency
       or btrim(v_receivable.counterparty) is distinct from v_counterparty
    then
      raise exception 'KIPU_DEDUPE_MISMATCH: loan operation replayed with different receivable'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome', 'replayed',
      'transaction_id', v_tx,
      'receivable_id', v_receivable.id
    );
  end if;

  insert into public.receivables (
    user_id, counterparty, direction, original_amount, outstanding_amount,
    currency, reason, status, origin_transaction_id
  ) values (
    v_user, v_counterparty, 'owed_to_user', v_amount, v_amount,
    v_currency, v_reason, 'open', v_tx
  )
  returning * into v_receivable;

  return jsonb_build_object(
    'outcome', 'applied',
    'transaction_id', v_tx,
    'receivable_id', v_receivable.id
  );
end;
$$;

-- Universal append-only undo: card statement/application state and receivables
-- are second financial halves of their ledger rows. Generic reversal alone
-- leaves those halves live. This boundary either reverses every half or none.
create or replace function public.kipu_reverse_financial_operation(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_original uuid := nullif(p->>'transaction_id','')::uuid;
  v_card jsonb;
  v_receivable public.receivables%rowtype;
  v_existing uuid;
  v_reversal uuid;
  v_close public.account_close_applications%rowtype;
  v_installment public.installment_plan_purchase_applications%rowtype;
  v_installment_status text;
  v_account_status text;
  v_original_source uuid;
  v_original_destination uuid;
begin
  if v_user is null or v_original is null then
    raise exception 'KIPU_VALIDATION: user_id and transaction_id required'
      using errcode = '22023';
  end if;
  v_card := public.kipu_reverse_card_payment_operation(p);
  if v_card->>'outcome' <> 'not_card_payment' then
    return v_card;
  end if;

  select * into v_installment
    from public.installment_plan_purchase_applications
   where user_id = v_user and transaction_id = v_original
   for update;
  if found then
    select status::text into v_installment_status
      from public.installment_plans
     where id = v_installment.installment_plan_id and user_id = v_user
     for update;
    if not found then
      raise exception 'KIPU_CONFLICT: installment plan vanished during undo'
        using errcode = '22023';
    end if;
    if v_installment.reversed_at is not null then
      update public.installment_plans
         set status = 'cancelled',
             paid_off_at = null
       where id = v_installment.installment_plan_id and user_id = v_user;
      return jsonb_build_object(
        'outcome','already_reversed_installment_purchase',
        'reversal_transaction_ids',jsonb_build_array(v_installment.reversal_transaction_id),
        'installment_plan_id',v_installment.installment_plan_id
      );
    end if;
    if v_installment_status = 'paid_off' then
      return jsonb_build_object(
        'outcome','installment_purchase_paid_requires_review',
        'installment_plan_id',v_installment.installment_plan_id
      );
    end if;
    v_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
      'user_id', v_user,
      'type', 'reversal',
      'sign', -1,
      'related_transaction_id', v_original,
      'raw_input', p->>'raw_input',
      'input_channel', coalesce(nullif(p->>'input_channel',''), 'chat'),
      'occurred_at', coalesce(nullif(p->>'occurred_at','')::timestamptz, now())
    ));
    if v_reversal is null then
      raise exception 'KIPU_CONFLICT: installment reversal returned no transaction'
        using errcode = '22023';
    end if;
    update public.installment_plans
       set status = 'cancelled',
           paid_off_at = null
     where id = v_installment.installment_plan_id and user_id = v_user;
    update public.installment_plan_purchase_applications
       set reversal_transaction_id = v_reversal,
           reversed_at = now()
     where id = v_installment.id;
    return jsonb_build_object(
      'outcome','reversed_installment_purchase',
      'reversal_transaction_ids',jsonb_build_array(v_reversal),
      'installment_plan_id',v_installment.installment_plan_id
    );
  end if;

  select * into v_close
    from public.account_close_applications
   where user_id = v_user and transaction_id = v_original
   for update;
  if found then
    select status into v_account_status
      from public.accounts
     where id = v_close.account_id and user_id = v_user
     for update;
    if not found then
      raise exception 'KIPU_CONFLICT: closed account vanished during undo'
        using errcode = '22023';
    end if;
    if v_close.reversed_at is not null then
      return jsonb_build_object(
        'outcome','already_reversed_account_close',
        'reversal_transaction_ids',jsonb_build_array(v_close.reversal_transaction_id),
        'account_id',v_close.account_id
      );
    end if;
    v_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
      'user_id', v_user,
      'type', 'reversal',
      'sign', -1,
      'related_transaction_id', v_original,
      'raw_input', p->>'raw_input',
      'input_channel', coalesce(nullif(p->>'input_channel',''), 'chat'),
      'occurred_at', coalesce(nullif(p->>'occurred_at','')::timestamptz, now())
    ));
    update public.accounts
       set status = v_close.previous_status
     where id = v_close.account_id and user_id = v_user;
    update public.account_close_applications
       set reversal_transaction_id = v_reversal,
           reversed_at = now()
     where id = v_close.id;
    return jsonb_build_object(
      'outcome','reversed_account_close',
      'reversal_transaction_ids',jsonb_build_array(v_reversal),
      'account_id',v_close.account_id
    );
  end if;

  select source_account_id, destination_account_id
    into v_original_source, v_original_destination
    from public.transactions
   where id = v_original and user_id = v_user;
  if exists (
    select 1
      from public.accounts
     where user_id = v_user
       and id in (v_original_source, v_original_destination)
       and status = 'closed'
  ) then
    -- Historical closes predate the durable marker. A generic reversal could
    -- put money into a still-hidden account; refuse until the account is
    -- explicitly reopened/reconciled through a domain operation.
    return jsonb_build_object(
      'outcome','closed_account_operation_requires_reopen',
      'account_ids',jsonb_build_array(v_original_source, v_original_destination)
    );
  end if;

  select id into v_existing
    from public.transactions
   where user_id = v_user and type = 'reversal'
     and related_transaction_id = v_original;
  select * into v_receivable
    from public.receivables
   where user_id = v_user and origin_transaction_id = v_original
   for update;

  v_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id', v_user,
    'type', 'reversal',
    'sign', -1,
    'related_transaction_id', v_original,
    'raw_input', p->>'raw_input',
    'input_channel', coalesce(nullif(p->>'input_channel',''), 'chat'),
    'occurred_at', coalesce(nullif(p->>'occurred_at','')::timestamptz, now())
  ));
  if v_reversal is null then
    raise exception 'KIPU_CONFLICT: reversal did not return a transaction'
      using errcode = '22023';
  end if;
  if v_receivable.id is not null and v_receivable.status <> 'written_off' then
    update public.receivables
       set outstanding_amount = 0,
           status = 'written_off'
     where id = v_receivable.id;
  end if;
  return jsonb_build_object(
    'outcome', case when v_existing is null then 'reversed' else 'already_reversed' end,
    'reversal_transaction_ids', jsonb_build_array(v_reversal),
    'restored_due', 0,
    'receivable_id', v_receivable.id
  );
end;
$$;

-- Bulk undo is a single transaction, not a best-effort loop in TypeScript.
-- If one operation is unsafe (for example, it belongs to a historical close
-- whose account is still hidden), raising here rolls back every reversal that
-- preceded it in this call. The user never receives a half-true "revertí 2/3".
create or replace function public.kipu_reverse_financial_operations(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_ids uuid[];
  v_id uuid;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if v_user is null
     or jsonb_typeof(p->'transaction_ids') <> 'array'
     or jsonb_array_length(p->'transaction_ids') < 1
     or jsonb_array_length(p->'transaction_ids') > 10 then
    raise exception 'KIPU_VALIDATION: user_id and 1..10 transaction_ids required'
      using errcode = '22023';
  end if;
  select array_agg(value::uuid order by ordinal)
    into v_ids
    from jsonb_array_elements_text(p->'transaction_ids') with ordinality as x(value, ordinal);
  if cardinality(v_ids) <> (
    select count(distinct item) from unnest(v_ids) as item
  ) then
    raise exception 'KIPU_VALIDATION: duplicate transaction_ids'
      using errcode = '22023';
  end if;
  foreach v_id in array v_ids loop
    v_result := public.kipu_reverse_financial_operation(jsonb_build_object(
      'user_id', v_user,
      'transaction_id', v_id,
      'raw_input', p->>'raw_input',
      'input_channel', coalesce(nullif(p->>'input_channel',''), 'chat'),
      'occurred_at', coalesce(nullif(p->>'occurred_at','')::timestamptz, now())
    ));
    if v_result->>'outcome' in (
      'closed_account_operation_requires_reopen',
      'account_close_correction_requires_undo',
      'installment_purchase_paid_requires_review'
    ) then
      raise exception 'KIPU_NEEDS_INFO: one operation needs domain review before undo'
        using errcode = '22023';
    end if;
    if v_result->>'outcome' not in (
      'reversed',
      'already_reversed',
      'reversed_account_close',
      'already_reversed_account_close',
      'reversed_installment_purchase',
      'already_reversed_installment_purchase'
    ) then
      raise exception 'KIPU_CONFLICT: unclassified reversal outcome %', v_result->>'outcome'
        using errcode = '22023';
    end if;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;
  return jsonb_build_object('outcome','applied','results',v_results);
end;
$$;

-- Universal correction tries the card boundary first, then preserves a
-- receivable linked to an outgoing loan. Ordinary movements return not_special
-- and keep using the existing generic correction RPC.
create or replace function public.kipu_correct_financial_operation(
  p_user_id uuid,
  p_original_transaction_id uuid,
  p_entry jsonb,
  p_statement jsonb,
  p_raw_input text default null,
  p_input_channel text default 'chat'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_card jsonb;
  v_receivable public.receivables%rowtype;
  v_new uuid;
  v_amount numeric := round(nullif(p_entry->>'original_amount','')::numeric, 2);
  v_currency text := upper(coalesce(nullif(p_entry->>'original_currency',''),''));
  v_already_paid numeric;
  v_new_outstanding numeric;
  v_close_id uuid;
  v_installment_plan_id uuid;
  v_original_source uuid;
  v_original_destination uuid;
begin
  select id into v_close_id
    from public.account_close_applications
   where user_id = p_user_id
     and transaction_id = p_original_transaction_id
     and reversed_at is null;
  if v_close_id is not null then
    return jsonb_build_object(
      'outcome','account_close_correction_requires_undo',
      'close_application_id',v_close_id
    );
  end if;
  select installment_plan_id into v_installment_plan_id
    from public.installment_plan_purchase_applications
   where user_id = p_user_id
     and transaction_id = p_original_transaction_id;
  if v_installment_plan_id is not null then
    return jsonb_build_object(
      'outcome','installment_correction_requires_cancel',
      'installment_plan_id',v_installment_plan_id
    );
  end if;
  select source_account_id, destination_account_id
    into v_original_source, v_original_destination
    from public.transactions
   where id = p_original_transaction_id and user_id = p_user_id;
  if exists (
    select 1
      from public.accounts
     where user_id = p_user_id
       and id in (v_original_source, v_original_destination)
       and status = 'closed'
  ) then
    return jsonb_build_object(
      'outcome','closed_account_operation_requires_reopen',
      'account_ids',jsonb_build_array(v_original_source, v_original_destination)
    );
  end if;
  v_card := public.kipu_correct_card_payment(
    p_user_id, p_original_transaction_id, p_entry, p_statement,
    p_raw_input, p_input_channel
  );
  if v_card->>'outcome' <> 'not_card_payment' then
    return v_card;
  end if;

  select * into v_receivable
    from public.receivables
   where user_id = p_user_id and origin_transaction_id = p_original_transaction_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_special');
  end if;
  if p_entry->>'type' <> 'expense' or v_amount is null or v_amount <= 0
     or v_currency !~ '^[A-Z]{3}$'
  then
    raise exception 'KIPU_VALIDATION: a loan-out correction must remain an expense with amount/currency'
      using errcode = '22023';
  end if;
  v_already_paid := greatest(
    round(v_receivable.original_amount - v_receivable.outstanding_amount, 2),
    0
  );
  if v_already_paid > 0.005 and upper(v_receivable.currency) <> v_currency then
    raise exception 'KIPU_VALIDATION: cannot change currency after repayments exist'
      using errcode = '22023';
  end if;
  v_new := public.kipu_correct_ledger_entry(jsonb_build_object(
    'user_id', p_user_id,
    'original_transaction_id', p_original_transaction_id,
    'corrected', p_entry,
    'raw_input', p_raw_input,
    'input_channel', p_input_channel
  ));
  v_new_outstanding := greatest(round(v_amount - v_already_paid, 2), 0);
  update public.receivables
     set original_amount = v_amount,
         outstanding_amount = v_new_outstanding,
         currency = v_currency,
         origin_transaction_id = v_new,
         status = case
           when v_new_outstanding <= 0.005 then 'settled'
           when v_already_paid > 0.005 then 'partial'
           else 'open'
         end
   where id = v_receivable.id;
  return jsonb_build_object(
    'outcome', 'corrected_receivable',
    'transaction_id', v_new,
    'receivable_id', v_receivable.id,
    'outstanding_amount', v_new_outstanding
  );
end;
$$;

-- Closing a plan is a domain operation. A cancellation must reverse the
-- financed purchase and stop the future monthly commitment together; a payoff
-- only marks the plan after the user has separately registered the actual card
-- payment. Both modes are replay-safe.
create or replace function public.kipu_close_installment_plan_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_plan uuid := nullif(p->>'installment_plan_id','')::uuid;
  v_mode text := p->>'mode';
  v_status text;
  v_purchase public.installment_plan_purchase_applications%rowtype;
  v_reverse jsonb;
begin
  if v_user is null or v_plan is null or v_mode not in ('cancelled','paid_off') then
    raise exception 'KIPU_VALIDATION: user/plan/mode required'
      using errcode = '22023';
  end if;
  select status::text into v_status
    from public.installment_plans
   where id = v_plan and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: installment plan not found/not owned'
      using errcode = '42501';
  end if;

  if v_mode = 'paid_off' then
    if v_status = 'paid_off' then
      return jsonb_build_object('outcome','already_paid_off','installment_plan_id',v_plan);
    end if;
    if v_status <> 'active' then
      raise exception 'KIPU_VALIDATION: a cancelled installment plan cannot be paid off'
        using errcode = '22023';
    end if;
    update public.installment_plans
       set status = 'paid_off',
           paid_off_at = coalesce(nullif(p->>'paid_off_at','')::date, current_date)
     where id = v_plan and user_id = v_user;
    return jsonb_build_object('outcome','paid_off','installment_plan_id',v_plan);
  end if;

  select * into v_purchase
    from public.installment_plan_purchase_applications
   where user_id = v_user and installment_plan_id = v_plan
   for update;
  if not found then
    return jsonb_build_object(
      'outcome','missing_purchase_requires_review',
      'installment_plan_id',v_plan
    );
  end if;
  if v_purchase.reversed_at is not null then
    update public.installment_plans
       set status = 'cancelled',
           paid_off_at = null
     where id = v_plan and user_id = v_user;
    return jsonb_build_object(
      'outcome','already_cancelled',
      'installment_plan_id',v_plan,
      'reversal_transaction_ids',jsonb_build_array(v_purchase.reversal_transaction_id)
    );
  end if;
  if v_status = 'paid_off' and v_purchase.reversed_at is null then
    return jsonb_build_object(
      'outcome','paid_purchase_requires_review',
      'installment_plan_id',v_plan
    );
  end if;
  v_reverse := public.kipu_reverse_financial_operation(jsonb_build_object(
    'user_id', v_user,
    'transaction_id', v_purchase.transaction_id,
    'raw_input', p->>'raw_input',
    'input_channel', coalesce(nullif(p->>'input_channel',''), 'chat'),
    'occurred_at', coalesce(nullif(p->>'occurred_at','')::timestamptz, now())
  ));
  if v_reverse->>'outcome' not in (
    'reversed_installment_purchase',
    'already_reversed_installment_purchase'
  ) then
    return jsonb_build_object(
      'outcome',v_reverse->>'outcome',
      'installment_plan_id',v_plan
    );
  end if;
  return jsonb_build_object(
    'outcome',
    case
      when v_reverse->>'outcome' = 'already_reversed_installment_purchase'
        then 'already_cancelled'
      else 'cancelled'
    end,
    'installment_plan_id',v_plan,
    'reversal_transaction_ids',v_reverse->'reversal_transaction_ids'
  );
end;
$$;

-- Metadata is financially relevant too (category/objective treatment), and an
-- installment purchase duplicates description/category in its plan. Keep both
-- representations aligned in one transaction instead of updating only the
-- ledger row.
create or replace function public.kipu_correct_transaction_metadata_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_tx uuid := nullif(p->>'transaction_id','')::uuid;
  v_patch jsonb := coalesce(p->'patch','{}'::jsonb);
  v_plan uuid;
  v_description text;
  v_category public.financial_category;
  v_treatment text;
begin
  if v_user is null or v_tx is null
     or jsonb_typeof(v_patch) is distinct from 'object'
     or v_patch = '{}'::jsonb
     or exists (
       select 1
         from jsonb_object_keys(v_patch) as k(key)
        where k.key not in ('description','category','budget_treatment')
     )
  then
    raise exception 'KIPU_VALIDATION: invalid transaction metadata correction'
      using errcode = '22023';
  end if;
  perform 1
    from public.transactions
   where id = v_tx and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: transaction not found/not owned'
      using errcode = '42501';
  end if;
  if v_patch ? 'description' then
    v_description := nullif(btrim(v_patch->>'description'),'');
    if v_description is null then
      raise exception 'KIPU_VALIDATION: description cannot be blank'
        using errcode = '22023';
    end if;
  end if;
  if v_patch ? 'category' then
    v_category := nullif(v_patch->>'category','')::public.financial_category;
  end if;
  if v_patch ? 'budget_treatment' then
    v_treatment := v_patch->>'budget_treatment';
    if v_treatment not in ('objective','saldo') then
      raise exception 'KIPU_VALIDATION: invalid budget treatment'
        using errcode = '22023';
    end if;
  end if;
  update public.transactions
     set description = case when v_patch ? 'description' then left(v_description,200) else description end,
         category = case when v_patch ? 'category' then v_category else category end,
         budget_treatment = case
           when v_patch ? 'budget_treatment' then v_treatment
           else budget_treatment
         end
   where id = v_tx and user_id = v_user;

  select installment_plan_id into v_plan
    from public.installment_plan_purchase_applications
   where user_id = v_user and transaction_id = v_tx;
  if v_plan is not null then
    perform 1
      from public.installment_plans
     where id = v_plan and user_id = v_user
     for update;
    if not found then
      raise exception 'KIPU_CONFLICT: installment plan vanished during metadata correction'
        using errcode = '22023';
    end if;
    update public.installment_plans
       set description = case when v_patch ? 'description' then left(v_description,200) else description end,
           category = case when v_patch ? 'category' then v_category else category end
     where id = v_plan and user_id = v_user;
  end if;
  return jsonb_build_object(
    'outcome','updated',
    'transaction_id',v_tx,
    'installment_plan_id',v_plan
  );
end;
$$;

-- A card/debt with money still attached cannot be hidden from debt pressure by
-- flipping status. Lock and validate every current obligation before closing;
-- replay is explicit rather than a zero-row UPDATE narrated as success.
create or replace function public.kipu_close_debt_account_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_debt uuid := nullif(p->>'debt_account_id','')::uuid;
  v_row public.debt_accounts%rowtype;
  v_statement_total numeric;
begin
  if v_user is null or v_debt is null then
    raise exception 'KIPU_VALIDATION: user/debt required'
      using errcode = '22023';
  end if;
  select * into v_row
    from public.debt_accounts
   where id = v_debt and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: debt account not found/not owned'
      using errcode = '42501';
  end if;
  v_statement_total := coalesce(
    nullif(to_jsonb(v_row)->>'statement_total_due','')::numeric,
    0
  );
  if abs(coalesce(v_row.current_balance_original,0)) > 0.005
     or abs(coalesce(v_row.current_balance_base,0)) > 0.005
     or abs(coalesce(v_row.full_payment_due,0)) > 0.005
     or abs(coalesce(v_row.minimum_payment,0)) > 0.005
     or abs(v_statement_total) > 0.005
  then
    return jsonb_build_object(
      'outcome',
      case when v_row.status = 'closed' then 'closed_with_debt_requires_review'
           else 'outstanding_debt_requires_payment' end,
      'debt_account_id',v_debt
    );
  end if;
  if v_row.status = 'closed' then
    return jsonb_build_object('outcome','already_closed','debt_account_id',v_debt);
  end if;
  update public.debt_accounts
     set status = 'closed'
   where id = v_debt and user_id = v_user;
  return jsonb_build_object('outcome','closed','debt_account_id',v_debt);
end;
$$;

-- Reconcile-to-zero + closed status are one transaction. The old tool performed
-- the adjustment first and ignored whether the later UPDATE closed any row.
create or replace function public.kipu_close_account_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_status text;
  v_reconcile jsonb;
  v_operation text := nullif(p->>'operation_id','');
  v_tx uuid;
  v_existing public.account_close_applications%rowtype;
begin
  if v_user is null or v_account is null or v_operation is null then
    raise exception 'KIPU_VALIDATION: user/account/operation required'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || '|' || v_operation, 0));
  select * into v_existing
    from public.account_close_applications
   where user_id = v_user and operation_id = v_operation
   for update;
  if found then
    if v_existing.account_id <> v_account or v_existing.reversed_at is not null then
      raise exception 'KIPU_DEDUPE_MISMATCH: close identity reused'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','already_closed',
      'already_matched',v_existing.transaction_id is null,
      'transaction_id',v_existing.transaction_id
    );
  end if;
  select status into v_status
    from public.accounts
   where id = v_account and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: account not found/not owned'
      using errcode = '42501';
  end if;
  if v_status = 'closed' then
    return jsonb_build_object('outcome', 'already_closed', 'already_matched', true);
  end if;
  v_reconcile := public.kipu_reconcile_account_balance(jsonb_build_object(
    'user_id', v_user,
    'account_id', v_account,
    'target_base', 0,
    'operation_id', v_operation,
    'raw_input', p->>'raw_input',
    'input_channel', coalesce(nullif(p->>'input_channel',''), 'chat')
  ));
  update public.accounts
     set status = 'closed'
   where id = v_account and user_id = v_user and status is distinct from 'closed';
  if not found then
    raise exception 'KIPU_CONFLICT: account was not closed'
      using errcode = '22023';
  end if;
  v_tx := nullif(v_reconcile->>'transaction_id','')::uuid;
  insert into public.account_close_applications (
    user_id, operation_id, account_id, previous_status, transaction_id
  ) values (
    v_user, v_operation, v_account, v_status, v_tx
  );
  return jsonb_build_object(
    'outcome', 'closed',
    'already_matched', coalesce((v_reconcile->>'already_matched')::boolean, false),
    'transaction_id', v_tx
  );
end;
$$;

-- Reopening is the domain inverse of closing. A zero-balance close has no
-- ledger row to select in undo_movement, so it still needs an explicit path.
-- For a close that did create an adjustment, delegate to the universal undo so
-- account status, adjustment and marker are restored together.
create or replace function public.kipu_reopen_account_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_status text;
  v_close public.account_close_applications%rowtype;
  v_reverse jsonb;
begin
  if v_user is null or v_account is null then
    raise exception 'KIPU_VALIDATION: user_id and account_id required'
      using errcode = '22023';
  end if;
  select status into v_status
    from public.accounts
   where id = v_account and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: account not found/not owned'
      using errcode = '42501';
  end if;
  select * into v_close
    from public.account_close_applications
   where user_id = v_user
     and account_id = v_account
     and reversed_at is null
   order by created_at desc, id desc
   limit 1
   for update;
  if not found then
    if v_status is distinct from 'closed' then
      return jsonb_build_object('outcome','already_open');
    end if;
    return jsonb_build_object('outcome','historical_close_requires_review');
  end if;
  if v_close.transaction_id is not null then
    v_reverse := public.kipu_reverse_financial_operation(jsonb_build_object(
      'user_id', v_user,
      'transaction_id', v_close.transaction_id,
      'raw_input', p->>'raw_input',
      'input_channel', coalesce(nullif(p->>'input_channel',''), 'chat'),
      'occurred_at', now()
    ));
    if v_reverse->>'outcome' not in (
      'reversed_account_close',
      'already_reversed_account_close'
    ) then
      raise exception 'KIPU_CONFLICT: account close undo returned %', v_reverse->>'outcome'
        using errcode = '22023';
    end if;
  else
    update public.accounts
       set status = v_close.previous_status
     where id = v_account and user_id = v_user;
    update public.account_close_applications
       set reversed_at = now()
     where id = v_close.id;
  end if;
  return jsonb_build_object(
    'outcome','reopened',
    'account_id',v_account,
    'reversal_transaction_ids',
      coalesce(v_reverse->'reversal_transaction_ids','[]'::jsonb)
  );
end;
$$;

alter function public.kipu_reverse_card_payment_operation(jsonb) owner to postgres;
alter function public.kipu_correct_card_payment(uuid, uuid, jsonb, jsonb, text, text) owner to postgres;
alter function public.kipu_apply_fixed_expense_with_payment(jsonb) owner to postgres;
alter function public.kipu_record_person_loan_out(jsonb, jsonb) owner to postgres;
alter function public.kipu_reverse_financial_operation(jsonb) owner to postgres;
alter function public.kipu_reverse_financial_operations(jsonb) owner to postgres;
alter function public.kipu_correct_financial_operation(uuid, uuid, jsonb, jsonb, text, text) owner to postgres;
alter function public.kipu_close_account_v2(jsonb) owner to postgres;
alter function public.kipu_reopen_account_v2(jsonb) owner to postgres;
alter function public.kipu_create_installment_plan_with_purchase(jsonb) owner to postgres;
alter function public.kipu_close_installment_plan_v2(jsonb) owner to postgres;
alter function public.kipu_correct_transaction_metadata_v2(jsonb) owner to postgres;
alter function public.kipu_close_debt_account_v2(jsonb) owner to postgres;
revoke all on function public.kipu_reverse_card_payment_operation(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_correct_card_payment(uuid, uuid, jsonb, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.kipu_record_person_loan_out(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_apply_fixed_expense_with_payment(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_reverse_financial_operation(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_reverse_financial_operations(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_correct_financial_operation(uuid, uuid, jsonb, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.kipu_close_account_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_reopen_account_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_create_installment_plan_with_purchase(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_close_installment_plan_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_correct_transaction_metadata_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_close_debt_account_v2(jsonb)
  from public, anon, authenticated;
-- Card-specific helpers are private implementation details. The server calls
-- the universal boundaries below; only postgres (the DEFINER owner) may compose
-- these helpers directly.
revoke all on function public.kipu_reverse_card_payment_operation(jsonb)
  from service_role;
revoke all on function public.kipu_correct_card_payment(uuid, uuid, jsonb, jsonb, text, text)
  from service_role;
grant execute on function public.kipu_record_person_loan_out(jsonb, jsonb)
  to service_role;
grant execute on function public.kipu_apply_fixed_expense_with_payment(jsonb)
  to service_role;
grant execute on function public.kipu_reverse_financial_operation(jsonb)
  to service_role;
grant execute on function public.kipu_reverse_financial_operations(jsonb)
  to service_role;
grant execute on function public.kipu_correct_financial_operation(uuid, uuid, jsonb, jsonb, text, text)
  to service_role;
grant execute on function public.kipu_close_account_v2(jsonb)
  to service_role;
grant execute on function public.kipu_reopen_account_v2(jsonb)
  to service_role;
grant execute on function public.kipu_create_installment_plan_with_purchase(jsonb)
  to service_role;
grant execute on function public.kipu_close_installment_plan_v2(jsonb)
  to service_role;
grant execute on function public.kipu_correct_transaction_metadata_v2(jsonb)
  to service_role;
grant execute on function public.kipu_close_debt_account_v2(jsonb)
  to service_role;

commit;
