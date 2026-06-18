-- Stage 19 — Household, Shared Finance & Collaborative Money OS (additive; manual apply).
-- Models SHARED financial truth (households, members, shared expenses, splits,
-- settlements, shared-goal contributions) WITHOUT touching the personal ledger.
-- Shared rows are MULTI-OWNER (several members), so the simple auth.uid()=user_id
-- RLS policy does NOT apply: every table is RLS-enabled with NO client policies
-- (deny-by-default) and granted to service_role only. Membership + per-member
-- permission checks are enforced deterministically in the typed store/engine layer
-- (the agent executors + server actions call them; the browser never reads these
-- tables directly). This mirrors the Stage 16/17/18 service-role-only convention.
-- Personal truth stays in `transactions`/`accounts` (unchanged). No existing object
-- is dropped or weakened; columns are text (not new enums) to stay additive.

-- 1. HOUSEHOLD / GROUP. owner_id is the creator; type covers couple/family/
--    roommates/trip/custom; privacy_mode defaults to the conservative "minimal".
create table if not exists public.households (
  id            uuid        primary key default gen_random_uuid(),
  owner_id      uuid        not null references auth.users(id) on delete cascade,
  name          text        not null,
  type          text        not null default 'custom',   -- couple | family | roommates | trip | custom
  base_currency text        not null default 'USD',
  mode          text        not null default 'shared_expenses', -- shared_expenses | shared_goals | full | trip_split | family_support | custom
  privacy_mode  text        not null default 'minimal',   -- minimal | standard | full
  status        text        not null default 'active',    -- active | archived
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists households_owner_idx on public.households (owner_id);

-- 2. MEMBERS. user_id NULL = non-user participant ("mi mamá", a friend on a trip).
--    role drives permissions; status gates access (only 'active' members are in).
create table if not exists public.household_members (
  id           uuid        primary key default gen_random_uuid(),
  household_id uuid        not null references public.households(id) on delete cascade,
  user_id      uuid        references auth.users(id) on delete set null, -- NULL for non-user participants
  display_name text        not null,
  role         text        not null default 'member',     -- owner | admin | member | viewer | contributor | external
  status       text        not null default 'active',     -- active | invited | left | removed
  permissions  text,                                       -- optional CSV of extra grants/limits (reserved)
  invited_by   uuid        references auth.users(id) on delete set null,
  joined_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists household_members_household_idx on public.household_members (household_id);
create index if not exists household_members_user_idx on public.household_members (user_id);
-- A real (user-backed) member appears at most once per household.
create unique index if not exists household_members_household_user_uq on public.household_members (household_id, user_id) where user_id is not null;

-- 3. INVITES — explicit acceptance lifecycle. A member is NOT in until they accept.
create table if not exists public.household_invites (
  id              uuid        primary key default gen_random_uuid(),
  household_id    uuid        not null references public.households(id) on delete cascade,
  invited_user_id uuid        references auth.users(id) on delete cascade, -- the target Kipu user (when known)
  invited_label   text,                                    -- free label when the user isn't resolved yet
  role            text        not null default 'member',
  status          text        not null default 'pending',  -- pending | accepted | declined | cancelled | expired
  token           text        not null default replace(gen_random_uuid()::text, '-', ''),
  created_by      uuid        not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists household_invites_household_idx on public.household_invites (household_id);
create index if not exists household_invites_invited_idx on public.household_invites (invited_user_id, status);

-- 4. SHARED EXPENSES — the household truth, counted ONCE. origin_transaction_id
--    optionally links the payer's PERSONAL ledger row (their real outflow) so the
--    same real-world event is never treated as two. Money math lives in base.
create table if not exists public.shared_expenses (
  id                   uuid        primary key default gen_random_uuid(),
  household_id         uuid        not null references public.households(id) on delete cascade,
  payer_member_id      uuid        not null references public.household_members(id) on delete restrict,
  description          text        not null,
  category             text,
  total_original       numeric     not null,
  original_currency    text        not null default 'USD',
  total_base           numeric     not null,
  base_currency        text        not null default 'USD',
  occurred_at          timestamptz not null default now(),
  split_method         text        not null default 'equal', -- equal | percentage | fixed | income_weighted | custom | payer_absorbs
  status               text        not null default 'open',  -- open | settled | cancelled
  origin_transaction_id uuid       references public.transactions(id) on delete set null,
  note                 text,
  created_by           uuid        not null references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists shared_expenses_household_idx on public.shared_expenses (household_id, occurred_at desc);

-- 5. SPLITS — one row per participant of a shared expense (their share + settled).
create table if not exists public.shared_expense_splits (
  id                uuid        primary key default gen_random_uuid(),
  shared_expense_id uuid        not null references public.shared_expenses(id) on delete cascade,
  member_id         uuid        not null references public.household_members(id) on delete cascade,
  share_base        numeric     not null default 0,
  settled_base      numeric     not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists shared_expense_splits_expense_idx on public.shared_expense_splits (shared_expense_id);
create unique index if not exists shared_expense_splits_expense_member_uq on public.shared_expense_splits (shared_expense_id, member_id);

-- 6. SETTLEMENTS — recorded reimbursements between members (A paid B). A reimbursement
--    is NOT income; when linked to the personal ledger it is a `refund`, never income.
create table if not exists public.household_settlements (
  id                uuid        primary key default gen_random_uuid(),
  household_id      uuid        not null references public.households(id) on delete cascade,
  from_member_id    uuid        not null references public.household_members(id) on delete cascade,
  to_member_id      uuid        not null references public.household_members(id) on delete cascade,
  amount_base       numeric     not null,
  base_currency     text        not null default 'USD',
  status            text        not null default 'paid',   -- pending | paid
  note              text,
  related_expense_id uuid       references public.shared_expenses(id) on delete set null,
  marked_paid_at    timestamptz,
  created_by        uuid        not null references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists household_settlements_household_idx on public.household_settlements (household_id, created_at desc);

-- 7. SHARED GOAL CONTRIBUTIONS — extends Stage 17 goals (a goal gets a household_id
--    below). Each member's committed weekly contribution to a shared goal. A member
--    is responsible ONLY for their own committed contribution (never auto-assigned).
create table if not exists public.household_goal_contributions (
  id           uuid        primary key default gen_random_uuid(),
  household_id uuid        not null references public.households(id) on delete cascade,
  goal_id      uuid        not null references public.goals(id) on delete cascade,
  member_id    uuid        not null references public.household_members(id) on delete cascade,
  weekly_base  numeric     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists household_goal_contributions_goal_idx on public.household_goal_contributions (goal_id);
create unique index if not exists household_goal_contributions_goal_member_uq on public.household_goal_contributions (goal_id, member_id);

-- 8. AUDIT LOG — append-only. Who created/edited/settled what, for shared trust.
create table if not exists public.household_audit_log (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.households(id) on delete cascade,
  actor_user_id uuid        references auth.users(id) on delete set null,
  action        text        not null,                      -- create_household | add_member | invite | accept | add_expense | edit_split | mark_paid | create_goal | leave | remove | set_visibility | ...
  entity        text,                                       -- expense | split | settlement | goal | member | household
  detail        text,                                       -- short non-sensitive description
  created_at    timestamptz not null default now()
);
create index if not exists household_audit_log_household_idx on public.household_audit_log (household_id, created_at desc);

-- ADDITIVE: a Stage 17 goal can belong to a household (shared goal). NULL = personal.
alter table public.goals
  add column if not exists household_id uuid references public.households(id) on delete set null,
  add column if not exists is_shared    boolean not null default false;

-- RLS: enabled, NO client policies → deny-by-default. service_role (agent executors,
-- server actions, cron) bypasses RLS and the store layer enforces membership +
-- permission before every read/write. The audit log is append-only (no update/delete).
alter table public.households                   enable row level security;
alter table public.household_members            enable row level security;
alter table public.household_invites            enable row level security;
alter table public.shared_expenses              enable row level security;
alter table public.shared_expense_splits        enable row level security;
alter table public.household_settlements        enable row level security;
alter table public.household_goal_contributions enable row level security;
alter table public.household_audit_log          enable row level security;

grant select, insert, update, delete on public.households                   to service_role;
grant select, insert, update, delete on public.household_members            to service_role;
grant select, insert, update, delete on public.household_invites            to service_role;
grant select, insert, update, delete on public.shared_expenses              to service_role;
grant select, insert, update, delete on public.shared_expense_splits        to service_role;
grant select, insert, update, delete on public.household_settlements        to service_role;
grant select, insert, update, delete on public.household_goal_contributions to service_role;
grant select, insert                on public.household_audit_log          to service_role; -- append-only immutable audit
