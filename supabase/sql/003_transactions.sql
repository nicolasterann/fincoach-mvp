-- FinCoach MVP transactions schema
-- Stores financial movements interpreted from manual input, app chat, Telegram, and later AI parser.

-- =========================
-- Enums
-- =========================

do $$ begin
  create type public.transaction_type as enum (
    'expense',
    'income',
    'transfer',
    'debt_payment',
    'goal_contribution',
    'refund',
    'reversal',
    'adjustment'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.reimbursement_status as enum (
    'none',
    'expected',
    'received',
    'partial'
  );
exception
  when duplicate_object then null;
end $$;

-- =========================
-- Transactions
-- =========================

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  type public.transaction_type not null,
  description text not null,
  category public.financial_category not null default 'other',

  original_amount numeric(14,2) not null,
  original_currency text not null default 'USD',
  exchange_rate_to_base numeric(14,6) not null default 1,
  base_amount numeric(14,2) not null,
  base_currency text not null default 'USD',

  source_account_id uuid references public.accounts(id) on delete set null,
  destination_account_id uuid references public.accounts(id) on delete set null,
  debt_account_id uuid references public.debt_accounts(id) on delete set null,
  goal_id uuid references public.goals(id) on delete set null,

  related_transaction_id uuid references public.transactions(id) on delete set null,
  recurring_expense_id uuid,

  is_split boolean not null default false,
  gross_amount numeric(14,2),
  reimbursed_amount numeric(14,2),
  net_amount numeric(14,2),
  reimbursement_status public.reimbursement_status not null default 'none',

  confidence_score numeric(5,4) not null default 1,
  raw_input text,
  input_channel text not null default 'web',

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transactions_user_id_idx on public.transactions(user_id);
create index if not exists transactions_occurred_at_idx on public.transactions(occurred_at);
create index if not exists transactions_source_account_id_idx on public.transactions(source_account_id);
create index if not exists transactions_debt_account_id_idx on public.transactions(debt_account_id);
create index if not exists transactions_goal_id_idx on public.transactions(goal_id);

drop trigger if exists set_transactions_updated_at on public.transactions;
create trigger set_transactions_updated_at
before update on public.transactions
for each row execute function public.set_updated_at();

alter table public.transactions enable row level security;

drop policy if exists "Users can view own transactions" on public.transactions;
create policy "Users can view own transactions"
on public.transactions
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own transactions" on public.transactions;
create policy "Users can insert own transactions"
on public.transactions
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own transactions" on public.transactions;
create policy "Users can update own transactions"
on public.transactions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own transactions" on public.transactions;
create policy "Users can delete own transactions"
on public.transactions
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on public.transactions to authenticated;
