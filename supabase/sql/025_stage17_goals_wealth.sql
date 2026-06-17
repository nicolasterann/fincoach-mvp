-- Stage 17 — Goals, Mini-Goals, Wealth Builder & Human Financial Priorities
-- (additive; manual apply). Turns the single-main-goal world into a prioritized
-- PORTFOLIO (primary / secondary / mini / milestone), adds investment & asset
-- tracking, net-worth snapshots, recurring investment plans, an audit trail of
-- allocation revisions, and a provider-agnostic external-portfolio scaffold.
-- No existing object is dropped or weakened. RLS stays on every user-owned table.
-- All new columns are nullable/defaulted so existing rows + single-goal behavior
-- are unchanged. Columns use text (not new enums) to stay additive and flexible;
-- the app validates values.

-- 1. GOALS → portfolio fields (additive). parent_goal_id makes mini-goals; the
--    COMMITTED contribution_amount + cadence is what reserves money (feeds Margen);
--    is_primary guarantees a mini-goal is never picked as the main goal.
alter table public.goals
  add column if not exists goal_type           text    not null default 'primary',  -- primary | mini | milestone
  add column if not exists archetype           text,                                 -- savings|travel|purchase|emergency|debt_payoff|investment|wealth|family|lifestyle|custom
  add column if not exists parent_goal_id      uuid    references public.goals(id) on delete cascade,
  add column if not exists is_primary          boolean not null default false,
  add column if not exists priority            smallint,                             -- 1 = highest
  add column if not exists cadence             text,                                 -- weekly|biweekly|monthly|one_time|flexible
  add column if not exists contribution_amount numeric,                              -- committed per-cadence amount (reserves money when active+protected)
  add column if not exists cashflow_protected  boolean not null default true,
  add column if not exists flexible_deadline   boolean not null default false,
  add column if not exists can_pause           boolean not null default true,
  add column if not exists contribution_model  text    not null default 'notional_increment', -- notional_increment | move_to_account
  add column if not exists investment_eligible boolean not null default false;

create index if not exists goals_user_parent_idx on public.goals (user_id, parent_goal_id);

-- 2. PREFERENCES → adaptive ambition / risk / reserve / wealth (additive). Kept
--    DISTINCT from user_engagement.mode (which is temporal pause/light state):
--    ambition_mode is the set-at-onboarding goal posture.
alter table public.user_financial_preferences
  add column if not exists ambition_mode           text,     -- light_touch | steady | power_builder
  add column if not exists risk_tolerance          text,     -- conservative | moderate | aggressive
  add column if not exists emergency_reserve_target numeric,
  add column if not exists investment_horizon      text,     -- short | medium | long
  add column if not exists investment_readiness    smallint, -- 0-3 onboarding signal
  add column if not exists wealth_target            numeric;  -- long-term net-worth goal

-- 3. INVESTMENT ACCOUNTS / ASSETS — manual first (no live broker sync). Source of
--    truth for compounding/return projections & net worth. NEVER stores a market
--    price Kipu invented; value_base is user-provided or from a verified sync.
create table if not exists public.investment_accounts (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users(id) on delete cascade,
  name                text        not null,
  asset_class         text        not null,        -- cash|investment|fixed_term|crypto|property|vehicle|business|receivable|other
  value_base          numeric     not null default 0,
  currency            text,
  liquid              boolean     not null default false,
  include_in_net_worth boolean    not null default true,
  expected_return_pct numeric,                       -- user-provided; null ⇒ no growth projected
  return_kind         text,                          -- annual_nominal | annual_effective | monthly
  compounding         text,                          -- monthly | quarterly | annual
  cost_basis          numeric,                        -- for unrealized gain/loss when known
  valuation_date      date,
  valuation_confidence text,                          -- high | medium | low
  linked_goal_id      uuid        references public.goals(id) on delete set null,
  external_connection_id uuid,                        -- future: links to external_portfolio_connections
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists investment_accounts_user_idx on public.investment_accounts (user_id);

-- 4. RECURRING INVESTMENT PLANS (DCA / scheduled contributions). Feed the
--    financial calendar like fixed expenses when active.
create table if not exists public.recurring_investment_plans (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users(id) on delete cascade,
  investment_account_id uuid        references public.investment_accounts(id) on delete cascade,
  goal_id               uuid        references public.goals(id) on delete set null,
  amount                numeric     not null,
  frequency             text        not null default 'monthly', -- weekly | biweekly | monthly
  next_date             date,
  status                text        not null default 'active',   -- active | paused | cancelled
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists recurring_investment_plans_user_idx on public.recurring_investment_plans (user_id);

-- 5. GOAL ALLOCATION REVISIONS — AUDIT TRAIL ONLY (immutable; NEVER read back into
--    Margen, which always recomputes the allocation fresh). For observability:
--    "why was this contribution recommended on this date".
create table if not exists public.goal_allocation_revisions (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  goal_id       uuid        references public.goals(id) on delete cascade,
  weekly_amount numeric     not null default 0,
  strategy      text,
  rationale     text,
  created_at    timestamptz not null default now()
);
create index if not exists goal_allocation_revisions_user_idx on public.goal_allocation_revisions (user_id, created_at desc);

-- 6. NET WORTH SNAPSHOTS — for velocity/trend charts. Written on briefing build,
--    read for the dashboard trend; never an input to Margen.
create table if not exists public.net_worth_snapshots (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  captured_at      timestamptz not null default now(),
  liquid_net       numeric     not null default 0,
  total_net        numeric     not null default 0,
  total_debt       numeric     not null default 0,
  investment_value numeric     not null default 0,
  base_currency    text
);
create index if not exists net_worth_snapshots_user_idx on public.net_worth_snapshots (user_id, captured_at desc);

-- 7. EXTERNAL PORTFOLIO CONNECTIONS — SCAFFOLD ONLY (eToro etc. deferred). No
--    secrets stored here; no sync implemented. Provider-agnostic placeholder so
--    the model is future-ready without any unofficial API call or scraping.
create table if not exists public.external_portfolio_connections (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  provider     text        not null,        -- 'etoro' | 'manual' | ...
  status       text        not null default 'not_connected', -- not_connected | pending | connected | error
  last_synced_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists external_portfolio_connections_user_idx on public.external_portfolio_connections (user_id);

-- RLS: enabled, NO client policies → default deny. The service role (briefing
-- builder / agent executors / cron, no user session) bypasses RLS; the browser
-- reads these through server-side context, never directly. (Goals & preferences
-- keep their existing client policies; only NEW tables are deny-by-default.)
alter table public.investment_accounts            enable row level security;
alter table public.recurring_investment_plans     enable row level security;
alter table public.goal_allocation_revisions       enable row level security;
alter table public.net_worth_snapshots             enable row level security;
alter table public.external_portfolio_connections  enable row level security;

grant select, insert, update, delete on public.investment_accounts           to service_role;
grant select, insert, update, delete on public.recurring_investment_plans    to service_role;
grant select, insert,        delete on public.goal_allocation_revisions       to service_role; -- audit: no update (immutable)
grant select, insert, update, delete on public.net_worth_snapshots            to service_role;
grant select, insert, update, delete on public.external_portfolio_connections to service_role;
