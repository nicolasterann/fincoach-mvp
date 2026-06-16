-- Stage 13 — Ambient Telegram Loop & Data Freshness (additive; manual apply).
-- Adds ambient-loop PREFERENCES to user_engagement and an idempotent, auditable
-- ambient_nudges ledger. No existing object is dropped or weakened. RLS stays on
-- every user-owned table. The cron/loop runs with the service role (no user
-- session), so direct client access to ambient_nudges is denied by default.

-- 1. Ambient preferences (extend the existing engagement row; all additive/null-safe).
alter table public.user_engagement
  add column if not exists ambient_enabled    boolean      not null default true,
  add column if not exists timezone           text,                    -- IANA tz, e.g. 'America/Guayaquil'
  add column if not exists quiet_hours_start   integer,                 -- local hour 0-23 (inclusive start)
  add column if not exists quiet_hours_end     integer,                 -- local hour 0-23 (exclusive end)
  add column if not exists frequency           text         not null default 'auto',  -- auto | daily | weekly | off
  add column if not exists nudge_weekdays      integer[],               -- 0=Sun..6=Sat, for frequency='weekly'
  add column if not exists max_nudges_per_day  integer      not null default 1,
  add column if not exists last_ambient_nudge_at timestamptz;

-- 2. Ambient nudge ledger: idempotency claim + delivery audit + learning signal.
create table if not exists public.ambient_nudges (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  topic           text        not null,        -- nudge topic (signal kind / freshness reason)
  day_bucket      date        not null,        -- the user's LOCAL day this nudge belongs to
  channel         text        not null default 'telegram',
  status          text        not null,        -- 'sent' | 'skipped' | 'failed'
  reason          text,                         -- decision reason (non-sensitive)
  priority        integer,
  message_preview text,                         -- short audit snippet (no full financial detail)
  delivered       boolean     not null default false,
  telegram_error  text,
  replied         boolean     not null default false,
  created_at      timestamptz not null default now()
);

-- Idempotency: AT MOST ONE 'sent' claim per user/topic/local-day, so cron
-- repeats, retries and concurrent workers can never double-send. The claim is
-- PERMANENT for the day (a failed delivery keeps status='sent', delivered=false)
-- so even "Telegram delivered but the response was lost" cannot re-send today;
-- 'skipped' rows (decision skips) never occupy the slot.
create unique index if not exists ambient_nudges_user_topic_day_uq
  on public.ambient_nudges (user_id, topic, day_bucket)
  where status = 'sent';

-- Helpful lookups for the loop (per-user per-day counting + audit).
create index if not exists ambient_nudges_user_day_idx
  on public.ambient_nudges (user_id, day_bucket);

-- RLS: enabled, NO client policies → default deny. The service role (cron /
-- channel handlers, no user session) bypasses RLS; clients never read this.
alter table public.ambient_nudges enable row level security;
grant select, insert, update on public.ambient_nudges to service_role;

-- Immutability of the financial-ish audit trail is not required here (status
-- transitions sent→failed are expected), so no immutability trigger.
