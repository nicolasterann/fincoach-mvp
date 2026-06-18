-- Stage 20 PASS 2 (Micro-stage F) — RECURRING SHARED EXPENSES (additive; manual apply).
-- A household recurring bill is a TEMPLATE/SCHEDULE only (rent, utilities, internet,
-- a monthly cleaner, family support, a trip installment). It is NOT money by itself:
-- it surfaces "what shared bills are coming" and reminds the group. The actual money
-- event is still a single shared_expenses row the payer logs each cycle (optionally
-- created FROM a template), so settlement math and the no-double-count rule are
-- unchanged. Like every Stage 19 household table this is RLS-enabled, deny-by-default
-- (NO client policies) and granted to service_role only — membership + role are
-- enforced in the typed store layer. The stores degrade gracefully until this is
-- applied, so production is UNCHANGED until then.

create table if not exists public.household_recurring_expenses (
  id              uuid        primary key default gen_random_uuid(),
  household_id    uuid        not null references public.households(id) on delete cascade,
  payer_member_id uuid        not null references public.household_members(id) on delete restrict,
  description     text        not null,
  category        text,
  amount_base     numeric     not null,
  base_currency   text        not null default 'USD',
  split_method    text        not null default 'equal', -- equal | percentage | fixed | income_weighted | custom | payer_absorbs
  cadence         text        not null default 'monthly', -- weekly | biweekly | monthly | annual
  anchor_day      integer,                                -- monthly/annual: day-of-month 1..28; weekly/biweekly: weekday 0..6
  next_due        date,                                   -- advisory next occurrence (recomputed when null/stale)
  active          boolean     not null default true,
  note            text,
  created_by      uuid        references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists household_recurring_expenses_household_idx
  on public.household_recurring_expenses (household_id) where active;

alter table public.household_recurring_expenses enable row level security;
grant select, insert, update, delete on public.household_recurring_expenses to service_role;
