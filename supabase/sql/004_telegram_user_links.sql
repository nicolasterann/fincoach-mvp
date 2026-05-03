-- FinCoach MVP Telegram user links
-- Maps a Telegram chat/user to an authenticated FinCoach user.

create table if not exists public.telegram_user_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  telegram_chat_id text not null unique,
  telegram_user_id text,
  telegram_username text,
  telegram_first_name text,
  telegram_last_name text,

  is_active boolean not null default true,
  linked_at timestamptz not null default now(),
  last_message_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_user_links_user_id_idx
on public.telegram_user_links(user_id);

create index if not exists telegram_user_links_telegram_chat_id_idx
on public.telegram_user_links(telegram_chat_id);

drop trigger if exists set_telegram_user_links_updated_at on public.telegram_user_links;
create trigger set_telegram_user_links_updated_at
before update on public.telegram_user_links
for each row execute function public.set_updated_at();

alter table public.telegram_user_links enable row level security;

drop policy if exists "Users can view own telegram links" on public.telegram_user_links;
create policy "Users can view own telegram links"
on public.telegram_user_links
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own telegram links" on public.telegram_user_links;
create policy "Users can insert own telegram links"
on public.telegram_user_links
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own telegram links" on public.telegram_user_links;
create policy "Users can update own telegram links"
on public.telegram_user_links
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own telegram links" on public.telegram_user_links;
create policy "Users can delete own telegram links"
on public.telegram_user_links
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on public.telegram_user_links to authenticated;
