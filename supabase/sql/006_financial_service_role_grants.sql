-- Allows server-side channel handlers such as Telegram webhook to read/write financial data.
-- SUPABASE_SERVICE_ROLE_KEY must stay server-side only.

grant select, insert, update, delete on public.accounts to service_role;
grant select, insert, update, delete on public.debt_accounts to service_role;
grant select, insert, update, delete on public.goals to service_role;
grant select, insert, update, delete on public.transactions to service_role;
