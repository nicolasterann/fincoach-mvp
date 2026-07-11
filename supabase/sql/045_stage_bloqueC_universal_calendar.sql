-- Migration 045 — Bloque C completion: make recurring_occurrences the universal materialization
-- state machine for EVERY scheduled/expected calendar flow, not just income + fixed expenses.
-- Additive only. RLS + grants are inherited from 044 (new columns are covered by the existing
-- user-scoped policies). Human/authorized-agent applies this; do NOT weaken RLS, do NOT
-- drop/rewrite applied objects.
--
-- Until now the loop only knew income_source_id / fixed_expense_id. The calendar also projects
-- debt/loan payments, credit-card statements, savings/investment reserves and one-off scheduled
-- payments — all "on the calendar" and therefore (per the product rule) all must flow through
-- the SAME auto-book / ask / confirm / correct / skip machine. This migration adds the missing
-- source discriminators + widens `kind`:
--   - debt_account_id   → loans (auto), family/other debts (ask), credit-card payments (ask on
--                         the due day once a statement amount exists). kind='debt_payment'.
--   - savings_plan_id   → a Stage-38 reserve plan (ask). kind='savings' | 'investment'.
--   - scheduled_payment_id → a one-off planned payment (ask on its due_date). kind='expense'.
--   - commitment_kind   → the LEGACY aggregate reserve scalar (monthly_savings/investment_
--                         commitment) for users with no per-reserve plan: a sourceless monthly
--                         reserve check-in. kind='savings' | 'investment'.
-- Idempotency stays "one occurrence per (source, date)" via the new partial unique indexes.

-- Widen the movement kind. Reserves ('savings'/'investment') are confirmation check-ins (a
-- reserve is a Margen allocation, not necessarily a ledger movement); debt_payment reduces a
-- cash account + the debt (and, for a card, its statement) through the single ledger writer.
alter table public.recurring_occurrences drop constraint if exists recurring_occurrences_kind_check;
alter table public.recurring_occurrences
  add constraint recurring_occurrences_kind_check
  check (kind in ('income', 'expense', 'debt_payment', 'savings', 'investment'));

-- New source discriminators (nullable; exactly one of the six is set — enforced below).
alter table public.recurring_occurrences
  add column if not exists debt_account_id uuid references public.debt_accounts(id) on delete cascade,
  add column if not exists savings_plan_id uuid references public.savings_plans(id) on delete cascade,
  add column if not exists scheduled_payment_id uuid references public.scheduled_payments(id) on delete cascade,
  -- Sourceless aggregate reserve (no per-reserve plan row). NULL for every FK-backed occurrence.
  add column if not exists commitment_kind text check (commitment_kind in ('savings', 'investment'));

-- Replace the 2-way one-source check with a 6-way "exactly one source" check.
alter table public.recurring_occurrences drop constraint if exists recurring_occurrences_one_source_chk;
alter table public.recurring_occurrences
  add constraint recurring_occurrences_one_source_chk check (
    (case when income_source_id is not null then 1 else 0 end)
    + (case when fixed_expense_id is not null then 1 else 0 end)
    + (case when debt_account_id is not null then 1 else 0 end)
    + (case when savings_plan_id is not null then 1 else 0 end)
    + (case when scheduled_payment_id is not null then 1 else 0 end)
    + (case when commitment_kind is not null then 1 else 0 end)
    = 1
  );

-- Idempotency: at most one occurrence per source per date (partial indexes because NULL source
-- columns would otherwise be treated as distinct and let duplicates through).
create unique index if not exists recurring_occurrences_debt_uq
  on public.recurring_occurrences (user_id, debt_account_id, occurrence_date)
  where debt_account_id is not null;
create unique index if not exists recurring_occurrences_savings_uq
  on public.recurring_occurrences (user_id, savings_plan_id, occurrence_date)
  where savings_plan_id is not null;
create unique index if not exists recurring_occurrences_scheduled_uq
  on public.recurring_occurrences (user_id, scheduled_payment_id, occurrence_date)
  where scheduled_payment_id is not null;
-- A user has at most one savings + one investment aggregate reserve per date.
create unique index if not exists recurring_occurrences_commitment_uq
  on public.recurring_occurrences (user_id, commitment_kind, occurrence_date)
  where commitment_kind is not null;
