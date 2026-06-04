-- Kipu — Stage 6: Margen Kipu (cash-flow-aware safe spending margin).
--
-- ADDITIVE and NON-DESTRUCTIVE. Adds three nullable columns to
-- user_financial_preferences so onboarding can capture the user's monthly
-- saving / investing commitments and their essential-spending estimate. These
-- feed Margen Kipu: money the user commits to saving/investing (and essential
-- living costs) is reserved BEFORE Kipu reports free spending money, so the
-- user can spend their Margen Kipu knowing savings/investments are protected.
--
-- Existing rows get NULL (treated as 0 by the engine), so behavior is unchanged
-- until the user sets these. RLS + grants already exist on the table.
--
-- Apply manually in the Supabase SQL editor BEFORE deploying the Stage 6 code.

alter table public.user_financial_preferences
  add column if not exists monthly_savings_commitment numeric(14,2),
  add column if not exists monthly_investment_commitment numeric(14,2),
  add column if not exists essential_monthly_estimate numeric(14,2);
