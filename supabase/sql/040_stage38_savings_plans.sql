-- Migration 040 — Stage 38: reserves become scheduled, account-linked plans.
-- Additive only. RLS enabled + user-scoped policies mirroring income_sources (010).
-- Human/authorized-agent applies this; do NOT weaken RLS, do NOT drop/rewrite applied objects.
--
-- Onboarding reserves (ahorro/inversión) used to collapse into two scalar columns on
-- user_financial_preferences (monthly_savings_commitment / monthly_investment_commitment).
-- Now each reserve is a row here with a cadence + day + destination account, so the
-- financial calendar can reserve it on its day exactly like a debt payment. The aggregate
-- prefs columns STAY (summed from these rows) so the Margen math is unchanged and never
-- double-counts.

create table if not exists public.savings_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'savings'
    check (kind in ('savings', 'investment')),
  name text,
  amount_base numeric(14,2) not null default 0,
  original_amount numeric(14,2),
  original_currency text,
  base_currency text not null default 'USD',
  frequency text not null default 'monthly'
    check (frequency in ('weekly', 'biweekly', 'monthly', 'yearly')),
  expected_day int check (expected_day between 1 and 31),
  -- Anchor for weekly/biweekly cadence (mirrors fixed_expenses.pay_anchor_date / income_sources).
  pay_anchor_date date,
  -- Where the reserve is set aside. Nullable → the engine defaults to the primary account.
  -- A reserve lands EITHER in a liquid account (efectivo, banco) OR an asset
  -- (investment_accounts: etoro, póliza, cepo…). At most one is set; both null → default.
  destination_account_id uuid references public.accounts(id) on delete set null,
  destination_asset_id uuid references public.investment_accounts(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent reconcile for envs where the table predates the asset-destination column.
alter table public.savings_plans
  add column if not exists destination_asset_id uuid references public.investment_accounts(id) on delete set null;

create index if not exists savings_plans_user_id_idx on public.savings_plans(user_id);

drop trigger if exists set_savings_plans_updated_at on public.savings_plans;
create trigger set_savings_plans_updated_at
before update on public.savings_plans
for each row execute function public.set_updated_at();

alter table public.savings_plans enable row level security;

drop policy if exists "Users can view own savings plans" on public.savings_plans;
create policy "Users can view own savings plans"
on public.savings_plans
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own savings plans" on public.savings_plans;
create policy "Users can insert own savings plans"
on public.savings_plans
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own savings plans" on public.savings_plans;
create policy "Users can update own savings plans"
on public.savings_plans
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own savings plans" on public.savings_plans;
create policy "Users can delete own savings plans"
on public.savings_plans
for delete
to authenticated
using (auth.uid() = user_id);
