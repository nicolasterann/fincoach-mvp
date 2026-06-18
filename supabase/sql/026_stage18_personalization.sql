-- Stage 18 — Personalization, Memory & Life Context Engine (additive; manual apply).
-- Adds the EXPLICIT personalization preferences that don't already have a home,
-- the user-declared life context, and an append-only preference/feedback log. It
-- REUSES the existing explicit-preference surfaces — communication tone/detail in
-- `coach_preferences`, ambition/risk in `user_financial_preferences`, nudge timing
-- in `user_engagement` — and does NOT duplicate or weaken them. Inferred behavior
-- (logging rhythm, channel, modality, nudge engagement) stays DERIVED at read time
-- (no table). No existing object is dropped or weakened; RLS stays on every
-- user-owned table. Columns use text (not new enums) to stay additive/flexible.

-- 1. EXPLICIT Stage-18 preferences with no existing home. financial_philosophy is
--    the CORE lever (experiences | balanced | builder | wealth): it shapes FRAMING
--    and the allocation joy-floor posture only — never the money math or safety.
create table if not exists public.user_personalization (
  user_id              uuid        primary key references auth.users(id) on delete cascade,
  financial_philosophy text,        -- experiences | balanced | builder | wealth
  nudge_sensitivity    text,        -- low | normal | high
  dashboard_density    text,        -- minimal | balanced | rich
  preferred_capture    text,        -- text | voice | photo | statement | telegram | app | web
  onboarding_mode      text,        -- simple | power
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- 2. USER-DECLARED life context (never inferred for sensitive attributes). Only
--    what the user explicitly states or is directly financial (student, freelancer,
--    parent/family support, traveler, saving-for-move, irregular-income, …).
create table if not exists public.user_life_context (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  kind       text        not null,         -- student | freelancer | salaried | parent | traveler | entrepreneur | supporting_family | ...
  label      text        not null,         -- short human label
  source     text        not null default 'user_stated', -- user_stated | derived_financial
  created_at timestamptz not null default now()
);
create unique index if not exists user_life_context_user_kind_uq on public.user_life_context (user_id, kind);

-- 3. APPEND-ONLY preference / feedback log: every explicit preference change or
--    feedback ("ese recordatorio fue molesto", "muy estricto"). Immutable audit
--    for the learning loop + observability. NEVER read back into money math.
create table if not exists public.user_preference_events (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  event_type text        not null,         -- tone | detail | risk | philosophy | nudge_feedback | dashboard | onboarding | reset | ...
  value      text,                          -- the new value / feedback (non-sensitive)
  source     text        not null default 'chat', -- chat | dashboard | onboarding | ambient
  created_at timestamptz not null default now()
);
create index if not exists user_preference_events_user_idx on public.user_preference_events (user_id, created_at desc);

-- RLS: enabled, NO client policies → default deny. The service role (briefing
-- builder / agent executors / cron, no user session) bypasses RLS; the browser
-- reads these through server-side context, never directly.
alter table public.user_personalization     enable row level security;
alter table public.user_life_context         enable row level security;
alter table public.user_preference_events     enable row level security;

grant select, insert, update, delete on public.user_personalization to service_role;
grant select, insert, update, delete on public.user_life_context     to service_role;
grant select, insert                on public.user_preference_events  to service_role; -- append-only immutable audit (no update, no delete)
