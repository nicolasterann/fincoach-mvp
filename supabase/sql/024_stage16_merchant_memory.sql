-- Stage 16 — Budget Intelligence & Category Learning (additive; manual apply).
-- Adds the STRUCTURED merchant-memory store the deterministic category/merchant
-- classifier reads every turn. Free-text notes (user_context_notes) cannot be
-- read reliably by code, so corrections like "eso no es comida, es transporte" or
-- "PAYU*XYZ siempre es mi gym" need a typed, queryable home that GENERALIZES to
-- future transactions. No existing object is dropped or weakened; RLS stays on
-- every user-owned table.

-- 1. Per-user learned merchant facts. The normalizer applies these FIRST (a user
--    correction always wins over the built-in rules), so Kipu stops repeating a
--    mistake once told. Keyed by a normalized match pattern (lowercased substring
--    of the cleaned descriptor) so one correction covers every future variant.
create table if not exists public.user_merchant_memory (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  match_pattern    text        not null,        -- normalized substring to match (lowercase)
  merchant_family  text,                         -- readable family override (e.g. 'Uber')
  category         text,                         -- financial_category override (e.g. 'transport')
  spending_type    text,                         -- optional spending-type hint
  is_recurring     boolean,                      -- known recurring? (null = unknown)
  note             text,                         -- short human note (provenance / why)
  source           text        not null default 'user_correction', -- user_correction | inferred | system
  correction_count integer     not null default 1,  -- how many times reinforced (confidence signal)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One learned fact per user + pattern: a repeated correction UPSERTS (bumps
-- correction_count / refines fields) instead of duplicating.
create unique index if not exists user_merchant_memory_user_pattern_uq
  on public.user_merchant_memory (user_id, match_pattern);

-- Fast per-user load for the classifier (small set, read every briefing build).
create index if not exists user_merchant_memory_user_idx
  on public.user_merchant_memory (user_id);

-- RLS: enabled, NO client policies → default deny. The service role (briefing
-- builder / agent executors / cron, no user session) bypasses RLS; the browser
-- never reads or writes this directly.
alter table public.user_merchant_memory enable row level security;
grant select, insert, update, delete on public.user_merchant_memory to service_role;
