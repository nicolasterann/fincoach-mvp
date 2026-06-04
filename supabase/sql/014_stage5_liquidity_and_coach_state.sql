-- Kipu — Stage 5: liquidity realism + proactive coaching state.
--
-- ADDITIVE and NON-DESTRUCTIVE. Adds one nullable-with-default column and two
-- new tables, all guarded with `if not exists` / `drop policy if exists`. It
-- never drops or rewrites existing objects and never changes existing rows
-- (the new `liquidity` column defaults every existing account to 'liquid', so
-- current behavior is unchanged until an account is explicitly marked
-- non-liquid). RLS stays enabled.
--
-- Apply manually in the Supabase SQL editor BEFORE deploying the Stage 5 code.
--
-- Adds:
--   1. public.accounts.liquidity — 'liquid' (spendable now: bank/cash/wallet)
--      vs 'non_liquid' (investments, long-term/protected savings, etc.). Only
--      liquid, non-goal accounts count as "available this week".
--   2. public.coach_nudge_log — per-signal cooldown so Kipu does not repeat the
--      same proactive warning every message (intelligent nudge continuity).
--   3. public.user_engagement — pause / light / normal mode + last reconciled,
--      so coaching respects pause/light/return and tracks weekly reconciliation.
--
-- The two new tables hold operational coaching state only — financial truth
-- still lives in accounts/debt_accounts/goals/transactions. RLS + service_role
-- grants mirror 012_conversation_memory.sql.

-- =========================
-- 1. Account liquidity
-- =========================

alter table public.accounts
  add column if not exists liquidity text not null default 'liquid'
    check (liquidity in ('liquid', 'non_liquid'));

-- =========================
-- 2. Coach nudge log (anti-repetition)
-- =========================

create table if not exists public.coach_nudge_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_kind text not null,
  last_surfaced_at timestamptz not null default now(),
  surface_count integer not null default 1,
  unique (user_id, signal_kind)
);

create index if not exists coach_nudge_log_user_idx
  on public.coach_nudge_log(user_id, signal_kind);

alter table public.coach_nudge_log enable row level security;

drop policy if exists "Users can view own nudge log" on public.coach_nudge_log;
create policy "Users can view own nudge log"
on public.coach_nudge_log for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can insert own nudge log" on public.coach_nudge_log;
create policy "Users can insert own nudge log"
on public.coach_nudge_log for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update own nudge log" on public.coach_nudge_log;
create policy "Users can update own nudge log"
on public.coach_nudge_log for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own nudge log" on public.coach_nudge_log;
create policy "Users can delete own nudge log"
on public.coach_nudge_log for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.coach_nudge_log to authenticated;
grant select, insert, update, delete on public.coach_nudge_log to service_role;

-- =========================
-- 3. User engagement (pause / light / reconciliation)
-- =========================

create table if not exists public.user_engagement (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'normal' check (mode in ('normal', 'light', 'paused')),
  paused_until timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_user_engagement_updated_at on public.user_engagement;
create trigger set_user_engagement_updated_at
before update on public.user_engagement
for each row execute function public.set_updated_at();

alter table public.user_engagement enable row level security;

drop policy if exists "Users can view own engagement" on public.user_engagement;
create policy "Users can view own engagement"
on public.user_engagement for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can insert own engagement" on public.user_engagement;
create policy "Users can insert own engagement"
on public.user_engagement for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update own engagement" on public.user_engagement;
create policy "Users can update own engagement"
on public.user_engagement for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_engagement to authenticated;
grant select, insert, update, delete on public.user_engagement to service_role;
