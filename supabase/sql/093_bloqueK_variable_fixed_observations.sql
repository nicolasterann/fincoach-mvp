-- Bloque K — los fijos variables separan PLAN, OBSERVACIÓN y ESTIMACIÓN.
--
-- `fixed_expenses.amount` sigue siendo la cifra declarada por el usuario.
-- Cada factura real vive como observación nativa por ciclo; la proyección
-- prudente vive en una tabla separada. Ningún dato aprendido queda escribible
-- por `authenticated`.

begin;

-- A bill may be known before it is paid. `observed` is deliberately open:
-- the calendar can ask later whether cash actually moved.
alter table public.recurring_occurrences
  drop constraint if exists recurring_occurrences_status_check;
alter table public.recurring_occurrences
  add constraint recurring_occurrences_status_check
  check (status in ('pending', 'observed', 'booked', 'confirmed', 'corrected', 'skipped', 'dismissed'));

alter table public.recurring_occurrences
  drop constraint if exists recurring_occurrences_resolved_status_chk;
alter table public.recurring_occurrences
  add constraint recurring_occurrences_resolved_status_chk
  check (
    resolved_amount is null
    -- `dismissed` may preserve a known bill while the user explicitly stops
    -- payment reminders. `skipped` means the occurrence did not happen and
    -- therefore may not retain a resolved amount.
    or status in ('observed', 'confirmed', 'corrected', 'dismissed')
  );
alter table public.recurring_occurrences
  drop constraint if exists recurring_occurrences_observed_fact_chk;
alter table public.recurring_occurrences
  add constraint recurring_occurrences_observed_fact_chk
  check (
    status <> 'observed'
    or (
      kind = 'expense'
      and fixed_expense_id is not null
      and resolved_amount is not null
      and resolved_currency is not null
      and created_transaction_id is null
    )
  );

-- Upper/lower case is not a financial denomination change, so normalize the
-- pre-K rows before tightening the long-applied permissive `[A-Za-z]{3}`
-- constraint. Every K decoder and writer treats uppercase as canonical; letting
-- a raw lowercase fact in would poison the complete money read until a human
-- repaired the row.
update public.recurring_occurrences
set resolved_currency = upper(resolved_currency)
where resolved_currency is not null
  and resolved_currency is distinct from upper(resolved_currency);
alter table public.recurring_occurrences
  drop constraint if exists recurring_occurrences_resolved_currency_chk;
alter table public.recurring_occurrences
  add constraint recurring_occurrences_resolved_currency_chk
  check (
    resolved_currency is null
    or resolved_currency ~ '^[A-Z]{3}$'
  );

-- The original fixed-expense table never constrained its denomination.
-- Forecast rows do, so leaving the plan permissive would either make the
-- migration fail indirectly during backfill or let a later legacy writer
-- create a plan whose native regime no complete K reader can publish.
do $$
begin
  if exists (
    select 1
    from public.fixed_expenses
    where currency is null
       or btrim(currency) !~ '^[A-Za-z]{3}$'
  ) then
    raise exception
      'KIPU_MIGRATION: fixed expense has an invalid native currency';
  end if;
end;
$$;
update public.fixed_expenses
set currency = upper(btrim(currency))
where currency is distinct from upper(btrim(currency));
alter table public.fixed_expenses
  drop constraint if exists fixed_expenses_currency_iso_ck;
alter table public.fixed_expenses
  add constraint fixed_expenses_currency_iso_ck
  check (currency ~ '^[A-Z]{3}$');

-- A plan may change currency/cadence/regime after a cycle was created.  The
-- occurrence owns that cycle's identity; historical corrections must never be
-- re-labelled with the plan that happens to be current today.
alter table public.recurring_occurrences
  add column if not exists fixed_expense_regime int
    check (fixed_expense_regime is null or fixed_expense_regime > 0),
  add column if not exists fixed_expense_cadence text
    check (
      fixed_expense_cadence is null
      or fixed_expense_cadence in ('weekly','biweekly','monthly','yearly','custom')
    ),
  add column if not exists fixed_expense_retired_by_plan boolean
    not null default false;

-- The historical FK proves only that the plan id exists, not that the
-- occurrence and plan have the same owner. A service caller could otherwise
-- attach user A's calendar row to user B's fixed plan; the variable guard
-- would see “not my plan” as “not variable” and silently skip every K
-- invariant. Refuse a dirty pre-state, then make the INSERT lock trigger below
-- the durable ownership boundary for all fixed occurrences.
do $$
begin
  if exists (
    select 1
    from public.recurring_occurrences occurrence_row
    join public.fixed_expenses fixed_row
      on fixed_row.id = occurrence_row.fixed_expense_id
    where occurrence_row.fixed_expense_id is not null
      and occurrence_row.user_id is distinct from fixed_row.user_id
  ) then
    raise exception
      'KIPU_MIGRATION: recurring occurrence is linked to another user fixed expense';
  end if;
end;
$$;

-- `fixed_expenses.amount` had no sign constraint since migration 010. Most
-- callers happened to validate, but one stale/direct writer could persist -50;
-- monthly capacity subtracts fixed expenses, so subtracting -50 inflates Saldo.
-- Refuse a dirty pre-state instead of normalizing a financial fact.
do $$
begin
  if exists (
    select 1 from public.fixed_expenses where amount < 0
  ) then
    raise exception
      'KIPU_MIGRATION: fixed expense has a negative declared amount';
  end if;
end;
$$;
alter table public.fixed_expenses
  drop constraint if exists fixed_expenses_amount_nonnegative_ck;
alter table public.fixed_expenses
  add constraint fixed_expenses_amount_nonnegative_ck
  check (amount >= 0);

alter table public.recurring_occurrences
  drop constraint if exists recurring_occurrences_variable_plan_retirement_ck;
alter table public.recurring_occurrences
  add constraint recurring_occurrences_variable_plan_retirement_ck check (
    not fixed_expense_retired_by_plan
    or (
      fixed_expense_id is not null
      and status = 'dismissed'
      and resolved_amount is null
      and resolved_currency is null
      and created_transaction_id is null
    )
  );

create table if not exists public.fixed_expense_forecasts (
  fixed_expense_id uuid primary key references public.fixed_expenses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  regime int not null default 1 check (regime > 0),
  declared_amount numeric(14,2) not null check (declared_amount >= 0),
  planning_amount numeric(14,2) not null check (planning_amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  cadence text not null
    check (cadence in ('weekly','biweekly','monthly','yearly','custom')),
  sample_count int not null default 0 check (sample_count >= 0),
  confidence text not null default 'baseline'
    check (confidence in ('baseline','low','medium','high')),
  method text not null default 'declared'
    check (method in ('declared','conservative_p75')),
  last_cycle_date date,
  regime_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_expense_forecasts_state_ck check (
    (
      sample_count = 0
      and confidence = 'baseline'
      and method = 'declared'
      and planning_amount = declared_amount
      and last_cycle_date is null
    )
    or (
      sample_count between 1 and 2
      and confidence = 'low'
      and method = 'declared'
      and planning_amount = declared_amount
      and last_cycle_date is not null
    )
    or (
      sample_count between 3 and 5
      and confidence = 'medium'
      and method = 'conservative_p75'
      and last_cycle_date is not null
    )
    or (
      sample_count >= 6
      and confidence in ('medium','high')
      and method = 'conservative_p75'
      and last_cycle_date is not null
    )
  )
);

create index if not exists fixed_expense_forecasts_user_idx
  on public.fixed_expense_forecasts(user_id, fixed_expense_id);

alter table public.fixed_expense_forecasts enable row level security;
drop policy if exists "Users can view own fixed expense forecasts"
  on public.fixed_expense_forecasts;
create policy "Users can view own fixed expense forecasts"
  on public.fixed_expense_forecasts for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.fixed_expense_forecasts from public, anon, authenticated;
grant select on table public.fixed_expense_forecasts to authenticated;
-- The service client may READ the learned projection, but it cannot bypass the
-- canonical SECURITY DEFINER writers with a raw table mutation.
grant select on table public.fixed_expense_forecasts to service_role;

create table if not exists public.fixed_expense_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fixed_expense_id uuid not null references public.fixed_expenses(id) on delete cascade,
  occurrence_id uuid references public.recurring_occurrences(id) on delete set null,
  cycle_date date not null,
  regime int not null check (regime > 0),
  cadence text not null
    check (cadence in ('weekly','biweekly','monthly','yearly','custom')),
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  transaction_id uuid references public.transactions(id),
  source text not null check (source in ('calendar','ledger','backfill')),
  supersedes_id uuid references public.fixed_expense_observations(id),
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists fixed_expense_observations_current_cycle_uq
  on public.fixed_expense_observations(fixed_expense_id, regime, cycle_date)
  where is_current;
create unique index if not exists fixed_expense_observations_current_occurrence_uq
  on public.fixed_expense_observations(occurrence_id)
  where is_current and occurrence_id is not null;
create unique index if not exists fixed_expense_observations_transaction_uq
  on public.fixed_expense_observations(user_id, transaction_id)
  where transaction_id is not null;
create index if not exists fixed_expense_observations_estimator_idx
  on public.fixed_expense_observations(fixed_expense_id, regime, cycle_date desc)
  where is_current;

alter table public.fixed_expense_observations enable row level security;
drop policy if exists "Users can view own fixed expense observations"
  on public.fixed_expense_observations;
create policy "Users can view own fixed expense observations"
  on public.fixed_expense_observations for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.fixed_expense_observations from public, anon, authenticated;
grant select on table public.fixed_expense_observations to authenticated;
grant select on table public.fixed_expense_observations to service_role;

-- A service-role caller may still update ordinary occurrence lifecycle fields,
-- so constraints that cover only `status='observed'` are insufficient.  Keep
-- every variable-bill state internally coherent even if a future caller skips
-- the canonical RPC: a positive terminal bill proves its payment; a zero bill
-- proves there was none; dismissed preserves an unpaid fact; skipped erases it.
create or replace function public.kipu__guard_variable_fixed_occurrence_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_variable boolean := false;
  v_tx public.transactions%rowtype;
  v_current_observation public.fixed_expense_observations%rowtype;
begin
  if new.fixed_expense_id is null then return new; end if;
  select coalesce(f.is_variable, false)
    into v_is_variable
  from public.fixed_expenses f
  where f.id = new.fixed_expense_id and f.user_id = new.user_id;
  v_is_variable := coalesce(v_is_variable, false) or exists (
    select 1
    from public.fixed_expense_observations o
    where o.user_id = new.user_id
      and o.fixed_expense_id = new.fixed_expense_id
      and o.occurrence_id = new.id
  );
  if tg_op = 'UPDATE'
     and new.fixed_expense_retired_by_plan is distinct from
         old.fixed_expense_retired_by_plan
     and coalesce(
       current_setting('kipu.variable_fixed_plan_retirement', true),
       ''
     ) <> new.fixed_expense_id::text then
    raise exception
      'KIPU_VALIDATION: variable occurrence retirement belongs to the plan lifecycle'
      using errcode = '22023';
  end if;
  if not v_is_variable then return new; end if;

  -- Every variable cycle is born pending.  Facts and terminal states belong
  -- to the atomic writer, which creates the observation/payment identities
  -- before advancing the occurrence.  Without this INSERT rule a future
  -- service-role caller could manufacture a "paid" bill in one raw insert
  -- and bypass every UPDATE-only invariant below.
  if tg_op = 'INSERT' and new.status <> 'pending' then
    raise exception 'KIPU_VALIDATION: variable bill occurrence must start pending'
      using errcode = '22023';
  end if;

  if new.status = 'pending' then
    if new.resolved_amount is not null
       or new.resolved_currency is not null
       or new.created_transaction_id is not null then
      raise exception
        'KIPU_VALIDATION: pending variable bill cannot claim a fact or payment'
        using errcode = '22023';
    end if;
  elsif new.status = 'booked' then
    if new.resolved_amount is not null
       or new.resolved_currency is not null
       or new.created_transaction_id is null then
      raise exception
        'KIPU_VALIDATION: booked variable bill needs only its linked payment'
        using errcode = '22023';
    end if;
  elsif new.status = 'observed' then
    if new.resolved_amount is null
       or new.resolved_currency is null
       or new.created_transaction_id is not null then
      raise exception 'KIPU_VALIDATION: observed variable bill must be complete and unpaid'
        using errcode = '22023';
    end if;
  elsif new.status in ('confirmed','corrected') then
    if new.resolved_amount is null or new.resolved_currency is null then
      raise exception 'KIPU_VALIDATION: terminal variable bill needs its native fact'
        using errcode = '22023';
    end if;
    if (
      new.resolved_amount > 0 and new.created_transaction_id is null
    ) or (
      new.resolved_amount = 0 and new.created_transaction_id is not null
    ) then
      raise exception 'KIPU_VALIDATION: variable bill payment identity contradicts its amount'
        using errcode = '22023';
    end if;
  elsif new.status = 'dismissed' then
    if new.created_transaction_id is not null
       or (new.resolved_amount is null) <> (new.resolved_currency is null) then
      raise exception 'KIPU_VALIDATION: dismissed variable fact must remain native and unpaid'
        using errcode = '22023';
    end if;
  elsif new.status = 'skipped' then
    if new.resolved_amount is not null
       or new.resolved_currency is not null
       or new.created_transaction_id is not null then
      raise exception 'KIPU_VALIDATION: skipped variable cycle cannot retain a bill or payment'
        using errcode = '22023';
    end if;
  end if;

  -- The occurrence is the calendar projection of the durable CURRENT
  -- observation, not a second independently writable fact. Authenticated
  -- retains narrow lifecycle UPDATEs from Bloque C; without this comparison it
  -- could turn observed→pending/skipped, clear the amount and make a known
  -- invoice disappear while the estimator still retained it.
  select observation.*
    into v_current_observation
  from public.fixed_expense_observations observation
  where observation.user_id = new.user_id
    and observation.fixed_expense_id = new.fixed_expense_id
    and observation.occurrence_id = new.id
    and observation.is_current;
  if found then
    if new.status in ('pending','booked','skipped')
       or new.resolved_amount is distinct from v_current_observation.amount
       or upper(new.resolved_currency) is distinct from
            upper(v_current_observation.currency)
       or new.created_transaction_id is distinct from
            v_current_observation.transaction_id then
      raise exception
        'KIPU_VALIDATION: variable occurrence contradicts its current observation'
        using errcode = '22023';
    end if;
  elsif new.status = 'observed'
     or (
       new.status = 'dismissed'
       and new.resolved_amount is not null
     )
     or (
       new.status in ('confirmed','corrected')
       and not (
         tg_op = 'UPDATE'
         and old.status = new.status
         and old.fixed_expense_id is not distinct from new.fixed_expense_id
         and old.resolved_amount is not distinct from new.resolved_amount
         and old.resolved_currency is not distinct from new.resolved_currency
         and old.created_transaction_id is not distinct from
             new.created_transaction_id
       )
     ) then
    -- Pre-K terminal rows may legitimately predate the observation table. They
    -- remain readable and may receive unrelated notifier fields, but no caller
    -- can manufacture or materially rewrite such a terminal fact without the
    -- canonical writer first creating its observation.
    raise exception
      'KIPU_VALIDATION: variable occurrence fact has no current observation'
      using errcode = '22023';
  end if;

  if new.created_transaction_id is not null then
    select * into v_tx
    from public.transactions transaction_row
    where transaction_row.id = new.created_transaction_id
      and transaction_row.user_id = new.user_id;
    if not found
       or v_tx.type <> 'expense'
       or v_tx.recurring_expense_id is distinct from new.fixed_expense_id
       or exists (
         select 1
         from public.transactions reversal
         where reversal.user_id = new.user_id
           and reversal.type = 'reversal'
           and reversal.related_transaction_id = v_tx.id
       ) then
      raise exception
        'KIPU_VALIDATION: variable bill payment does not belong to this plan'
        using errcode = '22023';
    end if;
    if new.status in ('confirmed','corrected')
       and (
         v_tx.original_amount is distinct from new.resolved_amount
         or upper(v_tx.original_currency) is distinct from
              upper(new.resolved_currency)
       ) then
      raise exception
        'KIPU_VALIDATION: variable bill payment differs from its native fact'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.kipu__guard_variable_fixed_occurrence_state()
  from public, anon, authenticated, service_role;

drop trigger if exists recurring_occurrences_variable_fixed_state_guard
  on public.recurring_occurrences;
create trigger recurring_occurrences_variable_fixed_state_guard
before update of status, resolved_amount, resolved_currency,
  created_transaction_id, fixed_expense_id, fixed_expense_retired_by_plan
on public.recurring_occurrences
for each row execute function public.kipu__guard_variable_fixed_occurrence_state();

-- Trigger names are evaluated alphabetically for the same event.  The `00`
-- plan-lock trigger installed below first resolves the current plan/forecast;
-- this later trigger then rejects a caller-owned terminal lifecycle.
drop trigger if exists recurring_occurrences_variable_fixed_state_guard_insert
  on public.recurring_occurrences;
create trigger recurring_occurrences_variable_fixed_state_guard_insert
before insert on public.recurring_occurrences
for each row execute function public.kipu__guard_variable_fixed_occurrence_state();

-- Installing a trigger does not validate old rows. Run every pre-K occurrence
-- whose CURRENT plan is variable through the exact live guard now; a legacy
-- status that claims the wrong payment/monto/moneda aborts the migration
-- instead of becoming trusted input to the complete K reader.
update public.recurring_occurrences occurrence_row
set status = occurrence_row.status
from public.fixed_expenses fixed_row
where fixed_row.id = occurrence_row.fixed_expense_id
  and fixed_row.user_id = occurrence_row.user_id
  and fixed_row.is_variable;

create table if not exists public.fixed_expense_observation_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  payload_fingerprint text not null,
  observation_id uuid not null references public.fixed_expense_observations(id) on delete cascade,
  transaction_id uuid references public.transactions(id),
  occurrence_status text not null
    check (occurrence_status in ('observed','confirmed','corrected','skipped')),
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, dedupe_key)
);

alter table public.fixed_expense_observation_operations enable row level security;
drop policy if exists "Users can view own fixed expense observation operations"
  on public.fixed_expense_observation_operations;
create policy "Users can view own fixed expense observation operations"
  on public.fixed_expense_observation_operations for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.fixed_expense_observation_operations from public, anon, authenticated;
grant select on table public.fixed_expense_observation_operations to authenticated;
grant select on table public.fixed_expense_observation_operations to service_role;

-- Fixed expenses are retired with `is_active=false`; they are never erased.
-- A direct hard delete would cascade the forecast and every observation, making
-- the learned/auditable history disappear. Auth-account deletion still follows
-- the FK cascades because referential actions are executed by PostgreSQL, not
-- with the caller's table DELETE grant.
revoke delete on table public.fixed_expenses from authenticated, service_role;

-- Retrying a PARTIAL onboarding is the only sanctioned hard-delete of fixed
-- plans. Raw DELETE is revoked above because it would erase observations in
-- cascade. `onboarding_completed=false` cannot be caller-manufactured: once a
-- profile completes, no authenticated/service writer may move it backwards.
-- This is deliberately a state-machine invariant, not an RPC convention.
create or replace function public.kipu__guard_onboarding_completion_monotonic()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(old.onboarding_completed, false)
     and not coalesce(new.onboarding_completed, false) then
    raise exception
      'KIPU_VALIDATION: completed onboarding cannot be reopened'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.kipu__guard_onboarding_completion_monotonic()
  from public, anon, authenticated, service_role;

drop trigger if exists profiles_onboarding_completion_monotonic
  on public.profiles;
create trigger profiles_onboarding_completion_monotonic
before update of onboarding_completed on public.profiles
for each row execute function public.kipu__guard_onboarding_completion_monotonic();

-- Row locks protect the plans that already exist, but not a phantom INSERT.
-- Every new fixed definition first locks the same profile row the reset owns.
-- Therefore a concurrent create is serialized wholly before or after the wipe;
-- it can never appear between the reset's candidate scan and DELETE. Keep this
-- INSERT-only: UPDATE already owns the fixed row before its row trigger fires,
-- and adding profile-after-plan there would invert reset's profile→plan order.
create or replace function public.kipu__lock_fixed_expense_owner_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1
  from public.profiles profile_row
  where profile_row.id = new.user_id
  for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: fixed expense profile not found'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.kipu__lock_fixed_expense_owner_profile()
  from public, anon, authenticated, service_role;

drop trigger if exists fixed_expenses_00_owner_profile_lock
  on public.fixed_expenses;
create trigger fixed_expenses_00_owner_profile_lock
before insert on public.fixed_expenses
for each row execute function public.kipu__lock_fixed_expense_owner_profile();

-- This narrow reset writer proves ownership and a genuinely incomplete
-- profile under one row lock. It then locks every candidate plan in the same
-- deterministic order used by the ledger/calendar writers and refuses to
-- erase any monetary fact, observation, payment marker or non-empty lifecycle.
-- A bare pending occurrence contains no user fact and may be discarded with
-- the partial draft. A failed wipe aborts the retry before replacement rows
-- are inserted.
create or replace function public.kipu_reset_incomplete_onboarding_fixed_expenses(
  p_user uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_completed boolean;
  v_deleted integer;
begin
  if p_user is null
     or (
       auth.uid() is distinct from p_user
       and coalesce(auth.role(), '') <> 'service_role'
     ) then
    raise exception 'KIPU_OWNERSHIP: onboarding user mismatch'
      using errcode = '42501';
  end if;

  select onboarding_completed
  into v_completed
  from public.profiles
  where id = p_user
  for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: onboarding profile not found'
      using errcode = '42501';
  end if;
  if coalesce(v_completed, false) then
    raise exception
      'KIPU_VALIDATION: completed onboarding fixed expenses cannot be reset'
      using errcode = '22023';
  end if;

  perform 1
  from public.fixed_expenses fixed_row
  where fixed_row.user_id = p_user
  order by fixed_row.id
  for update;

  if exists (
    select 1
    from public.transactions transaction_row
    join public.fixed_expenses fixed_row
      on fixed_row.id = transaction_row.recurring_expense_id
     and fixed_row.user_id = transaction_row.user_id
    where fixed_row.user_id = p_user
  ) or exists (
    select 1
    from public.fixed_expense_observations observation_row
    where observation_row.user_id = p_user
  ) or exists (
    select 1
    from public.fixed_expense_payment_applications application_row
    where application_row.user_id = p_user
  ) or exists (
    select 1
    from public.recurring_occurrences occurrence_row
    where occurrence_row.user_id = p_user
      and occurrence_row.fixed_expense_id is not null
      and (
        occurrence_row.status <> 'pending'
        or occurrence_row.resolved_amount is not null
        or occurrence_row.resolved_currency is not null
        or occurrence_row.created_transaction_id is not null
      )
  ) then
    raise exception
      'KIPU_VALIDATION: onboarding fixed expenses with financial history cannot be reset'
      using errcode = '22023';
  end if;

  delete from public.fixed_expenses
  where user_id = p_user;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
alter function public.kipu_reset_incomplete_onboarding_fixed_expenses(uuid)
  owner to postgres;
revoke all on function public.kipu_reset_incomplete_onboarding_fixed_expenses(uuid)
  from public, anon;
grant execute on function public.kipu_reset_incomplete_onboarding_fixed_expenses(uuid)
  to authenticated, service_role;

-- Calendar identity: monthly/yearly plans use a bucket, weekly/biweekly/custom
-- keep the concrete due date. A payment on another day can still bind to the
-- same monthly bill.
create or replace function public.kipu__fixed_expense_cycle_date(
  p_fixed uuid,
  p_date date
) returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_frequency text;
begin
  select frequency into v_frequency
  from public.fixed_expenses
  where id = p_fixed;
  if not found then
    raise exception 'KIPU_VALIDATION: fixed expense not found' using errcode = '22023';
  end if;
  if v_frequency = 'monthly' then
    return date_trunc('month', p_date)::date;
  elsif v_frequency = 'yearly' then
    return date_trunc('year', p_date)::date;
  end if;
  return p_date;
end;
$$;
revoke all on function public.kipu__fixed_expense_cycle_date(uuid,date)
  from public, anon, authenticated, service_role;

-- Recalculate from the latest 24 CURRENT observations of the current regime.
-- It mirrors `estimateVariableFixedExpense`: fewer than three samples keep the
-- declared plan; afterwards use a robust p75. The lower fence may reject an
-- implausibly cheap reading because it could lower protection and inflate
-- Saldo. An expensive observed bill remains evidence but is winsorized at a
-- deliberately wide upper fence so one exceptional cycle cannot dominate.
create or replace function public.kipu__refresh_fixed_expense_forecast(
  p_user uuid,
  p_fixed uuid
) returns public.fixed_expense_forecasts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fixed public.fixed_expenses%rowtype;
  v_forecast public.fixed_expense_forecasts%rowtype;
  v_center numeric;
  v_mad numeric;
  v_fence numeric;
  v_upper_fence numeric;
  v_total int := 0;
  v_filtered int := 0;
  v_count int := 0;
  v_median numeric;
  v_p75 numeric;
  v_dispersion numeric;
  v_planning numeric;
  v_confidence text;
  v_method text;
  v_last date;
begin
  select * into v_fixed
  from public.fixed_expenses
  where id = p_fixed and user_id = p_user;
  if not found then
    raise exception 'KIPU_OWNERSHIP: fixed expense not owned' using errcode = '42501';
  end if;

  insert into public.fixed_expense_forecasts(
    fixed_expense_id, user_id, regime, declared_amount, planning_amount, currency, cadence,
    sample_count, confidence, method
  ) values (
    v_fixed.id, v_fixed.user_id, 1, v_fixed.amount, v_fixed.amount,
    upper(v_fixed.currency), v_fixed.frequency,
    0, 'baseline', 'declared'
  )
  on conflict (fixed_expense_id) do nothing;

  select * into v_forecast
  from public.fixed_expense_forecasts
  where fixed_expense_id = p_fixed and user_id = p_user
  for update;

  with recent as (
    select o.amount, o.cycle_date
    from public.fixed_expense_observations o
    where o.user_id = p_user
      and o.fixed_expense_id = p_fixed
      and o.regime = v_forecast.regime
      and o.is_current
      and upper(o.currency) = upper(v_forecast.currency)
      and o.cadence = v_fixed.frequency
    order by o.cycle_date desc, o.id desc
    limit 24
  )
  select count(*)::int,
         percentile_cont(0.5) within group (order by amount),
         max(cycle_date)
    into v_total, v_center, v_last
  from recent;

  if v_total > 0 then
    with recent as (
      select o.amount
      from public.fixed_expense_observations o
      where o.user_id = p_user
        and o.fixed_expense_id = p_fixed
        and o.regime = v_forecast.regime
        and o.is_current
        and upper(o.currency) = upper(v_forecast.currency)
        and o.cadence = v_fixed.frequency
      order by o.cycle_date desc, o.id desc
      limit 24
    )
    select percentile_cont(0.5) within group (order by abs(amount - v_center))
      into v_mad
    from recent;
  end if;

  -- Wide enough to retain normal seasonal utility swings. An unusually cheap
  -- reading may be excluded because it could inflate Saldo. An unusually high
  -- reading remains evidence but is winsorized at the upper fence: it raises
  -- protection without letting one exceptional invoice dominate for months.
  v_fence := greatest(0.01, coalesce(v_center,0) * 0.75, coalesce(v_mad,0) * 4);
  -- When the robust center and MAD are zero, their scale would winsorize the
  -- only positive invoice to 0.01 and could LOWER protection despite expensive
  -- evidence. The declared plan is the only honest fallback scale: one high
  -- cycle may lift p75, capped at 4x the baseline so a typo cannot dominate.
  v_upper_fence := case
    when coalesce(v_center,0) <= 0.01
      then greatest(0.01, v_fixed.amount * 4)
    else coalesce(v_center,0) + v_fence
  end;

  with recent as (
    select o.amount, o.cycle_date, o.id
    from public.fixed_expense_observations o
    where o.user_id = p_user
      and o.fixed_expense_id = p_fixed
      and o.regime = v_forecast.regime
      and o.is_current
      and upper(o.currency) = upper(v_forecast.currency)
      and o.cadence = v_fixed.frequency
    order by o.cycle_date desc, o.id desc
    limit 24
  ),
  filtered as (
    select least(amount, v_upper_fence) as amount, cycle_date, id
    from recent
    where amount >= coalesce(v_center, amount) - v_fence
  )
  select count(*)::int into v_filtered from filtered;

  with recent as (
    select o.amount, o.cycle_date, o.id
    from public.fixed_expense_observations o
    where o.user_id = p_user
      and o.fixed_expense_id = p_fixed
      and o.regime = v_forecast.regime
      and o.is_current
      and upper(o.currency) = upper(v_forecast.currency)
      and o.cadence = v_fixed.frequency
    order by o.cycle_date desc, o.id desc
    limit 24
  ),
  filtered as (
    select least(amount, v_upper_fence) as amount, cycle_date, id
    from recent
    where amount >= coalesce(v_center, amount) - v_fence
  ),
  chosen as (
    select * from filtered
    where v_filtered >= least(2, v_total)
    union all
    -- Mirror the pure TypeScript estimator even in the tiny-sample fallback:
    -- restoring excluded evidence must not restore its unbounded raw amount.
    select least(amount, v_upper_fence) as amount, cycle_date, id
    from recent
    where v_filtered < least(2, v_total)
  )
  select count(*)::int,
         percentile_cont(0.5) within group (order by amount),
         percentile_cont(0.75) within group (order by amount)
    into v_count, v_median, v_p75
  from chosen;

  if v_count > 0 and coalesce(v_median,0) > 0 then
    with recent as (
      select o.amount, o.cycle_date, o.id
      from public.fixed_expense_observations o
      where o.user_id = p_user
        and o.fixed_expense_id = p_fixed
        and o.regime = v_forecast.regime
        and o.is_current
        and upper(o.currency) = upper(v_forecast.currency)
        and o.cadence = v_fixed.frequency
      order by o.cycle_date desc, o.id desc
      limit 24
    ),
    filtered as (
      select least(amount, v_upper_fence) as amount, cycle_date, id
      from recent
      where amount >= coalesce(v_center, amount) - v_fence
    ),
    chosen as (
      select * from filtered
      where v_filtered >= least(2, v_total)
      union all
      select least(amount, v_upper_fence) as amount, cycle_date, id
      from recent
      where v_filtered < least(2, v_total)
    )
    select percentile_cont(0.5) within group (order by abs(amount - v_median))
           / v_median
      into v_dispersion
    from chosen;
  elsif v_count > 0 then
    v_dispersion := case when coalesce(v_p75,0) = 0 then 0 else 1 end;
  end if;

  if v_count < 3 then
    v_planning := round(v_fixed.amount, 2);
    v_confidence := case when v_count = 0 then 'baseline' else 'low' end;
    v_method := 'declared';
  else
    v_planning := round(greatest(
      0,
      coalesce(v_p75, v_fixed.amount),
      case when v_count < 6 then v_fixed.amount * 0.85 else 0 end
    ), 2);
    v_confidence := case
      when v_count >= 6 and coalesce(v_dispersion,1) <= 0.25 then 'high'
      else 'medium'
    end;
    v_method := 'conservative_p75';
  end if;

  update public.fixed_expense_forecasts
  set declared_amount = v_fixed.amount,
      planning_amount = v_planning,
      currency = upper(v_fixed.currency),
      cadence = v_fixed.frequency,
      sample_count = v_count,
      confidence = v_confidence,
      method = v_method,
      last_cycle_date = v_last,
      updated_at = now()
  where fixed_expense_id = p_fixed and user_id = p_user
  returning * into v_forecast;
  return v_forecast;
end;
$$;
revoke all on function public.kipu__refresh_fixed_expense_forecast(uuid,uuid)
  from public, anon, authenticated, service_role;

-- Any explicit plan/currency/cadence/variability change starts a fresh regime.
-- The old observations remain auditable but can never leak into the new plan.
create or replace function public.kipu__sync_fixed_expense_forecast()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_today date;
begin
  if new.is_active and new.is_variable and new.amount <= 0 then
    raise exception
      'KIPU_VALIDATION: an active variable fixed plan needs a positive declared amount'
      using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if new.is_variable then
      insert into public.fixed_expense_forecasts(
        fixed_expense_id, user_id, regime, declared_amount, planning_amount, currency, cadence,
        sample_count, confidence, method
      ) values (
        new.id, new.user_id, 1, new.amount, new.amount,
        upper(new.currency), new.frequency,
        0, 'baseline', 'declared'
      )
      on conflict (fixed_expense_id) do nothing;
    end if;
    return new;
  end if;

  if old.amount is distinct from new.amount
     or upper(old.currency) is distinct from upper(new.currency)
     or old.frequency is distinct from new.frequency
     or old.is_variable is distinct from new.is_variable then
    if new.is_variable then
      insert into public.fixed_expense_forecasts(
        fixed_expense_id, user_id, regime, declared_amount, planning_amount, currency, cadence,
        sample_count, confidence, method, last_cycle_date, updated_at
      ) values (
        new.id, new.user_id, 1, new.amount, new.amount,
        upper(new.currency), new.frequency,
        0, 'baseline', 'declared', null, now()
      )
      on conflict (fixed_expense_id) do update
        set regime = public.fixed_expense_forecasts.regime + 1,
            declared_amount = excluded.declared_amount,
            planning_amount = excluded.planning_amount,
            currency = excluded.currency,
            cadence = excluded.cadence,
            sample_count = 0,
            confidence = 'baseline',
            method = 'declared',
            last_cycle_date = null,
            regime_started_at = now(),
            updated_at = now();
    end if;

    -- A plan edit is "from now", so every still-UNKNOWN cycle must adopt the
    -- new native amount/currency/cadence before any nightly retry can move
    -- money.  Updating only variable→fixed left ordinary amount edits capable
    -- of auto-booking an old value.  Known `observed` bills are historical
    -- facts and deliberately remain untouched.
    update public.recurring_occurrences
    set mode = case when new.is_variable then 'ask' else 'auto' end,
        expected_amount = new.amount,
        currency = upper(new.currency),
        fixed_expense_regime = coalesce(
          (
            select forecast.regime
            from public.fixed_expense_forecasts forecast
            where forecast.fixed_expense_id = new.id
              and forecast.user_id = new.user_id
          ),
          fixed_expense_regime,
          1
        ),
        fixed_expense_cadence = new.frequency,
        notified = false,
        updated_at = now()
    where user_id = new.user_id
      and fixed_expense_id = new.id
      and status = 'pending';
  end if;
  if old.is_active and not new.is_active then
    -- Pause/delete controls future obligations. It may retire an ask for which
    -- no bill was ever reported, but it cannot erase a known unpaid invoice.
    perform set_config(
      'kipu.variable_fixed_plan_retirement',
      new.id::text,
      true
    );
    update public.recurring_occurrences
    set status = 'dismissed',
        fixed_expense_retired_by_plan = true,
        resolved_at = now(),
        updated_at = now()
    where user_id = new.user_id
      and fixed_expense_id = new.id
      and status = 'pending';
  end if;
  if not old.is_active and new.is_active then
    -- A pause-created dismissal is not a user's “stop asking forever”. If the
    -- same due cycle is still within the materializer's two-day recovery
    -- window (or in the future), reactivation must revive that exact identity;
    -- otherwise the unique cycle row makes the re-enabled plan silently miss
    -- its bill. Explicit dismissals have the marker false and stay closed.
    perform set_config(
      'kipu.variable_fixed_plan_retirement',
      new.id::text,
      true
    );
    select (
      now() at time zone coalesce(
        nullif(
          (
            select engagement.timezone
            from public.user_engagement engagement
            where engagement.user_id = new.user_id
          ),
          ''
        ),
        'America/Guayaquil'
      )
    )::date into v_user_today;
    update public.recurring_occurrences
    set status = 'pending',
        mode = case when new.is_variable then 'ask' else 'auto' end,
        expected_amount = coalesce(
          (
            select forecast.planning_amount
            from public.fixed_expense_forecasts forecast
            where forecast.fixed_expense_id = new.id
              and forecast.user_id = new.user_id
          ),
          new.amount
        ),
        currency = upper(new.currency),
        fixed_expense_regime = coalesce(
          (
            select forecast.regime
            from public.fixed_expense_forecasts forecast
            where forecast.fixed_expense_id = new.id
              and forecast.user_id = new.user_id
          ),
          fixed_expense_regime,
          1
        ),
        fixed_expense_cadence = new.frequency,
        fixed_expense_retired_by_plan = false,
        resolved_at = null,
        ask_count = 0,
        last_asked_on = null,
        snooze_until = null,
        notified = false,
        updated_at = now()
    where user_id = new.user_id
      and fixed_expense_id = new.id
      and status = 'dismissed'
      and fixed_expense_retired_by_plan
      and occurrence_date >= v_user_today - 2;
  end if;
  return new;
end;
$$;
revoke all on function public.kipu__sync_fixed_expense_forecast()
  from public, anon, authenticated, service_role;

drop trigger if exists fixed_expenses_forecast_sync on public.fixed_expenses;
create trigger fixed_expenses_forecast_sync
after insert or update of amount, currency, frequency, is_variable, is_active
on public.fixed_expenses
for each row execute function public.kipu__sync_fixed_expense_forecast();

-- A zero invoice is a valid observation; a zero ACTIVE plan is not a safe
-- planning fallback. It would reserve nothing until history exists and inflate
-- Saldo. Production was audited before this migration (all active variable
-- plans are positive), so abort rather than silently reinterpret a bad row.
do $$
begin
  if exists (
    select 1
    from public.fixed_expenses
    where is_active
      and is_variable
      and amount <= 0
  ) then
    raise exception
      'KIPU_MIGRATION: active variable fixed plan has no positive declared amount';
  end if;
end;
$$;

-- Backfill only a baseline forecast. No transaction row is guessed into an
-- observation: production currently has no proven variable-fixed history.
insert into public.fixed_expense_forecasts(
  fixed_expense_id, user_id, regime, declared_amount, planning_amount, currency, cadence,
  sample_count, confidence, method
)
select f.id, f.user_id, 1, f.amount, f.amount, upper(f.currency), f.frequency,
       0, 'baseline', 'declared'
from public.fixed_expenses f
where f.is_variable
on conflict (fixed_expense_id) do nothing;

-- Existing rows predate the snapshots. At migration time every variable plan
-- is still in its baseline regime, so this is a faithful, non-invented
-- attribution. Future inserts are stamped under the plan lock below.
update public.recurring_occurrences o
set fixed_expense_regime = f.regime,
    fixed_expense_cadence = x.frequency
from public.fixed_expense_forecasts f
join public.fixed_expenses x on x.id = f.fixed_expense_id
where o.fixed_expense_id = f.fixed_expense_id
  and (
    o.fixed_expense_regime is null
    or o.fixed_expense_cadence is null
  );

-- The old identity is unique only by exact date. A due-day edit racing two
-- early reports can derive two dates in the same monthly/yearly billing cycle;
-- both would then become independent invoices and could move money twice.
-- Cadence is snapshotted under the plan lock, so make cycle identity durable in
-- PostgreSQL instead of relying on the pre-insert read. Existing duplicates
-- deliberately abort this migration rather than being guessed away.
create unique index if not exists
  recurring_occurrences_fixed_monthly_cycle_uq
on public.recurring_occurrences (
  user_id,
  fixed_expense_id,
  (date_trunc('month', occurrence_date::timestamp)::date)
)
where fixed_expense_id is not null
  and fixed_expense_cadence = 'monthly';

create unique index if not exists
  recurring_occurrences_fixed_yearly_cycle_uq
on public.recurring_occurrences (
  user_id,
  fixed_expense_id,
  (date_trunc('year', occurrence_date::timestamp)::date)
)
where fixed_expense_id is not null
  and fixed_expense_cadence = 'yearly';

-- A pre-K unknown variable cycle must start from the same baseline projection
-- as every consumer. Observed/booked/terminal rows are historical facts and
-- are never relabelled by this backfill.
update public.recurring_occurrences o
set mode = 'ask',
    expected_amount = f.planning_amount,
    currency = f.currency,
    notified = false,
    updated_at = now()
from public.fixed_expense_forecasts f
join public.fixed_expenses x on x.id = f.fixed_expense_id
where o.fixed_expense_id = f.fixed_expense_id
  and o.user_id = f.user_id
  and x.is_variable
  and o.status = 'pending';

create or replace function public.kipu_record_variable_fixed_observation(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_occ_id uuid := nullif(p->>'occurrence_id','')::uuid;
  v_amount numeric := round((p->>'amount')::numeric, 2);
  v_currency text := upper(nullif(p->>'currency',''));
  v_action text := nullif(p->>'action','');
  v_scope text := coalesce(nullif(p->>'scope',''), 'once');
  v_dedupe text := nullif(p->>'dedupe_key','');
  v_expected_status text := nullif(p->>'expected_occurrence_status','');
  v_expected_amount numeric := nullif(p->>'expected_resolved_amount','')::numeric;
  v_expected_tx uuid := nullif(p->>'expected_transaction_id','')::uuid;
  v_entry jsonb := p->'entry';
  -- Fingerprint the semantic operation, not the optimistic read snapshot or
  -- derived FX valuation. After a committed response is lost, the next caller
  -- legitimately reloads a NEW occurrence status and may see a newer rate; it
  -- must still replay the already-landed native payment. Source/date/type stay
  -- in the fingerprint, so reusing the identity for a materially different
  -- payment is rejected.
  v_fingerprint text := md5(jsonb_strip_nulls(jsonb_build_object(
    'user_id', p->>'user_id',
    'occurrence_id', p->>'occurrence_id',
    'amount', v_amount,
    'currency', v_currency,
    'action', p->>'action',
    'scope', coalesce(nullif(p->>'scope',''), 'once'),
    'entry_type', p->'entry'->>'type',
    'entry_user_id', p->'entry'->>'user_id',
    'entry_original_amount',
      case when p->'entry'->>'original_amount' is null then null
           else round((p->'entry'->>'original_amount')::numeric, 2) end,
    'entry_original_currency', upper(p->'entry'->>'original_currency'),
    'entry_source_account_id', p->'entry'->>'source_account_id',
    'entry_debt_account_id', p->'entry'->>'debt_account_id',
    'entry_recurring_expense_id', p->'entry'->>'recurring_expense_id',
    'entry_occurred_at', p->'entry'->>'occurred_at'
  ))::text);
  v_occ public.recurring_occurrences%rowtype;
  v_fixed public.fixed_expenses%rowtype;
  v_forecast public.fixed_expense_forecasts%rowtype;
  v_existing_op public.fixed_expense_observation_operations%rowtype;
  v_current public.fixed_expense_observations%rowtype;
  v_old_tx public.transactions%rowtype;
  v_occ_tx public.transactions%rowtype;
  v_cycle date;
  v_observation uuid;
  v_tx uuid;
  v_reversal uuid;
  v_status text;
  v_same_payment boolean := false;
  v_observation_regime int;
  v_observation_cadence text;
  v_observation_currency text;
begin
  if v_user is null or v_occ_id is null then
    raise exception 'KIPU_VALIDATION: user_id and occurrence_id required' using errcode = '22023';
  end if;
  if v_amount is null or v_amount < 0 then
    raise exception 'KIPU_VALIDATION: amount must be >= 0' using errcode = '22023';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'KIPU_VALIDATION: valid currency required' using errcode = '22023';
  end if;
  if v_action not in ('observe','pay','retract','zero') or v_scope not in ('once','from_now') then
    raise exception 'KIPU_VALIDATION: invalid action/scope' using errcode = '22023';
  end if;
  if v_action = 'retract' and v_scope <> 'once' then
    raise exception 'KIPU_VALIDATION: retract cannot change the permanent plan'
      using errcode = '22023';
  end if;
  if v_scope = 'from_now' and v_amount <= 0 then
    raise exception 'KIPU_VALIDATION: permanent variable plan must be greater than zero'
      using errcode = '22023';
  end if;
  if v_action = 'pay' and v_amount <= 0 then
    raise exception 'KIPU_VALIDATION: payment must be greater than zero'
      using errcode = '22023';
  end if;
  if v_action = 'zero' and (v_amount <> 0 or v_scope <> 'once') then
    raise exception
      'KIPU_VALIDATION: zero correction requires amount zero and scope once'
      using errcode = '22023';
  end if;
  if v_dedupe is null then
    raise exception 'KIPU_VALIDATION: dedupe_key required' using errcode = '22023';
  end if;
  -- Serialize replay detection itself. A SELECT followed by an INSERT is not
  -- an idempotency protocol when two deliveries arrive concurrently.
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_dedupe, 0)
  );
  if v_action = 'pay' and (v_entry is null or jsonb_typeof(v_entry) <> 'object') then
    raise exception 'KIPU_VALIDATION: pay requires entry' using errcode = '22023';
  end if;
  if v_action in ('observe','retract','zero')
     and v_entry is not null and v_entry <> 'null'::jsonb then
    raise exception 'KIPU_VALIDATION: observe/retract must not move money' using errcode = '22023';
  end if;

  select * into v_existing_op
  from public.fixed_expense_observation_operations
  where user_id = v_user and dedupe_key = v_dedupe;
  if found then
    if v_existing_op.invalidated_at is not null then
      raise exception 'KIPU_CONFLICT: observation operation was superseded or reversed'
        using errcode = '22023';
    end if;
    if v_existing_op.payload_fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: observation identity reused' using errcode = '22023';
    end if;
    select * into v_forecast
    from public.fixed_expense_forecasts
    where fixed_expense_id = (
      select fixed_expense_id from public.fixed_expense_observations
      where id = v_existing_op.observation_id
    );
    return jsonb_build_object(
      'replayed', true,
      'observation_id', v_existing_op.observation_id,
      'transaction_id', v_existing_op.transaction_id,
      'occurrence_status', v_existing_op.occurrence_status,
      'planning_amount', v_forecast.planning_amount,
      'sample_count', v_forecast.sample_count,
      'confidence', v_forecast.confidence
    );
  end if;

  select o.* into v_occ
  from public.recurring_occurrences o
  where o.id = v_occ_id and o.user_id = v_user;
  if not found or v_occ.kind <> 'expense' or v_occ.fixed_expense_id is null then
    raise exception 'KIPU_VALIDATION: occurrence is not a fixed expense' using errcode = '22023';
  end if;

  select * into v_fixed
  from public.fixed_expenses
  where id = v_occ.fixed_expense_id and user_id = v_user
  for update;
  if not found or (
    not v_fixed.is_variable
    and not exists (
      select 1
      from public.fixed_expense_observations prior
      where prior.user_id = v_user
        and prior.fixed_expense_id = v_fixed.id
        and prior.occurrence_id = v_occ.id
        and prior.is_current
    )
  ) then
    raise exception 'KIPU_VALIDATION: fixed expense is not variable' using errcode = '22023';
  end if;
  if not v_fixed.is_variable and v_scope <> 'once' then
    -- A fact captured while the plan was variable survives later plan changes,
    -- but its historical resolver is not authority to mutate a plan that is
    -- fixed (or paused) today.
    raise exception
      'KIPU_VALIDATION: historical variable bill cannot change the current non-variable plan'
      using errcode = '22023';
  end if;
  -- All variable-fixed writers take the plan before the occurrence. The generic
  -- ledger trigger uses this same order; reversing it here would deadlock a
  -- chat resolution against a simultaneous legacy/log_movement capture.
  select o.* into v_occ
  from public.recurring_occurrences o
  where o.id = v_occ_id
    and o.user_id = v_user
    and o.fixed_expense_id = v_fixed.id
  for update;
  if not found then
    raise exception 'KIPU_CONFLICT: occurrence changed while resolving'
      using errcode = '22023';
  end if;
  if v_expected_status is null
     or v_occ.status is distinct from v_expected_status
     or (
       p ? 'expected_resolved_amount'
       and v_occ.resolved_amount is distinct from v_expected_amount
     )
     or (
       p ? 'expected_transaction_id'
       and v_occ.created_transaction_id is distinct from v_expected_tx
     ) then
    raise exception 'KIPU_CONFLICT: occurrence changed since it was read'
      using errcode = '22023';
  end if;
  if v_occ.status not in ('pending','observed','booked','confirmed','corrected','skipped','dismissed') then
    raise exception 'KIPU_VALIDATION: unsupported occurrence status'
      using errcode = '22023';
  end if;
  if v_scope = 'from_now'
     and upper(v_fixed.currency) is distinct from v_currency then
    raise exception
      'KIPU_VALIDATION: historical cycle currency % cannot rewrite current plan currency %',
      v_currency, upper(v_fixed.currency)
      using errcode = '22023';
  end if;
  if v_scope = 'from_now' and v_fixed.amount is distinct from v_amount then
    update public.fixed_expenses
    set amount = v_amount
    where id = v_fixed.id and user_id = v_user;
    select * into v_fixed
    from public.fixed_expenses
    where id = v_occ.fixed_expense_id and user_id = v_user;
  end if;

  insert into public.fixed_expense_forecasts(
    fixed_expense_id, user_id, regime, declared_amount, planning_amount, currency, cadence,
    sample_count, confidence, method
  ) values (
    v_fixed.id, v_user, 1, v_fixed.amount, v_fixed.amount,
    upper(v_fixed.currency), v_fixed.frequency,
    0, 'baseline', 'declared'
  )
  on conflict (fixed_expense_id) do nothing;
  select * into v_forecast
  from public.fixed_expense_forecasts
  where fixed_expense_id = v_fixed.id and user_id = v_user
  for update;

  v_observation_cadence := coalesce(
    v_occ.fixed_expense_cadence,
    v_fixed.frequency
  );
  v_cycle := case
    when v_observation_cadence = 'monthly'
      then date_trunc('month', v_occ.occurrence_date)::date
    when v_observation_cadence = 'yearly'
      then date_trunc('year', v_occ.occurrence_date)::date
    else v_occ.occurrence_date
  end;
  select * into v_current
  from public.fixed_expense_observations
  where occurrence_id = v_occ.id and is_current
  for update;

  v_observation_regime := case
    when v_scope = 'from_now' then v_forecast.regime
    else coalesce(
      v_current.regime,
      v_occ.fixed_expense_regime,
      v_forecast.regime
    )
  end;
  v_observation_cadence := coalesce(v_current.cadence, v_observation_cadence);
  v_observation_currency := upper(coalesce(
    v_current.currency,
    v_occ.currency,
    v_fixed.currency
  ));
  if v_observation_currency <> v_currency then
    raise exception 'KIPU_VALIDATION: observation currency % differs from cycle %',
      v_currency, v_observation_currency using errcode = '22023';
  end if;

  -- First K run over an occurrence auto-booked before this migration: adopt
  -- the already committed ledger fact instead of booking it a second time.
  if not found and v_occ.created_transaction_id is not null then
    select * into v_occ_tx
    from public.transactions
    where id = v_occ.created_transaction_id
      and user_id = v_user;
    if not found then
      raise exception 'KIPU_CONFLICT: occurrence points to a missing transaction'
        using errcode = '22023';
    end if;
    if exists (
      select 1 from public.transactions r
      where r.type = 'reversal'
        and r.related_transaction_id = v_occ_tx.id
    ) then
      raise exception 'KIPU_CONFLICT: occurrence still points to a reversed transaction'
        using errcode = '22023';
    end if;
    if v_occ_tx.type <> 'expense'
       or v_occ_tx.recurring_expense_id is distinct from v_fixed.id
       or upper(v_occ_tx.original_currency) is distinct from v_observation_currency then
      -- A pre-K occurrence that claims money moved is not permission to book a
      -- second payment when the claimed row cannot be adopted faithfully.
      raise exception 'KIPU_CONFLICT: occurrence transaction does not match the variable bill'
        using errcode = '22023';
    end if;
    insert into public.fixed_expense_observations(
      user_id, fixed_expense_id, occurrence_id, cycle_date, regime,
      cadence, amount, currency, transaction_id, source, is_current
    ) values (
      v_user, v_fixed.id, v_occ.id, v_cycle, v_observation_regime,
      v_observation_cadence, v_occ_tx.original_amount,
      upper(v_occ_tx.original_currency), v_occ_tx.id, 'backfill', true
    )
    returning * into v_current;
  end if;

  -- "Ese recibo no existió" is not the same as dismissing its payment reminder.
  -- Retract the current observation and, when a legacy/previous payment exists,
  -- reverse that cash movement IN THIS SAME transaction.  The old two-step
  -- skip path could commit the reversal, fail to clear the occurrence and then
  -- narrate a state that did not exist.
  if v_action = 'retract' then
    if v_current.id is null
       or v_current.occurrence_id is distinct from v_occ.id
       or v_current.amount is distinct from v_amount
       or upper(v_current.currency) is distinct from v_currency then
      raise exception 'KIPU_VALIDATION: only the current observation can be retracted'
        using errcode = '22023';
    end if;
    if v_current.transaction_id is not null then
      select * into v_old_tx
      from public.transactions
      where id = v_current.transaction_id and user_id = v_user;
      if not found then
        raise exception 'KIPU_CONFLICT: current observation payment disappeared'
          using errcode = '22023';
      end if;
      v_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
        'user_id', v_user,
        'type', 'reversal',
        'effect_type', 'reversal',
        'related_transaction_id', v_old_tx.id,
        'source_account_id', v_old_tx.source_account_id,
        'destination_account_id', v_old_tx.destination_account_id,
        'debt_account_id', v_old_tx.debt_account_id,
        'goal_id', v_old_tx.goal_id,
        'original_amount', v_old_tx.original_amount,
        'base_amount', v_old_tx.base_amount,
        'exchange_rate_to_base', v_old_tx.exchange_rate_to_base,
        'original_currency', v_old_tx.original_currency,
        'base_currency', v_old_tx.base_currency,
        'description', 'Retiro de factura variable inexistente',
        'category', v_old_tx.category,
        'input_channel', 'web',
        'external_ref', 'variable-fixed-internal-reversal:' || v_dedupe
      ));
    end if;
    update public.fixed_expense_observation_operations
    set invalidated_at = now()
    where observation_id = v_current.id
      and invalidated_at is null;
    update public.fixed_expense_observations
    set is_current = false
    where id = v_current.id;
    update public.recurring_occurrences
    set status = 'skipped',
        resolved_amount = null,
        resolved_currency = null,
        created_transaction_id = null,
        resolved_at = now(),
        updated_at = now()
    where id = v_occ.id and user_id = v_user;
    v_forecast := public.kipu__refresh_fixed_expense_forecast(v_user, v_fixed.id);
    insert into public.fixed_expense_observation_operations(
      user_id, dedupe_key, payload_fingerprint, observation_id,
      transaction_id, occurrence_status
    ) values (
      v_user, v_dedupe, v_fingerprint, v_current.id,
      null, 'skipped'
    );
    return jsonb_build_object(
      'replayed', false,
      'observation_id', v_current.id,
      'transaction_id', null,
      'occurrence_status', 'skipped',
      'planning_amount', v_forecast.planning_amount,
      'sample_count', v_forecast.sample_count,
      'confidence', v_forecast.confidence
    );
  end if;

  if found and v_current.transaction_id is not null then
    select * into v_old_tx
    from public.transactions
    where id = v_current.transaction_id and user_id = v_user;
    if v_action = 'pay' and found then
      v_same_payment :=
        v_old_tx.original_amount = v_amount
        and upper(v_old_tx.original_currency) = v_currency
        and coalesce(v_old_tx.source_account_id::text,'') = coalesce(v_entry->>'source_account_id','')
        and coalesce(v_old_tx.debt_account_id::text,'') = coalesce(v_entry->>'debt_account_id','')
        and v_old_tx.occurred_at =
              nullif(v_entry->>'occurred_at','')::timestamptz;
    end if;
  end if;

  if v_action = 'zero'
     and (
       v_current.id is null
       or v_current.transaction_id is null
     ) then
    raise exception
      'KIPU_VALIDATION: zero correction requires a paid current observation'
      using errcode = '22023';
  end if;
  if v_action = 'observe'
     and v_current.id is not null
     and v_current.transaction_id is not null then
    raise exception
      'KIPU_VALIDATION: a paid bill cannot be re-declared as unpaid'
      using errcode = '22023';
  end if;

  if v_current.id is not null
     and v_current.amount = v_amount
     and upper(v_current.currency) = v_currency
     and (
       (v_action = 'observe')
       or (v_action = 'pay' and v_same_payment)
     ) then
    -- A permanent change declared AFTER this same cycle was already captured
    -- opens a new regime in the fixed-expense trigger.  The current bill is
    -- precisely the first evidence for that regime; leaving it behind made the
    -- fresh forecast claim sample_count=0 until next month.
    if v_scope = 'from_now'
       and v_current.regime is distinct from v_forecast.regime then
      update public.fixed_expense_observations
      set regime = v_forecast.regime
      where id = v_current.id
      returning * into v_current;
    end if;
    v_observation := v_current.id;
    v_tx := v_current.transaction_id;
    v_status := case when v_tx is null then
      case when v_amount = 0 then 'confirmed' else 'observed' end
    else
      case when v_occ.status = 'corrected' then 'corrected' else 'confirmed' end
    end;
  else
    if v_action in ('pay','zero')
       and v_current.id is not null
       and v_current.transaction_id is not null then
      update public.fixed_expense_observation_operations
      set invalidated_at = now()
      where observation_id = v_current.id
        and invalidated_at is null;
      v_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
        'user_id', v_user,
        'type', 'reversal',
        'sign', -1,
        'related_transaction_id', v_current.transaction_id,
        'original_amount', 1,
        'base_amount', 1,
        'exchange_rate_to_base', 1,
        'original_currency', v_currency,
        'base_currency', coalesce(
          v_old_tx.base_currency,
          v_entry->>'base_currency',
          v_currency
        ),
        'description', 'Corrección de fijo variable',
        'category', 'other',
        'input_channel', 'web',
        'external_ref', 'variable-fixed-internal-reversal:' || v_dedupe
      ));
    end if;

    if v_action = 'pay' then
      if nullif(v_entry->>'user_id','')::uuid is distinct from v_user
         or nullif(v_entry->>'recurring_expense_id','')::uuid is distinct from v_fixed.id
         or round((v_entry->>'original_amount')::numeric,2) is distinct from v_amount
         or upper(v_entry->>'original_currency') is distinct from v_currency
         or v_entry->>'type' <> 'expense' then
        raise exception 'KIPU_VALIDATION: payment entry does not match observation'
          using errcode = '22023';
      end if;
      v_entry := v_entry || jsonb_build_object(
        'external_ref', 'variable-fixed-observation:' || v_dedupe
      );
      v_tx := public.kipu_apply_ledger_entry(v_entry);
      v_status := case
        when v_current.transaction_id is not null
          or (
            v_current.id is not null
            and v_current.amount is distinct from v_amount
          )
          or v_occ.created_transaction_id is not null
          or v_occ.status = 'skipped'
          then 'corrected'
        else 'confirmed'
      end;
    else
      v_tx := null;
      -- A real zero bill is learned evidence, but it has no payment to await.
      -- Leaving it `observed` creates an impossible loop: pay(0) is invalid.
      v_status := case
        when v_action = 'zero' then 'corrected'
        when v_amount = 0 and v_occ.status in ('skipped','dismissed')
          then 'corrected'
        when v_amount = 0 then 'confirmed'
        else 'observed'
      end;
    end if;

    if v_current.id is not null then
      update public.fixed_expense_observation_operations
      set invalidated_at = now()
      where observation_id = v_current.id
        and invalidated_at is null;
      update public.fixed_expense_observations
      set is_current = false
      where id = v_current.id;
    end if;

    insert into public.fixed_expense_observations(
      user_id, fixed_expense_id, occurrence_id, cycle_date, regime,
      cadence, amount, currency, transaction_id, source,
      supersedes_id, is_current
    ) values (
      v_user, v_fixed.id, v_occ.id, v_cycle, v_observation_regime,
      v_observation_cadence, v_amount, v_currency, v_tx, 'calendar',
      v_current.id, true
    )
    returning id into v_observation;
  end if;

  update public.recurring_occurrences
  set status = v_status,
      resolved_amount = v_amount,
      resolved_currency = v_currency,
      fixed_expense_regime = v_observation_regime,
      fixed_expense_cadence = v_observation_cadence,
      -- An observed-but-unpaid bill must never retain the id of an older,
      -- already-reversed payment. Every paid branch has v_tx; every genuinely
      -- unpaid branch has NULL.
      created_transaction_id = v_tx,
      resolved_at = case when v_status in ('confirmed','corrected') then now() else null end,
      -- Learning the bill answers the amount question and opens a DIFFERENT
      -- question (whether/where it was paid). Reusing the exhausted ask_count
      -- made a late answer at attempt 3 become standing forever.
      ask_count = case when v_status = 'observed' then 0 else ask_count end,
      last_asked_on = case when v_status = 'observed' then null else last_asked_on end,
      snooze_until = case when v_status = 'observed' then null else snooze_until end,
      notified = case when v_status = 'observed' then false else notified end,
      updated_at = now()
  where id = v_occ.id and user_id = v_user;

  v_forecast := public.kipu__refresh_fixed_expense_forecast(v_user, v_fixed.id);

  -- A cycle can have no CURRENT observation after retract. If the user later
  -- corrects/pays it, invalidating only `v_current` misses the retract
  -- operation (it points to the preserved non-current audit row). A late
  -- redelivery would then replay "skipped" over a now-paid bill. Every new
  -- durable fact supersedes all earlier operation identities for this cycle.
  update public.fixed_expense_observation_operations op
  set invalidated_at = now()
  where op.invalidated_at is null
    and op.observation_id in (
      select history.id
      from public.fixed_expense_observations history
      where history.user_id = v_user
        and history.occurrence_id = v_occ.id
    );

  insert into public.fixed_expense_observation_operations(
    user_id, dedupe_key, payload_fingerprint, observation_id,
    transaction_id, occurrence_status
  ) values (
    v_user, v_dedupe, v_fingerprint, v_observation, v_tx, v_status
  );

  return jsonb_build_object(
    'replayed', false,
    'observation_id', v_observation,
    'transaction_id', v_tx,
    'occurrence_status', v_status,
    'planning_amount', v_forecast.planning_amount,
    'sample_count', v_forecast.sample_count,
    'confidence', v_forecast.confidence
  );
end;
$$;

revoke all on function public.kipu_record_variable_fixed_observation(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_record_variable_fixed_observation(jsonb)
  to service_role;

-- Any OTHER safe ledger path (log_movement, legacy capture, corrections) that
-- carries recurring_expense_id must converge on the same observation. The
-- canonical calendar RPC tags its own ledger row and owns the transition, so
-- this trigger ignores that tag to avoid doing the same work twice.
--
-- Lock ordering needs a BEFORE half. The cash-currency guard also runs BEFORE
-- INSERT and locks accounts; waiting until this AFTER trigger to lock the fixed
-- plan would make generic capture account→fixed while the calendar RPC does
-- fixed→account, a real deadlock. PostgreSQL orders same-timing triggers by
-- name, so the `00` trigger below takes the plan before every account guard.
create or replace function public.kipu__lock_variable_fixed_plan()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fixed uuid;
  v_plan_found boolean := false;
begin
  if new.type = 'expense' and new.recurring_expense_id is not null then
    v_fixed := new.recurring_expense_id;
  elsif new.type = 'reversal' and new.related_transaction_id is not null then
    select recurring_expense_id into v_fixed
    from public.transactions
    where id = new.related_transaction_id
      and user_id = new.user_id;
  end if;
  if v_fixed is not null then
    select true
    into v_plan_found
    from public.fixed_expenses
    where id = v_fixed
      and user_id = new.user_id
    for no key update;
    -- Reversals derive their provenance from an already-durable row. Historic
    -- pre-K plans may no longer exist, so absence cannot block their repair.
    -- A NEW expense, however, must never outlive a reset/delete race: after it
    -- waits for the plan lock, missing means the link is not writable.
    if new.type = 'expense' and not coalesce(v_plan_found, false) then
      raise exception
        'KIPU_VALIDATION: recurring expense plan missing or not owned'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.kipu__lock_variable_fixed_plan()
  from public, anon, authenticated, service_role;

drop trigger if exists transactions_00_variable_fixed_plan_lock
  on public.transactions;
create trigger transactions_00_variable_fixed_plan_lock
before insert on public.transactions
for each row execute function public.kipu__lock_variable_fixed_plan();

-- The generic ledger fallback chooses an open occurrence only when the choice
-- is unique. Predicate reads alone cannot protect that decision: the nightly
-- materializer could insert another open cycle after COUNT and before SELECT.
-- Every fixed-expense occurrence creation therefore takes the same plan lock
-- first. Do NOT put this on UPDATE: PostgreSQL already owns the occurrence row
-- before a row-level UPDATE trigger runs, which would invert the canonical
-- plan → occurrence order and create the deadlock this guard is meant to stop.
create or replace function public.kipu__lock_variable_fixed_occurrence_plan()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fixed uuid := new.fixed_expense_id;
  v_cadence text;
  v_regime int;
  v_is_variable boolean;
  v_planning numeric;
  v_currency text;
begin
  if v_fixed is not null then
    select f.frequency, coalesce(p.regime, 1), f.is_variable,
           p.planning_amount, p.currency
      into v_cadence, v_regime, v_is_variable, v_planning, v_currency
    from public.fixed_expenses f
    left join public.fixed_expense_forecasts p
      on p.fixed_expense_id = f.id
    where f.id = v_fixed
      and f.user_id = new.user_id
    for no key update of f;
    if not found then
      raise exception
        'KIPU_OWNERSHIP: recurring occurrence fixed expense missing or not owned'
        using errcode = '42501';
    end if;
    -- New rows always belong to the locked CURRENT plan. Historical rows
    -- already existed before this migration and are backfilled separately;
    -- accepting caller-supplied snapshots here would let a new bill poison
    -- an arbitrary old regime.
    new.fixed_expense_cadence := v_cadence;
    new.fixed_expense_regime := v_regime;
    if v_is_variable then
      if v_planning is null or v_currency is null then
        raise exception
          'KIPU_CONFLICT: variable fixed plan has no durable forecast'
          using errcode = '22023';
      end if;
      -- The insert may have been planned before a concurrent permanent edit.
      -- Once the plan lock is ours, the durable forecast is authoritative.
      new.mode := 'ask';
      new.expected_amount := v_planning;
      new.currency := v_currency;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.kipu__lock_variable_fixed_occurrence_plan()
  from public, anon, authenticated, service_role;

drop trigger if exists recurring_occurrences_00_variable_fixed_plan_lock
  on public.recurring_occurrences;
create trigger recurring_occurrences_00_variable_fixed_plan_lock
before insert
on public.recurring_occurrences
for each row execute function public.kipu__lock_variable_fixed_occurrence_plan();

create or replace function public.kipu__sync_variable_fixed_from_ledger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fixed public.fixed_expenses%rowtype;
  v_forecast public.fixed_expense_forecasts%rowtype;
  v_current public.fixed_expense_observations%rowtype;
  v_occ public.recurring_occurrences%rowtype;
  v_original public.transactions%rowtype;
  v_timezone text;
  v_fact_date date;
  v_cycle date;
  v_due date;
  v_last_day int;
  v_candidate_count int := 0;
  v_back_days int := 0;
  v_forward_days int := 0;
  v_observation_regime int;
  v_observation_cadence text;
begin
  if new.type = 'reversal' then
    if coalesce(new.external_ref, '') like 'variable-fixed-internal-reversal:%' then
      return new;
    end if;
    select * into v_original
    from public.transactions
    where id = new.related_transaction_id and user_id = new.user_id;
    if not found or v_original.recurring_expense_id is null then
      return new;
    end if;
    select * into v_fixed
    from public.fixed_expenses
    where id = v_original.recurring_expense_id
      and user_id = new.user_id
    for no key update;
    if not found then return new; end if;

    -- Discover the occurrence first, then lock in the SAME global order as
    -- every canonical writer: plan → occurrence → observation. Locking the
    -- observation first and updating the occurrence afterwards deadlocked
    -- against chat resolution (plan → occurrence → observation).
    select * into v_current
    from public.fixed_expense_observations
    where user_id = new.user_id
      and fixed_expense_id = v_fixed.id
      and transaction_id = v_original.id
      and is_current;
    if not found then return new; end if;
    if v_current.occurrence_id is not null then
      select * into v_occ
      from public.recurring_occurrences
      where id = v_current.occurrence_id
        and user_id = new.user_id
      for update;
      if not found then
        raise exception
          'KIPU_CONFLICT: variable bill occurrence disappeared during reversal'
          using errcode = '22023';
      end if;
    end if;
    select * into v_current
    from public.fixed_expense_observations
    where id = v_current.id
      and user_id = new.user_id
      and fixed_expense_id = v_fixed.id
      and transaction_id = v_original.id
      and is_current
    for update;
    if not found then return new; end if;

    update public.fixed_expense_observation_operations
    set invalidated_at = now()
    where observation_id = v_current.id
      and invalidated_at is null;
    update public.fixed_expense_observations
    set is_current = false
    where id = v_current.id;
    -- Reversing CASH is not retracting the INVOICE. Preserve the native bill
    -- as the current unpaid observation; otherwise undoing a payment erased
    -- the estimator's evidence and forced the user to re-report an amount Kipu
    -- already knew. `retract` remains the only operation that removes the fact.
    insert into public.fixed_expense_observations(
      user_id, fixed_expense_id, occurrence_id, cycle_date, regime,
      cadence, amount, currency, transaction_id, source,
      supersedes_id, is_current
    ) values (
      v_current.user_id, v_current.fixed_expense_id,
      v_current.occurrence_id, v_current.cycle_date, v_current.regime,
      v_current.cadence, v_current.amount, v_current.currency, null,
      v_current.source, v_current.id, true
    );
    if v_current.occurrence_id is not null then
      update public.recurring_occurrences
      set status = 'observed',
          created_transaction_id = null,
          resolved_amount = v_current.amount,
          resolved_currency = v_current.currency,
          resolved_at = null,
          ask_count = 0,
          last_asked_on = null,
          snooze_until = null,
          notified = false,
          updated_at = now()
      where id = v_current.occurrence_id
        and user_id = new.user_id
        and created_transaction_id = v_original.id;
      if not found then
        raise exception
          'KIPU_CONFLICT: variable bill occurrence no longer points to the reversed payment'
          using errcode = '22023';
      end if;
    end if;
    perform public.kipu__refresh_fixed_expense_forecast(new.user_id, v_fixed.id);
    return new;
  end if;

  if new.type <> 'expense'
     or new.recurring_expense_id is null
     or coalesce(new.external_ref, '') like 'variable-fixed-observation:%' then
    return new;
  end if;

  select * into v_fixed
  from public.fixed_expenses
  where id = new.recurring_expense_id
    and user_id = new.user_id
  for no key update;
  if not found then return new; end if;
  if not v_fixed.is_variable then
    if exists (
      select 1
      from public.fixed_expense_observations historical
      join public.recurring_occurrences historical_occurrence
        on historical_occurrence.id = historical.occurrence_id
      where historical.user_id = new.user_id
        and historical.fixed_expense_id = v_fixed.id
        and historical.is_current
        and historical.transaction_id is null
        and historical_occurrence.status in ('observed','dismissed')
    ) then
      -- Once a known variable bill survives a later plan change, a generic
      -- `log_movement` cannot prove which historical cycle it is paying. The
      -- explicit occurrence writer owns that transition and preserves source,
      -- date and replay identity. Silently treating it as an ordinary fixed
      -- payment would leave the old bill open beside new cash movement.
      --
      -- `dismissed` means only “stop reminding me”; the invoice remains a
      -- native-money fact. The resolver can recover that historical occurrence
      -- by fixed plan + cycle even though it intentionally sits outside
      -- OPEN_STATUSES. Until the user resolves/retracts it, a generic linked
      -- payment cannot prove whether it is paying that fact or a new cycle.
      raise exception
        'KIPU_VALIDATION: historical variable bill must be resolved through its calendar occurrence'
        using errcode = '22023';
    end if;
    return new;
  end if;

  select timezone into v_timezone
  from public.user_engagement
  where user_id = new.user_id;
  v_timezone := coalesce(nullif(v_timezone,''), 'America/Guayaquil');
  if not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception 'KIPU_VALIDATION: invalid user timezone %', v_timezone using errcode = '22023';
  end if;
  v_fact_date := (new.occurred_at at time zone v_timezone)::date;
  -- A payment date is not necessarily the bill's cycle date. A July utility
  -- paid on 2 August must close July, not manufacture an August observation.
  -- The canonical calendar path carries occurrence_id; this generic fallback
  -- may infer only when exactly ONE open occurrence lies in the cadence window.
  if v_fixed.frequency = 'monthly' then
    v_back_days := 45;
    v_forward_days := 7;
  elsif v_fixed.frequency = 'yearly' then
    v_back_days := 60;
    v_forward_days := 14;
  elsif v_fixed.frequency = 'biweekly' then
    v_back_days := 10;
    v_forward_days := 4;
  elsif v_fixed.frequency = 'weekly' then
    v_back_days := 6;
    v_forward_days := 3;
  end if;

  if v_back_days > 0 then
    select count(*)::int into v_candidate_count
    from public.recurring_occurrences o
    where o.user_id = new.user_id
      and o.fixed_expense_id = v_fixed.id
      and o.status in ('pending','observed','booked')
      and o.occurrence_date between
        v_fact_date - v_back_days and v_fact_date + v_forward_days;
    if v_candidate_count > 1 then
      raise exception
        'KIPU_VALIDATION: multiple open cycles match this variable bill; resolve the calendar occurrence explicitly'
        using errcode = '22023';
    elsif v_candidate_count = 1 then
      select * into v_occ
      from public.recurring_occurrences o
      where o.user_id = new.user_id
        and o.fixed_expense_id = v_fixed.id
        and o.status in ('pending','observed','booked')
        and o.occurrence_date between
          v_fact_date - v_back_days and v_fact_date + v_forward_days
      order by o.occurrence_date, o.id
      limit 1
      for update;
    end if;
  end if;

  -- A generic ledger capture may close a cycle only when the calendar already
  -- proves which one it is. The single exception is the atomic create+pay
  -- writer below: that transaction creates a brand-new variable plan and tags
  -- its first payment durably. Without this proof, manufacturing "this month"
  -- from the payment date can bind a late bill to the wrong cycle.
  if v_occ.id is null
     and (
       coalesce(new.external_ref, '') not like
         'variable-fixed-create-payment:%'
       or current_setting(
            'kipu.variable_fixed_create_payment',
            true
          ) is distinct from
            v_fixed.id::text || ':' ||
            substring(
              new.external_ref
              from length('variable-fixed-create-payment:') + 1
            )
     ) then
    raise exception
      'KIPU_VALIDATION: no open variable-bill cycle; resolve the calendar occurrence explicitly'
      using errcode = '22023';
  end if;

  if upper(new.original_currency) <>
       upper(coalesce(v_occ.currency, v_fixed.currency)) then
    raise exception 'KIPU_VALIDATION: variable fixed payment currency % differs from cycle %',
      upper(new.original_currency),
      upper(coalesce(v_occ.currency, v_fixed.currency))
      using errcode = '22023';
  end if;

  insert into public.fixed_expense_forecasts(
    fixed_expense_id, user_id, regime, declared_amount, planning_amount, currency, cadence,
    sample_count, confidence, method
  ) values (
    v_fixed.id, new.user_id, 1, v_fixed.amount, v_fixed.amount,
    upper(v_fixed.currency), v_fixed.frequency,
    0, 'baseline', 'declared'
  )
  on conflict (fixed_expense_id) do nothing;
  select * into v_forecast
  from public.fixed_expense_forecasts
  where fixed_expense_id = v_fixed.id and user_id = new.user_id
  for update;

  v_observation_regime := coalesce(
    v_occ.fixed_expense_regime,
    v_forecast.regime
  );
  v_observation_cadence := coalesce(
    v_occ.fixed_expense_cadence,
    v_fixed.frequency
  );
  v_cycle := case
    when v_observation_cadence = 'monthly'
      then date_trunc(
        'month',
        coalesce(v_occ.occurrence_date, v_fact_date)
      )::date
    when v_observation_cadence = 'yearly'
      then date_trunc(
        'year',
        coalesce(v_occ.occurrence_date, v_fact_date)
      )::date
    else coalesce(v_occ.occurrence_date, v_fact_date)
  end;
  if v_fixed.frequency = 'monthly' then
    v_last_day := extract(day from (
      date_trunc('month', v_fact_date) + interval '1 month - 1 day'
    ))::int;
    v_due := make_date(
      extract(year from v_fact_date)::int,
      extract(month from v_fact_date)::int,
      least(
        coalesce(v_fixed.expected_day, extract(day from v_fact_date)::int),
        v_last_day
      )
    );
  else
    v_due := v_fact_date;
  end if;

  if v_occ.id is null then
    select * into v_occ
    from public.recurring_occurrences
    where user_id = new.user_id
      and fixed_expense_id = v_fixed.id
      and public.kipu__fixed_expense_cycle_date(v_fixed.id, occurrence_date) = v_cycle
    order by occurrence_date desc, id desc
    limit 1
    for update;
  end if;
  if v_occ.id is null then
    insert into public.recurring_occurrences(
      user_id, fixed_expense_id, occurrence_date, kind, mode,
      expected_amount, currency, status
    ) values (
      new.user_id, v_fixed.id, v_due, 'expense', 'ask',
      v_forecast.planning_amount, upper(v_forecast.currency), 'pending'
    )
    on conflict do nothing
    returning * into v_occ;
    if not found then
      select * into v_occ
      from public.recurring_occurrences
      where user_id = new.user_id
        and fixed_expense_id = v_fixed.id
        and public.kipu__fixed_expense_cycle_date(v_fixed.id, occurrence_date) = v_cycle
      order by occurrence_date desc, id desc
      limit 1
      for update;
      if not found then
        raise exception 'KIPU_CONFLICT: could not bind variable bill occurrence'
          using errcode = '22023';
      end if;
    end if;
  end if;

  select * into v_current
  from public.fixed_expense_observations
  where occurrence_id = v_occ.id and is_current
  for update;
  if v_occ.created_transaction_id is not null
     and v_occ.created_transaction_id <> new.id then
    -- A legacy/booked occurrence already proves that another ledger row moved
    -- money. The canonical resolver may ADOPT that row as the first K
    -- observation; an AFTER-trigger on a second generic transaction may not
    -- replace it, because the new insert would double-charge cash.
    raise exception
      'KIPU_VALIDATION: this variable bill already points to another payment; adopt or correct it through the calendar occurrence'
      using errcode = '22023';
  end if;
  if found and v_current.transaction_id is not null
     and v_current.transaction_id <> new.id then
    raise exception 'KIPU_VALIDATION: this variable bill already has a payment; correct or reverse it'
      using errcode = '22023';
  end if;
  if v_current.id is not null then
    update public.fixed_expense_observation_operations
    set invalidated_at = now()
    where observation_id = v_current.id
      and invalidated_at is null;
    update public.fixed_expense_observations
    set is_current = false
    where id = v_current.id;
  end if;

  insert into public.fixed_expense_observations(
    user_id, fixed_expense_id, occurrence_id, cycle_date, regime,
    cadence, amount, currency, transaction_id, source,
    supersedes_id, is_current
    ) values (
    new.user_id, v_fixed.id, v_occ.id, v_cycle, v_observation_regime,
    v_observation_cadence, new.original_amount, upper(new.original_currency),
    new.id, 'ledger', v_current.id, true
  );

  update public.recurring_occurrences
  set status = case
        when v_current.id is null
          or (
            v_current.transaction_id is null
            and v_current.amount = new.original_amount
            and upper(v_current.currency) = upper(new.original_currency)
          )
          then 'confirmed'
        else 'corrected'
      end,
      resolved_amount = new.original_amount,
      resolved_currency = upper(new.original_currency),
      created_transaction_id = new.id,
      resolved_at = now(),
      notified = true,
      updated_at = now()
  where id = v_occ.id and user_id = new.user_id;
  perform public.kipu__refresh_fixed_expense_forecast(new.user_id, v_fixed.id);
  return new;
end;
$$;
revoke all on function public.kipu__sync_variable_fixed_from_ledger()
  from public, anon, authenticated, service_role;

drop trigger if exists transactions_variable_fixed_observation_sync
  on public.transactions;
create trigger transactions_variable_fixed_observation_sync
after insert on public.transactions
for each row execute function public.kipu__sync_variable_fixed_from_ledger();

-- The J-8 atomic "create fixed + pay now" writer predates is_variable in its
-- INSERT column list. Extend the LIVE body additively: the row must already be
-- variable before kipu_apply_ledger_entry inserts the linked transaction, so
-- the trigger above can record the first observation in the same transaction.
do $$
declare
  v_def text;
  v_next text;
  v_old_columns text :=
    'payment_source_type, payment_source_id, is_essential, is_active';
  v_new_columns text :=
    'payment_source_type, payment_source_id, is_essential, is_active, is_variable';
  v_old_values text :=
    'coalesce((v_fixed->>''is_essential'')::boolean, false), true';
  v_new_values text :=
    'coalesce((v_fixed->>''is_essential'')::boolean, false), true, coalesce((v_fixed->>''is_variable'')::boolean, false)';
  v_old_call text :=
    'v_entry || jsonb_build_object(''recurring_expense_id'', v_fixed_id)';
  v_new_call text :=
    'v_entry || jsonb_build_object(
      ''recurring_expense_id'', v_fixed_id,
      ''external_ref'', case
        when coalesce((v_fixed->>''is_variable'')::boolean, false)
          then ''variable-fixed-create-payment:'' || v_dedupe
        else v_entry->>''external_ref''
      end
    )';
  v_old_write text :=
    'v_tx := public.kipu_apply_ledger_entry(';
  v_new_write text :=
    'perform set_config(
      ''kipu.variable_fixed_create_payment'',
      v_fixed_id::text || '':'' || v_dedupe,
      true
    );
  v_tx := public.kipu_apply_ledger_entry(';
  v_column_hits int;
  v_value_hits int;
  v_call_hits int;
  v_write_hits int;
begin
  select pg_get_functiondef(
    'public.kipu_apply_fixed_expense_with_payment(jsonb)'::regprocedure
  ) into v_def;
  if position(v_new_columns in v_def) > 0
     and position(v_new_values in v_def) > 0
     and position(v_new_call in v_def) > 0
     and position(v_new_write in v_def) > 0 then
    return;
  end if;
  if position(v_new_columns in v_def) > 0
     or position(v_new_values in v_def) > 0
     or position(v_new_call in v_def) > 0
     or position(v_new_write in v_def) > 0 then
    raise exception 'KIPU_MIGRATION: fixed+payment writer is partially patched';
  end if;
  v_column_hits :=
    (length(v_def) - length(replace(v_def, v_old_columns, '')))
    / length(v_old_columns);
  v_value_hits :=
    (length(v_def) - length(replace(v_def, v_old_values, '')))
    / length(v_old_values);
  v_call_hits :=
    (length(v_def) - length(replace(v_def, v_old_call, '')))
    / length(v_old_call);
  v_write_hits :=
    (length(v_def) - length(replace(v_def, v_old_write, '')))
    / length(v_old_write);
  if v_column_hits <> 1
     or v_value_hits <> 1
     or v_call_hits <> 1
     or v_write_hits <> 1 then
    raise exception
      'KIPU_MIGRATION: fixed+payment anchors changed (% columns, % values, % calls, % writes)',
      v_column_hits, v_value_hits, v_call_hits, v_write_hits;
  end if;
  v_next := replace(v_def, v_old_columns, v_new_columns);
  v_next := replace(v_next, v_old_values, v_new_values);
  v_next := replace(v_next, v_old_call, v_new_call);
  v_next := replace(v_next, v_old_write, v_new_write);
  if v_next = v_def
     or position(v_new_columns in v_next) = 0
     or position(v_new_values in v_next) = 0
     or position(v_new_call in v_next) = 0
     or position(v_new_write in v_next) = 0 then
    raise exception 'KIPU_MIGRATION: could not extend fixed+payment writer';
  end if;
  execute v_next;
end;
$$;

-- The agent decides whether an update is a stable-plan edit or a
-- variable-plan regime change from a complete catalog snapshot. That snapshot
-- must still be true after the atomic writer locks the row. Otherwise a
-- concurrent fixed→variable toggle could turn an ordinary "edit + pay" into a
-- silent variable-regime rewrite. The private `_expected_is_variable` field is
-- part of the fingerprint but is not persisted as a column.
do $$
declare
  v_def text;
  v_next text;
  v_guard_marker text :=
    'KIPU_VALIDATION: fixed expense variability changed since it was read';
  v_anchor text :=
    '    if not found then
      raise exception ''KIPU_OWNERSHIP: fixed expense not found/not owned''
        using errcode = ''42501'';
    end if;
    update public.fixed_expenses';
  v_replacement text :=
    '    if not found then
      raise exception ''KIPU_OWNERSHIP: fixed expense not found/not owned''
        using errcode = ''42501'';
    end if;
    if v_patch ? ''_expected_is_variable''
       and (v_patch->>''_expected_is_variable'')::boolean is distinct from (
         select is_variable
         from public.fixed_expenses
         where id = v_fixed_id and user_id = v_user
       ) then
      raise exception
        ''KIPU_VALIDATION: fixed expense variability changed since it was read''
        using errcode = ''22023'';
    end if;
    update public.fixed_expenses';
  v_hits int;
begin
  select pg_get_functiondef(
    'public.kipu_apply_fixed_expense_with_payment(jsonb)'::regprocedure
  ) into v_def;
  if position(v_guard_marker in v_def) > 0 then
    return;
  end if;
  v_hits :=
    (length(v_def) - length(replace(v_def, v_anchor, '')))
    / length(v_anchor);
  if v_hits <> 1 then
    raise exception
      'KIPU_MIGRATION: fixed+payment variability anchor changed (% hits)',
      v_hits;
  end if;
  v_next := replace(v_def, v_anchor, v_replacement);
  if v_next = v_def or position(v_guard_marker in v_next) = 0 then
    raise exception
      'KIPU_MIGRATION: could not install fixed+payment variability CAS';
  end if;
  execute v_next;
end;
$$;

alter function public.kipu__fixed_expense_cycle_date(uuid,date)
  owner to postgres;
alter function public.kipu__refresh_fixed_expense_forecast(uuid,uuid)
  owner to postgres;
alter function public.kipu__sync_fixed_expense_forecast()
  owner to postgres;
alter function public.kipu__guard_onboarding_completion_monotonic()
  owner to postgres;
alter function public.kipu__lock_fixed_expense_owner_profile()
  owner to postgres;
alter function public.kipu__guard_variable_fixed_occurrence_state()
  owner to postgres;
alter function public.kipu_record_variable_fixed_observation(jsonb)
  owner to postgres;
alter function public.kipu__lock_variable_fixed_plan()
  owner to postgres;
alter function public.kipu__lock_variable_fixed_occurrence_plan()
  owner to postgres;
alter function public.kipu__sync_variable_fixed_from_ledger()
  owner to postgres;

commit;
