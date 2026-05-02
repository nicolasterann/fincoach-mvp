-- FinCoach MVP grants for authenticated app access.
-- RLS still controls row-level ownership.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.debt_accounts to authenticated;
grant select, insert, update, delete on public.goals to authenticated;
