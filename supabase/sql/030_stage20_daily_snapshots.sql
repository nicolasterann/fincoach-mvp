-- Stage 20 (micro-stage G) — daily financial snapshots (additive; manual apply).
-- ONE row per user per day (upsert) capturing the headline metrics so Kipu can show
-- HONEST trends ("¿qué cambió?") — never a fabricated yesterday/today. Powers the
-- dashboard trend + the agent's change explanations. Service-role-only, deny-by-default.
create table if not exists public.daily_financial_snapshots (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  snapshot_date date        not null,
  margen_weekly numeric     not null default 0,
  safe_weekly   numeric     not null default 0,
  net_worth     numeric     not null default 0,
  total_debt    numeric     not null default 0,
  readiness     integer     not null default 0,
  base_currency text        not null default 'USD',
  created_at    timestamptz not null default now()
);
create unique index if not exists daily_financial_snapshots_user_date_uq on public.daily_financial_snapshots (user_id, snapshot_date);
create index if not exists daily_financial_snapshots_user_idx on public.daily_financial_snapshots (user_id, snapshot_date desc);

alter table public.daily_financial_snapshots enable row level security;
grant select, insert, update, delete on public.daily_financial_snapshots to service_role;
