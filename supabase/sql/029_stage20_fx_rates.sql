-- Stage 20 (micro-stage A) — FX rate cache (additive; manual apply). Stores the
-- exchange rates a user/agent CONFIRMS (e.g. "el dólar está a 4000") so Kipu can
-- convert multi-currency money with a KNOWN rate instead of asking every time —
-- and NEVER invents one. Per-user (each person's known rates). Service-role-only,
-- deny-by-default, like the Stage 16/18 tables. A live provider can later write
-- 'provider'-sourced rows here without any business-logic change.
create table if not exists public.fx_rates (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  base_currency  text        not null,                 -- "from"
  quote_currency text        not null,                 -- "to"
  rate           numeric     not null,                 -- 1 from = rate quote
  source         text        not null default 'manual', -- manual | provider | historical | cached
  as_of          date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists fx_rates_user_pair_uq on public.fx_rates (user_id, base_currency, quote_currency);
create index if not exists fx_rates_user_idx on public.fx_rates (user_id);

alter table public.fx_rates enable row level security;
grant select, insert, update, delete on public.fx_rates to service_role;

-- Micro-stage A2 — GLOBAL provider/reference rate CACHE (not user-scoped). Holds
-- rates fetched from a free reference provider (Frankfurter, ECB-sourced) so Kipu
-- avoids re-calling the network. Every row carries the provider's REAL effective
-- date (rate_date) — no NULL sentinel — so "latest" = the most recent row and a
-- historical conversion = the exact/nearest dated row. Reference rates only (NOT a
-- bank/transaction rate); the agent says so. A user's manual fx_rates row OUTRANKS
-- these for their own context. Service-role-only, deny-by-default.
create table if not exists public.fx_rate_cache (
  id             uuid        primary key default gen_random_uuid(),
  base_currency  text        not null,                  -- "from"
  quote_currency text        not null,                  -- "to"
  rate           numeric     not null,                  -- 1 from = rate quote
  rate_date      date        not null,                  -- the provider's effective date
  source         text        not null default 'provider', -- provider | cached
  provider       text        not null default 'frankfurter',
  fetched_at     timestamptz not null default now()
);
create unique index if not exists fx_rate_cache_pair_date_uq on public.fx_rate_cache (base_currency, quote_currency, rate_date);
create index if not exists fx_rate_cache_pair_idx on public.fx_rate_cache (base_currency, quote_currency, rate_date desc);

alter table public.fx_rate_cache enable row level security;
grant select, insert, update, delete on public.fx_rate_cache to service_role;
