-- Migration 047 — Bloque C: a reserve plan that TRANSFERS (not just reserves) needs a SOURCE.
-- Additive only. Human/authorized-agent applies this.
--
-- savings_plans already carries a DESTINATION (destination_account_id OR destination_asset_id).
-- An INVESTMENT reserve that the user actually moves each month (cash → an investment asset like
-- Etoro) also needs the SOURCE cash account it comes out of, so confirming it can book a
-- net-worth-neutral transfer: source account ↓ + destination asset ↑. NULL = a pure reserve
-- (acknowledge only, no ledger movement) — the default and how every savings plan behaves today.

alter table public.savings_plans
  add column if not exists source_account_id uuid references public.accounts(id) on delete set null;

-- P0 fix (found during Bloque C verify): savings_plans (migration 040) enabled RLS + authenticated
-- policies but never GRANTed the table, so every SERVICE-ROLE access (the materialization cron, the
-- resolve tool) hit "permission denied for table savings_plans" (42501) — the entire savings-plan
-- reserve materialization was silently dead for the cron. Add the grants (RLS below still scopes
-- authenticated to auth.uid() = user_id). Mirrors the recurring_occurrences grant fix in 044.
grant select, insert, update, delete on public.savings_plans to service_role;
grant select, insert, update, delete on public.savings_plans to authenticated;
