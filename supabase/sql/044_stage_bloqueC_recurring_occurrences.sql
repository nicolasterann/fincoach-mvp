-- Migration 044 — Bloque C: recurring cash-flow materialization loop.
-- Additive only. RLS enabled + user-scoped policies mirroring savings_plans (040).
-- Human/authorized-agent applies this; do NOT weaken RLS, do NOT drop/rewrite applied objects.
--
-- Until now a recurring income/expense was PROJECTION-ONLY config: the calendar projected
-- its occurrences for the Margen but nothing ever booked one into the ledger, so a salary
-- that really landed stayed invisible until the user reported it by chat. This table is the
-- state machine for materializing each due occurrence:
--   - FIXED-amount flows (is_variable=false) → mode='auto': booked automatically on its date,
--     then a correctable notification (status booked → confirmed/corrected/skipped).
--   - VARIABLE-amount flows (is_variable=true) → mode='ask': the user is asked the amount,
--     booked on confirm (status pending → confirmed/corrected/skipped/dismissed).
-- Idempotency = one row per (source, occurrence_date) via the partial unique indexes below;
-- created_transaction_id links the booked ledger row for correction/reversal. The Margen reads
-- pending/booked-unconfirmed rows so it never silently assumes nor silently craters a whole
-- paycheck. Timezone comes from the existing user_engagement.timezone (no new column).

create table if not exists public.recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Exactly one source is set (enforced by the check below). Cascade so an occurrence
  -- never outlives the plan it belongs to.
  income_source_id uuid references public.income_sources(id) on delete cascade,
  fixed_expense_id uuid references public.fixed_expenses(id) on delete cascade,
  -- The specific due date this occurrence represents (the user's local calendar day).
  occurrence_date date not null,
  kind text not null check (kind in ('income', 'expense')),
  mode text not null check (mode in ('auto', 'ask')),
  -- Snapshot of the plan's NATIVE expected amount + currency at creation time (for the
  -- notify/ask copy and the Margen "sin confirmar" figure). NULL for a variable ask with no
  -- prior estimate.
  expected_amount numeric(14, 2),
  currency text,
  status text not null default 'pending'
    check (status in ('pending', 'booked', 'confirmed', 'corrected', 'skipped', 'dismissed')),
  -- The ledger row auto-booked for this occurrence (mode='auto') or booked on confirm
  -- (mode='ask'). Kept for correction (reverse + rebook) and for skip (reverse). No FK to
  -- transactions (append-only ledger, rows are never hard-deleted).
  created_transaction_id uuid,
  -- Ask lifecycle (mode='ask'): re-ask up to 3 days, snooze on request, dismiss to stop.
  ask_count int not null default 0,
  snooze_until timestamptz,
  last_asked_on date,
  -- When the occurrence reached a terminal state (confirmed/corrected/skipped/dismissed).
  resolved_at timestamptz,
  -- Whether the notify/ask message was delivered (so the cron doesn't resend the same day).
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Exactly one source column set.
  constraint recurring_occurrences_one_source_chk check (
    (income_source_id is not null and fixed_expense_id is null)
    or (income_source_id is null and fixed_expense_id is not null)
  )
);

-- Idempotency: at most one occurrence per source per date. Partial indexes (not a plain
-- unique tuple) because NULL source columns would otherwise be treated as distinct and let
-- duplicates through.
create unique index if not exists recurring_occurrences_income_uq
  on public.recurring_occurrences (user_id, income_source_id, occurrence_date)
  where income_source_id is not null;
create unique index if not exists recurring_occurrences_fixed_uq
  on public.recurring_occurrences (user_id, fixed_expense_id, occurrence_date)
  where fixed_expense_id is not null;

-- Fast lookup of a user's open (non-terminal) occurrences for the Margen + the resolve flow.
create index if not exists recurring_occurrences_user_status_idx
  on public.recurring_occurrences (user_id, status);

drop trigger if exists set_recurring_occurrences_updated_at on public.recurring_occurrences;
create trigger set_recurring_occurrences_updated_at
before update on public.recurring_occurrences
for each row execute function public.set_updated_at();

-- Service-role (the materialization cron + the resolve agent tool run without a user session)
-- and authenticated (the user reads/edits their own via the session client) both need table
-- grants; RLS below still scopes authenticated to auth.uid() = user_id.
grant select, insert, update, delete on public.recurring_occurrences to service_role;
grant select, insert, update, delete on public.recurring_occurrences to authenticated;

alter table public.recurring_occurrences enable row level security;

drop policy if exists "Users can view own recurring occurrences" on public.recurring_occurrences;
create policy "Users can view own recurring occurrences"
on public.recurring_occurrences
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own recurring occurrences" on public.recurring_occurrences;
create policy "Users can insert own recurring occurrences"
on public.recurring_occurrences
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own recurring occurrences" on public.recurring_occurrences;
create policy "Users can update own recurring occurrences"
on public.recurring_occurrences
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own recurring occurrences" on public.recurring_occurrences;
create policy "Users can delete own recurring occurrences"
on public.recurring_occurrences
for delete
to authenticated
using (auth.uid() = user_id);
