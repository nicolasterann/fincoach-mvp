-- Kipu — Stage H fix P1-1: version the monthly OBJECTIVE by effective_month.
--
-- THE BUG: budget_categories holds ONE row per (user, category, period), so the
-- objective had no history. The engine walks the last 40 days and the close
-- reports the previous month — both read the CURRENT amount, so changing the
-- objective REWROTE THE PAST: raise it in July and June's excess (which already
-- drained the Saldo) silently disappears, and the tank refills retroactively.
-- The close would likewise report last month against this month's number.
--
-- THE FIX: one row per (user, category, effective_month). The objective in
-- effect FOR A GIVEN MONTH is the version with the greatest effective_month <=
-- that month; changing the objective writes a version for the CURRENT month
-- only, so past months keep the number the user actually decided back then.
-- budget_categories stays the "current" pointer (it still drives essentialEstimate
-- and the FX re-valuation); this table is the immutable-per-month history.
--
-- Amount is stored in the currency the user named (base or native), mirroring
-- budget_categories — the context builder re-values it at the LIVE rate, so a
-- peso objective never freezes at one day's rate.
--
-- Additive only. Apply BEFORE deploying the Stage H fix code (the context
-- builder selects from this table).

create table if not exists public.objective_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  effective_month text not null check (effective_month ~ '^[0-9]{4}-[0-9]{2}$'),
  amount numeric not null check (amount >= 0),
  currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category, effective_month)
);

create index if not exists objective_versions_user_cat_month_idx
  on public.objective_versions (user_id, category, effective_month desc);

alter table public.objective_versions enable row level security;

drop policy if exists "objective_versions_select_own" on public.objective_versions;
create policy "objective_versions_select_own" on public.objective_versions
  for select using (auth.uid() = user_id);
drop policy if exists "objective_versions_insert_own" on public.objective_versions;
create policy "objective_versions_insert_own" on public.objective_versions
  for insert with check (auth.uid() = user_id);
drop policy if exists "objective_versions_update_own" on public.objective_versions;
create policy "objective_versions_update_own" on public.objective_versions
  for update using (auth.uid() = user_id);

grant select, insert, update on public.objective_versions to authenticated;
grant select, insert, update, delete on public.objective_versions to service_role;

-- Seed the history from the CURRENT objectives so month resolution has an
-- anchor from today forward. Months BEFORE this seed have no row and fall back
-- to the earliest known version (there is no historical data to recover — but
-- from now on, a change can never rewrite a past month).
insert into public.objective_versions (user_id, category, effective_month, amount, currency)
select bc.user_id,
       bc.category::text,
       to_char(now(), 'YYYY-MM'),
       bc.amount,
       bc.currency::text
from public.budget_categories bc
where bc.is_active = true
  and bc.period = 'monthly'
  and bc.category::text in ('food', 'transport')
  and bc.amount > 0
on conflict (user_id, category, effective_month) do nothing;
