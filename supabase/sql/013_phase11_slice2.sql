-- Kipu — Phase 11 Slice 2: future commitments & receivables.
--
-- ADDITIVE and NON-DESTRUCTIVE. Safe to run against the existing production
-- schema: it only adds one nullable column and two new tables, all guarded
-- with `if not exists` / `drop policy if exists`. It never drops or rewrites
-- existing objects and never touches existing rows.
--
-- Apply manually in the Supabase SQL editor (the project applies SQL files
-- directly; supabase_migrations history is empty). Apply BEFORE deploying the
-- Slice 2 code that reads/writes these objects.
--
-- Adds:
--   1. public.fixed_expenses.start_date  — when a recurring expense BEGINS, so
--      a fixed expense the user will "start paying next month" is not treated
--      as already active by matching/planning.
--   2. public.scheduled_payments         — future one-time (or future-recurring
--      seed) payments the user told Kipu about but has NOT paid yet. No money
--      moves until it is actually paid; this is a plan/reminder, not a ledger
--      entry.
--   3. public.receivables                — money the user lent or is owed (and
--      the reverse), tracked separately from spending so a loan is not counted
--      as ordinary consumption and a repayment is not ordinary income.
--
-- RLS is enabled on the new tables; authenticated users manage only their own
-- rows. service_role is granted so the channel handlers (Telegram webhook /
-- web action) can operate on the user's behalf, consistent with
-- 006_financial_service_role_grants.sql and 012_conversation_memory.sql.

-- =========================
-- 1. Future-starting recurring expenses
-- =========================

alter table public.fixed_expenses
  add column if not exists start_date date;

-- =========================
-- 2. Scheduled (future, not-yet-paid) payments
-- =========================

create table if not exists public.scheduled_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null,
  category public.financial_category not null default 'other',
  amount numeric(14,2),
  currency text not null default 'USD',

  payment_source_type text check (payment_source_type in ('account', 'debt_account')),
  payment_source_id uuid,

  due_date date not null,
  recurring boolean not null default false,

  status text not null default 'scheduled' check (status in (
    'scheduled',
    'done',
    'cancelled',
    'skipped'
  )),

  notes text,
  raw_input text,
  -- When the payment is later actually made, link the resulting movement so
  -- the plan and the ledger stay consistent.
  created_transaction_id uuid references public.transactions(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_payments_user_idx
  on public.scheduled_payments(user_id);
create index if not exists scheduled_payments_due_idx
  on public.scheduled_payments(user_id, status, due_date);

drop trigger if exists set_scheduled_payments_updated_at on public.scheduled_payments;
create trigger set_scheduled_payments_updated_at
before update on public.scheduled_payments
for each row execute function public.set_updated_at();

alter table public.scheduled_payments enable row level security;

drop policy if exists "Users can view own scheduled payments" on public.scheduled_payments;
create policy "Users can view own scheduled payments"
on public.scheduled_payments
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own scheduled payments" on public.scheduled_payments;
create policy "Users can insert own scheduled payments"
on public.scheduled_payments
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own scheduled payments" on public.scheduled_payments;
create policy "Users can update own scheduled payments"
on public.scheduled_payments
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own scheduled payments" on public.scheduled_payments;
create policy "Users can delete own scheduled payments"
on public.scheduled_payments
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on public.scheduled_payments to authenticated;
grant select, insert, update, delete on public.scheduled_payments to service_role;

-- =========================
-- 3. Receivables (loans out / money owed) ledger
-- =========================

create table if not exists public.receivables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  counterparty text not null,
  -- 'owed_to_user': the user lent money (they expect it back).
  -- 'user_owes':    the user borrowed money (they owe someone).
  direction text not null default 'owed_to_user' check (direction in (
    'owed_to_user',
    'user_owes'
  )),

  original_amount numeric(14,2) not null,
  outstanding_amount numeric(14,2) not null,
  currency text not null default 'USD',
  reason text,

  status text not null default 'open' check (status in (
    'open',
    'partial',
    'settled',
    'written_off'
  )),

  -- The movement that created this receivable (the expense when money went
  -- out as a loan), so undo/correction can keep them consistent.
  origin_transaction_id uuid references public.transactions(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists receivables_user_status_idx
  on public.receivables(user_id, status);

drop trigger if exists set_receivables_updated_at on public.receivables;
create trigger set_receivables_updated_at
before update on public.receivables
for each row execute function public.set_updated_at();

alter table public.receivables enable row level security;

drop policy if exists "Users can view own receivables" on public.receivables;
create policy "Users can view own receivables"
on public.receivables
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own receivables" on public.receivables;
create policy "Users can insert own receivables"
on public.receivables
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own receivables" on public.receivables;
create policy "Users can update own receivables"
on public.receivables
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own receivables" on public.receivables;
create policy "Users can delete own receivables"
on public.receivables
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on public.receivables to authenticated;
grant select, insert, update, delete on public.receivables to service_role;
