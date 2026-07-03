-- Stage 30 (#6) — let the onboarding wizard (and the app) write a user's own
-- assets. public.investment_accounts (Stage 17) had RLS enabled but ONLY a
-- service_role grant + no authenticated policies, so a user-session insert (how
-- save-actions.ts writes accounts/debts/goals/budgets) was silently rejected.
--
-- This migration is ADDITIVE and does NOT weaken security: it grants the
-- authenticated role CRUD and adds owner-scoped RLS policies (auth.uid() =
-- user_id) — the exact pattern already used for accounts, goals, and
-- budget_categories. RLS stays ENABLED; every row remains user-scoped. Nothing
-- is dropped or rewritten. Apply once; safe to re-run (idempotent).

grant select, insert, update, delete on public.investment_accounts to authenticated;

drop policy if exists "Users can view own investment accounts" on public.investment_accounts;
create policy "Users can view own investment accounts"
on public.investment_accounts
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own investment accounts" on public.investment_accounts;
create policy "Users can insert own investment accounts"
on public.investment_accounts
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own investment accounts" on public.investment_accounts;
create policy "Users can update own investment accounts"
on public.investment_accounts
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own investment accounts" on public.investment_accounts;
create policy "Users can delete own investment accounts"
on public.investment_accounts
for delete
to authenticated
using (auth.uid() = user_id);
