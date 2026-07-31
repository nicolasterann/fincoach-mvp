-- Kipu — Pre-M backend integrity closure.
-- PREPARADA, NO APLICADA.
--
-- 1) Mis Datos can no longer rewrite money/status directly:
--    native balance reconciliation is a durable ledger operation and account
--    closure reuses it atomically; a tightly bounded base-only FX rounding
--    residue is swept with a durable reversible snapshot; debt close keeps the
--    existing debt guard.
-- 2) Authenticated/anon direct writes cannot bypass those typed writers.
-- 3) Recurring materialization and objective month-close gain durable cursors.
--
-- Apply before deploying the TypeScript that calls the new RPCs. Existing v2
-- writers remain intact during rollout except that the legacy authenticated
-- reconciliation grant is closed; its product caller already uses service_role.

-- ── Durable cron cursors ─────────────────────────────────────────────────────

create table if not exists public.recurring_materialization_cursors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_materialized_local_date date not null,
  timezone text not null,
  updated_at timestamptz not null default now()
);

alter table public.recurring_materialization_cursors enable row level security;
drop policy if exists "recurring_materialization_cursors_select_own"
  on public.recurring_materialization_cursors;
create policy "recurring_materialization_cursors_select_own"
  on public.recurring_materialization_cursors for select
  using (auth.uid() = user_id);
revoke all on table public.recurring_materialization_cursors
  from public, anon, authenticated, service_role;
grant select on table public.recurring_materialization_cursors
  to authenticated, service_role;

create or replace function public.kipu_advance_recurring_materialization_cursor(
  p_user_id uuid,
  p_through date,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.recurring_materialization_cursors%rowtype;
begin
  if p_user_id is null or p_through is null
     or nullif(btrim(p_timezone), '') is null
  then
    raise exception 'KIPU_VALIDATION: user, through date and timezone required'
      using errcode = '22023';
  end if;

  insert into public.recurring_materialization_cursors (
    user_id, last_materialized_local_date, timezone
  ) values (
    p_user_id, p_through, left(btrim(p_timezone), 100)
  )
  on conflict (user_id) do update
    set last_materialized_local_date = greatest(
          public.recurring_materialization_cursors.last_materialized_local_date,
          excluded.last_materialized_local_date
        ),
        timezone = excluded.timezone,
        updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'last_materialized_local_date', v_row.last_materialized_local_date,
    'timezone', v_row.timezone
  );
end;
$$;

create table if not exists public.objective_close_cursors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_evaluated_month date not null
    check (last_evaluated_month = date_trunc('month', last_evaluated_month)::date),
  updated_at timestamptz not null default now()
);

alter table public.objective_close_cursors enable row level security;
drop policy if exists "objective_close_cursors_select_own"
  on public.objective_close_cursors;
create policy "objective_close_cursors_select_own"
  on public.objective_close_cursors for select
  using (auth.uid() = user_id);
revoke all on table public.objective_close_cursors
  from public, anon, authenticated, service_role;
grant select on table public.objective_close_cursors
  to authenticated, service_role;

create or replace function public.kipu_advance_objective_close_cursor(
  p_user_id uuid,
  p_month text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date;
  v_row public.objective_close_cursors%rowtype;
begin
  if p_user_id is null or p_month is null
     or p_month !~ '^\d{4}-\d{2}$'
  then
    raise exception 'KIPU_VALIDATION: user and YYYY-MM month required'
      using errcode = '22023';
  end if;
  begin
    v_month := (p_month || '-01')::date;
  exception when others then
    raise exception 'KIPU_VALIDATION: invalid month'
      using errcode = '22023';
  end;
  if to_char(v_month, 'YYYY-MM') <> p_month then
    raise exception 'KIPU_VALIDATION: invalid month'
      using errcode = '22023';
  end if;

  insert into public.objective_close_cursors (user_id, last_evaluated_month)
  values (p_user_id, v_month)
  on conflict (user_id) do update
    set last_evaluated_month = greatest(
          public.objective_close_cursors.last_evaluated_month,
          excluded.last_evaluated_month
        ),
        updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'last_evaluated_month', to_char(v_row.last_evaluated_month, 'YYYY-MM')
  );
end;
$$;

-- ── Native, auditable balance reconciliation ────────────────────────────────

-- Bloque J's close marker did not need balance snapshots while every close was
-- represented by a reversible ledger row. A foreign account can also carry a
-- base-only rounding residue (native=0, base≠0), which has no valid ledger
-- representation because the canonical ledger requires original_amount > 0.
-- Preserve both pre-close legs so the typed reopen can restore that exact state.
alter table public.account_close_applications
  add column if not exists previous_balance_original numeric(18,2);
alter table public.account_close_applications
  add column if not exists previous_balance_base numeric(18,2);

create table if not exists public.account_balance_reconciliation_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  account_id uuid not null references public.accounts(id) on delete restrict,
  fingerprint text not null,
  target_original numeric(18,2) not null,
  exchange_rate_to_base numeric(24,10) not null
    check (exchange_rate_to_base > 0),
  base_currency text not null,
  delta_original numeric(18,2) not null,
  delta_base numeric(18,2) not null,
  new_balance_base numeric(18,2) not null,
  transaction_id uuid references public.transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (user_id, operation_id),
  unique (user_id, transaction_id)
);

alter table public.account_balance_reconciliation_applications enable row level security;
drop policy if exists "account_balance_reconciliation_applications_select_own"
  on public.account_balance_reconciliation_applications;
create policy "account_balance_reconciliation_applications_select_own"
  on public.account_balance_reconciliation_applications for select
  using (auth.uid() = user_id);
revoke all on table public.account_balance_reconciliation_applications
  from public, anon, authenticated, service_role;
grant select on table public.account_balance_reconciliation_applications
  to authenticated, service_role;

create or replace function public.kipu_reconcile_account_balance_native(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_operation text := nullif(btrim(p->>'operation_id'),'');
  v_target numeric;
  v_rate numeric;
  v_sweep_base_residue boolean := false;
  v_claimed_base text := upper(nullif(btrim(p->>'base_currency'),''));
  v_name text := nullif(btrim(p->>'name'),'');
  v_channel text := coalesce(nullif(p->>'input_channel',''), 'web');
  v_raw text := p->>'raw_input';
  v_profile_base text;
  v_account_currency text;
  v_account_name text;
  v_status text;
  v_live_original numeric;
  v_live_base numeric;
  v_delta_original numeric;
  v_delta_base numeric;
  v_new_base numeric;
  v_tx uuid;
  v_fingerprint text;
  v_existing public.account_balance_reconciliation_applications%rowtype;
begin
  if v_user is null or v_account is null or v_operation is null then
    raise exception 'KIPU_VALIDATION: user/account/operation required'
      using errcode = '22023';
  end if;
  if v_caller is not null and v_caller <> v_user then
    raise exception 'KIPU_OWNERSHIP: user does not match authenticated identity'
      using errcode = '42501';
  end if;
  if char_length(v_operation) > 200 then
    raise exception 'KIPU_VALIDATION: operation id too long'
      using errcode = '22023';
  end if;
  begin
    v_target := round((p->>'target_original')::numeric, 2);
    v_rate := (p->>'exchange_rate_to_base')::numeric;
    v_sweep_base_residue :=
      coalesce(nullif(p->>'sweep_base_residue','')::boolean, false);
  exception when others then
    raise exception 'KIPU_VALIDATION: numeric target/rate and boolean sweep required'
      using errcode = '22023';
  end;
  if v_target is null or v_rate is null or v_rate <= 0
     or v_claimed_base is null
  then
    raise exception 'KIPU_VALIDATION: valid target/rate/base required'
      using errcode = '22023';
  end if;
  if v_name is not null then v_name := left(v_name, 80); end if;

  v_fingerprint := md5(concat_ws('|',
    v_account::text,
    v_target::text,
    round(v_rate, 10)::text,
    v_claimed_base,
    coalesce(v_name, ''),
    v_sweep_base_residue::text
  ));
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || '|' || v_operation, 0)
  );
  select * into v_existing
    from public.account_balance_reconciliation_applications
   where user_id = v_user and operation_id = v_operation
   for update;
  if found then
    if v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: reconciliation identity reused'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed',
      'already_matched',
        abs(v_existing.delta_original) < 0.005
        and abs(v_existing.delta_base) < 0.005,
      'delta_original',v_existing.delta_original,
      'delta_base',v_existing.delta_base,
      'new_balance_original',v_existing.target_original,
      'new_balance_base',v_existing.new_balance_base,
      'transaction_id',v_existing.transaction_id
    );
  end if;

  select upper(base_currency) into v_profile_base
    from public.profiles
   where id = v_user
   for no key update;
  if not found or v_profile_base is null then
    raise exception 'KIPU_VALIDATION: profile/base currency missing'
      using errcode = '22023';
  end if;
  if v_claimed_base <> v_profile_base then
    raise exception 'KIPU_FX_REQUIRED: claimed base % does not match profile %',
      v_claimed_base, v_profile_base using errcode = '22023';
  end if;

  select upper(currency), name, status::text,
         coalesce(current_balance_original,0),
         coalesce(current_balance_base,0)
    into v_account_currency, v_account_name, v_status,
         v_live_original, v_live_base
    from public.accounts
   where id = v_account and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: account not found/not owned'
      using errcode = '42501';
  end if;
  if v_status = 'closed' then
    raise exception 'KIPU_VALIDATION: closed account cannot be reconciled'
      using errcode = '22023';
  end if;
  if v_account_currency = v_profile_base and abs(v_rate - 1) > 0.0000001 then
    raise exception 'KIPU_VALIDATION: base-currency account requires rate 1'
      using errcode = '22023';
  end if;

  if v_sweep_base_residue then
    -- This is deliberately narrow: it is not a general way to rewrite the
    -- base leg. It only absorbs at most one base-currency unit of rounding
    -- drift after the native balance is already zero. The durable application
    -- row is the audit fact; no fake 0.01-native ledger row is manufactured.
    if abs(v_target) >= 0.005
       or abs(v_live_original) >= 0.005
       or abs(v_live_base) > 1.00
    then
      raise exception 'KIPU_VALIDATION: base-only sweep is limited to a zero native balance and <= 1 base unit'
        using errcode = '22023';
    end if;
    v_delta_original := round(-v_live_original, 2);
    v_delta_base := round(-v_live_base, 2);
    v_new_base := 0;
    update public.accounts
       set current_balance_original = 0,
           current_balance_base = 0
     where id = v_account and user_id = v_user;
  else
    v_delta_original := round(v_target - v_live_original, 2);
    v_delta_base := round(v_delta_original * v_rate, 2);
    v_new_base := round(v_live_base + v_delta_base, 2);

    if abs(v_delta_original) >= 0.005 then
      if abs(v_delta_base) < 0.005 then
        raise exception 'KIPU_FX_REQUIRED: rate is too small to express a base leg'
          using errcode = '22023';
      end if;
      v_tx := public.kipu_apply_ledger_entry(jsonb_build_object(
        'user_id',v_user::text,
        'type','adjustment',
        'effect_type','adjustment',
        'sign',1,
        'description','Ajuste de saldo para cuadrar (' || coalesce(v_account_name,'cuenta') || ')',
        'category','other',
        'original_amount',abs(v_delta_original),
        'original_currency',v_account_currency,
        'exchange_rate_to_base',v_rate,
        'base_amount',abs(v_delta_base),
        'base_currency',v_profile_base,
        'source_account_id',case when v_delta_original < 0 then v_account::text else null end,
        'destination_account_id',case when v_delta_original > 0 then v_account::text else null end,
        'input_channel',v_channel,
        'raw_input',v_raw,
        'dedupe_key','native-reconcile:' || md5(v_user::text || '|' || v_operation)
      ));
    end if;
  end if;

  if v_name is not null then
    update public.accounts set name = v_name
     where id = v_account and user_id = v_user;
  end if;

  -- The ledger writer is authoritative. A malformed/no-op effect must abort the
  -- application marker rather than narrate a reconciliation that did not land.
  select coalesce(current_balance_original,0), coalesce(current_balance_base,0)
    into v_live_original, v_live_base
    from public.accounts
   where id = v_account and user_id = v_user;
  if abs(v_live_original - v_target) >= 0.005
     or abs(v_live_base - v_new_base) >= 0.005
  then
    raise exception 'KIPU_CONFLICT: reconciliation did not land atomically'
      using errcode = '22023';
  end if;

  insert into public.account_balance_reconciliation_applications (
    user_id, operation_id, account_id, fingerprint, target_original,
    exchange_rate_to_base, base_currency, delta_original, delta_base,
    new_balance_base, transaction_id
  ) values (
    v_user, v_operation, v_account, v_fingerprint, v_target,
    v_rate, v_profile_base, v_delta_original, v_delta_base,
    v_new_base, v_tx
  );

  return jsonb_build_object(
    'outcome','applied',
    'already_matched',
      abs(v_delta_original) < 0.005 and abs(v_delta_base) < 0.005,
    'delta_original',v_delta_original,
    'delta_base',v_delta_base,
    'new_balance_original',v_target,
    'new_balance_base',v_new_base,
    'transaction_id',v_tx
  );
end;
$$;

-- v3 closes native and base balances through one coherent adjustment. For a
-- foreign account it uses the row's effective stored ratio so both stored legs
-- become exactly zero; it never substitutes a fresh quote and leaves a ghost
-- base balance behind.
create or replace function public.kipu_close_account_v3(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_operation text := nullif(btrim(p->>'operation_id'),'');
  v_row public.accounts%rowtype;
  v_profile_base text;
  v_rate numeric;
  v_reconcile jsonb;
  v_tx uuid;
  v_previous_status text;
  v_previous_original numeric;
  v_previous_base numeric;
  v_existing public.account_close_applications%rowtype;
begin
  if v_user is null or v_account is null or v_operation is null then
    raise exception 'KIPU_VALIDATION: user/account/operation required'
      using errcode = '22023';
  end if;
  -- The nested native writer appends `:native-zero` and enforces a 200-char
  -- identity. Refuse at this boundary with the real contract instead of
  -- accepting an operation that can only fail halfway through the close.
  if char_length(v_operation) > 188 then
    raise exception 'KIPU_VALIDATION: close operation id too long'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || '|' || v_operation, 0)
  );
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
      'already_matched',
        coalesce(
          abs(v_existing.previous_balance_original) < 0.005,
          v_existing.transaction_id is null
        )
        and coalesce(
          abs(v_existing.previous_balance_base) < 0.005,
          v_existing.transaction_id is null
        ),
      'transaction_id',v_existing.transaction_id
    );
  end if;

  select * into v_row
    from public.accounts
   where id = v_account and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: account not found/not owned'
      using errcode = '42501';
  end if;
  if v_row.status::text = 'closed' then
    return jsonb_build_object('outcome','already_closed','already_matched',true);
  end if;
  v_previous_status := v_row.status::text;
  v_previous_original := coalesce(v_row.current_balance_original, 0);
  v_previous_base := coalesce(v_row.current_balance_base, 0);
  select upper(base_currency) into v_profile_base
    from public.profiles where id = v_user for no key update;
  if not found or v_profile_base is null then
    raise exception 'KIPU_VALIDATION: profile/base currency missing'
      using errcode = '22023';
  end if;

  if abs(coalesce(v_row.current_balance_original,0)) < 0.005
     and abs(coalesce(v_row.current_balance_base,0)) < 0.005
  then
    v_tx := null;
  elsif abs(coalesce(v_row.current_balance_original,0)) < 0.005
        and abs(coalesce(v_row.current_balance_base,0)) <= 1.00
  then
    -- A drained foreign account can retain a few cents in the base leg through
    -- historical FX rounding. Refusing it is a lock-out: editing native zero
    -- produces no ledger delta and can never clear the ghost base amount.
    -- Sweep only the tightly-bounded base residue through the durable native
    -- reconciliation marker; the pre-close snapshot below makes reopen exact.
    v_reconcile := public.kipu_reconcile_account_balance_native(jsonb_build_object(
      'user_id',v_user,
      'account_id',v_account,
      'target_original',0,
      'exchange_rate_to_base',1,
      'base_currency',v_profile_base,
      'sweep_base_residue',true,
      'operation_id',v_operation || ':base-zero',
      'raw_input',p->>'raw_input',
      'input_channel',coalesce(nullif(p->>'input_channel',''),'chat')
    ));
    v_tx := null;
  else
    if abs(coalesce(v_row.current_balance_original,0)) < 0.005
       or abs(coalesce(v_row.current_balance_base,0)) < 0.005
       or sign(v_row.current_balance_original) <> sign(v_row.current_balance_base)
    then
      raise exception 'KIPU_VALIDATION: incoherent account balances require review before close'
        using errcode = '22023';
    end if;
    v_rate := abs(v_row.current_balance_base / v_row.current_balance_original);
    v_reconcile := public.kipu_reconcile_account_balance_native(jsonb_build_object(
      'user_id',v_user,
      'account_id',v_account,
      'target_original',0,
      'exchange_rate_to_base',v_rate,
      'base_currency',v_profile_base,
      'operation_id',v_operation || ':native-zero',
      'raw_input',p->>'raw_input',
      'input_channel',coalesce(nullif(p->>'input_channel',''),'chat')
    ));
    v_tx := nullif(v_reconcile->>'transaction_id','')::uuid;
  end if;

  select * into v_row
    from public.accounts
   where id = v_account and user_id = v_user
   for update;
  if abs(coalesce(v_row.current_balance_original,0)) >= 0.005
     or abs(coalesce(v_row.current_balance_base,0)) >= 0.005
  then
    raise exception 'KIPU_CONFLICT: account balances were not zeroed'
      using errcode = '22023';
  end if;

  update public.accounts set status = 'closed'
   where id = v_account and user_id = v_user
     and status is distinct from 'closed';
  if not found then
    raise exception 'KIPU_CONFLICT: account was not closed'
      using errcode = '22023';
  end if;
  insert into public.account_close_applications (
    user_id, operation_id, account_id, previous_status, transaction_id,
    previous_balance_original, previous_balance_base
  ) values (
    v_user, v_operation, v_account, v_previous_status, v_tx,
    v_previous_original, v_previous_base
  );
  return jsonb_build_object(
    'outcome','closed',
    'already_matched',
      abs(v_previous_original) < 0.005 and abs(v_previous_base) < 0.005,
    'transaction_id',v_tx
  );
end;
$$;

-- v3 is the inverse of v3 close. A normal coherent close still delegates its
-- ledger reversal to the universal append-only undo. A base-only rounding
-- sweep has no fabricated ledger transaction, so its durable close snapshot is
-- restored directly together with status and marker in this typed transaction.
create or replace function public.kipu_reopen_account_v3(p jsonb)
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
  select status::text into v_status
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
       set status = v_close.previous_status,
           current_balance_original = coalesce(
             v_close.previous_balance_original,
             current_balance_original
           ),
           current_balance_base = coalesce(
             v_close.previous_balance_base,
             current_balance_base
           )
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

-- ── Lateral-door guards ─────────────────────────────────────────────────────
-- SECURITY DEFINER writers and the canonical SECURITY INVOKER ledger called
-- through service_role execute with trusted DB authority. Browser table writes
-- execute as authenticated. This distinction blocks raw UI updates without a
-- transaction-local bypass that a future writer could forget to set. The three
-- live web actions that invoke the ledger authenticate with the session first,
-- derive user_id from it, then call the ledger through service_role.

create or replace function public.kipu__guard_direct_account_financial_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated','anon')
     and (
       new.current_balance_original is distinct from old.current_balance_original
       or new.current_balance_base is distinct from old.current_balance_base
       or new.status is distinct from old.status
     )
  then
    raise exception 'KIPU_VALIDATION: account money/status requires a typed writer'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_direct_financial_update_guard on public.accounts;
create trigger accounts_direct_financial_update_guard
before update of current_balance_original, current_balance_base, status
on public.accounts
for each row execute function public.kipu__guard_direct_account_financial_update();

create or replace function public.kipu__guard_direct_debt_status_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated','anon')
     and new.status is distinct from old.status
  then
    raise exception 'KIPU_VALIDATION: debt status requires a typed writer'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists debt_accounts_direct_status_update_guard
  on public.debt_accounts;
create trigger debt_accounts_direct_status_update_guard
before update of status on public.debt_accounts
for each row execute function public.kipu__guard_direct_debt_status_update();

-- ── Ownership / ACL ─────────────────────────────────────────────────────────

alter function public.kipu_advance_recurring_materialization_cursor(uuid,date,text)
  owner to postgres;
alter function public.kipu_advance_objective_close_cursor(uuid,text)
  owner to postgres;
alter function public.kipu_reconcile_account_balance_native(jsonb)
  owner to postgres;
alter function public.kipu_close_account_v3(jsonb)
  owner to postgres;
alter function public.kipu_reopen_account_v3(jsonb)
  owner to postgres;
alter function public.kipu__guard_direct_account_financial_update()
  owner to postgres;
alter function public.kipu__guard_direct_debt_status_update()
  owner to postgres;

revoke all on function public.kipu_advance_recurring_materialization_cursor(uuid,date,text)
  from public, anon, authenticated;
revoke all on function public.kipu_advance_objective_close_cursor(uuid,text)
  from public, anon, authenticated;
revoke all on function public.kipu_reconcile_account_balance_native(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_close_account_v3(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_reopen_account_v3(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu__guard_direct_account_financial_update()
  from public, anon, authenticated, service_role;
revoke all on function public.kipu__guard_direct_debt_status_update()
  from public, anon, authenticated, service_role;
-- Migration 020 exposed the base-only legacy reconciliation directly to an
-- authenticated client. Product callers have long used the service-role
-- executor; keeping the old grant would be a stale typed-but-weaker side door.
revoke execute on function public.kipu_reconcile_account_balance(jsonb)
  from public, anon, authenticated;

grant execute on function public.kipu_advance_recurring_materialization_cursor(uuid,date,text)
  to service_role;
grant execute on function public.kipu_advance_objective_close_cursor(uuid,text)
  to service_role;
grant execute on function public.kipu_reconcile_account_balance_native(jsonb)
  to service_role;
grant execute on function public.kipu_close_account_v3(jsonb)
  to service_role;
grant execute on function public.kipu_reopen_account_v3(jsonb)
  to service_role;
grant execute on function public.kipu_reconcile_account_balance(jsonb)
  to service_role;
