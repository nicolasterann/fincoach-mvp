-- Stage 26 — scheduled future changes ("en 3 meses mi sueldo sube a 1500",
-- "cada 3 meses sube 3% el arriendo", "pausa Netflix desde julio", "recuérdame
-- revisar la tasa cada mes"). A PLAN of a future mutation, applied by the daily
-- cron through the same typed stores the chat uses — never by the LLM directly.
-- Additive only. RLS deny-by-default: all reads/writes go through the
-- service-role store (channel handlers run without a user session), which
-- scopes every operation to user_id.

create table if not exists public.scheduled_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- What object the change applies to. 'reminder' has no target row.
  target_type text not null check (target_type in ('income_source','fixed_expense','goal','reminder')),
  target_id uuid,
  target_label text not null,
  change_kind text not null check (change_kind in ('set_amount','adjust_percent','adjust_fixed','pause','resume','set_frequency','reminder')),
  -- set_amount: the new amount. adjust_percent: percent (+3 = +3%).
  -- adjust_fixed: signed delta. set_frequency: unused (frequency below).
  amount numeric,
  currency text,
  new_frequency text check (new_frequency in ('weekly','biweekly','monthly','yearly')),
  effective_date date not null,
  cadence text not null default 'once' check (cadence in ('once','monthly','quarterly','semiannual','yearly')),
  next_run_date date not null,
  last_applied_on date,
  runs_count integer not null default 0,
  status text not null default 'pending' check (status in ('pending','applied','cancelled','failed')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_changes_due_idx
  on public.scheduled_changes (status, next_run_date);
create index if not exists scheduled_changes_user_idx
  on public.scheduled_changes (user_id, status);

alter table public.scheduled_changes enable row level security;
-- Deny-by-default: no anon/authenticated policies. Service role bypasses RLS;
-- the store scopes every query to user_id.
revoke all on public.scheduled_changes from anon, authenticated;
grant all on public.scheduled_changes to service_role;
