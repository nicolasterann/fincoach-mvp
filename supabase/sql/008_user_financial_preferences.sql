-- Stores user-level financial preferences for low-friction chat input.
-- Example: default payment method when a Telegram message omits source.

create table if not exists public.user_financial_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_source_type text check (default_source_type in ('account', 'debt_account')),
  default_source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_user_financial_preferences_updated_at on public.user_financial_preferences;
create trigger set_user_financial_preferences_updated_at
before update on public.user_financial_preferences
for each row execute function public.set_updated_at();

alter table public.user_financial_preferences enable row level security;

drop policy if exists "Users can view own financial preferences" on public.user_financial_preferences;
create policy "Users can view own financial preferences"
on public.user_financial_preferences
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own financial preferences" on public.user_financial_preferences;
create policy "Users can insert own financial preferences"
on public.user_financial_preferences
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own financial preferences" on public.user_financial_preferences;
create policy "Users can update own financial preferences"
on public.user_financial_preferences
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update on public.user_financial_preferences to service_role;