-- Stage 14 — Card & Debt Protection / Interest Intelligence (additive; manual apply).
-- Makes card obligations DATE-AWARE (an older statement can't overwrite newer
-- obligations) and adds an auditable per-cycle history. No existing object is
-- dropped or weakened; RLS stays on every user-owned table.

-- 1. Date-awareness + interest interpretation on the existing debt_accounts row.
alter table public.debt_accounts
  add column if not exists statement_date           date,   -- emission date of the statement that set the CURRENT obligations
  add column if not exists statement_period_end     date,   -- period end of that statement, if known
  add column if not exists interest_rate_kind        text,   -- how to read interest_rate: 'annual_nominal' | 'annual_effective' | 'monthly'
  add column if not exists last_statement_evidence_id uuid;  -- provenance of the current obligations (capture evidence)

-- 2. Per-statement-cycle history: every statement seen for a card, whether or not
-- it became the current obligation. Powers date-aware overwrite protection,
-- "I kept the newer one" explanations, and observability.
create table if not exists public.debt_statement_cycles (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  debt_account_id   uuid        not null references public.debt_accounts(id) on delete cascade,
  evidence_id       uuid,                       -- capture evidence this cycle came from (no FK: evidence is prunable)
  statement_date    date,                       -- emission date (null when the statement didn't show one)
  period_end        date,
  previous_balance  numeric,
  statement_balance numeric,
  full_payment_due  numeric,
  minimum_payment   numeric,
  due_day           integer,
  cutoff_day        integer,
  interest_rate     numeric,
  interest_rate_kind text,
  applied           boolean     not null default false,  -- did this cycle's obligations become the current ones?
  is_current        boolean     not null default false,  -- is this the cycle currently reflected on debt_accounts?
  reason            text,                                  -- decision reason (newer / older_statement / no_prior / incoming_date_unknown)
  created_at        timestamptz not null default now()
);

-- Idempotency for the audit trail: at most one cycle row per card + emission date
-- (re-uploading the same statement doesn't duplicate history). Undated cycles are
-- not constrained (partial index) since they can't be ordered/deduped reliably.
create unique index if not exists debt_statement_cycles_card_date_uq
  on public.debt_statement_cycles (debt_account_id, statement_date)
  where statement_date is not null;

create index if not exists debt_statement_cycles_user_card_idx
  on public.debt_statement_cycles (user_id, debt_account_id, statement_date desc);

-- RLS: enabled, NO client policies → default deny. The service role (agent
-- executors / cron, no user session) bypasses RLS; clients never read this.
alter table public.debt_statement_cycles enable row level security;
grant select, insert, update on public.debt_statement_cycles to service_role;
