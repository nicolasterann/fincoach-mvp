-- Stage 20 (micro-stage C) — Personality / Life-Philosophy Test result (additive; manual apply).
-- One latest result per user (retake overwrites). Feeds Stage 18 personalization;
-- the applied preferences live in their own stores (user_personalization /
-- user_financial_preferences / coach_preferences). This row is the test record so
-- Kipu can show the archetype, explain it, let the user retake or forget it.
-- Service-role-only, deny-by-default (no client policies), like the Stage 16/18 tables.
create table if not exists public.user_personality_test (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  archetype   text        not null,                 -- explorador | constructor | guardian | ambicioso | realizador | equilibrista
  dimensions  jsonb       not null default '{}'::jsonb,
  version     integer     not null default 1,
  confidence  text        not null default 'low',   -- low | medium | high
  taken_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.user_personality_test enable row level security;
grant select, insert, update, delete on public.user_personality_test to service_role;
