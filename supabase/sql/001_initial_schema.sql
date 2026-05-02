-- FinCoach MVP initial schema
-- Security-first Supabase schema with user ownership and RLS.

create extension if not exists pgcrypto;

-- =========================
-- Enums
-- =========================

do $$ begin
  create type public.account_type as enum ('bank', 'cash', 'wallet', 'goal_account');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.debt_account_type as enum ('credit_card', 'loan', 'family_debt', 'other_debt');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.goal_status as enum ('active', 'paused', 'completed', 'cancelled');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.goal_feasibility_status as enum (
    'viable',
    'challenging',
    'at_risk',
    'not_currently_viable',
    'paused_due_to_financial_health'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.financial_confidence_level as enum ('low', 'medium', 'high');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_frequency as enum ('weekly', 'biweekly', 'monthly', 'yearly', 'custom');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.recurring_expense_status as enum ('active', 'paused', 'cancelled');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.financial_category as enum (
    'housing',
    'utilities',
    'food',
    'transport',
    'health',
    'education',
    'subscriptions',
    'debt',
    'shopping',
    'entertainment',
    'family',
    'savings',
    'income',
    'travel',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

-- =========================
-- Helpers
-- =========================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================
-- Profiles
-- =========================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  country text,
  base_currency text not null default 'USD',
  tone_preference text not null default 'playful',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- =========================
-- Accounts
-- =========================

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type public.account_type not null,
  currency text not null default 'USD',
  current_balance_original numeric(14,2) not null default 0,
  current_balance_base numeric(14,2) not null default 0,
  is_goal_account boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists accounts_user_id_idx on public.accounts(user_id);

drop trigger if exists set_accounts_updated_at on public.accounts;
create trigger set_accounts_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

alter table public.accounts enable row level security;

drop policy if exists "Users can view own accounts" on public.accounts;
create policy "Users can view own accounts"
on public.accounts
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own accounts" on public.accounts;
create policy "Users can insert own accounts"
on public.accounts
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own accounts" on public.accounts;
create policy "Users can update own accounts"
on public.accounts
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own accounts" on public.accounts;
create policy "Users can delete own accounts"
on public.accounts
for delete
to authenticated
using (auth.uid() = user_id);

-- =========================
-- Debt accounts
-- =========================

create table if not exists public.debt_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type public.debt_account_type not null,
  currency text not null default 'USD',
  current_balance_original numeric(14,2) not null default 0,
  current_balance_base numeric(14,2) not null default 0,
  minimum_payment numeric(14,2),
  full_payment_due numeric(14,2),
  due_day int check (due_day between 1 and 31),
  cutoff_day int check (cutoff_day between 1 and 31),
  interest_rate numeric(8,4),
  default_payment_account_id uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists debt_accounts_user_id_idx on public.debt_accounts(user_id);

drop trigger if exists set_debt_accounts_updated_at on public.debt_accounts;
create trigger set_debt_accounts_updated_at
before update on public.debt_accounts
for each row execute function public.set_updated_at();

alter table public.debt_accounts enable row level security;

drop policy if exists "Users can view own debt accounts" on public.debt_accounts;
create policy "Users can view own debt accounts"
on public.debt_accounts
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own debt accounts" on public.debt_accounts;
create policy "Users can insert own debt accounts"
on public.debt_accounts
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own debt accounts" on public.debt_accounts;
create policy "Users can update own debt accounts"
on public.debt_accounts
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own debt accounts" on public.debt_accounts;
create policy "Users can delete own debt accounts"
on public.debt_accounts
for delete
to authenticated
using (auth.uid() = user_id);

-- =========================
-- Goals
-- =========================

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric(14,2) not null,
  currency text not null default 'USD',
  current_amount numeric(14,2) not null default 0,
  target_date date,
  goal_account_id uuid references public.accounts(id) on delete set null,
  status public.goal_status not null default 'active',
  feasibility_status public.goal_feasibility_status not null default 'challenging',
  weekly_required_amount numeric(14,2) not null default 0,
  monthly_required_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists goals_user_id_idx on public.goals(user_id);

drop trigger if exists set_goals_updated_at on public.goals;
create trigger set_goals_updated_at
before update on public.goals
for each row execute function public.set_updated_at();

alter table public.goals enable row level security;

drop policy if exists "Users can view own goals" on public.goals;
create policy "Users can view own goals"
on public.goals
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own goals" on public.goals;
create policy "Users can insert own goals"
on public.goals
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own goals" on public.goals;
create policy "Users can update own goals"
on public.goals
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own goals" on public.goals;
create policy "Users can delete own goals"
on public.goals
for delete
to authenticated
using (auth.uid() = user_id);
