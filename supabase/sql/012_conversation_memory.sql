-- Conversation memory foundation for Kipu chat.
--
-- Adds two tables that let Kipu remember short-lived chat context
-- between Telegram (or web) messages:
--
--   public.pending_chat_clarifications
--     One open clarification Kipu is waiting on from the user. The next
--     reply on the same channel/chat can resolve it in context (e.g.
--     "fue el cargo normal" → apply the fixed expense Kipu just asked
--     about). Operational state only — financial truth still lives in
--     accounts/debt_accounts/goals/transactions.
--
--   public.chat_messages
--     Short rolling log of recent user/assistant turns per channel/chat.
--     Used for advisory follow-ups (e.g. "¿y si lo pago con Visa?"
--     right after asking about a watch). Context, not ledger — never
--     the source of any financial number.
--
-- RLS is enabled on both. Authenticated users can manage only their
-- own rows. service_role is granted access so the Telegram webhook
-- (which runs without a Supabase session) can manage rows on the
-- user's behalf, consistent with telegram_user_links and the financial
-- service-role grants in 006_financial_service_role_grants.sql.

-- =========================
-- Pending chat clarifications
-- =========================

create table if not exists public.pending_chat_clarifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'web')),
  chat_id text,
  kind text not null check (kind in (
    'fixed_expense_amount_mismatch',
    'fixed_expense_match_confirmation',
    'goal_name_mismatch',
    'payment_source_mismatch',
    'vague_payment'
  )),
  payload jsonb not null default '{}'::jsonb,
  prompt text not null,
  status text not null default 'open' check (status in (
    'open',
    'resolved',
    'expired',
    'cancelled'
  )),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz
);

create index if not exists pending_chat_clarifications_user_status_idx
on public.pending_chat_clarifications(user_id, status, expires_at);

create index if not exists pending_chat_clarifications_channel_chat_idx
on public.pending_chat_clarifications(channel, chat_id, status, expires_at);

alter table public.pending_chat_clarifications enable row level security;

drop policy if exists "Users can view own pending clarifications"
on public.pending_chat_clarifications;
create policy "Users can view own pending clarifications"
on public.pending_chat_clarifications
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own pending clarifications"
on public.pending_chat_clarifications;
create policy "Users can insert own pending clarifications"
on public.pending_chat_clarifications
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own pending clarifications"
on public.pending_chat_clarifications;
create policy "Users can update own pending clarifications"
on public.pending_chat_clarifications
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own pending clarifications"
on public.pending_chat_clarifications;
create policy "Users can delete own pending clarifications"
on public.pending_chat_clarifications
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete
on public.pending_chat_clarifications to authenticated;

grant select, insert, update, delete
on public.pending_chat_clarifications to service_role;

-- =========================
-- Chat messages (recent turn buffer)
-- =========================

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'web')),
  chat_id text,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  message_type text not null default 'chat' check (message_type in (
    'chat',
    'transaction',
    'clarification',
    'advisory',
    'system'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_user_created_idx
on public.chat_messages(user_id, created_at desc);

create index if not exists chat_messages_channel_chat_created_idx
on public.chat_messages(channel, chat_id, created_at desc);

alter table public.chat_messages enable row level security;

drop policy if exists "Users can view own chat messages" on public.chat_messages;
create policy "Users can view own chat messages"
on public.chat_messages
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own chat messages" on public.chat_messages;
create policy "Users can insert own chat messages"
on public.chat_messages
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own chat messages" on public.chat_messages;
create policy "Users can delete own chat messages"
on public.chat_messages
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, delete on public.chat_messages to authenticated;
grant select, insert, delete on public.chat_messages to service_role;
