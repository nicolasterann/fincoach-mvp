-- Stores Telegram update ids already received by the webhook.
-- Prevents duplicate transaction processing if Telegram retries the same update.

create table if not exists public.telegram_processed_updates (
  update_id bigint primary key,
  telegram_chat_id text not null,
  telegram_message_id text,
  received_at timestamptz not null default now()
);

create index if not exists telegram_processed_updates_chat_id_idx
on public.telegram_processed_updates(telegram_chat_id);

grant select, insert on public.telegram_processed_updates to service_role;
