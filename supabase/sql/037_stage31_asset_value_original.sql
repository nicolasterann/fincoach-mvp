-- Stage 31 — assets FX honesty. Additive only.
-- Chat/onboarding asset writers now store value_base ALWAYS in the user's base
-- currency (converted with the user's known rate — never a fabricated 1:1).
-- value_original preserves the amount as the user stated it in the asset's own
-- currency, mirroring the ledger's original_*/base_* convention.
alter table public.investment_accounts add column if not exists value_original numeric;
