-- Allows server-side Telegram webhook admin client to read and manage Telegram links.
-- This is safe only because SUPABASE_SERVICE_ROLE_KEY must stay server-side.

grant select, insert, update, delete on public.telegram_user_links to service_role;
