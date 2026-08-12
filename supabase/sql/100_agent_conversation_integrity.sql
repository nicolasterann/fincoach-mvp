-- Migration 100 — Bloque M0, foundation: durable agent operations and
-- data-driven fact ↔ occurrence satisfaction.
-- PREPARED, NOT APPLIED. Claude/the founder applies after external audit.
--
-- This file deliberately REPLACES the un-applied case-specific draft. It does
-- not classify borrowed funds and it does not add a card_statement-only repair.
-- The two primitives are general:
--   1) a delivered user instruction has a durable, CAS-versioned lifecycle;
--   2) every calendar occurrence declares kind + entity + cycle, and any
--      durable fact with that identity satisfies it regardless of which writer
--      produced the fact.

-- NOTE: this file carries no begin;/commit;. It is applied through the
-- Supabase MCP `apply_migration`, which already wraps the body in a single
-- transaction; an inner commit would close that transaction early and leave
-- the schema_migrations row outside it. Same convention as 096-099.

-- ── 1. Durable conversational operations ──────────────────────────────────

create table if not exists public.agent_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_key text not null,
  channel text not null check (channel in ('telegram','web')),
  chat_id text,
  root_message_id uuid references public.chat_messages(id) on delete set null,
  superseded_by uuid references public.agent_operations(id) on delete set null,
  request_text text not null,
  latest_request_text text not null,
  request_fingerprint text not null,
  status text not null default 'planning' check (status in (
    'planning','awaiting_input','ready','applying','verifying','completed',
    'refused','failed_retriable','superseded','abandoned','expired'
  )),
  state_version integer not null default 1 check (state_version > 0),
  plan_version integer,
  plan jsonb,
  context_coverage jsonb not null default '{}'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb,
  pending_question text,
  result jsonb,
  last_error jsonb,
  validated_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, operation_key),
  constraint agent_operations_missing_fields_array_ck
    check (jsonb_typeof(missing_fields) = 'array'),
  constraint agent_operations_context_object_ck
    check (jsonb_typeof(context_coverage) = 'object'),
  constraint agent_operations_plan_object_ck
    check (plan is null or jsonb_typeof(plan) = 'object'),
  constraint agent_operations_result_object_ck
    check (result is null or jsonb_typeof(result) = 'object'),
  constraint agent_operations_error_object_ck
    check (last_error is null or jsonb_typeof(last_error) = 'object'),
  constraint agent_operations_waiting_question_ck
    check (status <> 'awaiting_input' or nullif(btrim(pending_question),'') is not null),
  constraint agent_operations_terminal_time_ck
    check (
      (status = 'completed' and completed_at is not null)
      or (status <> 'completed' and completed_at is null)
    )
);

create index if not exists agent_operations_user_open_idx
  on public.agent_operations(user_id, updated_at desc, id)
  where status in ('planning','awaiting_input','ready','applying','verifying','failed_retriable');

-- A financial job may span several chat deliveries. Keeping deliveries in a
-- separate table prevents the old failure mode where each answer became a new
-- unrelated job, while preserving exact replay identity for Telegram/web.
create table if not exists public.agent_operation_deliveries (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.agent_operations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivery_key text not null,
  message_id uuid references public.chat_messages(id) on delete set null,
  channel text not null check (channel in ('telegram','web')),
  chat_id text,
  request_text text not null,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (user_id, delivery_key)
);
create index if not exists agent_operation_deliveries_operation_idx
  on public.agent_operation_deliveries(operation_id, created_at, id);

-- Context/planner reads happen before an operation can be selected safely: the
-- model may still need to decide whether this turn continues, supersedes or is
-- independent from older work. A failure in that intake window must still be
-- durable and retryable without inventing a shell operation that would steal
-- continuation identity from the real job. This row is the pre-operation half
-- of the delivery lifecycle; it is resolved only after a validated plan has
-- been persisted on an agent_operation.
create table if not exists public.agent_intake_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delivery_key text not null,
  message_id uuid references public.chat_messages(id) on delete set null,
  channel text not null check (channel in ('telegram','web')),
  chat_id text,
  request_text text not null,
  request_fingerprint text not null,
  stage text not null,
  attempts integer not null default 1 check (attempts > 0),
  status text not null default 'open' check (status in ('open','resolved')),
  last_error jsonb not null,
  resolved_operation_id uuid references public.agent_operations(id) on delete cascade,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, delivery_key),
  constraint agent_intake_failures_error_object_ck
    check (jsonb_typeof(last_error) = 'object'),
  constraint agent_intake_failures_resolution_pair_ck check (
    (status = 'open' and resolved_operation_id is null and resolved_at is null)
    or
    (status = 'resolved' and resolved_operation_id is not null and resolved_at is not null)
  )
);

create table if not exists public.agent_operation_steps (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.agent_operations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_version integer not null check (plan_version > 0),
  step_order integer not null check (step_order > 0),
  step_key text not null,
  step_type text not null,
  capability text,
  atomic_group text,
  depends_on text[] not null default '{}',
  status text not null default 'pending' check (status in (
    'pending','preflighted','applying','applied','verified','needs_input',
    'refused','failed'
  )),
  arguments jsonb not null default '{}'::jsonb,
  arguments_fingerprint text not null,
  state_witness jsonb not null default '{}'::jsonb,
  effects jsonb not null default '[]'::jsonb,
  postconditions jsonb not null default '[]'::jsonb,
  resolved_type text,
  resolved_payload jsonb,
  resolved_fingerprint text,
  result jsonb,
  affected_refs jsonb not null default '[]'::jsonb,
  error jsonb,
  preflighted_at timestamptz,
  applied_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operation_id, plan_version, step_key),
  unique (operation_id, plan_version, step_order),
  constraint agent_operation_steps_args_object_ck
    check (jsonb_typeof(arguments) = 'object'),
  constraint agent_operation_steps_witness_object_ck
    check (jsonb_typeof(state_witness) = 'object'),
  constraint agent_operation_steps_effects_array_ck
    check (jsonb_typeof(effects) = 'array'),
  constraint agent_operation_steps_postconditions_array_ck
    check (jsonb_typeof(postconditions) = 'array'),
  constraint agent_operation_steps_resolved_payload_ck
    check (resolved_payload is null or jsonb_typeof(resolved_payload) = 'object'),
  constraint agent_operation_steps_resolved_pair_ck
    check (
      (resolved_type is null and resolved_payload is null and resolved_fingerprint is null)
      or
      (nullif(btrim(resolved_type),'') is not null and resolved_payload is not null
       and nullif(btrim(resolved_fingerprint),'') is not null)
    ),
  constraint agent_operation_steps_refs_array_ck
    check (jsonb_typeof(affected_refs) = 'array'),
  constraint agent_operation_steps_result_object_ck
    check (result is null or jsonb_typeof(result) = 'object'),
  constraint agent_operation_steps_error_object_ck
    check (error is null or jsonb_typeof(error) = 'object')
);

create index if not exists agent_operation_steps_operation_idx
  on public.agent_operation_steps(operation_id, plan_version, created_at, id);

-- The liability half of borrowed cash is not represented by the adjustment
-- ledger row. This marker makes that second leg auditable and gives universal
-- undo enough information to reverse cash + liability together.
create table if not exists public.debt_proceeds_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null references public.agent_operations(id) on delete cascade,
  step_key text not null,
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  debt_account_id uuid not null references public.debt_accounts(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  base_amount numeric(14,2) not null check (base_amount > 0),
  original_currency text not null,
  base_currency text not null,
  exchange_rate_to_base numeric not null check (exchange_rate_to_base > 0),
  dedupe_key text not null,
  payload_fingerprint text not null,
  reversal_transaction_id uuid unique references public.transactions(id) on delete restrict,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (operation_id, step_key),
  unique (user_id, dedupe_key),
  constraint debt_proceeds_reversal_pair_ck check (
    (reversal_transaction_id is null) = (reversed_at is null)
  )
);

-- A repayment ledger row proves only cash-in. The receivable reductions are a
-- second financial half, so replay and universal undo need the exact allocation
-- set that landed with that transaction. Without this marker, undoing an agent
-- operation would restore cash while leaving what the counterparty owed reduced.
create table if not exists public.receivable_repayment_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  dedupe_key text not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null,
  allocations jsonb not null,
  payload_fingerprint text not null,
  reversal_transaction_id uuid unique references public.transactions(id) on delete restrict,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key),
  constraint receivable_repayment_allocations_array_ck check (
    jsonb_typeof(allocations) = 'array' and jsonb_array_length(allocations) > 0
  ),
  constraint receivable_repayment_reversal_pair_ck check (
    (reversal_transaction_id is null) = (reversed_at is null)
  )
);

-- Operation-level undo links the corrective instruction to the complete
-- durable operation it reverses. It never guesses a group from time proximity.
create table if not exists public.agent_operation_reversals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_operation_id uuid not null unique
    references public.agent_operations(id) on delete cascade,
  reversal_operation_id uuid not null unique
    references public.agent_operations(id) on delete cascade,
  reversal_step_key text not null,
  transaction_ids uuid[] not null,
  result jsonb not null,
  payload_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint agent_operation_reversals_transactions_ck check (
    -- One planner request is capped at 24 actions and the largest forward
    -- writer (`log_movements_batch`) is capped at 15 ledger rows.  Keeping the
    -- product of those two proven bounds makes every operation the runtime can
    -- accept reversible as one atomic unit; the former limit of 10 made a
    -- perfectly valid 15-row batch impossible to correct as an operation.
    cardinality(transaction_ids) between 1 and 360
  ),
  constraint agent_operation_reversals_result_object_ck check (
    jsonb_typeof(result) = 'object'
  )
);

alter table public.agent_operations enable row level security;
alter table public.agent_operation_deliveries enable row level security;
alter table public.agent_intake_failures enable row level security;
alter table public.agent_operation_steps enable row level security;
alter table public.debt_proceeds_applications enable row level security;
alter table public.receivable_repayment_applications enable row level security;
alter table public.agent_operation_reversals enable row level security;
alter table public.agent_operations owner to postgres;
alter table public.agent_operation_deliveries owner to postgres;
alter table public.agent_intake_failures owner to postgres;
alter table public.agent_operation_steps owner to postgres;
alter table public.debt_proceeds_applications owner to postgres;
alter table public.receivable_repayment_applications owner to postgres;
alter table public.agent_operation_reversals owner to postgres;

drop policy if exists "Users can view own agent operations" on public.agent_operations;
create policy "Users can view own agent operations"
  on public.agent_operations for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can view own agent operation deliveries"
  on public.agent_operation_deliveries;
create policy "Users can view own agent operation deliveries"
  on public.agent_operation_deliveries for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can view own agent intake failures"
  on public.agent_intake_failures;
create policy "Users can view own agent intake failures"
  on public.agent_intake_failures for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can view own agent operation steps" on public.agent_operation_steps;
create policy "Users can view own agent operation steps"
  on public.agent_operation_steps for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can view own debt proceeds applications"
  on public.debt_proceeds_applications;
create policy "Users can view own debt proceeds applications"
  on public.debt_proceeds_applications for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can view own receivable repayment applications"
  on public.receivable_repayment_applications;
create policy "Users can view own receivable repayment applications"
  on public.receivable_repayment_applications for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can view own agent operation reversals"
  on public.agent_operation_reversals;
create policy "Users can view own agent operation reversals"
  on public.agent_operation_reversals for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.agent_operations, public.agent_operation_deliveries,
  public.agent_intake_failures, public.agent_operation_steps, public.debt_proceeds_applications,
  public.receivable_repayment_applications,
  public.agent_operation_reversals
  from public, anon, authenticated, service_role;
grant select on table public.agent_operations, public.agent_operation_deliveries,
  public.agent_intake_failures, public.agent_operation_steps, public.debt_proceeds_applications,
  public.receivable_repayment_applications,
  public.agent_operation_reversals
  to authenticated, service_role;

drop trigger if exists set_agent_operations_updated_at on public.agent_operations;
create trigger set_agent_operations_updated_at
before update on public.agent_operations
for each row execute function public.set_updated_at();
drop trigger if exists set_agent_operation_steps_updated_at on public.agent_operation_steps;
create trigger set_agent_operation_steps_updated_at
before update on public.agent_operation_steps
for each row execute function public.set_updated_at();
drop trigger if exists set_agent_intake_failures_updated_at on public.agent_intake_failures;
create trigger set_agent_intake_failures_updated_at
before update on public.agent_intake_failures
for each row execute function public.set_updated_at();

-- J-1's base-currency witness is intentionally row-based. K's learned
-- plan/observation history, Pre-M's reconciliation history and M0's facts and
-- applications all carry amounts or currencies. Leaving any of them outside
-- the explicit contract would reopen a silent reinterpretation path merely
-- because the value lives in a newer model. Cursor/lifecycle tables are not
-- monetary facts and deliberately stay outside this list.
create or replace function public.kipu__base_financial_tables()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array[
    'accounts','debt_accounts','transactions','goals','fixed_expenses','income_sources',
    'scheduled_payments','receivables','budget_categories','savings_plans','investment_accounts',
    'installment_plans','objective_versions','objective_month_closes','daily_financial_snapshots',
    'net_worth_snapshots','financial_context_snapshots','recurring_investment_plans',
    'goal_allocation_revisions','card_payment_applications','debt_statement_cycles',
    'kipu_reconcile_ops','recurring_occurrences','scheduled_changes','spending_alert_rules',
    'user_financial_preferences','fixed_expense_forecasts',
    'fixed_expense_observations','fixed_expense_observation_operations',
    'account_close_applications',
    'account_balance_reconciliation_applications','financial_facts',
    'debt_proceeds_applications','receivable_repayment_applications',
    'agent_operation_reversals'
  ]::text[];
$$;

alter function public.kipu__base_financial_tables() owner to postgres;
revoke all on function public.kipu__base_financial_tables()
  from public, anon, authenticated;
grant execute on function public.kipu__base_financial_tables() to service_role;

create or replace function public.kipu_record_agent_intake_failure(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_key text := nullif(btrim(p->>'delivery_key'),'');
  v_channel text := nullif(btrim(p->>'channel'),'');
  v_chat text := nullif(p->>'chat_id','');
  v_message uuid := nullif(p->>'message_id','')::uuid;
  v_text text := nullif(btrim(p->>'request_text'),'');
  v_stage text := nullif(btrim(p->>'stage'),'');
  v_error jsonb := coalesce(p->'error','{}'::jsonb);
  v_fingerprint text;
  v_row public.agent_intake_failures%rowtype;
begin
  if v_user is null or v_key is null or v_channel not in ('telegram','web')
     or v_message is null or v_text is null or v_stage is null
     or jsonb_typeof(v_error) <> 'object' then
    raise exception 'KIPU_VALIDATION: complete intake failure identity is required'
      using errcode = '22023';
  end if;
  if length(v_key) > 240 or length(v_text) > 12000 or length(v_stage) > 80 then
    raise exception 'KIPU_VALIDATION: intake failure identity is too long'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.chat_messages m
     where m.id = v_message and m.user_id = v_user and m.role = 'user'
  ) then
    raise exception 'KIPU_OWNERSHIP: intake root message does not belong to user'
      using errcode = '42501';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'channel',v_channel,'chat_id',v_chat,'root_message_id',v_message,'request_text',v_text
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':intake:' || v_key,0));
  select * into v_row from public.agent_intake_failures
   where user_id = v_user and delivery_key = v_key for update;
  if found then
    if v_row.request_fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: intake key reused for a different request'
        using errcode = '22023';
    end if;
    update public.agent_intake_failures
       set status = 'open', stage = v_stage, last_error = v_error,
           attempts = attempts + 1, resolved_operation_id = null, resolved_at = null
     where id = v_row.id returning * into v_row;
  else
    insert into public.agent_intake_failures(
      user_id,delivery_key,message_id,channel,chat_id,request_text,
      request_fingerprint,stage,last_error
    ) values (
      v_user,v_key,v_message,v_channel,v_chat,v_text,
      v_fingerprint,v_stage,v_error
    ) returning * into v_row;
  end if;
  return jsonb_build_object(
    'outcome','recorded','id',v_row.id,'status',v_row.status,
    'attempts',v_row.attempts,'stage',v_row.stage
  );
end;
$$;

create or replace function public.kipu_resolve_agent_intake_failure(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_key text := nullif(btrim(p->>'delivery_key'),'');
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_row public.agent_intake_failures%rowtype;
begin
  if v_user is null or v_key is null or v_operation is null then
    raise exception 'KIPU_VALIDATION: user, delivery and operation are required'
      using errcode = '22023';
  end if;
  select * into v_row from public.agent_intake_failures
   where user_id = v_user and delivery_key = v_key for update;
  if not found then
    return jsonb_build_object('outcome','absent');
  end if;
  if not exists (
    select 1 from public.agent_operations o
     join public.agent_operation_deliveries d on d.operation_id = o.id
    where o.id = v_operation and o.user_id = v_user
      and d.user_id = v_user and d.delivery_key = v_key
      and d.request_fingerprint = v_row.request_fingerprint
  ) then
    raise exception 'KIPU_OWNERSHIP: durable operation does not own the exact intake delivery'
      using errcode = '42501';
  end if;
  if v_row.status = 'resolved' then
    if v_row.resolved_operation_id is distinct from v_operation then
      raise exception 'KIPU_DEDUPE_MISMATCH: intake resolved by another operation'
        using errcode = '22023';
    end if;
    return jsonb_build_object('outcome','replayed','id',v_row.id);
  end if;
  update public.agent_intake_failures
     set status = 'resolved', resolved_operation_id = v_operation, resolved_at = now()
   where id = v_row.id returning * into v_row;
  return jsonb_build_object('outcome','resolved','id',v_row.id);
end;
$$;

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
  -- inverse two-channel race A→B / B→A to deadlock. Acquire every operation
  -- identity in one deterministic order before reading or changing any row.
  v_lock_ids := array_remove(
    array[v_continuation]::uuid[] || v_supersede || v_abandon,
    null
  );
  if jsonb_object_length(v_expected_versions) <> cardinality(v_lock_ids)
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

-- Exact worker recovery resumes the already-validated plan and its existing
-- step rows. It MUST NOT create a new plan version or ask the model to choose
-- arguments again: a prior writer may have committed just before its durable
-- step receipt was recorded. Reusing the exact persisted arguments is the only
-- safe retry boundary for that uncertain interval.
create or replace function public.kipu_resume_agent_operation_plan(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_id uuid := nullif(p->>'operation_id','')::uuid;
  v_expected integer := nullif(p->>'expected_version','')::integer;
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_row public.agent_operations%rowtype;
  v_step_count integer;
begin
  if v_user is null or v_id is null or v_expected is null or v_lease is null then
    raise exception 'KIPU_VALIDATION: user, operation, version and recovery lease are required'
      using errcode = '22023';
  end if;
  select * into v_row from public.agent_operations
   where id = v_id and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_row.state_version <> v_expected then
    return jsonb_build_object(
      'outcome','conflict','id',v_row.id,'status',v_row.status,
      'state_version',v_row.state_version
    );
  end if;
  if v_row.status <> 'planning' or v_row.plan is null
     or v_row.plan_version is null or v_row.validated_at is null then
    raise exception 'KIPU_VALIDATION: operation has no persisted plan to resume'
      using errcode = '22023';
  end if;
  if v_row.lease_token <> v_lease or v_row.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: recovery lease is missing, stale or expired'
      using errcode = '22023';
  end if;
  select count(*) into v_step_count from public.agent_operation_steps s
   where s.operation_id = v_row.id and s.user_id = v_user
     and s.plan_version = v_row.plan_version;
  if v_step_count <> jsonb_array_length(coalesce(v_row.plan->'actions','[]'::jsonb)) then
    raise exception 'KIPU_EFFECT_MISSING: persisted plan and step rows diverge'
      using errcode = '22023';
  end if;
  update public.agent_operations
     set status = 'ready', state_version = state_version + 1,
         lease_token = null, lease_expires_at = null
   where id = v_row.id
   returning * into v_row;
  return jsonb_build_object(
    'outcome','resumed_plan','id',v_row.id,'status',v_row.status,
    'state_version',v_row.state_version,'plan_version',v_row.plan_version
  );
end;
$$;

create or replace function public.kipu_transition_agent_operation(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_id uuid := nullif(p->>'operation_id','')::uuid;
  v_expected integer := nullif(p->>'expected_version','')::integer;
  v_status text := nullif(btrim(p->>'status'),'');
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_row public.agent_operations%rowtype;
  v_terminal boolean;
  v_allowed boolean;
begin
  if v_user is null or v_id is null or v_expected is null or v_status is null then
    raise exception 'KIPU_VALIDATION: user, operation, expected version and status are required'
      using errcode = '22023';
  end if;
  if v_status not in (
    'planning','awaiting_input','ready','applying','verifying','completed',
    'refused','failed_retriable','superseded','abandoned','expired'
  ) then
    raise exception 'KIPU_VALIDATION: unsupported operation status'
      using errcode = '22023';
  end if;

  select * into v_row from public.agent_operations
   where id = v_id and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned'
      using errcode = '42501';
  end if;
  if v_row.state_version <> v_expected then
    return jsonb_build_object(
      'outcome','conflict','id',v_row.id,'status',v_row.status,
      'state_version',v_row.state_version
    );
  end if;
  if v_row.status in ('completed','refused','superseded','abandoned','expired') then
    if v_row.status = v_status then
      return jsonb_build_object(
        'outcome','replayed','id',v_row.id,'status',v_row.status,
        'state_version',v_row.state_version
      );
    end if;
    raise exception 'KIPU_VALIDATION: terminal operation cannot transition'
      using errcode = '22023';
  end if;

  -- The lifecycle is a contract, not a label callers can jump around. In
  -- particular, no caller may claim completion directly from planning and no
  -- stale worker may finish an operation after another worker acquired it.
  v_allowed := case v_row.status
    when 'planning' then v_status in ('planning','awaiting_input','ready','refused','failed_retriable','abandoned')
    when 'awaiting_input' then false -- only kipu_claim_agent_operation may resume it
    when 'ready' then v_status in ('ready','awaiting_input','verifying','refused','failed_retriable','abandoned')
    when 'applying' then v_status in ('awaiting_input','verifying','failed_retriable')
    when 'verifying' then v_status in ('awaiting_input','completed','failed_retriable')
    when 'failed_retriable' then v_status in ('failed_retriable','abandoned')
    else false
  end;
  if not v_allowed then
    raise exception 'KIPU_VALIDATION: invalid operation lifecycle transition % -> %',
      v_row.status, v_status using errcode = '22023';
  end if;
  if v_row.lease_token is not null
     and (v_lease is null or v_lease <> v_row.lease_token) then
    raise exception 'KIPU_CONFLICT: operation lease is missing or stale'
      using errcode = '22023';
  end if;

  if v_status = 'awaiting_input'
     and nullif(btrim(coalesce(p->>'pending_question',v_row.pending_question)),'') is null then
    raise exception 'KIPU_VALIDATION: awaiting-input operation requires an exact question'
      using errcode = '22023';
  end if;
  if p ? 'missing_fields' and jsonb_typeof(p->'missing_fields') <> 'array' then
    raise exception 'KIPU_VALIDATION: missing_fields must be an array'
      using errcode = '22023';
  end if;
  if p ? 'context_coverage' and jsonb_typeof(p->'context_coverage') <> 'object' then
    raise exception 'KIPU_VALIDATION: context_coverage must be an object'
      using errcode = '22023';
  end if;
  if p ? 'plan' and p->'plan' is not null and jsonb_typeof(p->'plan') <> 'object' then
    raise exception 'KIPU_VALIDATION: plan must be an object'
      using errcode = '22023';
  end if;

  v_terminal := v_status = 'completed';
  update public.agent_operations
     set status = v_status,
         state_version = state_version + 1,
         plan_version = case when p ? 'plan_version' then nullif(p->>'plan_version','')::integer else plan_version end,
         plan = case when p ? 'plan' then p->'plan' else plan end,
         context_coverage = case when p ? 'context_coverage' then p->'context_coverage' else context_coverage end,
         missing_fields = case when p ? 'missing_fields' then p->'missing_fields' else missing_fields end,
         pending_question = case when p ? 'pending_question' then nullif(btrim(p->>'pending_question'),'') else pending_question end,
         result = case when p ? 'result' then p->'result' else result end,
         last_error = case when p ? 'last_error' then p->'last_error' else last_error end,
         validated_at = case when p ? 'validated_at' then nullif(p->>'validated_at','')::timestamptz else validated_at end,
         expires_at = case when p ? 'expires_at' then nullif(p->>'expires_at','')::timestamptz else expires_at end,
         lease_token = case when v_status in ('awaiting_input','failed_retriable','completed','refused','abandoned') then null else lease_token end,
         lease_expires_at = case when v_status in ('awaiting_input','failed_retriable','completed','refused','abandoned') then null else lease_expires_at end,
         completed_at = case when v_terminal then now() else null end
   where id = v_id and user_id = v_user
   returning * into v_row;

  return jsonb_build_object(
    'outcome','transitioned','id',v_row.id,'status',v_row.status,
    'state_version',v_row.state_version
  );
end;
$$;

create or replace function public.kipu_begin_agent_operation_application(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_id uuid := nullif(p->>'operation_id','')::uuid;
  v_expected integer := nullif(p->>'expected_version','')::integer;
  v_row public.agent_operations%rowtype;
  v_token uuid := gen_random_uuid();
begin
  if v_user is null or v_id is null or v_expected is null then
    raise exception 'KIPU_VALIDATION: user, operation and expected version are required'
      using errcode = '22023';
  end if;
  select * into v_row from public.agent_operations
   where id = v_id and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_row.state_version <> v_expected then
    return jsonb_build_object(
      'outcome','conflict','id',v_row.id,'status',v_row.status,
      'state_version',v_row.state_version
    );
  end if;
  if v_row.status <> 'ready' then
    raise exception 'KIPU_VALIDATION: only a ready operation can begin applying'
      using errcode = '22023';
  end if;
  update public.agent_operations
     set status = 'applying', state_version = state_version + 1,
         lease_token = v_token, lease_expires_at = now() + interval '5 minutes'
   where id = v_id
   returning * into v_row;
  return jsonb_build_object(
    'outcome','leased','id',v_row.id,'status',v_row.status,
    'state_version',v_row.state_version,'lease_token',v_token,
    'lease_expires_at',v_row.lease_expires_at
  );
end;
$$;

create or replace function public.kipu_save_agent_operation_plan(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_id uuid := nullif(p->>'operation_id','')::uuid;
  v_expected integer := nullif(p->>'expected_version','')::integer;
  v_plan jsonb := p->'plan';
  v_coverage jsonb := coalesce(p->'context_coverage','{}'::jsonb);
  v_missing jsonb := coalesce(p->'missing_fields','[]'::jsonb);
  v_question text := nullif(btrim(p->>'pending_question'),'');
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_row public.agent_operations%rowtype;
  v_action jsonb;
  v_key text;
  v_capability text;
  v_args jsonb;
  v_status text;
  v_plan_version integer;
  v_step_order integer := 0;
begin
  if v_user is null or v_id is null or v_expected is null
     or v_plan is null or jsonb_typeof(v_plan) <> 'object' then
    raise exception 'KIPU_VALIDATION: user, operation, version and plan are required'
      using errcode = '22023';
  end if;
  if jsonb_typeof(v_coverage) <> 'object' or jsonb_typeof(v_missing) <> 'array'
     or jsonb_typeof(coalesce(v_plan->'actions','[]'::jsonb)) <> 'array' then
    raise exception 'KIPU_VALIDATION: malformed plan collections'
      using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(v_plan->'actions','[]'::jsonb)) > 24
     or jsonb_array_length(v_missing) > 24 then
    raise exception 'KIPU_VALIDATION: an operation plan supports at most 24 actions and missing fields'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_missing) missing
     where jsonb_typeof(missing) <> 'object'
        or jsonb_typeof(coalesce(missing->'applies_to','null'::jsonb)) <> 'array'
        or jsonb_array_length(coalesce(missing->'applies_to','[]'::jsonb)) = 0
  ) then
    raise exception 'KIPU_VALIDATION: every missing field requires an applies_to array'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_missing) missing,
           lateral jsonb_array_elements_text(missing->'applies_to') target(value)
     where target.value <> '$response'
       and not exists (
         select 1
           from jsonb_array_elements(coalesce(v_plan->'actions','[]'::jsonb)) action
          where action->>'id' = target.value
       )
  ) then
    raise exception 'KIPU_VALIDATION: missing fields must target current action ids or $response'
      using errcode = '22023';
  end if;
  -- Missing data belongs to explicit step ids. A plan with actions remains
  -- executable so independent groups can land; the runtime records needs_input
  -- only on the affected group. With no action at all, there is nothing safe to
  -- execute and the operation waits immediately.
  v_status := case
    when jsonb_array_length(v_missing) > 0
      and jsonb_array_length(coalesce(v_plan->'actions','[]'::jsonb)) = 0
      then 'awaiting_input'
    else 'ready'
  end;
  if v_status = 'awaiting_input' and v_question is null then
    raise exception 'KIPU_VALIDATION: an incomplete plan requires its exact question'
      using errcode = '22023';
  end if;

  select * into v_row from public.agent_operations
   where id = v_id and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_row.state_version <> v_expected then
    return jsonb_build_object(
      'outcome','conflict','id',v_row.id,'status',v_row.status,
      'state_version',v_row.state_version
    );
  end if;
  if v_row.status <> 'planning' then
    raise exception 'KIPU_VALIDATION: only a planning operation accepts a plan'
      using errcode = '22023';
  end if;
  if v_lease is null or v_row.lease_token <> v_lease
     or v_row.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: planning lease is missing, stale or expired'
      using errcode = '22023';
  end if;

  v_plan_version := coalesce(v_row.plan_version,0) + 1;
  for v_action in select value from jsonb_array_elements(coalesce(v_plan->'actions','[]'::jsonb))
  loop
    v_step_order := v_step_order + 1;
    if jsonb_typeof(v_action) <> 'object' then
      raise exception 'KIPU_VALIDATION: plan action must be an object' using errcode = '22023';
    end if;
    v_key := nullif(btrim(v_action->>'id'),'');
    v_capability := nullif(btrim(v_action->>'capability'),'');
    v_args := coalesce(v_action->'arguments','{}'::jsonb);
    if v_key is null or v_capability is null or jsonb_typeof(v_args) <> 'object'
       or jsonb_typeof(coalesce(v_action->'depends_on','[]'::jsonb)) <> 'array' then
      raise exception 'KIPU_VALIDATION: plan action identity, capability, arguments and dependencies are required'
        using errcode = '22023';
    end if;
    -- The model may rename a step or reorder JSON keys on a later turn. Neither
    -- is permission to repeat an effect that already landed under an earlier
    -- plan version. This is the server-side half of the planner guard: prompts
    -- are not authority, and every future caller of this RPC inherits it.
    if exists (
      select 1 from public.agent_operation_steps prior
       where prior.operation_id = v_id and prior.user_id = v_user
         and prior.status in ('applied','verified')
         and prior.result->>'execution_effect' in ('write','noop')
         and (
           prior.step_key = v_key
           or (
             prior.capability = v_capability
             and prior.arguments_fingerprint = md5(v_args::text)
           )
         )
    ) then
      raise exception 'KIPU_VALIDATION: continuation repeats an already-settled side effect'
        using errcode = '22023';
    end if;
    insert into public.agent_operation_steps(
      operation_id,user_id,plan_version,step_order,step_key,step_type,capability,atomic_group,
      depends_on,arguments,arguments_fingerprint,state_witness,effects,
      postconditions,status
    ) values (
      v_id,v_user,v_plan_version,v_step_order,v_key,'tool_call',v_capability,
      nullif(btrim(v_action->>'atomic_group'),''),
      array(select jsonb_array_elements_text(coalesce(v_action->'depends_on','[]'::jsonb))),
      v_args,md5(v_args::text),coalesce(v_action->'state_witness','{}'::jsonb),
      coalesce(v_action->'effects','[]'::jsonb),
      coalesce(v_action->'postconditions','[]'::jsonb),
      'preflighted'
    );
  end loop;

  update public.agent_operations
     set status = v_status,
         state_version = state_version + 1,
         plan_version = v_plan_version,
         plan = v_plan,
         context_coverage = v_coverage,
         missing_fields = v_missing,
         pending_question = case when v_status = 'awaiting_input' then v_question else null end,
         validated_at = now(),
         lease_token = null,
         lease_expires_at = null
   where id = v_id
   returning * into v_row;
  return jsonb_build_object(
    'outcome','planned','id',v_row.id,'status',v_row.status,
    'state_version',v_row.state_version,'plan_version',v_row.plan_version
  );
end;
$$;

create or replace function public.kipu_expire_agent_operations(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
declare v_recovered integer;
begin
  if p_user is null then
    raise exception 'KIPU_VALIDATION: user required' using errcode = '22023';
  end if;
  update public.agent_operations
     set status = 'expired', state_version = state_version + 1,
         pending_question = null, missing_fields = '[]'::jsonb
   where user_id = p_user
     and status in ('planning','awaiting_input','ready','failed_retriable')
     and expires_at <= now();
  get diagnostics v_count = row_count;
  update public.agent_operations
     set status = 'failed_retriable', state_version = state_version + 1,
         lease_token = null, lease_expires_at = null,
         last_error = jsonb_build_object(
           'code','lease_expired','message','The previous worker stopped before verification.'
         )
   where user_id = p_user
     and status in ('applying','verifying')
     and lease_expires_at <= now();
  get diagnostics v_recovered = row_count;
  v_count := v_count + v_recovered;
  return v_count;
end;
$$;

-- Every model tool call is attached to the exact persisted plan version.  A
-- pretty final reply cannot turn an unexecuted plan into a completed operation:
-- this receipt is what the verifier consumes later.
create or replace function public.kipu_record_agent_operation_step_outcome(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_step_key text := nullif(btrim(p->>'step_key'),'');
  v_capability text := nullif(btrim(p->>'capability'),'');
  v_args jsonb := p->'arguments';
  v_tool_status text := nullif(btrim(p->>'tool_status'),'');
  v_effect text := nullif(btrim(p->>'execution_effect'),'');
  v_result jsonb := coalesce(p->'result','{}'::jsonb);
  v_refs jsonb := coalesce(p->'affected_refs','[]'::jsonb);
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_op public.agent_operations%rowtype;
  v_step public.agent_operation_steps%rowtype;
  v_next text;
begin
  if v_user is null or v_operation is null or v_step_key is null
     or v_capability is null or v_args is null or jsonb_typeof(v_args) <> 'object'
     or v_tool_status not in ('done','redirect','needs_info','refused','error')
     or v_effect not in ('read','write','noop','failed','needs_info')
     or jsonb_typeof(v_result) <> 'object' or jsonb_typeof(v_refs) <> 'array' then
    raise exception 'KIPU_VALIDATION: complete typed step outcome required'
      using errcode = '22023';
  end if;
  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_op.status not in ('ready','applying') then
    raise exception 'KIPU_VALIDATION: operation is not executing its current plan'
      using errcode = '22023';
  end if;
  if v_op.lease_token is not null
     and (v_lease is null or v_lease <> v_op.lease_token or v_op.lease_expires_at <= now()) then
    raise exception 'KIPU_CONFLICT: operation lease is missing, stale or expired'
      using errcode = '22023';
  end if;
  select * into v_step from public.agent_operation_steps
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_op.plan_version and step_key = v_step_key
   for update;
  if not found or v_step.capability <> v_capability
     or v_step.arguments_fingerprint <> md5(v_args::text) then
    raise exception 'KIPU_VALIDATION: tool outcome contradicts the current persisted step'
      using errcode = '22023';
  end if;
  if v_step.status in ('applied','verified') then
    if v_step.result = v_result || jsonb_build_object(
         'tool_status',v_tool_status,'execution_effect',v_effect
       )
       and v_step.affected_refs = v_refs then
      return jsonb_build_object(
        'outcome','replayed','step_key',v_step.step_key,'status',v_step.status
      );
    end if;
    raise exception 'KIPU_DEDUPE_MISMATCH: step already has a different result'
      using errcode = '22023';
  end if;
  if v_effect in ('read','write','noop') and exists (
    select 1 from unnest(v_step.depends_on) dependency
     where not exists (
       select 1 from public.agent_operation_steps prior
        where prior.operation_id = v_operation
          and prior.plan_version = v_op.plan_version
          and prior.step_key = dependency
          and prior.status in ('applied','verified')
     )
  ) then
    raise exception 'KIPU_VALIDATION: step dependencies are not verified'
      using errcode = '22023';
  end if;
  v_next := case
    when v_tool_status = 'done' and v_effect = 'read' then 'verified'
    when v_tool_status = 'done' and v_effect in ('write','noop') then 'applied'
    when v_tool_status in ('needs_info','redirect') then 'needs_input'
    when v_tool_status = 'refused' then 'refused'
    else 'failed'
  end;
  update public.agent_operation_steps
     set status = v_next,
         result = v_result || jsonb_build_object(
           'tool_status',v_tool_status,'execution_effect',v_effect
         ),
         affected_refs = v_refs,
         error = case when v_next in ('failed','refused') then v_result else null end,
         applied_at = case when v_next = 'applied' then now() else applied_at end,
         verified_at = case when v_next = 'verified' then now() else verified_at end
   where id = v_step.id
   returning * into v_step;
  return jsonb_build_object(
    'outcome','recorded','step_key',v_step.step_key,'status',v_step.status
  );
end;
$$;

-- Final operation verification is deliberately small and falsifiable.  It
-- proves plan coverage and, for money writes, requires the server process to
-- have rebuilt post-write financial context. Domain writers remain responsible
-- for their own monetary postconditions inside their transactions.
create or replace function public.kipu_verify_agent_operation(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_post_write boolean := coalesce((p->>'post_write_context_verified')::boolean,false);
  v_allow_incomplete boolean := coalesce((p->>'allow_incomplete')::boolean,false);
  v_op public.agent_operations%rowtype;
  v_total integer;
  v_verified integer;
  v_resolved integer;
  v_writes integer;
begin
  if v_user is null or v_operation is null then
    raise exception 'KIPU_VALIDATION: user and operation required'
      using errcode = '22023';
  end if;
  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_op.status <> 'verifying' then
    raise exception 'KIPU_VALIDATION: operation must enter verifying first'
      using errcode = '22023';
  end if;
  if v_op.lease_token is not null
     and (v_lease is null or v_lease <> v_op.lease_token or v_op.lease_expires_at <= now()) then
    raise exception 'KIPU_CONFLICT: verification lease is missing, stale or expired'
      using errcode = '22023';
  end if;
  select count(*),
         count(*) filter (where status in ('applied','verified')),
         count(*) filter (where status in ('applied','verified','needs_input','refused','failed')),
         count(*) filter (where result->>'execution_effect' = 'write')
    into v_total,v_verified,v_resolved,v_writes
    from public.agent_operation_steps
   where operation_id = v_operation and plan_version = v_op.plan_version;
  if v_total <> jsonb_array_length(coalesce(v_op.plan->'actions','[]'::jsonb))
     or (not v_allow_incomplete and v_verified <> v_total)
     or (v_allow_incomplete and v_resolved <> v_total) then
    raise exception 'KIPU_EFFECT_MISSING: not every planned step reached a proved result'
      using errcode = '22023';
  end if;
  if v_writes > 0 and not v_post_write then
    raise exception 'KIPU_READ_FAILED: post-write financial context was not verified'
      using errcode = '22023';
  end if;
  update public.agent_operation_steps
     set status = 'verified', verified_at = coalesce(verified_at,now())
   where operation_id = v_operation and plan_version = v_op.plan_version
     and status = 'applied';
  return jsonb_build_object(
    'outcome','verified','operation_id',v_operation,
    'plan_version',v_op.plan_version,'step_count',v_total,'write_count',v_writes
  );
end;
$$;

-- Upgrade the existing v2 repayment boundary with a durable allocation marker.
-- The old core is already atomic for cash + receivable reduction, but it kept no
-- inverse recipe: a later universal undo could only see and reverse the income
-- row. This wrapper requires exact allocation parity, refuses an unattributable
-- historical replay and records the second half in the same transaction.
create or replace function public.kipu_apply_repayment_v2(
  p_entry jsonb,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p_entry->>'user_id','')::uuid;
  v_dedupe text := nullif(p_entry->>'dedupe_key','');
  v_amount numeric := round(nullif(p_entry->>'original_amount','')::numeric,2);
  v_currency text := upper(coalesce(nullif(p_entry->>'original_currency',''),''));
  v_existing_transaction uuid;
  v_marker public.receivable_repayment_applications%rowtype;
  v_result jsonb;
  v_transaction uuid;
  v_allocation_count integer;
  v_distinct_count integer;
  v_allocated numeric;
  v_fingerprint text;
  v_inserted integer;
begin
  if v_user is null or v_dedupe is null or v_amount is null or v_amount <= 0
     or v_currency = ''
     or p_entry->>'type' is distinct from 'income'
     or p_entry->>'effect_type' is distinct from 'income'
     or p_entry->>'category' is distinct from 'income'
     or nullif(p_entry->>'destination_account_id','') is null
     or nullif(p_entry->>'source_account_id','') is not null
     or nullif(p_entry->>'debt_account_id','') is not null
     or nullif(p_entry->>'goal_id','') is not null
     or coalesce(p_entry->>'external_ref','') not like 'receivable_repayment:%'
     or jsonb_typeof(p_allocations) is distinct from 'array'
     or jsonb_array_length(coalesce(p_allocations,'[]'::jsonb)) < 1 then
    raise exception 'KIPU_VALIDATION: complete repayment entry and allocations required'
      using errcode = '22023';
  end if;
  select count(*), count(distinct nullif(a->>'receivable_id','')::uuid),
         round(coalesce(sum(nullif(a->>'amount','')::numeric),0),2)
    into v_allocation_count,v_distinct_count,v_allocated
    from jsonb_array_elements(p_allocations) a;
  if v_allocation_count <> v_distinct_count
     or abs(v_allocated - v_amount) > 0.005
     or exists (
       select 1 from jsonb_array_elements(p_allocations) a
        where nullif(a->>'receivable_id','') is null
           or coalesce(nullif(a->>'amount','')::numeric,0) <= 0
           or coalesce(nullif(a->>'expected_outstanding','')::numeric,0) <= 0
     ) then
    raise exception 'KIPU_VALIDATION: repayment allocations must be unique and equal the cash entry'
      using errcode = '22023';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'entry',p_entry,'allocations',p_allocations
  )::text);
  select id into v_existing_transaction
    from public.transactions
   where user_id = v_user and dedupe_key = v_dedupe;
  if v_existing_transaction is not null then
    select * into v_marker
      from public.receivable_repayment_applications
     where user_id = v_user and transaction_id = v_existing_transaction
     for update;
    if not found then
      raise exception 'KIPU_CONFLICT: historical repayment has no durable allocation marker'
        using errcode = '22023';
    end if;
    if v_marker.dedupe_key <> v_dedupe
       or v_marker.payload_fingerprint <> v_fingerprint
       or abs(v_marker.amount - v_amount) > 0.005
       or v_marker.currency <> v_currency then
      raise exception 'KIPU_DEDUPE_MISMATCH: repayment replay changed its economics'
        using errcode = '22023';
    end if;
    v_result := public.kipu_apply_repayment(p_entry,p_allocations);
    return coalesce(v_result,'{}'::jsonb) || jsonb_build_object(
      'replayed',true,'transaction_id',v_existing_transaction
    );
  end if;

  v_result := public.kipu_apply_repayment(p_entry,p_allocations);
  v_transaction := nullif(v_result->>'transaction_id','')::uuid;
  if v_transaction is null then
    raise exception 'KIPU_EFFECT_MISSING: repayment returned no transaction'
      using errcode = '22023';
  end if;
  insert into public.receivable_repayment_applications(
    user_id,transaction_id,dedupe_key,amount,currency,allocations,payload_fingerprint
  ) values (
    v_user,v_transaction,v_dedupe,v_amount,v_currency,p_allocations,v_fingerprint
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    -- Two exact deliveries may both miss the first wrapper-level SELECT before
    -- the core serializes them on the ledger dedupe. The loser must validate
    -- the marker committed by the winner and return a replay, not surface a
    -- uniqueness error after the financial operation already proved identical.
    select * into v_marker
      from public.receivable_repayment_applications
     where user_id = v_user and transaction_id = v_transaction
     for update;
    if not found
       or v_marker.dedupe_key <> v_dedupe
       or v_marker.payload_fingerprint <> v_fingerprint
       or abs(v_marker.amount - v_amount) > 0.005
       or v_marker.currency <> v_currency then
      raise exception 'KIPU_DEDUPE_MISMATCH: concurrent repayment marker changed its economics'
        using errcode = '22023';
    end if;
    return coalesce(v_result,'{}'::jsonb) || jsonb_build_object(
      'replayed',true,'transaction_id',v_transaction
    );
  end if;
  return coalesce(v_result,'{}'::jsonb) || jsonb_build_object(
    'replayed',false,'transaction_id',v_transaction
  );
end;
$$;

-- Resolve a model-facing tool step into one of a deliberately tiny set of
-- database-native operations. The payload is data, never a function name: the
-- coordinator below owns the dispatch table and cannot execute arbitrary SQL,
-- RPCs or tables supplied by the model.
create or replace function public.kipu_preflight_agent_operation_step(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_step_key text := nullif(btrim(p->>'step_key'),'');
  v_type text := nullif(btrim(p->>'resolved_type'),'');
  v_payload jsonb := p->'resolved_payload';
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_op public.agent_operations%rowtype;
  v_step public.agent_operation_steps%rowtype;
begin
  if v_user is null or v_operation is null or v_step_key is null
     or v_type not in (
       'ledger_entry','card_payment','repayment','debt_proceeds','operation_reversal'
     )
     or v_payload is null or jsonb_typeof(v_payload) <> 'object' then
    raise exception 'KIPU_VALIDATION: unsupported or incomplete resolved step'
      using errcode = '22023';
  end if;
  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_op.status <> 'applying' or v_op.lease_token <> v_lease
     or v_op.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: operation is not under its live lease'
      using errcode = '22023';
  end if;
  select * into v_step from public.agent_operation_steps
   where operation_id = v_operation and plan_version = v_op.plan_version
     and user_id = v_user and step_key = v_step_key for update;
  if not found or v_step.status <> 'preflighted' or v_step.atomic_group is null then
    raise exception 'KIPU_VALIDATION: current grouped step is not preflightable'
      using errcode = '22023';
  end if;
  if not (
    (v_step.capability = 'record_person_payment'
      and v_type in ('ledger_entry','repayment','debt_proceeds'))
    or
    (v_step.capability = 'log_movement'
      and v_type in ('ledger_entry','card_payment'))
    or
    (v_step.capability = 'register_card_payment'
      and v_type in ('ledger_entry','card_payment'))
    or
    (v_step.capability = 'undo_agent_operation'
      and v_type = 'operation_reversal')
  ) then
    raise exception 'KIPU_VALIDATION: resolved database operation contradicts capability'
      using errcode = '22023';
  end if;
  if v_type in ('ledger_entry','card_payment','repayment')
     and nullif(v_payload->'entry'->>'user_id','')::uuid is distinct from v_user then
    raise exception 'KIPU_OWNERSHIP: resolved ledger entry belongs to another user'
      using errcode = '42501';
  end if;
  if v_type = 'debt_proceeds'
     and nullif(v_payload->>'user_id','')::uuid is distinct from v_user then
    raise exception 'KIPU_OWNERSHIP: resolved debt proceeds belong to another user'
      using errcode = '42501';
  end if;
  if v_type = 'operation_reversal'
     and nullif(v_payload->>'user_id','')::uuid is distinct from v_user then
    raise exception 'KIPU_OWNERSHIP: resolved operation reversal belongs to another user'
      using errcode = '42501';
  end if;
  -- The service-role adapter is not authority to change the economic meaning
  -- between the persisted plan and the generic ledger. This boundary has been
  -- the source of repeated production defects: validate the complete
  -- capital-return shape here before storing a payload the coordinator will
  -- later execute without re-consulting TypeScript.
  if v_step.capability = 'record_person_payment' and v_type = 'ledger_entry' then
    if v_step.arguments->>'direction' is distinct from 'in'
       or v_step.arguments->>'inflowKind' is distinct from 'capital_return_unrecorded'
       or v_payload->'entry'->>'type' is distinct from 'adjustment'
       or v_payload->'entry'->>'effect_type' is distinct from 'adjustment'
       or coalesce((v_payload->'entry'->>'sign')::integer,0) <> 1
       or v_payload->'entry'->>'category' is distinct from 'other'
       or nullif(v_payload->'entry'->>'destination_account_id','')::uuid
            is distinct from nullif(v_step.arguments->>'accountId','')::uuid
       or coalesce(nullif(v_step.arguments->>'amount','')::numeric,0) <= 0
       or coalesce(nullif(v_payload->'entry'->>'original_amount','')::numeric,0) <= 0
       or abs(
            coalesce(nullif(v_payload->'entry'->>'original_amount','')::numeric,0)
            - coalesce(nullif(v_step.arguments->>'amount','')::numeric,0)
          ) > 0.005
       or nullif(v_payload->'entry'->>'source_account_id','') is not null
       or nullif(v_payload->'entry'->>'debt_account_id','') is not null
       or nullif(v_payload->'entry'->>'goal_id','') is not null
       or v_payload->'entry'->>'external_ref'
            is distinct from 'capital_return_unrecorded:' || v_operation::text || ':' || v_step_key
       or v_payload->'entry'->>'dedupe_key'
            is distinct from 'agent-operation:' || v_operation::text || ':' || v_step_key
       or not exists (
         select 1
           from jsonb_array_elements(coalesce(v_op.plan->'actions','[]'::jsonb)) a
          where a->>'id' = v_step_key
            and exists (
              select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
               where e->>'owner' = 'user'
                 and e->>'classification' = 'capital_return_unrecorded'
                 and e->>'surface' = 'cash'
                 and e->>'direction' = 'increase'
                 and e->>'entity_ref' = v_payload->'entry'->>'destination_account_id'
            )
            and exists (
              select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
               where e->>'owner' = 'user'
                 and e->>'classification' = 'capital_return_unrecorded'
                 and e->>'surface' = 'income_recognition'
                 and e->>'direction' = 'unchanged'
            )
            and exists (
              select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
               where e->>'owner' = 'user'
                 and e->>'classification' = 'capital_return_unrecorded'
                 and e->>'surface' = 'receivable'
                 and e->>'direction' = 'unchanged'
            )
       ) then
      raise exception 'KIPU_VALIDATION: capital-return ledger payload contradicts its persisted plan'
        using errcode = '22023';
    end if;
  end if;
  if v_step.capability = 'record_person_payment' and v_type = 'repayment' then
    if v_step.arguments->>'direction' is distinct from 'in'
       or v_step.arguments->>'inflowKind' is distinct from 'loan_repayment'
       or v_payload->'entry'->>'type' is distinct from 'income'
       or v_payload->'entry'->>'effect_type' is distinct from 'income'
       or coalesce((v_payload->'entry'->>'sign')::integer,0) <> 1
       or v_payload->'entry'->>'category' is distinct from 'income'
       or nullif(v_payload->'entry'->>'destination_account_id','')::uuid
            is distinct from nullif(v_step.arguments->>'accountId','')::uuid
       or nullif(v_payload->'entry'->>'source_account_id','') is not null
       or nullif(v_payload->'entry'->>'debt_account_id','') is not null
       or nullif(v_payload->'entry'->>'goal_id','') is not null
       or coalesce(nullif(v_step.arguments->>'amount','')::numeric,0) <= 0
       or abs(
            coalesce(nullif(v_payload->'entry'->>'original_amount','')::numeric,0)
            - coalesce(nullif(v_step.arguments->>'amount','')::numeric,0)
          ) > 0.005
       or v_payload->'entry'->>'external_ref'
            is distinct from 'receivable_repayment:' || v_operation::text || ':' || v_step_key
       or v_payload->'entry'->>'dedupe_key'
            is distinct from 'agent-operation:' || v_operation::text || ':' || v_step_key
       or jsonb_typeof(v_payload->'allocations') is distinct from 'array'
       or jsonb_array_length(coalesce(v_payload->'allocations','[]'::jsonb)) < 1
       or jsonb_typeof(v_step.arguments->'receivableIds') is distinct from 'array'
       or jsonb_array_length(coalesce(v_step.arguments->'receivableIds','[]'::jsonb)) < 1
       or exists (
         select 1
           from jsonb_array_elements(coalesce(v_payload->'allocations','[]'::jsonb)) allocation
          where not exists (
            select 1
              from jsonb_array_elements_text(
                coalesce(v_step.arguments->'receivableIds','[]'::jsonb)
              ) planned_id(value)
             where planned_id.value = allocation->>'receivable_id'
          )
       )
       or exists (
         select 1
           from jsonb_array_elements_text(
             coalesce(v_step.arguments->'receivableIds','[]'::jsonb)
           ) planned_id(value)
          where not exists (
            select 1
              from jsonb_array_elements(coalesce(v_payload->'allocations','[]'::jsonb)) allocation
             where allocation->>'receivable_id' = planned_id.value
          )
       )
       or abs(
         coalesce((
           select sum(nullif(allocation->>'amount','')::numeric)
             from jsonb_array_elements(coalesce(v_payload->'allocations','[]'::jsonb)) allocation
         ),0) - coalesce(nullif(v_payload->'entry'->>'original_amount','')::numeric,0)
       ) > 0.005
       or not exists (
         select 1
           from jsonb_array_elements(coalesce(v_op.plan->'actions','[]'::jsonb)) a
          where a->>'id' = v_step_key
            and exists (
              select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
               where e->>'owner' = 'user'
                 and e->>'classification' = 'receivable_repayment'
                 and e->>'surface' = 'cash'
                 and e->>'direction' = 'increase'
                 and e->>'entity_ref' = v_payload->'entry'->>'destination_account_id'
            )
            and exists (
              select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
               where e->>'owner' = 'user'
                 and e->>'classification' = 'receivable_repayment'
                 and e->>'surface' = 'receivable'
                 and e->>'direction' = 'decrease'
            )
       ) then
      raise exception 'KIPU_VALIDATION: receivable-repayment payload contradicts its persisted plan'
        using errcode = '22023';
    end if;
  end if;
  if v_step.capability = 'register_card_payment'
     and v_type in ('ledger_entry','card_payment') then
    if v_payload->'entry'->>'type' is distinct from 'debt_payment'
       or v_payload->'entry'->>'effect_type' is distinct from 'debt_payment'
       or coalesce((v_payload->'entry'->>'sign')::integer,0) <> 1
       or v_payload->'entry'->>'category' is distinct from 'debt'
       or nullif(v_payload->'entry'->>'source_account_id','') is null
       or nullif(v_payload->'entry'->>'debt_account_id','') is null
       or nullif(v_payload->'entry'->>'destination_account_id','') is not null
       or nullif(v_payload->'entry'->>'goal_id','') is not null
       or coalesce(nullif(v_payload->'entry'->>'original_amount','')::numeric,0) <= 0
       or (
         nullif(v_step.arguments->>'amount','') is not null
         and abs(
           nullif(v_step.arguments->>'amount','')::numeric
           - coalesce(nullif(v_payload->'entry'->>'original_amount','')::numeric,0)
         ) > 0.005
       )
       or v_payload->'entry'->>'dedupe_key'
            is distinct from 'agent-operation:' || v_operation::text || ':' || v_step_key
       or (
         v_type = 'card_payment'
         and v_payload->'statement'->>'debt_account_id'
              is distinct from v_payload->'entry'->>'debt_account_id'
       )
       or not exists (
         select 1
           from jsonb_array_elements(coalesce(v_op.plan->'actions','[]'::jsonb)) a
          where a->>'id' = v_step_key
            and exists (
              select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
               where e->>'owner' = 'user'
                 and e->>'classification' = 'payment'
                 and e->>'surface' = 'cash'
                 and e->>'direction' = 'decrease'
                 and e->>'entity_ref' = v_payload->'entry'->>'source_account_id'
            )
            and exists (
              select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
               where e->>'owner' = 'user'
                 and e->>'classification' = 'payment'
                 and e->>'surface' = 'debt_liability'
                 and e->>'direction' = 'decrease'
                 and e->>'entity_ref' = v_payload->'entry'->>'debt_account_id'
            )
       ) then
      raise exception 'KIPU_VALIDATION: card-payment payload contradicts its persisted plan'
        using errcode = '22023';
    end if;
  end if;
  -- A movement replacement is admitted only as the second half of an
  -- append-only whole-operation correction in the SAME atomic group. This is
  -- the database proof behind the TypeScript adapter's temporary correction
  -- context; a service-role caller cannot submit a naked replacement entry.
  if v_step.capability = 'log_movement'
     and v_type in ('ledger_entry','card_payment') then
    if not exists (
         select 1 from public.agent_operation_steps reversal
          where reversal.operation_id = v_operation
            and reversal.plan_version = v_op.plan_version
            and reversal.atomic_group = v_step.atomic_group
            and reversal.step_order < v_step.step_order
            and reversal.capability = 'undo_agent_operation'
            and reversal.resolved_type = 'operation_reversal'
       )
       or v_payload->'entry'->>'type' is distinct from v_step.arguments->>'type'
       or v_payload->'entry'->>'effect_type' is distinct from v_step.arguments->>'type'
       or coalesce((v_payload->'entry'->>'sign')::integer,0) <> 1
       or coalesce(nullif(v_step.arguments->>'amount','')::numeric,0) <= 0
       or abs(
            coalesce(nullif(v_payload->'entry'->>'original_amount','')::numeric,0)
            - coalesce(nullif(v_step.arguments->>'amount','')::numeric,0)
          ) > 0.005
       or v_payload->'entry'->>'dedupe_key'
            is distinct from 'agent-operation:' || v_operation::text || ':' || v_step_key
       or (
         v_type = 'card_payment'
         and v_payload->'statement'->>'debt_account_id'
              is distinct from v_payload->'entry'->>'debt_account_id'
       )
       or not exists (
         select 1
           from jsonb_array_elements(coalesce(v_op.plan->'actions','[]'::jsonb)) a
          where a->>'id' = v_step_key
            and (
              (
                v_step.arguments->>'type' = 'expense'
                and (
                  (
                    nullif(v_payload->'entry'->>'source_account_id','') is not null
                    and nullif(v_payload->'entry'->>'debt_account_id','') is null
                    and exists (
                      select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
                       where e->>'owner' = 'user' and e->>'classification' = 'expense'
                         and e->>'surface' = 'cash' and e->>'direction' = 'decrease'
                         and e->>'entity_ref' = v_payload->'entry'->>'source_account_id'
                    )
                  )
                  or
                  (
                    nullif(v_payload->'entry'->>'debt_account_id','') is not null
                    and nullif(v_payload->'entry'->>'source_account_id','') is null
                    and exists (
                      select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
                       where e->>'owner' = 'user' and e->>'classification' = 'expense'
                         and e->>'surface' = 'debt_liability' and e->>'direction' = 'increase'
                         and e->>'entity_ref' = v_payload->'entry'->>'debt_account_id'
                    )
                  )
                )
                and exists (
                  select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
                   where e->>'owner' = 'user' and e->>'classification' = 'expense'
                     and e->>'surface' = 'expense_recognition' and e->>'direction' = 'increase'
                )
              )
              or
              (
                v_step.arguments->>'type' = 'income'
                and nullif(v_payload->'entry'->>'destination_account_id','') is not null
                and exists (
                  select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
                   where e->>'owner' = 'user' and e->>'classification' = 'income'
                     and e->>'surface' = 'cash' and e->>'direction' = 'increase'
                     and e->>'entity_ref' = v_payload->'entry'->>'destination_account_id'
                )
                and exists (
                  select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
                   where e->>'owner' = 'user' and e->>'classification' = 'income'
                     and e->>'surface' = 'income_recognition' and e->>'direction' = 'increase'
                )
              )
              or
              (
                v_step.arguments->>'type' = 'debt_payment'
                and nullif(v_payload->'entry'->>'source_account_id','') is not null
                and nullif(v_payload->'entry'->>'debt_account_id','') is not null
                and exists (
                  select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
                   where e->>'owner' = 'user' and e->>'classification' = 'payment'
                     and e->>'surface' = 'cash' and e->>'direction' = 'decrease'
                     and e->>'entity_ref' = v_payload->'entry'->>'source_account_id'
                )
                and exists (
                  select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
                   where e->>'owner' = 'user' and e->>'classification' = 'payment'
                     and e->>'surface' = 'debt_liability' and e->>'direction' = 'decrease'
                     and e->>'entity_ref' = v_payload->'entry'->>'debt_account_id'
                )
              )
              or
              (
                v_step.arguments->>'type' = 'goal_contribution'
                and nullif(v_payload->'entry'->>'source_account_id','') is not null
                and nullif(v_payload->'entry'->>'goal_id','') is not null
                and exists (
                  select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
                   where e->>'owner' = 'user' and e->>'classification' = 'transfer'
                     and e->>'surface' = 'cash' and e->>'direction' = 'decrease'
                     and e->>'entity_ref' = v_payload->'entry'->>'source_account_id'
                )
                and exists (
                  select 1 from jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
                   where e->>'owner' = 'user' and e->>'classification' = 'transfer'
                     and e->>'surface' = 'goal_balance' and e->>'direction' = 'increase'
                     and e->>'entity_ref' = v_payload->'entry'->>'goal_id'
                )
              )
            )
       ) then
      raise exception 'KIPU_VALIDATION: replacement movement contradicts its reversal group or persisted plan'
        using errcode = '22023';
    end if;
  end if;
  update public.agent_operation_steps
     set resolved_type = v_type,
         resolved_payload = v_payload,
         resolved_fingerprint = md5(v_payload::text),
         preflighted_at = now()
   where id = v_step.id;
  return jsonb_build_object(
    'outcome','preflighted','step_key',v_step_key,'resolved_type',v_type
  );
end;
$$;

create or replace function public.kipu_apply_operation(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_group text := nullif(btrim(p->>'atomic_group'),'');
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_op public.agent_operations%rowtype;
  v_step public.agent_operation_steps%rowtype;
  v_result jsonb;
  v_transaction uuid;
  v_total integer;
  v_done integer;
  v_results jsonb := '[]'::jsonb;
begin
  if v_user is null or v_operation is null or v_group is null or v_lease is null then
    raise exception 'KIPU_VALIDATION: operation, atomic group and lease required'
      using errcode = '22023';
  end if;
  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_op.status <> 'applying' or v_op.lease_token <> v_lease
     or v_op.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: operation is not under its live lease'
      using errcode = '22023';
  end if;
  select count(*), count(*) filter (where status in ('applied','verified'))
    into v_total,v_done
    from public.agent_operation_steps
   where operation_id = v_operation and plan_version = v_op.plan_version
     and atomic_group = v_group;
  if v_total < 2 then
    raise exception 'KIPU_VALIDATION: atomic coordinator requires at least two planned steps'
      using errcode = '22023';
  end if;
  if v_done = v_total then
    select coalesce(jsonb_agg(result order by step_order),'[]'::jsonb)
      into v_results from public.agent_operation_steps
     where operation_id = v_operation and plan_version = v_op.plan_version
       and atomic_group = v_group;
    return jsonb_build_object('outcome','replayed','results',v_results);
  end if;
  if v_done <> 0 then
    raise exception 'KIPU_CONFLICT: atomic group has a partial prior application'
      using errcode = '22023';
  end if;

  for v_step in
    select * from public.agent_operation_steps
     where operation_id = v_operation and plan_version = v_op.plan_version
       and atomic_group = v_group
     order by step_order
     for update
  loop
    if v_step.status <> 'preflighted' or v_step.resolved_payload is null
       or v_step.resolved_fingerprint <> md5(v_step.resolved_payload::text) then
      raise exception 'KIPU_VALIDATION: every grouped step must pass typed preflight'
        using errcode = '22023';
    end if;
    if exists (
      select 1 from unnest(v_step.depends_on) dependency
       where not exists (
         select 1 from public.agent_operation_steps prior
          where prior.operation_id = v_operation
            and prior.plan_version = v_op.plan_version
            and prior.step_key = dependency
            and prior.status in ('applied','verified')
       )
    ) then
      raise exception 'KIPU_VALIDATION: atomic step dependency is absent'
        using errcode = '22023';
    end if;

    if v_step.resolved_type = 'ledger_entry' then
      v_transaction := public.kipu_apply_ledger_entry(v_step.resolved_payload->'entry');
      v_result := jsonb_build_object(
        'outcome','applied','transaction_id',v_transaction
      );
    elsif v_step.resolved_type = 'card_payment' then
      v_result := public.kipu_apply_card_payment_v2(
        v_step.resolved_payload->'entry',v_step.resolved_payload->'statement'
      );
    elsif v_step.resolved_type = 'repayment' then
      v_result := public.kipu_apply_repayment_v2(
        v_step.resolved_payload->'entry',v_step.resolved_payload->'allocations'
      );
    elsif v_step.resolved_type = 'debt_proceeds' then
      v_result := public.kipu_apply_debt_proceeds(
        v_step.resolved_payload || jsonb_build_object(
          'operation_id',v_operation,'step_key',v_step.step_key,
          'lease_token',v_lease
        )
      );
    elsif v_step.resolved_type = 'operation_reversal' then
      v_result := public.kipu_reverse_agent_operation(
        v_step.resolved_payload || jsonb_build_object(
          'reversal_operation_id',v_operation,'step_key',v_step.step_key,
          'lease_token',v_lease
        )
      );
    else
      raise exception 'KIPU_VALIDATION: resolved step type is not dispatchable'
        using errcode = '22023';
    end if;
    update public.agent_operation_steps
       set status = 'applied', applied_at = coalesce(applied_at,now()),
           result = coalesce(v_result,'{}'::jsonb) || jsonb_build_object(
             'tool_status','done','execution_effect','write'
           ),
           affected_refs = case
             when v_step.resolved_type = 'debt_proceeds'
               then jsonb_build_array(
                 jsonb_build_object('type','transaction','id',v_result->>'transaction_id'),
                 jsonb_build_object('type','account','id',v_result->>'account_id'),
                 jsonb_build_object('type','debt_account','id',v_result->>'debt_account_id')
               )
             when v_step.resolved_type = 'repayment'
               then jsonb_build_array(
                 jsonb_build_object('type','transaction','id',v_result->>'transaction_id'),
                 jsonb_build_object(
                   'type','account',
                   'id',v_step.resolved_payload->'entry'->>'destination_account_id'
                 )
               ) || coalesce((
                 select jsonb_agg(
                   jsonb_build_object(
                     'type','receivable','id',allocation->>'receivable_id'
                   ) order by allocation->>'receivable_id'
                 )
                   from jsonb_array_elements(
                     coalesce(v_step.resolved_payload->'allocations','[]'::jsonb)
                   ) allocation
               ),'[]'::jsonb)
             when v_step.resolved_type = 'card_payment'
               then jsonb_build_array(
                 jsonb_build_object('type','transaction','id',v_result->>'transaction_id'),
                 jsonb_build_object(
                   'type','account',
                   'id',v_step.resolved_payload->'entry'->>'source_account_id'
                 ),
                 jsonb_build_object(
                   'type','debt_account',
                   'id',v_step.resolved_payload->'entry'->>'debt_account_id'
                 )
               )
             when v_step.resolved_type = 'ledger_entry'
               then jsonb_build_array(
                 jsonb_build_object('type','transaction','id',v_transaction)
               ) || coalesce((
                 select jsonb_agg(ref)
                   from (
                     select jsonb_build_object('type','account','id',id) ref
                       from (values
                         (nullif(v_step.resolved_payload->'entry'->>'source_account_id','')),
                         (nullif(v_step.resolved_payload->'entry'->>'destination_account_id',''))
                       ) account_ids(id)
                      where id is not null
                     union all
                     select jsonb_build_object(
                       'type','debt_account',
                       'id',nullif(v_step.resolved_payload->'entry'->>'debt_account_id','')
                     )
                      where nullif(v_step.resolved_payload->'entry'->>'debt_account_id','') is not null
                     union all
                     select jsonb_build_object(
                       'type','goal',
                       'id',nullif(v_step.resolved_payload->'entry'->>'goal_id','')
                     )
                      where nullif(v_step.resolved_payload->'entry'->>'goal_id','') is not null
                   ) refs
               ),'[]'::jsonb)
             when v_step.resolved_type = 'operation_reversal'
               then coalesce(v_result->'affected_refs','[]'::jsonb)
             when coalesce(v_result->>'transaction_id','') <> ''
               then jsonb_build_array(jsonb_build_object(
                 'type','transaction','id',v_result->>'transaction_id'
               ))
             else affected_refs
           end
     where id = v_step.id;
    v_results := v_results || jsonb_build_array(
      jsonb_build_object('step_key',v_step.step_key,'result',v_result)
    );
  end loop;
  return jsonb_build_object('outcome','applied','results',v_results);
end;
$$;

-- One ontology-backed financial primitive needed by the founder transcript.
-- It does not inspect words: the persisted plan must declare debt_proceeds and
-- the exact record_person_payment arguments. Cash and liability land together.
create or replace function public.kipu_apply_debt_proceeds(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_step_key text := nullif(btrim(p->>'step_key'),'');
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_debt uuid := nullif(p->>'debt_account_id','')::uuid;
  v_amount numeric := nullif(p->>'amount','')::numeric;
  v_currency text := upper(nullif(btrim(p->>'original_currency'),''));
  v_base text := upper(nullif(btrim(p->>'base_currency'),''));
  v_rate numeric := nullif(p->>'exchange_rate_to_base','')::numeric;
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_step public.agent_operation_steps%rowtype;
  v_op public.agent_operations%rowtype;
  v_application public.debt_proceeds_applications%rowtype;
  v_account_currency text;
  v_debt_currency text;
  v_profile_base text;
  v_transaction uuid;
  v_base_amount numeric;
  v_fingerprint text;
  v_rows integer;
begin
  if v_user is null or v_operation is null or v_step_key is null or v_lease is null
     or v_account is null or v_debt is null or v_amount is null or v_amount <= 0
     or v_currency is null or v_base is null or v_rate is null or v_rate <= 0
     or v_dedupe is null then
    raise exception 'KIPU_VALIDATION: complete debt-proceeds identity and money are required'
      using errcode = '22023';
  end if;

  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_op.status <> 'applying' or v_op.lease_token <> v_lease
     or v_op.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: operation is not under a live application lease'
      using errcode = '22023';
  end if;
  select * into v_step from public.agent_operation_steps
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_op.plan_version and step_key = v_step_key
   for update;
  if not found or v_step.capability <> 'record_person_payment' then
    raise exception 'KIPU_VALIDATION: debt proceeds step is absent from the plan'
      using errcode = '22023';
  end if;
  -- Immutable intent is checked before the replay branch. A replay is allowed
  -- to skip mutable account/rate revalidation, but never to change what this
  -- durable step means.
  if v_step.arguments->>'direction' <> 'in'
     or v_step.arguments->>'inflowKind' <> 'borrowed'
     or nullif(v_step.arguments->>'accountId','')::uuid <> v_account
     or nullif(v_step.arguments->>'debtAccountId','')::uuid <> v_debt
     or abs(coalesce(nullif(v_step.arguments->>'amount','')::numeric,0) - v_amount) > 0.005
     or not exists (
       select 1 from jsonb_array_elements(coalesce(v_op.plan->'actions','[]'::jsonb)) a,
         lateral jsonb_array_elements(coalesce(a->'effects','[]'::jsonb)) e
        where a->>'id' = v_step_key and e->>'classification' = 'debt_proceeds'
     ) then
    raise exception 'KIPU_VALIDATION: debt proceeds payload contradicts its persisted plan'
      using errcode = '22023';
  end if;
  v_base_amount := round(v_amount * v_rate, 2);
  if v_base_amount <= 0 then
    raise exception 'KIPU_FX_REQUIRED: debt proceeds base leg is not expressible'
      using errcode = '22023';
  end if;
  if v_step.status in ('applied','verified') then
    select * into v_application
      from public.debt_proceeds_applications
     where user_id = v_user and operation_id = v_operation
       and step_key = v_step_key
     for update;
    if not found
       or v_application.account_id <> v_account
       or v_application.debt_account_id <> v_debt
       or abs(v_application.amount - v_amount) > 0.005
       or abs(v_application.base_amount - v_base_amount) > 0.005
       or v_application.original_currency <> v_currency
       or v_application.base_currency <> v_base
       or abs(v_application.exchange_rate_to_base - v_rate) > 0.0000000001
       or v_application.dedupe_key <> v_dedupe then
      raise exception 'KIPU_DEDUPE_MISMATCH: debt proceeds replay changed its economics'
        using errcode = '22023';
    end if;
    return coalesce(v_step.result,'{}'::jsonb)
      || jsonb_build_object('outcome','replayed');
  end if;
  if v_step.status <> 'preflighted' then
    raise exception 'KIPU_VALIDATION: debt proceeds step was not preflighted'
      using errcode = '22023';
  end if;

  select upper(a.currency) into v_account_currency from public.accounts a
   where a.id = v_account and a.user_id = v_user and a.status = 'active'
   for no key update;
  select upper(d.currency) into v_debt_currency from public.debt_accounts d
   where d.id = v_debt and d.user_id = v_user and d.type <> 'credit_card'
   for no key update;
  select upper(base_currency) into v_profile_base from public.profiles
   where id = v_user for no key update;
  if v_account_currency is null or v_debt_currency is null or v_profile_base is null then
    raise exception 'KIPU_OWNERSHIP: account, liability or profile not owned'
      using errcode = '42501';
  end if;
  if v_account_currency <> v_currency or v_debt_currency <> v_currency
     or v_profile_base <> v_base then
    raise exception 'KIPU_VALIDATION: debt proceeds currencies contradict account, liability or profile'
      using errcode = '22023';
  end if;
  update public.agent_operation_steps set status = 'applying'
   where id = v_step.id;
  v_fingerprint := md5(jsonb_build_object(
    'user_id',v_user,'operation_id',v_operation,'step_key',v_step_key,
    'account_id',v_account,'debt_account_id',v_debt,'amount',v_amount,
    'original_currency',v_currency,'base_amount',v_base_amount,
    'base_currency',v_base,'exchange_rate_to_base',v_rate,
    'dedupe_key',v_dedupe
  )::text);
  v_transaction := public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id',v_user,'type','adjustment','effect_type','adjustment','sign',1,
    'description',coalesce(nullif(p->>'description',''),'Fondos prestados recibidos'),
    'category','other','original_amount',v_amount,'original_currency',v_currency,
    'exchange_rate_to_base',v_rate,'base_amount',v_base_amount,
    'base_currency',v_base,'destination_account_id',v_account,
    'raw_input',coalesce(p->>'raw_input',''),'input_channel',coalesce(p->>'input_channel','chat'),
    'occurred_at',nullif(p->>'occurred_at','')::timestamptz,
    'external_ref','debt_proceeds:' || v_operation::text || ':' || v_step_key,
    'dedupe_key',v_dedupe
  ));
  update public.debt_accounts
     set current_balance_original = current_balance_original + v_amount,
         current_balance_base = current_balance_base + v_base_amount
   where id = v_debt and user_id = v_user;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'KIPU_EFFECT_MISSING: debt proceeds liability leg'
      using errcode = '22023';
  end if;
  insert into public.debt_proceeds_applications(
    user_id,operation_id,step_key,transaction_id,account_id,debt_account_id,
    amount,base_amount,original_currency,base_currency,
    exchange_rate_to_base,dedupe_key,payload_fingerprint
  ) values (
    v_user,v_operation,v_step_key,v_transaction,v_account,v_debt,
    v_amount,v_base_amount,v_currency,v_base,v_rate,v_dedupe,v_fingerprint
  );
  update public.agent_operation_steps
     set status = 'applied', applied_at = now(),
         affected_refs = jsonb_build_array(
           jsonb_build_object('type','transaction','id',v_transaction),
           jsonb_build_object('type','account','id',v_account),
           jsonb_build_object('type','debt_account','id',v_debt)
         ),
         result = jsonb_build_object(
           'outcome','applied','transaction_id',v_transaction,
           'account_id',v_account,'debt_account_id',v_debt,
           'amount',v_amount,'currency',v_currency,
           'tool_status','done','execution_effect','write'
         )
   where id = v_step.id;
  return jsonb_build_object(
    'outcome','applied','transaction_id',v_transaction,
    'account_id',v_account,'debt_account_id',v_debt,
    'amount',v_amount,'currency',v_currency
  );
end;
$$;

-- A repayment has two legs just like debt proceeds, in the opposite ownership
-- direction. Generic reversal may not restore only cash while leaving the
-- receivable reduced.
create or replace function public.kipu__guard_receivable_repayment_reversal()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.type = 'reversal'
     and new.related_transaction_id is not null
     and exists (
       select 1 from public.receivable_repayment_applications a
        where a.transaction_id = new.related_transaction_id
     )
     and current_setting('kipu.sanctioned_receivable_repayment_reversal', true)
         is distinct from '1' then
    raise exception 'KIPU_VALIDATION: receivable repayment requires its two-leg reversal writer'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_receivable_repayment_reversal_guard
  on public.transactions;
create trigger transactions_receivable_repayment_reversal_guard
before insert on public.transactions
for each row execute function public.kipu__guard_receivable_repayment_reversal();

create or replace function public.kipu_reverse_receivable_repayment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_original uuid := nullif(p->>'transaction_id','')::uuid;
  v_application public.receivable_repayment_applications%rowtype;
  v_account_status text;
  v_alloc jsonb;
  v_receivable public.receivables%rowtype;
  v_id uuid;
  v_amount numeric;
  v_reversal uuid;
  v_locked integer;
begin
  if v_user is null or v_original is null then
    raise exception 'KIPU_VALIDATION: user_id and transaction_id required'
      using errcode = '22023';
  end if;
  select * into v_application
    from public.receivable_repayment_applications
   where user_id = v_user and transaction_id = v_original
   for update;
  if not found then
    return jsonb_build_object('outcome','not_receivable_repayment');
  end if;
  if v_application.reversed_at is not null then
    return jsonb_build_object(
      'outcome','already_reversed_receivable_repayment',
      'reversal_transaction_ids',jsonb_build_array(v_application.reversal_transaction_id)
    );
  end if;
  select a.status into v_account_status
    from public.transactions t
    join public.accounts a on a.id = t.destination_account_id
   where t.id = v_original and t.user_id = v_user and a.user_id = v_user
   for update of a;
  if v_account_status is null then
    raise exception 'KIPU_OWNERSHIP: repayment destination account vanished'
      using errcode = '42501';
  end if;
  if v_account_status <> 'active' then
    return jsonb_build_object(
      'outcome','closed_account_operation_requires_reopen'
    );
  end if;

  -- Lock every receivable in deterministic id order before validating any
  -- inverse amount. A later repayment may have reduced it further; adding this
  -- operation's own allocation remains correct, but exceeding original_amount
  -- or reviving a written-off row requires human review.
  perform 1
    from public.receivables r
   where r.user_id = v_user
     and r.id in (
       select nullif(a->>'receivable_id','')::uuid
         from jsonb_array_elements(v_application.allocations) a
     )
   order by r.id
   for update;
  get diagnostics v_locked = row_count;
  if v_locked <> jsonb_array_length(v_application.allocations) then
    raise exception 'KIPU_CONFLICT: repayment receivable set changed'
      using errcode = '22023';
  end if;
  for v_alloc in select * from jsonb_array_elements(v_application.allocations)
  loop
    v_id := nullif(v_alloc->>'receivable_id','')::uuid;
    v_amount := round(nullif(v_alloc->>'amount','')::numeric,2);
    select * into v_receivable from public.receivables
     where id = v_id and user_id = v_user;
    if v_receivable.status = 'written_off'
       or v_receivable.outstanding_amount + v_amount
            > v_receivable.original_amount + 0.005 then
      raise exception 'KIPU_NEEDS_INFO: later receivable changes require review before undo'
        using errcode = '22023';
    end if;
  end loop;

  perform set_config('kipu.sanctioned_receivable_repayment_reversal','1',true);
  v_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id',v_user,'type','reversal','sign',-1,
    'related_transaction_id',v_original,
    'raw_input',p->>'raw_input',
    'input_channel',coalesce(nullif(p->>'input_channel',''),'chat'),
    'occurred_at',coalesce(nullif(p->>'occurred_at','')::timestamptz,now())
  ));
  if v_reversal is null then
    raise exception 'KIPU_CONFLICT: receivable repayment reversal returned no transaction'
      using errcode = '22023';
  end if;
  for v_alloc in select * from jsonb_array_elements(v_application.allocations)
  loop
    v_id := nullif(v_alloc->>'receivable_id','')::uuid;
    v_amount := round(nullif(v_alloc->>'amount','')::numeric,2);
    update public.receivables
       set outstanding_amount = round(outstanding_amount + v_amount,2),
           status = case
             when outstanding_amount + v_amount >= original_amount - 0.005
               then 'open'
             else 'partial'
           end
     where id = v_id and user_id = v_user;
  end loop;
  update public.receivable_repayment_applications
     set reversal_transaction_id = v_reversal, reversed_at = now()
   where id = v_application.id;
  return jsonb_build_object(
    'outcome','reversed_receivable_repayment',
    'reversal_transaction_ids',jsonb_build_array(v_reversal)
  );
end;
$$;

-- A debt-proceeds row has two financial legs: cash in the account and the
-- user's liability. The generic reversal only knows the ledger row. Refuse
-- that half-undo at the ledger boundary unless the domain writer below has
-- locked and sanctioned the complete reversal in this same transaction.
create or replace function public.kipu__guard_debt_proceeds_reversal()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.type = 'reversal'
     and new.related_transaction_id is not null
     and exists (
       select 1 from public.debt_proceeds_applications a
        where a.transaction_id = new.related_transaction_id
     )
     and current_setting('kipu.sanctioned_debt_proceeds_reversal', true)
         is distinct from '1' then
    raise exception 'KIPU_VALIDATION: debt proceeds require their two-leg reversal writer'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_debt_proceeds_reversal_guard
  on public.transactions;
create trigger transactions_debt_proceeds_reversal_guard
before insert on public.transactions
for each row execute function public.kipu__guard_debt_proceeds_reversal();

create or replace function public.kipu_reverse_debt_proceeds(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_original uuid := nullif(p->>'transaction_id','')::uuid;
  v_application public.debt_proceeds_applications%rowtype;
  v_account_status text;
  v_debt_status text;
  v_debt_original numeric;
  v_debt_base numeric;
  v_reversal uuid;
  v_rows integer;
begin
  if v_user is null or v_original is null then
    raise exception 'KIPU_VALIDATION: user_id and transaction_id required'
      using errcode = '22023';
  end if;
  select * into v_application
    from public.debt_proceeds_applications
   where user_id = v_user and transaction_id = v_original
   for update;
  if not found then
    return jsonb_build_object('outcome','not_debt_proceeds');
  end if;
  if v_application.reversed_at is not null then
    return jsonb_build_object(
      'outcome','already_reversed_debt_proceeds',
      'reversal_transaction_ids',
        jsonb_build_array(v_application.reversal_transaction_id),
      'restored_due',0,
      'debt_account_id',v_application.debt_account_id
    );
  end if;

  select status into v_account_status
    from public.accounts
   where id = v_application.account_id and user_id = v_user
   for update;
  select status, current_balance_original, current_balance_base
    into v_debt_status, v_debt_original, v_debt_base
    from public.debt_accounts
   where id = v_application.debt_account_id and user_id = v_user
   for update;
  if v_account_status is null or v_debt_status is null then
    raise exception 'KIPU_OWNERSHIP: debt proceeds account or liability vanished'
      using errcode = '42501';
  end if;
  if v_account_status <> 'active' or v_debt_status <> 'active' then
    raise exception 'KIPU_NEEDS_INFO: reopen the affected account or liability before undo'
      using errcode = '22023';
  end if;
  -- If later repayments have already consumed this liability, subtracting the
  -- original proceeds would manufacture a credit. The user must first review
  -- those dependent facts; fail closed without moving either leg.
  if v_debt_original + 0.005 < v_application.amount
     or v_debt_base + 0.005 < v_application.base_amount then
    raise exception 'KIPU_NEEDS_INFO: later repayments depend on these borrowed funds; review them before undo'
      using errcode = '22023';
  end if;

  perform set_config('kipu.sanctioned_debt_proceeds_reversal','1',true);
  v_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id',v_user,'type','reversal','sign',-1,
    'related_transaction_id',v_original,
    'raw_input',p->>'raw_input',
    'input_channel',coalesce(nullif(p->>'input_channel',''),'chat'),
    'occurred_at',coalesce(nullif(p->>'occurred_at','')::timestamptz,now())
  ));
  if v_reversal is null then
    raise exception 'KIPU_CONFLICT: debt proceeds reversal returned no transaction'
      using errcode = '22023';
  end if;
  update public.debt_accounts
     set current_balance_original = current_balance_original - v_application.amount,
         current_balance_base = current_balance_base - v_application.base_amount
   where id = v_application.debt_account_id and user_id = v_user;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'KIPU_EFFECT_MISSING: debt proceeds liability reversal'
      using errcode = '22023';
  end if;
  update public.debt_proceeds_applications
     set reversal_transaction_id = v_reversal, reversed_at = now()
   where id = v_application.id;
  return jsonb_build_object(
    'outcome','reversed_debt_proceeds',
    'reversal_transaction_ids',jsonb_build_array(v_reversal),
    'restored_due',0,
    'debt_account_id',v_application.debt_account_id
  );
end;
$$;

-- Versioned universal reversal: new domain-owned financial shapes dispatch
-- before the legacy universal writer. This is one boundary, not a new chat
-- route, and it remains append-only/idempotent.
create or replace function public.kipu_reverse_financial_operation_v3(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  v_result := public.kipu_reverse_receivable_repayment(p);
  if v_result->>'outcome' <> 'not_receivable_repayment' then
    return v_result;
  end if;
  v_result := public.kipu_reverse_debt_proceeds(p);
  if v_result->>'outcome' <> 'not_debt_proceeds' then
    return v_result;
  end if;
  return public.kipu_reverse_financial_operation(p);
end;
$$;

create or replace function public.kipu_reverse_financial_operations_v3(p jsonb)
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
     or jsonb_array_length(p->'transaction_ids') > 360 then
    raise exception 'KIPU_VALIDATION: user_id and 1..360 transaction_ids required'
      using errcode = '22023';
  end if;
  select array_agg(value::uuid order by ordinal)
    into v_ids
    from jsonb_array_elements_text(p->'transaction_ids')
         with ordinality as x(value, ordinal);
  if cardinality(v_ids) <> (select count(distinct item) from unnest(v_ids) item) then
    raise exception 'KIPU_VALIDATION: duplicate transaction_ids'
      using errcode = '22023';
  end if;
  foreach v_id in array v_ids loop
    v_result := public.kipu_reverse_financial_operation_v3(jsonb_build_object(
      'user_id',v_user,'transaction_id',v_id,
      'raw_input',p->>'raw_input',
      'input_channel',coalesce(nullif(p->>'input_channel',''),'chat'),
      'occurred_at',coalesce(nullif(p->>'occurred_at','')::timestamptz,now())
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
      'reversed','already_reversed',
      'reversed_account_close','already_reversed_account_close',
      'reversed_installment_purchase','already_reversed_installment_purchase',
      'reversed_receivable_repayment','already_reversed_receivable_repayment',
      'reversed_debt_proceeds','already_reversed_debt_proceeds'
    ) then
      raise exception 'KIPU_CONFLICT: unclassified reversal outcome %', v_result->>'outcome'
        using errcode = '22023';
    end if;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;
  return jsonb_build_object('outcome','applied','results',v_results);
end;
$$;

-- Correct/undo conversational work by its durable operation identity, never by
-- "the last few rows". Every money-writing step must expose its transaction
-- refs; otherwise the whole correction refuses before reversing one piece.
create or replace function public.kipu_reverse_agent_operation(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_current uuid := nullif(p->>'reversal_operation_id','')::uuid;
  v_target uuid := nullif(p->>'target_operation_id','')::uuid;
  v_step_key text := nullif(btrim(p->>'step_key'),'');
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_current_op public.agent_operations%rowtype;
  v_target_op public.agent_operations%rowtype;
  v_step public.agent_operation_steps%rowtype;
  v_marker public.agent_operation_reversals%rowtype;
  v_write_count integer;
  v_unlinked_count integer;
  v_target_is_correction boolean := false;
  v_transaction_ids uuid[];
  v_result jsonb;
  v_refs jsonb := '[]'::jsonb;
  v_fingerprint text;
  v_row jsonb;
  v_id text;
begin
  if v_user is null or v_current is null or v_target is null
     or v_step_key is null or v_lease is null or v_current = v_target then
    raise exception 'KIPU_VALIDATION: complete and distinct reversal identities required'
      using errcode = '22023';
  end if;
  -- One deterministic lock order for a correction and its target.
  perform 1 from public.agent_operations o
   where o.user_id = v_user and o.id in (v_current,v_target)
   order by o.id for update;
  select * into v_current_op from public.agent_operations
   where id = v_current and user_id = v_user;
  select * into v_target_op from public.agent_operations
   where id = v_target and user_id = v_user;
  if v_current_op.id is null or v_target_op.id is null then
    raise exception 'KIPU_OWNERSHIP: current or target operation not owned'
      using errcode = '42501';
  end if;
  if v_current_op.status <> 'applying' or v_current_op.lease_token <> v_lease
     or v_current_op.lease_expires_at <= now() then
    raise exception 'KIPU_CONFLICT: reversal operation is not under its live lease'
      using errcode = '22023';
  end if;
  if v_target_op.status <> 'completed' then
    raise exception 'KIPU_VALIDATION: only a completed operation can be undone'
      using errcode = '22023';
  end if;
  select * into v_step from public.agent_operation_steps
   where operation_id = v_current and user_id = v_user
     and plan_version = v_current_op.plan_version and step_key = v_step_key
   for update;
  if not found or v_step.capability <> 'undo_agent_operation'
     or nullif(v_step.arguments->>'targetOperationId','')::uuid <> v_target then
    raise exception 'KIPU_VALIDATION: reversal target contradicts the persisted plan'
      using errcode = '22023';
  end if;
  if v_step.status in ('applied','verified') then
    select * into v_marker from public.agent_operation_reversals
     where user_id = v_user and reversal_operation_id = v_current
       and reversal_step_key = v_step_key;
    if not found or v_marker.target_operation_id <> v_target then
      raise exception 'KIPU_DEDUPE_MISMATCH: operation reversal replay changed target'
        using errcode = '22023';
    end if;
    return v_marker.result || jsonb_build_object('outcome','replayed');
  end if;
  if v_step.status <> 'preflighted' then
    raise exception 'KIPU_VALIDATION: operation reversal step was not preflighted'
      using errcode = '22023';
  end if;

  -- A correction operation owns its replacement facts, not the reversal rows
  -- that merely retire the previous version.  Treating those reversal rows as
  -- new forward facts makes the next correction attempt a forbidden
  -- reversal-of-reversal.  A correction may therefore be corrected again, but
  -- it may not be undone on its own: without a replacement, "undo the
  -- correction" is economically ambiguous (restore the old assertion or
  -- remove the fact altogether).  Refuse that ambiguity before moving money.
  select exists (
    select 1
      from public.agent_operation_steps prior_reversal
     where prior_reversal.operation_id = v_target
       and prior_reversal.status = 'verified'
       and prior_reversal.capability = 'undo_agent_operation'
       and prior_reversal.result->>'execution_effect' = 'write'
  ) into v_target_is_correction;
  if v_target_is_correction and (
    v_step.atomic_group is null
    or not exists (
      select 1
        from public.agent_operation_steps replacement
       where replacement.operation_id = v_current
         and replacement.plan_version = v_current_op.plan_version
         and replacement.atomic_group = v_step.atomic_group
         and replacement.step_order > v_step.step_order
         and replacement.capability = 'log_movement'
         and replacement.status = 'preflighted'
    )
  ) then
    raise exception 'KIPU_NEEDS_INFO: correcting a prior correction requires the complete replacement facts in the same atomic group'
      using errcode = '22023';
  end if;

  select count(*) filter (where s.result->>'execution_effect' = 'write'),
         count(*) filter (
           where s.result->>'execution_effect' = 'write'
             and not exists (
               select 1 from jsonb_array_elements(coalesce(s.affected_refs,'[]'::jsonb)) r
                where r->>'type' = 'transaction'
                  and nullif(r->>'id','') is not null
             )
         )
    into v_write_count,v_unlinked_count
   from public.agent_operation_steps s
   where s.operation_id = v_target
     and s.status = 'verified'
     and (not v_target_is_correction or s.capability <> 'undo_agent_operation');
  if v_write_count < 1 then
    raise exception 'KIPU_VALIDATION: target operation has no reversible money writes'
      using errcode = '22023';
  end if;
  if v_unlinked_count <> 0 then
    raise exception 'KIPU_NEEDS_INFO: target operation contains a write without a reversible transaction receipt'
      using errcode = '22023';
  end if;
  select array_agg(distinct (r->>'id')::uuid order by (r->>'id')::uuid)
    into v_transaction_ids
    from public.agent_operation_steps s,
         lateral jsonb_array_elements(coalesce(s.affected_refs,'[]'::jsonb)) r
   where s.operation_id = v_target
     and s.status = 'verified' and s.result->>'execution_effect' = 'write'
     and (not v_target_is_correction or s.capability <> 'undo_agent_operation')
     and r->>'type' = 'transaction' and nullif(r->>'id','') is not null;
  if cardinality(v_transaction_ids) < 1 or cardinality(v_transaction_ids) > 360 then
    raise exception 'KIPU_VALIDATION: operation undo supports 1..360 transaction receipts'
      using errcode = '22023';
  end if;

  v_result := public.kipu_reverse_financial_operations_v3(jsonb_build_object(
    'user_id',v_user,'transaction_ids',to_jsonb(v_transaction_ids),
    'raw_input',coalesce(p->>'raw_input',''),
    'input_channel',coalesce(nullif(p->>'input_channel',''),'chat'),
    'occurred_at',coalesce(nullif(p->>'occurred_at','')::timestamptz,now())
  ));
  for v_row in select value from jsonb_array_elements(coalesce(v_result->'results','[]'::jsonb))
  loop
    for v_id in select value from jsonb_array_elements_text(
      coalesce(v_row->'reversal_transaction_ids','[]'::jsonb)
    )
    loop
      v_refs := v_refs || jsonb_build_array(
        jsonb_build_object('type','transaction','id',v_id)
      );
    end loop;
  end loop;
  v_fingerprint := md5(jsonb_build_object(
    'user_id',v_user,'target_operation_id',v_target,
    'reversal_operation_id',v_current,'step_key',v_step_key,
    'transaction_ids',to_jsonb(v_transaction_ids)
  )::text);
  v_result := v_result || jsonb_build_object(
    'outcome','reversed_operation','target_operation_id',v_target,
    'affected_refs',v_refs,'tool_status','done','execution_effect','write'
  );
  insert into public.agent_operation_reversals(
    user_id,target_operation_id,reversal_operation_id,reversal_step_key,
    transaction_ids,result,payload_fingerprint
  ) values (
    v_user,v_target,v_current,v_step_key,v_transaction_ids,v_result,v_fingerprint
  );
  update public.agent_operation_steps
     set status = 'applied', applied_at = now(), result = v_result,
         affected_refs = v_refs
   where id = v_step.id;
  return v_result;
end;
$$;

alter function public.kipu_claim_agent_operation(jsonb) owner to postgres;
alter function public.kipu_record_agent_intake_failure(jsonb) owner to postgres;
alter function public.kipu_resolve_agent_intake_failure(jsonb) owner to postgres;
alter function public.kipu_transition_agent_operation(jsonb) owner to postgres;
alter function public.kipu_begin_agent_operation_application(jsonb) owner to postgres;
alter function public.kipu_save_agent_operation_plan(jsonb) owner to postgres;
alter function public.kipu_resume_agent_operation_plan(jsonb) owner to postgres;
alter function public.kipu_expire_agent_operations(uuid) owner to postgres;
alter function public.kipu_record_agent_operation_step_outcome(jsonb) owner to postgres;
alter function public.kipu_verify_agent_operation(jsonb) owner to postgres;
alter function public.kipu_preflight_agent_operation_step(jsonb) owner to postgres;
alter function public.kipu_apply_operation(jsonb) owner to postgres;
alter function public.kipu_apply_repayment_v2(jsonb,jsonb) owner to postgres;
alter function public.kipu_apply_debt_proceeds(jsonb) owner to postgres;
alter function public.kipu__guard_receivable_repayment_reversal() owner to postgres;
alter function public.kipu_reverse_receivable_repayment(jsonb) owner to postgres;
alter function public.kipu__guard_debt_proceeds_reversal() owner to postgres;
alter function public.kipu_reverse_debt_proceeds(jsonb) owner to postgres;
alter function public.kipu_reverse_financial_operation_v3(jsonb) owner to postgres;
alter function public.kipu_reverse_financial_operations_v3(jsonb) owner to postgres;
alter function public.kipu_reverse_agent_operation(jsonb) owner to postgres;
revoke all on function public.kipu_claim_agent_operation(jsonb),
  public.kipu_record_agent_intake_failure(jsonb),
  public.kipu_resolve_agent_intake_failure(jsonb),
  public.kipu_transition_agent_operation(jsonb),
  public.kipu_begin_agent_operation_application(jsonb),
  public.kipu_save_agent_operation_plan(jsonb),
  public.kipu_resume_agent_operation_plan(jsonb),
  public.kipu_expire_agent_operations(uuid),
  public.kipu_record_agent_operation_step_outcome(jsonb),
  public.kipu_verify_agent_operation(jsonb),
  public.kipu_preflight_agent_operation_step(jsonb),
  public.kipu_apply_operation(jsonb),
  public.kipu_apply_repayment_v2(jsonb,jsonb),
  public.kipu_apply_debt_proceeds(jsonb),
  public.kipu__guard_receivable_repayment_reversal(),
  public.kipu_reverse_receivable_repayment(jsonb),
  public.kipu__guard_debt_proceeds_reversal(),
  public.kipu_reverse_debt_proceeds(jsonb),
  public.kipu_reverse_financial_operation_v3(jsonb),
  public.kipu_reverse_financial_operations_v3(jsonb),
  public.kipu_reverse_agent_operation(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_claim_agent_operation(jsonb),
  public.kipu_record_agent_intake_failure(jsonb),
  public.kipu_resolve_agent_intake_failure(jsonb),
  public.kipu_transition_agent_operation(jsonb),
  public.kipu_begin_agent_operation_application(jsonb),
  public.kipu_save_agent_operation_plan(jsonb),
  public.kipu_resume_agent_operation_plan(jsonb),
  public.kipu_expire_agent_operations(uuid),
  public.kipu_record_agent_operation_step_outcome(jsonb),
  public.kipu_verify_agent_operation(jsonb),
  public.kipu_preflight_agent_operation_step(jsonb),
  public.kipu_apply_operation(jsonb),
  public.kipu_apply_repayment_v2(jsonb,jsonb),
  public.kipu_apply_debt_proceeds(jsonb),
  public.kipu_reverse_financial_operation_v3(jsonb),
  public.kipu_reverse_financial_operations_v3(jsonb),
  public.kipu_reverse_agent_operation(jsonb)
  to service_role;

-- ── 2. Universal durable facts and occurrence satisfaction ────────────────

create table if not exists public.financial_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  fact_kind text not null,
  entity_type text not null,
  entity_id text not null,
  cycle_key text not null,
  source_type text not null,
  source_id text not null,
  provenance text not null,
  payload jsonb not null default '{}'::jsonb,
  payload_fingerprint text not null,
  is_current boolean not null default true,
  supersedes_fact_id uuid references public.financial_facts(id) on delete set null,
  superseded_by_fact_id uuid references public.financial_facts(id) on delete set null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key),
  constraint financial_facts_payload_object_ck check (jsonb_typeof(payload) = 'object'),
  constraint financial_facts_identity_nonempty_ck check (
    btrim(fact_kind) <> '' and btrim(entity_type) <> '' and
    btrim(entity_id) <> '' and btrim(cycle_key) <> '' and
    btrim(source_type) <> '' and btrim(source_id) <> '' and
    btrim(provenance) <> ''
  )
);

create unique index if not exists financial_facts_current_identity_uq
  on public.financial_facts(user_id, fact_kind, entity_type, entity_id, cycle_key)
  where is_current;
create index if not exists financial_facts_user_time_idx
  on public.financial_facts(user_id, observed_at desc, id);

alter table public.financial_facts enable row level security;
alter table public.financial_facts owner to postgres;
drop policy if exists "Users can view own financial facts" on public.financial_facts;
create policy "Users can view own financial facts"
  on public.financial_facts for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.financial_facts from public, anon, authenticated, service_role;
grant select on table public.financial_facts to authenticated, service_role;

alter table public.recurring_occurrences
  add column if not exists satisfaction_kind text,
  add column if not exists satisfaction_entity_type text,
  add column if not exists satisfaction_entity_id text,
  add column if not exists satisfaction_cycle_key text,
  add column if not exists satisfied_fact_id uuid references public.financial_facts(id) on delete set null,
  add column if not exists satisfied_at timestamptz;

alter table public.recurring_occurrences
  drop constraint if exists recurring_occurrences_satisfaction_identity_ck;
alter table public.recurring_occurrences
  add constraint recurring_occurrences_satisfaction_identity_ck check (
    (satisfaction_kind is null and satisfaction_entity_type is null
      and satisfaction_entity_id is null and satisfaction_cycle_key is null)
    or
    (nullif(btrim(satisfaction_kind),'') is not null
      and nullif(btrim(satisfaction_entity_type),'') is not null
      and nullif(btrim(satisfaction_entity_id),'') is not null
      and nullif(btrim(satisfaction_cycle_key),'') is not null)
  );
alter table public.recurring_occurrences
  drop constraint if exists recurring_occurrences_satisfied_pair_ck;
alter table public.recurring_occurrences
  add constraint recurring_occurrences_satisfied_pair_ck check (
    (satisfied_fact_id is null) = (satisfied_at is null)
  );

create index if not exists recurring_occurrences_unsatisfied_identity_idx
  on public.recurring_occurrences(
    user_id, satisfaction_kind, satisfaction_entity_type,
    satisfaction_entity_id, satisfaction_cycle_key
  ) where satisfied_fact_id is null;

create table if not exists public.recurring_occurrence_satisfactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_id uuid not null unique references public.recurring_occurrences(id) on delete cascade,
  fact_id uuid not null references public.financial_facts(id) on delete restrict,
  satisfaction_key text not null,
  satisfied_at timestamptz not null default now(),
  unique (user_id, satisfaction_key)
);
alter table public.recurring_occurrence_satisfactions enable row level security;
alter table public.recurring_occurrence_satisfactions owner to postgres;
drop policy if exists "Users can view own occurrence satisfactions"
  on public.recurring_occurrence_satisfactions;
create policy "Users can view own occurrence satisfactions"
  on public.recurring_occurrence_satisfactions for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.recurring_occurrence_satisfactions
  from public, anon, authenticated, service_role;
grant select on table public.recurring_occurrence_satisfactions
  to authenticated, service_role;

create or replace function public.kipu__occurrence_cycle_key(
  p_kind text, p_occurrence_date date
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_kind = 'card_statement' then to_char(p_occurrence_date, 'YYYY-MM')
    else p_occurrence_date::text
  end
$$;

create or replace function public.kipu__derive_occurrence_satisfaction_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_fact uuid;
declare v_identity_lock bigint;
begin
  new.satisfaction_kind := new.kind;
  if new.income_source_id is not null then
    new.satisfaction_entity_type := 'income_source';
    new.satisfaction_entity_id := new.income_source_id::text;
  elsif new.fixed_expense_id is not null then
    new.satisfaction_entity_type := 'fixed_expense';
    new.satisfaction_entity_id := new.fixed_expense_id::text;
  elsif new.debt_account_id is not null then
    new.satisfaction_entity_type := 'debt_account';
    new.satisfaction_entity_id := new.debt_account_id::text;
  elsif new.savings_plan_id is not null then
    new.satisfaction_entity_type := 'savings_plan';
    new.satisfaction_entity_id := new.savings_plan_id::text;
  elsif new.scheduled_payment_id is not null then
    new.satisfaction_entity_type := 'scheduled_payment';
    new.satisfaction_entity_id := new.scheduled_payment_id::text;
  else
    new.satisfaction_entity_type := 'commitment';
    new.satisfaction_entity_id := new.commitment_kind;
  end if;
  new.satisfaction_cycle_key := public.kipu__occurrence_cycle_key(
    new.kind, new.occurrence_date
  );

  -- The fact writer takes this same identity lock before inserting and then
  -- satisfying occurrences. Taking it on the inverse occurrence-first path
  -- prevents both transactions from reading "absent" before either publishes
  -- its row. The lock is transaction-scoped and re-entrant when a fact writer
  -- updates an occurrence inside its own transaction.
  v_identity_lock := hashtextextended(
    new.user_id::text || ':' || new.satisfaction_kind || ':' ||
    new.satisfaction_entity_type || ':' || new.satisfaction_entity_id || ':' ||
    new.satisfaction_cycle_key, 0
  );
  -- INSERT has not locked a durable occurrence row yet, so it can wait for the
  -- fact writer safely. An UPDATE reaches a BEFORE ROW trigger while holding
  -- the occurrence row that the fact writer will update after taking this
  -- advisory lock. Waiting there would create the cycle row -> advisory versus
  -- advisory -> row. Use a genuine serialization failure instead: PostgREST may
  -- retry it after the fact transaction commits, and no stale identity lands.
  if tg_op = 'UPDATE' then
    if not pg_try_advisory_xact_lock(v_identity_lock) then
      raise exception 'KIPU_CONFLICT: occurrence identity changed while its fact was being recorded'
        using errcode = '40001';
    end if;
  else
    perform pg_advisory_xact_lock(v_identity_lock);
  end if;

  -- Undo/retraction is a first-class state change. A fact emitted by this same
  -- occurrence while it was terminal must not keep an observed/pending/booked
  -- row invisible forever after the domain writer reopens it. The AFTER fact
  -- publisher retires the source fact in this transaction; clearing the live
  -- link here prevents the BEFORE trigger from immediately reattaching it.
  if tg_op = 'UPDATE'
     and old.status in ('confirmed','corrected','skipped','dismissed')
     and new.status not in ('confirmed','corrected','skipped','dismissed') then
    new.satisfied_fact_id := null;
    new.satisfied_at := null;
    return new;
  end if;

  select f.id into v_fact
    from public.financial_facts f
   where f.user_id = new.user_id
     and f.fact_kind = new.satisfaction_kind
     and f.entity_type = new.satisfaction_entity_type
     and f.entity_id = new.satisfaction_entity_id
     and f.cycle_key = new.satisfaction_cycle_key
     and f.is_current
   order by f.observed_at desc, f.id desc
   limit 1;
  new.satisfied_fact_id := v_fact;
  new.satisfied_at := case when v_fact is null then null else coalesce(new.satisfied_at, now()) end;
  return new;
end;
$$;

drop trigger if exists recurring_occurrences_01_satisfaction_identity
  on public.recurring_occurrences;
create trigger recurring_occurrences_01_satisfaction_identity
before insert or update of status, kind, occurrence_date, income_source_id,
  fixed_expense_id, debt_account_id, savings_plan_id,
  scheduled_payment_id, commitment_kind, satisfied_fact_id
on public.recurring_occurrences
for each row execute function public.kipu__derive_occurrence_satisfaction_identity();

-- `satisfied_fact_id` is the live guard used by the notifier, while this row is
-- the durable audit link. The fact writer creates both when the occurrence
-- already exists. The inverse order (fact first, occurrence later) used to set
-- only the column in the BEFORE trigger and silently omit the audit row. Keep
-- both representations symmetric for every insert, relink and identity change.
create or replace function public.kipu__persist_occurrence_satisfaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.satisfied_fact_id is null then
    delete from public.recurring_occurrence_satisfactions
     where occurrence_id = new.id and user_id = new.user_id;
    return new;
  end if;
  if not exists (
    select 1 from public.financial_facts f
     where f.id = new.satisfied_fact_id and f.user_id = new.user_id
       and f.fact_kind = new.satisfaction_kind
       and f.entity_type = new.satisfaction_entity_type
       and f.entity_id = new.satisfaction_entity_id
       and f.cycle_key = new.satisfaction_cycle_key
  ) then
    raise exception 'KIPU_VALIDATION: occurrence satisfaction fact contradicts its identity'
      using errcode = '22023';
  end if;
  insert into public.recurring_occurrence_satisfactions(
    user_id, occurrence_id, fact_id, satisfaction_key, satisfied_at
  ) values (
    new.user_id,new.id,new.satisfied_fact_id,
    concat_ws(':',new.satisfaction_kind,new.satisfaction_entity_type,
      new.satisfaction_entity_id,new.satisfaction_cycle_key,new.id::text),
    coalesce(new.satisfied_at,now())
  )
  on conflict (occurrence_id) do update
    set fact_id = excluded.fact_id,
        satisfaction_key = excluded.satisfaction_key,
        satisfied_at = excluded.satisfied_at;
  return new;
end;
$$;

drop trigger if exists recurring_occurrences_02_persist_satisfaction
  on public.recurring_occurrences;
create trigger recurring_occurrences_02_persist_satisfaction
after insert or update of satisfied_fact_id, kind, occurrence_date,
  income_source_id, fixed_expense_id, debt_account_id, savings_plan_id,
  scheduled_payment_id, commitment_kind
on public.recurring_occurrences
for each row execute function public.kipu__persist_occurrence_satisfaction();

create or replace function public.kipu__assert_financial_fact_entity(
  p_user uuid, p_type text, p_id text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_type = 'income_source' then
    if not exists (select 1 from public.income_sources where id = p_id::uuid and user_id = p_user) then raise exception 'KIPU_OWNERSHIP: income source not owned' using errcode='42501'; end if;
  elsif p_type = 'fixed_expense' then
    if not exists (select 1 from public.fixed_expenses where id = p_id::uuid and user_id = p_user) then raise exception 'KIPU_OWNERSHIP: fixed expense not owned' using errcode='42501'; end if;
  elsif p_type = 'debt_account' then
    if not exists (select 1 from public.debt_accounts where id = p_id::uuid and user_id = p_user) then raise exception 'KIPU_OWNERSHIP: debt account not owned' using errcode='42501'; end if;
  elsif p_type = 'savings_plan' then
    if not exists (select 1 from public.savings_plans where id = p_id::uuid and user_id = p_user) then raise exception 'KIPU_OWNERSHIP: savings plan not owned' using errcode='42501'; end if;
  elsif p_type = 'scheduled_payment' then
    if not exists (select 1 from public.scheduled_payments where id = p_id::uuid and user_id = p_user) then raise exception 'KIPU_OWNERSHIP: scheduled payment not owned' using errcode='42501'; end if;
  elsif p_type = 'commitment' then
    if p_id not in ('savings','investment') then raise exception 'KIPU_VALIDATION: invalid commitment identity' using errcode='22023'; end if;
  else
    raise exception 'KIPU_VALIDATION: unsupported fact entity type' using errcode='22023';
  end if;
end;
$$;

create or replace function public.kipu_record_financial_fact(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_dedupe text := nullif(btrim(p->>'dedupe_key'),'');
  v_kind text := nullif(btrim(p->>'fact_kind'),'');
  v_type text := nullif(btrim(p->>'entity_type'),'');
  v_entity text := nullif(btrim(p->>'entity_id'),'');
  v_cycle text := nullif(btrim(p->>'cycle_key'),'');
  v_source_type text := nullif(btrim(p->>'source_type'),'');
  v_source text := nullif(btrim(p->>'source_id'),'');
  v_provenance text := nullif(btrim(p->>'provenance'),'');
  v_payload jsonb := coalesce(p->'payload','{}'::jsonb);
  v_observed timestamptz := coalesce(nullif(p->>'observed_at','')::timestamptz, now());
  v_fingerprint text;
  v_existing public.financial_facts%rowtype;
  v_prior public.financial_facts%rowtype;
  v_fact uuid;
  v_satisfied integer := 0;
begin
  if v_user is null or v_dedupe is null or v_kind is null or v_type is null
     or v_entity is null or v_cycle is null or v_source_type is null
     or v_source is null or v_provenance is null then
    raise exception 'KIPU_VALIDATION: complete fact identity and provenance are required'
      using errcode = '22023';
  end if;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'KIPU_VALIDATION: fact payload must be an object'
      using errcode = '22023';
  end if;
  perform public.kipu__assert_financial_fact_entity(v_user, v_type, v_entity);

  if v_source_type = 'recurring_occurrence' then
    if not exists (
      select 1 from public.recurring_occurrences o
       where o.id = v_source::uuid and o.user_id = v_user
         and o.satisfaction_kind = v_kind
         and o.satisfaction_entity_type = v_type
         and o.satisfaction_entity_id = v_entity
         and o.satisfaction_cycle_key = v_cycle
         and o.status in ('confirmed','corrected','skipped','dismissed')
    ) then
      raise exception 'KIPU_VALIDATION: occurrence source does not prove this fact identity'
        using errcode='22023';
    end if;
  elsif v_source_type = 'debt_statement_cycle' then
    if v_kind <> 'card_statement' or v_type <> 'debt_account'
       or not exists (
         select 1 from public.debt_statement_cycles s
          where s.id = v_source::uuid and s.user_id = v_user
            and s.debt_account_id::text = v_entity
            and s.applied and s.is_current and s.statement_date is not null
            and to_char(s.statement_date,'YYYY-MM') = v_cycle
       ) then
      raise exception 'KIPU_VALIDATION: statement source does not prove this fact identity'
        using errcode='22023';
    end if;
  else
    raise exception 'KIPU_VALIDATION: unsupported fact source type' using errcode='22023';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'fact_kind',v_kind,'entity_type',v_type,'entity_id',v_entity,
    'cycle_key',v_cycle,'source_type',v_source_type,'source_id',v_source,
    'provenance',v_provenance,'payload',v_payload
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(
    v_user::text || ':' || v_kind || ':' || v_type || ':' || v_entity || ':' || v_cycle, 0
  ));

  select * into v_existing from public.financial_facts
   where user_id = v_user and dedupe_key = v_dedupe for update;
  if found then
    if v_existing.payload_fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: fact key reused for different evidence'
        using errcode = '22023';
    end if;
    -- A terminal occurrence can be reopened and later resolved again with the
    -- exact same evidence. The reopen deliberately retires its resolution fact;
    -- treating the later resolution as a plain replay would leave the terminal
    -- occurrence without a current fact or durable satisfaction link. Reactivate
    -- the same deduped evidence under the identity lock, superseding whichever
    -- independent fact (for example the bank statement) became current while the
    -- occurrence was open. This is not a second fact or a second money write.
    if not v_existing.is_current then
      select * into v_prior from public.financial_facts
       where user_id = v_user and fact_kind = v_kind and entity_type = v_type
         and entity_id = v_entity and cycle_key = v_cycle and is_current
       for update;
      if found then
        update public.financial_facts
           set is_current = false, superseded_by_fact_id = v_existing.id
         where id = v_prior.id;
      end if;
      update public.financial_facts
         set is_current = true,
             supersedes_fact_id = coalesce(v_prior.id, supersedes_fact_id),
             superseded_by_fact_id = null
       where id = v_existing.id;
      update public.recurring_occurrences o
         set satisfied_fact_id = v_existing.id, satisfied_at = now()
       where o.user_id = v_user
         and o.satisfaction_kind = v_kind
         and o.satisfaction_entity_type = v_type
         and o.satisfaction_entity_id = v_entity
         and o.satisfaction_cycle_key = v_cycle;
      get diagnostics v_satisfied = row_count;
      return jsonb_build_object(
        'outcome','reactivated','fact_id',v_existing.id,
        'satisfied_count',v_satisfied,'superseded_fact_id',v_prior.id
      );
    end if;
    return jsonb_build_object(
      'outcome','replayed','fact_id',v_existing.id,'satisfied_count',0
    );
  end if;

  select * into v_prior from public.financial_facts
   where user_id = v_user and fact_kind = v_kind and entity_type = v_type
     and entity_id = v_entity and cycle_key = v_cycle and is_current
   for update;
  if found and v_prior.payload_fingerprint = v_fingerprint then
    return jsonb_build_object(
      'outcome','same_fact','fact_id',v_prior.id,'satisfied_count',0
    );
  end if;
  if found then
    update public.financial_facts set is_current = false where id = v_prior.id;
  end if;

  insert into public.financial_facts(
    user_id,dedupe_key,fact_kind,entity_type,entity_id,cycle_key,
    source_type,source_id,provenance,payload,payload_fingerprint,
    supersedes_fact_id,observed_at
  ) values (
    v_user,v_dedupe,v_kind,v_type,v_entity,v_cycle,
    v_source_type,v_source,v_provenance,v_payload,v_fingerprint,
    v_prior.id,v_observed
  ) returning id into v_fact;
  if v_prior.id is not null then
    update public.financial_facts set superseded_by_fact_id = v_fact where id = v_prior.id;
  end if;

  update public.recurring_occurrences o
     set satisfied_fact_id = v_fact, satisfied_at = now()
   where o.user_id = v_user
     and o.satisfaction_kind = v_kind
     and o.satisfaction_entity_type = v_type
     and o.satisfaction_entity_id = v_entity
     and o.satisfaction_cycle_key = v_cycle;
  get diagnostics v_satisfied = row_count;

  insert into public.recurring_occurrence_satisfactions(
    user_id, occurrence_id, fact_id, satisfaction_key, satisfied_at
  )
  select o.user_id, o.id, v_fact,
         concat_ws(':',v_kind,v_type,v_entity,v_cycle,o.id::text), now()
    from public.recurring_occurrences o
   where o.user_id = v_user and o.satisfied_fact_id = v_fact
  on conflict (occurrence_id) do update
    set fact_id = excluded.fact_id,
        satisfaction_key = excluded.satisfaction_key,
        satisfied_at = excluded.satisfied_at;

  return jsonb_build_object(
    'outcome','recorded','fact_id',v_fact,'satisfied_count',v_satisfied,
    'superseded_fact_id',v_prior.id
  );
end;
$$;

create or replace function public.kipu__publish_terminal_occurrence_fact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_result jsonb;
  v_restored_fact uuid;
begin
  if new.status not in ('confirmed','corrected','skipped','dismissed') then
    if tg_op = 'UPDATE'
       and old.status in ('confirmed','corrected','skipped','dismissed') then
      -- Retire only facts whose evidence was this resolution. A separate bank
      -- statement or other durable source for the same identity remains valid.
      update public.financial_facts f
         set is_current = false
       where f.user_id = new.user_id
         and f.source_type = 'recurring_occurrence'
         and f.source_id = new.id::text
         and f.is_current;

      -- The resolution fact may have superseded an independent statement that
      -- is still current in its own domain. Reopening must not erase that bank
      -- evidence and make the notifier ask again. Restore only a source whose
      -- liveness is still provable; never resurrect an older resolution from
      -- this or another occurrence merely because it appears in the chain.
      select f.id into v_restored_fact
        from public.financial_facts f
        join public.debt_statement_cycles s
          on f.source_type = 'debt_statement_cycle'
         and f.source_id = s.id::text
         and s.user_id = f.user_id
         and s.debt_account_id::text = f.entity_id
         and s.applied and s.is_current and s.statement_date is not null
         and to_char(s.statement_date,'YYYY-MM') = f.cycle_key
       where f.user_id = new.user_id
         and f.fact_kind = new.satisfaction_kind
         and f.entity_type = new.satisfaction_entity_type
         and f.entity_id = new.satisfaction_entity_id
         and f.cycle_key = new.satisfaction_cycle_key
       order by f.observed_at desc, f.id desc
       limit 1;
      if v_restored_fact is not null then
        update public.financial_facts
           set is_current = true, superseded_by_fact_id = null
         where id = v_restored_fact;
      end if;
      update public.recurring_occurrences o
         set satisfied_fact_id = v_restored_fact,
             satisfied_at = case
               when v_restored_fact is null then null
               else now()
             end
       where o.user_id = new.user_id
         and o.satisfaction_kind = new.satisfaction_kind
         and o.satisfaction_entity_type = new.satisfaction_entity_type
         and o.satisfaction_entity_id = new.satisfaction_entity_id
         and o.satisfaction_cycle_key = new.satisfaction_cycle_key;
    end if;
    return new;
  end if;
  v_payload := jsonb_build_object(
    'status',new.status,
    'amount',new.resolved_amount,
    'currency',new.resolved_currency,
    'transaction_id',new.created_transaction_id
  );
  v_result := public.kipu_record_financial_fact(jsonb_build_object(
    'user_id',new.user_id,
    'dedupe_key','occurrence:' || new.id::text || ':' || md5(v_payload::text),
    'fact_kind',new.satisfaction_kind,
    'entity_type',new.satisfaction_entity_type,
    'entity_id',new.satisfaction_entity_id,
    'cycle_key',new.satisfaction_cycle_key,
    'source_type','recurring_occurrence',
    'source_id',new.id,
    'provenance','occurrence_resolution',
    'payload',v_payload,
    'observed_at',coalesce(new.resolved_at,now())
  ));
  return new;
end;
$$;

drop trigger if exists recurring_occurrences_99_publish_fact
  on public.recurring_occurrences;
create trigger recurring_occurrences_99_publish_fact
after insert or update of status, resolved_amount, resolved_currency,
  created_transaction_id, resolved_at
on public.recurring_occurrences
for each row execute function public.kipu__publish_terminal_occurrence_fact();

create or replace function public.kipu__publish_card_statement_fact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_currency text;
declare v_result jsonb;
declare v_payload jsonb;
begin
  if not new.applied or not new.is_current or new.statement_date is null
     or new.full_payment_due is null then
    return new;
  end if;
  select upper(currency) into v_currency
    from public.debt_accounts
   where id = new.debt_account_id and user_id = new.user_id;
  if v_currency is null then
    raise exception 'KIPU_OWNERSHIP: statement card not owned'
      using errcode = '42501';
  end if;
  v_payload := jsonb_build_object(
    'amount',round(new.full_payment_due,2),
    'currency',v_currency,
    'statement_date',new.statement_date,
    'due_day',new.due_day
  );
  v_result := public.kipu_record_financial_fact(jsonb_build_object(
    'user_id',new.user_id,
    'dedupe_key','statement-cycle:' || new.id::text || ':' || md5(v_payload::text),
    'fact_kind','card_statement',
    'entity_type','debt_account',
    'entity_id',new.debt_account_id,
    'cycle_key',to_char(new.statement_date,'YYYY-MM'),
    'source_type','debt_statement_cycle',
    'source_id',new.id,
    'provenance','statement_writer',
    'payload',v_payload,
    'observed_at',new.created_at
  ));
  return new;
end;
$$;

drop trigger if exists debt_statement_cycles_publish_fact
  on public.debt_statement_cycles;
create trigger debt_statement_cycles_publish_fact
after insert or update of applied, is_current, statement_date, full_payment_due,
  due_day
on public.debt_statement_cycles
for each row execute function public.kipu__publish_card_statement_fact();

alter function public.kipu__occurrence_cycle_key(text,date) owner to postgres;
alter function public.kipu__derive_occurrence_satisfaction_identity() owner to postgres;
alter function public.kipu__persist_occurrence_satisfaction() owner to postgres;
alter function public.kipu__assert_financial_fact_entity(uuid,text,text) owner to postgres;
alter function public.kipu_record_financial_fact(jsonb) owner to postgres;
alter function public.kipu__publish_terminal_occurrence_fact() owner to postgres;
alter function public.kipu__publish_card_statement_fact() owner to postgres;

revoke all on function public.kipu__occurrence_cycle_key(text,date),
  public.kipu__derive_occurrence_satisfaction_identity(),
  public.kipu__persist_occurrence_satisfaction(),
  public.kipu__assert_financial_fact_entity(uuid,text,text),
  public.kipu__publish_terminal_occurrence_fact(),
  public.kipu__publish_card_statement_fact()
  from public, anon, authenticated, service_role;
revoke all on function public.kipu_record_financial_fact(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_record_financial_fact(jsonb)
  to service_role;

-- Backfill identities first. The BEFORE trigger also attaches any fact that is
-- already present (none on a clean first apply).
update public.recurring_occurrences
   set occurrence_date = occurrence_date;

-- Existing terminal rows become facts through the same public primitive used
-- at runtime. This preserves all six occurrence kinds without a per-kind loop.
do $$
declare r public.recurring_occurrences%rowtype;
declare v_payload jsonb;
begin
  for r in
    select * from public.recurring_occurrences
     where status in ('confirmed','corrected','skipped','dismissed')
     order by created_at,id
  loop
    v_payload := jsonb_build_object(
      'status',r.status,'amount',r.resolved_amount,
      'currency',r.resolved_currency,'transaction_id',r.created_transaction_id
    );
    perform public.kipu_record_financial_fact(jsonb_build_object(
      'user_id',r.user_id,
      'dedupe_key','occurrence:' || r.id::text || ':' || md5(v_payload::text),
      'fact_kind',r.satisfaction_kind,
      'entity_type',r.satisfaction_entity_type,
      'entity_id',r.satisfaction_entity_id,
      'cycle_key',r.satisfaction_cycle_key,
      'source_type','recurring_occurrence','source_id',r.id,
      'provenance','migration_100_backfill','payload',v_payload,
      'observed_at',coalesce(r.resolved_at,r.updated_at,r.created_at)
    ));
  end loop;
end;
$$;

-- Current statement rows backfill the same data-driven fact used by the live
-- trigger. A statement whose emission date differs from cutoff day still shares
-- the monthly cycle key, which is the Diners case that exposed the old split.
do $$
declare r public.debt_statement_cycles%rowtype;
declare v_currency text;
declare v_payload jsonb;
begin
  for r in
    select * from public.debt_statement_cycles
     where applied and is_current and statement_date is not null
       and full_payment_due is not null
     order by created_at,id
  loop
    select upper(currency) into v_currency from public.debt_accounts
     where id = r.debt_account_id and user_id = r.user_id;
    v_payload := jsonb_build_object(
      'amount',round(r.full_payment_due,2),'currency',v_currency,
      'statement_date',r.statement_date,'due_day',r.due_day
    );
    perform public.kipu_record_financial_fact(jsonb_build_object(
      'user_id',r.user_id,
      'dedupe_key','statement-cycle:' || r.id::text || ':' || md5(v_payload::text),
      'fact_kind','card_statement','entity_type','debt_account',
      'entity_id',r.debt_account_id,'cycle_key',to_char(r.statement_date,'YYYY-MM'),
      'source_type','debt_statement_cycle','source_id',r.id,
      'provenance','migration_100_backfill','payload',v_payload,
      'observed_at',r.created_at
    ));
  end loop;
end;
$$;
