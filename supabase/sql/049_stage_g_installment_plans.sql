-- Stage G (Cuotas / LatAm installments) — a card purchase paid in N monthly
-- installments. The FULL debt is born on purchase day (debt_accounts balance
-- goes up by the total via the normal card-expense ledger path; the purchase
-- transaction carries external_ref = 'installment:<plan_id>' so the Saldo tank
-- never drains it); the CASH leaves in monthly installments inside each card
-- statement. Option A (founder-locked): the monthly installment load reduces
-- the RITMO (monthlyTrulyFree) while the plan is active — a temporary fixed
-- outflow — and the tank stays untouched.
--
-- months elapsed/remaining are DERIVED from first_statement_due at read time
-- (never mutated by a loop); status changes only by user action (cancel /
-- early payoff) or derived completion.

create table if not exists public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  debt_account_id uuid not null references public.debt_accounts(id) on delete cascade,

  description text not null,
  -- Total committed (price + surcharge when financed with interest).
  total_original numeric(14,2) not null check (total_original > 0),
  original_currency text not null default 'USD',
  total_base numeric(14,2) not null check (total_base > 0),
  base_currency text not null default 'USD',
  -- Per-month installment in base currency (≈ total_base / months_total).
  installment_base numeric(14,2) not null check (installment_base > 0),
  months_total int not null check (months_total between 1 and 60),
  -- Due date of the statement that includes installment #1.
  first_statement_due date not null,
  -- Interest surcharge included in the total (0 = cuotas sin interés).
  surcharge_base numeric(14,2) not null default 0 check (surcharge_base >= 0),

  status text not null default 'active' check (status in ('active', 'cancelled', 'paid_off')),
  paid_off_at date,
  category public.financial_category not null default 'shopping',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists installment_plans_user_id_idx on public.installment_plans(user_id);
create index if not exists installment_plans_debt_idx on public.installment_plans(debt_account_id);

drop trigger if exists set_installment_plans_updated_at on public.installment_plans;
create trigger set_installment_plans_updated_at
before update on public.installment_plans
for each row execute function public.set_updated_at();

alter table public.installment_plans enable row level security;

drop policy if exists "installment_plans_select_own" on public.installment_plans;
create policy "installment_plans_select_own" on public.installment_plans
  for select using (auth.uid() = user_id);
drop policy if exists "installment_plans_insert_own" on public.installment_plans;
create policy "installment_plans_insert_own" on public.installment_plans
  for insert with check (auth.uid() = user_id);
drop policy if exists "installment_plans_update_own" on public.installment_plans;
create policy "installment_plans_update_own" on public.installment_plans
  for update using (auth.uid() = user_id);
drop policy if exists "installment_plans_delete_own" on public.installment_plans;
create policy "installment_plans_delete_own" on public.installment_plans
  for delete using (auth.uid() = user_id);

-- Service-role grants are intentional (channel handlers / the briefing builder
-- run without a user session) — the savings_plans lesson: RLS without grants
-- leaves the service role silently dead (42501).
grant select, insert, update, delete on public.installment_plans to service_role;
grant select, insert, update, delete on public.installment_plans to authenticated;
