-- Allows authenticated users to manage their own financial preferences through RLS policies.

grant select, insert, update on public.user_financial_preferences to authenticated;
grant select, insert, update on public.user_financial_preferences to service_role;
