-- Adds onboarding and financial context tables used by FinCoach AI coaching.

-- =========================
-- Income sources
-- =========================

create table if not exists public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount numeric(14,2) not null default 0,
  currency text not null default 'USD',
  frequency text not null default 'monthly'
    check (frequency in ('weekly', 'biweekly', 'monthly', 'yearly', 'custom')),
  expected_day int check (expected_day between 1 and 31),
  expected_weekday int check (expected_weekday between 0 and 6),
  is_variable boolean not null default false,
  min_expected_amount numeric(14,2),
  max_expected_amount numeric(14,2),
  destination_account_id uuid references public.accounts(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists income_sources_user_id_idx on public.income_sources(user_id);

drop trigger if exists set_income_sources_updated_at on public.income_sources;
create trigger set_income_sources_updated_at
before update on public.income_sources
for each row execute function public.set_updated_at();

alter table public.income_sources enable row level security;

drop policy if exists "Users can view own income sources" on public.income_sources;
create policy "Users can view own income sources"
on public.income_sources
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own income sources" on public.income_sources;
create policy "Users can insert own income sources"
on public.income_sources
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own income sources" on public.income_sources;
create policy "Users can update own income sources"
on public.income_sources
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own income sources" on public.income_sources;
create policy "Users can delete own income sources"
on public.income_sources
for delete
to authenticated
using (auth.uid() = user_id);

-- =========================
-- Fixed expenses
-- =========================

create table if not exists public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount numeric(14,2) not null default 0,
  currency text not null default 'USD',
  category public.financial_category not null default 'other',
  frequency text not null default 'monthly'
    check (frequency in ('weekly', 'biweekly', 'monthly', 'yearly', 'custom')),
  expected_day int check (expected_day between 1 and 31),
  expected_weekday int check (expected_weekday between 0 and 6),
  payment_source_type text check (payment_source_type in ('account', 'debt_account')),
  payment_source_id uuid,
  is_essential boolean not null default true,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fixed_expenses_user_id_idx on public.fixed_expenses(user_id);
create index if not exists fixed_expenses_user_category_idx on public.fixed_expenses(user_id, category);

drop trigger if exists set_fixed_expenses_updated_at on public.fixed_expenses;
create trigger set_fixed_expenses_updated_at
before update on public.fixed_expenses
for each row execute function public.set_updated_at();

alter table public.fixed_expenses enable row level security;

drop policy if exists "Users can view own fixed expenses" on public.fixed_expenses;
create policy "Users can view own fixed expenses"
on public.fixed_expenses
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own fixed expenses" on public.fixed_expenses;
create policy "Users can insert own fixed expenses"
on public.fixed_expenses
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own fixed expenses" on public.fixed_expenses;
create policy "Users can update own fixed expenses"
on public.fixed_expenses
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own fixed expenses" on public.fixed_expenses;
create policy "Users can delete own fixed expenses"
on public.fixed_expenses
for delete
to authenticated
using (auth.uid() = user_id);

-- =========================
-- Coach preferences
-- =========================

create table if not exists public.coach_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tone text not null default 'playful'
    check (tone in ('clear', 'coach_like', 'playful')),
  strictness_level text not null default 'balanced'
    check (strictness_level in ('relaxed', 'balanced', 'strict')),
  humor_level text not null default 'medium'
    check (humor_level in ('none', 'low', 'medium', 'high')),
  detail_level text not null default 'short'
    check (detail_level in ('short', 'medium', 'detailed')),
  proactive_alerts_enabled boolean not null default true,
  weekly_review_enabled boolean not null default true,
  daily_checkin_enabled boolean not null default false,
  preferred_language text not null default 'es',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_coach_preferences_updated_at on public.coach_preferences;
create trigger set_coach_preferences_updated_at
before update on public.coach_preferences
for each row execute function public.set_updated_at();

alter table public.coach_preferences enable row level security;

drop policy if exists "Users can view own coach preferences" on public.coach_preferences;
create policy "Users can view own coach preferences"
on public.coach_preferences
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own coach preferences" on public.coach_preferences;
create policy "Users can insert own coach preferences"
on public.coach_preferences
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own coach preferences" on public.coach_preferences;
create policy "Users can update own coach preferences"
on public.coach_preferences
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- =========================
-- Budget categories
-- =========================

create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category public.financial_category not null,
  amount numeric(14,2) not null default 0,
  currency text not null default 'USD',
  period text not null default 'monthly'
    check (period in ('weekly', 'monthly', 'yearly', 'custom')),
  alert_threshold_percentage numeric(5,2) not null default 80,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, category, period)
);

create index if not exists budget_categories_user_id_idx on public.budget_categories(user_id);

drop trigger if exists set_budget_categories_updated_at on public.budget_categories;
create trigger set_budget_categories_updated_at
before update on public.budget_categories
for each row execute function public.set_updated_at();

alter table public.budget_categories enable row level security;

drop policy if exists "Users can view own budget categories" on public.budget_categories;
create policy "Users can view own budget categories"
on public.budget_categories
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own budget categories" on public.budget_categories;
create policy "Users can insert own budget categories"
on public.budget_categories
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own budget categories" on public.budget_categories;
create policy "Users can update own budget categories"
on public.budget_categories
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own budget categories" on public.budget_categories;
create policy "Users can delete own budget categories"
on public.budget_categories
for delete
to authenticated
using (auth.uid() = user_id);

-- =========================
-- Spending alert rules
-- =========================

create table if not exists public.spending_alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  rule_type text not null
    check (rule_type in ('category_amount', 'account_balance_below', 'debt_usage_above', 'daily_spend_above', 'weekly_spend_above')),
  category public.financial_category,
  account_id uuid references public.accounts(id) on delete cascade,
  debt_account_id uuid references public.debt_accounts(id) on delete cascade,
  threshold_amount numeric(14,2),
  threshold_percentage numeric(5,2),
  period text check (period in ('daily', 'weekly', 'monthly', 'custom')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spending_alert_rules_user_id_idx on public.spending_alert_rules(user_id);

drop trigger if exists set_spending_alert_rules_updated_at on public.spending_alert_rules;
create trigger set_spending_alert_rules_updated_at
before update on public.spending_alert_rules
for each row execute function public.set_updated_at();

alter table public.spending_alert_rules enable row level security;

drop policy if exists "Users can view own spending alert rules" on public.spending_alert_rules;
create policy "Users can view own spending alert rules"
on public.spending_alert_rules
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own spending alert rules" on public.spending_alert_rules;
create policy "Users can insert own spending alert rules"
on public.spending_alert_rules
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own spending alert rules" on public.spending_alert_rules;
create policy "Users can update own spending alert rules"
on public.spending_alert_rules
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own spending alert rules" on public.spending_alert_rules;
create policy "Users can delete own spending alert rules"
on public.spending_alert_rules
for delete
to authenticated
using (auth.uid() = user_id);

-- =========================
-- User context notes
-- =========================

create table if not exists public.user_context_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_type text not null default 'general'
    check (note_type in ('general', 'preference', 'constraint', 'goal_context', 'risk_context', 'behavior_pattern')),
  content text not null,
  source text not null default 'manual'
    check (source in ('manual', 'onboarding', 'ai', 'system')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_context_notes_user_id_idx on public.user_context_notes(user_id);

drop trigger if exists set_user_context_notes_updated_at on public.user_context_notes;
create trigger set_user_context_notes_updated_at
before update on public.user_context_notes
for each row execute function public.set_updated_at();

alter table public.user_context_notes enable row level security;

drop policy if exists "Users can view own context notes" on public.user_context_notes;
create policy "Users can view own context notes"
on public.user_context_notes
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own context notes" on public.user_context_notes;
create policy "Users can insert own context notes"
on public.user_context_notes
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own context notes" on public.user_context_notes;
create policy "Users can update own context notes"
on public.user_context_notes
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own context notes" on public.user_context_notes;
create policy "Users can delete own context notes"
on public.user_context_notes
for delete
to authenticated
using (auth.uid() = user_id);

-- =========================
-- Financial context snapshots
-- =========================

create table if not exists public.financial_context_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null default current_date,
  base_currency text not null default 'USD',
  total_available numeric(14,2) not null default 0,
  total_debt numeric(14,2) not null default 0,
  total_goal_savings numeric(14,2) not null default 0,
  weekly_available numeric(14,2) not null default 0,
  daily_suggested numeric(14,2) not null default 0,
  fixed_expenses_pending numeric(14,2) not null default 0,
  debt_payments_pending numeric(14,2) not null default 0,
  goal_contributions_required numeric(14,2) not null default 0,
  raw_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists financial_context_snapshots_user_id_idx
on public.financial_context_snapshots(user_id);

create index if not exists financial_context_snapshots_user_date_idx
on public.financial_context_snapshots(user_id, snapshot_date);

alter table public.financial_context_snapshots enable row level security;

drop policy if exists "Users can view own financial context snapshots" on public.financial_context_snapshots;
create policy "Users can view own financial context snapshots"
on public.financial_context_snapshots
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own financial context snapshots" on public.financial_context_snapshots;
create policy "Users can insert own financial context snapshots"
on public.financial_context_snapshots
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own financial context snapshots" on public.financial_context_snapshots;
create policy "Users can delete own financial context snapshots"
on public.financial_context_snapshots
for delete
to authenticated
using (auth.uid() = user_id);

-- =========================
-- Service role grants
-- =========================

grant select, insert, update, delete on public.income_sources to authenticated;
grant select, insert, update, delete on public.fixed_expenses to authenticated;
grant select, insert, update on public.coach_preferences to authenticated;
grant select, insert, update, delete on public.budget_categories to authenticated;
grant select, insert, update, delete on public.spending_alert_rules to authenticated;
grant select, insert, update, delete on public.user_context_notes to authenticated;
grant select, insert, delete on public.financial_context_snapshots to authenticated;

grant select, insert, update, delete on public.income_sources to service_role;
grant select, insert, update, delete on public.fixed_expenses to service_role;
grant select, insert, update on public.coach_preferences to service_role;
grant select, insert, update, delete on public.budget_categories to service_role;
grant select, insert, update, delete on public.spending_alert_rules to service_role;
grant select, insert, update, delete on public.user_context_notes to service_role;
grant select, insert, delete on public.financial_context_snapshots to service_role;
