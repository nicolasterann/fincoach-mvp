-- Stage 29 — chat as the full control surface.
-- Additive only. Enables (a) soft-closing accounts/cards from chat WITHOUT hard
-- deleting financial rows (status flips to 'closed'; the row stays for audit and
-- history, and is reconciled to 0 before closing), and (b) persistent
-- bug/feedback reports so "reportar un problema" actually stores something.
-- RLS on accounts/debt_accounts is unchanged (they already scope by user_id).
-- user_feedback is deny-by-default + service_role only (channel handlers run
-- without a user session, like every other Kipu write store).

-- (a) Soft-close status for money-holding entities. Default 'active' backfills
--     every existing row, so nothing changes until a user closes one.
alter table public.accounts add column if not exists status text not null default 'active';
alter table public.debt_accounts add column if not exists status text not null default 'active';

-- (b) Persistent feedback / bug reports captured by the report_bug chat tool.
create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'bug' check (kind in ('bug', 'idea', 'confusion', 'other')),
  message text not null,
  context text,
  channel text,
  created_at timestamptz not null default now()
);
create index if not exists user_feedback_user_idx on public.user_feedback (user_id, created_at desc);
alter table public.user_feedback enable row level security;
revoke all on public.user_feedback from anon, authenticated;
grant all on public.user_feedback to service_role;
